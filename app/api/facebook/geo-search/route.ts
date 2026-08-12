import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getConnectionForAdAccount, isManual } from "@/lib/auth"
import { secureMetaFetch } from "@/lib/meta-secure-fetch"
import { getCachedFacebookMetadata } from "../_cache"

/**
 * GET /api/facebook/geo-search?q=<term>&types=country,region,city,zip&ad_account_id=act_<id>
 *
 * Type-ahead for the Ads Manager editor's Locations field. Proxies Meta's
 * `search?type=adgeolocation`, which is the only way to obtain the `key` values Meta will accept
 * back in `targeting.geo_locations` — a country name typed by hand is not a valid write.
 *
 * Read scope, so it resolves the ad account's Via NON-LAUNCH connection. Never the launch via:
 * a search box must not consume the one write slot's rate budget.
 *
 * Cached for 24h per (query, types). Geo names do not move, and the field fires on every
 * keystroke past the debounce.
 */

const GRAPH_API_BASE = "https://graph.facebook.com/v25.0"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

const ALLOWED_TYPES = new Set([
  "country",
  "region",
  "city",
  "zip",
  "geo_market",
  "electoral_district",
])

/** Meta returns city/zip rows that support a radius; countries and regions never do. */
const RADIUS_TYPES = new Set(["city", "zip", "custom_location", "place"])

type MetaGeoRow = {
  key?: string
  name?: string
  type?: string
  country_code?: string
  country_name?: string
  region?: string
  region_id?: number | string
  primary_city?: string
  supports_region?: boolean
  supports_city?: boolean
}

export type GeoSearchResult = {
  key: string
  type: string
  name: string
  /** Disambiguated one-line label: "Austin, Texas, United States". */
  label: string
  country_code?: string
  country_name?: string
  region?: string
  supportsRadius: boolean
}

function toResult(row: MetaGeoRow): GeoSearchResult | null {
  if (!row?.key || !row?.name || !row?.type) return null
  const parts = [row.name, row.region, row.country_name].filter(
    (part, index, all) => Boolean(part) && all.indexOf(part) === index
  )
  return {
    key: String(row.key),
    type: String(row.type),
    name: String(row.name),
    label: parts.join(", "),
    country_code: row.country_code,
    country_name: row.country_name,
    region: row.region,
    supportsRadius: RADIUS_TYPES.has(String(row.type)),
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const query = (searchParams.get("q") || "").trim()
    const adAccountId = searchParams.get("ad_account_id")

    if (query.length < 2) return NextResponse.json({ results: [] })

    const types = (searchParams.get("types") || "country,region,city,zip")
      .split(",")
      .map(type => type.trim())
      .filter(type => ALLOWED_TYPES.has(type))
    if (types.length === 0) {
      return NextResponse.json({ error: "No valid location types requested" }, { status: 400 })
    }

    const connection = await getConnectionForAdAccount(ctx.orgId, adAccountId, "read")
    if (!connection) {
      return NextResponse.json({ error: "No Facebook connection found" }, { status: 400 })
    }

    const cacheKey = `geo-search:${types.join(",")}:${query.toLowerCase()}`

    const results = await getCachedFacebookMetadata<GeoSearchResult[]>(cacheKey, CACHE_TTL_MS, async () => {
      const url = new URL(`${GRAPH_API_BASE}/search`)
      url.searchParams.set("type", "adgeolocation")
      url.searchParams.set("q", query)
      url.searchParams.set("location_types", JSON.stringify(types))
      url.searchParams.set("limit", "25")
      url.searchParams.set("access_token", connection.access_token)

      // A manual via token is issued by a different Meta app, so the proof would be rejected;
      // an OAuth token needs it. Same contract as every other Meta read route here.
      const response = await secureMetaFetch(url.toString(), undefined, {
        skipProof: isManual(connection),
      })
      const data = await response.json()
      if (!response.ok || data?.error) {
        throw new Error(data?.error?.message || "Location search failed")
      }
      return (Array.isArray(data.data) ? data.data : [])
        .map(toResult)
        .filter((row: GeoSearchResult | null): row is GeoSearchResult => row !== null)
    })

    return NextResponse.json({ results })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Location search failed"
    console.error("[geo-search] error:", message)
    const rateLimited = /rate limit|too many calls|#4\b/i.test(message)
    return NextResponse.json(
      { error: rateLimited ? "Meta rate limit — try again shortly" : message, rateLimited },
      { status: rateLimited ? 429 : 500 }
    )
  }
}
