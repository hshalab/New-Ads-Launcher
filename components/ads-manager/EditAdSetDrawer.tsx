"use client"

import { useEffect, useState } from "react"
import { IconLoader2, IconX } from "@tabler/icons-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { resolveOdaxRow } from "@/lib/odax-matrix"
import { cn } from "@/lib/utils"
import {
  AdvertiserEntity,
  CampaignFormState,
  defaultCampaignState,
  PixelOption,
} from "./create-flow/types"
import { AdSetFormFields } from "./create-flow/AdSetFormFields"

export interface EditAdSetDrawerProps {
  adSetId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
  /** Pass-through props the form needs (fetched at the page level in edit too). */
  pixels?: PixelOption[]
  currency?: string
  timezoneName?: string
  adAccountId?: string
}

type AdSetStatus = "ACTIVE" | "PAUSED"

interface AdSetDetailMeta {
  id: string
  name: string
  status: AdSetStatus
  [key: string]: unknown
}

function toDatetimeLocal(iso?: string): string {
  if (!iso) return ""
  // Meta returns ISO 8601 (e.g. 2026-07-15T15:30:00+0000). datetime-local needs YYYY-MM-DDTHH:MM.
  return iso.slice(0, 16)
}

function gendersToState(metaGenders?: number[]): CampaignFormState["gender"] {
  if (!metaGenders || metaGenders.length === 0 || metaGenders.length > 1) return "ALL"
  return metaGenders[0] === 1 ? "MALE" : metaGenders[0] === 2 ? "FEMALE" : "ALL"
}

function stateToGenders(g: CampaignFormState["gender"]): number[] {
  if (g === "MALE") return [1]
  if (g === "FEMALE") return [2]
  return []
}

function buildAttributionSpec(state: CampaignFormState) {
  const spec: { event_type: string; window_days: number }[] = []
  spec.push({ event_type: "CLICK", window_days: Number(state.attributionClickDays) })
  if (state.attributionViewDays !== "0") {
    spec.push({ event_type: "VIEW", window_days: Number(state.attributionViewDays) })
  }
  if (state.attributionEngagedViewDays !== "0") {
    spec.push({ event_type: "ENGAGED_VIEW", window_days: Number(state.attributionEngagedViewDays) })
  }
  return spec
}

function detailToState(detail: AdSetDetailMeta | null): CampaignFormState {
  if (!detail) return { ...defaultCampaignState }
  const t = (detail.targeting ?? {}) as Record<string, any>
  const po = (detail.promoted_object ?? {}) as Record<string, any>
  const attrSpec = Array.isArray(detail.attribution_spec) ? detail.attribution_spec as Array<Record<string, any>> : []

  const countries: string[] = t.geo_locations?.countries ?? []
  const publisherPlatforms: string[] = Array.isArray(t.publisher_platforms) ? t.publisher_platforms : []

  const clickDays = attrSpec.find(a => a.event_type === "CLICK")?.window_days
  const viewDays = attrSpec.find(a => a.event_type === "VIEW")?.window_days
  const evDays = attrSpec.find(a => a.event_type === "ENGAGED_VIEW")?.window_days

  return {
    ...defaultCampaignState,
    adSetName: detail.name ?? "",
    dailyBudget: detail.daily_budget ? String(parseInt(detail.daily_budget as string) / 100) : "",
    scheduleStart: toDatetimeLocal(detail.start_time as string | undefined),
    scheduleEnd: toDatetimeLocal(detail.end_time as string | undefined),
    performanceGoal: (detail.optimization_goal as CampaignFormState["performanceGoal"]) ?? defaultCampaignState.performanceGoal,
    costPerResultGoal: detail.bid_amount ? String(parseInt(detail.bid_amount as string) / 100) : "",
    pixelId: po.pixel_id ?? "",
    conversionEvent: po.custom_event_type ?? defaultCampaignState.conversionEvent,
    attributionClickDays: clickDays ? String(clickDays) as CampaignFormState["attributionClickDays"] : defaultCampaignState.attributionClickDays,
    attributionViewDays: viewDays ? String(viewDays) as CampaignFormState["attributionViewDays"] : "0",
    attributionEngagedViewDays: evDays ? String(evDays) as CampaignFormState["attributionEngagedViewDays"] : "0",
    locations: countries,
    ageMin: t.age_min ?? defaultCampaignState.ageMin,
    ageMax: t.age_max ?? defaultCampaignState.ageMax,
    gender: gendersToState(t.genders),
    customAudiences: Array.isArray(t.custom_audiences?.data)
      ? t.custom_audiences.data.map((ca: any) => ({ id: ca.id, name: ca.name }))
      : [],
    excludedCustomAudiences: Array.isArray(t.excluded_custom_audiences?.data)
      ? t.excluded_custom_audiences.data.map((ca: any) => ({ id: ca.id, name: ca.name }))
      : [],
    targetingExpansion: t.targeting_optimization === "expansion_all" ? true : defaultCampaignState.targetingExpansion,
    placementMode: publisherPlatforms.length > 0 ? "manual" : "advantage",
    publisherPlatforms: publisherPlatforms.filter((p): p is CampaignFormState["publisherPlatforms"][number] =>
      ["facebook", "instagram", "audience_network", "messenger"].includes(p)
    ) as CampaignFormState["publisherPlatforms"],
  }
}

function stateToReview(state: CampaignFormState, status: AdSetStatus, currency: string) {
  const clickLabel =
    state.attributionClickDays === "7" ? "7-day click" : "1-day click"
  const viewLabel =
    state.attributionViewDays === "1" ? "1-day view" : "Off"
  const evLabel =
    state.attributionEngagedViewDays === "1" ? "1-day engaged-view" : "Off"

  const budgetLabel = state.dailyBudget
    ? `Daily budget ${currency}${state.dailyBudget}`
    : "Not set"

  const locationsLabel =
    state.locations.length > 0 ? state.locations.join(", ") : "None"

  const placementsLabel =
    state.placementMode === "advantage"
      ? "Advantage+ placements"
      : state.publisherPlatforms.length > 0
        ? "Manual: " + state.publisherPlatforms.join(", ")
        : "Manual (none selected)"

  const genderLabel =
    state.gender === "ALL" ? "All" : state.gender === "MALE" ? "Men" : "Women"

  return [
    { label: "Ad set name", value: state.adSetName || "—" },
    { label: "Status", value: status === "ACTIVE" ? "Active" : "Paused" },
    {
      label: "Conversion location",
      // Awareness ad sets have no conversion location at all, so the label comes from the ODAX
      // table rather than a string comparison that would render an empty cell for null.
      value:
        resolveOdaxRow(state.objective, state.conversionLocation, state.engagementType)
          ?.conversionLocationLabel || "—",
    },
    { label: "Performance goal", value: perfGoalLabel(state.performanceGoal) },
    { label: "Budget", value: budgetLabel },
    { label: "Start date", value: state.scheduleStart || "Start immediately" },
    { label: "End date", value: state.scheduleEnd || "Run as ongoing" },
    { label: "Locations included", value: locationsLabel },
    { label: "Minimum age", value: String(state.ageMin) },
    { label: "Age suggestion", value: `${state.ageMin} - ${state.ageMax === 65 ? "65+" : state.ageMax}` },
    { label: "Gender", value: genderLabel },
    { label: "Targeting expansion", value: state.targetingExpansion ? "Yes" : "No" },
    { label: "Placements", value: placementsLabel },
    {
      label: "Advertiser (selected locations)",
      value: state.advertiser?.name ?? null,
      warnIfNull: "Please add Advertiser (selected locations)",
    },
    {
      label: "Payer (selected locations)",
      value: state.payer?.name ?? null,
      warnIfNull: "Please add Payer (selected locations)",
    },
    { label: "Attribution", value: `${clickLabel}, ${viewLabel}, ${evLabel}` },
    {
      label: "Cost per result goal",
      value: state.costPerResultGoal ? `${currency}${state.costPerResultGoal}` : "Not set",
    },
    {
      label: "Custom audiences",
      value: state.customAudiences.length > 0
        ? state.customAudiences.map((c) => c.name).join(", ")
        : "None",
    },
    {
      label: "Detailed targeting",
      value: state.detailedTargeting.length > 0
        ? state.detailedTargeting.map((t) => t.name).join(", ")
        : "None",
    },
  ]
}

function perfGoalLabel(goal: CampaignFormState["performanceGoal"]): string {
  switch (goal) {
    case "OFFSITE_CONVERSIONS":
      return "Maximise number of conversions"
    case "LINK_CLICKS":
      return "Maximise number of link clicks"
    case "LANDING_PAGE_VIEWS":
      return "Maximise number of landing page views"
    case "REACH":
      return "Maximise reach"
    default:
      return String(goal)
  }
}

export function EditAdSetDrawer({
  adSetId,
  open,
  onOpenChange,
  onSaved,
  pixels = [],
  currency = "USD",
  timezoneName,
  adAccountId,
}: EditAdSetDrawerProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<AdSetDetailMeta | null>(null)
  const [status, setStatus] = useState<AdSetStatus>("PAUSED")
  const [form, setForm] = useState<CampaignFormState>({ ...defaultCampaignState })
  const [advertisers, setAdvertisers] = useState<AdvertiserEntity[]>([])

  useEffect(() => {
    if (!open || !adSetId) return
    let active = true

    const load = async () => {
      setLoading(true)
      try {
        const [detailRes, advRes] = await Promise.all([
          fetch(`/api/facebook/adsets/${adSetId}/detail`),
          adAccountId ? fetch(`/api/facebook/adset-advertisers?ad_account_id=${encodeURIComponent(adAccountId)}`) : Promise.resolve(null)
        ])

        if (!active) return

        if (detailRes.ok) {
          const data = await detailRes.json()
          if (data.adSet) {
            setDetail(data.adSet)
            setStatus(data.adSet.status as AdSetStatus)
            setForm(detailToState(data.adSet))
          }
        }
        if (advRes && advRes.ok) {
          const advData = await advRes.json()
          setAdvertisers(advData.advertisers || [])
        }
      } catch (err) {
        console.error("Failed to load adset detail:", err)
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [open, adSetId, adAccountId])

  const update = (updates: Partial<CampaignFormState>) =>
    setForm((prev) => ({ ...prev, ...updates }))

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        id: adSetId,
        adAccountId,
        name: form.adSetName,
        status: status,
        daily_budget: form.dailyBudget ? Number(form.dailyBudget) : undefined,
        start_time: form.scheduleStart ? new Date(form.scheduleStart).toISOString() : undefined,
        end_time: form.scheduleEnd ? new Date(form.scheduleEnd).toISOString() : undefined,
        optimization_goal: form.performanceGoal,
        bid_amount: form.costPerResultGoal ? Number(form.costPerResultGoal) : undefined,
        promoted_object: {
          pixel_id: form.pixelId,
          custom_event_type: form.conversionEvent,
        },
        attribution_spec: buildAttributionSpec(form),
        targeting: {
          geo_locations: { countries: form.locations },
          age_min: form.ageMin,
          age_max: form.ageMax,
          genders: stateToGenders(form.gender),
          custom_audiences: form.customAudiences.length > 0 ? form.customAudiences.map(c => ({ id: c.id, name: c.name })) : undefined,
          excluded_custom_audiences: form.excludedCustomAudiences.length > 0 ? form.excludedCustomAudiences.map(c => ({ id: c.id, name: c.name })) : undefined,
          targeting_optimization: form.targetingExpansion ? "expansion_all" : "none",
          publisher_platforms: form.placementMode === "advantage" ? ["facebook", "instagram", "audience_network", "messenger"] : form.publisherPlatforms,
        },
        advertiser: form.advertiser,
        payer: form.payer,
      }

      const r = await fetch("/api/facebook/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      if (!r.ok) throw new Error("Failed to save ad set")

      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      alert("Failed to save ad set")
    } finally {
      setSaving(false)
    }
  }

  const reviewRows = stateToReview(form, status, currency)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[1100px] w-full p-0 flex flex-col gap-0 overflow-hidden"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Edit Ad Set</DialogTitle>
          <DialogDescription>
            Edit settings for this ad set. Changes apply on save.
          </DialogDescription>
        </DialogHeader>

        {/* Sticky header */}
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-card">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
            >
              <IconX className="size-5 text-slate-400" />
            </Button>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-gray-100">
              Edit Ad Set
            </h2>
            {detail && (
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium",
                  status === "ACTIVE"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                )}
              >
                {status === "ACTIVE" ? "Active" : "Paused"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={loading || saving}
              className="bg-blue-600 px-4 text-white hover:bg-blue-700"
            >
              {saving ? (
                <>
                  <IconLoader2 className="mr-1.5 size-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </header>

        {/* Scrollable body — 2 columns */}
        <div className="flex flex-1 overflow-hidden h-[85vh] max-h-[85vh]">
          {/* LEFT: form (65%) */}
          <div className="w-full overflow-y-auto border-r border-slate-200 p-6 dark:border-gray-800 lg:w-[65%]">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <IconLoader2 className="size-6 animate-spin text-slate-400" />
              </div>
            ) : (
              <AdSetFormFields
                value={form}
                onChange={update}
                mode="edit"
                pixels={pixels}
                pixelsLoading={false}
                currency={currency}
                timezoneName={timezoneName}
                advertisers={advertisers}
              />
            )}
          </div>

          {/* RIGHT: sticky Review panel (35%) */}
          <aside className="hidden overflow-y-auto bg-slate-50 p-6 dark:bg-muted/30 lg:block lg:w-[35%]">
            <div className="sticky top-0 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-gray-800 dark:bg-card">
              <div className="rounded-t-lg border-b border-slate-200 bg-slate-50/50 px-5 py-4 dark:border-gray-800 dark:bg-muted/50">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-gray-100">
                  Review
                </h3>
              </div>
              <div className="max-h-[calc(100vh-140px)] space-y-3.5 overflow-y-auto p-5">
                {reviewRows.map((row, idx) => (
                  <div key={`${row.label}-${idx}`}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-gray-300">
                      {row.label}
                    </p>
                    {row.value ? (
                      <p className="text-sm font-medium text-slate-900 dark:text-gray-100">
                        {row.value}
                      </p>
                    ) : row.warnIfNull ? (
                      <p className="text-sm font-medium text-red-600 dark:text-red-400">
                        {row.warnIfNull}
                      </p>
                    ) : (
                      <p className="text-sm text-slate-400">—</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}
