import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { getCachedFacebookMetadata } from "../../facebook/_cache"

/**
 * POST /api/geo/geocode  { items: [{ key, query, country }] }
 *
 * Resolves the locations selected in the Ads Manager Locations field to latitude/longitude so the
 * map can draw a pin where the place actually is, and a radius circle at its real size.
 *
 * Why this route exists at all: Meta's `search?type=adgeolocation` returns the `key` this product
 * must write back to `targeting.geo_locations`, and nothing else — no coordinates. Countries are
 * covered by a static centroid table on the client; anything smaller (region, city, zip, DMA) has
 * no position until something geocodes it.
 *
 * Provider is Nominatim, the same OpenStreetMap project that serves the map tiles. Two rules from
 * its usage policy are honoured here and are the reason for the shape of this route:
 *   - identify the caller (User-Agent), and
 *   - do not bulk-query — hence MAX_ITEMS, the 24h cache, and the fact that only locations a human
 *     actually selected are ever looked up.
 *
 * Coordinates are display-only. They are never written into `geo_locations`: a stray key inside
 * that object is exactly the class of bug LocationsField's header warns about.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_ITEMS = 12
const USER_AGENT = "AdLauncher/1.0 (internal ads tooling; +https://github.com/dev-pati/New-Ads-Launcher)"

type GeocodeItem = { key?: string; query?: string; country?: string }

/** null is a real, cacheable answer: "OSM has no match for this string". */
type Coord = [number, number] | null

async function lookup(query: string, country?: string): Promise<Coord> {
  const cacheKey = `geocode:${country || "-"}:${query.toLowerCase()}`
  return getCachedFacebookMetadata<Coord>(cacheKey, CACHE_TTL_MS, async () => {
    const url = new URL(NOMINATIM_URL)
    url.searchParams.set("format", "jsonv2")
    url.searchParams.set("limit", "1")
    url.searchParams.set("q", query)
    if (country) url.searchParams.set("countrycodes", country.toLowerCase())

    const response = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    })
    if (!response.ok) throw new Error(`Geocoder returned ${response.status}`)

    const data = await response.json()
    const first = Array.isArray(data) ? data[0] : null
    const lat = Number(first?.lat)
    const lon = Number(first?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return [lat, lon]
  })
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => null)
    const items: GeocodeItem[] = Array.isArray(body?.items) ? body.items.slice(0, MAX_ITEMS) : []
    if (items.length === 0) return NextResponse.json({ coords: {} })

    const coords: Record<string, [number, number]> = {}

    // Sequential on purpose: parallel fan-out at a shared public geocoder is the behaviour its
    // usage policy asks callers not to have. The cache makes the second render free.
    for (const item of items) {
      const key = String(item?.key || "").trim()
      const query = String(item?.query || "").trim()
      if (!key || query.length < 2) continue
      try {
        const found = await lookup(query, item.country)
        if (found) coords[key] = found
      } catch (err) {
        // One unresolved place must not blank the whole map — the client falls back to the
        // country centroid and labels that pin approximate.
        console.warn("[geocode]", query, err instanceof Error ? err.message : err)
      }
    }

    return NextResponse.json({ coords })
  } catch (err) {
    console.error("[geocode] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ coords: {} })
  }
}
