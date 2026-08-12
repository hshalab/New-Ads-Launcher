"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  IconCheck,
  IconChevronRight,
  IconDots,
  IconLayoutSidebarLeftCollapse,
  IconPhoto,
  IconPlayerPlay,
  IconSearch,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { Level } from "./InsightDrawers"
import { LoadMediaModal } from "@/components/shared/load-media-modal"
import { LocationsField, hasAnyLocation, type GeoLocations } from "./LocationsField"
import type { Creative } from "@/types/creative"

type FbPage = {
  id: string
  name: string
  picture?: { data?: { url?: string } }
}

export type WorkspaceNode = {
  id: string
  name: string
  campaign_id?: string
  adset_id?: string
  status?: string
  daily_budget?: string
  lifetime_budget?: string
  start_time?: string
  stop_time?: string
  end_time?: string
  objective?: string
  buying_type?: string
  special_ad_categories?: string[]
  optimization_goal?: string
  bid_strategy?: string
  bid_amount?: string
  billing_event?: string
  conversion_location?: string
  destination_type?: string
  pacing_type?: string[]
  promoted_object?: {
    pixel_id?: string
    custom_event_type?: string
  }
  targeting?: {
    geo_locations?: GeoLocations
    excluded_geo_locations?: GeoLocations
    age_min?: number
    age_max?: number
    genders?: number[]
    custom_audiences?: { id: string; name: string }[]
    excluded_custom_audiences?: { id: string; name: string }[]
    targeting_optimization?: string
    flexible_spec?: unknown[]
    publisher_platforms?: string[]
    device_platforms?: string[]
    facebook_positions?: string[]
    instagram_positions?: string[]
    audience_network_positions?: string[]
    messenger_positions?: string[]
  }
  attribution_spec?: { event_type: string; window_days: number }[]
  advertiser?: { type: string; id: string; name: string } | null
  payer?: { type: string; id: string; name: string } | null
  creative?: {
    thumbnail_url?: string
    image_url?: string
    title?: string
    name?: string
    body?: string
    video_id?: string
  }
  page_id?: string
  object_story_id?: string
  post_url?: string
  image_hash?: string
  video_id?: string
  thumb_url?: string
  primaryText?: string
  headline?: string
  description?: string
  link?: string
  cta?: string
  portal_creative_id?: string
  creative_edit?: boolean
  primary_text_variations?: string[]
  headline_variations?: string[]
  description_variations?: string[]
}

type HierarchyPath = {
  campaign?: string
  adset?: string
  ad?: string
}

type Props = {
  node: WorkspaceNode | null
  level: Level
  onSave?: (node: WorkspaceNode) => Promise<void> | void
  onReview?: () => void
  readOnly?: boolean
  loading?: boolean
  error?: string
  onRefresh?: () => void
  onDraftChange?: (node: WorkspaceNode, level: Level) => void
  accountId?: string
  hierarchyPath?: HierarchyPath
  hasDraft?: boolean
  onClose?: () => void
  onDiscard?: () => void
  onPublish?: () => void
  publishing?: boolean
  /** Total staged drafts across every node, shown on Publish so the count is the same at all three levels. */
  draftCount?: number
  /** Hierarchy panel control, hoisted into the shared top chrome. Omitted → no button rendered. */
  onTogglePanel?: () => void
  panelOpen?: boolean
  panelDisabled?: boolean
  panelDisabledHint?: string
}

const CTA_LABEL: Record<string, string> = {
  LEARN_MORE: "Learn more",
  SHOP_NOW: "Shop now",
  SIGN_UP: "Sign up",
  SUBSCRIBE: "Subscribe",
  CONTACT_US: "Contact us",
  DOWNLOAD: "Download",
  GET_OFFER: "Get offer",
  BOOK_TRAVEL: "Book now",
  APPLY_NOW: "Apply now",
  WATCH_MORE: "Watch more",
  SEND_MESSAGE: "Send message",
}

const lockedControlClass =
  "flex h-10 w-full cursor-not-allowed rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground opacity-80"

const selectControlClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"

const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_SALES: "Sales",
  OUTCOME_LEADS: "Leads",
  OUTCOME_TRAFFIC: "Traffic",
  OUTCOME_AWARENESS: "Awareness",
  OUTCOME_ENGAGEMENT: "Engagement",
  OUTCOME_APP_PROMOTION: "App promotion",
  OUTCOME_REACH: "Reach",
  LINK_CLICKS: "Link clicks",
  CONVERSIONS: "Conversions",
}

const BID_LABEL: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: "Highest volume or value",
  LOWEST_COST_WITH_BID_CAP: "Bid cap",
  COST_CAP: "Cost per result goal",
  MINIMUM_ROAS: "Minimum ROAS",
}

const OPT_LABEL: Record<string, string> = {
  LINK_CLICKS: "Link clicks",
  IMPRESSIONS: "Impressions",
  REACH: "Reach",
  LANDING_PAGE_VIEWS: "Landing page views",
  CONVERSIONS: "Conversions",
  OFFSITE_CONVERSIONS: "Offsite conversions",
  VIDEO_VIEWS: "Video views",
  LEAD_GENERATION: "Lead generation",
  APP_INSTALLS: "App installs",
}

const PIXEL_GOALS = new Set(["OFFSITE_CONVERSIONS", "CONVERSIONS"])

const DESTINATION_LABEL: Record<string, string> = {
  WEBSITE: "Website",
  APP: "App",
  MESSENGER: "Messenger",
  INSTAGRAM_DIRECT: "Instagram",
  WHATSAPP: "WhatsApp",
  ON_AD: "Instant form",
  ON_POST: "On post",
  ON_PAGE: "On page",
  ON_EVENT: "Event",
  PHONE_CALL: "Calls",
  SHOP_AUTOMATIC: "Shop",
  UNDEFINED: "Website",
}

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  audience_network: "Audience Network",
  messenger: "Messenger",
  threads: "Threads",
}

const DEVICE_LABEL: Record<string, string> = {
  mobile: "Mobile",
  desktop: "Desktop",
}

const PLACEMENT_PLATFORMS = ["facebook", "instagram", "audience_network", "messenger"]
const PLACEMENT_DEVICES = ["mobile", "desktop"]

function formatDateTime(value?: string) {
  return value ? value.slice(0, 16) : ""
}

function Section({
  title,
  subtitle,
  children,
  optional = false,
  locked = false,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  optional?: boolean
  locked?: boolean
}) {
  return (
    <section className="space-y-4 rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
      <div className="mb-3 space-y-1">
        <div className="flex items-center gap-2">
          <span className={cn(
            "grid size-4 place-items-center rounded-full border",
            locked ? "border-muted-foreground text-muted-foreground" : "border-emerald-600 text-emerald-600",
          )}>
            <IconCheck className="size-2.5" />
          </span>
          <h3 className="text-sm font-semibold">{title}</h3>
          {locked && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Locked
            </span>
          )}
          {optional && <span className="text-xs text-muted-foreground">Optional</span>}
        </div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

function SplitBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-[#e4e6eb] dark:border-gray-800">
      <div className="border-b border-[#e4e6eb] bg-muted/40 px-3 py-2 text-xs font-semibold dark:border-gray-800">
        {title}
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </div>
  )
}

function ReadOnlyChips({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-2">
        {values.map(value => (
          <span key={value} className="rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {value}
          </span>
        ))}
      </div>
    </div>
  )
}

function LockedControl({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <input
        type="text"
        disabled
        value={value?.trim() ? value : "—"}
        className={lockedControlClass}
        aria-disabled="true"
      />
    </div>
  )
}

function StatusToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const active = value === "ACTIVE"
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={active ? "On" : "Off"}
      disabled={disabled}
      onClick={() => onChange(active ? "PAUSED" : "ACTIVE")}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        active ? "bg-emerald-600" : "bg-muted-foreground/40",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full bg-white shadow transition-transform",
          active ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

/**
 * Primary text in the preview, clamped the way Facebook clamps it: four lines, then "See more".
 *
 * Line-clamped rather than character-counted — a character budget mis-truncates German compounds
 * and emoji-heavy copy, and Meta itself clamps by rendered lines. The toggle is only rendered when
 * the text actually overflows, measured after layout, so short copy gets no dangling control.
 * `text` is a key input: switching ads remounts the measurement and collapses the new body.
 */
function ClampedPrimaryText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    setExpanded(false)
  }, [text])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setOverflowing(element.scrollHeight - element.clientHeight > 1)
    // Collapsed height is what decides whether a toggle is needed, so only measure then.
    if (!expanded) measure()
    const observer = new ResizeObserver(() => { if (!expanded) measure() })
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, expanded])

  return (
    <div className="px-3 pb-2">
      <p
        ref={ref}
        className={cn("whitespace-pre-wrap text-xs leading-relaxed", !expanded && "line-clamp-4")}
      >
        {text}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(open => !open)}
          className="mt-0.5 text-xs font-semibold text-muted-foreground hover:underline"
          aria-expanded={expanded}
        >
          {expanded ? "See less" : "See more"}
        </button>
      )}
    </div>
  )
}

function AdPreview({ node }: { node: WorkspaceNode }) {
  const thumbnail = node.thumb_url || node?.creative?.thumbnail_url || node?.creative?.image_url
  const videoId = node.video_id || node?.creative?.video_id
  const videoSrc = videoId
    ? `/api/insights/video-proxy?videoId=${encodeURIComponent(videoId)}${node.page_id ? `&pageId=${encodeURIComponent(node.page_id)}` : ""}`
    : ""
  const title = node.headline || node?.creative?.title || node?.creative?.name || node?.name || "Headline"
  const body = node.primaryText || node?.creative?.body || "Primary text will appear here."
  const description = node.description || ""
  const link = node.link || ""
  const cta = CTA_LABEL[node.cta || ""] || node.cta || "Learn more"
  const domain = (() => {
    if (!link) return "Website destination"
    try {
      return new URL(link.startsWith("http") ? link : `https://${link}`).hostname.replace(/^www\./, "")
    } catch {
      return link
    }
  })()
  return (
    <div className="mx-auto w-full max-w-[330px] overflow-hidden rounded-lg border bg-background shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="grid size-8 place-items-center rounded-full bg-neutral-900 text-xs font-bold text-white">P</span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">Facebook Page</p>
          <p className="text-[10px] text-muted-foreground">Sponsored · Public</p>
        </div>
      </div>
      <ClampedPrimaryText text={body} />
      <div className="relative flex aspect-square items-center justify-center bg-neutral-100 dark:bg-neutral-900">
        {videoSrc ? (
          <video
            src={videoSrc}
            poster={thumbnail || undefined}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            className="size-full object-contain"
            aria-label="Ad video preview"
          />
        ) : thumbnail ? (
          <img src={thumbnail} alt="" className="size-full object-contain" />
        ) : (
          <IconPhoto className="size-12 text-muted-foreground" />
        )}
        {videoSrc && (
          <span className="pointer-events-none absolute grid size-11 place-items-center rounded-full bg-black/70 text-white">
            <IconPlayerPlay className="size-5" />
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 bg-muted/30 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{domain}</p>
          <p className="truncate text-xs font-semibold">{title}</p>
          {description ? <p className="truncate text-[10px] text-muted-foreground">{description}</p> : null}
        </div>
        <Button variant="outline" size="sm" className="h-7 shrink-0 text-xs" type="button" tabIndex={-1}>
          {cta}
        </Button>
      </div>
    </div>
  )
}

export function UnifiedWorkspaceEditor({
  node,
  level,
  onSave: _onSave,
  onReview,
  readOnly = false,
  loading = false,
  error,
  onRefresh,
  onDraftChange,
  accountId = "",
  hierarchyPath,
  hasDraft = false,
  onClose,
  onDiscard,
  onPublish,
  publishing = false,
  draftCount = 0,
  onTogglePanel,
  panelOpen = false,
  panelDisabled = false,
  panelDisabledHint,
}: Props) {
  const [draft, setDraft] = useState<WorkspaceNode | null>(node)
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pages, setPages] = useState<FbPage[]>([])
  const [pagesLoading, setPagesLoading] = useState(false)
  const [pageMenuOpen, setPageMenuOpen] = useState(false)
  const [pageQuery, setPageQuery] = useState("")
  const primaryTextRef = useRef<HTMLTextAreaElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const pageMenuRef = useRef<HTMLDivElement | null>(null)
  const syncingNodeRef = useRef(false)
  const nodeSignature = useMemo(() => JSON.stringify(node), [node])
  const draftSignature = useMemo(() => JSON.stringify(draft), [draft])

  useEffect(() => {
    setDraft(current => {
      if (JSON.stringify(current) === nodeSignature) {
        syncingNodeRef.current = false
        return current
      }
      syncingNodeRef.current = true
      return JSON.parse(nodeSignature) as WorkspaceNode | null
    })
  }, [level, nodeSignature])

  useEffect(() => {
    if (!draft || nodeSignature === "null" || !onDraftChange) return
    if (syncingNodeRef.current) {
      if (draftSignature === nodeSignature) syncingNodeRef.current = false
      return
    }
    if (draftSignature !== nodeSignature) onDraftChange(draft, level)
  }, [draft, draftSignature, level, nodeSignature, onDraftChange])

  useEffect(() => {
    const el = primaryTextRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.max(el.scrollHeight, 96)}px`
  }, [draft?.primaryText, level])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [menuOpen])

  useEffect(() => {
    if (!pageMenuOpen) return
    const onDoc = (event: MouseEvent) => {
      if (!pageMenuRef.current?.contains(event.target as Node)) setPageMenuOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [pageMenuOpen])

  useEffect(() => {
    if (level !== "ad" || readOnly) return
    let cancelled = false

    async function loadPages() {
      try {
        const cached = sessionStorage.getItem("fb_pages_cache")
        if (cached) {
          const { ts, pages: cachedPages } = JSON.parse(cached) as { ts: number; pages: FbPage[] }
          if (Date.now() - ts < 10 * 60 * 1000 && Array.isArray(cachedPages) && cachedPages.length) {
            if (!cancelled) setPages(cachedPages)
            return
          }
        }
      } catch {
        // ignore cache parse failures
      }

      setPagesLoading(true)
      try {
        const qs = accountId ? `?ad_account_id=${encodeURIComponent(accountId)}` : ""
        const res = await fetch(`/api/facebook/pages${qs}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to load pages")
        const nextPages = Array.isArray(data.pages) ? (data.pages as FbPage[]) : []
        if (!cancelled) setPages(nextPages)
        try {
          sessionStorage.setItem("fb_pages_cache", JSON.stringify({ ts: Date.now(), pages: nextPages }))
        } catch {
          // ignore storage failures
        }
      } catch {
        if (!cancelled) setPages([])
      } finally {
        if (!cancelled) setPagesLoading(false)
      }
    }

    void loadPages()
    return () => {
      cancelled = true
    }
  }, [accountId, level, readOnly])

  const typeLabel = level === "campaign" ? "Campaign" : level === "adset" ? "Ad set" : "Ad"
  const hasDailyBudget = draft?.daily_budget != null && draft?.daily_budget !== ""
  const hasLifetimeBudget = draft?.lifetime_budget != null && draft?.lifetime_budget !== ""
  const budgetCents = Number.parseInt(draft?.daily_budget || draft?.lifetime_budget || "0")

  if (loading && !draft) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <p className="font-semibold">Loading fresh Meta details…</p>
          <p className="mt-1 text-sm text-muted-foreground">This node will be cached for the current workspace session.</p>
        </div>
      </div>
    )
  }

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="font-semibold">Select a campaign, ad set or ad</p>
          <p className="mt-1 text-sm text-muted-foreground">The editor will stay in this workspace while you move through the hierarchy.</p>
        </div>
      </div>
    )
  }

  const updateCreative = (updates: Partial<WorkspaceNode>) => {
    setDraft(current => current ? { ...current, ...updates, creative_edit: true } : current)
  }

  const selectPortalMedia = (_ids: string[], creatives: Creative[]) => {
    const creative = creatives[0]
    if (!creative) return
    updateCreative({
      portal_creative_id: creative.id,
      image_hash: creative.fb_image_hash,
      video_id: creative.fb_video_id,
      thumb_url: creative.fb_thumbnail_url || creative.fb_image_url || creative.file_url,
    })
    setMediaPickerOpen(false)
  }

  const crumbs = (
    level === "campaign"
      ? [hierarchyPath?.campaign || draft.name]
      : level === "adset"
        ? [hierarchyPath?.campaign, hierarchyPath?.adset || draft.name]
        : [hierarchyPath?.campaign, hierarchyPath?.adset, hierarchyPath?.ad || draft.name]
  ).filter(Boolean) as string[]
  const statusOn = (draft.status || "PAUSED") === "ACTIVE"
  // The trailing crumb IS the title — rendering the name again below it was the duplication in the
  // top chrome that made campaign / ad set / ad look like three different editors.
  const parentCrumbs = crumbs.slice(0, -1)
  const titleCrumb = crumbs[crumbs.length - 1] || draft.name || typeLabel
  const customAudiences = draft.targeting?.custom_audiences || []
  const excludedCustomAudiences = draft.targeting?.excluded_custom_audiences || []
  const currentPage = draft.page_id ? pages.find(page => page.id === draft.page_id) || { id: draft.page_id, name: draft.page_id } : null
  const pageOptions = currentPage && !pages.some(page => page.id === currentPage.id) ? [currentPage, ...pages] : pages
  const filteredPages = pageOptions.filter(page => {
    const query = pageQuery.trim().toLowerCase()
    return !query || page.name.toLowerCase().includes(query) || page.id.includes(query)
  })
  const needsPixel = PIXEL_GOALS.has(draft.optimization_goal || "")
  const showTransparency = Boolean(draft.advertiser || draft.payer)
  const mediaThumb = draft.thumb_url || draft.creative?.thumbnail_url || draft.creative?.image_url
  const ctaValue = draft.cta && CTA_LABEL[draft.cta] ? draft.cta : (draft.cta || "LEARN_MORE")

  // Meta convention: absence of platform lists on targeting means Advantage+ placements.
  const selectedPlatforms = draft.targeting?.publisher_platforms || []
  const manualPlacements = selectedPlatforms.length > 0
  const selectedDevices = draft.targeting?.device_platforms || PLACEMENT_DEVICES
  const positionSummary = (
    [
      ["Facebook", draft.targeting?.facebook_positions],
      ["Instagram", draft.targeting?.instagram_positions],
      ["Audience Network", draft.targeting?.audience_network_positions],
      ["Messenger", draft.targeting?.messenger_positions],
    ] as const
  )
    .filter(([, positions]) => (positions?.length || 0) > 0)
    .map(([platform, positions]) => `${platform}: ${(positions || []).join(", ")}`)

  const setPlacementMode = (mode: "advantage" | "manual") => {
    const targeting = { ...draft.targeting }
    if (mode === "advantage") {
      delete targeting.publisher_platforms
      delete targeting.device_platforms
    } else {
      targeting.publisher_platforms = ["facebook", "instagram"]
    }
    setDraft({ ...draft, targeting })
  }

  const conversionLocation = draft.destination_type
    ? DESTINATION_LABEL[draft.destination_type] || draft.destination_type
    : draft.conversion_location || "Website"
  const pacing = (draft.pacing_type || []).map(type => type.toLowerCase().replace(/_/g, " "))
  const detailedTargetingCount = draft.targeting?.flexible_spec?.length || 0
  // An existing-post / dark-post ad cannot have its Page swapped by replaceAdCreative.
  const pageLocked = Boolean(draft.object_story_id)

  // Publish blockers, evaluated once so the footer can say WHY it is disabled instead of just
  // greying out. Same list at all three levels; only the applicable ones fire.
  const blockers = [
    !draft.name?.trim() ? "Name is required" : null,
    level === "adset" && !hasAnyLocation(draft.targeting?.geo_locations)
      ? "Add at least one location — Meta rejects an empty location set"
      : null,
  ].filter(Boolean) as string[]

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(draft.id)
    } catch {
      // ignore clipboard failures
    }
    setMenuOpen(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f5f6f7] dark:bg-background">
      {/* Top chrome and footer span the full width at every level. At Ad level the preview column
          starts below the chrome rather than beside it — as grid siblings the preview frame cut
          into the breadcrumb row, and Ad stopped matching Campaign and Ad set. */}
      <div className="shrink-0 border-b border-[#e4e6eb] bg-white px-6 py-3 dark:border-gray-800 dark:bg-card">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {onTogglePanel && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={panelOpen ? "Hide hierarchy" : "Show hierarchy"}
              aria-pressed={Boolean(panelOpen)}
              disabled={panelDisabled}
              title={panelDisabled ? panelDisabledHint : undefined}
              onClick={onTogglePanel}
            >
              <IconLayoutSidebarLeftCollapse className="size-4" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label="Hierarchy path">
              <span className="shrink-0 uppercase tracking-wider">{typeLabel}</span>
              {parentCrumbs.map((name, index) => (
                <span key={`${name}-${index}`} className="inline-flex min-w-0 items-center gap-1">
                  <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
                  <span className="max-w-[200px] truncate">{name}</span>
                </span>
              ))}
            </nav>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="truncate text-lg font-bold text-[#1c2b33] dark:text-gray-100">{titleCrumb}</h1>
              {hasDraft && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800">
                  Draft
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className={cn("text-xs font-semibold", statusOn ? "text-emerald-700" : "text-muted-foreground")}>
                {statusOn ? "On" : "Off"}
              </span>
              <StatusToggle
                value={draft.status || "PAUSED"}
                onChange={status => setDraft({ ...draft, status })}
                disabled={readOnly}
              />
            </div>
            <div className="relative" ref={menuRef}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="More options"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(open => !open)}
              >
                <IconDots className="size-4" />
              </Button>
              {menuOpen && (
                <div className="absolute right-0 z-30 mt-1 w-52 rounded-md border bg-background py-1 shadow-lg">
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs hover:bg-muted/50"
                    onClick={() => {
                      setMenuOpen(false)
                      onReview?.()
                    }}
                  >
                    Review and publish
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs hover:bg-muted/50 disabled:opacity-40"
                    disabled={!hasDraft || readOnly}
                    onClick={() => {
                      setMenuOpen(false)
                      onDiscard?.()
                    }}
                  >
                    Discard draft
                  </button>
                  <div className="my-1 border-t" />
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs hover:bg-muted/50"
                    onClick={() => void copyId()}
                  >
                    Copy ID
                  </button>
                  <div className="my-1 border-t" />
                  <button type="button" className="block w-full cursor-not-allowed px-3 py-2 text-left text-xs text-muted-foreground opacity-50" disabled>
                    Duplicate · soon
                  </button>
                  <button type="button" className="block w-full cursor-not-allowed px-3 py-2 text-left text-xs text-muted-foreground opacity-50" disabled>
                    Create ad · soon
                  </button>
                  <button type="button" className="block w-full cursor-not-allowed px-3 py-2 text-left text-xs text-muted-foreground opacity-50" disabled>
                    Create rule · soon
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={cn(
        "grid min-h-0 flex-1 grid-cols-1",
        level === "ad" && "xl:grid-cols-[minmax(420px,1fr)_minmax(320px,420px)]",
      )}>
        <div className={cn(
          "min-h-0 overflow-y-auto bg-white dark:bg-card",
          level === "ad" && "xl:border-r",
        )}>
          <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
            {error && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <span>{error} The editor is read-only until fresh detail loads.</span>
                <Button type="button" variant="outline" size="sm" onClick={onRefresh}>Retry</Button>
              </div>
            )}

            <fieldset disabled={readOnly} className="space-y-6 border-0 p-0">
              {readOnly && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Your role has read-only access. Charts, Preview, Review and History remain available.
                </div>
              )}

              <Section title={`${typeLabel} name`}>
                <Input value={draft.name || ""} onChange={event => setDraft({ ...draft, name: event.target.value })} />
              </Section>

              {level === "campaign" && (
                <Section title="Campaign structure" locked>
                  <div className="grid grid-cols-2 gap-2">
                    <LockedControl label="Buying type" value={draft.buying_type || "AUCTION"} />
                    <LockedControl
                      label="Objective"
                      value={OBJECTIVE_LABEL[draft.objective || ""] || draft.objective || "—"}
                    />
                    {draft.bid_strategy && (
                      <LockedControl
                        label="Bid strategy"
                        value={BID_LABEL[draft.bid_strategy] || draft.bid_strategy}
                      />
                    )}
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Special Ad Categories</Label>
                    <input
                      type="text"
                      disabled
                      value={(draft.special_ad_categories || []).length
                        ? (draft.special_ad_categories || []).join(", ")
                        : "None"}
                      className={lockedControlClass}
                      aria-disabled="true"
                    />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Locked after create. Changing objective, buying type, or special categories needs a replacement hierarchy.
                  </p>
                </Section>
              )}

              {level === "campaign" && (
                <Section title="Budget & schedule">
                  {(hasDailyBudget || hasLifetimeBudget) ? (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">{hasDailyBudget ? "Daily budget" : "Lifetime budget"}</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                        <Input
                          type="number"
                          min="0"
                          step=".01"
                          className="pl-7"
                          value={budgetCents / 100}
                          onChange={event => {
                            const cents = String(Math.round((Number.parseFloat(event.target.value) || 0) * 100))
                            setDraft(hasDailyBudget ? { ...draft, daily_budget: cents } : { ...draft, lifetime_budget: cents })
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                      Budget is controlled at the ad set level.
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Start</Label>
                      <Input
                        type="datetime-local"
                        className="text-xs"
                        value={formatDateTime(draft.start_time)}
                        onChange={event => setDraft({ ...draft, start_time: event.target.value ? new Date(event.target.value).toISOString() : "" })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">End</Label>
                      <Input
                        type="datetime-local"
                        className="text-xs"
                        value={formatDateTime(draft.stop_time)}
                        onChange={event => {
                          const value = event.target.value ? new Date(event.target.value).toISOString() : ""
                          setDraft({ ...draft, stop_time: value })
                        }}
                      />
                    </div>
                  </div>
                </Section>
              )}

              {level === "adset" && (
                <>
                  <Section
                    title="Conversion structure"
                    subtitle="Set at create. Not reassigned in the editor."
                    locked
                  >
                    <LockedControl label="Conversion location" value={conversionLocation} />
                    <p className="mt-3 text-xs text-muted-foreground">
                      Changing conversion location needs a replacement ad set.
                    </p>
                  </Section>

                  <Section title="Conversion">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Performance goal</Label>
                        <select
                          className={selectControlClass}
                          value={draft.optimization_goal || ""}
                          onChange={e => setDraft({ ...draft, optimization_goal: e.target.value })}
                        >
                          <option value="">Select goal</option>
                          {Object.entries(OPT_LABEL).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      </div>
                      {needsPixel && (
                        <>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Dataset (Pixel)</Label>
                            {draft.promoted_object?.pixel_id ? (
                              <select
                                className={selectControlClass}
                                value={draft.promoted_object.pixel_id}
                                onChange={e => setDraft({
                                  ...draft,
                                  promoted_object: { ...draft.promoted_object, pixel_id: e.target.value },
                                })}
                              >
                                <option value={draft.promoted_object.pixel_id}>{draft.promoted_object.pixel_id}</option>
                              </select>
                            ) : (
                              <p className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                                No pixel on this ad set.
                              </p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Conversion event</Label>
                            <select
                              className={selectControlClass}
                              value={draft.promoted_object?.custom_event_type || "PURCHASE"}
                              onChange={e => setDraft({
                                ...draft,
                                promoted_object: { ...draft.promoted_object, custom_event_type: e.target.value },
                              })}
                            >
                              <option value="PURCHASE">Purchase</option>
                              <option value="ADD_TO_CART">Add to cart</option>
                              <option value="INITIATED_CHECKOUT">Initiate checkout</option>
                              <option value="LEAD">Lead</option>
                              <option value="COMPLETE_REGISTRATION">Complete registration</option>
                              <option value="VIEW_CONTENT">View content</option>
                            </select>
                          </div>
                        </>
                      )}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-muted-foreground">Cost per result goal</Label>
                          <span className="text-xs text-muted-foreground">Optional</span>
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                          <Input
                            type="number"
                            min="0"
                            step=".01"
                            className="pl-7"
                            value={draft.bid_amount ? (parseInt(draft.bid_amount) / 100) : ""}
                            onChange={e => setDraft({
                              ...draft,
                              bid_amount: e.target.value ? String(Math.round(parseFloat(e.target.value) * 100)) : "",
                            })}
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Bid strategy</Label>
                        <select
                          className={selectControlClass}
                          value={draft.bid_strategy || ""}
                          onChange={e => setDraft({ ...draft, bid_strategy: e.target.value })}
                        >
                          <option value="">Select strategy</option>
                          {Object.entries(BID_LABEL).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                          {draft.bid_strategy && !BID_LABEL[draft.bid_strategy] && (
                            <option value={draft.bid_strategy}>{draft.bid_strategy}</option>
                          )}
                        </select>
                      </div>
                      <LockedControl
                        label="Billing event"
                        value={draft.billing_event || "IMPRESSIONS"}
                      />
                    </div>
                  </Section>

                  <Section title="Budget & schedule">
                    {(hasDailyBudget || hasLifetimeBudget) ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Daily budget</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                            <Input
                              type="number"
                              min="0"
                              step=".01"
                              className="pl-7"
                              value={hasDailyBudget ? budgetCents / 100 : ""}
                              disabled={!hasDailyBudget}
                              onChange={event => {
                                const cents = String(Math.round((Number.parseFloat(event.target.value) || 0) * 100))
                                setDraft({ ...draft, daily_budget: cents })
                              }}
                              placeholder="—"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Lifetime budget</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                            <Input
                              type="number"
                              min="0"
                              step=".01"
                              className="pl-7"
                              value={hasLifetimeBudget && !hasDailyBudget ? budgetCents / 100 : (draft.lifetime_budget ? Number.parseInt(draft.lifetime_budget) / 100 : "")}
                              disabled={!hasLifetimeBudget}
                              onChange={event => {
                                const cents = String(Math.round((Number.parseFloat(event.target.value) || 0) * 100))
                                setDraft({ ...draft, lifetime_budget: cents })
                              }}
                              placeholder="—"
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                        Budget is controlled at the campaign level.
                      </div>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Start</Label>
                        <Input
                          type="datetime-local"
                          className="text-xs"
                          value={formatDateTime(draft.start_time)}
                          onChange={event => setDraft({ ...draft, start_time: event.target.value ? new Date(event.target.value).toISOString() : "" })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          End <span className="font-normal text-muted-foreground/70">empty = ongoing</span>
                        </Label>
                        <Input
                          type="datetime-local"
                          className="text-xs"
                          value={formatDateTime(draft.end_time)}
                          onChange={event => {
                            const value = event.target.value ? new Date(event.target.value).toISOString() : ""
                            setDraft({ ...draft, end_time: value })
                          }}
                        />
                      </div>
                    </div>
                    {pacing.length > 0 && (
                      <p className="mt-3 rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        Pacing: {pacing.join(", ")} · read-only
                      </p>
                    )}
                  </Section>

                  <Section title="Attribution setting">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Click-through</Label>
                        <select
                          className={selectControlClass}
                          value={draft.attribution_spec?.find(a => a.event_type === "CLICK")?.window_days || "7"}
                          onChange={e => {
                            const days = parseInt(e.target.value)
                            const spec = [...(draft.attribution_spec || [])]
                            const idx = spec.findIndex(a => a.event_type === "CLICK")
                            if (idx >= 0) spec[idx] = { ...spec[idx], window_days: days }
                            else spec.push({ event_type: "CLICK", window_days: days })
                            setDraft({ ...draft, attribution_spec: spec })
                          }}
                        >
                          <option value="1">1 day</option>
                          <option value="7">7 days</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">View-through</Label>
                        <select
                          className={selectControlClass}
                          value={draft.attribution_spec?.find(a => a.event_type === "VIEW")?.window_days || "1"}
                          onChange={e => {
                            const days = parseInt(e.target.value)
                            const spec = [...(draft.attribution_spec || [])].filter(a => a.event_type !== "VIEW")
                            if (days > 0) spec.push({ event_type: "VIEW", window_days: days })
                            setDraft({ ...draft, attribution_spec: spec })
                          }}
                        >
                          <option value="0">None</option>
                          <option value="1">1 day</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Engaged-view</Label>
                        <select
                          className={selectControlClass}
                          value={draft.attribution_spec?.find(a => a.event_type === "ENGAGED_VIEW")?.window_days || "0"}
                          onChange={e => {
                            const days = parseInt(e.target.value)
                            const spec = [...(draft.attribution_spec || [])].filter(a => a.event_type !== "ENGAGED_VIEW")
                            if (days > 0) spec.push({ event_type: "ENGAGED_VIEW", window_days: days })
                            setDraft({ ...draft, attribution_spec: spec })
                          }}
                        >
                          <option value="0">None</option>
                          <option value="1">1 day</option>
                        </select>
                      </div>
                    </div>
                  </Section>

                  <Section
                    title="Audience"
                    subtitle="Controls are hard limits. Suggestions are signals Advantage+ may expand on."
                  >
                    <div className="space-y-4">
                      <SplitBlock title="Controls">
                        <p className="text-xs text-muted-foreground">
                          We won&apos;t reach people beyond these selections.
                        </p>
                        <LocationsField
                          geo={draft.targeting?.geo_locations}
                          excluded={draft.targeting?.excluded_geo_locations}
                          accountId={accountId}
                          readOnly={readOnly}
                          onChange={({ geo, excluded }) => setDraft({
                            ...draft,
                            targeting: {
                              ...draft.targeting,
                              geo_locations: geo,
                              // Absent, not empty — `excluded_geo_locations` is a removable key and
                              // undefined is how "remove every exclusion" reaches Meta.
                              excluded_geo_locations: excluded,
                            },
                          })}
                        />
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Minimum age (control)</Label>
                          <select
                            className={cn(selectControlClass, "max-w-[120px]")}
                            value={draft.targeting?.age_min || 18}
                            onChange={e => setDraft({
                              ...draft,
                              targeting: { ...draft.targeting, age_min: parseInt(e.target.value) },
                            })}
                          >
                            {Array.from({ length: 48 }, (_, i) => i + 18).map(age => (
                              <option key={age} value={age}>{age}</option>
                            ))}
                          </select>
                        </div>
                        {excludedCustomAudiences.length > 0 && (
                          <ReadOnlyChips
                            label="Excluded custom audiences"
                            values={excludedCustomAudiences.map(aud => aud.name || aud.id)}
                          />
                        )}
                      </SplitBlock>

                      <SplitBlock title="Suggest an audience">
                        <label className="flex items-start gap-2 rounded border bg-muted/30 p-3">
                          <input
                            type="checkbox"
                            checked={draft.targeting?.targeting_optimization === "expansion_all"}
                            onChange={e => setDraft({
                              ...draft,
                              targeting: {
                                ...draft.targeting,
                                targeting_optimization: e.target.checked ? "expansion_all" : "none",
                              },
                            })}
                            className="mt-0.5"
                          />
                          <div className="text-xs">
                            <span className="block font-medium">Advantage detailed targeting</span>
                            <span className="text-muted-foreground">Reach people beyond your selections when likely to improve performance.</span>
                          </div>
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Age min</Label>
                            <select
                              className={selectControlClass}
                              value={draft.targeting?.age_min || 18}
                              onChange={e => setDraft({
                                ...draft,
                                targeting: { ...draft.targeting, age_min: parseInt(e.target.value) },
                              })}
                            >
                              {Array.from({ length: 48 }, (_, i) => i + 18).map(age => (
                                <option key={age} value={age}>{age}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Age max</Label>
                            <select
                              className={selectControlClass}
                              value={draft.targeting?.age_max || 65}
                              onChange={e => setDraft({
                                ...draft,
                                targeting: { ...draft.targeting, age_max: parseInt(e.target.value) },
                              })}
                            >
                              {Array.from({ length: 48 }, (_, i) => i + 18).map(age => (
                                <option key={age} value={age}>{age === 65 ? "65+" : age}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Gender</Label>
                            <select
                              className={selectControlClass}
                              value={draft.targeting?.genders?.[0] || 0}
                              onChange={e => {
                                const val = parseInt(e.target.value)
                                setDraft({ ...draft, targeting: { ...draft.targeting, genders: val ? [val] : [] } })
                              }}
                            >
                              <option value={0}>All</option>
                              <option value={1}>Men</option>
                              <option value={2}>Women</option>
                            </select>
                          </div>
                        </div>
                        {customAudiences.length > 0 && (
                          <ReadOnlyChips
                            label="Custom audiences (include)"
                            values={customAudiences.map(aud => aud.name || aud.id)}
                          />
                        )}
                        <p className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                          {detailedTargetingCount > 0
                            ? `Detailed targeting: ${detailedTargetingCount} interest or behaviour group${detailedTargetingCount === 1 ? "" : "s"} set in Meta, shown read-only.`
                            : "Detailed targeting (interests, behaviours) is not set on this ad set."}
                          {" "}The full picker is deferred to BL-39.
                        </p>
                      </SplitBlock>

                      <p className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        Estimated audience size unavailable — reach estimate API not integrated.
                      </p>
                    </div>
                  </Section>

                  {showTransparency && (
                    <Section
                      title="Ad transparency"
                      subtitle="The advertiser and payer shown on this ad. Read-only here — changing them is a verification flow in Meta."
                    >
                      <div className="grid grid-cols-2 gap-3">
                        {draft.advertiser && (
                          <LockedControl
                            label="Advertiser"
                            value={draft.advertiser.name || draft.advertiser.id}
                          />
                        )}
                        {draft.payer && (
                          <LockedControl
                            label="Payer"
                            value={draft.payer.name || draft.payer.id}
                          />
                        )}
                      </div>
                    </Section>
                  )}

                  <Section title="Placements">
                    <div className="space-y-3">
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                        <input
                          type="radio"
                          name="placementMode"
                          checked={!manualPlacements}
                          onChange={() => setPlacementMode("advantage")}
                          className="mt-1"
                        />
                        <div>
                          <span className="block text-sm font-medium">Advantage+ placements</span>
                          <span className="block text-xs text-muted-foreground">
                            Recommended. Meta allocates budget across best performing placements. No platform lists are
                            sent on targeting.
                          </span>
                        </div>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                        <input
                          type="radio"
                          name="placementMode"
                          checked={manualPlacements}
                          onChange={() => setPlacementMode("manual")}
                          className="mt-1"
                        />
                        <div className="w-full space-y-3">
                          <div>
                            <span className="block text-sm font-medium">Manual placements</span>
                            <span className="block text-xs text-muted-foreground">Choose where your ads appear.</span>
                          </div>
                          <div className={cn("space-y-3", !manualPlacements && "pointer-events-none opacity-50")}>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Platforms</Label>
                              <div className="grid grid-cols-2 gap-2">
                                {PLACEMENT_PLATFORMS.map(plat => {
                                  const checked = selectedPlatforms.includes(plat)
                                  return (
                                    <label key={plat} className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={!manualPlacements || (checked && selectedPlatforms.length === 1)}
                                        onChange={e => {
                                          const next = e.target.checked
                                            ? [...selectedPlatforms, plat]
                                            : selectedPlatforms.filter(p => p !== plat)
                                          if (!next.length) return
                                          setDraft({
                                            ...draft,
                                            targeting: { ...draft.targeting, publisher_platforms: next },
                                          })
                                        }}
                                      />
                                      <span className="text-xs">{PLATFORM_LABEL[plat] || plat}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Devices</Label>
                              <div className="grid grid-cols-2 gap-2">
                                {PLACEMENT_DEVICES.map(device => {
                                  const checked = selectedDevices.includes(device)
                                  return (
                                    <label key={device} className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={!manualPlacements || (checked && selectedDevices.length === 1)}
                                        onChange={e => {
                                          const next = e.target.checked
                                            ? [...selectedDevices, device]
                                            : selectedDevices.filter(d => d !== device)
                                          if (!next.length) return
                                          setDraft({
                                            ...draft,
                                            targeting: { ...draft.targeting, device_platforms: next },
                                          })
                                        }}
                                      />
                                      <span className="text-xs">{DEVICE_LABEL[device] || device}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      </label>
                      {positionSummary.length > 0 && (
                        <ReadOnlyChips label="Positions set in Meta" values={positionSummary} />
                      )}
                    </div>
                  </Section>
                </>
              )}

              {level === "ad" && (
                <>
                  {mediaPickerOpen && (
                    <LoadMediaModal
                      open={mediaPickerOpen}
                      onClose={() => setMediaPickerOpen(false)}
                      adAccountId={accountId}
                      alreadySelected={new Set(draft.portal_creative_id ? [draft.portal_creative_id] : [])}
                      onConfirm={selectPortalMedia}
                      tabs={["vault"]}
                    />
                  )}
                  <Section
                    title="Identity"
                    subtitle="The profiles that will be used in your ad. Changing the Page creates a new Meta creative on Publish."
                  >
                    <div className="space-y-3">
                      {pageLocked ? (
                        <div className="space-y-2">
                          <LockedControl label="Facebook Page" value={currentPage?.name || draft.page_id} />
                          <p className="text-xs text-muted-foreground">
                            This ad runs on an existing Page post, so its Page can&apos;t be changed here.
                          </p>
                          {draft.post_url && (
                            <a
                              href={draft.post_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs underline"
                            >
                              Open the post
                            </a>
                          )}
                        </div>
                      ) : (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          <span className="text-red-500">*</span> Facebook Page
                        </Label>
                        <div className="relative" ref={pageMenuRef}>
                          <button
                            type="button"
                            className={cn(selectControlClass, "flex items-center justify-between gap-2 text-left")}
                            aria-haspopup="listbox"
                            aria-expanded={pageMenuOpen}
                            aria-label="Facebook Page"
                            onClick={() => setPageMenuOpen(open => !open)}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-neutral-900 text-[10px] font-bold text-white">
                                {currentPage?.picture?.data?.url ? (
                                  <img src={currentPage.picture.data.url} alt="" className="size-full object-cover" />
                                ) : (
                                  (currentPage?.name || "P").slice(0, 1).toUpperCase()
                                )}
                              </span>
                              <span className="min-w-0 truncate">
                                {currentPage?.name || "Select a Facebook Page"}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">▾</span>
                          </button>
                          {pageMenuOpen && (
                            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-lg">
                              <div className="flex items-center gap-2 border-b px-3 py-2">
                                <IconSearch className="size-3.5 text-muted-foreground" />
                                <input
                                  type="search"
                                  value={pageQuery}
                                  onChange={event => setPageQuery(event.target.value)}
                                  placeholder="Search by Page name or ID"
                                  className="w-full bg-transparent text-sm outline-none"
                                  autoFocus
                                />
                              </div>
                              <div className="max-h-56 overflow-y-auto py-1" role="listbox" aria-label="Facebook Pages">
                                {pagesLoading && (
                                  <p className="px-3 py-2 text-xs text-muted-foreground">Loading pages…</p>
                                )}
                                {!pagesLoading && filteredPages.length === 0 && (
                                  <p className="px-3 py-2 text-xs text-muted-foreground">No pages found</p>
                                )}
                                {filteredPages.map(page => {
                                  const selected = page.id === draft.page_id
                                  return (
                                    <button
                                      key={page.id}
                                      type="button"
                                      role="option"
                                      aria-selected={selected}
                                      className={cn(
                                        "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50",
                                        selected && "bg-muted/40",
                                      )}
                                      onClick={() => {
                                        updateCreative({ page_id: page.id })
                                        setPageMenuOpen(false)
                                        setPageQuery("")
                                      }}
                                    >
                                      <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-neutral-900 text-[10px] font-bold text-white">
                                        {page.picture?.data?.url ? (
                                          <img src={page.picture.data.url} alt="" className="size-full object-cover" />
                                        ) : (
                                          page.name.slice(0, 1).toUpperCase()
                                        )}
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">{page.name}</span>
                                        <span className="block truncate text-[10px] text-muted-foreground">{page.id}</span>
                                      </span>
                                      {selected && <IconCheck className="size-3.5 shrink-0 text-emerald-600" />}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      )}
                      <LockedControl label="Instagram profile" value="Use Facebook Page" />
                    </div>
                  </Section>
                  <Section
                    title="Ad creative"
                    subtitle="Any media, copy, CTA, URL or Page change creates a new Meta creative on Publish. The previous creative is retained."
                  >
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="relative size-24 shrink-0 overflow-hidden rounded-md border bg-muted">
                          {mediaThumb ? (
                            <img src={mediaThumb} alt="" className="size-full object-cover" />
                          ) : (
                            <span className="flex size-full items-center justify-center text-muted-foreground">
                              <IconPhoto className="size-6" />
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Button type="button" variant="outline" size="sm" onClick={() => setMediaPickerOpen(true)}>
                            Replace media from Creative Portal
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            Uses the asset&apos;s Meta <code>image_hash</code> or <code>video_id</code> plus thumbnail.
                          </p>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Primary text</Label>
                        <textarea
                          ref={primaryTextRef}
                          rows={4}
                          className="min-h-24 w-full resize-none overflow-hidden rounded-md border bg-background px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap"
                          value={draft.primaryText || ""}
                          onChange={event => updateCreative({ primaryText: event.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Headline</Label>
                          <Input value={draft.headline || ""} onChange={event => updateCreative({ headline: event.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Description</Label>
                          <Input value={draft.description || ""} onChange={event => updateCreative({ description: event.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Destination URL</Label>
                          <Input value={draft.link || ""} onChange={event => updateCreative({ link: event.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Call to action</Label>
                          <select
                            className={selectControlClass}
                            value={ctaValue}
                            onChange={event => updateCreative({ cta: event.target.value })}
                          >
                            {Object.entries(CTA_LABEL).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                            {draft.cta && !CTA_LABEL[draft.cta] && (
                              <option value={draft.cta}>{draft.cta}</option>
                            )}
                          </select>
                        </div>
                      </div>
                    </div>
                  </Section>
                </>
              )}
            </fieldset>
          </div>
        </div>

        {level === "ad" && (
          <aside className="min-h-0 space-y-4 overflow-y-auto bg-[#f5f6f7] p-5 dark:bg-background">
            <section className="rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
              <p className="mb-3 text-sm font-semibold">Preview</p>
              <AdPreview node={draft} />
              <p className="mt-3 text-xs text-muted-foreground">
                Built from this draft, not Meta&apos;s own preview. Advanced multi-placement preview is deferred to BL-39.
              </p>
            </section>
          </aside>
        )}
      </div>

      <div className="shrink-0 space-y-3 border-t border-[#e4e6eb] bg-white px-6 py-3 dark:border-gray-800 dark:bg-card">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          By clicking Publish, you acknowledge that your use of Meta&apos;s ad tools is subject to our Terms and Conditions.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
            {hasDraft && blockers.length > 0 ? (
              <span className="text-red-600 dark:text-red-400">{blockers.join(" · ")}</span>
            ) : draftCount > 0 ? (
              `${draftCount} unpublished change${draftCount === 1 ? "" : "s"} across this workspace`
            ) : (
              "No unpublished changes"
            )}
          </p>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onDiscard}
            disabled={!hasDraft || readOnly || publishing}
          >
            Discard draft
          </Button>
          <Button
            type="button"
            onClick={onPublish}
            disabled={!hasDraft || readOnly || publishing || blockers.length > 0}
          >
            {publishing ? "Publishing…" : draftCount > 1 ? `Publish (${draftCount})` : "Publish"}
          </Button>
        </div>
      </div>
    </div>
  )
}
