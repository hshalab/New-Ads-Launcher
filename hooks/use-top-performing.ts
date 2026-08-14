"use client"

import { useState, useEffect, useCallback } from "react"
import { getPresetRange } from "@/components/ads-manager/AdsDateRangePicker"
import { formatDateOnly } from "@/lib/local-date-range"

export interface TopPerformingItem {
  rank: number
  adId: string
  adName: string
  headline: string
  primaryText: string
  spend: number
  copyCount: number
}

const LS_TTL = 5 * 60 * 1000

function lsKey(accountId: string, preset: string) {
  return `tp:${accountId}:${preset}`
}

export function useTopPerforming(adAccountId: string | null, datePreset: string) {
  const [items, setItems] = useState<TopPerformingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCached, setIsCached] = useState(false)
  const [cachedAt, setCachedAt] = useState<Date | null>(null)

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!adAccountId) {
        setItems([])
        return
      }

      if (!forceRefresh) {
        try {
          const raw = localStorage.getItem(lsKey(adAccountId, datePreset))
          if (raw) {
            const p = JSON.parse(raw)
            if (p.expiresAt > Date.now()) {
              setItems(p.items)
              setCachedAt(new Date(p.savedAt))
              setIsCached(true)
              return
            }
          }
        } catch { /* ignore */ }
      }

      setLoading(true)
      setError(null)
      setIsCached(false)

      try {
        const range = getPresetRange(datePreset)
        const qs = new URLSearchParams({
          adAccountId,
          datePreset,
          since: formatDateOnly(range.start),
          until: formatDateOnly(range.end),
          ...(forceRefresh ? { refresh: "1" } : {}),
        })
        const res = await fetch(`/api/facebook/top-performing?${qs}`)
        if (!res.ok) {
          const d = await res.json()
          throw new Error(d.error || "Failed to load top performing")
        }
        const d = await res.json()
        const data: TopPerformingItem[] = d.items || []
        setItems(data)
        const now = new Date()
        setCachedAt(now)
        try {
          localStorage.setItem(
            lsKey(adAccountId, datePreset),
            JSON.stringify({ items: data, savedAt: now.toISOString(), expiresAt: Date.now() + LS_TTL })
          )
        } catch { /* quota */ }
      } catch (e: any) {
        setError(e.message)
        setItems([])
      } finally {
        setLoading(false)
      }
    },
    [adAccountId, datePreset]
  )

  useEffect(() => {
    load()
  }, [load])

  return {
    items,
    loading,
    error,
    isCached,
    cachedAt,
    refresh: () => load(true),
  }
}
