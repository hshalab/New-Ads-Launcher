"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  IconChevronDown, IconDownload, IconHistory, IconLoader2, IconPlus, IconCalendar,
  IconSettings, IconX, IconDots, IconMessageCircle, IconChartLine, IconPencil,
  IconEye, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconListCheck,
} from "@tabler/icons-react"
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts"
import { cn } from "@/lib/utils"
import {
  Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Level, ReportRow } from "./InsightDrawers"
import { AdsDateRangePicker } from "./AdsDateRangePicker"
import { UnifiedWorkspaceEditor, type WorkspaceNode } from "./UnifiedWorkspaceEditor"
import { workspaceDraftChangeLabels } from "@/lib/ads-manager-bulk-drafts"
import {
  clearEditorDrafts,
  flushEditorDrafts,
  loadEditorDrafts,
  saveEditorDrafts,
} from "@/lib/editor-drafts"

type Tab = "trends" | "breakdowns"

const SERIES = ["#2a78d6", "#4b9cd3", "#5b0a66", "#2f9e44", "#e67700", "#9c36b5", "#0ca678", "#868e96"]
const GRID = "#e1e0d9"
const MUTED = "#898781"

type MetricItem = { key: string; label: string; fmt: (v: number) => string; desc: string }

const METRIC_GROUPS: { group: string; items: MetricItem[] }[] = [
  {
    group: "Performance",
    items: [
      { key: "spend", label: "Amount spent", fmt: v => fmt$(v), desc: "The total amount of money you spent on your campaigns, ad sets or ads during their lifetime." },
      { key: "impressions", label: "Impressions", fmt: fmtN, desc: "The number of times your ads were on screen." },
      { key: "reach", label: "Reach", fmt: fmtN, desc: "The number of people who saw your ads at least once." },
      { key: "frequency", label: "Frequency", fmt: v => fmt(v, 2), desc: "The average number of times each person saw your ad." },
      { key: "results", label: "Results", fmt: fmtN, desc: "The number of times your ad achieved an outcome, based on the objective and settings you selected." },
    ],
  },
  {
    group: "Conversions",
    items: [
      { key: "purchases", label: "Website purchases", fmt: fmtN, desc: "The number of purchase events tracked by the pixel or conversions API on your website and attributed to your ads." },
      { key: "costPerPurchase", label: "Per purchase", fmt: fmt$, desc: "The average cost of each website purchase." },
      { key: "roas", label: "Purchase ROAS", fmt: v => fmt(v, 2) + "x", desc: "Purchase return on ad spend (ROAS), calculated as purchase conversion value divided by total spend." },
      { key: "purchaseValue", label: "Purchases conversion value", fmt: fmt$, desc: "The total value of website purchase conversions attributed to your ads." },
      { key: "contentViews", label: "Content views", fmt: fmtN, desc: "The number of website content view events attributed to your ads." },
      { key: "addToCart", label: "Adds to cart", fmt: fmtN, desc: "The number of add to cart events attributed to your ads." },
      { key: "initiateCheckout", label: "Checkouts initiated", fmt: fmtN, desc: "The number of checkout initiated events attributed to your ads." },
    ],
  },
  {
    group: "Clicks",
    items: [
      { key: "linkClicks", label: "Link clicks", fmt: fmtN, desc: "The number of clicks on links within the ad that led to advertiser-specified destinations." },
      { key: "ctrAll", label: "CTR (all)", fmt: v => fmt(v, 2) + "%", desc: "The percentage of times people saw your ad and performed any click." },
      { key: "cpm", label: "CPM", fmt: fmt$, desc: "The average cost per 1,000 impressions." },
    ],
  },
  {
    group: "Video",
    items: [
      { key: "hookRate", label: "Hook rate", fmt: v => fmt(v, 2) + "%", desc: "The percentage of video views that lasted 3 seconds or more, measuring initial hook strength." },
      { key: "holdRate", label: "Hold rate", fmt: v => fmt(v, 2) + "%", desc: "The percentage of video views that lasted 15 seconds or more, measuring retention." },
      { key: "avgWatchTime", label: "Avg. watch time", fmt: fmtSec, desc: "The average watch time of your video ads." },
    ],
  },
]

const ALL_METRICS = METRIC_GROUPS.flatMap(g => g.items)
const metricItem = (k: string): MetricItem => ALL_METRICS.find(m => m.key === k) || { key: k, label: k, fmt: fmtN, desc: "" }
const metricLabel = (k: string) => metricItem(k).label
const metricFmt = (k: string) => metricItem(k).fmt
const metricDesc = (k: string) => metricItem(k).desc

const BREAKDOWN_OPTS = [
  { key: "age,gender", label: "Age and gender" },
  { key: "publisher_platform", label: "Platform" },
  { key: "platform_position", label: "Placement" },
  { key: "impression_device", label: "Impression device" },
  { key: "country", label: "Country" },
  { key: "media_type", label: "Media type" },
]

const MAX_ROWS = 8
const MAX_ACTIVE_METRICS = 3

// ─── formatters ──────────────────────────────────────────────────────────────
function fmt(v: number, d = 2) {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmt$(v: number) {
  if (v == null || !Number.isFinite(v) || v === 0) return "—"
  return "$" + fmt(v, 2)
}
function fmtN(v: number) {
  if (v == null || !Number.isFinite(v) || v === 0) return "—"
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M"
  if (v >= 1000) return (v / 1000).toFixed(1) + "K"
  return String(Math.round(v * 100) / 100)
}
function fmtSec(v: number) {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—"
  const s = Math.round(v)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `0:${String(r).padStart(2, "0")}`
}

function downloadCsv(filename: string, rows: { label: string; value: number | string }[]) {
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`
  const csv = ["Label,Value", ...rows.map(r => `${esc(r.label)},${esc(r.value)}`)].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function splitActivity(summary: string, type: string) {
  const text = summary || type || "Activity"
  const [activity, ...rest] = text.split(":")
  return { activity: activity || "Activity", details: rest.join(":").trim() || "—" }
}

function fmtActivityTime(time: string | null | undefined) {
  if (!time) return "—"
  return new Date(time).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", " at")
}

interface Series { date: string; label: string; value: number }
interface BreakdownRow { label: string; [key: string]: any }

// Age buckets in Meta's standard ascending order
const AGE_ORDER = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
const ageRank = (a: string) => {
  const i = AGE_ORDER.indexOf(a)
  return i === -1 ? 99 : i
}

// Compute since/until (YYYY-MM-DD) for a granularity's default window.
// Day = 7d, Week = 7 weeks (~49d), Month = 6 months (~180d).
function rangeForGranularity(g: "day" | "week" | "month"): { since: string; until: string } {
  const until = new Date()
  const start = new Date(until)
  if (g === "day") start.setDate(until.getDate() - 6)
  else if (g === "week") start.setDate(until.getDate() - 48)
  else start.setMonth(until.getMonth() - 6)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return { since: iso(start), until: iso(until) }
}

// Pretty title for the trend chart's date window
function titleForGranularity(g: "day" | "week" | "month"): string {
  const { since, until } = rangeForGranularity(g)
  const f = (s: string) => {
    const d = new Date(s + "T00:00:00")
    return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }
  return `${f(since)} – ${f(until)}`
}

// KPI cards per level (Charts single-object)
function cardsForLevel(level: Level) {
  const base = [
    { key: "purchases", label: "Website purchases" },
    { key: "costPerPurchase", label: "Per purchase" },
  ]
  if (level === "campaign") return [...base, { key: "spend", label: "Amount spent" }]
  return [...base, { key: "roas", label: "Purchase ROAS" }] // adset + ad default
}

// ── Sidebar tree node action menu (Meta-style) ──────────────────────────────
function NodeActionMenu({ level, id, onDuplicate, onDelete, onEdit, onViewHistory, onSeeHistory }: {
  level: string; id: string
  onDuplicate?: (id: string) => void
  onDelete?: (id: string) => void
  onEdit?: (id: string) => void
  onViewHistory?: (id: string) => void
  onSeeHistory?: (id: string, level: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])
  const copyId = () => { try { navigator.clipboard?.writeText(id) } catch {} setOpen(false) }
  const Item = ({ label, shortcut, onClick, disabled }: { label: string; shortcut?: string; onClick: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}
      className={cn("w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-muted/50", disabled && "opacity-40 cursor-not-allowed")}>
      <span>{label}</span>
      {shortcut && <span className="text-[10px] text-muted-foreground">{shortcut}</span>}
    </button>
  )
  return (
    <div ref={ref} className="relative inline-flex">
      <button onClick={e => { e.stopPropagation(); setOpen(o => !o) }} className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10">
        <IconDots className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-5 z-50 w-52 bg-background border rounded-lg shadow-xl py-1">
          <p className="px-3 py-1 text-[10px] uppercase text-muted-foreground">Actions for this {level}</p>
          <div className="border-t my-1" />
          <Item label="Duplicate" shortcut="Ctrl+Shift+D" disabled={!onDuplicate} onClick={() => onDuplicate?.(id)} />
          <Item label="Quickly duplicate" shortcut="Ctrl+D" disabled={!onDuplicate} onClick={() => onDuplicate?.(id)} />
          <Item label="Delete" shortcut="Ctrl+Del" disabled={!onDelete} onClick={() => onDelete?.(id)} />
          <div className="border-t my-1" />
          <Item label="Edit" disabled={!onEdit} onClick={() => onEdit?.(id)} />
          <Item label="See history" disabled={!onSeeHistory} onClick={() => onSeeHistory?.(id, level)} />
          <div className="border-t my-1" />
          <Item label="Copy ID" onClick={copyId} />
        </div>
      )}
    </div>
  )
}

export function PerformancePopup({
  mode, level, accountId, rows, datePreset, since, until, onClose,
  campaigns, adSets, ads, onDuplicate, onDelete, onEdit, onViewHistory,
  attributionWindows, initialView = "charts", onSaveEdit, onCreate,
  onCreateReplacement, unifiedWorkspace = false, canMutate = false, onPublished,
  shell = "modal", canCollapse = false,
}: {
  mode: "charts" | "compare"
  level: Level
  accountId: string
  rows: ReportRow[]
  datePreset: string
  since: string
  until: string
  onClose: () => void
  campaigns?: any[]
  adSets?: any[]
  ads?: any[]
  onDuplicate?: (id: string) => void
  onDelete?: (id: string) => void
  onEdit?: (id: string) => void
  onViewHistory?: (id: string) => void
  attributionWindows?: string[]
  initialView?: "charts" | "edit" | "review" | "history"
  onSaveEdit?: (node: WorkspaceNode) => Promise<void> | void
  onCreate?: () => void
  onCreateReplacement?: (node: WorkspaceNode, level: Level) => void
  unifiedWorkspace?: boolean
  canMutate?: boolean
  onPublished?: () => void
  /**
   * "modal" is the legacy centred dialog, still used by compare mode. "page" is the routed editor:
   * it fills the Ads Manager main area and can collapse to an overlay that leaves the live table
   * visible on the left.
   */
  shell?: "modal" | "page"
  /**
   * Whether an Ads Manager table is actually mounted behind this shell. False on a hard load of
   * /ads-manager/editor — collapsing would then reveal an empty pane, so the control is disabled.
   */
  canCollapse?: boolean
}) {
  const baseCapped = rows.slice(0, MAX_ROWS)
  const overCap = rows.length > MAX_ROWS
  const isCompare = mode === "compare"
  const isPage = shell === "page"

  // ── States ────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>("trends")
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day")

  const [calOpen, setCalOpen] = useState(false)
  const [sinceOverride, setSinceOverride] = useState(since)
  const [untilOverride, setUntilOverride] = useState(until)
  const [presetOverride, setPresetOverride] = useState(datePreset)

  // Charts mode active metric
  const [metric, setMetric] = useState("spend")
  const [activeCard, setActiveCard] = useState<string | null>(null)

  // Compare mode charts list
  const [compareCharts, setCompareCharts] = useState<string[]>(["spend"])
  const [compareBreakdown, setCompareBreakdown] = useState("age,gender")
  const [addChartOpen, setAddChartOpen] = useState(false)

  // Filters for Charts mode
  const [activityFilter, setActivityFilter] = useState("all")
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["spend", "purchases", "costPerPurchase"])
  const [draftMetrics, setDraftMetrics] = useState<string[]>(selectedMetrics)
  const [previewMode, setPreviewMode] = useState("all")
  const [commentsFilter, setCommentsFilter] = useState("facebook_feed")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  /**
   * Collapsed = Meta's "Collapse view": the editor becomes an overlay on the right and the live
   * Ads Manager table on the left becomes the navigator. Exactly one navigator is visible at a
   * time, which is why the hierarchy tree is not rendered here (it would float over the form).
   */
  const [collapsed, setCollapsed] = useState(false)
  const [prefBenchmark, setPrefBenchmark] = useState(true)
  const [prefSimilar, setPrefSimilar] = useState(true)
  const [customizeTab, setCustomizeTab] = useState<"metrics" | "preferences">("metrics")

  // Platform Section filters
  const [platMetric, setPlatMetric] = useState("results")
  // Demographics (Age/Gender) filters
  const [demoMetric, setDemoMetric] = useState("results")
  const [demoGender, setDemoGender] = useState<"all" | "male" | "female">("all")
  // Charts popup sub-page: main charts vs dedicated activity history
  const [chartsPage, setChartsPage] = useState<"charts" | "history">("charts")
  const [workspaceView, setWorkspaceView] = useState<"charts" | "edit" | "review" | "history">(initialView)

  useEffect(() => {
    setWorkspaceView(initialView)
  }, [initialView])

  // Data storage
  // Key: rowId + ":" + metric
  const [trendDataStore, setTrendDataStore] = useState<Record<string, Series[]>>({})
  const [breakdownDataStore, setBreakdownDataStore] = useState<Record<string, BreakdownRow[]>>({})

  const [metricsByRow, setMetricsByRow] = useState<Record<string, any>>({})
  const [creativeByRow, setCreativeByRow] = useState<Record<string, any>>({})
  const [videoByRow, setVideoByRow] = useState<Record<string, any>>({})
  const [activities, setActivities] = useState<any[]>([])
  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Demographics + Platform sections
  const [demoRows, setDemoRows] = useState<BreakdownRow[]>([])
  const [platRows, setPlatRows] = useState<BreakdownRow[]>([])
  const [demoLoading, setDemoLoading] = useState(false)
  const [chartsSub, setChartsSub] = useState<"demographics" | "platform">("demographics")

  // ── Charts mode: active-node override (tree click) ─────────────────────────
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [activeNodeLevel, setActiveNodeLevel] = useState<Level>(level)
  const [histActivityFilter, setHistActivityFilter] = useState<string>("all") // history table Activity
  const [histActorFilter, setHistActorFilter] = useState<string>("all") // history table Changed by (Anyone)
  const [localCampaigns, setLocalCampaigns] = useState<any[]>([])
  const [localAdSets, setLocalAdSets] = useState<any[]>([])
  const [localAds, setLocalAds] = useState<any[]>([])
  const [workspaceDetails, setWorkspaceDetails] = useState<Record<string, WorkspaceNode>>({})
  const [workspaceDetailLoading, setWorkspaceDetailLoading] = useState<Record<string, boolean>>({})
  const [workspaceDetailErrors, setWorkspaceDetailErrors] = useState<Record<string, string>>({})
  const [workspaceDetailRefresh, setWorkspaceDetailRefresh] = useState(0)
  const [workspaceDrafts, setWorkspaceDrafts] = useState<Record<string, WorkspaceNode>>({})
  const [workspacePublishResults, setWorkspacePublishResults] = useState<Array<{
    id: string
    level: Level
    status: "published" | "failed" | "skipped"
    message?: string
  }>>([])
  const [workspacePublishing, setWorkspacePublishing] = useState(false)
  const [workspaceDiscardConfirm, setWorkspaceDiscardConfirm] = useState(false)
  const workspaceDirty = Object.keys(workspaceDrafts).length > 0
  const historyRef = useRef<HTMLDivElement>(null)
  const workspaceContentRef = useRef<HTMLDivElement>(null)

  // ── Draft survival ─────────────────────────────────────────────────────────
  // Staged edits used to live only in this component's state, which was safe while the editor was
  // a modal that never unmounted. It is a route now: navigating between nodes, or refreshing,
  // unmounts it. sessionStorage carries the drafts across that gap. See lib/editor-drafts.ts.
  const draftsHydrated = useRef(false)
  const workspaceDraftsRef = useRef(workspaceDrafts)
  workspaceDraftsRef.current = workspaceDrafts

  useEffect(() => {
    if (!unifiedWorkspace || !accountId) return
    draftsHydrated.current = false
    const stored = loadEditorDrafts<WorkspaceNode>(accountId)
    if (Object.keys(stored).length > 0) setWorkspaceDrafts(stored)
    draftsHydrated.current = true
  }, [unifiedWorkspace, accountId])

  useEffect(() => {
    // Guarded on hydration so the initial empty state cannot erase what was just restored.
    if (!unifiedWorkspace || !accountId || !draftsHydrated.current) return
    saveEditorDrafts(accountId, workspaceDrafts)
  }, [unifiedWorkspace, accountId, workspaceDrafts])

  useEffect(() => {
    if (!unifiedWorkspace || !accountId) return
    // The 300ms debounce loses the last keystroke on a fast unmount; flush synchronously instead.
    return () => flushEditorDrafts(accountId, workspaceDraftsRef.current)
  }, [unifiedWorkspace, accountId])

  // The parent lists can be one cursor page. Merge them with the editor's targeted
  // hierarchy reads so opening an Ad does not lose its campaign siblings.
  const mergeHierarchyRows = (primary: any[] = [], local: any[] = []) =>
    Array.from(new Map([...local, ...primary].map(item => [item.id, item])).values())
  const allCampaigns = mergeHierarchyRows(campaigns, localCampaigns)
  const allAdSets = mergeHierarchyRows(adSets, localAdSets)
  const allAds = mergeHierarchyRows(ads, localAds)

  // Active level for fetches: override if a tree node is selected, else prop level
  const effectiveLevel: Level = isCompare ? level : (activeNodeId ? activeNodeLevel : level)

  // Reset override when popup target changes
  useEffect(() => {
    setActiveNodeId(null)
    setActiveNodeLevel(level)
    setHistActivityFilter("all")
    setHistActorFilter("all")
    setLocalCampaigns([])
    setLocalAdSets([])
    setLocalAds([])
  }, [rows.map(r => r.id).join(","), level]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve display name for the selected node from the merged hierarchy
  const activeNodeName = useMemo(() => {
    if (!activeNodeId) return null
    const hit = allCampaigns.find(c => c.id === activeNodeId)
      || allAdSets.find(a => a.id === activeNodeId)
      || allAds.find(a => a.id === activeNodeId)
    return hit?.name ?? null
  }, [activeNodeId, allCampaigns, allAdSets, allAds])

  // In charts mode all fetches target the selected node (or rows[0]); compare uses full rows.
  const capped: ReportRow[] = isCompare
    ? baseCapped
    : [{
        id: activeNodeId ?? baseCapped[0]?.id ?? "",
        name: activeNodeName ?? baseCapped[0]?.name ?? "",
      }]

  const selectNode = (id: string, lvl: Level) => {
    setActiveNodeId(id)
    setActiveNodeLevel(lvl)
  }

  const nodeLevelForId = (id: string): Level => {
    if (allCampaigns.some(item => item.id === id)) return "campaign"
    if (allAds.some(item => item.id === id)) return "ad"
    return "adset"
  }

  const openWorkspaceEditor = (id: string, lvl?: Level) => {
    selectNode(id, lvl || nodeLevelForId(id))
    setWorkspaceView("edit")
  }

  const updateWorkspaceDraft = useCallback((node: WorkspaceNode, nodeLevel: Level) => {
    setWorkspaceDrafts(current => ({ ...current, [`${nodeLevel}:${node.id}`]: node }))
    setWorkspacePublishResults([])
  }, [])

  const discardWorkspaceDraft = useCallback((nodeLevel: Level, id: string) => {
    const key = `${nodeLevel}:${id}`
    setWorkspaceDrafts(current => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setWorkspacePublishResults([])
  }, [])

  const requestWorkspaceClose = () => {
    if (unifiedWorkspace && workspaceDirty) {
      setWorkspaceDiscardConfirm(true)
      return
    }
    onClose()
  }

  useEffect(() => {
    if (!unifiedWorkspace || !workspaceDirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (accountId) flushEditorDrafts(accountId, workspaceDraftsRef.current)
      event.preventDefault()
      event.returnValue = ""
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        setWorkspaceView("review")
      } else if (event.key === "Escape" && !editing) {
        event.preventDefault()
        setWorkspaceDiscardConfirm(true)
      }
    }
    window.addEventListener("beforeunload", beforeUnload)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [unifiedWorkspace, workspaceDirty, accountId])

  const publishWorkspaceChanges = async () => {
    const entries = Object.entries(workspaceDrafts)
    if (!entries.length || workspacePublishing) return
    setWorkspacePublishing(true)
    try {
      const response = await fetch("/api/ads-manager/workspace-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adAccountId: accountId,
          changes: entries.map(([key, node]) => ({
            level: key.split(":")[0] as Level,
            node,
          })),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to publish workspace changes")
      const results = Array.isArray(data.results) ? data.results : []
      setWorkspacePublishResults(results)

      const publishedKeys = new Set(
        results
          .filter((result: { status?: string }) => result.status === "published")
          .map((result: { id: string; level: Level }) => `${result.level}:${result.id}`)
      )
      setWorkspaceDrafts(current => Object.fromEntries(
        Object.entries(current).filter(([key]) => !publishedKeys.has(key))
      ))
      setWorkspaceDetails(current => Object.fromEntries(
        Object.entries(current).filter(([key]) => !publishedKeys.has(key))
      ))
      onPublished?.()
    } catch (error) {
      setWorkspacePublishResults([{
        id: workspaceDetailId,
        level: effectiveLevel,
        status: "failed",
        message: error instanceof Error ? error.message : "Publish failed",
      }])
    } finally {
      setWorkspacePublishing(false)
    }
  }

  const workspaceDetailId = capped[0]?.id || ""
  const workspaceDetailKey = `${effectiveLevel}:${workspaceDetailId}`

  useLayoutEffect(() => {
    if (workspaceView === "edit") workspaceContentRef.current?.scrollTo({ top: 0, left: 0 })
  }, [workspaceDetailKey, workspaceView])

  const structuralReplacement = useMemo(() => {
    const entries = Object.entries(workspaceDrafts)
    for (const [key, draft] of entries) {
      const nodeLevel = key.split(":")[0] as Level
      const original = workspaceDetails[key]
      if (!original) continue
      if (nodeLevel === "campaign") {
        const beforeCategories = [...(original.special_ad_categories || [])].sort().join(",")
        const afterCategories = [...(draft.special_ad_categories || [])].sort().join(",")
        if (
          draft.objective !== original.objective
          || draft.buying_type !== original.buying_type
          || afterCategories !== beforeCategories
        ) return { draft, level: nodeLevel }
      }
      if (nodeLevel === "adset" && draft.conversion_location !== original.conversion_location) {
        return { draft, level: nodeLevel }
      }
    }
    return null
  }, [workspaceDetails, workspaceDrafts])

  useEffect(() => {
    if (!unifiedWorkspace || workspaceView !== "edit" || !workspaceDetailId || isCompare) return
    if (workspaceDetails[workspaceDetailKey] && workspaceDetailRefresh === 0) return

    let cancelled = false
    const load = async () => {
      setWorkspaceDetailLoading(current => ({ ...current, [workspaceDetailKey]: true }))
      setWorkspaceDetailErrors(current => ({ ...current, [workspaceDetailKey]: "" }))
      try {
        const url = effectiveLevel === "campaign"
          ? `/api/facebook/campaigns/${workspaceDetailId}?ad_account_id=${encodeURIComponent(accountId)}`
          : effectiveLevel === "adset"
            ? `/api/facebook/adsets/${workspaceDetailId}/detail?ad_account_id=${encodeURIComponent(accountId)}`
            : `/api/facebook/ad-detail?ad_id=${encodeURIComponent(workspaceDetailId)}&ad_account_id=${encodeURIComponent(accountId)}&date_preset=${encodeURIComponent(datePreset)}`
        const response = await fetch(url)
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Failed to load fresh Meta details")
        const detail = effectiveLevel === "campaign" ? data.campaign : effectiveLevel === "adset" ? data.adSet : data.ad
        if (!detail?.id) throw new Error("Meta returned incomplete detail")
        if (!cancelled) setWorkspaceDetails(current => ({ ...current, [workspaceDetailKey]: detail }))
      } catch (error) {
        if (!cancelled) {
          setWorkspaceDetailErrors(current => ({
            ...current,
            [workspaceDetailKey]: error instanceof Error ? error.message : "Failed to load fresh Meta details",
          }))
        }
      } finally {
        if (!cancelled) {
          setWorkspaceDetailLoading(current => ({ ...current, [workspaceDetailKey]: false }))
          setWorkspaceDetailRefresh(0)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [
    accountId,
    datePreset,
    effectiveLevel,
    isCompare,
    unifiedWorkspace,
    workspaceDetailId,
    workspaceDetailKey,
    workspaceDetailRefresh,
    workspaceDetails,
    workspaceView,
  ])

  // An Ads-tab cursor page is not a hierarchy. Once the selected ad's fresh detail
  // identifies its parents, load that campaign's ad sets and every child's ads.
  useEffect(() => {
    if (!unifiedWorkspace || workspaceView !== "edit" || effectiveLevel !== "ad" || isCompare) return
    const detail = workspaceDetails[workspaceDetailKey]
    if (!detail?.campaign_id || !detail?.adset_id || !accountId) return
    let cancelled = false

    const loadHierarchy = async () => {
      try {
        const account = encodeURIComponent(accountId)
        const campaignId = encodeURIComponent(detail.campaign_id!)
        const adSetId = encodeURIComponent(detail.adset_id!)
        const [campaignResponse, adSetsResponse, activeAdsResponse] = await Promise.all([
          fetch(`/api/facebook/campaigns/${campaignId}?ad_account_id=${account}`),
          fetch(`/api/facebook/adsets?ad_account_id=${account}&campaign_id=${campaignId}`),
          fetch(`/api/facebook/ads?ad_account_id=${account}&adset_id=${adSetId}`),
        ])
        const [campaignData, adSetsData, activeAdsData] = await Promise.all([
          campaignResponse.json(), adSetsResponse.json(), activeAdsResponse.json(),
        ])
        if (cancelled) return
        if (campaignResponse.ok && campaignData.campaign?.id) setLocalCampaigns([campaignData.campaign])
        const campaignAdSets = adSetsResponse.ok ? (adSetsData.adSets || []) : []
        if (campaignAdSets.length) setLocalAdSets(campaignAdSets)
        const adResults = await Promise.all(campaignAdSets.map(async (adSet: any) => {
          const response = adSet.id === detail.adset_id
            ? Promise.resolve({ ok: activeAdsResponse.ok, data: activeAdsData })
            : fetch(`/api/facebook/ads?ad_account_id=${account}&adset_id=${encodeURIComponent(adSet.id)}`)
              .then(async response => ({ ok: response.ok, data: await response.json() }))
          const result = await response
          return result.ok ? (result.data.ads || []) : []
        }))
        if (!cancelled) setLocalAds(adResults.flat())
      } catch {
        // The selected ad remains editable even if its optional hierarchy cannot load.
      }
    }
    void loadHierarchy()
    return () => { cancelled = true }
  }, [accountId, effectiveLevel, isCompare, unifiedWorkspace, workspaceDetailKey, workspaceDetails, workspaceView])

  const qsBase = useMemo(() => {
    const p = new URLSearchParams({ adAccountId: accountId, level: effectiveLevel })
    if (sinceOverride && untilOverride) { p.set("since", sinceOverride); p.set("until", untilOverride) }
    else if (since && until) { p.set("since", since); p.set("until", until) }
    else p.set("datePreset", presetOverride === "custom" ? "last_30d" : presetOverride)
    if (attributionWindows && attributionWindows.length > 0) p.set("action_attribution_windows", attributionWindows.join(","))
    return p
  }, [accountId, effectiveLevel, since, until, sinceOverride, untilOverride, presetOverride, attributionWindows])

  // Trend window follows granularity (Day=7d, Week=7w, Month=6m). Calendar override wins.
  const trendQs = useMemo(() => {
    const p = new URLSearchParams({ adAccountId: accountId, level: effectiveLevel })
    if (sinceOverride && untilOverride) { p.set("since", sinceOverride); p.set("until", untilOverride) }
    else { const r = rangeForGranularity(granularity); p.set("since", r.since); p.set("until", r.until) }
    if (attributionWindows && attributionWindows.length > 0) p.set("action_attribution_windows", attributionWindows.join(","))
    return p
  }, [accountId, effectiveLevel, granularity, sinceOverride, untilOverride, attributionWindows])

  // Bootstrap missing hierarchy data so the tree works even when the parent only loaded one tab.
  useEffect(() => {
    if (isCompare) return
    const missing = !allCampaigns.length || !allAdSets.length || !allAds.length
    if (!missing || !accountId) return
    let cancelled = false
    const load = async () => {
      try {
        const qs = `ad_account_id=${encodeURIComponent(accountId)}`
        const jobs: Promise<any>[] = []
        jobs.push(allCampaigns.length ? Promise.resolve({ campaigns: allCampaigns }) : fetch(`/api/facebook/campaigns?${qs}&date_preset=${encodeURIComponent(presetOverride)}`).then(r => r.json()))
        jobs.push(allAdSets.length ? Promise.resolve({ adSets: allAdSets }) : fetch(`/api/facebook/adsets?${qs}&date_preset=${encodeURIComponent(presetOverride)}`).then(r => r.json()))
        jobs.push(allAds.length ? Promise.resolve({ ads: allAds }) : fetch(`/api/facebook/ads?${qs}&date_preset=${encodeURIComponent(presetOverride)}`).then(r => r.json()))
        const [c, s, a] = await Promise.all(jobs)
        if (cancelled) return
        if (!allCampaigns.length) setLocalCampaigns(c.campaigns || [])
        if (!allAdSets.length) setLocalAdSets(s.adSets || [])
        if (!allAds.length) setLocalAds(a.ads || [])
      } catch {
        // Hierarchy is nice-to-have; charts still work for the active row.
      }
    }
    load()
    return () => { cancelled = true }
  }, [isCompare, accountId, presetOverride, allCampaigns.length, allAdSets.length, allAds.length])

  // Determine active metrics list based on mode
  const activeMetrics = useMemo(() => {
    return isCompare ? compareCharts : [metric]
  }, [isCompare, compareCharts, metric])

  // ── Fetch Trends (metric & row dependent) ──────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // Find what needs to be loaded
      const queue: { row: ReportRow; metricKey: string; cacheKey: string }[] = []
      capped.forEach(row => {
        activeMetrics.forEach(m => {
          const cacheKey = `${row.id}:${m}:${granularity}:${trendQs}`
          if (!trendDataStore[cacheKey]) {
            queue.push({ row, metricKey: m, cacheKey })
          }
        })
      })

      if (queue.length === 0) return

      // Mark only the genuinely-pending keys so skeletons render per-chart.
      setPendingKeys(prev => {
        const next = { ...prev }
        queue.forEach(q => { next[q.cacheKey] = true })
        return next
      })

      const results = await Promise.allSettled(queue.map(async item => {
        const res = await fetch(`/api/insights/report-trends?${trendQs}&id=${item.row.id}&metric=${item.metricKey}&granularity=${granularity}`)
        const d = await res.json()
        if (d.error) throw new Error(d.error)
        return { key: item.cacheKey, series: (d.series || []) as Series[] }
      }))

      if (cancelled) return

      const nextTrend = { ...trendDataStore }
      const errs: Record<string, string> = {}
      results.forEach((r, idx) => {
        const q = queue[idx]
        if (r.status === "fulfilled") {
          nextTrend[r.value.key] = r.value.series
        } else {
          errs[q.row.id] = (r.reason as any)?.message || "Failed"
        }
      })

      setTrendDataStore(nextTrend)
      setErrors(errs)
      setPendingKeys(prev => {
        const next = { ...prev }
        queue.forEach(q => { next[q.cacheKey] = false })
        return next
      })
    }
    load()
    return () => { cancelled = true }
  }, [trendQs, activeMetrics.join(","), granularity, capped.map(r => r.id).join(",")])

  // ── Fetch KPI metrics (Charts mode initialization) ───────────────────────
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const results = await Promise.allSettled(capped.map(async row => {
        const res = await fetch(`/api/insights/report-object?${qsBase}&id=${row.id}`)
        const d = await res.json()
        if (d.error) throw new Error(d.error)
        return { row, metrics: d.metrics || {}, creative: d.creative || {}, video: d.video || {} }
      }))
      if (cancelled) return
      const nextM: Record<string, any> = {}
      const nextC: Record<string, any> = {}
      const nextV: Record<string, any> = {}
      results.forEach(r => {
        if (r.status === "fulfilled") {
          nextM[r.value.row.id] = r.value.metrics
          nextC[r.value.row.id] = r.value.creative
          nextV[r.value.row.id] = r.value.video
        }
      })
      setMetricsByRow(nextM)
      setCreativeByRow(nextC)
      setVideoByRow(nextV)
    }
    load()
    return () => { cancelled = true }
  }, [qsBase, capped.map(r => r.id).join(",")])

  // ── Fetch Breakdowns (Compare Breakdown mode) ─────────────────────────────
  useEffect(() => {
    if (!isCompare || tab !== "breakdowns") return
    let cancelled = false
    const load = async () => {
      const queue: { row: ReportRow; metricKey: string; cacheKey: string }[] = []
      capped.forEach(row => {
        compareCharts.forEach(m => {
          const cacheKey = `${row.id}:${m}:${compareBreakdown}`
          if (!breakdownDataStore[cacheKey]) {
            queue.push({ row, metricKey: m, cacheKey })
          }
        })
      })

      if (queue.length === 0) return

      setPendingKeys(prev => {
        const next = { ...prev }
        queue.forEach(q => { next[q.cacheKey] = true })
        return next
      })

      const results = await Promise.allSettled(queue.map(async item => {
        const res = await fetch(`/api/insights/breakdown?${qsBase}&id=${item.row.id}&breakdown=${encodeURIComponent(compareBreakdown)}`)
        const d = await res.json()
        if (d.error) throw new Error(d.error)
        return { key: item.cacheKey, rows: (d.rows || []) as BreakdownRow[] }
      }))

      if (cancelled) return

      const nextBreakdown = { ...breakdownDataStore }
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") {
          nextBreakdown[r.value.key] = r.value.rows
        }
      })
      setBreakdownDataStore(nextBreakdown)
      setPendingKeys(prev => {
        const next = { ...prev }
        queue.forEach(q => { next[q.cacheKey] = false })
        return next
      })
    }
    load()
    return () => { cancelled = true }
  }, [isCompare, tab, compareBreakdown, compareCharts.join(","), qsBase, capped.map(r => r.id).join(",")])

  // ── Activities for active card (single object only) ────────────────────────
  useEffect(() => {
    if (isCompare || capped.length !== 1) { setActivities([]); return }
    let cancelled = false
    const row = capped[0]
    const load = async () => {
      try {
        const res = await fetch(`/api/insights/activities?${qsBase}&id=${row.id}`)
        const d = await res.json()
        if (!cancelled) setActivities(d.events || [])
      } catch { if (!cancelled) setActivities([]) }
    }
    load()
    return () => { cancelled = true }
  }, [isCompare, qsBase, capped.map(r => r.id).join(",")])

  // ── Demographics + Platform load (Charts single object) ───────────────────
  useEffect(() => {
    if (isCompare || capped.length !== 1) return
    let cancelled = false
    const row = capped[0]
    const load = async () => {
      setDemoLoading(true)
      try {
        const [ageRes, platRes] = await Promise.all([
          fetch(`/api/insights/breakdown?${qsBase}&id=${row.id}&breakdown=age,gender`),
          fetch(`/api/insights/breakdown?${qsBase}&id=${row.id}&breakdown=publisher_platform,platform_position,impression_device`),
        ])
        const [age, plat] = await Promise.all([ageRes.json(), platRes.json()])
        if (cancelled) return
        setDemoRows(age.rows || [])
        setPlatRows(plat.rows || [])
      } catch { if (!cancelled) { setDemoRows([]); setPlatRows([]) } }
      finally { if (!cancelled) setDemoLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [isCompare, qsBase, capped.map(r => r.id).join(",")])

  // ── Compute KPIs ──────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let spend = 0, purchases = 0, purchaseValue = 0
    Object.values(metricsByRow).forEach((m: any) => {
      spend += Number(m.spend) || 0
      purchases += Number(m.purchases) || 0
      purchaseValue += Number(m.purchaseValue) || 0
    })
    return {
      spend,
      purchases,
      costPerPurchase: purchases > 0 ? spend / purchases : 0,
      roas: spend > 0 ? purchaseValue / spend : 0,
    }
  }, [metricsByRow])

  // Get trend series data helper for a specific metric
  const getTrendDataForMetric = (mKey: string) => {
    const byDate: Record<string, any> = {}
    capped.forEach((row, i) => {
      const cacheKey = `${row.id}:${mKey}:${granularity}:${trendQs}`
      const series = trendDataStore[cacheKey] || []
      series.forEach(p => {
        if (!byDate[p.date]) byDate[p.date] = { date: p.date, label: p.label }
        byDate[p.date][`row_${i}`] = p.value
      })
    })
    return Object.values(byDate).sort((a: any, b: any) => (a.date < b.date ? -1 : 1))
  }

  // Get breakdown data helper for a specific metric
  const getBreakdownDataForMetric = (mKey: string) => {
    const byLabel: Record<string, any> = {}
    capped.forEach((row, i) => {
      const cacheKey = `${row.id}:${mKey}:${compareBreakdown}`
      const rows = breakdownDataStore[cacheKey] || []
      rows.forEach(r => {
        const label = r.label || r.breakdownValue || "Unknown"
        if (!byLabel[label]) byLabel[label] = { label }
        byLabel[label][`row_${i}`] = Number(r[mKey] ?? r.spend ?? 0) || 0
      })
    })
    return Object.values(byLabel)
      .map((d: any) => ({ ...d, _total: capped.reduce((s, _, i) => s + (Number(d[`row_${i}`]) || 0), 0) }))
      .sort((a: any, b: any) => b._total - a._total)
      .slice(0, 10)
  }

  const demoBarData = useMemo(() => {
    const pick = (r: any) => Number(r[demoMetric] ?? r.results ?? r.spend ?? 0) || 0
    const buckets: Record<string, { age: string; men: number; women: number; all: number }> = {}
    for (const r of demoRows) {
      const parts = String(r.breakdownValue || r.label || "").split(",").map(s => s.trim())
      const age = String(r.age || parts[0] || "Unknown").trim()
      const g = String(r.gender || parts[1] || "").toLowerCase()
      if (!buckets[age]) buckets[age] = { age, men: 0, women: 0, all: 0 }
      const v = pick(r)
      buckets[age].all += v
      if (g === "male" || g === "men" || g === "m") buckets[age].men += v
      else if (g === "female" || g === "women" || g === "f") buckets[age].women += v
    }
    return Object.values(buckets).sort((a, b) => ageRank(a.age) - ageRank(b.age))
  }, [demoRows, demoMetric])

  // Platform chart: X = publisher_platform, Y = metric, series = device (mobile/desktop/other)
  const platBarData = useMemo(() => {
    const pick = (r: any) => Number(r[platMetric] ?? r.results ?? r.spend ?? 0) || 0
    const groups: Record<string, { platform: string; mobile: number; desktop: number; other: number; total: number }> = {}
    for (const r of platRows) {
      const platform = String(r.publisher_platform || "Unknown")
      const device = String(r.impression_device || "").toLowerCase()
      if (!groups[platform]) groups[platform] = { platform, mobile: 0, desktop: 0, other: 0, total: 0 }
      const v = pick(r)
      groups[platform].total += v
      if (device.includes("mobile") || device.includes("iphone") || device.includes("android") || device.includes("ipad")) {
        groups[platform].mobile += v
      } else if (device.includes("desktop") || device.includes("computer")) {
        groups[platform].desktop += v
      } else {
        groups[platform].other += v
      }
    }
    return Object.values(groups).sort((a, b) => b.total - a.total)
  }, [platRows, platMetric])

  // Activities filtered by Activity History dropdown
  // Chart-marker filter only (does not affect the history table).
  const filteredActivities = useMemo(() => {
    if (activityFilter === "all") return activities
    return activities.filter(e => {
      const type = String(e.type || "").toLowerCase()
      if (activityFilter === "budget") return type.includes("budget") || type.includes("bid")
      if (activityFilter === "status") return type.includes("status") || type.includes("pause") || type.includes("resume")
      return true
    })
  }, [activities, activityFilter])

  const actorOptions = useMemo(
    () => Array.from(new Set(activities.map(a => a.actor).filter(Boolean))) as string[],
    [activities]
  )

  // History table has its own filters, independent of the chart-marker select.
  const tableActivities = useMemo(() => {
    return activities.filter(e => {
      const type = String(e.type || "").toLowerCase()
      if (histActivityFilter === "budget" && !(type.includes("budget") || type.includes("bid"))) return false
      if (histActivityFilter === "status" && !(type.includes("status") || type.includes("pause") || type.includes("resume"))) return false
      if (histActivityFilter === "delivery" && !(type.includes("deliver") || type.includes("review") || type.includes("active"))) return false
      if (histActorFilter !== "all" && e.actor !== histActorFilter) return false
      return true
    })
  }, [activities, histActivityFilter, histActorFilter])

  // Generate activities markers for Chart Mode Recharts line
  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props
    // Check if there is an activity on this date
    const hasEvent = activities.some(e => {
      if (!e.time) return false
      const eDate = new Date(e.time).toISOString().split("T")[0]
      return eDate === payload.date
    })

    if (hasEvent) {
      return (
        <svg x={cx - 6} y={cy - 6} width="12" height="12" viewBox="0 0 24 24" className="cursor-pointer text-destructive fill-destructive">
          <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2" />
        </svg>
      )
    }

    return null
  }

  const headerTitle = isCompare
    ? `Compare ${capped.length} ${level}${capped.length > 1 ? "s" : ""}`
    : `Charts · ${capped[0]?.name || ""}`

  const currentCards = selectedMetrics.map(k => ({ key: k, label: metricLabel(k) }))

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPARE MODE — SIDEBAR DRAWER
  // ═══════════════════════════════════════════════════════════════════════════
  if (isCompare) {
    const availableToAdd = ALL_METRICS.filter(m => !compareCharts.includes(m.key))

    return (
      <TooltipProvider>
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l bg-background shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Compare</p>
              <h2 className="font-semibold text-sm truncate" title={headerTitle}>{headerTitle}</h2>
            </div>
            <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/50 shrink-0">
              <IconX className="size-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
            {(["trends", "breakdowns"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={cn("h-8 px-3 text-sm rounded-lg capitalize transition-colors",
                  tab === t ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50")}>
                {t === "trends" ? "Trends" : "Breakdown"}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              {tab === "trends" ? (
                <select value={granularity} onChange={e => setGranularity(e.target.value as any)}
                  className="h-8 px-2 text-xs rounded-lg border bg-background">
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              ) : (
                <select value={compareBreakdown} onChange={e => setCompareBreakdown(e.target.value)}
                  className="h-8 px-2 text-xs rounded-lg border bg-background max-w-[180px]">
                  {BREAKDOWN_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Charts list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {overCap && (
              <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Showing first {MAX_ROWS} of {rows.length} items to keep Meta API requests safe.
              </div>
            )}

            {compareCharts.map((mKey, chartIdx) => {
              const data = tab === "trends"
                ? getTrendDataForMetric(mKey)
                : getBreakdownDataForMetric(mKey)
              const hasError = capped.some(r => errors[r.id])
              const isPending = capped.some(r => pendingKeys[
                tab === "trends"
                  ? `${r.id}:${mKey}:${granularity}:${trendQs}`
                  : `${r.id}:${mKey}:${compareBreakdown}`
              ])

              return (
                <div key={mKey + chartIdx} className="border rounded-xl p-3 bg-card">
                  {/* Chart header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <UITooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm font-semibold cursor-help">{metricLabel(mKey)}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">{metricDesc(mKey)}</TooltipContent>
                      </UITooltip>
                    </div>
                    {compareCharts.length > 1 && (
                      <button
                        onClick={() => setCompareCharts(prev => prev.filter((_, i) => i !== chartIdx))}
                        className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/50 text-muted-foreground"
                        title="Remove chart"
                      >
                        <IconX className="size-3.5" />
                      </button>
                    )}
                  </div>

                                    {/* Compare Stat Cards: large primary + small volatility under */}
                  {data.length > 0 && tab === "trends" && (() => {
                    const allVals = data.flatMap(p => capped.map((_, i) => Number(p["row_" + i] || 0))).filter(v => Number.isFinite(v))
                    const sum = allVals.reduce((a, b) => a + b, 0)
                    const mean = allVals.length ? sum / allVals.length : 0
                    const variance = allVals.length ? allVals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / allVals.length : 0
                    const stdDev = Math.sqrt(variance)
                    const volatility = mean > 0 ? (stdDev / mean) * 100 : 0
                    // Sum for cumulative metrics; mean for ratios
                    const isRatio = ["roas", "ctr", "ctrAll", "cpm", "frequency", "costPerPurchase", "costPerResult", "hookRate", "holdRate"].includes(mKey)
                    const primary = isRatio ? mean : sum
                    return (
                      <div className="mb-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{isRatio ? "Average" : "Sum"}</p>
                        <p className="text-3xl font-bold tabular-nums leading-tight">{metricFmt(mKey)(primary)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {mean > 0 ? `${volatility.toFixed(1)}% volatility` : "— volatility"}
                        </p>
                      </div>
                    )
                  })()}
                  
                  {/* Chart body */}
                  {hasError ? (
                    <div className="h-40 flex items-center justify-center text-xs text-destructive">
                      Failed to load chart data.
                    </div>
                  ) : isPending ? (
                    <div className="h-40 flex flex-col items-center justify-center gap-2 rounded-lg bg-muted/20 animate-pulse">
                      <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Loading chart data...</span>
                    </div>
                  ) : data.length === 0 ? (
                    <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
                      No data available.
                    </div>
                  ) : tab === "trends" ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: MUTED }} />
                        <YAxis tick={{ fontSize: 10, fill: MUTED }} width={52} tickFormatter={v => metricFmt(mKey)(Number(v))} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, name: any) => [metricFmt(mKey)(Number(v)), name]} />
                        {capped.length >= 2 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                        {capped.map((row, i) => (
                          <Line key={row.id} type="monotone" dataKey={`row_${i}`} name={row.name}
                            stroke={SERIES[i]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 24)}>
                      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: MUTED }} tickFormatter={v => metricFmt(mKey)(Number(v))} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: MUTED }} width={120} interval={0} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, name: any) => [metricFmt(mKey)(Number(v)), name]} />
                        {capped.length >= 2 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                        {capped.map((row, i) => (
                          <Bar key={row.id} dataKey={`row_${i}`} name={row.name}
                            fill={SERIES[i]} radius={[3, 3, 3, 3]} maxBarSize={18} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )
            })}

            {/* Add chart button */}
            <div className="relative">
              <button
                onClick={() => setAddChartOpen(o => !o)}
                disabled={availableToAdd.length === 0}
                className="w-full h-10 flex items-center justify-center gap-2 text-sm border border-dashed rounded-xl hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconPlus className="size-4" /> Add chart
              </button>
              {addChartOpen && availableToAdd.length > 0 && (
                <div className="absolute bottom-12 left-0 right-0 z-10 bg-background border rounded-xl shadow-xl max-h-72 overflow-y-auto">
                  {METRIC_GROUPS.map(g => (
                    <div key={g.group}>
                      <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground sticky top-0 bg-background">{g.group}</p>
                      {g.items.filter(m => availableToAdd.includes(m as any)).map(m => (
                        <button key={m.key}
                          onClick={() => {
                            setCompareCharts(prev => [...prev, m.key])
                            setAddChartOpen(false)
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center justify-between">
                          <span>{m.label}</span>
                          <IconPlus className="size-3.5 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </TooltipProvider>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHARTS MODE — LARGE POPUP (SINGLE OBJECT)
  // ═══════════════════════════════════════════════════════════════════════════
  const trendData = getTrendDataForMetric(metric)
  const isTrendPending = capped.some(r => pendingKeys[`${r.id}:${metric}:${granularity}:${trendQs}`])
  const activeId = capped[0]?.id
  const activeAd = allAds.find(a => a.id === activeId) || null
  const activeAdSet = allAdSets.find(a => a.id === activeId || a.id === activeAd?.adset_id) || null
  const activeCampaign = allCampaigns.find(c => c.id === activeId || c.id === activeAdSet?.campaign_id || c.id === activeAd?.campaign_id) || null
  const selectedWorkspaceListNode = allCampaigns.find(item => item.id === activeId)
    || allAdSets.find(item => item.id === activeId)
    || allAds.find(item => item.id === activeId)
    || null
  const selectedWorkspaceNode = workspaceDrafts[`${activeNodeLevel}:${activeId}`]
    || workspaceDetails[`${activeNodeLevel}:${activeId}`]
    || selectedWorkspaceListNode
  const effectiveWorkspaceView = unifiedWorkspace
    ? workspaceView
    : chartsPage === "history" ? "history" : "charts"
  const treeAdSets = activeCampaign ? allAdSets.filter(a => a.campaign_id === activeCampaign.id) : (activeAdSet ? [activeAdSet] : [])
  const treeAds = (adSetId: string) => allAds.filter(a => a.adset_id === adSetId)
  const spendTotal = totals.spend

  const seeHistoryLocal = (id: string, lvl: string) => {
    const lvlNorm: Level = lvl === "campaign" ? "campaign" : lvl === "ad" ? "ad" : "adset"
    selectNode(id, lvlNorm)
    setChartsPage("history")
    setWorkspaceView("history")
  }

  // Collapsed view hands navigation to the table behind it, so the hierarchy column stands down.
  const treeVisible = sidebarOpen && !(isPage && collapsed)
  // In page mode the editor renders its own breadcrumb, title, status and ⋯ menu — the shared top
  // chrome. Repeating the name here is the duplication requirement #5 called out.
  const showShellHeader = !isPage || effectiveWorkspaceView !== "edit"

  const shellCard = (
    <div
      className={cn(
        isPage
          ? cn(
            "absolute inset-y-0 right-0 z-40 flex flex-col overflow-hidden bg-background",
            collapsed ? "left-[32%] border-l shadow-2xl" : "left-0",
          )
          : "bg-background rounded-2xl shadow-2xl flex flex-col overflow-auto resize",
      )}
      style={isPage ? undefined : {
        width: "96vw",
        height: "94vh",
        minWidth: 640,
        minHeight: 400,
        maxWidth: "98vw",
        maxHeight: "98vh",
      }}
    >
          {/* Header */}
          {showShellHeader && (
          <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {effectiveWorkspaceView === "charts" ? "Charts" : effectiveWorkspaceView === "edit" ? "Edit" : effectiveWorkspaceView === "review" ? "Review and publish" : "Activity history"}
              </p>
              <h2 className="font-semibold text-base truncate" title={headerTitle}>
                {effectiveWorkspaceView === "charts" ? headerTitle : (capped[0]?.name || headerTitle)}
              </h2>
            </div>
            <button onClick={requestWorkspaceClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/50">
              <IconX className="size-4" />
            </button>
          </div>
          )}

          {/* Body */}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {unifiedWorkspace && <nav className="w-14 shrink-0 border-r bg-[#1d2d35] px-2 py-3 flex flex-col items-center gap-2" aria-label="Workspace navigation">
              {[
                { view: "charts" as const, label: "Charts", icon: IconChartLine },
                { view: "edit" as const, label: "Edit", icon: IconPencil },
                { view: "history" as const, label: "History", icon: IconHistory },
              ].map(item => (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => {
                    setWorkspaceView(item.view)
                    if (item.view === "history") setChartsPage("history")
                    if (item.view === "charts") setChartsPage("charts")
                  }}
                  className={cn(
                    "grid size-9 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white",
                    workspaceView === item.view && "bg-white/15 text-white"
                  )}
                  aria-label={item.label}
                  title={item.label}
                >
                  <item.icon className="size-4.5" />
                </button>
              ))}
              {workspaceDirty && (
                <button
                  type="button"
                  onClick={() => setWorkspaceView("review")}
                  className={cn(
                    "relative grid size-9 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white",
                    workspaceView === "review" && "bg-white/15 text-white"
                  )}
                  aria-label={`Review and publish (${Object.keys(workspaceDrafts).length})`}
                  title={`Review and publish (${Object.keys(workspaceDrafts).length})`}
                >
                  <IconListCheck className="size-4.5" />
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                    {Object.keys(workspaceDrafts).length}
                  </span>
                </button>
              )}
              <div className="flex-1" />
              {isPage ? (
                // In page mode this slot is the shell control, not the tree control: it collapses
                // the editor to an overlay so the live table behind becomes the navigator.
                <button
                  type="button"
                  onClick={() => setCollapsed(open => !open)}
                  disabled={!canCollapse}
                  className="grid size-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                  aria-label={collapsed ? "Expand to full page" : "Collapse view"}
                  aria-pressed={collapsed}
                  title={
                    canCollapse
                      ? (collapsed ? "Expand to full page" : "Collapse view — keep the table visible")
                      : "Collapse needs the Ads Manager table behind it — open the editor from the table"
                  }
                >
                  {collapsed
                    ? <IconLayoutSidebarLeftExpand className="size-4.5" />
                    : <IconLayoutSidebarLeftCollapse className="size-4.5" />}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSidebarOpen(open => !open)}
                  className="grid size-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
                  aria-label="Toggle hierarchy"
                  title="Toggle hierarchy"
                >
                  <IconLayoutSidebarLeftCollapse className="size-4.5" />
                </button>
              )}
            </nav>}
            {treeVisible && (
              <aside className="w-80 shrink-0 border-r bg-muted/20 overflow-y-auto p-3">
                {unifiedWorkspace ? (
                  <div className="flex items-center gap-2 mb-3">
                    <div className="relative flex-1">
                      <input
                        className="h-8 w-full rounded-md border bg-background px-2.5 text-xs"
                        placeholder="Search hierarchy"
                        aria-label="Search hierarchy"
                      />
                    </div>
                    <button
                      onClick={onCreate}
                      disabled={!canMutate}
                      className="h-8 px-2.5 text-xs rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <IconPlus className="size-3.5 inline mr-1" /> Create
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 mb-3">
                    <button onClick={() => setSidebarOpen(false)} className="h-7 px-2 text-xs rounded-md border hover:bg-muted/50">Close</button>
                    <button onClick={() => setChartsPage("charts")} className={cn("h-7 px-2 text-xs rounded-md border hover:bg-muted/50", chartsPage === "charts" && "bg-primary/10 text-primary border-primary/30")}>View charts</button>
                    <button onClick={() => activeId && onEdit?.(activeId)} className="h-7 px-2 text-xs rounded-md border hover:bg-muted/50">Edit</button>
                    <button onClick={() => activeId && seeHistoryLocal(activeId, String(activeNodeLevel))} className={cn("h-7 px-2 text-xs rounded-md border hover:bg-muted/50", chartsPage === "history" && "bg-primary/10 text-primary border-primary/30")}>See history</button>
                  </div>
                )}
                <div className="space-y-1 text-xs">
                  {activeCampaign && (() => {
                    const draftKey = `campaign:${activeCampaign.id}`
                    const hasDraft = Boolean(workspaceDrafts[draftKey])
                    const draftName = workspaceDrafts[draftKey]?.name
                    return (
                      <div
                        onClick={() => selectNode(activeCampaign.id, "campaign")}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 cursor-pointer text-blue-600 dark:text-blue-400 hover:bg-muted/40",
                          activeCampaign.id === activeId && "bg-primary/10 text-primary",
                          hasDraft && "bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-800",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-900 dark:text-white">📁 {draftName || activeCampaign.name}</span>
                          {hasDraft && <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">Unpublished edits</span>}
                        </div>
                        <NodeActionMenu level="campaign" id={activeCampaign.id} onDuplicate={onDuplicate} onDelete={onDelete} onEdit={unifiedWorkspace ? (id) => openWorkspaceEditor(id, "campaign") : onEdit} onViewHistory={onViewHistory} onSeeHistory={seeHistoryLocal} />
                      </div>
                    )
                  })()}
                  {treeAdSets.map(as => {
                    const draftKey = `adset:${as.id}`
                    const hasDraft = Boolean(workspaceDrafts[draftKey])
                    const draftName = workspaceDrafts[draftKey]?.name
                    return (
                      <div key={as.id} className="ml-4">
                        <div
                          onClick={() => selectNode(as.id, "adset")}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 cursor-pointer text-blue-600 dark:text-blue-400 hover:bg-muted/40",
                            as.id === activeId && "bg-primary/10 text-primary",
                            hasDraft && "bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-800",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-slate-900 dark:text-white">▦ {draftName || as.name}</span>
                            {hasDraft && <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">Unpublished edits</span>}
                          </div>
                          <NodeActionMenu level="ad set" id={as.id} onDuplicate={onDuplicate} onDelete={onDelete} onEdit={unifiedWorkspace ? (id) => openWorkspaceEditor(id, "adset") : onEdit} onViewHistory={onViewHistory} onSeeHistory={seeHistoryLocal} />
                        </div>
                        <div className="ml-4 space-y-1">
                          {treeAds(as.id).map(ad => {
                            const adDraftKey = `ad:${ad.id}`
                            const adHasDraft = Boolean(workspaceDrafts[adDraftKey])
                            const adDraftName = workspaceDrafts[adDraftKey]?.name
                            return (
                              <div
                                key={ad.id}
                                onClick={() => selectNode(ad.id, "ad")}
                                className={cn(
                                  "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 cursor-pointer text-blue-600 dark:text-blue-400 hover:bg-muted/40",
                                  ad.id === activeId && "bg-primary/10 text-primary",
                                  adHasDraft && "bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-800",
                                )}
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate text-slate-900 dark:text-white">▣ {adDraftName || ad.name}</span>
                                  {adHasDraft && <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">Unpublished edits</span>}
                                </div>
                                <NodeActionMenu level="ad" id={ad.id} onDuplicate={onDuplicate} onDelete={onDelete} onEdit={unifiedWorkspace ? (id) => openWorkspaceEditor(id, "ad") : onEdit} onViewHistory={onViewHistory} onSeeHistory={seeHistoryLocal} />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  {!activeCampaign && !activeAdSet && (
                    <p className="text-xs text-muted-foreground px-2 py-4">No hierarchy data loaded.</p>
                  )}
                </div>
              </aside>
            )}
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="self-start m-3 h-8 px-2 text-xs rounded-md border hover:bg-muted/50 shrink-0">
                Show hierarchy
              </button>
            )}
            <div ref={workspaceContentRef} className={cn(
              "flex-1 min-h-0",
              effectiveWorkspaceView === "edit" ? "overflow-hidden" : "overflow-y-auto px-5 py-4 space-y-5"
            )}>
            {effectiveWorkspaceView === "edit" ? (
              <UnifiedWorkspaceEditor
                node={selectedWorkspaceNode}
                level={activeNodeLevel}
                onSave={() => setWorkspaceView("review")}
                onReview={() => setWorkspaceView("review")}
                readOnly={!canMutate || Boolean(workspaceDetailErrors[`${activeNodeLevel}:${activeId}`])}
                loading={workspaceDetailLoading[`${activeNodeLevel}:${activeId}`] === true}
                error={workspaceDetailErrors[`${activeNodeLevel}:${activeId}`]}
                onRefresh={() => setWorkspaceDetailRefresh(value => value + 1)}
                onDraftChange={updateWorkspaceDraft}
                accountId={accountId}
                // TD-42: the ad set node carries no objective, so the editor cannot resolve its
                // ODAX row without the parent campaign's.
                campaignObjective={activeCampaign?.objective}
                hierarchyPath={{
                  campaign: workspaceDrafts[`campaign:${activeCampaign?.id || ""}`]?.name || activeCampaign?.name,
                  adset: workspaceDrafts[`adset:${activeAdSet?.id || ""}`]?.name || activeAdSet?.name,
                  ad: workspaceDrafts[`ad:${activeAd?.id || ""}`]?.name || activeAd?.name,
                }}
                hasDraft={Boolean(activeId && workspaceDrafts[`${activeNodeLevel}:${activeId}`])}
                onClose={requestWorkspaceClose}
                onDiscard={() => {
                  if (!activeId) return
                  discardWorkspaceDraft(activeNodeLevel, activeId)
                }}
                onPublish={() => {
                  void publishWorkspaceChanges()
                }}
                publishing={workspacePublishing}
                draftCount={Object.keys(workspaceDrafts).length}
                onTogglePanel={unifiedWorkspace ? () => setSidebarOpen(open => !open) : undefined}
                panelOpen={treeVisible}
                panelDisabled={isPage && collapsed}
                panelDisabledHint="Hierarchy is off in collapsed view — navigate with the table on the left"
              />
            ) : effectiveWorkspaceView === "review" ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <section className="rounded-xl border bg-card p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <IconEye className="size-4 text-primary" />
                    <h3 className="font-semibold">
                      Review and publish ({Object.keys(workspaceDrafts).length})
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Meta is not updated until you publish. Publish runs Campaign → Ad Set → Ad. A failed parent skips descendants; successful changes are not rolled back.
                  </p>
                  <div className="mt-4 space-y-2">
                    {Object.entries(workspaceDrafts).length === 0 ? (
                      <p className="rounded-lg border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">No staged drafts.</p>
                    ) : Object.entries(workspaceDrafts).map(([key, node]) => {
                      const nodeLevel = key.split(":")[0] as Level
                      const result = workspacePublishResults.find(item => item.id === node.id && item.level === nodeLevel)
                      const changeLabels = workspaceDraftChangeLabels(
                        node as unknown as Record<string, unknown>,
                        (workspaceDetails[key] || null) as Record<string, unknown> | null,
                      )
                      return (
                        <div key={key} className="rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/20">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{node.name}</p>
                              <p className="text-xs capitalize text-muted-foreground">{nodeLevel === "adset" ? "Ad set" : nodeLevel}</p>
                            </div>
                            {result && (
                              <span className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                                result.status === "published" && "bg-emerald-50 text-emerald-700",
                                result.status === "failed" && "bg-red-50 text-red-700",
                                result.status === "skipped" && "bg-amber-50 text-amber-700"
                              )}>{result.status}</span>
                            )}
                          </div>
                          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                            {changeLabels.map(label => (
                              <li key={label}>· {label}</li>
                            ))}
                          </ul>
                          {result?.message && <p className="mt-1 text-xs text-red-600">{result.message}</p>}
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button onClick={() => setWorkspaceView("edit")} className="h-9 rounded-lg border px-3 text-sm hover:bg-muted/50">Back to edit</button>
                    <button
                      onClick={() => {
                        setWorkspaceDrafts({})
                        if (accountId) clearEditorDrafts(accountId)
                        setWorkspacePublishResults([])
                      }}
                      disabled={workspacePublishing || Object.keys(workspaceDrafts).length === 0}
                      className="h-9 rounded-lg border px-3 text-sm hover:bg-muted/50 disabled:opacity-40"
                    >Discard drafts</button>
                    <button
                      onClick={() => {
                        if (structuralReplacement) {
                          onCreateReplacement?.(structuralReplacement.draft, structuralReplacement.level)
                          return
                        }
                        void publishWorkspaceChanges()
                      }}
                      disabled={!canMutate || workspacePublishing || Object.keys(workspaceDrafts).length === 0}
                      className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                    >{workspacePublishing
                        ? "Publishing…"
                        : structuralReplacement
                          ? "Create replacement"
                          : workspacePublishResults.some(result => result.status !== "published")
                            ? "Retry failed"
                            : `Publish ${Object.keys(workspaceDrafts).length} draft(s)`}</button>
                  </div>
                </section>
                <section className="rounded-xl border bg-card p-5">
                  <h3 className="font-semibold">Before you publish</h3>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {Object.values(workspaceDrafts).some(node => node.status === "ACTIVE") && (
                      <li className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">At least one object will become Active and may begin spending.</li>
                    )}
                    {structuralReplacement && (
                      <li className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                        Objective, buying type, special category, or conversion location changed. Meta requires a replacement hierarchy; the existing hierarchy will remain untouched.
                      </li>
                    )}
                    <li className="rounded-lg border px-3 py-2">Staged drafts match Quick edit: nothing hits Meta until Publish.</li>
                    <li className="rounded-lg border px-3 py-2">Hierarchy nodes with unpublished edits show a green marker in the sidebar.</li>
                  </ul>
                </section>
              </div>
            ) : effectiveWorkspaceView === "history" ? (
              <section ref={historyRef} className="rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <IconHistory className="size-3.5 text-muted-foreground" />
                    <p className="text-sm font-semibold">Activity History ({tableActivities.length})</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={histActivityFilter}
                      onChange={e => setHistActivityFilter(e.target.value)}
                      className="h-7 px-2 text-xs border rounded-md bg-background"
                      aria-label="Activity filter"
                    >
                      <option value="all">All</option>
                      <option value="budget">Budget · Bid</option>
                      <option value="status">Status</option>
                      <option value="delivery">Delivery</option>
                    </select>
                    <select
                      value={histActorFilter}
                      onChange={e => setHistActorFilter(e.target.value)}
                      className="h-7 px-2 text-xs border rounded-md bg-background"
                      aria-label="Changed by filter"
                    >
                      <option value="all">Anyone</option>
                      {actorOptions.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <button onClick={() => setChartsPage("charts")} className="h-7 px-2 text-xs rounded-md border hover:bg-muted/50">← Back to charts</button>
                  </div>
                </div>
                {tableActivities.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1 py-8 text-center">No activity in this date range.</p>
                ) : (
                  <div className="overflow-x-auto max-h-[60vh] overflow-y-auto border rounded-md">
                    <table data-table="compact" className="w-full text-xs">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr className="text-left text-muted-foreground">
                          <th className="font-medium px-3">Activity</th>
                          <th className="font-medium px-3">Activity details</th>
                          <th className="font-medium px-3">Item changed</th>
                          <th className="font-medium px-3">Changed by</th>
                          <th className="font-medium px-3 whitespace-nowrap">Date and Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {tableActivities.slice(0, 200).map((e, i) => {
                          const { activity, details } = splitActivity(e.summary, e.type)
                          return (
                            <tr key={i} className="hover:bg-muted/30">
                              <td className="px-3 font-medium">{activity}</td>
                              <td className="px-3 text-muted-foreground">{details}</td>
                              <td className="px-3">
                                <div className="truncate max-w-[200px]">{e.objectName || e.objectId || "—"}</div>
                                {e.objectId && <div className="text-[10px] text-muted-foreground">ID: {e.objectId}</div>}
                              </td>
                              <td className="px-3">{e.actor || "Meta"}</td>
                              <td className="px-3 whitespace-nowrap">{fmtActivityTime(e.time)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : (<>
            {/* KPI Cards (level-based) */}
            <div className="grid grid-cols-3 gap-3">
              {currentCards.map(c => {
                const value = totals[c.key as keyof typeof totals] ?? 0
                return (
                  <button key={c.key}
                    onClick={() => { setActiveCard(c.key); setMetric(c.key) }}
                    className={cn("text-left rounded-xl border p-3 hover:bg-muted/30 transition-colors",
                      activeCard === c.key ? "border-primary bg-primary/5" : "bg-card")}>
                    <div className="flex items-center gap-1 mb-1">
                      <UITooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[11px] text-muted-foreground cursor-help">{c.label}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">{metricDesc(c.key)}</TooltipContent>
                      </UITooltip>
                    </div>
                    <p className="text-xl font-bold tabular-nums">{metricFmt(c.key)(value)}</p>
                  </button>
                )
              })}
            </div>

            {/* Filter Row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Time filter */}
              <select value={granularity} onChange={e => setGranularity(e.target.value as any)}
                className="h-9 px-3 text-sm rounded-lg border bg-background">
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>

              {/* Activity markers on chart */}
              <select value={activityFilter} onChange={e => setActivityFilter(e.target.value)}
                className="h-9 px-3 text-sm rounded-lg border bg-background"
                title="Mark these events on the trend chart">
                <option value="all">Mark all</option>
                <option value="budget">Mark budget/bid</option>
                <option value="status">Mark status</option>
              </select>

              {/* Calendar / date range — auto-apply, no Apply button, no selection label */}
              <div className="relative">
                <button
                  onClick={() => setCalOpen(o => !o)}
                  className="h-9 px-3 text-sm rounded-lg border bg-background flex items-center gap-1.5 hover:bg-muted/50"
                  title={`Trend window: ${titleForGranularity(granularity)}`}
                >
                  <IconCalendar className="size-4" />
                  <span className="hidden sm:inline">{titleForGranularity(granularity)}</span>
                </button>
                {calOpen && (
                  <div className="absolute right-0 top-10 z-20 bg-background border rounded-xl shadow-xl p-3">
                    <AdsDateRangePicker
                      preset="custom"
                      accountId={accountId}
                      autoApply
                      hideLabel
                      onClose={() => setCalOpen(false)}
                      onChange={(p, s, e) => {
                        if (p === "custom" && s && e) {
                          setSinceOverride(s.toISOString().split("T")[0])
                          setUntilOverride(e.toISOString().split("T")[0])
                        } else {
                          setSinceOverride(""); setUntilOverride("")
                          setPresetOverride(p)
                        }
                        setCalOpen(false)
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Customize — draft metrics + Apply */}
              <div className="relative ml-auto">
                <button
                  onClick={() => {
                    if (!customizeOpen) setDraftMetrics(selectedMetrics)
                    setCustomizeOpen(o => !o)
                  }}
                  className="h-9 px-3 text-sm rounded-lg border bg-background flex items-center gap-1.5 hover:bg-muted/50">
                  <IconSettings className="size-4" /> Customise
                  <IconChevronDown className="size-3.5" />
                </button>
                {customizeOpen && (
                  <div className="absolute right-0 top-10 z-10 w-72 bg-background border rounded-xl shadow-xl">
                    <div className="flex border-b">
                      {(["metrics", "preferences"] as const).map(t => (
                        <button key={t} onClick={() => setCustomizeTab(t)}
                          className={cn("flex-1 h-9 text-sm capitalize border-b-2",
                            customizeTab === t ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground")}>
                          {t}
                        </button>
                      ))}
                    </div>

                    {customizeTab === "metrics" ? (
                      <div className="p-3 max-h-80 overflow-y-auto">
                        <p className="text-[11px] text-muted-foreground mb-2">{draftMetrics.length} of {MAX_ACTIVE_METRICS} metrics selected</p>
                        {METRIC_GROUPS.map(g => (
                          <div key={g.group} className="mb-2">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{g.group}</p>
                            {g.items.map(m => {
                              const checked = draftMetrics.includes(m.key)
                              const disabled = !checked && draftMetrics.length >= MAX_ACTIVE_METRICS
                              return (
                                <label key={m.key} className={cn("flex items-center gap-2 py-1 text-sm", disabled ? "opacity-50" : "cursor-pointer")}>
                                  <input type="checkbox" checked={checked} disabled={disabled}
                                    onChange={() => {
                                      setDraftMetrics(prev =>
                                        checked ? prev.filter(k => k !== m.key) : [...prev, m.key]
                                      )
                                    }} />
                                  <span>{m.label}</span>
                                </label>
                              )
                            })}
                          </div>
                        ))}
                        <div className="flex justify-end gap-2 pt-2 border-t mt-2 sticky bottom-0 bg-background">
                          <button
                            onClick={() => { setDraftMetrics(selectedMetrics); setCustomizeOpen(false) }}
                            className="h-8 px-3 text-xs border rounded-md hover:bg-muted/50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              const next = draftMetrics.length ? draftMetrics : selectedMetrics
                              setSelectedMetrics(next)
                              if (!next.includes(metric)) setMetric(next[0])
                              setActiveCard(next.includes(metric) ? metric : next[0])
                              setCustomizeOpen(false)
                            }}
                            className="h-8 px-3 text-xs bg-[#1877f2] text-white rounded-md hover:bg-[#1464d8] font-medium"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 space-y-3">
                        <label className="flex items-center justify-between text-sm">
                          <div>
                            <p>Your similar ad sets</p>
                            <p className="text-[11px] text-muted-foreground">Show benchmarks for similar ad sets</p>
                          </div>
                          <input type="checkbox" checked={prefSimilar} onChange={e => setPrefSimilar(e.target.checked)} />
                        </label>
                        <label className="flex items-center justify-between text-sm">
                          <div>
                            <p>Businesses like yours</p>
                            <p className="text-[11px] text-muted-foreground">Show benchmarks for similar businesses</p>
                          </div>
                          <input type="checkbox" checked={prefBenchmark} onChange={e => setPrefBenchmark(e.target.checked)} />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Trendline chart with historical edit markers */}
            <div className="rounded-xl border bg-card p-4">
              <p className="text-sm font-semibold mb-3">{metricLabel(metric)} over time</p>
              {isTrendPending ? (
                <div className="h-56 flex flex-col items-center justify-center gap-2 rounded-lg bg-muted/20 animate-pulse">
                  <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading chart data...</span>
                </div>
              ) : trendData.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">No trend data</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} />
                    <YAxis tick={{ fontSize: 11, fill: MUTED }} width={56} tickFormatter={v => metricFmt(metric)(Number(v))} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [metricFmt(metric)(Number(v)), metricLabel(metric)]} />
                    <Line type="monotone" dataKey="row_0" name={capped[0]?.name}
                      stroke={SERIES[0]} strokeWidth={2} dot={<CustomDot />} activeDot={{ r: 5 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}

              </div>

            {/* Demographics + Platform sections */}
            <div className="border-t pt-5">
              {capped.length === 1 && metricsByRow[capped[0].id]?.isVideo && (
                <section className="rounded-xl border bg-card p-4 mb-5">
                  <p className="text-sm font-semibold mb-3">Video performance</p>

                  <div className="grid grid-cols-4 gap-3 mb-4">
                    {[
                      { key: "videoPlays", label: "Video plays", link: "https://www.facebook.com/business/help/592054664510127" },
                      { key: "avgWatchTime", label: "Avg. play time", link: "https://www.facebook.com/business/help/1794520550789165" },
                      { key: "hookRate", label: "Hook rate", link: "https://www.facebook.com/business/help/1591938568393543" },
                      { key: "holdRate", label: "Hold rate", link: "https://www.facebook.com/business/help/1216404939613119" }
                    ].map(c => {
                      const v = videoByRow[capped[0].id]?.[c.key]
                      const isPct = c.key.includes("Rate")
                      const formatted = c.key === "avgWatchTime" ? fmtSec(v) : (isPct ? (v ? fmt(v, 2) + "%" : "—") : fmtN(v))
                      return (
                        <div key={c.key} className="border rounded-xl p-3 bg-background flex flex-col justify-between">
                          <a href={c.link} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground hover:underline hover:text-primary mb-1 inline-flex w-fit">
                            {c.label}
                          </a>
                          <p className="text-xl font-bold tabular-nums">{formatted}</p>
                        </div>
                      )
                    })}
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-1 border rounded-lg bg-background p-2 aspect-[4/5] flex items-center justify-center bg-muted relative overflow-auto">
                      {(() => {
                        const cr = creativeByRow[capped[0].id]
                        if (cr?.videoId) {
                          return (
                            <video src={`/api/insights/video-proxy?videoId=${encodeURIComponent(cr.videoId)}&pageId=${encodeURIComponent(cr.pageId || "")}`} poster={cr.thumbnail || undefined}
                              controls playsInline preload="metadata" className="max-h-full max-w-full object-contain rounded" />
                          )
                        }
                        if (cr?.thumbnail) {
                          return <img src={cr.thumbnail} alt="Video thumbnail" className="w-full h-full object-cover rounded" />
                        }
                        return <span className="text-xs text-muted-foreground">No preview</span>
                      })()}
                    </div>

                    <div className="col-span-2 flex flex-col justify-center">
                      <p className="text-sm font-semibold mb-1">Video plays by second</p>
                      <p className="text-[11px] text-muted-foreground mb-4">
                        Analyse your video performance by time watched to uncover creative optimisation opportunities. Though a decrease in video play time is normal as the video elapses, significant drops may indicate a lack of engagement.
                      </p>

                      <div className="h-40 w-full">
                        {videoByRow[capped[0].id]?.retention?.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={videoByRow[capped[0].id].retention} margin={{ top: 8, right: 12, left: -24, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                              <XAxis dataKey="secLabel" tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} tickFormatter={v => v + "%"} domain={[0, 100]} />
                              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [fmt(Number(v), 1) + "%", "% of video plays"]} labelFormatter={(l: any) => `Second ${l}`} />
                              <Line type="monotone" dataKey="pct" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 5 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-full flex items-center justify-center text-xs text-muted-foreground border rounded bg-background">No retention data</div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              <div className="flex items-center gap-1 mb-3">
                {(["demographics", "platform"] as const).map(s => (
                  <button key={s} onClick={() => setChartsSub(s)}
                    className={cn("h-8 px-3 text-sm rounded-lg capitalize transition-colors",
                      chartsSub === s ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50")}>
                    {s === "demographics" ? "Demographics" : "Platform"}
                  </button>
                ))}
              </div>

              {chartsSub === "demographics" ? (
                <section className="rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                    <p className="text-sm font-semibold">Age and gender distribution</p>
                    <div className="flex items-center gap-2">
                      <select value={demoMetric} onChange={e => setDemoMetric(e.target.value)}
                        className="h-8 px-2 text-xs rounded-lg border bg-background">
                        <option value="results">Results (website purchases)</option>
                        <option value="spend">Amount spent</option>
                        <option value="reach">Reach</option>
                        <option value="impressions">Impressions</option>
                      </select>
                      <select value={demoGender} onChange={e => setDemoGender(e.target.value as any)}
                        className="h-8 px-2 text-xs rounded-lg border bg-background">
                        <option value="all">All</option>
                        <option value="male">Men</option>
                        <option value="female">Women</option>
                      </select>
                    </div>
                  </div>
                  {demoLoading ? (
                    <div className="flex flex-col items-center justify-center gap-2 h-[320px] rounded-lg bg-muted/20 animate-pulse">
                      <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Loading breakdown data...</span>
                    </div>
                  ) : demoBarData.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <p className="text-sm font-semibold">Reach breakdowns not available</p>
                      <p className="text-xs text-muted-foreground max-w-sm">
                        Reach breakdowns are only available for the last 13 months. Please select a different date range.
                      </p>
                      <button
                        onClick={() => setCalOpen(true)}
                        className="mt-2 h-8 px-3 text-xs rounded-lg border bg-background hover:bg-muted/50 font-medium"
                      >
                        Change date
                      </button>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={demoBarData} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                        <XAxis dataKey="age" tick={{ fontSize: 11, fill: MUTED }} interval={0} />
                        <YAxis tick={{ fontSize: 10, fill: MUTED }} tickFormatter={v => metricFmt(demoMetric)(Number(v))} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, n: any) => [metricFmt(demoMetric)(Number(v)), n]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {(demoGender === "all" || demoGender === "male") && (
                          <Bar dataKey="men" name="Men" fill={SERIES[0]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                        )}
                        {(demoGender === "all" || demoGender === "female") && (
                          <Bar dataKey="women" name="Women" fill={SERIES[3]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </section>
              ) : (
                <section className="rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                    <p className="text-sm font-semibold">Per platform · by device</p>
                    <select value={platMetric} onChange={e => setPlatMetric(e.target.value)}
                      className="h-8 px-2 text-xs rounded-lg border bg-background">
                      <option value="results">Results</option>
                      <option value="spend">Amount spent</option>
                      <option value="reach">Reach</option>
                      <option value="impressions">Impressions</option>
                      <option value="purchases">Website purchases</option>
                    </select>
                  </div>

                  <p className="text-[11px] text-muted-foreground mb-3">
                    About placement results — Ad delivery is optimised to allocate your budget to the placements likely to perform best with your audience, based on your targeting and bid amount.
                  </p>

                  <p className="text-[11px] text-muted-foreground mb-3">
                    * You may see low delivery of ads to the Facebook Stories placement until it's available to everyone who uses Facebook Stories. A more accurate metric is cost per result.
                  </p>

                  {demoLoading ? (
                    <div className="flex flex-col items-center justify-center gap-2 h-[320px] rounded-lg bg-muted/20 animate-pulse">
                      <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Loading breakdown data...</span>
                    </div>
                  ) : platBarData.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">No platform data</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={platBarData} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                        <XAxis dataKey="platform" tick={{ fontSize: 10, fill: MUTED }} interval={0} angle={-15} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 10, fill: MUTED }} tickFormatter={v => metricFmt(platMetric)(Number(v))} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, n: any) => [metricFmt(platMetric)(Number(v)), n]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="mobile" name="Mobile" fill={SERIES[0]} radius={[3, 3, 0, 0]} maxBarSize={32} />
                        <Bar dataKey="desktop" name="Desktop" fill={SERIES[3]} radius={[3, 3, 0, 0]} maxBarSize={32} />
                        <Bar dataKey="other" name="Other" fill={SERIES[1]} radius={[3, 3, 0, 0]} maxBarSize={32} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </section>
              )}
            </div>

            {/* Ad preview + Comments (Ads only) */}
            {level === "ad" && (
              <div className="rounded-xl border bg-card p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center gap-1 mb-2">
                      <p className="text-sm font-semibold">Ad preview</p>
                    </div>
                    <div className="flex gap-1 mb-2 flex-wrap">
                      {[
                        { k: "all", l: "All" },
                        { k: "feeds_instream", l: "Feeds and instream ads" },
                        { k: "stories_reels", l: "Stories and Reels" },
                        { k: "right_column", l: "Right column" },
                      ].map(m => (
                        <button key={m.k} onClick={() => setPreviewMode(m.k)}
                          className={cn("h-7 px-2 text-[11px] rounded-md border",
                            previewMode === m.k ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50")}>
                          {m.l}
                        </button>
                      ))}
                    </div>
                    <div className="aspect-[4/5] border rounded-lg bg-muted flex items-center justify-center overflow-auto">
                      {(() => {
                        const cr = creativeByRow[capped[0]?.id]
                        if (cr?.videoId) {
                          return (
                            <video src={`/api/insights/video-proxy?videoId=${encodeURIComponent(cr.videoId)}&pageId=${encodeURIComponent(cr.pageId || "")}`} poster={cr.thumbnail || undefined}
                              controls playsInline preload="metadata" className="max-h-full max-w-full object-contain" />
                          )
                        }
                        if (cr?.thumbnail) return <img src={cr.thumbnail} alt="preview" className="w-full h-full object-cover" />
                        return <span className="text-xs text-muted-foreground">No preview available</span>
                      })()}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1 mb-2">
                      <p className="text-sm font-semibold">Comments</p>
                    </div>
                    <div className="flex gap-1 mb-2 flex-wrap">
                      {[
                        { k: "facebook_feed", l: "Facebook Feed" },
                        { k: "instagram_feed", l: "Instagram Feed" },
                        { k: "instagram_reels", l: "Instagram Reels" },
                      ].map(m => (
                        <button key={m.k} onClick={() => setCommentsFilter(m.k)}
                          className={cn("h-7 px-2 text-[11px] rounded-md border",
                            commentsFilter === m.k ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50")}>
                          {m.l}
                        </button>
                      ))}
                    </div>
                    <div className="aspect-[4/5] border rounded-lg bg-background flex flex-col items-center justify-center text-center p-6">
                      <IconMessageCircle className="size-8 text-muted-foreground mb-3" />
                      <p className="text-sm font-semibold mb-1">Comments not supported</p>
                      <p className="text-xs text-muted-foreground">
                        Comment previews are not supported for dynamic ads.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Download Reports Block */}
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold mb-1">See where your ads appeared</p>
                  <p className="text-[11px] text-muted-foreground">
                    Download delivery reports to see where your ads appeared. Reports show the last 30 days of available data for Audience Network, Facebook in-stream reels and Ads on Facebook Reels. Recent data may be delayed by a few days. Learn more
                  </p>
                </div>
                <button
                  onClick={() => {
                    const csvRows = platBarData.map(r => ({
                      label: r.platform,
                      value: `Mobile: ${r.mobile}, Desktop: ${r.desktop}, Other: ${r.other}`,
                    }))
                    if (csvRows.length === 0) {
                      const demoRows = demoBarData.map(r => ({ label: r.age, value: `Men: ${r.men}, Women: ${r.women}` }))
                      downloadCsv("placement_report.csv", demoRows)
                    } else {
                      downloadCsv("placement_report.csv", csvRows)
                    }
                  }}
                  className="h-9 px-3 text-sm rounded-lg border bg-background flex items-center gap-1.5 hover:bg-muted/50 shrink-0"
                >
                  <IconDownload className="size-4" /> Download reports
                </button>
              </div>
            </div>
          </>)}
          </div>
          </div>
          {workspaceDiscardConfirm && (
            <div className="absolute inset-0 z-30 grid place-items-center bg-black/45 p-4">
              <div className="w-full max-w-md rounded-xl border bg-background p-5 shadow-2xl">
                <h3 className="font-semibold">Discard staged changes?</h3>
                <p className="mt-2 text-sm text-muted-foreground">Your staged changes will be lost, including the copy kept for this browser tab. Published changes are not affected.</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => setWorkspaceDiscardConfirm(false)} className="h-9 rounded-lg border px-3 text-sm hover:bg-muted/50">Keep editing</button>
                  <button
                    onClick={() => {
                      setWorkspaceDrafts({})
                      if (accountId) clearEditorDrafts(accountId)
                      setWorkspaceDiscardConfirm(false)
                      onClose()
                    }}
                    className="h-9 rounded-lg bg-destructive px-3 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
                  >Discard and close</button>
                </div>
              </div>
            </div>
          )}
    </div>
  )

  return (
    <TooltipProvider>
      {isPage ? shellCard : (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          {shellCard}
        </div>
      )}
    </TooltipProvider>
  )
}
