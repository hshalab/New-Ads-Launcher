import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getFacebookConnection } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  collectAllCreativePages,
  mapCreativeForClient,
  sortCreativesByLatestAssignment,
} from "@/lib/creative-media"
import { uploadImageToMeta, uploadVideoToMeta, pollVideoReady } from "@/lib/facebook"
import { emitAndLog } from "@/lib/notifications/emit"
import { deleteMediaObject } from "@/lib/media-delete"
import { isValidDateOnly, localDateRangeToUtc, parseTimezoneOffset } from "@/lib/local-date-range"

// Large media uploads (videos can be 100MB+) — use Node runtime + extended timeout
export const runtime = "nodejs"
export const maxDuration = 300 // 5 minutes for big videos
export const dynamic = "force-dynamic"

const CREATIVE_SELECT = `
  *,
  portal_media_assignments(created_at),
  portal_media_items(
    object_key,
    portal_asset_id,
    file_name,
    media_type,
    mime_type,
    file_size,
    portal_created_at,
    brand_id,
    brand_name,
    brand_slug,
    product_id,
    product_name,
    language,
    width,
    height,
    duration_seconds,
    pdp_url,
    sales_page_url,
    landing_url,
    checkout_funnel_url,
    brief_type,
    voice_variant
  )
`

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-")
}

function portalItem(creative: any) {
  const value = creative.portal_media_items
  return Array.isArray(value) ? value[0] : value
}

function creativeFacets(creatives: any[]) {
  const brands = new Set<string>()
  const products = new Set<string>()
  const languages = new Set<string>()
  for (const creative of creatives) {
    const portal = portalItem(creative)
    if (portal?.brand_name) brands.add(portal.brand_name)
    if (portal?.product_name) products.add(portal.product_name)
    if (portal?.language) languages.add(portal.language)
  }
  return {
    brands: [...brands].sort(),
    products: [...products].sort(),
    languages: [...languages].sort(),
  }
}

async function uploadOriginalToStorage(params: {
  orgId: string
  fileName: string
  contentType: string
  buffer: ArrayBuffer
}) {
  const storagePath = `creatives/${params.orgId}/${crypto.randomUUID()}-${sanitizeFileName(params.fileName)}`
  const admin = createAdminClient()
  const { error } = await admin.storage.from("ad-media").upload(storagePath, params.buffer, {
    contentType: params.contentType,
    upsert: false,
    cacheControl: "31536000",
  })

  if (error) {
    throw new Error(error.message)
  }

  const { data } = admin.storage.from("ad-media").getPublicUrl(storagePath)
  return { storagePath, publicUrl: data.publicUrl }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const url = new URL(request.url)
    // Repeat ?ad_account_id=X&ad_account_id=Y for a multi-account filter (Assets page);
    // a single value still works the same as before.
    const adAccountIds = url.searchParams.getAll("ad_account_id")
    const mediaType    = url.searchParams.get("media_type")   // "image" | "video"
    const statusFilter = url.searchParams.get("status")       // "uploaded" | "pending" | "processing" | "archived"
    const nameContains = url.searchParams.get("name_contains")
    const readiness    = url.searchParams.get("readiness")
    const brand        = url.searchParams.get("brand")
    const product      = url.searchParams.get("product")
    const language     = url.searchParams.get("language")
    const dateFrom     = url.searchParams.get("date_from")
    const dateTo       = url.searchParams.get("date_to")
    const timezoneOffset = parseTimezoneOffset(url.searchParams.get("timezone_offset"))
    const userOnly     = url.searchParams.get("user_only") === "true"
    const limit    = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 200)
    const cursor   = url.searchParams.get("cursor") || null
    const sortMode = url.searchParams.get("sort")
    if ((dateFrom && !isValidDateOnly(dateFrom)) || (dateTo && !isValidDateOnly(dateTo))) {
      return NextResponse.json({ error: "date_from and date_to must use YYYY-MM-DD" }, { status: 400 })
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return NextResponse.json({ error: "date_from must not be after date_to" }, { status: 400 })
    }
    const assignedSortOffset = sortMode === "assigned_desc"
      ? Math.max(parseInt(cursor || "0", 10) || 0, 0)
      : 0

    const supabase = createAdminClient()

    // Batch lookup by filenames (for CSV import) OR single dedup check (file_name + file_size)
    const fileNames = url.searchParams.getAll("file_name")
    const fileSize  = url.searchParams.get("file_size")
    if (fileNames.length > 0) {
      const db = createAdminClient()
      let q = db
        .from("creatives")
        .select("id, file_name, file_size, file_url, media_type, headline, primary_text, cta, link_url, fb_image_url, fb_thumbnail_url, fb_image_hash, fb_video_id, status, ad_account_id")
        .eq("org_id", ctx.orgId)
        .in("file_name", fileNames)
        .order("created_at", { ascending: false })
      // Dedup mode: single name + size → only return rows that already have a Meta asset ID
      if (fileSize && fileNames.length === 1) {
        q = (q as any).eq("file_size", parseInt(fileSize, 10)).not("fb_video_id", "is", null)
      }
      const { data, error } = await q
      if (error) return NextResponse.json({ error: "Failed to fetch creatives" }, { status: 500 })
      return NextResponse.json({ creatives: (data ?? []).map(mapCreativeForClient) })
    }

    if (sortMode === "assigned_desc") {
      // Date Assigned is the maximum timestamp of a to-many embedded relation, so
      // PostgREST cannot order the parent creatives by it directly. Exhaust every
      // matching database page first; only then flatten, sort, and apply the UI offset.
      const rows = await collectAllCreativePages(async (from, to) => {
        let pageQuery = supabase
          .from("creatives")
          .select(CREATIVE_SELECT)
          .eq("org_id", ctx.orgId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to)

        if (adAccountIds.length === 1) pageQuery = pageQuery.eq("ad_account_id", adAccountIds[0])
        else if (adAccountIds.length > 1) pageQuery = pageQuery.in("ad_account_id", adAccountIds)
        if (userOnly) pageQuery = pageQuery.eq("user_id", ctx.user.id)

        const { data: page, error: pageError } = await pageQuery
        if (pageError) throw pageError
        return page ?? []
      })

      const scoped = rows.map((creative) => mapCreativeForClient(creative))
      const facets = creativeFacets(scoped)
      const { startIso, endExclusiveIso } = localDateRangeToUtc(dateFrom, dateTo, timezoneOffset)
      const filtered = scoped.filter((creative: any) => {
        if (mediaType && creative.media_type !== mediaType) return false
        if (statusFilter && creative.status !== statusFilter) return false
        if (nameContains && !creative.file_name?.toLowerCase().includes(nameContains.toLowerCase())) return false
        const ready = Boolean(creative.fb_image_hash || creative.fb_video_id)
        if (readiness === "ready" && !ready) return false
        if (readiness === "pending" && ready) return false
        const portal = portalItem(creative)
        if (brand && portal?.brand_name !== brand) return false
        if (product && portal?.product_name !== product) return false
        if (language && portal?.language !== language) return false
        const timestamp = Date.parse(creative.assigned_at || creative.created_at || "")
        if (startIso && (!Number.isFinite(timestamp) || timestamp < Date.parse(startIso))) return false
        if (endExclusiveIso && (!Number.isFinite(timestamp) || timestamp >= Date.parse(endExclusiveIso))) return false
        return true
      })
      const sorted = sortCreativesByLatestAssignment(filtered)
      const items = sorted.slice(assignedSortOffset, assignedSortOffset + limit)
      const hasMore = assignedSortOffset + limit < sorted.length
      return NextResponse.json({
        creatives: items,
        hasMore,
        nextCursor: hasMore ? String(assignedSortOffset + limit) : null,
        total: sorted.length,
        facets,
      })
    }

    let query = supabase
      .from("creatives")
      .select(CREATIVE_SELECT)
      .eq("org_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1)

    if (adAccountIds.length === 1) query = query.eq("ad_account_id", adAccountIds[0])
    else if (adAccountIds.length > 1) query = query.in("ad_account_id", adAccountIds)
    if (mediaType) query = query.eq("media_type", mediaType)
    if (statusFilter) query = query.eq("status", statusFilter)
    if (nameContains) query = query.ilike("file_name", `%${nameContains}%`)
    if (cursor) query = query.lt("created_at", cursor)

    const { data, error } = await query

    if (error) {
      console.error("Failed to fetch creatives:", error)
      return NextResponse.json({ error: "Failed to fetch creatives" }, { status: 500 })
    }

    const mapped = (data ?? []).map((creative) => mapCreativeForClient(creative))

    const hasMore  = mapped.length > limit
    const items    = mapped.slice(0, limit)
    const nextCursor = hasMore ? (items[items.length - 1]?.created_at ?? null) : null

    return NextResponse.json({
      creatives: items,
      hasMore,
      nextCursor,
    })
  } catch (err) {
    console.error("Failed to fetch creatives:", err)
    return NextResponse.json({ error: "Failed to fetch creatives" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const contentType = request.headers.get("content-type") || ""

    // Case 1: Metadata update or JSON-based upload (already uploaded on client)
    if (contentType.includes("application/json")) {
      const body = await request.json()
      const supabase = createAdminClient()
      const { data: creative, error: insertError } = await supabase
        .from("creatives")
        .insert({
          org_id: ctx.orgId,
          user_id: ctx.user.id,
          ad_account_id: body.ad_account_id || null,
          file_name: body.file_name,
          file_url: body.fb_thumbnail_url || body.fb_image_url || "",
          media_type: body.media_type,
          file_size: body.file_size || 0,
          campaign_name: body.campaign_name || null,
          adset_name: body.adset_name || null,
          headline: body.headline || "",
          primary_text: body.primary_text || "",
          description: body.description || "",
          cta: body.cta || "LEARN_MORE",
          link_url: body.link_url || "",
          fb_image_hash: body.fb_image_hash || null,
          fb_image_url: body.fb_image_url || null,
          fb_thumbnail_url: body.fb_thumbnail_url || null,
          fb_video_id: body.fb_video_id || null,
          status: "ready",
        })
        .select()
        .single()

      if (insertError) {
        console.error("DB insert error:", insertError)
        return NextResponse.json({ error: "Failed to save creative metadata" }, { status: 500 })
      }

      return NextResponse.json({ creative: mapCreativeForClient(creative) }, { status: 201 })
    }

    // Case 2: Binary file upload through server
    // ponytail: legacy slow path — buffers full file in memory then awaits Meta upload.
    // Preferred path is Case 1 (JSON metadata) after uploading directly browser→Meta.
    // Remaining caller: app/(dashboard)/ads/page.tsx. Migrate it, then delete this branch.
    console.warn("[creatives] multipart upload (legacy) — prefer JSON metadata path")
    const formData = await request.formData()
    const file = formData.get("file") as File
    const headline = formData.get("headline") as string
    const primaryText = formData.get("primary_text") as string
    const description = formData.get("description") as string
    const cta = formData.get("cta") as string
    const linkUrl = formData.get("link_url") as string
    const adAccountIdParam = formData.get("adAccountId") as string | null

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    const connection = await getFacebookConnection(ctx.orgId)
    if (!connection) {
      return NextResponse.json({ error: "Facebook not connected" }, { status: 400 })
    }

    const supabase = createAdminClient()
    let fbAdAccountId = adAccountIdParam

    if (!fbAdAccountId) {
      const { data: adAccounts } = await supabase
        .from("ad_accounts")
        .select("id, fb_ad_account_id")
        .eq("org_id", ctx.orgId)
        .limit(1)

      if (!adAccounts || adAccounts.length === 0) {
        return NextResponse.json({ error: "No ad account found" }, { status: 400 })
      }
      fbAdAccountId = adAccounts[0].fb_ad_account_id
    }

    if (!fbAdAccountId) {
      return NextResponse.json({ error: "Facebook Ad Account ID is missing" }, { status: 400 })
    }

    const isVideo = file.type.startsWith("video/")
    const mediaType = isVideo ? "video" : "image"
    const fileBuffer = await file.arrayBuffer()

    let fbImageHash: string | null = null
    let fbImageUrl: string | null = null
    let fbThumbnailUrl: string | null = null
    let fbVideoId: string | null = null
    let publicUrl = ""
    let storagePath: string | null = null

    if (mediaType === "video") {
      // Direct Meta Upload for Video (No intermediate storage)
      try {
        const uploadResult = await uploadVideoToMeta(fbAdAccountId, connection.access_token, fileBuffer, file.name)
        fbVideoId = uploadResult.videoId

      } catch (err: any) {
        console.error("Meta video upload error:", err)
        const msg = err?.message || "Meta Video Upload failed"
        if (msg.includes("permission") || msg.includes("OAuth")) {
          return NextResponse.json({ error: "Meta Permission Error: Please check your Ad Account access." }, { status: 403 })
        }
        return NextResponse.json({ error: msg }, { status: 500 })
      }
    } else {
      // Image Flow: Still using Supabase for reliable previews as Meta image URLs are volatile
      const storedOriginal = await uploadOriginalToStorage({
        orgId: ctx.orgId,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        buffer: fileBuffer,
      })
      publicUrl = storedOriginal.publicUrl
      storagePath = storedOriginal.storagePath

      const result = await uploadImageToMeta(fbAdAccountId, connection.access_token, fileBuffer, file.name)
      fbImageHash = result.hash
      fbImageUrl = result.url
      fbThumbnailUrl = result.url_128
    }

    const { data: creative, error: insertError } = await supabase
      .from("creatives")
      .insert({
        org_id: ctx.orgId,
        user_id: ctx.user.id,
        ad_account_id: fbAdAccountId || null,
        file_name: file.name,
        file_url: publicUrl,
        storage_path: storagePath,
        media_type: mediaType,
        file_size: file.size,
        headline: headline || "",
        primary_text: primaryText || "",
        description: description || "",
        cta: cta || "LEARN_MORE",
        link_url: linkUrl || "",
        fb_image_hash: fbImageHash,
        fb_image_url: fbImageUrl,
        fb_thumbnail_url: fbThumbnailUrl,
        fb_video_id: fbVideoId,
        status: isVideo ? "processing" : "ready",
      })
      .select()
      .single()

    if (insertError) {
      console.error("DB insert error:", insertError)
      return NextResponse.json({ error: "Failed to save creative" }, { status: 500 })
    }

    const actorName = ctx.user.user_metadata?.full_name || ctx.user.email?.split("@")[0] || "Someone"
    // Keyed on the creative row, so a retried upload of the same row delivers once.
    await emitAndLog("creatives.create", {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName,
      type: "asset.uploaded",
      action: "created",
      objectType: "creative",
      objectId: creative.id,
      objectName: file.name,
      link: "/assets",
      dedupeKey: `asset.uploaded:${creative.id}`,
      source: "creatives.create",
    })

    return NextResponse.json({ creative: mapCreativeForClient(creative) }, { status: 201 })
  } catch (err: unknown) {
    console.error("Failed to create creative:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create creative" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => null)
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
      : []

    if (ids.length === 0) {
      return NextResponse.json({ error: "ids are required" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: creatives, error: fetchError } = await supabase
      .from("creatives")
      .select("id, storage_path, fb_video_id, fb_image_hash")
      .eq("org_id", ctx.orgId)
      .in("id", ids)

    if (fetchError) {
      return NextResponse.json({ error: "Failed to load creatives" }, { status: 500 })
    }

    const foundIds = (creatives || []).map((creative) => creative.id)
    if (foundIds.length !== ids.length) {
      return NextResponse.json({ error: "Some selected assets were not found" }, { status: 404 })
    }

    const hasMetaUploadedPortal = (creatives || []).some(creative => {
      const isPortal = creative.storage_path?.startsWith("r2://pati-videos/creative-portal/")
      return isPortal && (creative.fb_video_id || creative.fb_image_hash)
    })

    if (hasMetaUploadedPortal) {
      return NextResponse.json(
        { error: "One or more selected Portal assets are already uploaded to Meta. Remove them from Meta before deleting." },
        { status: 409 }
      )
    }

    for (const creative of creatives || []) {
      if (!creative.storage_path) continue
      const deleted = await deleteMediaObject(creative.storage_path, ctx.orgId, ctx.user.id, supabase)
      if (!deleted.ok) {
        return NextResponse.json({ error: deleted.reason || "Failed to delete media object" }, { status: 502 })
      }
    }

    const portalSourcedIds = (creatives || [])
      .filter(creative => creative.storage_path?.startsWith("r2://pati-videos/creative-portal/"))
      .map(c => c.id)

    // Order B: reset the Portal tracking rows before deleting the creatives
    if (portalSourcedIds.length > 0) {
      await supabase
        .from("portal_media_items")
        .update({ org_id: null, ad_account_id: null, mapped_by: null, creative_id: null, status: "pending", updated_at: new Date().toISOString() })
        .in("creative_id", portalSourcedIds)
    }

    const { error: deleteError } = await supabase
      .from("creatives")
      .delete()
      .eq("org_id", ctx.orgId)
      .in("id", ids)

    if (deleteError) {
      return NextResponse.json({ error: "Failed to delete creatives" }, { status: 500 })
    }

    return NextResponse.json({ success: true, deletedIds: ids })
  } catch (err) {
    console.error("Failed to bulk delete creatives:", err)
    return NextResponse.json({ error: "Failed to bulk delete creatives" }, { status: 500 })
  }
}
