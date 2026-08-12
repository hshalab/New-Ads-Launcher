"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { IconLoader2 } from "@tabler/icons-react"
import { useAdAccount } from "@/lib/ad-account-context"
import type { Level, ReportRow } from "./InsightDrawers"

const PerformancePopup = dynamic(
  () => import("./PerformancePopup").then(module => module.PerformancePopup),
  { ssr: false }
)

/**
 * The Ads Manager editor as a route.
 *
 * Mounted twice, deliberately:
 *  - `@editor/(.)editor/page.tsx` — soft navigation from the table. The table stays mounted
 *    underneath, so Collapse view has something to reveal (`intercepted` → canCollapse).
 *  - `editor/page.tsx` — hard load, refresh, or a pasted link. Nothing is mounted behind, so
 *    Collapse is disabled rather than opening onto an empty pane.
 *
 * Everything the editor needs beyond the URL is re-fetched here. That is the cost of the editor
 * being a route instead of a child of the table's state, and it is why the lists are requested
 * without insights (`date_preset` is only carried through for the charts view).
 */

type Params = {
  accountId: string
  level: Level
  id: string
  campaignId?: string
  adsetId?: string
  view: "charts" | "edit" | "review" | "history"
  datePreset: string
}

function readParams(search: URLSearchParams, fallbackAccount: string): Params | null {
  const id = search.get("id") || ""
  const level = (search.get("level") || "campaign") as Level
  const accountId = search.get("account") || fallbackAccount
  if (!id || !accountId) return null
  if (level !== "campaign" && level !== "adset" && level !== "ad") return null
  const view = (search.get("view") || "edit") as Params["view"]
  return {
    accountId,
    level,
    id,
    campaignId: search.get("campaign") || undefined,
    adsetId: search.get("adset") || undefined,
    view: ["charts", "edit", "review", "history"].includes(view) ? view : "edit",
    datePreset: search.get("date") || "last_30d",
  }
}

export function AdsManagerEditorRoute({ intercepted = false }: { intercepted?: boolean }) {
  const router = useRouter()
  const search = useSearchParams()
  const { selectedAccountId } = useAdAccount()

  const params = useMemo(
    () => readParams(new URLSearchParams(search.toString()), selectedAccountId || ""),
    [search, selectedAccountId]
  )

  const [access, setAccess] = useState({ loaded: false, enabled: false, canMutate: false })
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [adSets, setAdSets] = useState<any[]>([])
  const [ads, setAds] = useState<any[]>([])
  const [name, setName] = useState("")
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/ads-manager/workspace-access")
      .then(response => response.json())
      .then(data => {
        if (cancelled) return
        setAccess({
          loaded: true,
          enabled: Boolean(data?.enabled),
          canMutate: Boolean(data?.canMutate),
        })
      })
      .catch(() => { if (!cancelled) setAccess({ loaded: true, enabled: false, canMutate: false }) })
    return () => { cancelled = true }
  }, [])

  // Hierarchy for the tree and the breadcrumb. Scoped by the parent ids in the URL when they are
  // there, so opening one ad does not pull the whole account.
  useEffect(() => {
    if (!params) return
    let cancelled = false
    const account = encodeURIComponent(params.accountId)
    const campaignScope = params.campaignId ? `&campaign_id=${encodeURIComponent(params.campaignId)}` : ""
    const adsetScope = params.adsetId ? `&adset_id=${encodeURIComponent(params.adsetId)}` : ""

    const get = (url: string) => fetch(url, { cache: "no-store" }).then(response => response.json())

    Promise.all([
      get(`/api/facebook/campaigns?ad_account_id=${account}&date_preset=${params.datePreset}`),
      params.level === "campaign" && !params.campaignId
        ? Promise.resolve({ adSets: [] })
        : get(`/api/facebook/adsets?ad_account_id=${account}${campaignScope}&date_preset=${params.datePreset}`),
      params.level === "ad" || params.adsetId
        ? get(`/api/facebook/ads?ad_account_id=${account}${adsetScope}&date_preset=${params.datePreset}`)
        : Promise.resolve({ ads: [] }),
    ])
      .then(([campaignData, adSetData, adData]) => {
        if (cancelled) return
        const nextCampaigns = campaignData?.campaigns || []
        const nextAdSets = adSetData?.adSets || []
        const nextAds = adData?.ads || []
        setCampaigns(nextCampaigns)
        setAdSets(nextAdSets)
        setAds(nextAds)
        const pool = params.level === "campaign" ? nextCampaigns : params.level === "adset" ? nextAdSets : nextAds
        const match = pool.find((item: { id: string }) => item.id === params.id)
        if (match?.name) setName(match.name)
      })
      .catch((error: Error) => { if (!cancelled) setLoadError(error.message || "Failed to load hierarchy") })

    return () => { cancelled = true }
  }, [params])

  const close = useCallback(() => {
    // Soft-navigated in → back returns to the table with its scroll and filters intact.
    // Hard-loaded → there is no history entry to return to, so land on the table.
    if (intercepted && window.history.length > 1) router.back()
    else router.push("/ads-manager")
  }, [intercepted, router])

  if (!params) {
    return (
      <div className="absolute inset-0 z-40 grid place-items-center bg-background">
        <div className="max-w-sm text-center">
          <p className="text-sm font-semibold">Nothing to edit</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This link is missing the node it should open. Pick a campaign, ad set or ad from the table.
          </p>
          <button onClick={close} className="mt-4 h-9 rounded-lg border px-3 text-sm hover:bg-muted/50">
            Back to Ads Manager
          </button>
        </div>
      </div>
    )
  }

  if (!access.loaded) {
    return (
      <div className="absolute inset-0 z-40 grid place-items-center bg-background">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const rows: ReportRow[] = [{
    id: params.id,
    name: name || params.id,
    adId: params.level === "ad" ? params.id : undefined,
  }]

  return (
    <>
      {loadError && (
        <div className="absolute inset-x-0 top-0 z-50 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          Hierarchy could not be loaded ({loadError}) — the tree and breadcrumb may be incomplete.
        </div>
      )}
      <PerformancePopup
        mode="charts"
        level={params.level}
        accountId={params.accountId}
        rows={rows}
        datePreset={params.datePreset}
        since=""
        until=""
        onClose={close}
        campaigns={campaigns}
        adSets={adSets}
        ads={ads}
        initialView={params.view}
        unifiedWorkspace={access.enabled}
        canMutate={access.canMutate}
        onPublished={() => router.refresh()}
        shell="page"
        canCollapse={intercepted}
      />
    </>
  )
}
