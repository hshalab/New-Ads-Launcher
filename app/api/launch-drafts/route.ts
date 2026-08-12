import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, requireRole } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { recordActivity } from "@/lib/notifications/emit"

// ── GET /api/launch-drafts            → list all drafts (no data JSONB)
// ── GET /api/launch-drafts?id=xxx     → load one draft + enrich creatives
// ── POST /api/launch-drafts           → save draft (lean data)
// ── DELETE /api/launch-drafts?id=xxx  → delete draft

/**
 * This route reaches into exactly two fields of a saved draft — `creativeId` on each row and
 * `selectedCreativeIds` on the snapshot. Everything else is stored and handed back untouched,
 * so it stays opaque here rather than being restated: `launch/page.tsx` owns the real TableRow
 * and settings shapes, and a second copy of them in this file would be a copy that drifts.
 */
type DraftRow = { creativeId?: string | null } & Record<string, unknown>
type DraftSnapshot = { selectedCreativeIds?: string[] } & Record<string, unknown>
type DraftData = {
  rows?: DraftRow[]
  globalSettings?: Record<string, unknown>
  snapshot?: DraftSnapshot
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const db = createAdminClient()
    const id = new URL(request.url).searchParams.get("id")

    if (id) {
      // Load one draft → fetch creative objects fresh from DB
      const { data: draft, error } = await db
        .from("launch_drafts")
        .select("*")
        .eq("id", id)
        .eq("org_id", ctx.orgId)
        .single()

      if (error || !draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 })

      const draftData = draft.data as DraftData
      const rows = draftData.rows || []
      const snapshotIds: string[] = draftData.snapshot?.selectedCreativeIds || []

      // Every creative the draft references: Table-mode rows plus the Gallery-mode
      // selection. Resolved in one query, then handed back to whichever needs it.
      const creativeIds = [...new Set([
        ...rows.map(r => r.creativeId),
        ...snapshotIds,
      ].filter((id): id is string => Boolean(id)))]

      // Fetch creatives fresh from DB — a creative may have been deleted, or re-uploaded to
      // Meta with a new fb_video_id, since the draft was saved.
      const creativeMap: Record<string, Record<string, unknown>> = {}
      if (creativeIds.length > 0) {
        const { data: creatives } = await db
          .from("creatives")
          .select("id, file_name, file_url, media_type, headline, primary_text, cta, link_url, fb_image_url, fb_thumbnail_url, fb_image_hash, fb_video_id, status")
          .eq("org_id", ctx.orgId)
          .in("id", creativeIds)
        for (const c of creatives || []) creativeMap[c.id] = c
      }

      // Rebuild full TableRow[] by merging creative objects back in
      const fullRows = rows.map(r => ({
        ...r,
        creative: r.creativeId ? (creativeMap[r.creativeId] || null) : null,
      }))

      // Order follows the snapshot, not the query: the user's selection order is what the
      // gallery shows. Ids that no longer resolve drop out, and the client reports how many.
      const selectedCreatives = snapshotIds.map(id => creativeMap[id]).filter(Boolean)

      return NextResponse.json({
        draft: { ...draft, data: { ...draftData, rows: fullRows, selectedCreatives } },
      })
    }

    // List drafts — no data JSONB for performance
    const { data, error } = await db
      .from("launch_drafts")
      .select("id, name, ad_account_id, ad_account_name, row_count, creative_thumbs, user_name, created_at")
      .eq("org_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(100)

    if (error) {
      if (error.code === "42P01") return NextResponse.json({ drafts: [], _migrationNeeded: true })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ drafts: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const denied = requireRole(ctx)
    if (denied) return denied

    const db = createAdminClient()
    const body = await request.json()
    const { name, adAccountId, adAccountName, rows, globalSettings, snapshot, creativeThumbs } = body

    const rowList: DraftRow[] = Array.isArray(rows) ? rows : []
    const snapshotIds: string[] = snapshot?.selectedCreativeIds || []

    // A Gallery-mode draft has no Table rows — its unit of work is the selected creatives.
    // Requiring rows is what made "Save Draft" impossible outside Table mode.
    if (!rowList.length && !snapshotIds.length) {
      return NextResponse.json({ error: "Nothing to save — configure an ad first" }, { status: 400 })
    }

    // Collect creative IDs and thumbnails for list preview
    const creativeIds = [...new Set([
      ...rowList.map(r => r.creativeId),
      ...snapshotIds,
    ].filter((id): id is string => Boolean(id)))]
    const thumbs = creativeThumbs || []
    // The drafts list shows this as "Rows"; for a Gallery draft the comparable count is the
    // number of ads the selection will produce.
    const unitCount = rowList.length || snapshotIds.length

    const { data, error } = await db
      .from("launch_drafts")
      .insert({
        org_id: ctx.orgId,
        user_id: ctx.user.id,
        user_name: ctx.user.full_name || ctx.user.email?.split("@")[0] || "Unknown",
        name: name || `${unitCount} Ads — ${new Date().toLocaleString("vi-VN")}`,
        ad_account_id: adAccountId || null,
        ad_account_name: adAccountName || null,
        row_count: unitCount,
        creative_ids: creativeIds,
        creative_thumbs: thumbs,
        // `data` is JSONB, so `snapshot` needs no migration. It is stored only when sent, so
        // drafts written by the previous build stay exactly as they were.
        data: {
          rows: rowList,
          globalSettings: globalSettings || {},
          ...(snapshot ? { snapshot } : {}),
        },
      })
      .select("id, name, created_at")
      .single()

    if (error) {
      if (error.code === "42P01") return NextResponse.json({ error: "Run migration: 20260515_launch_drafts.sql" }, { status: 503 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Saving a draft is real preparation work — Tracking counts it as Reuse. Audit-only:
    // the org does not need a notification every time somebody parks a launch.
    await recordActivity({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.full_name || ctx.user.email?.split("@")[0] || "Someone",
      objectType: "draft",
      objectId: data.id,
      objectName: data.name,
      action: "created",
    })

    return NextResponse.json({ draft: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const denied = requireRole(ctx)
    if (denied) return denied

    const id = new URL(request.url).searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

    const db = createAdminClient()
    const { error } = await db
      .from("launch_drafts")
      .delete()
      .eq("id", id)
      .eq("org_id", ctx.orgId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 })
  }
}
