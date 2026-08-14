"use client"

import { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from "react"
import { useSearchParams } from "next/navigation"
import { useAdAccount } from "@/lib/ad-account-context"
import { cn } from "@/lib/utils"
import { CreativeCardMedia } from "@/components/creative-card-media"
import { AdsDateRangePicker, getPresetRange } from "@/components/ads-manager/AdsDateRangePicker"
import { Button } from "@/components/ui/button"
import { LoadMoreButton } from "@/components/ui/load-more-button"
import { DismissibleBanner } from "@/components/ui/dismissible-banner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AdAccountPill } from "@/components/shared/ad-account-pill"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  IconSearch, IconFolder, IconFolderPlus, IconRefresh,
  IconLoader2, IconPhoto, IconLayoutGrid,
  IconChevronDown, IconPlus, IconCheck, IconDotsVertical,
  IconX, IconTrash, IconArrowLeft,
  IconClipboardList, IconUser, IconAlertCircle,
  IconCloudDownload, IconArrowBackUp,
} from "@tabler/icons-react"
import {
  MediaDetailSheet,
  formatMediaBytes,
  formatMediaDuration,
  formatMediaDate,
  type MediaDetailFile,
} from "@/components/shared/media-detail-sheet"
import type { FolderNode } from "@/lib/portal-media/tree"
import { MetaAssignmentStatus } from "@/components/shared/meta-assignment-status"
import { useMetaAssignmentProgress } from "@/hooks/use-meta-assignment-progress"
import { sortCreativesByLatestAssignment, type PortalMediaItemRow } from "@/lib/creative-media"
import { getRangeToggledIds } from "@/lib/range-selection"
import { formatDateOnly } from "@/lib/local-date-range"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Creative {
  id: string
  user_id: string
  file_name: string
  file_url: string
  media_type: "image" | "video"
  headline?: string
  primary_text?: string
  cta?: string
  link_url?: string
  fb_image_url?: string
  fb_thumbnail_url?: string
  fb_image_hash?: string
  fb_video_id?: string
  tags?: string[]
  created_at?: string
  assigned_at?: string
  ad_account_id?: string
  storage_path?: string
  status?: "pending" | "processing" | "ready" | "error"
  portal_media_items?: PortalMediaItemRow[] | PortalMediaItemRow | null
}

interface Board {
  id: string
  name: string
  description?: string
  asset_count: number
  created_at: string
}

interface CreativeRequest {
  id: string
  title: string
  description?: string
  status: "open" | "in_progress" | "completed" | "cancelled"
  due_date?: string
  created_at: string
}

interface DeleteConfirmState {
  type: "creative" | "board" | "request" | "bulk_creative" | "revert"
  id?: string
  ids?: string[]
  name: string
}

/** The shapes the tree API returns. Type-only imports, so no server module is pulled
 *  into this client bundle — previously these were hand-copied and had already drifted
 *  (the local copy was missing brandId/productId, which the Identifiers block needs). */
type PortalMediaFile = MediaDetailFile
type PortalFolder = FolderNode

interface PortalAssignment {
  object_key: string
  ad_account_id: string
  creative_id: string | null
}

/** How many files render at once. The media resolver allows 120 GET/HEAD per IP per
 *  minute and the whole office shares one IP, so a folder of 114 must not mount at once. */
const PORTAL_PAGE_SIZE = 24

type PortalSortKey = "name" | "brand" | "product" | "language" | "dimensions" | "size" | "approved" | "assigned"
type PortalSort = { key: PortalSortKey; dir: "asc" | "desc" } | null

type AssetSortKey = "name" | "brand" | "product" | "language" | "dimensions" | "type" | "status" | "date"
type AssetSort = { key: AssetSortKey; dir: "asc" | "desc" } | null

// Shared picker presets + "All time" (empty string).

type Section = "all" | "boards" | "requests" | "my-uploads" | "portal" | `board_${string}`

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Formatters live with the shared Media Detail sheet — three copies of formatBytes
// across two files is how "1.5 MB" here and "2 MB" there happens.
const formatDate = (s?: string | null) => formatMediaDate(s)
const formatDuration = formatMediaDuration
const formatBytes = formatMediaBytes

const STATUS_COLORS: Record<CreativeRequest["status"], string> = {
  // Neutral, not blue: "Open" is plain information and blue-as-information is what makes
  // dark mode hard to read. Colour is reserved for the states that need attention.
  open:        "bg-muted text-foreground border border-border",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  completed:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled:   "bg-muted text-muted-foreground",
}
const STATUS_LABEL: Record<CreativeRequest["status"], string> = {
  open: "Open", in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled",
}

/**
 * One row of the asset actions menu. `whitespace-nowrap` is the part that matters: the menu
 * sizes to its widest label instead of wrapping or truncating, which combined with the
 * viewport clamp is what makes every option readable wherever the row sits on screen.
 */
const CONTEXT_MENU_ITEM =
  "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left whitespace-nowrap " +
  "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"

/**
 * The tick boxes in both spreadsheets. Was a bare <div onClick> in four places: no focus
 * ring, no keyboard, and `cursor-pointer` present on two of them and missing on the other
 * two. A real button keeps the look and gets all three for free.
 */
function RowCheckbox({ checked, onToggle, label, className }: {
  checked: boolean
  onToggle: (e: React.MouseEvent<HTMLButtonElement>) => void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onToggle(e) }}
      className={cn(
        "size-4 rounded border flex items-center justify-center shrink-0 cursor-pointer transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        checked ? "bg-primary border-primary" : "border-muted-foreground/30 hover:border-muted-foreground/60",
        className
      )}
    >
      {checked && <IconCheck className="size-2.5 text-primary-foreground" />}
    </button>
  )
}

function SortTh<K extends string>({ label, keyId, sort, onSort }: { label: string; keyId: K; sort: { key: K; dir: "asc" | "desc" } | null; onSort: (key: K) => void }) {
  const active = sort?.key === keyId
  return (
    <button
      type="button"
      onClick={() => onSort(keyId)}
      className="flex items-center gap-1.5 uppercase tracking-wide hover:text-foreground"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span>{label}</span>
      <IconChevronDown className={cn("size-3 transition-transform", !active && "opacity-40", active && sort.dir === "asc" && "rotate-180")} />
    </button>
  )
}

const PortalSortTh = SortTh<PortalSortKey>
const AssetSortTh = SortTh<AssetSortKey>

const ASSETS_FILTER_STATE_KEY = "assets_filters_v1"

interface AssetsFilterState {
  section: Section
  search: string
  filterType: "" | "image" | "video"
  filterStatus: "" | "ready" | "pending"
  filterBrand: string
  filterProduct: string
  filterLanguage: string
  dateRange: string
  dateCustomStart?: string
  dateCustomEnd?: string
  assetFilterAccounts: string[]
  assetSort: AssetSort
  portalPath: string[]
  portalSort: PortalSort
  portalAccountId: string
}

function loadAssetsFilterState(): AssetsFilterState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(ASSETS_FILTER_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AssetsFilterState>
    if (!parsed || typeof parsed !== "object") return null
    return {
      section: typeof parsed.section === "string" ? parsed.section as Section : "all",
      search: typeof parsed.search === "string" ? parsed.search : "",
      filterType: parsed.filterType === "image" || parsed.filterType === "video" ? parsed.filterType : "",
      filterStatus: parsed.filterStatus === "ready" || parsed.filterStatus === "pending" ? parsed.filterStatus : "",
      filterBrand: typeof parsed.filterBrand === "string" ? parsed.filterBrand : "",
      filterProduct: typeof parsed.filterProduct === "string" ? parsed.filterProduct : "",
      filterLanguage: typeof parsed.filterLanguage === "string" ? parsed.filterLanguage : "",
      dateRange: typeof parsed.dateRange === "string" ? parsed.dateRange : "",
      dateCustomStart: typeof parsed.dateCustomStart === "string" && Number.isFinite(new Date(parsed.dateCustomStart).getTime())
        ? parsed.dateCustomStart
        : undefined,
      dateCustomEnd: typeof parsed.dateCustomEnd === "string" && Number.isFinite(new Date(parsed.dateCustomEnd).getTime())
        ? parsed.dateCustomEnd
        : undefined,
      assetFilterAccounts: Array.isArray(parsed.assetFilterAccounts)
        ? parsed.assetFilterAccounts.filter((id): id is string => typeof id === "string")
        : [],
      assetSort: parsed.assetSort && typeof parsed.assetSort === "object" && typeof (parsed.assetSort as AssetSort)?.key === "string"
        ? parsed.assetSort as AssetSort
        : { key: "date", dir: "desc" },
      portalPath: Array.isArray(parsed.portalPath) ? parsed.portalPath.filter((p): p is string => typeof p === "string") : [],
      portalSort: parsed.portalSort && typeof parsed.portalSort === "object" && typeof (parsed.portalSort as PortalSort)?.key === "string"
        ? parsed.portalSort as PortalSort
        : null,
      portalAccountId: typeof parsed.portalAccountId === "string" ? parsed.portalAccountId : "",
    }
  } catch {
    return null
  }
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AssetsPage() {
  const { selectedAccountId, adAccounts } = useAdAccount()
  const searchParams = useSearchParams()
  const urlSearch = searchParams.get("q") || ""
  const [section, setSection]           = useState<Section>("all")
  const [creatives, setCreatives]       = useState<Creative[]>([])
  const [boardCreatives, setBoardCreatives] = useState<Creative[]>([])
  const [portalTree, setPortalTree]      = useState<PortalFolder[]>([])
  const [portalAssignments, setPortalAssignments] = useState<PortalAssignment[]>([])
  const [portalPath, setPortalPath]      = useState<string[]>([])
  const [portalVisible, setPortalVisible] = useState(PORTAL_PAGE_SIZE)
  const [portalSelected, setPortalSelected] = useState<Set<string>>(new Set())
  const [portalAnchorId, setPortalAnchorId] = useState<string | null>(null)
  const [portalSort, setPortalSort] = useState<PortalSort>(null)
  const [assetSort, setAssetSort] = useState<AssetSort>({ key: "date", dir: "desc" })
  const [dateRange, setDateRange] = useState("")
  const [dateCustomStart, setDateCustomStart] = useState<Date | undefined>()
  const [dateCustomEnd, setDateCustomEnd] = useState<Date | undefined>()
  const [portalAccountId, setPortalAccountId] = useState("")
  /**
   * The provider's accounts reshaped for AdAccountPill's `showAccountId`, which reads
   * `account_id`. In this list `id` already *is* the ad account id — the replaced Select rendered
   * it as both name and parenthetical — so this only names the field the pill expects. Memoised
   * because a fresh array each render would defeat the pill's own filter memo.
   */
  const portalPillAccounts = useMemo(
    () => adAccounts.map((a: { id: string; name?: string }) => ({ id: a.id, name: a.name, account_id: a.id })),
    [adAccounts]
  )
  const [assetFilterAccounts, setAssetFilterAccounts] = useState<string[]>([])
  const [filterAccountsOpen, setFilterAccountsOpen] = useState(false)
  const [loadingPortal, setLoadingPortal] = useState(false)
  const [portalError, setPortalError]     = useState("")
  const [portalErrorKind, setPortalErrorKind] = useState<"portal" | "adlauncher" | null>(null)
  const [mappingPortal, setMappingPortal] = useState(false)
  const [assignItems, setAssignItems] = useState<Record<string, string>>({})
  const trackedAssignmentIds = useMemo(
    () => [...new Set([
      ...Object.values(assignItems),
      ...creatives
        .filter(creative => creative.status === "pending" || creative.status === "processing")
        .map(creative => creative.id),
    ])],
    [assignItems, creatives],
  )
  const assignmentProgressById = useMetaAssignmentProgress(trackedAssignmentIds)
  const [portalDetailOpen, setPortalDetailOpen] = useState(false)
  const [portalDetailFile, setPortalDetailFile] = useState<PortalMediaFile | null>(null)

  // undefined = derive the resolver URL from assetId (Portal media);
  // a string = a non-Portal asset's own file_url; null = nothing to view.
  const [portalDetailHref, setPortalDetailHref] = useState<string | null | undefined>(undefined)
  const [portalDetailAssigned, setPortalDetailAssigned] = useState<string[]>([])

  const [importConfirm, setImportConfirm] = useState<
    { count: number; adAccountId: string; label: string; folderPath?: string; objectKeys?: string[] } | null
  >(null)
  const [boards, setBoards]             = useState<Board[]>([])
  const [requests, setRequests]         = useState<CreativeRequest[]>([])
  const [selected, setSelected]         = useState<Set<string>>(new Set())
  const [assetAnchorId, setAssetAnchorId] = useState<string | null>(null)
  const [search, setSearch]             = useState(urlSearch)
  const deferredSearch = useDeferredValue(search)
  const [filterType, setFilterType]     = useState<"" | "image" | "video">("")
  const [filterStatus, setFilterStatus] = useState<"" | "ready" | "pending">("")
  const [filterBrand, setFilterBrand]   = useState<string>("")
  const [filterProduct, setFilterProduct] = useState<string>("")
  const [filterLanguage, setFilterLanguage] = useState<string>("")
  const [filtersHydrated, setFiltersHydrated] = useState(false)
  const clearAssetFilters = useCallback(() => {
    setSearch("")
    setFilterType("")
    setFilterStatus("")
    setFilterBrand("")
    setFilterProduct("")
    setFilterLanguage("")
    setDateRange("")
    setDateCustomStart(undefined)
    setDateCustomEnd(undefined)
    setAssetFilterAccounts([])
  }, [])

  useEffect(() => {
    const stored = loadAssetsFilterState()
    if (stored) {
      setSection(stored.section)
      if (!urlSearch) setSearch(stored.search)
      setFilterType(stored.filterType)
      setFilterStatus(stored.filterStatus)
      setFilterBrand(stored.filterBrand)
      setFilterProduct(stored.filterProduct)
      setFilterLanguage(stored.filterLanguage)
      setDateRange(stored.dateRange)
      setDateCustomStart(stored.dateCustomStart ? new Date(stored.dateCustomStart) : undefined)
      setDateCustomEnd(stored.dateCustomEnd ? new Date(stored.dateCustomEnd) : undefined)
      setAssetFilterAccounts(stored.assetFilterAccounts)
      setAssetSort(stored.assetSort ?? { key: "date", dir: "desc" })
      setPortalPath(stored.portalPath)
      setPortalSort(stored.portalSort)
      setPortalAccountId(stored.portalAccountId)
    }
    setFiltersHydrated(true)
  }, [urlSearch])

  useEffect(() => {
    if (!filtersHydrated) return
    try {
      const next: AssetsFilterState = {
        section,
        search,
        filterType,
        filterStatus,
        filterBrand,
        filterProduct,
        filterLanguage,
        dateRange,
        dateCustomStart: dateCustomStart?.toISOString(),
        dateCustomEnd: dateCustomEnd?.toISOString(),
        assetFilterAccounts,
        assetSort,
        portalPath,
        portalSort,
        portalAccountId,
      }
      window.localStorage.setItem(ASSETS_FILTER_STATE_KEY, JSON.stringify(next))
    } catch { /* quota or private mode */ }
  }, [
    filtersHydrated, section, search, filterType, filterStatus, filterBrand, filterProduct, filterLanguage,
    dateRange, dateCustomStart, dateCustomEnd, assetFilterAccounts, assetSort,
    portalPath, portalSort, portalAccountId,
  ])
  const [loadingCreatives, setLoadingCreatives] = useState(true)
  const [loadingBoards, setLoadingBoards]       = useState(false)
  const [loadingRequests, setLoadingRequests]   = useState(false)
  const [loadingBoard, setLoadingBoard]         = useState(false)
  const [currentUserId, setCurrentUserId]       = useState<string | null>(null)
  const [creativesNextCursor, setCreativesNextCursor] = useState<string | null>(null)
  const [creativesHasMore, setCreativesHasMore]       = useState(false)
  const [loadingMoreCreatives, setLoadingMoreCreatives] = useState(false)
  const [creativeTotal, setCreativeTotal] = useState(0)
  const [assetFacets, setAssetFacets] = useState<{ brands: string[]; products: string[]; languages: string[] }>({
    brands: [], products: [], languages: [],
  })
  const creativeRequestId = useRef(0)
  const CREATIVES_PAGE = 20

  const pollingVideosRef = useRef<Set<string>>(new Set())
  const pollingQueueRef  = useRef<string[]>([])
  const pendingPollIdsRef = useRef<Set<string>>(new Set())
  const MAX_CONCURRENT_POLLS = 3

  // Dialog state
  const [createBoardOpen, setCreateBoardOpen]     = useState(false)
  const [boardName, setBoardName]                 = useState("")
  const [boardDesc, setBoardDesc]                 = useState("")
  const [savingBoard, setSavingBoard]             = useState(false)
  const [boardDialogError, setBoardDialogError]   = useState("")

  const [createReqOpen, setCreateReqOpen]         = useState(false)
  const [reqTitle, setReqTitle]                   = useState("")
  const [reqDesc, setReqDesc]                     = useState("")
  const [reqDue, setReqDue]                       = useState("")
  const [savingReq, setSavingReq]                 = useState(false)

  const [deleteConfirm, setDeleteConfirm]         = useState<DeleteConfirmState | null>(null)
  const [deleting, setDeleting]                   = useState(false)
  const [actionError, setActionError]             = useState("")

  const [addToBoardOpen, setAddToBoardOpen]       = useState(false)
  const [addingToBoard, setAddingToBoard]         = useState<string | null>(null)
  // The trigger's viewport rect, not the cursor — see the clamping effect below.
  const [contextMenu, setContextMenu]             = useState<{ id: string; top: number; bottom: number; right: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Saved searches (localStorage)
  const [savedSearches, setSavedSearches]         = useState<{ label: string; query: string }[]>([])

  const currentBoardId = section.startsWith("board_") ? section.slice(6) : null
  const currentBoard   = boards.find(b => b.id === currentBoardId)

  const applyCreativePreviewUpdate = useCallback((creativeId: string, update: Partial<Creative>) => {
    if (Object.keys(update).length === 0) return
    const patch = (list: Creative[]) =>
      list.map((creative) => creative.id === creativeId ? { ...creative, ...update } : creative)
    setCreatives((prev) => patch(prev))
    setBoardCreatives((prev) => patch(prev))
  }, [])

  const refreshVideoPreview = useCallback(async (creativeId: string, retries = 0, initialDelayMs = 0) => {
    const MAX_RETRIES = 6
    if (retries === 0) {
      if (pollingVideosRef.current.has(creativeId)) return
      // Queue if already at max concurrent polls
      if (pollingVideosRef.current.size >= MAX_CONCURRENT_POLLS) {
        if (!pollingQueueRef.current.includes(creativeId)) {
          pollingQueueRef.current.push(creativeId)
        }
        return
      }
      pollingVideosRef.current.add(creativeId)
      if (initialDelayMs > 0) await new Promise(r => setTimeout(r, initialDelayMs))
    }
    if (retries >= MAX_RETRIES) {
      pollingVideosRef.current.delete(creativeId)
      // Start next queued video
      const next = pollingQueueRef.current.shift()
      if (next) setTimeout(() => refreshVideoPreview(next, 0, 5000), 1000)
      return
    }

    // Defer when tab is hidden — resume on next visibilitychange
    if (document.hidden) {
      const resume = () => {
        document.removeEventListener("visibilitychange", resume)
        if (!document.hidden) refreshVideoPreview(creativeId, retries)
      }
      document.addEventListener("visibilitychange", resume)
      return
    }

    try {
      const response = await fetch(`/api/creatives/${creativeId}/thumbnail`, { method: "POST" })
      const data = await response.json()
      if (data.error || !data.creative) {
        pollingVideosRef.current.delete(creativeId)
        return
      }
      applyCreativePreviewUpdate(creativeId, {
        file_url: data.creative.file_url,
        fb_image_url: data.creative.fb_image_url,
        fb_thumbnail_url: data.creative.fb_thumbnail_url,
        status: data.creative.status,
      })

      if (data.creative.status === "processing") {
        // Progressive backoff: 20s, 25s, 30s, 30s, 30s, 30s
        const delays = [20000, 25000, 30000, 30000, 30000, 30000]
        const delay = delays[Math.min(retries, delays.length - 1)]
        setTimeout(() => refreshVideoPreview(creativeId, retries + 1), delay)
      } else {
        pollingVideosRef.current.delete(creativeId)
        const next = pollingQueueRef.current.shift()
        if (next) setTimeout(() => refreshVideoPreview(next, 0, 5000), 1000)
      }
    } catch {
      pollingVideosRef.current.delete(creativeId)
      const next = pollingQueueRef.current.shift()
      if (next) setTimeout(() => refreshVideoPreview(next, 0, 5000), 1000)
    }
  }, [applyCreativePreviewUpdate])

  const refreshVideoPreviews = useCallback(async (items: Creative[]) => {
    const toRefresh = items.filter((creative) =>
      creative.media_type === "video"
      && creative.fb_video_id
      && !pollingVideosRef.current.has(creative.id)  // skip already-polling
      && (
        creative.status === "processing"
        || !creative.fb_thumbnail_url
        || (
          !/^https?:/.test(creative.fb_thumbnail_url)
          && !creative.fb_thumbnail_url.startsWith("/api/creatives/")
        )
        || creative.fb_thumbnail_url.includes("rsrc.php")
      )
    )

    // Submit all to refreshVideoPreview — it self-limits to MAX_CONCURRENT_POLLS=3
    // and queues the rest automatically
    for (const creative of toRefresh) {
      refreshVideoPreview(creative.id)
    }
  }, [refreshVideoPreview])

  // ── Load helpers ──────────────────────────────────────────────────────────

  const loadCreatives = useCallback((cursor: string | null, reset: boolean) => {
    // Empty assetFilterAccounts = "All ad accounts" (no ad_account_id param => org-wide).
    // Picking one or more accounts narrows the fetch to exactly those accounts.
    if (reset) setLoadingCreatives(true); else setLoadingMoreCreatives(true)
    const requestId = ++creativeRequestId.current
    setActionError("")
    const params = new URLSearchParams({ limit: String(CREATIVES_PAGE), sort: "assigned_desc" })
    for (const id of assetFilterAccounts) params.append("ad_account_id", id)
    if (section === "my-uploads") params.set("user_only", "true")
    if (deferredSearch.trim()) params.set("name_contains", deferredSearch.trim())
    if (filterType) params.set("media_type", filterType)
    if (filterStatus) params.set("readiness", filterStatus)
    if (filterBrand) params.set("brand", filterBrand)
    if (filterProduct) params.set("product", filterProduct)
    if (filterLanguage) params.set("language", filterLanguage)
    if (dateRange) {
      const range = (dateRange === "custom" || dateRange === "maximum") && dateCustomStart && dateCustomEnd
        ? { start: dateCustomStart, end: dateCustomEnd }
        : getPresetRange(dateRange)
      params.set("date_from", formatDateOnly(range.start))
      params.set("date_to", formatDateOnly(range.end))
      params.set("timezone_offset", String(new Date().getTimezoneOffset()))
    }
    if (cursor) params.set("cursor", cursor)
    fetch(`/api/creatives?${params}`)
      .then(r => r.json())
      .then(d => {
        if (requestId !== creativeRequestId.current) return
        if (d.error) throw new Error(d.error)
        const next: Creative[] = d.creatives || []
        setCreatives(prev => reset ? next : [...prev, ...next])
        setCreativesNextCursor(d.nextCursor ?? null)
        setCreativesHasMore(d.hasMore ?? false)
        setCreativeTotal(Number.isFinite(d.total) ? d.total : next.length)
        if (d.facets) setAssetFacets(d.facets)
        refreshVideoPreviews(next)
      })
      .catch((error: unknown) => {
        if (requestId !== creativeRequestId.current) return
        setActionError(error instanceof Error ? error.message : "Failed to load assets")
      })
      .finally(() => {
        if (requestId !== creativeRequestId.current) return
        setLoadingCreatives(false)
        setLoadingMoreCreatives(false)
      })
  }, [refreshVideoPreviews, assetFilterAccounts, section, deferredSearch, filterType, filterStatus, filterBrand, filterProduct, filterLanguage, dateRange, dateCustomStart, dateCustomEnd])

  const loadBoards = useCallback(() => {
    setLoadingBoards(true)
    setActionError("")
    fetch("/api/assets/boards")
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setBoards(d.boards || [])
      })
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : "Failed to load boards")
      })
      .finally(() => setLoadingBoards(false))
  }, [])

  const loadRequests = useCallback(() => {
    setLoadingRequests(true)
    fetch("/api/assets/requests")
      .then(r => r.json())
      .then(d => setRequests(d.requests || []))
      .catch(() => {})
      .finally(() => setLoadingRequests(false))
  }, [])

  const loadPortalTree = useCallback(() => {
    setLoadingPortal(true)
    setPortalError("")
    setPortalErrorKind(null)
    fetch("/api/portal-media/tree")
      .then(async r => ({ status: r.status, ok: r.ok, body: await r.json() }))
      .then(({ status, ok, body }) => {
        if (!ok || body.error) {
          // 502 is the Portal registry itself; anything else is on our side. Saying
          // "Portal is down" when the real cause is a missing local table sends the
          // reader to the wrong system.
          setPortalErrorKind(status === 502 ? "portal" : "adlauncher")
          throw new Error(body.error || "Failed to load Portal media")
        }
        setPortalTree(body.tree || [])
        setPortalAssignments(body.assignments || [])
      })
      .catch((error: unknown) => {
        // Kept out of the shared actionError banner: a failure must read as a failure,
        // not as an empty folder, or the next person quietly goes back to asking
        // Creative for the file over chat.
        setPortalTree([])
        setPortalError(error instanceof Error ? error.message : "Failed to load Portal media")
      })
      .finally(() => setLoadingPortal(false))
  }, [])

  const loadBoardCreatives = useCallback((boardId: string) => {
    setLoadingBoard(true)
    setActionError("")
    fetch(`/api/assets/boards/${boardId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        const nextCreatives = d.creatives || []
        setBoardCreatives(nextCreatives)
        refreshVideoPreviews(nextCreatives)
      })
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : "Failed to load board assets")
      })
      .finally(() => setLoadingBoard(false))
  }, [refreshVideoPreviews])

  // ── Initial loads ─────────────────────────────────────────────────────────

  // Default "All" (empty assetFilterAccounts) means "every ad account in the org".
  // loadCreatives fetches org-wide when no specific accounts are picked.
  useEffect(() => {
    setCreativesNextCursor(null)
    setCreativesHasMore(false)
    loadCreatives(null, true)
  }, [assetFilterAccounts, loadCreatives])

  // Per-item assignment progress. Job rows schedule work, but are deliberately
  // not the display contract: each asset follows its own creative + Meta state.
  useEffect(() => {
    const creativeIds = Object.values(assignItems)
    if (creativeIds.length === 0) return
    const progress = creativeIds.map(id => assignmentProgressById[id])
    if (progress.some(item => !item || item.phase === "assigning" || item.phase === "processing")) return

    loadPortalTree()
    setCreativesNextCursor(null)
    setCreativesHasMore(false)
    loadCreatives(null, true)
    const timer = setTimeout(() => setAssignItems({}), 2000)
    return () => clearTimeout(timer)
  }, [assignItems, assignmentProgressById, loadCreatives, loadPortalTree])

  useEffect(() => { loadBoards() }, [loadBoards])
  useEffect(() => { loadPortalTree() }, [loadPortalTree])

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => setCurrentUserId(d?.user?.id || null))
    const stored = localStorage.getItem("assets_saved_searches")
    if (stored) setSavedSearches(JSON.parse(stored))
  }, [])

  useEffect(() => {
    if (section === "requests" && requests.length === 0) loadRequests()
  }, [section, requests.length, loadRequests])

  // Range anchor is only valid against the currently rendered row order — reset on
  // section switch so a stray anchor from a different list can't produce a bogus range.
  useEffect(() => { setAssetAnchorId(null) }, [section])

  useEffect(() => {
    if (currentBoardId) loadBoardCreatives(currentBoardId)
  }, [currentBoardId, loadBoardCreatives])

  // Close context menu on outside click, or on Escape
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null) }
    document.addEventListener("mousedown", handler)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", handler)
      document.removeEventListener("keydown", onKey)
    }
  }, [])

  /**
   * Keep the row menu inside the viewport.
   *
   * It was positioned with `top: clientY; left: clientX` — the menu's top-left placed at the
   * cursor. The 3-dot trigger is the last column of a full-width table, so the cursor is
   * ~20px from the right edge and a 160px-wide menu extended past it: the labels were cut
   * off mid-word ("Add to Board" → "Ad…"), which reads as missing options rather than an
   * off-screen menu. Rows near the bottom of the list lost their last item the same way.
   *
   * The click handler now records the trigger's rect and this measures the rendered menu, so
   * the clamp works for any option count — the menu grows and shrinks with the row's state
   * (board vs. library, revertible Portal import or not).
   */
  useEffect(() => {
    const el = contextMenuRef.current
    if (!contextMenu || !el) return
    const MARGIN = 8
    const { width, height } = el.getBoundingClientRect()
    // Right-align under the trigger, which is what a menu opened from an end-aligned
    // control should do; fall back to flush-left if the menu is wider than the viewport.
    const left = Math.max(MARGIN, Math.min(contextMenu.right - width, window.innerWidth - width - MARGIN))
    // Flip above the trigger when there is no room below.
    const below = contextMenu.bottom + height + MARGIN <= window.innerHeight
    const top = below
      ? contextMenu.bottom + 4
      : Math.max(MARGIN, contextMenu.top - height - 4)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.visibility = "visible"
    // Focus the first item so the menu is operable from the keyboard, and so Escape has a
    // sensible place to return from.
    el.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [contextMenu])

  // Poll pending videos (fb_video_id=null) until IIFE uploads to Meta
  useEffect(() => {
    const toAdd = creatives.filter(c =>
      c.media_type === "video" &&
      !c.fb_video_id &&
      (c.status === "pending" || c.status === "processing") &&
      !pendingPollIdsRef.current.has(c.id)
    )
    if (toAdd.length === 0) return
    for (const c of toAdd) {
      pendingPollIdsRef.current.add(c.id)
      let retries = 0
      const poll = async () => {
        if (retries >= 24) { pendingPollIdsRef.current.delete(c.id); return }
        try {
          const res = await fetch(`/api/creatives/${c.id}`)
          const data = await res.json()
          const updated = data.creative as Partial<Creative> | undefined
          if (!updated) { retries++; setTimeout(poll, 5000); return }
          const isDone = !!updated.fb_video_id || updated.status === "error" || updated.status === "ready"
          if (isDone) {
            setCreatives(prev => prev.map(x => x.id === c.id ? { ...x, ...updated } : x))
            if (updated.fb_video_id) refreshVideoPreview(c.id, 0, 3000)
            pendingPollIdsRef.current.delete(c.id)
            return
          }
        } catch {}
        retries++
        setTimeout(poll, 5000)
      }
      setTimeout(poll, 5000)
    }
  }, [creatives, refreshVideoPreview])

  // ── Filtering ─────────────────────────────────────────────────────────────

  // Flatten portal tree to map creatives by their object key
  const portalFileMap = useMemo(() => {
    const map = new Map<string, PortalMediaFile>()
    const walk = (folders: PortalFolder[], files: PortalMediaFile[]) => {
      for (const file of files) map.set(file.objectKey, file)
      for (const folder of folders) walk(folder.folders, folder.files)
    }
    walk(portalTree, [])
    return map
  }, [portalTree])

  const resolvePortalMetadata = useCallback((creative: Creative): PortalMediaFile | null => {
    if (!creative.storage_path?.startsWith("r2://pati-videos/")) return null
    const objectKey = creative.storage_path.slice(17) // remove prefix
    const mapMatch = portalFileMap.get(objectKey)
    if (mapMatch) return mapMatch

    const items = creative.portal_media_items
    const dbItem = Array.isArray(items) ? items[0] : items
    if (!dbItem) return null

    return {
      kind: "file",
      assetId: dbItem.portal_asset_id || "",
      objectKey: dbItem.object_key,
      name: dbItem.file_name || creative.file_name,
      mimeType: dbItem.mime_type,
      sizeBytes: dbItem.file_size,
      createdAt: dbItem.portal_created_at,
      fileUrl: creative.file_url,
      brandId: dbItem.brand_id,
      brandName: dbItem.brand_name,
      brandSlug: dbItem.brand_slug,
      productId: dbItem.product_id,
      productName: dbItem.product_name,
      pdpUrl: dbItem.pdp_url,
      salesPageUrl: dbItem.sales_page_url,
      landingUrl: dbItem.landing_url,
      checkoutFunnelUrl: dbItem.checkout_funnel_url,
      language: dbItem.language,
      briefType: dbItem.brief_type,
      voiceVariant: dbItem.voice_variant,
      mediaType: dbItem.media_type,
      width: dbItem.width,
      height: dbItem.height,
      durationSeconds: dbItem.duration_seconds ? Number(dbItem.duration_seconds) : null,
    }
  }, [portalFileMap])


  const availableFilters = assetFacets

  const filterCreatives = useCallback((list: Creative[]) => {
    const q = search.toLowerCase()
    // The account filter is ANY-match (OR): a media item shows when it is assigned to at
    // least one selected account. Empty selection = every account in the org.
    //
    // It is enforced server-side — GET /api/creatives does `.in("ad_account_id", ids)` —
    // so there is deliberately no client-side account predicate here. There used to be an
    // ALL-match (AND) intersection, and it is what made "Hooray 37 + Hooray 52" return
    // nothing:
    //   1. it intersected by storage_path over only the rows loaded so far (page = 20,
    //      cursor-paginated), so two rows for the same asset on different pages never met;
    //   2. it dropped every row with storage_path = null — i.e. all manual and Drive
    //      uploads — the moment a second account was ticked;
    //   3. if either account had no loaded row it returned the empty set outright.
    // See the account-filter cases in tests/assets-account-filter.test.mjs.
    return list.filter(c => {
      if (q && !c.file_name.toLowerCase().includes(q)) return false
      if (filterType && c.media_type !== filterType) return false
      if (filterStatus === "ready" && !(c.fb_image_hash || c.fb_video_id)) return false
      if (filterStatus === "pending" && !!(c.fb_image_hash || c.fb_video_id)) return false

      const pm = resolvePortalMetadata(c)
      if (filterBrand && pm?.brandName !== filterBrand) return false
      if (filterProduct && pm?.productName !== filterProduct) return false
      if (filterLanguage && pm?.language !== filterLanguage) return false

      if (dateRange) {
        const itemDateStr = c.assigned_at || c.created_at
        if (!itemDateStr) return false
        const itemDate = new Date(itemDateStr)
        const { start, end } = (dateRange === "custom" || dateRange === "maximum") && dateCustomStart && dateCustomEnd
          ? { start: dateCustomStart, end: dateCustomEnd }
          : getPresetRange(dateRange)
        const startDay = new Date(start); startDay.setHours(0, 0, 0, 0)
        const endDay = new Date(end); endDay.setHours(23, 59, 59, 999)
        if (itemDate < startDay || itemDate > endDay) return false
      }

      return true
    })
  }, [search, filterType, filterStatus, resolvePortalMetadata, filterBrand, filterProduct, filterLanguage, dateRange, dateCustomStart, dateCustomEnd])

  const displayList = useMemo(() => {
    const filtered = section === "my-uploads"
      ? filterCreatives(creatives.filter(c => c.user_id === currentUserId))
      : currentBoardId
        ? filterCreatives(boardCreatives)
        : filterCreatives(creatives)

    if (!assetSort) {
      return section === "all" ? sortCreativesByLatestAssignment(filtered) : filtered
    }

    const { key, dir } = assetSort
    const sign = dir === "asc" ? 1 : -1

    const val = (c: Creative): string | number => {
      const pm = resolvePortalMetadata(c)
      switch (key) {
        case "name": return c.file_name.toLowerCase()
        case "brand": return (pm?.brandName || "").toLowerCase()
        case "product": return (pm?.productName || "").toLowerCase()
        case "language": return (pm?.language || "").toLowerCase()
        case "dimensions": return (pm?.width || 0) * (pm?.height || 0) || pm?.durationSeconds || 0
        case "type": return c.media_type
        case "status": return c.status || ""
        case "date": return c.assigned_at ? new Date(c.assigned_at).getTime() : c.created_at ? new Date(c.created_at).getTime() : 0
      }
    }

    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va < vb) return -1 * sign
      if (va > vb) return 1 * sign
      return 0
    })
  }, [section, creatives, boardCreatives, currentUserId, currentBoardId, filterCreatives, assetSort, resolvePortalMetadata])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  const adAccountName = adAccounts?.find((a: any) => a.id === selectedAccountId)?.name || selectedAccountId || "—"

  const toggleSelect = (id: string, shiftKey = false, ctrlKey = false) => {
    const { nextSelected, nextAnchorId } = getRangeToggledIds(
      selected,
      displayList.map(c => c.id),
      id,
      assetAnchorId,
      shiftKey,
      ctrlKey
    )
    setSelected(nextSelected)
    setAssetAnchorId(nextAnchorId)
  }
  const selectAll = () => { setSelected(new Set(displayList.map(c => c.id))); setAssetAnchorId(null) }
  const clearSelected = () => { setSelected(new Set()); setAssetAnchorId(null) }
  const allDisplayedSelected = displayList.length > 0 && selected.size === displayList.length

  // ── Portal Media: folder navigation ───────────────────────────────────────

  /** The folder currently open, found by walking the labels in portalPath. */
  const portalCurrent = useMemo(() => {
    let folders = portalTree
    let current: PortalFolder | null = null
    for (const label of portalPath) {
      const next: PortalFolder | undefined = folders.find(f => f.label === label)
      if (!next) break
      current = next
      folders = next.folders
    }
    return current
  }, [portalTree, portalPath])

  const portalFolders = portalCurrent ? portalCurrent.folders : portalTree
  const portalFiles = portalCurrent ? portalCurrent.files : []

  /** ad_account_id set per object key, so a tile can show where it already went. */
  const portalAssignedBy = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const a of portalAssignments) {
      const list = map.get(a.object_key)
      if (list) list.push(a.ad_account_id)
      else map.set(a.object_key, [a.ad_account_id])
    }
    return map
  }, [portalAssignments])

  const cyclePortalSort = (key: PortalSortKey) => setPortalSort(prev => {
    if (!prev || prev.key !== key) return { key, dir: "asc" }
    if (prev.dir === "asc") return { key, dir: "desc" }
    return null
  })

  const sortedPortalFiles = useMemo(() => {
    if (!portalSort) return portalFiles
    const { key, dir } = portalSort
    const sign = dir === "asc" ? 1 : -1
    const val = (f: PortalMediaFile): string | number => {
      switch (key) {
        case "name": return f.name.toLowerCase()
        case "brand": return (f.brandName || "").toLowerCase()
        case "product": return (f.productName || "").toLowerCase()
        case "language": return (f.language || "").toLowerCase()
        case "dimensions": return (f.width || 0) * (f.height || 0) || f.durationSeconds || 0
        case "size": return f.sizeBytes || 0
        case "approved": return f.createdAt ? new Date(f.createdAt).getTime() : 0
        case "assigned": return (portalAssignedBy.get(f.objectKey)?.join(",") || "").toLowerCase()
      }
    }
    return [...portalFiles].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va < vb) return -1 * sign
      if (va > vb) return 1 * sign
      return 0
    })
  }, [portalFiles, portalSort, portalAssignedBy])

  const cycleAssetSort = (key: AssetSortKey) => setAssetSort(prev => {
    if (!prev || prev.key !== key) return { key, dir: "asc" }
    if (prev.dir === "asc") return { key, dir: "desc" }
    return null
  })

  const openPortalFolder = (label: string) => {
    setPortalPath(prev => [...prev, label])
    setPortalVisible(PORTAL_PAGE_SIZE)
    setPortalSelected(new Set())
    setPortalAnchorId(null)
  }
  const gotoPortalCrumb = (index: number) => {
    setPortalPath(prev => prev.slice(0, index))
    setPortalVisible(PORTAL_PAGE_SIZE)
    setPortalSelected(new Set())
    setPortalAnchorId(null)
  }

  const togglePortalSelect = (objectKey: string, shiftKey = false, ctrlKey = false) => {
    const { nextSelected, nextAnchorId } = getRangeToggledIds(
      portalSelected,
      sortedPortalFiles.slice(0, portalVisible).map(f => f.objectKey),
      objectKey,
      portalAnchorId,
      shiftKey,
      ctrlKey
    )
    setPortalSelected(nextSelected)
    setPortalAnchorId(nextAnchorId)
  }
  const clearPortalSelected = () => { setPortalSelected(new Set()); setPortalAnchorId(null) }

  /** Header checkbox acts on the whole folder, not just the rendered page — assigning
   *  costs no resolver requests, so there is no reason to cap it at PORTAL_PAGE_SIZE. */
  const portalAllSelected = portalFiles.length > 0 && portalFiles.every(f => portalSelected.has(f.objectKey))
  const togglePortalSelectAll = () =>
    setPortalSelected(portalAllSelected ? new Set() : new Set(portalFiles.map(f => f.objectKey)))

  const accountLabel = (id: string) => {
    const account = adAccounts.find((a: { id: string; name?: string }) => a.id === id)
    return account?.name || id
  }

  // ── Media Detail sidebar (shared with Portal Vault) ───────────────────────
  // Two entry points, one sheet. A click that landed on the row's own checkbox, a link or
  // a button is that control's click, not the row's.
  const isRowChrome = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    return !!(target.closest('[role="checkbox"]') || target.closest("a") || target.closest("button"))
  }

  /** Portal Media spreadsheet — the registry row is already in hand. */
  const openPortalDetail = (file: PortalMediaFile, e: React.MouseEvent) => {
    if (isRowChrome(e)) return
    setPortalDetailFile(file)
    setPortalDetailHref(undefined)
    setPortalDetailAssigned((portalAssignedBy.get(file.objectKey) || []).map(accountLabel))
    setPortalDetailOpen(true)
  }

  /**
   * All Assets / My Uploads / a board — the row is a `creatives` record.
   *
   * With Portal lineage it shows the full registry metadata. Without it (manual upload,
   * Drive import) the row used to open nothing at all and silently toggled selection
   * instead, which is why the sidebar read as a Portal-only feature. It now opens the same
   * sheet, populated from the fields the creatives row does know; absent Portal fields
   * render as "—" rather than disappearing.
   */
  const openCreativeDetail = (creative: Creative, e: React.MouseEvent) => {
    if (isRowChrome(e)) return

    const portalMeta = resolvePortalMetadata(creative)
    if (portalMeta) {
      setPortalDetailFile(portalMeta)
      setPortalDetailHref(undefined)
      setPortalDetailAssigned((portalAssignedBy.get(portalMeta.objectKey) || []).map(accountLabel))
    } else {
      setPortalDetailFile({
        kind: "file",
        assetId: "",
        objectKey: creative.storage_path || creative.file_name,
        name: creative.file_name,
        mimeType: null,
        sizeBytes: null,
        createdAt: creative.assigned_at || creative.created_at || null,
        fileUrl: creative.file_url || null,
        brandId: null, brandName: null, brandSlug: null,
        productId: null, productName: null,
        pdpUrl: creative.link_url || null,
        salesPageUrl: null, landingUrl: null, checkoutFunnelUrl: null,
        language: null, briefType: null, voiceVariant: null,
        mediaType: creative.media_type,
        width: null, height: null, durationSeconds: null,
      })
      setPortalDetailHref(creative.fb_image_url || creative.file_url || null)
      // A non-Portal creative carries its ad account on the row itself; there is no
      // portal_media_assignments entry to look up.
      setPortalDetailAssigned(creative.ad_account_id ? [accountLabel(creative.ad_account_id)] : [])
    }
    setPortalDetailOpen(true)
  }

  const assignPortalSelection = () => {
    if (portalSelected.size === 0 || !portalAccountId) return
    setImportConfirm({
      count: portalSelected.size,
      adAccountId: portalAccountId,
      label: `${portalSelected.size} selected media`,
      objectKeys: Array.from(portalSelected),
    })
  }

  const assignPortalFolder = (folder: PortalFolder) => {
    if (!portalAccountId) return
    setImportConfirm({
      count: folder.fileCount,
      adAccountId: portalAccountId,
      label: folder.label,
      folderPath: folder.path,
    })
  }

  const executePortalAssign = async () => {
    if (!importConfirm) return
    setMappingPortal(true)
    setPortalError("")
    try {
      const res = await fetch("/api/portal-media/assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_account_id: importConfirm.adAccountId,
          folder_paths: importConfirm.folderPath ? [importConfirm.folderPath] : [],
          object_keys: importConfirm.objectKeys || [],
        }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || "Failed to assign Portal media")
      if (d.errors?.length) {
        setPortalError(`${d.assigned}/${d.requested} assigned — ${d.errors[0].error}`)
      }
      if (Array.isArray(d.items)) {
        setAssignItems(previous => {
          const next = { ...previous }
          for (const item of d.items) {
            if (typeof item?.object_key === "string" && typeof item?.creative_id === "string") {
              next[item.object_key] = item.creative_id
            }
          }
          return next
        })
      }
      clearPortalSelected()
      loadPortalTree()
      // Refresh when this assignment belongs to the current Assets scope. An empty
      // account filter means every org account, not the global account-context choice.
      if (assetFilterAccounts.length === 0 || assetFilterAccounts.includes(importConfirm.adAccountId)) {
        setCreativesNextCursor(null)
        setCreativesHasMore(false)
        loadCreatives(null, true)
      }
      setImportConfirm(null)
    } catch (error: unknown) {
      setPortalError(error instanceof Error ? error.message : "Failed to assign Portal media")
    } finally {
      setMappingPortal(false)
    }
  }

  // ── CRUD: Board ───────────────────────────────────────────────────────────

  const handleCreateBoard = async () => {
    if (!boardName.trim()) return
    setSavingBoard(true)
    setBoardDialogError("")
    setActionError("")
    try {
      const res = await fetch("/api/assets/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: boardName.trim(), description: boardDesc }),
      })
      const d = await res.json()
      if (!res.ok || d.error || !d.board) {
        throw new Error(d.error || "Failed to create board")
      }
      setBoards(prev => [d.board, ...prev])
      setSection(`board_${d.board.id}` as Section)
      setBoardName("")
      setBoardDesc("")
      setCreateBoardOpen(false)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create board"
      setBoardDialogError(message)
      setActionError(message)
    } finally {
      setSavingBoard(false)
    }
  }

  const handleAddToBoard = async (boardId: string) => {
    if (selected.size === 0) return
    setAddingToBoard(boardId)
    setActionError("")
    try {
      const res = await fetch(`/api/assets/boards/${boardId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creative_ids: Array.from(selected) }),
      })
      const d = await res.json()
      if (!res.ok || d.error) {
        throw new Error(d.error || "Failed to add assets to board")
      }
      setAddToBoardOpen(false)
      clearSelected()
      loadBoards()
      if (currentBoardId === boardId) loadBoardCreatives(boardId)
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Failed to add assets to board")
    } finally {
      setAddingToBoard(null)
    }
  }

  const handleRemoveFromBoard = async (creativeId: string) => {
    if (!currentBoardId) return
    setActionError("")
    try {
      const res = await fetch(`/api/assets/boards/${currentBoardId}/assets?creative_id=${creativeId}`, { method: "DELETE" })
      const d = await res.json()
      if (!res.ok || d.error) {
        throw new Error(d.error || "Failed to remove asset from board")
      }
      setBoardCreatives(prev => prev.filter(c => c.id !== creativeId))
      loadBoards()
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Failed to remove asset from board")
    }
  }

  // ── CRUD: Request ─────────────────────────────────────────────────────────

  const handleCreateRequest = async () => {
    if (!reqTitle.trim()) return
    setSavingReq(true)
    const res = await fetch("/api/assets/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: reqTitle.trim(), description: reqDesc, due_date: reqDue || null }),
    })
    const d = await res.json()
    if (d.request) setRequests(prev => [d.request, ...prev])
    setReqTitle(""); setReqDesc(""); setReqDue(""); setCreateReqOpen(false); setSavingReq(false)
  }

  const handleUpdateRequestStatus = async (id: string, status: CreativeRequest["status"]) => {
    await fetch(`/api/assets/requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r))
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setDeleting(true)
    setActionError("")
    const { type, id, ids } = deleteConfirm
    try {
      if (type === "revert") {
        const res = await fetch(`/api/portal-media/assignments?creative_id=${id}`, { method: "DELETE" })
        const d = await res.json()
        if (!res.ok || d.error) throw new Error(d.error || "Failed to revert Portal import")
        setCreatives(prev => prev.filter(c => c.id !== id))
        setBoardCreatives(prev => prev.filter(c => c.id !== id))
        setSelected(prev => {
          const next = new Set(prev)
          if (id) next.delete(id)
          return next
        })
        loadBoards()
      } else if (type === "creative") {
        const res = await fetch(`/api/creatives/${id}`, { method: "DELETE" })
        const d = await res.json()
        if (!res.ok || d.error) throw new Error(d.error || "Failed to delete asset")
        setCreatives(prev => prev.filter(c => c.id !== id))
        setBoardCreatives(prev => prev.filter(c => c.id !== id))
        setSelected(prev => {
          const next = new Set(prev)
          if (id) next.delete(id)
          return next
        })
        loadBoards()
      } else if (type === "bulk_creative") {
        const res = await fetch("/api/creatives", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        })
        const d = await res.json()
        if (!res.ok || d.error) throw new Error(d.error || "Failed to delete selected assets")
        const deletedIds = new Set<string>(d.deletedIds || ids || [])
        setCreatives(prev => prev.filter(c => !deletedIds.has(c.id)))
        setBoardCreatives(prev => prev.filter(c => !deletedIds.has(c.id)))
        clearSelected()
        loadBoards()
      } else if (type === "board") {
        const res = await fetch(`/api/assets/boards/${id}`, { method: "DELETE" })
        const d = await res.json()
        if (!res.ok || d.error) throw new Error(d.error || "Failed to delete board")
        setBoards(prev => prev.filter(b => b.id !== id))
        if (currentBoardId === id) setSection("all")
      } else if (type === "request") {
        const res = await fetch(`/api/assets/requests/${id}`, { method: "DELETE" })
        const d = await res.json()
        if (!res.ok || d.error) throw new Error(d.error || "Failed to delete request")
        setRequests(prev => prev.filter(r => r.id !== id))
      }
      setDeleteConfirm(null)
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Delete failed")
    } finally {
      setDeleting(false)
    }
  }

  // ── Saved searches ────────────────────────────────────────────────────────

  const saveSearch = () => {
    if (!search.trim()) return
    const next = [{ label: search, query: search }, ...savedSearches.filter(s => s.query !== search)].slice(0, 5)
    setSavedSearches(next)
    localStorage.setItem("assets_saved_searches", JSON.stringify(next))
  }

  const removeSavedSearch = (query: string) => {
    const next = savedSearches.filter(s => s.query !== query)
    setSavedSearches(next)
    localStorage.setItem("assets_saved_searches", JSON.stringify(next))
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const isAssetSection = section === "all" || section === "my-uploads" || !!currentBoardId

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left Sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-52 border-r flex flex-col shrink-0 overflow-y-auto bg-sidebar">
        <div className="p-3 space-y-0.5">
          {([
            { id: "all",        icon: IconLayoutGrid,    label: "All Assets",   count: creatives.length },
            { id: "portal",     icon: IconCloudDownload, label: "Portal Media", count: undefined },
            { id: "boards",     icon: IconFolder,        label: "Boards",       count: boards.length },
            { id: "requests",   icon: IconClipboardList, label: "Requests",     count: requests.filter(r => r.status === "open").length || undefined },
            { id: "my-uploads", icon: IconUser,          label: "My Uploads" },
          ] as { id: Section; icon: typeof IconLayoutGrid; label: string; count?: number }[]).map(item => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={cn(
                "flex items-center gap-2.5 w-full px-2.5 py-2 text-sm rounded-md transition-colors",
                section === item.id
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <item.icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.count !== undefined && item.count > 0 && (
                <span className="text-xs bg-muted/80 text-muted-foreground rounded-full px-1.5 py-0.5 leading-none">
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Saved Searches */}
        <div className="px-4 mt-3">
          <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5">Saved Searches</p>
          {savedSearches.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 py-1">No saved searches yet</p>
          ) : savedSearches.map(s => (
            <div key={s.query} className="flex items-center gap-1 group">
              <button
                onClick={() => { setSection("all"); setSearch(s.query) }}
                className="flex-1 text-xs text-left py-1 text-muted-foreground hover:text-foreground truncate"
              >
                {s.label}
              </button>
              <button onClick={() => removeSavedSearch(s.query)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                <IconX className="size-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Boards list */}
        <div className="px-4 mt-4 flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">Boards</p>
            <button onClick={() => setCreateBoardOpen(true)} className="text-muted-foreground hover:text-foreground">
              <IconPlus className="size-3.5" />
            </button>
          </div>
          {loadingBoards ? (
            <div className="py-1"><IconLoader2 className="size-3.5 animate-spin text-muted-foreground/40" /></div>
          ) : boards.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 py-1">No boards yet</p>
          ) : boards.map(b => (
            <button
              key={b.id}
              onClick={() => setSection(`board_${b.id}` as Section)}
              className={cn(
                "flex items-center gap-2 w-full py-1.5 text-xs rounded transition-colors group",
                section === `board_${b.id}` ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <IconFolder className="size-3.5 shrink-0" />
              <span className="flex-1 text-left truncate">{b.name}</span>
              <span className="text-xs opacity-60">{b.asset_count}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {actionError && (
          <div className="mx-4 mt-4 shrink-0">
            <DismissibleBanner onDismiss={() => setActionError("")}>
              <span className="flex items-start gap-2">
                <IconAlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{actionError}</span>
              </span>
            </DismissibleBanner>
          </div>
        )}


        {/* ── Boards Section ─────────────────────────────────────────────── */}
        {section === "boards" && (
          <div className="flex-1 overflow-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Boards</h2>
              <Button size="sm" onClick={() => setCreateBoardOpen(true)}>
                <IconPlus className="size-4" /> New Board
              </Button>
            </div>

            {loadingBoards ? (
              <div className="flex items-center justify-center h-48">
                <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : boards.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
                <div className="size-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                  <IconFolder className="size-8 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="font-medium">No boards yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Create a board to organize your assets</p>
                </div>
                <Button onClick={() => setCreateBoardOpen(true)}>
                  <IconPlus className="size-4" /> Create Board
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {boards.map(b => (
                  <div
                    key={b.id}
                    className="group relative rounded-xl border bg-card hover:shadow-md transition-all cursor-pointer overflow-hidden"
                    onClick={() => setSection(`board_${b.id}` as Section)}
                  >
                    <div className="aspect-video bg-muted/40 flex items-center justify-center">
                      <IconFolder className="size-10 text-muted-foreground/20" />
                    </div>
                    <div className="p-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{b.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{b.asset_count} asset{b.asset_count !== 1 ? "s" : ""}</p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); setDeleteConfirm({ type: "board", id: b.id, name: b.name }) }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                      >
                        <IconTrash className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Requests Section ───────────────────────────────────────────── */}
        {section === "requests" && (
          <div className="flex-1 overflow-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold">Creative Requests</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {requests.filter(r => r.status === "open").length} open request{requests.filter(r => r.status === "open").length !== 1 ? "s" : ""}
                </p>
              </div>
              <Button size="sm" onClick={() => setCreateReqOpen(true)}>
                <IconPlus className="size-4" /> New Request
              </Button>
            </div>

            {loadingRequests ? (
              <div className="flex items-center justify-center h-48">
                <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
                <div className="size-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                  <IconClipboardList className="size-8 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="font-medium">No creative requests yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Create a request to assign creative work to team members.</p>
                </div>
                <Button onClick={() => setCreateReqOpen(true)}>
                  <IconPlus className="size-4" /> New Request
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map(r => (
                  <div key={r.id} className="group flex items-start gap-4 p-4 rounded-xl border bg-card hover:shadow-sm transition-all">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm">{r.title}</p>
                        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_COLORS[r.status])}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </div>
                      {r.description && <p className="text-xs text-muted-foreground line-clamp-2">{r.description}</p>}
                      <p className="text-xs text-muted-foreground/60 mt-1.5">
                        Created {formatDate(r.created_at)}
                        {r.due_date && <> · Due {formatDate(r.due_date)}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Status cycle button */}
                      {r.status !== "completed" && r.status !== "cancelled" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => handleUpdateRequestStatus(r.id, r.status === "open" ? "in_progress" : "completed")}
                        >
                          {r.status === "open" ? "Start" : "Complete"}
                        </Button>
                      )}
                      <button
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                        onClick={() => setDeleteConfirm({ type: "request", id: r.id, name: r.title })}
                      >
                        <IconTrash className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Portal Media Section ─────────────────────────────────────── */}
        {section === "portal" && (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">Portal Media</h2>
                <p className="text-xs text-muted-foreground">Browse media approved by Creative Portal.</p>
              </div>
              <Button size="sm" variant="outline" onClick={loadPortalTree} disabled={loadingPortal}>
                {loadingPortal ? <IconLoader2 className="size-4 animate-spin" /> : <IconRefresh className="size-4" />}
                Refresh
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b shrink-0">
              <button
                onClick={() => gotoPortalCrumb(0)}
                className={cn("text-xs transition-colors", portalPath.length ? "text-muted-foreground hover:text-foreground" : "font-medium text-foreground")}
              >
                Portal
              </button>
              {portalPath.map((label, i) => (
                <span key={label} className="flex items-center gap-2">
                  <span className="text-muted-foreground/50 text-xs">/</span>
                  <button
                    onClick={() => gotoPortalCrumb(i + 1)}
                    className={cn("text-xs transition-colors", i === portalPath.length - 1 ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    {label}
                  </button>
                </span>
              ))}

              <div className="flex-1" />

              {/* Controlled, not provider-backed. `portalAccountId` is the *assignment target* for
                  mapping Portal media into an org's ad account — it is deliberately independent of
                  the app-wide selection, so letting the pill fall through to `useAdAccount()`
                  would make picking a mapping target switch the account for every other page. */}
              <AdAccountPill
                accounts={portalPillAccounts}
                value={portalAccountId}
                onChange={setPortalAccountId}
                showAccountId
                placeholder="Select ad account"
                labelClassName="max-w-[200px]"
                align="end"
                className="h-8"
              />
              {portalSelected.size > 0 && (
                <>
                  <Button size="sm" onClick={assignPortalSelection} disabled={!portalAccountId || mappingPortal}>
                    {mappingPortal ? <IconLoader2 className="size-4 animate-spin" /> : <IconCheck className="size-4" />}
                    Assign {portalSelected.size} media
                  </Button>
                  <Button size="sm" variant="outline" onClick={clearPortalSelected}>Clear</Button>
                </>
              )}
            </div>

            {portalError && (
              <div className="mx-4 mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 shrink-0">
                <p className="text-xs font-medium text-destructive">
                  {portalErrorKind === "portal" ? "Could not connect to Creative Portal" : "AdLauncher-side error"}
                </p>
                <p className="text-[11px] text-destructive/80 mt-0.5 break-words">{portalError}</p>
              </div>
            )}

            <div className="flex-1 overflow-auto px-4 py-4">
              {loadingPortal ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
                </div>
              ) : portalFolders.length === 0 && portalFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                  <div className="size-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                    <IconCloudDownload className="size-7 text-muted-foreground/30" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{portalError ? "Could not load folder" : "No approved media found"}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {portalError
                        ? "Try refreshing. The list is read live from Creative Portal, not from a sync copy."
                        : "Media will appear as soon as Creative approves it — no sync needed."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {portalFolders.length > 0 && (
                    <div className="space-y-2">
                      {portalFolders.map(folder => (
                        <div
                          key={folder.path}
                          className="group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:border-muted-foreground/30 hover:bg-muted/30"
                        >
                          <button onClick={() => openPortalFolder(folder.label)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                            <div className="size-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                              <IconFolder className="size-4.5 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{folder.label}</p>
                              <p className="text-[11px] text-muted-foreground">{folder.fileCount} media</p>
                            </div>
                          </button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            onClick={() => assignPortalFolder(folder)}
                            disabled={!portalAccountId || mappingPortal}
                          >
                            <IconCheck className="size-3.5" /> Assign folder
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {portalFiles.length > 0 && (
                    <>
                      {/* Spreadsheet. No <video>/<img> is mounted here on purpose: the
                          resolver allows 120 GET/HEAD per IP per minute and the office
                          shares one IP, so a 114-row folder rendering thumbnails would
                          burn the whole budget. Preview is one click, via Xem. */}
                      <div className="relative border rounded-xl overflow-hidden">
                        <table data-table="compact" className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/30">
                              <th className="w-8 px-2">
                                <RowCheckbox
                                  checked={portalAllSelected}
                                  label={portalAllSelected ? "Deselect all media" : "Select all media"}
                                  onToggle={togglePortalSelectAll}
                                />
                              </th>
                              <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                                <PortalSortTh label="File name" keyId="name" sort={portalSort} onSort={cyclePortalSort} />
                              </th>
                              <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                                <PortalSortTh label="Brand" keyId="brand" sort={portalSort} onSort={cyclePortalSort} />
                              </th>
                              <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                                <PortalSortTh label="Product" keyId="product" sort={portalSort} onSort={cyclePortalSort} />
                              </th>
                              <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                                <PortalSortTh label="Lang" keyId="language" sort={portalSort} onSort={cyclePortalSort} />
                              </th>
                              <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                                <PortalSortTh label="Dims / Dur" keyId="dimensions" sort={portalSort} onSort={cyclePortalSort} />
                              </th>
                              <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                                <PortalSortTh label="Size" keyId="size" sort={portalSort} onSort={cyclePortalSort} />
                              </th>
                              <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                                <PortalSortTh label="Approved" keyId="approved" sort={portalSort} onSort={cyclePortalSort} />
                              </th>
                              {/* "View media" used to be a column here; it lives in the
                                  Media Detail sidebar now, above File Information. */}
                              <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                                <PortalSortTh label="Assigned" keyId="assigned" sort={portalSort} onSort={cyclePortalSort} />
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedPortalFiles.slice(0, portalVisible).map(file => {
                              const isSelected = portalSelected.has(file.objectKey)
                              const assignedTo = portalAssignedBy.get(file.objectKey) || []
                              const assigningCreativeId = assignItems[file.objectKey]
                              const assigningProgress = assigningCreativeId
                                ? assignmentProgressById[assigningCreativeId]
                                : undefined
                              const isVideo = !file.mimeType?.startsWith("image/")
                              return (
                                <tr
                                  key={file.objectKey}
                                  title={file.objectKey}
                                  className={cn(
                                    "border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/20",
                                    isSelected && "bg-primary/5 hover:bg-primary/10"
                                  )}
                                  onClick={(e) => openPortalDetail(file, e)}
                                >
                                  <td className="px-3">
                                    <RowCheckbox
                                      checked={isSelected}
                                      label={`Select ${file.name}`}
                                      onToggle={(e) => togglePortalSelect(file.objectKey, e.shiftKey, e.ctrlKey || e.metaKey)}
                                    />
                                  </td>
                                  <td className="px-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="size-9 rounded-lg overflow-hidden bg-muted shrink-0">
                                        <CreativeCardMedia
                                          creative={{
                                            id: file.assetId,
                                            file_name: file.name,
                                            file_url: file.fileUrl || "",
                                            media_type: isVideo ? "video" : "image",
                                          }}
                                          className="h-full w-full object-cover"
                                          compact
                                          eager
                                        />
                                      </div>
                                      <span className="text-base font-medium truncate max-w-[220px]">{file.name}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 text-base truncate max-w-[120px] font-medium" title={file.brandName || ""}>{file.brandName || "—"}</td>
                                  <td className="px-3 text-base text-muted-foreground truncate max-w-[180px]" title={file.productName || ""}>{file.productName || "—"}</td>
                                  <td className="px-3 text-sm text-muted-foreground">
                                    {file.language ? (
                                      <span className="bg-muted px-1.5 py-0.5 rounded text-xs uppercase font-semibold">{file.language}</span>
                                    ) : "—"}
                                  </td>
                                  <td className="px-3 text-sm text-muted-foreground font-mono">
                                    {file.width && file.height ? `${file.width}x${file.height}` : "—"}
                                    {file.durationSeconds ? ` • ${formatDuration(file.durationSeconds)}` : ""}
                                  </td>
                                  <td className="px-3 text-sm text-muted-foreground tabular-nums">{formatBytes(file.sizeBytes)}</td>
                                  <td className="px-3 text-sm text-muted-foreground">{formatDate(file.createdAt || undefined)}</td>
                                  <td className="px-3">
                                    {assigningCreativeId && assigningProgress?.phase !== "ready" ? (
                                      <MetaAssignmentStatus progress={assigningProgress} fallbackStatus="pending" />
                                    ) : assignedTo.length > 0 ? (
                                      <span className="text-sm px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                        {assignedTo.map(accountLabel).join(", ")}
                                      </span>
                                    ) : (
                                      <span className="text-sm text-muted-foreground/50">—</span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        <div className="px-4 py-2 text-xs text-muted-foreground border-t bg-muted/10">
                          {Math.min(portalVisible, portalFiles.length)} / {portalFiles.length} media
                        </div>
                      </div>

                      {portalVisible < portalFiles.length && (
                        <LoadMoreButton
                          remaining={portalFiles.length - portalVisible}
                          onClick={() => setPortalVisible(v => v + PORTAL_PAGE_SIZE)}
                          className="pt-1"
                        >
                          {`Show more (${portalFiles.length - portalVisible} media)`}
                        </LoadMoreButton>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Asset Grid (All / My Uploads / Board) ──────────────────────── */}
        {isAssetSection && (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
              {currentBoardId && (
                <button
                  onClick={() => setSection("boards")}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mr-1"
                >
                  <IconArrowLeft className="size-4" />
                </button>
              )}

              {/* Search */}
              <div className="relative flex-1 max-w-sm">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/40" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && saveSearch()}
                  placeholder="Search by name, smart tag or ID..."
                  className="w-full pl-9 pr-8 py-2 text-sm bg-muted/40 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <IconX className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Filters */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Ad Account (multi-select) */}
                <div className="relative">
                  <button
                    type="button"
                    aria-expanded={filterAccountsOpen}
                    onClick={() => setFilterAccountsOpen(o => !o)}
                    className={cn(
                      "flex items-center gap-1 h-8 px-3 text-xs rounded-lg border shadow-sm transition-colors",
                      assetFilterAccounts.length > 0
                        ? "border-primary bg-primary/10 text-link font-semibold shadow"
                        : "border-border bg-background text-foreground/80 hover:text-foreground hover:bg-muted/60"
                    )}
                  >
                    Account {assetFilterAccounts.length > 0 ? `(${assetFilterAccounts.length})` : ""} <IconChevronDown className="size-3" />
                  </button>
                  {filterAccountsOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setFilterAccountsOpen(false)} />
                      <div className="absolute top-full left-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 min-w-[240px] py-1 max-h-72 overflow-y-auto">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={assetFilterAccounts.length === 0}
                          onClick={() => setAssetFilterAccounts([])}
                          className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none text-left",
                            assetFilterAccounts.length === 0 && "text-link font-semibold")}
                        >
                          <span className={cn(
                            "size-3.5 rounded border flex items-center justify-center shrink-0",
                            assetFilterAccounts.length === 0 ? "bg-primary border-primary" : "border-muted-foreground/30"
                          )}>
                            {assetFilterAccounts.length === 0 && <IconCheck className="size-2.5 text-primary-foreground" />}
                          </span>
                          <span className="truncate flex-1">All accounts</span>
                        </button>
                        {adAccounts.map((a: { id: string; name?: string }) => {
                          const isChecked = assetFilterAccounts.includes(a.id)
                          return (
                            <button
                              key={a.id}
                              type="button"
                              role="checkbox"
                              aria-checked={isChecked}
                              onClick={() => {
                                setAssetFilterAccounts(prev => isChecked ? prev.filter(x => x !== a.id) : [...prev, a.id])
                              }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none text-left"
                            >
                              <span className={cn(
                                "size-3.5 rounded border flex items-center justify-center shrink-0",
                                isChecked ? "bg-primary border-primary" : "border-muted-foreground/30"
                              )}>
                                {isChecked && <IconCheck className="size-2.5 text-primary-foreground" />}
                              </span>
                              <span className="truncate flex-1" title={a.name || a.id}>{a.name || a.id}</span>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>

                {/* Type */}
                <div className="relative group">
                  <button className={cn(
                    "flex items-center gap-1 h-8 px-3 text-xs rounded-lg border shadow-sm transition-colors",
                    filterType ? "border-primary bg-primary/10 text-link font-semibold shadow" : "border-border bg-background text-foreground/80 hover:text-foreground hover:bg-muted/60"
                  )}>
                    Type {filterType ? `: ${filterType}` : ""} <IconChevronDown className="size-3" />
                  </button>
                  <div className="absolute top-full left-0 mt-1 z-20 bg-popover border rounded-lg shadow-md p-1 min-w-[120px] hidden group-hover:block group-focus-within:block">
                    {(["", "image", "video"] as const).map(v => (
                      <button key={v} onClick={() => setFilterType(v)}
                        className={cn("w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2",
                          filterType === v && "text-link"
                        )}>
                        {filterType === v && <IconCheck className="size-3" />}
                        {v === "" ? "All" : v.charAt(0).toUpperCase() + v.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Status */}
                <div className="relative group">
                  <button className={cn(
                    "flex items-center gap-1 h-8 px-3 text-xs rounded-lg border shadow-sm transition-colors",
                    filterStatus ? "border-primary bg-primary/10 text-link font-semibold shadow" : "border-border bg-background text-foreground/80 hover:text-foreground hover:bg-muted/60"
                  )}>
                    Status {filterStatus ? `: ${filterStatus}` : ""} <IconChevronDown className="size-3" />
                  </button>
                  <div className="absolute top-full left-0 mt-1 z-20 bg-popover border rounded-lg shadow-md p-1 min-w-[120px] hidden group-hover:block group-focus-within:block">
                    {(["", "ready", "pending"] as const).map(v => (
                      <button key={v} onClick={() => setFilterStatus(v)}
                        className={cn("w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2",
                          filterStatus === v && "text-link"
                        )}>
                        {filterStatus === v && <IconCheck className="size-3" />}
                        {v === "" ? "All" : v.charAt(0).toUpperCase() + v.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Brand */}
                {availableFilters.brands.length > 0 && (
                  <div className="relative group">
                    <button className={cn(
                      "flex items-center gap-1 h-8 px-3 text-xs rounded-lg border shadow-sm transition-colors max-w-[160px]",
                      filterBrand ? "border-primary bg-primary/10 text-link font-semibold shadow" : "border-border bg-background text-foreground/80 hover:text-foreground hover:bg-muted/60"
                    )}>
                      <span className="truncate">Brand {filterBrand ? `: ${filterBrand}` : ""}</span> <IconChevronDown className="size-3 shrink-0" />
                    </button>
                    <div className="absolute top-full left-0 mt-1 z-20 bg-popover border rounded-lg shadow-md p-1 min-w-[140px] max-h-[240px] overflow-y-auto hidden group-hover:block group-focus-within:block">
                      <button onClick={() => setFilterBrand("")}
                        className={cn("w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2",
                          !filterBrand && "text-link"
                        )}>
                        {!filterBrand && <IconCheck className="size-3" />}
                        All Brands
                      </button>
                      {availableFilters.brands.map(brand => (
                        <button key={brand} onClick={() => setFilterBrand(brand)}
                          className={cn("w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2 truncate",
                            filterBrand === brand && "text-link"
                          )}
                          title={brand}
                        >
                          {filterBrand === brand && <IconCheck className="size-3" />}
                          {brand}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Product */}
                {availableFilters.products.length > 0 && (
                  <div className="relative group">
                    <button className={cn(
                      "flex items-center gap-1 h-8 px-3 text-xs rounded-lg border shadow-sm transition-colors max-w-[200px]",
                      filterProduct ? "border-primary bg-primary/10 text-link font-semibold shadow" : "border-border bg-background text-foreground/80 hover:text-foreground hover:bg-muted/60"
                    )}>
                      <span className="truncate">Product {filterProduct ? `: ${filterProduct}` : ""}</span> <IconChevronDown className="size-3 shrink-0" />
                    </button>
                    <div className="absolute top-full left-0 mt-1 z-20 bg-popover border rounded-lg shadow-md p-1 min-w-[180px] max-h-[240px] overflow-y-auto hidden group-hover:block group-focus-within:block">
                      <button onClick={() => setFilterProduct("")}
                        className={cn("w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2",
                          !filterProduct && "text-link"
                        )}>
                        {!filterProduct && <IconCheck className="size-3" />}
                        All Products
                      </button>
                      {availableFilters.products.map(product => (
                        <button key={product} onClick={() => setFilterProduct(product)}
                          className={cn("w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2 truncate",
                            filterProduct === product && "text-link"
                          )}
                          title={product}
                        >
                          {filterProduct === product && <IconCheck className="size-3" />}
                          {product}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Language */}
                {availableFilters.languages.length > 0 && (
                  <div className="relative group">
                    <button className={cn(
                      "flex items-center gap-1 h-8 px-3 text-xs rounded-lg border shadow-sm transition-colors",
                      filterLanguage ? "border-primary bg-primary/10 text-link font-semibold shadow" : "border-border bg-background text-foreground/80 hover:text-foreground hover:bg-muted/60"
                    )}>
                      Language {filterLanguage ? `: ${filterLanguage.toUpperCase()}` : ""} <IconChevronDown className="size-3" />
                    </button>
                    <div className="absolute top-full left-0 mt-1 z-20 bg-popover border rounded-lg shadow-md p-1 min-w-[100px] hidden group-hover:block group-focus-within:block">
                      <button onClick={() => setFilterLanguage("")}
                        className={cn("w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2",
                          !filterLanguage && "text-link"
                        )}>
                        {!filterLanguage && <IconCheck className="size-3" />}
                        All
                      </button>
                      {availableFilters.languages.map(lang => (
                        <button key={lang} onClick={() => setFilterLanguage(lang)}
                          className={cn("w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2 uppercase",
                            filterLanguage === lang && "text-link"
                          )}>
                          {filterLanguage === lang && <IconCheck className="size-3" />}
                          {lang}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Time Filter — shared AdsDateRangePicker */}
                <AdsDateRangePicker
                  preset={dateRange}
                  customStart={dateCustomStart}
                  customEnd={dateCustomEnd}
                  allowAllTime
                  maximumLookbackMonths={null}
                  autoApply
                  onChange={(preset, start, end) => {
                    setDateRange(preset)
                    if (preset === "custom" || preset === "maximum") {
                      setDateCustomStart(start)
                      setDateCustomEnd(end)
                    } else {
                      setDateCustomStart(undefined)
                      setDateCustomEnd(undefined)
                    }
                  }}
                />

                {(search || filterType || filterStatus || filterBrand || filterProduct || filterLanguage || dateRange || assetFilterAccounts.length > 0) && (
                  <button onClick={clearAssetFilters}
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 border rounded-lg">
                    <IconX className="size-3" /> Clear
                  </button>
                )}
              </div>

              {/* Actions */}
              <div className="ml-auto flex items-center gap-2">
                {selected.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                    {!currentBoardId && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddToBoardOpen(true)}>
                        <IconFolderPlus className="size-3.5" /> Add to Board
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirm({
                        type: "bulk_creative",
                        ids: Array.from(selected),
                        name: `${selected.size} selected asset${selected.size > 1 ? "s" : ""}`,
                      })}
                    >
                      <IconTrash className="size-3.5" /> Delete
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={clearSelected}>
                      Deselect
                    </Button>
                  </div>
                )}

                {selected.size === 0 && (
                  <button onClick={selectAll} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50">
                    Select All
                  </button>
                )}

                <button
                  onClick={() => currentBoardId ? loadBoardCreatives(currentBoardId) : loadCreatives(null, true)}
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
                >
                  <IconRefresh className="size-4" />
                </button>
              </div>
            </div>

            {/* Count bar */}
            <div className="px-4 py-2 text-xs text-muted-foreground border-b shrink-0 flex items-center justify-between">
              <span>
                {currentBoardId && currentBoard ? (
                  <span className="font-medium text-foreground">{currentBoard.name}</span>
                ) : section === "my-uploads" ? "My Uploads" : "All Assets"}
                {" — "}{displayList.length} of {currentBoardId ? boardCreatives.length : creativeTotal} assets
              </span>
              {search && (
                <button onClick={saveSearch} className="text-link hover:underline">Save search</button>
              )}
            </div>

            {/* Grid / List content */}
            <div className="flex-1 overflow-auto px-4 py-4">
              {(loadingCreatives || loadingBoard) ? (
                <div className="space-y-2">
                  {[...Array(10)].map((_, i) => <div key={i} className="h-11 rounded-lg bg-muted animate-pulse" />)}
                </div>
              ) : displayList.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                  <div className="size-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                    <IconPhoto className="size-7 text-muted-foreground/30" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {search || filterType || filterStatus ? "No assets match the current filters" : "No assets found"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {search || filterType || filterStatus
                        ? "Clear the active filters to see all assets in this view."
                        : "Media assets sync from Creative Portal — map pending media from Portal Media."}
                    </p>
                  </div>
                  {(search || filterType || filterStatus || filterBrand || filterProduct || filterLanguage || dateRange || assetFilterAccounts.length > 0) ? (
                    <Button size="sm" variant="outline" onClick={clearAssetFilters}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setSection("portal")}>
                      <IconCloudDownload className="size-3.5" /> Portal Media
                    </Button>
                  )}
                </div>
              ) : (
                /* Spreadsheet view — the only view. The grid was removed rather than
                   kept behind a toggle: two renderings of the same list drift, and the
                   table is the one that shows status and date without a hover. */
                <div className="border rounded-xl overflow-hidden">
                  <table data-table="compact" className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="w-8 px-2">
                          {/* `selected.size === displayList.length` alone reads as
                              "all selected" on an empty table, because 0 === 0. */}
                          <RowCheckbox
                            checked={allDisplayedSelected}
                            label={allDisplayedSelected ? "Deselect all assets" : "Select all assets"}
                            onToggle={() => allDisplayedSelected ? clearSelected() : selectAll()}
                          />
                        </th>
                        <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                          <AssetSortTh label="Name" keyId="name" sort={assetSort} onSort={cycleAssetSort} />
                        </th>
                        <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                          <AssetSortTh label="Brand" keyId="brand" sort={assetSort} onSort={cycleAssetSort} />
                        </th>
                        <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                          <AssetSortTh label="Product" keyId="product" sort={assetSort} onSort={cycleAssetSort} />
                        </th>
                        <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                          <AssetSortTh label="Lang" keyId="language" sort={assetSort} onSort={cycleAssetSort} />
                        </th>
                        <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                          <AssetSortTh label="Dims / Dur" keyId="dimensions" sort={assetSort} onSort={cycleAssetSort} />
                        </th>
                        <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                          <AssetSortTh label="Type" keyId="type" sort={assetSort} onSort={cycleAssetSort} />
                        </th>
                        <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                          <AssetSortTh label="Status" keyId="status" sort={assetSort} onSort={cycleAssetSort} />
                        </th>
                        <th className="px-3 text-left text-sm font-bold text-muted-foreground uppercase tracking-wide">
                          <AssetSortTh label="Date Assigned" keyId="date" sort={assetSort} onSort={cycleAssetSort} />
                        </th>
                        <th className="w-8 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayList.map(c => {
                        const isSelected = selected.has(c.id)
                        const isReady = c.status === "ready"
                          || (c.media_type === "image" && Boolean(c.fb_image_hash))
                        const assignmentProgress = assignmentProgressById[c.id]
                        const portalMeta = resolvePortalMetadata(c)
                        return (
                          <tr
                            key={c.id}
                            className={cn(
                              "border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/20",
                              isSelected && "bg-primary/5 hover:bg-primary/10"
                            )}
                            /* Every row opens the Media Detail sidebar now. It used to
                               open only for Portal-backed rows and silently toggle
                               selection for the rest — same cursor, two behaviours.
                               Selection stays on the checkbox cell. */
                            onClick={(e) => openCreativeDetail(c, e)}
                          >
                            <td className="px-3">
                              <RowCheckbox
                                checked={isSelected}
                                label={`Select ${c.file_name}`}
                                onToggle={(e) => toggleSelect(c.id, e.shiftKey, e.ctrlKey || e.metaKey)}
                              />
                            </td>
                            <td className="px-3">
                              <div className="flex items-center gap-3">
                                <div className="size-9 rounded-lg overflow-hidden bg-muted shrink-0">
                                  <CreativeCardMedia creative={c} className="h-full w-full object-cover" compact eager />
                                </div>
                                <span className="text-base font-medium truncate max-w-[200px]">{c.file_name}</span>
                              </div>
                            </td>
                            <td className="px-3 text-base truncate max-w-[120px] font-medium" title={portalMeta?.brandName || ""}>{portalMeta?.brandName || "—"}</td>
                            <td className="px-3 text-base text-muted-foreground truncate max-w-[180px]" title={portalMeta?.productName || ""}>{portalMeta?.productName || "—"}</td>
                            <td className="px-3 text-sm text-muted-foreground">
                              {portalMeta?.language ? (
                                <span className="bg-muted px-1.5 py-0.5 rounded text-xs uppercase font-semibold">{portalMeta.language}</span>
                              ) : "—"}
                            </td>
                            <td className="px-3 text-sm text-muted-foreground font-mono">
                              {portalMeta?.width && portalMeta?.height ? `${portalMeta.width}x${portalMeta.height}` : "—"}
                              {portalMeta?.durationSeconds ? ` • ${formatDuration(portalMeta.durationSeconds)}` : ""}
                            </td>
                            <td className="px-3 text-sm text-muted-foreground capitalize">{c.media_type}</td>
                            <td className="px-3">
                              <MetaAssignmentStatus
                                progress={assignmentProgress}
                                fallbackStatus={c.status}
                                ready={isReady}
                              />
                            </td>
                            <td className="px-3 text-sm text-muted-foreground">{formatDate(c.assigned_at || c.created_at)}</td>
                            <td className="px-3">
                              <button
                                type="button"
                                aria-haspopup="menu"
                                aria-expanded={contextMenu?.id === c.id}
                                aria-label={`Actions for ${c.file_name}`}
                                onClick={e => {
                                  e.stopPropagation()
                                  const r = e.currentTarget.getBoundingClientRect()
                                  setContextMenu({ id: c.id, top: r.top, bottom: r.bottom, right: r.right })
                                }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <IconDotsVertical className="size-3.5" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="px-4 py-2 text-xs text-muted-foreground border-t bg-muted/10">
                    {displayList.length} row{displayList.length !== 1 ? "s" : ""}
                  </div>
                </div>
              )}

              {/* Load More — only show for "all" and "my-uploads" sections, not boards */}
              {!currentBoardId && creativesHasMore && (
                <LoadMoreButton
                  loading={loadingMoreCreatives}
                  loaded={creatives.length}
                  onClick={() => loadCreatives(creativesNextCursor, false)}
                  className="pt-2 pb-1"
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Context Menu ─────────────────────────────────────────────────── */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label="Asset actions"
          // Rendered hidden at 0,0 and moved by the clamping effect once its real size is
          // known. Without `visibility: hidden` the menu would paint at the origin for one
          // frame before jumping to the trigger.
          style={{ top: 0, left: 0, visibility: "hidden" }}
          className="fixed z-50 bg-popover border rounded-lg shadow-lg py-1 min-w-[180px] max-w-[calc(100vw-1rem)]"
        >
          {!currentBoardId ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setSelected(new Set([contextMenu.id])); setAddToBoardOpen(true); setContextMenu(null) }}
                className={CONTEXT_MENU_ITEM}
              >
                <IconFolderPlus className="size-4 shrink-0 text-muted-foreground" /> Add to Board
              </button>
              <div className="h-px bg-border my-1" />
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => { handleRemoveFromBoard(contextMenu.id); setContextMenu(null) }}
                className={CONTEXT_MENU_ITEM}
              >
                <IconFolder className="size-4 shrink-0 text-muted-foreground" /> Remove from Board
              </button>
              <div className="h-px bg-border my-1" />
            </>
          )}
          {(() => {
            const c = creatives.find(x => x.id === contextMenu.id) || boardCreatives.find(x => x.id === contextMenu.id)
            const isPortalSourced = c?.storage_path?.startsWith("r2://pati-videos/creative-portal/")
            const canRevert = isPortalSourced && !c?.fb_video_id && !c?.fb_image_hash
            if (!canRevert) return null
            return (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDeleteConfirm({ type: "revert", id: contextMenu.id, name: c?.file_name || "this asset" })
                  setContextMenu(null)
                }}
                className={CONTEXT_MENU_ITEM}
              >
                <IconArrowBackUp className="size-4 shrink-0 text-muted-foreground" /> Revert Portal Import
              </button>
            )
          })()}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const c = creatives.find(x => x.id === contextMenu.id) || boardCreatives.find(x => x.id === contextMenu.id)
              setDeleteConfirm({ type: "creative", id: contextMenu.id, name: c?.file_name || "this asset" })
              setContextMenu(null)
            }}
            className={cn(CONTEXT_MENU_ITEM, "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10")}
          >
            <IconTrash className="size-4 shrink-0" /> Delete
          </button>
        </div>
      )}

      {/* ── Add to Board Dialog ───────────────────────────────────────────── */}
      <Dialog open={addToBoardOpen} onOpenChange={setAddToBoardOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to Board</DialogTitle>
          </DialogHeader>
          {boards.length === 0 ? (
            <div className="py-4 text-center">
              <p className="text-sm text-muted-foreground mb-3">No boards yet. Create one first.</p>
              <Button size="sm" onClick={() => { setAddToBoardOpen(false); setCreateBoardOpen(true) }}>
                <IconPlus className="size-4" /> Create Board
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5 py-2 max-h-64 overflow-y-auto">
              {boards.map(b => (
                <button
                  key={b.id}
                  onClick={() => handleAddToBoard(b.id)}
                  disabled={!!addingToBoard}
                  className="w-full flex items-center justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <IconFolder className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{b.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{b.asset_count}</span>
                    {addingToBoard === b.id && <IconLoader2 className="size-3.5 animate-spin" />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Create Board Dialog ───────────────────────────────────────────── */}
      <Dialog
        open={createBoardOpen}
        onOpenChange={(open) => {
          setCreateBoardOpen(open)
          if (!open) setBoardDialogError("")
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Board</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="board-name">Board Name</Label>
              <Input
                id="board-name"
                value={boardName}
                onChange={e => setBoardName(e.target.value)}
                placeholder="e.g. Summer Campaign"
                onKeyDown={e => e.key === "Enter" && handleCreateBoard()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="board-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="board-desc" value={boardDesc} onChange={e => setBoardDesc(e.target.value)} placeholder="What's this board for?" />
            </div>
            {boardDialogError && (
              <DismissibleBanner onDismiss={() => setBoardDialogError("")}>
                <span className="flex items-start gap-2">
                  <IconAlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{boardDialogError}</span>
                </span>
              </DismissibleBanner>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateBoardOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateBoard} disabled={!boardName.trim() || savingBoard}>
              {savingBoard ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlus className="size-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create Request Dialog ─────────────────────────────────────────── */}
      <Dialog open={createReqOpen} onOpenChange={setCreateReqOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Creative Request</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="req-title">Title</Label>
              <Input
                id="req-title"
                value={reqTitle}
                onChange={e => setReqTitle(e.target.value)}
                placeholder="e.g. Product video for June sale"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <textarea
                id="req-desc"
                value={reqDesc}
                onChange={e => setReqDesc(e.target.value)}
                placeholder="Describe what you need..."
                rows={3}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-due">Due Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="req-due" type="date" value={reqDue} onChange={e => setReqDue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateReqOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateRequest} disabled={!reqTitle.trim() || savingReq}>
              {savingReq ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlus className="size-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ─────────────────────────────────────────── */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {deleteConfirm?.type === "revert"
                ? "Revert Portal Import"
                : `Delete ${deleteConfirm?.type === "creative"
                  ? "Asset"
                  : deleteConfirm?.type === "board"
                    ? "Board"
                    : deleteConfirm?.type === "bulk_creative"
                      ? "Selected Assets"
                      : "Request"}`
              }?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            {deleteConfirm?.type === "revert" ? (
              <>
                Are you sure you want to revert the import of <span className="font-medium text-foreground">&quot;{deleteConfirm?.name}&quot;</span>?
                This will remove the creative and return the asset to the Portal Media pool.
              </>
            ) : (
              <>
                Are you sure you want to delete <span className="font-medium text-foreground">&quot;{deleteConfirm?.name}&quot;</span>?
                {deleteConfirm?.type === "creative" && " This will also remove it from any boards."}
                {deleteConfirm?.type === "bulk_creative" && " Each asset will also be removed from any boards."}
                {deleteConfirm?.type === "board" && " The assets inside will not be deleted."}
                {" "}This action cannot be undone.
              </>
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant={deleteConfirm?.type === "revert" ? "default" : "destructive"}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : deleteConfirm?.type === "revert" ? (
                <IconArrowBackUp className="size-4" />
              ) : (
                <IconTrash className="size-4" />
              )}
              {deleteConfirm?.type === "revert" ? "Revert" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Import Confirm Dialog ─────────────────────────────────────────── */}
      <Dialog open={!!importConfirm} onOpenChange={(open) => !open && setImportConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Map media to ad account</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Map <span className="font-medium text-foreground">{importConfirm?.count}</span> media in{" "}
            <span className="font-medium text-foreground">{importConfirm?.label}</span> to{" "}
            <span className="font-medium text-foreground">{importConfirm ? accountLabel(importConfirm.adAccountId) : ""}</span>?
            <br /><br />
            <span className="font-semibold text-destructive">Note: once mapped, this cannot be reverted after the asset is uploaded to Meta.</span> You are responsible for ensuring this media complies with Meta advertising policies.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportConfirm(null)} disabled={mappingPortal}>
              Cancel
            </Button>
            <Button onClick={executePortalAssign} disabled={mappingPortal}>
              {mappingPortal ? <IconLoader2 className="size-4 animate-spin" /> : <IconCheck className="size-4" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    
      {/* Detail Sheet — the one shared implementation (Portal Vault is the source of
          truth). Both the All Assets table and the Portal Media spreadsheet open this. */}
      <MediaDetailSheet
        open={portalDetailOpen}
        onOpenChange={setPortalDetailOpen}
        file={portalDetailFile}
        assignedTo={portalDetailAssigned}
        viewMediaHref={portalDetailHref}
      />

    </div>
  )
}
