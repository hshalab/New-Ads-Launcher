import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { emitAndLog } from "@/lib/notifications/emit"

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const adAccountId = searchParams.get("ad_account_id")

    const db = createAdminClient()
    let query = db
      .from("ad_copy_templates")
      .select("*")
      .eq("org_id", ctx.orgId)
      .order("created_at", { ascending: false })
    if (adAccountId) query = query.eq("ad_account_id", adAccountId)
    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ templates: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { ad_account_id, name, primary_text, headline, description, link, cta, tags } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }

    const db = createAdminClient()
    const { data, error } = await db
      .from("ad_copy_templates")
      .insert({
        org_id: ctx.orgId,
        user_id: ctx.user.id,
        ad_account_id,
        name: name.trim(),
        primary_text: primary_text || null,
        headline: headline || null,
        description: description || null,
        link: link || null,
        cta: cta || "SHOP_NOW",
        tags: tags || [],
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const actorName = ctx.user.user_metadata?.full_name || ctx.user.email?.split("@")[0] || "Someone"
    await emitAndLog("templates.create", {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName,
      type: "template.created",
      action: "created",
      objectType: "template",
      objectId: data.id,
      objectName: name.trim(),
      link: "/templates",
      dedupeKey: `template.created:${data.id}`,
      source: "templates.create",
    })

    return NextResponse.json({ template: data }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
