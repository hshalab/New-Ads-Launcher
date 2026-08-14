"use client"

import { useState, useEffect, useCallback, useRef, useMemo, Fragment, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AdAccountPill } from "@/components/shared/ad-account-pill"
import { useAdAccount } from "@/lib/ad-account-context"
import { LatestRequestGuard } from "@/lib/latest-request-guard"
import { BID_STRATEGY_LABEL } from "@/lib/create-campaign-bidding"
import { cn } from "@/lib/utils"
import {
  IconPlus, IconCopy, IconPencil, IconRefresh,
  IconLoader2, IconChevronDown, IconChevronLeft, IconChevronRight,
  IconTrash, IconSettings, IconCalendar, IconArrowsUpDown,
  IconArrowUp, IconArrowDown, IconHistory, IconTable, IconCheck,
  IconChevronRight as IconDrillRight,
  IconSpeakerphone, IconTarget, IconPhoto, IconExternalLink, IconClipboard, IconX,
  IconAdjustments, IconDownload, IconChartBar, IconInfoCircle, IconSearch,
} from "@tabler/icons-react"
import dynamic from "next/dynamic"
import { type Level, type ReportRow } from "@/components/ads-manager/InsightDrawers"
import { MiniStatusPopup, type PopupItem } from "@/components/ads-manager/MiniStatusPopup"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AdsDateRangePicker, DATE_PICKER_PRESETS, getPresetRange } from "@/components/ads-manager/AdsDateRangePicker"
import type { WorkspaceNode } from "@/components/ads-manager/UnifiedWorkspaceEditor"
import type {
  CampaignFormState,
  CampaignObjective,
  PerformanceGoal,
  SpecialAdCategory,
} from "@/components/ads-manager/create-flow/types"

// Modals only render when opened — load their JS on demand instead of in the main bundle
const PerformancePopup = dynamic(() => import("@/components/ads-manager/PerformancePopup").then(m => m.PerformancePopup), { ssr: false })
const CreateCampaignModal = dynamic(() => import("@/components/ads-manager/create-flow/CreateCampaignModal").then(m => m.CreateCampaignModal), { ssr: false })
const CustomizeColumnsModal = dynamic(() => import("@/components/ads-manager/CustomizeColumnsModal").then(m => m.CustomizeColumnsModal), { ssr: false })
const EditAdSetDrawer = dynamic(() => import("@/components/ads-manager/EditAdSetDrawer").then(m => m.EditAdSetDrawer), { ssr: false })
import { COLUMN_DEFS, COLUMN_MAP, DEFAULT_PRESETS, ColumnPreset, CustomMetricConfig, getActivePreset, toColumnDef } from "@/lib/column-config"
import { evalCustomMetric } from "@/lib/custom-metric-eval"
import { BreakdownDropdown } from "@/components/ads-manager/BreakdownDropdown"
import { BREAKDOWN_API_MAP } from "@/lib/breakdown-config"
import { useLaunchBatchesRealtime } from "@/hooks/use-launch-batches-realtime"
import { OpportunityScoreBadge } from "@/components/ads-manager/OpportunityScoreBadge"
import {
  BulkDraftReviewDialog,
  BulkEditDraftDialog,
  BulkStatusChangeDialog,
  type BulkEditHierarchy,
} from "@/components/ads-manager/BulkEditDraftDialogs"
import { BulkEditFieldMenu } from "@/components/ads-manager/BulkEditFieldMenu"
import { FilterBar } from "@/components/ads-manager/FilterBar"
import {
  type ChipEvalContext,
  type FilterChip,
  type FilterLevel,
  SELECTED_ROWS_FIELD,
  isChipValidAt,
  loadAdsManagerFilterState,
  matchesChip,
  newChipId,
  orderChipsForEval,
  saveAdsManagerFilterState,
} from "@/lib/ads-manager-filters"
import {
  type BulkDraftField,
  type BulkDraftMap,
  type BulkEditableItem,
  type BulkPublishResult,
  bulkDraftKey,
  bulkDraftStorageKey,
  parseBulkDrafts,
  removePublishedDrafts,
  serializeBulkDrafts,
  stageBudgetDrafts,
} from "@/lib/ads-manager-bulk-drafts"

// ─── Helpers ──────────────────────────────────────────────────────────────────
function downloadCsv(filename: string, rows: Record<string, string | number>[]) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`
  const csv = [
    headers.map(esc).join(","),
    ...rows.map(r => headers.map(h => esc(r[h])).join(","))
  ].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "campaigns" | "adsets" | "ads"
type SortDir = "asc" | "desc"
type DeleteResult = { id: string; success?: boolean; error?: string }

const STANDARD_ATTR = [
  { key: "1d_click", label: "1-day click", desc: "Conversions counted after an action within 1 day of an ad click." },
  { key: "7d_click", label: "7-day click", desc: "Conversions counted after an action within 7 days of an ad click." },
  { key: "28d_click", label: "28-day click", desc: "Conversions counted after an action within 28 days of an ad click." },
  { key: "1d_view", label: "1-day view", desc: "Conversions counted after an action within 1 day of an ad impression." },
  { key: "1d_ev", label: "1-day engagement", desc: "Counted after an interaction (ad click or video view) within 1 day." },
]
const SKAN_ATTR = [
  { key: "skan_view", label: "View from SKAdNetwork", desc: "Attributed when someone views an ad and installs the app within 24 hours." },
  { key: "skan_click", label: "Click from SKAdNetwork", desc: "Attributed when someone clicks an ad and installs the app within 30 days." },
]

interface Insight {
  spend: string
  impressions: string
  clicks: string
  reach?: string
  frequency?: string
  cpm?: string
  ctr?: string
  inline_link_clicks?: string
  unique_clicks?: string
  unique_inline_link_clicks?: string
  unique_link_clicks_ctr?: string
  actions?: { action_type: string; value: string }[]
  action_values?: { action_type: string; value: string }[]
  cost_per_action_type?: { action_type: string; value: string }[]
  video_avg_time_watched_actions?: { action_type: string; value: string }[]
}

interface Campaign {
  id: string
  name: string
  status: string
  effective_status: string
  objective: string
  daily_budget?: string
  lifetime_budget?: string
  budget_remaining?: string
  start_time?: string
  stop_time?: string
  bid_strategy?: string
  special_ad_categories?: string[]
  /** Optional because the DB-snapshot fallback in the API route may not carry it. */
  created_time?: string
  insights?: { data: Insight[] }
}

interface LearningStageInfo {
  status?: "LEARNING" | "SUCCESS" | "LEARNING_LIMITED" | string
  conversions?: number
}

interface AttributionSpecEntry {
  event_type?: string
  window_days?: number
}

interface AdSet {
  id: string
  name: string
  status: string
  effective_status: string
  campaign_id: string
  campaign_name?: string | null
  daily_budget?: string
  lifetime_budget?: string
  budget_remaining?: string
  optimization_goal?: string
  billing_event?: string
  bid_strategy?: string
  attribution_spec?: AttributionSpecEntry[]
  learning_stage_info?: LearningStageInfo
  start_time?: string
  end_time?: string
  created_time?: string
  insights?: { data: Insight[] }
}

interface Ad {
  id: string
  name: string
  status: string
  effective_status: string
  adset_id: string
  campaign_id: string
  adset?: {
    attribution_spec?: AttributionSpecEntry[]
    bid_strategy?: string
    learning_stage_info?: LearningStageInfo
  }
  creative?: { id: string; title?: string; body?: string; image_url?: string; thumbnail_url?: string }
  creative_variations?: { bodies: string[]; titles: string[]; descriptions: string[] }
  created_time?: string
  insights?: { data: Insight[] }
}

/**
 * The default row order for all three hierarchy levels: newest created first, then active.
 *
 * Meta returns objects in its own order — effectively oldest first — so the campaign, ad set or
 * ad the user launched a minute ago arrived at the bottom of the list. Sorting by name instead
 * is worse than it looks: it groups rows by whatever naming convention the account happens to
 * use and still buries new work.
 *
 * `created_time` is already requested by lib/facebook.ts at all three levels, so this needed no
 * API change. It is optional on the interfaces because those routes have a DB-snapshot fallback
 * that may not carry it — a row without one sorts last rather than jumping to the top, and the
 * numeric id tie-break keeps the order stable across re-renders (Meta ids increase over time,
 * so it is a reasonable recency proxy on its own).
 */
const byNewestFirst = (
  a: { created_time?: string; effective_status: string; id: string },
  b: { created_time?: string; effective_status: string; id: string },
) => {
  const at = a.created_time ? Date.parse(a.created_time) : NaN
  const bt = b.created_time ? Date.parse(b.created_time) : NaN
  const aOk = !Number.isNaN(at)
  const bOk = !Number.isNaN(bt)
  if (aOk && bOk && at !== bt) return bt - at
  if (aOk !== bOk) return aOk ? -1 : 1
  const aActive = a.effective_status === "ACTIVE"
  const bActive = b.effective_status === "ACTIVE"
  if (aActive !== bActive) return aActive ? -1 : 1
  return b.id.localeCompare(a.id, undefined, { numeric: true })
}

interface BreakdownRow {
  parentId: string
  breakdownLabel: string
  dateStart?: string
  ins: Insight
}

// ─── Constants ────────────────────────────────────────────────────────────────


const OBJECTIVE_RESULT: Record<string, { type: string; actionType: string }> = {
  OUTCOME_SALES: { type: "Purchases", actionType: "omni_purchase" },
  OUTCOME_LEADS: { type: "Leads", actionType: "lead" },
  OUTCOME_TRAFFIC: { type: "Link clicks", actionType: "link_click" },
  OUTCOME_ENGAGEMENT: { type: "Post engagements", actionType: "post_engagement" },
  OUTCOME_APP_PROMOTION: { type: "App installs", actionType: "mobile_app_install" },
  OUTCOME_AWARENESS: { type: "Reach", actionType: "reach" },
}

const ACTION_ALIASES: Record<string, string[]> = {
  omni_purchase: ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase"],
  purchase: ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase"],
  lead: ["lead", "omni_lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped", "onsite_conversion.lead"],
  link_click: ["link_click", "omni_link_click"],
  add_to_cart: ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "onsite_conversion.add_to_cart"],
  initiate_checkout: ["omni_initiate_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"],
  view_content: ["omni_view_content", "view_content", "offsite_conversion.fb_pixel_view_content"],
  landing_page_view: ["landing_page_view", "omni_landing_page_view"],
}

const PAGE_SIZE = 20

/**
 * Ceiling on the drain that sorting and filtering trigger. One Graph round trip per
 * PAGE_SIZE rows, so 1,000 rows is ~50 sequential calls — already slow, and past the
 * point where a buyer is scanning rather than working. A judgement call, not a
 * measurement: it is owed a timing on the largest real account (BL-43, ticket 04).
 */
const DRAIN_ROW_LIMIT = 1000

/** Above this many objects, bulk delete requires the count to be typed. */
const TYPED_DELETE_CONFIRM_THRESHOLD = 20

function mergeById<T extends { id: string }>(prev: T[], next: T[]) {
  const seen = new Set(prev.map(item => item.id))
  return [...prev, ...next.filter(item => !seen.has(item.id))]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBreakdownLabel(item: Record<string, string>, selectedIds: string[]): string {
  const allBdsFields: string[] = []
  let tiValue: string | null = null
  for (const id of selectedIds) {
    const param = BREAKDOWN_API_MAP[id]
    if (!param) continue
    const bdsM = param.match(/breakdowns=([^&]+)/)
    const tiM  = param.match(/time_increment=([^&]+)/)
    if (bdsM) allBdsFields.push(...bdsM[1].split(",").map(s => s.trim()))
    if (tiM) tiValue = tiM[1]
  }
  const parts: string[] = []
  if (tiValue && item.date_start) {
    parts.push(new Date(item.date_start + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }))
  }
  allBdsFields
    .map(f => item[f] ?? "")
    .filter(Boolean)
    .map(v => v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()))
    .forEach(v => parts.push(v))
  return parts.join(" / ") || "—"
}

function fmtBudget(cents?: string) {
  if (!cents) return "—"
  return `$${(parseInt(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(iso?: string) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function formatMetaDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function getInsight(item: Campaign | AdSet | Ad): Insight | null {
  return item.insights?.data?.[0] || null
}

function getMetricValue(items: { action_type: string; value: string }[] | undefined, actionType: string): number {
  if (!items?.length) return 0
  // Meta returns the same conversion under multiple action_type keys (e.g. a purchase
  // shows as omni_purchase, purchase, AND offsite_conversion.fb_pixel_purchase in the
  // same actions[] array). Summing aliases double/triple-counts. Pick the first alias
  // that exists, in priority order — that matches the Ads Manager UI count.
  const aliases = ACTION_ALIASES[actionType] || [actionType]
  for (const alias of aliases) {
    const item = items.find(entry => entry.action_type === alias)
    if (item) return parseFloat(item.value || "0") || 0
  }
  return 0
}

function getActionCount(ins: Insight | null, actionType: string): number {
  return getMetricValue(ins?.actions, actionType)
}

function getActionValueAmount(ins: Insight | null, actionType: string): number {
  return getMetricValue(ins?.action_values, actionType)
}

function formatMoneyAmount(value: number): string {
  return Number.isFinite(value) && value > 0 ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"
}

// Inline money formatter with thousands separators — used in JSX cell renders.
function fmtMoney(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "$0.00"
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function BudgetQuickEditCell({
  targetNode,
  targetLevel,
  displayMinor,
  displayType,
  canMutate,
  publishing,
  onSaveDraft,
  onPublish,
}: {
  targetNode: Campaign | AdSet
  targetLevel: "campaign" | "adset"
  displayMinor?: string
  displayType: "Daily" | "Lifetime"
  canMutate: boolean
  publishing: boolean
  onSaveDraft: (node: Campaign | AdSet, level: "campaign" | "adset", amountMajor: number) => void
  onPublish: (node: Campaign | AdSet, level: "campaign" | "adset", amountMajor: number) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const current = Number(displayMinor || 0) / 100
  const parsed = Number(amount)
  const canSave = canMutate && Number.isFinite(parsed) && parsed > 0 && !publishing

  useEffect(() => {
    if (open) setAmount(current ? current.toFixed(2) : "")
  }, [current, open])

  const save = () => {
    if (!canSave) return
    onSaveDraft(targetNode, targetLevel, parsed)
    setOpen(false)
  }

  const publish = async () => {
    if (!canSave) return
    await onPublish(targetNode, targetLevel, parsed)
    setOpen(false)
  }

  const maxDaily = Number.isFinite(parsed) ? (parsed * 1.75).toFixed(2) : "0.00"
  const maxWeekly = Number.isFinite(parsed) ? (parsed * 7).toFixed(2) : "0.00"
  const typeLabel = displayType === "Daily" ? "Daily budget" : "Lifetime budget"
  const levelLabel = targetLevel === "adset" ? "ad set" : "campaign"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="group/budget inline-flex items-start justify-end gap-1.5">
        {canMutate && (
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Edit budget"
              onClick={event => event.stopPropagation()}
              className="mt-0.5 inline-flex size-5 items-center justify-center rounded text-[#65676b] opacity-0 transition-opacity hover:bg-black/5 group-hover/row:opacity-100 focus:opacity-100"
            >
              <IconPencil className="size-3" />
            </button>
          </PopoverTrigger>
        )}
        <div>
          <span className="text-sm font-medium tabular-nums leading-5">{displayMinor ? fmtBudget(displayMinor) : "—"}</span>
          <p className="text-xs text-[#65676b]">{displayType}</p>
        </div>
      </div>
      <PopoverContent side="left" align="start" className="w-[340px] p-4 text-xs" onClick={event => event.stopPropagation()}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="font-semibold text-sm text-[#1c2b33] dark:text-white">{typeLabel}</span>
            <div className="relative flex items-center w-[110px] min-w-[110px] rounded border bg-background focus-within:ring-1 focus-within:ring-ring">
              <span className="pl-2 text-[#4b4f56] dark:text-gray-400">$</span>
              <Input
                id={`budget-${targetNode.id}`}
                value={amount}
                onChange={event => setAmount(event.target.value)}
                inputMode="decimal"
                className="h-8 w-full border-0 pl-1 pr-9 py-1 text-sm text-right shadow-none focus-visible:ring-0"
                autoFocus
              />
              <span className="absolute right-2 text-[10px] text-muted-foreground uppercase pointer-events-none">USD</span>
            </div>
          </div>

          <div className="space-y-2 text-[#65676b] dark:text-gray-400 leading-normal">
            <p>
              You are using {levelLabel} budget.
              {displayType === "Daily" ? (
                <> The maximum that you will spend on any day is <strong className="text-[#1c2b33] dark:text-white">${maxDaily}</strong> and the maximum that you will spend in a week is <strong className="text-[#1c2b33] dark:text-white">${maxWeekly}</strong>.</>
              ) : (
                <> The maximum that you will spend over the lifetime of the {levelLabel} is <strong className="text-[#1c2b33] dark:text-white">${parsed ? parsed.toFixed(2) : "0.00"}</strong>.</>
              )}
            </p>
            <button type="button" className="text-[#1877f2] hover:underline block font-medium">
              About {displayType.toLowerCase()} budget
            </button>
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground hover:underline font-semibold text-sm bg-transparent border-0 cursor-pointer"
            >
              Cancel
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                className="h-8 rounded border border-gray-300 bg-white px-3 font-semibold text-[#4b4f56] shadow-sm hover:bg-gray-50 disabled:opacity-40 text-sm cursor-pointer dark:bg-muted dark:text-gray-300 dark:border-gray-700"
              >
                Save to draft
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={!canSave}
                className="h-8 rounded bg-[#00695c] hover:bg-[#004d40] px-3 font-semibold text-white shadow-sm disabled:opacity-40 text-sm cursor-pointer"
              >
                {publishing ? <IconLoader2 className="size-3.5 animate-spin" /> : "Publish"}
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SpendHoverValue({
  row,
  spend,
  hasInsights,
  onOpenCharts,
  accountId,
  level,
  datePreset,
  since,
  until,
}: {
  row: Campaign | AdSet | Ad
  spend: number
  hasInsights: boolean
  onOpenCharts: () => void
  accountId: string
  level: Level
  datePreset: string
  since?: string
  until?: string
}) {
  const [open, setOpen] = useState(false)
  const [series, setSeries] = useState<Array<{ date: string; label: string; value: number }>>([])
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendLoaded, setTrendLoaded] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeSurface = useRef({
    triggerPointer: false,
    triggerFocus: false,
    contentPointer: false,
    contentFocus: false,
  })
  const budgetCents = Number((row as Campaign | AdSet).daily_budget || (row as Campaign | AdSet).lifetime_budget || 0)
  const budget = Number.isFinite(budgetCents) ? budgetCents / 100 : 0
  const max = Math.max(spend, budget, 1)
  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      if (!Object.values(activeSurface.current).some(Boolean)) setOpen(false)
    }, 220)
  }
  const enterTarget = (target: keyof typeof activeSurface.current) => {
    activeSurface.current[target] = true
    keepOpen()
  }
  const leaveTarget = (target: keyof typeof activeSurface.current) => {
    activeSurface.current[target] = false
    closeSoon()
  }
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      activeSurface.current = {
        triggerPointer: false,
        triggerFocus: false,
        contentPointer: false,
        contentFocus: false,
      }
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
    setOpen(nextOpen)
  }

  useEffect(() => {
    if (!open || trendLoaded || trendLoading || !accountId) return
    let cancelled = false
    const load = async () => {
      setTrendLoading(true)
      try {
        const params = new URLSearchParams({
          adAccountId: accountId,
          level,
          id: row.id,
          metric: "spend",
          granularity: "day",
        })
        if (since && until) {
          params.set("since", since)
          params.set("until", until)
        } else {
          params.set("datePreset", datePreset)
        }
        const response = await fetch(`/api/insights/report-trends?${params}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Failed to load spend trend")
        if (!cancelled) setSeries(Array.isArray(data.series) ? data.series : [])
      } catch {
        if (!cancelled) setSeries([])
      } finally {
        if (!cancelled) {
          setTrendLoaded(true)
          setTrendLoading(false)
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [accountId, datePreset, level, open, row.id, since, trendLoaded, until])

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const chartWidth = 272
  const chartHeight = 92
  const chartPad = 8
  const chartMax = Math.max(...series.map(point => point.value), 1)
  const chartPoints = series.map((point, index) => {
    const x = chartPad + (series.length <= 1 ? 0 : index * (chartWidth - chartPad * 2) / (series.length - 1))
    const y = chartHeight - chartPad - (point.value / chartMax) * (chartHeight - chartPad * 2)
    return `${x},${y}`
  }).join(" ")

  if (!hasInsights) return <span className="text-sm font-medium tabular-nums leading-5">—</span>

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div
        className="group/spend flex items-center justify-between w-full"
        onMouseEnter={() => enterTarget("triggerPointer")}
        onMouseLeave={() => leaveTarget("triggerPointer")}
        onFocusCapture={() => enterTarget("triggerFocus")}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) leaveTarget("triggerFocus")
        }}
      >
        <button
          type="button"
          aria-label="Open performance chart"
          title="Open performance chart"
          className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-background text-[#1877f2] opacity-60 transition-opacity hover:bg-muted hover:opacity-100 group-hover/spend:opacity-100"
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onOpenCharts()
          }}
        >
          <IconChartBar className="size-3.5" />
        </button>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center text-sm font-medium tabular-nums leading-5 underline decoration-dotted underline-offset-2"
          >
            {fmtMoney(spend)}
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        onMouseEnter={() => enterTarget("contentPointer")}
        onMouseLeave={() => leaveTarget("contentPointer")}
        onFocusCapture={() => enterTarget("contentFocus")}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) leaveTarget("contentFocus")
        }}
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
        className="w-80 gap-3 p-4"
      >
        <div>
          <p className="font-semibold">About your spending</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Performance for the selected reporting period and the budget configured on this item.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Amount spent</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{fmtMoney(spend)}</p>
          </div>
          <div className="border-l pl-3">
            <p className="text-xs text-muted-foreground">Budget</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{budget > 0 ? fmtMoney(budget) : "—"}</p>
            <p className="text-xs text-muted-foreground">{budget > 0 ? "Configured amount" : "Using parent budget"}</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs"><span>Amount spent</span><span>{fmtMoney(spend)}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(2, Math.min(100, (spend / max) * 100))}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs"><span>Budget</span><span>{budget > 0 ? fmtMoney(budget) : "—"}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${budget > 0 ? Math.max(2, Math.min(100, (budget / max) * 100)) : 0}%` }} />
          </div>
        </div>
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Daily spend</p>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-teal-500" />Amount spent</span>
          </div>
          {trendLoading ? (
            <div className="flex h-28 items-center justify-center"><IconLoader2 className="size-5 animate-spin text-[#1877f2]" /></div>
          ) : series.length ? (
            <div>
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-28 w-full overflow-visible" role="img" aria-label="Daily amount spent chart">
                {[0.25, 0.5, 0.75].map(ratio => (
                  <line key={ratio} x1={chartPad} x2={chartWidth - chartPad} y1={chartHeight * ratio} y2={chartHeight * ratio} className="stroke-border" strokeWidth="1" />
                ))}
                {series.length > 1 && <polyline points={chartPoints} fill="none" className="stroke-teal-500" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
                {series.map((point, index) => {
                  const [x, y] = chartPoints.split(" ")[index].split(",").map(Number)
                  return <circle key={point.date} cx={x} cy={y} r="2.5" className="fill-teal-500" />
                })}
              </svg>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{series[0]?.label}</span><span>{series[series.length - 1]?.label}</span>
              </div>
            </div>
          ) : (
            <div className="flex h-28 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">No daily spend data</div>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onOpenCharts}>Performance overview</Button>
      </PopoverContent>
    </Popover>
  )
}

// Inline percentage formatter with thousands separators for large values.
function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return "0.00%"
  return `${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

function getSpend(item: Campaign | AdSet | Ad) {
  const ins = getInsight(item)
  if (!ins?.spend) return 0
  return parseFloat(ins.spend)
}

function getResults(item: Campaign | AdSet | Ad, objective?: string) {
  const ins = getInsight(item)
  if (!ins?.actions) return { count: 0, type: "Results" }
  const obj = OBJECTIVE_RESULT[objective || ""]
  if (!obj) return { count: parseInt(ins.actions[0]?.value || "0"), type: "Actions" }
  return { count: getActionCount(ins, obj.actionType), type: obj.type }
}

// Meta-style stacked Results cell: Total count, Per Action cost, and conversion rate %.
// Video objectives report Average watch time instead of a conversion rate.
function getResultsDetail(item: Campaign | AdSet | Ad, objective?: string) {
  const ins = getInsight(item)
  if (!ins?.actions) return null
  const { count, type } = getResults(item, objective)
  const perAction = getCostPerResult(item, objective) // "$x.xx" | null
  const linkClicks = parseFloat(ins.inline_link_clicks || "0")
  const rate = count > 0 && linkClicks > 0 ? (count / linkClicks) * 100 : null
  // Avg watch time (seconds) for video-style objectives
  const avgWatchRaw = ins.video_avg_time_watched_actions?.find(a => a.action_type === "video_view")?.value
    ?? ins.video_avg_time_watched_actions?.[0]?.value
  const avgWatch = avgWatchRaw ? parseFloat(avgWatchRaw) : null
  return { count, type, perAction, rate, avgWatch }
}

function fmtWatch(sec: number): string {
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

function getCostPerResult(item: Campaign | AdSet | Ad, objective?: string) {
  const ins = getInsight(item)
  const spend = getSpend(item)
  const obj = OBJECTIVE_RESULT[objective || ""]
  if (!obj) return null
  const cpa = ins?.cost_per_action_type?.find(a => (ACTION_ALIASES[obj.actionType] || [obj.actionType]).includes(a.action_type))
  if (!cpa) {
    const count = getActionCount(ins, obj.actionType)
    return count > 0 ? fmtMoney((spend / count)) : null
  }
  const value = parseFloat(cpa.value)
  if (Number.isFinite(value)) return fmtMoney(value)
  const count = getActionCount(ins, obj.actionType)
  return count > 0 ? fmtMoney((spend / count)) : null
}

// ─── Status Toggle ────────────────────────────────────────────────────────────

function StatusToggle({ id, status, onToggle }: { id: string; status: string; onToggle: (id: string, newStatus: string) => void }) {
  const isActive = status === "ACTIVE"
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(id, isActive ? "PAUSED" : "ACTIVE") }}
      className={cn(
        "relative inline-flex h-4 w-[30px] items-center rounded-full transition-colors shrink-0",
        isActive ? "bg-[#1877f2]" : "bg-[#bec3c9] dark:bg-gray-600"
      )}
      title={isActive ? "Click to pause" : "Click to activate"}
    >
      <span className={cn(
        "inline-block size-[14px] rounded-full bg-white shadow-sm transition-transform",
        isActive ? "translate-x-[14px]" : "translate-x-px"
      )} />
    </button>
  )
}

// ─── Delivery Badge ───────────────────────────────────────────────────────────

// Meta attribution_spec entries — single-click entries carry event_type+window_days.
const CLICK_WINDOW_LABEL: Record<number, string> = { 1: "1-day click", 7: "7-day click", 28: "28-day click" }
function formatAttributionSpec(spec: AttributionSpecEntry[] | string | undefined | null): string {
  if (!spec) return "7-day click or 1-day view" // Facebook's default for missing/empty
  if (typeof spec === "string") {
    const s = spec.trim()
    if (!s) return "7-day click or 1-day view"
    if (s.toLowerCase().includes("incremental")) return "Incremental attribution"
    return s
  }
  if (!Array.isArray(spec) || !spec.length) return "7-day click or 1-day view"

  // If there are exactly two entries for CLICK and VIEW, we combine them with "or"
  const clickEntry = spec.find(e => (e.event_type || "").toLowerCase().includes("click"))
  const viewEntry = spec.find(e => (e.event_type || "").toLowerCase().includes("view"))
  const evEntry = spec.find(e => (e.event_type || "").toLowerCase().includes("engag"))

  if (clickEntry && viewEntry && !evEntry && spec.length === 2) {
    const clickW = clickEntry.window_days || 7
    const viewW = viewEntry.window_days || 1
    return `${clickW}-day click or ${viewW}-day view`
  }

  if (clickEntry && viewEntry && evEntry && spec.length === 3) {
    const clickW = clickEntry.window_days || 7
    const viewW = viewEntry.window_days || 1
    return `${clickW}-day click or ${viewW}-day view (engaged view)`
  }

  const parts = spec.map(e => {
    const etRaw = (e.event_type || "").toLowerCase()
    const et = etRaw.includes("increment") ? "incremental"
      : etRaw.includes("click") ? "click"
      : etRaw.includes("view") ? "view"
      : etRaw.includes("engag") ? "engagement"
      : etRaw
    const w = e.window_days
    if (et === "incremental") return "Incremental attribution"
    if (et === "click") return (w != null ? CLICK_WINDOW_LABEL[w] : undefined) ?? `${w ?? 0}-day click`
    if (et === "view") return `${w ?? 1}-day view`
    if (et === "engagement") return `${w ?? 1}-day engagement`
    return `${w ? `${w}-day ` : ""}${et}`
  }).filter(Boolean)
  return parts.length ? Array.from(new Set(parts)).join(" or ") : "7-day click or 1-day view"
}

function formatBidStrategy(raw: string | null | undefined): string {
  if (!raw) return "—"
  return raw.replace(/_/g, " ").toLowerCase()
}

function DeliveryBadge({ effective_status, learning, allAdsOff }: { effective_status: string; budget_remaining?: string; learning?: LearningStageInfo; allAdsOff?: boolean }) {
  const status = effective_status || "UNKNOWN"
  const normalizedStatus = status.toUpperCase()
  const learnStatus = normalizedStatus === "ACTIVE" && !allAdsOff ? learning?.status : undefined
  const isLearning = learnStatus === "LEARNING"
  const isLearningLimited = learnStatus === "LEARNING_LIMITED"
  const titleCase = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  const label = isLearning || isLearningLimited ? titleCase(learnStatus!) : titleCase(status)
  const dot = isLearning
    ? "bg-[#1877f2]"
    : isLearningLimited || normalizedStatus === "PENDING_REVIEW" || normalizedStatus === "IN_PROCESS"
      ? "bg-[#f59e0b]"
      : normalizedStatus === "ACTIVE" && !allAdsOff
        ? "bg-[#31a24c]"
        : normalizedStatus === "DISAPPROVED" || normalizedStatus === "WITH_ISSUES" || normalizedStatus === "PENDING_BILLING_INFO"
          ? "bg-[#e41e3f]"
          : "bg-[#8a8d91]"
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-[#1c2b33] dark:text-gray-300">
      <span className={cn("size-[7px] rounded-full shrink-0", dot)} />
      {label}
    </span>
  )
}

// ─── Sort Header ──────────────────────────────────────────────────────────────

/**
 * The three frozen columns — checkbox, Off/On, name.
 *
 * Two things were wrong here. The body pinned these columns but the header did not pin
 * anything (only `thead` was `sticky top-0`), so any horizontal scroll slid the header labels
 * out from over the columns they name and left blank gaps above the frozen cells. And the
 * offsets did not add up: column 1 is `w-10` (40px) and column 2 is `w-16` (64px), so column 3
 * has to pin at 104px. It pinned at 100px and overlapped column 2 by 4px.
 *
 * Defining the offsets once means header and body cannot drift apart again, and the arithmetic
 * lives next to the widths it is derived from. If a width changes, the offset below it must
 * change with it — that is the whole invariant, asserted in
 * tests/table-spacing-contract.test.mjs.
 */
const FROZEN_W = { check: "w-10", toggle: "w-16" } as const   // 40px, 64px
const FROZEN_LEFT = {
  check: "left-0",
  toggle: "left-10",        // 40
  name: "left-[104px]",     // 40 + 64
} as const
/**
 * Frozen cells must be opaque. Every dark-mode background here was written with an alpha
 * channel, which is invisible while nothing is pinned and shows the scrolling columns straight
 * through the frozen ones the moment something is. The replacements are the same colours
 * flattened, not new ones:
 *   · thead      bg-muted/80  → bg-muted
 *   · group band bg-muted/10  → bg-background  (#1b1d23 at 10% over #1f2127 = #1e2027; the tint
 *                               was already below the perceptual threshold in dark mode)
 *   · selected   bg-blue-950/30 → #1d2235      (#172554 at 30% over #1f2127, computed)
 */
const FROZEN_HEAD_BG = "bg-[#f5f6f7] dark:bg-muted"
const ROW_BG = {
  even: "bg-white dark:bg-background",
  odd: "bg-[#f7f8fa] dark:bg-[#1b1d23]",
} as const
const rowBg = (i: number) => (i % 2 === 0 ? ROW_BG.even : ROW_BG.odd)
/**
 * Row background for the two "this row is not like the others" states: amber = just published in this
 * session, emerald = has unpublished bulk edits. Amber wins, because it expires on its own and the
 * user is looking for it right now. Selection still beats both and is applied by the caller.
 *
 * Three class sets because the frozen columns are sticky and paint over the <tr> background: `row`
 * for the <tr>, `cell` for each frozen <td>, `hover` for the frozen cells' group-hover state.
 */
function rowTint(isNew: boolean, hasDraft: boolean) {
  if (isNew) return {
    tinted: true,
    tintRow: "bg-amber-50/80 dark:bg-amber-950/20 hover:bg-amber-50/80 dark:hover:bg-amber-950/20",
    tintCell: "bg-amber-50 dark:bg-amber-950/30",
    tintHover: "group-hover/row:bg-amber-50 dark:group-hover/row:bg-amber-950/30",
  }
  return {
    tinted: hasDraft,
    tintRow: "bg-emerald-50/80 dark:bg-emerald-950/20 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/20",
    tintCell: "bg-emerald-50 dark:bg-emerald-950/30",
    tintHover: "group-hover/row:bg-emerald-50 dark:group-hover/row:bg-emerald-950/30",
  }
}
const FROZEN_BODY_SEL = "bg-[#e3f0fe] dark:bg-[#1d2235]"
const FROZEN_BAND_BG = "bg-[#f5f6f7] dark:bg-background"
/**
 * A border on a sticky cell goes hairline-thin or vanishes at odd horizontal scroll offsets
 * (subpixel rounding leaves a gap between adjacent <td> borders). box-shadow paints on the
 * cell's own layer regardless of scroll position, so the frozen-pane edge reads as one solid
 * line from header through every body row to the footer, not a border that flickers while
 * scrolling.
 */
const FROZEN_DIVIDER = "border-r border-[#d4d8e0] dark:border-[#3f4654]"
const FOOTER_CELL_SHADOW = "border-t border-[#d4d8e0] dark:border-[#3f4654]"
const FOOTER_STICKY_SHADOW = "border-t border-r border-[#d4d8e0] dark:border-[#3f4654]"
const FOOTER_BG = "bg-[#f7f8fa] dark:bg-[#1b1d23]"

function SortTh({ label, field, sortField, sortDir, onSort, width, onResize, className }: {
  label: string; field: string; sortField: string | null; sortDir: SortDir
  onSort: (f: string) => void; width?: number; onResize?: (w: number) => void; className?: string
}) {
  const active = sortField === field
  const handleDrag = (e: React.MouseEvent) => {
    if (!onResize || !width) return
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (me: MouseEvent) => onResize(Math.max(60, startW + me.clientX - startX))
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return (
    <th
      style={{ width: width ? `${width}px` : undefined, minWidth: width ? `${width}px` : undefined, maxWidth: width ? `${width}px` : undefined }}
      className={cn("relative px-3 text-left text-xs font-bold text-[#1c2b33] dark:text-foreground cursor-pointer select-none whitespace-nowrap hover:bg-black/5 dark:hover:bg-white/5", className)}
      onClick={() => onSort(field)}
    >
      <span className="flex items-center gap-1 overflow-hidden">
        <span className="truncate">{label}</span>
        {active
          ? (sortDir === "asc" ? <IconArrowUp className="size-3 shrink-0 text-[#1877f2]" /> : <IconArrowDown className="size-3 shrink-0 text-[#1877f2]" />)
          : <IconArrowsUpDown className="size-3 shrink-0 opacity-0 group-hover:opacity-50" />
        }
      </span>
      {onResize && (
        <div
          onMouseDown={handleDrag}
          onClick={e => e.stopPropagation()}
          className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 opacity-0 hover:opacity-100 transition-opacity"
        />
      )}
    </th>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// Per-column header context menu: sort + column management actions (Meta-style).
function HeaderCellMenu({ colId, label, onSortAsc, onSortDesc, onMoveLeft, onMoveRight, onRemove, canMoveLeft, canMoveRight, onOpenAttributionCompare }: {
  colId: string
  label: string
  onSortAsc: () => void
  onSortDesc: () => void
  onMoveLeft: () => void
  onMoveRight: () => void
  onRemove: () => void
  canMoveLeft: boolean
  canMoveRight: boolean
  onOpenAttributionCompare?: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])
  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
        title="Column options"
      >
        <IconChevronDown className="size-3 opacity-50" />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-50 w-56 bg-background border rounded-lg shadow-xl py-1 text-xs">
          <button onClick={() => { onSortAsc(); setOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-muted/50 flex items-center gap-2">
            <IconArrowUp className="size-3.5" /> Sort ascending
          </button>
          <button onClick={() => { onSortDesc(); setOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-muted/50 flex items-center gap-2">
            <IconArrowDown className="size-3.5" /> Sort descending
          </button>
          <div className="my-1 border-t" />
          <button onClick={() => { onMoveLeft(); setOpen(false) }} disabled={!canMoveLeft} className="w-full text-left px-3 py-1.5 hover:bg-muted/50 disabled:opacity-40 flex items-center gap-2">
            <IconChevronLeft className="size-3.5" /> Move left
          </button>
          <button onClick={() => { onMoveRight(); setOpen(false) }} disabled={!canMoveRight} className="w-full text-left px-3 py-1.5 hover:bg-muted/50 disabled:opacity-40 flex items-center gap-2">
            <IconChevronRight className="size-3.5" /> Move right
          </button>
          <button onClick={() => { onRemove(); setOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-muted/50 text-destructive flex items-center gap-2">
            <IconX className="size-3.5" /> Remove column
          </button>

          {colId === "attribution_setting" && onOpenAttributionCompare && (
            <>
              <div className="my-1 border-t" />
              <button
                onClick={() => { onOpenAttributionCompare(); setOpen(false) }}
                className="w-full text-left px-3 py-1.5 hover:bg-muted/50 flex items-center gap-2"
              >
                <IconAdjustments className="size-3.5" /> Compare attribution settings
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function AdsManagerContent() {
  const { selectedAccountId, selectedAccount } = useAdAccount()

  const [tab, setTab] = useState<Tab>("campaigns")
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [adSets, setAdSets] = useState<AdSet[]>([])
  const [ads, setAds] = useState<Ad[]>([])
  const [adSetHasActiveAds, setAdSetHasActiveAds] = useState<Record<string, boolean>>({})
  const fetchedAdsetAdsRef = useRef<Set<string>>(new Set())
  const [accountSummary, setAccountSummary] = useState<Insight | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadedMs, setLoadedMs] = useState<number | null>(null)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [error, setError] = useState("")

  // Filters & search
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "ACTIVE" | "PAUSED">("ACTIVE")
  /**
   * Filter chips, AND-ed with each other and with `search` / `statusFilter`.
   * One array across all three tabs on purpose: a chip that does not apply at the
   * current level is greyed rather than dropped, so switching Campaigns → Ads and
   * back does not silently lose the filter (spec D7).
   */
  const [chips, setChips] = useState<FilterChip[]>([])

  // Hierarchical filter: checked campaigns → filters adsets; checked adsets → filters ads
  const [campaignFilter, setCampaignFilter] = useState<Set<string>>(new Set())
  const [adSetFilter, setAdSetFilter] = useState<Set<string>>(new Set())
  const campaignParentIds = useMemo(() => Array.from(campaignFilter).sort(), [campaignFilter])
  const adSetParentIds = useMemo(() => Array.from(adSetFilter).sort(), [adSetFilter])
  const selectedRowsChip = chips.find(c => c.field === SELECTED_ROWS_FIELD)
  const selectedRowsSnapshotIds = useMemo(() => (selectedRowsChip?.snapshotIds ?? []).slice().sort(), [selectedRowsChip])
  const hierarchyParentType = tab === "adsets"
    ? "campaign"
    : tab === "ads" && selectedRowsChip?.snapshotLevel === "adsets" && selectedRowsSnapshotIds.length > 0
      ? "adset"
      : tab === "ads" && selectedRowsChip?.snapshotLevel === "campaigns" && selectedRowsSnapshotIds.length > 0
        ? "campaign"
        : tab === "ads" && adSetParentIds.length
          ? "adset"
          : tab === "ads" && campaignParentIds.length
            ? "campaign"
            : null
  const hierarchyParentIds = useMemo(() => {
    if (hierarchyParentType === "adset") {
      return selectedRowsChip?.snapshotLevel === "adsets" && selectedRowsSnapshotIds.length > 0 ? selectedRowsSnapshotIds : adSetParentIds
    }
    if (hierarchyParentType === "campaign") {
      return selectedRowsChip?.snapshotLevel === "campaigns" && selectedRowsSnapshotIds.length > 0 ? selectedRowsSnapshotIds : campaignParentIds
    }
    return []
  }, [adSetParentIds, campaignParentIds, hierarchyParentType, selectedRowsChip?.snapshotLevel, selectedRowsSnapshotIds])
  const hierarchyParentId = hierarchyParentIds.length === 1 ? hierarchyParentIds[0] : null
  const hierarchyCacheKey = tab === "adsets"
    ? `campaign:${hierarchyParentIds.join(",") || "all"}`
    : tab === "ads"
      ? `${hierarchyParentType || "all"}:${hierarchyParentIds.join(",") || "all"}`
      : "all"
  const [datePreset,     setDatePreset]     = useState("last_7d")
  const [customDateRange, setCustomDateRange] = useState<{ start: Date; end: Date } | null>(null)

  // Pagination
  const [page, setPage] = useState(1)
  const [pageCursors, setPageCursors] = useState<Record<Tab, Array<string | undefined>>>({
    campaigns: [undefined],
    adsets: [undefined],
    ads: [undefined],
  })
  const pageCursorsRef = useRef(pageCursors)
  const [paging, setPaging] = useState<{ after?: string; hasNext: boolean }>({ hasNext: false })
  /** Sorting and the filter bar can both request a drain; only one may run. */
  const drainingRef = useRef(false)
  const [drainTruncated, setDrainTruncated] = useState(false)
  useEffect(() => { pageCursorsRef.current = pageCursors }, [pageCursors])
  const colsDropRef = useRef<HTMLDivElement>(null)

  // Sort
  /** `sortField === null` is the third sort state: the table's default newest-first order. */
  const [sortField, setSortField] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [filtersHydratedAccount, setFiltersHydratedAccount] = useState("")

  // Selection — kept per tab so switching tabs or drilling down/back doesn't drop it.
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set())
  const [selectedAdSetIds, setSelectedAdSetIds] = useState<Set<string>>(new Set())
  const [selectedAdIds, setSelectedAdIds] = useState<Set<string>>(new Set())
  const selectedIdsByTab: Record<Tab, Set<string>> = { campaigns: selectedCampaignIds, adsets: selectedAdSetIds, ads: selectedAdIds }
  const setSelectedIdsByTab: Record<Tab, React.Dispatch<React.SetStateAction<Set<string>>>> = { campaigns: setSelectedCampaignIds, adsets: setSelectedAdSetIds, ads: setSelectedAdIds }
  const selectedIds = selectedIdsByTab[tab]
  const setSelectedIds = setSelectedIdsByTab[tab]

  /**
   * Shift-range anchor, per tab. Stored as an **id, not an index** — a filter or a
   * sort change renumbers every row, so an index anchor would silently select a
   * different range than the one the user pointed at.
   */
  const [anchorIdByTab, setAnchorIdByTab] = useState<Record<Tab, string | null>>({ campaigns: null, adsets: null, ads: null })

  // Account-scoped bulk edit drafts. V1 persists within the current browser tab,
  // which keeps drafts across dialog closes/navigation without leaking them across accounts.
  const [bulkDraftsByAccount, setBulkDraftsByAccount] = useState<Record<string, BulkDraftMap>>({})
  const loadedBulkDraftAccounts = useRef(new Set<string>())
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false)
  const [bulkEditorField, setBulkEditorField] = useState<BulkDraftField>("name")
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)
  const [bulkStatusField, setBulkStatusField] = useState<"turn_on" | "turn_off">("turn_on")
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false)
  const [bulkReviewInitialKeys, setBulkReviewInitialKeys] = useState<string[] | undefined>()
  const [bulkPublishing, setBulkPublishing] = useState(false)
  const [bulkPublishResults, setBulkPublishResults] = useState<BulkPublishResult[]>([])
  const [bulkDiscardConfirmOpen, setBulkDiscardConfirmOpen] = useState(false)

  // Smooth ease-out progress: jump to 2% on load start, glide toward 90% while
  // Meta responds, then the caller snaps to 100% on completion. No indeterminate
  // sweep — that animated bar visibly looped while waiting and felt jittery.
  useEffect(() => {
    if (!loading) return
    setLoadingProgress(0)
    const timer = window.setInterval(() => {
      setLoadingProgress(current => {
        if (current >= 90) return current
        // Slow linear climb to 90% then hold: never rush past it while Meta works.
        const step = current < 45 ? 2 : 1
        return Math.min(90, current + step)
      })
    }, 90)
    return () => window.clearInterval(timer)
  }, [loading])

  const bulkDrafts = useMemo(
    () => selectedAccountId ? (bulkDraftsByAccount[selectedAccountId] || {}) : {},
    [bulkDraftsByAccount, selectedAccountId],
  )
  const bulkDraftCount = Object.keys(bulkDrafts).length

  useEffect(() => {
    if (!selectedAccountId || loadedBulkDraftAccounts.current.has(selectedAccountId)) return
    loadedBulkDraftAccounts.current.add(selectedAccountId)
    const stored = typeof window === "undefined"
      ? {}
      : parseBulkDrafts(window.sessionStorage.getItem(bulkDraftStorageKey(selectedAccountId)))
    setBulkDraftsByAccount(current => ({ ...current, [selectedAccountId]: stored }))
  }, [selectedAccountId])

  const replaceBulkDrafts = useCallback((next: BulkDraftMap) => {
    if (!selectedAccountId) return
    setBulkDraftsByAccount(current => ({ ...current, [selectedAccountId]: next }))
    if (typeof window !== "undefined") {
      const key = bulkDraftStorageKey(selectedAccountId)
      if (Object.keys(next).length) window.sessionStorage.setItem(key, serializeBulkDrafts(next))
      else window.sessionStorage.removeItem(key)
    }
  }, [selectedAccountId])

  // Toggling status
  const [toggling, setToggling] = useState<Set<string>>(new Set())

  // Close dropdowns on outside click
  const [editingNode, setEditingNode] = useState<Campaign | AdSet | Ad | null>(null)
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null)
  const [inlineEditingName, setInlineEditingName] = useState("")
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false)
  const [duplicateCount, setDuplicateCount] = useState(1)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [duplicateName, setDuplicateName] = useState("")
  const [duplicateDestination, setDuplicateDestination] = useState<"original" | "existing" | "new">("original")
  const [duplicateTargetId, setDuplicateTargetId] = useState("")
  const [duplicateAdSetOptions, setDuplicateAdSetOptions] = useState<AdSet[]>([])
  const [duplicateAdSetOptionsAccountId, setDuplicateAdSetOptionsAccountId] = useState("")
  const [duplicateAdSetOptionsLoading, setDuplicateAdSetOptionsLoading] = useState(false)
  const [duplicateAdSetOptionsError, setDuplicateAdSetOptionsError] = useState("")
  const [duplicateAdSetPickerOpen, setDuplicateAdSetPickerOpen] = useState(false)
  const [duplicateAdSetSearch, setDuplicateAdSetSearch] = useState("")
  const [duplicateNewName, setDuplicateNewName] = useState("")
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false)
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null)
  const [actionToast, setActionToast] = useState<{ kind: "success" | "error"; message: string; href?: string } | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [miniStatusPopup, setMiniStatusPopup] = useState<{ title: string; total: number; items: PopupItem[] } | null>(null)
  /** "all" = everything selected, including rows a filter is hiding. Never auto-narrowed. */
  const [deleteScope, setDeleteScope] = useState<"all" | "visible">("all")
  const [deleteListExpanded, setDeleteListExpanded] = useState(false)
  const [deleteTypedConfirm, setDeleteTypedConfirm] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyBatches, setHistoryBatches] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [defaultPrimaryText, setDefaultPrimaryText] = useState("")
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createInitialState, setCreateInitialState] = useState<Partial<CampaignFormState> | undefined>()
  // Rows this session just published. The refetch after a publish drops the new objects into a list
  // that can be hundreds long and sorted by spend, where a brand-new PAUSED object sinks to the
  // bottom — so the toast says "published" and the table shows no visible change. Holding the ids
  // for a few seconds is what turns "it worked" into "there it is".
  const [justPublishedIds, setJustPublishedIds] = useState<Set<string>>(new Set())
  const justPublishedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (justPublishedTimer.current) clearTimeout(justPublishedTimer.current) }, [])
  const [defaultHeadline, setDefaultHeadline] = useState("")
  const [defaultCta, setDefaultCta] = useState("SHOP_NOW")
  const [defaultLink, setDefaultLink] = useState("")
  const [columnOrder,       setColumnOrder]       = useState<string[]>(DEFAULT_PRESETS[4].columns)
  const [columnWidths,      setColumnWidths]      = useState<Record<string, number>>({})
  const [customPresets,     setCustomPresets]     = useState<ColumnPreset[]>([])
  const [customMetrics,     setCustomMetrics]     = useState<CustomMetricConfig[]>([])
  const [colsOpen,          setColsOpen]          = useState(false)
  const [customizeColsOpen, setCustomizeColsOpen] = useState(false)
  const [attributionWindows, setAttributionWindows] = useState<string[]>([])
  const [attributionCompareOpen, setAttributionCompareOpen] = useState(false)
  const [draftAttribution, setDraftAttribution] = useState<string[]>([])
  const [breakdowns,        setBreakdowns]        = useState<string[]>([])
  const [breakdownRows,     setBreakdownRows]     = useState<BreakdownRow[]>([])
  const [breakdownError,    setBreakdownError]    = useState("")

  useEffect(() => {
    setDuplicateTargetId("")
    setDuplicateAdSetOptions([])
    setDuplicateAdSetOptionsAccountId("")
    setDuplicateAdSetOptionsError("")
    setDuplicateAdSetPickerOpen(false)
    setDuplicateAdSetSearch("")
    if (!selectedAccountId) {
      setFiltersHydratedAccount("")
      return
    }
    const stored = loadAdsManagerFilterState(selectedAccountId)
    setTab(stored?.tab ?? "campaigns")
    setSearch(stored?.search ?? "")
    setStatusFilter(stored?.statusFilter ?? "ACTIVE")
    setChips(stored?.chips ?? [])
    setCampaignFilter(new Set(stored?.campaignFilter ?? []))
    setAdSetFilter(new Set(stored?.adSetFilter ?? []))
    setDatePreset(stored?.datePreset ?? "last_7d")
    setCustomDateRange(stored?.customDateRange ? { start: new Date(stored.customDateRange.start), end: new Date(stored.customDateRange.end) } : null)
    setSortField(stored?.sortField ?? null)
    setSortDir(stored?.sortDir ?? "asc")
    setBreakdowns(stored?.breakdowns ?? [])
    setPage(1)
    setPageCursors({ campaigns: [undefined], adsets: [undefined], ads: [undefined] })
    setFiltersHydratedAccount(selectedAccountId)
  }, [selectedAccountId])

  useEffect(() => {
    if (!selectedAccountId || filtersHydratedAccount !== selectedAccountId) return
    saveAdsManagerFilterState(selectedAccountId, {
      tab,
      search,
      statusFilter,
      chips,
      campaignFilter: Array.from(campaignFilter),
      adSetFilter: Array.from(adSetFilter),
      datePreset,
      customDateRange: customDateRange ? { start: customDateRange.start.toISOString(), end: customDateRange.end.toISOString() } : null,
      sortField,
      sortDir,
      breakdowns,
    })
  }, [selectedAccountId, filtersHydratedAccount, tab, search, statusFilter, chips, campaignFilter, adSetFilter, datePreset, customDateRange, sortField, sortDir, breakdowns])

  const [performancePopup, setPerformancePopup] = useState<{
    mode: "charts" | "compare"
    rows: ReportRow[]
    initialView?: "charts" | "edit" | "review" | "history"
  } | null>(null)
  const [workspaceAccess, setWorkspaceAccess] = useState({
    loaded: false,
    enabled: false,
    canMutate: false,
    role: "",
  })

  // Launch → Ads Manager connection: ?batch=<id> prefilters ads to that launch's created ads.
  const searchParams = useSearchParams()
  const batchParam = searchParams.get("batch")
  const [launchAdIds, setLaunchAdIds] = useState<Set<string> | null>(null)
  const [launchLabel, setLaunchLabel] = useState<string | null>(null)
  const activeLaunchFilter = !!batchParam && tab === "ads" && launchAdIds && launchAdIds.size > 0

  useEffect(() => {
    if (!batchParam) return
    let cancelled = false
    fetch(`/api/launch-history?id=${encodeURIComponent(batchParam)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        const batch = d.batches?.[0]
        if (!batch) return
        const ids: string[] = Array.isArray(batch.created_ads)
          ? batch.created_ads.map((a: any) => typeof a === "string" ? a : (a?.adId || a?.id)).filter(Boolean)
          : []
        setLaunchAdIds(new Set(ids))
        setLaunchLabel(batch.name || batch.id?.slice(0, 8) || "launch")
        setTab("ads")
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [batchParam])

  const router = useRouter()
  const level: Level = tab === "campaigns" ? "campaign" : tab === "adsets" ? "adset" : "ad"
  useEffect(() => {
    setDuplicateDestination("original")
    setDuplicateTargetId("")
    setDuplicateName("")
    setDuplicateNewName("")
    setDuplicateAdSetPickerOpen(false)
    setDuplicateAdSetSearch("")
  }, [tab])
  useEffect(() => {
    if (!duplicateDialogOpen || tab !== "ads" || duplicateDestination !== "existing" || !selectedAccountId) return
    if (duplicateAdSetOptionsAccountId === selectedAccountId) return

    const controller = new AbortController()
    setDuplicateAdSetOptionsLoading(true)
    setDuplicateAdSetOptionsError("")

    // ponytail: reuse the cached full ad-set read; add a lightweight picker route if very large accounts make this slow.
    fetch(`/api/facebook/adsets?ad_account_id=${encodeURIComponent(selectedAccountId)}&date_preset=last_7d`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || "Failed to load ad sets")
        setDuplicateAdSetOptions(data.adSets || [])
        setDuplicateAdSetOptionsAccountId(selectedAccountId)
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setDuplicateAdSetOptionsError(error instanceof Error ? error.message : "Failed to load ad sets")
      })
      .finally(() => {
        if (!controller.signal.aborted) setDuplicateAdSetOptionsLoading(false)
      })

    return () => controller.abort()
  }, [duplicateAdSetOptionsAccountId, duplicateDestination, duplicateDialogOpen, selectedAccountId, tab])
  const usesCustomRange = (datePreset === "custom" || datePreset === "maximum") && customDateRange
  const drawerSince = usesCustomRange ? formatMetaDate(customDateRange.start) : ""
  const drawerUntil = usesCustomRange ? formatMetaDate(customDateRange.end) : ""
  /**
   * Human name for the active range. A metric chip means "in this range" and its own
   * text never says so — change the preset and the same chip matches different rows.
   * Meta behaves the same way; naming the range in the chip tooltip is what keeps it
   * from reading as a bug.
   */
  const dateRangeLabel = usesCustomRange
    ? `${formatMetaDate(customDateRange.start)} – ${formatMetaDate(customDateRange.end)}`
    : DATE_PICKER_PRESETS.find(p => p.value === datePreset)?.label ?? datePreset.replace(/_/g, " ")
  const toReportRow = (node: { id: string; name: string }): ReportRow =>
    ({ id: node.id, name: node.name, adId: tab === "ads" ? node.id : undefined })
  const customColumnMap = useMemo(() => ({ ...COLUMN_MAP, ...Object.fromEntries(customMetrics.map(m => [m.id, toColumnDef(m)])) }), [customMetrics])
  const customMetricById = useMemo(() => new Map(customMetrics.map(m => [m.id, m])), [customMetrics])
  const getColWidth = (id: string) => {
    if (columnWidths[id]) return columnWidths[id]
    if (id === "results") return 120
    if (id === "cost_per_result") return 140
    if (id === "spend") return 120
    if (id === "budget") return 125
    if (id === "delivery") return 100
    const label = customColumnMap[id]?.headerLabel || ""
    return label.length > 34 ? 160 : label.length > 20 ? 135 : 112
  }
  const isTextCol = (id: string) => [
    "delivery", "effective_status", "attribution_setting",
    "schedule_start", "schedule_end", "bid_strategy", "boosted_object_id", "buying_type",
    "objective", "smart_promotion_type", "special_ad_category", "account_id", "date_created",
    "issues_info", "optimization_goal", "updated_time",
  ].includes(id)
  const setColWidth = (id: string, width: number) => setColumnWidths(prev => ({ ...prev, [id]: width }))
  const startColResize = (id: string, startWidth: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const onMove = (me: MouseEvent) => setColWidth(id, Math.max(60, startWidth + me.clientX - startX))
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  // Open the big Meta-style popup. Compare uses the multi-selection when the clicked
  // row is part of it; otherwise falls back to just the clicked row.
  const openCompare = (clicked: { id: string; name: string }) => {
    const rowsById = new Map(currentData.map(r => [r.id, r as { id: string; name: string }]))
    const many = selectedIds.size > 1 && selectedIds.has(clicked.id)
    const rows = many
      ? Array.from(selectedIds).map(id => rowsById.get(id)).filter(Boolean).map(n => toReportRow(n as any))
      : [toReportRow(clicked)]
    setPerformancePopup({ mode: "compare", rows })
  }
  const openCharts = (clicked: { id: string; name: string }) =>
    setPerformancePopup({ mode: "charts", rows: [toReportRow(clicked)], initialView: "charts" })
  // The editor is a route, not a popup: /ads-manager/editor is intercepted by the @editor slot so
  // this table stays mounted underneath and Collapse view has something to reveal. Both the row
  // click and the post-publish handoff build the same URL, so the semantics live in one place.
  const pushWorkspaceEditor = (target: {
    level: Level
    id: string
    campaignId?: string
    adSetId?: string
  }) => {
    const editorParams = new URLSearchParams({
      account: selectedAccountId,
      level: target.level,
      id: target.id,
      view: "edit",
      date: datePreset,
    })
    if (target.campaignId) editorParams.set("campaign", target.campaignId)
    if (target.adSetId) editorParams.set("adset", target.adSetId)
    router.push(`/ads-manager/editor?${editorParams.toString()}`)
  }

  const openWorkspaceEditor = (clicked: { id: string; name: string }) => {
    if (workspaceAccess.enabled) {
      const editorLevel: Level = tab === "campaigns" ? "campaign" : tab === "adsets" ? "adset" : "ad"
      const source: any =
        campaigns.find(item => item.id === clicked.id)
        || adSets.find(item => item.id === clicked.id)
        || ads.find(item => item.id === clicked.id)
        || {}
      pushWorkspaceEditor({
        level: editorLevel,
        id: clicked.id,
        campaignId: source.campaign_id,
        adSetId: source.adset_id,
      })
      return
    }
    const node = campaigns.find(item => item.id === clicked.id)
      || adSets.find(item => item.id === clicked.id)
      || ads.find(item => item.id === clicked.id)
      || null
    setEditingNode(node)
  }

  const openReplacementCreate = (node: WorkspaceNode, nodeLevel: Level) => {
    const campaign = campaigns.find(item => item.id === (nodeLevel === "campaign" ? node.id : node.campaign_id))
    const targeting = node.targeting
    const gender = targeting?.genders?.includes(1) && !targeting.genders.includes(2)
      ? "MALE"
      : targeting?.genders?.includes(2) && !targeting.genders.includes(1)
        ? "FEMALE"
        : "ALL"
    const objective = (node.objective || campaign?.objective || "OUTCOME_SALES") as CampaignObjective
    const performanceGoal = (node.optimization_goal || "OFFSITE_CONVERSIONS") as PerformanceGoal
    const specialAdCategories = (
      node.special_ad_categories
      || campaign?.special_ad_categories
      || []
    ) as SpecialAdCategory[]
    const dailyBudget = node.daily_budget && Number.isFinite(Number(node.daily_budget))
      ? String(Number(node.daily_budget) / 100)
      : undefined
    const campaignBudget = campaign?.daily_budget && Number.isFinite(Number(campaign.daily_budget))
      ? String(Number(campaign.daily_budget) / 100)
      : undefined

    setCreateInitialState({
      campaignName: `${campaign?.name || node.name} — replacement`,
      objective,
      specialAdCategories,
      advantageCampaignBudget: Boolean(campaign?.daily_budget || campaign?.lifetime_budget),
      campaignBudget,
      adSetName: nodeLevel === "adset" ? `${node.name} — replacement` : "New Ad Set",
      conversionLocation: "website",
      performanceGoal,
      pixelId: node.promoted_object?.pixel_id || "",
      conversionEvent: (node.promoted_object?.custom_event_type || "PURCHASE") as CampaignFormState["conversionEvent"],
      dailyBudget,
      scheduleStart: node.start_time?.slice(0, 16) || "",
      scheduleEnd: (node.end_time || node.stop_time)?.slice(0, 16) || "",
      locations: targeting?.geo_locations?.countries || ["US"],
      ageMin: targeting?.age_min || 18,
      ageMax: targeting?.age_max || 65,
      gender,
      customAudiences: targeting?.custom_audiences || [],
      excludedCustomAudiences: targeting?.excluded_custom_audiences || [],
      placementMode: targeting?.publisher_platforms?.length ? "manual" : "advantage",
      publisherPlatforms: (targeting?.publisher_platforms || ["facebook", "instagram", "audience_network", "messenger"]) as CampaignFormState["publisherPlatforms"],
    })
    setPerformancePopup(null)
    setCreateModalOpen(true)
  }

  const DEFAULTS_KEY = `adsmanager_defaults_${selectedAccountId}`

  useEffect(() => {
    let cancelled = false
    fetch("/api/ads-manager/workspace-access")
      .then(response => response.ok ? response.json() : Promise.reject(new Error("Access check failed")))
      .then(data => {
        if (cancelled) return
        setWorkspaceAccess({
          loaded: true,
          enabled: data.enabled === true,
          canMutate: data.canMutate === true,
          role: typeof data.role === "string" ? data.role : "",
        })
      })
      .catch(() => {
        if (!cancelled) setWorkspaceAccess(current => ({ ...current, loaded: true }))
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selectedAccountId) return
    try {
      const raw = localStorage.getItem(DEFAULTS_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        setDefaultPrimaryText(d.primaryText || "")
        setDefaultHeadline(d.headline || "")
        setDefaultCta(d.cta || "SHOP_NOW")
        setDefaultLink(d.link || "")
      }
    } catch {}
  }, [selectedAccountId])

  const saveDefaults = () => {
    const d = { primaryText: defaultPrimaryText, headline: defaultHeadline, cta: defaultCta, link: defaultLink }
    try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d)) } catch {}
    setDefaultsOpen(false)
  }

  const resetAllDefaults = () => {
    setDefaultPrimaryText("")
    setDefaultHeadline("")
    setDefaultCta("SHOP_NOW")
    setDefaultLink("")
  }

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const r = await fetch("/api/launch-history?limit=30")
      const d = await r.json()
      setHistoryBatches(d.batches || [])
    } catch {} finally { setHistoryLoading(false) }
  }, [])

  // Load / save column state from localStorage
  useEffect(() => {
    try {
      const rawMetrics = localStorage.getItem("adsmanager_custom_metrics_v1")
      const storedCustomMetrics = rawMetrics ? JSON.parse(rawMetrics) as CustomMetricConfig[] : []
      if (storedCustomMetrics.length) setCustomMetrics(storedCustomMetrics)
      const validIds = new Set([...COLUMN_DEFS.map(c => c.id), ...storedCustomMetrics.map(c => c.id)])
      const raw = localStorage.getItem("adsmanager_col_order_v3")
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        const valid = parsed.filter(id => validIds.has(id))
        if (valid.length > 0) setColumnOrder(valid)
      }
      const rawPresets = localStorage.getItem("adsmanager_col_presets")
      if (rawPresets) setCustomPresets(JSON.parse(rawPresets))
      const rawWidths = localStorage.getItem("adsmanager_col_widths_v1")
      if (rawWidths) setColumnWidths(JSON.parse(rawWidths))
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem("adsmanager_col_order_v3", JSON.stringify(columnOrder)) } catch {}
  }, [columnOrder])

  useEffect(() => {
    try { localStorage.setItem("adsmanager_col_widths_v1", JSON.stringify(columnWidths)) } catch {}
  }, [columnWidths])

  useEffect(() => {
    try { localStorage.setItem("adsmanager_col_presets", JSON.stringify(customPresets)) } catch {}
  }, [customPresets])

  useEffect(() => {
    try { localStorage.setItem("adsmanager_custom_metrics_v1", JSON.stringify(customMetrics)) } catch {}
  }, [customMetrics])

  const saveCustomPreset = (name: string, cols: string[]) => {
    setCustomPresets(prev => [
      ...prev.filter(p => p.label !== name),
      { id: `custom_${Date.now()}`, label: name, columns: cols },
    ])
  }

  // Close dropdowns on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (colsDropRef.current && !colsDropRef.current.contains(e.target as Node)) setColsOpen(false)
    }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])

  // ─── Data fetch (fetch all, filter client-side) ──────────────────────────────

  const buildDateParam = useCallback(() => {
    return (datePreset === "custom" || datePreset === "maximum") && customDateRange
      ? `time_range=${encodeURIComponent(JSON.stringify({
          since: formatMetaDate(customDateRange.start),
          until: formatMetaDate(customDateRange.end),
        }))}`
      : `date_preset=${datePreset}`
  }, [datePreset, customDateRange])

  // Fetches campaigns/adsets/ads only — `breakdowns` intentionally excluded from
  // deps so that toggling a breakdown never triggers a redundant main-data refetch.
  const clientCache = useRef<Map<string, {
    campaigns?: Campaign[]
    adSets?: AdSet[]
    ads?: Ad[]
    paging?: { after?: string; hasNext: boolean }
  }>>(new Map())
  const mainDataRequests = useRef(new LatestRequestGuard())
  const pendingFreshAccounts = useRef(new Set<string>())
  const markNextReadFresh = useCallback((adAccountId = selectedAccountId) => {
    if (adAccountId) pendingFreshAccounts.current.add(adAccountId)
  }, [selectedAccountId])
  const fetchMainData = useCallback(async (forceRefresh = false) => {
    if (!selectedAccountId) {
      mainDataRequests.current.begin()
      setLoading(false)
      return
    }

    const dateParam = buildDateParam()
    const after = pageCursorsRef.current[tab][page - 1]
    const paginationParam = `&limit=${PAGE_SIZE}${statusFilter === "ACTIVE" ? "&active_only=true" : ""}${after ? `&after=${encodeURIComponent(after)}` : ""}`
    const requiresFreshRead = forceRefresh || pendingFreshAccounts.current.has(selectedAccountId)
    const refreshParam = `${requiresFreshRead ? "&refresh=true" : ""}${paginationParam}`
    const cacheKey = `${selectedAccountId}:${dateParam}:${tab}:${statusFilter}:hierarchy:${hierarchyCacheKey}:page:${page}:after:${after || "first"}`
    const request = mainDataRequests.current.begin()

    const appending = page > 1
    const cached = (requiresFreshRead || appending) ? undefined : clientCache.current.get(cacheKey)
    if (cached) {
      if (tab === "campaigns") {
        setCampaigns(cached.campaigns || [])
      } else if (tab === "adsets") {
        setAdSets(cached.adSets || [])
      } else {
        setAds(cached.ads || [])
      }
      setPaging(cached.paging || { hasNext: false })
      setLoadedAccountId(selectedAccountId)
      setLoading(false)
      return
    } else {
      setLoading(true)
    }

    setError("")
    const t0 = Date.now()

    try {
      if (tab === "campaigns") {
        const r = await fetch(`/api/facebook/campaigns?ad_account_id=${encodeURIComponent(selectedAccountId)}&${dateParam}${refreshParam}`, { signal: request.signal, cache: "no-store" })
        const d = await r.json()
        if (!request.isCurrent()) return
        if (!r.ok) throw new Error(d.error || "Failed")
        setCampaigns(prev => page === 1 ? (d.campaigns || []) : mergeById(prev, d.campaigns || []))
        setPaging(d.paging || { hasNext: false })
        clientCache.current.set(cacheKey, { campaigns: d.campaigns || [], paging: d.paging })
        if (d.paging?.after) {
          setPageCursors(previous => previous.campaigns[page] === d.paging.after
            ? previous
            : { ...previous, campaigns: [...previous.campaigns.slice(0, page), d.paging.after] })
        }
      } else if (tab === "adsets") {
        const parentParam = hierarchyParentIds.length > 1
          ? `&campaign_ids=${encodeURIComponent(hierarchyParentIds.join(","))}`
          : hierarchyParentId
            ? `&campaign_id=${encodeURIComponent(hierarchyParentId)}`
            : ""
        const r = await fetch(`/api/facebook/adsets?ad_account_id=${encodeURIComponent(selectedAccountId)}${parentParam}&${dateParam}${refreshParam}`, { signal: request.signal, cache: "no-store" })
        const d = await r.json()
        if (!request.isCurrent()) return
        if (!r.ok) throw new Error(d.error || "Failed")
        setAdSets(prev => page === 1 ? (d.adSets || []) : mergeById(prev, d.adSets || []))
        setPaging(d.paging || { hasNext: false })
        clientCache.current.set(cacheKey, { adSets: d.adSets || [], paging: d.paging })
        if (d.paging?.after) {
          setPageCursors(previous => previous.adsets[page] === d.paging.after
            ? previous
            : { ...previous, adsets: [...previous.adsets.slice(0, page), d.paging.after] })
        }
      } else {
        const parentParam = hierarchyParentType === "adset"
          ? hierarchyParentIds.length > 1
            ? `&adset_ids=${encodeURIComponent(hierarchyParentIds.join(","))}`
            : hierarchyParentId
              ? `&adset_id=${encodeURIComponent(hierarchyParentId)}`
              : ""
          : hierarchyParentType === "campaign"
            ? hierarchyParentIds.length > 1
              ? `&campaign_ids=${encodeURIComponent(hierarchyParentIds.join(","))}`
              : hierarchyParentId
                ? `&campaign_id=${encodeURIComponent(hierarchyParentId)}`
                : ""
            : ""
        const r = await fetch(`/api/facebook/ads?ad_account_id=${encodeURIComponent(selectedAccountId)}${parentParam}&${dateParam}${refreshParam}`, { signal: request.signal, cache: "no-store" })
        const d = await r.json()
        if (!request.isCurrent()) return
        if (!r.ok) throw new Error(d.error || "Failed")
        setAds(prev => page === 1 ? (d.ads || []) : mergeById(prev, d.ads || []))
        setPaging(d.paging || { hasNext: false })
        clientCache.current.set(cacheKey, { ads: d.ads || [], paging: d.paging })
        if (d.paging?.after) {
          setPageCursors(previous => previous.ads[page] === d.paging.after
            ? previous
            : { ...previous, ads: [...previous.ads.slice(0, page), d.paging.after] })
        }
      }
      if (!request.isCurrent()) return
      if (requiresFreshRead) pendingFreshAccounts.current.delete(selectedAccountId)
      setLoadingProgress(100)
      setLoadedMs(Date.now() - t0)
      setLoadedAccountId(selectedAccountId)
      await new Promise<void>(resolve => window.setTimeout(resolve, 140))
    } catch (e: any) {
      if (!request.isCurrent() || e?.name === "AbortError") return
      setError(e.message || "Failed to load")
      setLoadedAccountId(selectedAccountId)
    } finally {
      if (request.isCurrent()) setLoading(false)
    }
  }, [selectedAccountId, tab, buildDateParam, datePreset, customDateRange, page, statusFilter, hierarchyParentId, hierarchyParentIds, hierarchyParentType, hierarchyCacheKey])

  const handleLaunchBatchChange = useCallback((event: "INSERT" | "UPDATE" | "DELETE") => {
    if (historyOpen) void fetchHistory()
    if (event === "INSERT") {
      clientCache.current.clear()
      void fetchMainData(true)
    }
  }, [fetchHistory, fetchMainData, historyOpen])

  useLaunchBatchesRealtime(handleLaunchBatchChange)

  // Fetches breakdown-insights rows — only when breakdowns are selected.
  // Receives the current breakdown list as an arg so callers can pass the
  // latest value directly (avoids stale-closure issues in the debounce).
  const fetchBreakdownData = useCallback(async (bds: string[]) => {
    setBreakdownRows([])
    setBreakdownError("")
    if (bds.length === 0 || !selectedAccountId) return

    const allBdsFields: string[] = []
    let tiValue: string | null = null
    for (const id of bds) {
      const param = BREAKDOWN_API_MAP[id]
      if (!param) continue
      const bdsM = param.match(/breakdowns=([^&]+)/)
      const tiM  = param.match(/time_increment=([^&]+)/)
      if (bdsM) allBdsFields.push(...bdsM[1].split(",").map(s => s.trim()))
      if (tiM) tiValue = tiM[1]
    }
    if (allBdsFields.length === 0 && !tiValue) return

    const dateParam = buildDateParam()
    const levelMap: Record<string, string> = { campaigns: "campaign", adsets: "adset", ads: "ad" }
    const level = levelMap[tab]

    const currentItems = tab === "campaigns" ? campaigns : tab === "adsets" ? adSets : ads
    const ids = currentItems.map(item => item.id).filter(Boolean)

    let insUrl = `/api/facebook/breakdown-insights?ad_account_id=${encodeURIComponent(selectedAccountId)}&level=${level}&${dateParam}`
    if (allBdsFields.length > 0) insUrl += `&breakdowns=${encodeURIComponent(allBdsFields.join(","))}`
    if (tiValue) insUrl += `&time_increment=${encodeURIComponent(tiValue)}`
    if (ids.length > 0) insUrl += `&object_ids=${encodeURIComponent(ids.join(","))}`

    try {
      const ir = await fetch(insUrl)
      const id = await ir.json()
      if (!ir.ok) {
        setBreakdownError(id.error || `Breakdown API error (${ir.status})`)
      } else if (Array.isArray(id.data)) {
        const idKey = level === "campaign" ? "campaign_id" : level === "adset" ? "adset_id" : "ad_id"
        const rows = id.data
          .filter((item: any) => item[idKey])
          .map((item: any) => ({
            parentId: item[idKey] as string,
            breakdownLabel: getBreakdownLabel(item as Record<string, string>, bds),
            dateStart: item.date_start || "",
            ins: {
              spend: item.spend || "0",
              impressions: item.impressions || "0",
              clicks: item.clicks || "0",
              reach: item.reach,
              actions: item.actions,
              action_values: item.action_values,
              cost_per_action_type: item.cost_per_action_type,
            } as Insight,
          }))
        if (tiValue) rows.sort((x: any, y: any) => y.dateStart.localeCompare(x.dateStart))
        setBreakdownRows(rows)
      }
    } catch (err) {
      console.error("[breakdown-insights] fetch error:", err)
      setBreakdownError("Failed to fetch breakdown data")
    }
  }, [selectedAccountId, tab, buildDateParam, campaigns, adSets, ads])

  const breakdownDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Main data: account / tab / date change reuses a matching loaded state.
  useEffect(() => { fetchMainData() }, [fetchMainData])

  // Time-based only: tab/window focus must never trigger a refetch, it was
  // reloading (and resetting scroll/selection) on every alt-tab back.
  useEffect(() => {
    if (!selectedAccountId) return
    const timer = window.setInterval(() => fetchMainData(true), 10 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [selectedAccountId, fetchMainData])

  // Account-level summary for footer metrics that Meta dedupes across the whole ad account.
  // Do not derive these by summing campaign/ad set/ad rows; reach/unique users overlap.
  useEffect(() => {
    if (!selectedAccountId) { setAccountSummary(null); return }
    let cancelled = false
    const load = async () => {
      try {
        const params = new URLSearchParams({ adAccountId: selectedAccountId })
        if ((datePreset === "custom" || datePreset === "maximum") && customDateRange) {
          params.set("since", formatMetaDate(customDateRange.start))
          params.set("until", formatMetaDate(customDateRange.end))
        } else {
          params.set("datePreset", datePreset)
        }
        if (attributionWindows.length) params.set("action_attribution_windows", attributionWindows.join(","))
        const r = await fetch(`/api/insights/account-summary?${params}`)
        const d = await r.json()
        if (!cancelled) setAccountSummary(r.ok ? (d.summary || null) : null)
      } catch {
        if (!cancelled) setAccountSummary(null)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedAccountId, datePreset, customDateRange, attributionWindows.join(",")])

  // Breakdown data: debounced 300ms so rapid multi-select fires only one request
  useEffect(() => {
    if (breakdownDebounceRef.current) clearTimeout(breakdownDebounceRef.current)
    breakdownDebounceRef.current = setTimeout(() => fetchBreakdownData(breakdowns), 300)
    return () => {
      if (breakdownDebounceRef.current) clearTimeout(breakdownDebounceRef.current)
    }
  }, [breakdowns, fetchBreakdownData])

  // Local filters reset the visible page; server-backed inputs also reset the cursor chain.
  useEffect(() => { setPage(1) }, [tab, search, statusFilter, datePreset, customDateRange, breakdowns])
  useEffect(() => {
    setPageCursors(previous => ({ ...previous, [tab]: [undefined] }))
  }, [selectedAccountId, tab, statusFilter, datePreset, customDateRange, hierarchyCacheKey])

  // ─── Tab switch: if items checked, capture as filter for the next level ─────
  // Badge appears only on the NEXT tab, not on all 3 at once

  const switchTab = (newTab: Tab) => {
    setError("")
    if (tab === "campaigns" && selectedIds.size > 0) {
      setCampaignFilter(new Set(selectedIds))
      setAdSetFilter(new Set())
    }
    if (tab === "adsets" && selectedIds.size > 0) {
      setAdSetFilter(new Set(selectedIds))
    }
    setPage(1)
    setPageCursors(previous => ({ ...previous, [newTab]: [undefined] }))
    setTab(newTab)
  }

  // ─── Toggle status ───────────────────────────────────────────────────────────

  const toggleStatus = async (id: string, newStatus: string) => {
    setToggling(prev => new Set(prev).add(id))
    try {
      const r = await fetch("/api/facebook/toggle-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, newStatus, adAccountId: selectedAccountId }),
      })
      if (!r.ok) return
      clientCache.current.clear()
      markNextReadFresh()
      // Optimistic update
      if (tab === "campaigns") setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: newStatus, effective_status: newStatus } : c))
      else if (tab === "adsets") setAdSets(prev => prev.map(a => a.id === id ? { ...a, status: newStatus, effective_status: newStatus } : a))
      else setAds(prev => prev.map(a => a.id === id ? { ...a, status: newStatus, effective_status: newStatus } : a))
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  // ─── Inline Rename ────────────────────────────────────────────────────────────
  const saveInlineRename = async (id: string) => {
    if (!inlineEditingName.trim() || inlineEditingId !== id) {
      setInlineEditingId(null)
      return
    }
    
    // Optimistic update
    const updateList = (list: any[]) => list.map(x => x.id === id ? { ...x, name: inlineEditingName } : x)
    if (tab === "campaigns") setCampaigns(updateList)
    else if (tab === "adsets") setAdSets(updateList)
    else setAds(updateList)
    
    setInlineEditingId(null)

    try {
      const r = await fetch("/api/facebook/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: inlineEditingName, adAccountId: selectedAccountId })
      })
      if (!r.ok) throw new Error("Failed to update name")
      clientCache.current.clear()
      markNextReadFresh()
    } catch (err) {
      console.error(err)
      fetchMainData(true) // revert on fail
    }
  }

  // ─── Duplicate ────────────────────────────────────────────────────────────────
  const canDuplicate = selectedIds.size > 0
    && (tab === "campaigns"
      || !((duplicateDestination === "existing" && !duplicateTargetId) || (duplicateDestination === "new" && !duplicateNewName.trim())))
  const sourceAdSetIds = new Set(ads.filter(ad => selectedIds.has(ad.id)).map(ad => ad.adset_id))
  const availableDuplicateAdSetOptions = duplicateAdSetOptions
    .filter(adSet => (adSet.status === "ACTIVE" || adSet.status === "PAUSED") && !sourceAdSetIds.has(adSet.id))
    .sort((a, b) => (a.campaign_name || "").localeCompare(b.campaign_name || "") || a.name.localeCompare(b.name))
  const duplicateAdSetSearchTerm = duplicateAdSetSearch.trim().toLowerCase()
  const filteredDuplicateAdSetOptions = duplicateAdSetSearchTerm
    ? availableDuplicateAdSetOptions.filter(adSet =>
        adSet.name.toLowerCase().includes(duplicateAdSetSearchTerm)
        || (adSet.campaign_name || "").toLowerCase().includes(duplicateAdSetSearchTerm)
      )
    : availableDuplicateAdSetOptions
  const selectedDuplicateAdSet = duplicateAdSetOptions.find(adSet => adSet.id === duplicateTargetId)

  const openDuplicatePublishConfirm = () => {
    if (!canDuplicate || isDuplicating) return
    setDuplicateDialogOpen(false)
    setDuplicateConfirmOpen(true)
  }

  const executeDuplicate = async (active: boolean) => {
    if (selectedIds.size === 0 || !selectedAccountId) return

    const ids = Array.from(selectedIds)
    const copyCount = Math.min(Math.max(duplicateCount || 1, 1), 20)
    const sourceRows = tab === "campaigns" ? campaigns : tab === "adsets" ? adSets : ads
    const sourceById = new Map(sourceRows.map(row => [row.id, row]))
    const pendingItems: PopupItem[] = ids.map(id => ({
      id,
      name: sourceById.get(id)?.name ?? id,
      status: "pending",
    }))
    const copiedIds: string[] = []
    let firstCreated: { id: string; name: string } | null = null

    const updatePopupItem = (id: string, patch: Partial<PopupItem>) => {
      setMiniStatusPopup(prev => prev ? {
        ...prev,
        items: prev.items.map(item => item.id === id ? { ...item, ...patch } : item),
      } : prev)
    }
    const postJson = async (url: string, body: Record<string, unknown>) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || d.errors?.[0] || "Duplicate failed")
      return d
    }
    const copiedName = (node: { name: string }) => ids.length === 1 && duplicateName.trim() ? duplicateName.trim() : `${node.name} - Copy`

    setDuplicateConfirmOpen(false)
    setDuplicateDialogOpen(false)
    setMiniStatusPopup({ title: "Duplicating…", total: ids.length, items: pendingItems })
    setIsDuplicating(true)
    try {
      for (const id of ids) {
        try {
          const node = sourceById.get(id)
          if (!node) throw new Error("Selected item is no longer loaded")
          let createdIds: string[] = []
          const nodeName = copiedName(node)

          if (tab === "campaigns") {
            const campaign = node as Campaign
            const d = await postJson(`/api/facebook/campaigns/${encodeURIComponent(id)}/duplicate`, {
              customName: copiedName(campaign),
              count: copyCount,
              launchAsActive: active,
              adAccountId: selectedAccountId,
              mode: "ALL",
            })
            createdIds = (d.campaigns || []).map((c: { id: string }) => c.id)
          } else if (tab === "adsets") {
            const adSet = node as AdSet
            const d = await postJson("/api/facebook/campaigns/duplicate-adsets", {
              targetCampaignIds: duplicateDestination === "new" ? [] : [duplicateDestination === "existing" ? duplicateTargetId : adSet.campaign_id],
              newCampaignName: duplicateDestination === "new" ? duplicateNewName.trim() || `${adSet.name} Campaign` : undefined,
              adAccountId: selectedAccountId,
              adSetConfigs: [{
                id,
                customName: copiedName(adSet),
                copies: copyCount,
                statusActive: active,
                deepCopy: true,
                selectedAdIds: null,
                duplicatedAdsStatus: active ? "ACTIVE" : "PAUSED",
              }],
            })
            createdIds = (d.campaigns || [])
              .flatMap((campaign: { adSets?: AdSet[] }) => campaign.adSets || [])
              .map((adSet: { id: string }) => adSet.id)
          } else if (duplicateDestination === "new") {
            const ad = node as Ad
            const sourceAdSet = adSets.find(item => item.id === ad.adset_id)
            const d = await postJson("/api/facebook/campaigns/duplicate-adsets", {
              targetCampaignIds: [ad.campaign_id],
              adAccountId: selectedAccountId,
              adSetConfigs: [{
                id: ad.adset_id,
                customName: duplicateNewName.trim() || `${sourceAdSet?.name || ad.name} - Copy`,
                copies: copyCount,
                statusActive: active,
                deepCopy: true,
                selectedAdIds: [id],
                duplicatedAdsStatus: active ? "ACTIVE" : "PAUSED",
              }],
            })
            createdIds = (d.campaigns || [])
              .flatMap((campaign: { adSets?: Array<{ copiedAdIds?: string[] }> }) => campaign.adSets || [])
              .flatMap((adSet: { copiedAdIds?: string[] }) => adSet.copiedAdIds || [])
          } else {
            const ad = node as Ad
            const d = await postJson("/api/facebook/duplicate", {
              id,
              name: copiedName(ad),
              deep_copy: false,
              status_option: active ? "ACTIVE" : "PAUSED",
              copies: copyCount,
              adAccountId: selectedAccountId,
              target_adset_id: duplicateDestination === "existing" ? duplicateTargetId : undefined,
            })
            createdIds = d.ids || []
          }

          if (createdIds.length === 0) throw new Error("Meta returned no copied object ID")
          copiedIds.push(...createdIds)
          if (!firstCreated) firstCreated = { id: createdIds[0], name: nodeName }
          updatePopupItem(id, { status: "success" })
        } catch (err) {
          const message = err instanceof Error ? err.message : "Duplicate failed"
          updatePopupItem(id, { status: "failed", error: message })
        }
      }

      clientCache.current.clear()
      markNextReadFresh()
      await fetchMainData(true)
      if (firstCreated) {
        setSelectedIds(new Set(copiedIds))
        openWorkspaceEditor(firstCreated)
      } else {
        setSelectedIds(new Set())
      }
    } finally {
      setIsDuplicating(false)
    }
  }

  useEffect(() => {
    if (!actionToast) return
    const t = setTimeout(() => setActionToast(null), 6000)
    return () => clearTimeout(t)
  }, [actionToast])

  // ─── Save as Template / Duplicate to Launcher ─────────────────────────────────
  // The P0 loop: a winning ad goes back into Templates, or straight into the
  // Launcher as a pre-filled draft.
  const handleSaveAsTemplate = async (ad: Ad) => {
    if (!selectedAccountId || savingTemplateId) return
    setSavingTemplateId(ad.id)
    try {
      const r = await fetch("/api/templates/from-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_id: ad.id,
          ad_account_id: selectedAccountId,
          name: ad.name,
          date_preset: datePreset === "custom" ? "last_30d" : datePreset,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Failed to save template")
      setActionToast({ kind: "success", message: `Saved "${ad.name}" to Templates`, href: "/templates" })
    } catch (err: any) {
      setActionToast({ kind: "error", message: err.message || "Failed to save template" })
    } finally {
      setSavingTemplateId(null)
    }
  }

  const handleDuplicateToLauncher = (ad: Ad) => {
    if (!selectedAccountId) return
    router.push(`/launch?from_ad=${encodeURIComponent(ad.id)}&ad_account_id=${encodeURIComponent(selectedAccountId)}`)
  }

  // ─── Save Side Panel Edit ─────────────────────────────────────────────────────
  const saveSidePanelEdit = async (updatedNode: any) => {
    const updateList = (list: any[]) => list.map(x => x.id === updatedNode.id ? { ...x, ...updatedNode } : x)
    if (campaigns.some(item => item.id === updatedNode.id)) setCampaigns(updateList)
    else if (adSets.some(item => item.id === updatedNode.id)) setAdSets(updateList)
    else setAds(updateList)
    setEditingNode(null)

    try {
      const r = await fetch("/api/facebook/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: updatedNode.id,
          name: updatedNode.name,
          status: updatedNode.status,
          daily_budget: updatedNode.daily_budget ? parseInt(updatedNode.daily_budget) / 100 : undefined,
          lifetime_budget: updatedNode.lifetime_budget ? parseInt(updatedNode.lifetime_budget) / 100 : undefined,
          start_time: updatedNode.start_time || undefined,
          end_time: updatedNode.end_time || undefined,
          adAccountId: selectedAccountId,
          optimization_goal: updatedNode.optimization_goal,
          bid_amount: updatedNode.bid_amount ? parseInt(updatedNode.bid_amount) / 100 : undefined,
          promoted_object: updatedNode.promoted_object,
          attribution_spec: updatedNode.attribution_spec,
          targeting: updatedNode.targeting,
          advertiser: updatedNode.advertiser,
          payer: updatedNode.payer,
        })
      })
      if (!r.ok) throw new Error("Failed to update")
      clientCache.current.clear()
      markNextReadFresh()
      setActionToast({ kind: "success", message: `Saved "${updatedNode.name}"` })
    } catch (err) {
      console.error(err)
      fetchMainData(true) // revert on fail
      setActionToast({ kind: "error", message: "Failed to save changes" })
      throw err
    }
  }

  // ─── Delete ───────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    // Whatever the dialog last showed is what gets deleted. `deleteScope` is only
    // ever "visible" because the user pressed the narrow-to-visible button.
    const ids = deleteScope === "visible" ? visibleSelectedIds : Array.from(selectedIds)
    if (ids.length === 0) return

    const nameById = new Map(
      (tab === "campaigns" ? campaigns : tab === "adsets" ? adSets : ads).map(r => [r.id, r.name])
    )
    const pendingItems: PopupItem[] = ids.map(id => ({
      id,
      name: nameById.get(id) ?? id,
      status: "pending",
    }))

    setDeleteConfirmOpen(false)
    setMiniStatusPopup({ title: "Deleting…", total: ids.length, items: pendingItems })
    setIsDeleting(true)
    try {
      const r = await fetch("/api/facebook/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, adAccountId: selectedAccountId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Delete failed")
      const results: DeleteResult[] = Array.isArray(d.results) ? d.results : []
      const resultById = new Map<string, DeleteResult>(results.map(x => [x.id, x]))
      setMiniStatusPopup({
        title: "Deleting…",
        total: ids.length,
        items: pendingItems.map(item => {
          const result = resultById.get(item.id)
          return {
            ...item,
            status: result?.success ? "success" : "failed",
            error: result?.success ? undefined : result?.error || "Delete failed",
          }
        }),
      })
      if (Number(d.deleted) > 0) {
        clientCache.current.clear()
        markNextReadFresh()
        const deletedSet = new Set(results.filter(x => x.success).map(x => x.id))
        if (tab === "campaigns") {
          setCampaigns(prev => prev.filter(c => !deletedSet.has(c.id)))
          setAdSets(prev => prev.filter(a => !deletedSet.has(a.campaign_id)))
          setAds(prev => prev.filter(a => !deletedSet.has(a.campaign_id)))
        } else if (tab === "adsets") {
          setAdSets(prev => prev.filter(a => !deletedSet.has(a.id)))
          setAds(prev => prev.filter(a => !deletedSet.has(a.adset_id)))
        } else {
          setAds(prev => prev.filter(a => !deletedSet.has(a.id)))
        }
        // Drop only what was actually deleted — after a narrowed delete the hidden
        // rows are still selected, and pretending otherwise would hide that.
        setSelectedIds(prev => new Set(Array.from(prev).filter(id => !deletedSet.has(id))))
      }
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : "Delete failed"
      setMiniStatusPopup({
        title: "Deleting…",
        total: ids.length,
        items: pendingItems.map(item => ({ ...item, status: "failed", error: message })),
      })
    } finally {
      setIsDeleting(false)
    }
  }

  // ─── Sort ────────────────────────────────────────────────────────────────────

  /**
   * Drains every remaining cursor page into memory.
   *
   * Sorting needed this first — a sort over one page is a lie. Filtering and the
   * filter bar's entity suggestions need the same thing for the same reason, hence
   * the rename from `fetchRemainingRowsForSort`. Two callers can now fire it at
   * once (click a column header while the bar is draining), so it is reentrant-safe.
   *
   * It stops at DRAIN_ROW_LIMIT and says so rather than walking an account with tens
   * of thousands of ads. Meta's paging is the cost here: one round trip per page.
   */
  const fetchAllRemainingRows = useCallback(async () => {
    if (!selectedAccountId || !paging.hasNext) return
    if (drainingRef.current) return
    drainingRef.current = true

    setLoading(true)
    setError("")
    const dateParam = buildDateParam()
    let cursorPage = page
    let hasNext: boolean = paging.hasNext
    let loadedCount = (tab === "campaigns" ? campaigns : tab === "adsets" ? adSets : ads).length

    try {
      while (hasNext) {
        if (loadedCount >= DRAIN_ROW_LIMIT) break
        const after = pageCursorsRef.current[tab][cursorPage]
        if (!after) break

        const paginationParam = `&limit=${PAGE_SIZE}${statusFilter === "ACTIVE" ? "&active_only=true" : ""}&after=${encodeURIComponent(after)}`
        const parentParam = tab === "adsets"
          ? hierarchyParentIds.length > 1
            ? `&campaign_ids=${encodeURIComponent(hierarchyParentIds.join(","))}`
            : hierarchyParentId
              ? `&campaign_id=${encodeURIComponent(hierarchyParentId)}`
              : ""
          : tab === "ads"
            ? hierarchyParentType === "adset"
              ? hierarchyParentIds.length > 1
                ? `&adset_ids=${encodeURIComponent(hierarchyParentIds.join(","))}`
                : hierarchyParentId
                  ? `&adset_id=${encodeURIComponent(hierarchyParentId)}`
                  : ""
              : hierarchyParentType === "campaign"
                ? hierarchyParentIds.length > 1
                  ? `&campaign_ids=${encodeURIComponent(hierarchyParentIds.join(","))}`
                  : hierarchyParentId
                    ? `&campaign_id=${encodeURIComponent(hierarchyParentId)}`
                    : ""
                : ""
            : ""
        const endpoint = tab === "campaigns" ? "campaigns" : tab === "adsets" ? "adsets" : "ads"
        const r = await fetch(`/api/facebook/${endpoint}?ad_account_id=${encodeURIComponent(selectedAccountId)}${parentParam}&${dateParam}${paginationParam}`)
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || "Failed")

        if (tab === "campaigns") setCampaigns(prev => mergeById(prev, d.campaigns || []))
        else if (tab === "adsets") setAdSets(prev => mergeById(prev, d.adSets || []))
        else setAds(prev => mergeById(prev, d.ads || []))
        loadedCount += ((tab === "campaigns" ? d.campaigns : tab === "adsets" ? d.adSets : d.ads) || []).length

        cursorPage += 1
        hasNext = Boolean(d.paging?.hasNext)
        if (d.paging?.after) {
          const nextCursors = {
            ...pageCursorsRef.current,
            [tab]: [...pageCursorsRef.current[tab].slice(0, cursorPage), d.paging.after],
          }
          pageCursorsRef.current = nextCursors
          setPageCursors(nextCursors)
        }
      }
      setPage(cursorPage)
      setPaging({ hasNext })
      // Never silently truncate: filters and sorts below this banner are over a
      // partial set, and the user has to be told which.
      setDrainTruncated(hasNext)
    } catch (e: any) {
      setError(e.message || "Failed to load remaining rows")
    } finally {
      drainingRef.current = false
      setLoading(false)
    }
  }, [selectedAccountId, paging.hasNext, buildDateParam, page, tab, statusFilter, campaigns, adSets, ads, hierarchyParentIds, hierarchyParentId, hierarchyParentType])

  /**
   * Three states per column: ascending → descending → default.
   *
   * The old version cycled asc ↔ desc forever, so once a column was clicked there was no way
   * back to the table's own order short of a reload. Clearing `sortField` is what "default"
   * means — the currentData memo falls through to `byNewestFirst`.
   */
  const handleSort = async (field: string) => {
    await fetchAllRemainingRows()
    if (sortField !== field) { setSortField(field); setSortDir("asc"); return }
    if (sortDir === "asc") { setSortDir("desc"); return }
    setSortField(null)
    setSortDir("asc")
  }

  // ─── Filtered + sorted data ──────────────────────────────────────────────────

  // Lookup maps for cross-level name search
  const campaignNameById = useMemo(() => new Map(campaigns.map(c => [c.id, c.name])), [campaigns])
  const adSetNameById    = useMemo(() => new Map(adSets.map(a => [a.id, a.name])), [adSets])

  // Per-tab match counts — only computed for tabs that have loaded data
  const tabMatchCounts = useMemo(() => {
    const q = search.toLowerCase().trim()
    const matchStatus = (item: { effective_status: string }) =>
      statusFilter === "all" || item.effective_status === statusFilter
    const matchText = (item: { name: string; id: string }, extra = "") =>
      !q || item.name.toLowerCase().includes(q) || item.id.includes(q) || extra.toLowerCase().includes(q)
    return {
      // null = data not loaded yet (tab never visited) → don't show badge
      campaigns: campaigns.length > 0 || tab === "campaigns"
        ? campaigns.filter(c => matchStatus(c) && matchText(c)).length
        : null,
      adsets: adSets.length > 0 || tab === "adsets"
        ? adSets.filter(a => matchStatus(a) && matchText(a, campaignNameById.get(a.campaign_id) ?? "")).length
        : null,
      ads: ads.length > 0 || tab === "ads"
        ? ads.filter(ad => matchStatus(ad) && matchText(ad,
            [campaignNameById.get(ad.campaign_id) ?? "", adSetNameById.get(ad.adset_id) ?? ""].join(" ")
          )).length
        : null,
    }
  }, [campaigns, adSets, ads, tab, search, statusFilter, campaignNameById, adSetNameById])

  const currentData: (Campaign | AdSet | Ad)[] = useMemo(() => {
    let list: (Campaign | AdSet | Ad)[] = tab === "campaigns" ? campaigns : tab === "adsets" ? adSets : ads

    // Launch → Ads Manager connection: filter to ads created by the linked launch batch
    if (activeLaunchFilter && launchAdIds) {
      list = (list as Ad[]).filter(a => launchAdIds.has(a.id))
    }

    // Hierarchical filter — persists across all tabs
    if (tab === "adsets" && campaignFilter.size > 0) {
      list = (list as AdSet[]).filter(a => campaignFilter.has(a.campaign_id))
    }
    if (tab === "ads" && adSetFilter.size > 0) {
      list = (list as Ad[]).filter(a => adSetFilter.has(a.adset_id))
    } else if (tab === "ads" && campaignFilter.size > 0) {
      list = (list as Ad[]).filter(a => campaignFilter.has(a.campaign_id))
    }

    // Status filter
    if (statusFilter !== "all") {
      list = list.filter(item => item.effective_status === statusFilter)
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      if (tab === "adsets") {
        list = list.filter(item =>
          item.name.toLowerCase().includes(q) || item.id.includes(q) ||
          (campaignNameById.get((item as AdSet).campaign_id) ?? "").toLowerCase().includes(q)
        )
      } else if (tab === "ads") {
        list = list.filter(item =>
          item.name.toLowerCase().includes(q) || item.id.includes(q) ||
          (campaignNameById.get((item as Ad).campaign_id) ?? "").toLowerCase().includes(q) ||
          (adSetNameById.get((item as Ad).adset_id) ?? "").toLowerCase().includes(q)
        )
      } else {
        list = list.filter(item => item.name.toLowerCase().includes(q) || item.id.includes(q))
      }
    }

    // Filter chips — AND-ed with each other and with everything above. Chips that do
    // not apply at this level are inactive, not dropped (they stay greyed in the bar).
    const activeChips = orderChipsForEval(chips.filter(c => isChipValidAt(c, tab as FilterLevel)))
    if (activeChips.length > 0) {
      list = list.filter(row => {
        // One structural view over the three row shapes: the evaluator reads fields that
        // exist at only some levels, and the `text` accessor answers "" for the rest.
        const r = row as Partial<Campaign & AdSet & Ad>
        const objective = tab === "campaigns" ? r.objective : campaigns.find(c => c.id === r.campaign_id)?.objective
        const ins = getInsight(row)
        const ctx: ChipEvalContext = {
          rowId: row.id,
          // `resolveMetricNumber` reports 0 for a row Meta returned no insights for,
          // so "spent nothing" and "no data" are indistinguishable downstream. This
          // flag is what keeps `spend < 100` from sweeping in everything undelivered.
          hasInsights: ins !== null,
          createdAt: r.created_time || null,
          campaignId: r.campaign_id,
          adsetId: r.adset_id,
          text: fieldId => {
            switch (fieldId) {
              case "name": return r.name ?? ""
              case "id": return r.id ?? ""
              case "campaign_name": return tab === "campaigns" ? r.name ?? "" : campaignNameById.get(r.campaign_id ?? "") ?? ""
              case "adset_name": return tab === "adsets" ? r.name ?? "" : adSetNameById.get(r.adset_id ?? "") ?? ""
              case "objective": return (r.objective ?? objective ?? "").toString()
              default: return ""
            }
          },
          number: fieldId => resolveMetricNumber(fieldId, ins, row, objective),
        }
        return activeChips.every(chip => matchesChip(chip, ctx))
      })
    }

    if (sortField) {
      list = [...list].sort((a, b) => {
        const av = sortValue(sortField, a)
        const bv = sortValue(sortField, b)
        if (typeof av === "string" || typeof bv === "string") {
          const as = String(av ?? ""), bs = String(bv ?? "")
          return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as)
        }
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number)
      })
    } else {
      // Default order = newest created first, at all three levels. Meta returns campaigns,
      // ad sets and ads in its own order (roughly oldest first), which put the thing the user
      // just launched at the bottom of the list. `created_time` is already requested by
      // lib/facebook.ts for all three levels, so this needs no API change — but the DB-snapshot
      // fallback path may omit it, so a missing value sorts last rather than crashing the
      // comparator or jumping to the top.
      list = [...list].sort(byNewestFirst)
    }
    return list
  }, [tab, campaigns, adSets, ads, campaignFilter, adSetFilter, search, statusFilter, chips, sortField, sortDir, campaignNameById, adSetNameById, activeLaunchFilter, launchAdIds])

  const pagedData = currentData

  /**
   * Hidden selection — the number that makes a bulk action honest.
   *
   * Bulk Duplicate / Edit / Delete all read the whole `selectedIds` set, and the
   * selection deliberately survives filter changes. Without this count, "select 9 →
   * filter to 6 → Delete" destroys 9 Meta objects with nothing on screen saying so.
   *
   * Computed over `currentData`, not `pagedData`: a row further down the same
   * filtered list is not hidden. Hidden means *excluded by a filter*.
   */
  const visibleSelectedIds = useMemo(
    () => currentData.filter(r => selectedIds.has(r.id)).map(r => r.id),
    [currentData, selectedIds]
  )
  const hiddenSelectedCount = selectedIds.size - visibleSelectedIds.length

  /**
   * Row selection, including the Meta-style range gesture.
   *
   * | Gesture           | Result                                            |
   * |-------------------|---------------------------------------------------|
   * | click             | toggle that row, and make it the anchor           |
   * | Shift + click     | add every row between the anchor and here (union) |
   * | Shift + Ctrl/⌘    | remove every row in that range                    |
   *
   * The range is taken over `currentData` — what is on screen, in the order it is on
   * screen. Sorting or filtering between the two clicks therefore changes the range,
   * which is why the anchor is an id: it still points at the row the user clicked.
   * A shift-click does not move the anchor, so the range can be re-extended.
   */
  const toggleRowSelection = (rowId: string, shiftKey: boolean, ctrlKey: boolean) => {
    const anchorId = anchorIdByTab[tab]
    if (shiftKey && anchorId && anchorId !== rowId) {
      const ids = currentData.map(r => r.id)
      const from = ids.indexOf(anchorId)
      const to = ids.indexOf(rowId)
      if (from !== -1 && to !== -1) {
        const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1)
        setSelectedIds(prev => {
          const s = new Set(prev)
          for (const id of range) ctrlKey ? s.delete(id) : s.add(id)
          return s
        })
        return
      }
      // Anchor no longer in view (filtered out, or on a page not loaded) — fall
      // through to a plain toggle rather than guessing at a range.
    }
    setSelectedIds(prev => {
      const s = new Set(prev)
      if (s.has(rowId)) s.delete(rowId); else s.add(rowId)
      return s
    })
    setAnchorIdByTab(prev => ({ ...prev, [tab]: rowId }))
  }

  /** Narrows the selection to the rows the current filters leave visible. */
  const keepOnlyVisibleSelected = () => setSelectedIds(new Set(visibleSelectedIds))

  /** Distinct enum values present in the loaded rows, for the chip editor. */
  const chipEnumOptions = useMemo(() => {
    const objectives = new Set<string>()
    for (const c of campaigns) if (c.objective) objectives.add(c.objective)
    return { objective: Array.from(objectives).sort() }
  }, [campaigns])

  /** Entity names present in the loaded rows, for the chip dropdown's exact-match group. */
  const chipSuggestions = useMemo(() => {
    const rows = tab === "campaigns" ? campaigns : tab === "adsets" ? adSets : ads
    const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort()
    return {
      name: uniq(rows.map(r => r.name)),
      campaign_name: uniq(campaigns.map(c => c.name)),
      adset_name: uniq(adSets.map(a => a.name)),
    }
  }, [tab, campaigns, adSets, ads])

  useEffect(() => {
    if (tab !== "adsets" || !pagedData.length) return

    let cancelled = false
    const adsetIds = pagedData.map(a => a.id)
    const toFetch = adsetIds.filter(id => !fetchedAdsetAdsRef.current.has(id))

    if (toFetch.length === 0) return

    toFetch.forEach(id => fetchedAdsetAdsRef.current.add(id))

    async function fetchAdsetAds() {
      await Promise.all(toFetch.map(async (id) => {
        try {
          const res = await fetch(`/api/facebook/adsets/${id}/ads`)
          if (!res.ok) return
          const data = await res.json()
          const adsList = data.ads || []
          const hasActive = adsList.some((ad: any) => ad.effective_status === "ACTIVE")
          if (!cancelled) {
            setAdSetHasActiveAds(prev => ({ ...prev, [id]: hasActive }))
          }
        } catch (e) {
          console.error("Failed to fetch ads for adset", id, e)
        }
      }))
    }

    fetchAdsetAds()

    return () => {
      cancelled = true
    }
  }, [tab, pagedData])

  const selectedBulkItems: BulkEditableItem[] = useMemo(() => {
    const selected = currentData.filter(item => selectedIds.has(item.id))
    return selected.map(item => {
      if (tab === "campaigns") {
        const campaign = item as Campaign
        return {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          daily_budget: campaign.daily_budget,
          lifetime_budget: campaign.lifetime_budget,
          budgetEligible: false,
          budgetBlockedReason: "Campaign budget is not a bulk-edit field",
        }
      }
      if (tab === "adsets") {
        const adSet = item as AdSet
        const campaign = campaigns.find(candidate => candidate.id === adSet.campaign_id)
        const parentOwnsBudget = Boolean(campaign?.daily_budget || campaign?.lifetime_budget)
        const hasOwnBudget = adSet.daily_budget !== undefined || adSet.lifetime_budget !== undefined
        return {
          id: adSet.id,
          name: adSet.name,
          status: adSet.status,
          campaign_id: adSet.campaign_id,
          daily_budget: adSet.daily_budget,
          lifetime_budget: adSet.lifetime_budget,
          budgetEligible: hasOwnBudget && !parentOwnsBudget,
          budgetBlockedReason: parentOwnsBudget ? "Controlled by campaign budget" : "No editable budget found",
        }
      }
      const ad = item as Ad
      return {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        campaign_id: ad.campaign_id,
        adset_id: ad.adset_id,
        budgetEligible: false,
        budgetBlockedReason: "Ads do not own budgets",
      }
    })
  }, [campaigns, currentData, selectedIds, tab])

  const currentDraftLevel: Level = tab === "campaigns" ? "campaign" : tab === "adsets" ? "adset" : "ad"
  const bulkEditHierarchy: BulkEditHierarchy = useMemo(() => {
    if (currentDraftLevel === "campaign") {
      return {
        rows: selectedBulkItems.map(item => ({
          id: item.id,
          level: "campaign" as const,
          name: item.name,
          depth: 0 as const,
          selected: true,
        })),
        counts: { campaign: selectedBulkItems.length },
      }
    }

    const selectedCampaignIds = Array.from(new Set(selectedBulkItems.map(item => item.campaign_id).filter(Boolean) as string[]))
    if (currentDraftLevel === "adset") {
      const rows: BulkEditHierarchy["rows"] = []
      for (const campaignId of selectedCampaignIds) {
        rows.push({
          id: campaignId,
          level: "campaign",
          name: campaigns.find(campaign => campaign.id === campaignId)?.name || `Campaign ${campaignId}`,
          depth: 0,
          selected: false,
        })
        for (const item of selectedBulkItems.filter(candidate => candidate.campaign_id === campaignId)) {
          rows.push({ id: item.id, level: "adset", name: item.name, depth: 1, selected: true })
        }
      }
      return {
        rows,
        counts: { campaign: selectedCampaignIds.length, adset: selectedBulkItems.length },
      }
    }

    const rows: BulkEditHierarchy["rows"] = []
    const selectedAdSetIds = Array.from(new Set(selectedBulkItems.map(item => item.adset_id).filter(Boolean) as string[]))
    for (const campaignId of selectedCampaignIds) {
      rows.push({
        id: campaignId,
        level: "campaign",
        name: campaigns.find(campaign => campaign.id === campaignId)?.name || `Campaign ${campaignId}`,
        depth: 0,
        selected: false,
      })
      const campaignAdSetIds = Array.from(new Set(
        selectedBulkItems
          .filter(item => item.campaign_id === campaignId)
          .map(item => item.adset_id)
          .filter(Boolean) as string[],
      ))
      for (const adSetId of campaignAdSetIds) {
        rows.push({
          id: adSetId,
          level: "adset",
          name: adSets.find(adSet => adSet.id === adSetId)?.name || `Ad set ${adSetId}`,
          depth: 1,
          selected: false,
        })
        for (const item of selectedBulkItems.filter(candidate => candidate.adset_id === adSetId)) {
          rows.push({ id: item.id, level: "ad", name: item.name, depth: 2, selected: true })
        }
      }
    }
    return {
      rows,
      counts: { campaign: selectedCampaignIds.length, adset: selectedAdSetIds.length, ad: selectedBulkItems.length },
    }
  }, [adSets, campaigns, currentDraftLevel, selectedBulkItems])

  const selectedDraftKeys = useMemo(
    () => Array.from(selectedIds)
      .map(id => bulkDraftKey(currentDraftLevel, id))
      .filter(key => Boolean(bulkDrafts[key])),
    [bulkDrafts, currentDraftLevel, selectedIds],
  )

  const openBulkEditor = (field: BulkDraftField) => {
    if (!workspaceAccess.canMutate || selectedBulkItems.length === 0) return
    if (field === "turn_on" || field === "turn_off") {
      setBulkStatusField(field)
      setBulkStatusOpen(true)
      return
    }
    setBulkEditorField(field === "budget" && tab !== "adsets" ? "name" : field)
    setBulkEditorOpen(true)
  }

  const openBulkReview = (keys?: string[]) => {
    setBulkPublishResults([])
    setBulkReviewInitialKeys(keys)
    setBulkReviewOpen(true)
  }

  const publishBulkDrafts = async (keys: string[], sourceDrafts: BulkDraftMap = bulkDrafts) => {
    if (!selectedAccountId || bulkPublishing || keys.length === 0) return
    const changes = keys.map(key => sourceDrafts[key]).filter(Boolean)
    if (!changes.length) return
    setBulkPublishing(true)
    setBulkPublishResults([])
    try {
      const response = await fetch("/api/ads-manager/workspace-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adAccountId: selectedAccountId,
          changes: changes.map(draft => ({ level: draft.level, node: draft.node })),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to publish bulk edits")
      const results = Array.isArray(data.results) ? data.results as BulkPublishResult[] : []
      setBulkPublishResults(results)
      replaceBulkDrafts(removePublishedDrafts(sourceDrafts, results))

      const published = results.filter(result => result.status === "published").length
      const failed = results.length - published
      if (published > 0) {
        clientCache.current.clear()
        await fetchMainData(true)
      }
      if (failed === 0) {
        setBulkReviewOpen(false)
        setBulkStatusOpen(false)
        setActionToast({ kind: "success", message: `Published ${published} draft${published === 1 ? "" : "s"}` })
      } else {
        setActionToast({ kind: "error", message: `${failed} draft${failed === 1 ? "" : "s"} could not be published and remain queued` })
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to publish bulk edits"
      setBulkPublishResults(changes.map(draft => ({
        id: draft.id,
        level: draft.level,
        status: "failed" as const,
        message,
      })))
      setActionToast({ kind: "error", message })
    } finally {
      setBulkPublishing(false)
    }
  }

  const budgetEditItem = (node: Campaign | AdSet, level: "campaign" | "adset"): BulkEditableItem => {
    const hasOwnBudget = node.daily_budget !== undefined || node.lifetime_budget !== undefined
    const parentOwnsBudget = level === "adset"
      ? Boolean(campaigns.find(c => c.id === (node as AdSet).campaign_id)?.daily_budget || campaigns.find(c => c.id === (node as AdSet).campaign_id)?.lifetime_budget)
      : false
    return {
      id: node.id,
      name: node.name,
      status: node.status,
      campaign_id: level === "adset" ? (node as AdSet).campaign_id : undefined,
      daily_budget: node.daily_budget,
      lifetime_budget: node.lifetime_budget,
      budgetEligible: hasOwnBudget && !parentOwnsBudget,
    }
  }

  const handleSaveBudgetDraft = (node: Campaign | AdSet, level: "campaign" | "adset", amountMajor: number) => {
    const nextDrafts = stageBudgetDrafts(bulkDrafts, level, [budgetEditItem(node, level)], amountMajor)
    replaceBulkDrafts(nextDrafts)
    setActionToast({ kind: "success", message: `Saved budget draft for ${node.name}` })
  }

  const handlePublishBudget = async (node: Campaign | AdSet, level: "campaign" | "adset", amountMajor: number) => {
    const nextDrafts = stageBudgetDrafts(bulkDrafts, level, [budgetEditItem(node, level)], amountMajor)
    const key = bulkDraftKey(level, node.id)
    replaceBulkDrafts(nextDrafts)
    await publishBulkDrafts([key], nextDrafts)
  }

  // Totals
  const totalResultsCount = useMemo(() => currentData.reduce((sum, item) => {
    const objective = tab === "campaigns"
      ? (item as Campaign).objective
      : campaigns.find(c => c.id === (item as AdSet | Ad).campaign_id)?.objective
    return sum + getResults(item, objective).count
  }, 0), [currentData, tab, campaigns])

  // Aggregate every insight metric across the current rows for the totals footer.
  const agg = useMemo(() => {
    const t = {
      spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, uniqueClicks: 0, uniqueLinkClicks: 0,
      purchases: 0, purchaseValue: 0, addToCart: 0, initiateCheckout: 0, leads: 0,
      landingPageViews: 0, contentViews: 0, video3s: 0,
      dailyBudget: 0, lifetimeBudget: 0, watchWeighted: 0, watchImp: 0,
    }
    for (const item of currentData) {
      t.dailyBudget    += parseFloat((item as any).daily_budget || "0") || 0
      t.lifetimeBudget += parseFloat((item as any).lifetime_budget || "0") || 0
      const ins = getInsight(item)
      if (!ins) continue
      const imp = parseFloat(ins.impressions || "0") || 0
      t.spend        += parseFloat(ins.spend || "0") || 0
      t.impressions  += imp
      t.reach        += parseFloat(ins.reach || "0") || 0
      t.clicks       += parseFloat(ins.clicks || "0") || 0
      t.linkClicks   += parseFloat(ins.inline_link_clicks || "0") || 0
      t.uniqueClicks += parseFloat(ins.unique_clicks || "0") || 0
      t.uniqueLinkClicks += parseFloat(ins.unique_inline_link_clicks || "0") || 0
      t.purchases        += getActionCount(ins, "omni_purchase")
      t.purchaseValue    += getActionValueAmount(ins, "omni_purchase")
      t.addToCart        += getActionCount(ins, "add_to_cart")
      t.initiateCheckout += getActionCount(ins, "initiate_checkout")
      t.leads            += getActionCount(ins, "lead")
      t.landingPageViews += getActionCount(ins, "landing_page_view")
      t.contentViews     += getActionCount(ins, "view_content")
      t.video3s          += getActionCount(ins, "video_view")
      const w = parseFloat(ins.video_avg_time_watched_actions?.find(a => a.action_type === "video_view")?.value
        ?? ins.video_avg_time_watched_actions?.[0]?.value ?? "0") || 0
      if (w > 0) { t.watchWeighted += w * (imp || 1); t.watchImp += (imp || 1) }
    }
    return t
  }, [currentData])

  // Footer cell: Total / Average / Per 1,000 Impressions / Per Meta account / Per Action.
  function renderTotalCell(colId: string) {
    const money = (v: number) => fmtMoney(v)
    const num = (v: number) => v > 0 ? Math.round(v).toLocaleString() : "—"
    const cell = (value: string, label: string) => (
      <>
        <span className="text-sm font-semibold tabular-nums">{value}</span>
        <p className="text-xs text-muted-foreground font-normal">{label}</p>
      </>
    )
    const avg = (n: number, d: number, fmt: (x: number) => string) => d > 0 ? fmt(n / d) : "—"
    const acctSpend = parseFloat(accountSummary?.spend || "0") || agg.spend
    const acctImpressions = parseFloat(accountSummary?.impressions || "0") || agg.impressions
    const acctClicks = parseFloat(accountSummary?.clicks || "0") || agg.clicks
    const acctReach = parseFloat(accountSummary?.reach || "0") || agg.reach
    const acctUniqueClicks = parseFloat(accountSummary?.unique_clicks || "0") || agg.uniqueClicks
    const acctUniqueLinkClicks = parseFloat(accountSummary?.unique_inline_link_clicks || "0") || agg.uniqueLinkClicks
    const acctFrequency = parseFloat(accountSummary?.frequency || "0") || (acctReach > 0 ? acctImpressions / acctReach : 0)
    switch (colId) {
      case "spend":              return cell(money(agg.spend), "Total spent")
      case "results":            return cell(totalResultsCount > 0 ? totalResultsCount.toLocaleString() : "—", "Total")
      case "cost_per_result":    return cell(avg(agg.spend, totalResultsCount, money), "Per Action")
      case "budget":             return null
      case "lifetime_budget":    return cell(agg.lifetimeBudget > 0 ? money(agg.lifetimeBudget) : "—", "Total")
      case "purchases":          return cell(num(agg.purchases), "Total")
      case "purchase_value":     return cell(agg.purchaseValue > 0 ? money(agg.purchaseValue) : "—", "Total")
      case "avg_order_value":    return cell(avg(agg.purchaseValue, agg.purchases, money), "Average")
      case "roas":               return cell(agg.spend > 0 ? `${(agg.purchaseValue / agg.spend).toFixed(2)}x` : "—", "Average")
      case "cost_per_purchase":  return cell(avg(agg.spend, agg.purchases, money), "Per Action")
      case "cost_per_lead":      return cell(avg(agg.spend, agg.leads, money), "Per Action")
      case "impressions":        return cell(num(agg.impressions), "Total")
      case "reach":              return cell(num(agg.reach), "Per Meta account")
      case "cpm":                return cell(agg.impressions > 0 ? money(agg.spend / agg.impressions * 1000) : "—", "Per 1,000 Impressions")
      case "frequency":          return cell(acctFrequency > 0 ? acctFrequency.toFixed(2) : "—", "Per Meta account")
      case "clicks":             return cell(num(agg.clicks), "Total")
      case "ctr":                return cell(acctImpressions > 0 ? fmtPct((acctClicks / acctImpressions * 100)) : "—", "Per 1,000 Impressions")
      case "cpc":                return cell(avg(agg.spend, agg.clicks, money), "Average")
      case "link_clicks":        return cell(num(agg.linkClicks), "Total")
      case "unique_clicks":      return cell(num(acctUniqueClicks), "Per Meta account")
      case "unique_link_clicks": return cell(num(acctUniqueLinkClicks), "Per Meta account")
      case "unique_link_ctr":    return cell(acctReach > 0 ? fmtPct((acctUniqueLinkClicks / acctReach * 100)) : "—", "Per Meta account")
      case "cost_per_link_click":return cell(avg(agg.spend, agg.linkClicks, money), "Per Action")
      case "cost_per_unique_click": return cell(avg(acctSpend, acctUniqueClicks, money), "Per Meta account")
      case "landing_page_views": return cell(num(agg.landingPageViews), "Total")
      case "lpv_rate":           return cell(agg.linkClicks > 0 ? fmtPct(Math.min(100, agg.landingPageViews / agg.linkClicks * 100)) : "—", "Average")
      case "content_views":      return cell(num(agg.contentViews), "Total")
      case "add_to_cart":        return cell(num(agg.addToCart), "Total")
      case "cost_per_add_to_cart": return cell(avg(agg.spend, agg.addToCart, money), "Per Action")
      case "initiate_checkout":  return cell(num(agg.initiateCheckout), "Total")
      case "cost_per_initiate_checkout": return cell(avg(agg.spend, agg.initiateCheckout, money), "Per Action")
      case "leads":              return cell(num(agg.leads), "Total")
      case "purchase_conv_rate": return cell(agg.linkClicks > 0 ? fmtPct((agg.purchases / agg.linkClicks * 100)) : "—", "Average")
      case "video_views_3s":     return cell(num(agg.video3s), "Total")
      case "avg_watch_time":     return cell(agg.watchImp > 0 ? fmtWatch(agg.watchWeighted / agg.watchImp) : "—", "Average")
      default:                   return null
    }
  }

  const allSelected = pagedData.length > 0 && pagedData.every(r => selectedIds.has(r.id))
  const someSelected = !allSelected && pagedData.some(r => selectedIds.has(r.id))
  const toggleAll = () => {
    const visible = pagedData.map(r => r.id)
    // Union / subtract rather than replace: the header checkbox governs the rows on
    // screen, and must not quietly discard a selection a filter is hiding.
    setSelectedIds(prev => {
      const s = new Set(prev)
      for (const id of visible) allSelected ? s.delete(id) : s.add(id)
      return s
    })
    setAnchorIdByTab(prev => ({ ...prev, [tab]: null }))
  }

  // Header checkbox ref for indeterminate state
  const headerCheckRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (headerCheckRef.current) headerCheckRef.current.indeterminate = someSelected
  }, [someSelected])

  function exportTable() {
    const list = selectedIds.size > 0
      ? currentData.filter(item => selectedIds.has(item.id))
      : currentData

    if (list.length === 0) return

    const rows = list.map(item => {
      const ins = getInsight(item)
      const spend = getSpend(item)
      const objective =
        tab === "campaigns" ? (item as Campaign).objective
        : tab === "adsets"  ? campaigns.find(c => c.id === (item as AdSet).campaign_id)?.objective
        :                     campaigns.find(c => c.id === (item as Ad).campaign_id)?.objective

      const row: Record<string, string | number> = {
        "Name": item.name,
        "ID": item.id,
      }

      for (const colId of columnOrder) {
        const colDef = customColumnMap[colId]
        if (!colDef) continue
        const label = colDef.headerLabel

        let val: string | number = "—"
        const customMetric = customMetricById.get(colId)
        if (customMetric) {
          val = formatCustomMetric(evalCustomMetric(customMetric.formula, id => resolveMetricNumber(id, ins, item, objective)), customMetric.format)
          row[label] = val
          continue
        }
        switch (colId) {
          case "spend":
            val = ins ? fmtMoney(spend) : "—"
            break
          case "results": {
            const { count } = getResults(item, objective)
            val = ins ? count : "—"
            break
          }
          case "cost_per_result": {
            const cpr = getCostPerResult(item, objective)
            val = cpr || "—"
            break
          }
          case "budget": {
            const daily = (item as any).daily_budget
            val = daily ? fmtBudget(daily) : "Using ad set budget"
            break
          }
          case "lifetime_budget":
            val = (item as any).lifetime_budget ? fmtBudget((item as any).lifetime_budget) : "—"
            break
          case "delivery":
          case "effective_status":
            val = item.effective_status
            break
          case "impressions":
            val = ins?.impressions ? parseInt(ins.impressions) : "—"
            break
          case "clicks":
            val = ins?.clicks ? parseInt(ins.clicks) : "—"
            break
          case "reach":
            val = ins?.reach ? parseInt(ins.reach) : "—"
            break
          case "cpm":
            if (ins && ins.impressions && parseFloat(ins.impressions) > 0) {
              val = fmtMoney(((parseFloat(ins.spend || "0") / parseFloat(ins.impressions)) * 1000))
            }
            break
          case "frequency":
            if (ins?.frequency) val = parseFloat(ins.frequency).toFixed(2)
            else if (ins?.impressions && ins?.reach) val = (parseFloat(ins.impressions) / parseFloat(ins.reach)).toFixed(2)
            break
          case "ctr":
            if (ins?.ctr) val = fmtPct(parseFloat(ins.ctr))
            else if (ins?.clicks && ins?.impressions && parseFloat(ins.impressions) > 0) val = fmtPct(((parseFloat(ins.clicks) / parseFloat(ins.impressions)) * 100))
            break
          case "cpc":
            if (ins?.clicks && parseFloat(ins.clicks) > 0) val = fmtMoney((spend / parseFloat(ins.clicks)))
            break
          case "link_clicks":
            val = ins?.inline_link_clicks ? parseInt(ins.inline_link_clicks) : "—"
            break
          case "unique_clicks":
            val = ins?.unique_clicks ? parseInt(ins.unique_clicks) : "—"
            break
          case "unique_link_clicks":
            val = ins?.unique_inline_link_clicks ? parseInt(ins.unique_inline_link_clicks) : "—"
            break
          case "unique_link_ctr":
            if (ins?.unique_link_clicks_ctr) val = fmtPct(parseFloat(ins.unique_link_clicks_ctr))
            else if (ins?.unique_inline_link_clicks && ins?.reach && parseFloat(ins.reach) > 0) val = fmtPct(((parseFloat(ins.unique_inline_link_clicks) / parseFloat(ins.reach)) * 100))
            break
          case "cost_per_unique_click":
            if (ins?.unique_clicks && parseFloat(ins.unique_clicks) > 0) val = fmtMoney((spend / parseFloat(ins.unique_clicks)))
            break
          case "cost_per_link_click":
            if (ins?.inline_link_clicks && parseFloat(ins.inline_link_clicks) > 0) val = fmtMoney((spend / parseFloat(ins.inline_link_clicks)))
            break
          case "landing_page_views":
            val = getActionValue(ins, "landing_page_view") || "—"
            break
          case "lpv_rate": {
            const lpv = getActionValue(ins, "landing_page_view")
            const lc = parseFloat(ins?.inline_link_clicks || "0")
            if (lpv && lc > 0) val = fmtPct(((lpv / lc) * 100))
            break
          }
          case "content_views":
            val = getActionValue(ins, "view_content") || "—"
            break
          case "add_to_cart":
            val = getActionValue(ins, "add_to_cart") || "—"
            break
          case "cost_per_add_to_cart": {
            const atc = getActionValue(ins, "add_to_cart")
            if (atc > 0) val = fmtMoney((spend / atc))
            break
          }
          case "initiate_checkout":
            val = getActionValue(ins, "initiate_checkout") || "—"
            break
          case "cost_per_initiate_checkout": {
            const ic = getActionValue(ins, "initiate_checkout")
            if (ic > 0) val = fmtMoney((spend / ic))
            break
          }
          case "leads":
            val = getActionValue(ins, "lead") || "—"
            break
          case "cost_per_lead": {
            const lead = getActionValue(ins, "lead")
            if (lead > 0) val = fmtMoney((spend / lead))
            break
          }
          case "purchases":
            val = getActionValue(ins, "omni_purchase") || "—"
            break
          case "purchase_value":
            val = formatMoneyAmount(getActionValueAmount(ins, "omni_purchase"))
            break
          case "roas": {
            const pVal = getActionValueAmount(ins, "omni_purchase")
            if (spend > 0 && pVal > 0) val = `${(pVal / spend).toFixed(2)}x`
            break
          }
          case "cost_per_purchase": {
            const pur = getActionValue(ins, "omni_purchase")
            if (pur > 0) val = fmtMoney((spend / pur))
            break
          }
          case "avg_order_value": {
            const pur = getActionValue(ins, "omni_purchase")
            const pVal = getActionValueAmount(ins, "omni_purchase")
            if (pur > 0 && pVal > 0) val = fmtMoney((pVal / pur))
            break
          }
          case "purchase_conv_rate": {
            const pur = getActionValue(ins, "omni_purchase")
            const cl = parseFloat(ins?.clicks || "0")
            if (cl > 0) val = fmtPct(((pur / cl) * 100))
            break
          }
          case "avg_watch_time": {
            const sec = parseFloat(ins?.video_avg_time_watched_actions?.[0]?.value || "0")
            if (sec > 0) val = sec.toFixed(1)
            break
          }
          case "video_views_3s":
            val = getActionValue(ins, "video_view") || "—"
            break
          case "video_25":
            val = getActionValue(ins, "video_p25_watched_actions") || "—"
            break
          case "video_50":
            val = getActionValue(ins, "video_p50_watched_actions") || "—"
            break
          case "video_75":
            val = getActionValue(ins, "video_p75_watched_actions") || "—"
            break
          case "video_100":
            val = getActionValue(ins, "video_p100_watched_actions") || "—"
            break
          case "schedule_start":
            val = fmtDate((item as any).start_time)
            break
          case "schedule_end":
            val = fmtDate((item as any).stop_time || (item as any).end_time)
            break
          case "optimization_goal":
            val = (item as AdSet).optimization_goal || "—"
            break
          case "bid_strategy":
            val = (item as any).bid_strategy ?? (item as Ad).adset?.bid_strategy ?? "—"
            break
          case "objective":
            val = objective || "—"
            break
          case "attribution_setting": {
            if (tab === "campaigns") {
              const kids = adSets.filter(a => a.campaign_id === item.id)
              const labels = Array.from(new Set(kids.map(k => formatAttributionSpec(k.attribution_spec))))
              val = labels.length === 1 ? labels[0] : labels.length > 1 ? "Multiple" : "7-day click or 1-day view"
            } else {
              const spec = (item as any).attribution_spec ?? (item as Ad).adset?.attribution_spec ?? (item as any).attributionSetting ?? (item as any).metrics?.attributionSetting
              val = formatAttributionSpec(spec)
            }
            break
          }
        }
        row[label] = val
      }
      return row
    })

    downloadCsv(`${tab}_export.csv`, rows)
  }

  // ─── Config-driven cell renderer ─────────────────────────────────────────────

  function getActionValue(ins: Insight | null, actionType: string): number {
    return getActionCount(ins, actionType)
  }

  function resolveMetricNumberWithSpend(metricId: string, ins: Insight | null, spend: number, objective?: string, row?: Campaign | AdSet | Ad): number | null {
    switch (metricId) {
      case "spend": return spend
      case "results": {
        if (!ins?.actions) return 0
        const obj = OBJECTIVE_RESULT[objective || ""]
        return obj ? getActionCount(ins, obj.actionType) : parseInt(ins.actions[0]?.value || "0")
      }
      case "cost_per_result": { const count = resolveMetricNumberWithSpend("results", ins, spend, objective, row); return count ? spend / count : null }
      case "budget": return row ? parseFloat((row as any).daily_budget || (row as any).lifetime_budget || "0") / 100 : null
      case "lifetime_budget": return row ? parseFloat((row as any).lifetime_budget || "0") / 100 : null
      case "budget_remaining": return row ? parseFloat((row as any).budget_remaining || "0") / 100 : null
      case "impressions": return parseFloat(ins?.impressions || "0")
      case "reach": return parseFloat(ins?.reach || "0")
      case "clicks": return parseFloat(ins?.clicks || "0")
      case "link_clicks": return parseFloat(ins?.inline_link_clicks || "0")
      case "unique_clicks": return parseFloat(ins?.unique_clicks || "0")
      case "unique_link_clicks": return parseFloat(ins?.unique_inline_link_clicks || "0")
      case "purchases": return getActionValue(ins, "omni_purchase")
      case "purchase_value": return getActionValueAmount(ins, "omni_purchase")
      case "add_to_cart": return getActionValue(ins, "add_to_cart")
      case "initiate_checkout": return getActionValue(ins, "initiate_checkout")
      case "leads": return getActionValue(ins, "lead")
      case "landing_page_views": return getActionValue(ins, "landing_page_view")
      case "content_views": return getActionValue(ins, "view_content")
      case "video_views_3s": return getActionValue(ins, "video_view")
      case "post_engagements": return getActionValue(ins, "post_engagement")
      case "cpm": { const imp = parseFloat(ins?.impressions || "0"); return imp ? spend / imp * 1000 : null }
      case "cpc": { const cl = parseFloat(ins?.clicks || "0"); return cl ? spend / cl : null }
      case "ctr": { const imp = parseFloat(ins?.impressions || "0"); return imp ? parseFloat(ins?.clicks || "0") / imp : null }
      case "cost_per_link_click": { const lc = parseFloat(ins?.inline_link_clicks || "0"); return lc ? spend / lc : null }
      case "cost_per_unique_click": { const uc = parseFloat(ins?.unique_clicks || "0"); return uc ? spend / uc : null }
      case "unique_link_ctr": { const r = parseFloat(ins?.reach || "0"); return r ? parseFloat(ins?.unique_inline_link_clicks || "0") / r : null }
      case "frequency": return parseFloat(ins?.frequency || "0")
      case "roas": { const v = getActionValueAmount(ins, "omni_purchase"); return spend ? v / spend : null }
      case "cost_per_purchase": { const p = getActionValue(ins, "omni_purchase"); return p ? spend / p : null }
      case "avg_order_value": { const p = getActionValue(ins, "omni_purchase"); const v = getActionValueAmount(ins, "omni_purchase"); return p ? v / p : null }
      case "cost_per_lead": { const l = getActionValue(ins, "lead"); return l ? spend / l : null }
      case "cost_per_add_to_cart": { const a = getActionValue(ins, "add_to_cart"); return a ? spend / a : null }
      case "cost_per_initiate_checkout": { const c = getActionValue(ins, "initiate_checkout"); return c ? spend / c : null }
      case "purchase_conv_rate": { const cl = parseFloat(ins?.clicks || "0"); const p = getActionValue(ins, "omni_purchase"); return cl ? p / cl : null }
      case "lpv_rate": { const lc = parseFloat(ins?.inline_link_clicks || "0"); const lpv = getActionValue(ins, "landing_page_view"); return lc ? lpv / lc : null }
      case "video_25": return getActionValue(ins, "video_p25_watched_actions")
      case "video_50": return getActionValue(ins, "video_p50_watched_actions")
      case "video_75": return getActionValue(ins, "video_p75_watched_actions")
      case "video_100": return getActionValue(ins, "video_p100_watched_actions")
      case "avg_watch_time": return getActionValue(ins, "video_avg_time_watched_actions")
      default: return null
    }
  }

  function resolveMetricNumber(metricId: string, ins: Insight | null, row: Campaign | AdSet | Ad, objective?: string): number | null {
    return resolveMetricNumberWithSpend(metricId, ins, getSpend(row), objective, row)
  }

  function resolveBreakdownMetricNumber(metricId: string, ins: Insight | null, objective?: string): number | null {
    return resolveMetricNumberWithSpend(metricId, ins, parseFloat(ins?.spend || "0"), objective)
  }

  function sortValue(field: string, row: Campaign | AdSet | Ad): number | string | null {
    const r = row as any
    switch (field) {
      case "name": return r.name ?? ""
      case "delivery":
      case "effective_status": return (r.effective_status || r.status || "").toString()
      case "objective": return (r.objective || "").toString()
      case "bid_strategy": return (r.bid_strategy || "").toString()
      case "buying_type": return (r.buying_type || "").toString()
      case "optimization_goal": return (r.optimization_goal || "").toString()
      case "attribution_setting": return (r.attribution_setting || "").toString()
      case "schedule_start": return r.start_time || r.start || ""
      case "schedule_end": return r.end_time || r.end || ""
      case "date_created": return r.created_time || ""
      case "updated_time": return r.updated_time || ""
      case "account_id": return (r.account_id || "").toString()
      case "results": {
        const obj = tab === "campaigns" ? r.objective : campaigns.find(c => c.id === r.campaign_id)?.objective
        return getResults(row, obj).count
      }
      default: {
        const obj = tab === "campaigns" ? r.objective : campaigns.find(c => c.id === r.campaign_id)?.objective
        const customMetric = customMetricById.get(field)
        if (customMetric) return evalCustomMetric(customMetric.formula, id => resolveMetricNumber(id, getInsight(row), row, obj))
        return resolveMetricNumber(field, getInsight(row), row, obj)
      }
    }
  }

  function sortBreakdownValue(field: string, row: BreakdownRow, objective?: string): number | string | null {
    if (field === "name") return row.breakdownLabel
    if (["schedule_start", "schedule_end", "date_created", "updated_time"].includes(field)) return (row as any).dateStart || ""
    const customMetric = customMetricById.get(field)
    if (customMetric) return evalCustomMetric(customMetric.formula, id => resolveBreakdownMetricNumber(id, row.ins, objective))
    return resolveBreakdownMetricNumber(field, row.ins, objective)
  }

  function sortedBreakdownRows(parentId: string, objective?: string) {
    const rows = breakdowns.length > 0 ? breakdownRows.filter(br => br.parentId === parentId) : []
    if (!sortField) return rows
    return [...rows].sort((a, b) => {
      const av = sortBreakdownValue(sortField, a, objective)
      const bv = sortBreakdownValue(sortField, b, objective)
      if (typeof av === "string" || typeof bv === "string") {
        const as = String(av ?? ""), bs = String(bv ?? "")
        return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as)
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }

  const formatCustomMetric = (value: number | null, format: CustomMetricConfig["format"]) => value == null
    ? "—"
    : format === "currency" ? fmtMoney(value)
    : format === "percentage" ? fmtPct(value * 100)
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 })

  function renderCellContent(colId: string, row: Campaign | AdSet | Ad) {
    const ins   = getInsight(row)
    const spend = getSpend(row)
    const objective =
      tab === "campaigns" ? (row as Campaign).objective
      : tab === "adsets"  ? campaigns.find(c => c.id === (row as AdSet).campaign_id)?.objective
      :                     campaigns.find(c => c.id === (row as Ad).campaign_id)?.objective
    const customMetric = customMetricById.get(colId)
    if (customMetric) {
      const value = evalCustomMetric(customMetric.formula, id => resolveMetricNumber(id, ins, row, objective))
      return <span className="text-sm font-medium tabular-nums leading-5">{formatCustomMetric(value, customMetric.format)}</span>
    }

    switch (colId) {
      case "spend":
        return <SpendHoverValue row={row} spend={spend} hasInsights={Boolean(ins)} onOpenCharts={() => openCharts(row)} accountId={selectedAccountId || ""} level={level} datePreset={datePreset} since={drawerSince} until={drawerUntil} />

      case "results": {
        const { count, type } = getResults(row, objective)
        return <>
          <span className="text-sm font-medium tabular-nums leading-5 font-semibold text-[#1c2b33] dark:text-white">{ins ? count : "—"}</span>
          {ins && <p className="text-xs text-[#65676b]">{type}</p>}
        </>
      }

      case "cost_per_result": {
        const { type } = getResults(row, objective)
        const cpr = getCostPerResult(row, objective)
        return <>
          <span className="text-sm font-medium tabular-nums leading-5">{cpr || "—"}</span>
          {cpr && <p className="text-xs text-[#65676b]">Per {type}</p>}
        </>
      }

      case "budget": {
        const daily = (row as any).daily_budget
        const lifetime = (row as any).lifetime_budget
        const key = bulkDraftKey(level, row.id)
        const draft = bulkDrafts[key]
        const displayDaily = draft?.node.daily_budget ?? daily
        const displayLifetime = draft?.node.lifetime_budget ?? lifetime

        if (tab === "campaigns") {
          const campaign = row as Campaign
          const budgetEligible = Boolean(daily || lifetime)
          if (budgetEligible) {
            return (
              <BudgetQuickEditCell
                targetNode={campaign}
                targetLevel="campaign"
                displayMinor={displayDaily ?? displayLifetime}
                displayType={displayDaily !== undefined ? "Daily" : "Lifetime"}
                canMutate={workspaceAccess.canMutate}
                publishing={bulkPublishing}
                onSaveDraft={handleSaveBudgetDraft}
                onPublish={handlePublishBudget}
              />
            )
          }
        }
        if (tab === "adsets") {
          const adSet = row as AdSet
          const campaign = campaigns.find(c => c.id === adSet.campaign_id)
          const budgetEligible = Boolean(daily || lifetime) && !Boolean(campaign?.daily_budget || campaign?.lifetime_budget)
          if (budgetEligible) {
            return (
              <BudgetQuickEditCell
                targetNode={adSet}
                targetLevel="adset"
                displayMinor={displayDaily ?? displayLifetime}
                displayType={displayDaily !== undefined ? "Daily" : "Lifetime"}
                canMutate={workspaceAccess.canMutate}
                publishing={bulkPublishing}
                onSaveDraft={handleSaveBudgetDraft}
                onPublish={handlePublishBudget}
              />
            )
          }
        }
        if (tab === "ads") {
          const ad = row as Ad
          const adSet = adSets.find(as => as.id === ad.adset_id)
          if (adSet) {
            const campaign = campaigns.find(c => c.id === adSet.campaign_id)
            const adsetDaily = adSet.daily_budget
            const adsetLifetime = adSet.lifetime_budget
            const adsetBudgetEligible = Boolean(adsetDaily || adsetLifetime) && !Boolean(campaign?.daily_budget || campaign?.lifetime_budget)
            const adsetDraft = bulkDrafts[bulkDraftKey("adset", adSet.id)]
            const adsetDisplayDaily = adsetDraft?.node.daily_budget ?? adsetDaily
            const adsetDisplayLifetime = adsetDraft?.node.lifetime_budget ?? adsetLifetime

            if (adsetBudgetEligible) {
              return (
                <BudgetQuickEditCell
                  targetNode={adSet}
                  targetLevel="adset"
                  displayMinor={adsetDisplayDaily ?? adsetDisplayLifetime}
                  displayType={adsetDisplayDaily !== undefined ? "Daily" : "Lifetime"}
                  canMutate={workspaceAccess.canMutate}
                  publishing={bulkPublishing}
                  onSaveDraft={handleSaveBudgetDraft}
                  onPublish={handlePublishBudget}
                />
              )
            }
          }
        }
        if (daily) {
          return (
            <>
              <span className="text-sm font-medium tabular-nums leading-5">{fmtBudget(daily)}</span>
              <p className="text-xs text-[#65676b]">Daily</p>
            </>
          )
        }
        if (lifetime) {
          return (
            <>
              <span className="text-sm font-medium tabular-nums leading-5">{fmtBudget(lifetime)}</span>
              <p className="text-[#65676b] text-xs">Lifetime</p>
            </>
          )
        }
        return <span className="text-xs text-[#65676b]">Using ad set budget</span>
      }

      case "lifetime_budget":
        return <span className="text-sm font-medium tabular-nums leading-5">{(row as any).lifetime_budget ? fmtBudget((row as any).lifetime_budget) : "—"}</span>

      case "delivery": {
        let budgetRemaining: string | undefined = (row as any).budget_remaining
        // Learning is an ad-set-level delivery state; ads inherit it from their parent ad set.
        let learning: LearningStageInfo | undefined
        let allAdsOff = false
        if (tab === "adsets") {
          const adset = row as AdSet
          learning = adset.learning_stage_info
          // CBO adsets have no budget of their own — inherit from parent campaign
          if (!adset.daily_budget && !adset.lifetime_budget) {
            const parentCampaign = campaigns.find(c => c.id === adset.campaign_id)
            budgetRemaining = parentCampaign?.budget_remaining
          }
          const adsetAds = ads.filter(ad => ad.adset_id === adset.id)
          const hasActiveAds = adSetHasActiveAds[adset.id] ?? (adsetAds.length > 0 ? adsetAds.some(ad => ad.effective_status === "ACTIVE") : undefined)
          allAdsOff = hasActiveAds === false
        } else if (tab === "ads") {
          // Ads don't show budget status — delivery is based solely on their own effective_status
          budgetRemaining = undefined
          learning = (row as Ad).adset?.learning_stage_info
        }
        return <DeliveryBadge effective_status={row.effective_status} budget_remaining={budgetRemaining} learning={learning} allAdsOff={allAdsOff} />
      }

      case "effective_status":
        return <span className="text-xs">{row.effective_status.charAt(0) + row.effective_status.slice(1).toLowerCase()}</span>

      case "impressions":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins?.impressions ? parseInt(ins.impressions).toLocaleString() : "—"}</span>

      case "clicks":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins?.clicks ? parseInt(ins.clicks).toLocaleString() : "—"}</span>

      case "reach":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins?.reach ? parseInt(ins.reach).toLocaleString() : "—"}</span>

      case "cpm": {
        if (!ins || !ins.impressions || parseFloat(ins.impressions) === 0) return <span className="text-xs">—</span>
        const cpmVal = (parseFloat(ins.spend || "0") / parseFloat(ins.impressions)) * 1000
        return <span className="text-sm font-medium tabular-nums leading-5">{fmtMoney(cpmVal)}</span>
      }

      case "frequency": {
        if (ins?.frequency != null && ins.frequency !== "") {
          return <span className="text-sm font-medium tabular-nums leading-5">{parseFloat(ins.frequency).toFixed(2)}</span>
        }
        const imp = parseFloat(ins?.impressions || "0")
        const rch = parseFloat(ins?.reach || "0")
        if (!imp || !rch) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{(imp / rch).toFixed(2)}</span>
      }

      case "ctr": {
        if (!ins || !ins.impressions || parseFloat(ins.impressions) === 0) return <span className="text-xs">—</span>
        const ctrVal = ins.ctr != null && ins.ctr !== ""
          ? parseFloat(ins.ctr)
          : (parseFloat(ins.clicks || "0") / parseFloat(ins.impressions)) * 100
        return <span className="text-sm font-medium tabular-nums leading-5">{ctrVal.toFixed(2)}%</span>
      }

      case "cpc": {
        if (!ins || !ins.clicks || parseFloat(ins.clicks) === 0) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{fmtMoney((spend / parseFloat(ins.clicks)))}</span>
      }

      case "link_clicks": {
        const n = parseInt(ins?.inline_link_clicks || "0")
        return <span className="text-sm font-medium tabular-nums leading-5">{n ? n.toLocaleString() : "—"}</span>
      }

      case "unique_clicks": {
        const n = parseInt(ins?.unique_clicks || "0")
        return <span className="text-sm font-medium tabular-nums leading-5">{n ? n.toLocaleString() : "—"}</span>
      }

      case "unique_link_clicks": {
        const n = parseInt(ins?.unique_inline_link_clicks || "0")
        return <span className="text-sm font-medium tabular-nums leading-5">{n ? n.toLocaleString() : "—"}</span>
      }

      case "unique_link_ctr": {
        if (ins?.unique_link_clicks_ctr != null && ins.unique_link_clicks_ctr !== "") {
          return <span className="text-sm font-medium tabular-nums leading-5">{parseFloat(ins.unique_link_clicks_ctr).toFixed(2)}%</span>
        }
        const rch = parseFloat(ins?.reach || "0")
        const ulc = parseFloat(ins?.unique_inline_link_clicks || "0")
        if (!rch || !ulc) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{((ulc / rch) * 100).toFixed(2)}%</span>
      }

      case "cost_per_unique_click": {
        const n = parseFloat(ins?.unique_clicks || "0")
        if (!n) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{fmtMoney((spend / n))}</span>
      }

      case "cost_per_link_click": {
        const n = parseFloat(ins?.inline_link_clicks || "0")
        if (!n) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{fmtMoney((spend / n))}</span>
      }

      case "landing_page_views": {
        const n = getActionValue(ins, "landing_page_view")
        return <span className="text-sm font-medium tabular-nums leading-5">{n || "—"}</span>
      }

      case "lpv_rate": {
        const lpv = getActionValue(ins, "landing_page_view")
        const lc = parseFloat(ins?.inline_link_clicks || "0")
        if (!lpv || !lc) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{((lpv / lc) * 100).toFixed(2)}%</span>
      }

      case "content_views": {
        const n = getActionValue(ins, "view_content")
        return <span className="text-sm font-medium tabular-nums leading-5">{n || "—"}</span>
      }

      case "cost_per_add_to_cart": {
        const n = getActionValue(ins, "add_to_cart")
        if (!n) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{fmtMoney((spend / n))}</span>
      }

      case "initiate_checkout": {
        const n = getActionValue(ins, "initiate_checkout")
        return <span className="text-sm font-medium tabular-nums leading-5">{n || "—"}</span>
      }

      case "cost_per_initiate_checkout": {
        const n = getActionValue(ins, "initiate_checkout")
        if (!n) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{fmtMoney((spend / n))}</span>
      }

      case "avg_watch_time": {
        const arr = ins?.video_avg_time_watched_actions
        const sec = arr?.[0] ? parseFloat(arr[0].value || "0") : 0
        if (!sec) return <span className="text-xs">—</span>
        const s = Math.round(sec)
        const mm = Math.floor(s / 60)
        const rr = s % 60
        return <span className="text-sm font-medium tabular-nums leading-5">{mm > 0 ? `${mm}:${String(rr).padStart(2, "0")}` : `0:${String(rr).padStart(2, "0")}`}</span>
      }

      case "purchases":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins ? getActionValue(ins, "omni_purchase") : "—"}</span>

      case "purchase_value": {
        const value = getActionValueAmount(ins, "omni_purchase")
        return <span className="text-sm font-medium tabular-nums leading-5">{formatMoneyAmount(value)}</span>
      }

      case "avg_order_value": {
        const purchasesN = getActionValue(ins, "omni_purchase")
        const purchaseValue = getActionValueAmount(ins, "omni_purchase")
        if (!ins || purchasesN === 0 || purchaseValue === 0) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{fmtMoney((purchaseValue / purchasesN))}</span>
      }

      case "roas": {
        const purchaseValue = getActionValueAmount(ins, "omni_purchase")
        if (!ins || spend === 0 || purchaseValue === 0) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{(purchaseValue / spend).toFixed(2)}x</span>
      }

      case "cost_per_purchase": {
        const p = getActionValue(ins, "omni_purchase")
        if (!ins || p === 0) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{fmtMoney((spend / p))}</span>
      }

      case "cost_per_lead": {
        const l = getActionValue(ins, "lead")
        if (!ins || l === 0) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{fmtMoney((spend / l))}</span>
      }

      case "shopify_score":
        // ponytail: no Shopify data source wired yet — column exists for CSV-order parity.
        // Upgrade: add /api/shopify/score + join by ad/adset/campaign id.
        return <span className="text-sm font-medium tabular-nums leading-5">{(row as any).shopifyScore ?? (row as any).shopify_score ?? "—"}</span>

      case "leads":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins ? getActionValue(ins, "lead") : "—"}</span>

      case "add_to_cart":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins ? getActionValue(ins, "add_to_cart") : "—"}</span>

      case "purchase_conv_rate": {
        const p = getActionValue(ins, "omni_purchase")
        const cl = ins ? parseInt(ins.clicks || "0") : 0
        if (!ins || cl === 0) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{((p / cl) * 100).toFixed(2)}%</span>
      }

      case "video_views_3s":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins ? getActionValue(ins, "video_view") : "—"}</span>
      case "video_25":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins ? getActionValue(ins, "video_p25_watched_actions") : "—"}</span>
      case "video_50":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins ? getActionValue(ins, "video_p50_watched_actions") : "—"}</span>
      case "video_75":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins ? getActionValue(ins, "video_p75_watched_actions") : "—"}</span>
      case "video_100":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins ? getActionValue(ins, "video_p100_watched_actions") : "—"}</span>

      case "schedule_start":
        return <span className="text-xs text-[#65676b]">{fmtDate((row as any).start_time)}</span>
      case "schedule_end":
        return <span className="text-xs text-[#65676b]">{fmtDate((row as any).stop_time || (row as any).end_time)}</span>
      case "optimization_goal":
        return <span className="text-xs text-[#65676b]">{(row as AdSet).optimization_goal?.replace(/_/g, " ").toLowerCase() || "—"}</span>
      case "bid_strategy": {
        // Ads inherit bid_strategy from their parent ad set (fetched via adset{bid_strategy}).
        const raw = (row as any).bid_strategy
          ?? (row as Ad).adset?.bid_strategy
          ?? null
        return <span className="text-xs text-[#65676b]">{formatBidStrategy(raw)}</span>
      }
      case "objective":
        return <span className="text-xs text-[#65676b]">{(row as Campaign).objective?.replace(/OUTCOME_/g, "").replace(/_/g, " ").toLowerCase() || "—"}</span>

      case "attribution_setting": {
        // Ad sets expose attribution_spec; ads inherit via adset{attribution_spec}.
        // Campaigns have no attribution_spec → derive from ALL child ad sets.
        // Multiple distinct → "Multiple" (Meta shows mixed parent as "Multiple").
        const anyRow = row as any
        let label: string | null = null
        if (tab === "campaigns") {
          const kids = adSets.filter(a => a.campaign_id === (row as Campaign).id)
          const labels = Array.from(new Set(kids.map(k => formatAttributionSpec(k.attribution_spec))))
          label = labels.length === 1 ? labels[0] : labels.length > 1 ? "Multiple" : "7-day click or 1-day view"
        } else {
          const spec: AttributionSpecEntry[] | string | undefined =
            anyRow.attribution_spec
            ?? (row as Ad).adset?.attribution_spec
            ?? anyRow.attributionSetting
            ?? anyRow.metrics?.attributionSetting
          label = formatAttributionSpec(spec)
        }
        return <span className="text-xs text-[#65676b]">{label}</span>
      }

      default:
        return <span className="text-xs">—</span>
    }
  }

  function renderBreakdownCell(colId: string, ins: Insight, objective?: string) {
    if (colId === "attribution_setting") return <span className="text-xs">—</span>
    const spend = parseFloat(ins.spend || "0")
    const getVal = (type: string) => getActionCount(ins, type)
    const getValue = (type: string) => getActionValueAmount(ins, type)
    const customMetric = customMetricById.get(colId)
    if (customMetric) {
      const results = OBJECTIVE_RESULT[objective || ""]
      const value = evalCustomMetric(customMetric.formula, id => id === "results" ? (results ? getVal(results.actionType) : null) : resolveMetricNumber(id, ins, {} as any, objective))
      return <span className="text-sm font-medium tabular-nums leading-5">{formatCustomMetric(value, customMetric.format)}</span>
    }
    switch (colId) {
      case "spend":
        return <span className="text-sm font-medium tabular-nums leading-5">{ins.spend ? fmtMoney(spend) : "—"}</span>
      case "results": {
        const obj = OBJECTIVE_RESULT[objective || ""]
        if (!obj) return <span className="text-xs">—</span>
        const count = getVal(obj.actionType)
        return (
          <>
            <span className="text-sm font-medium tabular-nums leading-5 font-semibold">{count || "—"}</span>
            <p className="text-xs text-[#65676b]">{obj.type}</p>
          </>
        )
      }
      case "cost_per_result": {
        const obj = OBJECTIVE_RESULT[objective || ""]
        if (!obj) return <span className="text-xs">—</span>
        const cpa = ins.cost_per_action_type?.find(a => (ACTION_ALIASES[obj.actionType] || [obj.actionType]).includes(a.action_type))
        const count = getVal(obj.actionType)
        const value = cpa ? parseFloat(cpa.value) : (count > 0 ? spend / count : NaN)
        if (!Number.isFinite(value)) return <span className="text-xs">—</span>
        return <><span className="text-sm font-medium tabular-nums leading-5">{fmtMoney(value)}</span><p className="text-xs text-[#65676b]">Per {obj.type}</p></>
      }
      case "impressions": return <span className="text-sm font-medium tabular-nums leading-5">{ins.impressions ? parseInt(ins.impressions).toLocaleString() : "—"}</span>
      case "clicks":      return <span className="text-sm font-medium tabular-nums leading-5">{ins.clicks ? parseInt(ins.clicks).toLocaleString() : "—"}</span>
      case "reach":       return <span className="text-sm font-medium tabular-nums leading-5">{ins.reach ? parseInt(ins.reach).toLocaleString() : "—"}</span>
      case "cpm": {
        if (!ins.impressions || parseFloat(ins.impressions) === 0) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{fmtMoney(((spend / parseFloat(ins.impressions)) * 1000))}</span>
      }
      case "ctr": {
        if (!ins.impressions || parseFloat(ins.impressions) === 0) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{((parseFloat(ins.clicks || "0") / parseFloat(ins.impressions)) * 100).toFixed(2)}%</span>
      }
      case "cpc": {
        if (!ins.clicks || parseFloat(ins.clicks) === 0) return <span className="text-xs">—</span>
        return <span className="text-sm font-medium tabular-nums leading-5">{fmtMoney((spend / parseFloat(ins.clicks)))}</span>
      }
      case "link_clicks":      { const n = parseInt(ins.inline_link_clicks || "0"); return <span className="text-sm font-medium tabular-nums leading-5">{n ? n.toLocaleString() : "—"}</span> }
      case "unique_clicks":    { const n = parseInt(ins.unique_clicks || "0"); return <span className="text-sm font-medium tabular-nums leading-5">{n ? n.toLocaleString() : "—"}</span> }
      case "unique_link_clicks": { const n = parseInt(ins.unique_inline_link_clicks || "0"); return <span className="text-sm font-medium tabular-nums leading-5">{n ? n.toLocaleString() : "—"}</span> }
      case "unique_link_ctr":  { const v = parseFloat(ins.unique_link_clicks_ctr || "0"); return <span className="text-sm font-medium tabular-nums leading-5">{v ? fmtPct(v) : "—"}</span> }
      case "cost_per_unique_click": { const n = parseFloat(ins.unique_clicks || "0"); return <span className="text-sm font-medium tabular-nums leading-5">{n ? fmtMoney((spend/n)) : "—"}</span> }
      case "cost_per_link_click": { const n = parseFloat(ins.inline_link_clicks || "0"); return <span className="text-sm font-medium tabular-nums leading-5">{n ? fmtMoney((spend/n)) : "—"}</span> }
      case "landing_page_views": { const n = getVal("landing_page_view"); return <span className="text-sm font-medium tabular-nums leading-5">{n || "—"}</span> }
      case "lpv_rate":         { const lpv = getVal("landing_page_view"); const lc = parseFloat(ins.inline_link_clicks || "0"); return <span className="text-sm font-medium tabular-nums leading-5">{lpv && lc ? fmtPct(((lpv/lc)*100)) : "—"}</span> }
      case "content_views":    { const n = getVal("view_content"); return <span className="text-sm font-medium tabular-nums leading-5">{n || "—"}</span> }
      case "cost_per_add_to_cart": { const n = getVal("add_to_cart"); return <span className="text-sm font-medium tabular-nums leading-5">{n ? fmtMoney((spend/n)) : "—"}</span> }
      case "initiate_checkout": { const n = getVal("initiate_checkout"); return <span className="text-sm font-medium tabular-nums leading-5">{n || "—"}</span> }
      case "cost_per_initiate_checkout": { const n = getVal("initiate_checkout"); return <span className="text-sm font-medium tabular-nums leading-5">{n ? fmtMoney((spend/n)) : "—"}</span> }
      case "avg_watch_time":   { const sec = parseFloat(ins.video_avg_time_watched_actions?.[0]?.value || "0"); const s = Math.round(sec); const mm = Math.floor(s / 60); const rr = s % 60; return <span className="text-sm font-medium tabular-nums leading-5">{s ? (mm > 0 ? `${mm}:${String(rr).padStart(2, "0")}` : `0:${String(rr).padStart(2, "0")}`) : "—"}</span> }
      case "purchases":        { const p = getVal("omni_purchase"); return <span className="text-sm font-medium tabular-nums leading-5">{p || "—"}</span> }
      case "purchase_value":   { const value = getValue("omni_purchase"); return <span className="text-sm font-medium tabular-nums leading-5">{formatMoneyAmount(value)}</span> }
      case "avg_order_value":  { const p = getVal("omni_purchase"); const value = getValue("omni_purchase"); return <span className="text-sm font-medium tabular-nums leading-5">{p && value ? fmtMoney((value / p)) : "—"}</span> }
      case "roas":             { const value = getValue("omni_purchase"); return <span className="text-sm font-medium tabular-nums leading-5">{spend && value ? `${(value / spend).toFixed(2)}x` : "—"}</span> }
      case "cost_per_purchase":{ const p = getVal("omni_purchase"); return <span className="text-sm font-medium tabular-nums leading-5">{p ? fmtMoney((spend/p)) : "—"}</span> }
      case "leads":            { const l = getVal("lead"); return <span className="text-sm font-medium tabular-nums leading-5">{l || "—"}</span> }
      case "cost_per_lead":    { const l = getVal("lead"); return <span className="text-sm font-medium tabular-nums leading-5">{l ? fmtMoney((spend/l)) : "—"}</span> }
      case "shopify_score":    return <span className="text-sm font-medium tabular-nums leading-5">—</span>
      case "add_to_cart":      { const atc = getVal("add_to_cart"); return <span className="text-sm font-medium tabular-nums leading-5">{atc || "—"}</span> }
      case "video_views_3s":   { const v = getVal("video_view"); return <span className="text-sm font-medium tabular-nums leading-5">{v || "—"}</span> }
      case "video_25":         { const v = getVal("video_p25_watched_actions"); return <span className="text-sm font-medium tabular-nums leading-5">{v || "—"}</span> }
      case "video_50":         { const v = getVal("video_p50_watched_actions"); return <span className="text-sm font-medium tabular-nums leading-5">{v || "—"}</span> }
      case "video_75":         { const v = getVal("video_p75_watched_actions"); return <span className="text-sm font-medium tabular-nums leading-5">{v || "—"}</span> }
      case "video_100":        { const v = getVal("video_p100_watched_actions"); return <span className="text-sm font-medium tabular-nums leading-5">{v || "—"}</span> }
      default: return <span className="text-xs">—</span>
    }
  }

  // ─── Drill-down helpers (click name → single-item filter) ────────────────────

  const drillToAdSets = (campaign: Campaign) => {
    setCampaignFilter(new Set([campaign.id]))
    setAdSetFilter(new Set())
    setPage(1)
    setPageCursors(previous => ({ ...previous, adsets: [undefined] }))
    setSelectedIds(new Set())
    setTab("adsets")
  }
  const drillToAds = (adSet: AdSet) => {
    setAdSetFilter(new Set([adSet.id]))
    setPage(1)
    setPageCursors(previous => ({ ...previous, ads: [undefined] }))
    setSelectedIds(new Set())
    setTab("ads")
  }

  // ─── Tab label + badge helpers ────────────────────────────────────────────────
  // Label changes immediately as user selects items (live preview)

  const tabLabel = (t: Tab) => {
    if (t === "campaigns") return "Campaigns"

    if (t === "adsets") {
      // Live: user is on campaigns tab selecting campaigns
      const n = tab === "campaigns" ? selectedIds.size : campaignFilter.size
      if (n > 0) return `Ad sets for ${n} Campaign${n > 1 ? "s" : ""}`
      return "Ad sets"
    }

    // t === "ads"
    const adSetN = tab === "adsets" ? selectedIds.size : adSetFilter.size
    if (adSetN > 0) return `Ads for ${adSetN} Ad set${adSetN > 1 ? "s" : ""}`
    const campaignN = tab === "campaigns" ? selectedIds.size : campaignFilter.size
    if (campaignN > 0) return `Ads for ${campaignN} Campaign${campaignN > 1 ? "s" : ""}`
    return "Ads"
  }

  // Badge logic:
  //   Current tab  → live selectedIds count (clears selection)
  //   Other tabs   → locked filter count (clears that filter)
  const tabBadge = (t: Tab): { count: number; clear: () => void } | null => {
    if (t === tab && selectedIds.size > 0) {
      return { count: selectedIds.size, clear: () => setSelectedIds(new Set()) }
    }
    if (t === "campaigns" && t !== tab && campaignFilter.size > 0) {
      return {
        count: campaignFilter.size,
        clear: () => {
          setCampaignFilter(new Set())
          setAdSetFilter(new Set())
          setPage(1)
          setPageCursors(previous => ({ ...previous, adsets: [undefined] }))
        },
      }
    }
    if (t === "adsets" && t !== tab && adSetFilter.size > 0) {
      return {
        count: adSetFilter.size,
        clear: () => {
          setAdSetFilter(new Set())
          setPage(1)
          setPageCursors(previous => ({ ...previous, ads: [undefined] }))
        },
      }
    }
    return null
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  const isLoadingAccount = Boolean(selectedAccountId && loadedAccountId !== selectedAccountId)
  const isDataLoading = loading || isLoadingAccount

  return (
    <div className="relative flex flex-col h-full overflow-hidden bg-background">
      <CreateCampaignModal
        open={createModalOpen}
        initialState={createInitialState}
        onClose={() => {
          setCreateModalOpen(false)
          setCreateInitialState(undefined)
        }}
        onSuccess={async (result) => {
          setCreateInitialState(undefined)
          clientCache.current.clear()
          // Campaign and ad sets both go in. On the attach scope the campaign was already running,
          // so its row is not "new" — but it is where the new ad set landed, and the user is
          // usually looking at the campaigns tab when they publish.
          const ids = [result.campaignId, ...result.adSetIds, ...result.adIds].filter(
            (id): id is string => Boolean(id)
          )
          if (justPublishedTimer.current) clearTimeout(justPublishedTimer.current)
          setJustPublishedIds(new Set(ids))
          // Start the clock after the rows actually exist, not while the refetch is still running.
          await fetchMainData(true)
          justPublishedTimer.current = setTimeout(() => setJustPublishedIds(new Set()), 12000)
          // Everything Meta created is PAUSED. Land the user on it in the editor instead of making
          // them hunt the row they just made — on the attach scope that is the new ad set, since the
          // campaign was already theirs and is not what changed.
          if (!workspaceAccess.enabled) return
          const newAdSetId = result.adSetIds[0]
          if (result.attached && newAdSetId) {
            pushWorkspaceEditor({
              level: "adset",
              id: newAdSetId,
              campaignId: result.campaignId,
              adSetId: newAdSetId,
            })
          } else if (result.campaignId) {
            pushWorkspaceEditor({
              level: "campaign",
              id: result.campaignId,
              campaignId: result.campaignId,
              adSetId: newAdSetId,
            })
          }
        }}
      />

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
        <h1 className="text-base font-bold">Campaigns</h1>
        {/* Account selector */}
        <AdAccountPill className="h-8 py-0 text-xs" labelClassName="max-w-[180px]" />
        {selectedAccountId && <OpportunityScoreBadge adAccountId={selectedAccountId} />}
        {selectedAccount && (
          <span className="text-xs text-muted-foreground">{selectedAccount.id}</span>
        )}
        {selectedAccount?.timezone_name && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Ad account timezone — budgets/schedules launch in this zone">
            <IconCalendar className="size-3.5" />
            {selectedAccount.timezone_name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {workspaceAccess.enabled && bulkDraftCount > 0 && (
            <>
              <button
                onClick={() => setBulkDiscardConfirmOpen(true)}
                disabled={!workspaceAccess.canMutate || bulkPublishing}
                className="flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
              >
                <IconTrash className="size-3.5" />Discard Drafts
              </button>
              <button
                onClick={() => openBulkReview()}
                disabled={!workspaceAccess.canMutate || bulkPublishing}
                className="flex h-7 items-center gap-1.5 rounded-lg bg-[#1877f2] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#166fe5] disabled:opacity-40"
              >
                Review and publish ({bulkDraftCount})
              </button>
            </>
          )}
          <button onClick={() => { setHistoryOpen(true); fetchHistory() }} className="flex items-center gap-1.5 h-7 px-2.5 text-xs border rounded-lg hover:bg-muted/50 transition-colors mr-2">
            <IconHistory className="size-3.5" />History
          </button>

          <span className="text-xs text-muted-foreground">Updated just now</span>
          <button
            onClick={() => fetchMainData(true)}
            disabled={loading}
            className="size-7 flex items-center justify-center border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <IconRefresh className={cn("size-3.5 text-muted-foreground", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {activeLaunchFilter && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b shrink-0 bg-primary/5 text-xs">
          <IconHistory className="size-3.5 text-primary" />
          <span>Showing {launchAdIds?.size ?? 0} ad{(launchAdIds?.size ?? 0) === 1 ? "" : "s"} from launch <span className="font-medium">{launchLabel}</span></span>
          <button onClick={() => { setLaunchAdIds(null); router.replace("/ads-manager") }} className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <IconX className="size-3.5" />Clear
          </button>
        </div>
      )}

      {/* ── Search + Status filter bar ── */}
      <div className="px-4 py-2 border-b shrink-0 flex items-center gap-3 flex-wrap">
        {/* Search + filter chips. Same slot as the old input, no width ceiling —
            chips live inside the box, so a narrow field ran out of room immediately. */}
        <FilterBar
          level={tab as FilterLevel}
          chips={chips}
          onChipsChange={setChips}
          search={search}
          onSearchChange={setSearch}
          enumOptions={chipEnumOptions}
          suggestions={chipSuggestions}
          loadedRowCount={(tab === "campaigns" ? campaigns : tab === "adsets" ? adSets : ads).length}
          dateRangeLabel={dateRangeLabel}
          selectedCount={selectedIds.size}
          onFilterSelectedRows={() => setChips(prev => [
            ...prev,
            // Snapshot, not a live binding: changing the selection afterwards must
            // not change which rows this chip matches. Matches Meta's behaviour.
            { id: newChipId(), field: SELECTED_ROWS_FIELD, operator: "is", values: [], snapshotIds: Array.from(selectedIds), snapshotLevel: tab as FilterLevel },
          ])}
        />

        {/* Delivery — still a server-side filter (`active_only`), so it stays a pill
            rather than a chip. One control, one source of truth. */}
        <div className="flex items-center shrink-0 gap-0.5 p-0.5 rounded-full border bg-muted/30">
          {(["all", "ACTIVE", "PAUSED"] as const).map(s => (
            <button
              key={s}
              onClick={() => {
                setPage(1)
                setPageCursors(previous => ({ ...previous, [tab]: [undefined] }))
                setStatusFilter(s)
              }}
              className={cn(
                "px-2.5 py-1 text-xs rounded-full font-medium transition-colors",
                statusFilter === s
                  ? s === "ACTIVE"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                    : s === "PAUSED"
                    ? "bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-300"
                    : "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/60"
              )}
            >
              {s === "all" ? "All" : s === "ACTIVE" ? "Active" : "Paused"}
            </button>
          ))}
        </div>

        {/* Result count */}
        {(search || chips.length > 0 || statusFilter !== "all") && (
          <span className="text-xs text-muted-foreground shrink-0">
            {currentData.length} result{currentData.length !== 1 ? "s" : ""}
          </span>
        )}

        {drainTruncated && (
          <span className="text-xs text-amber-700 dark:text-amber-500 shrink-0">
            Showing the first {DRAIN_ROW_LIMIT.toLocaleString()} rows — filters and sorting cover these only.
          </span>
        )}
      </div>

      {/* Hidden-selection guard. Bulk actions operate on the whole selection, so a
          selected row that a filter has hidden is about to be acted on unseen. */}
      {hiddenSelectedCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b shrink-0 bg-amber-50 dark:bg-amber-950/20 text-xs text-amber-900 dark:text-amber-300">
          <span>
            <span className="font-semibold">{selectedIds.size} selected</span> · {hiddenSelectedCount} hidden by filters
          </span>
          {visibleSelectedIds.length > 0 ? (
            <button onClick={keepOnlyVisibleSelected} className="underline underline-offset-2 hover:no-underline font-medium">
              Keep only the {visibleSelectedIds.length} visible
            </button>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">
              None of the selected rows are on screen. Clear the filters to review them.
            </span>
          )}
        </div>
      )}

      {/* ── Tabs + Pagination + Date range ── */}
      <div className="flex items-center px-4 border-b shrink-0 bg-background">
        {/* Tabs */}
        <div className="flex items-center">
          {(["campaigns", "adsets", "ads"] as Tab[]).map(t => {
            const badge = tabBadge(t)
            return (
              <button
                key={t}
                onClick={() => switchTab(t)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-xs transition-colors whitespace-nowrap rounded-t-lg border-t border-l border-r",
                  tab === t
                    ? "bg-white dark:bg-card border-[#e4e6eb] dark:border-gray-800 font-bold text-gray-900 dark:text-gray-100 z-10 -mb-px shadow-[0_-2px_0_0_#1877f2]"
                    : "bg-[#f5f6f7] dark:bg-muted/50 border-transparent border-b-[#e4e6eb] dark:border-b-gray-800 text-[#65676b] dark:text-muted-foreground hover:bg-[#ebedf0] dark:hover:bg-muted font-semibold"
                )}
              >
                {t === "campaigns"
                  ? <span className="size-4 shrink-0 flex items-center justify-center rounded bg-blue-600 text-white text-xs font-bold">A</span>
                  : <IconTable className="size-3.5 shrink-0" />
                }
                <span className="truncate max-w-[110px]">{tabLabel(t)}</span>

                {/* Search/filter match count badge — only when tab has loaded data */}
                {(search || statusFilter !== "all") && tabMatchCounts[t] !== null && (
                  <span className={cn(
                    "px-1.5 py-0.5 text-xs rounded-full font-bold leading-none",
                    tab === t
                      ? "bg-blue-600 text-white"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {tabMatchCounts[t]}
                  </span>
                )}

                {/* Hierarchical filter badge. Shown whenever the hierarchy filter is
                    on — it used to hide as soon as anything was typed in the search
                    box, leaving an active drill-down with no visible indicator. */}
                {badge && (
                  <span className="flex items-center gap-px px-1.5 py-0.5 bg-blue-600 text-white text-xs rounded-full font-bold leading-none">
                    {badge.count}
                    <span
                      role="button"
                      onClick={e => { e.stopPropagation(); badge.clear() }}
                      className="ml-0.5 cursor-pointer hover:text-blue-200 font-normal"
                    >×</span>
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-2 py-1.5">
          {/* Loaded-row count — rows accumulate via Load more, so this is a running total, not a page window */}
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {currentData.length === 0 ? "0 rows loaded" : `${currentData.length} rows loaded`}
          </span>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="size-6 flex items-center justify-center border rounded hover:bg-muted/50 disabled:opacity-30" title="Reload from the first page">
            <IconChevronLeft className="size-3.5" />
          </button>
          <button onClick={() => setPage(p => p + 1)} disabled={!paging.hasNext} className="size-6 flex items-center justify-center border rounded hover:bg-muted/50 disabled:opacity-30" title="Load 20 more">
            <IconChevronRight className="size-3.5" />
          </button>

          {/* Date range */}
          <AdsDateRangePicker
            preset={datePreset}
            accountId={selectedAccountId}
            customStart={customDateRange?.start}
            customEnd={customDateRange?.end}
            onChange={(p, cs, ce) => {
              setDatePreset(p)
              setCustomDateRange((p === "custom" || p === "maximum") && cs && ce ? { start: cs, end: ce } : null)
            }}
          />
        </div>
      </div>

      {/* ── Action toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0 flex-wrap bg-white dark:bg-background">
        <button onClick={() => setCreateModalOpen(true)} className="flex items-center gap-1.5 h-7 px-3 text-xs rounded bg-primary hover:bg-primary/90 text-primary-foreground transition-colors font-semibold shadow-sm">
          <IconPlus className="size-3.5" />Create
        </button>
        <button
          disabled={selectedIds.size === 0}
          onClick={() => setDuplicateDialogOpen(true)}
          className="flex items-center gap-1.5 h-7 px-3 text-xs border border-[#ccd0d5] dark:border-gray-700 rounded bg-[#f5f6f7] dark:bg-muted hover:bg-[#ebedf0] dark:hover:bg-muted/80 transition-colors text-[#4b4f56] dark:text-gray-300 font-semibold shadow-sm disabled:opacity-40"
        >
          <IconCopy className="size-3.5" />
          Duplicate{selectedIds.size > 0 && ` (${selectedIds.size})`}
        </button>
        <div className="flex items-center">
          <button
            disabled={selectedIds.size === 0}
            onClick={() => {
              if (workspaceAccess.enabled && selectedIds.size > 1) {
                openBulkEditor("name")
                return
              }
              const selected = currentData.find(x => x.id === Array.from(selectedIds)[0])
              if (selected) openWorkspaceEditor(selected)
            }}
            className={cn(
              "flex h-7 items-center gap-1.5 border border-[#ccd0d5] bg-[#f5f6f7] px-3 text-xs font-semibold text-[#4b4f56] shadow-sm transition-colors hover:bg-[#ebedf0] disabled:opacity-40 dark:border-gray-700 dark:bg-muted dark:text-gray-300 dark:hover:bg-muted/80",
              workspaceAccess.enabled ? "rounded-l" : "rounded",
            )}
          >
            <IconPencil className="size-3.5" />
            Edit{selectedIds.size > 0 && ` (${selectedIds.size})`}
          </button>
          {workspaceAccess.enabled && (
            <BulkEditFieldMenu
              level={currentDraftLevel}
              disabled={selectedIds.size === 0 || !workspaceAccess.canMutate}
              onSelect={openBulkEditor}
            />
          )}
        </div>
        <button
          disabled={selectedIds.size === 0}
          onClick={() => {
            const rowsById = new Map(currentData.map(r => [r.id, r as { id: string; name: string }]))
            const rows = Array.from(selectedIds).map(id => rowsById.get(id)).filter(Boolean).map(n => toReportRow(n as any))
            setPerformancePopup({ mode: "compare", rows })
          }}
          className="flex items-center gap-1.5 h-7 px-3 text-xs border border-[#ccd0d5] dark:border-gray-700 rounded bg-[#f5f6f7] dark:bg-muted hover:bg-[#ebedf0] dark:hover:bg-muted/80 transition-colors text-[#4b4f56] dark:text-gray-300 font-semibold shadow-sm disabled:opacity-40"
        >
          Compare{selectedIds.size > 0 && ` (${selectedIds.size})`}
        </button>

        {selectedIds.size > 0 && !workspaceAccess.enabled && (
          <div className="flex items-center gap-1.5 ml-2">
            <button
              onClick={() => Array.from(selectedIds).forEach(id => toggleStatus(id, "ACTIVE"))}
              className="h-7 px-3 text-xs border border-[#ccd0d5] dark:border-gray-700 rounded bg-[#f5f6f7] dark:bg-muted hover:bg-[#ebedf0] dark:hover:bg-muted/80 transition-colors text-[#1877f2] font-semibold shadow-sm"
            >
              Turn on
            </button>
            <button
              onClick={() => Array.from(selectedIds).forEach(id => toggleStatus(id, "PAUSED"))}
              className="h-7 px-3 text-xs border border-[#ccd0d5] dark:border-gray-700 rounded bg-[#f5f6f7] dark:bg-muted hover:bg-[#ebedf0] dark:hover:bg-muted/80 transition-colors text-[#4b4f56] dark:text-gray-300 font-semibold shadow-sm"
            >
              Turn off
            </button>
          </div>
        )}

        {workspaceAccess.enabled && selectedDraftKeys.length > 0 && (
          <button
            onClick={() => openBulkReview(selectedDraftKeys)}
            disabled={!workspaceAccess.canMutate || bulkPublishing}
            className="h-7 rounded bg-[#1877f2] px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#166fe5] disabled:opacity-40"
          >
            Publish selected ({selectedDraftKeys.length})
          </button>
        )}

        {/* Selection indicator — only shown when items selected */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 h-7 border rounded-lg bg-blue-50 dark:bg-blue-950/20 text-xs text-blue-700 dark:text-blue-400 font-medium">
            {selectedIds.size} selected
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-0.5 flex items-center justify-center size-4 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors text-blue-500"
              title="Clear selection"
            >
              ×
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {/* Drill into selected item within Ads Manager */}
          <button
            onClick={() => {
              if (selectedIds.size === 0) return
              const id = Array.from(selectedIds)[0]
              const node = currentData.find(x => x.id === id)
              if (!node) return
              if (tab === "campaigns") drillToAdSets(node as Campaign)
              else if (tab === "adsets") drillToAds(node as AdSet)
            }}
            disabled={tab === "ads" || selectedIds.size === 0}
            className="size-7 flex items-center justify-center border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-40"
            title="View Ads Manager"
          >
            <svg className="size-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            disabled={selectedIds.size === 0}
            onClick={() => setDeleteConfirmOpen(true)}
            className="size-7 flex items-center justify-center border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-40"
            title="Delete selected"
          >
            <IconTrash className="size-3.5 text-muted-foreground" />
          </button>
          {/* Breakdown */}
          <BreakdownDropdown selected={breakdowns} onChange={setBreakdowns} />

          {/* Columns preset picker */}
          <div ref={colsDropRef} className="relative">
            <button
              onClick={() => setColsOpen(v => !v)}
              className="flex items-center gap-1.5 h-7 px-2.5 text-xs border rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground"
            >
              <IconTable className="size-3.5 shrink-0" />
              <span className="max-w-[160px] truncate">
                Columns: {getActivePreset(columnOrder, customPresets)?.label || "Custom"}
              </span>
              <IconChevronDown className="size-3 shrink-0" />
            </button>

            {colsOpen && (
              <div className="absolute right-0 top-full mt-1 bg-popover border rounded-xl shadow-lg z-50 w-72 py-2">
                {(() => {
                  const activePreset = getActivePreset(columnOrder, customPresets)
                  const presetButton = (id: string) => {
                    const preset = [...DEFAULT_PRESETS, ...customPresets].find(p => p.id === id)
                    if (!preset) return null
                    const isActive = activePreset?.id === preset.id
                    return (
                      <button
                        key={preset.id}
                        onClick={() => { setColumnOrder(preset.columns); setColsOpen(false) }}
                        className="w-full flex items-center gap-3 px-3 py-1.5 hover:bg-muted/50 transition-colors"
                      >
                        <span className={cn("size-3.5 rounded-full border-2 shrink-0", isActive ? "border-[#1877f2] bg-[#1877f2]" : "border-muted-foreground/40")} />
                        <span className="text-xs">{preset.label}</span>
                      </button>
                    )
                  }
                  return (
                    <>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 mb-1">Recently used</p>
                      {presetButton("ecom")}
                      {presetButton("performance")}

                      <div className="border-t my-1.5" />
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 mb-1">Popular</p>
                      {presetButton("performance_and_clicks")}
                      {presetButton("engagement")}
                      {presetButton("delivery")}

                      <div className="border-t my-1.5" />
                      <button
                        onClick={() => { setColsOpen(false); setCustomizeColsOpen(true) }}
                        className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-muted/50 transition-colors text-xs text-left"
                      >
                        <span>View your column presets</span>
                        <IconDrillRight className="size-3.5 text-muted-foreground" />
                      </button>

                      <div className="border-t my-1.5" />
                      <button
                        onClick={() => { setDraftAttribution(attributionWindows); setAttributionCompareOpen(true); setColsOpen(false) }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 transition-colors text-xs text-left"
                      >
                        <IconAdjustments className="size-3.5 text-muted-foreground" /> Compare attribution settings
                      </button>
                      <button
                        onClick={() => { setColumnWidths({}); setColsOpen(false) }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 transition-colors text-xs text-left"
                      >
                        Reset column width
                      </button>
                      <button
                        onClick={() => { setColsOpen(false); setCustomizeColsOpen(true) }}
                        className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-muted/50 transition-colors"
                      >
                        <span className="flex items-center gap-2 text-xs"><IconTable className="size-3.5 text-muted-foreground" /> Customize columns</span>
                        <IconDrillRight className="size-3.5 text-muted-foreground" />
                      </button>
                    </>
                  )
                })()}
              </div>
            )}
          </div>

          {/* Export */}
          <button
            onClick={exportTable}
            title="Export to CSV"
            className="size-7 flex items-center justify-center border rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground ml-1"
          >
            <IconDownload className="size-3.5 shrink-0" />
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-background" aria-busy={isDataLoading}>
        {error && (
          <div className="m-4 px-4 py-3 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive">{error}</div>
        )}
        {breakdownError && (
          <div className="mx-4 mt-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-400">
            Breakdown error: {breakdownError}
          </div>
        )}

        <div className="min-h-0 max-h-full overflow-auto border border-[#d8dadf] bg-white dark:border-gray-700 dark:bg-background">
          <table data-table="compact" data-sticky-grid className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 1100, tableLayout: "fixed" }}>
            {/* `dark:bg-muted/80` was translucent, which is invisible while nothing is pinned
                horizontally but shows the scrolling columns through the frozen header cells the
                moment they are. Opaque here and on the three frozen cells below. */}
            <thead className="sticky top-0 z-30 bg-[#f5f6f7] dark:bg-muted shadow-[0_1px_0_0_#d4d8e0] dark:shadow-[0_1px_0_0_#3f4654]">
              <tr>
                <th className={cn(FROZEN_W.check, "px-2 text-left sticky z-20", FROZEN_LEFT.check, FROZEN_HEAD_BG)}>
                  <input ref={headerCheckRef} type="checkbox" className="rounded size-3.5 accent-blue-600" checked={allSelected} onChange={toggleAll} />
                </th>
                <th className={cn(FROZEN_W.toggle, "px-3 text-left text-xs font-bold text-[#1c2b33] dark:text-foreground resize-x overflow-auto sticky z-20", FROZEN_LEFT.toggle, FROZEN_HEAD_BG)}>Off/On</th>
                <SortTh
                  label={tab === "ads" ? "Ad name" : tab === "adsets" ? "Ad set" : "Campaign"}
                  field="name"
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={handleSort}
                  width={columnWidths.__name || 320}
                  onResize={w => setColWidth("__name", w)}
                  className={cn("sticky z-20", FROZEN_DIVIDER, FROZEN_LEFT.name, FROZEN_HEAD_BG)}
                />
                {tab === "ads" && (
                  <th className="w-20 px-3 text-left text-xs font-bold text-[#1c2b33] dark:text-foreground resize-x overflow-auto">Preview</th>
                )}
                                {columnOrder.map((colId, i) => {
                  const col = customColumnMap[colId]
                  if (!col) return null
                  const moveLeft = () => setColumnOrder(prev => { const n = [...prev]; [n[i-1], n[i]] = [n[i], n[i-1]]; return n })
                  const moveRight = () => setColumnOrder(prev => { const n = [...prev]; [n[i], n[i+1]] = [n[i+1], n[i]]; return n })
                  const remove = () => setColumnOrder(prev => prev.filter(id => id !== colId))
                  const sortFieldObj = col.sortKey || colId
                  const active = sortField === sortFieldObj
                  const colWidth = getColWidth(colId)

                  return (
                    <th key={colId} style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }} className={cn("group/header relative px-3 text-xs font-bold text-[#1c2b33] dark:text-foreground", isTextCol(colId) ? "text-left" : "text-right")}>
                      <div className={cn("flex items-start gap-1", !isTextCol(colId) && "justify-end")}>
                        <div className="cursor-pointer hover:text-foreground transition-colors flex items-start gap-0.5 min-w-0" onClick={() => handleSort(sortFieldObj)}>
                          <span className="line-clamp-2 break-words leading-tight">{col.headerLabel}</span>
                          {active
                            ? (sortDir === "asc" ? <IconArrowUp className="size-3 shrink-0 text-primary" /> : <IconArrowDown className="size-3 shrink-0 text-primary" />)
                            : <IconArrowsUpDown className="size-3 shrink-0 opacity-0 group-hover/header:opacity-40" />
                          }
                        </div>
                        <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 w-max max-w-[240px] rounded-xl border bg-popover p-3 text-[11px] font-normal leading-snug text-popover-foreground shadow-xl opacity-0 translate-y-1 transition-all group-hover/header:opacity-100 group-hover/header:translate-y-0">
                          <p className="mb-1 text-sm font-semibold leading-tight">{col.headerLabel}</p>
                          <p className="text-muted-foreground">{col.description}</p>
                        </div>
                        <HeaderCellMenu
                          colId={colId}
                          label={col.headerLabel}
                          onSortAsc={() => { setSortField(sortFieldObj); setSortDir("asc") }}
                          onSortDesc={() => { setSortField(sortFieldObj); setSortDir("desc") }}
                          onMoveLeft={moveLeft}
                          onMoveRight={moveRight}
                          onRemove={remove}
                          canMoveLeft={i > 0}
                          canMoveRight={i < columnOrder.length - 1}
                          onOpenAttributionCompare={() => { setDraftAttribution(attributionWindows); setAttributionCompareOpen(true) }}
                        />
                      </div>
                      <div
                        onMouseDown={e => startColResize(colId, colWidth, e)}
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 opacity-0 hover:opacity-100 transition-opacity z-10"
                      />
                    </th>
                  )
                })}
              </tr>
              {isDataLoading && (
                <tr className="h-0">
                  <th colSpan={Math.max(12, columnOrder.length + (tab === "ads" ? 4 : 3))} className="relative h-0 p-0">
                    <div
                      className="absolute inset-x-0 top-0 z-40 h-[3px] overflow-hidden bg-[#d8dadf] dark:bg-white/10"
                      role="progressbar"
                      aria-label="Loading Ads Manager data"
                      aria-valuetext={loadingProgress >= 100 ? "Loading complete" : `${loadingProgress}% loaded`}
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-[#1877f2] transition-[width] duration-300 ease-out"
                        style={{ width: `${Math.max(0, Math.min(100, loadingProgress))}%` }}
                      />
                    </div>
                  </th>
                </tr>
              )}
            </thead>

            <tbody className={cn("transition-opacity duration-200", isLoadingAccount ? "opacity-35 pointer-events-none select-none" : (loading ? "pointer-events-none select-none" : ""))}>
              {pagedData.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-16">
                    {isDataLoading ? (
                      <div className="h-8" aria-hidden="true" />
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <span className="text-sm">
                          {search ? `No ${tab === "campaigns" ? "campaigns" : tab === "adsets" ? "ad sets" : "ads"} match "${search}"` : `No ${tab} found`}
                        </span>
                        {/* Suggest switching to another tab if it has matching results */}
                        {search && (
                          <div className="flex items-center gap-2 flex-wrap justify-center">
                            {(["campaigns", "adsets", "ads"] as Tab[]).filter(t => t !== tab && (tabMatchCounts[t] ?? 0) > 0).map(t => (
                              <button
                                key={t}
                                onClick={() => switchTab(t)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors font-medium"
                              >
                                Found {tabMatchCounts[t]} in {t === "campaigns" ? "Campaigns" : t === "adsets" ? "Ad sets" : "Ads"} →
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ) : tab === "campaigns" ? (
                (pagedData as Campaign[]).map((c, idx) => {
                  const bg = rowBg(idx)
                  const isSel = selectedIds.has(c.id)
                  const hasDraft = Boolean(bulkDrafts[bulkDraftKey("campaign", c.id)])
                  const { tinted, tintRow, tintCell, tintHover } = rowTint(justPublishedIds.has(c.id), hasDraft)
                  const rowBDs = sortedBreakdownRows(c.id, c.objective)
                  return (
                    <Fragment key={c.id}>
                      <tr className={cn("border-b border-[#e4e6eb] dark:border-gray-800 hover:bg-[#f5f6f7] dark:hover:bg-white/5 transition-colors group/row", bg, tinted && !isSel && tintRow, isSel && "bg-[#e3f0fe] dark:bg-blue-950/30 hover:bg-[#d8e9fc]")}>
                        <td className={cn("px-2 sticky z-10 transition-colors", FROZEN_W.check, FROZEN_LEFT.check, bg, tinted && !isSel && tintCell, isSel ? cn(FROZEN_BODY_SEL, "group-hover/row:bg-[#d8e9fc]") : tinted ? tintHover : "group-hover/row:bg-[#f5f6f7] dark:group-hover/row:bg-white/5")}>
                          {/* onClick, not onChange — the range gesture needs shiftKey/ctrlKey off the mouse event. */}
                          <input type="checkbox" className="rounded size-[14px] accent-[#1877f2]" checked={isSel}
                            onChange={() => {}}
                            onClick={e => toggleRowSelection(c.id, e.shiftKey, e.ctrlKey || e.metaKey)} />
                        </td>
                        <td className={cn("px-3 sticky z-10 transition-colors", FROZEN_W.toggle, FROZEN_LEFT.toggle, bg, tinted && !isSel && tintCell, isSel ? cn(FROZEN_BODY_SEL, "group-hover/row:bg-[#d8e9fc]") : tinted ? tintHover : "group-hover/row:bg-[#f5f6f7] dark:group-hover/row:bg-white/5")}>
                          {toggling.has(c.id) ? <IconLoader2 className="size-4 animate-spin text-[#65676b]" /> : <StatusToggle id={c.id} status={c.status} onToggle={toggleStatus} />}
                        </td>
                        <td style={{ width: columnWidths.__name || 320, minWidth: columnWidths.__name || 320, maxWidth: columnWidths.__name || 320 }} className={cn("px-3 sticky z-10 transition-colors group/cell overflow-hidden", FROZEN_LEFT.name, bg, FROZEN_DIVIDER, tinted && !isSel && tintCell, isSel ? cn(FROZEN_BODY_SEL, "group-hover/row:bg-[#d8e9fc]") : tinted ? tintHover : "group-hover/row:bg-[#f5f6f7] dark:group-hover/row:bg-white/5")}>
                          {inlineEditingId === c.id ? (
                            <div className="flex items-center gap-2"><Input value={inlineEditingName} onChange={e => setInlineEditingName(e.target.value)} onBlur={() => saveInlineRename(c.id)} onKeyDown={e => e.key === "Enter" && saveInlineRename(c.id)} className="h-7 text-xs py-1" autoFocus /></div>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <button onClick={() => drillToAdSets(c)} className="text-[#1877f2] hover:underline text-xs font-semibold text-left line-clamp-2">{c.name}</button>
                                {hasDraft && <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">Unpublished edits</span>}
                                {justPublishedIds.has(c.id) && <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">Just published</span>}
                                <button onClick={e => { e.stopPropagation(); setInlineEditingId(c.id); setInlineEditingName(c.name) }} className="opacity-0 group-hover/cell:opacity-100 p-0.5 hover:bg-black/5 rounded transition-opacity"><IconPencil className="size-3 text-[#65676b]" /></button>
                              </div>
                              <div className="flex items-center gap-1.5 opacity-0 group-hover/cell:opacity-100 transition-opacity">
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => openWorkspaceEditor(c)}>Edit</button>
                                <span className="text-[#ccd0d5]">·</span>
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => { setSelectedIds(new Set([c.id])); setDuplicateDialogOpen(true) }}>Duplicate</button>
                                <span className="text-[#ccd0d5]">·</span>
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => openCharts(c)}>Charts</button>
                                <span className="text-[#ccd0d5]">·</span>
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => openCompare(c)}>Compare</button>
                              </div>
                            </div>
                          )}
                        </td>
                        {columnOrder.map(colId => <td key={colId} style={{ width: getColWidth(colId), maxWidth: getColWidth(colId) }} className={cn("px-3 align-middle overflow-hidden whitespace-nowrap", isTextCol(colId) ? "text-left" : "text-right")}>{renderCellContent(colId, c)}</td>)}
                      </tr>
                      {rowBDs.map((br, i) => (
                        <tr key={`bd-${i}`} className="border-b border-[#e4e6eb] dark:border-gray-800 bg-[#f5f6f7] dark:bg-muted/10">
                          <td className={cn("sticky z-10 px-2", FROZEN_W.check, FROZEN_LEFT.check, FROZEN_BAND_BG)} />
                          <td className={cn("sticky z-10 px-3", FROZEN_W.toggle, FROZEN_LEFT.toggle, FROZEN_BAND_BG)} />
                          <td className={cn("px-3 sticky z-10", FROZEN_LEFT.name, FROZEN_BAND_BG, FROZEN_DIVIDER)}>
                            <span className="pl-6 text-xs text-[#1c2b33] dark:text-foreground">{br.breakdownLabel}</span>
                          </td>
                          {columnOrder.map(colId => <td key={colId} style={{ width: getColWidth(colId), maxWidth: getColWidth(colId) }} className={cn("px-3 align-middle overflow-hidden whitespace-nowrap", isTextCol(colId) ? "text-left" : "text-right")}>{renderBreakdownCell(colId, br.ins, c.objective)}</td>)}
                        </tr>
                      ))}
                    </Fragment>
                  )
                })
              ) : tab === "adsets" ? (
                (pagedData as AdSet[]).map((a, idx) => {
                  const bg = rowBg(idx)
                  const isSel = selectedIds.has(a.id)
                  const hasDraft = Boolean(bulkDrafts[bulkDraftKey("adset", a.id)])
                  const { tinted, tintRow, tintCell, tintHover } = rowTint(justPublishedIds.has(a.id), hasDraft)
                  const objective = campaigns.find(c => c.id === a.campaign_id)?.objective
                  const rowBDs = sortedBreakdownRows(a.id, objective)
                  return (
                    <Fragment key={a.id}>
                      <tr className={cn("border-b border-[#e4e6eb] dark:border-gray-800 hover:bg-[#f5f6f7] dark:hover:bg-white/5 transition-colors group/row", bg, tinted && !isSel && tintRow, isSel && "bg-[#e3f0fe] dark:bg-blue-950/30 hover:bg-[#d8e9fc]")}>
                        <td className={cn("px-2 sticky z-10 transition-colors", FROZEN_W.check, FROZEN_LEFT.check, bg, tinted && !isSel && tintCell, isSel ? cn(FROZEN_BODY_SEL, "group-hover/row:bg-[#d8e9fc]") : tinted ? tintHover : "group-hover/row:bg-[#f5f6f7] dark:group-hover/row:bg-white/5")}>
                          <input type="checkbox" className="rounded size-[14px] accent-[#1877f2]" checked={isSel}
                            onChange={() => {}}
                            onClick={e => toggleRowSelection(a.id, e.shiftKey, e.ctrlKey || e.metaKey)} />
                        </td>
                        <td className={cn("px-3 sticky z-10 transition-colors", FROZEN_W.toggle, FROZEN_LEFT.toggle, bg, tinted && !isSel && tintCell, isSel ? cn(FROZEN_BODY_SEL, "group-hover/row:bg-[#d8e9fc]") : tinted ? tintHover : "group-hover/row:bg-[#f5f6f7] dark:group-hover/row:bg-white/5")}>
                          {toggling.has(a.id) ? <IconLoader2 className="size-4 animate-spin text-[#65676b]" /> : <StatusToggle id={a.id} status={a.status} onToggle={toggleStatus} />}
                        </td>
                        <td style={{ width: columnWidths.__name || 320, minWidth: columnWidths.__name || 320, maxWidth: columnWidths.__name || 320 }} className={cn("px-3 sticky z-10 transition-colors group/cell overflow-hidden", FROZEN_LEFT.name, bg, FROZEN_DIVIDER, tinted && !isSel && tintCell, isSel ? cn(FROZEN_BODY_SEL, "group-hover/row:bg-[#d8e9fc]") : tinted ? tintHover : "group-hover/row:bg-[#f5f6f7] dark:group-hover/row:bg-white/5")}>
                          {inlineEditingId === a.id ? (
                            <div className="flex items-center gap-2"><Input value={inlineEditingName} onChange={e => setInlineEditingName(e.target.value)} onBlur={() => saveInlineRename(a.id)} onKeyDown={e => e.key === "Enter" && saveInlineRename(a.id)} className="h-7 text-xs py-1" autoFocus /></div>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <button onClick={() => drillToAds(a)} className="text-[#1877f2] hover:underline text-xs font-semibold text-left line-clamp-2">{a.name}</button>
                                {hasDraft && <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">Unpublished edits</span>}
                                {justPublishedIds.has(a.id) && <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">Just published</span>}
                                <button onClick={e => { e.stopPropagation(); setInlineEditingId(a.id); setInlineEditingName(a.name) }} className="opacity-0 group-hover/cell:opacity-100 p-0.5 hover:bg-black/5 rounded transition-opacity"><IconPencil className="size-3 text-[#65676b]" /></button>
                              </div>
                              <div className="flex items-center gap-1.5 opacity-0 group-hover/cell:opacity-100 transition-opacity">
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => openWorkspaceEditor(a)}>Edit</button>
                                <span className="text-[#ccd0d5]">·</span>
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => { setSelectedIds(new Set([a.id])); setDuplicateDialogOpen(true) }}>Duplicate</button>
                                <span className="text-[#ccd0d5]">·</span>
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => openCharts(a)}>Charts</button>
                                <span className="text-[#ccd0d5]">·</span>
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => openCompare(a)}>Compare</button>
                              </div>
                            </div>
                          )}
                        </td>
                        {columnOrder.map(colId => <td key={colId} style={{ width: getColWidth(colId), maxWidth: getColWidth(colId) }} className={cn("px-3 align-middle overflow-hidden whitespace-nowrap", isTextCol(colId) ? "text-left" : "text-right")}>{renderCellContent(colId, a)}</td>)}
                      </tr>
                      {rowBDs.map((br, i) => (
                        <tr key={`bd-${i}`} className="border-b border-[#e4e6eb] dark:border-gray-800 bg-[#f5f6f7] dark:bg-muted/10">
                          <td className={cn("sticky z-10 px-2", FROZEN_W.check, FROZEN_LEFT.check, FROZEN_BAND_BG)} />
                          <td className={cn("sticky z-10 px-3", FROZEN_W.toggle, FROZEN_LEFT.toggle, FROZEN_BAND_BG)} />
                          <td className={cn("px-3 sticky z-10", FROZEN_LEFT.name, FROZEN_BAND_BG, FROZEN_DIVIDER)}>
                            <span className="pl-6 text-xs text-[#1c2b33] dark:text-foreground">{br.breakdownLabel}</span>
                          </td>
                          {columnOrder.map(colId => <td key={colId} style={{ width: getColWidth(colId), maxWidth: getColWidth(colId) }} className={cn("px-3 align-middle overflow-hidden whitespace-nowrap", isTextCol(colId) ? "text-left" : "text-right")}>{renderBreakdownCell(colId, br.ins, objective)}</td>)}
                        </tr>
                      ))}
                    </Fragment>
                  )
                })
              ) : (
                (pagedData as Ad[]).map((a, idx) => {
                  const bg = rowBg(idx)
                  const adSet = adSets.find(s => s.id === a.adset_id)
                  const isSel = selectedIds.has(a.id)
                  const hasDraft = Boolean(bulkDrafts[bulkDraftKey("ad", a.id)])
                  const { tinted, tintRow, tintCell, tintHover } = rowTint(justPublishedIds.has(a.id), hasDraft)
                  const thumb =a.creative?.thumbnail_url || a.creative?.image_url
                  const objective = campaigns.find(c => c.id === a.campaign_id)?.objective
                  const rowBDs = sortedBreakdownRows(a.id, objective)
                  return (
                    <Fragment key={a.id}>
                      <tr className={cn("border-b border-[#e4e6eb] dark:border-gray-800 hover:bg-[#f5f6f7] dark:hover:bg-white/5 transition-colors group/row", bg, tinted && !isSel && tintRow, isSel && "bg-[#e3f0fe] dark:bg-blue-950/30 hover:bg-[#d8e9fc]")}>
                        <td className={cn("px-2 sticky z-10 transition-colors", FROZEN_W.check, FROZEN_LEFT.check, bg, tinted && !isSel && tintCell, isSel ? cn(FROZEN_BODY_SEL, "group-hover/row:bg-[#d8e9fc]") : tinted ? tintHover : "group-hover/row:bg-[#f5f6f7] dark:group-hover/row:bg-white/5")}>
                          <input type="checkbox" className="rounded size-[14px] accent-[#1877f2]" checked={isSel}
                            onChange={() => {}}
                            onClick={e => toggleRowSelection(a.id, e.shiftKey, e.ctrlKey || e.metaKey)} />
                        </td>
                        <td className={cn("px-3 sticky z-10 transition-colors", FROZEN_W.toggle, FROZEN_LEFT.toggle, bg, tinted && !isSel && tintCell, isSel ? cn(FROZEN_BODY_SEL, "group-hover/row:bg-[#d8e9fc]") : tinted ? tintHover : "group-hover/row:bg-[#f5f6f7] dark:group-hover/row:bg-white/5")}>
                          {toggling.has(a.id) ? <IconLoader2 className="size-4 animate-spin text-[#65676b]" /> : <StatusToggle id={a.id} status={a.status} onToggle={toggleStatus} />}
                        </td>
                        <td style={{ width: columnWidths.__name || 320, minWidth: columnWidths.__name || 320, maxWidth: columnWidths.__name || 320 }} className={cn("px-3 sticky z-10 transition-colors group/cell overflow-hidden", FROZEN_LEFT.name, bg, FROZEN_DIVIDER, tinted && !isSel && tintCell, isSel ? cn(FROZEN_BODY_SEL, "group-hover/row:bg-[#d8e9fc]") : tinted ? tintHover : "group-hover/row:bg-[#f5f6f7] dark:group-hover/row:bg-white/5")}>
                          {inlineEditingId === a.id ? (
                            <div className="flex items-center gap-2"><Input value={inlineEditingName} onChange={e => setInlineEditingName(e.target.value)} onBlur={() => saveInlineRename(a.id)} onKeyDown={e => e.key === "Enter" && saveInlineRename(a.id)} className="h-7 text-xs py-1" autoFocus /></div>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <button onClick={() => openWorkspaceEditor(a)} className="text-[#1877f2] hover:underline text-xs font-semibold text-left line-clamp-2">{a.name}</button>
                                {hasDraft && <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">Unpublished edits</span>}
                                {justPublishedIds.has(a.id) && <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">Just published</span>}
                                <button onClick={e => { e.stopPropagation(); setInlineEditingId(a.id); setInlineEditingName(a.name) }} className="opacity-0 group-hover/cell:opacity-100 p-0.5 hover:bg-black/5 rounded transition-opacity"><IconPencil className="size-3 text-[#65676b]" /></button>
                              </div>
                              <div className="flex items-center gap-1.5 opacity-0 group-hover/cell:opacity-100 transition-opacity">
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => openWorkspaceEditor(a)}>Edit</button>
                                <span className="text-[#ccd0d5]">·</span>
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => { setSelectedIds(new Set([a.id])); setDuplicateDialogOpen(true) }}>Duplicate</button>
                                <span className="text-[#ccd0d5]">·</span>
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => openCharts(a)}>Charts</button>
                                <span className="text-[#ccd0d5]">·</span>
                                <button className="text-xs text-[#65676b] font-semibold hover:underline" onClick={() => openCompare(a)}>Compare</button>
                                <span className="text-[#ccd0d5]">·</span>
                                <button
                                  className="text-xs text-[#16a34a] font-semibold hover:underline disabled:opacity-50 disabled:no-underline"
                                  disabled={savingTemplateId === a.id}
                                  onClick={() => handleSaveAsTemplate(a)}
                                >
                                  {savingTemplateId === a.id ? "Saving…" : "Save as Template"}
                                </button>
                                <span className="text-[#ccd0d5]">·</span>
                                <button className="text-xs text-[#1877f2] font-semibold hover:underline" onClick={() => handleDuplicateToLauncher(a)}>To Launcher</button>
                              </div>
                              {adSet && <p className="text-xs text-[#8a8d91] truncate max-w-[200px]">↳ {adSet.name}</p>}
                            </div>
                          )}
                        </td>
                        <td className="px-3">
                          <div className="relative inline-block">
                            {thumb ? <img src={thumb} alt="" className="size-12 rounded object-cover border" loading="lazy" /> : <div className="size-12 rounded bg-muted border flex items-center justify-center text-xs text-muted-foreground">No img</div>}
                            {a.creative_variations && (
                              <span className="absolute -top-1.5 -right-1.5 bg-[#1877f2] text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none shadow" title="Multiple text options">
                                {(a.creative_variations.bodies.length + a.creative_variations.titles.length + a.creative_variations.descriptions.length)}
                              </span>
                            )}
                          </div>
                        </td>
                        {columnOrder.map(colId => <td key={colId} style={{ width: getColWidth(colId), maxWidth: getColWidth(colId) }} className={cn("px-3 align-middle overflow-hidden whitespace-nowrap", isTextCol(colId) ? "text-left" : "text-right")}>{renderCellContent(colId, a)}</td>)}
                      </tr>
                      {rowBDs.map((br, i) => (
                        <tr key={`bd-${i}`} className="border-b border-[#e4e6eb] dark:border-gray-800 bg-[#f5f6f7] dark:bg-muted/10">
                          <td className={cn("sticky z-10 px-2", FROZEN_W.check, FROZEN_LEFT.check, FROZEN_BAND_BG)} />
                          <td className={cn("sticky z-10 px-3", FROZEN_W.toggle, FROZEN_LEFT.toggle, FROZEN_BAND_BG)} />
                          <td className={cn("px-3 sticky z-10", FROZEN_LEFT.name, FROZEN_BAND_BG, FROZEN_DIVIDER)}>
                            <span className="pl-6 text-xs text-[#1c2b33] dark:text-foreground">{br.breakdownLabel}</span>
                          </td>
                          <td className="px-3 bg-[#f5f6f7] dark:bg-muted/10" />
                          {columnOrder.map(colId => <td key={colId} style={{ width: getColWidth(colId), maxWidth: getColWidth(colId) }} className={cn("px-3 align-middle overflow-hidden whitespace-nowrap", isTextCol(colId) ? "text-left" : "text-right")}>{renderBreakdownCell(colId, br.ins, objective)}</td>)}
                        </tr>
                      ))}
                    </Fragment>
                  )
                })
              )}
              {paging.hasNext && (
                <tr className="border-b border-[#e4e6eb] dark:border-gray-800 hover:bg-transparent">
                  <td className="px-2" />
                  <td className="px-3" />
                  <td colSpan={tab === "ads" ? 2 : 1} className="px-3 py-2 text-left">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPage(p => p + 1)}
                      disabled={loading}
                      className="shadow-none text-[11px] text-muted-foreground hover:text-foreground h-auto p-0 font-semibold"
                    >
                      {loading ? "Loading…" : "Load more (20 more)"}
                    </Button>
                  </td>
                  {columnOrder.map(colId => (
                    <td key={colId} />
                  ))}
                </tr>
              )}
            </tbody>

            {/* ── Totals row ── */}
            {pagedData.length > 0 && (
              <tfoot>
                <tr className="sticky bottom-0 z-40">
                  <td colSpan={3} className={cn("sticky left-0 bottom-0 z-40 px-3 text-xs text-muted-foreground font-medium", FOOTER_BG, FOOTER_STICKY_SHADOW)}>
                    Showing {currentData.length} loaded {tab === "campaigns" ? "campaigns" : tab === "adsets" ? "ad sets" : "ads"}
                  </td>
                  {tab === "ads" && (
                    <td className={cn("px-3 sticky bottom-0", FOOTER_BG, FOOTER_CELL_SHADOW)} />
                  )}
                  {columnOrder.map(colId => (
                    <td key={colId} className={cn("px-2 sticky bottom-0 text-xs font-semibold tabular-nums text-[#1c2b33] dark:text-white", FOOTER_BG, FOOTER_CELL_SHADOW, isTextCol(colId) ? "text-left" : "text-right")}>
                      {renderTotalCell(colId)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Duplicate Dialog */}
      <Dialog
        open={duplicateDialogOpen}
        onOpenChange={open => {
          setDuplicateDialogOpen(open)
          if (!open) {
            setDuplicateAdSetPickerOpen(false)
            setDuplicateAdSetSearch("")
          }
        }}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[640px]">
          <DialogHeader className="border-b px-6 py-5 text-left">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e7f3ff] text-[#1877f2]">
                <IconCopy className="size-5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 space-y-1">
                <DialogTitle className="text-xl font-semibold tracking-tight text-foreground">
                  Duplicate {tab === "campaigns" ? "Campaign" : tab === "adsets" ? "Ad Set" : "Ad"}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {selectedIds.size} selected. {tab === "campaigns" ? "Choose name and quantity." : "Choose where copies go, then set name and quantity."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[72vh] space-y-5 overflow-y-auto px-6 py-5">
            {tab !== "campaigns" ? (
                  <section className="space-y-3">
                    <div>
                      <Label className="text-sm font-semibold text-foreground">Where should the copies go?</Label>
                      <p className="mt-1 text-xs text-muted-foreground">Pick the structure that matches what you want to do next.</p>
                    </div>

                    <div className="space-y-2">
                      {(["original", "existing", "new"] as const).map(option => {
                        const label = option === "original"
                          ? tab === "adsets" ? "Keep in the same campaign" : "Keep in the same ad set"
                          : option === "existing"
                            ? tab === "adsets" ? "Copy to another campaign" : "Copy to another ad set"
                            : tab === "adsets" ? "Create a new campaign" : "Create a new ad set"
                        const description = option === "original"
                          ? tab === "adsets"
                            ? "Keep each copied ad set beside its source."
                            : "Keep each copied ad beside its source."
                          : option === "existing"
                            ? tab === "adsets"
                              ? "Choose an existing campaign in this ad account."
                              : "Use this when the copies should run under a different ad set or campaign."
                            : tab === "adsets"
                              ? "Create a paused campaign, then place the copied ad sets inside it."
                              : "Copy the source ad set settings into a new paused ad set, then place the ads inside it."

                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setDuplicateDestination(option)}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition",
                              duplicateDestination === option
                                ? "border-[#1877f2] bg-[#e7f3ff] shadow-[0_0_0_1px_#1877f2] dark:bg-blue-950/30"
                                : "border-border bg-background hover:bg-muted/50"
                            )}
                          >
                            <span className={cn(
                              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                              duplicateDestination === option ? "border-[#1877f2]" : "border-muted-foreground/40"
                            )}>
                              {duplicateDestination === option && <span className="size-2 rounded-full bg-[#1877f2]" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-foreground">{label}</span>
                              <span className="block text-xs leading-5 text-muted-foreground">{description}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ) : (
                  <section className="rounded-xl border bg-muted/30 p-4">
                    <div className="text-sm font-semibold text-foreground">New campaign</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Campaign duplicates always create a new campaign with all ad sets and ads copied.</p>
                  </section>
                )}

                {tab === "adsets" && duplicateDestination === "existing" && (
                  <section className="space-y-2">
                    <Label htmlFor="duplicate-target-campaign" className="text-sm font-semibold">Search campaign</Label>
                    <div className="relative">
                      <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
                      <select
                        id="duplicate-target-campaign"
                        value={duplicateTargetId}
                        onChange={e => setDuplicateTargetId(e.target.value)}
                        className="h-10 w-full appearance-none rounded-lg border border-input bg-background pl-9 pr-3 text-sm"
                      >
                        <option value="">Select campaign</option>
                        {campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                      </select>
                    </div>
                  </section>
                )}

                {tab === "ads" && duplicateDestination === "existing" && (
                  <section className="space-y-2">
                    <Label htmlFor="duplicate-target-adset" className="text-sm font-semibold">Search ad set</Label>
                    <button
                      type="button"
                      id="duplicate-target-adset"
                      aria-expanded={duplicateAdSetPickerOpen}
                      aria-controls="duplicate-target-adset-options"
                      onClick={() => setDuplicateAdSetPickerOpen(open => !open)}
                      className="flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3 text-left text-sm"
                    >
                      <span className={cn("truncate", !selectedDuplicateAdSet && "text-muted-foreground")}>
                        {duplicateAdSetOptionsLoading
                          ? "Loading ad sets..."
                          : selectedDuplicateAdSet
                            ? `${selectedDuplicateAdSet.campaign_name ? `${selectedDuplicateAdSet.campaign_name} / ` : ""}${selectedDuplicateAdSet.name}`
                            : "Select ad set"}
                      </span>
                      <IconChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", duplicateAdSetPickerOpen && "rotate-180")} />
                    </button>

                    {duplicateAdSetPickerOpen && (
                      <div
                        id="duplicate-target-adset-options"
                        className="overflow-hidden rounded-lg border border-input bg-background shadow-sm"
                      >
                        <div className="relative border-b p-2">
                          <IconSearch className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
                          <Input
                            autoFocus
                            value={duplicateAdSetSearch}
                            onChange={event => setDuplicateAdSetSearch(event.target.value)}
                            placeholder="Search campaign or ad set"
                            className="h-9 pl-9"
                          />
                        </div>
                        <div role="listbox" className="max-h-60 overflow-y-auto p-1">
                          {duplicateAdSetOptionsLoading ? (
                            <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading ad sets...</div>
                          ) : duplicateAdSetOptionsError ? (
                            <div className="px-3 py-6 text-center text-sm text-destructive">{duplicateAdSetOptionsError}. Close and reopen to retry.</div>
                          ) : filteredDuplicateAdSetOptions.length === 0 ? (
                            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No eligible ad sets found.</div>
                          ) : filteredDuplicateAdSetOptions.map(adSet => (
                            <button
                              key={adSet.id}
                              type="button"
                              role="option"
                              aria-selected={duplicateTargetId === adSet.id}
                              onClick={() => {
                                setDuplicateTargetId(adSet.id)
                                setDuplicateAdSetPickerOpen(false)
                                setDuplicateAdSetSearch("")
                              }}
                              className={cn(
                                "flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-muted",
                                duplicateTargetId === adSet.id && "bg-[#e7f3ff] dark:bg-blue-950/40",
                              )}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">{adSet.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">{adSet.campaign_name || "Campaign unavailable"}</span>
                              </span>
                              {duplicateTargetId === adSet.id && <IconCheck className="mt-0.5 size-4 shrink-0 text-[#1877f2]" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {tab !== "campaigns" && duplicateDestination === "new" && (
                  <section className="space-y-3 rounded-xl border p-4">
                    <div className="space-y-2">
                      <Label htmlFor="duplicate-new-name" className="text-sm font-semibold">New {tab === "adsets" ? "campaign" : "ad set"} name</Label>
                      <Input
                        id="duplicate-new-name"
                        value={duplicateNewName}
                        onChange={e => setDuplicateNewName(e.target.value)}
                        placeholder={tab === "adsets" ? "Enter campaign name" : "Enter ad set name"}
                        className="h-10 rounded-lg"
                      />
                    </div>
                    <div className="grid gap-2 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-2">
                      <div>
                        <div className="font-medium text-muted-foreground">Buying type</div>
                        <div className="mt-1 font-semibold text-foreground">Auction</div>
                      </div>
                      <div>
                        <div className="font-medium text-muted-foreground">Objective</div>
                        <div className="mt-1 font-semibold text-foreground">Inherited from source</div>
                      </div>
                    </div>
                  </section>
                )}

                {selectedIds.size === 1 && (
                  <section className="space-y-2">
                    <Label htmlFor="duplicate-name" className="text-sm font-semibold">Name</Label>
                    <Input
                      id="duplicate-name"
                      value={duplicateName}
                      onChange={e => setDuplicateName(e.target.value)}
                      placeholder="Leave blank to append - Copy"
                      className="h-10 rounded-lg"
                    />
                  </section>
                )}

            <section className="flex items-center justify-between gap-4 rounded-xl border p-4">
                  <div>
                    <Label htmlFor="duplicate-count" className="text-sm font-semibold">Number of copies</Label>
                    <p className="mt-1 text-xs text-muted-foreground">Up to 20 copies per selected item.</p>
                  </div>
                  <div className="flex items-center overflow-hidden rounded-lg border">
                    <button
                      type="button"
                      className="flex size-9 items-center justify-center text-lg font-semibold hover:bg-muted disabled:opacity-40"
                      disabled={duplicateCount <= 1}
                      onClick={() => setDuplicateCount(Math.max(1, duplicateCount - 1))}
                    >
                      -
                    </button>
                    <Input
                      id="duplicate-count"
                      type="number"
                      min={1}
                      max={20}
                      value={duplicateCount}
                      onChange={e => setDuplicateCount(Math.min(Math.max(parseInt(e.target.value) || 1, 1), 20))}
                      className="h-9 w-14 rounded-none border-0 text-center shadow-none focus-visible:ring-0"
                    />
                    <button
                      type="button"
                      className="flex size-9 items-center justify-center text-lg font-semibold hover:bg-muted disabled:opacity-40"
                      disabled={duplicateCount >= 20}
                      onClick={() => setDuplicateCount(Math.min(20, duplicateCount + 1))}
                    >
                      +
                    </button>
                  </div>
            </section>
          </div>

          <DialogFooter className="border-t bg-muted/20 px-6 py-4">
            {tab === "campaigns" ? (
              <>
                <Button variant="outline" onClick={() => setDuplicateDialogOpen(false)} disabled={isDuplicating}>Cancel</Button>
                <Button
                  variant="outline"
                  disabled={isDuplicating}
                  onClick={() => executeDuplicate(false)}
                >
                  Save draft
                </Button>
                <Button
                  onClick={openDuplicatePublishConfirm}
                  disabled={isDuplicating || !canDuplicate}
                  className="bg-[#1877f2] text-white hover:bg-[#166fe5]"
                >
                  {isDuplicating && <IconLoader2 className="mr-2 size-4 animate-spin" />}
                  Duplicate
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setDuplicateDialogOpen(false)} disabled={isDuplicating}>Cancel</Button>
                <Button
                  onClick={openDuplicatePublishConfirm}
                  disabled={isDuplicating || !canDuplicate}
                  className="bg-[#1877f2] text-white hover:bg-[#166fe5]"
                >
                  {isDuplicating && <IconLoader2 className="mr-2 size-4 animate-spin" />}
                  Next: choose status
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Publish Confirmation Dialog */}
      <Dialog open={duplicateConfirmOpen} onOpenChange={open => !isDuplicating && setDuplicateConfirmOpen(open)}>
        <DialogContent className="gap-0 p-0 sm:max-w-[500px]">
          <DialogHeader className="border-b px-6 py-5 text-left">
            <DialogTitle className="text-lg font-semibold text-foreground">How should the copies be created?</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-5 text-sm text-muted-foreground">
            Create paused copies to review safely, or create them active so delivery can start immediately.
          </div>
          <DialogFooter className="border-t bg-muted/20 px-6 py-4 sm:flex-row sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                setDuplicateConfirmOpen(false)
                setDuplicateDialogOpen(true)
              }}
              disabled={isDuplicating}
            >
              Back
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="outline"
                disabled={isDuplicating}
                onClick={() => executeDuplicate(false)}
              >
                Create paused
              </Button>
              <Button
                className="bg-[#078f67] text-white hover:bg-[#067b59]"
                disabled={isDuplicating}
                onClick={() => executeDuplicate(true)}
              >
                {isDuplicating && <IconLoader2 className="mr-1.5 size-4 animate-spin" />}
                Create and turn on
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* ── History Sheet ── */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-[480px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Launch History</SheetTitle>
            <SheetDescription>Recent ad launches across this workspace</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {historyLoading && (
              <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                <IconLoader2 className="size-4 animate-spin" /><span className="text-sm">Loading...</span>
              </div>
            )}
            {!historyLoading && historyBatches.length === 0 && (
              <div className="text-center py-10 text-sm text-muted-foreground">No launch history found for this workspace.</div>
            )}
            {!historyLoading && historyBatches.map((b: any) => (
              <div key={b.id} className="border rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-semibold",
                      b.status === "success" ? "bg-green-100 text-green-700" :
                      b.status === "partial" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                    )}>● {b.status}</span>
                    <span className="text-xs font-mono text-muted-foreground">{b.id.replace(/-/g, "").slice(-6).toUpperCase()}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div><span className="text-muted-foreground">Ads: </span><span className="font-medium">{b.total_ads} ({b.failed_ads} failed)</span></div>
                  <div><span className="text-muted-foreground">Launcher: </span><span className="font-medium">{b.launcher?.full_name || b.user_name || b.launcher?.email || "Unknown"}</span></div>
                  {b.ad_account_name && <div><span className="text-muted-foreground">Account: </span><span className="font-medium">{b.ad_account_name}</span></div>}
                  {b.headline && <div className="col-span-2"><span className="text-muted-foreground">Headline: </span><span className="font-medium truncate">{b.headline}</span></div>}
                  {b.cta && <div><span className="text-muted-foreground">CTA: </span><span className="font-medium">{b.cta}</span></div>}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Ad Defaults Sheet ── */}
      <Sheet open={defaultsOpen} onOpenChange={setDefaultsOpen}>
        <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Ad Defaults</SheetTitle>
            <SheetDescription>Default copy applied when launching new ads from this account</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-5 px-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Primary Text</label>
              <textarea
                value={defaultPrimaryText}
                onChange={e => setDefaultPrimaryText(e.target.value)}
                rows={3}
                placeholder="Default primary ad text..."
                className="w-full px-3 py-2.5 text-sm border rounded-lg outline-none focus:ring-1 focus:ring-ring resize-none bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Headline</label>
              <Input placeholder="Default headline..." value={defaultHeadline} onChange={e => setDefaultHeadline(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">CTA</label>
                <select
                  value={defaultCta}
                  onChange={e => setDefaultCta(e.target.value)}
                  className="w-full h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                >
                  {["SHOP_NOW","LEARN_MORE","SIGN_UP","BOOK_NOW","CONTACT_US","DOWNLOAD","GET_OFFER","ORDER_NOW","SEND_MESSAGE","SUBSCRIBE","APPLY_NOW","BUY_NOW"].map(c => (
                    <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Web Link</label>
                <Input placeholder="https://..." value={defaultLink} onChange={e => setDefaultLink(e.target.value)} />
              </div>
            </div>
          </div>
          <SheetFooter className="mt-8 pt-6 border-t">
            <Button variant="ghost" onClick={resetAllDefaults}>Reset All</Button>
            <Button onClick={saveDefaults} className="bg-blue-600 hover:bg-blue-700 text-white">Save Defaults</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Delete Confirm Dialog ──
          The old version named a count and a level and nothing else. It could not
          show that some of those objects were off screen, which is exactly the state
          a range selection plus a filter produces. Meta deletion is irreversible and
          there is no feature flag to stage it behind (TD-12), so this dialog is the
          only brake: it names the objects, states the hidden ones, and — above
          TYPED_DELETE_CONFIRM_THRESHOLD — asks for the count to be typed. */}
      <Dialog open={deleteConfirmOpen} onOpenChange={open => {
        setDeleteConfirmOpen(open)
        if (open) { setDeleteScope("all"); setDeleteListExpanded(false); setDeleteTypedConfirm("") }
      }}>
        <DialogContent className="max-w-md">
          {(() => {
            const targetIds = deleteScope === "visible" ? visibleSelectedIds : Array.from(selectedIds)
            const count = targetIds.length
            const noun = tab === "campaigns" ? "campaign" : tab === "adsets" ? "ad set" : "ad"
            const nouns = `${noun}${count === 1 ? "" : "s"}`
            // From the whole loaded tab, not `currentData` — the hidden rows are the
            // ones whose names matter most here, and they are not in `currentData`.
            const nameById = new Map(
              (tab === "campaigns" ? campaigns : tab === "adsets" ? adSets : ads).map(r => [r.id, r.name])
            )
            const rows = targetIds.map(id => ({
              id,
              name: nameById.get(id) ?? id,
              hidden: !visibleSelectedIds.includes(id),
            }))
            const shown = deleteListExpanded ? rows : rows.slice(0, 3)
            const hiddenInTarget = rows.filter(r => r.hidden).length
            const needsTyped = count > TYPED_DELETE_CONFIRM_THRESHOLD
            const confirmBlocked = isDeleting || count === 0 || (needsTyped && deleteTypedConfirm.trim() !== String(count))

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <IconTrash className="size-4 shrink-0" />
                    Delete {count} {nouns} from Meta?
                  </DialogTitle>
                  <DialogDescription>
                    This cannot be undone. Meta deletes these permanently and AdLauncher cannot restore them.
                  </DialogDescription>
                </DialogHeader>

                {hiddenInTarget > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-300 space-y-1.5">
                    <p>
                      <span className="font-semibold">{hiddenInTarget} of these are hidden by your filters</span> — they are not on
                      screen, but they will be deleted.
                    </p>
                    {visibleSelectedIds.length > 0 && (
                      <button
                        onClick={() => { setDeleteScope("visible"); setDeleteTypedConfirm("") }}
                        className="underline underline-offset-2 hover:no-underline font-medium"
                      >
                        Delete only the {visibleSelectedIds.length} visible
                      </button>
                    )}
                  </div>
                )}

                <div className="text-sm space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Will be deleted</p>
                  <ul className="max-h-40 overflow-y-auto space-y-0.5">
                    {shown.map(r => (
                      <li key={r.id} className="flex items-center gap-2 text-xs">
                        <span className="truncate">{r.name}</span>
                        {r.hidden && <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-500">hidden</span>}
                      </li>
                    ))}
                  </ul>
                  {rows.length > shown.length && (
                    <button onClick={() => setDeleteListExpanded(true)} className="text-xs text-primary hover:underline">
                      … and {rows.length - shown.length} more — show all
                    </button>
                  )}
                </div>

                {tab === "campaigns" && (
                  // No number: child counts are not loaded on this tab, and a guessed
                  // one would be worse than none.
                  <p className="text-xs text-muted-foreground">
                    Every ad set and ad inside these campaigns will also be deleted on Meta.
                  </p>
                )}

                {needsTyped && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Type <span className="font-semibold text-foreground">{count}</span> to confirm</label>
                    <Input
                      value={deleteTypedConfirm}
                      onChange={e => setDeleteTypedConfirm(e.target.value)}
                      placeholder={String(count)}
                      className="h-8 text-sm"
                    />
                  </div>
                )}

                <DialogFooter>
                  {/* Cancel is the default focus and Enter must not reach Delete. */}
                  <Button variant="outline" autoFocus onClick={() => setDeleteConfirmOpen(false)} disabled={isDeleting}>Cancel</Button>
                  <Button variant="destructive" onClick={handleDelete} disabled={confirmBlocked}>
                    {isDeleting && <IconLoader2 className="mr-2 size-4 animate-spin" />}
                    Delete {count} {nouns}
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Compare Attribution Settings Modal ── */}
      <Dialog open={attributionCompareOpen} onOpenChange={setAttributionCompareOpen}>
        <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-3 border-b">
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle>Compare attribution settings</DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed">
                  Compare when and how people take action after engaging with your ads.<br />
                  Selections in this tool are for reporting only and do not change ad optimisation.
                </DialogDescription>
              </div>
              <DialogClose className="rounded p-1 hover:bg-muted/50">×</DialogClose>
            </div>
          </DialogHeader>

          <div className="px-4 py-4 space-y-5 text-sm">
            <div>
              <p className="font-semibold mb-3">Standard attribution</p>
              <div className="space-y-3">
                {STANDARD_ATTR.map(a => (
                  <label key={a.key} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="size-5 rounded border-muted-foreground/40"
                      checked={draftAttribution.includes(a.key)}
                      onChange={() => setDraftAttribution(prev => prev.includes(a.key) ? prev.filter(k => k !== a.key) : [...prev, a.key])}
                    />
                    <span>{a.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="w-full flex items-center justify-between text-left p-2">
                <span>
                  <span className="block">Apple SKAdNetwork</span>
                  <span className="block text-xs text-muted-foreground">App ads only</span>
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {SKAN_ATTR.map(a => (
                  <label key={a.key} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="size-5 rounded border-muted-foreground/40"
                      checked={draftAttribution.includes(a.key)}
                      onChange={() => setDraftAttribution(prev => prev.includes(a.key) ? prev.filter(k => k !== a.key) : [...prev, a.key])}
                    />
                    <span>{a.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="font-semibold mb-3">Advanced option</p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="size-5 rounded border-muted-foreground/40"
                  checked={draftAttribution.includes("incremental")}
                  onChange={() => setDraftAttribution(prev => prev.includes("incremental") ? prev.filter(k => k !== "incremental") : [...prev, "incremental"])}
                />
                <span>Incremental attribution</span>
              </label>
            </div>
          </div>

          <DialogFooter className="px-4 py-3 border-t bg-muted/10">
            <Button variant="outline" onClick={() => setAttributionCompareOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setAttributionWindows(draftAttribution)
                setAttributionCompareOpen(false)
              }}
              className="bg-[#1877f2] hover:bg-[#1464d8] text-white"
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Customize Columns Modal ── */}
      <CustomizeColumnsModal
        open={customizeColsOpen}
        columnOrder={columnOrder}
        customMetrics={customMetrics}
        onApply={setColumnOrder}
        onSavePreset={saveCustomPreset}
        onSaveCustomMetric={m => setCustomMetrics(p => [...p, m])}
        onClose={() => setCustomizeColsOpen(false)}
      />

      {/* ── Edit Ad Set Drawer ── */}
      <EditAdSetDrawer
        adSetId={tab === "adsets" && editingNode ? editingNode.id : null}
        open={tab === "adsets" && !!editingNode}
        onOpenChange={(open) => {
          if (!open) setEditingNode(null)
        }}
        onSaved={() => {
          setEditingNode(null)
          clientCache.current.clear()
          fetchMainData(true)
        }}
        adAccountId={selectedAccountId ?? undefined}
        currency={selectedAccount?.currency || "USD"}
        timezoneName={selectedAccount?.timezone_name}
      />

      {/* ── Edit Side Panel (Campaign/Ad only) ── */}
      <Sheet open={!!editingNode && tab !== "adsets"} onOpenChange={(open) => !open && setEditingNode(null)}>
        <SheetContent className="w-full sm:w-[480px] flex flex-col p-0 gap-0 overflow-hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>{tab === "campaigns" ? "Edit Campaign" : "Edit Ad"}</SheetTitle>
            <SheetDescription>Edit settings for this {tab === "campaigns" ? "campaign" : "ad"}.</SheetDescription>
          </SheetHeader>
          {editingNode && (() => {
            const node = editingNode as any
            const isCampaign = tab === "campaigns"
            const isAdSet    = tab === "adsets"
            const isAd       = tab === "ads"
            const hasDailyBudget    = node.daily_budget != null && node.daily_budget !== ""
            const hasLifetimeBudget = node.lifetime_budget != null && node.lifetime_budget !== ""
            const hasBudget  = hasDailyBudget || hasLifetimeBudget
            const budgetCents = parseInt(node.daily_budget || node.lifetime_budget || "0")
            const insight    = getInsight(editingNode)
            const isActive   = node.status === "ACTIVE"

            const OBJECTIVE_LABEL: Record<string, string> = {
              OUTCOME_SALES: "Sales", OUTCOME_LEADS: "Leads", OUTCOME_TRAFFIC: "Traffic",
              OUTCOME_AWARENESS: "Awareness", OUTCOME_ENGAGEMENT: "Engagement",
              OUTCOME_APP_PROMOTION: "App Promotion", OUTCOME_REACH: "Reach",
              LINK_CLICKS: "Link Clicks", CONVERSIONS: "Conversions",
            }
            // Shared with the create flow and the editor. The local copy this replaced keyed ROAS
            // as MINIMUM_ROAS, which Graph never returns, so a ROAS ad set rendered its raw enum.
            const BID_LABEL: Record<string, string> = BID_STRATEGY_LABEL
            const OPT_LABEL: Record<string, string> = {
              LINK_CLICKS: "Link clicks", IMPRESSIONS: "Impressions", REACH: "Reach",
              LANDING_PAGE_VIEWS: "Landing page views", CONVERSIONS: "Conversions",
              OFFSITE_CONVERSIONS: "Offsite conversions", VIDEO_VIEWS: "Video views",
              LEAD_GENERATION: "Lead generation", APP_INSTALLS: "App installs",
            }
            const fmt = (iso?: string) => iso ? iso.slice(0, 16) : ""
            const toIso = (v: string) => v ? new Date(v).toISOString() : ""
            const typeLabel = isCampaign ? "Campaign" : isAdSet ? "Ad Set" : "Ad"
            const TypeIcon  = isCampaign ? IconSpeakerphone : isAdSet ? IconTarget : IconPhoto
            const typeColor = isCampaign ? "bg-blue-500" : isAdSet ? "bg-violet-500" : "bg-emerald-500"

            return (
              <>
                {/* ── Header ── */}
                <div className="flex items-center gap-3 px-5 py-4 border-b shrink-0">
                  <div className={cn("size-9 rounded-xl flex items-center justify-center text-white shrink-0", typeColor)}>
                    <TypeIcon className="size-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{typeLabel}</p>
                    <p className="text-sm font-semibold truncate leading-tight">{node.name}</p>
                  </div>
                  <span className={cn(
                    "shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold",
                    isActive
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                  )}>
                    <span className={cn("size-1.5 rounded-full", isActive ? "bg-green-500" : "bg-neutral-400")} />
                    {isActive ? "Active" : "Paused"}
                  </span>
                </div>

                {/* ── Scrollable body ── */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

                  {/* Performance row */}
                  {insight && (
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: "Spend",  value: fmtMoney(getSpend(editingNode)), accent: true },
                        { label: "Results",value: String(getResults(editingNode, node.objective).count) },
                        { label: "Impr.",  value: parseInt(insight.impressions).toLocaleString() },
                        { label: "Clicks", value: parseInt(insight.clicks).toLocaleString() },
                      ].map(s => (
                        <div key={s.label} className="rounded-xl bg-muted/40 border px-2.5 py-2 text-center">
                          <p className="text-xs text-muted-foreground mb-0.5">{s.label}</p>
                          <p className={cn("text-sm font-bold tabular-nums truncate", s.accent && "text-primary")}>{s.value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Settings section ── */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Settings</p>

                    {/* Name */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <Input
                        value={node.name}
                        onChange={e => setEditingNode({ ...node, name: e.target.value })}
                        className="h-9 text-sm bg-background"
                      />
                    </div>

                    {/* Status toggle */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Status</Label>
                      <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-muted/50 border">
                        {(["ACTIVE", "PAUSED"] as const).map(s => (
                          <button
                            key={s}
                            onClick={() => setEditingNode({ ...node, status: s })}
                            className={cn(
                              "h-8 rounded-md text-xs font-semibold transition-all",
                              node.status === s
                                ? s === "ACTIVE"
                                  ? "bg-green-500 text-white shadow-sm"
                                  : "bg-background text-foreground shadow-sm border"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {s === "ACTIVE" ? "● Active" : "○ Paused"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Budget */}
                    {(isCampaign || isAdSet) && (
                      hasBudget ? (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">
                            {hasDailyBudget ? "Daily Budget" : "Lifetime Budget"}
                          </Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-sm">$</span>
                            <Input
                              type="number" step="0.01" min="0"
                              className="pl-7 h-9 text-sm bg-background"
                              value={budgetCents / 100}
                              onChange={e => {
                                const cents = Math.round((parseFloat(e.target.value) || 0) * 100).toString()
                                setEditingNode(hasDailyBudget ? { ...node, daily_budget: cents } : { ...node, lifetime_budget: cents })
                              }}
                            />
                          </div>
                          {isAdSet && node.budget_remaining != null && (
                            <p className="text-xs text-muted-foreground">
                              Remaining: <span className="font-medium text-foreground">{fmtMoney((parseInt(node.budget_remaining) / 100))}</span>
                            </p>
                          )}
                        </div>
                      ) : isAdSet ? (
                        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40 text-xs text-blue-600 dark:text-blue-400">
                          <IconSpeakerphone className="size-3.5 shrink-0" />
                          Budget set at campaign level (CBO)
                        </div>
                      ) : null
                    )}

                    {/* Schedule */}
                    {(isCampaign || isAdSet) && (
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Start</Label>
                          <Input type="datetime-local" className="h-9 text-xs bg-background"
                            value={fmt(node.start_time)}
                            onChange={e => setEditingNode({ ...node, start_time: toIso(e.target.value) })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">End</Label>
                          <Input type="datetime-local" className="h-9 text-xs bg-background"
                            value={fmt(isCampaign ? node.stop_time : node.end_time)}
                            onChange={e => {
                              const iso = toIso(e.target.value)
                              setEditingNode(isCampaign ? { ...node, stop_time: iso } : { ...node, end_time: iso })
                            }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Strategy tags ── */}
                  {((isCampaign && (node.objective || node.bid_strategy)) ||
                    (isAdSet && (node.optimization_goal || node.bid_strategy))) && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Strategy</p>
                      <div className="flex flex-wrap gap-1.5">
                        {isCampaign && node.objective && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium border border-blue-200/70 dark:border-blue-700/40">
                            {OBJECTIVE_LABEL[node.objective] ?? node.objective}
                          </span>
                        )}
                        {isAdSet && node.optimization_goal && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 text-xs font-medium border border-violet-200/70 dark:border-violet-700/40">
                            {OPT_LABEL[node.optimization_goal] ?? node.optimization_goal}
                          </span>
                        )}
                        {node.bid_strategy && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-xs font-medium border">
                            {BID_LABEL[node.bid_strategy] ?? node.bid_strategy}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Creative preview (Ad only) ── */}
                  {isAd && (node.creative?.thumbnail_url || node.creative?.title || node.creative?.body) && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Creative</p>
                      <div className="rounded-2xl border overflow-hidden shadow-sm">
                        {node.creative.thumbnail_url && (
                          <img src={node.creative.thumbnail_url} className="w-full object-cover max-h-52" loading="lazy" />
                        )}
                        {(node.creative.title || node.creative.body) && (
                          <div className="px-3.5 py-3 space-y-3 bg-neutral-50 dark:bg-neutral-900 border-t">
                            <div className="space-y-1">
                              {node.creative.title && (
                                <p className="text-sm font-semibold leading-snug line-clamp-2 text-foreground">{node.creative.title}</p>
                              )}
                              {node.creative.body && (
                                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{node.creative.body}</p>
                              )}
                            </div>

                            {node.creative_variations && (
                              <div className="pt-2 border-t border-dashed space-y-2">
                                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Additional Variations</p>

                                {node.creative_variations.titles.length > 1 && (
                                  <div className="space-y-1">
                                    <span className="text-[10px] text-muted-foreground">Headlines:</span>
                                    {node.creative_variations.titles.slice(1).map((t: string, i: number) => (
                                      <p key={i} className="text-xs font-medium text-foreground bg-white dark:bg-black border rounded px-2 py-1 line-clamp-1">{t}</p>
                                    ))}
                                  </div>
                                )}

                                {node.creative_variations.bodies.length > 1 && (
                                  <div className="space-y-1">
                                    <span className="text-[10px] text-muted-foreground">Primary Texts:</span>
                                    {node.creative_variations.bodies.slice(1).map((b: string, i: number) => (
                                      <p key={i} className="text-xs text-muted-foreground bg-white dark:bg-black border rounded px-2 py-1 line-clamp-2">{b}</p>
                                    ))}
                                  </div>
                                )}

                                {node.creative_variations.descriptions.length > 1 && (
                                  <div className="space-y-1">
                                    <span className="text-[10px] text-muted-foreground">Descriptions:</span>
                                    {node.creative_variations.descriptions.slice(1).map((d: string, i: number) => (
                                      <p key={i} className="text-xs text-muted-foreground bg-white dark:bg-black border rounded px-2 py-1 line-clamp-1">{d}</p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {tab !== "ads" && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Details</p>
                      <div className="rounded-xl border overflow-hidden text-xs">
                        <button
                          className="w-full flex items-center gap-2 px-3 py-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors text-left"
                          onClick={() => {
                            setEditingNode(null)
                            if (tab === "campaigns") drillToAdSets(node)
                            else if (tab === "adsets") drillToAds(node)
                          }}
                        >
                          <IconExternalLink className="size-3.5 shrink-0" />
                          View Ads Manager
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Footer ── */}
                <div className="shrink-0 border-t px-5 py-4 flex items-center justify-end gap-2 bg-background">
                  <Button variant="ghost" size="sm" onClick={() => setEditingNode(null)} className="text-muted-foreground">
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveSidePanelEdit(node)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-5"
                  >
                    Save changes
                  </Button>
                </div>
              </>
            )
          })()}
        </SheetContent>
      </Sheet>

      {bulkStatusOpen && (
        <BulkStatusChangeDialog
          key={`${currentDraftLevel}:${bulkStatusField}`}
          open={bulkStatusOpen}
          level={currentDraftLevel}
          items={selectedBulkItems}
          drafts={bulkDrafts}
          field={bulkStatusField}
          publishing={bulkPublishing}
          onOpenChange={setBulkStatusOpen}
          onSave={next => {
            replaceBulkDrafts(next)
            const count = selectedBulkItems.length
            setActionToast({ kind: "success", message: `Saved draft edits for ${count} item${count === 1 ? "" : "s"}` })
          }}
          onPublish={(next, keys) => {
            replaceBulkDrafts(next)
            void publishBulkDrafts(keys, next)
          }}
        />
      )}

      {bulkEditorOpen && (
        <BulkEditDraftDialog
          key={`${currentDraftLevel}:${bulkEditorField}`}
          open={bulkEditorOpen}
          level={currentDraftLevel}
          items={selectedBulkItems}
          drafts={bulkDrafts}
          hierarchy={bulkEditHierarchy}
          initialField={bulkEditorField}
          onOpenChange={setBulkEditorOpen}
          onSave={next => {
            replaceBulkDrafts(next)
            const count = selectedBulkItems.length
            setActionToast({ kind: "success", message: `Saved draft edits for ${count} item${count === 1 ? "" : "s"}` })
          }}
        />
      )}

      {bulkReviewOpen && (
        <BulkDraftReviewDialog
          open={bulkReviewOpen}
          drafts={bulkDrafts}
          publishing={bulkPublishing}
          results={bulkPublishResults}
          initialKeys={bulkReviewInitialKeys}
          onOpenChange={open => {
            if (!bulkPublishing) setBulkReviewOpen(open)
          }}
          onPublish={publishBulkDrafts}
        />
      )}

      <Dialog open={bulkDiscardConfirmOpen} onOpenChange={setBulkDiscardConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Discard drafts?</DialogTitle>
            <DialogDescription>
              All {bulkDraftCount} unpublished edit{bulkDraftCount === 1 ? "" : "s"} in this ad account will be removed. Meta will not be changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDiscardConfirmOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                replaceBulkDrafts({})
                setBulkDiscardConfirmOpen(false)
                setActionToast({ kind: "success", message: "Discarded all unpublished edits" })
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {actionToast && (
        <div className={cn(
          "fixed bottom-6 right-6 z-[100] flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg text-sm",
          actionToast.kind === "success"
            ? "bg-white dark:bg-background border-green-200 dark:border-green-900 text-[#1c2b33] dark:text-foreground"
            : "bg-white dark:bg-background border-red-200 dark:border-red-900 text-red-600"
        )}>
          {actionToast.kind === "success"
            ? <IconCheck className="size-4 text-green-600 shrink-0" />
            : <IconX className="size-4 shrink-0" />}
          <span>{actionToast.message}</span>
          {actionToast.href && (
            <button className="font-semibold text-[#1877f2] hover:underline" onClick={() => router.push(actionToast.href!)}>
              View
            </button>
          )}
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setActionToast(null)}>
            <IconX className="size-3.5" />
          </button>
        </div>
      )}

      {miniStatusPopup && (
        <MiniStatusPopup
          title={miniStatusPopup.title}
          total={miniStatusPopup.total}
          items={miniStatusPopup.items}
          onDone={() => setMiniStatusPopup(null)}
        />
      )}

      {performancePopup && selectedAccountId && (
        <PerformancePopup
          mode={performancePopup.mode}
          initialView={performancePopup.initialView}
          unifiedWorkspace={workspaceAccess.enabled}
          canMutate={workspaceAccess.canMutate}
          rows={performancePopup.rows}
          level={level}
          accountId={selectedAccountId}
          datePreset={datePreset === "custom" ? "last_30d" : datePreset}
          since={drawerSince}
          until={drawerUntil}
          onClose={() => setPerformancePopup(null)}
          campaigns={campaigns}
          adSets={adSets}
          ads={ads}
          onDuplicate={(id: string) => { setSelectedIds(new Set([id])); setDuplicateDialogOpen(true) }}
          onDelete={(id: string) => { setSelectedIds(new Set([id])); setDeleteConfirmOpen(true) }}
          onEdit={(id: string) => {
            const node = campaigns.find(x => x.id === id) || adSets.find(x => x.id === id) || ads.find(x => x.id === id) || null
            if (node) openWorkspaceEditor(node)
          }}
          onSaveEdit={saveSidePanelEdit}
          onCreate={() => {
            setPerformancePopup(null)
            setCreateInitialState(undefined)
            setCreateModalOpen(true)
          }}
          onCreateReplacement={openReplacementCreate}
          onPublished={() => {
            clientCache.current.clear()
            fetchMainData(true)
          }}
          onViewHistory={(_id: string) => { setHistoryOpen(true); fetchHistory() }}
          attributionWindows={attributionWindows}
        />
      )}

    </div>
  )
}

export default function AdsManagerPage() {
  return (
    <Suspense>
      <AdsManagerContent />
    </Suspense>
  )
}
