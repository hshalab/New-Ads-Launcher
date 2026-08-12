import { NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// GET /api/team-stats?days=30
// Returns aggregated Ads, Batches, Templates counts for the org over the last N days.
export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get("days") || "30")
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const supabase = createAdminClient()

    const [batchesRes, templatesRes] = await Promise.all([
      supabase
        .from("launch_batches")
        .select("id, total_ads, failed_ads")
        .eq("org_id", ctx.orgId)
        .gte("created_at", since),
      supabase
        .from("ad_copy_templates")
        .select("id")
        .eq("org_id", ctx.orgId)
        .gte("created_at", since),
    ])

    const batches = batchesRes.data || []
    const ads = batches.reduce(
      (sum: number, b: any) => sum + Math.max(0, b.total_ads || 0),
      0
    )

    return NextResponse.json({
      ads,
      batches: batches.length,
      templates: (templatesRes.data || []).length,
      days,
    })
  } catch (err: any) {
    console.error("[team-stats]", err)
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 })
  }
}
