import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getFacebookConnection } from "@/lib/auth"
import { getCachedFacebookMetadata } from "../_cache"
import { metaFetch } from "../_meta-fetch"
import { resolveAdsManagerTimeRange } from "@/lib/snapshot-fallback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// GET ?ad_account_id=&level=campaign|adset|ad&date_preset=|time_range=&breakdowns=|time_increment=
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const adAccountId   = searchParams.get("ad_account_id")
  const level         = searchParams.get("level") || "campaign"
  const datePreset    = searchParams.get("date_preset")
  const timeRange     = searchParams.get("time_range")
  const breakdowns    = searchParams.get("breakdowns")
  const timeIncrement = searchParams.get("time_increment")
  const objectIds     = searchParams.get("object_ids") || ""

  if (!adAccountId) {
    return NextResponse.json({ error: "ad_account_id required" }, { status: 400 })
  }
  if (!breakdowns && !timeIncrement) {
    return NextResponse.json({ error: "breakdowns or time_increment required" }, { status: 400 })
  }

  const ctx = await getAuthContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const connection = await getFacebookConnection(ctx.orgId)
  if (!connection) return NextResponse.json({ error: "No Facebook connection" }, { status: 401 })

  const apiTimeRange = resolveAdsManagerTimeRange(datePreset || "last_7d", timeRange || "")
  const dateKey  = timeRange ? `tr:${timeRange}` : `dp:${datePreset || "last_7d"}`
  const bdsKey   = [breakdowns || "", timeIncrement || ""].filter(Boolean).join(":")
  const cacheKey = `breakdown-insights:${adAccountId}:${level}:${dateKey}:${bdsKey}:${objectIds}`

  try {
    const data = await getCachedFacebookMetadata(cacheKey, CACHE_TTL, async () => {
      const idField = level === "campaign" ? "campaign_id" : level === "adset" ? "adset_id" : "ad_id"
      const fields = [
        idField, "date_start", "date_stop",
        "spend", "impressions", "clicks", "reach",
        "actions", "action_values", "cost_per_action_type",
      ].join(",")

      const filteringList: any[] = [
        { field: "impressions", operator: "GREATER_THAN", value: 0 }
      ]
      if (objectIds) {
        const idFilterField = level === "campaign" ? "campaign.id" : level === "adset" ? "adset.id" : "ad.id"
        filteringList.push({
          field: idFilterField,
          operator: "IN",
          value: objectIds.split(",").map(id => id.trim())
        })
      }

      const params = new URLSearchParams({
        level,
        fields,
        limit: "1000",
        access_token: connection.access_token,
        filtering: JSON.stringify(filteringList),
      })

      if (apiTimeRange)  params.set("time_range", apiTimeRange)
      else               params.set("date_preset", datePreset || "last_7d")
      if (breakdowns)    params.set("breakdowns", breakdowns)
      if (timeIncrement) params.set("time_increment", timeIncrement)

      const rows: any[] = []
      let nextUrl: string | null = `https://graph.facebook.com/v25.0/${adAccountId}/insights?${params}`

      while (nextUrl) {
        const result = await metaFetch(nextUrl, { caller: "breakdown-insights" })
        rows.push(...(result.data || []))
        nextUrl = result.paging?.next || null
      }

      return { data: rows }
    })

    return NextResponse.json(data)
  } catch (err: any) {
    console.error("[breakdown-insights]", err)
    const isRateLimit = err?.name === "MetaRateLimitError"
    return NextResponse.json(
      { error: isRateLimit ? "Meta API rate limit reached. Please wait a moment." : (err.message || "Failed") },
      { status: isRateLimit ? 429 : 400 }
    )
  }
}
