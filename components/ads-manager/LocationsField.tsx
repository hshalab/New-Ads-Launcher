"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { IconMapPin, IconSearch, IconX } from "@tabler/icons-react"
import { GeoMap, type GeoMapPoint } from "@/components/ads-manager/GeoMap"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * Locations editor for the Ads Manager ad set editor.
 *
 * Two rules govern every mutation in this file, and both come from TD-37 one level deeper than
 * the original fix:
 *
 * 1. `geo_locations` is a whole object to Meta, exactly like `targeting` is. Meta stores keys this
 *    UI does not render — `geo_markets`, `custom_locations`, `places`, `location_types`,
 *    `location_cluster_ids`. Every change therefore SPREADS the existing object and replaces one
 *    sub-key. Rebuilding `{ countries: [...] }` from what happens to be on screen silently deletes
 *    the rest.
 * 2. Removing the last exclusion is expressed by `excluded_geo_locations` being ABSENT, not empty.
 *    That is why the key is in REMOVABLE_TARGETING_KEYS, and why this component returns
 *    `undefined` rather than `{}` when the last exclusion goes.
 */

export type GeoCity = {
  key: string
  name?: string
  region?: string
  country?: string
  radius?: number
  distance_unit?: "mile" | "kilometer"
}

export type GeoNamed = { key: string; name?: string; country?: string }

export type GeoLocations = {
  countries?: string[]
  regions?: GeoNamed[]
  cities?: GeoCity[]
  zips?: GeoNamed[]
  geo_markets?: GeoNamed[]
  custom_locations?: unknown[]
  places?: unknown[]
  location_types?: string[]
  location_cluster_ids?: unknown[]
}

type SearchResult = {
  key: string
  type: string
  name: string
  label: string
  country_code?: string
  country_name?: string
  region?: string
  supportsRadius: boolean
}

type Scope = "include" | "exclude"

type Row = {
  scope: Scope
  kind: "country" | "region" | "city" | "zip" | "other"
  key: string
  label: string
  detail: string
  radius?: number
  radiusUnit?: "mile" | "kilometer"
  /** ISO-2 country, when Meta supplied one. Drives the map's centroid fallback. */
  country?: string
  /** Geocoder input for the map. Absent on countries — those resolve from the centroid table. */
  query?: string
  /** Sub-key of the geo object this row lives in, used by the remove/update paths. */
  bucket: keyof GeoLocations
}

const RADIUS_OPTIONS = [10, 25, 50]

/**
 * Publish guard: Meta rejects an ad set whose `geo_locations` selects nothing. Counts the location
 * kinds this UI does not render too — an ad set targeted purely by pin-drop is valid.
 */
export function hasAnyLocation(geo: GeoLocations | undefined): boolean {
  if (!geo) return false
  return (
    (geo.countries?.length || 0) +
    (geo.regions?.length || 0) +
    (geo.cities?.length || 0) +
    (geo.zips?.length || 0) +
    (geo.geo_markets?.length || 0) +
    (geo.custom_locations?.length || 0) +
    (geo.places?.length || 0) +
    (geo.location_cluster_ids?.length || 0) > 0
  )
}

function bucketOf(type: string): keyof GeoLocations | null {
  if (type === "country") return "countries"
  if (type === "region") return "regions"
  if (type === "city") return "cities"
  if (type === "zip") return "zips"
  if (type === "geo_market") return "geo_markets"
  return null
}

/** Strip empty sub-arrays but keep every key this UI does not manage. */
function normalise(geo: GeoLocations | undefined): GeoLocations | undefined {
  if (!geo) return undefined
  const next: GeoLocations = { ...geo }
  for (const key of ["countries", "regions", "cities", "zips", "geo_markets"] as const) {
    const value = next[key]
    if (Array.isArray(value) && value.length === 0) delete next[key]
  }
  return Object.keys(next).length === 0 ? undefined : next
}

function rowsFrom(geo: GeoLocations | undefined, scope: Scope): Row[] {
  if (!geo) return []
  const rows: Row[] = []
  for (const code of geo.countries || []) {
    rows.push({ scope, kind: "country", key: code, label: code, detail: "Country", country: code, bucket: "countries" })
  }
  for (const region of geo.regions || []) {
    const label = region.name || String(region.key)
    rows.push({ scope, kind: "region", key: String(region.key), label, detail: "Region", country: region.country, query: label, bucket: "regions" })
  }
  for (const city of geo.cities || []) {
    const label = [city.name, city.region].filter(Boolean).join(", ") || String(city.key)
    rows.push({
      scope,
      kind: "city",
      key: String(city.key),
      label,
      detail: city.radius ? `City · +${city.radius} ${city.distance_unit === "kilometer" ? "km" : "mi"}` : "City",
      radius: city.radius,
      radiusUnit: city.distance_unit,
      country: city.country,
      query: label,
      bucket: "cities",
    })
  }
  for (const zip of geo.zips || []) {
    const label = zip.name || String(zip.key)
    rows.push({ scope, kind: "zip", key: String(zip.key), label, detail: "Zip", country: zip.country, query: label, bucket: "zips" })
  }
  for (const market of geo.geo_markets || []) {
    const label = market.name || String(market.key)
    rows.push({ scope, kind: "other", key: String(market.key), label, detail: "DMA region", country: market.country, query: label, bucket: "geo_markets" })
  }
  return rows
}

/**
 * Rows → map points. Radius is converted to miles here because Meta stores the unit alongside the
 * number and the map only speaks one unit.
 */
function toMapPoints(rows: Row[]): GeoMapPoint[] {
  return rows.map(row => ({
    id: `${row.scope}-${row.bucket}-${row.key}`,
    scope: row.scope,
    kind: row.kind,
    label: row.label,
    detail: row.detail,
    country: row.country,
    query: row.query,
    radiusMiles: row.radius === undefined
      ? undefined
      : row.radiusUnit === "kilometer" ? row.radius / 1.60934 : row.radius,
  }))
}

/** Every location type Meta returned that this UI has no row renderer for, so it is visibly kept. */
function unmanagedSummary(geo: GeoLocations | undefined): string[] {
  if (!geo) return []
  const notes: string[] = []
  if (Array.isArray(geo.custom_locations) && geo.custom_locations.length > 0) {
    notes.push(`${geo.custom_locations.length} pin-drop location(s)`)
  }
  if (Array.isArray(geo.places) && geo.places.length > 0) notes.push(`${geo.places.length} place(s)`)
  if (Array.isArray(geo.location_cluster_ids) && geo.location_cluster_ids.length > 0) {
    notes.push(`${geo.location_cluster_ids.length} location cluster(s)`)
  }
  return notes
}

export function LocationsField({
  geo,
  excluded,
  accountId,
  readOnly = false,
  onChange,
}: {
  geo?: GeoLocations
  excluded?: GeoLocations
  accountId?: string
  readOnly?: boolean
  onChange: (next: { geo?: GeoLocations; excluded?: GeoLocations }) => void
}) {
  const [scope, setScope] = useState<Scope>("include")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const includeRows = useMemo(() => rowsFrom(geo, "include"), [geo])
  const excludeRows = useMemo(() => rowsFrom(excluded, "exclude"), [excluded])
  const allRows = useMemo(() => [...includeRows, ...excludeRows], [includeRows, excludeRows])
  const mapPoints = useMemo(() => toMapPoints(allRows), [allRows])
  const keptNotes = useMemo(() => [...unmanagedSummary(geo), ...unmanagedSummary(excluded)], [geo, excluded])

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      setSearchError(null)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: term })
      if (accountId) params.set("ad_account_id", accountId)
      fetch(`/api/facebook/geo-search?${params.toString()}`)
        .then(async response => {
          const data = await response.json()
          if (!response.ok) throw new Error(data?.error || "Search unavailable")
          return data
        })
        .then(data => {
          if (cancelled) return
          setResults(Array.isArray(data.results) ? data.results : [])
          setSearchError(null)
        })
        .catch((err: Error) => {
          if (cancelled) return
          setResults([])
          setSearchError(err.message || "Search unavailable — try again")
        })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, accountId])

  /** Replace exactly one sub-key of one scope, spreading everything else through untouched. */
  const patch = (target: Scope, bucket: keyof GeoLocations, value: unknown[]) => {
    const base = target === "include" ? geo : excluded
    const next: GeoLocations = { ...(base || {}), [bucket]: value }
    const normalised = normalise(next)
    onChange(
      target === "include"
        ? { geo: normalised ?? {}, excluded }
        // Absent, not empty: that absence is how "no exclusions" is written to Meta.
        : { geo, excluded: normalised }
    )
  }

  const add = (result: SearchResult) => {
    const bucket = bucketOf(result.type)
    if (!bucket) return
    const base = (scope === "include" ? geo : excluded) || {}
    if (bucket === "countries") {
      const current = base.countries || []
      const code = result.country_code || result.key
      if (current.includes(code)) return
      patch(scope, "countries", [...current, code])
    } else {
      const current = (base[bucket] as GeoNamed[] | undefined) || []
      if (current.some(item => String(item.key) === result.key)) return
      const entry: GeoCity | GeoNamed =
        bucket === "cities"
          ? { key: result.key, name: result.name, region: result.region, country: result.country_code, radius: 25, distance_unit: "mile" }
          : { key: result.key, name: result.name, country: result.country_code }
      patch(scope, bucket, [...current, entry])
    }
    setQuery("")
    setResults([])
    setOpen(false)
  }

  const remove = (row: Row) => {
    const base = (row.scope === "include" ? geo : excluded) || {}
    if (row.bucket === "countries") {
      patch(row.scope, "countries", (base.countries || []).filter(code => code !== row.key))
      return
    }
    const current = (base[row.bucket] as GeoNamed[] | undefined) || []
    patch(row.scope, row.bucket, current.filter(item => String(item.key) !== row.key))
  }

  const setRadius = (row: Row, radius: number) => {
    const base = (row.scope === "include" ? geo : excluded) || {}
    const cities = (base.cities || []).map(city =>
      String(city.key) === row.key ? { ...city, radius, distance_unit: "mile" as const } : city
    )
    patch(row.scope, "cities", cities)
  }

  const empty = allRows.length === 0 && keptNotes.length === 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">Locations</Label>
        <span className="text-[11px] text-muted-foreground">
          {includeRows.length} included · {excludeRows.length} excluded
        </span>
      </div>

      <div ref={boxRef} className="relative flex gap-2">
        <select
          value={scope}
          onChange={event => setScope(event.target.value as Scope)}
          disabled={readOnly}
          aria-label="Include or exclude the next location"
          className="h-9 w-[104px] shrink-0 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
        >
          <option value="include">Include</option>
          <option value="exclude">Exclude</option>
        </select>
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={event => { setQuery(event.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            disabled={readOnly}
            placeholder="Search countries, regions, cities or zips"
            aria-label="Search locations"
            className="h-9 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs disabled:opacity-50"
          />
          {open && query.trim().length >= 2 && (
            <div className="absolute left-0 right-0 top-10 z-30 max-h-64 overflow-y-auto rounded-md border bg-background shadow-lg">
              {searching && <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>}
              {!searching && searchError && <p className="px-3 py-2 text-xs text-red-600">{searchError}</p>}
              {!searching && !searchError && results.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">No locations found</p>
              )}
              {!searching && results.map(result => (
                <button
                  key={`${result.type}-${result.key}`}
                  type="button"
                  onClick={() => add(result)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/60"
                >
                  <IconMapPin className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{result.label}</span>
                  <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{result.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {empty ? (
        <p className="rounded-md border border-dashed border-red-300 bg-red-50/40 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
          No locations selected. Meta rejects an ad set with an empty location set — add at least one before publishing.
        </p>
      ) : (
        <div className="space-y-1 rounded-md border border-input bg-background p-2">
          {allRows.map(row => (
            <div
              key={`${row.scope}-${row.bucket}-${row.key}`}
              className={cn(
                "flex items-center gap-2 rounded-sm px-2 py-1 text-xs",
                row.scope === "exclude" ? "bg-red-50 dark:bg-red-950/20" : "bg-blue-50 dark:bg-blue-950/20"
              )}
            >
              <IconMapPin className={cn("size-3.5 shrink-0", row.scope === "exclude" ? "text-red-600" : "text-blue-600")} />
              <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {row.scope === "exclude" ? "Excluded · " : ""}{row.detail}
              </span>
              {row.kind === "city" && (
                <select
                  value={row.radius ?? 25}
                  onChange={event => setRadius(row, Number(event.target.value))}
                  disabled={readOnly}
                  aria-label={`Radius around ${row.label}`}
                  className="h-6 shrink-0 rounded border border-input bg-background px-1 text-[11px] disabled:opacity-50"
                >
                  {RADIUS_OPTIONS.map(option => (
                    <option key={option} value={option}>+{option} mi</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => remove(row)}
                disabled={readOnly}
                aria-label={`Remove ${row.label}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
              >
                <IconX className="size-3.5" />
              </button>
            </div>
          ))}
          {keptNotes.length > 0 && (
            <p className="px-2 pt-1 text-[11px] text-muted-foreground">
              Kept as-is (no editor for these yet): {keptNotes.join(" · ")}
            </p>
          )}
        </div>
      )}

      <GeoMap points={mapPoints} />
    </div>
  )
}
