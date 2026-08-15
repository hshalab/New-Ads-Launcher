import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const sp     = request.nextUrl.searchParams
    const pageId = sp.get("page_id") || ""
    const range  = sp.get("range") || "last_30d"

    const supabase = createAdminClient()

    const since = new Date()
    if      (range === "last_7d")       since.setDate(since.getDate() - 7)
    else if (range === "last_30d")      since.setDate(since.getDate() - 30)
    else if (range === "last_12_months") since.setFullYear(since.getFullYear() - 1)
    else                                since.setDate(since.getDate() - 30)

    const prevSince = new Date(since)
    const days = (Date.now() - since.getTime()) / 86400000
    prevSince.setDate(prevSince.getDate() - Math.round(days))

    // Only the five columns this aggregation reads. `select("*")` also pulled the
    // comment body and every Meta id for each row — megabytes of text over the wire
    // for numbers that never use it.
    const ANALYTICS_SELECT = "sentiment, sentiment_score, like_count, fb_created_time, themes"

    let q = supabase.from("comments").select(ANALYTICS_SELECT).eq("org_id", ctx.orgId).gte("fb_created_time", since.toISOString())
    if (pageId) q = q.eq("page_id", pageId)

    let qp = supabase.from("comments").select("sentiment, sentiment_score, like_count").eq("org_id", ctx.orgId)
      .gte("fb_created_time", prevSince.toISOString()).lt("fb_created_time", since.toISOString())
    if (pageId) qp = qp.eq("page_id", pageId)

    // The two windows are disjoint and independent — one round trip, not two.
    const [{ data: comments }, { data: prevComments }] = await Promise.all([q, qp])

    const list = comments || []
    const prev = prevComments || []

    const total    = list.length
    const positive = list.filter(c => c.sentiment === "positive").length
    const neutral  = list.filter(c => c.sentiment === "neutral").length
    const negative = list.filter(c => c.sentiment === "negative").length
    const totalReactions = list.reduce((s, c) => s + (c.like_count || 0), 0)
    const avgSentiment   = total > 0 ? list.reduce((s, c) => s + (c.sentiment_score || 0), 0) / total : 0

    const prevTotal = prev.length
    const prevAvg   = prevTotal > 0 ? prev.reduce((s: number, c: any) => s + (c.sentiment_score || 0), 0) / prevTotal : 0

    // Trend data grouped by day/month
    const buckets: Record<string, { count: number; score_sum: number; score_count: number }> = {}
    for (const c of list) {
      const d = new Date(c.fb_created_time)
      const label = range === "last_12_months"
        ? d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      if (!buckets[label]) buckets[label] = { count: 0, score_sum: 0, score_count: 0 }
      buckets[label].count++
      buckets[label].score_sum   += (c.sentiment_score || 0)
      buckets[label].score_count++
    }

    const trend_data  = Object.entries(buckets).map(([label, v]) => ({ label, score: v.score_count > 0 ? (v.score_sum / v.score_count * 50 + 50) : 50 }))
    const volume_data = Object.entries(buckets).map(([label, v]) => ({ label, count: v.count }))

    // Top themes
    const themeCount: Record<string, number> = {}
    for (const c of list) {
      for (const t of c.themes || []) {
        themeCount[t] = (themeCount[t] || 0) + 1
      }
    }
    const themes = Object.entries(themeCount).sort((a, b) => b[1] - a[1]).map(([theme, count]) => ({ theme, count }))

    return NextResponse.json({
      total, positive, neutral, negative, totalReactions,
      avgSentiment: parseFloat(avgSentiment.toFixed(2)),
      trend: {
        total:     prevTotal > 0 ? ((total - prevTotal) / prevTotal * 100) : 0,
        sentiment: prevAvg   ? ((avgSentiment - prevAvg) / Math.abs(prevAvg) * 100) : 0,
      },
      trend_data, volume_data, themes,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
