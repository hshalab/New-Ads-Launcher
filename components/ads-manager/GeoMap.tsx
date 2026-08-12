"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as LeafletNS from "leaflet"
import "leaflet/dist/leaflet.css"

/**
 * The map under the Ads Manager Locations field.
 *
 * Real OpenStreetMap tiles, real coordinates, real radius circles — this replaces the SVG
 * schematic that shipped with the editor and closes BL-50. Three things are worth knowing before
 * changing it:
 *
 * 1. Leaflet touches `window` at import time, so it is imported inside an effect, never at module
 *    scope. The stylesheet is a normal import: it is extracted at build time and is SSR-safe.
 * 2. Nothing here is ever written back to Meta. `geo_locations` is a whole object to Meta and an
 *    unknown key inside it is a live class of bug (see the header of LocationsField) — coordinates
 *    are display state and stay in this component.
 * 3. A country pin sits on a static centroid; a city/region/zip pin is geocoded. When the geocoder
 *    has no answer the pin falls back to the country centre and is drawn hollow and labelled
 *    approximate, rather than implying a precision it does not have.
 */

/** Approximate country centroids, used for country pins and as the fallback for everything else. */
export const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  AE: [24, 54], AR: [-34, -64], AT: [47, 14], AU: [-25, 134], BE: [50, 4], BR: [-10, -52],
  CA: [56, -106], CH: [47, 8], CL: [-35, -71], CN: [35, 104], CO: [4, -74], CZ: [50, 15],
  DE: [51, 10], DK: [56, 10], EG: [27, 30], ES: [40, -4], FI: [64, 26], FR: [46, 2],
  GB: [54, -2], GR: [39, 22], HK: [22, 114], HU: [47, 20], ID: [-1, 113], IE: [53, -8],
  IL: [31, 35], IN: [22, 79], IT: [42, 12], JP: [36, 138], KR: [36, 128], MX: [23, -102],
  MY: [4, 102], NG: [9, 8], NL: [52, 5], NO: [61, 9], NZ: [-41, 174], PH: [12, 122],
  PK: [30, 70], PL: [52, 19], PT: [39, -8], RO: [46, 25], RU: [60, 100], SA: [24, 45],
  SE: [62, 17], SG: [1, 104], TH: [15, 101], TR: [39, 35], TW: [24, 121], UA: [49, 32],
  US: [38, -97], VN: [16, 108], ZA: [-29, 24],
}

export type GeoMapPoint = {
  /** Stable per rendered location; also the geocoder cache key for this point. */
  id: string
  scope: "include" | "exclude"
  kind: "country" | "region" | "city" | "zip" | "other"
  label: string
  detail: string
  /** ISO-2, when Meta gave us one. Drives the centroid fallback and narrows the geocoder. */
  country?: string
  radiusMiles?: number
  /** Geocoder input. Absent for countries — those resolve from the centroid table. */
  query?: string
}

const MILES_TO_METRES = 1609.34
const INCLUDE = "#3a61f6"
const EXCLUDE = "#f95f53"
/** Above this many pins the permanent labels collide, so they become hover tooltips. */
const MAX_PERMANENT_LABELS = 8

type Resolved = GeoMapPoint & { lat: number; lng: number; approximate: boolean }

export function GeoMap({ points }: { points: GeoMapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletNS.Map | null>(null)
  const layerRef = useRef<LeafletNS.LayerGroup | null>(null)
  const leafletRef = useRef<typeof LeafletNS | null>(null)
  const [ready, setReady] = useState(false)
  const [coords, setCoords] = useState<Record<string, [number, number]>>({})
  const [geocoding, setGeocoding] = useState(false)

  // Create the map once. Leaflet is imported here, not at module scope, because it reads `window`.
  useEffect(() => {
    let cancelled = false
    import("leaflet").then(mod => {
      const L = (mod as unknown as { default?: typeof LeafletNS }).default ?? (mod as typeof LeafletNS)
      if (cancelled || !containerRef.current || mapRef.current) return

      const map = L.map(containerRef.current, {
        // The editor lives in a scrolling panel: wheel-zoom would hijack the scroll.
        scrollWheelZoom: false,
        worldCopyJump: true,
        zoomControl: true,
      }).setView([20, 0], 1)

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map)

      leafletRef.current = L
      mapRef.current = map
      layerRef.current = L.layerGroup().addTo(map)
      setReady(true)
    })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      layerRef.current = null
      leafletRef.current = null
    }
  }, [])

  // The editor opens inside a drawer, so the container is often 0px wide at map creation.
  useEffect(() => {
    if (!ready || !containerRef.current) return
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize())
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [ready])

  /** Everything smaller than a country needs a lookup; countries come from the centroid table. */
  const needsGeocode = useMemo(
    () => points.filter(point => point.query && !coords[point.id]),
    [points, coords]
  )
  const geocodeSignature = needsGeocode.map(point => point.id).join("|")

  useEffect(() => {
    if (!geocodeSignature) return
    let cancelled = false
    setGeocoding(true)
    fetch("/api/geo/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: needsGeocode.map(point => ({ key: point.id, query: point.query, country: point.country })),
      }),
    })
      .then(response => (response.ok ? response.json() : { coords: {} }))
      .then(data => {
        if (cancelled) return
        const found = (data?.coords || {}) as Record<string, [number, number]>
        if (Object.keys(found).length > 0) setCoords(current => ({ ...current, ...found }))
      })
      .catch(() => { /* the centroid fallback already covers this */ })
      .finally(() => { if (!cancelled) setGeocoding(false) })
    return () => { cancelled = true }
    // needsGeocode is derived from the signature; depending on it directly would re-fire on every
    // coords update and re-query the places that just failed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geocodeSignature])

  const resolved = useMemo<Resolved[]>(() => {
    return points.flatMap(point => {
      const exact = coords[point.id]
      if (exact) return [{ ...point, lat: exact[0], lng: exact[1], approximate: false }]
      const centroid = point.country ? COUNTRY_CENTROIDS[point.country.toUpperCase()] : undefined
      if (!centroid) return []
      return [{ ...point, lat: centroid[0], lng: centroid[1], approximate: point.kind !== "country" }]
    })
  }, [points, coords])

  const draw = useCallback(() => {
    const L = leafletRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!L || !map || !layer) return

    layer.clearLayers()
    if (resolved.length === 0) {
      map.setView([20, 0], 1)
      return
    }

    const permanentLabels = resolved.length <= MAX_PERMANENT_LABELS
    const bounds = L.latLngBounds([])

    for (const point of resolved) {
      const colour = point.scope === "exclude" ? EXCLUDE : INCLUDE
      const position: LeafletNS.LatLngExpression = [point.lat, point.lng]

      // A radius circle is only honest on a geocoded point — never on a country centroid.
      if (point.radiusMiles && !point.approximate) {
        const circle = L.circle(position, {
          radius: point.radiusMiles * MILES_TO_METRES,
          color: colour,
          weight: 1,
          fillColor: colour,
          fillOpacity: 0.12,
        }).addTo(layer)
        bounds.extend(circle.getBounds())
      }

      const marker = L.circleMarker(position, {
        radius: point.kind === "country" ? 7 : 5,
        color: colour,
        weight: 2,
        fillColor: point.approximate ? "#ffffff" : colour,
        fillOpacity: point.approximate ? 0.9 : 0.75,
        dashArray: point.approximate ? "2 2" : undefined,
      }).addTo(layer)

      const suffix = point.approximate ? " · approximate" : ""
      marker.bindTooltip(`${point.label} — ${point.detail}${suffix}`, {
        permanent: permanentLabels,
        direction: "top",
        offset: [0, -6],
        className: "adl-geo-label",
      })
      bounds.extend(position)
    }

    if (resolved.length === 1 && !resolved[0].radiusMiles) {
      map.setView([resolved[0].lat, resolved[0].lng], resolved[0].kind === "country" ? 4 : 9)
    } else {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 10 })
    }
  }, [resolved])

  useEffect(() => {
    if (ready) draw()
  }, [ready, draw])

  const approximateCount = resolved.filter(point => point.approximate).length
  const unmappable = points.length - resolved.length

  return (
    <div className="overflow-hidden rounded-md border border-input">
      <div
        ref={containerRef}
        className="h-56 w-full bg-[#eaf0f6] dark:bg-slate-900 [&_.adl-geo-label]:!border-0 [&_.adl-geo-label]:!bg-black/70 [&_.adl-geo-label]:!px-1.5 [&_.adl-geo-label]:!py-0.5 [&_.adl-geo-label]:!text-[10px] [&_.adl-geo-label]:!text-white [&_.adl-geo-label]:!shadow-none [&_.adl-geo-label:before]:!hidden"
        role="application"
        aria-label="Map of selected locations"
      />
      <p className="border-t border-input bg-background/60 px-2 py-1 text-[10px] text-muted-foreground">
        {resolved.length === 0
          ? "No mappable locations selected."
          : <>
              {resolved.length} location{resolved.length === 1 ? "" : "s"} shown
              {approximateCount > 0 && <> · {approximateCount} placed at the country centre (hollow pin) because the geocoder had no match</>}
              {unmappable > 0 && <> · {unmappable} without a known country</>}
              {geocoding && <> · locating…</>}
            </>}
      </p>
    </div>
  )
}
