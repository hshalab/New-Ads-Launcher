import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getFacebookConnection } from "@/lib/auth"
import { getDbCachedFacebookMetadata } from "@/app/api/facebook/_db-cache"
import { metaFetch } from "@/app/api/facebook/_meta-fetch"
import { computeInsightMetrics } from "@/lib/insights-metrics"
import { clampTimeToToday } from "@/lib/snapshot-fallback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const GRAPH = "https://graph.facebook.com/v25.0"
const CACHE_TTL = 5 * 60 * 1000

const VALID_BREAKDOWNS = [
  "publisher_platform",
  "platform_position",
  "publisher_platform,platform_position",
  "age",
  "gender",
  "age,gender",
  "impression_device",
  "publisher_platform,impression_device",
  "platform_position,impression_device",
  "publisher_platform,platform_position,impression_device",
  "country",
  "region",
  "media_type",
]

const BREAKDOWN_LABELS: Record<string, string> = {
  publisher_platform: "Platform",
  platform_position: "Placement",
  "publisher_platform,platform_position": "Placement",
  age: "Age",
  gender: "Gender",
  "age,gender": "Age and gender",
  impression_device: "Impression device",
  "publisher_platform,impression_device": "Platform and device",
  "platform_position,impression_device": "Placement and device",
  country: "Country",
  region: "Region",
  media_type: "Media type",
}

function labelForRow(row: any, breakdown: string) {
  const keys = breakdown.split(",")
  return keys.map(k => row[k] || "Unknown").join(" / ")
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const connection = await getFacebookConnection(ctx.orgId)
    if (!connection) return NextResponse.json({ error: "Facebook not connected" }, { status: 400 })

    const sp = request.nextUrl.searchParams
    const adAccountId = sp.get("adAccountId") || ""
    const datePreset = sp.get("datePreset") || "last_30d"
    const attributionWindows = sp.get("action_attribution_windows") || ""
    let since = sp.get("since") || ""
    let until = sp.get("until") || ""
    ;({ since, until } = clampTimeToToday(since, until))
    const level = sp.get("level") || "account"
    const id = sp.get("id") || ""
    const requestedBreakdown = sp.get("breakdown") || "publisher_platform"
    const breakdown = VALID_BREAKDOWNS.includes(requestedBreakdown) ? requestedBreakdown : "publisher_platform"

    if (!adAccountId) return NextResponse.json({ error: "adAccountId required" }, { status: 400 })

    const accountPath = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
    const basePath = id || accountPath
    const token = connection.access_token
    const dateKey = since && until ? `range:${since}_${until}` : `preset:${datePreset}`
    const cacheKey = `insights-breakdown:${adAccountId}:${id || "account"}:${dateKey}:${breakdown}:${attributionWindows}`

    const result = await getDbCachedFacebookMetadata({
      orgId: ctx.orgId,
      cacheKey,
      ttlMs: CACHE_TTL,
      loader: async () => {
        const params = new URLSearchParams({
          fields: [
            "spend", "impressions", "reach", "frequency", "cpm", "ctr", "clicks",
            "inline_link_clicks", "inline_link_click_ctr", "unique_clicks",
            "unique_inline_link_clicks", "unique_link_clicks_ctr", "outbound_clicks",
            "actions", "action_values", "purchase_roas",
          ].join(","),
          breakdowns: breakdown,
          limit: "100",
          access_token: token,
          filtering: JSON.stringify([{ field: "impressions", operator: "GREATER_THAN", value: 0 }]),
          ...(!attributionWindows ? { use_account_attribution_setting: "true" } : { action_attribution_windows: attributionWindows }),
        })
        if (since && until) params.set("time_range", JSON.stringify({ since, until }))
        else params.set("date_preset", datePreset)

        const data = await metaFetch(`${GRAPH}/${basePath}/insights?${params}`, {
          caller: "insights/breakdown",
        })

        return (data.data || []).map((d: any) => {
          const m = computeInsightMetrics(d)
          const dims: Record<string, string> = {}
          for (const k of breakdown.split(",")) dims[k] = d[k] || "Unknown"
          return {
            label: labelForRow(d, breakdown),
            breakdownValue: labelForRow(d, breakdown),
            ...dims,
            ...m,
          }
        }).sort((a: any, b: any) => b.spend - a.spend)
      },
    })

    return NextResponse.json({
      rows: result.value,
      breakdown,
      breakdownLabel: BREAKDOWN_LABELS[breakdown] || breakdown,
      datePreset,
      since: since || null,
      until: until || null,
      level,
      id: id || null,
      cached: result.source !== "meta",
      stale: result.stale,
    })
  } catch (err: any) {
    console.error("[insights/breakdown]", err)
    const isRateLimit = err?.name === "MetaRateLimitError"
    return NextResponse.json(
      { error: isRateLimit ? "Meta API rate limit reached. Please wait a moment." : err.message },
      { status: isRateLimit ? 429 : 500 }
    )
  }
}
