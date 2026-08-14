import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getFacebookConnection } from "@/lib/auth"
import { getCachedFacebookMetadata } from "../_cache"
import { metaFetch } from "../_meta-fetch"
import { resolveAdsManagerTimeRange } from "@/lib/snapshot-fallback"
import { ADS_MANAGER_INSIGHT_FIELDS } from "@/lib/facebook"
import { isValidTimeIncrement, unsupportedBreakdownFields } from "@/lib/breakdown-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const PAGE_LIMIT = 500          // 1000 + breakdowns trips Meta's "reduce the amount of data" error
const FALLBACK_PAGE_LIMIT = 100
const MAX_PAGES = 40            // hard stop; the response is flagged truncated instead of hanging

/**
 * The columns every breakdown supports. Meta refuses unique/reach metrics
 * alongside a few breakdowns, so this is the last rung of the attempt ladder:
 * fewer columns beats an empty table.
 */
const MINIMAL_INSIGHT_FIELDS = [
  "spend", "impressions", "clicks", "actions", "action_values", "cost_per_action_type",
].join(",")

type Attempt = {
  fields: string
  filtering: unknown[] | null
  limit: number
  /** Non-null once we are past the ideal request — surfaced to the user. */
  warning: string | null
}

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

  // Meta rejects the whole request when one breakdown field is not real, which
  // reads in the UI as "this filter has no data". Fail here instead, by name.
  if (breakdowns) {
    const bad = unsupportedBreakdownFields(breakdowns.split(",").map(f => f.trim()).filter(Boolean))
    if (bad.length > 0) {
      return NextResponse.json(
        { error: `Meta's Insights API doesn't report this breakdown: ${bad.join(", ")}` },
        { status: 400 }
      )
    }
  }
  if (timeIncrement && !isValidTimeIncrement(timeIncrement)) {
    return NextResponse.json({ error: `Invalid time_increment: ${timeIncrement}` }, { status: 400 })
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
      const fullFields = [idField, "date_start", "date_stop", ADS_MANAGER_INSIGHT_FIELDS].join(",")
      const minimalFields = [idField, "date_start", "date_stop", MINIMAL_INSIGHT_FIELDS].join(",")

      const ids = objectIds.split(",").map(id => id.trim()).filter(Boolean)
      const idFilterField = level === "campaign" ? "campaign.id" : level === "adset" ? "adset.id" : "ad.id"
      const objectFilter = ids.length > 0 ? [{ field: idFilterField, operator: "IN", value: ids }] : null

      // Degrade one axis at a time: object filter first (narrowest blast radius
      // if Meta dislikes it), then the wide column set. Every rung still returns
      // the rows asked for; only the columns or the request shape change.
      const attempts: Attempt[] = [
        { fields: fullFields, filtering: objectFilter, limit: PAGE_LIMIT, warning: null },
      ]
      if (objectFilter) {
        attempts.push({
          fields: fullFields, filtering: null, limit: PAGE_LIMIT,
          warning: "Meta rejected the ad-object filter; results were fetched account-wide and filtered here.",
        })
      }
      attempts.push({
        fields: minimalFields, filtering: null, limit: FALLBACK_PAGE_LIMIT,
        warning: "Meta doesn't support the full column set for this breakdown — link clicks, unique clicks, reach, frequency and watch time are unavailable here.",
      })

      let lastError: any = null

      for (const attempt of attempts) {
        const params = new URLSearchParams({
          level,
          fields: attempt.fields,
          limit: String(attempt.limit),
          access_token: connection.access_token,
        })
        if (attempt.filtering) params.set("filtering", JSON.stringify(attempt.filtering))
        if (apiTimeRange)  params.set("time_range", apiTimeRange)
        else               params.set("date_preset", datePreset || "last_7d")
        if (breakdowns)    params.set("breakdowns", breakdowns)
        if (timeIncrement) params.set("time_increment", timeIncrement)

        try {
          const rows: any[] = []
          let truncated = false
          let pages = 0
          let nextUrl: string | null = `https://graph.facebook.com/v25.0/${adAccountId}/insights?${params}`

          while (nextUrl) {
            if (pages >= MAX_PAGES) { truncated = true; break }
            const result: any = await metaFetch(nextUrl, { caller: "breakdown-insights" })
            rows.push(...(result.data || []))
            nextUrl = result.paging?.next || null
            pages++
          }

          // The filter Meta refused still has to hold, or sub-rows would appear
          // under parents the table isn't showing.
          const scoped = !attempt.filtering && ids.length > 0
            ? rows.filter(row => ids.includes(String(row[idField] || "")))
            : rows

          if (attempt.warning) {
            console.warn("[breakdown-insights] degraded:", attempt.warning, lastError?.message)
          }
          return { data: scoped, warning: attempt.warning, truncated }
        } catch (err: any) {
          // A rate limit is not a request-shape problem; retrying just burns quota.
          if (err?.name === "MetaRateLimitError") throw err
          lastError = err
        }
      }

      throw lastError
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
