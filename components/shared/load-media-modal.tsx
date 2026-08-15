import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { cn, proxyFbImage } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  IconSearch, IconX, IconUpload, IconFolder, IconFolderOpen,
  IconRefresh, IconLayoutGrid, IconTable, IconTrash, IconSettings, IconStack2,
  IconLoader2, IconPhoto, IconVideo, IconMinus, IconPlayerPlay,
  IconChevronDown, IconChevronUp, IconCheck, IconCircleCheck, IconClipboard, IconDots,
  IconCalendar,
  IconBrandGoogleDrive, IconBrandMeta as IconMetaBadge,
  IconArrowsSort
} from "@tabler/icons-react"
import {
  MediaDetailSheet,
  formatMediaDuration,
  type MediaDetailFile,
} from "@/components/shared/media-detail-sheet"
import type { FolderNode } from "@/lib/portal-media/tree"
import { Creative } from "@/types/creative"
import { DynamicMediaToggle } from "@/components/ui/dynamic-media-toggle"
import { CreativeCardMedia } from "@/components/creative-card-media"
import { formatNumberShort, formatCurrency } from "@/lib/format"
import { MetaAssignmentStatus } from "@/components/shared/meta-assignment-status"
import { useMetaAssignmentProgress } from "@/hooks/use-meta-assignment-progress"
import { getRangeToggledIds } from "@/lib/range-selection"

// ─── Drive Link Tab ───────────────────────────────────────────────────────────

// ─── Drive Link Tab ───────────────────────────────────────────────────────────

function DriveLinkTab({ gdriveToken, onRequestAuth, adAccountId, onImported }: {
  gdriveToken: string | null
  onRequestAuth: () => void
  adAccountId: string
  onImported: (creatives: Creative[]) => void
}) {
  const [links, setLinks] = useState("")
  const [includeSubfolders, setIncludeSubfolders] = useState(false)
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<{ name: string; status: "importing" | "done" | "error"; error?: string }[]>([])

  const extractFileId = (url: string): { id: string; type: "file" | "folder" } | null => {
    const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
    if (fileMatch) return { id: fileMatch[1], type: "file" }
    const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
    if (folderMatch) return { id: folderMatch[1], type: "folder" }
    // drive.google.com/open?id=... or /uc?id=... or any ?id= / &id= param
    const openMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
    if (openMatch) return { id: openMatch[1], type: "file" }
    return null
  }

  const handleViewContents = async () => {
    const urls = links.split("\n").map(l => l.trim()).filter(Boolean)
    if (urls.length === 0) return
    setImporting(true)
    setResults([])
    const newCreatives: Creative[] = []

    const items = urls.map(url => {
      const parsed = extractFileId(url)
      if (!parsed) {
        setResults(p => [...p, { name: url, status: "error", error: "Invalid Drive URL" }])
        return null
      }
      return { ...parsed, label: url }
    }).filter(Boolean) as { id: string; type: "file" | "folder"; label: string }[]

    try {
      const resolveRes = await fetch("/api/google/drive/resolve-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, includeSubfolders }),
      })
      const resolved = await resolveRes.json()

      if (resolveRes.status === 401 || resolved.connected === false) {
        onRequestAuth()
        throw new Error("Google Drive is not connected. Reconnect Google Drive and try again.")
      }
      if (!resolveRes.ok) throw new Error(resolved.error || "Failed to resolve Google Drive links")

      ;(resolved.errors || []).forEach((err: { name: string; error: string }) => {
        setResults(p => [...p, { name: err.name, status: "error", error: err.error }])
      })

      const files = (resolved.files || []) as { id: string; name: string; mimeType: string }[]
      if (files.length === 0) {
        setResults(p => p.length ? p : [...p, { name: "Google Drive links", status: "error", error: "No image or video files found" }])
      } else {
        let cursor = 0
        const concurrency = 2
        const importOne = async (file: { id: string; name: string; mimeType: string }) => {
          setResults(p => [...p, { name: file.name, status: "importing" }])
          try {
            const res = await fetch("/api/google/import-drive", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fileId: file.id, fileName: file.name, mimeType: file.mimeType, adAccountId }),
            })
            const d = await res.json()
            if (!res.ok) throw new Error(d.error || "Import failed")
            newCreatives.push(d.creative)
            setResults(p => p.map(r => r.name === file.name && r.status === "importing" ? { name: file.name, status: "done" } : r))
          } catch (e: any) {
            setResults(p => p.map(r => r.name === file.name && r.status === "importing" ? { name: file.name, status: "error", error: e.message } : r))
          }
        }

        const worker = async () => {
          while (cursor < files.length) {
            const index = cursor++
            await importOne(files[index])
          }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
      }
    } catch (e: any) {
      setResults(p => [...p, { name: "Google Drive", status: "error", error: e.message }])
    }

    if (newCreatives.length > 0) onImported(newCreatives)
    setImporting(false)
  }

  return (
    <div className="flex-1 flex flex-col p-6 gap-4 overflow-y-auto">
      <div>
        <h3 className="text-sm font-semibold mb-1">Import from Google Drive</h3>
        <p className="text-xs text-muted-foreground">
          Paste <strong>one or multiple</strong> Google Drive links below. When using multiple links,{" "}
          <strong>put each link on a separate line</strong> to batch import from multiple folders.
        </p>
      </div>
      <textarea
        value={links}
        onChange={e => setLinks(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); handleViewContents() } }}
        rows={5}
        placeholder={"https://drive.google.com/drive/folders/...\nhttps://drive.google.com/file/d/...\nhttps://drive.google.com/drive/folders/..."}
        className="w-full px-3 py-2.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring resize-none font-mono placeholder:text-muted-foreground/40"
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <IconFolderOpen className="size-4 text-muted-foreground" />
          Include files from subfolders
          <button
            role="switch"
            onClick={() => setIncludeSubfolders(v => !v)}
            className={cn("relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors",
              includeSubfolders ? "bg-primary" : "bg-muted")}
          >
            <span className={cn("pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform",
              includeSubfolders ? "translate-x-4" : "translate-x-0")} />
          </button>
        </label>
        <Button
          onClick={handleViewContents}
          disabled={!links.trim() || importing}
          className="gap-2 bg-[#4285F4] hover:bg-[#3574E2] text-white px-6"
        >
          <IconFolderOpen className="size-4" />
          {importing ? "Importing..." : "View Contents"}
          {!importing && <span className="text-xs opacity-70 ml-1">Ctrl↵</span>}
        </Button>
      </div>
      {results.length > 0 && (
        <div className="space-y-1.5">
          {results.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-muted/30 border">
              {r.status === "done"
                ? <IconCheck className="size-3.5 text-green-500 shrink-0" />
                : r.status === "importing"
                  ? <IconLoader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />
                  : <IconX className="size-3.5 text-destructive shrink-0" />
              }
              <span className={cn("truncate flex-1", r.status === "importing" && "text-muted-foreground")}>{r.name}</span>
              {r.status === "importing" && <span className="text-muted-foreground shrink-0">Importing…</span>}
              {r.error && <span className="text-destructive shrink-0">{r.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Load Media Modal ─────────────────────────────────────────────────────────

interface FbMediaItem { id: string; fb_id: string; name: string; media_type: "image" | "video"; duration?: number | null; width?: number; height?: number; dimensions?: string | null; date_added?: string; status?: string | null; thumbnail_url?: string; fb_video_id?: string; fb_image_hash?: string; fb_image_url?: string }
interface DriveFileItem { id: string; name: string; mimeType: string; thumbnailLink?: string; iconLink?: string; size?: string; modifiedTime?: string }
interface AdAccountItem { id: string; name: string; account_id?: string }

// Portal catalog shapes, straight from lib/portal-media/tree.ts. `import type` erases at
// compile time, so nothing from that module — including its server-only Supabase import —
// reaches this client bundle. These used to be hand-copied structural clones and had
// already drifted: the copy was missing `mediaType`.
type PortalMediaFile = MediaDetailFile
type PortalFolder = FolderNode

// ─── Load Media Modal ─────────────────────────────────────────────────────────

type MediaTab = "library" | "vault" | "existing" | "gdrive" | "drive_browser" | "drive_link" | "integrations"
type SortField = "name" | "ad_id" | "brand" | "product" | "language" | "dimensions" | "duration" | "date" | "status" | "user" | "workspace"
type SortDir = "asc" | "desc"

interface ExistingAdRow {
  id: string
  name: string
  status: string
  effective_status: string
  date_created: string
  page_name?: string
  page_id?: string
  post_id?: string
  post_url?: string
  link?: string
  thumb_url?: string
  image_hash?: string
  video_id?: string
  media_type: "image" | "video" | "unknown"
  spend: number
  impressions: number
  results: number
  roas: number
  platform: string
}
type ExistingSortField = "name" | "page" | "date" | "status" | "spend" | "roas" | "results" | "impressions"
const DATE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7d", label: "Last 7 days" },
  { value: "last_14d", label: "Last 14 days" },
  { value: "last_30d", label: "Last 30 days" },
  { value: "last_90d", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "maximum", label: "Maximum" },
]
const EXISTING_COLUMNS = [
  { key: "page", label: "Page" },
  { key: "date", label: "Date Created" },
  { key: "post", label: "Post" },
  { key: "status", label: "Status" },
  { key: "platform", label: "Platform" },
  { key: "spend", label: "Spend" },
  { key: "roas", label: "ROAS" },
  { key: "results", label: "Results" },
  { key: "impressions", label: "Impressions" },
]

// Upload queue constants — shared by handleUpload inside LoadMediaModal
const UPLOAD_CONCURRENCY = 3   // max parallel image uploads

export function LoadMediaModal({
  open, onClose, adAccountId, adAccounts, alreadySelected, onConfirm, refreshSignal, tabs,
}: {
  open: boolean; onClose: () => void; adAccountId: string
  adAccounts?: AdAccountItem[]
  alreadySelected: Set<string>; onConfirm: (ids: string[], creatives: Creative[], existingAdSources?: Record<string, { adId: string; postId: string }>) => void
  // Increment from parent to force re-fetch (e.g. after a new upload completes)
  refreshSignal?: number
  // Restrict which tabs render; defaults to all tabs
  tabs?: MediaTab[]
}) {
  // ── Existing Ads tab state ──────────────────────────────────────
  const [existingAds, setExistingAds] = useState<ExistingAdRow[]>([])
  const [existingLoading, setExistingLoading] = useState(false)
  const [existingError, setExistingError] = useState<string>("")
  const existingAbortRef = useRef<AbortController | null>(null)
  const [existingAfter, setExistingAfter] = useState<string>("")
  const [existingHasMore, setExistingHasMore] = useState(false)
  const [existingSearch, setExistingSearch] = useState("")
  const [existingDatePreset, setExistingDatePreset] = useState("last_30d")
  const [existingActiveOnly, setExistingActiveOnly] = useState(false)
  const [existingActiveAdSetOnly, setExistingActiveAdSetOnly] = useState(false)
  const [existingSortField, setExistingSortField] = useState<ExistingSortField>("spend")
  const [existingSortDir, setExistingSortDir] = useState<SortDir>("desc")
  const [existingSelected, setExistingSelected] = useState<Set<string>>(new Set())
  const [existingColumnsOpen, setExistingColumnsOpen] = useState(false)
  const [existingMetricsOpen, setExistingMetricsOpen] = useState(false)
  const [existingDateOpen, setExistingDateOpen] = useState(false)
  const [existingAccountId, setExistingAccountId] = useState(adAccountId)
  const [existingAccountOpen, setExistingAccountOpen] = useState(false)
  const [existingFilterOpen, setExistingFilterOpen] = useState(false)
  /**
   * Open-state for the footer's Include picker (Creatives only / Full ad config / Ad settings
   * only), which is a real control. The Existing Ads toolbar used to hold a *second* dropdown
   * also labelled "Include" — three checkboxes with no handler — sharing this same state. That
   * one is gone; two controls with one label and one of them inert is not a labelling problem
   * worth keeping.
   */
  const [existingIncludeOpen, setExistingIncludeOpen] = useState(false)
  const [existingIncludeMode, setExistingIncludeMode] = useState<"creatives" | "full" | "ad_settings">("creatives")
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(["page", "date", "post", "status", "platform", "spend", "roas", "results", "impressions"])
  )
  const [allCreatives, setAllCreatives] = useState<Creative[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [mediaTab, setMediaTab] = useState<MediaTab>(() => {
    const allowed = tabs && tabs.length > 0 ? tabs : (["vault", "library", "existing", "gdrive", "drive_browser", "drive_link", "integrations"] as MediaTab[])
    return allowed.includes("vault") ? "vault" : allowed[0]
  })
  const libThumbRetryCounts = useRef<Map<string, number>>(new Map())
  // Client-side cache: avoid re-fetching creatives if modal reopened within 90s
  const creativesCache = useRef<{ accountId: string; data: Creative[]; at: number } | null>(null)
  const CREATIVES_CACHE_TTL = 90_000
  // FB Media Library (from Facebook ad account)
  const [fbMedia, setFbMedia] = useState<FbMediaItem[]>([])
  const [fbMediaLoading, setFbMediaLoading] = useState(false)
  const [fbMediaLoaded, setFbMediaLoaded] = useState(false)
  const [fbMediaHasMore, setFbMediaHasMore] = useState(false)
  const [fbMediaError, setFbMediaError] = useState<string | null>(null)
  const [fbMediaSaving, setFbMediaSaving] = useState(false)
  const [fbMediaTypeFilter, setFbMediaTypeFilter] = useState<"all" | "image" | "video">("all")
  const [fbMediaSort, setFbMediaSort] = useState<{ field: string; dir: "asc" | "desc" }>({ field: "date", dir: "desc" })
  const FB_MEDIA_PAGE = 20
  const [selected, setSelected] = useState<Set<string>>(new Set(alreadySelected))
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  // Range anchor is only valid against the currently rendered row order — reset on
  // tab switch so a stray anchor from library/vault's differing lists can't leak in.
  useEffect(() => { setSelectionAnchorId(null) }, [mediaTab])
  /**
   * Filter chip values. `uploader`, `channels`, `workspace` and `source` used to sit here too;
   * they had no options and no predicate, so the keys went with the chips — leaving them would
   * leave `ClearFiltersButton` resetting fields nothing can set.
   */
  const [filters, setFilters] = useState<{
    status: string; fileType: string; dimensions: string; dateAdded: string
    brand: string; product: string; language: string
  }>({
    status: "all", fileType: "all", dimensions: "all", dateAdded: "all",
    brand: "all", product: "all", language: "all",
  })
  // Portal catalog, flattened by object key — joined against fbMedia/allCreatives via
  // storage_path/fb_video_id so Portal-sourced media shows brand/product/dims here too.
  const [portalTree, setPortalTree] = useState<PortalFolder[]>([])
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>("date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const [moreOpen, setMoreOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null)
  const [uploadPauseMsg, setUploadPauseMsg] = useState<string | null>(null)
  const uploadFileRef = useRef<HTMLInputElement>(null)
  const uploadFolderRef = useRef<HTMLInputElement>(null)

  // ── Google Drive state ──────────────────────────────────────────
  // Short-lived memory cache — server is the source of truth for refresh tokens
  const GDRIVE_LS_KEY = "gdrive_token_cache"
  const loadCachedToken = (): string | null => {
    try {
      const raw = localStorage.getItem(GDRIVE_LS_KEY)
      if (!raw) return null
      const { token, expiresAt } = JSON.parse(raw)
      if (Date.now() > expiresAt) { localStorage.removeItem(GDRIVE_LS_KEY); return null }
      return token
    } catch { return null }
  }
  const saveCachedToken = (token: string) => {
    localStorage.setItem(GDRIVE_LS_KEY, JSON.stringify({ token, expiresAt: Date.now() + 55 * 60 * 1000 }))
  }
  const clearCachedToken = () => localStorage.removeItem(GDRIVE_LS_KEY)

  const [gdriveEmail, setGdriveEmail] = useState<string | null>(null)

  const [gdriveToken, setGdriveToken] = useState<string | null>(() => loadCachedToken())
  const [gdriveQueue, setGdriveQueue] = useState<{ id: string; name: string; mimeType: string; status: "pending" | "importing" | "done" | "error"; error?: string }[]>([])
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([])
  const [driveFilesLoading, setDriveFilesLoading] = useState(false)
  const [selectedDriveFileIds, setSelectedDriveFileIds] = useState<Set<string>>(new Set())
  const [gdriveImporting, setGdriveImporting] = useState(false)
  const [gdriveError, setGdriveError] = useState<string | null>(null)
  const gdriveTokenRef = useRef<string | null>(loadCachedToken())
  const gdriveScriptsReady = useRef(false)

  useEffect(() => {
    if (!open || !adAccountId) return
    setSelected(new Set(alreadySelected))
    setAllCreatives([])
    creativesCache.current = null
    fetchCreatives(true)
    setFbMediaLoaded(false)
    setFbMedia([])
    // Fetch the Portal catalog once per open — used to enrich both creatives and
    // FB media with brand/product/dimensions when they originated in Portal.
    fetch("/api/portal-media/tree")
      .then(r => r.ok ? r.json() : null)
      .then(d => setPortalTree(d?.tree || []))
      .catch(() => setPortalTree([]))
  }, [open, adAccountId])

  // Load FB media when library tab is active
  useEffect(() => {
    if (!open || mediaTab !== "library" || fbMediaLoaded || fbMediaLoading) return
    fetchFbMedia()
  }, [open, mediaTab, adAccountId])

  // Vault tab uses allCreatives from fetchCreatives(true)

  // Auto-load persistent Google Drive token from server when gdrive or drive_link tab opens
  useEffect(() => {
    if (!open || (mediaTab !== "gdrive" && mediaTab !== "drive_link")) return
    if (gdriveTokenRef.current) return
    fetch("/api/google/token")
      .then(r => r.json())
      .then(d => {
        if (d.connected && d.token) {
          gdriveTokenRef.current = d.token
          setGdriveToken(d.token)
          saveCachedToken(d.token)
          if (d.email) setGdriveEmail(d.email)
        }
      })
      .catch(e => console.warn("[gdrive] token preload failed:", e))
  }, [open, mediaTab])

  // Preload Google scripts when modal opens so they're ready before user clicks
  useEffect(() => {
    if (!open || gdriveScriptsReady.current) return
    const loadScript = (src: string) => new Promise<void>((resolve) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
      const s = document.createElement("script")
      s.src = src; s.async = true; s.onload = () => resolve(); s.onerror = () => resolve()
      document.head.appendChild(s)
    })
    Promise.all([
      loadScript("https://apis.google.com/js/api.js"),
      loadScript("https://accounts.google.com/gsi/client"),
    ]).then(() => { gdriveScriptsReady.current = true })
  }, [open])

  // Re-fetch when parent signals new upload completed — always force-refresh cache
  useEffect(() => {
    if (!open || !adAccountId || !refreshSignal) return
    creativesCache.current = null
    fetchCreatives(true)
  }, [refreshSignal])

  // Polling for missing thumbnails in Library tab (max 12 retries per video ~2min)
  useEffect(() => {
    if (!open || mediaTab !== "library" || allCreatives.length === 0) return
    const MAX_RETRIES = 12
    const pending = allCreatives.filter(c =>
      c.media_type === "video"
      && !!(c as any).fb_video_id
      && (!c.fb_thumbnail_url || !/^https?:/.test(c.fb_thumbnail_url) || c.fb_thumbnail_url.includes("rsrc.php"))
      && (libThumbRetryCounts.current.get(c.id) ?? 0) < MAX_RETRIES
    )
    if (pending.length === 0) return

    const tick = async () => {
      if (document.hidden) return  // pause when tab is not visible
      const toCheck = pending.slice(0, 2)
      for (const c of toCheck) {
        libThumbRetryCounts.current.set(c.id, (libThumbRetryCounts.current.get(c.id) ?? 0) + 1)
        try {
          const res = await fetch(`/api/creatives/${c.id}/thumbnail`, { method: "POST" })
          const data = await res.json()
          if (data.thumbnail_url || data.source_url) {
            setAllCreatives(prev => prev.map(x =>
              x.id === c.id
                ? { ...x, fb_thumbnail_url: data.thumbnail_url || x.fb_thumbnail_url, file_url: data.source_url || x.file_url || data.thumbnail_url }
                : x
            ))
          }
        } catch {}
      }
    }

    const interval = setInterval(tick, 30000)
    // Resume immediately when user returns to this tab (don't wait up to 30s)
    const onVisible = () => { if (!document.hidden) tick() }
    document.addEventListener("visibilitychange", onVisible)

    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible) }
  }, [open, mediaTab, allCreatives])

  // Sync existing ads ad-account when prop changes
  useEffect(() => {
    if (open) setExistingAccountId(adAccountId)
  }, [open, adAccountId])

  // Auto-fetch existing ads when entering tab or filter changes
  useEffect(() => {
    if (!open || mediaTab !== "existing" || !existingAccountId) return
    fetchExistingAds(true)
  }, [open, mediaTab, existingAccountId, existingDatePreset, existingActiveOnly, existingActiveAdSetOnly])

  const fetchExistingAds = async (reset: boolean) => {
    // Cancel previous in-flight request when filter changes
    existingAbortRef.current?.abort()
    const ctrl = new AbortController()
    existingAbortRef.current = ctrl

    setExistingLoading(true)
    setExistingError("")
    try {
      const params = new URLSearchParams({
        ad_account_id: existingAccountId,
        date_preset: existingDatePreset,
        limit: "50",
      })
      if (existingActiveOnly) params.set("active_only", "1")
      if (existingActiveAdSetOnly) params.set("active_adset_only", "1")
      if (!reset && existingAfter) params.set("after", existingAfter)
      console.log(`[existing-ads] fetch reset=${reset} preset=${existingDatePreset} activeOnly=${existingActiveOnly}`)
      const res = await fetch(`/api/facebook/existing-ads?${params}`, { signal: ctrl.signal })
      const d = await res.json()
      if (!res.ok) {
        setExistingError(d.error || "Failed to load")
        if (reset) setExistingAds([])
      } else {
        setExistingAds(prev => reset ? (d.ads || []) : [...prev, ...(d.ads || [])])
        setExistingAfter(d.paging?.after || "")
        setExistingHasMore(!!d.paging?.after)
        if (reset) setExistingSelected(new Set())
      }
    } catch (e: any) {
      if (e.name === "AbortError") return // silently ignore cancelled requests
      setExistingError(e.message)
    }
    setExistingLoading(false)
  }

  const filteredExisting = existingAds.filter(a =>
    !existingSearch || a.name.toLowerCase().includes(existingSearch.toLowerCase()) || a.id.includes(existingSearch)
  )
  const sortedExisting = [...filteredExisting].sort((a, b) => {
    const dir = existingSortDir === "asc" ? 1 : -1
    switch (existingSortField) {
      case "name": return a.name.localeCompare(b.name) * dir
      case "page": return (a.page_name || "").localeCompare(b.page_name || "") * dir
      case "date": return (new Date(a.date_created).getTime() - new Date(b.date_created).getTime()) * dir
      case "status": return a.effective_status.localeCompare(b.effective_status) * dir
      case "spend": return (a.spend - b.spend) * dir
      case "roas": return (a.roas - b.roas) * dir
      case "results": return (a.results - b.results) * dir
      case "impressions": return (a.impressions - b.impressions) * dir
      default: return 0
    }
  })

  const toggleExisting = (id: string) => {
    setExistingSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  const toggleExistingSort = (f: ExistingSortField) => {
    if (existingSortField === f) setExistingSortDir(d => d === "asc" ? "desc" : "asc")
    else { setExistingSortField(f); setExistingSortDir("desc") }
  }

  const handleSelectExistingAds = () => {
    const selected = existingAds.filter(a => existingSelected.has(a.id))
    const picked = selected.filter(a => a.post_id)

    if (picked.length !== selected.length) {
      setExistingError(`${selected.length - picked.length} selected ad${selected.length - picked.length === 1 ? " has" : "s have"} no post to reuse`)
    } else {
      setExistingError("")
    }

    if (!picked.length) return

    const existingAdSources = Object.fromEntries(picked.map(a => [
      `existing_${a.id}`,
      { adId: a.id, postId: a.post_id! },
    ]))
    const creatives: Creative[] = picked.map(a => ({
      id: `existing_${a.id}`,
      file_name: a.name,
      file_url: a.thumb_url || "",
      media_type: a.media_type === "video" ? "video" : "image",
      headline: "",
      primary_text: "",
      cta: "LEARN_MORE",
      link_url: a.link || "",
      fb_image_url: a.thumb_url,
      fb_thumbnail_url: a.thumb_url,
      fb_image_hash: a.image_hash,
      fb_video_id: a.video_id,
      created_at: a.date_created,
    }))
    onConfirm(picked.map(a => `existing_${a.id}`), creatives, existingAdSources)
    onClose()
  }

  // ── Google Drive Picker ──────────────────────────────────────────
  const loadGoogleScript = (src: string) => new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement("script")
    s.src = src; s.async = true
    s.onload = () => resolve(); s.onerror = reject
    document.head.appendChild(s)
  })

  const openGoogleDrivePicker = async () => {
    setGdriveError(null)
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ""
    const googleProjectNumber = clientId.split("-")[0] || ""

    if (!clientId) {
      setGdriveError("Missing Google Client ID in environment variables")
      return
    }

    // If scripts not preloaded yet, load them now (fallback)
    if (!gdriveScriptsReady.current) {
      await Promise.all([
        loadGoogleScript("https://apis.google.com/js/api.js"),
        loadGoogleScript("https://accounts.google.com/gsi/client"),
      ])
      gdriveScriptsReady.current = true
    }

    try {

    // 1. Check server for stored refresh token (persistent connection)
    if (!gdriveTokenRef.current) {
      const serverRes = await fetch("/api/google/token")
      if (serverRes.ok) {
        const serverData = await serverRes.json()
        if (serverData.connected && serverData.token) {
          gdriveTokenRef.current = serverData.token
          setGdriveToken(serverData.token)
          saveCachedToken(serverData.token)
          if (serverData.email) setGdriveEmail(serverData.email)
        }
      }
    }

    // 2. If still no token, request auth via Authorization Code flow (gets refresh token)
    const getToken = () => new Promise<string>((resolve, reject) => {
      const cc = (window as any).google.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/drive.readonly",
        ux_mode: "popup",
        // Force the consent screen every time so Google always returns a refresh_token.
        // Without this, returning users (who already granted access) get no refresh_token
        // → /api/google/connect rejects with "No refresh_token returned".
        prompt: "consent",
        callback: async (resp: any) => {
          if (resp.error) {
            console.error("[gdrive] code client error:", resp)
            reject(new Error(resp.error_description || resp.error))
            return
          }
          try {
            const connectRes = await fetch("/api/google/connect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: resp.code }),
            })
            const connectData = await connectRes.json()
            if (!connectRes.ok) {
              console.error("[gdrive] connect failed:", connectRes.status, connectData)
              reject(new Error(connectData.error || `Connect failed (${connectRes.status})`))
              return
            }
            // Fetch fresh token from server
            const tokenRes = await fetch("/api/google/token")
            const tokenData = await tokenRes.json()
            if (!tokenData.token) { reject(new Error("No token returned")); return }
            gdriveTokenRef.current = tokenData.token
            setGdriveToken(tokenData.token)
            saveCachedToken(tokenData.token)
            if (tokenData.email) setGdriveEmail(tokenData.email)
            resolve(tokenData.token)
          } catch (e: any) { reject(e) }
        },
      })
      cc.requestCode()
    })

    const token = gdriveTokenRef.current || await getToken()

    setDriveFilesLoading(true)
    const filesRes = await fetch("/api/google/drive/files?limit=50")
    const filesData = await filesRes.json()
    if (!filesRes.ok) throw new Error(filesData.error || "Failed to load Google Drive files")
    if (!filesData.connected) throw new Error("Google Drive is not connected")
    setDriveFiles(filesData.files || [])
    setSelectedDriveFileIds(new Set())
    setMediaTab("gdrive")
    setDriveFilesLoading(false)
    return

    await new Promise<void>(resolve => (window as any).gapi.load("picker", resolve))

    // Radix Dialog sets pointer-events:none on body — override while Picker is open
    document.body.style.pointerEvents = "auto"

    const P = (window as any).google.picker
    const picker = new P.PickerBuilder()
      .addView(
        new P.DocsView()
          .setIncludeFolders(true)
          .setMimeTypes("image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/x-msvideo")
      )
      .addView(new P.DocsView(P.ViewId.DOCS_IMAGES_AND_VIDEOS))
      .setOAuthToken(token)
      .setOrigin(window.location.origin)
      .setAppId(googleProjectNumber)
      .enableFeature(P.Feature.MULTISELECT_ENABLED)
      .setCallback(async (data: any) => {
        // Restore pointer-events when picker is dismissed or files picked
        if (data.action === P.Action.CANCEL || data.action === P.Action.PICKED) {
          document.body.style.pointerEvents = ""
        }
        if (data.action !== P.Action.PICKED) return
        const files = data.docs as { id: string; name: string; mimeType?: string }[]
        const queue = files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType || "", status: "pending" as const }))
        setGdriveQueue(queue)
        setGdriveImporting(true)

        // Snapshot of creatives before import (used to reconstruct full list after parallel imports)
        const creativesBefore = [...allCreatives]
        const newImported: Creative[] = []

        // Parallel imports — all files download+upload simultaneously instead of one by one.
        // Each handler uses functional state updates to avoid race conditions.
        await Promise.allSettled(files.map(async (f, i) => {
          setGdriveQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: "importing" } : q))
          try {
            let fileName = f.name
            let mimeType = f.mimeType
            if (!mimeType) {
              const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?fields=id,name,mimeType`, {
                headers: { Authorization: `Bearer ${token}` },
              })
              const meta = await metaRes.json()
              if (!metaRes.ok) throw new Error(meta.error?.message || "Failed to get file info")
              fileName = meta.name || fileName
              mimeType = meta.mimeType
            }
            const res = await fetch("/api/google/import-drive", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accessToken: token,
                fileId: f.id,
                fileName,
                mimeType,
                adAccountId,
              }),
            })
            const d = await res.json()
            if (!res.ok) throw new Error(d.error || "Import failed")
            const creative: Creative = d.creative
            newImported.push(creative)
            setAllCreatives(prev => [creative, ...prev.filter(c => c.id !== creative.id)])
            setSelected(prev => new Set([...prev, creative.id]))
            setGdriveQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: "done" } : q))
          } catch (err: any) {
            setGdriveQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: "error", error: err.message } : q))
          }
        }))
        setGdriveImporting(false)

        // Auto-confirm and close if files were imported successfully.
        if (newImported.length > 0) {
          // Reconstruct full creatives list from snapshot + newly imported
          const newAllCreatives = [
            ...newImported,
            ...creativesBefore.filter(c => !newImported.find(n => n.id === c.id)),
          ]
          setTimeout(() => {
            setSelected(prev => {
              const finalSelectedIds = Array.from(prev)
              const selectedObjects = newAllCreatives.filter(c => prev.has(c.id))
              Promise.resolve().then(() => {
                onConfirm(finalSelectedIds, selectedObjects)
                onClose()
              })
              return prev
            })
          }, 800)
        }
      })
      .build()
    picker.setVisible(true)
    } catch (err: any) {
      console.error("[gdrive] openGoogleDrivePicker failed:", err)
      document.body.style.pointerEvents = ""
      setDriveFilesLoading(false)
      const msg = err.message || "Google Drive connection failed"
      setGdriveError(msg)
    }
  }

  const importGoogleDriveFiles = async (files: DriveFileItem[]) => {
    if (files.length === 0) return

    const token = gdriveTokenRef.current
    if (!token) {
      setGdriveError("Google Drive is not connected")
      return
    }

    setGdriveError(null)
    setGdriveQueue(files.map(file => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      status: "pending" as const,
    })))
    setGdriveImporting(true)

    const creativesBefore = [...allCreatives]
    const selectedBefore = new Set(selected)
    const imported: Creative[] = []
    let errorCount = 0
    let cursor = 0
    const concurrency = 2

    const importOne = async (file: DriveFileItem, index: number) => {
      setGdriveQueue(prev => prev.map((q, i) => i === index ? { ...q, status: "importing" } : q))
      try {
        const res = await fetch("/api/google/import-drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: token,
            fileId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            adAccountId,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Import failed")

        const creative: Creative = data.creative
        imported.push(creative)
        setAllCreatives(prev => [creative, ...prev.filter(c => c.id !== creative.id)])
        setSelected(prev => new Set([...prev, creative.id]))
        setGdriveQueue(prev => prev.map((q, i) => i === index ? { ...q, status: "done" } : q))
      } catch (err: any) {
        errorCount += 1
        setGdriveQueue(prev => prev.map((q, i) => i === index
          ? { ...q, status: "error", error: err.message || "Import failed" }
          : q
        ))
      }
    }

    const worker = async () => {
      while (cursor < files.length) {
        const index = cursor++
        await importOne(files[index], index)
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
    setGdriveImporting(false)

    if (imported.length > 0) {
      const importedFileNames = new Set(imported.map(c => c.file_name))
      setSelectedDriveFileIds(prev => {
        const next = new Set(prev)
        files.forEach(file => {
          if (importedFileNames.has(file.name)) next.delete(file.id)
        })
        return next
      })
    }

    if (imported.length > 0 && errorCount === 0) {
      const newAllCreatives = [
        ...imported,
        ...creativesBefore.filter(c => !imported.some(n => n.id === c.id)),
      ]
      const finalSelectedIds = Array.from(new Set([...Array.from(selectedBefore), ...imported.map(c => c.id)]))
      const selectedObjects = newAllCreatives.filter(c => finalSelectedIds.includes(c.id))
      setTimeout(() => {
        onConfirm(finalSelectedIds, selectedObjects)
        onClose()
      }, 800)
    }
  }

  const fetchCreatives = (forceRefresh = false) => {
    const cached = creativesCache.current
    if (!forceRefresh && cached && cached.accountId === adAccountId && (Date.now() - cached.at) < CREATIVES_CACHE_TTL) {
      console.log(`[creatives] client cache HIT (${Math.round((Date.now() - cached.at) / 1000)}s old) account=${adAccountId}`)
      setAllCreatives(cached.data)
      return
    }
    setLoading(true)
    fetch(`/api/creatives?ad_account_id=${encodeURIComponent(adAccountId)}&limit=200`)
      .then(r => r.json())
      .then(d => {
        const list: Creative[] = d.creatives || []
        creativesCache.current = { accountId: adAccountId, data: list, at: Date.now() }
        console.log(`[creatives] fetched count=${list.length} total=${d.total ?? "?"} hasMore=${d.hasMore}`)
        setAllCreatives(list)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const deleteFbMedia = async (ids: string[]) => {
    if (ids.length === 0) return
    const label = ids.length === 1 ? "1 item" : `${ids.length} items`
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return
    try {
      const res = await fetch("/api/creatives", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Delete failed"); return }
      setFbMedia(prev => prev.filter(m => !ids.includes(m.id)))
      setSelected(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next })
    } catch { alert("Delete failed") }
  }

  const fetchFbMedia = (append = false) => {
    if (!adAccountId) return
    setFbMediaLoading(true)
    setFbMediaError(null)
    const offset = append ? fbMedia.length : 0
    fetch(`/api/facebook/ad-media?ad_account_id=${encodeURIComponent(adAccountId)}&limit=${FB_MEDIA_PAGE}&offset=${offset}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setFbMediaError(d.error); return }
        const incoming: FbMediaItem[] = d.media || []
        setFbMedia(prev => append ? [...prev, ...incoming] : incoming)
        setFbMediaHasMore(incoming.length === FB_MEDIA_PAGE)
        setFbMediaLoaded(true)
      })
      .catch(() => setFbMediaError("Failed to load media"))
      .finally(() => setFbMediaLoading(false))
  }

  const dimsOf = (c: Creative) => (c as any).dimensions || (c.media_type === "video" ? "9:16" : "1:1")
  const durationOf = (c: Creative) => (c as any).duration || (c.media_type === "video" ? "0:30" : "—")
  const uploaderOf = (c: Creative) => (c as any).uploader || (c as any).user_email || "—"
  const workspaceOf = (c: Creative) => (c as any).workspace_id || "—"

  // Flatten portal tree to a key→file map by object_key, plus a fb_video_id→file
  // index so FB media (which carries no storage_path) can still resolve Portal
  // metadata through the matching Creative.
  const portalByKey = useMemo(() => {
    const map = new Map<string, PortalMediaFile>()
    const walk = (folders: PortalFolder[]) => {
      for (const f of folders) { for (const file of f.files) map.set(file.objectKey, file); walk(f.folders) }
    }
    walk(portalTree)
    return map
  }, [portalTree])

  const resolveCreativePortal = useCallback((c: Creative): PortalMediaFile | null => {
    if (!c.storage_path?.startsWith("r2://pati-videos/")) return null
    return portalByKey.get(c.storage_path.slice(17)) || null
  }, [portalByKey])

  // Build dynamic chip options from data
  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean)))
  const filterOptions = {
    status:     uniq(fbMedia.map(m => typeof m.status === "object" ? (m.status as any)?.value : m.status)) as string[],
    fileType:   ["image", "video"],
    dimensions: uniq(fbMedia.map(m => {
      if (m.dimensions) return m.dimensions
      if (m.width && m.height) {
        const g = (a: number, b: number): number => b === 0 ? a : g(b, a % b)
        const d = g(m.width, m.height)
        return `${m.width / d}:${m.height / d}`
      }
      return null
    })) as string[],
    dateAdded:  ["today", "week", "month", "year"],
    brand:      uniq(allCreatives.map(c => resolveCreativePortal(c)?.brandName)) as string[],
    product:    uniq(allCreatives.map(c => resolveCreativePortal(c)?.productName)) as string[],
    language:   uniq(allCreatives.map(c => resolveCreativePortal(c)?.language)) as string[],
  }

  // Media Library uses fbMedia (from Facebook ad account)
  // Duration/size formatting lives with the shared Media Detail sheet — three copies of
  // formatBytes across two files is how "1.5 MB" here and "2 MB" there happens.
  const fmtDuration = formatMediaDuration
  const fmtDims = (m: FbMediaItem) => {
    if (m.dimensions) return m.dimensions
    if (m.width && m.height) {
      const g = (a: number, b: number): number => b === 0 ? a : g(b, a % b)
      const d = g(m.width, m.height)
      return `${m.width / d}:${m.height / d}`
    }
    return m.media_type === "video" ? "9:16" : "—"
  }

  // Portal Vault: only creatives with real Portal lineage (imported from Portal
  // Media, i.e. storage_path resolves into the Portal registry) — manual uploads
  // live in Media Library / All Assets, not here. Keeps the two tabs MECE.
  const filteredVault = allCreatives.filter(c => {
    const pm = resolveCreativePortal(c)
    if (!pm) return false
    const matchSearch = !search || c.file_name.toLowerCase().includes(search.toLowerCase())
    if (!matchSearch) return false
    if (filters.brand !== "all" && pm?.brandName !== filters.brand) return false
    if (filters.product !== "all" && pm?.productName !== filters.product) return false
    if (filters.language !== "all" && pm?.language !== filters.language) return false
    if (filters.dateAdded !== "all" && c.created_at) {
      const ms = Date.now() - new Date(c.created_at).getTime()
      const day = 86400000
      if (filters.dateAdded === "today" && ms > day) return false
      if (filters.dateAdded === "week" && ms > 7 * day) return false
      if (filters.dateAdded === "month" && ms > 30 * day) return false
      if (filters.dateAdded === "year" && ms > 365 * day) return false
    }
    return true
  })

  const vaultSorted = [...filteredVault].sort((a, b) => {
    let va: any, vb: any
    switch (sortField) {
      case "name": va = a.file_name; vb = b.file_name; break
      case "brand":
        va = resolveCreativePortal(a)?.brandName || "";
        vb = resolveCreativePortal(b)?.brandName || "";
        break
      case "product":
        va = resolveCreativePortal(a)?.productName || "";
        vb = resolveCreativePortal(b)?.productName || "";
        break
      case "language":
        va = resolveCreativePortal(a)?.language || "";
        vb = resolveCreativePortal(b)?.language || "";
        break
      case "dimensions":
        va = resolveCreativePortal(a)?.width || 0;
        vb = resolveCreativePortal(b)?.width || 0;
        break
      case "duration":
        va = resolveCreativePortal(a)?.durationSeconds || 0;
        vb = resolveCreativePortal(b)?.durationSeconds || 0;
        break
      // assigned_at (when this Portal asset was claimed for the ad account) is what
      // "most recently assigned" means — created_at is only a fallback for creatives
      // that predate the assignments join (e.g. manual uploads).
      case "date": va = a.assigned_at || a.created_at || ""; vb = b.assigned_at || b.created_at || ""; break
      case "status": va = a.status || ""; vb = b.status || ""; break
      default: va = a.assigned_at || a.created_at || ""; vb = b.assigned_at || b.created_at || ""; break
    }
    if (typeof va === "number") return sortDir === "asc" ? va - vb : vb - va
    return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
  })
  const vaultProgressById = useMetaAssignmentProgress(
    vaultSorted
      .filter(creative => creative.status === "pending" || creative.status === "processing")
      .map(creative => creative.id),
    open && mediaTab === "vault",
  )

  const toggleAllVault = () => {
    setSelected(prev => prev.size === vaultSorted.length ? new Set() : new Set(vaultSorted.map(m => m.id)))
    setSelectionAnchorId(null)
  }

  const [portalDetailOpen, setPortalDetailOpen] = useState(false)
  const [portalDetailFile, setPortalDetailFile] = useState<PortalMediaFile | null>(null)
  const openPortalDetail = (file: PortalMediaFile, e: React.MouseEvent) => {
    e.stopPropagation()
    setPortalDetailFile(file)
    setPortalDetailOpen(true)
  }

  const filtered = fbMedia.filter(m => {
    const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.fb_id?.includes(search)
    if (!matchSearch) return false
    if (filters.fileType !== "all" && m.media_type !== filters.fileType) return false
    if (filters.status !== "all") {
      const mStatus = typeof m.status === "object" ? (m.status as any)?.value : m.status
      if (mStatus !== filters.status) return false
    }
    if (filters.dimensions !== "all" && fmtDims(m) !== filters.dimensions) return false
    if (filters.dateAdded !== "all" && m.date_added) {
      const ms = Date.now() - new Date(m.date_added).getTime()
      const day = 86400000
      if (filters.dateAdded === "today" && ms > day) return false
      if (filters.dateAdded === "week" && ms > 7 * day) return false
      if (filters.dateAdded === "month" && ms > 30 * day) return false
      if (filters.dateAdded === "year" && ms > 365 * day) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    let va: any, vb: any
    switch (sortField) {
      case "name": va = a.name; vb = b.name; break
      case "ad_id": va = a.fb_id || ""; vb = b.fb_id || ""; break
      case "dimensions": va = fmtDims(a); vb = fmtDims(b); break
      case "date": va = a.date_added || ""; vb = b.date_added || ""; break
      case "status": va = String(a.status || ""); vb = String(b.status || ""); break
      case "workspace": va = ""; vb = ""; break
      default: va = a.date_added || ""; vb = b.date_added || ""; break
    }
    if (typeof va === "number") return sortDir === "asc" ? va - vb : vb - va
    return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
  })

  const toggle = (id: string, shiftKey = false, ctrlKey = false) => {
    const orderedIds = (mediaTab === "vault" ? vaultSorted : sorted).map(m => m.id)
    const { nextSelected, nextAnchorId } = getRangeToggledIds(selected, orderedIds, id, selectionAnchorId, shiftKey, ctrlKey)
    setSelected(nextSelected)
    setSelectionAnchorId(nextAnchorId)
  }
  const toggleAll = () => {
    setSelected(prev => prev.size === sorted.length ? new Set() : new Set(sorted.map(m => m.id)))
    setSelectionAnchorId(null)
  }
  const handleConfirm = async () => {
    const selectedMedia = fbMedia.filter(m => selected.has(m.id))
    if (selectedMedia.length === 0) { onClose(); return }

    setFbMediaSaving(true)
    try {
      const res = await fetch("/api/facebook/ad-media/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_account_id: adAccountId,
          items: selectedMedia.map(m => ({
            id: m.id,
            name: m.name,
            media_type: m.media_type,
            thumbnail_url: m.thumbnail_url,
            fb_image_hash: m.fb_image_hash,
            fb_image_url: m.fb_image_url,
            fb_video_id: m.fb_video_id,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.creatives?.length) {
        setFbMediaError(data.error || "Failed to save media")
        return
      }
      const creatives: Creative[] = data.creatives
      onConfirm(creatives.map((c: any) => c.id), creatives)
      onClose()
    } catch (err: any) {
      setFbMediaError(err.message || "Failed to save media")
    } finally {
      setFbMediaSaving(false)
    }
  }
  const handlePasteSubmit = () => {
    const ids = pasteText.split(/[\s,;\n]+/).map(s => s.trim()).filter(Boolean)
    const matched = fbMedia.filter(m => ids.includes(m.id) || ids.includes(m.fb_id))
    setSelected(prev => { const s = new Set(prev); matched.forEach(m => s.add(m.id)); return s })
    setPasteText("")
    setPasteOpen(false)
  }
  const toggleSort = (f: SortField) => {
    if (sortField === f) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortField(f); setSortDir("asc") }
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || !adAccountId) return
    const fileArr = Array.from(files)
    setUploading(true)
    setUploadProgress({ current: 0, total: fileArr.length })
    setUploadPauseMsg(null)

    let done = 0
    let newCount = 0
    let dupCount = 0
    let errCount = 0
    let lastError = ""

    // Path B upload (same mechanism as the Gallery panel's uploadOneFile):
    //   Video → direct browser→Meta chunked upload (bypasses the app server body limit)
    //   Image → signed Supabase URL + proxy PUT + finalize
    // The old /api/creatives/upload-binary path funneled the whole file through the
    // serverless function, so anything above the platform body cap (~4.5MB on Vercel)
    // was rejected with 413 before the code ran.
    const MAX_SIZE = 500 * 1024 * 1024

    const uploadFile = async (file: File): Promise<void> => {
      if (file.size > MAX_SIZE) {
        errCount++
        lastError = `${file.name}: too large (${(file.size / 1024 / 1024).toFixed(0)}MB, max 500MB)`
        return
      }
      const isVideo = file.type.startsWith("video/")
      try {
        if (isVideo) {
          // Dedup: same file already uploaded to Meta → skip all Meta calls
          try {
            const dupRes = await fetch(`/api/creatives?file_name=${encodeURIComponent(file.name)}&file_size=${file.size}`)
            if (dupRes.ok) {
              const { creatives = [] } = await dupRes.json()
              if (creatives[0]?.fb_video_id) { dupCount++; return }
            }
          } catch {}

          // Browser upload credentials — WRITE via resolved for this ad account
          const credRes = await fetch(`/api/facebook/upload-credentials?adAccountId=${encodeURIComponent(adAccountId)}`, { method: "POST" })
          if (!credRes.ok) {
            const e = await credRes.json().catch(() => ({}))
            throw new Error(e.error || "Failed to get upload credentials")
          }
          const { accessToken, adAccountId: credAccountId } = await credRes.json()
          const cleanId = String(credAccountId).replace(/^act_/, "")
          const FB_VIDEOS = `https://graph.facebook.com/v25.0/act_${cleanId}/advideos`
          const DIRECT_LIMIT = 100 * 1024 * 1024 // ≤100MB: direct POST
          let CHUNK_SIZE = 4 * 1024 * 1024
          if (file.size > 150 * 1024 * 1024) CHUNK_SIZE = 20 * 1024 * 1024
          else if (file.size > 50 * 1024 * 1024) CHUNK_SIZE = 10 * 1024 * 1024

          let fbVideoId: string
          if (file.size <= DIRECT_LIMIT) {
            const form = new FormData()
            form.append("source", file)
            form.append("title", file.name)
            form.append("access_token", accessToken)
            const res = await fetch(FB_VIDEOS, { method: "POST", body: form })
            const d = await res.json()
            if (!res.ok || !d.id) throw new Error(d.error?.message || `Upload failed (${res.status})`)
            fbVideoId = d.id
          } else {
            // Chunked: START → TRANSFER × N → FINISH
            const startForm = new FormData()
            startForm.append("upload_phase", "start")
            startForm.append("file_size", String(file.size))
            startForm.append("access_token", accessToken)
            const startRes = await fetch(FB_VIDEOS, { method: "POST", body: startForm })
            const startData = await startRes.json()
            if (startData.error) throw new Error(startData.error.message)
            const { upload_session_id, video_id } = startData
            fbVideoId = video_id
            let startOffset = parseInt(startData.start_offset || "0")
            let endOffset = parseInt(startData.end_offset || String(Math.min(CHUNK_SIZE, file.size)))
            while (startOffset < file.size) {
              // Retry a failed chunk at the same offset (Meta's transfer phase is
              // idempotent per start_offset) instead of throwing away the whole upload
              // on one transient hiccup — mirrors the Gallery uploadOneFile path.
              const snapStart = startOffset
              let cData: any = null
              let cErr: string | null = null
              for (let cAttempt = 1; cAttempt <= 4; cAttempt++) {
                const chunk = file.slice(snapStart, endOffset)
                const chunkForm = new FormData()
                chunkForm.append("upload_phase", "transfer")
                chunkForm.append("upload_session_id", upload_session_id)
                chunkForm.append("start_offset", String(snapStart))
                chunkForm.append("video_file_chunk", chunk, file.name)
                chunkForm.append("access_token", accessToken)
                try {
                  const cRes = await fetch(FB_VIDEOS, { method: "POST", body: chunkForm })
                  cData = await cRes.json()
                  if (cRes.ok && !cData.error) { cErr = null; break }
                  cErr = cData.error?.message || "Chunk upload failed"
                } catch (e: any) {
                  cErr = e?.message || "Network error during chunk upload"
                }
                if (cAttempt < 4) await new Promise(r => setTimeout(r, 800 * cAttempt))
              }
              if (cErr) throw new Error(cErr)
              startOffset = parseInt(cData.start_offset || String(endOffset))
              endOffset = parseInt(cData.end_offset || String(Math.min(endOffset + CHUNK_SIZE, file.size)))
            }
            const finishForm = new FormData()
            finishForm.append("upload_phase", "finish")
            finishForm.append("upload_session_id", upload_session_id)
            finishForm.append("title", file.name)
            finishForm.append("access_token", accessToken)
            const finRes = await fetch(FB_VIDEOS, { method: "POST", body: finishForm })
            const finData = await finRes.json()
            if (finData.error) throw new Error(finData.error.message)
          }

          // Save to DB via JSON (tiny body — no size limit)
          const dbRes = await fetch("/api/creatives", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ad_account_id: adAccountId,
              file_name: file.name,
              file_size: file.size,
              media_type: "video",
              fb_video_id: fbVideoId,
              headline: "", primary_text: "", description: "", cta: "LEARN_MORE", link_url: "",
            }),
          })
          const dbData = await dbRes.json()
          if (!dbRes.ok || !dbData.creative) throw new Error(dbData.error || "Failed to save creative")
          newCount++
        } else {
          // IMAGE: signed Supabase URL → proxy PUT (small files) → finalize
          const signRes = await fetch(`/api/creatives/upload-sign?filename=${encodeURIComponent(file.name)}`)
          if (!signRes.ok) {
            const e = await signRes.json().catch(() => ({}))
            throw new Error(e.error || `Failed to get upload URL (${signRes.status})`)
          }
          const { signedUrl, storagePath, publicUrl } = await signRes.json()
          const putRes = await fetch(`/api/creatives/upload-proxy?url=${encodeURIComponent(signedUrl)}`, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          })
          if (!putRes.ok) throw new Error(`Storage upload failed (${putRes.status})`)
          const finRes = await fetch("/api/creatives/finalize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storagePath, publicUrl, filename: file.name, fileType: file.type, fileSize: file.size, adAccountId }),
          })
          const finData = await finRes.json()
          if (!finRes.ok || !finData.creative) throw new Error(finData.error || "Failed to finalize upload")
          newCount++
        }
      } catch (e: any) {
        errCount++
        lastError = `${file.name}: ${e?.message || "upload failed"}`
        console.error("[media-library upload]", file.name, e)
      }
    }

    const images = fileArr.filter(f => !f.type.startsWith("video/"))
    const videos = fileArr.filter(f => f.type.startsWith("video/"))

    // Images: parallel (fast, cheap on quota)
    if (images.length > 0) {
      let imgIdx = 0
      const imgWorker = async () => {
        while (imgIdx < images.length) {
          await uploadFile(images[imgIdx++])
          done++
          setUploadProgress({ current: done, total: fileArr.length })
        }
      }
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, images.length) }, imgWorker))
    }

    // Videos: capped concurrency (matches Gallery's uploadOneFile) — fully serial
    // wastes time on multi-file batches, fully unbounded starves each other's bandwidth.
    if (videos.length > 0) {
      const VIDEO_UPLOAD_CONCURRENCY = 4
      let vidIdx = 0
      const vidWorker = async () => {
        while (vidIdx < videos.length) {
          await uploadFile(videos[vidIdx++])
          done++
          setUploadProgress({ current: done, total: fileArr.length })
        }
      }
      await Promise.all(Array.from({ length: Math.min(VIDEO_UPLOAD_CONCURRENCY, videos.length) }, vidWorker))
    }

    setUploading(false)
    setUploadProgress(null)
    setUploadPauseMsg(null)
    fetchFbMedia()
    fetchCreatives(true)
    const summary: string[] = []
    if (newCount > 0) summary.push(`Uploaded ${newCount} new`)
    if (dupCount > 0) summary.push(`${dupCount} already exist (skipped)`)
    if (errCount > 0) summary.push(`${errCount} failed — ${lastError}`)
    if (summary.length > 0) {
      setUploadPauseMsg(summary.join(" · "))
      setTimeout(() => setUploadPauseMsg(null), errCount > 0 ? 8000 : 4000)
    }
  }

  const ALL_TABS: { id: MediaTab; label: string; Icon: React.ElementType; beta?: boolean }[] = [
    { id: "vault", label: "Portal Vault", Icon: IconFolder },
    { id: "library", label: "Media Library", Icon: IconStack2 },
    { id: "existing", label: "Existing Ads", Icon: IconLayoutGrid },
    { id: "gdrive", label: "Google Drive", Icon: IconBrandGoogleDrive },
    { id: "drive_browser", label: "Drive Browser", Icon: IconBrandGoogleDrive, beta: true },
    { id: "drive_link", label: "Drive Link", Icon: IconBrandGoogleDrive },
    { id: "integrations", label: "Integrations", Icon: IconSettings },
  ]
  const TABS = tabs ? ALL_TABS.filter(t => tabs.includes(t.id)) : ALL_TABS

  // `text-link`, not `text-primary`: --primary is a fill colour and only clears 3:1 against
  // its own background. As a foreground it measures 2.98:1 on --card in dark mode. Every
  // blue *mark* in this file goes through --link for that reason; blue *fills* keep --primary.
  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="inline-flex flex-col -space-y-1 ml-0.5 opacity-60">
      <IconChevronUp className={cn("size-2.5", sortField === field && sortDir === "asc" && "text-link opacity-100")} />
      <IconChevronDown className={cn("size-2.5", sortField === field && sortDir === "desc" && "text-link opacity-100")} />
    </span>
  )

  /**
   * Date and Clear were written out twice — once in the Library row, once in the Vault row —
   * and the two copies had already drifted (the Library copy lacked the cursor and focus-ring
   * classes every other chip carries). One definition, two call sites.
   */
  const DateChip = () => (
    <div className="relative">
      <button
        type="button"
        aria-expanded={openFilter === "dateAdded"}
        onClick={() => setOpenFilter(openFilter === "dateAdded" ? null : "dateAdded")}
        className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          filters.dateAdded !== "all" ? "border-primary bg-primary/5 text-link" : "hover:bg-muted/30")}
      >
        <IconCalendar className="size-3" />
        <span className="font-medium">Date assigned{filters.dateAdded !== "all" && ` · ${filters.dateAdded}`}</span>
        <IconChevronDown className={cn("size-3 transition-transform", openFilter === "dateAdded" && "rotate-180")} />
      </button>
      {openFilter === "dateAdded" && (
        <div className="absolute top-full left-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 min-w-[140px] py-1">
          {[["all", "All time"], ["today", "Today"], ["week", "This week"], ["month", "This month"], ["year", "This year"]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => { setFilters(f => ({ ...f, dateAdded: v })); setOpenFilter(null) }}
              className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:bg-accent", filters.dateAdded === v && "font-semibold text-link")}>
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  /**
   * `keys` is the set of filters that belong to the calling tab. Both rows previously tested
   * *every* key, so setting Brand in the Vault tab made "Clear filters" appear in the Library
   * tab, where no Brand filter exists. The reset itself still clears everything, as before.
   */
  const ClearFiltersButton = ({ keys }: { keys: (keyof typeof filters)[] }) => {
    if (!keys.some(k => filters[k] !== "all")) return null
    return (
      <button
        type="button"
        onClick={() => setFilters({
          status: "all", fileType: "all", dimensions: "all", dateAdded: "all",
          brand: "all", product: "all", language: "all",
        })}
        className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-lg border border-dashed transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IconX className="size-3" />
        Clear filters
      </button>
    )
  }

  const FilterChip = ({ id, label }: { id: keyof typeof filters; label: string }) => {
    const opts = filterOptions[id] as string[]
    const value = filters[id]
    const isActive = value !== "all"
    return (
      <div className="relative">
        <button
          type="button"
          aria-expanded={openFilter === id}
          onClick={() => setOpenFilter(openFilter === id ? null : id)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition-colors cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isActive ? "border-primary bg-primary/5 text-link" : "hover:bg-muted/30"
          )}
        >
          <span className="font-medium">{label}</span>
          {isActive && <span className={cn("bg-primary/10 px-1 rounded text-xs", id === "language" && "uppercase")}>{value}</span>}
          <IconChevronDown className={cn("size-3 transition-transform", openFilter === id && "rotate-180")} />
        </button>
        {openFilter === id && (
          <div className="absolute top-full left-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 min-w-[160px] py-1 max-h-60 overflow-y-auto">
            <button
              type="button"
              onClick={() => { setFilters(f => ({ ...f, [id]: "all" })); setOpenFilter(null) }}
              className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:bg-accent", value === "all" && "font-semibold text-link")}
            >
              All
            </button>
            {opts.map(o => (
              <button
                type="button"
                key={o}
                onClick={() => { setFilters(f => ({ ...f, [id]: o })); setOpenFilter(null) }}
                className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:bg-accent", id === "language" ? "uppercase" : "capitalize", value === o && "font-semibold text-link")}
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent
        className="z-[70] max-w-6xl h-[94vh] flex flex-col p-0 gap-0"
        overlayClassName="z-[70]"
      >
        <DialogHeader className="px-6 py-3 border-b shrink-0">
          <DialogTitle className="text-base font-semibold">Select media to use</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex items-center border-b px-6 shrink-0 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.Icon
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={mediaTab === t.id}
                onClick={() => setMediaTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 py-2.5 mr-6 text-sm border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
                  mediaTab === t.id ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-4" />{t.label}
                {/* Was bg-blue-100 + text-primary/90: a fixed light-blue pill that stayed
                    light in dark mode. "Beta" is a label, not a link or an active state. */}
                {t.beta && <span className="text-xs px-1 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-bold">Beta</span>}
              </button>
            )
          })}
        </div>

        {mediaTab === "library" ? (
          <>
            {/*
              One toolbar, not three rows. Search, the media actions and the overflow menu were
              spread over a search row, a filter row and a right-aligned action row, each with its
              own border — ~112px of chrome above a table in a 94vh modal. The actions row was the
              cheapest to fold in: it was already right-aligned, so it becomes the right cluster of
              the search row and the row itself disappears. Nothing was dropped except the two
              controls that did nothing (see below).

              `flex-wrap` plus `min-w-[220px]` on the input is what keeps this honest at narrow
              widths: the action cluster wraps beneath the input instead of crushing it, and the
              labels collapse to icons under `sm`.
            */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-2.5 border-b shrink-0">
              <div className="relative flex-1 min-w-[220px]">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                {/* The Search button next to this input had no onClick at all — `onChange` here
                    already filters `fbMedia` on every keystroke, so the button was decoration
                    that implied the results were stale until you pressed it. */}
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or ID..."
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50" />
              </div>

              {uploadPauseMsg && (
                <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  {uploading
                    ? <IconLoader2 className="size-3 animate-spin" />
                    : <IconCheck className="size-3" />
                  }
                  {uploadPauseMsg}
                </span>
              )}

              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPasteOpen(true)}>
                  <IconClipboard className="size-3.5" /><span className="hidden sm:inline">Paste list</span>
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => uploadFileRef.current?.click()} disabled={uploading}>
                  {uploading && uploadProgress
                    ? <><IconLoader2 className="size-3.5 animate-spin" />{uploadProgress.current}/{uploadProgress.total}</>
                    : <><IconUpload className="size-3.5" /><span className="hidden sm:inline">Upload New Media</span></>
                  }
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => uploadFolderRef.current?.click()} disabled={uploading}>
                  <IconFolder className="size-3.5" /><span className="hidden sm:inline">Upload Folder</span>
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fetchFbMedia()} disabled={fbMediaLoading}>
                  <IconRefresh className={cn("size-3.5", fbMediaLoading && "animate-spin")} /><span className="hidden sm:inline">Refresh list</span>
                </Button>
                <div className="relative">
                  <Button variant="outline" size="icon" className="size-8" onClick={() => setMoreOpen(o => !o)} aria-label="More actions">
                    <IconDots className="size-3.5" />
                  </Button>
                  {moreOpen && (
                    <div className="absolute top-full right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 min-w-[160px] py-1">
                      <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent">Export selected</button>
                      <button
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent text-destructive disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                        disabled={selected.size === 0}
                        onClick={() => { setMoreOpen(false); deleteFbMedia(Array.from(selected)) }}
                      >
                        Bulk delete{selected.size > 0 ? ` (${selected.size})` : ""}
                      </button>
                      <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent">Settings</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/*
              Four of the eight chips here were inert, not merely unpopular: `uploader`,
              `channels`, `workspace` and `source` are hardcoded to `[] as string[]` in
              filterOptions — so the dropdown opened on "All" and nothing else — and none of the
              four is read by the `filtered` predicate above. Clicking them could not change the
              result set under any data. They are gone.

              The four that remain are each derived from the loaded media and applied in
              `filtered`: File Type (image/video), Status (Meta's own values), Dimensions (the
              aspect ratio, which is how you find a 9:16 for Reels), Date assigned.
            */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-2 border-b shrink-0">
              <FilterChip id="fileType" label="File Type" />
              <FilterChip id="status" label="Status" />
              <FilterChip id="dimensions" label="Dimensions" />
              <DateChip />
              <ClearFiltersButton keys={["fileType", "status", "dimensions", "dateAdded"]} />
            </div>

            {/* Table header */}
            <div className="grid items-center text-sm font-bold text-muted-foreground/70 uppercase tracking-wide border-b px-6 py-2 shrink-0"
              style={{ gridTemplateColumns: "28px 2.5fr 90px 110px 100px 120px" }}>
              <button onClick={toggleAll} className={cn("size-4 rounded border-2 flex items-center justify-center transition-colors",
                selected.size > 0 ? "bg-primary border-primary" : "border-muted-foreground/30 hover:border-muted-foreground/60")}>
                {selected.size > 0 && selected.size === sorted.length && <IconCheck className="size-2.5 text-primary-foreground" />}
                {selected.size > 0 && selected.size < sorted.length && <IconMinus className="size-2.5 text-primary-foreground" />}
              </button>
              <button onClick={() => toggleSort("name")} className="flex items-center text-left hover:text-foreground">Name<SortIcon field="name" /></button>
              <button onClick={() => toggleSort("ad_id")} className="flex items-center hover:text-foreground">AD ID<SortIcon field="ad_id" /></button>
              <button onClick={() => toggleSort("dimensions")} className="flex items-center hover:text-foreground">Dimensions<SortIcon field="dimensions" /></button>
              <button onClick={() => toggleSort("status")} className="flex items-center hover:text-foreground">Status<SortIcon field="status" /></button>
              <button onClick={() => toggleSort("workspace")} className="flex items-center hover:text-foreground">Workspace ID<SortIcon field="workspace" /></button>
            </div>

            {/* Table body */}
            <div className="flex-1 overflow-auto">
              {fbMediaLoading ? (
                <div className="flex items-center justify-center h-40">
                  <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : fbMediaError ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
                  <IconPhoto className="size-8 opacity-30" />
                  <p className="text-sm text-destructive">{fbMediaError}</p>
                  <Button size="sm" variant="outline" onClick={() => fetchFbMedia()}>Retry</Button>
                </div>
              ) : sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
                  <IconPhoto className="size-8 opacity-30" />
                  <p className="text-sm">No media assets found</p>
                </div>
              ) : (
                sorted.map(m => {
                  const isSelected = selected.has(m.id)
                  const statusRaw = String(m.status || "active").toLowerCase()
                  const isSyncing = statusRaw.includes("process") || statusRaw.includes("pending")
                  const statusLabel = isSyncing ? "Assigning" : statusRaw.replace(/_/g, " ")
                  const statusColor = statusRaw === "active" || statusRaw === "ready"
                    ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                    : statusRaw === "paused"
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                    : statusRaw.includes("disapprove") || statusRaw.includes("reject")
                    ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                    : statusRaw.includes("process") || statusRaw.includes("pending")
                    // text-link, not text-primary: the other four states use a readable
                    // 700/400 pair, and text-primary was the odd one out at 2.98:1 in dark.
                    ? "bg-primary/10 text-link dark:bg-primary/15"
                    : "bg-muted/60 text-muted-foreground"
                  return (
                    <div key={m.id} onClick={() => toggle(m.id)}
                      className={cn("group grid items-center px-6 py-2.5 border-b cursor-pointer hover:bg-muted/30 transition-colors select-none",
                        isSelected && "bg-primary/5 hover:bg-primary/10")}
                      style={{ gridTemplateColumns: "28px 2.5fr 90px 110px 100px 120px" }}>
                      <div className={cn("size-4 rounded border-2 flex items-center justify-center shrink-0",
                        isSelected ? "bg-primary border-primary" : "border-muted-foreground/30")}>
                        {isSelected && <IconCheck className="size-2.5 text-primary-foreground" />}
                      </div>
                      <div className="flex items-center gap-2.5 min-w-0 pr-3">
                        <div className="size-9 rounded overflow-hidden bg-muted shrink-0 relative">
                          {m.thumbnail_url
                            ? <img src={m.thumbnail_url} className="w-full h-full object-cover" alt="" loading="lazy" onError={e => e.currentTarget.style.display="none"} />
                            : <div className="w-full h-full flex items-center justify-center"><IconPhoto className="size-4 text-muted-foreground/40" /></div>
                          }
                          {m.media_type === "video" && (
                            <div className="absolute bottom-0 right-0 size-3.5 rounded-tl bg-black/60 flex items-center justify-center pointer-events-none">
                              <IconPlayerPlay className="size-2 text-white" />
                            </div>
                          )}
                        </div>
                        <span className="text-base truncate flex-1" title={m.name}>{m.name}</span>
                        <button
                          onClick={e => { e.stopPropagation(); deleteFbMedia([m.id]) }}
                          className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                          title="Delete"
                        >
                          <IconTrash className="size-3.5" />
                        </button>
                      </div>
                      <span className="text-sm text-muted-foreground font-mono">{m.fb_id?.slice(-6) || "—"}</span>
                      <span className="text-sm px-1.5 py-0.5 rounded bg-muted/50 w-fit">{fmtDims(m)}</span>
                      <span className={cn("inline-flex items-center gap-1 text-sm px-1.5 py-0.5 rounded-full w-fit max-w-full", statusColor)}>
                        {isSyncing && (
                          <IconLoader2 className="size-3 shrink-0 animate-spin" />
                        )}
                        <span className="truncate capitalize">{statusLabel}</span>
                      </span>
                      <span className="text-sm text-muted-foreground truncate font-mono">{adAccountId.replace("act_", "").slice(0, 12)}</span>
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer */}
            <div className="border-t shrink-0">
              <div className="px-6 pt-2 pb-1 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {filtered.length !== fbMedia.length
                    ? `${filtered.length} of ${fbMedia.length}${fbMediaHasMore ? "+" : ""} row(s)`
                    : `${fbMedia.length}${fbMediaHasMore ? "+" : ""} row(s)`}
                </span>
                {fbMediaHasMore && (
                  <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => fetchFbMedia(true)} disabled={fbMediaLoading}>
                    {fbMediaLoading ? <IconLoader2 className="size-3 animate-spin mr-1" /> : null}
                    Load more
                  </Button>
                )}
              </div>
              <Button
                onClick={handleConfirm}
                disabled={selected.size === 0 || fbMediaSaving}
                className="w-full h-12 rounded-none rounded-b-xl text-base font-semibold"
              >
                {fbMediaSaving ? <><IconLoader2 className="size-4 animate-spin mr-2" />Saving...</> : `Add ${selected.size > 0 ? `${selected.size} ` : "New "}Creatives`}
              </Button>
            </div>
          </>
        ) : mediaTab === "vault" ? (
          <>
            {/* Search row */}
            <div className="flex items-center gap-2 px-6 py-3 border-b shrink-0">
              <div className="relative flex-1">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search assets..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50" />
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fetchCreatives(true)} disabled={loading}>
                <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />Refresh
              </Button>
            </div>

            {/* Filter chips — Brand/Product/Language/Date */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-2 border-b shrink-0">
              {filterOptions.brand.length > 0 && <FilterChip id="brand" label="Brand" />}
              {filterOptions.product.length > 0 && <FilterChip id="product" label="Product" />}
              {filterOptions.language.length > 0 && <FilterChip id="language" label="Language" />}
              <DateChip />
              <ClearFiltersButton keys={["brand", "product", "language", "dateAdded"]} />
            </div>

            {/* Table header — matches Assets table: Name/Brand/Product/Lang/Dims-Dur/Type/Status/Date Assigned */}
            <div className="grid items-center text-sm font-bold text-muted-foreground/70 uppercase tracking-wide border-b px-6 py-2 shrink-0"
              style={{ gridTemplateColumns: "28px 2.5fr 1fr 1.4fr 60px 1fr 70px 100px 120px 32px" }}>
              <button onClick={toggleAllVault} className={cn("size-4 rounded border-2 flex items-center justify-center transition-colors",
                selected.size > 0 ? "bg-primary border-primary" : "border-muted-foreground/30 hover:border-muted-foreground/60")}>
                {selected.size > 0 && selected.size === vaultSorted.length && <IconCheck className="size-2.5 text-primary-foreground" />}
                {selected.size > 0 && selected.size < vaultSorted.length && <IconMinus className="size-2.5 text-primary-foreground" />}
              </button>
              <button onClick={() => toggleSort("name")} className="flex items-center text-left hover:text-foreground">Name<SortIcon field="name" /></button>
              <button onClick={() => toggleSort("brand")} className="flex items-center hover:text-foreground">Brand<SortIcon field="brand" /></button>
              <button onClick={() => toggleSort("product")} className="flex items-center hover:text-foreground">Product<SortIcon field="product" /></button>
              <button onClick={() => toggleSort("language")} className="flex items-center hover:text-foreground">Lang<SortIcon field="language" /></button>
              <button onClick={() => toggleSort("dimensions")} className="flex items-center hover:text-foreground">Dims<SortIcon field="dimensions" /></button>
              <button onClick={() => toggleSort("duration")} className="flex items-center hover:text-foreground">Duration<SortIcon field="duration" /></button>
              <button onClick={() => toggleSort("status")} className="flex items-center hover:text-foreground">Status<SortIcon field="status" /></button>
              <button onClick={() => toggleSort("date")} className="flex items-center hover:text-foreground">Date Assigned<SortIcon field="date" /></button>
            </div>

            {/* Table body */}
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex items-center justify-center h-40">
                  <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : vaultSorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
                  <IconPhoto className="size-8 opacity-30" />
                  <p className="text-sm">No assets found</p>
                </div>
              ) : (
                vaultSorted.map(c => {
                  const isSelected = selected.has(c.id)
                  const isReady = c.status === "ready"
                    || (c.media_type === "image" && Boolean(c.fb_image_hash))
                  const pm = resolveCreativePortal(c)
                  const assignmentProgress = vaultProgressById[c.id]
                  return (
                    <div key={c.id}
                      onClick={(e) => toggle(c.id, e.shiftKey, e.ctrlKey || e.metaKey)}
                      className={cn("group grid items-center px-6 py-2.5 border-b cursor-pointer hover:bg-muted/30 transition-colors select-none",
                        isSelected && "bg-primary/5 hover:bg-primary/10")}
                      style={{ gridTemplateColumns: "28px 2.5fr 1fr 1.4fr 60px 1fr 70px 100px 120px 32px" }}>
                      <div className="size-4 rounded border-2 flex items-center justify-center shrink-0"
                        onClick={e => { e.stopPropagation(); toggle(c.id, e.shiftKey, e.ctrlKey || e.metaKey) }}>
                        <div className={cn("size-4 -m-2 rounded border-2 flex items-center justify-center", isSelected ? "bg-primary border-primary" : "border-muted-foreground/30")}>
                          {isSelected && <IconCheck className="size-2.5 text-primary-foreground" />}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 min-w-0 pr-3">
                        <div className="size-9 rounded-lg overflow-hidden bg-muted shrink-0">
                          <CreativeCardMedia creative={c} className="h-full w-full object-cover" compact />
                        </div>
                        <span className="text-base truncate flex-1" title={c.file_name}>{c.file_name}</span>
                      </div>
                      <span className="text-sm truncate min-w-0" title={pm?.brandName || ""}>{pm?.brandName || "—"}</span>
                      <span className="text-sm text-muted-foreground truncate min-w-0" title={pm?.productName || ""}>{pm?.productName || "—"}</span>
                      <span className="text-sm text-muted-foreground">
                        {pm?.language ? <span className="uppercase text-[10px] font-bold bg-muted px-1 rounded">{pm.language}</span> : "—"}
                      </span>
                      <span className="text-sm px-1.5 py-0.5 rounded bg-muted/50 w-fit">{pm?.width && pm?.height ? `${pm.width}x${pm.height}` : "—"}</span>
                      <span className="text-sm px-1.5 py-0.5 rounded bg-muted/50 w-fit">{pm?.durationSeconds ? fmtDuration(pm.durationSeconds) : "—"}</span>
                      <MetaAssignmentStatus
                        progress={assignmentProgress}
                        fallbackStatus={c.status}
                        ready={isReady}
                        compact
                      />
                      <span className="text-sm text-muted-foreground">
                        {(c.assigned_at || c.created_at) ? new Date(c.assigned_at || c.created_at!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                      </span>
                      {pm ? (
                        <button
                          type="button"
                          onClick={(e) => openPortalDetail(pm, e)}
                          title="View details"
                          aria-label={`View details for ${c.file_name}`}
                          // opacity-0 alone leaves an invisible but focusable target: tabbing
                          // to it moved focus nowhere a sighted keyboard user could see.
                          className="flex items-center justify-center size-7 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity"
                        >
                          <IconDots className="size-4" />
                        </button>
                      ) : <span />}
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer */}
            <div className="border-t shrink-0">
              <div className="px-6 pt-2 pb-1 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{vaultSorted.length} asset{vaultSorted.length !== 1 ? "s" : ""}</span>
              </div>
              <Button
                onClick={() => {
                  const selectedObjs = allCreatives.filter(c => selected.has(c.id))
                  onConfirm(Array.from(selected), selectedObjs)
                  onClose()
                }}
                disabled={selected.size === 0}
                className="w-full h-12 rounded-none rounded-b-xl text-base font-semibold"
              >
                {`Add ${selected.size > 0 ? `${selected.size} ` : ""}Creatives`}
              </Button>
            </div>
          </>
        ) : mediaTab === "existing" ? (
          <>
            {/* Search row + ad account picker (combined) */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-2 border-b shrink-0">
              <div className="relative flex-1 min-w-[220px]">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                {/*
                  `filteredExisting` narrows this list on every keystroke, and `fetchExistingAds`
                  never puts `existingSearch` in its params — so the Search button that used to sit
                  in this row could not search, client-side or server-side. Its onClick was
                  `fetchExistingAds(true)`, byte-for-byte the Refresh button's, and the `reset`
                  path runs `setExistingSelected(new Set())`: pressing "Search" after choosing
                  ads silently discarded the selection. Removed, not rewired — Refresh already
                  provides the only behaviour it had, under the name that describes it.

                  The "Include" dropdown next to it went the same way: three checkboxes
                  (Archived / Deleted / Inactive ads) with no onChange and no request param.
                */}
                <input value={existingSearch} onChange={e => setExistingSearch(e.target.value)} placeholder="Search by ad name or ID..."
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => setPasteOpen(true)}>
                <IconClipboard className="size-3.5" />Paste list
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => fetchExistingAds(true)} disabled={existingLoading}>
                <IconRefresh className={cn("size-3.5", existingLoading && "animate-spin")} />Refresh
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
              <div className="relative">
                <button
                  onClick={() => setExistingAccountOpen(o => !o)}
                  className="h-8 flex items-center gap-1.5 px-3 rounded-lg border bg-background hover:bg-muted/40 transition-colors min-w-[160px] max-w-[220px] text-sm"
                  title="Load creatives from this ad account"
                >
                  <IconMetaBadge className="size-3.5 text-[#0064E0] shrink-0" />
                  <span className="truncate flex-1 text-left">
                    {adAccounts?.find(a => a.id === existingAccountId)?.name || existingAccountId}
                  </span>
                  <IconChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                </button>
                {existingAccountOpen && adAccounts && (
                  <div className="absolute top-full right-0 mt-1 bg-popover border rounded-xl shadow-lg z-50 max-h-64 overflow-y-auto min-w-[240px]">
                    {adAccounts.map(a => (
                      <button key={a.id}
                        onClick={() => { setExistingAccountId(a.id); setExistingAccountOpen(false) }}
                        className={cn("w-full px-3 py-2 text-left text-sm hover:bg-accent",
                          existingAccountId === a.id && "bg-primary/5 font-medium")}>
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Filter chips — wrap, no horizontal scroll */}
            <div className="flex items-center gap-2 flex-wrap px-6 py-2 border-b shrink-0">
              {/* Date preset */}
              <div className="relative">
                <button onClick={() => setExistingDateOpen(o => !o)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg hover:bg-muted/30">
                  <IconCalendar className="size-3" />
                  <span className="font-medium">{DATE_PRESETS.find(p => p.value === existingDatePreset)?.label}</span>
                  <IconChevronDown className="size-3" />
                </button>
                {existingDateOpen && (
                  <div className="absolute top-full left-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 min-w-[160px] py-1">
                    {DATE_PRESETS.map(p => (
                      <button key={p.value} onClick={() => { setExistingDatePreset(p.value); setExistingDateOpen(false) }}
                        className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-accent", existingDatePreset === p.value && "font-semibold")}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={() => setExistingFilterOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg hover:bg-muted/30">
                <IconArrowsSort className="size-3" /><span className="font-medium">Filter</span>
              </button>

              <button onClick={() => setExistingActiveOnly(v => !v)}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg",
                  existingActiveOnly ? "bg-primary/10 border-primary text-link" : "hover:bg-muted/30")}>
                <IconCircleCheck className="size-3" /><span className="font-medium">Active ads</span>
              </button>

              <button onClick={() => setExistingActiveAdSetOnly(v => !v)}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg",
                  existingActiveAdSetOnly ? "bg-primary/10 border-primary text-link" : "hover:bg-muted/30")}>
                <IconCircleCheck className="size-3" /><span className="font-medium">Active ad sets</span>
              </button>

              {/* Columns */}
              <div className="relative">
                <button onClick={() => setExistingColumnsOpen(o => !o)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg hover:bg-muted/30">
                  <IconTable className="size-3" /><span className="font-medium">Columns</span><IconChevronDown className="size-3" />
                </button>
                {existingColumnsOpen && (
                  <div className="absolute top-full left-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 min-w-[180px] py-1 max-h-60 overflow-y-auto">
                    {EXISTING_COLUMNS.map(c => (
                      <label key={c.key} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.has(c.key)}
                          onChange={() => setVisibleColumns(prev => { const s = new Set(prev); s.has(c.key) ? s.delete(c.key) : s.add(c.key); return s })}
                          className="rounded size-3"
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button onClick={() => setExistingMetricsOpen(o => !o)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg hover:bg-muted/30">
                  <span className="font-medium">Metrics</span>
                  <span className="text-xs px-1 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold">BETA</span>
                </button>
                {existingMetricsOpen && (
                  <div className="absolute top-full left-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 min-w-[200px] py-1">
                    {["CPC", "CTR", "Frequency", "CPM", "Reach", "Conversions"].map(m => (
                      <label key={m} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent cursor-pointer">
                        <input type="checkbox" className="rounded size-3" />{m}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  <span className="font-semibold text-foreground">{existingAds.length}</span> ads
                  {existingHasMore && " (more available)"}
                </span>
                {existingSelected.size > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-link font-semibold">{existingSelected.size} selected</span>
                  </>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {existingLoading && existingAds.length === 0 ? (
                <div className="flex items-center justify-center h-40">
                  <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : existingError ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg mx-6 my-4 p-3 text-xs text-amber-900">{existingError}</div>
              ) : sortedExisting.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
                  <IconLayoutGrid className="size-8 opacity-30" />
                  <p className="text-sm">No ads found in this time range</p>
                </div>
              ) : (
                <table data-table="compact" className="w-full text-sm">
                  <thead className="bg-background sticky top-0 z-10">
                    <tr className="border-b">
                      <th className="w-10 px-2"></th>
                      <th className="w-12 px-3"><IconPhoto className="size-3.5 text-muted-foreground inline" /></th>
                      <th className="px-3 text-left font-bold text-muted-foreground/80 cursor-pointer" onClick={() => toggleExistingSort("name")}>
                        <span className="inline-flex items-center">Name {existingSortField === "name" && <IconChevronDown className={cn("size-3 ml-0.5 transition-transform", existingSortDir === "asc" && "rotate-180")} />}</span>
                      </th>
                      {visibleColumns.has("page") && <th className="px-3 text-left font-bold text-muted-foreground/80 cursor-pointer" onClick={() => toggleExistingSort("page")}>Page</th>}
                      {visibleColumns.has("date") && <th className="px-3 text-left font-bold text-muted-foreground/80 cursor-pointer" onClick={() => toggleExistingSort("date")}>Date Created</th>}
                      {visibleColumns.has("post") && <th className="px-3 text-left font-bold text-muted-foreground/80">Post</th>}
                      {visibleColumns.has("status") && <th className="px-3 text-left font-bold text-muted-foreground/80 cursor-pointer" onClick={() => toggleExistingSort("status")}>Status</th>}
                      {visibleColumns.has("platform") && <th className="px-3 text-left font-bold text-muted-foreground/80">Platform</th>}
                      {visibleColumns.has("spend") && <th className="px-3 text-right font-bold text-muted-foreground/80 cursor-pointer" onClick={() => toggleExistingSort("spend")}>
                        <span className="inline-flex items-center">Spend <IconChevronDown className={cn("size-3 ml-0.5", existingSortField === "spend" && existingSortDir === "asc" && "rotate-180")} /></span>
                      </th>}
                      {visibleColumns.has("roas") && <th className="px-3 text-right font-bold text-muted-foreground/80 cursor-pointer" onClick={() => toggleExistingSort("roas")}>ROAS</th>}
                      {visibleColumns.has("results") && <th className="px-3 text-right font-bold text-muted-foreground/80 cursor-pointer" onClick={() => toggleExistingSort("results")}>Results</th>}
                      {visibleColumns.has("impressions") && <th className="px-3 text-right font-bold text-muted-foreground/80 cursor-pointer" onClick={() => toggleExistingSort("impressions")}>Impr.</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedExisting.map(ad => {
                      const isSel = existingSelected.has(ad.id)
                      const isVideo = ad.media_type === "video"
                      return (
                        <tr key={ad.id} onClick={() => toggleExisting(ad.id)}
                          className={cn("border-b cursor-pointer hover:bg-muted/20 transition-colors",
                            isSel && "bg-primary/5 hover:bg-primary/10")}>
                          <td className="px-3">
                            <div className={cn("size-4 rounded border-2 flex items-center justify-center",
                              isSel ? "bg-primary border-primary" : "border-muted-foreground/30")}>
                              {isSel && <IconCheck className="size-2.5 text-primary-foreground" />}
                            </div>
                          </td>
                          <td className="px-3">
                            <div className="relative size-9 rounded overflow-hidden bg-muted">
                              {ad.thumb_url ? <img src={ad.thumb_url} className="w-full h-full object-cover" alt="" loading="lazy" onError={e => e.currentTarget.style.display="none"} />
                                : <div className="w-full h-full flex items-center justify-center">
                                  {isVideo ? <IconVideo className="size-3.5 text-muted-foreground/40" /> : <IconPhoto className="size-3.5 text-muted-foreground/40" />}
                                </div>}
                              {ad.effective_status === "DELETED" && (
                                <div className="absolute -top-1 -right-1 size-4 rounded-full bg-primary/100 text-white flex items-center justify-center text-xs font-bold">D</div>
                              )}
                              {isVideo && (
                                <div className="absolute bottom-0.5 left-0.5 size-3.5 rounded-full bg-black/60 flex items-center justify-center">
                                  <IconPlayerPlay className="size-2 text-white" />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-3 max-w-[280px]">
                            <span className="text-base truncate block" title={ad.name}>{ad.name}</span>
                          </td>
                          {visibleColumns.has("page") && <td className="px-3 text-muted-foreground">{ad.page_name || "—"}</td>}
                          {visibleColumns.has("date") && <td className="px-3 text-muted-foreground whitespace-nowrap">{new Date(ad.date_created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>}
                          {visibleColumns.has("post") && <td className="px-3">
                            {ad.post_url ? <a href={ad.post_url} target="_blank" rel="noopener noreferrer" className="text-link hover:underline" onClick={e => e.stopPropagation()}>Post</a> : "—"}
                          </td>}
                          {visibleColumns.has("status") && <td className="px-3">
                            <span className={cn("text-sm px-1.5 py-0.5 rounded font-bold whitespace-nowrap",
                              ad.effective_status === "ACTIVE" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                              /PAUSED/.test(ad.effective_status) ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                              /DISAPPROVED|DELETED|ARCHIVED/.test(ad.effective_status) ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" :
                              "bg-muted text-muted-foreground")}
                              title={ad.effective_status}>
                              {ad.effective_status === "ACTIVE" ? "ACTIVE" :
                               ad.effective_status === "CAMPAIGN_PAUSED" ? "CAMP. PAUSED" :
                               ad.effective_status === "ADSET_PAUSED" ? "ADSET PAUSED" :
                               ad.effective_status === "PAUSED" ? "PAUSED" :
                               ad.effective_status.replace(/_/g, " ").slice(0, 12)}
                            </span>
                          </td>}
                          {visibleColumns.has("platform") && <td className="px-3">
                            <span className="text-sm px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 font-medium">{ad.platform}</span>
                          </td>}
                          {visibleColumns.has("spend") && <td className="px-3 text-right font-medium">{formatCurrency(ad.spend)}</td>}
                          {visibleColumns.has("roas") && <td className="px-3 text-right">{ad.roas > 0 ? ad.roas.toFixed(2) : "—"}</td>}
                          {visibleColumns.has("results") && <td className="px-3 text-right">{ad.results > 0 ? ad.results : "—"}</td>}
                          {visibleColumns.has("impressions") && <td className="px-3 text-right text-muted-foreground">{formatNumberShort(ad.impressions)}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {/* Load more */}
              {existingHasMore && (
                <div className="flex justify-center py-4">
                  <Button variant="outline" size="sm" onClick={() => fetchExistingAds(false)} disabled={existingLoading}>
                    {existingLoading ? <IconLoader2 className="size-3.5 animate-spin mr-1.5" /> : null}
                    Load more
                  </Button>
                </div>
              )}
            </div>

            {/* Footer — combined into single compact row + button */}
            <div className="border-t shrink-0">
              <div className="flex items-center gap-3 px-6 py-1.5">
                <span className="text-xs text-muted-foreground">Include:</span>
                <div className="relative">
                  <button onClick={() => setExistingIncludeOpen(o => !o)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-lg hover:bg-muted/30 min-w-[130px]">
                    <span className="font-medium flex-1 text-left">
                      {existingIncludeMode === "creatives" ? "Creatives only" : existingIncludeMode === "full" ? "Full ad config" : "Ad settings only"}
                    </span>
                    <IconChevronDown className="size-3" />
                  </button>
                  {existingIncludeOpen && (
                    <div className="absolute bottom-full left-0 mb-1 bg-popover border rounded-lg shadow-lg z-50 min-w-[160px] py-1">
                      {[
                        { v: "creatives", l: "Creatives only" },
                        { v: "full", l: "Full ad config" },
                        { v: "ad_settings", l: "Ad settings only" },
                      ].map(o => (
                        <button key={o.v} onClick={() => { setExistingIncludeMode(o.v as any); setExistingIncludeOpen(false) }}
                          className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-accent", existingIncludeMode === o.v && "font-semibold")}>
                          {o.l}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <Button
                onClick={handleSelectExistingAds}
                disabled={existingSelected.size === 0}
                className="w-full h-10 rounded-none rounded-b-xl text-sm font-semibold"
              >
                Select Ads to Use
              </Button>
            </div>
          </>
        ) : mediaTab === "drive_link" ? (
          <DriveLinkTab gdriveToken={gdriveToken} onRequestAuth={openGoogleDrivePicker} adAccountId={adAccountId}
            onImported={(creatives) => {
              const newAllCreatives = [...creatives.filter(c => !allCreatives.some(p => p.id === c.id)), ...allCreatives]
              setAllCreatives(newAllCreatives)
              
              setSelected(prev => {
                const nextIds = new Set([...prev, ...creatives.map(c => c.id)])
                const finalSelectedIds = Array.from(nextIds)
                const selectedObjects = newAllCreatives.filter(c => nextIds.has(c.id))
                Promise.resolve().then(() => {
                  onConfirm(finalSelectedIds, selectedObjects)
                  onClose()
                })
                return nextIds
              })
            }} />
        ) : mediaTab === "gdrive" || mediaTab === "drive_browser" ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {gdriveQueue.length > 0 ? (
              /* Import progress list */
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium">
                    {gdriveImporting ? "Importing from Google Drive..." : `Done — ${gdriveQueue.filter(q => q.status === "done").length}/${gdriveQueue.length} imported`}
                  </p>
                  {!gdriveImporting && (
                    <button onClick={() => { setGdriveQueue([]); setMediaTab("library") }}
                      className="text-xs text-link hover:underline">
                      View in library
                    </button>
                  )}
                </div>
                {gdriveQueue.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 border rounded-lg bg-muted/20">
                    <IconBrandGoogleDrive className="size-4 shrink-0 text-[#4285F4]" />
                    <span className="text-sm flex-1 truncate">{f.name}</span>
                    {f.status === "pending" && <span className="text-xs text-muted-foreground">Waiting...</span>}
                    {f.status === "importing" && <IconLoader2 className="size-4 animate-spin text-primary shrink-0" />}
                    {f.status === "done" && <IconCheck className="size-4 text-green-500 shrink-0" />}
                    {f.status === "error" && (
                      <span className="text-xs text-destructive truncate max-w-[120px]" title={f.error}>{f.error}</span>
                    )}
                  </div>
                ))}
                {!gdriveImporting && (
                  <Button variant="outline" size="sm" className="w-full mt-2 gap-1.5" onClick={openGoogleDrivePicker}>
                    <IconBrandGoogleDrive className="size-3.5" />Import more files
                  </Button>
                )}
              </div>
            ) : driveFilesLoading || driveFiles.length > 0 ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-b">
                  <div>
                    <p className="text-sm font-medium">Google Drive files</p>
                    <p className="text-xs text-muted-foreground">Recent images and videos from your Drive</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {driveFiles.length > 0 && (
                      <>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-muted-foreground/30"
                            checked={selectedDriveFileIds.size > 0 && selectedDriveFileIds.size === driveFiles.length}
                            ref={el => {
                              if (el) el.indeterminate = selectedDriveFileIds.size > 0 && selectedDriveFileIds.size < driveFiles.length
                            }}
                            onChange={e => setSelectedDriveFileIds(e.target.checked ? new Set(driveFiles.map(file => file.id)) : new Set())}
                          />
                          Select all
                        </label>
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={gdriveImporting || selectedDriveFileIds.size === 0}
                          onClick={() => importGoogleDriveFiles(driveFiles.filter(file => selectedDriveFileIds.has(file.id)))}
                        >
                          {gdriveImporting ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconBrandGoogleDrive className="size-3.5" />}
                          Import selected{selectedDriveFileIds.size ? ` (${selectedDriveFileIds.size})` : ""}
                        </Button>
                      </>
                    )}
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={openGoogleDrivePicker} disabled={driveFilesLoading || gdriveImporting}>
                      {driveFilesLoading ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconRefresh className="size-3.5" />}
                      Refresh
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {driveFilesLoading ? (
                    <div className="h-40 flex items-center justify-center">
                      <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : driveFiles.length === 0 ? (
                    <div className="h-40 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <IconBrandGoogleDrive className="size-8 opacity-40" />
                      <p className="text-sm">No image or video files found</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {driveFiles.map(file => {
                        const isVideo = file.mimeType.startsWith("video/")
                        const sizeMb = file.size ? `${(Number(file.size) / 1024 / 1024).toFixed(1)} MB` : ""
                        const isDriveFileSelected = selectedDriveFileIds.has(file.id)
                        return (
                          <div key={file.id} className={cn("flex items-center gap-3 p-2.5 border rounded-lg bg-background hover:bg-muted/20", isDriveFileSelected && "border-primary/50 bg-primary/5")}>
                            <input
                              type="checkbox"
                              className="size-4 rounded border-muted-foreground/30 shrink-0"
                              checked={isDriveFileSelected}
                              onChange={e => {
                                setSelectedDriveFileIds(prev => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(file.id)
                                  else next.delete(file.id)
                                  return next
                                })
                              }}
                            />
                            <div className="size-11 rounded-md bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                              {file.thumbnailLink ? (
                                <img src={file.thumbnailLink} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : isVideo ? (
                                <IconVideo className="size-5 text-muted-foreground/50" />
                              ) : (
                                <IconPhoto className="size-5 text-muted-foreground/50" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate" title={file.name}>{file.name}</p>
                              <p className="text-xs text-muted-foreground">{isVideo ? "Video" : "Image"}{sizeMb ? ` · ${sizeMb}` : ""}</p>
                            </div>
                            <Button size="sm" className="gap-1.5" disabled={gdriveImporting} onClick={() => importGoogleDriveFiles([file])}>
                              Import
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Empty state */
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <div className="size-16 rounded-2xl bg-muted/40 flex items-center justify-center">
                  <IconBrandGoogleDrive className="size-8 text-[#4285F4]" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">Import from Google Drive</p>
                  <p className="text-xs mt-1">Select images or videos — they'll be uploaded to Meta and added to your library</p>
                </div>
                {gdriveToken ? (
                  <div className="flex flex-col items-center gap-2 mt-1">
                    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                      <div className="size-1.5 rounded-full bg-green-500" />
                      Connected to Google Drive
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="gap-1.5" onClick={openGoogleDrivePicker}>
                        <IconBrandGoogleDrive className="size-3.5" />Open Google Drive
                      </Button>
                      <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={async () => {
                        clearCachedToken()
                        gdriveTokenRef.current = null
                        setGdriveToken(null)
                        setGdriveEmail(null)
                        await fetch("/api/google/connect", { method: "DELETE" }).catch(() => {})
                      }}>
                        Disconnect
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" className="mt-1 gap-1.5" onClick={openGoogleDrivePicker}>
                    <IconBrandGoogleDrive className="size-3.5" />Connect Google Drive
                  </Button>
                )}
                {gdriveError && (
                  <p className="text-xs text-destructive mt-1 text-center max-w-xs">{gdriveError}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <IconSettings className="size-10 opacity-30" />
            <p className="text-sm">Connect more integrations</p>
            <p className="text-xs">Dropbox, OneDrive, S3, etc.</p>
          </div>
        )}

        {/* Paste list dialog */}
        {pasteOpen && (
          <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setPasteOpen(false)}>
            <div className="bg-popover border rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold mb-2">Paste creative IDs</h3>
              <p className="text-xs text-muted-foreground mb-3">One ID per line, or comma-separated. Matching media will be auto-selected.</p>
              <textarea
                autoFocus
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
                placeholder="123456789012345&#10;987654321098765&#10;..."
              />
              <div className="flex justify-end gap-2 mt-3">
                <Button variant="outline" size="sm" onClick={() => setPasteOpen(false)}>Cancel</Button>
                <Button size="sm" disabled={!pasteText.trim()} onClick={handlePasteSubmit}>Match</Button>
              </div>
            </div>
          </div>
        )}

        {/* Hidden file inputs for upload */}
        <input
          ref={uploadFileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={e => { handleUpload(e.target.files); e.target.value = "" }}
        />
        <input
          ref={uploadFolderRef}
          type="file"
          accept="image/*,video/*"
          multiple
          // @ts-ignore
          webkitdirectory=""
          className="hidden"
          onChange={e => { handleUpload(e.target.files); e.target.value = "" }}
        />
      </DialogContent>

      {/* Detail Sheet — this markup moved to components/shared/media-detail-sheet.tsx
          verbatim and is now rendered by all three surfaces (Portal Vault here, All
          Assets and Portal Media on the assets page). Portal Vault passes no
          `assignedTo`, which hides that section, and no `viewMediaHref`, so the URL is
          derived from `assetId` exactly as it was here. */}
      <MediaDetailSheet
        open={portalDetailOpen}
        onOpenChange={setPortalDetailOpen}
        file={portalDetailFile}
      />
    </Dialog>
  )
}
