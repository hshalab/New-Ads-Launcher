"use client"
import dynamic from "next/dynamic"
import { LaunchProgressDialog, LaunchPhase } from "@/components/launch/launch-progress-dialog"

const CreateCampaignModal = dynamic(
  () => import("@/components/ads-manager/create-flow/CreateCampaignModal").then(m => m.CreateCampaignModal),
  { ssr: false }
)

import { useState, useEffect, useRef, useCallback, useMemo, Suspense, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAdAccount } from "@/lib/ad-account-context"
import { useOrg } from "@/lib/org-context"
import { cn, proxyFbImage } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { LoadMoreButton } from "@/components/ui/load-more-button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  IconSearch, IconX, IconPlus, IconUpload, IconFolder,
  IconRefresh, IconLayoutGrid, IconTable, IconRocket,
  IconCalendar, IconEye, IconBookmark, IconChevronDown,
  IconLoader2, IconPhoto, IconVideo, IconCopy, IconTrash,
  IconCheck, IconSettings, IconTextCaption, IconWorld,
  IconPlayerPlay, IconAlertCircle, IconAlertTriangle,
  IconCircleCheck, IconDotsVertical, IconMinus, IconBrandMeta,
  IconExternalLink, IconBrandFacebook, IconBrandInstagram,
  IconUsers, IconLanguage, IconStack2, IconStack3, IconLayout,
  IconClock, IconPencil, IconInfoCircle, IconArrowsUpDown,
  IconSelector, IconChevronUp,
  IconFileDescription, IconBuildingStore, IconShoppingBag, IconBox,
  IconBrandGoogleDrive, IconClipboard, IconDots, IconBrandMeta as IconMetaBadge,
  IconArrowsSort,
  IconBrandTiktok, IconBrandSnapchat, IconBrandReddit, IconBrandLinkedin,
  IconDownload, IconThumbUp, IconMessageCircle, IconShare3,
  IconArrowLeft, IconArrowRight,
  IconHeart, IconBookmark as IconBookmarkOutline, IconSend, IconArrowUp, IconArrowDown,
  IconHome, IconUser, IconBrandFacebook as IconFb,
  IconVolumeOff, IconMaximize, IconPlayerPause, IconPlus as IconPlusFollow,
  IconCurrencyDollar, IconTarget, IconTrendingUp,
  IconFilter,
  IconChevronLeft, IconChevronRight,
  IconSparkles,
} from "@tabler/icons-react"
import { CreativeCardMedia } from "@/components/creative-card-media"
import { SheetsImportDialog, type ImportedRow } from "@/components/sheets-import-dialog"
import { Creative } from "@/types/creative"
import { DynamicMediaToggle } from "@/components/ui/dynamic-media-toggle"
import { LoadMediaModal } from "@/components/shared/load-media-modal"
import { LoadCopyModal } from "@/components/shared/load-copy-modal"
import { formatNumberShort, formatCurrency } from "@/lib/format"
import { useLaunchBatchesRealtime } from "@/hooks/use-launch-batches-realtime"
import { isLaunchable } from "@/lib/creative-readiness"

const Tip = ({ text, children, className }: { text: string; children: ReactNode; className?: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span title={text} className={cn("inline-block pointer-events-auto", className)}>{children}</span>
    </TooltipTrigger>
    <TooltipContent side="top" align="center" className="text-xs font-normal">
      {text}
    </TooltipContent>
  </Tooltip>
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdSet { id: string; name: string; status: string; effective_status: string; campaign_id: string; campaign_name?: string; daily_budget?: string }
interface IgAccount { id: string; username?: string; profile_pic?: string }
interface FacebookPage { id: string; name: string; picture?: { data: { url: string } }; instagram_accounts?: { data: IgAccount[] } }
interface AdAccountItem { id: string; name: string; account_id?: string }
interface SitelinkItem { title: string; url: string }
interface TableRow { id: string; creative: Creative | null; adName: string; primaryText: string; headline: string; description: string; adSetIds: string[]; primaryTextVariations?: string[]; headlineVariations?: string[]; descriptionVariations?: string[]; cta?: string; webLink?: string; urlTags?: string; promoCode?: string; launchAsActive?: boolean; pageId?: string; igId?: string; sitelinks?: SitelinkItem[]; partnership?: PartnershipState; multilanguage?: MultilanguageState; catalog?: CatalogAdsState; schedule?: { start: string; end?: string } }
interface CreatedAd { adId: string; adSetId: string; adSetName: string; creativeId?: string; fileName?: string; thumbnailUrl?: string | null; mediaType?: "image" | "video"; mode?: string; multiGroup?: string; flexibleAd?: string; carousel?: string }
interface LaunchMeta { cta: string; webLink: string; headline: string; primaryText: string; pageId: string; pageName?: string; adAccountId: string; adAccountName: string; timestamp: string }
interface LaunchResult { created: number; failed: number; durationMs: number; errors: { adSetId: string; fileName: string; error: string }[]; scheduled?: { at: string; end: string | null } | null; scheduleError?: string | null; auditError?: string | null; createdAds: CreatedAd[]; batchId?: string | null; launchMeta?: LaunchMeta }
interface UploadItem {
  id: string
  file: File
  filename: string
  fileSize: number
  fileTypeShort: string
  status: "uploading" | "completed" | "cancelled" | "error"
  uploaded: number
  speed: number
  eta: number
  error?: string
  xhr?: XMLHttpRequest
  startedAt: number
  creativeId?: string
}

interface PartnershipState {
  enabled: boolean
  partnerPageId: string
  partnerIgId: string
  displayMode: "dynamic" | "both" | "first"
  partnerFirstInDisplay: boolean
}
interface LanguageTranslation {
  language: string
  primaryText: string
  headline: string
  description: string
}
interface MultilanguageState {
  enabled: boolean
  defaultLanguage: string
  translations: LanguageTranslation[]
}
type AdFormatType = "single" | "collection" | "catalog"
interface AdFormatState {
  type: AdFormatType
}
interface CollectionAdsState {
  enabled: boolean
  templateType: "storefront" | "lookbook" | "customer_acquisition"
  catalogId: string
  catalogName: string
  catalogVertical: string
  productSetId: string
  productSetName: string
  productCount: number
  order: "dynamic" | "specific"
  productHeadlineChips: string[]
  productDescriptionChips: string[]
  ieHeadline: string
  destinationUrl: string
}
interface CatalogItem { id: string; name: string; product_count?: number; vertical?: string }
interface ProductSetItem { id: string; name: string; product_count?: number }
interface CatalogProductItem { id: string; name?: string; image_url?: string; price?: string; brand?: string }

interface CarouselCard {
  creativeId: string
  headline?: string
  description?: string
  linkUrl?: string
  cta?: string
}
interface CarouselAd {
  id: string
  name: string
  cards: CarouselCard[]
  showAsCollectionTiles: boolean
  showAsSingleMedia: boolean
}
interface CarouselAdsState {
  enabled: boolean
  carousels: CarouselAd[]
}

interface FlexibleGroup {
  id: string
  creativeIds: string[]
}
interface FlexibleAd {
  id: string
  name: string
  groups: FlexibleGroup[]
}
interface FlexibleAdsState {
  enabled: boolean
  flexibleAds: FlexibleAd[]
}

interface MultiPlacementGroup {
  id: string
  name: string
  creativeIds: string[]
  // optional manual placement mapping creativeId -> placement key
  placements?: Record<string, string[]>
}
interface MultiPlacementAdsState {
  enabled: boolean
  manualPlacements: boolean
  groups: MultiPlacementGroup[]
}

interface CatalogAdsState {
  enabled: boolean
  formatMode: "automatic" | "manual"
  format: "single" | "carousel"
  frameImageUrl: string
  dynamicMedia: {
    optimizedMediaSelection: boolean
    automaticVideoCropping: boolean
    prioritizeVideo: boolean
  }
  catalogId: string
  catalogName: string
  productSetId: string
  productSetName: string
  hideAutoCreatedSets: boolean
}

// Files currently mid-upload (by name:size), module-scoped so the guard survives even if
// React ends up dispatching a change/drop event against a stale or duplicate component
// fiber (observed in dev: two calls into handleUploadFiles for one file-picker interaction,
// each seeing an empty in-flight set because they belonged to different fiber instances of
// a component-level useRef). A module-level Set has exactly one instance for the whole tab,
// so it can't be duplicated by remounts. Two upload sessions racing over the same video get
// rejected by Meta with a generic "There was a problem uploading your video file" (code 6000).
const inFlightUploadKeys = new Set<string>()

// Available template variables for product fields (Meta DPA placeholders)
const PRODUCT_FIELD_OPTIONS = [
  { key: "product_name", label: "Product Name" },
  { key: "current_price", label: "Current Price" },
  { key: "sale_price", label: "Sale Price" },
  { key: "brand", label: "Brand" },
  { key: "description", label: "Description" },
]
interface LaunchBatch {
  id: string
  user_name: string
  launcher?: { avatar_url?: string } | null
  ad_account_id: string
  ad_account_name: string
  adset_ids: string[]
  adset_names: string[]
  creative_ids: string[]
  creative_thumbs: string[]
  primary_text: string
  headline: string
  cta?: string
  web_link?: string
  page_id?: string
  status: "success" | "partial" | "failed"
  total_ads: number
  failed_ads: number
  duration_ms: number
  created_at: string
  errors: any[]
  created_ads?: CreatedAd[]
  deleted_at?: string | null
}
interface ScheduledActivation {
  id: string
  ad_account_id: string
  ad_ids: string[]
  scheduled_at: string
  end_time?: string | null
  status: "pending" | "activated" | "paused" | "cancelled" | "failed"
  error?: string | null
  created_at: string
}

// Facebook ads-supported languages (Meta locale codes)
const FB_LANGUAGES = [
  { code: "en_US", name: "English (US)" },
  { code: "en_GB", name: "English (UK)" },
  { code: "es_ES", name: "Spanish (Spain)" },
  { code: "es_LA", name: "Spanish (Latin America)" },
  { code: "fr_FR", name: "French" },
  { code: "de_DE", name: "German" },
  { code: "it_IT", name: "Italian" },
  { code: "pt_BR", name: "Portuguese (Brazil)" },
  { code: "pt_PT", name: "Portuguese (Portugal)" },
  { code: "ja_JP", name: "Japanese" },
  { code: "ko_KR", name: "Korean" },
  { code: "zh_CN", name: "Chinese (Simplified)" },
  { code: "zh_TW", name: "Chinese (Traditional)" },
  { code: "vi_VN", name: "Vietnamese" },
  { code: "th_TH", name: "Thai" },
  { code: "ar_AR", name: "Arabic" },
  { code: "hi_IN", name: "Hindi" },
  { code: "id_ID", name: "Indonesian" },
  { code: "ms_MY", name: "Malay" },
  { code: "nl_NL", name: "Dutch" },
  { code: "pl_PL", name: "Polish" },
  { code: "ru_RU", name: "Russian" },
  { code: "tr_TR", name: "Turkish" },
  { code: "sv_SE", name: "Swedish" },
]

const CTA_OPTIONS = [
  { value: "LEARN_MORE", label: "Learn More" },
  { value: "SHOP_NOW", label: "Shop Now" },
  { value: "SIGN_UP", label: "Sign Up" },
  { value: "DOWNLOAD", label: "Download" },
  { value: "GET_OFFER", label: "Get Offer" },
  { value: "CONTACT_US", label: "Contact Us" },
  { value: "SUBSCRIBE", label: "Subscribe" },
  { value: "WATCH_MORE", label: "Watch More" },
  { value: "APPLY_NOW", label: "Apply Now" },
  { value: "ORDER_NOW", label: "Order Now" },
  { value: "GET_QUOTE", label: "Get Quote" },
  { value: "BOOK_TRAVEL", label: "Book Now" },
]

function formatDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60000)
  const secs = Math.round((ms % 60000) / 1000)
  return `${mins}min ${secs}s`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
}

// ─── Platform Status Popover ──────────────────────────────────────────────────

interface ServiceStatus { label: string; status: "operational" | "degraded" | "down" | "unknown" }

function PlatformStatusPopover() {
  const [open, setOpen] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(false)
  const [metaApi, setMetaApi] = useState<ServiceStatus>({ label: "Marketing API", status: "unknown" })
  const [adsManager, setAdsManager] = useState<ServiceStatus>({ label: "Ads Manager", status: "unknown" })
  const ref = useRef<HTMLDivElement>(null)

  const checkStatus = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/facebook/ad-accounts")
      const data = await res.json().catch(() => ({}))
      const ok = res.ok && data.connected !== false
      setMetaApi({ label: "Marketing API", status: ok ? "operational" : "degraded" })
      setAdsManager({ label: "Ads Manager", status: ok ? "operational" : "degraded" })
    } catch {
      setMetaApi({ label: "Marketing API", status: "down" })
      setAdsManager({ label: "Ads Manager", status: "down" })
    }
    setUpdatedAt(new Date())
    setLoading(false)
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // Check once on mount — polling every 5 min was hitting /api/facebook/ad-accounts too frequently
  useEffect(() => { checkStatus() }, [])

  const allOk = metaApi.status === "operational" && adsManager.status === "operational"

  const StatusBadge = ({ status }: { status: ServiceStatus["status"] }) => {
    if (status === "operational") return <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium"><IconCircleCheck className="size-3.5" />Operational</span>
    if (status === "degraded") return <span className="flex items-center gap-1 text-amber-500 text-xs font-medium"><IconAlertTriangle className="size-3.5" />Degraded</span>
    if (status === "down") return <span className="flex items-center gap-1 text-red-500 text-xs font-medium"><IconAlertCircle className="size-3.5" />Down</span>
    return <span className="text-xs text-muted-foreground">Checking...</span>
  }

  const minutesAgo = updatedAt ? Math.floor((Date.now() - updatedAt.getTime()) / 60000) : null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 hover:opacity-70 transition-opacity"
      >
        <div className={cn("size-1.5 rounded-full", allOk && updatedAt ? "bg-green-500" : "bg-muted-foreground/40")} />
        <span className="text-xs text-muted-foreground font-medium tracking-wide">Status</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-popover border rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="text-sm font-semibold">Platform Status</span>
            <div className="flex items-center gap-2">
              {minutesAgo !== null && (
                <span className="text-xs text-muted-foreground">Updated {minutesAgo}m ago</span>
              )}
              <button onClick={checkStatus} disabled={loading} className="hover:opacity-70 transition-opacity">
                <IconRefresh className={cn("size-3.5 text-muted-foreground", loading && "animate-spin")} />
              </button>
            </div>
          </div>

          <div className="px-4 py-3 space-y-3">
            {/* Meta API */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Meta API</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Ads Manager</span>
                  <StatusBadge status={adsManager.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Marketing API</span>
                  <StatusBadge status={metaApi.status} />
                </div>
              </div>
            </div>

            {/* Launcher */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Launcher</p>
              <div className="flex items-center justify-between">
                <span className="text-sm">App Server</span>
                <StatusBadge status="operational" />
              </div>
            </div>
          </div>

          {/* Links */}
          <div className="px-4 py-2.5 border-t flex flex-wrap gap-x-3 gap-y-1">
            <a href="https://metastatus.com" target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-0.5">
              <IconExternalLink className="size-3" />Meta Status
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Ad Account Dropdown ──────────────────────────────────────────────────────

function AdAccountDropdown({ accounts, selectedId, onSelect }: {
  accounts: AdAccountItem[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const selected = accounts.find(a => a.id === selectedId)

  const filtered = accounts.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.id.includes(search)
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="h-8 flex items-center gap-1.5 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-black dark:text-white hover:bg-zinc-50 dark:hover:bg-zinc-700/60 transition-colors min-w-[180px] max-w-[240px] text-sm"
        >
          <IconBrandMeta className="size-3.5 text-[#0064E0] shrink-0" />
          <span className="truncate flex-1 text-left">{selected?.name || "Select account..."}</span>
          <IconChevronDown className={cn("size-3.5 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-72 p-0 gap-0 overflow-hidden"
      >
        {/* Search */}
        <div className="px-3 pt-3 pb-2">
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search account..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/40 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
            />
          </div>
        </div>

        {/* Account list */}
        <div className="max-h-52 overflow-y-auto">
          {filtered.map(a => {
            const isSelected = a.id === selectedId
            return (
              <button
                key={a.id}
                onClick={() => { onSelect(a.id); setOpen(false); setSearch("") }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent transition-colors text-left",
                  isSelected && "bg-primary/5"
                )}
              >
                <div className="size-4 shrink-0">
                  {isSelected && <IconCheck className="size-4 text-primary" />}
                </div>
                <div className="size-5 rounded-full bg-[#0064E0]/10 flex items-center justify-center shrink-0">
                  <IconBrandMeta className="size-3 text-[#0064E0]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{a.id}</p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="border-t">
          <a href="/ad-accounts" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <IconPlus className="size-3.5" />
            Add or edit ad accounts
          </a>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Ad Profiles Modal ────────────────────────────────────────────────────────

function AdProfilesModal({
  open, onClose, pages,
  selectedPageId, selectedIgId,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  pages: FacebookPage[]
  selectedPageId: string
  selectedIgId: string
  onConfirm: (pageId: string, igId: string, igCache: Record<string, IgAccount[]>) => void
}) {
  const [search, setSearch] = useState("")
  const [showAvailableOnly, setShowAvailableOnly] = useState(false)
  const [localPageId, setLocalPageId] = useState(selectedPageId)
  const [localIgId, setLocalIgId] = useState(selectedIgId)
  const [igByPage, setIgByPage] = useState<Record<string, IgAccount[]>>({})
  const [igLoading, setIgLoading] = useState(false)

  const fetchIgAccounts = async (forceRefresh = false) => {
    if (pages.length === 0) return
    setIgLoading(true)
    try {
      const res = await fetch(`/api/facebook/page-instagram${forceRefresh ? "?refresh=true" : ""}`)
      if (res.ok) {
        const data = await res.json()
        const map: Record<string, IgAccount[]> = {}
        for (const r of (data.results || [])) {
          map[r.pageId] = r.igAccounts || []
        }
        setIgByPage(map)
      }
    } catch {}
    setIgLoading(false)
  }

  useEffect(() => {
    if (open) {
      setLocalPageId(selectedPageId)
      setLocalIgId(selectedIgId)
      fetchIgAccounts()
    }
  }, [open, selectedPageId, selectedIgId])

  const [igExpanded, setIgExpanded] = useState<Record<string, boolean>>({})
  const [fetchTime, setFetchTime] = useState<number | null>(null)

  const fetchIgAccountsTimed = async () => {
    const t = Date.now()
    await fetchIgAccounts(true)
    setFetchTime(Date.now() - t)
  }

  const filtered = pages.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.id.includes(search)
  )

  const totalIg = Object.values(igByPage).reduce((n, arr) => n + arr.length, 0)

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl p-0 flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-semibold">Ad Profiles</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            These pages will be used as the profiles to launch your ads under. Missing pages or Instagram accounts?
          </p>
          <div className="flex items-center gap-2 mt-1 text-xs">
            <a href="/connect" className="text-primary hover:underline flex items-center gap-0.5">
              Re-authenticate <IconExternalLink className="size-3 ml-0.5" />
            </a>
            <span className="text-muted-foreground">|</span>
            <a href="/connect" className="text-primary hover:underline flex items-center gap-0.5">
              <IconBrandMeta className="size-3 mr-0.5" /> See granted permissions
            </a>
          </div>
          {/* Search + filters */}
          <div className="flex items-center gap-2 mt-3">
            <div className="relative flex-1">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search profiles..."
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/40 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
              />
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 h-8 shrink-0" onClick={fetchIgAccountsTimed} disabled={igLoading}>
              <IconRefresh className={cn("size-3.5", igLoading && "animate-spin")} />Refresh
            </Button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={showAvailableOnly} onChange={e => setShowAvailableOnly(e.target.checked)} className="rounded size-3" />
              Show available only
            </label>
          </div>
        </div>

        {/* Section sub-header */}
        <div className="px-5 py-2 border-b shrink-0 flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground flex-1">
            Ad Account Pages ({pages.length} Pages, {igLoading ? "..." : totalIg} Instagrams)
          </span>
          {fetchTime !== null && !igLoading && (
            <span className="text-xs text-muted-foreground">Refreshed in {(fetchTime / 1000).toFixed(1)}s</span>
          )}
        </div>

        {/* Pages list */}
        <div className="overflow-y-auto px-3 py-2 flex-1 min-h-0">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">No pages found</div>
          ) : filtered.map(page => {
            const isPageSelected = localPageId === page.id
            const igAccounts = igByPage[page.id] || []
            const igCount = igAccounts.length + 1 // +1 for "Use Facebook Page"
            const expanded = igExpanded[page.id] !== false // default expanded

            return (
              <div key={page.id} className={cn("border rounded-xl mb-2 overflow-hidden bg-background transition-colors", isPageSelected ? "border-primary/60" : "border-border")}>

                {/* "Facebook Page" type label */}
                <div className="flex items-center gap-1 px-3 pt-2 pb-0">
                  <IconBrandMeta className="size-3 text-[#0064E0]" />
                  <span className="text-xs text-muted-foreground font-medium">Facebook Page</span>
                </div>

                {/* Page main row */}
                <div
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => {
                    setLocalPageId(page.id)
                  }}
                >
                  {/* Checkbox */}
                  <div className={cn(
                    "size-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                    isPageSelected ? "bg-primary border-primary" : "border-muted-foreground/40 bg-background"
                  )}>
                    {isPageSelected && <IconCheck className="size-3 text-primary-foreground" />}
                  </div>
                  {page.picture?.data?.url ? (
                    <img src={page.picture.data.url} className="size-9 rounded-full shrink-0 object-cover" alt="" />
                  ) : (
                    <div className="size-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-muted-foreground">{page.name.slice(0, 1)}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold truncate">{page.name}</span>
                      <IconCircleCheck className="size-3.5 text-primary shrink-0" />
                      <IconExternalLink className="size-3 text-muted-foreground/50 shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground">{page.id}</p>
                  </div>
                </div>

                {/* Associated Instagram Accounts — collapsible, always show */}
                <div className="border-t">
                  <button
                    className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/20 transition-colors"
                    onClick={() => setIgExpanded(prev => ({ ...prev, [page.id]: !expanded }))}
                  >
                    <IconChevronDown className={cn("size-3 transition-transform", !expanded && "-rotate-90")} />
                    <IconBrandInstagram className="size-3 text-[#E1306C]" />
                    <span>Associated Instagram Accounts ({igLoading ? "..." : igAccounts.length})</span>
                  </button>

                  {expanded && (
                    <div className="px-3 pb-2 space-y-1">
                      {/* Use Facebook Page */}
                      <div
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-muted/40 transition-colors",
                          localIgId === `fb_${page.id}` && "bg-primary/8"
                        )}
                        onClick={() => setLocalIgId(`fb_${page.id}`)}
                      >
                        <div className={cn(
                          "size-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                          localIgId === `fb_${page.id}` ? "bg-primary border-primary" : "border-muted-foreground/40 bg-background"
                        )}>
                          {localIgId === `fb_${page.id}` && <IconCheck className="size-3 text-primary-foreground" />}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <IconBrandMeta className="size-4 text-[#0064E0]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">Use Facebook Page</p>
                          <p className="text-xs text-muted-foreground">{page.id}</p>
                        </div>
                      </div>

                      {/* Real IG accounts */}
                      {igAccounts.map(ig => (
                        <div
                          key={ig.id}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-muted/40 transition-colors",
                            localIgId === ig.id && "bg-primary/8"
                          )}
                          onClick={() => setLocalIgId(ig.id)}
                        >
                          <div className={cn(
                            "size-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                            localIgId === ig.id ? "bg-primary border-primary" : "border-muted-foreground/40 bg-background"
                          )}>
                            {localIgId === ig.id && <IconCheck className="size-3 text-primary-foreground" />}
                          </div>
                          {ig.profile_pic ? (
                            <img src={ig.profile_pic} className="size-7 rounded-full object-cover shrink-0" alt="" />
                          ) : (
                            <div className="size-7 rounded-full bg-gradient-to-br from-purple-400 to-rose-400 flex items-center justify-center shrink-0">
                              <IconBrandInstagram className="size-3.5 text-white" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">@{ig.username || ig.id}</p>
                            <p className="text-xs text-muted-foreground">{ig.id}</p>
                          </div>
                        </div>
                      ))}

                      {igLoading && igAccounts.length === 0 && (
                        <p className="text-xs text-muted-foreground px-3 py-1">Loading...</p>
                      )}
                      {!igLoading && igAccounts.length === 0 && (
                        <p className="text-xs text-muted-foreground px-3 py-1">No Instagram accounts associated</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t shrink-0">
          <Button
            className="w-full"
            onClick={() => { onConfirm(localPageId, localIgId, igByPage); onClose() }}
          >
            Confirm Selection
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Partnership Ads Modal ────────────────────────────────────────────────────

function PartnershipAdsModal({
  open, onClose, pages, selectedPageId, selectedIgId, igAccountCache,
  value, onConfirm,
}: {
  open: boolean
  onClose: () => void
  pages: FacebookPage[]
  selectedPageId: string
  selectedIgId: string
  igAccountCache: Record<string, IgAccount[]>
  value: PartnershipState
  onConfirm: (v: PartnershipState) => void
}) {
  const [local, setLocal] = useState<PartnershipState>(value)
  const [partnerSearchOpen, setPartnerSearchOpen] = useState(false)
  const [partnerSearch, setPartnerSearch] = useState("")
  const [manualPageId, setManualPageId] = useState("")

  useEffect(() => { if (open) setLocal(value) }, [open, value])

  const selectedPage = pages.find(p => p.id === selectedPageId)
  const isFbActor = selectedIgId.startsWith("fb_")
  const igAccount = Object.values(igAccountCache).flat().find(ig => ig.id === selectedIgId)
  const igLabel = isFbActor ? `@${selectedPage?.name || ""}` : (igAccount?.username ? `@${igAccount.username}` : selectedIgId)

  const partnerPage = pages.find(p => p.id === local.partnerPageId)
  const partnerIg = Object.values(igAccountCache).flat().find(ig => ig.id === local.partnerIgId)
  const partnerIsFbActor = local.partnerIgId.startsWith("fb_")
  const hasPartner = !!local.partnerPageId

  // Identities — order based on swap state
  const identityA = local.partnerFirstInDisplay && hasPartner
    ? { page: partnerPage, igId: local.partnerIgId, isFb: partnerIsFbActor, ig: partnerIg, isManual: !partnerPage }
    : { page: selectedPage, igId: selectedIgId, isFb: isFbActor, ig: igAccount, isManual: false }
  const identityB = local.partnerFirstInDisplay && hasPartner
    ? { page: selectedPage, igId: selectedIgId, isFb: isFbActor, ig: igAccount, isManual: false }
    : { page: partnerPage, igId: local.partnerIgId, isFb: partnerIsFbActor, ig: partnerIg, isManual: hasPartner && !partnerPage }

  const availablePartners = pages.filter(p =>
    p.id !== selectedPageId &&
    (!partnerSearch || p.name.toLowerCase().includes(partnerSearch.toLowerCase()) || p.id.includes(partnerSearch))
  )

  const addPartner = (pageId: string, igId?: string) => {
    setLocal(s => ({ ...s, partnerPageId: pageId, partnerIgId: igId || `fb_${pageId}` }))
    setPartnerSearchOpen(false)
    setPartnerSearch("")
    setManualPageId("")
  }
  const removePartner = () => {
    setLocal(s => ({ ...s, partnerPageId: "", partnerIgId: "", partnerFirstInDisplay: false }))
  }
  const swapIdentities = () => {
    if (!hasPartner) return
    setLocal(s => ({ ...s, partnerFirstInDisplay: !s.partnerFirstInDisplay }))
  }
  const toggleEnabled = () => {
    setLocal(s => ({ ...s, enabled: !s.enabled }))
  }
  const handleSave = () => {
    onConfirm(hasPartner ? local : { ...local, enabled: false })
    onClose()
  }

  const OPTIONS = [
    { value: "dynamic" as const, title: "Dynamic identity.", desc: "Uses the version that's likely to perform best" },
    { value: "both" as const, title: "Both identities in the header.", desc: "Showcases your partnership and cross-promotes accounts" },
    { value: "first" as const, title: "First identity only in the header.", desc: "Displaying the first identity leverages your partner's voice" },
  ]

  const renderIdentityCell = (id: typeof identityA, label: "Facebook" | "Instagram") => (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2 min-h-[20px]">
        <div className="flex items-center gap-1.5">
          {label === "Facebook"
            ? <IconBrandMeta className="size-3.5 text-[#0064E0]" />
            : <IconBrandInstagram className="size-3.5 text-[#E1306C]" />}
          <span className="text-sm font-medium">{label}</span>
        </div>
      </div>
      {label === "Facebook" ? (
        <div className="w-full flex items-center gap-2 px-2.5 py-2 border rounded-lg bg-background">
          {id.page?.picture?.data?.url ? (
            <img src={id.page.picture.data.url} className="size-5 rounded-full shrink-0 object-cover" alt="" />
          ) : (
            <div className="size-5 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-emerald-700">{(id.page?.name || id.igId)?.slice(0, 1) || "?"}</span>
            </div>
          )}
          <span className="flex-1 text-sm truncate text-left">
            {id.page?.name || (id.isManual ? `Page ${id.igId}` : "—")}
          </span>
        </div>
      ) : (
        <div className="w-full flex items-center gap-2 px-2.5 py-2 border rounded-lg bg-background">
          {id.ig?.profile_pic && !id.isFb ? (
            <img src={id.ig.profile_pic} className="size-5 rounded-full shrink-0 object-cover" alt="" />
          ) : (
            <div className="size-5 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
              <IconBrandInstagram className="size-3 text-[#E1306C]" />
            </div>
          )}
          <span className="flex-1 text-sm truncate text-left">
            {id.isFb ? `Use ${id.page?.name || "Facebook Page"}` : (id.ig?.username ? `@${id.ig.username}` : id.igId || "—")}
          </span>
        </div>
      )}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-semibold">Partnership Ads</DialogTitle>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Info card */}
          <div className="border rounded-xl p-3 flex items-start gap-3">
            <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <IconUsers className="size-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Partnership ads</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select a partner identity to activate partnership ads for this launch. Searching partners for {igLabel || `@${selectedPage?.name || "Use Facebook Page"}`}.
              </p>
            </div>
          </div>

          {/* First Identity */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-muted-foreground">First Identity {local.partnerFirstInDisplay && hasPartner && <span className="text-primary">(Partner)</span>}</p>
            </div>
            <div className="border rounded-xl overflow-hidden">
              <div className="grid grid-cols-2 divide-x">
                {renderIdentityCell(identityA, "Facebook")}
                {renderIdentityCell(identityA, "Instagram")}
              </div>
            </div>
          </div>

          {/* Second Identity */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-muted-foreground">Second Identity {local.partnerFirstInDisplay && hasPartner && <span className="text-muted-foreground">(You)</span>}</p>
              <div className="flex items-center gap-3 text-xs">
                <button
                  onClick={swapIdentities}
                  disabled={!hasPartner}
                  className={cn(
                    "flex items-center gap-0.5 transition-colors",
                    hasPartner ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/40 cursor-not-allowed"
                  )}
                >
                  <IconArrowsUpDown className="size-3" />Swap
                </button>
                <button
                  onClick={removePartner}
                  disabled={!hasPartner}
                  className={cn(
                    "flex items-center gap-0.5 transition-colors",
                    hasPartner ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground/40 cursor-not-allowed"
                  )}
                >
                  <IconX className="size-3" />Remove
                </button>
              </div>
            </div>

            {hasPartner ? (
              <div className="border rounded-xl overflow-hidden">
                <div className="grid grid-cols-2 divide-x">
                {renderIdentityCell(identityB, "Facebook")}
                {renderIdentityCell(identityB, "Instagram")}
                </div>
              </div>
            ) : !partnerSearchOpen ? (
              <button
                onClick={() => setPartnerSearchOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 py-3 border-2 border-dashed rounded-xl text-sm text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors"
              >
                <IconPlus className="size-4" />Add Partnership Identity
              </button>
            ) : (
              <div className="border rounded-xl p-3 space-y-3 bg-muted/20">
                {/* Search from connected pages */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">From your connected pages</p>
                  <div className="relative mb-2">
                    <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                    <input
                      autoFocus
                      value={partnerSearch}
                      onChange={e => setPartnerSearch(e.target.value)}
                      placeholder="Search page name or ID..."
                      className="w-full pl-8 pr-3 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto bg-background rounded-lg border">
                    {availablePartners.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-muted-foreground">No other pages available</div>
                    ) : availablePartners.map(p => (
                      <button
                        key={p.id}
                        onClick={() => addPartner(p.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/40 text-left transition-colors"
                      >
                        {p.picture?.data?.url ? (
                          <img src={p.picture.data.url} className="size-6 rounded-full shrink-0 object-cover" alt="" />
                        ) : (
                          <div className="size-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold">{p.name.slice(0, 1)}</span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.id}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Manual page ID */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Or enter Partner Page ID</p>
                  <div className="flex gap-2">
                    <input
                      value={manualPageId}
                      onChange={e => setManualPageId(e.target.value)}
                      placeholder="e.g. 123456789012345"
                      className="flex-1 px-3 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    />
                    <Button size="sm" disabled={!/^\d{5,}$/.test(manualPageId.trim())} onClick={() => addPartner(manualPageId.trim())}>
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Partner page must have authorized this app or be a public page.</p>
                </div>

                <div className="flex justify-end">
                  <button onClick={() => setPartnerSearchOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Choose which identities */}
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <p className="text-sm font-semibold">Choose which identities to display</p>
              <div className="relative group">
                <IconInfoCircle className="size-3.5 text-muted-foreground cursor-help" />
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-64 px-3 py-2 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                  Control how identities are displayed in your partnership ads. Dynamic will adapt based on the platform and placement.
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 size-2 bg-zinc-900 dark:bg-zinc-800 rotate-45" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                {OPTIONS.map(opt => (
                  <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
                    <div className={cn(
                      "size-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                      local.displayMode === opt.value ? "border-primary" : "border-muted-foreground/30"
                    )}>
                      {local.displayMode === opt.value && <div className="size-2 rounded-full bg-primary" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{opt.title}</p>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </div>
                    <input type="radio" className="sr-only" checked={local.displayMode === opt.value} onChange={() => setLocal(s => ({ ...s, displayMode: opt.value }))} />
                  </label>
                ))}
              </div>
              <div className="border-2 border-dashed rounded-xl flex items-center justify-center text-center text-sm p-4 min-h-[140px]">
                {!hasPartner || !local.enabled ? (
                  <span className="text-muted-foreground/60">Enable partnership ads to see preview</span>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Ad header will show:</p>
                    {local.displayMode === "first" ? (
                      <p className="text-sm font-semibold">{identityA.page?.name || "First Identity"}</p>
                    ) : (
                      <p className="text-sm font-semibold">
                        {identityA.page?.name || "First"} <span className="text-muted-foreground font-normal">×</span> {identityB.page?.name || "Partner"}
                      </p>
                    )}
                    {local.displayMode === "dynamic" && <p className="text-xs text-muted-foreground">(Meta will pick best variant)</p>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t bg-background shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status</span>
            <button
              onClick={toggleEnabled}
              disabled={!hasPartner}
              className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                local.enabled && hasPartner ? "bg-primary" : "bg-muted-foreground/30",
                !hasPartner && "opacity-50 cursor-not-allowed")}
            >
              <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                local.enabled && hasPartner ? "translate-x-4" : "translate-x-0.5")} />
            </button>
            <span className="text-xs text-muted-foreground">
              {!hasPartner ? "No partner selected" : local.enabled ? "Partnership active" : "Partnership paused"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave}>Save Confirm</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Multilanguage Ads Modal ──────────────────────────────────────────────────

function MultilanguageAdsModal({
  open, onClose, value, onConfirm,
  basePrimaryText, baseHeadline, baseDescription,
}: {
  open: boolean
  onClose: () => void
  value: MultilanguageState
  onConfirm: (v: MultilanguageState) => void
  basePrimaryText: string
  baseHeadline: string
  baseDescription: string
}) {
  const [local, setLocal] = useState<MultilanguageState>(value)
  const [collapsed, setCollapsed] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [langSearch, setLangSearch] = useState("")

  useEffect(() => { if (open) { setLocal(value); setPickerOpen(false); setLangSearch("") } }, [open, value])

  const filteredLangs = FB_LANGUAGES.filter(l =>
    l.code !== local.defaultLanguage &&
    (!langSearch || l.name.toLowerCase().includes(langSearch.toLowerCase()) || l.code.toLowerCase().includes(langSearch.toLowerCase()))
  )

  const addLanguage = (code: string) => {
    setLocal(s => ({
      ...s,
      translations: [...s.translations, { language: code, primaryText: "", headline: "", description: "" }],
    }))
  }
  const removeLanguage = (code: string) => {
    setLocal(s => ({ ...s, translations: s.translations.filter(t => t.language !== code) }))
  }
  const toggleLanguage = (code: string) => {
    if (local.translations.some(t => t.language === code)) removeLanguage(code)
    else addLanguage(code)
  }
  const updateTranslation = (code: string, field: keyof Omit<LanguageTranslation, "language">, val: string) => {
    setLocal(s => ({
      ...s,
      translations: s.translations.map(t => t.language === code ? { ...t, [field]: val } : t),
    }))
  }
  const toggleEnabled = () => setLocal(s => ({ ...s, enabled: !s.enabled }))
  const handleSave = () => {
    const hasTranslations = local.translations.length > 0
    onConfirm(hasTranslations ? local : { ...local, enabled: false })
    onClose()
  }

  const langName = (code: string) => FB_LANGUAGES.find(l => l.code === code)?.name || code

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-semibold">Multi-Language Settings</DialogTitle>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
          <div className="border rounded-xl overflow-hidden">
            {/* Section header */}
            <button
              onClick={() => setCollapsed(c => !c)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <IconLanguage className="size-4" />
                <span className="text-sm font-semibold">Multi-Language Ads</span>
                <div className="relative group">
                  <IconInfoCircle className="size-3.5 text-muted-foreground cursor-help" />
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-64 px-3 py-2 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none text-left">
                    Provide translations of your ad text. Meta will show the right version based on viewer language; otherwise the default is used.
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 size-2 bg-zinc-900 dark:bg-zinc-800 rotate-45" />
                  </div>
                </div>
              </div>
              {collapsed
                ? <IconChevronDown className="size-4 text-muted-foreground" />
                : <IconChevronUp className="size-4 text-muted-foreground" />}
            </button>

            {!collapsed && (
              <div className="border-t">
                {/* Language Templates */}
                <div className="bg-muted/20 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <IconFileDescription className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Language Templates</span>
                  </div>
                </div>

                {/* Default Language */}
                <div className="px-4 py-4 space-y-3 border-t">
                  <div>
                    <label className="text-sm font-semibold block mb-1.5">Default Language</label>
                    <Select value={local.defaultLanguage} onValueChange={v => setLocal(s => ({ ...s, defaultLanguage: v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FB_LANGUAGES.filter(l => !local.translations.some(t => t.language === l.code)).map(l => (
                          <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      This is the primary language for your ad. It will be shown when viewer's language doesn't match any of your translations.
                    </p>
                  </div>

                  {/* Multi-select language picker */}
                  <div className="border rounded-xl overflow-hidden">
                    {/* Toggle header */}
                    <button
                      onClick={() => setPickerOpen(o => !o)}
                      className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Select Languages to Add</span>
                        {local.translations.length > 0 && (
                          <span className="text-xs bg-primary/10 text-primary border border-primary/20 rounded-full px-1.5 py-0.5 font-semibold leading-none">{local.translations.length} selected</span>
                        )}
                      </div>
                      {pickerOpen
                        ? <IconChevronUp className="size-4 text-muted-foreground" />
                        : <IconChevronDown className="size-4 text-muted-foreground" />}
                    </button>

                    {pickerOpen && (
                      <div className="border-t p-3 space-y-2.5">
                        {/* Chips */}
                        {local.translations.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {local.translations.map(t => (
                              <span key={t.language} className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-full text-xs font-medium">
                                {langName(t.language)}
                                <button onClick={() => removeLanguage(t.language)} className="hover:text-destructive transition-colors ml-0.5">
                                  <IconX className="size-2.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Search */}
                        <div className="relative">
                          <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                          <input
                            value={langSearch}
                            onChange={e => setLangSearch(e.target.value)}
                            placeholder="Search languages..."
                            className="w-full pl-8 pr-3 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                          />
                        </div>
                        {/* Checkbox list */}
                        <div className="max-h-44 overflow-y-auto bg-background border rounded-lg divide-y divide-border/40">
                          {filteredLangs.length === 0 ? (
                            <div className="px-3 py-3 text-xs text-muted-foreground text-center">No languages found</div>
                          ) : filteredLangs.map(l => {
                            const isChecked = local.translations.some(t => t.language === l.code)
                            return (
                              <button
                                key={l.code}
                                onClick={() => toggleLanguage(l.code)}
                                className={cn("w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors text-left", isChecked && "bg-primary/5")}
                              >
                                <div className={cn("size-4 rounded flex items-center justify-center shrink-0 transition-colors border-2",
                                  isChecked ? "bg-primary border-primary" : "border-border/70")}>
                                  {isChecked && <IconCheck className="size-2.5 text-white" strokeWidth={3} />}
                                </div>
                                <span className="text-sm flex-1">{l.name}</span>
                                <span className="text-xs text-muted-foreground font-mono">{l.code}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Translations list — below picker */}
                  {local.translations.map(t => (
                    <div key={t.language} className="border rounded-xl p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{langName(t.language)}</span>
                        <button
                          onClick={() => removeLanguage(t.language)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Remove"
                        >
                          <IconX className="size-3.5" />
                        </button>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Primary Text</label>
                        <textarea
                          value={t.primaryText}
                          onChange={e => updateTranslation(t.language, "primaryText", e.target.value)}
                          placeholder={basePrimaryText ? `Translate: "${basePrimaryText.slice(0, 50)}${basePrimaryText.length > 50 ? "..." : ""}"` : "Primary text in " + langName(t.language)}
                          rows={2}
                          className="w-full px-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/50"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Headline</label>
                        <input
                          type="text"
                          value={t.headline}
                          onChange={e => updateTranslation(t.language, "headline", e.target.value)}
                          placeholder={baseHeadline || "Headline in " + langName(t.language)}
                          maxLength={125}
                          className="w-full px-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Description (optional)</label>
                        <input
                          type="text"
                          value={t.description}
                          onChange={e => updateTranslation(t.language, "description", e.target.value)}
                          placeholder={baseDescription || "Description in " + langName(t.language)}
                          className="w-full px-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t bg-background shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status</span>
            <button
              onClick={toggleEnabled}
              disabled={local.translations.length === 0}
              className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                local.enabled && local.translations.length > 0 ? "bg-primary" : "bg-muted-foreground/30",
                local.translations.length === 0 && "opacity-50 cursor-not-allowed")}
            >
              <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                local.enabled && local.translations.length > 0 ? "translate-x-4" : "translate-x-0.5")} />
            </button>
            <span className="text-xs text-muted-foreground">
              {local.translations.length === 0
                ? "No translations configured"
                : local.enabled
                  ? `${local.translations.length} translation${local.translations.length > 1 ? "s" : ""} active`
                  : "Translations paused"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}><IconX className="size-3.5 mr-1" />Cancel</Button>
            <Button onClick={handleSave}><IconCheck className="size-3.5 mr-1" />Save Confirm</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Collection Ads / Instant Experience Modal ────────────────────────────────

const IE_TEMPLATES: { value: CollectionAdsState["templateType"]; label: string; desc: string }[] = [
  { value: "storefront", label: "Instant Storefront", desc: "Shows catalog products in a scrollable grid. Best for e-commerce." },
  { value: "lookbook", label: "Instant Lookbook", desc: "Lifestyle images with product tags. Best for fashion & lifestyle brands." },
  { value: "customer_acquisition", label: "Customer Acquisition", desc: "Highlights key features with a sign-up form or website link." },
]

function CollectionAdsModal({
  open, onClose, value, onConfirm, baseWebLink, adAccountId,
}: {
  open: boolean
  onClose: () => void
  value: CollectionAdsState
  onConfirm: (v: CollectionAdsState) => void
  baseWebLink: string
  adAccountId?: string
}) {
  const [local, setLocal] = useState<CollectionAdsState>(value)
  const [saveError, setSaveError] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [catalogs, setCatalogs] = useState<CatalogItem[]>([])
  const [catalogsLoading, setCatalogsLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string>("")
  const [catalogDebug, setCatalogDebug] = useState<string[]>([])
  const [catalogDropdownOpen, setCatalogDropdownOpen] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState("")
  const [manualCatalogId, setManualCatalogId] = useState("")
  const [manualCatalogLoading, setManualCatalogLoading] = useState(false)
  const [productSets, setProductSets] = useState<ProductSetItem[]>([])
  const [productSetsLoading, setProductSetsLoading] = useState(false)
  const [productSetDropdownOpen, setProductSetDropdownOpen] = useState(false)
  const [products, setProducts] = useState<CatalogProductItem[]>([])
  const catalogRef = useRef<HTMLDivElement>(null)
  const productSetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setSaveError([])
      setLocal({ ...value, destinationUrl: value.destinationUrl || baseWebLink || "" })
    }
  }, [open])

  // Load catalogs on open
  useEffect(() => {
    if (!open) return
    fetchCatalogs()
  }, [open, adAccountId])

  // Load product sets + preview when catalog changes
  useEffect(() => {
    if (!local.catalogId) { setProductSets([]); setProducts([]); return }
    setProductSetsLoading(true)
    fetch(`/api/facebook/product-sets?catalog_id=${encodeURIComponent(local.catalogId)}`)
      .then(r => r.json())
      .then(d => {
        setProductSets(d.productSets || [])
        setProducts(d.products || [])
      })
      .catch(() => {})
      .finally(() => setProductSetsLoading(false))
  }, [local.catalogId])

  // Click outside dropdowns
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (catalogRef.current && !catalogRef.current.contains(e.target as Node)) setCatalogDropdownOpen(false)
      if (productSetRef.current && !productSetRef.current.contains(e.target as Node)) setProductSetDropdownOpen(false)
    }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])

  const fetchCatalogs = async () => {
    setCatalogsLoading(true)
    setCatalogError("")
    try {
      const url = adAccountId
        ? `/api/facebook/catalogs?ad_account_id=${encodeURIComponent(adAccountId)}`
        : "/api/facebook/catalogs"
      const res = await fetch(url)
      const d = await res.json()
      if (!res.ok) {
        setCatalogError(d.error || "Failed to fetch catalogs")
        setCatalogs([])
      } else {
        setCatalogs(d.catalogs || [])
        setCatalogDebug(d.debug || [])
        if ((d.catalogs || []).length === 0) {
          setCatalogError(
            "No catalogs found. Possible reasons: (1) your Facebook account has no Business with catalogs, (2) the connection lacks `business_management` / `catalog_management` permissions, or (3) the ad account isn't linked to a business with catalogs."
          )
        }
      }
    } catch (e: any) {
      setCatalogError(e.message || "Network error")
    }
    setCatalogsLoading(false)
  }

  const filteredCatalogs = catalogs.filter(c =>
    !catalogSearch || c.name.toLowerCase().includes(catalogSearch.toLowerCase()) || c.id.includes(catalogSearch)
  )

  const selectCatalog = (c: CatalogItem) => {
    setLocal(s => ({
      ...s,
      catalogId: c.id, catalogName: c.name, catalogVertical: c.vertical || "",
      productSetId: "", productSetName: "",
    }))
    setCatalogDropdownOpen(false)
    setCatalogSearch("")
  }
  const addManualCatalog = async () => {
    const id = manualCatalogId.trim()
    if (!/^\d{5,}$/.test(id)) return
    setManualCatalogLoading(true)
    try {
      // Try fetching the catalog name by directly hitting product-sets endpoint
      // (it'll succeed if user has access via business_management/catalog_management)
      const res = await fetch(`/api/facebook/product-sets?catalog_id=${encodeURIComponent(id)}`)
      const ok = res.ok
      const name = ok ? `Catalog ${id}` : `Catalog ${id}`
      selectCatalog({ id, name, vertical: "" })
    } catch {
      selectCatalog({ id, name: `Catalog ${id}`, vertical: "" })
    }
    setManualCatalogLoading(false)
    setManualCatalogId("")
  }
  const selectProductSet = (ps: ProductSetItem) => {
    setLocal(s => ({ ...s, productSetId: ps.id, productSetName: ps.name }))
    setProductSetDropdownOpen(false)
  }

  const toggleChip = (field: "productHeadlineChips" | "productDescriptionChips", chipKey: string) => {
    setLocal(s => {
      const arr = s[field]
      return { ...s, [field]: arr.includes(chipKey) ? arr.filter(c => c !== chipKey) : [...arr, chipKey] }
    })
  }
  const removeChip = (field: "productHeadlineChips" | "productDescriptionChips", chipKey: string) => {
    setLocal(s => ({ ...s, [field]: s[field].filter(c => c !== chipKey) }))
  }

  const requiredMissing: string[] = []
  if (!local.catalogId) requiredMissing.push("Select a catalog")
  if (!local.productSetId) requiredMissing.push("Select a product set")
  if (!local.destinationUrl.trim()) requiredMissing.push("Enter Destination URL")
  const isValid = requiredMissing.length === 0

  const handleSave = () => {
    if (local.enabled && !isValid) {
      setSaveError(requiredMissing)
      return
    }
    setSaveError([])
    onConfirm({ ...local })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-semibold">Collection Ads / Instant Experience</DialogTitle>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
          <div className="border rounded-xl overflow-hidden">
            {/* Section header */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <IconShoppingBag className="size-4" />
                <span className="text-sm font-semibold">Collection Ads / Instant Experience</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLocal(s => ({ ...s, enabled: !s.enabled }))}
                  className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                    local.enabled ? "bg-primary" : "bg-muted-foreground/30")}
                >
                  <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                    local.enabled ? "translate-x-4" : "translate-x-0.5")} />
                </button>
                <button onClick={() => setCollapsed(c => !c)} className="text-muted-foreground hover:text-foreground">
                  {collapsed ? <IconChevronDown className="size-4" /> : <IconChevronUp className="size-4" />}
                </button>
              </div>
            </div>

            {!collapsed && local.enabled && (
              <>
                {/* Presets */}
                <div className="bg-muted/20 border-t px-4 py-2.5 flex items-center justify-between">
                  <span className="text-sm">Collection ad presets</span>
                </div>

                {/* Body content */}
                <div className="px-4 py-4 space-y-4 border-t">
                  {/* IE Template selector */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <p className="text-sm font-semibold">Instant Experience Template</p>
                      <IconInfoCircle className="size-3.5 text-muted-foreground" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {IE_TEMPLATES.map(t => (
                        <button
                          key={t.value}
                          onClick={() => setLocal(s => ({ ...s, templateType: t.value }))}
                          className={cn(
                            "border rounded-xl p-3 text-left transition-colors",
                            local.templateType === t.value
                              ? "border-primary bg-primary/5 ring-1 ring-primary"
                              : "hover:border-muted-foreground/40"
                          )}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold">{t.label}</span>
                            {local.templateType === t.value && <IconCheck className="size-3.5 text-primary" />}
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{t.desc}</p>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      One instant experience will be created per media item. Cover media is taken from your selected creatives.
                    </p>
                  </div>

                  {/* Catalog + Product Set grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Catalogue */}
                    <div className="border rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold">Catalogue</span>
                          <IconInfoCircle className="size-3.5 text-muted-foreground" />
                        </div>
                        <button onClick={fetchCatalogs} disabled={catalogsLoading} className="text-muted-foreground hover:text-foreground">
                          <IconRefresh className={cn("size-3.5", catalogsLoading && "animate-spin")} />
                        </button>
                      </div>
                      <div ref={catalogRef} className="relative">
                        <button
                          onClick={() => setCatalogDropdownOpen(o => !o)}
                          className="w-full flex items-center gap-2 px-3 py-2 border rounded-lg bg-background hover:bg-muted/30 transition-colors text-sm"
                        >
                          <span className="flex-1 truncate text-left text-muted-foreground">
                            {local.catalogId ? `${local.catalogName} (${local.catalogId})` : "Select a catalog"}
                          </span>
                          <IconChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                        </button>
                        {catalogDropdownOpen && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-xl shadow-lg z-50 overflow-hidden">
                            <div className="p-2 border-b">
                              <div className="relative">
                                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                                <input
                                  autoFocus
                                  value={catalogSearch}
                                  onChange={e => setCatalogSearch(e.target.value)}
                                  placeholder="Select a catalog"
                                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                                />
                              </div>
                            </div>
                            <div className="max-h-60 overflow-y-auto">
                              {catalogsLoading ? (
                                <div className="px-3 py-3 text-xs text-muted-foreground flex items-center gap-2">
                                  <IconLoader2 className="size-3 animate-spin" />Loading catalogs...
                                </div>
                              ) : filteredCatalogs.length === 0 ? (
                                <div className="px-3 py-3 text-xs text-muted-foreground">No catalogs found via API</div>
                              ) : filteredCatalogs.map(c => (
                                <button
                                  key={c.id}
                                  onClick={() => selectCatalog(c)}
                                  className={cn(
                                    "w-full px-3 py-2 text-sm hover:bg-accent text-left transition-colors",
                                    local.catalogId === c.id && "bg-primary/5"
                                  )}
                                >
                                  {c.name} ({c.id})
                                </button>
                              ))}
                            </div>
                            {/* Manual catalog ID fallback */}
                            <div className="border-t p-2 bg-muted/20">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Or enter Catalog ID manually</p>
                              <div className="flex gap-1.5">
                                <input
                                  value={manualCatalogId}
                                  onChange={e => setManualCatalogId(e.target.value)}
                                  placeholder="e.g. 1611620056697514"
                                  className="flex-1 px-2 py-1 text-xs bg-background border rounded outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                                />
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  disabled={!/^\d{5,}$/.test(manualCatalogId.trim()) || manualCatalogLoading}
                                  onClick={addManualCatalog}
                                >
                                  {manualCatalogLoading ? <IconLoader2 className="size-3 animate-spin" /> : "Use"}
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">Tip: copy ID from Facebook Commerce Manager URL.</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Error / debug */}
                      {!catalogsLoading && catalogError && (
                        <div className="mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2 text-xs text-amber-900 dark:text-amber-200">
                          {catalogError}
                          {catalogDebug.length > 0 && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-xs opacity-70">Debug</summary>
                              <ul className="mt-1 ml-3 list-disc opacity-80">
                                {catalogDebug.map((l, i) => <li key={i}>{l}</li>)}
                              </ul>
                            </details>
                          )}
                        </div>
                      )}

                      {/* Catalog detail card */}
                      {local.catalogId && (
                        <div className="mt-2 border rounded-lg p-2 bg-muted/10 flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{local.catalogName}</p>
                            <p className="text-xs text-muted-foreground">Catalog ID: {local.catalogId}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {local.catalogVertical && (
                              <span className="text-xs px-1.5 py-0.5 rounded border bg-background">{local.catalogVertical}</span>
                            )}
                            <Button variant="outline" size="sm" className="h-6 text-xs gap-0.5">
                              <IconEye className="size-3" />View
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Product Set */}
                    <div className="border rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold">Product set</span>
                          <span className="text-destructive text-xs">*</span>
                          <IconInfoCircle className="size-3.5 text-muted-foreground" />
                        </div>
                        <button
                          onClick={() => local.catalogId && setProductSets([])}
                          className="text-muted-foreground hover:text-foreground"
                          disabled={!local.catalogId}
                        >
                          <IconRefresh className={cn("size-3.5", productSetsLoading && "animate-spin")} />
                        </button>
                      </div>
                      {!local.catalogId ? (
                        <div className="text-xs text-muted-foreground p-2">Select a catalog first</div>
                      ) : productSetsLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
                          <IconLoader2 className="size-3 animate-spin" />Loading...
                        </div>
                      ) : productSets.length === 0 ? (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 text-xs text-amber-900 dark:text-amber-200">
                          No product sets found. Create one in Facebook Business Manager first.
                        </div>
                      ) : (
                        <div ref={productSetRef} className="relative">
                          <button
                            onClick={() => setProductSetDropdownOpen(o => !o)}
                            className="w-full flex items-center gap-2 px-3 py-2 border rounded-lg bg-background hover:bg-muted/30 transition-colors text-sm"
                          >
                            <span className="flex-1 truncate text-left text-muted-foreground">
                              {local.productSetId ? local.productSetName : "Select a product set"}
                            </span>
                            <IconChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                          </button>
                          {productSetDropdownOpen && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-xl shadow-lg z-50 overflow-hidden max-h-60 overflow-y-auto">
                              {productSets.map(ps => (
                                <button
                                  key={ps.id}
                                  onClick={() => selectProductSet(ps)}
                                  className="w-full px-3 py-2 text-sm hover:bg-accent text-left"
                                >
                                  {ps.name} {ps.product_count !== undefined && <span className="text-muted-foreground">({ps.product_count})</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Product preview */}
                  {local.catalogId && (
                    <div className="border rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-semibold">Product preview</p>
                          <p className="text-xs text-muted-foreground">Previewing products from the selected catalog.</p>
                        </div>
                        <button className="text-muted-foreground hover:text-foreground">
                          <IconRefresh className="size-3.5" />
                        </button>
                      </div>
                      {products.length === 0 ? (
                        <div className="bg-muted/30 border rounded-lg p-2.5 text-xs text-muted-foreground">
                          No product images were available for this catalog.
                        </div>
                      ) : (
                        <div className="grid grid-cols-6 gap-2">
                          {products.slice(0, 6).map(p => (
                            <div key={p.id} className="aspect-square rounded-md overflow-hidden border bg-muted">
                              {p.image_url
                                ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                                : <div className="w-full h-full flex items-center justify-center"><IconPhoto className="size-4 text-muted-foreground/40" /></div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Order + Product count + Cover media */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="border rounded-xl p-3 space-y-3">
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-sm font-semibold">Order</span>
                          <IconInfoCircle className="size-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {([
                            { value: "dynamic" as const, label: "Order dynamically" },
                            { value: "specific" as const, label: "Choose a specific order" },
                          ]).map(opt => (
                            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                              <div className={cn(
                                "size-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                                local.order === opt.value ? "border-primary" : "border-muted-foreground/30"
                              )}>
                                {local.order === opt.value && <div className="size-2 rounded-full bg-primary" />}
                              </div>
                              <span className="text-sm">{opt.label}</span>
                              <input type="radio" className="sr-only" checked={local.order === opt.value}
                                onChange={() => setLocal(s => ({ ...s, order: opt.value }))} />
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-xs font-medium">Number of products to show</span>
                          <IconInfoCircle className="size-3 text-muted-foreground" />
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={50}
                            value={local.productCount}
                            onChange={e => setLocal(s => ({ ...s, productCount: Math.min(50, Math.max(1, Number(e.target.value))) }))}
                            className="w-20 px-2 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring text-center"
                          />
                          <span className="text-xs text-muted-foreground">Max 50, default 4</span>
                        </div>
                      </div>
                    </div>
                    <div className="border-2 border-primary/20 dark:border-blue-900 bg-primary/10/50 dark:bg-blue-950/20 rounded-xl p-3 flex items-start gap-2">
                      <IconInfoCircle className="size-4 text-primary dark:text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold">Cover media</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Automatically uses your selected creatives as the instant experience cover. One IE is created per creative.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Product headline + description */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-xs font-medium">Product headline</span>
                        <IconInfoCircle className="size-3 text-muted-foreground" />
                      </div>
                      <ChipPicker
                        selected={local.productHeadlineChips}
                        options={PRODUCT_FIELD_OPTIONS}
                        onAdd={k => toggleChip("productHeadlineChips", k)}
                        onRemove={k => removeChip("productHeadlineChips", k)}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-xs font-medium">Product description</span>
                        <IconInfoCircle className="size-3 text-muted-foreground" />
                      </div>
                      <ChipPicker
                        selected={local.productDescriptionChips}
                        options={PRODUCT_FIELD_OPTIONS}
                        onAdd={k => toggleChip("productDescriptionChips", k)}
                        onRemove={k => removeChip("productDescriptionChips", k)}
                      />
                    </div>
                  </div>

                  {/* IE Headline + Destination URL */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-xs font-medium">IE Headline</span>
                        <span className="text-muted-foreground text-xs">(optional)</span>
                        <IconInfoCircle className="size-3 text-muted-foreground" />
                      </div>
                      <input
                        value={local.ieHeadline}
                        onChange={e => setLocal(s => ({ ...s, ieHeadline: e.target.value }))}
                        placeholder="Headline shown inside the Instant Experience"
                        className="w-full px-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Shown at the top of the Instant Experience (separate from main ad headline)</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-xs font-medium">Destination URL</span>
                        <span className="text-destructive text-xs">*</span>
                        <IconInfoCircle className="size-3 text-muted-foreground" />
                      </div>
                      <input
                        value={local.destinationUrl}
                        onChange={e => setLocal(s => ({ ...s, destinationUrl: e.target.value }))}
                        placeholder="https://..."
                        className={cn(
                          "w-full px-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring",
                          saveError.length > 0 && !local.destinationUrl.trim() && "border-destructive"
                        )}
                      />
                      <p className="text-xs text-muted-foreground mt-1">Landing page URL when users tap the "See more" button</p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-5 py-3 border-t bg-background shrink-0">
          {saveError.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
              <p className="text-xs text-destructive font-medium mb-1">Please fill in all required fields before saving:</p>
              {saveError.map((e, i) => <p key={i} className="text-xs text-destructive ml-2">• {e}</p>)}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose}><IconX className="size-3.5 mr-1" />Cancel</Button>
            <Button onClick={handleSave}><IconCheck className="size-3.5 mr-1" />Save Confirm</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Chip picker for product field placeholders
function ChipPicker({ selected, options, onAdd, onRemove }: {
  selected: string[]
  options: { key: string; label: string }[]
  onAdd: (key: string) => void
  onRemove: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])
  const remaining = options.filter(o => !selected.includes(o.key))
  const labelOf = (k: string) => options.find(o => o.key === k)?.label || k

  return (
    <div className="border rounded-lg px-2 py-1.5 bg-background min-h-[36px] flex flex-wrap gap-1 items-center" ref={ref}>
      {selected.map(k => (
        <span key={k} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-primary/10 dark:bg-blue-950/40 text-primary/90 dark:text-blue-300 text-xs border border-primary/20 dark:border-blue-800">
          {labelOf(k)}
          <button onClick={() => onRemove(k)} className="hover:text-destructive">
            <IconX className="size-3" />
          </button>
        </span>
      ))}
      {remaining.length > 0 && (
        <div className="relative">
          <button onClick={() => setOpen(o => !o)} className="text-xs text-muted-foreground hover:text-foreground px-1">
            <IconPlus className="size-3.5" />
          </button>
          {open && (
            <div className="absolute top-full left-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 min-w-[140px] py-1">
              {remaining.map(o => (
                <button
                  key={o.key}
                  onClick={() => { onAdd(o.key); setOpen(false) }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Catalog Ads (Meta) Modal ─────────────────────────────────────────────────

function CatalogAdsModal({
  open, onClose, value, onConfirm, adAccountId,
}: {
  open: boolean
  onClose: () => void
  value: CatalogAdsState
  onConfirm: (v: CatalogAdsState) => void
  adAccountId?: string
}) {
  const [local, setLocal] = useState<CatalogAdsState>(value)
  const [collapsed, setCollapsed] = useState(false)
  const [catalogs, setCatalogs] = useState<CatalogItem[]>([])
  const [catalogsLoading, setCatalogsLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string>("")
  const [catalogDropdownOpen, setCatalogDropdownOpen] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState("")
  const [productSets, setProductSets] = useState<ProductSetItem[]>([])
  const [productSetsLoading, setProductSetsLoading] = useState(false)
  const [productSetDropdownOpen, setProductSetDropdownOpen] = useState(false)
  const [manualCatalogId, setManualCatalogId] = useState("")
  const catalogRef = useRef<HTMLDivElement>(null)
  const productSetRef = useRef<HTMLDivElement>(null)
  const frameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) setLocal(value) }, [open, value])

  // Fetch catalogs on open
  useEffect(() => {
    if (!open) return
    fetchCatalogs()
  }, [open, adAccountId])

  // Fetch product sets when catalog changes
  useEffect(() => {
    if (!local.catalogId) { setProductSets([]); return }
    setProductSetsLoading(true)
    fetch(`/api/facebook/product-sets?catalog_id=${encodeURIComponent(local.catalogId)}`)
      .then(r => r.json())
      .then(d => setProductSets(d.productSets || []))
      .catch(() => {})
      .finally(() => setProductSetsLoading(false))
  }, [local.catalogId])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (catalogRef.current && !catalogRef.current.contains(e.target as Node)) setCatalogDropdownOpen(false)
      if (productSetRef.current && !productSetRef.current.contains(e.target as Node)) setProductSetDropdownOpen(false)
    }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])

  const fetchCatalogs = async () => {
    setCatalogsLoading(true)
    setCatalogError("")
    try {
      const url = adAccountId ? `/api/facebook/catalogs?ad_account_id=${encodeURIComponent(adAccountId)}` : "/api/facebook/catalogs"
      const res = await fetch(url)
      const d = await res.json()
      if (!res.ok) {
        setCatalogError(d.error || "Failed to fetch catalogs")
      } else {
        setCatalogs(d.catalogs || [])
        if ((d.catalogs || []).length === 0) {
          setCatalogError("No catalogs found. Connect a Business with catalogs or enter Catalog ID manually.")
        }
      }
    } catch (e: any) {
      setCatalogError(e.message)
    }
    setCatalogsLoading(false)
  }

  const filteredCatalogs = catalogs.filter(c =>
    !catalogSearch || c.name.toLowerCase().includes(catalogSearch.toLowerCase()) || c.id.includes(catalogSearch)
  )
  const visibleProductSets = local.hideAutoCreatedSets
    ? productSets.filter(ps => !/auto[- ]?created|url[- ]?based/i.test(ps.name))
    : productSets

  const selectCatalog = (c: CatalogItem) => {
    setLocal(s => ({ ...s, catalogId: c.id, catalogName: c.name, productSetId: "", productSetName: "" }))
    setCatalogDropdownOpen(false)
    setCatalogSearch("")
  }
  const addManualCatalog = () => {
    const id = manualCatalogId.trim()
    if (!/^\d{5,}$/.test(id)) return
    selectCatalog({ id, name: `Catalog ${id}` })
    setManualCatalogId("")
  }
  const selectProductSet = (ps: ProductSetItem) => {
    setLocal(s => ({ ...s, productSetId: ps.id, productSetName: ps.name }))
    setProductSetDropdownOpen(false)
  }

  const handleFrameUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setLocal(s => ({ ...s, frameImageUrl: reader.result as string }))
    reader.readAsDataURL(file)
  }

  const isValid = !!local.catalogId
  const handleSave = () => {
    onConfirm(isValid ? { ...local, enabled: true } : { ...local, enabled: false })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b shrink-0">
          <div>
            <DialogTitle className="text-base font-semibold">Catalog Ads (Meta)</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Pick a catalogue, then confirm the setup at the bottom of this modal.</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
          <div className="border rounded-xl overflow-hidden">
            {/* Section header with toggle */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <IconBox className="size-4" />
                <span className="text-sm font-semibold">Catalog Ads (Meta)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLocal(s => ({ ...s, enabled: !s.enabled }))}
                  className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                    local.enabled ? "bg-primary" : "bg-muted-foreground/30")}
                >
                  <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                    local.enabled ? "translate-x-4" : "translate-x-0.5")} />
                </button>
                <button onClick={() => setCollapsed(c => !c)} className="text-muted-foreground hover:text-foreground">
                  {collapsed ? <IconChevronDown className="size-4" /> : <IconChevronUp className="size-4" />}
                </button>
              </div>
            </div>

            {!collapsed && local.enabled && (
              <div className="border-t px-4 py-4 space-y-4">
                {/* Format Mode */}
                <div>
                  <p className="text-sm font-semibold mb-2">Format Mode</p>
                  <div className="space-y-2">
                    {([
                      { value: "automatic" as const, title: "Automatic", desc: "Let Meta choose the best format for your ad" },
                      { value: "manual" as const, title: "Manual", desc: "Manage format manually" },
                    ]).map(opt => (
                      <label key={opt.value} className={cn(
                        "flex items-start gap-2.5 p-3 border rounded-xl cursor-pointer transition-colors",
                        local.formatMode === opt.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                      )}>
                        <div className={cn(
                          "size-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
                          local.formatMode === opt.value ? "border-primary" : "border-muted-foreground/30"
                        )}>
                          {local.formatMode === opt.value && <div className="size-2 rounded-full bg-primary" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{opt.title}</p>
                          <p className="text-xs text-muted-foreground">{opt.desc}</p>
                        </div>
                        <input type="radio" className="sr-only" checked={local.formatMode === opt.value}
                          onChange={() => setLocal(s => ({ ...s, formatMode: opt.value }))} />
                      </label>
                    ))}
                  </div>
                </div>

                {/* Format + Frame Image grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-semibold mb-1">Format</p>
                    <p className="text-xs text-muted-foreground mb-2">Choose an ad creative layout</p>
                    <div className="space-y-2">
                      {([
                        { value: "single" as const, title: "Single image or video", desc: "Use a single image or video for your ad" },
                        { value: "carousel" as const, title: "Carousel", desc: "Show multiple images or videos in a scrollable format" },
                      ]).map(opt => (
                        <label key={opt.value} className={cn(
                          "flex items-start gap-2.5 p-2.5 border rounded-xl cursor-pointer transition-colors",
                          local.format === opt.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30",
                          local.formatMode === "automatic" && "opacity-60 cursor-not-allowed"
                        )}>
                          <div className={cn(
                            "size-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
                            local.format === opt.value ? "border-primary" : "border-muted-foreground/30"
                          )}>
                            {local.format === opt.value && <div className="size-2 rounded-full bg-primary" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{opt.title}</p>
                            <p className="text-xs text-muted-foreground">{opt.desc}</p>
                          </div>
                          <input type="radio" disabled={local.formatMode === "automatic"} className="sr-only"
                            checked={local.format === opt.value}
                            onChange={() => setLocal(s => ({ ...s, format: opt.value }))} />
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-semibold mb-1">Frame Image (Optional)</p>
                    <p className="text-xs text-muted-foreground mb-2">Upload an image to use as a frame for your catalogue ad creative.</p>
                    <input ref={frameInputRef} type="file" accept="image/*" className="hidden" onChange={handleFrameUpload} />
                    <button
                      onClick={() => frameInputRef.current?.click()}
                      className="w-full aspect-[2/1] border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:bg-muted/30 transition-colors overflow-hidden"
                    >
                      {local.frameImageUrl ? (
                        <img src={local.frameImageUrl} className="w-full h-full object-cover" alt="Frame" />
                      ) : (
                        <>
                          <IconUpload className="size-5" />
                          <span className="text-xs">Upload Frame Image</span>
                        </>
                      )}
                    </button>
                    {local.frameImageUrl && (
                      <button
                        onClick={() => setLocal(s => ({ ...s, frameImageUrl: "" }))}
                        className="text-xs text-destructive hover:underline mt-1"
                      >
                        Remove frame
                      </button>
                    )}
                  </div>
                </div>

                {/* Dynamic Media */}
                <div className="border rounded-xl p-3">
                  <p className="text-sm font-semibold">Dynamic media</p>
                  <p className="text-xs text-muted-foreground mb-3">Control how catalogue images and videos are chosen for delivery (maps to Meta Dynamic Media).</p>
                  <div className="space-y-2.5">
                    <DynamicMediaToggle
                      title="Optimized media selection"
                      desc="Let Meta show images or videos from your catalogue based on what each person is likely to engage with."
                      checked={local.dynamicMedia.optimizedMediaSelection}
                      onChange={v => setLocal(s => ({ ...s, dynamicMedia: { ...s.dynamicMedia, optimizedMediaSelection: v, automaticVideoCropping: v ? s.dynamicMedia.automaticVideoCropping : false, prioritizeVideo: v ? s.dynamicMedia.prioritizeVideo : false } }))}
                    />
                    <DynamicMediaToggle
                      title="Automatic video cropping"
                      desc="Crop catalogue videos to fit placements when aspect ratios differ."
                      checked={local.dynamicMedia.automaticVideoCropping}
                      onChange={v => setLocal(s => ({ ...s, dynamicMedia: { ...s.dynamicMedia, automaticVideoCropping: v } }))}
                      disabled={!local.dynamicMedia.optimizedMediaSelection}
                      indent
                    />
                    <DynamicMediaToggle
                      title="Prioritize video"
                      desc="Prefer catalogue video for the hero when both image and video are available."
                      checked={local.dynamicMedia.prioritizeVideo}
                      onChange={v => setLocal(s => ({ ...s, dynamicMedia: { ...s.dynamicMedia, prioritizeVideo: v } }))}
                      disabled={!local.dynamicMedia.optimizedMediaSelection}
                      indent
                    />
                  </div>
                </div>

                {/* Catalogue */}
                <div>
                  <p className="text-sm font-semibold mb-1">Catalogue</p>
                  <p className="text-xs text-muted-foreground mb-2">Your ad is currently using catalogue in media setup. We'll use product images from this catalogue as your ad creative.</p>
                  <div ref={catalogRef} className="relative">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCatalogDropdownOpen(o => !o)}
                        className="flex-1 flex items-center gap-2 px-3 py-2 border rounded-lg bg-background hover:bg-muted/30 transition-colors text-sm"
                      >
                        <IconSearch className="size-3.5 text-muted-foreground/50" />
                        <span className="flex-1 truncate text-left text-muted-foreground">
                          {local.catalogId ? `${local.catalogName} (${local.catalogId})` : "Search catalogues..."}
                        </span>
                        <IconChevronDown className="size-3.5 text-muted-foreground" />
                      </button>
                      <button onClick={fetchCatalogs} disabled={catalogsLoading} className="size-9 border rounded-lg flex items-center justify-center hover:bg-muted/30">
                        <IconRefresh className={cn("size-3.5 text-muted-foreground", catalogsLoading && "animate-spin")} />
                      </button>
                    </div>
                    {catalogDropdownOpen && (
                      <div className="absolute top-full left-0 right-12 mt-1 bg-popover border rounded-xl shadow-lg z-50 overflow-hidden">
                        <div className="p-2 border-b">
                          <input
                            autoFocus
                            value={catalogSearch}
                            onChange={e => setCatalogSearch(e.target.value)}
                            placeholder="Search catalogues..."
                            className="w-full px-3 py-1.5 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                        <div className="max-h-52 overflow-y-auto">
                          {catalogsLoading ? (
                            <div className="px-3 py-3 text-xs text-muted-foreground flex items-center gap-2">
                              <IconLoader2 className="size-3 animate-spin" />Loading...
                            </div>
                          ) : filteredCatalogs.length === 0 ? (
                            <div className="px-3 py-3 text-xs text-muted-foreground">{catalogError || "No catalogs"}</div>
                          ) : filteredCatalogs.map(c => (
                            <button key={c.id} onClick={() => selectCatalog(c)}
                              className={cn("w-full px-3 py-2 text-sm hover:bg-accent text-left",
                                local.catalogId === c.id && "bg-primary/5")}>
                              {c.name} ({c.id})
                            </button>
                          ))}
                        </div>
                        <div className="border-t p-2 bg-muted/20">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Or enter Catalog ID</p>
                          <div className="flex gap-1.5">
                            <input
                              value={manualCatalogId}
                              onChange={e => setManualCatalogId(e.target.value)}
                              placeholder="e.g. 1611620056697514"
                              className="flex-1 px-2 py-1 text-xs bg-background border rounded outline-none focus:ring-1 focus:ring-ring"
                            />
                            <Button size="sm" className="h-7 text-xs" disabled={!/^\d{5,}$/.test(manualCatalogId.trim())} onClick={addManualCatalog}>Use</Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Product set */}
                <div>
                  <p className="text-sm font-semibold mb-1">Product set</p>
                  <p className="text-xs text-muted-foreground mb-2">Use a product set to feature certain products in your ads and shops on Facebook and Instagram. Leave this on All Products to use the whole catalogue.</p>

                  {/* Hide auto-created toggle */}
                  <div className="flex items-start justify-between p-3 border rounded-lg mb-2 bg-muted/10">
                    <div className="flex-1">
                      <p className="text-sm font-medium">Hide Meta auto-created sets</p>
                      <p className="text-xs text-muted-foreground">Hides URL-based sets and "Auto-Created Set" entries from this list.</p>
                    </div>
                    <button
                      onClick={() => setLocal(s => ({ ...s, hideAutoCreatedSets: !s.hideAutoCreatedSets }))}
                      className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
                        local.hideAutoCreatedSets ? "bg-primary" : "bg-muted-foreground/30")}
                    >
                      <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                        local.hideAutoCreatedSets ? "translate-x-4" : "translate-x-0.5")} />
                    </button>
                  </div>

                  <div ref={productSetRef} className="relative">
                    <div className="flex gap-2">
                      <button
                        onClick={() => local.catalogId && setProductSetDropdownOpen(o => !o)}
                        disabled={!local.catalogId}
                        className={cn("flex-1 flex items-center gap-2 px-3 py-2 border rounded-lg bg-background hover:bg-muted/30 transition-colors text-sm",
                          !local.catalogId && "opacity-60 cursor-not-allowed")}
                      >
                        <span className="flex-1 truncate text-left text-muted-foreground">
                          {!local.catalogId ? "Select a catalogue first" : (local.productSetId ? local.productSetName : "All Products (default)")}
                        </span>
                        <IconChevronDown className="size-3.5 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => local.catalogId && setProductSets([])}
                        disabled={!local.catalogId || productSetsLoading}
                        className="size-9 border rounded-lg flex items-center justify-center hover:bg-muted/30"
                      >
                        <IconRefresh className={cn("size-3.5 text-muted-foreground", productSetsLoading && "animate-spin")} />
                      </button>
                    </div>
                    {productSetDropdownOpen && local.catalogId && (
                      <div className="absolute top-full left-0 right-12 mt-1 bg-popover border rounded-xl shadow-lg z-50 max-h-52 overflow-y-auto">
                        <button onClick={() => { setLocal(s => ({ ...s, productSetId: "", productSetName: "All Products" })); setProductSetDropdownOpen(false) }}
                          className="w-full px-3 py-2 text-sm hover:bg-accent text-left border-b font-medium">
                          All Products (default)
                        </button>
                        {productSetsLoading ? (
                          <div className="px-3 py-3 text-xs text-muted-foreground flex items-center gap-2">
                            <IconLoader2 className="size-3 animate-spin" />Loading...
                          </div>
                        ) : visibleProductSets.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-muted-foreground">No product sets</div>
                        ) : visibleProductSets.map(ps => (
                          <button key={ps.id} onClick={() => selectProductSet(ps)}
                            className="w-full px-3 py-2 text-sm hover:bg-accent text-left">
                            {ps.name} {ps.product_count !== undefined && <span className="text-muted-foreground">({ps.product_count})</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-background shrink-0">
          <Button onClick={handleSave} disabled={local.enabled && !isValid}>
            <IconCheck className="size-3.5 mr-1" />Confirm Catalog Setup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Carousel Ads Modal ───────────────────────────────────────────────────────

function CarouselAdsModal({
  open, onClose, value, onConfirm,
  availableCreatives, baseHeadline, baseLinkUrl, baseCta,
}: {
  open: boolean
  onClose: () => void
  value: CarouselAdsState
  onConfirm: (v: CarouselAdsState) => void
  availableCreatives: Creative[]
  baseHeadline: string
  baseLinkUrl: string
  baseCta: string
}) {
  const [local, setLocal] = useState<CarouselAdsState>(value)
  const [selectedAdId, setSelectedAdId] = useState<string>("")
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!open) return
    // Ensure at least one carousel exists
    if (value.carousels.length === 0) {
      const initial: CarouselAd = { id: `c_${Date.now()}`, name: "Ad 1", cards: [], showAsCollectionTiles: false, showAsSingleMedia: false }
      setLocal({ enabled: value.enabled, carousels: [initial] })
      setSelectedAdId(initial.id)
    } else {
      setLocal(value)
      setSelectedAdId(value.carousels[0].id)
    }
  }, [open])

  const selectedAd = local.carousels.find(c => c.id === selectedAdId)
  const usedCreativeIds = new Set(local.carousels.flatMap(c => c.cards.map(card => card.creativeId)))
  const totalMediaCount = local.carousels.reduce((sum, c) => sum + c.cards.length, 0)
  const totalSelected = usedCreativeIds.size

  const availableFiltered = availableCreatives
    .filter(c => !usedCreativeIds.has(c.id))
    .filter(c => !search || c.file_name.toLowerCase().includes(search.toLowerCase()))

  const addCarousel = () => {
    const next = local.carousels.length + 1
    const newAd: CarouselAd = { id: `c_${Date.now()}`, name: `Ad ${next}`, cards: [], showAsCollectionTiles: false, showAsSingleMedia: false }
    setLocal(s => ({ ...s, carousels: [...s.carousels, newAd] }))
    setSelectedAdId(newAd.id)
  }
  const duplicateCarousel = (id: string) => {
    const ad = local.carousels.find(c => c.id === id)
    if (!ad) return
    const dup: CarouselAd = { ...ad, id: `c_${Date.now()}`, name: `${ad.name} (copy)`, cards: [...ad.cards] }
    setLocal(s => ({ ...s, carousels: [...s.carousels, dup] }))
  }
  const deleteCarousel = (id: string) => {
    if (local.carousels.length === 1) return
    const idx = local.carousels.findIndex(c => c.id === id)
    const next = local.carousels.filter(c => c.id !== id)
    setLocal(s => ({ ...s, carousels: next }))
    if (selectedAdId === id) setSelectedAdId(next[Math.max(0, idx - 1)].id)
  }
  const updateAd = (id: string, patch: Partial<CarouselAd>) => {
    setLocal(s => ({ ...s, carousels: s.carousels.map(c => c.id === id ? { ...c, ...patch } : c) }))
  }
  const addCardToSelected = (creativeId: string) => {
    if (!selectedAd) return
    if (selectedAd.cards.length >= 10) return // Meta max 10 cards
    const card: CarouselCard = {
      creativeId,
      headline: baseHeadline,
      linkUrl: baseLinkUrl,
      cta: baseCta,
    }
    updateAd(selectedAd.id, { cards: [...selectedAd.cards, card] })
  }
  const removeCard = (creativeId: string) => {
    if (!selectedAd) return
    updateAd(selectedAd.id, { cards: selectedAd.cards.filter(c => c.creativeId !== creativeId) })
  }
  const moveCard = (creativeId: string, dir: -1 | 1) => {
    if (!selectedAd) return
    const idx = selectedAd.cards.findIndex(c => c.creativeId === creativeId)
    if (idx < 0) return
    const next = [...selectedAd.cards]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    updateAd(selectedAd.id, { cards: next })
  }
  const updateCardField = (creativeId: string, field: keyof CarouselCard, val: string) => {
    if (!selectedAd) return
    updateAd(selectedAd.id, {
      cards: selectedAd.cards.map(c => c.creativeId === creativeId ? { ...c, [field]: val } : c),
    })
  }
  const toggleFormat = (id: string, field: "showAsCollectionTiles" | "showAsSingleMedia", val: boolean) => {
    // The two are mutually exclusive
    if (field === "showAsCollectionTiles" && val) updateAd(id, { showAsCollectionTiles: true, showAsSingleMedia: false })
    else if (field === "showAsSingleMedia" && val) updateAd(id, { showAsCollectionTiles: false, showAsSingleMedia: true })
    else updateAd(id, { [field]: val } as any)
  }
  const handleDone = () => {
    const validCarousels = local.carousels.filter(c => c.cards.length >= 2) // Meta requires min 2 cards
    onConfirm({
      enabled: validCarousels.length > 0,
      carousels: local.carousels,
    })
    onClose()
  }

  const creativeById = (id: string) => availableCreatives.find(c => c.id === id)
  const thumbOf = (c?: Creative) => proxyFbImage(c ? (c.media_type === "video" ? c.fb_thumbnail_url : (c.fb_image_url || c.file_url)) : "")

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-5xl p-0 flex flex-col max-h-[92vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-semibold">
            Create Carousel Ads <span className="text-muted-foreground font-normal">({totalMediaCount} media)</span>
          </DialogTitle>
        </div>

        <div className="grid grid-cols-2 flex-1 min-h-0 overflow-hidden">
          {/* LEFT: Available Media + Carousel Ads list */}
          <div className="border-r flex flex-col overflow-hidden">
            {/* Available Media */}
            <div className="px-4 py-3 border-b shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Available Media</span>
                  <span className="text-xs text-primary">({totalSelected} selected)</span>
                </div>
                <IconInfoCircle className="size-3.5 text-muted-foreground" />
              </div>
              <div className="relative">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 bg-muted/10">
              {availableFiltered.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No available media to add
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {availableFiltered.map(c => {
                    const thumb = thumbOf(c)
                    return (
                      <button
                        key={c.id}
                        onClick={() => addCardToSelected(c.id)}
                        disabled={!selectedAd || selectedAd.cards.length >= 10}
                        className="group relative aspect-square rounded-lg overflow-hidden border bg-muted hover:ring-2 hover:ring-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <CreativeCardMedia creative={c} className="w-full h-full object-cover" compact />
                        <div className="absolute inset-0 bg-primary/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <IconPlus className="size-5 text-white" />
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Carousel Ads list */}
            <div className="border-t shrink-0 max-h-[40%] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm font-semibold">Carousel Ads</span>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addCarousel}>
                  <IconPlus className="size-3" />New
                </Button>
              </div>
              <div className="overflow-y-auto px-3 pb-3 space-y-1.5">
                {local.carousels.map(ad => (
                  <div
                    key={ad.id}
                    onClick={() => setSelectedAdId(ad.id)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 border rounded-lg cursor-pointer transition-colors",
                      selectedAdId === ad.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                    )}
                  >
                    <span className="flex-1 text-sm font-medium">{ad.name}</span>
                    <span className="text-xs text-muted-foreground">{ad.cards.length} card{ad.cards.length !== 1 ? "s" : ""}</span>
                    <button
                      onClick={e => { e.stopPropagation(); duplicateCarousel(ad.id) }}
                      className="text-muted-foreground hover:text-foreground"
                      title="Duplicate"
                    >
                      <IconCopy className="size-3.5" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); deleteCarousel(ad.id) }}
                      disabled={local.carousels.length === 1}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                      title="Delete"
                    >
                      <IconTrash className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: Selected carousel details */}
          <div className="flex flex-col overflow-hidden">
            {selectedAd ? (
              <>
                <div className="px-5 py-3 border-b shrink-0">
                  <h3 className="text-sm font-semibold">Carousel {local.carousels.findIndex(c => c.id === selectedAd.id) + 1} Details</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {/* Ad Name */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Ad Name</label>
                    <input
                      value={selectedAd.name}
                      onChange={e => updateAd(selectedAd.id, { name: e.target.value })}
                      className="w-full px-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>

                  {/* Format display options */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Format display options</p>
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedAd.showAsCollectionTiles}
                          onChange={e => toggleFormat(selectedAd.id, "showAsCollectionTiles", e.target.checked)}
                          className="rounded size-3.5"
                        />
                        <span className="text-sm">Show cards as collection tiles</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedAd.showAsSingleMedia}
                          onChange={e => toggleFormat(selectedAd.id, "showAsSingleMedia", e.target.checked)}
                          className="rounded size-3.5"
                        />
                        <span className="text-sm">Show cards as single media</span>
                      </label>
                    </div>
                  </div>

                  {/* Cards list */}
                  {selectedAd.cards.length === 0 ? (
                    <div className="border-2 border-dashed rounded-xl py-12 px-4 text-center text-sm text-muted-foreground">
                      Select an ad from above to add to <span className="font-semibold text-foreground">{selectedAd.name}</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Cards ({selectedAd.cards.length}/10)</p>
                      {selectedAd.cards.map((card, idx) => {
                        const c = creativeById(card.creativeId)
                        const thumb = thumbOf(c)
                        return (
                          <div key={card.creativeId} className="border rounded-lg p-2 flex gap-2">
                            <div className="size-14 rounded overflow-hidden bg-muted shrink-0 relative">
                              {thumb ? <img src={thumb} className="w-full h-full object-cover" alt="" onError={e => e.currentTarget.style.display="none"} />
                                : <div className="w-full h-full flex items-center justify-center"><IconPhoto className="size-4 text-muted-foreground/40" /></div>}
                              {c?.media_type === "video" && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none">
                                  <IconPlayerPlay className="size-4 text-white opacity-60" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-muted-foreground">CARD {idx + 1}</span>
                                <div className="flex items-center gap-0.5">
                                  <button onClick={() => moveCard(card.creativeId, -1)} disabled={idx === 0}
                                    className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                                    <IconChevronUp className="size-3.5" />
                                  </button>
                                  <button onClick={() => moveCard(card.creativeId, 1)} disabled={idx === selectedAd.cards.length - 1}
                                    className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                                    <IconChevronDown className="size-3.5" />
                                  </button>
                                  <button onClick={() => removeCard(card.creativeId)} className="text-muted-foreground hover:text-destructive">
                                    <IconX className="size-3.5" />
                                  </button>
                                </div>
                              </div>
                              <input
                                value={card.headline || ""}
                                onChange={e => updateCardField(card.creativeId, "headline", e.target.value)}
                                placeholder="Card headline"
                                className="w-full px-2 py-1 text-xs bg-muted/30 border rounded outline-none focus:ring-1 focus:ring-ring"
                              />
                              <input
                                value={card.linkUrl || ""}
                                onChange={e => updateCardField(card.creativeId, "linkUrl", e.target.value)}
                                placeholder="Card URL"
                                className="w-full px-2 py-1 text-xs bg-muted/30 border rounded outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                          </div>
                        )
                      })}
                      {selectedAd.cards.length < 2 && (
                        <p className="text-xs text-amber-600">Carousel ads require at least 2 cards.</p>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Create a carousel ad to begin
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t shrink-0">
          <Button
            className="w-full h-10"
            disabled={local.carousels.every(c => c.cards.length < 2)}
            onClick={handleDone}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Flexible Ads Modal ───────────────────────────────────────────────────────

function FlexibleAdsModal({
  open, onClose, value, onConfirm, availableCreatives,
}: {
  open: boolean
  onClose: () => void
  value: FlexibleAdsState
  onConfirm: (v: FlexibleAdsState) => void
  availableCreatives: Creative[]
}) {
  const [local, setLocal] = useState<FlexibleAdsState>(value)
  const [selectedAdId, setSelectedAdId] = useState<string>("")
  const [selectedGroupId, setSelectedGroupId] = useState<string>("")
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!open) return
    if (value.flexibleAds.length === 0) {
      const g: FlexibleGroup = { id: `g_${Date.now()}`, creativeIds: [] }
      const ad: FlexibleAd = { id: `f_${Date.now()}`, name: "Flexible Ad 1", groups: [g] }
      setLocal({ enabled: value.enabled, flexibleAds: [ad] })
      setSelectedAdId(ad.id); setSelectedGroupId(g.id)
    } else {
      setLocal(value)
      setSelectedAdId(value.flexibleAds[0].id)
      setSelectedGroupId(value.flexibleAds[0].groups[0]?.id || "")
    }
  }, [open])

  const selectedAd = local.flexibleAds.find(a => a.id === selectedAdId)
  const selectedGroup = selectedAd?.groups.find(g => g.id === selectedGroupId)

  const totalLoaded = local.flexibleAds.reduce((sum, a) => sum + a.groups.reduce((s, g) => s + g.creativeIds.length, 0), 0)
  const validFlexibleAds = local.flexibleAds.filter(a => a.groups.some(g => g.creativeIds.length > 0))
  const validCount = validFlexibleAds.length

  // Available media = creatives NOT in current group (can be in other groups/ads)
  const usedInCurrentGroup = new Set(selectedGroup?.creativeIds || [])
  const availableFiltered = availableCreatives
    .filter(c => !usedInCurrentGroup.has(c.id))
    .filter(c => !search || c.file_name.toLowerCase().includes(search.toLowerCase()))

  const addFlexibleAd = () => {
    const g: FlexibleGroup = { id: `g_${Date.now()}`, creativeIds: [] }
    const ad: FlexibleAd = { id: `f_${Date.now()}`, name: `Flexible Ad ${local.flexibleAds.length + 1}`, groups: [g] }
    setLocal(s => ({ ...s, flexibleAds: [...s.flexibleAds, ad] }))
    setSelectedAdId(ad.id); setSelectedGroupId(g.id)
  }
  const deleteFlexibleAd = (id: string) => {
    if (local.flexibleAds.length === 1) return
    const idx = local.flexibleAds.findIndex(a => a.id === id)
    const next = local.flexibleAds.filter(a => a.id !== id)
    setLocal(s => ({ ...s, flexibleAds: next }))
    if (selectedAdId === id) {
      const newSelected = next[Math.max(0, idx - 1)]
      setSelectedAdId(newSelected.id)
      setSelectedGroupId(newSelected.groups[0]?.id || "")
    }
  }
  const addGroup = () => {
    if (!selectedAd || selectedAd.groups.length >= 3) return
    const g: FlexibleGroup = { id: `g_${Date.now()}`, creativeIds: [] }
    setLocal(s => ({
      ...s,
      flexibleAds: s.flexibleAds.map(a => a.id === selectedAdId ? { ...a, groups: [...a.groups, g] } : a),
    }))
    setSelectedGroupId(g.id)
  }
  const deleteGroup = (groupId: string) => {
    if (!selectedAd || selectedAd.groups.length === 1) return
    const idx = selectedAd.groups.findIndex(g => g.id === groupId)
    const nextGroups = selectedAd.groups.filter(g => g.id !== groupId)
    setLocal(s => ({
      ...s,
      flexibleAds: s.flexibleAds.map(a => a.id === selectedAdId ? { ...a, groups: nextGroups } : a),
    }))
    if (selectedGroupId === groupId) setSelectedGroupId(nextGroups[Math.max(0, idx - 1)].id)
  }
  const addToGroup = (creativeId: string) => {
    if (!selectedAd || !selectedGroup || selectedGroup.creativeIds.length >= 10) return
    setLocal(s => ({
      ...s,
      flexibleAds: s.flexibleAds.map(a => a.id !== selectedAdId ? a : {
        ...a,
        groups: a.groups.map(g => g.id !== selectedGroupId ? g : { ...g, creativeIds: [...g.creativeIds, creativeId] }),
      }),
    }))
  }
  const removeFromGroup = (creativeId: string) => {
    if (!selectedAd || !selectedGroup) return
    setLocal(s => ({
      ...s,
      flexibleAds: s.flexibleAds.map(a => a.id !== selectedAdId ? a : {
        ...a,
        groups: a.groups.map(g => g.id !== selectedGroupId ? g : { ...g, creativeIds: g.creativeIds.filter(id => id !== creativeId) }),
      }),
    }))
  }
  const updateAdName = (id: string, name: string) => {
    setLocal(s => ({ ...s, flexibleAds: s.flexibleAds.map(a => a.id === id ? { ...a, name } : a) }))
  }

  const handleDone = () => {
    onConfirm({
      enabled: validCount > 0,
      flexibleAds: local.flexibleAds.filter(a => a.groups.some(g => g.creativeIds.length > 0)),
    })
    onClose()
  }

  const creativeById = (id: string) => availableCreatives.find(c => c.id === id)
  const thumbOf = (c?: Creative) => proxyFbImage(c ? (c.media_type === "video" ? c.fb_thumbnail_url : (c.fb_image_url || c.file_url)) : "")

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-5xl p-0 flex flex-col max-h-[92vh] overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-semibold">
            Group Media Together for Flexible Ads <span className="text-muted-foreground font-normal">({totalLoaded} ads loaded)</span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Create up to 3 groups per flexible ad. Each group holds up to 10 images or videos — Meta optimises delivery across groups.
          </p>
        </div>

        <div className="grid grid-cols-[260px_1fr] flex-1 min-h-0 overflow-hidden">
          {/* LEFT: Flexible Ads list */}
          <div className="border-r flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b shrink-0">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">FLEXIBLE ADS</p>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
              {local.flexibleAds.map(ad => {
                const groupCount = ad.groups.length
                const imgCount = ad.groups.reduce((s, g) => s + g.creativeIds.length, 0)
                return (
                  <div
                    key={ad.id}
                    onClick={() => { setSelectedAdId(ad.id); setSelectedGroupId(ad.groups[0]?.id || "") }}
                    className={cn(
                      "px-3 py-2.5 border rounded-lg cursor-pointer transition-colors group",
                      selectedAdId === ad.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/30"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <input
                        value={ad.name}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateAdName(ad.id, e.target.value)}
                        className={cn(
                          "bg-transparent outline-none text-sm font-semibold flex-1 min-w-0",
                          selectedAdId === ad.id ? "text-primary-foreground" : ""
                        )}
                      />
                      {local.flexibleAds.length > 1 && (
                        <button
                          onClick={e => { e.stopPropagation(); deleteFlexibleAd(ad.id) }}
                          className={cn(
                            "opacity-0 group-hover:opacity-100 transition-opacity",
                            selectedAdId === ad.id ? "text-primary-foreground/70 hover:text-primary-foreground" : "text-muted-foreground hover:text-destructive"
                          )}
                        >
                          <IconTrash className="size-3.5" />
                        </button>
                      )}
                    </div>
                    <p className={cn("text-xs mt-0.5", selectedAdId === ad.id ? "text-primary-foreground/80" : "text-muted-foreground")}>
                      {groupCount} group{groupCount !== 1 ? "s" : ""} · {imgCount} img
                    </p>
                  </div>
                )
              })}
            </div>
            <div className="border-t p-3 shrink-0">
              <Button variant="outline" className="w-full h-8 text-xs gap-1" onClick={addFlexibleAd}>
                <IconPlus className="size-3.5" />New Flexible Ad
              </Button>
            </div>
          </div>

          {/* RIGHT: Groups + media */}
          <div className="flex flex-col overflow-hidden">
            {selectedAd ? (
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* Group tabs */}
                <div className="flex items-center gap-2 flex-wrap">
                  {selectedAd.groups.map((g, i) => (
                    <div key={g.id} className="flex items-center group">
                      <button
                        onClick={() => setSelectedGroupId(g.id)}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-1.5",
                          selectedGroupId === g.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground hover:bg-muted/70"
                        )}
                      >
                        Group {i + 1}
                        <span className={cn("px-1 rounded", selectedGroupId === g.id ? "bg-primary-foreground/20" : "bg-foreground/10")}>
                          {g.creativeIds.length}/10
                        </span>
                        {selectedAd.groups.length > 1 && (
                          <span
                            onClick={e => { e.stopPropagation(); deleteGroup(g.id) }}
                            className="hover:text-destructive ml-1"
                          >
                            <IconX className="size-3" />
                          </span>
                        )}
                      </button>
                    </div>
                  ))}
                  {selectedAd.groups.length < 3 && (
                    <button
                      onClick={addGroup}
                      className="px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-muted-foreground/40 hover:bg-muted/30 transition-colors flex items-center gap-1"
                    >
                      <IconPlus className="size-3" />Add Group
                    </button>
                  )}
                </div>

                {/* Available Media */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">AVAILABLE MEDIA</p>
                    <div className="relative">
                      <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search..."
                        className="pl-7 pr-3 py-1 text-xs bg-background border rounded-md outline-none focus:ring-1 focus:ring-ring w-44"
                      />
                    </div>
                  </div>
                  <div className="border rounded-xl bg-muted/10 min-h-[180px] p-3">
                    {availableFiltered.length === 0 ? (
                      <div className="flex items-center justify-center h-[160px] text-sm text-muted-foreground">
                        No available media
                      </div>
                    ) : (
                      <div className="grid grid-cols-6 gap-2">
                        {availableFiltered.map(c => {
                          const thumb = thumbOf(c)
                          const canAdd = selectedGroup && selectedGroup.creativeIds.length < 10
                          return (
                            <button
                              key={c.id}
                              onClick={() => addToGroup(c.id)}
                              disabled={!canAdd}
                              className="group relative aspect-square rounded-lg overflow-hidden border bg-muted hover:ring-2 hover:ring-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <CreativeCardMedia creative={c} className="w-full h-full object-cover" compact />
                              <div className="absolute inset-0 bg-primary/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <IconPlus className="size-4 text-white" />
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Selected group */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      GROUP {selectedAd.groups.findIndex(g => g.id === selectedGroupId) + 1} — SELECTED
                    </p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {selectedGroup?.creativeIds.length || 0} / 10
                    </span>
                  </div>
                  <div className="border rounded-xl min-h-[180px] p-3">
                    {!selectedGroup || selectedGroup.creativeIds.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-[160px] gap-2 text-center">
                        <div className="size-8 rounded-full bg-muted flex items-center justify-center">
                          <IconPlus className="size-4 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground">No media in Group {selectedAd.groups.findIndex(g => g.id === selectedGroupId) + 1} yet</p>
                        <p className="text-xs text-muted-foreground/70">Click items in Available Media above to add them here</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-6 gap-2">
                        {selectedGroup.creativeIds.map(id => {
                          const c = creativeById(id)
                          return (
                            <div key={id} className="group relative aspect-square rounded-lg overflow-hidden border bg-muted">
                              {c && <CreativeCardMedia creative={c} className="w-full h-full object-cover" compact />}
                              <button
                                onClick={() => removeFromGroup(id)}
                                className="absolute top-0.5 right-0.5 size-5 rounded-full bg-background/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                              >
                                <IconX className="size-2.5" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Create a flexible ad to begin
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t shrink-0">
          <Button
            className="w-full h-10"
            disabled={validCount === 0}
            onClick={handleDone}
          >
            Done ({validCount} flexible ad{validCount !== 1 ? "s" : ""} configured) ↵
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Creative Group Modal ─────────────────────────────────────────────────────
// Simplified entry point onto the same Flexible Ads (Dynamic Creative) engine:
// no groups concept, just pick up to `maxMedia` media for a single ad — Meta
// tests which one performs best. Experimental cap, raise once validated.

function CreativeGroupModal({
  open, onClose, value, onConfirm, availableCreatives, maxMedia = 5,
}: {
  open: boolean
  onClose: () => void
  value: FlexibleAdsState
  onConfirm: (v: FlexibleAdsState) => void
  availableCreatives: Creative[]
  maxMedia?: number
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!open) return
    const firstGroup = value.flexibleAds[0]?.groups[0]
    setSelectedIds(value.enabled && firstGroup ? firstGroup.creativeIds.slice(0, maxMedia) : [])
    setSearch("")
  }, [open])

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= maxMedia) return prev
      return [...prev, id]
    })
  }

  const filtered = availableCreatives.filter(c => !search || c.file_name.toLowerCase().includes(search.toLowerCase()))

  const handleDone = () => {
    onConfirm({
      enabled: selectedIds.length > 0,
      flexibleAds: selectedIds.length > 0
        ? [{ id: `f_${Date.now()}`, name: "Creative Group 1", groups: [{ id: `g_${Date.now()}`, creativeIds: selectedIds }] }]
        : [],
    })
    onClose()
  }

  const thumbOf = (c: Creative) => proxyFbImage(c.media_type === "video" ? c.fb_thumbnail_url : (c.fb_image_url || c.file_url))

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 flex flex-col max-h-[85vh] overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-semibold">
            Creative Group <span className="text-muted-foreground font-normal">({selectedIds.length}/{maxMedia} media)</span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Combine up to {maxMedia} images/videos into a single ad — Meta tests which one performs best. Experimental cap, same engine as Flexible Ads.
          </p>
        </div>

        <div className="px-5 py-3 border-b shrink-0">
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search media..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">No media found.</p>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {filtered.map(c => {
                const idx = selectedIds.indexOf(c.id)
                const selected = idx !== -1
                const disabled = !selected && selectedIds.length >= maxMedia
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(c.id)}
                    className={cn(
                      "relative aspect-square rounded-md overflow-hidden border-2 transition",
                      selected ? "border-primary" : "border-transparent hover:border-muted-foreground/30",
                      disabled && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    <img src={thumbOf(c)} alt={c.file_name} className="w-full h-full object-cover" />
                    {c.media_type === "video" && (
                      <span className="absolute bottom-1 left-1 size-4 rounded-full bg-black/60 flex items-center justify-center">
                        <IconVideo className="size-2.5 text-white" />
                      </span>
                    )}
                    {selected && (
                      <span className="absolute top-1 right-1 size-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">
                        {idx + 1}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleDone} disabled={selectedIds.length === 0}>
            {selectedIds.length > 0 ? `Group ${selectedIds.length} media into 1 ad` : "Select media"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Multi Placement Ads Modal ────────────────────────────────────────────────

const META_PLACEMENTS = [
  { key: "feed", label: "Feed (1:1, 4:5)", platforms: ["facebook", "instagram"], positions: ["feed"] },
  { key: "story", label: "Stories (9:16)", platforms: ["facebook", "instagram"], positions: ["story"] },
  { key: "reels", label: "Reels (9:16)", platforms: ["facebook", "instagram"], positions: ["reels"] },
  { key: "right_column", label: "Right Column (1:1)", platforms: ["facebook"], positions: ["right_hand_column"] },
  { key: "marketplace", label: "Marketplace (1:1)", platforms: ["facebook"], positions: ["marketplace"] },
  { key: "explore", label: "Explore (1:1, 4:5)", platforms: ["instagram"], positions: ["explore"] },
]

function MultiPlacementAdsModal({
  open, onClose, value, onConfirm, availableCreatives,
}: {
  open: boolean
  onClose: () => void
  value: MultiPlacementAdsState
  onConfirm: (v: MultiPlacementAdsState) => void
  availableCreatives: Creative[]
}) {
  const [local, setLocal] = useState<MultiPlacementAdsState>(value)
  const [activeGroupId, setActiveGroupId] = useState<string>("")
  const [search, setSearch] = useState("")
  const [view, setView] = useState<"grid" | "list">("grid")

  useEffect(() => {
    if (!open) return
    setLocal(value)
    if (value.groups.length > 0) setActiveGroupId(value.groups[0].id)
    else setActiveGroupId("")
  }, [open])

  const validGroupCount = local.groups.filter(g => g.creativeIds.length >= 2).length

  const usedAcrossActiveGroup = new Set(local.groups.find(g => g.id === activeGroupId)?.creativeIds || [])
  const filteredAvailable = availableCreatives
    .filter(c => !usedAcrossActiveGroup.has(c.id))
    .filter(c => !search || c.file_name.toLowerCase().includes(search.toLowerCase()))

  const addGroup = () => {
    const g: MultiPlacementGroup = {
      id: `mg_${Date.now()}`,
      name: `Multi Group ${local.groups.length + 1}`,
      creativeIds: [],
    }
    setLocal(s => ({ ...s, groups: [...s.groups, g] }))
    setActiveGroupId(g.id)
  }
  const deleteGroup = (id: string) => {
    const idx = local.groups.findIndex(g => g.id === id)
    const next = local.groups.filter(g => g.id !== id)
    setLocal(s => ({ ...s, groups: next }))
    if (activeGroupId === id) setActiveGroupId(next[Math.max(0, idx - 1)]?.id || "")
  }
  const updateGroupName = (id: string, name: string) => {
    setLocal(s => ({ ...s, groups: s.groups.map(g => g.id === id ? { ...g, name } : g) }))
  }
  const addToActiveGroup = (creativeId: string) => {
    if (!activeGroupId) {
      // Auto-create first group
      const g: MultiPlacementGroup = {
        id: `mg_${Date.now()}`,
        name: "Multi Group 1",
        creativeIds: [creativeId],
      }
      setLocal(s => ({ ...s, groups: [...s.groups, g] }))
      setActiveGroupId(g.id)
      return
    }
    setLocal(s => ({
      ...s,
      groups: s.groups.map(g => g.id !== activeGroupId ? g : (
        g.creativeIds.includes(creativeId) ? g : { ...g, creativeIds: [...g.creativeIds, creativeId] }
      )),
    }))
  }
  const removeFromGroup = (groupId: string, creativeId: string) => {
    setLocal(s => ({
      ...s,
      groups: s.groups.map(g => g.id !== groupId ? g : { ...g, creativeIds: g.creativeIds.filter(id => id !== creativeId) }),
    }))
  }
  const togglePlacement = (groupId: string, creativeId: string, placementKey: string) => {
    setLocal(s => ({
      ...s,
      groups: s.groups.map(g => {
        if (g.id !== groupId) return g
        const placements = { ...(g.placements || {}) }
        const list = placements[creativeId] || []
        placements[creativeId] = list.includes(placementKey)
          ? list.filter(p => p !== placementKey)
          : [...list, placementKey]
        return { ...g, placements }
      }),
    }))
  }
  const handleDone = () => {
    onConfirm({
      ...local,
      enabled: validGroupCount > 0,
      groups: local.groups.filter(g => g.creativeIds.length >= 2),
    })
    onClose()
  }

  const creativeById = (id: string) => availableCreatives.find(c => c.id === id)
  const thumbOf = (c?: Creative) => proxyFbImage(c ? (c.media_type === "video" ? c.fb_thumbnail_url : (c.fb_image_url || c.file_url)) : "")

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-6xl p-0 flex flex-col max-h-[92vh] overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-semibold">
            Group Media Together for Multi Placement Ads <span className="text-muted-foreground font-normal">({validGroupCount} ads loaded)</span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pair your ads together to optimize for different placements. You can combine a square format (1:1) / (4:5) for Facebook newsfeed with a vertical format (9:16) for Instagram Stories.
          </p>
        </div>

        {/* Manual Placements toggle */}
        <div className="px-5 py-3 border-b shrink-0 flex items-center gap-2">
          <span className="text-sm font-medium">Manual Placements</span>
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 font-bold">BETA</span>
          <button
            onClick={() => setLocal(s => ({ ...s, manualPlacements: !s.manualPlacements }))}
            className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              local.manualPlacements ? "bg-primary" : "bg-muted-foreground/30")}
          >
            <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
              local.manualPlacements ? "translate-x-4" : "translate-x-0.5")} />
          </button>
        </div>

        {/* Body */}
        <div className="grid grid-cols-[1fr_360px] flex-1 min-h-0 overflow-hidden">
          {/* LEFT: Available Media */}
          <div className="border-r flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b shrink-0">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-sm font-semibold">Available Media</span>
                <span className="text-xs text-muted-foreground">• Select ads to group</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search media..."
                    className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="flex items-center bg-muted/30 border rounded-lg p-0.5">
                  <button onClick={() => setView("grid")}
                    className={cn("size-6 flex items-center justify-center rounded transition-colors",
                      view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                    <IconLayoutGrid className="size-3.5" />
                  </button>
                  <button onClick={() => setView("list")}
                    className={cn("size-6 flex items-center justify-center rounded transition-colors",
                      view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                    <IconTable className="size-3.5" />
                  </button>
                </div>
                <IconInfoCircle className="size-3.5 text-muted-foreground" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-muted/10">
              {filteredAvailable.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No available media
                </div>
              ) : view === "grid" ? (
                <div className="grid grid-cols-5 gap-2">
                  {filteredAvailable.map(c => {
                    const thumb = thumbOf(c)
                    return (
                      <button
                        key={c.id}
                        onClick={() => addToActiveGroup(c.id)}
                        className="group relative aspect-square rounded-lg overflow-hidden border bg-muted hover:ring-2 hover:ring-primary transition-all"
                      >
                        <CreativeCardMedia creative={c} className="w-full h-full object-cover" compact />
                        <div className="absolute inset-0 bg-primary/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <IconPlus className="size-5 text-white" />
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredAvailable.map(c => {
                    const thumb = thumbOf(c)
                    return (
                      <button
                        key={c.id}
                        onClick={() => addToActiveGroup(c.id)}
                        className="w-full flex items-center gap-3 p-2 border rounded-lg hover:bg-background transition-colors text-left"
                      >
                        <div className="size-10 rounded overflow-hidden bg-muted shrink-0">
                          <CreativeCardMedia creative={c} className="w-full h-full object-cover" compact />
                        </div>
                        <span className="text-sm truncate flex-1">{c.file_name}</span>
                        <IconPlus className="size-4 text-muted-foreground shrink-0" />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Multi-format groups preview */}
          <div className="flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b shrink-0 flex items-center justify-between">
              <span className="text-sm font-semibold">Multi-Format Groups Preview</span>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addGroup}>
                <IconPlus className="size-3" />New Group
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-muted/10 space-y-3">
              {local.groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <p className="text-sm text-muted-foreground">No multi-format groups yet</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Click "New Group" to create your first multi-format group</p>
                </div>
              ) : (
                local.groups.map(g => (
                  <div
                    key={g.id}
                    onClick={() => setActiveGroupId(g.id)}
                    className={cn(
                      "border rounded-xl p-3 bg-background cursor-pointer transition-all",
                      activeGroupId === g.id ? "border-primary ring-1 ring-primary/30" : "hover:border-muted-foreground/30"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        value={g.name}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateGroupName(g.id, e.target.value)}
                        className="flex-1 bg-transparent outline-none text-sm font-semibold"
                      />
                      <span className="text-xs text-muted-foreground">{g.creativeIds.length} media</span>
                      <button
                        onClick={e => { e.stopPropagation(); deleteGroup(g.id) }}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <IconTrash className="size-3.5" />
                      </button>
                    </div>
                    {g.creativeIds.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Click media on the left to add</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5">
                        {g.creativeIds.map(id => {
                          const c = creativeById(id)
                          const thumb = thumbOf(c)
                          return (
                            <div key={id} className="relative group">
                              <div className="aspect-square rounded overflow-hidden bg-muted border">
                                <CreativeCardMedia creative={c!} className="w-full h-full object-cover" compact />
                              </div>
                              <button
                                onClick={e => { e.stopPropagation(); removeFromGroup(g.id, id) }}
                                className="absolute -top-1 -right-1 size-4 rounded-full bg-background border shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100"
                              >
                                <IconX className="size-2.5" />
                              </button>
                              {/* Manual placements selector */}
                              {local.manualPlacements && (
                                <div className="mt-1 flex flex-wrap gap-0.5">
                                  {META_PLACEMENTS.map(p => {
                                    const active = (g.placements?.[id] || []).includes(p.key)
                                    return (
                                      <button
                                        key={p.key}
                                        onClick={e => { e.stopPropagation(); togglePlacement(g.id, id, p.key) }}
                                        className={cn(
                                          "text-xs px-1 py-0.5 rounded transition-colors",
                                          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
                                        )}
                                        title={p.label}
                                      >
                                        {p.key}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {g.creativeIds.length === 1 && (
                      <p className="text-xs text-amber-600 mt-1.5">Add at least 2 different aspect ratios</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t shrink-0">
          <Button
            className="w-full h-10"
            disabled={validGroupCount === 0}
            onClick={handleDone}
          >
            Done ({validGroupCount} multi ad{validGroupCount !== 1 ? "s" : ""} created) ↵
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Preview Modal ────────────────────────────────────────────────────────────

const MOCKUP_PLATFORMS = [
  { key: "meta", label: "Meta", Icon: IconBrandMeta },
  { key: "instagram", label: "Instagram", Icon: IconBrandInstagram },
  { key: "tiktok", label: "TikTok", Icon: IconBrandTiktok },
  { key: "snapchat", label: "Snapchat", Icon: IconBrandSnapchat },
  { key: "admanage", label: "AdManage", Icon: IconRocket },
  { key: "loom", label: "Loom", Icon: IconPlayerPlay },
  { key: "reddit", label: "Reddit", Icon: IconBrandReddit },
  { key: "linkedin", label: "LinkedIn", Icon: IconBrandLinkedin },
] as const
type MockupPlatform = typeof MOCKUP_PLATFORMS[number]["key"]

// ─── Platform Mockups ────────────────────────────────────────────────────────

interface MockupProps {
  mockup: MockupPlatform
  placement: "feed" | "story"
  page?: FacebookPage
  creative: Creative
  thumb?: string
  isVideo: boolean
  primaryText: string
  headline: string
  description?: string
  webLink: string
  ctaLabel: string
  primaryExpanded: boolean
  setPrimaryExpanded: (v: boolean) => void
}

function MediaArea({ thumb, creative, isVideo, aspect = "aspect-square", roundBottom = false }: {
  thumb?: string
  creative: Creative
  isVideo: boolean
  aspect?: string
  roundBottom?: boolean
}) {
  const duration = (creative as any).duration as string | undefined
  return (
    <div className={cn("relative bg-black group/media overflow-hidden", aspect, roundBottom && "rounded-b-xl")}>
      {thumb && (
        <img
          src={thumb}
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60 pointer-events-none"
          alt=""
          onError={e => e.currentTarget.style.display="none"}
        />
      )}
      <div className="relative w-full h-full z-10">
        <CreativeCardMedia creative={creative} className="w-full h-full object-contain bg-transparent" />
      </div>
      {/* Duration badge top-left (matches admanage.ai reference) */}
      {isVideo && duration && (
        <div className="absolute top-2 left-2 z-30 px-2 py-0.5 rounded-md bg-black/70 text-white text-xs font-semibold tracking-wide pointer-events-none">
          {duration}
        </div>
      )}
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity group-hover/media:opacity-0 z-20">
          <div className="size-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <IconPlayerPlay className="size-6 text-foreground translate-x-0.5" />
          </div>
        </div>
      )}
    </div>
  )
}

function PlatformMockup(props: MockupProps) {
  const { mockup } = props
  switch (mockup) {
    case "instagram": return <InstagramMockup {...props} />
    case "tiktok": return <TikTokMockup {...props} />
    case "snapchat": return <SnapchatMockup {...props} />
    case "admanage": return <AdManageMockup {...props} />
    case "loom": return <LoomMockup {...props} />
    case "reddit": return <RedditMockup {...props} />
    case "linkedin": return <LinkedInMockup {...props} />
    default: return <MetaMockup {...props} />
  }
}

// ── META / FACEBOOK ──
function MetaMockup({ page, creative, thumb, isVideo, primaryText, headline, description, webLink, ctaLabel, primaryExpanded, setPrimaryExpanded, placement }: MockupProps) {
  if (placement === "story") {
    return (
      <div className="w-full max-w-[300px] bg-black rounded-[20px] overflow-hidden shadow-xl relative" style={{ aspectRatio: "9/16" }}>
        {/* Progress bars */}
        <div className="absolute top-2 left-2 right-2 z-30 flex gap-1">
          {[0.4, 0, 0].map((fill, i) => (
            <div key={i} className="flex-1 h-[2px] bg-white/40 rounded-full overflow-hidden">
              {fill > 0 && <div className="h-full bg-white rounded-full" style={{ width: `${fill * 100}%` }} />}
            </div>
          ))}
        </div>
        {/* Header overlay */}
        <div className="absolute top-5 left-0 right-0 z-30 flex items-center gap-2 px-3">
          {page?.picture?.data?.url
            ? <img src={page.picture.data.url} className="size-8 rounded-full object-cover border-2 border-white shrink-0" alt="" />
            : <div className="size-8 rounded-full bg-emerald-600 flex items-center justify-center shrink-0 border-2 border-white"><span className="text-xs font-bold text-white">{(page?.name || "P").slice(0, 1)}</span></div>}
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold leading-tight truncate">{page?.name || "Your Page"}</p>
            <p className="text-white/70 text-xs">Sponsored</p>
          </div>
          <button className="text-white/90 p-1.5 hover:bg-white/10 rounded-full transition-colors"><IconDotsVertical className="size-4" /></button>
          <button className="text-white/90 p-1.5 hover:bg-white/10 rounded-full transition-colors"><IconX className="size-4" /></button>
        </div>
        {/* Media fills full */}
        <div className="absolute inset-0">
          <CreativeCardMedia creative={creative} className="w-full h-full object-cover" />
        </div>
        {/* Bottom gradient + text + CTA */}
        <div className="absolute bottom-0 left-0 right-0 z-20 px-3 pb-5 pt-14 bg-gradient-to-t from-black/75 to-transparent">
          {primaryText && (
            <div className="mb-2.5">
              <p className={cn("text-white text-xs leading-snug", primaryExpanded ? "" : "line-clamp-2")}>{primaryText}</p>
              {primaryText.length > 80 && (
                <button onClick={() => setPrimaryExpanded(!primaryExpanded)} className="text-white/60 text-xs flex items-center gap-0.5 mt-0.5">
                  {primaryExpanded ? <IconChevronDown className="size-3" /> : <IconChevronUp className="size-3" />}
                </button>
              )}
            </div>
          )}
          <button className="w-full bg-white text-black font-bold text-sm py-2.5 rounded-full">{ctaLabel}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-[340px] bg-background border rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {page?.picture?.data?.url
          ? <img src={page.picture.data.url} className="size-9 rounded-full shrink-0 object-cover border" alt="" />
          : <div className="size-10 rounded-full bg-emerald-600 flex items-center justify-center shrink-0"><span className="text-sm font-bold text-white">{(page?.name || "P").slice(0, 1)}</span></div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-sm font-bold hover:underline cursor-pointer">{page?.name || "Your Page"}</span>
            <IconCircleCheck className="size-3.5 text-primary shrink-0" />
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <p className="text-xs text-[#65676B] font-medium">Sponsored</p>
            <span className="text-[#65676B]">·</span>
            <IconWorld className="size-3 text-[#65676B]" />
          </div>
        </div>
        <button className="text-[#65676B] p-1.5 rounded-full hover:bg-muted/60 transition-colors"><IconDotsVertical className="size-4" /></button>
      </div>
      {primaryText && (
        <div className="px-3 pb-2.5 text-xs">
          <p className={primaryExpanded ? "" : "line-clamp-3"}>{primaryText}</p>
          {primaryText.length > 120 && (
            <button onClick={() => setPrimaryExpanded(!primaryExpanded)} className="text-muted-foreground hover:underline text-xs mt-0.5">
              {primaryExpanded ? "See less" : "See more"}
            </button>
          )}
        </div>
      )}
      <MediaArea thumb={thumb} creative={creative} isVideo={isVideo} aspect="aspect-square" />
      <div className="flex items-center justify-between px-3 py-2.5 bg-muted/30 border-t">
        <div className="flex-1 min-w-0">
          {headline
            ? <p className="text-sm font-semibold truncate leading-tight text-foreground/90">{headline}</p>
            : <p className="text-sm font-semibold truncate leading-tight text-muted-foreground/50 italic">No headline</p>}
          {description && <p className="text-xs text-[#65676B] truncate leading-tight mt-0.5">{description}</p>}
        </div>
        <Button size="sm" variant="outline" className="h-8 px-4 text-xs font-bold bg-[#E4E6EB] hover:bg-[#D8DADF] border-none text-[#050505] shrink-0 ml-3 rounded-lg">{ctaLabel}</Button>
      </div>
      <div className="flex items-center gap-3 px-3 py-2 border-t">
        <div className="flex items-center gap-1 text-xs text-[#65676B]">
          <div className="flex -space-x-1 mr-1">
            <span className="size-[18px] rounded-full bg-[#1877F2] border-2 border-background flex items-center justify-center"><IconThumbUp className="size-[10px] text-white" /></span>
            <span className="size-[18px] rounded-full bg-[#F33E58] border-2 border-background flex items-center justify-center text-white text-xs">♥</span>
          </div>
          <span className="hover:underline cursor-pointer">420</span>
        </div>
        <span className="text-xs text-[#65676B] ml-auto hover:underline cursor-pointer">96 comments</span>
      </div>
      <div className="grid grid-cols-3 border-t mx-3 my-1">
        {[{i: IconThumbUp, l: "Like"}, {i: IconMessageCircle, l: "Comment"}, {i: IconShare3, l: "Share"}].map(({i: I, l}) => (
          <button key={l} className="flex items-center justify-center gap-2 py-1.5 text-xs font-semibold text-[#65676B] hover:bg-muted/50 rounded-md">
            <I className="size-[18px]" />{l}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── INSTAGRAM ──
function InstagramMockup({ page, creative, thumb, isVideo, primaryText, ctaLabel, primaryExpanded, setPrimaryExpanded, placement }: MockupProps) {
  if (placement === "story") {
    return (
      <div className="w-full max-w-[300px] bg-black rounded-[20px] overflow-hidden shadow-xl relative" style={{ aspectRatio: "9/16" }}>
        {/* Progress bars */}
        <div className="absolute top-2 left-2 right-2 z-30 flex gap-1">
          {[0, 0.5, 0].map((fill, i) => (
            <div key={i} className="flex-1 h-[2px] bg-white/40 rounded-full overflow-hidden">
              {fill > 0 && <div className="h-full bg-white rounded-full" style={{ width: `${fill * 100}%` }} />}
            </div>
          ))}
        </div>
        {/* Header overlay */}
        <div className="absolute top-5 left-0 right-0 z-30 flex items-center gap-2 px-3">
          {page?.picture?.data?.url
            ? <div className="size-8 rounded-full overflow-hidden border-2 border-white shrink-0"><img src={page.picture.data.url} className="w-full h-full object-cover" alt="" /></div>
            : <div className="size-8 rounded-full bg-gradient-to-br from-yellow-400 via-pink-500 to-purple-600 p-[2px] shrink-0"><div className="size-full rounded-full bg-black/40 flex items-center justify-center text-white text-xs font-bold">{(page?.name || "P").slice(0, 1)}</div></div>}
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold leading-tight truncate">{page?.name || "Your Page"}</p>
            <p className="text-white/70 text-xs">Ad</p>
          </div>
          <button className="text-white/90 p-1.5 hover:bg-white/10 rounded-full transition-colors"><IconDotsVertical className="size-4" /></button>
          <button className="text-white/90 p-1.5 hover:bg-white/10 rounded-full transition-colors"><IconX className="size-4" /></button>
        </div>
        {/* Media */}
        <div className="absolute inset-0">
          <CreativeCardMedia creative={creative} className="w-full h-full object-cover" />
        </div>
        {/* Bottom */}
        <div className="absolute bottom-0 left-0 right-0 z-20 px-3 pb-5 pt-14 bg-gradient-to-t from-black/75 to-transparent">
          {primaryText && (
            <div className="mb-2.5">
              <p className={cn("text-white text-xs leading-snug", primaryExpanded ? "" : "line-clamp-2")}>{primaryText}</p>
              {primaryText.length > 80 && (
                <button onClick={() => setPrimaryExpanded(!primaryExpanded)} className="text-white/60 text-xs flex items-center gap-0.5 mt-0.5">
                  {primaryExpanded ? <IconChevronDown className="size-3" /> : <IconChevronUp className="size-3" />}
                </button>
              )}
            </div>
          )}
          <button className="w-full bg-white text-black font-bold text-sm py-2.5 rounded-full">{ctaLabel}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-[340px] bg-background border rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          {page?.picture?.data?.url
            ? <img src={page.picture.data.url} className="size-9 rounded-full object-cover ring-2 ring-pink-500/30" alt="" />
            : <div className="size-9 rounded-full bg-gradient-to-br from-yellow-400 via-pink-500 to-purple-600 p-0.5"><div className="size-full rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold">{(page?.name || "P").slice(0, 1)}</div></div>}
          <div>
            <p className="text-xs font-semibold leading-tight">@{page?.name?.toLowerCase().replace(/\s+/g, "") || "your_page"}</p>
            <p className="text-xs text-muted-foreground">Sponsored</p>
          </div>
        </div>
        <button><IconDotsVertical className="size-4" /></button>
      </div>
      <MediaArea thumb={thumb} creative={creative} isVideo={isVideo} aspect="aspect-square" />
      <div className="px-3 py-2 flex items-center gap-3">
        <IconHeart className="size-6" />
        <IconMessageCircle className="size-6" />
        <IconSend className="size-6" />
        <IconBookmarkOutline className="size-6 ml-auto" />
      </div>
      <p className="px-3 pb-3 text-xs font-semibold">@{page?.name?.toLowerCase().replace(/\s+/g, "") || "your_page"}</p>
    </div>
  )
}

// ── TIKTOK ──
function TikTokMockup({ page, creative, thumb, isVideo, ctaLabel }: MockupProps) {
  return (
    <div className="w-full max-w-[280px] bg-black rounded-2xl overflow-hidden shadow-xl relative" style={{ aspectRatio: "9/16" }}>
      {/* Top tabs */}
      <div className="absolute top-0 left-0 right-0 z-30 flex justify-center items-center gap-6 pt-3 pb-2 text-white">
        <span className="text-sm opacity-70">Following</span>
        <span className="text-sm font-bold border-b-2 border-white pb-0.5">For You</span>
      </div>
      {/* Media background */}
      <div className="absolute inset-0">
        <CreativeCardMedia creative={creative} className="w-full h-full object-cover" />
      </div>
      {/* Right side actions */}
      <div className="absolute right-2 bottom-20 flex flex-col items-center gap-4 z-20 text-white">
        {page?.picture?.data?.url
          ? <div className="relative"><img src={page.picture.data.url} className="size-10 rounded-full ring-2 ring-white object-cover" alt="" /><div className="absolute -bottom-1 left-1/2 -translate-x-1/2 size-4 rounded-full bg-red-500 flex items-center justify-center text-white text-xs font-bold">+</div></div>
          : <div className="size-10 rounded-full bg-pink-500 flex items-center justify-center text-white font-bold ring-2 ring-white">{(page?.name || "Y").slice(0, 1)}</div>}
        <div className="flex flex-col items-center"><IconHeart className="size-7" /><span className="text-xs font-semibold">991K</span></div>
        <div className="flex flex-col items-center"><IconMessageCircle className="size-7" /><span className="text-xs font-semibold">3456</span></div>
        <div className="flex flex-col items-center"><IconBookmarkOutline className="size-7" /><span className="text-xs font-semibold">810</span></div>
        <div className="flex flex-col items-center"><IconShare3 className="size-7" /><span className="text-xs font-semibold">1256</span></div>
      </div>
      {/* Bottom info + CTA */}
      <div className="absolute left-0 right-0 bottom-12 px-3 z-20 text-white">
        <p className="text-sm font-bold mb-0.5">{page?.name || "Your Page Name"}</p>
        <p className="text-xs opacity-80 mb-2">Sponsored</p>
        <button className="w-full bg-[#FE2C55] text-white text-sm font-semibold py-2 rounded">{ctaLabel}</button>
      </div>
      {/* Bottom nav */}
      <div className="absolute bottom-0 left-0 right-0 grid grid-cols-5 py-2 bg-black/80 z-20 text-white">
        {["Home", "Friends", "+", "Inbox", "Me"].map(l => (
          <span key={l} className="text-center text-xs font-medium">{l}</span>
        ))}
      </div>
    </div>
  )
}

// ── SNAPCHAT ──
function SnapchatMockup({ page, creative, thumb, isVideo, headline, webLink, ctaLabel }: MockupProps) {
  return (
    <div className="w-full max-w-[280px] bg-black rounded-3xl overflow-hidden shadow-xl relative" style={{ aspectRatio: "9/19.5" }}>
      {/* Status bar */}
      <div className="absolute top-0 left-0 right-0 z-30 flex justify-between items-center px-5 pt-2 pb-1 text-white text-xs font-semibold">
        <span>9:41</span>
        <div className="flex items-center gap-1">
          <span>•••</span>
          <span>📶</span>
          <span>🔋</span>
        </div>
      </div>
      <div className="absolute top-7 left-3 right-3 z-30 flex items-center gap-2 text-white">
        {page?.picture?.data?.url
          ? <img src={page.picture.data.url} className="size-7 rounded-full object-cover" alt="" />
          : <div className="size-7 rounded-full bg-emerald-500" />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold flex items-center gap-1">{page?.name || "Your Page"} <span className="opacity-70">· Ad</span></p>
          <p className="text-xs opacity-80">{headline || "Your headline here"}</p>
        </div>
        <button><IconDotsVertical className="size-4" /></button>
      </div>
      {/* Media */}
      <div className="absolute inset-0">
        <CreativeCardMedia creative={creative} className="w-full h-full object-cover" />
      </div>
      {/* Bottom card */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-black/95 px-3 pt-3 pb-2 text-white">
        <div className="flex items-center gap-2 mb-2">
          {page?.picture?.data?.url
            ? <img src={page.picture.data.url} className="size-8 rounded-full object-cover" alt="" />
            : <div className="size-8 rounded-full bg-emerald-500" />}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold flex items-center gap-1 truncate">{page?.name || "Your Page"} <IconArrowRight className="size-3" /></p>
            <p className="text-xs opacity-80 truncate">{headline || "Your headline here"}</p>
            <p className="text-xs opacity-60 truncate">{(() => { try { return new URL(webLink).hostname } catch { return webLink || "your-link.com" } })()}</p>
          </div>
          <IconHeart className="size-5" />
        </div>
        <button className="w-full bg-yellow-400 text-black font-bold text-sm py-2 rounded-full mb-1">{ctaLabel}</button>
      </div>
    </div>
  )
}

// ── ADMANAGE (custom phone mockup) ──
function AdManageMockup({ creative, thumb, isVideo }: MockupProps) {
  const [tab, setTab] = useState<"video" | "endcard">("video")
  return (
    <div className="w-full max-w-[300px]">
      <div className="flex items-center justify-center gap-2 mb-3">
        <button onClick={() => setTab("video")} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium", tab === "video" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
          <IconPlayerPlay className="size-4" />Video
        </button>
        <button onClick={() => setTab("endcard")} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium", tab === "endcard" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
          <IconPhoto className="size-4" />Endcard
        </button>
      </div>
      <div className="relative bg-black rounded-[2.5rem] p-2 shadow-2xl">
        <div className="rounded-[2rem] overflow-hidden bg-black" style={{ aspectRatio: "9/19.5" }}>
          <CreativeCardMedia creative={creative} className="w-full h-full object-cover" />
        </div>
      </div>
    </div>
  )
}

// ── LOOM (video player style) ──
function LoomMockup({ creative, thumb, isVideo, webLink, ctaLabel }: MockupProps) {
  const duration = (creative as any).duration || "0:52"
  return (
    <div className="w-full max-w-[400px] bg-background border rounded-xl overflow-hidden shadow-sm">
      <MediaArea thumb={thumb} creative={creative} isVideo={isVideo} aspect="aspect-video" />
      <div className="bg-black/95 text-white px-3 py-2 flex items-center gap-2 text-xs">
        <IconPlayerPlay className="size-4" />
        <span className="opacity-80">0:00 / {duration}</span>
        <IconVolumeOff className="size-4 ml-auto opacity-80" />
        <IconMaximize className="size-4 opacity-80" />
        <IconDotsVertical className="size-4 opacity-80" />
      </div>
      <div className="flex items-center justify-between px-3 py-2.5 bg-background border-t">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate"><span className="font-medium text-foreground">{(() => { try { return new URL(webLink).hostname } catch { return webLink || "your-link.com" } })()}</span> · Sponsored</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs rounded-full ml-3 shrink-0">{ctaLabel}</Button>
      </div>
    </div>
  )
}

// ── REDDIT ──
function RedditMockup({ page, creative, thumb, isVideo, headline, webLink, ctaLabel }: MockupProps) {
  return (
    <div className="w-full max-w-[400px] bg-background border rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2.5">
        {page?.picture?.data?.url
          ? <img src={page.picture.data.url} className="size-8 rounded-full object-cover" alt="" />
          : <div className="size-8 rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-bold">{(page?.name || "U").slice(0, 1)}</div>}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">u/{page?.name?.toLowerCase().replace(/\s+/g, "") || "your_page"} · <span className="text-muted-foreground font-normal">Promoted</span></p>
        </div>
        <button><IconDotsVertical className="size-4" /></button>
      </div>
      {headline && <p className="px-3 pb-2 text-base font-bold leading-tight">{headline}</p>}
      <MediaArea thumb={thumb} creative={creative} isVideo={isVideo} aspect="aspect-square" />
      <div className="flex items-center justify-between px-3 py-2.5 border-t">
        <p className="text-xs text-muted-foreground truncate font-medium">{(() => { try { return new URL(webLink).hostname } catch { return webLink || "your-link.com" } })()}</p>
        <Button size="sm" variant="outline" className="h-8 text-xs rounded-full ml-3 shrink-0">{ctaLabel}</Button>
      </div>
      <div className="flex items-center gap-4 px-3 py-2 border-t text-muted-foreground">
        <div className="flex items-center gap-1"><IconArrowUp className="size-4" /><span className="text-xs font-medium">Vote</span><IconArrowDown className="size-4" /></div>
        <div className="flex items-center gap-1"><IconMessageCircle className="size-4" /><span className="text-xs">0</span></div>
        <div className="flex items-center gap-1 ml-auto"><IconShare3 className="size-4" /><span className="text-xs">Share</span></div>
      </div>
    </div>
  )
}

// ── LINKEDIN ──
function LinkedInMockup({ page, creative, thumb, isVideo, primaryText, headline, webLink, ctaLabel, primaryExpanded, setPrimaryExpanded }: MockupProps) {
  return (
    <div className="w-full max-w-[400px] bg-background border rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-start gap-2.5 px-3 py-3">
        {page?.picture?.data?.url
          ? <img src={page.picture.data.url} className="size-12 rounded-full object-cover" alt="" />
          : <div className="size-12 rounded-full bg-emerald-500 flex items-center justify-center text-white text-base font-bold">{(page?.name || "P").slice(0, 1)}</div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-sm font-bold truncate">{page?.name || "Your Page"}</p>
            <span className="size-4 bg-[#0A66C2] flex items-center justify-center rounded-sm"><IconBrandLinkedin className="size-3 text-white" /></span>
          </div>
          <p className="text-xs text-muted-foreground">Followers</p>
          <p className="text-xs text-muted-foreground">Promoted · <IconWorld className="size-3 inline" /></p>
        </div>
        <button className="text-[#0A66C2] text-xs font-semibold flex items-center gap-1 hover:bg-primary/10 px-2 py-1 rounded">
          <IconPlusFollow className="size-3.5" />Follow
        </button>
      </div>
      {primaryText && (
        <div className="px-3 pb-2.5 text-xs">
          <p className={primaryExpanded ? "" : "line-clamp-3"}>{primaryText}</p>
          {primaryText.length > 120 && (
            <button onClick={() => setPrimaryExpanded(!primaryExpanded)} className="text-muted-foreground hover:underline text-xs mt-0.5">
              {primaryExpanded ? "see less" : "…see more"}
            </button>
          )}
        </div>
      )}
      <MediaArea thumb={thumb} creative={creative} isVideo={isVideo} aspect="aspect-square" />
      <div className="flex items-center justify-between px-3 py-2.5 bg-muted/30 border-t">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground uppercase truncate font-medium">{(() => { try { return new URL(webLink).hostname } catch { return webLink || "your-link.com" } })()}</p>
          {headline && <p className="text-sm font-semibold truncate leading-tight mt-0.5">{headline}</p>}
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs font-semibold rounded-full ml-3 shrink-0 border-[#0A66C2] text-[#0A66C2] hover:bg-primary/10">{ctaLabel}</Button>
      </div>
    </div>
  )
}

function PreviewModal({
  open, onClose, creatives, page, primaryText, headline, description, webLink, cta, adNameOverrides, onUpdateCreative,
  confirmMode = false, onConfirmLaunch, launching = false, showSkipOption = false, skipPreview = false, onToggleSkipPreview,
}: {
  open: boolean
  onClose: () => void
  creatives: Creative[]
  page?: FacebookPage
  primaryText: string
  headline: string
  description?: string
  webLink: string
  cta: string
  adNameOverrides: Record<string, string>
  onUpdateCreative?: (c: Creative) => void
  confirmMode?: boolean
  onConfirmLaunch?: () => void
  launching?: boolean
  showSkipOption?: boolean
  skipPreview?: boolean
  onToggleSkipPreview?: (v: boolean) => void
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [mockup, setMockup] = useState<MockupPlatform>("meta")
  const [placement, setPlacement] = useState<"feed" | "story">("feed")
  const [primaryExpanded, setPrimaryExpanded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [uploadingThumb, setUploadingThumb] = useState(false)
  const thumbInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) { setActiveIdx(0); setPlacement("feed"); setMockup("meta"); setPrimaryExpanded(false) } }, [open])
  // Clamp activeIdx whenever the creatives list shrinks
  useEffect(() => {
    if (activeIdx >= creatives.length && creatives.length > 0) setActiveIdx(0)
  }, [creatives.length, activeIdx])

  if (creatives.length === 0) {
    return (
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent className="max-w-md p-6">
          <DialogTitle>Preview</DialogTitle>
          <p className="text-sm text-muted-foreground mt-2">No creatives to preview. Load media first.</p>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Clamp activeIdx in case the creatives list shrank (e.g. user removed one)
  const safeIdx = Math.min(activeIdx, creatives.length - 1)
  const creative = creatives[safeIdx] ?? creatives[0]
  if (!creative) {
    return (
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent className="max-w-md p-6">
          <DialogTitle>Preview</DialogTitle>
          <p className="text-sm text-muted-foreground mt-2">No creative to preview.</p>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }
  const customName = adNameOverrides[creative.id]
  const adName = customName ?? creative.file_name.replace(/\.[^/.]+$/, "")
  const isVideo = creative.media_type === "video"
  const thumb = proxyFbImage(creative.fb_thumbnail_url || creative.fb_image_url || creative.file_url)
  // Fallback to creative's saved metadata if main form fields are empty
  const effectivePrimaryText = primaryText
  const effectiveHeadline = headline
  const effectiveWebLink = webLink
  const effectiveCta = cta || "LEARN_MORE"
  const ctaLabel = CTA_OPTIONS.find(o => o.value === effectiveCta)?.label || "Learn More"
  const duration = (creative as any).duration as string | undefined
  const fileSizeMB = (creative as any).file_size ? `${((creative as any).file_size / 1024 / 1024).toFixed(2)}MB` : ""

  const refreshThumbnail = async () => {
    if (refreshing) return
    if (!(creative as any).fb_video_id) return
    setRefreshing(true)
    try {
      const res = await fetch(`/api/creatives/${creative.id}/thumbnail`, { method: "POST" })
      const data = await res.json()
      if (data.thumbnail_url || data.source_url) {
        onUpdateCreative?.({
          ...creative,
          fb_thumbnail_url: data.thumbnail_url || creative.fb_thumbnail_url,
          file_url: data.source_url || creative.file_url || data.thumbnail_url
        })
      }
    } catch {} finally {
      setRefreshing(false)
    }
  }

  const handleUploadThumb = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || uploadingThumb) return
    setUploadingThumb(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch(`/api/creatives/${creative.id}/custom-thumbnail`, {
        method: "POST",
        body: formData,
      })
      const data = await res.json()
      if (data.thumbnail_url) {
        onUpdateCreative?.({ ...creative, fb_thumbnail_url: data.thumbnail_url })
      }
    } catch {} finally {
      setUploadingThumb(false)
      e.target.value = ""
    }
  }

  const downloadTranscript = () => {
    if (!creative.transcript) return
    const blob = new Blob([creative.transcript], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${creative.file_name}_transcript.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const regenerateTranscript = async () => {
    // Placeholder for real logic
    console.log("Regenerating transcript...")
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-5xl !h-[92vh] !max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-row">
        {/* LEFT: Mockup area — scrolls independently, mockup centered */}
        <div className="flex-1 min-w-0 h-full overflow-y-auto bg-[#F0F2F5] dark:bg-zinc-900/60 flex flex-col items-center justify-center px-6 py-6">
          <div className="flex flex-col items-center gap-2 w-full max-w-[380px]">
            {/* Carousel nav for multiple ads */}
            {creatives.length > 1 && (
              <div className="flex items-center gap-4 justify-center w-full mb-3">
                <button onClick={() => setActiveIdx(i => Math.max(0, i - 1))} disabled={activeIdx === 0}
                  className="size-10 rounded-full bg-background border shadow-sm flex items-center justify-center hover:bg-muted disabled:opacity-30 transition-colors">
                  <IconArrowLeft className="size-5" />
                </button>
                <span className="text-sm font-semibold text-muted-foreground tabular-nums">{activeIdx + 1} / {creatives.length}</span>
                <button onClick={() => setActiveIdx(i => Math.min(creatives.length - 1, i + 1))} disabled={activeIdx === creatives.length - 1}
                  className="size-10 rounded-full bg-background border shadow-sm flex items-center justify-center hover:bg-muted disabled:opacity-30 transition-colors">
                  <IconArrowRight className="size-5" />
                </button>
              </div>
            )}

            {/* Platform-specific mockup */}
            <PlatformMockup
              mockup={mockup}
              placement={placement}
              page={page}
              creative={creative}
              thumb={thumb}
              isVideo={isVideo}
              primaryText={effectivePrimaryText}
              headline={effectiveHeadline}
              description={description}
              webLink={effectiveWebLink}
              ctaLabel={ctaLabel}
              primaryExpanded={primaryExpanded}
              setPrimaryExpanded={setPrimaryExpanded}
            />
          </div>
        </div>

        {/* RIGHT: Details panel */}
        <div className="w-[340px] shrink-0 border-l flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
              <DialogTitle className="text-base font-semibold">Preview</DialogTitle>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Choose Mockup */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-sm font-medium">Choose Mockup</span>
                  <IconInfoCircle className="size-3.5 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-1 border rounded-lg p-1">
                  {MOCKUP_PLATFORMS.map(p => (
                    <button
                      key={p.key}
                      onClick={() => setMockup(p.key)}
                      title={p.label}
                      className={cn(
                        "flex-1 size-9 flex items-center justify-center rounded-md transition-colors",
                        mockup === p.key ? "bg-muted shadow-sm" : "hover:bg-muted/50"
                      )}
                    >
                      <p.Icon className={cn("size-4", mockup === p.key ? "text-foreground" : "text-muted-foreground")} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Placement */}
              <div>
                <div className="text-sm font-medium mb-2">Placement</div>
                <div className="grid grid-cols-2 border rounded-lg p-1">
                  {(["feed", "story"] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setPlacement(p)}
                      className={cn(
                        "py-2 text-sm font-semibold rounded-md transition-colors capitalize",
                        placement === p ? "bg-primary text-primary-foreground" : "hover:bg-muted/50 text-muted-foreground"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ad Details */}
              <div>
                <div className="text-sm font-medium mb-2">Ad Details</div>
                <div className="border rounded-lg overflow-hidden">
                  {/* Destination URL */}
                  <div className="px-4 py-3 border-b bg-primary/10/70 dark:bg-primary/20 border-blue-100 dark:border-blue-900/50 transition-colors">
                    <p className="text-xs font-bold text-primary dark:text-primary uppercase tracking-wider mb-1">Destination URL:</p>
                    <a href={effectiveWebLink} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline break-all block">
                      {effectiveWebLink || "—"}
                    </a>
                    <div className="mt-2.5 pt-2 border-t border-primary/20/50">
                      <p className="text-xs font-bold text-muted-foreground/70 uppercase tracking-wider mb-0.5">UTM Parameters:</p>
                      <p className="text-xs text-muted-foreground font-medium italic">
                        {(() => {
                          try {
                            const params = new URL(effectiveWebLink).searchParams
                            const utm: string[] = []
                            params.forEach((v, k) => { if (k.startsWith("utm_")) utm.push(`${k}=${v}`) })
                            return utm.length > 0 ? utm.join(" · ") : "No UTM params"
                          } catch {
                            return "No UTM params"
                          }
                        })()}
                      </p>
                    </div>
                  </div>

                  {/* Static rows */}
                  {[
                    { label: "Creative ID", value: creative.id.startsWith("temp_") ? "N/A" : creative.id.slice(0, 12) },
                    { label: "Source", value: "launch" },
                    { label: "Dimensions", value: (creative as any).dimensions || (isVideo ? "1080x1920" : "—") },
                    ...(duration ? [{ label: "Duration", value: duration }] : []),
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between px-3 py-2 border-b text-xs">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="font-medium text-right truncate ml-2">{row.value}</span>
                    </div>
                  ))}

                  <div className="px-3 py-2 border-b text-xs">
                    <p className="text-muted-foreground mb-0.5">Original filename</p>
                    <p className="font-medium text-foreground/80 break-all">{creative.file_name}</p>
                  </div>

                  <div className="px-3 py-2 border-b text-xs">
                    <p className="text-muted-foreground mb-0.5">Ad Name Preview</p>
                    <p className="font-medium text-foreground/80 break-all">{adName}</p>
                  </div>

                  <div className="flex items-center justify-between px-3 py-2 border-b text-xs gap-2">
                    <span className="text-muted-foreground shrink-0">Thumbnail URL</span>
                    <div className="flex items-center gap-1 min-w-0">
                      <a href={thumb} target="_blank" rel="noopener noreferrer" title={thumb} className="text-primary hover:underline truncate max-w-[140px]">{thumb || "—"}</a>
                      <button onClick={refreshThumbnail} className={cn("text-muted-foreground hover:text-foreground shrink-0", refreshing && "animate-spin")}>
                        <IconRefresh className="size-3" />
                      </button>
                    </div>
                  </div>

                  <div className="px-3 py-2 text-xs">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-muted-foreground">Custom Thumbnail</p>
                      <input type="file" ref={thumbInputRef} className="hidden" accept="image/*" onChange={handleUploadThumb} />
                      <button onClick={() => thumbInputRef.current?.click()} className={cn("text-muted-foreground hover:text-foreground", uploadingThumb && "animate-pulse")}>
                        <IconUpload className="size-3" />
                      </button>
                    </div>
                    <p className="font-medium text-muted-foreground/70">{creative.fb_thumbnail_url ? "Set" : "Not set"}</p>
                  </div>
                </div>
              </div>

              {/* Transcript */}
              {isVideo && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium">Transcript</span>
                    <div className="flex items-center gap-1.5">
                      <button onClick={downloadTranscript} disabled={!creative.transcript} className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Download transcript"><IconDownload className="size-3.5" /></button>
                      <button onClick={regenerateTranscript} className="text-muted-foreground hover:text-foreground" title="Re-generate"><IconRefresh className="size-3.5" /></button>
                    </div>
                  </div>
                  <div className="border rounded-lg p-3.5 text-xs text-muted-foreground leading-relaxed bg-muted/5 min-h-[60px]">
                    {creative.transcript ? (
                      <p>{creative.transcript}</p>
                    ) : isVideo ? (
                      <p className="italic">Auto-transcript will appear here after Meta processes the video. (Requires speech-to-text integration.)</p>
                    ) : (
                      <p className="italic">No transcript available for static images.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Smart Tags */}
              <div>
                <div className="text-sm font-medium mb-1.5">Smart Tags</div>
                <div className="flex flex-wrap gap-1">
                  {(creative.tags || ["influencer", "senior", "outdoor", "selfie", "textoverlay", "aging"]).map(tag => (
                    <span key={tag} className="text-xs px-2.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium border border-zinc-200 dark:border-zinc-700">{tag}</span>
                  ))}
                </div>
                {!creative.tags && (
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                    <IconLoader2 className="size-2.5 animate-spin" />
                    Analyzing media for smart tags...
                  </p>
                )}
              </div>

              {/* Files in this Ad */}
              <div className="border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20">
                  <span className="text-sm font-medium">Files in this Ad ({creatives.length})</span>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                    <IconDownload className="size-3" />Download All
                  </Button>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {creatives.map((c, i) => {
                    const ct = c.fb_thumbnail_url || c.fb_image_url || c.file_url
                    const cd = (c as any).duration
                    const cdim = (c as any).dimensions || (c.media_type === "video" ? "1080x1920" : "—")
                    return (
                      <div
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setActiveIdx(i)}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setActiveIdx(i) }}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/30 transition-all text-left relative cursor-pointer",
                          activeIdx === i ? "bg-primary/10/50 dark:bg-blue-900/10 ring-2 ring-primary ring-inset" : ""
                        )}
                      >
                        <div className="size-10 rounded overflow-hidden bg-muted shrink-0 relative">
                          {ct ? <img src={ct} alt="" className="w-full h-full object-cover" loading="lazy" /> :
                            <div className="w-full h-full flex items-center justify-center"><IconVideo className="size-3 text-muted-foreground/40" /></div>}
                          {c.media_type === "video" && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <IconPlayerPlay className="size-3 text-white" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate" title={c.file_name}>{c.file_name}</p>
                          <p className="text-xs text-muted-foreground">{cdim}{cd ? ` · ${cd}` : ""}</p>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); if (ct) window.open(ct, "_blank") }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <IconDownload className="size-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {confirmMode && (
              <div className="border-t p-4 shrink-0 space-y-3 bg-background">
                {showSkipOption && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={skipPreview}
                      onChange={e => onToggleSkipPreview?.(e.target.checked)}
                      className="size-3.5 rounded border-muted-foreground/40 accent-primary"
                    />
                    Skip preview next time — launch directly
                  </label>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={onClose} disabled={launching}>Back</Button>
                  <Button className="flex-1 gap-2 font-medium" onClick={onConfirmLaunch} disabled={launching}>
                    {launching ? <IconLoader2 className="size-4 animate-spin" /> : <IconRocket className="size-4" />}
                    {launching ? "Launching..." : "Confirm & Launch"}
                  </Button>
                </div>
              </div>
            )}
          </div>
      </DialogContent>
    </Dialog>
  )
}


// ─── Schedule Modal ───────────────────────────────────────────────────────────

function ScheduleModal({ open, onClose, onConfirm }: {
  open: boolean
  onClose: () => void
  onConfirm: (start: string, end?: string) => void
}) {
  const [date, setDate] = useState("")
  const [time, setTime] = useState("09:00")
  const [hasEnd, setHasEnd] = useState(false)
  const [endDate, setEndDate] = useState("")
  const [endTime, setEndTime] = useState("23:59")
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = new Date().toISOString().split("T")[0]
  const inputCls = "w-full px-3 py-2 text-sm border rounded-lg bg-muted/30 outline-none focus:ring-1 focus:ring-ring"

  const handleConfirm = () => {
    if (!date) return
    const start = new Date(`${date}T${time}:00`).toISOString()
    const end = hasEnd && endDate ? new Date(`${endDate}T${endTime}:00`).toISOString() : undefined
    onConfirm(start, end)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Schedule Ads</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">Timezone: {tz}</p>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Start Date</label>
              <input type="date" value={date} min={today}
                onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Start Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} className={inputCls} />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={hasEnd} onChange={e => setHasEnd(e.target.checked)}
              className="rounded border-input" />
            <span className="text-sm">Set end date (optional)</span>
          </label>

          {hasEnd && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">End Date</label>
                <input type="date" value={endDate} min={date || today}
                  onChange={e => setEndDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">End Time</label>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className={inputCls} />
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1 gap-1.5" disabled={!date} onClick={handleConfirm}>
              <IconCalendar className="size-4" />Schedule
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Duplicate Ad Set Modal ───────────────────────────────────────────────────

function DuplicateAdSetModal({
  adAccountId, open, onClose, allAdSets, onDuplicated,
}: {
  adAccountId: string
  open: boolean
  onClose: () => void
  allAdSets: AdSet[]
  onDuplicated: (newAdSets: AdSet[]) => void
}) {
  const [search, setSearch] = useState("")
  const [selectedSourceId, setSelectedSourceId] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [count, setCount] = useState(1)
  const [duplicateAds, setDuplicateAds] = useState(true)
  const [launchAsActive, setLaunchAsActive] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState("")
  const [detail, setDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // Additional Options state
  const [advTab, setAdvTab] = useState<"budget" | "delivery" | "targeting">("budget")
  const [budgetOverride, setBudgetOverride] = useState("")
  const [budgetType, setBudgetType] = useState<"daily" | "lifetime">("daily")
  const [spendingLimitsOn, setSpendingLimitsOn] = useState(false)
  const [minSpend, setMinSpend] = useState("")
  const [maxSpend, setMaxSpend] = useState("")
  const [optimizationOverride, setOptimizationOverride] = useState("")
  const [bidStrategy, setBidStrategy] = useState("")
  // Delivery tab state
  const [scheduleStart, setScheduleStart] = useState("")
  const [scheduleEnd, setScheduleEnd] = useState("")
  const [targetCampaign, setTargetCampaign] = useState<"source" | "another">("source")
  const [destCampaignId, setDestCampaignId] = useState("")
  // Targeting tab state
  const [ageMinSelect, setAgeMinSelect] = useState("18")
  const [ageMaxSelect, setAgeMaxSelect] = useState("65+")
  useEffect(() => {
    if (open) {
      setSearch("")
      setSelectedSourceId("")
      setSearchOpen(false)
      setNewName("")
      setCount(1)
      setDuplicateAds(true)
      setLaunchAsActive(true)
      setShowAdvanced(false)
      setDetailsExpanded(false)
      setError("")
      setDetail(null)
      setAdvTab("budget")
      setBudgetOverride("")
      setBudgetType("daily")
      setSpendingLimitsOn(false)
      setMinSpend("")
      setMaxSpend("")
      setOptimizationOverride("")
      setBidStrategy("")
      setScheduleStart("")
      setScheduleEnd("")
      setTargetCampaign("source")
      setDestCampaignId("")
      setAgeMinSelect("18")
      setAgeMaxSelect("65+")
    }
  }, [open])

  // Auto-fetch detail when expanded for first time
  useEffect(() => {
    if (!detailsExpanded || !selectedSourceId || detail) return
    setDetailLoading(true)
    fetch(`/api/facebook/adsets/${selectedSourceId}/detail`)
      .then(r => r.json())
      .then(d => { if (!d.error) setDetail(d) })
      .catch(() => {})
      .finally(() => setDetailLoading(false))
  }, [detailsExpanded, selectedSourceId, detail])

  // Reset detail when source changes
  useEffect(() => { setDetail(null) }, [selectedSourceId])

  const sourceAdSet = allAdSets.find(a => a.id === selectedSourceId)
  const filtered = allAdSets.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.id.includes(search)
  )

  const selectSource = (a: AdSet) => {
    setSelectedSourceId(a.id)
    setNewName(`${a.name.replace(/\s*[-–]\s*Copy\s*\d*\s*$/i, "").replace(/\s*\(copy\)\s*$/i, "")} - Copy`)
    setSearchOpen(false)
    setSearch("")
  }

  const handleDuplicate = async () => {
    if (!selectedSourceId || count < 1) return
    setDuplicating(true)
    setError("")
    try {
      const newAdSets: AdSet[] = []
      const errors: string[] = []
      for (let i = 0; i < count; i++) {
        const suffix = count > 1 ? ` ${i + 1}` : ""
        const res = await fetch(`/api/facebook/adsets/${selectedSourceId}/duplicate?ad_account_id=${encodeURIComponent(adAccountId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adAccountId,
            renameSuffix: "",
            customName: newName + suffix,
            statusOption: launchAsActive ? "ACTIVE" : "PAUSED",
            deepCopy: duplicateAds,
            campaignId: targetCampaign === "another" && destCampaignId ? destCampaignId : undefined,
            startTime: scheduleStart || undefined,
            endTime: scheduleEnd || undefined,
            // Advanced overrides (only sent if user changed them)
            budgetOverride: budgetOverride ? Math.round(parseFloat(budgetOverride) * 100) : undefined, // dollars → cents
            budgetType: budgetOverride ? budgetType : undefined,
            spendingLimits: spendingLimitsOn ? {
              min: minSpend ? Math.round(parseFloat(minSpend) * 100) : undefined,
              max: maxSpend ? Math.round(parseFloat(maxSpend) * 100) : undefined,
            } : undefined,
            optimizationGoal: optimizationOverride || undefined,
            bidStrategy: bidStrategy || undefined,
            ageMin: ageMinSelect ? parseInt(ageMinSelect) : undefined,
            ageMax: ageMaxSelect && ageMaxSelect !== "65+" ? parseInt(ageMaxSelect) : undefined,
          }),
        })
        const text = await res.text()
        let data: any = {}
        try { data = text ? JSON.parse(text) : {} } catch { data = { error: `HTTP ${res.status}: ${text.slice(0, 120)}` } }
        if (!res.ok) {
          errors.push(data.error || `HTTP ${res.status}`)
          continue
        }
        newAdSets.push(data.adSet)
      }
      if (newAdSets.length > 0) onDuplicated(newAdSets)
      if (errors.length > 0) {
        setError(`${newAdSets.length}/${count} duplicated. Errors: ${errors[0]}`)
        if (newAdSets.length === 0) {
          setDuplicating(false)
          return
        }
      }
      onClose()
    } catch (e: any) {
      setError(e.message)
    }
    setDuplicating(false)
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className={cn(
        "p-0 max-h-[92vh] flex flex-col overflow-hidden transition-[max-width] duration-200",
        sourceAdSet ? "max-w-[832px]" : "max-w-md"
      )}>
        <div className="px-5 py-4 border-b flex items-center gap-2 shrink-0">
          <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
            <IconCopy className="size-4 text-primary" />
          </div>
          <DialogTitle className="text-base font-semibold flex-1 text-center">Duplicate existing ad sets</DialogTitle>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {/* Source selector */}
          <div className="border rounded-xl p-3">
            <p className="text-sm font-semibold mb-2">
              Select an existing Ad Set <span className="text-muted-foreground font-normal italic">(1 ad set maximum)</span>
            </p>
            <Popover open={searchOpen && !sourceAdSet} onOpenChange={setSearchOpen}>
              <PopoverTrigger asChild>
                <div className="flex items-center gap-2 px-2.5 py-2 border rounded-lg bg-muted/20 min-h-[40px] cursor-text min-w-0">
                  <IconSearch className="size-3.5 text-muted-foreground/50 shrink-0" />
                  {sourceAdSet ? (
                    <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md bg-background border text-xs font-medium min-w-0 max-w-full">
                      <IconCircleCheck className="size-3 text-emerald-500 shrink-0" />
                      <span className="truncate">{sourceAdSet.name}</span>
                      <IconBrandMeta className="size-3 text-[#0064E0] shrink-0" />
                      <button
                        onClick={() => { setSelectedSourceId(""); setNewName("") }}
                        className="hover:text-destructive ml-1"
                      >
                        <IconX className="size-3" />
                      </button>
                    </span>
                  ) : (
                    <input
                      autoFocus
                      value={search}
                      onChange={e => { setSearch(e.target.value); setSearchOpen(true) }}
                      onFocus={() => setSearchOpen(true)}
                      placeholder="Search by Ad Set name or ID"
                      className="flex-1 bg-transparent outline-none text-sm"
                    />
                  )}
                  {sourceAdSet && (
                    <button onClick={() => { setSelectedSourceId(""); setNewName("") }} className="text-muted-foreground hover:text-foreground ml-auto">
                      <IconX className="size-3.5" />
                    </button>
                  )}
                </div>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={4}
                onOpenAutoFocus={e => e.preventDefault()}
                onWheel={e => e.stopPropagation()}
                className="p-0 gap-0 w-[var(--radix-popover-trigger-width)] max-w-none max-h-72 overflow-y-auto overscroll-contain"
              >
                {filtered.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground">
                    {allAdSets.length === 0 ? "No ad sets in this account" : "No match"}
                  </div>
                ) : filtered.map(a => (
                  <button key={a.id} onClick={() => selectSource(a)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent border-b last:border-b-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{a.name}</p>
                      <p className="text-xs text-muted-foreground">{a.id}</p>
                    </div>
                    <span className={cn(
                      "text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0",
                      a.effective_status === "ACTIVE"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {a.effective_status}
                    </span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>

          {sourceAdSet && (
            <>
              {/* New Ad Set Name + Quantity */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-semibold">New Ad Set Name</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{count} duplicate{count > 1 ? "s" : ""}</span>
                    <div className="flex items-center border rounded-lg">
                      <button
                        onClick={() => setCount(c => Math.max(1, c - 1))}
                        className="size-7 flex items-center justify-center hover:bg-muted/40 disabled:opacity-30"
                        disabled={count <= 1}
                      >
                        <IconMinus className="size-3.5" />
                      </button>
                      <span className="px-2 text-sm font-medium min-w-[28px] text-center">{count}</span>
                      <button
                        onClick={() => setCount(c => Math.min(20, c + 1))}
                        className="size-7 flex items-center justify-center hover:bg-muted/40 disabled:opacity-30"
                        disabled={count >= 20}
                      >
                        <IconPlus className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Ad set name..."
                  className="w-full px-3 py-2.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                />
                {count > 1 && (
                  <p className="text-xs text-muted-foreground mt-1">Each copy will be suffixed " - 1", " - 2", etc.</p>
                )}
              </div>

              {/* Source ad set details (collapsible with 3 sections) */}
              <div className="border rounded-xl bg-muted/20 overflow-hidden">
                <button
                  onClick={() => setDetailsExpanded(e => !e)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
                >
                  <IconChevronDown className={cn("size-4 transition-transform", !detailsExpanded && "-rotate-90")} />
                  <IconEye className="size-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{sourceAdSet.name}</p>
                    <p className="text-xs text-muted-foreground">See ad set details</p>
                  </div>
                </button>
                {detailsExpanded && (
                  <div className="border-t bg-background p-2 space-y-2">
                    {detailLoading ? (
                      <div className="flex items-center justify-center py-6 gap-2 text-xs text-muted-foreground">
                        <IconLoader2 className="size-3.5 animate-spin" />Loading details...
                      </div>
                    ) : detail ? (
                      <>
                        {/* BUDGET & SCHEDULE */}
                        <div className="border rounded-lg p-2.5">
                          <div className="flex items-center gap-1.5 mb-2">
                            <IconCurrencyDollar className="size-3.5 text-muted-foreground" />
                            <span className="text-xs font-bold text-muted-foreground tracking-wider">BUDGET & SCHEDULE</span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            {detail.adSet?.daily_budget && (
                              <span><span className="text-muted-foreground">Daily:</span> <span className="font-medium">${(parseInt(detail.adSet.daily_budget) / 100).toFixed(2)}</span></span>
                            )}
                            {detail.adSet?.lifetime_budget && (
                              <span><span className="text-muted-foreground">Lifetime:</span> <span className="font-medium">${(parseInt(detail.adSet.lifetime_budget) / 100).toFixed(2)}</span></span>
                            )}
                            <span><span className="text-muted-foreground">CBO:</span> <span className="font-medium">{detail.campaign?.is_cbo ? "Yes" : "No"}</span></span>
                            {detail.adSet?.pacing_type?.[0] && (
                              <span><span className="text-muted-foreground">Pacing:</span> <span className="font-medium capitalize">{detail.adSet.pacing_type[0]}</span></span>
                            )}
                            {detail.adSet?.start_time && (
                              <span><span className="text-muted-foreground">Start:</span> <span className="font-medium">{new Date(detail.adSet.start_time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</span></span>
                            )}
                            <span className="inline-flex items-center gap-0.5">
                              <span className="text-muted-foreground">Status:</span>
                              <span className={cn(
                                "font-medium",
                                detail.adSet?.effective_status === "ACTIVE" ? "text-emerald-600" : "text-muted-foreground"
                              )}>{detail.adSet?.effective_status}</span>
                              <IconExternalLink className="size-2.5 text-muted-foreground" />
                            </span>
                          </div>
                          {detail.campaign && (
                            <div className="mt-1.5 text-xs">
                              <span className="text-muted-foreground">Campaign:</span>
                              <span className="font-medium ml-1">
                                {detail.campaign.daily_budget
                                  ? `$${(parseInt(detail.campaign.daily_budget) / 100).toFixed(2)}/day`
                                  : detail.campaign.lifetime_budget
                                    ? `$${(parseInt(detail.campaign.lifetime_budget) / 100).toFixed(2)} lifetime`
                                    : "ad-set level"}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* TARGETING */}
                        <div className="border rounded-lg p-2.5">
                          <div className="flex items-center gap-1.5 mb-2">
                            <IconTarget className="size-3.5 text-muted-foreground" />
                            <span className="text-xs font-bold text-muted-foreground tracking-wider">TARGETING</span>
                          </div>
                          {detail.adSet?.targeting?.geo_locations?.countries?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {detail.adSet.targeting.geo_locations.countries.slice(0, 24).map((c: string) => (
                                <span key={c} className="text-xs px-1 py-0.5 rounded bg-muted/50 font-medium uppercase">{c}</span>
                              ))}
                              {detail.adSet.targeting.geo_locations.countries.length > 24 && (
                                <span className="text-xs text-muted-foreground">+{detail.adSet.targeting.geo_locations.countries.length - 24}</span>
                              )}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                            <span>
                              <span className="text-muted-foreground">Age:</span>{" "}
                              <span className="font-medium">{detail.adSet?.targeting?.age_min || 18}-{detail.adSet?.targeting?.age_max === 65 ? "65+" : (detail.adSet?.targeting?.age_max || "65+")}</span>
                            </span>
                            <span>
                              <span className="text-muted-foreground">Gender:</span>{" "}
                              <span className="font-medium">
                                {!detail.adSet?.targeting?.genders || detail.adSet.targeting.genders.length === 0
                                  ? "All"
                                  : detail.adSet.targeting.genders.includes(1) ? "Male"
                                  : detail.adSet.targeting.genders.includes(2) ? "Female"
                                  : "Custom"}
                              </span>
                            </span>
                            <span><span className="text-muted-foreground">Ad count:</span> <span className="font-medium">{detail.adSet?.ad_count ?? 0}</span></span>
                          </div>
                          <div className="mt-1.5 text-xs space-y-0.5">
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <IconUsers className="size-2.5" />
                              <span>Inc:</span>
                              <span className="italic">{detail.adSet?.targeting?.custom_audiences?.length ? `${detail.adSet.targeting.custom_audiences.length} audience(s)` : "none"}</span>
                            </div>
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <IconUsers className="size-2.5" />
                              <span>Exc:</span>
                              <span className="italic">{detail.adSet?.targeting?.excluded_custom_audiences?.length ? `${detail.adSet.targeting.excluded_custom_audiences.length} audience(s)` : "none"}</span>
                            </div>
                          </div>
                        </div>

                        {/* OPTIMIZATION */}
                        <div className="border rounded-lg p-2.5">
                          <div className="flex items-center gap-1.5 mb-2">
                            <IconTrendingUp className="size-3.5 text-muted-foreground" />
                            <span className="text-xs font-bold text-muted-foreground tracking-wider">OPTIMIZATION</span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            {detail.campaign?.objective && (
                              <span><span className="text-muted-foreground">Objective:</span> <span className="font-bold">{detail.campaign.objective.replace(/_/g, " ")}</span></span>
                            )}
                            {detail.adSet?.optimization_goal && (
                              <span><span className="text-muted-foreground">Goal:</span> <span className="font-bold">{detail.adSet.optimization_goal.replace(/_/g, " ")}</span></span>
                            )}
                            {detail.adSet?.billing_event && (
                              <span><span className="text-muted-foreground">Billing:</span> <span className="font-bold">{detail.adSet.billing_event.replace(/_/g, " ")}</span></span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <span><span className="text-muted-foreground">Destination:</span> <span className="font-bold">{(detail.adSet?.destination_type || "UNDEFINED").replace(/_/g, " ")}</span></span>
                            {detail.adSet?.attribution_spec && (
                              <span><span className="text-muted-foreground">Attribution:</span> <span className="font-medium">{
                                detail.adSet.attribution_spec.map((s: any) =>
                                  `${s.window_days}d ${s.event_type === "CLICK_THROUGH" ? "click" : "view"}`
                                ).join(" / ")
                              }</span></span>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground italic px-3 py-4 text-center">Failed to load details. Click to retry.</div>
                    )}
                  </div>
                )}
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-3">
                <div className="border rounded-xl p-3">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-1">
                      <p className="text-sm font-semibold">Duplicate ads</p>
                      <Tip text="ON copies ads exactly from the existing ad set, so launch will include those ads.">
                        <IconInfoCircle className="size-3 text-muted-foreground cursor-help" />
                      </Tip>
                    </div>
                    <Tip text="ON copies ads exactly from the existing ad set, so launch will include those ads.">
                      <button
                        onClick={() => setDuplicateAds(v => !v)}
                        className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
                          duplicateAds ? "bg-primary" : "bg-muted-foreground/30")}
                      >
                        <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                          duplicateAds ? "translate-x-4" : "translate-x-0.5")} />
                      </button>
                    </Tip>
                  </div>
                  <p className="text-xs text-muted-foreground">ON copies ads exactly from the existing ad set, so launch will include those ads.</p>
                </div>

                <div className={cn("border rounded-xl p-3", launchAsActive && "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900")}>
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-1">
                      <p className="text-sm font-semibold">Launch as</p>
                      <span className={cn(
                        "text-xs px-1.5 py-0.5 rounded-full font-bold",
                        launchAsActive
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-muted text-muted-foreground"
                      )}>{launchAsActive ? "Active" : "Paused"}</span>
                    </div>
                    <button
                      onClick={() => setLaunchAsActive(v => !v)}
                      className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
                        launchAsActive ? "bg-emerald-500" : "bg-muted-foreground/30")}
                    >
                      <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                        launchAsActive ? "translate-x-4" : "translate-x-0.5")} />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">{launchAsActive ? "Starts spending immediately" : "Paused until you enable"}</p>
                </div>
              </div>

              {/* Show Additional Options */}
              <button
                onClick={() => setShowAdvanced(s => !s)}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-foreground hover:text-primary"
              >
                {showAdvanced ? "Hide" : "Show"} Additional Options
                <IconChevronDown className={cn("size-4 transition-transform", showAdvanced && "rotate-180")} />
              </button>

              {showAdvanced && (
                <div className="space-y-3">
                  {/* Tab switcher */}
                  <div className="grid grid-cols-3 border rounded-xl p-1 bg-muted/30">
                    {([
                      { key: "budget" as const, label: "Budget & Bid", Icon: IconCurrencyDollar },
                      { key: "delivery" as const, label: "Delivery", Icon: IconSend },
                      { key: "targeting" as const, label: "Targeting", Icon: IconTarget },
                    ]).map(t => (
                      <button
                        key={t.key}
                        onClick={() => setAdvTab(t.key)}
                        className={cn(
                          "flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg transition-colors",
                          advTab === t.key
                            ? "bg-background shadow-sm text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <t.Icon className="size-3.5" />
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {/* Tab content */}
                  {advTab === "budget" && (
                    <div className="space-y-3">
                      {/* Budget override */}
                      <div className="border rounded-xl p-3">
                        <p className="text-sm font-bold mb-0.5">Budget</p>
                        <p className="text-xs text-muted-foreground mb-2.5">Override the budget amount and type for the duplicated ad set.</p>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={budgetOverride}
                            onChange={e => setBudgetOverride(e.target.value)}
                            placeholder="0.00"
                            className="flex-1 px-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                          />
                          <Select value={budgetType} onValueChange={v => setBudgetType(v as any)}>
                            <SelectTrigger className="w-28 h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="daily">Daily</SelectItem>
                              <SelectItem value="lifetime">Lifetime</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* CBO info banner (if campaign has budget) */}
                      {detail?.campaign?.is_cbo && (
                        <div className="border border-primary/20 dark:border-blue-900 bg-primary/10 dark:bg-blue-950/20 rounded-xl p-3">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <IconInfoCircle className="size-3.5 text-primary dark:text-primary" />
                            <span className="text-sm font-bold text-primary/90 dark:text-blue-300">Campaign Budget (CBO)</span>
                          </div>
                          <p className="text-xs mb-1">
                            <span className="font-bold">Daily Budget:</span>{" "}
                            <span className="font-semibold">${detail.campaign.daily_budget ? (parseInt(detail.campaign.daily_budget) / 100).toFixed(2) : "—"}</span>
                          </p>
                          <p className="text-xs text-primary/90/80 dark:text-blue-300/80">
                            Consider this campaign budget when setting your ad set spending limits below.
                          </p>
                        </div>
                      )}

                      {/* Ad set spending limits toggle */}
                      <div className="border rounded-xl p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-1">
                              <p className="text-sm font-bold">Ad set spending limits</p>
                              <IconInfoCircle className="size-3 text-muted-foreground" />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Optional min and max spend per ad set. Turn on to set daily or lifetime limits in currency or as a % of campaign budget.
                            </p>
                          </div>
                          <button
                            onClick={() => setSpendingLimitsOn(v => !v)}
                            className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 mt-0.5",
                              spendingLimitsOn ? "bg-primary" : "bg-muted-foreground/30")}
                          >
                            <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                              spendingLimitsOn ? "translate-x-4" : "translate-x-0.5")} />
                          </button>
                        </div>
                        {spendingLimitsOn && (
                          <div className="grid grid-cols-2 gap-2 mt-2.5">
                            <div>
                              <label className="text-xs font-medium text-muted-foreground block mb-1">Min spend ($)</label>
                              <input
                                type="number"
                                value={minSpend}
                                onChange={e => setMinSpend(e.target.value)}
                                placeholder="0.00"
                                className="w-full px-2 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-muted-foreground block mb-1">Max spend ($)</label>
                              <input
                                type="number"
                                value={maxSpend}
                                onChange={e => setMaxSpend(e.target.value)}
                                placeholder="0.00"
                                className="w-full px-2 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Day parting note */}
                      <div className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
                        <IconClock className="size-3.5 shrink-0 mt-0.5" />
                        <p>
                          <span className="font-medium text-foreground/70">Ad Scheduling (Day Parting)</span> - Requires Lifetime Budget. Select{" "}
                          <button onClick={() => setBudgetType("lifetime")} className="text-primary hover:underline font-medium">"Lifetime"</button>{" "}
                          budget type to enable.
                        </p>
                      </div>
                    </div>
                  )}

                  {advTab === "delivery" && (
                    <div className="space-y-3">
                      {/* Schedule */}
                      <div className="border rounded-xl p-3">
                        <p className="text-sm font-bold mb-0.5">Schedule</p>
                        <p className="text-xs text-muted-foreground mb-2.5">Override start and end dates for the duplicated ad set.</p>

                        {/* Timezone info banner */}
                        <div className="border border-primary/20 dark:border-blue-900 bg-primary/10 dark:bg-blue-950/20 rounded-lg p-2.5 mb-3">
                          <div className="flex items-start gap-1.5 mb-2">
                            <IconInfoCircle className="size-3.5 text-primary dark:text-primary shrink-0 mt-0.5" />
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs flex-1">
                              <div>
                                <p className="font-bold text-primary/90 dark:text-blue-300">Your Local Timezone:</p>
                                <p className="font-mono">{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
                              </div>
                              <div>
                                <p className="font-bold text-primary/90 dark:text-blue-300">Ad Account Timezone:</p>
                                <p className="font-mono">America/Los_Angeles (UTC-7)</p>
                              </div>
                              <div>
                                <p className="font-bold text-primary/90 dark:text-blue-300">Ad Account Time:</p>
                                <p className="font-mono">{new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}</p>
                              </div>
                              <div>
                                <p className="font-bold text-primary/90 dark:text-blue-300">Local Time:</p>
                                <p className="font-mono">{new Date().toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}</p>
                              </div>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            All dates and times will be set according to <span className="text-primary font-medium">your ad account timezone</span>.
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Start Date (optional)</label>
                            <input
                              type="datetime-local"
                              value={scheduleStart}
                              onChange={e => setScheduleStart(e.target.value)}
                              className="w-full px-2 py-1.5 text-xs bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">End Date (optional)</label>
                            <input
                              type="datetime-local"
                              value={scheduleEnd}
                              onChange={e => setScheduleEnd(e.target.value)}
                              className="w-full px-2 py-1.5 text-xs bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Target Campaign */}
                      <div className="border rounded-xl p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <p className="text-sm font-bold">Target Campaign (Optional)</p>
                            <p className="text-xs text-muted-foreground">Choose whether to duplicate into the original campaign or another campaign.</p>
                          </div>
                          <button className="flex items-center gap-1 text-xs px-2 py-1 border rounded-lg hover:bg-muted/30 shrink-0 ml-2">
                            <IconRefresh className="size-3" />Refresh
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setTargetCampaign("source")}
                            className={cn(
                              "p-2.5 border rounded-lg text-left transition-colors",
                              targetCampaign === "source"
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background hover:bg-muted/30"
                            )}
                          >
                            <p className="text-sm font-bold">Existing campaign</p>
                            <p className={cn("text-xs", targetCampaign === "source" ? "opacity-80" : "text-muted-foreground")}>Keep the source campaign</p>
                          </button>
                          <button
                            onClick={() => setTargetCampaign("another")}
                            className={cn(
                              "p-2.5 border rounded-lg text-left transition-colors",
                              targetCampaign === "another"
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background hover:bg-muted/30"
                            )}
                          >
                            <p className="text-sm font-bold">Another campaign</p>
                            <p className={cn("text-xs", targetCampaign === "another" ? "opacity-80" : "text-muted-foreground")}>Choose a destination</p>
                          </button>
                        </div>
                        {targetCampaign === "another" && (
                          <input
                            value={destCampaignId}
                            onChange={e => setDestCampaignId(e.target.value)}
                            placeholder="Destination campaign ID"
                            className="w-full mt-2 px-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring font-mono"
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {advTab === "targeting" && (
                    <div className="space-y-3">
                      {/* Age Targeting */}
                      <div className="border rounded-xl p-3">
                        <p className="text-sm font-bold mb-0.5">Age Targeting</p>
                        <p className="text-xs text-muted-foreground mb-2">Define the age range of people who will see your ads.</p>

                        <div className="flex items-center gap-1.5 mb-1.5">
                          <IconCalendar className="size-3.5 text-muted-foreground" />
                          <p className="text-xs font-bold text-muted-foreground">Age Targeting</p>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">Define the age range of people who will see your ads</p>

                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-2">
                          <Select value={ageMinSelect} onValueChange={setAgeMinSelect}>
                            <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 53 }, (_, i) => 13 + i).map(a => (
                                <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-xs text-muted-foreground">to</span>
                          <Select value={ageMaxSelect} onValueChange={setAgeMaxSelect}>
                            <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 52 }, (_, i) => 14 + i).map(a => (
                                <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                              ))}
                              <SelectItem value="65+">65+</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="bg-muted/30 rounded-lg p-2 mb-2">
                          <p className="text-xs font-medium">Age: {ageMinSelect} - {ageMaxSelect}</p>
                          {ageMaxSelect === "65+" && <p className="text-xs text-muted-foreground">People aged 65 and older will be included</p>}
                        </div>

                        <p className="text-xs text-muted-foreground mb-1">Common age ranges</p>
                        <div className="flex flex-wrap gap-1">
                          {[
                            { label: "All adults (18-65+)", min: "18", max: "65+" },
                            { label: "18-34", min: "18", max: "34" },
                            { label: "25-54", min: "25", max: "54" },
                            { label: "35-65+", min: "35", max: "65+" },
                          ].map(r => (
                            <button
                              key={r.label}
                              onClick={() => { setAgeMinSelect(r.min); setAgeMaxSelect(r.max) }}
                              className={cn(
                                "px-2 py-1 text-xs border rounded-full font-medium transition-colors",
                                ageMinSelect === r.min && ageMaxSelect === r.max
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "hover:bg-muted/30"
                              )}
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-2">
              {error}
            </div>
          )}
        </div>

        <div className="shrink-0 px-5 pb-4">
          <Button
            className="w-full h-11 text-sm font-semibold"
            disabled={!selectedSourceId || !newName.trim() || duplicating}
            onClick={handleDuplicate}
          >
            {duplicating
              ? <><IconLoader2 className="size-4 animate-spin mr-1.5" />Duplicating {count}...</>
              : `Duplicate ${count} Ad Set${count > 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Duplicate Campaign Modal (3-step wizard) ────────────────────────────────

interface CampaignItem {
  id: string
  name: string
  status: string
  effective_status: string
  objective: string
  daily_budget?: string
  _adset_count?: number
  _spend?: number
}

interface AdSetCfg {
  id: string
  sourceName: string
  sourceStatus: string
  customName: string
  copies: number
  statusActive: boolean
  startTime: string
  endTime: string
  customAttribution: boolean
  // Custom attribution window values (days). "0" = disabled. Maps to Meta attribution_spec.
  attrViewDays: string       // "0" | "1"
  attrClickDays: string      // "1" | "7" | "28"
  attrEngagedViewDays: string // "0" | "1"  (video only)
  deepCopy: boolean
  // Granular ad selection for deep copy. Empty array = copy all (uses deep_copy=true on /copies).
  selectedAdIds: string[]
  duplicatedAdsStatus: "ACTIVE" | "PAUSED"
  // Cached ads list for the source ad set
  adsList: { id: string; name: string; effective_status: string }[]
  adsLoading: boolean
  adsLoaded: boolean
  copyCurrentSettings: boolean
}

function DuplicateCampaignModal({
  open, onClose, adAccountId, onDuplicated,
}: {
  open: boolean
  onClose: () => void
  adAccountId: string
  onDuplicated: (newAdSets: AdSet[]) => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  // Step 1
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [selectedCampaignId, setSelectedCampaignId] = useState("")
  const [campaignDropdownOpen, setCampaignDropdownOpen] = useState(false)
  const [campaignSearch, setCampaignSearch] = useState("")
  const [filterValue, setFilterValue] = useState("all")
  const [campaignName, setCampaignName] = useState("")
  const [campaignCount, setCampaignCount] = useState(1)
  const [budgetCollapsed, setBudgetCollapsed] = useState(true)
  const [budgetType, setBudgetType] = useState<"daily" | "lifetime">("daily")
  const [budgetAmount, setBudgetAmount] = useState("")
  const [bidStrategy, setBidStrategy] = useState("inherit")
  const [launchAsActive, setLaunchAsActive] = useState(false)
  // Step 2
  const [sourceAdSets, setSourceAdSets] = useState<AdSet[]>([])
  const [adSetsLoading, setAdSetsLoading] = useState(false)
  const [selectedAdSetIds, setSelectedAdSetIds] = useState<Set<string>>(new Set())
  const [adSetConfigs, setAdSetConfigs] = useState<Record<string, AdSetCfg>>({})
  // Newly-created (empty) campaigns from Step 1, used as targets in Step 2
  const [newCampaigns, setNewCampaigns] = useState<{ id: string; name: string }[]>([])
  // Step 3 results
  const [results, setResults] = useState<any[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")
  const [warnings, setWarnings] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setStep(1)
    setSelectedCampaignId("")
    setCampaignName("")
    setCampaignCount(1)
    setBudgetCollapsed(true)
    setBudgetType("daily")
    setBudgetAmount("")
    setBidStrategy("inherit")
    setLaunchAsActive(false)
    setSelectedAdSetIds(new Set())
    setAdSetConfigs({})
    setNewCampaigns([])
    setResults([])
    setError("")
    setWarnings([])
    fetchCampaigns()
  }, [open, adAccountId])

  const fetchCampaigns = async (forceRefresh = false) => {
    if (!adAccountId) return
    setCampaignsLoading(true)
    try {
      const url = `/api/facebook/campaigns?ad_account_id=${encodeURIComponent(adAccountId)}${forceRefresh ? "&refresh=true" : ""}`
      const res = await fetch(url)
      const d = await res.json()
      const raw: any[] = d.campaigns || []
      setCampaigns(raw.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        effective_status: c.effective_status,
        objective: c.objective,
        daily_budget: c.daily_budget,
        lifetime_budget: c.lifetime_budget,
        _adset_count: c.adsets?.summary?.total_count ?? undefined,
        _spend: parseFloat(c.insights?.data?.[0]?.spend || "0"),
      })))
    } catch {}
    setCampaignsLoading(false)
  }

  const selectCampaign = (c: CampaignItem) => {
    setSelectedCampaignId(c.id)
    // Meta convention: "Name - Copy" — strip existing trailing copy suffix to avoid stacking
    const baseName = c.name.replace(/\s*[-–]\s*Copy\s*\d*\s*$/i, "").replace(/\s*\(copy\)\s*$/i, "")
    setCampaignName(`${baseName} - Copy`)
    // Inherit budget from source campaign (Meta returns budget in cents → convert to dollars)
    const sc = c as any
    if (sc.daily_budget) {
      setBudgetType("daily")
      setBudgetAmount((parseInt(sc.daily_budget) / 100).toFixed(2))
    } else if (sc.lifetime_budget) {
      setBudgetType("lifetime")
      setBudgetAmount((parseInt(sc.lifetime_budget) / 100).toFixed(2))
    } else {
      // CBO without budget set, or campaign with adset-level budgets (ABO)
      setBudgetAmount("")
    }
    setCampaignDropdownOpen(false)
    setCampaignSearch("")
  }

  const sourceCampaign = campaigns.find(c => c.id === selectedCampaignId)
  const filteredCampaigns = campaigns.filter(c => {
    if (filterValue === "active" && c.effective_status !== "ACTIVE") return false
    if (filterValue === "paused" && c.effective_status !== "PAUSED") return false
    if (campaignSearch && !c.name.toLowerCase().includes(campaignSearch.toLowerCase()) && !c.id.includes(campaignSearch)) return false
    return true
  })

  // Step 1 → Step 2: actually creates EMPTY campaigns in Meta, then loads source ad sets to configure
  const createCampaignsAndContinue = async () => {
    if (!selectedCampaignId || !campaignName.trim()) return
    setCreating(true)
    setError("")
    try {
      // 1) Create the empty campaign(s) in Meta
      const cRes = await fetch(`/api/facebook/campaigns/${selectedCampaignId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adAccountId,
          customName: campaignName,
          count: campaignCount,
          launchAsActive,
          dailyBudget: budgetType === "daily" && budgetAmount ? budgetAmount : undefined,
          lifetimeBudget: budgetType === "lifetime" && budgetAmount ? budgetAmount : undefined,
          bidStrategy: bidStrategy === "inherit" ? undefined : bidStrategy,
          adSetConfigs: [], // empty — only create campaign shells
        }),
      })
      const cData = await cRes.json()
      if (!cRes.ok) {
        setError(cData.error || `HTTP ${cRes.status}`)
        setCreating(false)
        return
      }
      const created = (cData.campaigns || []) as { id: string; name: string }[]
      setNewCampaigns(created)
      if (Array.isArray(cData.warnings) && cData.warnings.length > 0) {
        setWarnings(cData.warnings)
      }

      // 2) Fetch source ad sets to configure
      setAdSetsLoading(true)
      try {
        const res = await fetch(`/api/facebook/adsets?ad_account_id=${encodeURIComponent(adAccountId)}&campaign_id=${selectedCampaignId}`)
        const d = await res.json()
        const list: AdSet[] = d.adSets || []
        setSourceAdSets(list)
        const ids = new Set(list.map(a => a.id))
        setSelectedAdSetIds(ids)
        const cfgs: Record<string, AdSetCfg> = {}
        list.forEach(a => {
          // Meta convention: "<original> - Copy". Strip trailing " - Copy" / " (copy)" first to avoid stacking.
          const baseName = a.name.replace(/\s*[-–]\s*Copy\s*\d*\s*$/i, "").replace(/\s*\(copy\)\s*$/i, "")
          cfgs[a.id] = {
            id: a.id,
            sourceName: a.name,
            sourceStatus: a.effective_status,
            customName: `${baseName} - Copy`,
            copies: 1,
            statusActive: a.effective_status === "ACTIVE",
            startTime: "",
            endTime: "",
            customAttribution: false,
            attrViewDays: "1",         // 1d_view
            attrClickDays: "7",        // 7d_click (Meta default)
            attrEngagedViewDays: "0",  // disabled
            deepCopy: false,
            selectedAdIds: [],
            duplicatedAdsStatus: "PAUSED",
            adsList: [],
            adsLoading: false,
            adsLoaded: false,
            copyCurrentSettings: true,
          }
        })
        setAdSetConfigs(cfgs)
      } catch {}
      setAdSetsLoading(false)
      setStep(2)
    } catch (e: any) {
      setError(e.message || "Failed to create campaigns")
    }
    setCreating(false)
  }

  // Step 2: add ad sets into the already-created campaigns
  const handleCreate = async () => {
    if (newCampaigns.length === 0) {
      setError("No created campaigns. Go back to Step 1.")
      return
    }
    setCreating(true)
    setError("")
    try {
      const adSetConfigsArr = Array.from(selectedAdSetIds).map(id => adSetConfigs[id]).filter(Boolean)
      const res = await fetch(`/api/facebook/campaigns/duplicate-adsets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adAccountId,
          targetCampaignIds: newCampaigns.map(c => c.id),
          adSetConfigs: adSetConfigsArr,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`)
        setCreating(false)
        return
      }
      const allWarnings = [
        ...(Array.isArray(data.warnings) ? data.warnings : []),
        ...(Array.isArray(data.errors) ? data.errors : []),
      ]
      if (allWarnings.length > 0) setWarnings(prev => [...prev, ...allWarnings])
      // Merge: results campaigns only have ids — enrich with names from newCampaigns
      const enriched = (data.campaigns || []).map((c: any) => ({
        ...c,
        name: newCampaigns.find(nc => nc.id === c.id)?.name || c.id,
      }))
      setResults(enriched)
      // Push all new ad sets to parent
      const allNewAdSets: AdSet[] = []
      for (const cmp of enriched) {
        for (const a of (cmp.adSets || [])) {
          allNewAdSets.push({
            id: a.id,
            name: a.name,
            status: launchAsActive ? "ACTIVE" : "PAUSED",
            effective_status: launchAsActive ? "ACTIVE" : "PAUSED",
            campaign_id: cmp.id,
          })
        }
      }
      onDuplicated(allNewAdSets)
      setStep(3)
    } catch (e: any) {
      setError(e.message)
    }
    setCreating(false)
  }

  const totalAdSetsToCreate = Array.from(selectedAdSetIds).reduce((sum, id) => sum + (adSetConfigs[id]?.copies || 1), 0) * newCampaigns.length

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl w-full p-0 max-h-[92vh] flex flex-col gap-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b shrink-0">
          <DialogTitle className="text-base font-semibold mb-3">Duplicate an existing campaign</DialogTitle>
          {/* Step indicator */}
          <div className="flex items-center justify-between gap-2">
            {([
              { n: 1, label: "Duplicate Campaign" },
              { n: 2, label: "Configure Ad Sets" },
              { n: 3, label: "Complete" },
            ] as const).map((s, i, arr) => (
              <div key={s.n} className="flex items-center flex-1">
                <div className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium",
                  step === s.n ? "bg-primary/10 text-primary" : "",
                  step > s.n ? "text-emerald-600" : ""
                )}>
                  {step > s.n ? (
                    <IconCircleCheck className="size-5 text-emerald-600" />
                  ) : (
                    <span className={cn(
                      "size-5 rounded-full flex items-center justify-center text-xs font-bold",
                      step === s.n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}>{s.n}</span>
                  )}
                  <span className={step === s.n || step > s.n ? "" : "text-muted-foreground"}>{s.label}</span>
                </div>
                {i < arr.length - 1 && <div className="flex-1 h-px bg-border mx-1" />}
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">

        {/* STEP 1 — Duplicate Campaign */}
        {step === 1 && (
          <div className="px-5 py-4 space-y-3">
            {/* Filter */}
            <Select value={filterValue} onValueChange={setFilterValue}>
              <SelectTrigger className="h-10 text-sm">
                <div className="flex items-center gap-2">
                  <IconFilter className="size-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Filter Campaigns" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Campaigns</SelectItem>
                <SelectItem value="active">Active only</SelectItem>
                <SelectItem value="paused">Paused only</SelectItem>
              </SelectContent>
            </Select>

            {/* Campaign selector */}
            <div className="flex gap-2 items-start">
              <div className="flex-1 space-y-1">
                <button
                  onClick={() => setCampaignDropdownOpen(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 border rounded-lg bg-background hover:bg-muted/30 text-left"
                >
                  {sourceCampaign ? (
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <IconBrandMeta className="size-4 text-[#0064E0] shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold truncate">{sourceCampaign.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {sourceCampaign._adset_count ?? "—"} ad sets | {(sourceCampaign.objective || "").replace(/_/g, " ")} | spend: ${(sourceCampaign._spend || 0).toFixed(0)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Select a campaign...</span>
                  )}
                  <IconSelector className="size-4 text-muted-foreground shrink-0 ml-2" />
                </button>
                {campaignDropdownOpen && (
                  <div className="border rounded-lg bg-background overflow-hidden shadow-sm">
                    <div className="p-2 border-b">
                      <div className="relative">
                        <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                        <input
                          autoFocus
                          value={campaignSearch}
                          onChange={e => setCampaignSearch(e.target.value)}
                          placeholder="Search campaigns..."
                          className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {campaignsLoading ? (
                        <div className="px-3 py-3 text-xs text-muted-foreground flex items-center gap-2">
                          <IconLoader2 className="size-3 animate-spin" />Loading...
                        </div>
                      ) : filteredCampaigns.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-muted-foreground">No campaigns</div>
                      ) : filteredCampaigns.map(c => (
                        <button
                          key={c.id}
                          onClick={() => selectCampaign(c)}
                          className={cn(
                            "w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-accent border-b last:border-b-0",
                            selectedCampaignId === c.id && "bg-primary/5"
                          )}
                        >
                          <div className="size-4 shrink-0 mt-0.5">
                            {selectedCampaignId === c.id && <IconCheck className="size-4 text-primary" />}
                          </div>
                          <IconBrandMeta className="size-4 text-[#0064E0] shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Ad Sets: {c._adset_count ?? "—"} | {(c.objective || "").replace(/_/g, " ")} | spend: ${(c._spend || 0).toFixed(0)}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => fetchCampaigns(true)} className="size-10 border rounded-lg flex items-center justify-center hover:bg-muted/30 shrink-0">
                <IconRefresh className={cn("size-4 text-muted-foreground", campaignsLoading && "animate-spin")} />
              </button>
            </div>

            {sourceCampaign && (
              <>
                {/* Duplicating from card */}
                <div className="border rounded-xl p-3 bg-muted/20">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">DUPLICATING FROM</p>
                  <div className="flex items-center gap-2 mb-1.5">
                    <IconBrandFacebook className="size-4 text-[#1877F2]" />
                    <span className="text-sm font-bold flex-1 truncate">{sourceCampaign.name}</span>
                    <IconExternalLink className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background border">
                      <IconPlus className="size-3" />{sourceCampaign._adset_count || 0} ad set{(sourceCampaign._adset_count || 0) !== 1 ? "s" : ""}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background border">
                      <IconClock className="size-3" />${(sourceCampaign._spend || 0).toFixed(2)} spend
                    </span>
                    {sourceCampaign.daily_budget && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background border font-bold">
                        ${(parseInt(sourceCampaign.daily_budget) / 100).toFixed(2)}/day
                      </span>
                    )}
                  </div>
                </div>

                {/* New Campaign divider */}
                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 border-t border-dashed" />
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">NEW CAMPAIGN</span>
                  <div className="flex-1 border-t border-dashed" />
                </div>

                {/* Campaign name + count */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-bold">Campaign Name</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{campaignCount} campaign{campaignCount > 1 ? "s" : ""}</span>
                      <div className="flex items-center border rounded-lg">
                        <button onClick={() => setCampaignCount(c => Math.max(1, c - 1))} className="size-7 flex items-center justify-center hover:bg-muted/40 disabled:opacity-30" disabled={campaignCount <= 1}>
                          <IconMinus className="size-3.5" />
                        </button>
                        <span className="px-2 text-sm font-medium min-w-[28px] text-center">{campaignCount}</span>
                        <button onClick={() => setCampaignCount(c => Math.min(20, c + 1))} className="size-7 flex items-center justify-center hover:bg-muted/40 disabled:opacity-30" disabled={campaignCount >= 20}>
                          <IconPlus className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <input
                    value={campaignName}
                    onChange={e => setCampaignName(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                    <IconInfoCircle className="size-3" />Ad sets will be configured in the next step
                  </p>
                </div>

                {/* Budget & Schedule (collapsible) */}
                <div className="border rounded-xl overflow-hidden">
                  <button
                    onClick={() => setBudgetCollapsed(c => !c)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-bold hover:bg-muted/20"
                  >
                    Budget & Schedule
                    <IconChevronDown className={cn("size-4 transition-transform", !budgetCollapsed && "rotate-180")} />
                  </button>
                  {!budgetCollapsed && (
                    <div className="border-t p-3 space-y-3">
                      <div>
                        <label className="text-sm font-bold block mb-1.5">Budget Type</label>
                        <Select
                          value={budgetType}
                          onValueChange={v => {
                            const t = v as "daily" | "lifetime"
                            setBudgetType(t)
                            // Re-inherit from source when switching type
                            const sc = sourceCampaign as any
                            const src = t === "daily" ? sc?.daily_budget : sc?.lifetime_budget
                            setBudgetAmount(src ? (parseInt(src) / 100).toFixed(2) : "")
                          }}
                        >
                          <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="daily">Daily Budget</SelectItem>
                            <SelectItem value="lifetime">Lifetime Budget</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-sm font-bold">{budgetType === "daily" ? "Daily Budget" : "Lifetime Budget"}</label>
                          {(() => {
                            const sc = sourceCampaign as any
                            const sourceBudget = budgetType === "daily" ? sc?.daily_budget : sc?.lifetime_budget
                            if (!sourceBudget) return null
                            const sourceVal = (parseInt(sourceBudget) / 100).toFixed(2)
                            return (
                              <button
                                type="button"
                                onClick={() => setBudgetAmount(sourceVal)}
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                                title="Use source campaign's budget"
                              >
                                <IconRefresh className="size-3" />Source: ${sourceVal}
                              </button>
                            )
                          })()}
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                          <input
                            type="number"
                            value={budgetAmount}
                            onChange={e => setBudgetAmount(e.target.value)}
                            placeholder="0"
                            className="w-full pl-7 pr-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {budgetType === "daily" ? "Amount to spend each day" : "Total amount over campaign lifetime"}
                          {budgetAmount && sourceCampaign && (() => {
                            const sc = sourceCampaign as any
                            const src = budgetType === "daily" ? sc.daily_budget : sc.lifetime_budget
                            if (!src) return null
                            const sourceVal = parseInt(src) / 100
                            const inputVal = parseFloat(budgetAmount) || 0
                            if (Math.abs(sourceVal - inputVal) < 0.01) {
                              return <span className="ml-1 text-emerald-600 dark:text-emerald-400">• Inherited from source</span>
                            }
                            return <span className="ml-1 text-amber-600 dark:text-amber-400">• Overridden (source: ${sourceVal.toFixed(2)})</span>
                          })()}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bid strategy */}
                <div className="border rounded-xl p-3 flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-bold">Campaign bid strategy</p>
                    <p className="text-xs text-muted-foreground">Override the copied campaign's bid strategy</p>
                  </div>
                  <Select value={bidStrategy} onValueChange={setBidStrategy}>
                    <SelectTrigger className="w-36 h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">Keep original</SelectItem>
                      <SelectItem value="LOWEST_COST_WITHOUT_CAP">Lowest cost (no cap)</SelectItem>
                      <SelectItem value="LOWEST_COST_WITH_BID_CAP">Bid cap</SelectItem>
                      <SelectItem value="COST_CAP">Cost cap</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Launch as Active */}
                <div className="border rounded-xl p-3 flex items-center justify-between">
                  <p className="text-sm font-bold">Launch as Active</p>
                  <button
                    onClick={() => setLaunchAsActive(v => !v)}
                    className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                      launchAsActive ? "bg-primary" : "bg-muted-foreground/30")}
                  >
                    <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                      launchAsActive ? "translate-x-4" : "translate-x-0.5")} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP 2 — Configure Ad Sets */}
        {step === 2 && (
          <div className="px-5 py-4 space-y-3">
            {newCampaigns.length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg px-3 py-2.5 text-xs">
                <div className="flex items-start gap-2">
                  <IconCircleCheck className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-emerald-700 dark:text-emerald-400">
                      Created {newCampaigns.length} campaign{newCampaigns.length > 1 ? "s" : ""} in Meta
                    </p>
                    <ul className="mt-1 space-y-0.5 text-emerald-700/80 dark:text-emerald-400/80">
                      {newCampaigns.map(c => (
                        <li key={c.id} className="truncate">• {c.name} <span className="font-mono opacity-60">({c.id})</span></li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-emerald-700/70 dark:text-emerald-400/70 italic">Add ad sets below, or close to leave empty.</p>
                  </div>
                </div>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded-lg px-3 py-2.5 text-xs">
                <div className="flex items-start gap-2">
                  <IconAlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-amber-800 dark:text-amber-300">
                      {warnings.length} warning{warnings.length > 1 ? "s" : ""} from Meta
                    </p>
                    <ul className="mt-1 space-y-0.5 text-amber-800/90 dark:text-amber-300/90 max-h-32 overflow-y-auto">
                      {warnings.map((w, i) => (
                        <li key={i} className="break-words">• {w}</li>
                      ))}
                    </ul>
                    <button onClick={() => setWarnings([])} className="mt-1.5 text-xs underline opacity-70 hover:opacity-100">Dismiss</button>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-primary/10 dark:bg-blue-950/20 border border-primary/20 dark:border-blue-900 rounded-lg px-3 py-2 text-xs flex items-center justify-between">
              <span><span className="font-bold text-primary/90 dark:text-blue-300">Ad Account Timezone:</span> America/Los_Angeles (UTC-07:00)</span>
              <span><span className="font-bold text-primary/90 dark:text-blue-300">Time:</span> {new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}</span>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-bold">Choose Ad Sets ({selectedAdSetIds.size}/{sourceAdSets.length}) To Duplicate</p>
              <div className="flex items-center gap-3 text-xs">
                <button onClick={() => setSelectedAdSetIds(selectedAdSetIds.size === sourceAdSets.length ? new Set() : new Set(sourceAdSets.map(a => a.id)))}
                  className="text-primary hover:underline">
                  {selectedAdSetIds.size === sourceAdSets.length ? "Deselect All" : "Select All"}
                </button>
                <span className="text-muted-foreground">{sourceAdSets.length} total ad sets</span>
              </div>
            </div>

            {adSetsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
                <IconLoader2 className="size-4 animate-spin" />Loading ad sets...
              </div>
            ) : sourceAdSets.length === 0 ? (
              <div className="text-sm text-muted-foreground italic px-3 py-6 text-center border rounded-lg">No ad sets in this campaign</div>
            ) : sourceAdSets.map((adset, idx) => {
              const cfg = adSetConfigs[adset.id]
              const sel = selectedAdSetIds.has(adset.id)
              const isPaused = adset.effective_status !== "ACTIVE"
              if (!cfg) return null
              const updateCfg = (patch: Partial<AdSetCfg>) => {
                setAdSetConfigs(prev => ({ ...prev, [adset.id]: { ...prev[adset.id], ...patch } }))
              }
              const fetchAdsForCfg = async () => {
                if (cfg.adsLoaded || cfg.adsLoading) return
                updateCfg({ adsLoading: true })
                try {
                  const r = await fetch(`/api/facebook/adsets/${adset.id}/ads`)
                  const d = await r.json()
                  const list = (d.ads || []).map((a: any) => ({
                    id: a.id, name: a.name, effective_status: a.effective_status,
                  }))
                  // Default: all ads selected
                  setAdSetConfigs(prev => ({
                    ...prev,
                    [adset.id]: {
                      ...prev[adset.id],
                      adsList: list,
                      adsLoaded: true,
                      adsLoading: false,
                      selectedAdIds: list.map((a: any) => a.id),
                    },
                  }))
                } catch {
                  updateCfg({ adsLoading: false })
                }
              }
              return (
                <div key={adset.id} className={cn("border rounded-xl overflow-hidden",
                  sel && cfg.statusActive && "border-l-4 border-l-primary",
                  sel && !cfg.statusActive && "border-l-4 border-l-muted-foreground/30 bg-muted/10"
                )}>
                  <div className="px-3 py-2.5 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={e => {
                        setSelectedAdSetIds(prev => {
                          const s = new Set(prev)
                          e.target.checked ? s.add(adset.id) : s.delete(adset.id)
                          return s
                        })
                      }}
                      className="size-4"
                    />
                    <IconBrandMeta className="size-4 text-[#0064E0]" />
                    <span className={cn("text-sm font-bold flex-1 truncate", !cfg.statusActive && "text-muted-foreground")}>{adset.name}</span>
                    {/* Badge: ALWAYS reflect cfg.statusActive (user's choice persists across check/uncheck) */}
                    {(() => {
                      const willBeActive = cfg.statusActive
                      const changed = cfg.statusActive !== (adset.effective_status === "ACTIVE")
                      return (
                        <span className={cn(
                          "text-xs px-1.5 py-0.5 rounded font-bold border inline-flex items-center gap-1",
                          willBeActive
                            ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800"
                            : "bg-muted text-muted-foreground border-border",
                          !sel && "opacity-50"
                        )}
                          title={changed ? `Source: ${adset.effective_status} → Will be: ${willBeActive ? "ACTIVE" : "PAUSED"}${!sel ? " (not selected — won't duplicate)" : ""}` : adset.effective_status}
                        >
                          {willBeActive ? "ACTIVE" : "PAUSED"}
                          {changed && sel && <IconArrowRight className="size-2.5 opacity-70" />}
                        </span>
                      )
                    })()}
                  </div>
                  <p className="px-3 pb-2 text-xs text-muted-foreground">
                    Ad Set {idx + 1} of {sourceAdSets.length}
                    {sel && (
                      cfg.statusActive
                        ? (isPaused ? <span className="ml-2 italic">— paused source, will be activated on duplicate</span> : null)
                        : (isPaused
                            ? <span className="ml-2 italic">— paused source (toggle Activate for full options)</span>
                            : <span className="ml-2 italic">— set to pause on duplicate (toggle Activate for full options)</span>)
                    )}
                  </p>

                  {/* statusActive = false → mini panel (regardless of source status) */}
                  {sel && !cfg.statusActive && (
                    <div className="border-t bg-background p-3 space-y-2.5">
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1">New Ad Set Name</label>
                          <input value={cfg.customName} onChange={e => updateCfg({ customName: e.target.value })}
                            className="w-full px-2 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1">Copies <span className="text-xs">1–250</span></label>
                          <input type="number" min={1} max={250} value={cfg.copies}
                            onChange={e => updateCfg({ copies: Math.max(1, Math.min(250, parseInt(e.target.value) || 1)) })}
                            className="w-16 px-2 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring text-center" />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/30 border">
                        <div className="flex-1">
                          <p className="text-sm font-medium">Activate when duplicated</p>
                          <p className="text-xs text-muted-foreground">Toggle on to set status ACTIVE + customize schedule, dates, attribution</p>
                        </div>
                        <button onClick={() => updateCfg({ statusActive: true })}
                          className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 bg-muted-foreground/30">
                          <span className="inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform translate-x-0.5" />
                        </button>
                      </div>

                      <div className="flex items-start justify-between gap-2 bg-primary/10/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900 rounded-lg p-2">
                        <div>
                          <p className="text-sm font-medium flex items-center gap-1">
                            Duplicate ads from original ad set
                            <IconInfoCircle className="size-3 text-muted-foreground" />
                          </p>
                          <p className="text-xs text-muted-foreground">Copy all existing ads to new ad set</p>
                        </div>
                        <button onClick={() => updateCfg({ deepCopy: !cfg.deepCopy })}
                          className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 mt-0.5",
                            cfg.deepCopy ? "bg-primary" : "bg-muted-foreground/30")}>
                          <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                            cfg.deepCopy ? "translate-x-4" : "translate-x-0.5")} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* statusActive = true → full panel (regardless of source) */}
                  {sel && cfg.statusActive && (
                    <div className="border-t bg-muted/10 p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Copy current settings</span>
                        <button onClick={() => updateCfg({ copyCurrentSettings: !cfg.copyCurrentSettings })}
                          className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                            cfg.copyCurrentSettings ? "bg-primary" : "bg-muted-foreground/30")}>
                          <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                            cfg.copyCurrentSettings ? "translate-x-4" : "translate-x-0.5")} />
                        </button>
                      </div>
                      {(() => {
                        const a = adset as any
                        const daily = a.daily_budget ? `$${(parseInt(a.daily_budget) / 100).toFixed(2)}/day` : null
                        const lifetime = a.lifetime_budget ? `$${(parseInt(a.lifetime_budget) / 100).toFixed(2)} lifetime` : null
                        const budget = daily || lifetime || "Inherits from campaign (CBO)"
                        const statusLabel = a.effective_status === "ACTIVE" ? "Active"
                          : a.effective_status === "PAUSED" ? "Paused"
                          : a.effective_status === "CAMPAIGN_PAUSED" ? "Paused (campaign off)"
                          : a.effective_status === "ARCHIVED" ? "Archived"
                          : a.effective_status === "DELETED" ? "Deleted"
                          : (a.effective_status || "—")
                        const schedule = a.start_time
                          ? `from ${new Date(a.start_time).toLocaleDateString()}${a.end_time ? ` to ${new Date(a.end_time).toLocaleDateString()}` : ""}`
                          : "Run continuously"
                        return (
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium">Budget:</span> {budget} <span className="opacity-50">•</span>{" "}
                            <span className="font-medium">Status:</span> {statusLabel} <span className="opacity-50">•</span>{" "}
                            <span className="font-medium">Schedule:</span> {schedule}
                          </p>
                        )
                      })()}

                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1">New Ad Set Name</label>
                          <input value={cfg.customName} onChange={e => updateCfg({ customName: e.target.value })}
                            className="w-full px-2 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1">Copies <span className="text-xs">1–250</span></label>
                          <input type="number" min={1} max={250} value={cfg.copies}
                            onChange={e => updateCfg({ copies: Math.max(1, Math.min(250, parseInt(e.target.value) || 1)) })}
                            className="w-16 px-2 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring text-center" />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button onClick={() => updateCfg({ statusActive: !cfg.statusActive })}
                          className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                            cfg.statusActive ? "bg-primary" : "bg-muted-foreground/30")}>
                          <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                            cfg.statusActive ? "translate-x-4" : "translate-x-0.5")} />
                        </button>
                        <span className="text-sm font-medium">Ad Set Status: {cfg.statusActive ? "Active" : "Paused"}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-medium block mb-1">Start Date & Time <span className="text-muted-foreground">(Optional)</span></label>
                          <input type="datetime-local" value={cfg.startTime} onChange={e => updateCfg({ startTime: e.target.value })}
                            className="w-full px-2 py-1.5 text-xs bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring" />
                          <p className="text-xs text-muted-foreground mt-0.5">Leave empty to start immediately when ad set is activated</p>
                        </div>
                        <div>
                          <label className="text-xs font-medium block mb-1">End Date & Time <span className="text-muted-foreground">(Optional)</span></label>
                          <input type="datetime-local" value={cfg.endTime} onChange={e => updateCfg({ endTime: e.target.value })} disabled={!cfg.startTime}
                            className="w-full px-2 py-1.5 text-xs bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                          <p className="text-xs text-muted-foreground mt-0.5">Please select a start date first</p>
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground flex items-start gap-1">
                        <IconClock className="size-3 mt-0.5" />
                        <span><span className="font-medium text-foreground/70">Ad Scheduling (Day Parting)</span> - Requires Lifetime Budget. Turn off "Copy current settings" and select "Lifetime Budget" to enable.</span>
                      </p>

                      {/* Custom Attribution Window */}
                      <div className="border-t pt-2">
                        <div className="flex items-start justify-between gap-2 py-1">
                          <div>
                            <p className="text-sm font-medium">Set Custom Attribution Window</p>
                            <p className="text-xs text-muted-foreground">{cfg.customAttribution ? "Override the source ad set's attribution settings" : "Using original ad set's attribution settings"}</p>
                          </div>
                          <button onClick={() => updateCfg({ customAttribution: !cfg.customAttribution })}
                            className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 mt-0.5",
                              cfg.customAttribution ? "bg-primary" : "bg-muted-foreground/30")}>
                            <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                              cfg.customAttribution ? "translate-x-4" : "translate-x-0.5")} />
                          </button>
                        </div>
                        {cfg.customAttribution && (
                          <div className="space-y-2 mt-2 pl-1">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs font-medium block mb-1 flex items-center gap-1">
                                  View-through Days <IconInfoCircle className="size-3 text-muted-foreground" />
                                </label>
                                <Select value={cfg.attrViewDays} onValueChange={v => updateCfg({ attrViewDays: v })}>
                                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="0">Disabled (0 days)</SelectItem>
                                    <SelectItem value="1">1 day</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <label className="text-xs font-medium block mb-1 flex items-center gap-1">
                                  Click-through Days <IconInfoCircle className="size-3 text-muted-foreground" />
                                </label>
                                <Select value={cfg.attrClickDays} onValueChange={v => updateCfg({ attrClickDays: v })}>
                                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="1">1 day</SelectItem>
                                    <SelectItem value="7">7 days</SelectItem>
                                    <SelectItem value="28">28 days</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div>
                              <label className="text-xs font-medium block mb-1 flex items-center gap-1">
                                Engaged-view Days <span className="text-muted-foreground">(Video ads only)</span> <IconInfoCircle className="size-3 text-muted-foreground" />
                              </label>
                              <Select value={cfg.attrEngagedViewDays} onValueChange={v => updateCfg({ attrEngagedViewDays: v })}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">Disabled (0 days)</SelectItem>
                                  <SelectItem value="1">1 day</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-2 text-xs text-amber-800 dark:text-amber-300">
                              <p className="font-bold flex items-center gap-1 mb-0.5">
                                <IconAlertTriangle className="size-3" />Attribution Window Limitations
                              </p>
                              <p className="mb-1">Facebook restricts attribution window combinations based on campaign objective and optimization goal. If you receive an error, try different combinations or keep the original attribution settings.</p>
                              <p>Common valid combinations: 1d_view, 1d_click, 7d_click, 1d_view + 1d_click, 1d_view + 7d_click. Engaged-view is only available for video ads.</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Duplicate ads from original ad set */}
                      <div className="border-t pt-2">
                        <div className={cn("flex items-start justify-between gap-2 rounded-lg p-2",
                          cfg.deepCopy ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900" : "bg-primary/10/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900")}>
                          <div className="flex-1">
                            <p className="text-sm font-medium flex items-center gap-1">
                              Duplicate ads from original ad set
                              <IconInfoCircle className="size-3 text-muted-foreground" />
                              {cfg.deepCopy && (
                                <span className="ml-2 text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                                  ✓ Will copy {cfg.selectedAdIds.length} ad{cfg.selectedAdIds.length !== 1 ? "s" : ""}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{cfg.deepCopy ? `${cfg.selectedAdIds.length} ad${cfg.selectedAdIds.length !== 1 ? "s" : ""} from original ad set will be copied` : "Copy all existing ads to new ad set"}</p>
                          </div>
                          <button onClick={() => {
                            const next = !cfg.deepCopy
                            updateCfg({ deepCopy: next })
                            if (next) fetchAdsForCfg()
                          }}
                            className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 mt-0.5",
                              cfg.deepCopy ? "bg-emerald-500" : "bg-muted-foreground/30")}>
                            <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                              cfg.deepCopy ? "translate-x-4" : "translate-x-0.5")} />
                          </button>
                        </div>
                        {cfg.deepCopy && (
                          <div className="space-y-2 mt-2">
                            <div className="flex items-center justify-between gap-2">
                              <label className="text-xs font-medium">Duplicated ads status <span className="text-muted-foreground italic">Ads will be created as {cfg.duplicatedAdsStatus}</span></label>
                              <Select value={cfg.duplicatedAdsStatus} onValueChange={v => updateCfg({ duplicatedAdsStatus: v as "ACTIVE" | "PAUSED" })}>
                                <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="PAUSED">PAUSED</SelectItem>
                                  <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="border rounded-lg overflow-hidden">
                              <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b text-xs">
                                <button
                                  onClick={() => {
                                    const allSelected = cfg.adsList.length > 0 && cfg.selectedAdIds.length === cfg.adsList.length
                                    updateCfg({ selectedAdIds: allSelected ? [] : cfg.adsList.map(a => a.id) })
                                  }}
                                  className="font-medium flex items-center gap-1.5 hover:text-foreground"
                                >
                                  <input
                                    type="checkbox"
                                    readOnly
                                    checked={cfg.adsList.length > 0 && cfg.selectedAdIds.length === cfg.adsList.length}
                                    ref={el => { if (el) el.indeterminate = cfg.selectedAdIds.length > 0 && cfg.selectedAdIds.length < cfg.adsList.length }}
                                    className="size-3.5"
                                  />
                                  Choose ads to copy <span className="text-muted-foreground">{cfg.selectedAdIds.length}/{cfg.adsList.length}</span>
                                </button>
                                <div className="flex items-center gap-3 text-muted-foreground">
                                  <span>None</span>
                                  <span>Use only</span>
                                  <span>All</span>
                                  <IconChevronDown className="size-3" />
                                </div>
                              </div>
                              <div className="max-h-40 overflow-y-auto">
                                {cfg.adsLoading ? (
                                  <div className="px-3 py-3 text-xs text-muted-foreground flex items-center gap-2">
                                    <IconLoader2 className="size-3 animate-spin" />Loading ads...
                                  </div>
                                ) : cfg.adsList.length === 0 ? (
                                  <div className="px-3 py-3 text-xs text-muted-foreground italic">No ads in this ad set</div>
                                ) : cfg.adsList.map(ad => {
                                  const checked = cfg.selectedAdIds.includes(ad.id)
                                  return (
                                    <label key={ad.id} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 hover:bg-muted/20 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={e => {
                                          updateCfg({
                                            selectedAdIds: e.target.checked
                                              ? [...cfg.selectedAdIds, ad.id]
                                              : cfg.selectedAdIds.filter(id => id !== ad.id),
                                          })
                                        }}
                                        className="size-3.5"
                                      />
                                      <IconBrandMeta className="size-3.5 text-[#0064E0]" />
                                      <span className="flex-1 truncate text-xs font-medium">{ad.name}</span>
                                      <span className={cn("text-xs px-1.5 py-0.5 rounded font-bold border",
                                        ad.effective_status === "ACTIVE"
                                          ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800"
                                          : "bg-muted text-muted-foreground border-border"
                                      )}>
                                        {ad.effective_status}
                                      </span>
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* STEP 3 — Complete */}
        {step === 3 && (
          <div className="px-5 py-6 text-center space-y-4">
            <div className="size-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
              <IconCheck className="size-8 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Duplication Complete!</h3>
              <p className="text-sm text-muted-foreground">
                Successfully created {results.length} campaign{results.length !== 1 ? "s" : ""} with {results.reduce((sum, c) => sum + (c.adSets?.length || 0), 0)} ad set{results.reduce((sum, c) => sum + (c.adSets?.length || 0), 0) !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="border rounded-lg overflow-hidden text-left bg-primary/10/50 dark:bg-blue-950/10">
              {results.map((c, i) => (
                <div key={c.id}>
                  <div className="px-3 py-2.5 flex items-center gap-2 border-b">
                    <span className="size-7 rounded-full bg-primary/100 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                    <IconBrandMeta className="size-4 text-[#0064E0]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">Campaign ID: {c.id}</p>
                    </div>
                  </div>
                  <p className="text-xs font-bold text-muted-foreground uppercase px-3 py-1.5">AD SETS ({c.adSets?.length || 0})</p>
                  {(c.adSets || []).map((a: any) => (
                    <div key={a.id} className="px-3 py-1.5 flex items-center gap-2 text-xs border-t">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      <span className="font-medium truncate flex-1">{a.name}</span>
                      <span className="text-muted-foreground font-mono">ID: {a.id}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && step !== 3 && (
          <div className="mx-5 mb-3 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-2">
            {error}
          </div>
        )}

        </div>{/* end scrollable body */}

        {/* Footer */}
        <div className="px-5 py-3 border-t flex items-center justify-between shrink-0">
          {step === 3 ? (
            <Button onClick={onClose} className="w-full h-10 bg-emerald-500 hover:bg-emerald-600 text-white">
              <IconCheck className="size-4 mr-1" />Done
            </Button>
          ) : (
            <>
              <button onClick={() => {
                if (step === 2) setStep(1)
                else { setSelectedCampaignId(""); setCampaignName(""); setSelectedAdSetIds(new Set()) }
              }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                <IconRefresh className="size-3" />Reset
              </button>
              <div className="flex items-center gap-2">
                {step === 1 ? (
                  <Button
                    onClick={createCampaignsAndContinue}
                    disabled={!selectedCampaignId || !campaignName.trim() || creating}
                    className="min-w-[200px]"
                  >
                    {creating
                      ? <><IconLoader2 className="size-4 animate-spin mr-1" />Creating...</>
                      : <>Create {campaignCount} Campaign{campaignCount > 1 ? "s" : ""} & Continue<IconArrowRight className="size-3.5 ml-1" /></>
                    }
                  </Button>
                ) : (
                  <Button onClick={handleCreate} disabled={selectedAdSetIds.size === 0 || creating} className="min-w-[180px]">
                    {creating ? <><IconLoader2 className="size-4 animate-spin mr-1" />Duplicating...</> : `Duplicate ${totalAdSetsToCreate} Ad Set${totalAdSetsToCreate !== 1 ? "s" : ""}`}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Ad Sets Panel ────────────────────────────────────────────────────────────

function AdSetsPanel({ adAccountId, selectedAdSets, onSelect, onRemove, invalid, refreshKey }: {
  adAccountId: string; selectedAdSets: AdSet[]
  onSelect: (a: AdSet) => void; onRemove: (id: string) => void
  invalid?: boolean
  refreshKey?: number
}) {
  const [search, setSearch] = useState("")
  const [allAdSets, setAllAdSets] = useState<AdSet[]>([])
  const [results, setResults] = useState<AdSet[]>([])
  const [loading, setLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false)
  const [duplicateCampaignOpen, setDuplicateCampaignOpen] = useState(false)
  const selectedIds = new Set(selectedAdSets.map(a => a.id))

  const fetchAdSets = useCallback((forceRefresh = false) => {
    if (!adAccountId) return
    setLoading(true)
    const url = `/api/facebook/adsets?ad_account_id=${encodeURIComponent(adAccountId)}${forceRefresh ? "&refresh=true" : ""}`
    fetch(url)
      .then(r => r.json())
      .then(d => setAllAdSets(d.adSets || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [adAccountId])

  useEffect(() => { fetchAdSets() }, [fetchAdSets])
  useEffect(() => {
    if (refreshKey) fetchAdSets(true)
  }, [refreshKey, fetchAdSets])

  useEffect(() => {
    const q = search.toLowerCase()
    setResults(!q ? allAdSets.slice(0, 25) : allAdSets.filter(a => a.name.toLowerCase().includes(q) || a.id.includes(q)).slice(0, 25))
  }, [search, allAdSets])

  return (
    <div className={cn("border rounded-xl bg-card", invalid && "border-destructive")}>
      <DuplicateAdSetModal
        adAccountId={adAccountId}
        open={duplicateModalOpen}
        onClose={() => setDuplicateModalOpen(false)}
        allAdSets={allAdSets}
        onDuplicated={(newAdSets) => {
          setAllAdSets(prev => [...newAdSets, ...prev])
          newAdSets.forEach(a => onSelect(a))
          fetchAdSets(true)
        }}
      />
      <DuplicateCampaignModal
        open={duplicateCampaignOpen}
        onClose={() => setDuplicateCampaignOpen(false)}
        adAccountId={adAccountId}
        onDuplicated={(newAdSets) => {
          setAllAdSets(prev => [...newAdSets, ...prev])
          newAdSets.forEach(a => onSelect(a))
          fetchAdSets(true)
        }}
      />
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b overflow-x-auto">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-sm font-semibold whitespace-nowrap">Ad Sets</span>
          <span className="text-destructive text-xs font-bold">*</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Tip text="Copy the selected ad set setup into a new ad set.">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setDuplicateModalOpen(true)}
              disabled={allAdSets.length === 0}
            >
              <IconCopy className="size-3" />Duplicate Ad Set
            </Button>
          </Tip>
          <Tip text="Copy the selected campaign structure and settings.">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setDuplicateCampaignOpen(true)}
              disabled={!adAccountId}
            >
              <IconCopy className="size-3" />Duplicate Campaign
            </Button>
          </Tip>
        </div>
      </div>

      <div className="p-3 space-y-2">
	        {selectedAdSets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedAdSets.map(a => (
              <span key={a.id} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
                {a.name}
                <button onClick={() => onRemove(a.id)} className="hover:text-destructive rounded-full p-0.5">
                  <IconX className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            placeholder="Search by Ad Set name or ID"
            className="w-full pl-9 pr-16 py-2 text-sm bg-muted/40 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/40 font-mono">Ctrl+K</span>

          {showDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
              {loading ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                  <IconLoader2 className="size-3.5 animate-spin" />Loading...
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">No ad sets found</div>
              ) : results.map(a => (
                <button key={a.id}
                  onMouseDown={() => { if (!selectedIds.has(a.id)) onSelect(a); setSearch("") }}
                  className={cn("w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-accent transition-colors",
                    selectedIds.has(a.id) && "opacity-50")}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{a.name}</p>
                    {a.campaign_name && (
                      <p className="text-xs text-primary/70 truncate">{a.campaign_name}</p>
                    )}
                    <p className="text-xs text-muted-foreground/60 font-mono">{a.id}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium",
                      a.effective_status === "ACTIVE" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground")}>
                      {a.effective_status}
                    </span>
                    {selectedIds.has(a.id) && <IconCheck className="size-3.5 text-primary" />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={() => fetchAdSets(true)}>
          <IconRefresh className={cn("size-3", loading && "animate-spin")} />Ad Set Refresh
        </Button>
      </div>
    </div>
  )
}

// ─── Default Ad Settings Modal ────────────────────────────────────────────────

const DYNAMIC_TAGS = [
  "id", "counter", "creator", "filename",
  "dimensions", "filetype", "creativeType", "landingPage",
  "webLink", "adSetName", "campaignName", "aiName",
  "pageName",
]
const AI_NAME_TAGS = ["aiName"]
const DATE_FORMATS = [
  { value: "yyyy-mm-dd", label: "yyyy-mm-dd (2025-10-17)" },
  { value: "mm-dd-yyyy", label: "mm-dd-yyyy (10-17-2025)" },
  { value: "dd-mm-yyyy", label: "dd-mm-yyyy (17-10-2025)" },
  { value: "mmm-dd", label: "mmm-dd (Oct-17)" },
  { value: "dd-mmm-yy", label: "dd-mmm-yy (17-Oct-25)" },
  { value: "yyyymmdd", label: "yyyymmdd (20251017)" },
  { value: "mmm-dd-yyyy", label: "mmm-dd-yyyy (Oct-17-2025)" },
  { value: "dd/mm/yyyy", label: "dd/mm/yyyy (17/10/2025)" },
  { value: "mm/dd/yyyy", label: "mm/dd/yyyy (10/17/2025)" },
  { value: "WwwYyy", label: "WwwYyy (W42Y25)" },
  { value: "Www", label: "Www (W42)" },
  { value: "Yyy", label: "Yyy (Y25)" },
]
const SEPARATORS = [
  { value: "none", label: "None (no separator)", char: "" },
  { value: "underscore", label: "Underscore _", char: "_" },
  { value: "hyphen", label: "Hyphen -", char: "-" },
  { value: "space", label: "Space", char: " " },
  { value: "pipe", label: "Pipe |", char: "|" },
  { value: "double_dots", label: "Double Dots ..", char: ".." },
  { value: "double_colons", label: "Double Colons ::", char: "::" },
]

interface NamingConvention {
  tags: string[]              // e.g. ["filename", "_separator_", "creator"]
  dateFormat: string
  customTexts: { name: string; value: string }[]
  options: {
    removeDimensions: boolean
    preserveUnderscores: boolean
    useStaticForImages: boolean
    extendedIdFormat: boolean
    spacesAroundSeparator: boolean
  }
  separator: string
  aiNameSchema: string[]
}

interface CreativeEnhancements {
  metaCreativeEnhancements: boolean
  optimiseTextPerPerson: boolean
  images: Record<string, boolean>
  videos: Record<string, boolean>
  carousel: Record<string, boolean>
}

interface LaunchSettings {
  multiAdvertiser: boolean
  websiteDestOpt: boolean
  sitelinks: boolean
  browserAdOns: boolean
  tagBasedLocalization: boolean
  hidePromoCode: boolean
  autoUploadCaptions: boolean
  fastUpload: boolean
  launchAsPaused: boolean
  oneAdPerAdset: boolean
  launchAsPostId: boolean
  trackingSpecs: boolean
}

interface AdCopyDefaults {
  primaryText: string
  primaryVariations: string[]
  headline: string
  headlineVariations: string[]
  description: string
  cta: string
}

interface WebAppLinks {
  webLink: string
  displayLink: string
  androidLink: string
  iosAppStoreLink: string
  appDeeplink: string
  customProductPage: string
  utmParameters: string
}

interface DefaultAdSettings {
  naming: NamingConvention
  enhancements: CreativeEnhancements
  launch: LaunchSettings
  adCopy: AdCopyDefaults
  links: WebAppLinks
}

const DEFAULT_SETTINGS: DefaultAdSettings = {
  naming: {
    tags: ["filename"],
    dateFormat: "mmm-dd",
    customTexts: [],
    options: {
      removeDimensions: true,
      preserveUnderscores: false,
      useStaticForImages: false,
      extendedIdFormat: false,
      spacesAroundSeparator: false,
    },
    separator: "underscore",
    aiNameSchema: ["Style", "Asset Type", "Length", "Creator Age", "Hook", "Dimensions"],
  },
  enhancements: {
    metaCreativeEnhancements: true,
    optimiseTextPerPerson: true,
    images: {
      textTranslation: true, showSummary: true, revealDetails: true, addOverlays: true,
      adjustBrightness: true, music: true, imageAnimation: true, addSiteLinks: true,
      enhanceCTA: true, addDetailsToAd: true, flexibleMedia: true, advantagePlus: true,
      profileExtension: true, storeLocation: true, businessAI: true, showSpotlights: true,
      createStickerCTA: true,
    },
    videos: {
      textTranslation: true, addVideoEffects: true, addSiteLinks: true, enhanceCTA: true,
      addDetailsToAd: true, flexibleMedia: true, advantagePlus: true, videoToImage: true,
      profileExtension: true, storeLocation: true, businessAI: true, showSpotlights: true,
      createStickerCTA: true,
    },
    carousel: {
      relevantComments: true, profileAndCard: true, highlightCarouselCard: true,
      formatAutomation: true, dynamicDescription: true, enhanceCTA: true,
      adaptMultiImage: true, advantagePlus: true, photosToVideo: true, profileExtension: true,
      storeLocation: true, businessAI: true,
    },
  },
  launch: {
    multiAdvertiser: true,
    websiteDestOpt: false,
    sitelinks: false,
    browserAdOns: false,
    tagBasedLocalization: false,
    hidePromoCode: true,
    autoUploadCaptions: false,
    fastUpload: true,
    launchAsPaused: false,
    oneAdPerAdset: false,
    launchAsPostId: false,
    trackingSpecs: false,
  },
  adCopy: { primaryText: "", primaryVariations: [], headline: "", headlineVariations: [], description: "", cta: "SHOP_NOW" },
  links: { webLink: "", displayLink: "", androidLink: "", iosAppStoreLink: "", appDeeplink: "", customProductPage: "", utmParameters: "" },
}

const ENHANCEMENT_LABELS = {
  images: [
    ["textTranslation", "Text translation"], ["showSummary", "Show summary"],
    ["revealDetails", "Reveal details over time"], ["addOverlays", "Add overlays"],
    ["adjustBrightness", "Adjust brightness and contrast"], ["music", "Music"],
    ["imageAnimation", "Image animation"], ["addSiteLinks", "Add site links"],
    ["enhanceCTA", "Enhance CTA"], ["addDetailsToAd", "Add details to ad layout"],
    ["flexibleMedia", "Flexible Media"], ["advantagePlus", "Advantage+ Creative"],
    ["profileExtension", "Profile extension"], ["storeLocation", "Store location"],
    ["businessAI", "Business AI"], ["showSpotlights", "Show spotlights"],
    ["createStickerCTA", "Create sticker CTA"],
  ],
  videos: [
    ["textTranslation", "Text translation"], ["addVideoEffects", "Add video effects"],
    ["addSiteLinks", "Add site links"], ["enhanceCTA", "Enhance CTA"],
    ["addDetailsToAd", "Add details to ad layout"], ["flexibleMedia", "Flexible Media"],
    ["advantagePlus", "Advantage+ Creative"], ["videoToImage", "Video to image"],
    ["profileExtension", "Profile extension"], ["storeLocation", "Store location"],
    ["businessAI", "Business AI"], ["showSpotlights", "Show spotlights"],
    ["createStickerCTA", "Create sticker CTA"],
  ],
  carousel: [
    ["relevantComments", "Relevant comments"], ["profileAndCard", "Profile and card"],
    ["highlightCarouselCard", "Highlight carousel card"], ["formatAutomation", "Format automation"],
    ["dynamicDescription", "Dynamic description"], ["enhanceCTA", "Enhance CTA"],
    ["adaptMultiImage", "Adapt multi-image format"], ["advantagePlus", "Advantage+ Creative"],
    ["photosToVideo", "Photos to video"], ["profileExtension", "Profile extension"],
    ["storeLocation", "Store location"], ["businessAI", "Business AI"],
  ],
}

const LAUNCH_SETTING_DEFS: { key: keyof LaunchSettings; label: string; desc: string }[] = [
  { key: "multiAdvertiser", label: "Multi Advertiser", desc: "Automatically enable multi advertiser optimization" },
  { key: "websiteDestOpt", label: "Website Destination Optimization", desc: "Allow Meta to optimize landing page destinations" },
  { key: "sitelinks", label: "Sitelinks", desc: "Add sitelinks to your ads with custom URLs and display labels" },
  { key: "browserAdOns", label: "Browser Ad Ons", desc: "Add an additional contact method in the browser" },
  { key: "tagBasedLocalization", label: "Tag Based Localization", desc: "Show Tag Based matcher in launch and save MultiLang" },
  { key: "hidePromoCode", label: "Hide Promo Code & Email Sign Up", desc: "Prevent promo codes from being used" },
  { key: "autoUploadCaptions", label: "Auto Upload Captions (Meta)", desc: "Auto-transcribe and upload captions to improve Meta performance for viewers who watch without sound" },
  { key: "fastUpload", label: "Fast Upload", desc: "Pre-queue videos to upload to ad account when media is loaded" },
  { key: "oneAdPerAdset", label: "Launch 1 ad per adset (Special Ad Testing)", desc: "Enable special ad testing features. This will be visible as a toggle on the launch page after an ad set is selected" },
  { key: "launchAsPostId", label: "Launch ads as POST_ID when launched", desc: "Use POST_ID when recreating ads" },
  { key: "trackingSpecs", label: "Tracking Specs", desc: "Enable tracking specs to monitor both website events and app installs" },
]

function SettingsModal({
  open, onClose, adAccountId, adAccountName, orgName, onSettingsSaved,
}: {
  open: boolean
  onClose: () => void
  adAccountId: string
  adAccountName: string
  orgName: string
  onSettingsSaved?: (s: DefaultAdSettings) => void
}) {
  const STORAGE_KEY = `default_ad_settings_${adAccountId}`
  const [activeTab, setActiveTab] = useState<"naming" | "enhancements" | "launch" | "adCopy" | "links">("naming")
  const [settings, setSettings] = useState<DefaultAdSettings>(DEFAULT_SETTINGS)
  const [originalSettings, setOriginalSettings] = useState<DefaultAdSettings>(DEFAULT_SETTINGS)
  const [launchSearch, setLaunchSearch] = useState("")
  const [customTextDialogOpen, setCustomTextDialogOpen] = useState(false)
  const [newCustomText, setNewCustomText] = useState("")

  // Load on open
  useEffect(() => {
    if (!open) return
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      const loaded = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS
      setSettings(loaded)
      setOriginalSettings(loaded)
      setActiveTab("naming")
    } catch {
      setSettings(DEFAULT_SETTINGS)
      setOriginalSettings(DEFAULT_SETTINGS)
    }
  }, [open, adAccountId])

  const updateNaming = (patch: Partial<NamingConvention>) =>
    setSettings(s => ({ ...s, naming: { ...s.naming, ...patch } }))
  const updateOptions = (patch: Partial<NamingConvention["options"]>) =>
    setSettings(s => ({ ...s, naming: { ...s.naming, options: { ...s.naming.options, ...patch } } }))

  const addTag = (tag: string) => updateNaming({ tags: [...settings.naming.tags, tag] })
  const removeTag = (idx: number) => updateNaming({ tags: settings.naming.tags.filter((_, i) => i !== idx) })

  // Live preview of naming convention
  const previewName = settings.naming.tags.length === 0
    ? "(empty)"
    : settings.naming.tags.map((t, i) => {
        if (t === "filename") return i === 0 ? "newHookAd" : "hookAd"
        if (t === "creator") return "Tuan"
        if (t === "id") return "12345"
        if (t === "counter") return "001"
        if (t === "dimensions") return "1080x1920"
        if (t === "filetype") return "mp4"
        if (t === "creativeType") return "VID"
        if (t === "landingPage") return "Protocol"
        if (t === "webLink") return "wellnessnest"
        if (t === "adSetName") return "AdSet1"
        if (t === "campaignName") return "Campaign1"
        if (t === "aiName") return "Hero-Style"
        if (t === "pageName") return "Magnali"
        if (t === "date") {
          const fmt = settings.naming.dateFormat
          if (fmt === "yyyy-mm-dd") return "2025-10-17"
          if (fmt === "mm-dd-yyyy") return "10-17-2025"
          if (fmt === "dd-mm-yyyy") return "17-10-2025"
          if (fmt === "mmm-dd") return "Oct-17"
          if (fmt === "dd-mmm-yy") return "17-Oct-25"
          if (fmt === "yyyymmdd") return "20251017"
          if (fmt === "mmm-dd-yyyy") return "Oct-17-2025"
          if (fmt === "dd/mm/yyyy") return "17/10/2025"
          if (fmt === "mm/dd/yyyy") return "10/17/2025"
          if (fmt === "WwwYyy") return "W42Y25"
          if (fmt === "Www") return "W42"
          if (fmt === "Yyy") return "Y25"
          return "Oct-17"
        }
        return t
      }).join(SEPARATORS.find(s => s.value === settings.naming.separator)?.char || "")

  const handleSave = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch {}
    setOriginalSettings(settings)
    onSettingsSaved?.(settings)
    onClose()
  }
  const resetDefaults = () => {
    if (confirm("Reset Naming Convention to defaults?")) {
      updateNaming(DEFAULT_SETTINGS.naming)
    }
  }

  const TABS = [
    { key: "naming" as const, label: "Naming Convention" },
    { key: "enhancements" as const, label: "Creative Enhancements" },
    { key: "launch" as const, label: "Launch Settings" },
    { key: "adCopy" as const, label: "Ad Copy Defaults" },
    { key: "links" as const, label: "Web & App Links" },
  ]

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="text-base font-bold">Default Ad Settings: {adAccountName}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Manage naming convention, creative enhancements, launch settings, ad copy defaults, and web/app links</p>
          <p className="text-xs text-muted-foreground/70 font-mono mt-1">Business ID: {adAccountId} | Workspace: {orgName}</p>
        </div>

        {/* Body: sidebar + content */}
        <div className="grid grid-cols-[200px_1fr] flex-1 min-h-0 overflow-hidden">
          {/* Sidebar */}
          <div className="border-r overflow-y-auto py-3">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  "w-full text-left px-4 py-2.5 text-sm transition-colors",
                  activeTab === t.key ? "bg-muted/60 font-bold border-l-2 border-primary" : "text-muted-foreground hover:bg-muted/30"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="overflow-y-auto p-5">
            {/* TAB: NAMING CONVENTION */}
            {activeTab === "naming" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-base font-bold">Naming Convention</h3>
                    <IconInfoCircle className="size-3.5 text-muted-foreground" />
                  </div>
                  <button onClick={resetDefaults} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                    <IconRefresh className="size-3" />Reset Defaults
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="border rounded-xl p-3">
                    <p className="text-sm font-bold mb-2">Your Convention</p>
                    <div className="border rounded-lg px-2 py-2 bg-muted/20 min-h-[44px] flex flex-wrap items-center gap-1">
                      {settings.naming.tags.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic px-2">Click tags below to build...</span>
                      ) : settings.naming.tags.map((t, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-background border text-xs font-mono">
                          <IconArrowLeft className="size-2.5 opacity-30" />
                          {`{{${t}}}`}
                          <button onClick={() => removeTag(i)} className="hover:text-destructive ml-0.5">
                            <IconX className="size-2.5" />
                          </button>
                          <IconArrowRight className="size-2.5 opacity-30" />
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="border rounded-xl p-3">
                    <div className="flex items-center gap-1 mb-2">
                      <p className="text-sm font-bold">Preview</p>
                      <IconInfoCircle className="size-3.5 text-muted-foreground" />
                    </div>
                    <div className="border rounded-lg px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 text-sm font-mono text-emerald-800 dark:text-emerald-300 min-h-[44px] flex items-center break-all">
                      {previewName}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_280px] gap-4">
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center gap-1 mb-2">
                        <p className="text-sm font-bold">Dynamic Tags</p>
                        <IconInfoCircle className="size-3 text-muted-foreground" />
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {DYNAMIC_TAGS.map(t => (
                          <button
                            key={t}
                            onClick={() => addTag(t)}
                            className={cn(
                              "px-2 py-1.5 text-xs font-mono border rounded-md hover:bg-muted/40 transition-colors",
                              AI_NAME_TAGS.includes(t) && "bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/30 dark:border-purple-900"
                            )}
                          >
                            {AI_NAME_TAGS.includes(t) && "✨ "}{`{{${t}}}`}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-1 mb-1.5">
                        <p className="text-sm font-bold">Date Format</p>
                        <IconInfoCircle className="size-3 text-muted-foreground" />
                      </div>
                      <div className="flex gap-2">
                        <Select value={settings.naming.dateFormat} onValueChange={v => updateNaming({ dateFormat: v })}>
                          <SelectTrigger className="h-9 text-sm bg-background flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DATE_FORMATS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                            <SelectItem value="custom">Custom...</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button size="icon" className="size-9" onClick={() => addTag("date")}>
                          <IconPlus className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-1 mb-1.5">
                        <p className="text-sm font-bold">Custom Text</p>
                        <IconInfoCircle className="size-3 text-muted-foreground" />
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={newCustomText}
                          onChange={e => setNewCustomText(e.target.value)}
                          placeholder="Enter text..."
                          className="flex-1 px-3 py-1.5 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                        />
                        <Button size="icon" className="size-9" onClick={() => {
                          if (newCustomText.trim()) {
                            updateNaming({ customTexts: [...settings.naming.customTexts, { name: newCustomText, value: newCustomText }] })
                            setNewCustomText("")
                          }
                        }}>
                          <IconPlus className="size-4" />
                        </Button>
                        <Button variant="outline" size="icon" className="size-9" onClick={() => setCustomTextDialogOpen(true)}>
                          <IconChevronDown className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Options */}
                  <div className="border rounded-xl p-3 space-y-3">
                    <p className="text-sm font-bold">Options</p>
                    {([
                      ["removeDimensions", "Remove dimensions"],
                      ["preserveUnderscores", "Preserve underscores and tildes"],
                      ["useStaticForImages", 'Use "Static" for images'],
                      ["extendedIdFormat", "Extended ID format (X.YYY)"],
                      ["spacesAroundSeparator", "Spaces around separator"],
                    ] as const).map(([key, label]) => (
                      <div key={key} className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-medium">{label}</span>
                          <IconInfoCircle className="size-3 text-muted-foreground" />
                        </div>
                        <button
                          onClick={() => updateOptions({ [key]: !settings.naming.options[key] } as any)}
                          className={cn("relative inline-flex h-5 w-9 items-center rounded-full shrink-0",
                            settings.naming.options[key] ? "bg-primary" : "bg-muted-foreground/30")}
                        >
                          <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                            settings.naming.options[key] ? "translate-x-4" : "translate-x-0.5")} />
                        </button>
                      </div>
                    ))}

                    <div>
                      <p className="text-xs font-medium mb-1">Separator</p>
                      <Select value={settings.naming.separator} onValueChange={v => updateNaming({ separator: v })}>
                        <SelectTrigger className="h-8 text-xs bg-background"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SEPARATORS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-bold">✨ AI Name</span>
                          <IconInfoCircle className="size-3 text-muted-foreground" />
                        </div>
                      </div>
                      <div className="border rounded-lg p-2 bg-muted/20">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-muted-foreground">Current Schema</span>
                          <button className="text-xs text-primary hover:underline">Edit →</button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {settings.naming.aiNameSchema.map(s => (
                            <span key={s} className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 rounded">{s}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: CREATIVE ENHANCEMENTS */}
            {activeTab === "enhancements" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 border rounded-xl">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold">Meta <span className="text-primary">Creative Enhancements</span></span>
                    <IconInfoCircle className="size-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground italic">Toggle all enhancements on/off</span>
                  </div>
                  <button
                    onClick={() => setSettings(s => ({ ...s, enhancements: { ...s.enhancements, metaCreativeEnhancements: !s.enhancements.metaCreativeEnhancements } }))}
                    className={cn("relative inline-flex h-5 w-9 items-center rounded-full",
                      settings.enhancements.metaCreativeEnhancements ? "bg-primary" : "bg-muted-foreground/30")}
                  >
                    <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                      settings.enhancements.metaCreativeEnhancements ? "translate-x-4" : "translate-x-0.5")} />
                  </button>
                </div>

                <div className="flex items-start justify-between p-3 border rounded-xl">
                  <div>
                    <p className="text-sm font-medium">Optimise text per person</p>
                    <p className="text-xs text-muted-foreground">Independent of individual creative enhancement switches; maps to the same setting the launcher sends to Meta</p>
                  </div>
                  <button
                    onClick={() => setSettings(s => ({ ...s, enhancements: { ...s.enhancements, optimiseTextPerPerson: !s.enhancements.optimiseTextPerPerson } }))}
                    className={cn("relative inline-flex h-5 w-9 items-center rounded-full shrink-0",
                      settings.enhancements.optimiseTextPerPerson ? "bg-primary" : "bg-muted-foreground/30")}
                  >
                    <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                      settings.enhancements.optimiseTextPerPerson ? "translate-x-4" : "translate-x-0.5")} />
                  </button>
                </div>

                <p className="text-xs text-muted-foreground italic">Standard enhancements are deprecated in Marketing API v22.0. Use individual Advantage+ Creative features instead.</p>

                <div className="grid grid-cols-3 gap-4">
                  {(["images", "videos", "carousel"] as const).map(group => (
                    <div key={group} className="border rounded-xl p-4">
                      <p className="text-base font-bold capitalize mb-3 flex items-center gap-2">
                        {group === "images" ? <IconPhoto className="size-4" /> : group === "videos" ? <IconVideo className="size-4" /> : <IconLayout className="size-4" />}
                        {group}
                      </p>
                      <div className="space-y-2.5">
                        {ENHANCEMENT_LABELS[group].map(([key, label]) => (
                          <div key={key} className="flex items-center justify-between gap-3">
                            <span className="text-xs flex items-center gap-1 leading-snug">
                              {label}
                              <IconInfoCircle className="size-3 text-muted-foreground/50 shrink-0" />
                            </span>
                            <button
                              onClick={() => setSettings(s => ({
                                ...s,
                                enhancements: { ...s.enhancements, [group]: { ...s.enhancements[group], [key]: !s.enhancements[group][key] } },
                              }))}
                              className={cn("relative inline-flex h-5 w-9 items-center rounded-full shrink-0 transition-colors",
                                settings.enhancements[group][key] ? "bg-primary" : "bg-muted-foreground/30")}
                            >
                              <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                                settings.enhancements[group][key] ? "translate-x-4" : "translate-x-0.5")} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <details className="mt-3">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1">
                          <IconChevronDown className="size-3" />Deprecated Fields
                        </summary>
                        <p className="text-xs text-muted-foreground italic mt-1.5 pl-4">Legacy fields no longer needed in v22.0+</p>
                      </details>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB: LAUNCH SETTINGS */}
            {activeTab === "launch" && (() => {
              const matchesSearch = (s: (typeof LAUNCH_SETTING_DEFS)[number]) =>
                !launchSearch || s.label.toLowerCase().includes(launchSearch.toLowerCase()) || s.desc.toLowerCase().includes(launchSearch.toLowerCase())
              const regularSettings = LAUNCH_SETTING_DEFS.filter(s => s.key === "oneAdPerAdset" && matchesSearch(s))
              const legacySettings = LAUNCH_SETTING_DEFS.filter(s => s.key !== "oneAdPerAdset" && matchesSearch(s))

              return (
                <div className="space-y-4">
                  <h3 className="text-base font-bold">Launch Settings</h3>
                  <div className="relative">
                    <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                    <input
                      value={launchSearch}
                      onChange={e => setLaunchSearch(e.target.value)}
                      placeholder="Search settings..."
                      className="w-full pl-9 pr-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-xl border bg-background p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Regular</p>
                      <div className="mt-3 space-y-2">
                        {regularSettings.map(def => (
                          <div key={def.key} className="flex items-start justify-between gap-3 rounded-lg border bg-muted/10 p-3 hover:bg-muted/20">
                            <div className="flex-1">
                              <p className="text-sm font-medium">{def.label}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">{def.desc}</p>
                            </div>
                            <button
                              onClick={() => setSettings(s => ({ ...s, launch: { ...s.launch, [def.key]: !s.launch[def.key] } }))}
                              className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full",
                                settings.launch[def.key] ? "bg-primary" : "bg-muted-foreground/30")}
                            >
                              <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                                settings.launch[def.key] ? "translate-x-4" : "translate-x-0.5")} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border bg-muted/20 p-3 opacity-60">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Legacy</p>
                      <div className="mt-3 space-y-2">
                        {legacySettings.map(def => (
                          <div key={def.key} className="flex items-start justify-between gap-3 rounded-lg border bg-background/40 p-3">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-muted-foreground">{def.label}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">{def.desc}</p>
                            </div>
                            <button
                              disabled
                              aria-disabled="true"
                              className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-not-allowed items-center rounded-full",
                                settings.launch[def.key] ? "bg-primary/50" : "bg-muted-foreground/20")}
                            >
                              <span className={cn("inline-block size-3.5 rounded-full bg-white/80 shadow-sm transition-transform",
                                settings.launch[def.key] ? "translate-x-4" : "translate-x-0.5")} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* TAB: AD COPY DEFAULTS */}
            {activeTab === "adCopy" && (
              <div className="space-y-4">
                <h3 className="text-base font-bold">Default Ad Copy</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-1 mb-1.5">
                        <label className="text-sm font-bold">Primary Text</label>
                        <IconInfoCircle className="size-3 text-muted-foreground" />
                      </div>
                      <textarea
                        value={settings.adCopy.primaryText}
                        onChange={e => setSettings(s => ({ ...s, adCopy: { ...s.adCopy, primaryText: e.target.value } }))}
                        rows={3}
                        placeholder="Enter your default primary text..."
                        className="w-full px-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring resize-none"
                      />
                      <button className="mt-1 text-xs text-primary hover:underline flex items-center gap-1">
                        Show Variations <IconPlus className="size-3 rounded-full border border-primary" />
                      </button>
                    </div>
                    <div>
                      <label className="text-sm font-bold block mb-1.5">Description</label>
                      <textarea
                        value={settings.adCopy.description}
                        onChange={e => setSettings(s => ({ ...s, adCopy: { ...s.adCopy, description: e.target.value } }))}
                        rows={3}
                        placeholder="Enter your ad description here"
                        className="w-full px-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring resize-none"
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-1 mb-1.5">
                        <label className="text-sm font-bold">Headline</label>
                        <IconInfoCircle className="size-3 text-muted-foreground" />
                      </div>
                      <input
                        value={settings.adCopy.headline}
                        onChange={e => setSettings(s => ({ ...s, adCopy: { ...s.adCopy, headline: e.target.value } }))}
                        placeholder="Enter default headline..."
                        className="w-full px-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button className="mt-1 text-xs text-primary hover:underline flex items-center gap-1">
                        Show Variations <IconPlus className="size-3 rounded-full border border-primary" />
                      </button>
                    </div>
                    <div>
                      <label className="text-sm font-bold block mb-1.5">Call To Action</label>
                      <Select value={settings.adCopy.cta} onValueChange={v => setSettings(s => ({ ...s, adCopy: { ...s.adCopy, cta: v } }))}>
                        <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CTA_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: WEB & APP LINKS */}
            {activeTab === "links" && (
              <div className="space-y-4">
                <h3 className="text-base font-bold">Default Web & App Links</h3>
                <div className="grid grid-cols-2 gap-4">
                  {([
                    ["webLink", "Web Link", "https://..."],
                    ["displayLink", "Display Link", "Enter your display link here (e.g., example.com)"],
                    ["androidLink", "Android Link", "Enter your Android link here"],
                    ["iosAppStoreLink", "iOS App Store Link", "Enter your iOS App Store link here"],
                    ["appDeeplink", "App Deeplink (Android Only)", "Enter your Android deeplink here"],
                    ["customProductPage", "Custom Product Page", "Enter your custom product page ID"],
                  ] as const).map(([key, label, placeholder]) => (
                    <div key={key}>
                      <label className="text-sm font-bold block mb-1.5">{label}</label>
                      <input
                        value={settings.links[key]}
                        onChange={e => setSettings(s => ({ ...s, links: { ...s.links, [key]: e.target.value } }))}
                        placeholder={placeholder}
                        className="w-full px-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  ))}
                  <div className="col-span-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm font-bold">UTM Parameters</label>
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => setSettings(s => ({ ...s, links: { ...s.links, utmParameters: "utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}" } }))}
                      >Add recommended tags</button>
                    </div>
                    <textarea
                      value={settings.links.utmParameters}
                      onChange={e => setSettings(s => ({ ...s, links: { ...s.links, utmParameters: e.target.value } }))}
                      rows={3}
                      placeholder="Enter your UTM params i.e utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}} or select from suggestions"
                      className="w-full px-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t flex items-center justify-end gap-2 shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </div>

        {/* Custom Text dialog */}
        {customTextDialogOpen && (
          <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setCustomTextDialogOpen(false)}>
            <div className="bg-popover border rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold">Custom Text</h3>
                <button onClick={() => setCustomTextDialogOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <IconX className="size-4" />
                </button>
              </div>
              <div className="flex gap-2 mb-3">
                <input
                  value={newCustomText}
                  onChange={e => setNewCustomText(e.target.value)}
                  placeholder="New category name..."
                  className="flex-1 px-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring"
                />
                <Button size="icon" onClick={() => {
                  if (newCustomText.trim()) {
                    updateNaming({ customTexts: [...settings.naming.customTexts, { name: newCustomText, value: newCustomText }] })
                    setNewCustomText("")
                  }
                }}>
                  <IconPlus className="size-4" />
                </Button>
              </div>
              {settings.naming.customTexts.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  <p>No custom text saved yet.</p>
                  <p className="text-xs">Add your first one using the input above.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {settings.naming.customTexts.map((ct, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 border rounded-lg">
                      <span className="text-sm">{ct.name}</span>
                      <button
                        onClick={() => updateNaming({ customTexts: settings.naming.customTexts.filter((_, j) => j !== i) })}
                        className="size-7 flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <IconX className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Ad Copy Templates ────────────────────────────────────────────────────────

interface AdCopyTemplate {
  id: string
  name: string
  primaryText: string
  headline: string
  description?: string
  link?: string
  cta: string
  createdAt: string
}

function AdCopyTemplateModal({
  open, onClose, adAccountId, adAccountName,
  onApply,
  currentPrimaryText, currentHeadline, currentDescription, currentLink, currentCta,
}: {
  open: boolean; onClose: () => void
  adAccountId: string; adAccountName: string
  onApply: (t: Omit<AdCopyTemplate, "id" | "name" | "createdAt">) => void
  currentPrimaryText: string; currentHeadline: string
  currentDescription: string; currentLink: string; currentCta: string
}) {
  const [templates, setTemplates] = useState<AdCopyTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<"newest" | "oldest">("newest")
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  // Create/Edit state
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AdCopyTemplate | null>(null)
  const [formName, setFormName] = useState("")
  const [formPrimaryText, setFormPrimaryText] = useState("")
  const [formHeadline, setFormHeadline] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formLink, setFormLink] = useState("")
  const [formCta, setFormCta] = useState("SHOP_NOW")

  // Load from Ad Set state
  const [loadOpen, setLoadOpen] = useState(false)
  const [loadSearch, setLoadSearch] = useState("")
  const [loadingAds, setLoadingAds] = useState(false)
  const [existingAds, setExistingAds] = useState<any[]>([])

  // Expanded rows
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(["__default__"]))

  const dbToLocal = (t: any): AdCopyTemplate => ({
    id: t.id,
    name: t.name,
    primaryText: t.primary_text || "",
    headline: t.headline || "",
    description: t.description || "",
    link: t.link || "",
    cta: t.cta || "SHOP_NOW",
    createdAt: t.created_at,
  })

  useEffect(() => {
    if (!open) return
    setSearch(""); setPage(1)
    setLoadingTemplates(true)
    fetch(`/api/templates`)
      .then(r => r.json())
      .then(d => setTemplates((d.templates || []).map(dbToLocal)))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false))
  }, [open])

  // Read Default Settings
  const defaultCopy = useMemo(() => {
    try {
      const raw = localStorage.getItem(`default_ad_settings_${adAccountId}`)
      if (!raw) return null
      const s: DefaultAdSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
      return s.adCopy
    } catch { return null }
  }, [open, adAccountId])

  const defaultLinks = useMemo(() => {
    try {
      const raw = localStorage.getItem(`default_ad_settings_${adAccountId}`)
      if (!raw) return null
      const s: DefaultAdSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
      return s.links
    } catch { return null }
  }, [open, adAccountId])

  const filtered = useMemo(() => {
    let ts = [...templates]
    if (search) {
      const q = search.toLowerCase()
      ts = ts.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.primaryText.toLowerCase().includes(q) ||
        t.headline.toLowerCase().includes(q)
      )
    }
    ts.sort((a, b) =>
      sort === "newest"
        ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
    return ts
  }, [templates, search, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const toggleExpand = (id: string) =>
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const openCreate = (prefill?: Partial<AdCopyTemplate>) => {
    setEditTarget(null)
    setFormName(prefill?.name || "")
    setFormPrimaryText(prefill?.primaryText ?? currentPrimaryText)
    setFormHeadline(prefill?.headline ?? currentHeadline)
    setFormDescription(prefill?.description ?? currentDescription)
    setFormLink(prefill?.link ?? currentLink)
    setFormCta(prefill?.cta ?? (currentCta || "SHOP_NOW"))
    setCreateOpen(true)
  }

  const openEdit = (t: AdCopyTemplate) => {
    setEditTarget(t)
    setFormName(t.name)
    setFormPrimaryText(t.primaryText)
    setFormHeadline(t.headline)
    setFormDescription(t.description || "")
    setFormLink(t.link || "")
    setFormCta(t.cta)
    setCreateOpen(true)
  }

  const formLinkInvalid = formLink.trim().length > 0 && !/^https:\/\/./.test(formLink.trim())

  const handleSaveTemplate = async () => {
    if (!formName.trim() || !adAccountId || formLinkInvalid) return
    setSaving(true)
    try {
      if (editTarget) {
        const r = await fetch(`/api/templates/${editTarget.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName, primary_text: formPrimaryText, headline: formHeadline, description: formDescription, link: formLink, cta: formCta }),
        })
        if (r.ok) {
          const d = await r.json()
          setTemplates(prev => prev.map(t => t.id === editTarget.id ? dbToLocal(d.template) : t))
        }
      } else {
        const r = await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ad_account_id: adAccountId, name: formName.trim(), primary_text: formPrimaryText, headline: formHeadline, description: formDescription, link: formLink, cta: formCta }),
        })
        if (r.ok) {
          const d = await r.json()
          setTemplates(prev => [dbToLocal(d.template), ...prev])
        }
      }
      setCreateOpen(false)
    } finally { setSaving(false) }
  }

  const deleteTemplate = async (id: string) => {
    if (!confirm("Delete this template?")) return
    setTemplates(prev => prev.filter(t => t.id !== id))
    await fetch(`/api/templates/${id}`, { method: "DELETE" })
  }

  const applyDefault = () => {
    onApply({
      primaryText: defaultCopy?.primaryText || "",
      headline: defaultCopy?.headline || "",
      description: defaultCopy?.description || "",
      link: defaultLinks?.webLink || "",
      cta: defaultCopy?.cta || "SHOP_NOW",
    })
    onClose()
  }

  const applyTemplate = (t: AdCopyTemplate) => {
    onApply({ primaryText: t.primaryText, headline: t.headline, description: t.description, link: t.link, cta: t.cta })
    onClose()
  }

  const fetchExistingAds = async () => {
    setLoadingAds(true)
    try {
      const res = await fetch(`/api/facebook/existing-ads?ad_account_id=${encodeURIComponent(adAccountId)}&active_only=1&limit=100`)
      const data = await res.json()
      const adsWithCopy = (data.ads || []).filter((a: any) => a.primaryText || a.headline)
      
      const seen = new Set<string>()
      const uniqueAds = adsWithCopy.filter((a: any) => {
        const key = `${(a.primaryText || "").trim()}|||${(a.headline || "").trim()}|||${(a.link || "").trim()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      
      setExistingAds(uniqueAds)
    } catch {}
    setLoadingAds(false)
  }

  const openLoadFromAdSet = () => {
    setLoadSearch("")
    setLoadOpen(true)
    if (existingAds.length === 0) fetchExistingAds()
  }

  const filteredAds = useMemo(() => {
    if (!loadSearch) return existingAds
    const q = loadSearch.toLowerCase()
    return existingAds.filter(a =>
      a.name?.toLowerCase().includes(q) ||
      a.primaryText?.toLowerCase().includes(q) ||
      a.headline?.toLowerCase().includes(q)
    )
  }, [existingAds, loadSearch])

  const applyFromAd = (ad: any) => {
    onApply({ primaryText: ad.primaryText || "", headline: ad.headline || "", description: ad.description, link: ad.link, cta: ad.cta || "LEARN_MORE" })
    onClose()
  }

  const saveAdAsTemplate = (ad: any) => {
    openCreate({ name: ad.name || "", primaryText: ad.primaryText || "", headline: ad.headline || "", description: ad.description, link: ad.link, cta: ad.cta || "LEARN_MORE" })
    setLoadOpen(false)
  }

  const formattedDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden [&>button:last-of-type]:hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
          <DialogTitle className="text-base font-bold">Select The Ad Copy Template</DialogTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={openLoadFromAdSet}>
              <IconCopy className="size-3.5" />Load from Ad Set
              <IconInfoCircle className="size-3.5 text-muted-foreground" />
            </Button>
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openCreate()}>
              <IconPlus className="size-3.5" />Create Ad Copy Template
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b shrink-0 bg-muted/20">
          <div className="relative flex-1">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search Ad Copy Templates..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
            />
          </div>
          <Select value={sort} onValueChange={v => setSort(v as any)}>
            <SelectTrigger className="h-9 w-28 text-xs bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5 h-9 px-3 border rounded-lg bg-background text-xs text-muted-foreground">
            <IconBuildingStore className="size-3.5" />
            <span className="truncate max-w-[120px]">{adAccountName}</span>
          </div>
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loadingTemplates && (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <IconLoader2 className="size-4 animate-spin" /><span className="text-sm">Loading templates...</span>
            </div>
          )}
          {/* Default Settings card */}
          {!search && (
            <div className="border rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => toggleExpand("__default__")}
                  className={cn("size-7 rounded-lg border flex items-center justify-center shrink-0 hover:bg-muted/40 transition-colors",
                    expandedIds.has("__default__") && "bg-muted/40")}
                >
                  <IconChevronDown className={cn("size-3.5 transition-transform", expandedIds.has("__default__") && "rotate-180")} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Default Settings</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-primary/90 dark:bg-blue-950/40 dark:text-primary font-medium">Default</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {[defaultCopy?.headline, defaultCopy?.cta, defaultLinks?.webLink ? new URL(defaultLinks.webLink.startsWith("http") ? defaultLinks.webLink : `https://${defaultLinks.webLink}`).hostname : null].filter(Boolean).join(" · ") || "No defaults configured"}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formattedDate(new Date().toISOString())}
                </span>
                <Button size="sm" className="h-8 px-4 shrink-0" onClick={applyDefault}
                  disabled={!defaultCopy?.primaryText && !defaultCopy?.headline}>
                  Apply
                </Button>
                <button onClick={() => {/* open settings */}} className="text-muted-foreground hover:text-foreground p-1">
                  <IconSettings className="size-4" />
                </button>
              </div>
              {expandedIds.has("__default__") && (
                <div className="border-t px-4 py-3 bg-muted/20 space-y-2">
                  {defaultCopy?.primaryText && (
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-0.5">Primary Text</span>
                      <p className="text-xs leading-relaxed line-clamp-4">{defaultCopy.primaryText}</p>
                    </div>
                  )}
                  {defaultCopy?.headline && (
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Headline</span>
                      <p className="text-xs">{defaultCopy.headline}</p>
                    </div>
                  )}
                  {defaultLinks?.webLink && (
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Link</span>
                      <p className="text-xs text-muted-foreground truncate">{defaultLinks.webLink}</p>
                    </div>
                  )}
                  {defaultCopy?.cta && (
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">CTA</span>
                      <p className="text-xs">{defaultCopy.cta}</p>
                    </div>
                  )}
                  {!defaultCopy?.primaryText && !defaultCopy?.headline && (
                    <p className="text-xs text-muted-foreground italic">No defaults set. Configure in Settings → Ad Copy Defaults.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* User templates */}
          {pageItems.map(t => (
            <div key={t.id} className="border rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => toggleExpand(t.id)}
                  className={cn("size-7 rounded-lg border flex items-center justify-center shrink-0 hover:bg-muted/40 transition-colors",
                    expandedIds.has(t.id) && "bg-muted/40")}
                >
                  <IconChevronDown className={cn("size-3.5 transition-transform", expandedIds.has(t.id) && "rotate-180")} />
                </button>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold">{t.name}</span>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {[t.headline, t.cta, t.link ? (() => { try { return new URL(t.link).hostname } catch { return t.link } })() : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{formattedDate(t.createdAt)}</span>
                <Button size="sm" className="h-8 px-4 shrink-0" onClick={() => applyTemplate(t)}>Apply</Button>
                <div className="relative group">
                  <button className="text-muted-foreground hover:text-foreground p-1">
                    <IconSettings className="size-4" />
                  </button>
                  <div className="absolute right-0 top-full mt-1 bg-popover border rounded-lg shadow-lg z-50 hidden group-hover:block w-36">
                    <button onClick={() => openEdit(t)} className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2">
                      <IconPencil className="size-3.5" />Edit
                    </button>
                    <button onClick={() => deleteTemplate(t.id)} className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-accent flex items-center gap-2">
                      <IconTrash className="size-3.5" />Delete
                    </button>
                  </div>
                </div>
              </div>
              {expandedIds.has(t.id) && (
                <div className="border-t px-4 py-3 bg-muted/20 space-y-2">
                  {t.primaryText && (
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-0.5">Primary Text</span>
                      <p className="text-xs leading-relaxed whitespace-pre-wrap line-clamp-4">{t.primaryText}</p>
                    </div>
                  )}
                  {t.headline && (
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Headline</span>
                      <p className="text-xs">{t.headline}</p>
                    </div>
                  )}
                  {t.link && (
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Link</span>
                      <p className="text-xs text-muted-foreground truncate">{t.link}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-[120px_1fr] gap-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">CTA</span>
                    <p className="text-xs">{t.cta}</p>
                  </div>
                </div>
              )}
            </div>
          ))}

          {filtered.length === 0 && !search && templates.length === 0 && (
            <div className="text-center py-10 text-sm text-muted-foreground">
              <p className="font-medium mb-1">No templates yet</p>
              <p className="text-xs">Click "Create Ad Copy Template" to save your first one.</p>
            </div>
          )}
          {filtered.length === 0 && search && (
            <div className="text-center py-10 text-sm text-muted-foreground">No templates match "{search}"</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0 bg-background">
          <p className="text-xs text-muted-foreground">Viewing <span className="font-medium">{filtered.length}</span> Template{filtered.length !== 1 ? "s" : ""}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <IconChevronLeft className="size-3.5 mr-1" />Previous
            </Button>
            <span className="text-sm font-medium px-2">{page}</span>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next<IconChevronRight className="size-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* Create / Edit dialog */}
      <Dialog open={createOpen} onOpenChange={v => !v && setCreateOpen(false)}>
        <DialogContent className="max-w-lg max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
          <div className="px-5 py-4 border-b shrink-0">
            <DialogTitle className="text-sm font-bold">{editTarget ? "Edit Template" : "Create Ad Copy Template"}</DialogTitle>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Template Name <span className="text-destructive">*</span></label>
              <input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="e.g. Black Friday Sale 2025"
                className="w-full px-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Primary Text</label>
              <textarea
                value={formPrimaryText}
                onChange={e => setFormPrimaryText(e.target.value)}
                rows={5}
                placeholder="Write your primary ad text..."
                className="w-full px-3 py-2.5 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Headline</label>
              <input
                value={formHeadline}
                onChange={e => setFormHeadline(e.target.value)}
                placeholder="Enter headline..."
                className="w-full px-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Description (optional)</label>
              <input
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="Enter description..."
                className="w-full px-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Web Link (optional)</label>
                <input
                  type="url"
                  value={formLink}
                  onChange={e => setFormLink(e.target.value)}
                  placeholder="https://..."
                  aria-invalid={formLinkInvalid}
                  className={cn(
                    "w-full px-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring",
                    formLinkInvalid && "border-destructive focus:ring-destructive/20"
                  )}
                />
                {formLinkInvalid && (
                  <p className="text-xs text-destructive mt-1">Web link must start with https://</p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">CTA</label>
                <Select value={formCta} onValueChange={setFormCta}>
                  <SelectTrigger className="h-9 text-sm bg-muted/30"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CTA_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSaveTemplate} disabled={!formName.trim() || saving || formLinkInvalid}>
              {saving && <IconLoader2 className="size-3.5 mr-1.5 animate-spin" />}
              {editTarget ? "Save Changes" : "Create Template"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Load from Ad Set dialog */}
      <Dialog open={loadOpen} onOpenChange={v => !v && setLoadOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
          <div className="px-5 py-4 border-b shrink-0">
            <DialogTitle className="text-sm font-bold">Load from Ad Set</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Select an active ad to import its copy</p>
          </div>
          <div className="px-5 py-3 border-b shrink-0">
            <div className="relative">
              <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
              <input
                value={loadSearch}
                onChange={e => setLoadSearch(e.target.value)}
                placeholder="Search ads by name or copy..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {loadingAds && (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <IconLoader2 className="size-4 animate-spin" />
                <span className="text-sm">Loading active ads...</span>
              </div>
            )}
            {!loadingAds && filteredAds.length === 0 && (
              <div className="text-center py-10 text-sm text-muted-foreground">
                {loadSearch ? `No ads match "${loadSearch}"` : "No active ads with copy found in this account"}
              </div>
            )}
            {!loadingAds && filteredAds.map((ad: any) => (
              <div key={ad.id} className="border rounded-lg p-3 hover:bg-muted/20 transition-colors">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{ad.name}</p>
                    <p className="text-xs text-muted-foreground">{ad.effective_status}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => saveAdAsTemplate(ad)}>
                      <IconBookmark className="size-3" />Save
                    </Button>
                    <Button size="sm" className="h-7 text-xs" onClick={() => applyFromAd(ad)}>Apply</Button>
                  </div>
                </div>
                <div className="space-y-1">
                  {ad.primaryText && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{ad.primaryText}</p>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {ad.headline && <span className="text-xs font-medium">{ad.headline}</span>}
                    {ad.cta && <span className="text-xs text-muted-foreground">{ad.cta}</span>}
                    {ad.link && <span className="text-xs text-muted-foreground truncate max-w-[200px]">{(() => { try { return new URL(ad.link).hostname } catch { return ad.link } })()}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

// ─── Ad Setup Panel ───────────────────────────────────────────────────────────

// ─── Web Link + UTM + Display Link ────────────────────────────────────────────

const META_DYNAMIC_PARAMS = [
  { label: "Campaign Name",  value: "{{campaign.name}}" },
  { label: "Campaign ID",    value: "{{campaign.id}}" },
  { label: "Ad Set Name",    value: "{{adset.name}}" },
  { label: "Ad Set ID",      value: "{{adset.id}}" },
  { label: "Ad Name",        value: "{{ad.name}}" },
  { label: "Ad ID",          value: "{{ad.id}}" },
  { label: "Platform",       value: "{{site_source_name}}" },
  { label: "Placement",      value: "{{placement}}" },
]

const UTM_SUGGESTIONS = [
  {
    label: "Standard Facebook",
    value: "utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}",
  },
  {
    label: "Full tracking",
    value: "utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&utm_id={{ad.id}}",
  },
  {
    label: "Simple",
    value: "utm_source=facebook&utm_medium=cpc",
  },
]

function WebLinkSection({ webLink, setWebLink, utmParams, setUtmParams, displayLink, setDisplayLink, invalid }: {
  webLink: string; setWebLink: (v: string) => void
  utmParams: string; setUtmParams: (v: string) => void
  displayLink: string; setDisplayLink: (v: string) => void
  invalid?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [dynOpen, setDynOpen] = useState(false)
  const [utmSugOpen, setUtmSugOpen] = useState(false)
  const utmRef = useRef<HTMLInputElement>(null)

  const insertAtCursor = (text: string) => {
    const el = utmRef.current
    if (!el) { setUtmParams((utmParams ? utmParams + "&" : "") + text); return }
    const start = el.selectionStart ?? utmParams.length
    const end = el.selectionEnd ?? utmParams.length
    const next = utmParams.slice(0, start) + text + utmParams.slice(end)
    setUtmParams(next)
    setTimeout(() => { el.focus(); el.setSelectionRange(start + text.length, start + text.length) }, 0)
  }

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1.5">Web Link</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconWorld className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
          <input type="url" value={webLink} onChange={e => setWebLink(e.target.value)}
            placeholder="https://..."
            className={cn("w-full pl-8 pr-3 py-2.5 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50", invalid && "border-destructive")} />
        </div>
        <Button
          variant="outline" size="icon"
          className="size-9 shrink-0"
          onClick={() => setExpanded(v => !v)}
          title={expanded ? "Hide UTM & Display Link" : "Add UTM Parameters & Display Link"}
        >
          {expanded ? <IconMinus className="size-3.5" /> : <IconPlus className="size-3.5" />}
        </Button>
      </div>

      {expanded && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {/* UTM Parameters */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-primary">UTM Parameters</label>
              <div className="flex items-center gap-1">
                {/* Dynamic params */}
                <Popover open={dynOpen} onOpenChange={setDynOpen}>
                  <PopoverTrigger asChild>
                    <button className="text-xs px-1.5 py-0.5 border rounded font-mono text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors">
                      {"{ }"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-1" align="end">
                    <p className="text-xs text-muted-foreground px-2 py-1 font-medium">Meta Dynamic Params</p>
                    {META_DYNAMIC_PARAMS.map(p => (
                      <button key={p.value} onClick={() => { insertAtCursor(p.value); setDynOpen(false) }}
                        className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted rounded flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{p.label}</span>
                        <span className="font-mono text-xs text-primary truncate">{p.value}</span>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                {/* Suggestions */}
                <Popover open={utmSugOpen} onOpenChange={setUtmSugOpen}>
                  <PopoverTrigger asChild>
                    <button className="text-xs text-primary hover:underline">from suggest</button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-1" align="end">
                    <p className="text-xs text-muted-foreground px-2 py-1 font-medium">UTM Templates</p>
                    {UTM_SUGGESTIONS.map(s => (
                      <button key={s.label} onClick={() => { setUtmParams(s.value); setUtmSugOpen(false) }}
                        className="w-full text-left px-2 py-2 hover:bg-muted rounded">
                        <p className="text-xs font-medium mb-0.5">{s.label}</p>
                        <p className="text-xs text-muted-foreground font-mono break-all leading-tight">{s.value}</p>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <input
              ref={utmRef}
              type="text"
              value={utmParams}
              onChange={e => setUtmParams(e.target.value)}
              placeholder="utm_source=facebook&utm_medium=paid"
              className="w-full px-3 py-2 text-xs bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40 font-mono"
            />
            {utmParams && webLink && (
              <p className="text-xs text-muted-foreground/60 mt-1 truncate font-mono">
                → {webLink}{webLink.includes("?") ? "&" : "?"}{utmParams}
              </p>
            )}
          </div>

          {/* Display Link */}
          <div>
            <label className="text-xs font-medium text-primary block mb-1">Display Link</label>
            <input
              type="text"
              value={displayLink}
              onChange={e => setDisplayLink(e.target.value)}
              placeholder="e.g. wellnessnest.co/shop"
              className="w-full px-3 py-2 text-xs bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
            />
            <p className="text-xs text-muted-foreground/60 mt-1 leading-tight">
              Short URL shown in the ad (does not affect destination)
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

type AdSourceMode = "new_ad" | "post_id" | "creative_id"

function AdSetupPanel({
  primaryTexts, setPrimaryTexts,
  headlines, setHeadlines,
  descriptions, setDescriptions,
  cta, setCta,
  webLink, setWebLink,
  utmParams, setUtmParams,
  displayLink, setDisplayLink,
  launchAsActive, setLaunchAsActive,
  oneAdPerAdset, setOneAdPerAdset,
  adAccountId, adAccountName, orgName,
  selectedCreatives,
  adSourceMode, setAdSourceMode,
  adSourceIds, setAdSourceIds,
  validationErrors,
  onSettingsSaved,
}: {
  primaryTexts: string[]; setPrimaryTexts: (v: string[]) => void
  headlines: string[]; setHeadlines: (v: string[]) => void
  descriptions: string[]; setDescriptions: (v: string[]) => void
  cta: string; setCta: (v: string) => void
  webLink: string; setWebLink: (v: string) => void
  utmParams: string; setUtmParams: (v: string) => void
  displayLink: string; setDisplayLink: (v: string) => void
  launchAsActive: boolean; setLaunchAsActive: (v: boolean) => void
  // setOneAdPerAdset must also persist to `default_ad_settings_${adAccountId}` so it
  // stays in sync with the Settings modal — see the wrapper built in LaunchPageContent.
  oneAdPerAdset: boolean; setOneAdPerAdset: (v: boolean) => void
  adAccountId: string
  adAccountName: string
  orgName: string
  selectedCreatives: Creative[]
  adSourceMode: AdSourceMode
  setAdSourceMode: (v: AdSourceMode) => void
  adSourceIds: Record<string, string>
  setAdSourceIds: (v: Record<string, string>) => void
  validationErrors?: Record<string, boolean>
  onSettingsSaved?: (s: DefaultAdSettings) => void
}) {
  const [showDesc, setShowDesc] = useState(() => descriptions.some(d => d.trim()))
  useEffect(() => { if (descriptions.some(d => d.trim())) setShowDesc(true) }, [descriptions])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [copyTemplateOpen, setCopyTemplateOpen] = useState(false)
  const [showAiVariations, setShowAiVariations] = useState(false)
  const [aiVariations, setAiVariations] = useState<{ angle: string; text: string }[]>([])
  const [loadingAiVariations, setLoadingAiVariations] = useState(false)
  const [aiVariationsError, setAiVariationsError] = useState<string | null>(null)
  const [addedVariations, setAddedVariations] = useState<Set<number>>(new Set())

  // Generate from URL/Video state
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [genMode, setGenMode] = useState<"url" | "video">("url") // kept for compat, unused
  const [genUrl, setGenUrl] = useState("")
  const [genCreative, setGenCreative] = useState<Creative | null>(null)
  const [generatingCopy, setGeneratingCopy] = useState(false)
  const [generateCopyStep, setGenerateCopyStep] = useState("")
  const [generateCopyError, setGenerateCopyError] = useState<string | null>(null)

  const updateText = (idx: number, val: string) => {
    const next = [...primaryTexts]; next[idx] = val; setPrimaryTexts(next)
  }
  const addText = () => setPrimaryTexts([...primaryTexts, ""])
  const removeText = (idx: number) => setPrimaryTexts(primaryTexts.filter((_, i) => i !== idx))

  const handleOpenAiVariations = async (sourceOverride?: string) => {
    const sourceText = sourceOverride ?? primaryTexts[0]?.trim()
    setShowAiVariations(true)
    if (!sourceText) return
    setAiVariations([])
    setAiVariationsError(null)
    setAddedVariations(new Set())
    setLoadingAiVariations(true)
    try {
      const res = await fetch("/api/launch/ai-variations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sourceText, headline: headlines[0] }),
      })
      const data = await res.json()
      if (data.error) setAiVariationsError(data.error)
      else setAiVariations(data.variations || [])
    } catch {
      setAiVariationsError("Network error. Please try again.")
    } finally {
      setLoadingAiVariations(false)
    }
  }

  const handleAddVariation = (text: string, idx: number) => {
    setPrimaryTexts([...primaryTexts.filter(t => t.trim()), text])
    setAddedVariations(prev => new Set(prev).add(idx))
  }

  const handleReplaceWithVariation = (text: string, idx: number) => {
    const next = [...primaryTexts]; next[0] = text; setPrimaryTexts(next)
    setAddedVariations(prev => new Set(prev).add(idx))
  }

  const updateHeadline = (idx: number, val: string) => {
    const next = [...headlines]; next[idx] = val; setHeadlines(next)
  }
  const addHeadline = () => setHeadlines([...headlines, ""])
  const removeHeadline = (idx: number) => setHeadlines(headlines.filter((_, i) => i !== idx))

  const updateDescription = (idx: number, val: string) => {
    const next = [...descriptions]; next[idx] = val; setDescriptions(next)
  }
  const addDescription = () => setDescriptions([...descriptions, ""])
  const removeDescription = (idx: number) => setDescriptions(descriptions.filter((_, i) => i !== idx))

  const openGenerateModal = () => {
    setShowGenerateModal(true)
    setGenerateCopyError(null)
  }

  const handleGenerateCopy = async () => {
    const hasUrl = !!genUrl.trim()
    const hasVideo = !!genCreative
    if (!hasUrl && !hasVideo) { setGenerateCopyError("Enter a URL or select a video to generate"); return }
    setGeneratingCopy(true)
    setGenerateCopyError(null)
    try {
      let body: Record<string, string>
      if (hasUrl && hasVideo) {
        body = { type: "both", url: genUrl.trim(), videoUrl: genCreative!.file_url }
        setGenerateCopyStep("Analyzing URL & video...")
      } else if (hasUrl) {
        body = { type: "url", url: genUrl.trim() }
        setGenerateCopyStep("Fetching page...")
      } else {
        body = { type: "video", url: genCreative!.file_url }
        setGenerateCopyStep("Uploading video...")
      }
      const res = await fetch("/api/inspo/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      setGenerateCopyStep("Generating copy...")
      const data = await res.json()
      if (data.error) { setGenerateCopyError(data.error); return }
      const g = data.generated
      setPrimaryTexts(g.primary_texts.map((p: { text: string }) => p.text))
      setHeadlines(g.headlines)
      if (g.descriptions?.[0]) setDescriptions([g.descriptions[0]])
      if (g.cta) setCta(g.cta)
      if (hasUrl) setWebLink(genUrl.trim())
      setShowGenerateModal(false)
      setGenUrl("")
      setGenCreative(null)
    } catch { setGenerateCopyError("Network error. Please try again.") }
    finally { setGeneratingCopy(false); setGenerateCopyStep("") }
  }

  return (
    <div className="border rounded-xl bg-card">
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        adAccountId={adAccountId}
        adAccountName={adAccountName}
        orgName={orgName}
        onSettingsSaved={onSettingsSaved}
      />
      {/* AI Variations Modal */}
      <Dialog open={showAiVariations} onOpenChange={(open) => { setShowAiVariations(open); if (!open) { setAiVariations([]); setAiVariationsError(null) } }}>
        <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconSparkles className="size-4 text-primary" />
              AI Variations
            </DialogTitle>
          </DialogHeader>

          {/* No source text → ask user to enter text first */}
          {!primaryTexts[0]?.trim() && !loadingAiVariations && aiVariations.length === 0 && !aiVariationsError ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">Enter primary text for AI to generate 5 variations:</p>
              <textarea
                placeholder="Write your primary ad text..."
                rows={5}
                className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/50"
                onChange={e => { const next = [...primaryTexts]; next[0] = e.target.value; setPrimaryTexts(next) }}
              />
              <Button className="w-full gap-2" onClick={() => handleOpenAiVariations(primaryTexts[0]?.trim())}
                disabled={!primaryTexts[0]?.trim()}>
                <IconSparkles className="size-4" />Generate variations
              </Button>
            </div>
          ) : (
            <>
              {/* Source text preview */}
              {primaryTexts[0]?.trim() && (
                <div className="bg-muted/40 rounded-lg px-3 py-2 text-xs text-muted-foreground border shrink-0">
                  <span className="font-medium text-foreground">Source: </span>
                  {primaryTexts[0]?.slice(0, 120)}{(primaryTexts[0]?.length ?? 0) > 120 ? "…" : ""}
                </div>
              )}

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {loadingAiVariations ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <IconLoader2 className="size-7 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Generating variations...</p>
              </div>
            ) : aiVariationsError ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <IconAlertCircle className="size-7 text-destructive/50" />
                <p className="text-sm text-muted-foreground">{aiVariationsError}</p>
                <Button size="sm" variant="outline" onClick={() => handleOpenAiVariations()}>Try again</Button>
              </div>
            ) : (
              aiVariations.map((v, i) => (
                <div key={i} className="border rounded-xl p-3.5 space-y-2 bg-card">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      {v.angle}
                    </span>
                    {addedVariations.has(i) && (
                      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                        <IconCheck className="size-3" />Added
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed">{v.text}</p>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="text-xs gap-1.5 flex-1"
                      onClick={() => handleAddVariation(v.text, i)}>
                      <IconPlus className="size-3" />Add
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs gap-1.5 flex-1"
                      onClick={() => handleReplaceWithVariation(v.text, i)}>
                      <IconRefresh className="size-3" />Replace
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <LoadCopyModal
        open={copyTemplateOpen}
        onClose={() => setCopyTemplateOpen(false)}
        adAccountId={adAccountId}
        adAccountName={adAccountName}
        current={{
          primaryText: primaryTexts[0] || "",
          headline: headlines[0] || "",
          description: descriptions.find(d => d.trim()) || "",
          link: webLink,
          cta,
        }}
        onApply={t => {
          if (t.primaryText) setPrimaryTexts([t.primaryText])
          if (t.headline) setHeadlines([t.headline])
          if (t.description) setDescriptions([t.description])
          if (t.link) setWebLink(t.link)
          if (t.cta) setCta(t.cta)
        }}
      />

      {/* Generate Copy from URL/Video Modal */}
      <Dialog open={showGenerateModal} onOpenChange={(open) => { setShowGenerateModal(open); if (!open) { setGenerateCopyError(null) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconSparkles className="size-4 text-primary" />
              Generate Ad Copy with AI
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">AI will generate primary text, headline, description and CTA — auto-filling the fields below.</p>

          {/* Combined mode badge */}
          {genUrl.trim() && genCreative && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary font-medium w-fit">
              <IconSparkles className="size-3.5" />Combine URL + Video — best results
            </div>
          )}

          {/* URL input — always shown */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium flex items-center gap-1.5">
              <IconWorld className="size-3.5 text-muted-foreground" />
              Landing Page URL
              <span className="text-muted-foreground/50 font-normal">(optional)</span>
            </label>
            <input
              type="url"
              value={genUrl}
              onChange={e => { setGenUrl(e.target.value); setWebLink(e.target.value) }}
              placeholder="https://example.com/product"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/50"
              onKeyDown={e => e.key === "Enter" && handleGenerateCopy()}
            />
          </div>

          {/* Video picker — always shown */}
          {(() => {
            const sessionVideos = selectedCreatives.filter(c => c.media_type === "video")
            return (
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1.5">
                  <IconVideo className="size-3.5 text-muted-foreground" />
                  Video
                  <span className="text-muted-foreground/50 font-normal">(optional)</span>
                </label>
                {sessionVideos.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground border rounded-lg bg-muted/20">
                    No videos yet. Add a video to your ads first.
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 max-h-44 overflow-y-auto">
                    {sessionVideos.map(c => (
                      <button key={c.id} onClick={() => setGenCreative(genCreative?.id === c.id ? null : c)}
                        className={cn("relative rounded-lg overflow-hidden border-2 transition-all aspect-video bg-muted",
                          genCreative?.id === c.id ? "border-primary ring-1 ring-primary" : "border-transparent hover:border-muted-foreground/40"
                        )}>
                        <CreativeCardMedia creative={c} compact />
                        {genCreative?.id === c.id && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <IconCheck className="size-5 text-primary" />
                          </div>
                        )}
                        <p className="absolute bottom-0 left-0 right-0 text-xs truncate px-1 py-0.5 bg-black/50 text-white">{c.file_name}</p>
                      </button>
                    ))}
                  </div>
                )}
                {genCreative && (
                  <p className="text-xs text-muted-foreground">Selected: <strong className="text-foreground">{genCreative.file_name}</strong>
                    <button onClick={() => setGenCreative(null)} className="ml-2 text-destructive hover:underline">Deselect</button>
                  </p>
                )}
              </div>
            )
          })()}

          {generateCopyError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              <IconAlertCircle className="size-4 shrink-0" />{generateCopyError}
            </div>
          )}

          <Button className="w-full gap-2" onClick={handleGenerateCopy}
            disabled={generatingCopy || (!genUrl.trim() && !genCreative)}>
            {generatingCopy
              ? <><IconLoader2 className="size-4 animate-spin" />{generateCopyStep || "Generating..."}</>
              : <><IconSparkles className="size-4" />Generate & Fill Fields</>
            }
          </Button>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b overflow-x-auto">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-sm font-semibold whitespace-nowrap">Ad Setup</span>
          <span className="text-destructive text-xs font-bold">*</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tip text="Generate primary text, headline, and description with AI.">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-primary border-primary/30 hover:bg-primary/5" onClick={openGenerateModal}>
              <IconSparkles className="size-3" />AI Generate
            </Button>
          </Tip>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setSettingsOpen(true)}>
            <IconSettings className="size-3" />Settings<IconChevronDown className="size-3" />
          </Button>
          <Tip text="Load saved copy or previous ad text into this setup.">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setCopyTemplateOpen(true)}>
              <IconTextCaption className="size-3" />Load Copy
            </Button>
          </Tip>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Primary Texts */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Primary Text</label>
          {primaryTexts.map((text, idx) => (
            <div key={idx} className={cn("relative", idx > 0 && "mt-2")}>
              <textarea value={text}
                ref={el => {
                  if (el) {
                    el.style.height = "auto"
                    el.style.height = Math.min(el.scrollHeight, 140) + "px"
                  }
                }}
                onChange={e => {
                  updateText(idx, e.target.value)
                }}
                placeholder="Write your primary ad text..."
                rows={1}
                className="w-full px-3 py-2.5 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring resize-y placeholder:text-muted-foreground/50 pr-8 overflow-y-auto"
                style={{ height: "46px", minHeight: "46px", maxHeight: "140px" }}
              />
              {primaryTexts.length > 1 && (
                <button onClick={() => removeText(idx)}
                  className="absolute top-1.5 right-1.5 size-7 flex items-center justify-center rounded text-muted-foreground/40 hover:bg-muted/60 hover:text-destructive transition-colors">
                  <IconMinus className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-3 mt-1.5">
            <button onClick={addText} className="text-xs text-primary hover:underline flex items-center gap-0.5">
              <IconPlus className="size-3" />Add more primary texts
              {primaryTexts.length > 1 && <span className="ml-1 text-muted-foreground">({primaryTexts.length - 1} additional)</span>}
            </button>
            <span className="text-muted-foreground/40">|</span>
            <button
              className="text-xs text-primary hover:underline flex items-center gap-1"
              onClick={() => handleOpenAiVariations()}
            >
              <IconSparkles className="size-3" />
              AI Variations
            </button>
          </div>
        </div>

        {/* Headlines */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Headline</label>
          {headlines.map((h, idx) => (
            <div key={idx} className={cn("relative", idx > 0 && "mt-2")}>
              <input type="text" value={h} onChange={e => updateHeadline(idx, e.target.value)}
                placeholder="Enter headline..." maxLength={125}
                className="w-full px-3 py-2.5 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 pr-20" />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground/45">{h.length}/125</span>
                {headlines.length > 1 && (
                  <button onClick={() => removeHeadline(idx)} className="text-muted-foreground/40 hover:text-destructive transition-colors">
                    <IconMinus className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3 mt-1.5">
            <button onClick={addHeadline} className="text-xs text-primary hover:underline flex items-center gap-0.5">
              <IconPlus className="size-3" />Add more headlines
              {headlines.length > 1 && <span className="ml-1 text-muted-foreground">({headlines.length - 1} additional)</span>}
            </button>
          </div>
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <button onClick={() => setShowDesc(!showDesc)}
              className="text-xs text-primary hover:underline">
              {showDesc ? "— Hide description" : "+ Add description"}
            </button>
          </div>
          {showDesc && (
            <>
              {descriptions.map((d, idx) => (
                <div key={idx} className={cn("relative", idx > 0 && "mt-2")}>
                  <textarea value={d} onChange={e => updateDescription(idx, e.target.value)}
                    placeholder="Enter description (optional)..." rows={2}
                    className="w-full px-3 py-2.5 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/50 pr-8" />
                  {descriptions.length > 1 && (
                    <button onClick={() => removeDescription(idx)}
                      className="absolute top-1.5 right-1.5 size-7 flex items-center justify-center rounded text-muted-foreground/40 hover:bg-muted/60 hover:text-destructive transition-colors">
                      <IconMinus className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-3 mt-1.5">
                <button onClick={addDescription} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                  <IconPlus className="size-3" />Add more descriptions
                  {descriptions.length > 1 && <span className="ml-1 text-muted-foreground">({descriptions.length - 1} additional)</span>}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Web Link */}
        <WebLinkSection
          webLink={webLink} setWebLink={setWebLink}
          utmParams={utmParams} setUtmParams={setUtmParams}
          displayLink={displayLink} setDisplayLink={setDisplayLink}
          invalid={validationErrors?.webLink}
        />

        {/* CTA + Active toggle */}
        <div className="grid grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Call to Action</label>
            <Select value={cta} onValueChange={setCta}>
              <SelectTrigger className="h-9 w-full text-sm bg-muted/30"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CTA_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5 whitespace-nowrap overflow-hidden text-ellipsis">1 ad per adset (Special)</label>
            <button onClick={() => setOneAdPerAdset(!oneAdPerAdset)}
              className="h-9 w-full px-3 rounded-lg border bg-muted/30 flex items-center justify-between text-sm">
              <span className="font-medium text-muted-foreground">{oneAdPerAdset ? "On" : "Off"}</span>
              <span className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                oneAdPerAdset ? "bg-primary" : "bg-muted-foreground/30")}>
                <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                  oneAdPerAdset ? "translate-x-4" : "translate-x-0.5")} />
              </span>
            </button>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Launch ads as</label>
            <button onClick={() => setLaunchAsActive(!launchAsActive)}
              className="h-9 w-full px-3 rounded-lg border bg-muted/30 flex items-center justify-between text-sm">
              <span className="font-medium">{launchAsActive ? "Active" : "Paused"}</span>
              <span className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                launchAsActive ? "bg-primary" : "bg-muted-foreground/30")}>
                <span className={cn("inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                  launchAsActive ? "translate-x-4" : "translate-x-0.5")} />
              </span>
            </button>
          </div>
        </div>

        {/* Ad Source — shown when media is loaded */}
        {selectedCreatives.length > 0 && (() => {
          const resolvedCount = selectedCreatives.filter(c =>
            adSourceMode === "post_id"
              ? !!adSourceIds[c.id]
              : adSourceMode === "creative_id"
                ? !!adSourceIds[c.id]
                : !!(c.fb_video_id || c.fb_image_hash)
          ).length

          const AD_SOURCE_OPTIONS: { value: AdSourceMode; label: string; desc: string }[] = [
            { value: "post_id",     label: "Post ID",      desc: "Full copy · includes engagement" },
            { value: "creative_id", label: "Creative ID",  desc: "Creative only · no engagement"   },
            { value: "new_ad",      label: "New ad",       desc: "Launch fresh · no reused ID"     },
          ]

          return (
            <div className="border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20">
                <div className="flex items-center gap-1.5">
                  <IconStack2 className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">Ad Source</span>
                  <IconInfoCircle className="size-3 text-muted-foreground/50" title="How ads reference your creative on Meta" />
                  {adSourceMode === "new_ad"
                    ? <span className="text-xs text-green-600 font-medium">{resolvedCount}/{selectedCreatives.length} resolved</span>
                    : resolvedCount > 0
                      ? <span className="text-xs text-green-600 font-medium">{resolvedCount}/{selectedCreatives.length} resolved</span>
                      : <span className="text-xs text-amber-500 font-medium">0/{selectedCreatives.length} resolved</span>
                  }
                </div>
                <button
                  onClick={() => setAdSourceMode("new_ad")}
                  title="Reset to New ad"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <IconRefresh className="size-3.5" />
                </button>
              </div>

              {/* 3 options */}
              <div className="grid grid-cols-3 gap-1.5 p-2">
                {AD_SOURCE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setAdSourceMode(opt.value)}
                    className={cn(
                      "flex flex-col items-start px-2.5 py-2 rounded-lg border text-left transition-all",
                      adSourceMode === opt.value
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-muted-foreground/40"
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <div className={cn(
                        "size-3 rounded-full border-2 flex items-center justify-center shrink-0",
                        adSourceMode === opt.value ? "border-primary" : "border-muted-foreground/40"
                      )}>
                        {adSourceMode === opt.value && <div className="size-1.5 rounded-full bg-primary" />}
                      </div>
                      <span className="text-xs font-semibold leading-tight">{opt.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground leading-tight pl-[18px]">{opt.desc}</span>
                  </button>
                ))}
              </div>

              {/* Per-creative ID inputs (Post ID / Creative ID modes) */}
              {(adSourceMode === "post_id" || adSourceMode === "creative_id") && (
                <div className="px-2 pb-2 space-y-1.5">
                  {selectedCreatives.map(c => {
                    const val = adSourceIds[c.id] || ""
                    const isResolved = !!val
                    return (
                      <div key={c.id} className="flex items-center gap-2">
                        <div className="relative size-8 rounded overflow-hidden bg-muted shrink-0">
                          <CreativeCardMedia creative={c} compact className="w-full h-full object-cover" />
                          {isResolved && (
                            <div className="absolute inset-0 bg-green-500/20 flex items-end justify-end p-0.5">
                              <div className="size-3 rounded-full bg-green-500 flex items-center justify-center">
                                <IconCheck className="size-2 text-white" />
                              </div>
                            </div>
                          )}
                        </div>
                        <input
                          type="text"
                          value={val}
                          onChange={e => setAdSourceIds({ ...adSourceIds, [c.id]: e.target.value.trim() })}
                          placeholder={adSourceMode === "post_id" ? "Paste Post ID (e.g. 123_456)" : "Paste Creative ID"}
                          className="flex-1 px-2 py-1 text-xs bg-muted/30 border rounded-md outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                        />
                      </div>
                    )
                  })}
                  <p className="text-xs text-muted-foreground px-0.5">
                    {adSourceMode === "post_id"
                      ? "Find Post ID in Meta Ads Manager → Ad → Creative → Post ID"
                      : "Find Creative ID in Meta Ads Manager → Ad → Creative → Creative ID"}
                  </p>
                </div>
              )}

              {/* Thumbnails row for new_ad mode */}
              {adSourceMode === "new_ad" && (
                <div className="px-3 pb-3 flex gap-2 flex-wrap">
                  {selectedCreatives.map(c => {
                    const ready = c.status === "ready"
                    return (
                      <div key={c.id} className="relative" title={c.file_name}>
                        <div className="size-10 rounded overflow-hidden bg-muted border">
                          <CreativeCardMedia creative={c} compact className="w-full h-full object-cover" />
                        </div>
                        <div className={cn(
                          "absolute -bottom-1 -right-1 size-3.5 rounded-full border border-background flex items-center justify-center",
                          ready ? "bg-green-500" : "bg-amber-400"
                        )}>
                          {ready ? <IconCheck className="size-2 text-white" /> : <IconLoader2 className="size-2 text-white animate-spin" />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

      </div>
    </div>
  )
}

// ─── Gallery Media Panel ──────────────────────────────────────────────────────

// ─── Upload Dock (floating progress panel) ────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}
function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds < 1) return "—"
  if (seconds < 60) return `${Math.round(seconds)}s left`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s left`
}
function formatSpeed(bytesPerSec: number): string {
  if (!isFinite(bytesPerSec) || bytesPerSec < 1) return "—"
  return `${formatBytes(bytesPerSec)}/s`
}

function UploadDock({ uploads, onCancel, onClear, onClose }: {
  uploads: UploadItem[]
  onCancel: (id: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<"all" | "completed" | "cancelled">("all")

  const filtered = uploads.filter(u =>
    tab === "all" ? true : tab === "completed" ? u.status === "completed" : u.status === "cancelled"
  )
  const uploadingCount = uploads.filter(u => u.status === "uploading").length
  const totalEta = Math.max(...uploads.filter(u => u.status === "uploading").map(u => u.eta), 0)

  if (uploads.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-[380px] bg-popover border rounded-2xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-background">
        <button onClick={() => setCollapsed(c => !c)} className="flex items-center gap-1.5 text-sm font-semibold hover:opacity-70">
          Uploads
          <IconChevronUp className={cn("size-3.5 text-muted-foreground transition-transform", collapsed && "rotate-180")} />
        </button>
        <div className="flex items-center gap-1">
          {uploads.every(u => u.status !== "uploading") && (
            <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5">
              Clear
            </button>
          )}
          <button onClick={onClose} className="size-6 flex items-center justify-center rounded hover:bg-muted/60">
            <IconX className="size-3.5" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-2 px-3 pt-2 border-b">
            {([
              { key: "all" as const, label: "All uploads" },
              { key: "completed" as const, label: "Completed" },
              { key: "cancelled" as const, label: "Cancelled" },
            ]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={cn(
                  "px-3 py-1 text-xs rounded-full transition-colors mb-2",
                  tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
                )}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Status summary */}
          {uploadingCount > 0 && (
            <div className="px-4 py-2 text-xs text-muted-foreground border-b">
              {uploadingCount} uploading
              {totalEta > 0 && <span> · About {formatETA(totalEta)}</span>}
            </div>
          )}

          {/* Items */}
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">No items in this view</div>
            ) : filtered.map(u => {
              const pct = u.fileSize > 0 ? Math.min(100, (u.uploaded / u.fileSize) * 100) : 0
              const isDone = u.status === "completed"
              const isError = u.status === "error"
              const isCancelled = u.status === "cancelled"
              return (
                <div key={u.id} className="px-4 py-2.5 border-b last:border-b-0">
                  <div className="flex items-start gap-2">
                    <div className={cn(
                      "size-2 rounded-full shrink-0 mt-1.5",
                      isDone ? "bg-green-500" :
                      isError ? "bg-red-500" :
                      isCancelled ? "bg-gray-400" :
                      "bg-primary/100 animate-pulse"
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" title={u.filename}>{u.filename}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {u.fileTypeShort}
                        {" "}{formatBytes(u.uploaded)} / {formatBytes(u.fileSize)}
                        {u.status === "uploading" && (
                          <>
                            {" · "}{formatSpeed(u.speed)}
                            {" · "}{formatETA(u.eta)}
                          </>
                        )}
                        {isDone && " · Done"}
                        {isError && ` · ${u.error || "Error"}`}
                        {isCancelled && " · Cancelled"}
                      </p>
                      {!isDone && !isCancelled && !isError && (
                        <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary/100 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                    {u.status === "uploading" ? (
                      <button onClick={() => onCancel(u.id)} className="text-muted-foreground hover:text-destructive shrink-0" title="Cancel">
                        <IconX className="size-3.5" />
                      </button>
                    ) : isDone ? (
                      <IconCircleCheck className="size-3.5 text-green-500 shrink-0" />
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}


function GalleryMediaPanel({ selectedCreatives, onOpenModal, onDeselect, onRemoveAll, onUploadFiles, uploading, uploadProgress, adNameOverrides, onAdNameChange }: {
  selectedCreatives: Creative[]; onOpenModal: () => void
  onDeselect: (id: string) => void; onRemoveAll: () => void
  onUploadFiles: (files: FileList | File[]) => void
  uploading: boolean
  uploadProgress: { done: number; total: number; current: string }
  adNameOverrides: Record<string, string>
  onAdNameChange: (id: string, name: string) => void
}) {
  const [editingNameId, setEditingNameId] = useState<string>("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUploadFiles(e.target.files)
      e.target.value = ""
    }
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files: File[] = []
    if (e.dataTransfer.items) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i]
        if (item.kind === "file") {
          const f = item.getAsFile()
          if (f) files.push(f)
        }
      }
    } else {
      for (let i = 0; i < e.dataTransfer.files.length; i++) files.push(e.dataTransfer.files[i])
    }
    if (files.length > 0) onUploadFiles(files)
  }

  if (selectedCreatives.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-10">
        <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFileChange} />
        <input ref={folderInputRef} type="file" multiple className="hidden" onChange={handleFileChange} {...({ webkitdirectory: "", directory: "" } as any)} />

        {uploading ? (
          <>
            <IconLoader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Uploading {uploadProgress.done + 1}/{uploadProgress.total}...</p>
            <p className="text-xs text-muted-foreground truncate max-w-xs">{uploadProgress.current}</p>
          </>
        ) : (
          <>
            <div className="relative">
              <div className="size-14 rounded-2xl bg-background border flex items-center justify-center shadow-sm">
                <IconPhoto className="size-7 text-muted-foreground/30" />
              </div>
              <div className="absolute -bottom-1 -right-1 size-5 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                <span className="text-xs font-bold text-muted-foreground">0</span>
              </div>
            </div>
            <p className="text-sm font-medium text-foreground/70">No media assets selected</p>
            <Button onClick={onOpenModal} className="gap-2 px-6 rounded-full">
              <IconUpload className="size-4" />Load Media
              <span className="ml-0.5 text-primary-foreground/70">+</span>
            </Button>
            <p className="text-xs text-muted-foreground/60 max-w-[260px]">
              Select media from Media Library to add to ads.
            </p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 relative">
      <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFileChange} />
      <input ref={folderInputRef} type="file" multiple className="hidden" onChange={handleFileChange} {...({ webkitdirectory: "", directory: "" } as any)} />
      {uploading && (
        <div className="mb-2 px-3 py-2 bg-primary/10 border border-primary/30 rounded-lg flex items-center gap-2 text-xs">
          <IconLoader2 className="size-3.5 animate-spin text-primary" />
          <span className="font-medium">Uploading {uploadProgress.done + 1}/{uploadProgress.total}:</span>
          <span className="text-muted-foreground truncate flex-1">{uploadProgress.current}</span>
        </div>
      )}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-xs text-muted-foreground font-medium">{selectedCreatives.length} ad{selectedCreatives.length !== 1 ? "s" : ""}</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={onOpenModal}>
            <IconPlus className="size-3" />Add More
          </Button>
        </div>
      </div>
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
        style={{ maxWidth: "calc(5 * 160px + 4 * 12px)" }}
      >
        {selectedCreatives.map(c => {
          const thumb = proxyFbImage(c.media_type === "video" ? c.fb_thumbnail_url : (c.fb_image_url || c.file_url))
          const isReady = c.media_type === "video"
            ? !!c.fb_video_id && c.status !== "processing" && c.status !== "pending" && c.status !== "error"
            : !!c.fb_image_hash
          const isVideo = c.media_type === "video"
          const customName = adNameOverrides[c.id]
          const displayName = customName ?? c.file_name.replace(/\.[^/.]+$/, "")
          const duration = (c as any).duration as string | undefined
          const isEditing = editingNameId === c.id

          return (
            <div key={c.id} className="rounded-xl border bg-background shadow-sm overflow-hidden">
              {/* Media */}
              <div className="group relative aspect-[4/5] bg-muted overflow-hidden">
                {/* Red X always visible top-left */}
                <button
                  onClick={() => onDeselect(c.id)}
                  className="absolute top-2 left-2 z-1 size-5 rounded-md bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-md"
                  title="Remove from ads"
                >
                  <IconX className="size-3" />
                </button>

                <CreativeCardMedia creative={c} className="w-full h-full object-cover" />

                {/* Play button overlay (video only) — fades on hover */}
                {isVideo && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity group-hover:opacity-0">
                    <div className="size-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                      <IconPlayerPlay className="size-5 text-foreground translate-x-0.5" />
                    </div>
                  </div>
                )}

                {/* Duration badge bottom-left for video */}
                {isVideo && duration && (
                  <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/70 text-white text-xs font-bold rounded">
                    {duration}
                  </div>
                )}

                {/* Not ready badge */}
                {!isReady && (
                  <div className={cn(
                    "absolute bottom-2 right-2 flex items-center gap-1 text-xs text-white font-semibold px-1.5 py-0.5 rounded",
                    c.status === "error" ? "bg-red-500/90" : "bg-amber-500/90"
                  )}>
                    {(c.status === "pending" || c.status === "processing") && (
                      <IconLoader2 className="size-3 animate-spin" />
                    )}
                    {c.status === "error"
                      ? "Upload Failed"
                      : c.status === "pending"
                        ? "Uploading…"
                        : c.status === "processing"
                          ? "Processing…"
                          : "Not Uploaded"}
                  </div>
                )}
              </div>

              {/* Body — ad name */}
              <div className="p-2.5">
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-xs font-semibold text-foreground">Ad Name</span>
                  <button
                    onClick={() => setEditingNameId(c.id)}
                    className="text-muted-foreground hover:text-foreground"
                    title="Rename"
                  >
                    <IconPencil className="size-2.5" />
                  </button>
                </div>
                {isEditing ? (
                  <input
                    autoFocus
                    value={displayName}
                    onChange={e => onAdNameChange(c.id, e.target.value)}
                    onBlur={() => setEditingNameId("")}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditingNameId("") }}
                    className="w-full text-xs bg-muted/30 border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <p className="text-xs text-foreground/80 line-clamp-2 break-all" title={displayName}>{displayName}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Launch Result Modal ──────────────────────────────────────────────────────

function CopyBtn({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className={cn("text-muted-foreground hover:text-foreground shrink-0 transition-colors", copied && "text-green-600", className)}
      title="Copy"
    >
      {copied ? <IconCircleCheck className="size-3" /> : <IconCopy className="size-3" />}
    </button>
  )
}

function DetailItem({ label, value, copyable, mono }: { label: string; value: string; copyable?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="text-muted-foreground shrink-0 w-24 text-xs">{label}</span>
      <span className={cn("flex-1 text-foreground text-xs truncate", mono && "font-mono text-xs")} title={value}>{value}</span>
      {copyable && <CopyBtn value={value} />}
    </div>
  )
}

function AdResultRow({ index, ad, status, expanded, onToggle, launchMeta, batchId }: {
  index: number; ad: CreatedAd; status?: string; expanded: boolean; onToggle: () => void; launchMeta?: LaunchMeta; batchId?: string | null
}) {
  const displayName = ad.fileName?.replace(/\.[^/.]+$/, "") || ad.multiGroup || ad.flexibleAd || ad.carousel || `Ad ${index}`
  const metaUrl = batchId ? `/ads-manager?batch=${batchId}` : "/ads-manager"
  return (
    <>
      <tr className={cn("border-b last:border-0 hover:bg-muted/20 cursor-pointer select-none", expanded && "bg-muted/30")} onClick={onToggle}>
        <td className="px-2 text-muted-foreground w-8">
          <div className="flex items-center gap-0.5 text-xs">{expanded ? <IconChevronDown className="size-3" /> : <IconChevronRight className="size-3" />}{index}</div>
        </td>
        <td className="px-2 w-10">
          {ad.thumbnailUrl
            ? <img src={ad.thumbnailUrl} className="size-8 rounded object-cover" onError={e => e.currentTarget.style.display="none"} />
            : <div className="size-8 rounded bg-muted flex items-center justify-center">{ad.mediaType === "video" ? <IconVideo className="size-3 text-muted-foreground" /> : <IconPhoto className="size-3 text-muted-foreground" />}</div>}
        </td>
        <td className="px-2 text-xs font-medium max-w-[140px] truncate" title={displayName}>{displayName}</td>
        <td className="px-2 w-28">
          {status
            ? <span className={cn("px-1.5 py-0.5 rounded text-xs font-semibold uppercase", status === "ACTIVE" ? "bg-green-100 text-green-700" : status === "PAUSED" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500")}>{status}</span>
            : <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><IconCircleCheck className="size-3" />Success</span>}
        </td>
        <td className="px-2 w-40">
          <div className="flex items-center gap-1">
            <span className="font-mono text-xs text-muted-foreground">{ad.adId.slice(0, 15)}…</span>
            <CopyBtn value={ad.adId} />
            <a href={metaUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-primary hover:text-primary"><IconExternalLink className="size-3" /></a>
          </div>
        </td>
        <td className="px-2 text-xs text-muted-foreground truncate max-w-[120px]" title={ad.adSetName}>{ad.adSetName}</td>
      </tr>
      {expanded && (
        <tr className="bg-muted/10 border-b">
          <td colSpan={6} className="px-5">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              {launchMeta?.adAccountName && <DetailItem label="Account" value={launchMeta.adAccountName} />}
              <DetailItem label="Ad Set" value={ad.adSetName} />
              {launchMeta?.cta && <DetailItem label="CTA" value={launchMeta.cta} />}
              {launchMeta?.webLink && <DetailItem label="Web Link" value={launchMeta.webLink} copyable />}
              <DetailItem label="Ad ID" value={ad.adId} copyable mono />
              {ad.thumbnailUrl && <DetailItem label="Media URL" value={ad.thumbnailUrl} copyable />}
              {launchMeta?.pageId && <DetailItem label="Page" value={launchMeta.pageName || launchMeta.pageId} />}
              {launchMeta?.headline && <DetailItem label="Headline" value={launchMeta.headline} />}
              {launchMeta?.primaryText && <DetailItem label="Primary Text" value={launchMeta.primaryText} />}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function LaunchResultModal({ result, onClose }: { result: LaunchResult; onClose: () => void }) {
  const [tab, setTab] = useState<"launched" | "performance">("launched")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [adStatuses, setAdStatuses] = useState<Record<string, string>>({})
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [insights, setInsights] = useState<any[]>([])
  const [loadingInsights, setLoadingInsights] = useState(false)
  const [datePreset, setDatePreset] = useState("last_30d")
  const [fetchMs, setFetchMs] = useState<number | null>(null)
  const [batchCopied, setBatchCopied] = useState(false)

  const isSuccess = result.failed === 0 && !result.scheduleError && !result.auditError
  const isPartial = result.created > 0 && (result.failed > 0 || Boolean(result.scheduleError) || Boolean(result.auditError))
  const batchShort = result.batchId
    ? result.batchId.replace(/-/g, "").slice(-6).toUpperCase()
    : Math.floor(Math.random() * 900000 + 100000).toString()

  const adIds = result.createdAds.map(a => a.adId).filter(Boolean)
  const hasAdIds = adIds.length > 0

  const loadStatus = async () => {
    if (!hasAdIds || !result.launchMeta?.adAccountId) return
    setLoadingStatus(true)
    try {
      const res = await fetch("/api/facebook/ads-insights", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adAccountId: result.launchMeta.adAccountId, adIds, statusOnly: true }),
      })
      const data = await res.json()
      const map: Record<string, string> = {}
      for (const r of data.insights || []) map[r.adId] = r.effectiveStatus
      setAdStatuses(map)
    } finally { setLoadingStatus(false) }
  }

  useEffect(() => {
    if (!hasAdIds || !result.launchMeta?.adAccountId) return
    loadStatus()
    const interval = setInterval(loadStatus, 5000)
    const timeout = setTimeout(() => clearInterval(interval), 60_000)
    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.batchId])

  const loadInsights = async () => {
    if (!hasAdIds || !result.launchMeta?.adAccountId) return
    setLoadingInsights(true)
    const t = Date.now()
    try {
      const res = await fetch("/api/facebook/ads-insights", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adAccountId: result.launchMeta.adAccountId, adIds, datePreset }),
      })
      const data = await res.json()
      setInsights(data.insights || [])
      setFetchMs(Date.now() - t)
    } finally { setLoadingInsights(false) }
  }

  useEffect(() => { if (tab === "performance") loadInsights() }, [tab, datePreset])

  const totals = useMemo(() => {
    let spend = 0, impressions = 0, clicks = 0, reach = 0, actions = 0
    for (const r of insights) { spend += r.spend; impressions += r.impressions; clicks += r.clicks; reach += r.reach; actions += r.actions }
    return { spend, impressions, clicks, reach, actions, costPerAction: actions > 0 ? spend / actions : 0 }
  }, [insights])

  const actId = result.launchMeta?.adAccountId?.replace("act_", "") || ""

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden [&>button:last-of-type]:hidden">
        <DialogTitle className="sr-only">Launch Result</DialogTitle>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b shrink-0">
          <div className={cn("size-8 rounded-full flex items-center justify-center shrink-0", isSuccess ? "bg-green-100" : isPartial ? "bg-amber-100" : "bg-red-100")}>
            {isSuccess ? <IconCircleCheck className="size-5 text-green-600" /> : isPartial ? <IconAlertTriangle className="size-5 text-amber-600" /> : <IconAlertCircle className="size-5 text-red-600" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold">{result.scheduled ? "Ads Scheduled" : "Launch completed"}</h2>
              <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", isSuccess ? "bg-green-100 text-green-700" : isPartial ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
                ● {result.created} of {result.created + result.failed} succeeded
              </span>
              <button
                className={cn("flex items-center gap-1 text-xs border rounded px-2 py-0.5 hover:bg-muted font-mono transition-colors", batchCopied && "text-green-600 border-green-300")}
                onClick={() => { navigator.clipboard.writeText(result.batchId || batchShort); setBatchCopied(true); setTimeout(() => setBatchCopied(false), 1500) }}
              >
                BATCH #{batchShort}{batchCopied ? <IconCircleCheck className="size-3 ml-0.5" /> : <IconCopy className="size-3 ml-0.5" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {result.launchMeta?.timestamp && new Date(result.launchMeta.timestamp).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}
              {result.launchMeta?.adAccountName && ` · ${result.launchMeta.adAccountName}`}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 ml-2"><IconX className="size-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-5 shrink-0">
          {(["launched", "performance"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn("pb-2 pt-2.5 px-1 mr-5 text-sm font-medium border-b-2 transition-colors capitalize", tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t === "launched" ? "Launched" : "Performance"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Launched tab ── */}
          {tab === "launched" && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <IconBrandMeta className="size-4 text-[#1877F2]" />
                  Meta Ads ({result.created} succeeded)
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={loadStatus} disabled={loadingStatus || !hasAdIds} title={!hasAdIds ? "No ad IDs — launch again to enable" : undefined}>
                    {loadingStatus ? <IconLoader2 className="size-3 animate-spin" /> : <IconRefresh className="size-3" />}Load Status
                  </Button>
                </div>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table data-table="compact" className="w-full">
                  <thead className="bg-muted/50 border-b">
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-left px-2 w-8">#</th>
                      <th className="text-left px-2 w-10">Thumb</th>
                      <th className="text-left px-3">Name</th>
                      <th className="text-left px-3 w-28">Status</th>
                      <th className="text-left px-3 w-40">Ad ID</th>
                      <th className="text-left px-3 w-32">Ad Set</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.createdAds.map((ad, i) => {
                      const rowKey = ad.adId || `row-${i}`
                      return (
                        <AdResultRow key={rowKey} index={i + 1} ad={ad}
                          status={adStatuses[ad.adId]}
                          expanded={expandedId === rowKey}
                          onToggle={() => setExpandedId(p => p === rowKey ? null : rowKey)}
                          launchMeta={result.launchMeta}
                          batchId={result.batchId} />
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {result.errors.length > 0 && (
                <div className="mt-3 space-y-1">
                  {result.errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded px-3 py-1.5">
                      <IconAlertCircle className="size-3 shrink-0 mt-0.5" />
                      <span className="font-medium truncate">{e.fileName}:</span>
                      <span className="text-muted-foreground">{e.error}</span>
                    </div>
                  ))}
                </div>
              )}
              {result.scheduled && (
                <div className="mt-3 text-xs text-primary bg-primary/10 dark:bg-primary/20 rounded px-3 py-2 flex items-center gap-2">
                  <IconClock className="size-3.5 shrink-0" />
                  Activates: {new Date(result.scheduled.at).toLocaleString()}
                  {result.scheduled.end && ` · Ends: ${new Date(result.scheduled.end).toLocaleString()}`}
                </div>
              )}
              {result.scheduleError && (
                <div className="mt-3 text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 rounded px-3 py-2 flex items-start gap-2">
                  <IconAlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                  <span>{result.scheduleError} Review these PAUSED ads in Meta Ads Manager; they will not activate automatically.</span>
                </div>
              )}
              {result.auditError && (
                <div className="mt-3 text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 rounded px-3 py-2 flex items-start gap-2">
                  <IconAlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                  <span>{result.auditError} Do not retry blindly; inspect Meta Ads Manager first to avoid duplicate ads.</span>
                </div>
              )}
            </div>
          )}

          {/* ── Performance tab ── */}
          {tab === "performance" && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <IconTrendingUp className="size-4" />
                  Performance
                  {insights.length > 0 && <span className="text-muted-foreground font-normal text-xs">({insights.filter((r: any) => r.spend > 0).length}/{result.createdAds.length} ads with data)</span>}
                  {fetchMs && <span className="text-muted-foreground font-normal text-xs">{(fetchMs / 1000).toFixed(1)}s</span>}
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <Select value={datePreset} onValueChange={setDatePreset}>
                    <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="last_7d">Last 7 days</SelectItem>
                      <SelectItem value="last_30d">Last 30 days</SelectItem>
                      <SelectItem value="this_month">This month</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={loadInsights} disabled={loadingInsights}>
                    {loadingInsights ? <IconLoader2 className="size-3 animate-spin" /> : <IconRefresh className="size-3" />}Refresh
                  </Button>
                </div>
              </div>

              {insights.length > 0 && (
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {[
                    { label: "Total Spend", value: `$${totals.spend.toFixed(2)}`, icon: IconCurrencyDollar },
                    { label: "Avg Cost/Action", value: totals.actions > 0 ? `$${totals.costPerAction.toFixed(2)}` : "—", icon: IconTrendingUp },
                    { label: "Impressions", value: totals.impressions.toLocaleString(), icon: IconEye },
                    { label: "Clicks", value: totals.clicks.toLocaleString(), icon: IconTarget },
                    { label: "Reach", value: totals.reach.toLocaleString(), icon: IconUsers },
                  ].map(m => (
                    <div key={m.label} className="bg-muted/30 rounded-lg px-3 py-2.5">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1"><m.icon className="size-3" />{m.label}</div>
                      <p className="text-base font-semibold">{m.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {loadingInsights ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
                  <IconLoader2 className="size-4 animate-spin" />Loading insights…
                </div>
              ) : insights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
                  <IconTrendingUp className="size-8 opacity-20" />
                  No performance data yet. Ads need to run first.
                </div>
              ) : (
                <div className="border rounded-lg overflow-x-auto">
                  <table data-table="compact" className="w-full text-xs">
                    <thead className="bg-muted/50 border-b text-muted-foreground">
                      <tr>
                        <th className="text-left px-2 w-8">#</th>
                        <th className="text-left px-2 w-10">Thumb</th>
                        <th className="text-left px-3">Ad Name</th>
                        <th className="text-left px-3 w-24">Status</th>
                        <th className="text-right px-3 w-20">Spend</th>
                        <th className="text-right px-3 w-20">Cost/Act.</th>
                        <th className="text-right px-3 w-16">Actions</th>
                        <th className="text-right px-3 w-16">CTR</th>
                        <th className="text-right px-3 w-16">Impr.</th>
                        <th className="text-right px-3 w-16">Clicks</th>
                        <th className="text-right px-3 w-16">CPC</th>
                        <th className="text-right px-3 w-16">CPM</th>
                        <th className="text-right px-3 w-16">Reach</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insights.map((row: any, i: number) => {
                        const createdAd = result.createdAds.find(a => a.adId === row.adId)
                        const ctrGood = row.ctr >= 3, ctrBad = row.ctr < 2 && row.impressions > 100
                        return (
                          <tr key={row.adId} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="px-3 text-muted-foreground">{i + 1}</td>
                            <td className="px-2">
                              {createdAd?.thumbnailUrl
                                ? <img src={createdAd.thumbnailUrl} className="size-8 rounded object-cover" onError={e => e.currentTarget.style.display="none"} />
                                : <div className="size-8 rounded bg-muted" />}
                            </td>
                            <td className="px-3 font-medium max-w-[140px] truncate" title={row.name}>{row.name}</td>
                            <td className="px-3">
                              <span className={cn("px-1.5 py-0.5 rounded text-xs font-semibold uppercase", row.effectiveStatus === "ACTIVE" ? "bg-green-100 text-green-700" : row.effectiveStatus === "PAUSED" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500")}>{row.effectiveStatus}</span>
                            </td>
                            <td className="px-3 text-right">${row.spend.toFixed(2)}</td>
                            <td className="px-3 text-right">{row.costPerAction > 0 ? `$${row.costPerAction.toFixed(2)}` : "—"}</td>
                            <td className="px-3 text-right">{row.actions || 0}</td>
                            <td className={cn("px-2 text-right font-medium", ctrGood ? "text-green-600 bg-green-50 dark:bg-green-900/20" : ctrBad ? "text-red-600 bg-red-50 dark:bg-red-900/20" : "")}>
                              {row.impressions > 0 ? `${row.ctr.toFixed(2)}%` : "—"}
                            </td>
                            <td className="px-3 text-right">{row.impressions.toLocaleString()}</td>
                            <td className="px-3 text-right">{row.clicks}</td>
                            <td className="px-3 text-right">{row.cpc > 0 ? `$${row.cpc.toFixed(2)}` : "—"}</td>
                            <td className={cn("px-2 text-right", row.cpm > 80 ? "text-red-500" : row.cpm > 0 && row.cpm < 40 ? "text-green-600" : "")}>{row.cpm > 0 ? `$${row.cpm.toFixed(2)}` : "—"}</td>
                            <td className="px-3 text-right">{row.reach.toLocaleString()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <IconClock className="size-3.5" />Completed in {formatDuration(result.durationMs)}
          </div>
          <div className="flex gap-2">
            <a href={`/ads-manager?batch=${result.batchId || ""}`}>
              <Button size="sm" className="text-xs gap-1.5 bg-[#1877F2] hover:bg-[#1877F2]/90">
                View Ads Manager<IconBrandMeta className="size-3.5" />
              </Button>
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Creative Thumbs Stack ────────────────────────────────────────────────────

function ThumbStack({ thumbs, count }: { thumbs: string[]; count: number }) {
  const shown = thumbs.slice(0, 2)
  const extra = count - shown.length

  return (
    <div className="flex items-center -space-x-2">
      {shown.map((url, i) => (
        <div key={i} className="size-9 rounded-lg overflow-hidden border-2 border-background bg-muted shrink-0"
          style={{ zIndex: shown.length - i }}>
          <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
        </div>
      ))}
      {extra > 0 && (
        <div className="size-9 rounded-lg border-2 border-background bg-muted flex items-center justify-center shrink-0">
          <span className="text-xs font-semibold text-muted-foreground">+{extra}</span>
        </div>
      )}
      {shown.length === 0 && (
        <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
          <IconPhoto className="size-4 text-muted-foreground/40" />
        </div>
      )}
    </div>
  )
}

// ─── User Avatar ──────────────────────────────────────────────────────────────

function UserAvatar({ name, url }: { name: string; url?: string | null }) {
  const initials = name ? name.slice(0, 1).toUpperCase() : "?"
  const colors = ["bg-teal-500", "bg-primary/100", "bg-purple-500", "bg-orange-500", "bg-pink-500"]
  const colorClass = name ? colors[name.charCodeAt(0) % colors.length] : "bg-muted"

  return (
    <Avatar size="sm">
      {url && <AvatarImage src={url} alt={name} />}
      <AvatarFallback className={cn("text-white font-bold", colorClass)}>{initials}</AvatarFallback>
    </Avatar>
  )
}

// ─── Batch Detail Modal ────────────────────────────────────────────────────────

function BatchDetailModal({ batch, open, onClose, onRelaunch }: {
  batch: LaunchBatch | null
  open: boolean
  onClose: () => void
  onRelaunch: (b: LaunchBatch) => void
}) {
  if (!batch) return null
  const ctaLabel = CTA_OPTIONS.find(o => o.value === batch.cta)?.label || batch.cta || "—"

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b">
          <DialogTitle className="text-base font-semibold">Launch Details</DialogTitle>
          <span className={cn("text-xs px-2 py-0.5 rounded-full font-semibold",
            batch.status === "success" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
            batch.status === "partial" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
            "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400")}>
            {batch.status === "success" ? "Success" : batch.status === "partial" ? "Partial" : "Failed"}
          </span>
          <span className="text-xs text-muted-foreground ml-auto">{new Date(batch.created_at).toLocaleString()} · {batch.user_name}</span>
        </div>

        <div className="overflow-y-auto max-h-[70vh] p-5 space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Ads Created", value: batch.total_ads, color: "text-foreground" },
              { label: "Failed", value: batch.failed_ads, color: batch.failed_ads > 0 ? "text-red-500" : "text-muted-foreground" },
              { label: "Ad Sets", value: batch.adset_ids?.length || 0, color: "text-foreground" },
              { label: "Creatives", value: batch.creative_ids?.length || 0, color: "text-foreground" },
            ].map(s => (
              <div key={s.label} className="text-center bg-muted/30 rounded-xl py-3">
                <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Creatives */}
          {batch.creative_thumbs?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Creatives</p>
              <div className="flex gap-2 flex-wrap">
                {batch.creative_thumbs.map((thumb, i) => (
                  <div key={i} className="size-16 rounded-lg overflow-hidden bg-muted border shrink-0">
                    {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" onError={e => e.currentTarget.style.display="none"} /> :
                      <div className="w-full h-full flex items-center justify-center"><IconVideo className="size-4 text-muted-foreground/40" /></div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ad copy */}
          <div className="grid grid-cols-2 gap-4">
            {batch.primary_text && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Primary Text</p>
                <p className="text-sm bg-muted/30 rounded-lg p-3 leading-relaxed border">{batch.primary_text}</p>
              </div>
            )}
            <div className="space-y-3">
              {batch.headline && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Headline</p>
                  <p className="text-sm font-medium">{batch.headline}</p>
                </div>
              )}
              <div className="flex gap-4">
                {batch.cta && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">CTA</p>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted font-medium">{ctaLabel}</span>
                  </div>
                )}
                {batch.duration_ms && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Duration</p>
                    <p className="text-xs font-medium">{formatDuration(batch.duration_ms)}</p>
                  </div>
                )}
              </div>
              {batch.web_link && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Destination URL</p>
                  <a href={batch.web_link} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline break-all">{batch.web_link}</a>
                </div>
              )}
            </div>
          </div>

          {/* Ad Sets */}
          {batch.adset_names?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Ad Sets Targeted</p>
              <div className="flex flex-wrap gap-1.5">
                {batch.adset_names.map((name, i) => (
                  <a
                    key={i}
                    href={`/ads-manager?batch=${batch.id}`}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 bg-primary/10 dark:bg-primary/20 text-primary/90 dark:text-primary rounded-md hover:bg-blue-100 border border-primary/20 dark:border-primary/20 transition-colors"
                  >
                    {name}<IconExternalLink className="size-3" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Errors */}
          {batch.errors?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">Errors ({batch.errors.length})</p>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {batch.errors.map((err: any, i: number) => (
                  <div key={i} className="text-xs bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-lg px-3 py-2">
                    <span className="font-semibold text-red-700 dark:text-red-400">{err.fileName || err.adSetId}</span>
                    <span className="text-red-600 dark:text-red-400/80"> — {err.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t bg-muted/10">
          <a
            href={`/ads-manager?batch=${batch.id}`}
          >
            <Button variant="outline" size="sm" className="gap-1.5">
              <IconBrandMeta className="size-3.5 text-[#1877F2]" />
              View Ads Manager
            </Button>
          </a>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
            <Button size="sm" className="gap-1.5" onClick={() => { onRelaunch(batch); onClose() }}>
              <IconRocket className="size-3.5" />Re-launch
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Launch History Section ───────────────────────────────────────────────────

interface DraftRecord { id: string; name: string; ad_account_id: string; ad_account_name: string; row_count: number; creative_thumbs: string[]; user_name: string; created_at: string }

/**
 * The full setup state a draft restores, stored in `launch_drafts.data.snapshot`.
 *
 * Every field is optional on read because drafts written before this shape existed have no
 * `snapshot` at all, and a future field must not make an older draft unreadable. `version`
 * exists so a later shape change can migrate rather than guess.
 *
 * Ad sets and creatives are stored as ids and re-resolved on load — the copy of an ad set or
 * a creative that a draft was saved with may be stale or gone by the time it is reopened.
 */
interface DraftSnapshot {
  version: 1
  mode?: "gallery" | "table"
  adAccountId?: string | null
  pageId?: string
  igPageId?: string
  // Stored whole rather than as ids: the launch payload only ever sends adSetIds, so a
  // stale name or status here is cosmetic, and re-resolving would mean waiting on the
  // per-account ad set fetch before the draft could finish restoring.
  adSets?: AdSet[]
  primaryTexts?: string[]
  headlines?: string[]
  descriptions?: string[]
  cta?: string
  webLink?: string
  utmParams?: string
  displayLink?: string
  launchAsActive?: boolean
  adSourceMode?: AdSourceMode
  adSourceIds?: Record<string, string>
  selectedCreativeIds?: string[]
  adNameOverrides?: Record<string, string>
  tableViewMode?: "single" | "stacked" | "grid" | "side-by-side"
  adFormat?: AdFormatState
  partnership?: PartnershipState
  multilanguage?: MultilanguageState
  collectionAds?: CollectionAdsState
  catalogAds?: CatalogAdsState
  carouselAds?: CarouselAdsState
  flexibleAds?: FlexibleAdsState
  multiPlacementAds?: MultiPlacementAdsState
}

/**
 * Column templates for the launch-history and drafts lists.
 *
 * Both are CSS grids rather than table elements, so their columns come from a `gridTemplateColumns`
 * string instead of from widths on cells. Each string was written inline twice — once on the
 * header, once on the row — so an edit to one silently misaligned it from the other. One
 * definition per list, consumed by both.
 *
 * The launch template is also rebalanced. It gave DATE `1.4fr`, the largest flexible share in the
 * row, to a short fixed-length date string, while ACCOUNT and the ad-set names — the two columns
 * that actually hold long text — were squeezed into `1.2fr` and `1fr` and truncated. That is the
 * wide empty gap sitting next to clipped names in the report. ACCOUNT is fixed-width now — account
 * names are uniformly short, so flexing that column only ever produced dead space after the text.
 * The ad-set names column keeps the row's sole flexible share: names genuinely vary in length, so
 * it is the one column where growing to fill the leftover width shows more real content instead of
 * leaving it empty.
 */
const HISTORY_COLS = "150px minmax(360px,1fr) 150px 56px 70px 120px 150px 90px 96px 100px"
const historyGrid = (withCheckbox: boolean) => ({
  gridTemplateColumns: withCheckbox ? `30px ${HISTORY_COLS}` : HISTORY_COLS,
  columnGap: "12px",
})
const DRAFT_COLS = "120px 1fr 140px 70px 120px 90px 100px"

function LaunchHistorySection({ reloadTrigger, onRelaunch, onLoadDraft, tabOverride, pages = [] }: {
  reloadTrigger: number
  onRelaunch: (b: LaunchBatch) => void
  onLoadDraft?: (draftId: string) => void
  tabOverride?: "launches" | "drafts" | "scheduled" | "deleted" | null
  pages?: any[]
}) {
  const [tab, setTab] = useState<"launches" | "drafts" | "scheduled" | "deleted">("launches")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState(false)
  const [batches, setBatches] = useState<LaunchBatch[]>([])
  const [scheduledActivations, setScheduledActivations] = useState<ScheduledActivation[]>([])
  const [drafts, setDrafts] = useState<DraftRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [draftSearch, setDraftSearch] = useState("")
  const [loadingDraftId, setLoadingDraftId] = useState<string | null>(null)
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [resultModal, setResultModal] = useState<LaunchResult | null>(null)
  const [displayCount, setDisplayCount] = useState(10)

  useEffect(() => { if (tabOverride) setTab(tabOverride) }, [tabOverride])
  useEffect(() => {
    setSelectedIds(new Set())
    setStatusFilter("all")
  }, [tab])

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (tab === "deleted") params.set("trash", "1")
    if (tab === "scheduled") params.set("scheduled", "1")
    fetch(`/api/launch-history?${params}`)
      .then(r => r.json())
      .then(d => {
        if (tab === "scheduled") setScheduledActivations(d.activations || [])
        else setBatches(d.batches || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [statusFilter, tab])

  useLaunchBatchesRealtime(load)

  const loadDrafts = useCallback(() => {
    setDraftsLoading(true)
    fetch("/api/launch-drafts")
      .then(r => r.json())
      .then(d => setDrafts(d.drafts || []))
      .catch(() => {})
      .finally(() => setDraftsLoading(false))
  }, [])

  const deleteDraft = async (id: string) => {
    setDeletingDraftId(id)
    const res = await fetch(`/api/launch-drafts?id=${id}`, { method: "DELETE" })
    if (res.ok) setDrafts(s => s.filter(d => d.id !== id))
    else alert((await res.json().catch(() => ({}))).error || "Failed to delete draft")
    setDeletingDraftId(null)
  }

  const handleBulkAction = async (action: "trash" | "restore" | "permanent") => {
    if (selectedIds.size === 0) return
    if (action === "permanent" && !confirm("Permanently delete " + selectedIds.size + " records?")) return
    
    setActionLoading(true)
    try {
      const ids = Array.from(selectedIds)
      const method = action === "permanent" ? "DELETE" : "PATCH"
      const body = action === "permanent" ? { ids } : { ids, action }

      const res = await fetch("/api/launch-history", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })

      if (res.ok) {
        setSelectedIds(new Set())
        load()
      } else {
        const errorData = await res.json().catch(() => ({}))
        alert(`Failed to ${action} records: ${errorData.error || res.statusText}`)
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`)
    }
    setActionLoading(false)
  }

  const doLoadDraft = async (id: string) => {
    setLoadingDraftId(id)
    await onLoadDraft?.(id)
    setLoadingDraftId(null)
  }

  useEffect(() => { load() }, [load, reloadTrigger, tab])
  useEffect(() => { if (tab === "drafts") loadDrafts() }, [tab, loadDrafts, reloadTrigger])
  useEffect(() => { setDisplayCount(10) }, [search, statusFilter])

  const filtered = batches.filter(b => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      b.adset_names?.some(n => n.toLowerCase().includes(q)) ||
      b.ad_account_name?.toLowerCase().includes(q) ||
      b.user_name?.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q) ||
      b.created_ads?.some(ad => ad.fileName?.toLowerCase().includes(q))
    )
  })
  const filteredScheduled = scheduledActivations.filter(item => {
    if (!search) return true
    const q = search.toLowerCase()
    return item.ad_account_id.toLowerCase().includes(q) || item.ad_ids.some(id => id.toLowerCase().includes(q))
  })

  // Labels name the record's state, not the surface — "Launched" is a thing that happened to
  // a batch, the same way "Draft" and "Scheduled" are. The keys are separate on purpose: they
  // are the `tabOverride` discriminant the launcher passes in (see setHistoryTabOverride) and
  // drive the `trash=1` query param, so renaming a key is a behaviour change, not a copy edit.
  const TABS = [
    { key: "launches" as const, label: "Launched", Icon: IconClock },
    { key: "drafts" as const, label: "Draft", Icon: IconPencil },
    { key: "scheduled" as const, label: "Scheduled", Icon: IconCalendar },
    { key: "deleted" as const, label: "Trash", Icon: IconTrash },
  ]

  const openDetails = (b: LaunchBatch) => {
    // For old batches without per-ad data, synthesise CreatedAd[] from thumbs × adsets
    const createdAds: CreatedAd[] = b.created_ads?.length
      ? b.created_ads
      : (b.creative_thumbs || []).flatMap((thumb, _ci) =>
          (b.adset_ids || []).map((adSetId, ai) => ({
            adId: "",
            adSetId,
            adSetName: b.adset_names?.[ai] || adSetId,
            thumbnailUrl: thumb || null,
            mediaType: "image" as const,
          }))
        ).slice(0, b.total_ads || 1)

    setResultModal({
      created: b.total_ads,
      failed: b.failed_ads,
      durationMs: b.duration_ms,
      errors: b.errors || [],
      createdAds,
      batchId: b.id,
      launchMeta: {
        cta: b.cta || "",
        webLink: b.web_link || "",
        headline: b.headline || "",
        primaryText: b.primary_text || "",
        pageId: b.page_id || "",
        pageName: (b as any).page_name || pages.find(p => p.id === b.page_id)?.name || "",
        adAccountId: b.ad_account_id,
        adAccountName: b.ad_account_name,
        timestamp: b.created_at,
      },
    })
  }

  return (
    <div className="border-t flex flex-col">
      {resultModal && <LaunchResultModal result={resultModal} onClose={() => setResultModal(null)} />}
      <div className="flex items-center border-b px-4 shrink-0 gap-0">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn("flex items-center gap-1.5 px-0 py-2.5 mr-6 text-sm border-b-2 transition-colors",
              tab === key ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <Icon className="size-3.5" />{label}
          </button>
        ))}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 mr-2 bg-muted/30 px-3 py-1 rounded-full border border-border">
            <span className="text-xs font-medium">{selectedIds.size} selected</span>
            {tab === "deleted" ? (
              <>
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => handleBulkAction("restore")} disabled={actionLoading}>Restore</Button>
                <Button variant="destructive" size="sm" className="h-6 text-xs gap-1 px-2" onClick={() => handleBulkAction("permanent")} disabled={actionLoading}>Delete Forever</Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-destructive hover:bg-destructive/10" onClick={() => handleBulkAction("trash")} disabled={actionLoading}>
                <IconTrash className="size-3.5" /> Move to Trash
              </Button>
            )}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 py-2">
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by ad set, ad name, account, user or batch..."
              className="pl-7 pr-3 py-1.5 text-xs bg-muted/40 border rounded-lg outline-none focus:ring-1 focus:ring-ring w-52 placeholder:text-muted-foreground/50" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="h-7 px-2 text-xs border rounded-lg bg-background outline-none">
            <option value="all">All Status</option>
            {tab === "scheduled" ? <>
              <option value="pending">Pending</option>
              <option value="activated">Activated</option>
              <option value="paused">Paused</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </> : <>
              <option value="success">Success</option>
              <option value="partial">Partial</option>
              <option value="failed">Failed</option>
            </>}
          </select>
          <Button variant="ghost" size="icon" className="size-7" onClick={load}>
            <IconRefresh className={cn("size-3.5 text-muted-foreground", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Drafts tab content */}
      {tab === "drafts" && (
        <div className="flex flex-col flex-1 min-h-0">
          {draftsLoading ? (
            <div className="flex items-center justify-center py-10">
              <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : drafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-2 text-muted-foreground/50">
              <IconBookmark className="size-8 stroke-1" />
              <span className="text-xs">No drafts saved yet. Click "Save Draft" to save current rows.</span>
            </div>
          ) : (
            <>
              {/* Drafts search */}
              <div className="px-4 py-2 border-b shrink-0">
                <div className="relative">
                  <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
                  <input value={draftSearch} onChange={e => setDraftSearch(e.target.value)}
                    placeholder="Search drafts..."
                    className="pl-7 pr-3 py-1.5 text-xs bg-muted/40 border rounded-lg outline-none focus:ring-1 focus:ring-ring w-64 placeholder:text-muted-foreground/50" />
                </div>
              </div>
              {/* Drafts header */}
              <div className="grid text-xs font-semibold text-muted-foreground/55 uppercase tracking-wide border-b px-4 py-1.5 shrink-0"
                style={{ gridTemplateColumns: DRAFT_COLS }}>
                <span>Creatives</span><span>Title</span><span>Account</span>
                <span>Rows</span><span>Created</span><span>User</span><span>Actions</span>
              </div>
              {/* Drafts list. `data-table` is what the row floor in globals.css keys off — the
                  CSS matches the attribute, not the element, so a grid list opts in the same way
                  a real table does. */}
              <div data-table="comfortable" className="overflow-y-auto flex-1">
                {drafts
                  .filter(d => !draftSearch || d.name.toLowerCase().includes(draftSearch.toLowerCase()) || d.ad_account_name?.toLowerCase().includes(draftSearch.toLowerCase()))
                  .map(d => (
                    <div key={d.id} data-table-row className="grid items-center px-4 py-2 border-b text-sm hover:bg-muted/20 transition-colors"
                      style={{ gridTemplateColumns: DRAFT_COLS }}>
                      {/* Thumbnails */}
                      <ThumbStack thumbs={d.creative_thumbs || []} count={d.row_count} />
                      {/* Name */}
                      <span className="block min-w-0 truncate pr-2 text-xs font-medium">{d.name}</span>
                      {/* Account */}
                      <div className="flex min-w-0 w-full overflow-hidden">
                        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300">
                          <IconBrandMeta className="size-3.5 shrink-0 text-[#1877F2]" />
                          <span className="min-w-0 truncate">{d.ad_account_name || d.ad_account_id || "—"}</span>
                        </span>
                      </div>
                      {/* Row count */}
                      <span className="text-xs font-medium">{d.row_count}</span>
                      {/* Date */}
                      <span className="text-xs text-muted-foreground">{formatDate(d.created_at)}</span>
                      {/* User */}
                      <div className="flex items-center gap-1.5">
                        <UserAvatar name={d.user_name || "?"} url={(d as any).launcher?.avatar_url} />
                        <span className="text-xs text-muted-foreground truncate">{d.user_name}</span>
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        <Button variant="default" size="sm" className="h-6 text-xs gap-1 px-2"
                          disabled={loadingDraftId === d.id}
                          onClick={() => doLoadDraft(d.id)}>
                          {loadingDraftId === d.id ? <IconLoader2 className="size-3 animate-spin" /> : <IconRocket className="size-3" />}
                          Load
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          disabled={deletingDraftId === d.id}
                          onClick={() => deleteDraft(d.id)} title="Delete draft">
                          {deletingDraftId === d.id ? <IconLoader2 className="size-3 animate-spin" /> : <IconTrash className="size-3" />}
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Launches + Scheduled tab content */}
      {tab !== "drafts" && <>
      {tab === "scheduled" ? (
        <>
          <div className="grid grid-cols-[minmax(180px,1fr)_90px_160px_160px_100px_minmax(180px,1fr)] gap-3 text-xs font-semibold text-muted-foreground/55 uppercase tracking-wide border-b px-4 py-1.5">
            <span>Account</span><span>Ads</span><span>Activates</span><span>Ends</span><span>Status</span><span>Error</span>
          </div>
          <div data-table="comfortable">
            {loading ? (
              <div className="flex items-center justify-center py-10"><IconLoader2 className="size-4 animate-spin text-muted-foreground" /></div>
            ) : filteredScheduled.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-xs text-muted-foreground/50">No scheduled ads</div>
            ) : filteredScheduled.map(item => (
              <div key={item.id} data-table-row className="grid grid-cols-[minmax(180px,1fr)_90px_160px_160px_100px_minmax(180px,1fr)] gap-3 items-center border-b px-4 py-2 text-xs">
                <span className="truncate font-medium">{item.ad_account_id}</span>
                <span>{item.ad_ids.length}</span>
                <span className="text-muted-foreground">{formatDate(item.scheduled_at)}</span>
                <span className="text-muted-foreground">{item.end_time ? formatDate(item.end_time) : "—"}</span>
                <span className={cn("w-fit rounded-full px-1.5 py-0.5 font-semibold", item.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : item.status === "pending" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400")}>{item.status}</span>
                <span className="truncate text-muted-foreground" title={item.error || ""}>{item.error || "—"}</span>
              </div>
            ))}
          </div>
        </>
      ) : <>
      {/* Table header */}
      <div className="grid text-xs font-semibold text-muted-foreground/55 uppercase tracking-wide border-b px-4 py-1.5 shrink-0"
        style={historyGrid(selectedIds.size > 0)}>
        {selectedIds.size > 0 && (
          <input type="checkbox" className="rounded border-muted-foreground/30 text-primary focus:ring-primary w-3.5 h-3.5"
            checked={filtered.length > 0 && selectedIds.size === filtered.length}
            onChange={e => {
              if (e.target.checked) setSelectedIds(new Set(filtered.map(f => f.id)))
              else setSelectedIds(new Set())
            }} />
        )}
        <span>CREATIVES</span>
        <span>ADSETS</span>
        <span>ACCOUNT</span>
        <span>ADS</span>
        <span>ADSETS</span>
        <span>DATE</span>
        <span>USER</span>
        <span>TIME</span>
        <span>STATUS</span>
        <span>ACTIONS</span>
      </div>

      <div data-table="comfortable">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-xs text-muted-foreground/50">
            No launches yet
          </div>
        ) : <>
          {filtered.slice(0, displayCount).map(b => (
            <div key={b.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input[type="checkbox"]')) {
                  return;
                }
                const s = new Set(selectedIds)
                if (s.has(b.id)) s.delete(b.id)
                else s.add(b.id)
                setSelectedIds(s)
              }}
              data-table-row
              className={cn("grid items-center px-4 py-2 border-b text-sm cursor-pointer transition-colors",
                selectedIds.has(b.id) ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/20"
              )}
              style={historyGrid(selectedIds.size > 0)}>

              {selectedIds.size > 0 && (
                <input type="checkbox" className="rounded border-muted-foreground/30 text-primary focus:ring-primary w-3.5 h-3.5"
                  checked={selectedIds.has(b.id)}
                  onChange={e => {
                    const s = new Set(selectedIds)
                    if (e.target.checked) s.add(b.id)
                    else s.delete(b.id)
                    setSelectedIds(s)
                  }} />
              )}

              {/* Creatives */}
              <ThumbStack thumbs={b.creative_thumbs || []} count={b.creative_ids?.length || 0} />

              {/* Ad Sets */}
              <span className="block min-w-0 truncate pr-2 text-xs text-muted-foreground">
                {b.adset_names?.slice(0, 2).join(", ")}
                {(b.adset_names?.length || 0) > 2 && ` +${(b.adset_names?.length || 0) - 2}`}
              </span>

              {/* Account */}
              <div className="flex min-w-0 w-full overflow-hidden">
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300">
                  <IconBrandMeta className="size-3.5 shrink-0 text-[#1877F2]" />
                  <span className="min-w-0 truncate">{b.ad_account_name || b.ad_account_id}</span>
                </span>
              </div>

              {/* Ads count */}
              <span className="text-xs font-medium">{b.total_ads}</span>

              {/* AdSets count */}
              <span className="text-xs font-medium">{b.adset_ids?.length || 0}</span>

              {/* Date */}
              <span className="text-xs text-muted-foreground">{formatDate(b.created_at)}</span>

              {/* User */}
              <div className="flex items-center gap-1.5">
                <UserAvatar name={b.user_name || "?"} url={b.launcher?.avatar_url} />
                <span className="text-xs text-muted-foreground truncate">{b.user_name}</span>
              </div>

              {/* Time taken */}
              <span className="text-xs font-medium text-foreground tabular-nums">
                {b.duration_ms ? formatDuration(b.duration_ms) : "—"}
              </span>

              {/* Status */}
              <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-semibold w-fit",
                b.status === "success" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                b.status === "partial" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400")}>
                {b.status === "success" ? "Success" : b.status === "partial" ? "Partial" : "Failed"}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost" size="sm"
                  className="h-6 text-xs gap-0.5 px-2"
                  onClick={() => openDetails(b)}
                >
                  Details
                </Button>
                <Button
                  variant="ghost" size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  title="Re-launch this batch"
                  onClick={() => onRelaunch(b)}
                >
                  <IconRocket className="size-3" />
                </Button>
              </div>
            </div>
          ))}
          {displayCount < filtered.length && (
            <LoadMoreButton
              variant="ghost"
              remaining={filtered.length - displayCount}
              onClick={() => setDisplayCount(c => c + 15)}
              className="py-3 border-t"
            />
          )}
        </>}
      </div>
      </>}
      </>}
    </div>
  )
}

// ─── Sitelinks Modal ─────────────────────────────────────────────────────────

function SitelinksModal({ open, onClose, value, onConfirm }: {
  open: boolean
  onClose: () => void
  value: SitelinkItem[]
  onConfirm: (v: SitelinkItem[]) => void
}) {
  const [local, setLocal] = useState<SitelinkItem[]>(value)
  useEffect(() => { if (open) setLocal(value) }, [open, value])

  const add = () => { if (local.length < 4) setLocal(s => [...s, { title: "", url: "" }]) }
  const update = (idx: number, field: "title" | "url", val: string) =>
    setLocal(s => s.map((l, i) => i === idx ? { ...l, [field]: val } : l))
  const remove = (idx: number) => setLocal(s => s.filter((_, i) => i !== idx))

  const handleSave = () => {
    onConfirm(local.filter(l => l.title.trim() && l.url.trim()))
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-semibold">Sitelinks</DialogTitle>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1 min-h-0">
          <p className="text-xs text-muted-foreground">Add up to 4 sitelinks shown below the ad. Each sitelink needs a title and URL.</p>
          {local.map((link, idx) => (
            <div key={idx} className="border rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">Sitelink {idx + 1}</span>
                <button onClick={() => remove(idx)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <IconX className="size-3.5" />
                </button>
              </div>
              <input
                value={link.title}
                onChange={e => update(idx, "title", e.target.value)}
                placeholder="Title (vd: Shop Now)"
                maxLength={25}
                className="w-full px-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
              />
              <input
                value={link.url}
                onChange={e => update(idx, "url", e.target.value)}
                placeholder="https://example.com/page"
                className="w-full px-3 py-2 text-sm bg-muted/30 border rounded-lg outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
              />
            </div>
          ))}
          {local.length < 4 && (
            <button
              onClick={add}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-dashed rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              <IconPlus className="size-4" />Add Sitelink ({local.length}/4)
            </button>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-background shrink-0">
          <Button variant="outline" onClick={onClose}><IconX className="size-3.5 mr-1" />Cancel</Button>
          <Button onClick={handleSave}><IconCheck className="size-3.5 mr-1" />Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Table Mode ───────────────────────────────────────────────────────────────

const DEFAULT_PARTNERSHIP: PartnershipState = { enabled: false, partnerPageId: "", partnerIgId: "", displayMode: "both", partnerFirstInDisplay: false }
const DEFAULT_MULTILANGUAGE: MultilanguageState = { enabled: false, defaultLanguage: "en_US", translations: [] }
const DEFAULT_CATALOG: CatalogAdsState = { enabled: false, formatMode: "automatic", format: "single", frameImageUrl: "", dynamicMedia: { optimizedMediaSelection: false, automaticVideoCropping: false, prioritizeVideo: false }, catalogId: "", catalogName: "", productSetId: "", productSetName: "", hideAutoCreatedSets: false }

type RowModalType = "partnership" | "multilanguage" | "catalog" | "schedule" | "sitelinks"

function AdSetPickerCell({ selectedIds, adSets, onUpdate }: {
  selectedIds: string[]
  adSets: AdSet[]
  onUpdate: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = adSets.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (id: string) => {
    onUpdate(selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id]
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedIds.map(id => {
            const as = adSets.find(a => a.id === id)
            if (!as) return null
            return (
              <span key={id} className="inline-flex items-center gap-0.5 text-xs bg-muted/80 border border-border/50 px-1.5 py-0.5 rounded-full max-w-full">
                <span className="truncate max-w-[110px]">{as.name}</span>
                <button
                  onClick={e => { e.stopPropagation(); toggle(id) }}
                  className="text-muted-foreground hover:text-foreground ml-0.5 shrink-0"
                >
                  <IconX className="size-2.5" />
                </button>
              </span>
            )
          })}
        </div>
      )}
      <Popover open={open} onOpenChange={v => {
        setOpen(v)
        if (v) setTimeout(() => searchRef.current?.focus(), 50)
        else setSearch("")
      }}>
        <PopoverTrigger asChild>
          <button className="h-7 px-2 text-xs border border-dashed border-border/60 rounded-md flex items-center gap-1 text-muted-foreground hover:text-foreground hover:border-border transition-colors w-full justify-center">
            <IconPlus className="size-3 shrink-0" />
            {selectedIds.length === 0 ? "Add ad set" : "Add more"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0 gap-0" align="start" sideOffset={4}>
          {/* Search */}
          <div className="px-2 py-2 border-b">
            <div className="flex items-center gap-1.5 px-2 h-7 rounded-md border bg-muted/30 focus-within:ring-1 focus-within:ring-ring/50">
              <IconSearch className="size-3 text-muted-foreground shrink-0" />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search ad sets…"
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                onKeyDown={e => e.stopPropagation()}
              />
              {search && (
                <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground shrink-0">
                  <IconX className="size-3" />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-5 text-xs text-muted-foreground text-center">No ad sets found</div>
            ) : filtered.map(a => {
              const isSelected = selectedIds.includes(a.id)
              const isActive = a.effective_status === "ACTIVE"
              return (
                <button
                  key={a.id}
                  onClick={() => toggle(a.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors",
                    isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"
                  )}
                >
                  <div className={cn(
                    "size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors",
                    isSelected ? "bg-primary border-primary" : "border-border/60"
                  )}>
                    {isSelected && <IconCheck className="size-2.5 text-primary-foreground" />}
                  </div>
                  <span className={cn("flex-1 truncate", isSelected && "font-medium text-primary")}>{a.name}</span>
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded-sm font-semibold shrink-0",
                    isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"
                  )}>
                    {isActive ? "Active" : "Paused"}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Footer */}
          {selectedIds.length > 0 && (
            <div className="border-t px-3 py-1.5 flex items-center justify-between bg-muted/20">
              <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
              <button
                onClick={() => { onUpdate([]); setOpen(false) }}
                className="text-xs text-destructive hover:underline"
              >
                Clear all
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function CtaPickerCell({ value, onChange }: {
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const current = CTA_OPTIONS.find(o => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          "h-7 w-full px-2 text-xs border rounded-md flex items-center justify-between gap-1 transition-colors",
          open ? "border-ring ring-1 ring-ring/30" : "border-border/60 hover:border-border",
          !current && "text-muted-foreground"
        )}>
          <span className="truncate">{current?.label ?? "From gallery"}</span>
          <IconChevronDown className="size-3 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1 gap-0" align="start" sideOffset={4}>
        <button
          onClick={() => { onChange(undefined); setOpen(false) }}
          className={cn(
            "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-sm transition-colors text-left",
            !value ? "bg-primary/5 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50"
          )}
        >
          {!value && <IconCheck className="size-3 shrink-0" />}
          <span className={!value ? "" : "ml-5"}>From gallery</span>
        </button>
        <div className="my-1 border-t" />
        {CTA_OPTIONS.map(o => (
          <button
            key={o.value}
            onClick={() => { onChange(o.value); setOpen(false) }}
            className={cn(
              "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-sm transition-colors text-left",
              value === o.value ? "bg-primary/5 text-primary font-medium" : "hover:bg-muted/50"
            )}
          >
            {value === o.value
              ? <IconCheck className="size-3 shrink-0" />
              : <span className="size-3 shrink-0" />
            }
            {o.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

// ─── Shared row primitives (reused by List / Record / Gallery views) ──────────
function CreativeThumb({
  row, size, uploadingRowId, onUploadFiles, onPickClick, onRemove, idPrefix,
}: {
  row: TableRow
  size: number
  uploadingRowId: string | null
  onUploadFiles: (files: FileList | null) => void
  onPickClick: () => void
  onRemove: () => void
  idPrefix: string
}) {
  const inputId = `${idPrefix}-upload-${row.id}`
  return (
    <div className="relative group/creative shrink-0" style={{ width: size, height: size }}>
      <input
        id={inputId}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={e => { onUploadFiles(e.target.files); e.currentTarget.value = "" }}
      />
      <label
        htmlFor={inputId}
        className="w-full h-full rounded border-2 border-dashed border-border/60 overflow-hidden relative flex items-center justify-center bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer"
        title={row.creative ? "Upload to replace creative" : "Upload creative from your computer"}
      >
        {uploadingRowId === row.id ? (
          <IconLoader2 className="size-5 text-muted-foreground animate-spin" />
        ) : row.creative?.status === "pending" ? (
          <div className="flex flex-col items-center gap-1">
            <IconClock className="size-4 text-amber-500/70" />
            <span className="text-xs text-amber-600/70 leading-none text-center">Pending</span>
          </div>
        ) : row.creative ? (
          <CreativeCardMedia creative={row.creative} className="w-full h-full object-cover" compact />
        ) : (
          <div className="flex flex-col items-center gap-1">
            <IconUpload className="size-4 text-muted-foreground/40" />
            <span className="text-xs text-muted-foreground/40 leading-none">Upload</span>
          </div>
        )}
        {row.creative?.media_type === "video" && uploadingRowId !== row.id && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="size-5 bg-black/50 rounded-full flex items-center justify-center">
              <IconPlayerPlay className="size-2.5 text-white fill-white" />
            </div>
          </div>
        )}
        {row.creative && uploadingRowId !== row.id && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/creative:opacity-100 transition-opacity pointer-events-none">
            <span className="text-xs text-white font-medium">Upload</span>
          </div>
        )}
      </label>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onPickClick() }}
        className="absolute bottom-1 right-1 size-5 rounded bg-background/90 border border-border flex items-center justify-center text-muted-foreground opacity-0 group-hover/creative:opacity-100 transition-opacity hover:text-foreground"
        title="Choose from media library"
      >
        <IconFolder className="size-3" />
      </button>
      {row.creative && uploadingRowId !== row.id && (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          className="absolute -top-1.5 -right-1.5 size-4 bg-background border border-border rounded-full flex items-center justify-center opacity-0 group-hover/creative:opacity-100 transition-opacity hover:bg-destructive hover:border-destructive hover:text-white"
        >
          <IconX className="size-2.5" />
        </button>
      )}
    </div>
  )
}

function LaunchStatusToggle({ row, launchAsActive, onUpdateRow }: {
  row: TableRow
  launchAsActive: boolean
  onUpdateRow: (id: string, field: keyof TableRow, value: any) => void
}) {
  const active = row.launchAsActive ?? launchAsActive
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onUpdateRow(row.id, "launchAsActive", row.launchAsActive === false ? true : row.launchAsActive === true ? false : !launchAsActive)}
        className={cn(
          "relative inline-flex h-4 w-8 items-center rounded-full transition-colors shrink-0",
          active ? "bg-primary/100" : "bg-muted-foreground/30"
        )}
        title={active ? "Active" : "Paused"}
      >
        <span className={cn(
          "inline-block size-3 rounded-full bg-white shadow-sm transition-transform",
          active ? "translate-x-[18px]" : "translate-x-0.5"
        )} />
      </button>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{active ? "Active" : "Paused"}</span>
    </div>
  )
}

function RowActions({ row, onDuplicateRow, onDeleteRow }: {
  row: TableRow
  onDuplicateRow: (id: string) => void
  onDeleteRow: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
      <button onClick={() => onDuplicateRow(row.id)} className="text-muted-foreground hover:text-foreground" title="Duplicate row">
        <IconCopy className="size-3.5" />
      </button>
      <button onClick={() => onDeleteRow(row.id)} className="text-muted-foreground hover:text-destructive" title="Delete row">
        <IconTrash className="size-3.5" />
      </button>
    </div>
  )
}

type CoreRowViewProps = {
  row: TableRow
  index: number
  isSelected: boolean
  onToggleSelect: () => void
  onUpdateRow: (id: string, field: keyof TableRow, value: any) => void
  onDeleteRow: (id: string) => void
  onDuplicateRow: (id: string) => void
  onCreativeClick: () => void
  onRowUpload: (files: FileList | null) => void
  uploadingRowId: string | null
  adSets: AdSet[]
  launchAsActive: boolean
}

// ─── 1. List view (Single column) — compact scan of many ads ──────────────────
function ListRowItem(props: CoreRowViewProps) {
  const { row, index, isSelected, onToggleSelect, onUpdateRow, onDeleteRow, onDuplicateRow, onCreativeClick, onRowUpload, uploadingRowId, adSets, launchAsActive } = props
  return (
    <div className={cn(
      "flex items-start gap-3 px-3 py-2.5 border-b group transition-colors",
      isSelected ? "bg-primary/10/60 dark:bg-blue-950/20" : "hover:bg-muted/20"
    )}>
      <input type="checkbox" className="rounded size-3.5 accent-primary shrink-0 mt-2" checked={isSelected} onChange={onToggleSelect} />
      <span className="text-xs text-muted-foreground w-4 shrink-0 mt-2">{index + 1}</span>
      <CreativeThumb row={row} size={36} uploadingRowId={uploadingRowId} onUploadFiles={onRowUpload} onPickClick={onCreativeClick} onRemove={() => onUpdateRow(row.id, "creative", null)} idPrefix="list" />
      <input
        value={row.adName}
        onChange={e => onUpdateRow(row.id, "adName", e.target.value)}
        placeholder="Ad name..."
        className="w-44 shrink-0 text-xs font-medium bg-transparent border border-transparent focus:border-border focus:bg-muted/20 rounded px-1.5 py-1.5 outline-none placeholder:text-muted-foreground/40 placeholder:font-normal"
      />
      <input
        value={row.primaryText}
        onChange={e => onUpdateRow(row.id, "primaryText", e.target.value)}
        placeholder="Primary text..."
        className="flex-1 min-w-0 text-xs text-muted-foreground bg-transparent border border-transparent focus:border-border focus:bg-muted/20 rounded px-1.5 py-1.5 outline-none placeholder:text-muted-foreground/40"
      />
      <div className="w-44 shrink-0"><AdSetPickerCell selectedIds={row.adSetIds} adSets={adSets} onUpdate={ids => onUpdateRow(row.id, "adSetIds", ids)} /></div>
      <div className="w-32 shrink-0"><CtaPickerCell value={row.cta} onChange={v => onUpdateRow(row.id, "cta", v)} /></div>
      <div className="mt-1.5 shrink-0"><LaunchStatusToggle row={row} launchAsActive={launchAsActive} onUpdateRow={onUpdateRow} /></div>
      <div className="mt-1"><RowActions row={row} onDuplicateRow={onDuplicateRow} onDeleteRow={onDeleteRow} /></div>
    </div>
  )
}

// ─── 2. Record / Form view (Stacked) — every field fully visible, one ad at a time ─
function RecordCard(props: CoreRowViewProps) {
  const { row, index, isSelected, onToggleSelect, onUpdateRow, onDeleteRow, onDuplicateRow, onCreativeClick, onRowUpload, uploadingRowId, adSets, launchAsActive } = props
  return (
    <div className={cn("p-4 group transition-colors", isSelected ? "bg-primary/10/60 dark:bg-blue-950/20" : "")}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <input type="checkbox" className="rounded size-3.5 accent-primary" checked={isSelected} onChange={onToggleSelect} />
          <span className="text-xs bg-green-100 text-green-700 border border-green-200 px-1.5 py-0.5 rounded font-semibold leading-none dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">SINGLE</span>
          <span className="text-xs text-muted-foreground">#{index + 1} {row.adName || <span className="opacity-50">Untitled ad</span>}</span>
        </div>
        <div className="flex items-center gap-3">
          <LaunchStatusToggle row={row} launchAsActive={launchAsActive} onUpdateRow={onUpdateRow} />
          <RowActions row={row} onDuplicateRow={onDuplicateRow} onDeleteRow={onDeleteRow} />
        </div>
      </div>
      <div className="flex gap-4">
        <CreativeThumb row={row} size={92} uploadingRowId={uploadingRowId} onUploadFiles={onRowUpload} onPickClick={onCreativeClick} onRemove={() => onUpdateRow(row.id, "creative", null)} idPrefix="record" />
        <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-3 min-w-0">
          <div className="col-span-2">
            <div className="text-[9.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Primary Text</div>
            <textarea
              value={row.primaryText}
              onChange={e => onUpdateRow(row.id, "primaryText", e.target.value)}
              placeholder="Primary text..."
              rows={3}
              className="w-full text-xs bg-muted/20 border border-border/70 focus:border-primary/50 hover:border-border rounded px-2 py-1.5 outline-none resize-y placeholder:text-muted-foreground/40 leading-relaxed transition-colors"
            />
          </div>
          <div>
            <div className="text-[9.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Ad Name</div>
            <input
              value={row.adName}
              onChange={e => onUpdateRow(row.id, "adName", e.target.value)}
              placeholder="Ad name..."
              className="w-full text-xs bg-muted/20 border border-border/70 focus:border-primary/50 hover:border-border rounded px-2 py-1.5 outline-none placeholder:text-muted-foreground/40 transition-colors"
            />
          </div>
          <div>
            <div className="text-[9.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Headline</div>
            <input
              value={row.headline}
              onChange={e => onUpdateRow(row.id, "headline", e.target.value)}
              placeholder="Headline..."
              className="w-full text-xs bg-muted/20 border border-border/70 focus:border-primary/50 hover:border-border rounded px-2 py-1.5 outline-none placeholder:text-muted-foreground/40 transition-colors"
            />
          </div>
          <div>
            <div className="text-[9.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Ad Sets <span className="text-amber-500 normal-case">required</span></div>
            <AdSetPickerCell selectedIds={row.adSetIds} adSets={adSets} onUpdate={ids => onUpdateRow(row.id, "adSetIds", ids)} />
          </div>
          <div>
            <div className="text-[9.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">CTA</div>
            <CtaPickerCell value={row.cta} onChange={v => onUpdateRow(row.id, "cta", v)} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 3. Gallery view (Grid) — creative-forward card grid ──────────────────────
function GridCard(props: CoreRowViewProps) {
  const { row, isSelected, onToggleSelect, onUpdateRow, onDeleteRow, onDuplicateRow, onCreativeClick, onRowUpload, uploadingRowId, adSets, launchAsActive } = props
  return (
    <div className={cn(
      "rounded-lg border overflow-hidden flex flex-col group transition-colors",
      isSelected ? "border-primary/40 bg-primary/10/40 dark:bg-blue-950/20" : "border-border bg-muted/10"
    )}>
      <div className="relative">
        <CreativeThumb row={row} size={220} uploadingRowId={uploadingRowId} onUploadFiles={onRowUpload} onPickClick={onCreativeClick} onRemove={() => onUpdateRow(row.id, "creative", null)} idPrefix="grid" />
        <input type="checkbox" className="absolute top-2 left-2 rounded size-3.5 accent-primary" checked={isSelected} onChange={onToggleSelect} />
        <span className="absolute top-2 right-2 text-xs bg-green-100 text-green-700 border border-green-200 px-1.5 py-0.5 rounded font-semibold leading-none dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">SINGLE</span>
      </div>
      <div className="p-2.5 flex flex-col gap-1.5 flex-1">
        <input
          value={row.adName}
          onChange={e => onUpdateRow(row.id, "adName", e.target.value)}
          placeholder="Ad name..."
          className="text-xs font-semibold bg-transparent border border-transparent focus:border-border focus:bg-muted/20 rounded px-1 py-1 outline-none placeholder:text-muted-foreground/40 placeholder:font-normal"
        />
        <textarea
          value={row.primaryText}
          onChange={e => onUpdateRow(row.id, "primaryText", e.target.value)}
          placeholder="Primary text..."
          rows={2}
          className="text-xs text-muted-foreground bg-transparent border border-transparent focus:border-border focus:bg-muted/20 rounded px-1 py-1 outline-none resize-none placeholder:text-muted-foreground/40 leading-snug"
        />
        <input
          value={row.headline}
          onChange={e => onUpdateRow(row.id, "headline", e.target.value)}
          placeholder="Headline..."
          className="text-xs italic text-muted-foreground bg-transparent border border-transparent focus:border-border focus:bg-muted/20 rounded px-1 py-1 outline-none placeholder:text-muted-foreground/40"
        />
        <div className="flex items-center gap-1.5 mt-1">
          <div className="flex-1 min-w-0"><AdSetPickerCell selectedIds={row.adSetIds} adSets={adSets} onUpdate={ids => onUpdateRow(row.id, "adSetIds", ids)} /></div>
        </div>
        <div className="flex items-center justify-between mt-auto pt-1.5">
          <LaunchStatusToggle row={row} launchAsActive={launchAsActive} onUpdateRow={onUpdateRow} />
          <RowActions row={row} onDuplicateRow={onDuplicateRow} onDeleteRow={onDeleteRow} />
        </div>
      </div>
    </div>
  )
}

function TableMode({
  rows, adSets, onAddRow, onUpdateRow, onDeleteRow, onDuplicateRow,
  selectedPage, igAccountCache, selectedIgPageId, searchQuery, launchAsActive, pages, selectedAccountId,
  onOpenCreativePicker, onUploadRowFiles, viewMode,
}: {
  rows: TableRow[]
  adSets: AdSet[]
  onAddRow: () => void
  onUpdateRow: (id: string, field: keyof TableRow, value: any) => void
  onDeleteRow: (id: string) => void
  onDuplicateRow: (id: string) => void
  selectedPage?: FacebookPage
  igAccountCache: Record<string, IgAccount[]>
  selectedIgPageId: string
  searchQuery: string
  launchAsActive: boolean
  pages: FacebookPage[]
  selectedAccountId: string
  onOpenCreativePicker: (rowId: string) => void
  onUploadRowFiles: (rowId: string, files: FileList | File[]) => Promise<void>
  viewMode: "single" | "stacked" | "grid" | "side-by-side"
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedVar, setExpandedVar] = useState<Record<string, { primary: boolean; headline: boolean; description: boolean }>>({})
  const [sortField, setSortField] = useState<"adName" | "primaryText" | "headline" | "description" | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [profilePopoverRow, setProfilePopoverRow] = useState<string | null>(null)
  const [profilePopoverPos, setProfilePopoverPos] = useState<{ top: number; left: number } | null>(null)
  const [rowModal, setRowModal] = useState<{ type: RowModalType; rowId: string } | null>(null)
  const [uploadingRowId, setUploadingRowId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const profilePopoverRef = useRef<HTMLDivElement>(null)
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragScrollLeft = useRef(0)

  const handleCreativeCellClick = (rowId: string) => {
    onOpenCreativePicker(rowId)
  }

  const handleRowUpload = async (rowId: string, files: FileList | null) => {
    if (!files || files.length === 0 || uploadingRowId) return
    setUploadError(null)
    setUploadingRowId(rowId)
    try {
      await onUploadRowFiles(rowId, files)
    } catch (err: any) {
      setUploadError(err?.message || "Upload failed")
    } finally {
      setUploadingRowId(null)
    }
  }

  const onTableMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest("input,textarea,select,button,[role=combobox],[data-radix-popper-content-wrapper]")) return
    isDragging.current = true
    dragStartX.current = e.pageX
    dragScrollLeft.current = tableScrollRef.current?.scrollLeft || 0
    if (tableScrollRef.current) tableScrollRef.current.style.cursor = "grabbing"
  }
  const onTableMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !tableScrollRef.current) return
    e.preventDefault()
    tableScrollRef.current.scrollLeft = dragScrollLeft.current - (e.pageX - dragStartX.current)
  }
  const onTableMouseUp = () => {
    isDragging.current = false
    if (tableScrollRef.current) tableScrollRef.current.style.cursor = ""
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profilePopoverRef.current && !profilePopoverRef.current.contains(e.target as Node)) {
        setProfilePopoverRow(null)
        setProfilePopoverPos(null)
      }
    }
    const onScroll = () => { setProfilePopoverRow(null); setProfilePopoverPos(null) }
    document.addEventListener("mousedown", handler)
    const el = tableScrollRef.current
    el?.addEventListener("scroll", onScroll)
    return () => {
      document.removeEventListener("mousedown", handler)
      el?.removeEventListener("scroll", onScroll)
    }
  }, [])

  const toggleSort = (field: "adName" | "primaryText" | "headline" | "description") => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortField(field); setSortDir("asc") }
  }

  const SortIcon = ({ field }: { field: "adName" | "primaryText" | "headline" | "description" }) => {
    if (sortField !== field) return <IconArrowsUpDown className="size-3 opacity-30 ml-0.5" />
    return sortDir === "asc" ? <IconArrowUp className="size-3 text-primary ml-0.5" /> : <IconArrowDown className="size-3 text-primary ml-0.5" />
  }

  const filteredRows = useMemo(() => {
    let list = rows
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(r =>
        r.adName.toLowerCase().includes(q) ||
        r.primaryText.toLowerCase().includes(q) ||
        r.headline.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
      )
    }
    if (sortField) {
      list = [...list].sort((a, b) => {
        const av = ((a as any)[sortField] || "").toLowerCase()
        const bv = ((b as any)[sortField] || "").toLowerCase()
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    }
    return list
  }, [rows, searchQuery, sortField, sortDir])

  const allSelected = filteredRows.length > 0 && filteredRows.every(r => selectedIds.has(r.id))
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(filteredRows.map(r => r.id)))
  }
  const toggleRow = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const igAccount = useMemo(() => {
    if (!selectedIgPageId) return null
    for (const accounts of Object.values(igAccountCache)) {
      const found = accounts.find(a => a.id === selectedIgPageId)
      if (found) return found
    }
    return null
  }, [igAccountCache, selectedIgPageId])

  const getExpanded = (id: string) => expandedVar[id] || { primary: false, headline: false, description: false }
  const setExpanded = (id: string, patch: Partial<{ primary: boolean; headline: boolean; description: boolean }>) =>
    setExpandedVar(prev => ({ ...prev, [id]: { ...getExpanded(id), ...patch } }))

  const selectedCount = selectedIds.size

  return (
    <>
    {uploadError && (
      <div className="px-4 py-2 text-xs text-destructive border-b bg-destructive/5">
        {uploadError}
      </div>
    )}
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {viewMode === "side-by-side" ? (
      <div
        ref={tableScrollRef}
        className="flex-1 overflow-auto select-none"
        style={{ cursor: "grab" }}
        onMouseDown={onTableMouseDown}
        onMouseMove={onTableMouseMove}
        onMouseUp={onTableMouseUp}
        onMouseLeave={onTableMouseUp}
      >
        <table data-table="compact" className="w-full text-sm border-collapse" style={{ minWidth: 2700 }}>
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b">
              <th className="w-10 px-2 text-left">
                <input type="checkbox" className="rounded size-3.5 accent-primary" checked={allSelected} onChange={toggleAll} />
              </th>
              <th className="w-7 px-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">#</th>
              <th className="w-32 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Creative</th>
              <th
                className="w-72 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground"
                onClick={() => toggleSort("adName")}
              >
                <span className="flex items-center gap-0.5">Ad Name <SortIcon field="adName" /></span>
              </th>
              <th
                className="w-80 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground"
                onClick={() => toggleSort("primaryText")}
              >
                <span className="flex items-center gap-0.5">Primary Text <SortIcon field="primaryText" /></span>
              </th>
              <th
                className="w-64 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground"
                onClick={() => toggleSort("headline")}
              >
                <span className="flex items-center gap-0.5">Headline <SortIcon field="headline" /></span>
              </th>
              <th
                className="w-52 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground"
                onClick={() => toggleSort("description")}
              >
                <span className="flex items-center gap-0.5">Description <SortIcon field="description" /></span>
              </th>
              <th className="w-48 px-3 text-left">
                <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Ad Sets <span className="text-xs font-medium text-amber-500 normal-case tracking-normal">required</span>
                  <IconArrowsUpDown className="size-3 opacity-30 ml-0.5" />
                </span>
              </th>
              <th className="w-40 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ad Profiles</th>
              <th className="w-28 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">CTA</th>
              <th className="w-48 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Link</th>
              <th className="w-44 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">URL Tags</th>
              <th className="w-36 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sitelinks</th>
              <th className="w-36 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Partnership Ads</th>
              <th className="w-36 px-3 text-left">
                <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <IconSparkles className="size-3 text-blue-400" />Multi-Language
                </span>
              </th>
              <th className="w-32 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Catalog</th>
              <th className="w-32 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Meta Schedule</th>
              <th className="w-32 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Promo Code</th>
              <th className="w-28 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Launch Status</th>
              <th className="w-14 px-3" />
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, i) => {
              const isSelected = selectedIds.has(row.id)
              const exp = getExpanded(row.id)
              const ptVars = row.primaryTextVariations || []
              const hlVars = row.headlineVariations || []
              const descVars = row.descriptionVariations || []
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b group transition-colors align-top",
                    isSelected ? "bg-primary/10/60 dark:bg-blue-950/20" : "hover:bg-muted/20"
                  )}
                >
                  {/* Checkbox */}
                  <td className="px-3">
                    <input type="checkbox" className="rounded size-3.5 accent-primary" checked={isSelected} onChange={() => toggleRow(row.id)} />
                  </td>

                  {/* # */}
                  <td className="px-2 text-xs text-muted-foreground">{i + 1}</td>

                  {/* CREATIVE */}
                  <td className="px-3">
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-xs bg-green-100 text-green-700 border border-green-200 px-1.5 py-0.5 rounded font-semibold leading-none dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
                        SINGLE
                      </span>
                      <div className="relative group/creative">
                        <input
                          id={`table-row-upload-${row.id}`}
                          type="file"
                          accept="image/*,video/*"
                          multiple
                          className="hidden"
                          onChange={e => {
                            handleRowUpload(row.id, e.target.files)
                            e.currentTarget.value = ""
                          }}
                        />
                        <label
                          htmlFor={`table-row-upload-${row.id}`}
                          className="size-20 rounded border-2 border-dashed border-border/60 overflow-hidden relative flex items-center justify-center bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer"
                          title={row.creative ? "Upload to replace creative" : "Upload creative from your computer"}
                        >
                          {uploadingRowId === row.id ? (
                            <IconLoader2 className="size-5 text-muted-foreground animate-spin" />
                          ) : row.creative?.status === "pending" ? (
                            <div className="flex flex-col items-center gap-1">
                              <IconClock className="size-4 text-amber-500/70" />
                              <span className="text-xs text-amber-600/70 leading-none text-center">Pending</span>
                            </div>
                          ) : row.creative ? (
                            <CreativeCardMedia creative={row.creative} className="w-full h-full object-cover" compact />
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <IconUpload className="size-4 text-muted-foreground/40" />
                              <span className="text-xs text-muted-foreground/40 leading-none">Upload</span>
                            </div>
                          )}
                          {row.creative?.media_type === "video" && !uploadingRowId && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="size-5 bg-black/50 rounded-full flex items-center justify-center">
                                <IconPlayerPlay className="size-2.5 text-white fill-white" />
                              </div>
                            </div>
                          )}
                          {/* Replace overlay on hover (when has creative) */}
                          {row.creative && uploadingRowId !== row.id && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/creative:opacity-100 transition-opacity pointer-events-none">
                              <span className="text-xs text-white font-medium">Upload</span>
                            </div>
                          )}
                        </label>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); handleCreativeCellClick(row.id) }}
                          className="absolute bottom-1 right-1 size-5 rounded bg-background/90 border border-border flex items-center justify-center text-muted-foreground opacity-0 group-hover/creative:opacity-100 transition-opacity hover:text-foreground"
                          title="Choose from media library"
                        >
                          <IconFolder className="size-3" />
                        </button>
                        {/* Remove button */}
                        {row.creative && uploadingRowId !== row.id && (
                          <button
                            onClick={e => { e.stopPropagation(); onUpdateRow(row.id, "creative", null) }}
                            className="absolute -top-1.5 -right-1.5 size-4 bg-background border border-border rounded-full flex items-center justify-center opacity-0 group-hover/creative:opacity-100 transition-opacity hover:bg-destructive hover:border-destructive hover:text-white"
                          >
                            <IconX className="size-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* AD NAME (separate column) */}
                  <td className="px-3 align-top">
                    <textarea
                      value={row.adName}
                      onChange={e => onUpdateRow(row.id, "adName", e.target.value)}
                      placeholder="Ad name..."
                      rows={3}
                      className="w-full text-xs bg-muted/20 border border-transparent focus:border-border rounded px-2 py-1.5 outline-none resize-y placeholder:text-muted-foreground/40 leading-relaxed"
                    />
                  </td>

                  {/* PRIMARY TEXT */}
                  <td className="px-3">
                    <div className="flex flex-col gap-1">
                      <textarea
                        value={row.primaryText}
                        onChange={e => onUpdateRow(row.id, "primaryText", e.target.value)}
                        placeholder="Primary text..."
                        rows={2}
                        className="w-full text-xs bg-muted/20 border border-transparent focus:border-border rounded px-2 py-1.5 outline-none resize-y placeholder:text-muted-foreground/40 leading-relaxed"
                        style={{ minHeight: 52 }}
                      />
                      {exp.primary && ptVars.map((v, vi) => (
                        <div key={vi} className="flex items-start gap-1">
                          <textarea
                            value={v}
                            onChange={e => {
                              const arr = [...ptVars]; arr[vi] = e.target.value
                              onUpdateRow(row.id, "primaryTextVariations", arr)
                            }}
                            rows={2}
                            placeholder={`Variation ${vi + 2}...`}
                            className="flex-1 text-xs bg-muted/20 border border-transparent focus:border-border rounded px-2 py-1.5 outline-none resize-y placeholder:text-muted-foreground/40"
                          />
                          <button
                            onClick={() => {
                              const arr = ptVars.filter((_, j) => j !== vi)
                              onUpdateRow(row.id, "primaryTextVariations", arr)
                              if (arr.length === 0) setExpanded(row.id, { primary: false })
                            }}
                            className="mt-1 text-muted-foreground hover:text-destructive"
                          >
                            <IconX className="size-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          onUpdateRow(row.id, "primaryTextVariations", [...ptVars, ""])
                          setExpanded(row.id, { primary: true })
                        }}
                        className="text-xs text-primary hover:text-primary/90 text-left font-medium"
                      >
                        Primary Text Variations {ptVars.length > 0 ? `${ptVars.length + 1} ` : ""}+
                      </button>
                    </div>
                  </td>

                  {/* HEADLINE */}
                  <td className="px-3">
                    <div className="flex flex-col gap-1">
                      <textarea
                        value={row.headline}
                        onChange={e => onUpdateRow(row.id, "headline", e.target.value)}
                        placeholder="Headline..."
                        rows={2}
                        className="w-full text-xs bg-muted/20 border border-transparent focus:border-border rounded px-2 py-1.5 outline-none resize-y placeholder:text-muted-foreground/40 leading-relaxed"
                        style={{ minHeight: 52 }}
                      />
                      {exp.headline && hlVars.map((v, vi) => (
                        <div key={vi} className="flex items-center gap-1">
                          <input
                            value={v}
                            onChange={e => {
                              const arr = [...hlVars]; arr[vi] = e.target.value
                              onUpdateRow(row.id, "headlineVariations", arr)
                            }}
                            placeholder={`Variation ${vi + 2}...`}
                            className="flex-1 text-xs bg-muted/20 border border-transparent focus:border-border rounded px-2 py-1.5 outline-none placeholder:text-muted-foreground/40"
                          />
                          <button
                            onClick={() => {
                              const arr = hlVars.filter((_, j) => j !== vi)
                              onUpdateRow(row.id, "headlineVariations", arr)
                              if (arr.length === 0) setExpanded(row.id, { headline: false })
                            }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <IconX className="size-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          onUpdateRow(row.id, "headlineVariations", [...hlVars, ""])
                          setExpanded(row.id, { headline: true })
                        }}
                        className="text-xs text-primary hover:text-primary/90 text-left font-medium"
                      >
                        Headline Variations {hlVars.length > 0 ? `${hlVars.length + 1} ` : ""}+
                      </button>
                    </div>
                  </td>

                  {/* DESCRIPTION */}
                  <td className="px-3">
                    <div className="flex flex-col gap-1">
                      <textarea
                        value={row.description}
                        onChange={e => onUpdateRow(row.id, "description", e.target.value)}
                        placeholder="Description..."
                        rows={2}
                        className="w-full text-xs bg-muted/20 border border-transparent focus:border-border rounded px-2 py-1.5 outline-none resize-y placeholder:text-muted-foreground/40 leading-relaxed"
                        style={{ minHeight: 52 }}
                      />
                      {exp.description && descVars.map((v, vi) => (
                        <div key={vi} className="flex items-center gap-1">
                          <input
                            value={v}
                            onChange={e => {
                              const arr = [...descVars]; arr[vi] = e.target.value
                              onUpdateRow(row.id, "descriptionVariations", arr)
                            }}
                            placeholder={`Variation ${vi + 2}...`}
                            className="flex-1 text-xs bg-muted/20 border border-transparent focus:border-border rounded px-2 py-1.5 outline-none placeholder:text-muted-foreground/40"
                          />
                          <button
                            onClick={() => {
                              const arr = descVars.filter((_, j) => j !== vi)
                              onUpdateRow(row.id, "descriptionVariations", arr)
                              if (arr.length === 0) setExpanded(row.id, { description: false })
                            }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <IconX className="size-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          onUpdateRow(row.id, "descriptionVariations", [...descVars, ""])
                          setExpanded(row.id, { description: true })
                        }}
                        className="text-xs text-primary hover:text-primary/90 text-left font-medium"
                      >
                        Description Variations {descVars.length > 0 ? `${descVars.length + 1} ` : ""}+
                      </button>
                    </div>
                  </td>

                  {/* AD SETS */}
                  <td className="px-3">
                    <AdSetPickerCell
                      selectedIds={row.adSetIds}
                      adSets={adSets}
                      onUpdate={ids => onUpdateRow(row.id, "adSetIds", ids)}
                    />
                  </td>

                  {/* AD PROFILE — per-row selectable */}
                  <td className="px-3">
                    {(() => {
                      const rowPageId = row.pageId || selectedPage?.id
                      const rowPage = pages.find(p => p.id === rowPageId) || selectedPage
                      const rowIgId = row.igId || selectedIgPageId
                      const rowIgAccounts = igAccountCache[rowPageId || ""] || []
                      const rowIg = rowIgAccounts.find(a => a.id === rowIgId) || igAccount
                      const isOpen = profilePopoverRow === row.id
                      return (
                        <div className="relative">
                          <button
                            onClick={e => {
                              if (isOpen) {
                                setProfilePopoverRow(null)
                                setProfilePopoverPos(null)
                              } else {
                                const rect = (e.currentTarget as HTMLElement).closest("td")!.getBoundingClientRect()
                                setProfilePopoverPos({ top: rect.bottom + 4, left: rect.left })
                                setProfilePopoverRow(row.id)
                              }
                            }}
                            className="flex flex-col gap-1 hover:opacity-80 transition-opacity group/profile min-w-0 w-full"
                            title="Click to change page / IG account"
                          >
                            {/* FB Page row */}
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className="size-5 rounded-full overflow-hidden bg-blue-100 shrink-0 ring-1 ring-border/60 group-hover/profile:ring-primary transition-all">
                                {rowPage?.picture?.data?.url
                                  ? <img src={rowPage.picture.data.url} className="w-full h-full object-cover" alt={rowPage.name} />
                                  : <div className="w-full h-full flex items-center justify-center"><IconBrandFacebook className="size-3 text-primary" /></div>}
                              </div>
                              <span className="text-xs truncate max-w-[100px] text-foreground/80">
                                {rowPage ? rowPage.name : <span className="text-muted-foreground/40">No page</span>}
                              </span>
                            </div>
                            {/* IG row */}
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className="size-5 rounded-full overflow-hidden shrink-0 ring-1 ring-border/60 group-hover/profile:ring-primary transition-all bg-gradient-to-br from-pink-500 to-purple-600">
                                {rowIg?.profile_pic
                                  ? <img src={rowIg.profile_pic} className="w-full h-full object-cover" alt={rowIg.username || "IG"} />
                                  : <div className="w-full h-full flex items-center justify-center"><IconBrandInstagram className="size-3 text-white" /></div>}
                              </div>
                              <span className="text-xs truncate max-w-[100px] text-foreground/60">
                                {rowIg ? `@${rowIg.username || rowIg.id}` : <span className="text-muted-foreground/40">@Use Facebook</span>}
                              </span>
                            </div>
                          </button>

                          {isOpen && profilePopoverPos && (
                            <div
                              ref={profilePopoverRef}
                              style={{ position: "fixed", top: profilePopoverPos.top, left: profilePopoverPos.left }}
                              className="z-[9999] bg-popover border rounded-xl shadow-xl w-64 py-1 overflow-hidden max-h-72 overflow-y-auto"
                            >
                              {/* FB Pages */}
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 py-1.5">Facebook Page</p>
                              {pages.length === 0 && (
                                <p className="text-xs text-muted-foreground px-3 py-2">No pages available</p>
                              )}
                              {pages.map(p => (
                                <button
                                  key={p.id}
                                  onClick={() => {
                                    onUpdateRow(row.id, "pageId", p.id)
                                    onUpdateRow(row.id, "igId", undefined)
                                  }}
                                  className={cn(
                                    "w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-left",
                                    (row.pageId === p.id || (!row.pageId && selectedPage?.id === p.id)) && "bg-primary/5 font-medium"
                                  )}
                                >
                                  <div className="size-6 rounded-full overflow-hidden bg-blue-100 shrink-0">
                                    {p.picture?.data?.url
                                      ? <img src={p.picture.data.url} className="w-full h-full object-cover" alt={p.name} />
                                      : <div className="w-full h-full flex items-center justify-center"><IconBrandFacebook className="size-3 text-primary" /></div>}
                                  </div>
                                  <span className="truncate">{p.name}</span>
                                  {(row.pageId === p.id || (!row.pageId && selectedPage?.id === p.id)) && (
                                    <IconCheck className="size-3 text-primary ml-auto shrink-0" />
                                  )}
                                </button>
                              ))}

                              {/* IG Accounts for selected page */}
                              {(() => {
                                const selPageId = row.pageId || selectedPage?.id || ""
                                const igAccounts = igAccountCache[selPageId] || []
                                if (!igAccounts.length) return null
                                return (
                                  <>
                                    <div className="border-t my-1" />
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 py-1.5">Instagram Account</p>
                                    {igAccounts.map(ig => (
                                      <button
                                        key={ig.id}
                                        onClick={() => onUpdateRow(row.id, "igId", ig.id)}
                                        className={cn(
                                          "w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-left",
                                          (row.igId === ig.id || (!row.igId && selectedIgPageId === ig.id)) && "bg-primary/5 font-medium"
                                        )}
                                      >
                                        <div className="size-6 rounded-full overflow-hidden bg-gradient-to-br from-pink-500 to-purple-600 shrink-0">
                                          {ig.profile_pic
                                            ? <img src={ig.profile_pic} className="w-full h-full object-cover" alt={ig.username || "IG"} />
                                            : <div className="w-full h-full flex items-center justify-center"><IconBrandInstagram className="size-3 text-white" /></div>}
                                        </div>
                                        <span className="truncate">@{ig.username || ig.id}</span>
                                        {(row.igId === ig.id || (!row.igId && selectedIgPageId === ig.id)) && (
                                          <IconCheck className="size-3 text-primary ml-auto shrink-0" />
                                        )}
                                      </button>
                                    ))}
                                  </>
                                )
                              })()}

                              <div className="border-t mt-1 px-3 py-1.5">
                                <button
                                  onClick={() => {
                                    onUpdateRow(row.id, "pageId", undefined)
                                    onUpdateRow(row.id, "igId", undefined)
                                    setProfilePopoverRow(null)
                                    setProfilePopoverPos(null)
                                  }}
                                  className="text-xs text-muted-foreground hover:text-foreground"
                                >
                                  Reset to gallery default
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </td>

                  {/* CTA */}
                  <td className="px-3">
                    <CtaPickerCell
                      value={row.cta}
                      onChange={v => onUpdateRow(row.id, "cta", v)}
                    />
                  </td>

                  {/* LINK */}
                  <td className="px-3">
                    <textarea
                      value={row.webLink || ""}
                      onChange={e => onUpdateRow(row.id, "webLink", e.target.value)}
                      placeholder="https://..."
                      rows={2}
                      className="w-full text-xs bg-muted/20 border border-transparent focus:border-border rounded px-2 py-1.5 outline-none resize-y placeholder:text-muted-foreground/40 leading-relaxed"
                    />
                  </td>

                  {/* URL TAGS */}
                  <td className="px-3">
                    <textarea
                      value={row.urlTags || ""}
                      onChange={e => onUpdateRow(row.id, "urlTags", e.target.value)}
                      placeholder="UTM parameters"
                      rows={2}
                      className="w-full text-xs bg-muted/20 border border-transparent focus:border-border rounded px-2 py-1.5 outline-none resize-y placeholder:text-muted-foreground/40 leading-relaxed"
                    />
                  </td>

                  {/* SITELINKS */}
                  <td className="px-3">
                    {row.sitelinks && row.sitelinks.length > 0
                      ? <button
                          onClick={() => setRowModal({ type: "sitelinks", rowId: row.id })}
                          className="flex items-center gap-1 text-xs text-primary/90 bg-primary/10 border border-primary/20 rounded px-2 py-1 hover:bg-blue-100 dark:bg-primary/20 dark:text-primary dark:border-blue-800 whitespace-nowrap"
                        >
                          <IconExternalLink className="size-3 shrink-0" />
                          {row.sitelinks.length} link{row.sitelinks.length > 1 ? "s" : ""}
                        </button>
                      : <button
                          onClick={() => setRowModal({ type: "sitelinks", rowId: row.id })}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border/50 rounded px-2 py-1 whitespace-nowrap"
                        >
                          <IconPlus className="size-3" />Add sitelinks
                        </button>
                    }
                  </td>

                  {/* PARTNERSHIP ADS */}
                  <td className="px-3">
                    {row.partnership?.enabled && row.partnership.partnerPageId
                      ? <button
                          onClick={() => setRowModal({ type: "partnership", rowId: row.id })}
                          className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800 max-w-[120px]"
                        >
                          <IconCheck className="size-3 shrink-0" />
                          <span className="truncate">Connected</span>
                        </button>
                      : <button
                          onClick={() => setRowModal({ type: "partnership", rowId: row.id })}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border/50 rounded px-2 py-1 whitespace-nowrap"
                        >
                          <IconPlus className="size-3" />Add Partner
                        </button>
                    }
                  </td>

                  {/* MULTI-LANGUAGE */}
                  <td className="px-3">
                    {row.multilanguage?.enabled && row.multilanguage.translations.length > 0
                      ? <button
                          onClick={() => setRowModal({ type: "multilanguage", rowId: row.id })}
                          className="flex items-center gap-1 text-xs text-primary/90 bg-primary/10 border border-primary/20 rounded px-2 py-1 hover:bg-blue-100 dark:bg-primary/20 dark:text-primary dark:border-blue-800"
                        >
                          <IconLanguage className="size-3" />
                          {row.multilanguage.translations.length} lang{row.multilanguage.translations.length > 1 ? "s" : ""}
                        </button>
                      : <button
                          onClick={() => setRowModal({ type: "multilanguage", rowId: row.id })}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border/50 rounded px-2 py-1 whitespace-nowrap"
                        >
                          <IconLanguage className="size-3" />Add Languages
                        </button>
                    }
                  </td>

                  {/* CATALOG */}
                  <td className="px-3">
                    {row.catalog?.enabled && row.catalog.catalogId
                      ? <button
                          onClick={() => setRowModal({ type: "catalog", rowId: row.id })}
                          className="flex flex-col items-start gap-0.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800 max-w-[120px]"
                        >
                          <span className="flex items-center gap-1 font-medium"><IconCheck className="size-3 shrink-0" />Enabled</span>
                          <span className="truncate text-xs opacity-70">{row.catalog.catalogName || row.catalog.catalogId}</span>
                        </button>
                      : <button
                          onClick={() => setRowModal({ type: "catalog", rowId: row.id })}
                          className="text-xs border border-dashed border-border/50 rounded px-2.5 py-1 hover:bg-muted/40 text-muted-foreground whitespace-nowrap"
                        >
                          Configure
                        </button>
                    }
                  </td>

                  {/* META SCHEDULE */}
                  <td className="px-3">
                    {row.schedule?.start
                      ? <button
                          onClick={() => setRowModal({ type: "schedule", rowId: row.id })}
                          className="text-left text-xs text-primary hover:text-primary/90 leading-snug"
                        >
                          <span className="block">{new Date(row.schedule.start).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                          {row.schedule.end && <span className="block opacity-70">→ {new Date(row.schedule.end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                        </button>
                      : <button
                          onClick={() => setRowModal({ type: "schedule", rowId: row.id })}
                          className="text-xs border border-border/60 rounded px-2.5 py-1 hover:bg-muted/40 text-foreground/70 font-medium"
                        >
                          Set
                        </button>
                    }
                  </td>

                  {/* PROMO CODE */}
                  <td className="px-3">
                    <input
                      type="text"
                      value={row.promoCode || ""}
                      onChange={e => onUpdateRow(row.id, "promoCode", e.target.value)}
                      placeholder="e.g., SAVE10"
                      className="w-full text-xs bg-muted/20 border border-transparent focus:border-border rounded px-2 py-1.5 outline-none placeholder:text-muted-foreground/40"
                    />
                  </td>

                  {/* LAUNCH STATUS */}
                  <td className="px-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onUpdateRow(row.id, "launchAsActive", row.launchAsActive === false ? true : row.launchAsActive === true ? false : !launchAsActive)}
                        className={cn(
                          "relative inline-flex h-4 w-8 items-center rounded-full transition-colors shrink-0",
                          (row.launchAsActive ?? launchAsActive) ? "bg-primary/100" : "bg-muted-foreground/30"
                        )}
                        title={(row.launchAsActive ?? launchAsActive) ? "Active" : "Paused"}
                      >
                        <span className={cn(
                          "inline-block size-3 rounded-full bg-white shadow-sm transition-transform",
                          (row.launchAsActive ?? launchAsActive) ? "translate-x-[18px]" : "translate-x-0.5"
                        )} />
                      </button>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {(row.launchAsActive ?? launchAsActive) ? "Active" : "Paused"}
                      </span>
                    </div>
                  </td>

                  {/* ACTIONS */}
                  <td className="px-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => onDuplicateRow(row.id)} className="text-muted-foreground hover:text-foreground" title="Duplicate row">
                        <IconCopy className="size-3.5" />
                      </button>
                      <button onClick={() => onDeleteRow(row.id)} className="text-muted-foreground hover:text-destructive" title="Delete row">
                        <IconTrash className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <button
          onClick={onAddRow}
          className="flex items-center gap-1.5 px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 w-full transition-colors border-b"
        >
          <IconPlus className="size-3.5" />Add New Row
        </button>
      </div>
      ) : viewMode === "single" ? (
        <div className="flex-1 overflow-y-auto">
          {filteredRows.map((row, i) => (
            <ListRowItem
              key={row.id}
              row={row}
              index={i}
              isSelected={selectedIds.has(row.id)}
              onToggleSelect={() => toggleRow(row.id)}
              onUpdateRow={onUpdateRow}
              onDeleteRow={onDeleteRow}
              onDuplicateRow={onDuplicateRow}
              onCreativeClick={() => handleCreativeCellClick(row.id)}
              onRowUpload={files => handleRowUpload(row.id, files)}
              uploadingRowId={uploadingRowId}
              adSets={adSets}
              launchAsActive={launchAsActive}
            />
          ))}
          <button
            onClick={onAddRow}
            className="flex items-center gap-1.5 px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 w-full transition-colors border-b"
          >
            <IconPlus className="size-3.5" />Add New Row
          </button>
        </div>
      ) : viewMode === "stacked" ? (
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {filteredRows.map((row, i) => (
            <RecordCard
              key={row.id}
              row={row}
              index={i}
              isSelected={selectedIds.has(row.id)}
              onToggleSelect={() => toggleRow(row.id)}
              onUpdateRow={onUpdateRow}
              onDeleteRow={onDeleteRow}
              onDuplicateRow={onDuplicateRow}
              onCreativeClick={() => handleCreativeCellClick(row.id)}
              onRowUpload={files => handleRowUpload(row.id, files)}
              uploadingRowId={uploadingRowId}
              adSets={adSets}
              launchAsActive={launchAsActive}
            />
          ))}
          <button
            onClick={onAddRow}
            className="flex items-center gap-1.5 px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 w-full transition-colors border-b"
          >
            <IconPlus className="size-3.5" />Add New Row
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="grid gap-3 p-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {filteredRows.map((row, i) => (
              <GridCard
                key={row.id}
                row={row}
                index={i}
                isSelected={selectedIds.has(row.id)}
                onToggleSelect={() => toggleRow(row.id)}
                onUpdateRow={onUpdateRow}
                onDeleteRow={onDeleteRow}
                onDuplicateRow={onDuplicateRow}
                onCreativeClick={() => handleCreativeCellClick(row.id)}
                onRowUpload={files => handleRowUpload(row.id, files)}
                uploadingRowId={uploadingRowId}
                adSets={adSets}
                launchAsActive={launchAsActive}
              />
            ))}
          </div>
          <button
            onClick={onAddRow}
            className="flex items-center gap-1.5 px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 w-full transition-colors border-b"
          >
            <IconPlus className="size-3.5" />Add New Row
          </button>
        </div>
      )}

      {/* Bulk selection bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 dark:bg-blue-950/20 border-t border-primary/20 dark:border-primary/20 shrink-0">
          <span className="text-xs text-primary/90 dark:text-primary font-medium">
            {selectedCount} of {filteredRows.length} row{filteredRows.length !== 1 ? "s" : ""} selected
          </span>
          <button
            onClick={() => { Array.from(selectedIds).forEach(id => onDuplicateRow(id)); setSelectedIds(new Set()) }}
            className="text-xs text-primary hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
          >
            Duplicate {selectedCount} Row{selectedCount !== 1 ? "s" : ""}
          </button>
          <button
            onClick={() => { Array.from(selectedIds).forEach(id => onDeleteRow(id)); setSelectedIds(new Set()) }}
            className="text-xs text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            Remove {selectedCount} Row{selectedCount !== 1 ? "s" : ""}
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-muted-foreground hover:text-foreground">
            <IconX className="size-3.5" />
          </button>
        </div>
      )}
    </div>

    {/* ── Per-row modals ─────────────────────────────────────────────────────── */}
    {(() => {
      if (!rowModal) return null
      const { type, rowId } = rowModal
      const row = rows.find(r => r.id === rowId)
      if (!row) return null
      const close = () => setRowModal(null)

      if (type === "partnership") return (
        <PartnershipAdsModal
          open onClose={close}
          pages={pages}
          selectedPageId={row.pageId || selectedPage?.id || ""}
          selectedIgId={row.igId || selectedIgPageId}
          igAccountCache={igAccountCache}
          value={row.partnership || DEFAULT_PARTNERSHIP}
          onConfirm={v => { onUpdateRow(rowId, "partnership", v); close() }}
        />
      )

      if (type === "multilanguage") return (
        <MultilanguageAdsModal
          open onClose={close}
          value={row.multilanguage || DEFAULT_MULTILANGUAGE}
          basePrimaryText={row.primaryText}
          baseHeadline={row.headline}
          baseDescription={row.description}
          onConfirm={v => { onUpdateRow(rowId, "multilanguage", v); close() }}
        />
      )

      if (type === "catalog") return (
        <CatalogAdsModal
          open onClose={close}
          adAccountId={selectedAccountId}
          value={row.catalog || DEFAULT_CATALOG}
          onConfirm={v => { onUpdateRow(rowId, "catalog", v); close() }}
        />
      )

      if (type === "schedule") return (
        <ScheduleModal
          open onClose={close}
          onConfirm={(start, end) => {
            onUpdateRow(rowId, "schedule", { start, end: end || undefined })
            close()
          }}
        />
      )

      if (type === "sitelinks") return (
        <SitelinksModal
          open onClose={close}
          value={row.sitelinks || []}
          onConfirm={v => { onUpdateRow(rowId, "sitelinks", v); close() }}
        />
      )

      return null
    })()}

    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// useSearchParams needs a Suspense boundary — the real page lives in LaunchPageContent.
export default function LaunchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading launcher…</div>}>
      <LaunchPageContent />
    </Suspense>
  )
}

function LaunchPageContent() {
  const { selectedAccountId, selectedAccount, adAccounts, setSelectedAccountId, loading: adAccountsLoading } = useAdAccount()
  const { activeOrgId } = useOrg()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [mode, setMode] = useState<"gallery" | "table">("gallery")
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false)
  const [adSetsRefreshKey, setAdSetsRefreshKey] = useState(0)

  const [pages, setPages] = useState<FacebookPage[]>([])
  const [selectedPageId, setSelectedPageId] = useState("")
  const [selectedIgPageId, setSelectedIgPageId] = useState("")
  const [igAccountCache, setIgAccountCache] = useState<Record<string, IgAccount[]>>({})
  const [adProfilesOpen, setAdProfilesOpen] = useState(false)
  const sanitizePages = (items: FacebookPage[]): FacebookPage[] => (
    items.map((page) => ({
      ...page,
      picture: {
        data: {
          url: `/api/facebook/page-picture?page_id=${encodeURIComponent(page.id)}`,
        },
      },
    }))
  )

  // Lưu page/IG preference cho từng ad account
  const PAGE_PREFS_KEY = activeOrgId ? `launch_page_prefs:${activeOrgId}` : "launch_page_prefs"
  const getPagePrefs = (): Record<string, { pageId: string; igId: string }> => {
    try { return JSON.parse(localStorage.getItem(PAGE_PREFS_KEY) || "{}") } catch { return {} }
  }
  const savePagePref = (accountId: string, pageId: string, igId: string) => {
    const prefs = getPagePrefs()
    prefs[accountId] = { pageId, igId }
    localStorage.setItem(PAGE_PREFS_KEY, JSON.stringify(prefs))
  }

  const [selectedAdSets, setSelectedAdSets] = useState<AdSet[]>([])
  const [primaryTexts, setPrimaryTexts] = useState<string[]>([""])
  const [headlines, setHeadlines] = useState<string[]>([""])
  const [descriptions, setDescriptions] = useState<string[]>([""])
  const [cta, setCta] = useState("LEARN_MORE")
  const [webLink, setWebLink] = useState("")
  const [launchAsActive, setLaunchAsActive] = useState(false)
  const [oneAdPerAdset, _setOneAdPerAdset] = useState(false)

  // Sync state both ways: when user toggles oneAdPerAdset outside, write it back
  // into the Default Ad Settings stored in localStorage.
  const setOneAdPerAdset = (val: boolean) => {
    _setOneAdPerAdset(val)
    if (!selectedAccountId) return
    try {
      const key = `default_ad_settings_${selectedAccountId}`
      const raw = localStorage.getItem(key)
      const current = raw ? JSON.parse(raw) : {}
      const updated = {
        ...DEFAULT_SETTINGS,
        ...current,
        launch: {
          ...(current.launch || DEFAULT_SETTINGS.launch),
          oneAdPerAdset: val
        }
      }
      localStorage.setItem(key, JSON.stringify(updated))
    } catch {}
  }
  const [adSourceMode, setAdSourceMode] = useState<AdSourceMode>("new_ad")
  const [adSourceIds, setAdSourceIds] = useState<Record<string, string>>({})
  const [utmParams, setUtmParams] = useState("")
  const [displayLink, setDisplayLink] = useState("")
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set())
  const [selectedCreatives, setSelectedCreatives] = useState<Creative[]>([])
  const [adNameOverrides, setAdNameOverrides] = useState<Record<string, string>>({})
  const thumbRetryCounts = useRef<Map<string, number>>(new Map())

  /**
   * True while a draft is being restored. Two effects below run whenever selectedAccountId
   * changes and write into the same state a restore is writing: one re-reads the saved
   * creative selection from localStorage, the other applies that account's Default Ad
   * Settings over empty copy fields. Restoring a draft changes the account, so without this
   * guard the draft's own selection and copy lose the race against them.
   */
  const restoringDraft = useRef(false)

  // ─── Prefill from URL (?template=<id> or ?from_ad=<id>&ad_account_id=<id>) ───
  // Read once on mount: the params are consumed and stripped, so later renders
  // must not see them again and re-run the prefill over the user's edits.
  const urlTemplateId = useRef(searchParams.get("template")).current
  const urlFromAdId = useRef(searchParams.get("from_ad")).current
  const urlFromAdAccount = useRef(searchParams.get("ad_account_id")).current
  const hasUrlPrefill = !!(urlTemplateId || urlFromAdId)
  const [prefillBanner, setPrefillBanner] = useState("")
  const [prefillError, setPrefillError] = useState("")

  // ─── Persistence: save selected creative IDs per ad account in localStorage ───
  const SELECTION_KEY = "launch_selected_creatives"

  // Restore selection when ad account is set / changed
  useEffect(() => {
    // A URL prefill owns the creative selection; don't let the saved selection
    // race in and overwrite the creatives the template/ad brought with it. A draft being
    // restored owns it for the same reason.
    if (hasUrlPrefill || restoringDraft.current) return
    if (!selectedAccountId) return
    try {
      const all = JSON.parse(localStorage.getItem(SELECTION_KEY) || "{}")
      const saved = all[selectedAccountId] as { ids: string[]; names: Record<string, string> } | undefined
      if (!saved || !saved.ids?.length) {
        setSelectedMediaIds(new Set())
        setSelectedCreatives([])
        setAdNameOverrides({})
        return
      }
      fetch(`/api/creatives?ad_account_id=${encodeURIComponent(selectedAccountId)}`)
        .then(r => r.json())
        .then(d => {
          const list: Creative[] = d.creatives || []
          const byId = new Map(list.map(c => [c.id, c]))
          const restored = saved.ids.map(id => byId.get(id)).filter(Boolean) as Creative[]
          setSelectedCreatives(restored)
          setSelectedMediaIds(new Set(restored.map(c => c.id)))
          setAdNameOverrides(saved.names || {})
        })
        .catch(() => {})
    } catch {}
  }, [selectedAccountId])

  // Load Default Ad Settings when account changes → pre-fill empty form fields
  useEffect(() => {
    if (!selectedAccountId) return
    // A draft carries its own copy, links and launch flag; account defaults must not
    // overwrite them just because restoring changed the account.
    if (restoringDraft.current) return
    try {
      const raw = localStorage.getItem(`default_ad_settings_${selectedAccountId}`)
      if (!raw) return
      const s: DefaultAdSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
      // Pre-fill ad copy only when fields are empty (don't overwrite user input)
      if (!primaryTexts[0]?.trim() && s.adCopy.primaryText) setPrimaryTexts([s.adCopy.primaryText])
      if (!headlines[0]?.trim() && s.adCopy.headline) setHeadlines([s.adCopy.headline])
      if (!descriptions.some(d => d.trim()) && s.adCopy.description) setDescriptions([s.adCopy.description])
      if (s.adCopy.cta) setCta(s.adCopy.cta)
      // Pre-fill web/app links
      if (!webLink && s.links.webLink) setWebLink(s.links.webLink)
      if (!utmParams && s.links.utmParameters) setUtmParams(s.links.utmParameters)
      if (!displayLink && s.links.displayLink) setDisplayLink(s.links.displayLink)
      // Apply launch defaults
      setLaunchAsActive(!s.launch.launchAsPaused)
      setOneAdPerAdset(!!s.launch.oneAdPerAdset)
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  // ─── Apply the URL prefill (Templates → Launch, Ads Manager → To Launcher) ───
  // Runs once. Copy always applies; creatives only when the source media exists
  // in this workspace's library — otherwise the user is told to pick media.
  const prefillApplied = useRef(false)
  useEffect(() => {
    if (!hasUrlPrefill || prefillApplied.current) return
    prefillApplied.current = true

    const selectCreativesFor = async (
      accountId: string,
      match: { ids?: string[]; imageHash?: string | null; videoId?: string | null }
    ): Promise<number> => {
      try {
        const r = await fetch(`/api/creatives?ad_account_id=${encodeURIComponent(accountId)}`)
        const d = await r.json()
        const list: Creative[] = d.creatives || []
        let picked: Creative[] = []
        if (match.ids?.length) {
          const byId = new Map(list.map(c => [c.id, c]))
          picked = match.ids.map(id => byId.get(id)).filter(Boolean) as Creative[]
        }
        // No stored ids (or they're gone): fall back to Meta's media identifiers,
        // which is how the same asset is recognized across ad accounts.
        if (!picked.length && (match.imageHash || match.videoId)) {
          picked = list.filter(c =>
            (match.imageHash && c.fb_image_hash === match.imageHash) ||
            (match.videoId && c.fb_video_id === match.videoId)
          )
        }
        if (picked.length) {
          setSelectedCreatives(picked)
          setSelectedMediaIds(new Set(picked.map(c => c.id)))
        }
        return picked.length
      } catch {
        return 0
      }
    }

    const applyCopy = (c: { primary_text?: string | null; headline?: string | null; description?: string | null; cta?: string | null; link?: string | null }) => {
      if (c.primary_text) setPrimaryTexts([c.primary_text])
      if (c.headline) setHeadlines([c.headline])
      if (c.description) setDescriptions([c.description])
      if (c.cta) setCta(c.cta)
      if (c.link) setWebLink(c.link)
    }

    const run = async () => {
      try {
        if (urlTemplateId) {
          const r = await fetch(`/api/templates/${encodeURIComponent(urlTemplateId)}`)
          const d = await r.json()
          if (!r.ok) throw new Error(d.error || "Template not found")
          const t = d.template
          const accountId = t.ad_account_id || selectedAccountId
          if (t.ad_account_id && t.ad_account_id !== selectedAccountId) setSelectedAccountId(t.ad_account_id)
          applyCopy(t)
          const n = accountId
            ? await selectCreativesFor(accountId, {
                ids: t.media?.creative_ids,
                imageHash: t.media?.image_hash,
                videoId: t.media?.video_id,
              })
            : 0
          setPrefillBanner(n > 0
            ? `Template "${t.name}" loaded — ${n} creative${n > 1 ? "s" : ""} preselected. Pick your ad sets, then launch.`
            : `Template "${t.name}" loaded (copy only) — chọn media rồi launch.`)
        } else if (urlFromAdId && urlFromAdAccount) {
          const r = await fetch(`/api/facebook/ad-detail?ad_id=${encodeURIComponent(urlFromAdId)}&ad_account_id=${encodeURIComponent(urlFromAdAccount)}`)
          const d = await r.json()
          if (!r.ok) throw new Error(d.error || "Failed to load ad")
          const ad = d.ad
          if (urlFromAdAccount !== selectedAccountId) setSelectedAccountId(urlFromAdAccount)
          applyCopy({
            primary_text: ad.primaryText,
            headline: ad.headline,
            description: ad.description,
            cta: ad.cta,
            link: ad.link,
          })
          const n = await selectCreativesFor(urlFromAdAccount, {
            imageHash: ad.image_hash,
            videoId: ad.video_id,
          })
          setPrefillBanner(n > 0
            ? `Copied from ad "${ad.name}" — ${n} creative${n > 1 ? "s" : ""} preselected. Pick your ad sets, then launch.`
            : `Copied from ad "${ad.name}" (copy only) — media của ad này chưa có trong library, chọn media rồi launch.`)
        } else if (urlFromAdId) {
          throw new Error("Missing ad_account_id")
        }
      } catch (err: any) {
        setPrefillError(err.message || "Could not prefill from the link")
      } finally {
        // Drop the params so a refresh doesn't re-apply the prefill on top of edits.
        router.replace("/launch")
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
    }
    run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Polling for missing thumbnails in selected creatives (max 10 retries per video ~100s at 10s)
  useEffect(() => {
    const MAX_RETRIES = 10
    const pending = selectedCreatives.filter(c =>
      c.media_type === "video" &&
      c.fb_video_id &&
      !(c.fb_thumbnail_url && /^https?:/.test(c.fb_thumbnail_url) && !c.fb_thumbnail_url.includes("rsrc.php")) &&
      !c.id.startsWith("temp_") &&
      (thumbRetryCounts.current.get(c.id) ?? 0) < MAX_RETRIES
    )
    if (pending.length === 0) return

    const tick = async () => {
      if (document.hidden) return
      const toCheck = pending.slice(0, 2)
      for (const c of toCheck) {
        thumbRetryCounts.current.set(c.id, (thumbRetryCounts.current.get(c.id) ?? 0) + 1)
        try {
          const res = await fetch(`/api/creatives/${c.id}/thumbnail`, { method: "POST" })
          const data = await res.json()
          // Always propagate status from server (processing → ready) so Ad Source dot updates correctly.
          // Only update file fields when the endpoint returns actual values to avoid overwriting blob URL.
          const hasNewData = data.thumbnail_url || data.source_url
          const statusChanged = data.creative?.status && data.creative.status !== c.status
          if (hasNewData || statusChanged) {
            setSelectedCreatives(prev => prev.map(x =>
              x.id === c.id
                ? {
                    ...x,
                    ...(data.thumbnail_url ? { fb_thumbnail_url: data.thumbnail_url } : {}),
                    ...(data.source_url ? { file_url: data.source_url } : {}),
                    ...(data.creative?.status ? { status: data.creative.status } : {}),
                  }
                : x
            ))
          }
        } catch {}
      }
    }

    tick()
    const interval = setInterval(tick, 10000)
    const onVisible = () => { if (!document.hidden) tick() }
    document.addEventListener("visibilitychange", onVisible)

    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible) }
  }, [selectedCreatives])

  // Polling for videos awaiting Meta upload (status=pending, no fb_video_id) — 5s interval
  useEffect(() => {
    const pending = selectedCreatives.filter(c =>
      c.media_type === "video" && !c.fb_video_id && !c.id.startsWith("temp_")
    )
    if (pending.length === 0) return

    const tick = async () => {
      if (document.hidden) return
      for (const c of pending.slice(0, 2)) {
        try {
          const res = await fetch(`/api/creatives/${c.id}`)
          if (!res.ok) continue
          const data = await res.json()
          const updated = data.creative || data
          if (updated.fb_video_id || updated.status === "ready" || updated.status === "processing" || updated.status === "error") {
            setSelectedCreatives(prev => prev.map(x => x.id === c.id ? { ...x, ...updated } : x))
          }
        } catch {}
      }
    }

    tick() // check immediately on mount
    const interval = setInterval(tick, 5000)
    return () => clearInterval(interval)
  }, [selectedCreatives])

  // Save selection whenever creatives or names change (debounced via effect cycle)
  useEffect(() => {
    if (!selectedAccountId) return
    try {
      const all = JSON.parse(localStorage.getItem(SELECTION_KEY) || "{}")
      // Only persist creatives that have a real DB ID (not temp_ blob previews)
      const realIds = selectedCreatives.filter(c => !c.id.startsWith("temp_") && !c.id.startsWith("existing_")).map(c => c.id)
      if (realIds.length === 0) {
        delete all[selectedAccountId]
      } else {
        all[selectedAccountId] = { ids: realIds, names: adNameOverrides }
      }
      localStorage.setItem(SELECTION_KEY, JSON.stringify(all))
    } catch {}
  }, [selectedAccountId, selectedCreatives, adNameOverrides])

  const [tableRows, setTableRows] = useState<TableRow[]>([
    { id: "1", creative: null, adName: "", primaryText: "", headline: "", description: "", adSetIds: [] }
  ])
  const [allAdSets, setAllAdSets] = useState<AdSet[]>([])
  const [tableViewMode, setTableViewMode] = useState<"single" | "stacked" | "grid" | "side-by-side">("side-by-side")
  const [toolbarNotice, setToolbarNotice] = useState("")

  const [sheetsImportOpen, setSheetsImportOpen] = useState(false)
  const [mediaModalOpen, setMediaModalOpen] = useState(false)
  const [creativePickerRowId, setCreativePickerRowId] = useState<string | null>(null)
  // Increment to force LoadMediaModal Library tab to re-fetch (used after a new upload completes)
  const [mediaRefreshSignal, setMediaRefreshSignal] = useState(0)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  // Preview-before-launch gate: force a preview step before each launch, with an opt-out
  const PREVIEW_SKIP_KEY = "launch_skip_preview_gate"
  const [skipPreviewGate, setSkipPreviewGate] = useState(false)
  const [previewConfirmMode, setPreviewConfirmMode] = useState(false)
  // Only show the "skip preview next time" opt-out when the gate opened the modal,
  // not when the user proactively clicked Preview
  const [previewShowSkip, setPreviewShowSkip] = useState(false)
  const pendingLaunchRef = useRef<null | (() => void)>(null)
  useEffect(() => {
    try { setSkipPreviewGate(localStorage.getItem(PREVIEW_SKIP_KEY) === "1") } catch {}
  }, [])
  const updateSkipPreviewGate = (skip: boolean) => {
    setSkipPreviewGate(skip)
    try { localStorage.setItem(PREVIEW_SKIP_KEY, skip ? "1" : "0") } catch {}
  }
  // Pre-launch gate: run the right validator (table rows vs. gallery form) before Preview
  // or Launch is allowed to do anything, so incomplete setups block immediately instead of
  // surfacing only after Confirm & Launch inside the modal.
  const validateBeforeLaunch = (): boolean => {
    const hasRowCreatives = tableRows.some(r => r.creative?.id && r.adSetIds.length > 0)
    return hasRowCreatives ? validateTableRows() : validate()
  }
  // Open the preview modal with a pending launch action so the user can confirm & launch from inside it.
  // showSkip=true only when the launch gate opened it (offers the opt-out); false for a proactive Preview click.
  const openPreview = (launchFn: () => void, showSkip = false) => {
    if (!validateBeforeLaunch()) return
    pendingLaunchRef.current = launchFn
    setPreviewConfirmMode(true)
    setPreviewShowSkip(showSkip)
    setPreviewModalOpen(true)
  }
  const requestLaunch = (launchFn: () => void) => {
    if (!validateBeforeLaunch()) return
    if (!skipPreviewGate && selectedCreatives.length > 0) {
      openPreview(launchFn, true)
    } else {
      launchFn()
    }
  }
  const confirmPendingLaunch = () => {
    setPreviewModalOpen(false)
    setPreviewConfirmMode(false)
    const fn = pendingLaunchRef.current
    pendingLaunchRef.current = null
    fn?.()
  }
  const closePreviewModal = () => {
    setPreviewModalOpen(false)
    setPreviewConfirmMode(false)
    pendingLaunchRef.current = null
  }
  const [partnershipModalOpen, setPartnershipModalOpen] = useState(false)
  const [partnership, setPartnership] = useState<PartnershipState>({
    enabled: false,
    partnerPageId: "",
    partnerIgId: "",
    displayMode: "both",
    partnerFirstInDisplay: false,
  })
  const [multilanguageOpen, setMultilanguageOpen] = useState(false)
  const [multilanguage, setMultilanguage] = useState<MultilanguageState>({
    enabled: false,
    defaultLanguage: "en_US",
    translations: [],
  })
  const [adFormatPopoverOpen, setAdFormatPopoverOpen] = useState(false)
  const [collectionModalOpen, setCollectionModalOpen] = useState(false)
  const [catalogModalOpen, setCatalogModalOpen] = useState(false)
  const [adFormat, setAdFormat] = useState<AdFormatState>({ type: "single" })
  const [collectionAds, setCollectionAds] = useState<CollectionAdsState>({
    enabled: false,
    templateType: "storefront",
    catalogId: "", catalogName: "", catalogVertical: "",
    productSetId: "", productSetName: "",
    productCount: 4,
    order: "dynamic",
    productHeadlineChips: ["product_name"],
    productDescriptionChips: ["current_price"],
    ieHeadline: "",
    destinationUrl: "",
  })
  const [catalogAds, setCatalogAds] = useState<CatalogAdsState>({
    enabled: false,
    formatMode: "automatic",
    format: "single",
    frameImageUrl: "",
    dynamicMedia: { optimizedMediaSelection: false, automaticVideoCropping: false, prioritizeVideo: false },
    catalogId: "", catalogName: "",
    productSetId: "", productSetName: "",
    hideAutoCreatedSets: false,
  })
  const [carouselModalOpen, setCarouselModalOpen] = useState(false)
  const [carouselAds, setCarouselAds] = useState<CarouselAdsState>({
    enabled: false,
    carousels: [],
  })
  const [flexibleModalOpen, setFlexibleModalOpen] = useState(false)
  const [creativeGroupModalOpen, setCreativeGroupModalOpen] = useState(false)
  const [flexibleAds, setFlexibleAds] = useState<FlexibleAdsState>({
    enabled: false,
    flexibleAds: [],
  })
  const [multiPlacementModalOpen, setMultiPlacementModalOpen] = useState(false)
  const [multiPlacementAds, setMultiPlacementAds] = useState<MultiPlacementAdsState>({
    enabled: false,
    manualPlacements: false,
    groups: [],
  })
  const adFormatRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (adFormatRef.current && !adFormatRef.current.contains(e.target as Node)) setAdFormatPopoverOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const [launching, setLaunching] = useState(false)
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null)
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>("idle")
  const [launchProgressOpen, setLaunchProgressOpen] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(550)
  const [isResizing, setIsResizing] = useState(false)
  const videoMissingThumbCount = selectedCreatives.filter(c => c.media_type === "video" && !c.fb_thumbnail_url).length
  const [historyReload, setHistoryReload] = useState(0)
  const [error, setError] = useState("")
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({})
  const clearValidationError = useCallback((field: string) => setValidationErrors(prev => {
    if (!prev[field]) return prev
    const next = { ...prev }
    delete next[field]
    if (Object.keys(next).length === 0) setError("")
    return next
  }), [])

  useEffect(() => { if (selectedAdSets.length > 0) clearValidationError("adsets") }, [selectedAdSets.length, clearValidationError])
  useEffect(() => { if (selectedMediaIds.size > 0) clearValidationError("creatives") }, [selectedMediaIds.size, clearValidationError])
  useEffect(() => { if (/^https?:\/\//.test(webLink.trim())) clearValidationError("webLink") }, [webLink, clearValidationError])
  useEffect(() => { if (selectedPageId) clearValidationError("page") }, [selectedPageId, clearValidationError])
  const [relaunchBanner, setRelaunchBanner] = useState("")
  const [savingDraft, setSavingDraft] = useState(false)
  const [historyTabOverride, setHistoryTabOverride] = useState<"launches" | "drafts" | "scheduled" | null>(null)

  // Upload dock state — per-file progress tracking
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [uploadDockOpen, setUploadDockOpen] = useState(false)
  // Map from tempCreativeId → canvas thumbnail blob; uploaded to Supabase after video upload
  const pendingThumbBlobsRef = useRef<Map<string, Blob>>(new Map())

  const updateUpload = (id: string, patch: Partial<UploadItem>) => {
    setUploads(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u))
  }

  const cancelUpload = (id: string) => {
    setUploads(prev => prev.map(u => {
      if (u.id !== id) return u
      u.xhr?.abort()
      return { ...u, status: "cancelled", xhr: undefined }
    }))
  }
  const clearUploads = () => {
    setUploads(prev => prev.filter(u => u.status === "uploading"))
  }
  const closeUploadDock = () => {
    // Cancel all in-progress and clear
    uploads.forEach(u => u.xhr?.abort())
    setUploads([])
    setUploadDockOpen(false)
  }

  // Meta error objects carry `code`/`error_subcode`/`error_user_msg` beyond `.message` —
  // surface them so a failure is diagnosable from the upload dock alone, no devtools needed.
  const formatMetaError = (error: any): string => {
    if (!error) return "Upload failed"
    // console.warn (not .error) — Next.js dev overlay treats console.error as a blocking crash screen
    console.warn("[video upload] Meta error:", error)
    const base = error.error_user_msg || error.message || "Upload failed"
    const parts = [base]
    if (error.code != null) parts.push(`code ${error.code}${error.error_subcode != null ? `/${error.error_subcode}` : ""}`)
    return parts.join(" — ")
  }

  // Upload strategy:
  //   Images → signed Supabase URL + XHR PUT (small files, no size issue) + finalize
  //   Videos → direct Meta API chunked upload from browser (proven approach, no proxy limits)
  const uploadOneFile = async (item: UploadItem): Promise<Creative | null> => {
    if (item.file.size > 500 * 1024 * 1024) {
      updateUpload(item.id, {
        status: "error",
        error: `File too large (${(item.file.size / 1024 / 1024).toFixed(0)} MB). Max 500 MB.`,
      })
      return null
    }

    const currentPrimary  = primaryTexts.find(t => t.trim()) || ""
    const currentHeadline = headlines.find(h => h.trim()) || ""
    const isVideo = item.file.type.startsWith("video/")

    // ── VIDEO: upload directly to Meta API from browser ───────────────────
    // Supabase PUT drops large files (~87 MB) due to storage server body limits.
    // Meta API chunked upload is the proven fix (same pattern as bulk-upload-dialog).
    if (isVideo) {
      console.warn("[DEBUG video meta]", { type: item.file.type, size: item.file.size, name: item.file.name })
      // Dedup: same file already uploaded → reuse, skip ALL Meta API calls
      try {
        const dupRes = await fetch(`/api/creatives?file_name=${encodeURIComponent(item.file.name)}&file_size=${item.file.size}`)
        if (dupRes.ok) {
          const { creatives = [] } = await dupRes.json()
          const existing = creatives[0]
          if (existing?.fb_video_id) {
            updateUpload(item.id, { status: "completed", uploaded: item.fileSize, eta: 0, speed: 0, creativeId: existing.id })
            return existing as Creative
          }
        }
      } catch {}

      const credUrl = selectedAccountId
        ? `/api/facebook/upload-credentials?adAccountId=${selectedAccountId}`
        : "/api/facebook/upload-credentials"

      let accessToken: string, adAccountId: string
      try {
        const credRes = await fetch(credUrl, { method: "POST" })
        if (!credRes.ok) {
          const e = await credRes.json().catch(() => ({}))
          throw new Error((e as any).error || "Failed to get upload credentials")
        }
        ;({ accessToken, adAccountId } = await credRes.json())
      } catch (err: any) {
        updateUpload(item.id, { status: "error", error: err.message || "Failed to get credentials" })
        return null
      }

      const cleanId    = adAccountId.replace(/^act_/, "")
      const FB_VIDEOS  = `https://graph.facebook.com/v25.0/act_${cleanId}/advideos`
      const DIRECT_LIMIT = 100 * 1024 * 1024 // ≤100 MB: direct POST
      let CHUNK_SIZE = 4 * 1024 * 1024
      if (item.file.size > 150 * 1024 * 1024) CHUNK_SIZE = 20 * 1024 * 1024
      else if (item.file.size > 50 * 1024 * 1024) CHUNK_SIZE = 10 * 1024 * 1024

      // Meta's transcode pipeline is known to be flaky for large/high-fps chunked
      // uploads — a single transient failure otherwise kills the whole upload even
      // though the same bytes succeed on a later attempt (matches Meta's own tools,
      // which retry internally). Retry the whole session from scratch a few times
      // before surfacing an error, instead of failing on the first hiccup.
      const MAX_UPLOAD_ATTEMPTS = 3
      let fbVideoId: string | null = null
      let lastError = "Upload failed"

      for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS && !fbVideoId; attempt++) {
        const attemptResult: { videoId: string } | { error: string } = await (async () => {
          if (item.file.size <= DIRECT_LIMIT) {
            // ── Direct POST to Meta ─────────────────────────────────────────
            const form = new FormData()
            form.append("source", item.file)
            form.append("title", item.file.name)
            form.append("access_token", accessToken)

            return new Promise<{ videoId: string } | { error: string }>((resolve) => {
              const xhr = new XMLHttpRequest()
              let lastTick = Date.now(), lastLoaded = 0
              xhr.upload.onprogress = (e) => {
                if (!e.lengthComputable) return
                const now = Date.now(), dt = (now - lastTick) / 1000
                const speed = dt > 0 ? (e.loaded - lastLoaded) / dt : 0
                lastTick = now; lastLoaded = e.loaded
                updateUpload(item.id, { uploaded: e.loaded, fileSize: e.total, speed, eta: speed > 0 ? (e.total - e.loaded) / speed : 0 })
              }
              xhr.onload = () => {
                const d = JSON.parse(xhr.responseText || "{}")
                if (xhr.status < 300 && d.id) resolve({ videoId: d.id })
                else resolve({ error: d.error ? formatMetaError(d.error) : `Upload failed (${xhr.status})` })
              }
              xhr.onerror = () => resolve({ error: "Network error connecting to Meta" })
              xhr.onabort = () => { updateUpload(item.id, { status: "cancelled" }); resolve({ error: "__cancelled__" }) }
              xhr.open("POST", FB_VIDEOS)
              updateUpload(item.id, { xhr })
              xhr.send(form)
            })

          } else {
            // ── Chunked upload: START → TRANSFER × N → FINISH ──────────────
            const startForm = new FormData()
            startForm.append("upload_phase", "start")
            startForm.append("file_size", String(item.file.size))
            startForm.append("access_token", accessToken)
            let startData: any
            try {
              const startRes = await fetch(FB_VIDEOS, { method: "POST", body: startForm })
              startData = await startRes.json()
            } catch (err: any) {
              return { error: err?.message || "Network error starting upload session" }
            }
            if (startData.error) return { error: formatMetaError(startData.error) }

            const { upload_session_id, video_id } = startData
            let startOffset = parseInt(startData.start_offset || "0")
            let endOffset   = parseInt(startData.end_offset   || String(Math.min(CHUNK_SIZE, item.file.size)))

            // Per-chunk retry budget. A single transfer failing at a random early
            // offset (code 6000/1363048) previously tore down the whole session and
            // restarted from byte 0 — re-uploading everything. Meta's transfer phase
            // is idempotent per start_offset, so instead we re-send just the failed
            // chunk at the same offset, preserving all prior progress. Only if a chunk
            // exhausts its retries do we surface an error (and let the outer session
            // loop try once more from scratch as a last resort).
            const MAX_CHUNK_ATTEMPTS = 4
            while (startOffset < item.file.size) {
              const snapStart = startOffset // progress snapshot + fixed retry offset for this chunk

              let offsets: { so: number; eo: number } | { error: string } | null = null
              for (let cAttempt = 1; cAttempt <= MAX_CHUNK_ATTEMPTS; cAttempt++) {
                // Preserve MIME type on the slice — Blob.slice() defaults to type ""
                // when omitted, so chunks were going out as application/octet-stream.
                const chunk     = item.file.slice(snapStart, endOffset, item.file.type)
                const chunkForm = new FormData()
                chunkForm.append("upload_phase",      "transfer")
                chunkForm.append("upload_session_id", upload_session_id)
                chunkForm.append("start_offset",      String(snapStart))
                chunkForm.append("video_file_chunk",  chunk, item.file.name)
                chunkForm.append("access_token",      accessToken)

                offsets = await new Promise<{ so: number; eo: number } | { error: string }>((resolve) => {
                  const xhr = new XMLHttpRequest()
                  let lastTick = Date.now(), lastLoaded = 0
                  xhr.upload.onprogress = (e) => {
                    if (!e.lengthComputable) return
                    const now = Date.now(), dt = (now - lastTick) / 1000
                    const speed = dt > 0 ? (e.loaded - lastLoaded) / dt : 0
                    lastTick = now; lastLoaded = e.loaded
                    const totalUploaded = snapStart + e.loaded
                    updateUpload(item.id, { uploaded: totalUploaded, fileSize: item.file.size, speed, eta: speed > 0 ? (item.file.size - totalUploaded) / speed : 0 })
                  }
                  xhr.onload = () => {
                    const d = JSON.parse(xhr.responseText || "{}")
                    if (xhr.status < 300 && !d.error) {
                      resolve({ so: parseInt(d.start_offset || String(endOffset)), eo: parseInt(d.end_offset || String(Math.min(endOffset + CHUNK_SIZE, item.file.size))) })
                    } else {
                      resolve({ error: d.error ? formatMetaError(d.error) : "Chunk upload failed" })
                    }
                  }
                  xhr.onerror = () => resolve({ error: "Network error during chunk upload" })
                  xhr.onabort = () => { updateUpload(item.id, { status: "cancelled" }); resolve({ error: "__cancelled__" }) }
                  xhr.open("POST", FB_VIDEOS)
                  updateUpload(item.id, { xhr })
                  xhr.send(chunkForm)
                })

                if (!("error" in offsets)) break                    // chunk succeeded
                if (offsets.error === "__cancelled__") return offsets // user cancelled — bail out
                if (cAttempt < MAX_CHUNK_ATTEMPTS) {
                  // Transient hiccup: rewind the progress bar to this chunk's start and
                  // back off (increasing) before re-sending the same bytes.
                  updateUpload(item.id, { uploaded: snapStart, speed: 0, eta: 0 })
                  await new Promise(r => setTimeout(r, 800 * cAttempt))
                }
              }
              if (offsets === null || "error" in offsets) return offsets ?? { error: "Chunk upload failed" }
              startOffset = offsets.so
              endOffset   = offsets.eo

              // Pace consecutive chunk transfers. Confirmed via live capture: Meta's own
              // Ads Manager UI uploads this exact file with no issue, but our chunked
              // /advideos session reliably dies partway through (after ~3-22 back-to-back
              // ~1MB transfers, no delay between) with a generic "There was a problem
              // uploading your video file" (code 6000/1363048) — consistent with Meta
              // rate-limiting/throttling rapid-fire chunk requests rather than an actual
              // file problem. A short pause between chunks avoids tripping that limit.
              if (startOffset < item.file.size) await new Promise(r => setTimeout(r, 400))
            }

            // FINISH
            const finishForm = new FormData()
            finishForm.append("upload_phase",      "finish")
            finishForm.append("upload_session_id", upload_session_id)
            finishForm.append("title",             item.file.name)
            finishForm.append("access_token",      accessToken)
            let finishData: any
            try {
              const finishRes = await fetch(FB_VIDEOS, { method: "POST", body: finishForm })
              finishData = await finishRes.json()
            } catch (err: any) {
              return { error: err?.message || "Network error finishing upload" }
            }
            if (finishData.error) return { error: formatMetaError(finishData.error) }
            return { videoId: video_id }
          }
        })()

        if ("videoId" in attemptResult) {
          fbVideoId = attemptResult.videoId
        } else if (attemptResult.error === "__cancelled__") {
          return null
        } else {
          lastError = attemptResult.error
          if (attempt < MAX_UPLOAD_ATTEMPTS) {
            updateUpload(item.id, { uploaded: 0, speed: 0, eta: 0 })
            await new Promise(r => setTimeout(r, 1500 * attempt))
          }
        }
      }

      if (!fbVideoId) {
        updateUpload(item.id, { status: "error", error: lastError })
        return null
      }

      // Save to DB via JSON (tiny body — no size issue)
      const dbRes = await fetch("/api/creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_account_id: adAccountId,
          file_name:     item.file.name,
          file_size:     item.file.size,
          media_type:    "video",
          fb_video_id:   fbVideoId,
          headline:      currentHeadline,
          primary_text:  currentPrimary,
          description:   descriptions.find(d => d.trim()) || "",
          cta:           cta || "LEARN_MORE",
          link_url:      webLink || "",
        }),
      })
      const dbData = await dbRes.json()
      if (!dbRes.ok || !dbData.creative) {
        updateUpload(item.id, { status: "error", error: dbData.error || "Failed to save creative" })
        return null
      }

      const creative: Creative = dbData.creative
      updateUpload(item.id, { status: "completed", uploaded: item.fileSize, eta: 0, speed: 0, creativeId: creative.id })

      // Poll for Meta thumbnail — adaptive delays (video needs 15-90s to process)
      ;(async () => {
        const thumbDelays = [15000, 30000, 60000]
        for (let attempt = 0; attempt < thumbDelays.length; attempt++) {
          await new Promise(r => setTimeout(r, thumbDelays[attempt]))
          try {
            const tRes  = await fetch(`/api/creatives/${creative.id}/thumbnail`, { method: "POST" })
            const tData = await tRes.json()
            if (tData.thumbnail_url && tData.source_url) {
              setSelectedCreatives(prev => prev.map(c =>
                c.id === creative.id
                  ? { ...c, fb_thumbnail_url: tData.thumbnail_url, file_url: tData.source_url, status: "ready" }
                  : c
              ))
              break
            }
          } catch {}
        }
      })()

      return creative
    }

    // ── IMAGE: signed Supabase URL + XHR PUT + finalize ───────────────────
    // Images are small (<10 MB typically) — Supabase PUT works fine.
    let signedUrl: string, storagePath: string, publicUrl: string
    try {
      const signRes = await fetch(`/api/creatives/upload-sign?filename=${encodeURIComponent(item.file.name)}`)
      if (!signRes.ok) {
        const err = await signRes.json().catch(() => ({}))
        throw new Error((err as any).error || `Failed to get upload URL (${signRes.status})`)
      }
      ;({ signedUrl, storagePath, publicUrl } = await signRes.json())
    } catch (err: any) {
      updateUpload(item.id, { status: "error", error: err.message || "Failed to prepare upload" })
      return null
    }

    const uploadOk = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest()
      let lastTick = Date.now(), lastLoaded = 0
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return
        const now = Date.now(), dt = (now - lastTick) / 1000
        const speed = dt > 0 ? (e.loaded - lastLoaded) / dt : 0
        lastTick = now; lastLoaded = e.loaded
        updateUpload(item.id, { uploaded: e.loaded, fileSize: e.total, speed, eta: speed > 0 ? (e.total - e.loaded) / speed : 0 })
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(true)
        else { updateUpload(item.id, { status: "error", error: `Storage upload failed (${xhr.status})` }); resolve(false) }
      }
      xhr.onerror = () => { updateUpload(item.id, { status: "error", error: "Network error during upload" }); resolve(false) }
      xhr.onabort = () => { updateUpload(item.id, { status: "cancelled" }); resolve(false) }
      xhr.open("PUT", `/api/creatives/upload-proxy?url=${encodeURIComponent(signedUrl)}`, true)
      xhr.setRequestHeader("Content-Type", item.file.type || "application/octet-stream")
      updateUpload(item.id, { xhr })
      xhr.send(item.file)
    })
    if (!uploadOk) return null

    const finalBody: Record<string, string | number> = {
      storagePath, publicUrl,
      filename: item.file.name, fileType: item.file.type, fileSize: item.file.size,
      adAccountId: selectedAccountId,
    }
    if (currentPrimary)  finalBody.primary_text = currentPrimary
    if (currentHeadline) finalBody.headline     = currentHeadline
    if (descriptions.some(d => d.trim())) finalBody.description = descriptions.find(d => d.trim()) || ""
    if (webLink)         finalBody.link_url     = webLink
    if (cta)             finalBody.cta          = cta

    let creative: Creative
    try {
      const finalRes = await fetch("/api/creatives/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalBody),
      })
      const data = await finalRes.json()
      if (!finalRes.ok || !data.creative) throw new Error(data.error || `Finalize failed (${finalRes.status})`)
      creative = data.creative
    } catch (err: any) {
      updateUpload(item.id, { status: "error", error: err.message || "Failed to save creative" })
      return null
    }

    updateUpload(item.id, { status: "completed", uploaded: item.fileSize, eta: 0, speed: 0, creativeId: creative.id })
    return creative
  }

  // Generate instant local preview (image objectURL OR video frame extracted via canvas)
  // Returns BOTH the blob URL (for instant display) AND the blob itself (to upload to storage)
  const generateLocalPreview = (file: File): Promise<{ thumb: string; blob?: Blob; duration?: string }> => {
    return new Promise((resolve) => {
      if (file.type.startsWith("image/")) {
        return resolve({ thumb: URL.createObjectURL(file), blob: file })
      }
      if (!file.type.startsWith("video/")) return resolve({ thumb: "" })

      const video = document.createElement("video")
      video.preload = "auto"
      video.muted = true
      video.playsInline = true
      video.style.position = "fixed"
      video.style.left = "-9999px"
      video.style.top = "0"
      video.style.width = "1px"
      video.style.height = "1px"
      video.style.opacity = "0"
      const url = URL.createObjectURL(file)
      video.src = url
      // Append to DOM — some browsers won't decode frames for off-DOM video
      document.body.appendChild(video)

      let duration = ""
      let captured = false
      const cleanup = () => {
        try { video.pause() } catch {}
        try { URL.revokeObjectURL(url) } catch {}
        try { document.body.removeChild(video) } catch {}
      }
      const finish = (thumb: string, blob?: Blob) => {
        if (captured) return
        captured = true
        cleanup()
        resolve({ thumb, blob, duration })
      }

      const timeoutId = setTimeout(() => finish(""), 15000)

      const captureFrame = () => {
        if (captured) return
        if (video.videoWidth === 0 || video.videoHeight === 0) return
        try {
          const canvas = document.createElement("canvas")
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          const ctx = canvas.getContext("2d")
          if (!ctx) return finish("")
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          canvas.toBlob(blob => {
            clearTimeout(timeoutId)
            if (blob) finish(URL.createObjectURL(blob), blob)
            else finish("")
          }, "image/jpeg", 0.9)
        } catch (e) {
          console.warn("[preview] drawImage failed:", e)
          clearTimeout(timeoutId)
          finish("")
        }
      }

      const captureWhenFrameReady = () => {
        const hasRVFC = "requestVideoFrameCallback" in video
        if (hasRVFC) {
          // Most reliable: wait for actually-rendered frame
          ;(video as any).requestVideoFrameCallback(() => {
            // Frame is decoded and rendered now — safe to drawImage
            captureFrame()
          })
        } else {
          // Older browser fallback — wait a bit then capture
          setTimeout(captureFrame, 200)
        }
      }

      video.addEventListener("loadedmetadata", () => {
        const d = video.duration
        if (isFinite(d) && d > 0) {
          const m = Math.floor(d / 60)
          const s = Math.floor(d % 60)
          duration = `${m}:${String(s).padStart(2, "0")}`
        }

        // Strategy: play() to actually decode frames, capture when first frame arrives, pause
        video.play().then(() => {
          captureWhenFrameReady()
          // Pause shortly after to avoid actually playing audio/wasting CPU
          setTimeout(() => { try { video.pause() } catch {} }, 300)
        }).catch(() => {
          // play() blocked — fallback to seek
          try { video.currentTime = Math.min(1, video.duration / 4 || 0) } catch {}
          // Try capture directly on seeked
          video.addEventListener("seeked", captureWhenFrameReady, { once: true })
        })
      }, { once: true })

      video.addEventListener("error", () => {
        clearTimeout(timeoutId)
        console.warn("[preview] video error", video.error)
        finish("")
      }, { once: true })

      // Trigger load
      video.load()
    })
  }

  const handleUploadFiles = async (filesIn: FileList | File[]): Promise<Creative[]> => {
    if (!selectedAccountId) { setError("Select an ad account first"); return [] }
    const rawFiles = Array.from(filesIn).filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"))
    if (rawFiles.length === 0) { setError("No valid image/video files selected"); return [] }

    // Drop any file that's already mid-upload from an earlier call (see inFlightUploadKeys).
    const files = rawFiles.filter(f => {
      const key = `${f.name}:${f.size}`
      if (inFlightUploadKeys.has(key)) return false
      inFlightUploadKeys.add(key)
      return true
    })
    if (files.length === 0) return []
    setError("")
    setUploadDockOpen(true)

    // INSTANT preview strategy:
    // - Image: blob URL of file → renders in <img>
    // - Video: blob URL of file → renders in <video> tag (browser auto-shows poster frame)
    // Also kick off canvas frame extraction in background as a backup thumbnail
    const fileUrls = files.map(f => URL.createObjectURL(f))

    // Create temporary creatives — show in panel IMMEDIATELY (no waiting)
    const tempCreatives: Creative[] = files.map((file, i) => {
      const isVid = file.type.startsWith("video/")
      return {
        id: `temp_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        file_name: file.name,
        file_url: fileUrls[i],
        media_type: isVid ? "video" : "image",
        headline: "",
        primary_text: "",
        cta: "LEARN_MORE",
        link_url: "",
        fb_image_url: !isVid ? fileUrls[i] : undefined,
        fb_thumbnail_url: !isVid ? fileUrls[i] : undefined, // video thumb fills in async below
        created_at: new Date().toISOString(),
      } as Creative
    })

    setSelectedCreatives(prev => [...prev, ...tempCreatives])
    setSelectedMediaIds(prev => { const s = new Set(prev); tempCreatives.forEach(c => s.add(c.id)); return s })

    // Background: extract canvas thumbnail blob for videos (for instant local display)
    // Also stored to upload to Supabase Storage AFTER video upload completes
    // → permanent storage so future loads don't need Meta API calls
    const thumbBlobByTempId = new Map<string, Blob>()
    files.forEach((file, i) => {
      if (!file.type.startsWith("video/")) return
      const tempId = tempCreatives[i].id
      generateLocalPreview(file).then(p => {
        if (p.blob) thumbBlobByTempId.set(tempId, p.blob)
        if (p.thumb) {
          setSelectedCreatives(prev => prev.map(c => c.id === tempId
            ? { ...c, fb_thumbnail_url: p.thumb, ...(p.duration ? ({ duration: p.duration } as any) : {}) }
            : c
          ))
        }
      })
    })
    // Expose to swap logic below via outer closure
    pendingThumbBlobsRef.current = thumbBlobByTempId

    // Add items to dock with the temp ID for tracking
    const items: UploadItem[] = files.map((file, i) => ({
      id: tempCreatives[i].id,
      file,
      filename: file.name,
      fileSize: file.size,
      fileTypeShort: (file.name.split(".").pop() || file.type.split("/").pop() || "FILE").toUpperCase(),
      status: "uploading",
      uploaded: 0,
      speed: 0,
      eta: 0,
      startedAt: Date.now(),
    }))
    setUploads(prev => [...prev, ...items])

    // Upload strategy: images run in parallel (small, signed-URL upload — no contention).
    // Videos run with a small concurrency cap (see VIDEO_UPLOAD_CONCURRENCY below) —
    // unbounded parallel chunked sessions split the same bandwidth and can starve/time out.
    let anyUploaded = false
    const uploadedByTempId = new Map<string, Creative>()
    const processItem = async (item: UploadItem) => {
      const real = await uploadOneFile(item)
      inFlightUploadKeys.delete(`${item.file.name}:${item.file.size}`)
      if (real) {
        anyUploaded = true
        // Swap temp → real, but ALWAYS keep local blob URL for instant preview.
        // Dedup afterward: dedup check may return an existing creative already in the list.
        const tempCreative = tempCreatives.find(c => c.id === item.id)
        const displayCreative: Creative = {
          ...real,
          file_url: tempCreative?.file_url || real.file_url || real.fb_thumbnail_url || real.fb_image_url || "",
          fb_image_url: real.fb_image_url || tempCreative?.fb_image_url,
          fb_thumbnail_url: real.fb_thumbnail_url || tempCreative?.fb_thumbnail_url,
        }
        uploadedByTempId.set(item.id, displayCreative)
        setSelectedCreatives(prev => {
          const mapped = prev.map(c => {
            if (c.id !== item.id) return c
            const localBlob = c.file_url
            return {
              ...real,
              file_url: localBlob || real.fb_thumbnail_url || real.fb_image_url || "",
              fb_image_url: real.fb_image_url || c.fb_image_url,
              fb_thumbnail_url: real.fb_thumbnail_url || c.fb_thumbnail_url,
            }
          })
          const seen = new Set<string>()
          return mapped.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true })
        })
        setSelectedMediaIds(prev => {
          const s = new Set(prev)
          s.delete(item.id)
          s.add(real.id)
          return s
        })

        // Upload canvas thumbnail blob to Supabase Storage (permanent, no Meta API needed)
        const thumbBlob = pendingThumbBlobsRef.current.get(item.id)
        if (thumbBlob && real.media_type === "video") {
          fetch(`/api/creatives/${real.id}/save-thumbnail`, {
            method: "POST",
            body: thumbBlob,
            headers: { "Content-Type": "image/jpeg" },
          })
            .then(r => r.json())
            .then(d => {
              if (d.thumbnail_url) {
                setSelectedCreatives(prev => prev.map(c => {
                  if (c.id !== real.id) return c
                  // Update thumbnail only — DO NOT overwrite file_url, otherwise the video URL
                  // is replaced by the JPEG thumbnail URL → <video> element no longer renders → no hover play.
                  return { ...c, fb_thumbnail_url: d.thumbnail_url }
                }))
                // Tell Library tab to re-fetch so the new thumbnail shows there too
                setMediaRefreshSignal(s => s + 1)
                console.log(`[thumbnail] Saved to Supabase: ${real.file_name}`)
              }
            })
            .catch(e => console.warn(`[thumbnail] Save failed for ${real.file_name}:`, e))
            .finally(() => pendingThumbBlobsRef.current.delete(item.id))
        }
        // Migrate ad name override to real ID
        setAdNameOverrides(prev => {
          if (!prev[item.id]) return prev
          const n = { ...prev }
          n[real.id] = n[item.id]
          delete n[item.id]
          return n
        })
      } else {
        // Failed → remove the temp creative
        setSelectedCreatives(prev => prev.filter(c => c.id !== item.id))
        setSelectedMediaIds(prev => { const s = new Set(prev); s.delete(item.id); return s })
      }
    }

    const videoItems = items.filter(item => item.file.type.startsWith("video/"))
    const imageItems = items.filter(item => !item.file.type.startsWith("video/"))

    // Videos upload concurrently, but capped — fully unbounded parallel makes N heavy
    // chunked-upload sessions split the same bandwidth, so each one starves and can
    // time out on Meta's side. A small cap keeps multiple videos moving at once
    // without any single session going too slowly to finish.
    const VIDEO_UPLOAD_CONCURRENCY = 4
    let videoIdx = 0
    const videoWorker = async () => {
      while (videoIdx < videoItems.length) await processItem(videoItems[videoIdx++])
    }

    await Promise.allSettled([
      ...imageItems.map(processItem),
      ...Array.from({ length: Math.min(VIDEO_UPLOAD_CONCURRENCY, videoItems.length) }, videoWorker),
    ])

    // Refresh Library tab so freshly uploaded items appear with thumbnails
    if (anyUploaded) setMediaRefreshSignal(s => s + 1)
    return items.map(item => uploadedByTempId.get(item.id)).filter(Boolean) as Creative[]
  }

  // Legacy props for GalleryMediaPanel — kept for backward compat (now empty)
  const uploading = uploads.some(u => u.status === "uploading")
  const uploadProgress = { done: 0, total: 0, current: "" }

  // Fetch pages 1 lần khi mount — cache 10 min in sessionStorage to avoid rate limits
  const [pagesError, setPagesError] = useState<string>("")
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const [pagesLoading, setPagesLoading] = useState(false)
  const pagesCacheKey = activeOrgId && selectedAccountId
    ? `fb_pages_cache:${activeOrgId}:${selectedAccountId}`
    : ""
  const PAGES_CACHE_TTL    = 10 * 60 * 1000 // 10 minutes
  const pagesRateLimitKey = activeOrgId ? `fb_pages_ratelimit:${activeOrgId}` : "fb_pages_ratelimit"
  const PAGES_RL_COOLDOWN  = 5 * 60 * 1000  // 5 minutes — don't re-hit after 429
  useEffect(() => {
    let cancelled = false
    setPages([])
    setSelectedPageId("")
    setSelectedIgPageId("")
    setIgAccountCache({})
    setPagesError("")
    setNeedsReconnect(false)

    if (!activeOrgId) {
      setPagesLoading(false)
      return
    }
    if (!selectedAccountId) {
      setPagesError("Select or connect an ad account to load pages.")
      setPagesLoading(false)
      return
    }

    setPagesLoading(true)

    // Respect active rate-limit cooldown (avoids hammering Facebook on rapid refreshes)
    try {
      const rl = sessionStorage.getItem(pagesRateLimitKey)
      if (rl) {
        const since = Date.now() - parseInt(rl, 10)
        if (since < PAGES_RL_COOLDOWN) {
          const remaining = Math.ceil((PAGES_RL_COOLDOWN - since) / 1000 / 60)
          if (!cancelled) {
            setPagesError(`Facebook API rate limit active. Try again in ~${remaining} min.`)
            setPagesLoading(false)
          }
          return
        }
        sessionStorage.removeItem(pagesRateLimitKey)
      }
    } catch {}

    // Try page cache first
    try {
      const cached = pagesCacheKey ? sessionStorage.getItem(pagesCacheKey) : null
      if (cached) {
        const { ts, pages: cachedPages } = JSON.parse(cached)
        if (Date.now() - ts < PAGES_CACHE_TTL && Array.isArray(cachedPages)) {
          const cleanPages = sanitizePages(cachedPages)
          console.log(`[pages] Using cache (${cleanPages.length} pages)`)
          if (!cancelled) {
            setPages(cleanPages)
            setPagesLoading(false)
          }
          return
        }
      }
    } catch {}

    fetch(`/api/facebook/pages?ad_account_id=${encodeURIComponent(selectedAccountId)}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok || d.error) {
          if (r.status === 429 || d.rateLimited || /request limit|rate limit|too many|#4/i.test(d.error || "")) {
            console.warn(`[pages] API ${r.status}:`, d.error || r.statusText)
            try { sessionStorage.setItem(pagesRateLimitKey, String(Date.now())) } catch {}
            setPagesError("Facebook API rate limit reached. Please wait 5-10 minutes and refresh.")
          } else if (r.status === 401 && /no facebook connection/i.test(d.error || "")) {
            setPagesError("Connect Facebook to load pages for this organization.")
            setNeedsReconnect(true)
          } else {
            console.warn(`[pages] API ${r.status}:`, d.error || r.statusText)
            setPagesError(d.error || `HTTP ${r.status}`)
          }
          if (d.needsReconnect) setNeedsReconnect(true)
          return
        }
        const p = sanitizePages(d.pages || [])
        console.log(`[pages] Loaded ${p.length} pages`)
        setPages(p)
        // Cache for 10 min
        try {
          if (pagesCacheKey) sessionStorage.setItem(pagesCacheKey, JSON.stringify({ ts: Date.now(), pages: p }))
        } catch {}
        if (p.length === 0) {
          setPagesError("No Facebook pages found. Your account must be admin of at least one page.")
        }
      })
      .catch(e => {
        if (cancelled) return
        console.error("[pages] Fetch error:", e)
        setPagesError(e.message || "Failed to load pages")
      })
      .finally(() => {
        if (!cancelled) setPagesLoading(false)
      })

    return () => { cancelled = true }
  }, [activeOrgId, selectedAccountId, pagesCacheKey, pagesRateLimitKey])

  // Khi pages load xong hoặc account đổi → apply saved pref cho account đó
  useEffect(() => {
    if (!selectedAccountId || pages.length === 0) return
    const pref = getPagePrefs()[selectedAccountId]
    const savedPage = pref && pages.find(pg => pg.id === pref.pageId)
    if (savedPage) {
      setSelectedPageId(savedPage.id)
      setSelectedIgPageId(pref.igId)
    } else {
      setSelectedPageId(pages[0].id)
      setSelectedIgPageId(`fb_${pages[0].id}`)
    }
  }, [selectedAccountId, pages])

  useEffect(() => {
    if (!selectedAccountId) return
    const refresh = mode === "table"
    fetch(`/api/facebook/adsets?ad_account_id=${encodeURIComponent(selectedAccountId)}${refresh ? "&refresh=true" : ""}`)
      .then(r => r.json())
      .then(d => setAllAdSets(d.adSets || []))
      .catch(() => {})
  }, [selectedAccountId, mode])


  const validate = () => {
    const fail = (message: string, fields: string[]) => {
      setError(message)
      setValidationErrors(Object.fromEntries(fields.map(f => [f, true])))
      return false
    }
    if (selectedAdSets.length === 0) return fail("No ad set selected — please select at least 1 ad set", ["adsets"])
    if (selectedMediaIds.size === 0) return fail("No creative selected — please select at least 1 image/video", ["creatives"])
    const erroredCreatives = selectedCreatives.filter(c => c.status === "error")
    if (erroredCreatives.length > 0) {
      return fail(`${erroredCreatives.length} media failed to upload. Please remove them or re-upload.`, ["creatives"])
    }
    const pendingCreatives = selectedCreatives.filter(c => !isLaunchable(c))
    if (pendingCreatives.length > 0) {
      return fail(`${pendingCreatives.length} media still uploading/processing on Meta — please wait until they show "ready" then try again`, ["creatives"])
    }
    if (!webLink.trim()) return fail("Destination URL is required when the CTA uses a link.", ["webLink"])
    if (!/^https?:\/\//.test(webLink.trim())) return fail("URL must start with http:// or https://.", ["webLink"])
    if (!selectedPageId) return fail("Select a Facebook Page.", ["page"])

    setError("")
    setValidationErrors({})
    return true
  }

  /**
   * "No ad has been configured yet" — the same emptiness test Preview uses, per mode.
   *
   * Gallery mode has no rows, so the selected creatives are the unit of work (this is
   * exactly Preview's `selectedCreatives.length === 0`). Table mode's unit is the row, and
   * a row can exist before its creative is picked, so rows are the test there. Save Draft
   * and Preview now agree in both modes instead of Save Draft being enabled on an empty
   * Gallery — where it did nothing at all, because it had no onClick.
   */
  const nothingConfigured = mode === "table"
    ? tableRows.length === 0
    : selectedCreatives.length === 0

  // ── Draft: snapshot the whole setup, restore it exactly ─────────────────────
  //
  // A draft used to carry the Table-mode rows plus five global fields (account, page, IG
  // page, CTA, link). Everything else the user had set up — the ad copy variations, the ad
  // set selection, the ad format and its per-format config, UTM/display link, launch-as-
  // active, the Gallery creative selection and its ad-name overrides — was dropped, and
  // loading always forced Table mode. Reopening a Gallery-mode setup therefore restored
  // something the user had never configured, and in Gallery mode the draft could not be
  // saved at all (`Save` had no onClick, and the API rejected an empty `rows`).
  //
  // The snapshot below is the full setup state at click time. `data` is a JSONB column, so
  // this needs no migration; `rows` is still written unchanged so drafts saved by the old
  // build keep loading, and a draft written by this build stays readable by the old one
  // (it just ignores `snapshot`).
  //
  // Transient state is deliberately excluded: open modals, in-flight/launching flags,
  // errors, banners, panel width, and anything fetched per account (pages, ad set lists).
  // A draft restores what the user *decided*, not what the app was displaying.

  const buildDraftSnapshot = (): DraftSnapshot => ({
    version: 1,
    mode,
    adAccountId: selectedAccountId || null,
    pageId: selectedPageId,
    igPageId: selectedIgPageId,
    adSets: selectedAdSets,
    primaryTexts,
    headlines,
    descriptions,
    cta,
    webLink,
    utmParams,
    displayLink,
    launchAsActive,
    adSourceMode,
    adSourceIds,
    // Creatives are stored by id and re-fetched on load: a creative may have been deleted,
    // or re-uploaded to Meta with a new fb_video_id, between saving and reopening.
    selectedCreativeIds: selectedCreatives.map(c => c.id),
    adNameOverrides,
    tableViewMode,
    adFormat,
    partnership,
    multilanguage,
    collectionAds,
    catalogAds,
    carouselAds,
    flexibleAds,
    multiPlacementAds,
  })

  const saveDraft = async () => {
    if (nothingConfigured) return
    setSavingDraft(true)
    setError("")
    try {
      // Convert TableRow → lean row (strip creative object, keep only creativeId)
      const leanRows = tableRows.map(({ creative, ...rest }) => ({
        ...rest,
        creativeId: creative?.id || null,
      }))

      // Thumbnails for the drafts list. In Gallery mode there are no rows, so the selected
      // creatives are what the list has to preview.
      const thumbSource = tableRows.length
        ? tableRows.map(r => r.creative)
        : selectedCreatives
      const thumbs = thumbSource
        .map(c => c?.fb_thumbnail_url || c?.fb_image_url || null)
        .filter(Boolean)
        .slice(0, 5) as string[]

      const adAccount = adAccounts.find(a => a.id === selectedAccountId)
      const unitCount = tableRows.length || selectedCreatives.length
      const stamp = new Date().toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      const name = `${unitCount} Ads — ${stamp}`

      const res = await fetch("/api/launch-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          adAccountId: selectedAccountId,
          adAccountName: adAccount?.name || selectedAccountId,
          rows: leanRows,
          // Kept for drafts read by the previous build, which knows only these five fields.
          globalSettings: { adAccountId: selectedAccountId, pageId: selectedPageId, igPageId: selectedIgPageId, cta, webLink },
          snapshot: buildDraftSnapshot(),
          creativeThumbs: thumbs,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Failed to save draft")
        return
      }
      setHistoryReload(n => n + 1)
      // Switch history tab to drafts
      setHistoryTabOverride("drafts")
      setTimeout(() => setHistoryTabOverride(null), 100)
    } catch {
      setError("Failed to save draft")
    } finally {
      setSavingDraft(false)
    }
  }

  const handleLoadDraft = async (draftId: string) => {
    setError("")
    const res = await fetch(`/api/launch-drafts?id=${draftId}`)
    if (!res.ok) { setError("Could not open that draft"); return }
    const { draft } = await res.json()
    const data = draft?.data
    if (!data) { setError("That draft has no saved setup"); return }

    const rows: TableRow[] = data.rows || []
    const snap: DraftSnapshot | undefined = data.snapshot

    // The account has to be applied first: several effects on this page keyed to
    // selectedAccountId re-read per-account defaults and the saved creative selection, and
    // they must not land on top of the values the draft is restoring.
    const accountId = snap?.adAccountId ?? data.globalSettings?.adAccountId
    if (accountId) setSelectedAccountId(accountId)

    setTableRows(rows)

    if (snap) {
      restoringDraft.current = true
      setMode(snap.mode ?? (rows.length ? "table" : "gallery"))
      setSelectedPageId(snap.pageId || "")
      setSelectedIgPageId(snap.igPageId || "")
      setSelectedAdSets(snap.adSets || [])
      if (snap.primaryTexts?.length) setPrimaryTexts(snap.primaryTexts)
      if (snap.headlines?.length) setHeadlines(snap.headlines)
      if (snap.descriptions?.length) setDescriptions(snap.descriptions)
      setCta(snap.cta || "LEARN_MORE")
      setWebLink(snap.webLink || "")
      setUtmParams(snap.utmParams || "")
      setDisplayLink(snap.displayLink || "")
      setLaunchAsActive(!!snap.launchAsActive)
      setAdSourceMode(snap.adSourceMode || "new_ad")
      setAdSourceIds(snap.adSourceIds || {})
      setAdNameOverrides(snap.adNameOverrides || {})
      if (snap.tableViewMode) setTableViewMode(snap.tableViewMode)
      if (snap.adFormat) setAdFormat(snap.adFormat)
      if (snap.partnership) setPartnership(snap.partnership)
      if (snap.multilanguage) setMultilanguage(snap.multilanguage)
      if (snap.collectionAds) setCollectionAds(snap.collectionAds)
      if (snap.catalogAds) setCatalogAds(snap.catalogAds)
      if (snap.carouselAds) setCarouselAds(snap.carouselAds)
      if (snap.flexibleAds) setFlexibleAds(snap.flexibleAds)
      if (snap.multiPlacementAds) setMultiPlacementAds(snap.multiPlacementAds)

      // The API resolves selectedCreativeIds against `creatives` and returns what still
      // exists, so a creative deleted since the save silently drops out of the selection
      // rather than restoring a row that cannot launch.
      const restored: Creative[] = data.selectedCreatives || []
      setSelectedCreatives(restored)
      setSelectedMediaIds(new Set(restored.map(c => c.id)))

      const missing = (snap.selectedCreativeIds?.length || 0) - restored.length
      if (missing > 0) {
        setRelaunchBanner(`Draft restored. ${missing} creative${missing === 1 ? " is" : "s are"} no longer in your library and were skipped.`)
        setTimeout(() => setRelaunchBanner(""), 10000)
      }
      // Release the guard after this render's effects have run.
      setTimeout(() => { restoringDraft.current = false }, 0)
    } else {
      // Pre-snapshot draft: rows + five global fields is all it has.
      setMode("table")
      const gs = data.globalSettings || {}
      if (gs.cta) setCta(gs.cta)
      if (gs.webLink) setWebLink(gs.webLink)
      if (gs.pageId) setSelectedPageId(gs.pageId)
      if (gs.igPageId) setSelectedIgPageId(gs.igPageId)
    }

    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleRelaunch = (batch: LaunchBatch) => {
    if (batch.primary_text) setPrimaryTexts([batch.primary_text])
    if (batch.headline) setHeadlines([batch.headline])
    if (batch.cta) setCta(batch.cta)
    if (batch.web_link) setWebLink(batch.web_link)
    setRelaunchBanner(`Settings restored from launch on ${new Date(batch.created_at).toLocaleDateString()} — re-select your ad sets and creatives, then launch.`)
    setTimeout(() => setRelaunchBanner(""), 8000)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const doLaunch = async (scheduledTime?: string, scheduleEndTime?: string) => {
    if (!validate()) return
    setLaunching(true)
    setLaunchResult(null)
    setLaunchPhase("launching")
    setLaunchProgressOpen(true)
    try {
      const primaryTextList = primaryTexts.filter(t => t.trim())
      const headlineList = headlines.filter(h => h.trim())
      const descriptionList = descriptions.filter(d => d.trim())
      const primaryText = primaryTextList[0] || ""
      const headline = headlineList[0] || ""
      const description = descriptionList[0] || ""

      // Read saved Default Ad Settings so enhancements + launch flags reach the API
      let savedEnhancements: DefaultAdSettings["enhancements"] | undefined
      let savedLaunchSettings: DefaultAdSettings["launch"] | undefined
      try {
        const raw = localStorage.getItem(`default_ad_settings_${selectedAccountId}`)
        if (raw) {
          const s: DefaultAdSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
          savedEnhancements = s.enhancements
          savedLaunchSettings = s.launch
        }
      } catch {}

      setLaunchPhase("launching")
      const res = await fetch("/api/facebook/launch-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adAccountId: selectedAccountId,
          adAccountName: selectedAccount?.name || selectedAccountId,
          adSetIds: selectedAdSets.map(a => a.id),
          adSetNames: selectedAdSets.map(a => a.name),
          creativeIds: Array.from(selectedMediaIds),
          pageId: selectedPageId,
          headline: headline.trim(),
          headlineVariations: headlineList.slice(1),
          primaryText: primaryText.trim(),
          // Send remaining variations (first entry is already sent as headline/primaryText above).
          // Server merges them into ONE ad's asset_feed_spec (Multiple Text Options,
          // optimization_type DEGREES_OF_FREEDOM) — works on standard ad sets, N ads per ad set.
          primaryTextVariations: primaryTextList.slice(1),
          description: description.trim(),
          descriptionVariations: descriptionList.slice(1),
          cta,
          webLink: utmParams.trim()
            ? `${webLink.trim()}${webLink.includes("?") ? "&" : "?"}${utmParams.trim()}`
            : webLink.trim(),
          displayLink: displayLink.trim() || undefined,
          createPaused: !launchAsActive,
          startTime: scheduledTime,
          endTime: scheduleEndTime,
          partnerPageId: partnership.enabled && partnership.partnerPageId ? partnership.partnerPageId : undefined,
          partnershipDisplayMode: partnership.enabled && partnership.partnerPageId ? partnership.displayMode : undefined,
          multilanguage: multilanguage.enabled && multilanguage.translations.length > 0
            ? { defaultLanguage: multilanguage.defaultLanguage, translations: multilanguage.translations }
            : undefined,
          catalogAds: catalogAds.enabled && catalogAds.catalogId
            ? {
                catalogId: catalogAds.catalogId,
                productSetId: catalogAds.productSetId || undefined,
                formatMode: catalogAds.formatMode,
                format: catalogAds.format,
                frameImageUrl: catalogAds.frameImageUrl || undefined,
                dynamicMedia: catalogAds.dynamicMedia,
              }
            : undefined,
          carouselAds: carouselAds.enabled
            ? carouselAds.carousels.filter(c => c.cards.length >= 2).map(c => ({
                name: c.name,
                showAsCollectionTiles: c.showAsCollectionTiles,
                showAsSingleMedia: c.showAsSingleMedia,
                cards: c.cards.map(card => ({
                  creativeId: card.creativeId,
                  headline: card.headline || "",
                  description: card.description || "",
                  linkUrl: card.linkUrl || "",
                  cta: card.cta || "",
                })),
              }))
            : undefined,
          flexibleAds: flexibleAds.enabled
            ? flexibleAds.flexibleAds.filter(a => a.groups.some(g => g.creativeIds.length > 0)).map(a => ({
                name: a.name,
                groups: a.groups.filter(g => g.creativeIds.length > 0).map(g => ({ creativeIds: g.creativeIds })),
              }))
            : undefined,
          multiPlacementAds: multiPlacementAds.enabled
            ? {
                manualPlacements: multiPlacementAds.manualPlacements,
                groups: multiPlacementAds.groups
                  .filter(g => g.creativeIds.length >= 2)
                  .map(g => ({ name: g.name, creativeIds: g.creativeIds, placements: g.placements || {} })),
              }
            : undefined,
          adSourceMode,
          adSourceIds: Object.keys(adSourceIds).length > 0 ? adSourceIds : undefined,
          enhancements: savedEnhancements,
          launchSettings: { ...savedLaunchSettings, oneAdPerAdset },
          collectionAds: collectionAds.enabled && collectionAds.catalogId && collectionAds.productSetId
            ? {
                templateType: collectionAds.templateType,
                catalogId: collectionAds.catalogId,
                productSetId: collectionAds.productSetId,
                productCount: collectionAds.productCount,
                order: collectionAds.order,
                ieHeadline: collectionAds.ieHeadline || undefined,
                destinationUrl: collectionAds.destinationUrl,
                productHeadlineChips: collectionAds.productHeadlineChips,
                productDescriptionChips: collectionAds.productDescriptionChips,
              }
            : undefined,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setLaunchPhase("error")
        setLaunchError(data.error || "Launch failed")
        setError(data.error || "Launch failed")
        return
      }

      const result: LaunchResult = {
        created: data.created?.length ?? 0,
        failed: data.errors?.length ?? 0,
        durationMs: data.durationMs ?? 0,
        errors: data.errors || [],
        scheduled: data.scheduled ?? null,
        scheduleError: data.scheduleError ?? null,
        auditError: data.auditError ?? null,
        createdAds: data.created || [],
        batchId: data.batchId || null,
        launchMeta: {
          cta,
          webLink: webLink.trim(),
          headline: headlines.find((h: string) => h.trim()) || "",
          primaryText: primaryTexts.find((t: string) => t.trim()) || "",
          pageId: selectedPageId || "",
          pageName: pages.find(p => p.id === selectedPageId)?.name || "",
          adAccountId: selectedAccountId || "",
          adAccountName: selectedAccount?.name || selectedAccountId || "",
          timestamp: new Date().toISOString(),
        },
      }
      setLaunchResult(result)
      setLaunchPhase("success")
      setHistoryReload(n => n + 1)

      if (result.failed === 0 && !result.scheduleError && !result.auditError) {
        setSelectedMediaIds(new Set())
        setSelectedCreatives([])
      }
    } catch {
      setLaunchPhase("error")
      setLaunchError("Network error. Please try again.")
      setError("Network error. Please try again.")
    } finally {
      setLaunching(false)
    }
  }

  const startResizing = useCallback(() => setIsResizing(true), [])
  const stopResizing = useCallback(() => setIsResizing(false), [])
  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = Math.max(420, Math.min(e.clientX, window.innerWidth - 400))
      setLeftPanelWidth(newWidth)
    }
  }, [isResizing])

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize)
      window.addEventListener("mouseup", stopResizing)
    }
    return () => {
      window.removeEventListener("mousemove", resize)
      window.removeEventListener("mouseup", stopResizing)
    }
  }, [isResizing, resize, stopResizing])

  const [tableSearchQuery, setTableSearchQuery] = useState("")
  const [tableAutoSync, setTableAutoSync] = useState(false)
  const [tableBulkOpen, setTableBulkOpen] = useState(false)
  const [tableMoreOpen, setTableMoreOpen] = useState(false)
  const [tableHistoryOpen, setTableHistoryOpen] = useState(true)
  const tableBulkRef = useRef<HTMLDivElement>(null)
  const tableMoreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (tableBulkRef.current && !tableBulkRef.current.contains(e.target as Node)) setTableBulkOpen(false)
      if (tableMoreRef.current && !tableMoreRef.current.contains(e.target as Node)) setTableMoreOpen(false)
    }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])

  const syncTableFromGallery = useCallback(() => {
    const ptList = primaryTexts.filter(t => t.trim())
    const hlList = headlines.filter(h => h.trim())
    const descList = descriptions.filter(d => d.trim())
    const adSetIdList = selectedAdSets.map((a: AdSet) => a.id)
    setTableRows(prev => prev.map(r => ({
      ...r,
      ...(ptList[0] ? { primaryText: ptList[0], primaryTextVariations: ptList.slice(1) } : {}),
      ...(hlList[0] ? { headline: hlList[0], headlineVariations: hlList.slice(1) } : {}),
      ...(descList[0] ? { description: descList[0], descriptionVariations: descList.slice(1) } : {}),
      ...(adSetIdList.length > 0 ? { adSetIds: adSetIdList } : {}),
      ...(cta ? { cta } : {}),
      ...(webLink ? { webLink } : {}),
    })))
  }, [primaryTexts, headlines, descriptions, cta, webLink, selectedAdSets])

  // Auto-sync when gallery values change (only while auto-sync is on and in table mode)
  useEffect(() => {
    if (!tableAutoSync || mode !== "table") return
    syncTableFromGallery()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableAutoSync, primaryTexts, headlines, descriptions, cta, webLink, selectedAdSets])

  const addTableRow = () => {
    setTableRows(prev => [...prev, { id: crypto.randomUUID(), creative: null, adName: "", primaryText: "", headline: "", description: "", adSetIds: [] }])
  }
  const updateTableRow = (id: string, field: keyof TableRow, value: any) => {
    setTableRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }
  const deleteTableRow = (id: string) => {
    setTableRows(prev => prev.filter(r => r.id !== id))
  }
  const duplicateTableRow = (id: string) => {
    setTableRows(prev => {
      const idx = prev.findIndex(r => r.id === id)
      if (idx < 0) return prev
      const copy = { ...prev[idx], id: crypto.randomUUID(), adName: prev[idx].adName ? `${prev[idx].adName} (copy)` : "" }
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]
    })
  }
  const uploadTableRowFiles = async (rowId: string, files: FileList | File[]) => {
    const uploaded = await handleUploadFiles(files)
    if (uploaded.length === 0) return

    setTableRows(prev => {
      const idx = prev.findIndex(r => r.id === rowId)
      if (idx < 0) return prev
      const baseRow = prev[idx]
      const firstClean = (uploaded[0].file_name || "").replace(/\.[^/.]+$/, "")
      const updatedBase: TableRow = {
        ...baseRow,
        creative: uploaded[0],
        adName: baseRow.adName?.trim() ? baseRow.adName : firstClean,
      }
      const extraRows: TableRow[] = uploaded.slice(1).map(c => ({
        ...baseRow,
        id: crypto.randomUUID(),
        creative: c,
        adName: (c.file_name || "").replace(/\.[^/.]+$/, ""),
      }))
      return [
        ...prev.slice(0, idx),
        updatedBase,
        ...extraRows,
        ...prev.slice(idx + 1),
      ]
    })
  }

  // Table mode: validate rows up front — reused both as a pre-launch gate (before the
  // preview modal opens) and as the final check inside doTableLaunch itself.
  const validateTableRows = (): boolean => {
    const validRows = tableRows.filter(r => r.creative?.id && r.adSetIds.length > 0)
    if (!validRows.length) {
      const missing: string[] = []
      if (!tableRows.some(r => r.creative?.id)) missing.push("creative")
      if (!tableRows.some(r => r.adSetIds.length > 0)) missing.push("ad set")
      setError(`Each row needs a ${missing.join(" and ")} before launching.`)
      return false
    }

    const rowErrors: string[] = []
    for (const row of validRows) {
      const label = row.adName?.trim() || `Ad #${tableRows.indexOf(row) + 1}`
      const rowLink = (row.webLink || webLink).trim()
      const pageId = row.pageId || selectedPageId

      if (!pageId) {
        rowErrors.push(`"${label}": select a Facebook Page`)
      }
      if (!rowLink) {
        rowErrors.push(`"${label}": destination URL is required`)
      } else if (!rowLink.startsWith("http")) {
        rowErrors.push(`"${label}": URL must start with http:// or https://`)
      }
      if (row.creative && !row.creative.fb_image_hash && !row.creative.fb_video_id) {
        const isPending = row.creative.status === "pending"
        rowErrors.push(`"${label}": ${isPending ? "video is still uploading to Meta (~2 minutes) — wait, then retry" : "creative not yet uploaded to Meta (wait for upload to finish)"}`)
      }
    }
    if (rowErrors.length > 0) {
      setError(rowErrors.join(" · "))
      return false
    }
    setError("")
    return true
  }

  // Table mode: launch each row individually using per-row settings
  const doTableLaunch = useCallback(async (scheduledTime?: string, scheduleEndTime?: string) => {
    setLaunchPhase("launching")
    setLaunchProgressOpen(true)
    setLaunchError(null)
    if (!validateTableRows()) return

    setLaunching(true)
    setLaunchResult(null)
    setLaunchPhase("launching")
    setError("")

    let savedEnhancements: DefaultAdSettings["enhancements"] | undefined
    let savedLaunchSettings: DefaultAdSettings["launch"] | undefined
    try {
      const raw = localStorage.getItem(`default_ad_settings_${selectedAccountId}`)
      if (raw) {
        const s: DefaultAdSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
        savedEnhancements = s.enhancements
        savedLaunchSettings = s.launch
      }
    } catch {}

    const globalPrimaryText = primaryTexts.find(t => t.trim()) || ""
    const globalHeadline = headlines.find(h => h.trim()) || ""

    let totalCreated = 0
    let totalFailed = 0
    const allErrors: { adSetId: string; fileName: string; error: string }[] = []
    const allCreatedAds: CreatedAd[] = []
    let lastBatchId: string | null = null
    let scheduleError: string | null = null
    let auditError: string | null = null

    const validRows = tableRows.filter(r => r.creative?.id && r.adSetIds.length > 0)
    const batchRows = validRows.map(row => {
      const rowLink = (row.webLink || webLink).trim()
      const rowUtm = (row.urlTags || utmParams).trim()
      const rowWebLink = rowUtm ? `${rowLink}${rowLink.includes("?") ? "&" : "?"}${rowUtm}` : rowLink
      return {
        adSetIds: row.adSetIds,
        adSetNames: row.adSetIds.map(id => allAdSets.find(a => a.id === id)?.name || id),
        creativeIds: [row.creative!.id],
        adName: row.adName.trim() || undefined,
        pageId: row.pageId || selectedPageId,
        instagramAccountId: (() => { const ig = row.igId || selectedIgPageId; return ig && !ig.startsWith("fb_") ? ig : undefined })(),
        headline: (row.headline || globalHeadline).trim(),
        headlineVariations: (row.headlineVariations || []).filter(v => v.trim()),
        primaryText: (row.primaryText || globalPrimaryText).trim(),
        primaryTextVariations: (row.primaryTextVariations || []).filter(v => v.trim()),
        description: (row.description || "").trim(),
        descriptionVariations: (row.descriptionVariations || []).filter(v => v.trim()),
        cta: row.cta || cta,
        webLink: rowWebLink,
        createPaused: row.launchAsActive !== undefined ? !row.launchAsActive : !launchAsActive,
        partnerPageId: row.partnership?.enabled && row.partnership.partnerPageId ? row.partnership.partnerPageId : undefined,
        partnershipDisplayMode: row.partnership?.enabled && row.partnership.partnerPageId ? row.partnership.displayMode : undefined,
        multilanguage: row.multilanguage?.enabled && row.multilanguage.translations.length > 0
          ? { defaultLanguage: row.multilanguage.defaultLanguage, translations: row.multilanguage.translations }
          : undefined,
        catalogAds: row.catalog?.enabled && row.catalog.catalogId
          ? { catalogId: row.catalog.catalogId, productSetId: row.catalog.productSetId || undefined, formatMode: row.catalog.formatMode, format: row.catalog.format, frameImageUrl: row.catalog.frameImageUrl || undefined, dynamicMedia: row.catalog.dynamicMedia }
          : undefined,
        sitelinks: row.sitelinks && row.sitelinks.length > 0 ? row.sitelinks : undefined,
        startTime: row.schedule?.start || scheduledTime,
        endTime: row.schedule?.end || scheduleEndTime,
        enhancements: savedEnhancements,
        launchSettings: { ...savedLaunchSettings, oneAdPerAdset },
      }
    })

    try {
      const res = await fetch("/api/facebook/launch-table-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: batchRows,
          adAccountId: selectedAccountId,
          adAccountName: selectedAccount?.name || selectedAccountId,
          pageName: pages.find(p => p.id === selectedPageId)?.name || "",
        }),
      })
      const data = await res.json()
      if (res.ok) {
        scheduleError = data.scheduleErrors?.map((item: { error: string }) => item.error).join("; ") || null
        auditError = data.auditError ?? null
        for (const rowResult of (data.rows || [])) {
          totalCreated += rowResult.created?.length ?? 0
          totalFailed  += rowResult.errors?.length ?? 0
          allErrors.push(...(rowResult.errors || []))
          allCreatedAds.push(...(rowResult.created || []))
          if (rowResult.batchId) lastBatchId = rowResult.batchId
        }
      } else {
        totalFailed += validRows.reduce((s, r) => s + r.adSetIds.length, 0)
        allErrors.push({ adSetId: "", fileName: "", error: data.error || "Launch failed" })
      }
    } catch (err: any) {
      totalFailed += validRows.reduce((s, r) => s + r.adSetIds.length, 0)
      allErrors.push({ adSetId: "", fileName: "", error: err.message || "Network error" })
    }

    const result: LaunchResult = {
      created: totalCreated,
      failed: totalFailed,
      durationMs: 0,
      errors: allErrors,
      scheduled: scheduledTime && !scheduleError ? { at: scheduledTime, end: scheduleEndTime || null } : null,
      scheduleError,
      auditError,
      createdAds: allCreatedAds,
      batchId: lastBatchId,
      launchMeta: {
        cta,
        webLink: webLink.trim(),
        headline: globalHeadline,
        primaryText: globalPrimaryText,
        pageId: selectedPageId || "",
        pageName: pages.find(p => p.id === selectedPageId)?.name || "",
        adAccountId: selectedAccountId || "",
        adAccountName: selectedAccount?.name || selectedAccountId || "",
        timestamp: new Date().toISOString(),
      },
    }
    setLaunchResult(result)
    setHistoryReload(n => n + 1)
    setLaunchPhase(totalFailed > 0 && totalCreated === 0 ? "error" : "success")
    if (totalFailed > 0 && totalCreated === 0) setLaunchError("Launch failed")
    setLaunching(false)
  }, [tableRows, selectedAccountId, selectedAccount, selectedPageId, primaryTexts, headlines, cta, webLink, utmParams, launchAsActive, allAdSets, pages])

  const handleSheetsImport = useCallback((rows: ImportedRow[]) => {
    const newRows = rows.map(r => {
      // Resolve adSetName → adSetIds
      let adSetIds: string[]
      if (r.adSetName) {
        const nameLower = r.adSetName.toLowerCase()
        const matched = allAdSets.filter((a: AdSet) => a.name.toLowerCase() === nameLower).map((a: AdSet) => a.id)
        adSetIds = matched.length > 0 ? matched : selectedAdSets.map((a: AdSet) => a.id)
      } else {
        adSetIds = selectedAdSets.map((a: AdSet) => a.id)
      }
      // Resolve pageName → pageId
      let pageId: string | undefined = undefined
      if (r.pageName) {
        const nameLower = r.pageName.toLowerCase()
        const matched = pages.find((p: FacebookPage) => p.name.toLowerCase() === nameLower)
        if (matched) pageId = matched.id
      }
      return {
        id: crypto.randomUUID(),
        creative: r.creative,
        adName: r.adName,
        primaryText: r.primaryText,
        headline: r.headline,
        description: r.description,
        adSetIds,
        pageId: pageId || undefined,
        cta: r.cta || undefined,
        webLink: r.webLink || undefined,
        urlTags: r.urlTags || undefined,
        promoCode: r.promoCode || undefined,
        launchAsActive: r.launchAsActive,
      }
    })
    setTableRows(prev => {
      const hasContent = prev.some(r => r.creative || r.adName.trim() || r.primaryText.trim())
      if (!hasContent) return newRows

      // Merge: match CSV rows to existing table rows, update in-place, append unmatched.
      // Primary match: creative.id (exact). Fallback: ad name vs creative file_name (no extension).
      const creativeIdToIdx = new Map<string, number>()
      const fileNameToIdx = new Map<string, number>()
      prev.forEach((r, i) => {
        if (r.creative?.id) creativeIdToIdx.set(r.creative.id, i)
        if (r.creative?.file_name) {
          fileNameToIdx.set(r.creative.file_name.toLowerCase().replace(/\.[^/.]+$/, ""), i)
        }
        if (r.adName) fileNameToIdx.set(r.adName.toLowerCase().trim(), i)
      })

      const updated = [...prev]
      const unmatched: typeof newRows = []
      const matchedIdx = new Set<number>()

      for (const nr of newRows) {
        let idx = nr.creative?.id ? creativeIdToIdx.get(nr.creative.id) : undefined
        if (idx === undefined && nr.adName) {
          idx = fileNameToIdx.get(nr.adName.toLowerCase().trim())
        }
        if (idx !== undefined && !matchedIdx.has(idx)) {
          matchedIdx.add(idx)
          updated[idx] = {
            ...updated[idx],
            ...(nr.adName       ? { adName: nr.adName }             : {}),
            ...(nr.primaryText  ? { primaryText: nr.primaryText }   : {}),
            ...(nr.headline     ? { headline: nr.headline }         : {}),
            ...(nr.description  ? { description: nr.description }   : {}),
            ...(nr.adSetIds.length > 0 ? { adSetIds: nr.adSetIds } : {}),
            ...(nr.pageId       ? { pageId: nr.pageId }             : {}),
            ...(nr.cta          ? { cta: nr.cta }                   : {}),
            ...(nr.webLink      ? { webLink: nr.webLink }           : {}),
            ...(nr.urlTags      ? { urlTags: nr.urlTags }           : {}),
            ...(nr.promoCode    ? { promoCode: nr.promoCode }       : {}),
            ...(nr.launchAsActive !== undefined ? { launchAsActive: nr.launchAsActive } : {}),
          }
        } else {
          unmatched.push(nr)
        }
      }

      return [...updated, ...unmatched]
    })
    setMode("table")
  }, [selectedAdSets, allAdSets, pages, cta, webLink])

  const exportTableCSV = () => {
    const headers = ["Ad Name", "Primary Text", "Headline", "Description", "Ad Sets", "CTA", "Web Link"]
    const csv = [
      headers.join(","),
      ...tableRows.map(r => [
        JSON.stringify(r.adName),
        JSON.stringify(r.primaryText),
        JSON.stringify(r.headline),
        JSON.stringify(r.description),
        JSON.stringify(r.adSetIds.map(id => allAdSets.find(a => a.id === id)?.name || id).join(";")),
        JSON.stringify(r.cta || ""),
        JSON.stringify(r.webLink || ""),
      ].join(","))
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = "ads-table.csv"; a.click()
    URL.revokeObjectURL(url)
  }

  const selectedPage = pages.find(p => p.id === selectedPageId)
  const launchBootLoading = adAccountsLoading || (Boolean(activeOrgId && selectedAccountId) && pagesLoading)
  if (launchBootLoading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <IconLoader2 className="size-6 animate-spin text-primary" />
          <div className="font-medium text-foreground">Loading launcher…</div>
          <div>{adAccountsLoading ? "Loading ad accounts…" : "Loading Facebook pages…"}</div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Prefill notice — Templates → Launch, or Ads Manager → To Launcher */}
      {(prefillBanner || prefillError) && (
        <div className={cn(
          "sticky top-0 z-40 mx-4 mt-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 border",
          prefillError
            ? "bg-destructive/10 border-destructive/30 text-destructive"
            : "bg-primary/10 border-primary/20 text-primary/90 dark:text-primary"
        )}>
          {prefillError ? <IconAlertTriangle className="size-3.5 shrink-0" /> : <IconCircleCheck className="size-3.5 shrink-0" />}
          <span className="flex-1">{prefillError || prefillBanner}</span>
          <button onClick={() => { setPrefillBanner(""); setPrefillError("") }} className="opacity-60 hover:opacity-100">
            <IconX className="size-3.5" />
          </button>
        </div>
      )}
      <LoadMediaModal open={mediaModalOpen} onClose={() => setMediaModalOpen(false)}
        adAccountId={selectedAccountId} adAccounts={adAccounts} alreadySelected={selectedMediaIds}
        refreshSignal={mediaRefreshSignal}
        onConfirm={(ids, creatives) => {
          setSelectedMediaIds(new Set(ids))
          setSelectedCreatives(creatives)
          // Auto-fill empty form fields from first creative's saved metadata
          // (so preview & launch have proper text/CTA/URL when picking from Media Library)
          const first = creatives.find(c => c.headline || c.primary_text || c.link_url)
          if (first) {
            // Only fill fields that are currently empty
            if (!primaryTexts.some(t => t.trim()) && first.primary_text) {
              setPrimaryTexts([first.primary_text])
            }
            if (!headlines.some(h => h.trim()) && first.headline) {
              setHeadlines([first.headline])
            }
            if (!descriptions.some(d => d.trim()) && (first as any).description) {
              setDescriptions([(first as any).description])
            }
            if (!webLink && first.link_url) {
              setWebLink(first.link_url)
            }
            if (cta === "LEARN_MORE" && first.cta && first.cta !== "LEARN_MORE") {
              setCta(first.cta)
            }
          }
        }} />
      {/* Creative picker for TableMode rows — multi-select supported */}
      <LoadMediaModal open={creativePickerRowId !== null} onClose={() => setCreativePickerRowId(null)}
        adAccountId={selectedAccountId} adAccounts={adAccounts} alreadySelected={new Set()}
        onConfirm={(ids, creatives) => {
          if (creatives.length > 0 && creativePickerRowId) {
            setTableRows(prev => {
              const idx = prev.findIndex(r => r.id === creativePickerRowId)
              if (idx < 0) return prev
              const baseRow = prev[idx]
              // First creative → update the clicked row
              const firstClean = (creatives[0].file_name || "").replace(/\.[^/.]+$/, "")
              const updatedBase: TableRow = {
                ...baseRow,
                creative: creatives[0],
                adName: baseRow.adName?.trim() ? baseRow.adName : firstClean,
              }
              // Extra creatives → new rows inserted after, inheriting base row settings
              const extraRows: TableRow[] = creatives.slice(1).map((c, i) => ({
                ...baseRow,
                id: crypto.randomUUID(),
                creative: c,
                adName: (c.file_name || "").replace(/\.[^/.]+$/, ""),
              }))
              return [
                ...prev.slice(0, idx),
                updatedBase,
                ...extraRows,
                ...prev.slice(idx + 1),
              ]
            })
          }
          setCreativePickerRowId(null)
        }} />
      <ScheduleModal open={scheduleModalOpen} onClose={() => setScheduleModalOpen(false)}
        onConfirm={(start, end) => mode === "table" ? doTableLaunch(start, end) : doLaunch(start, end)} />
      <CreateCampaignModal
        open={createCampaignOpen}
        onClose={() => setCreateCampaignOpen(false)}
        onSuccess={() => setAdSetsRefreshKey(key => key + 1)}
      />
      <LaunchProgressDialog
        phase={launchPhase}
        open={launchProgressOpen}
        onOpenChange={setLaunchProgressOpen}
        error={launchError}
        result={launchResult ? {
          success: launchResult.created,
          errors: launchResult.failed,
          total: launchResult.created + launchResult.failed,
          ads: [
            ...launchResult.createdAds.map(ad => ({
              name: ad.fileName || ad.adSetName || ad.adId,
              status: "created",
            })),
            ...launchResult.errors.map(e => ({
              name: e.fileName || e.adSetId,
              status: "error",
            })),
          ],
        } : null}
      />
      {mode === "table" && launchResult && (
        <LaunchResultModal result={launchResult} onClose={() => setLaunchResult(null)} />
      )}
      <AdProfilesModal
        open={adProfilesOpen}
        onClose={() => setAdProfilesOpen(false)}
        pages={pages}
        selectedPageId={selectedPageId}
        selectedIgId={selectedIgPageId}
        onConfirm={(pageId, igId, igCache) => {
          setSelectedPageId(pageId)
          setSelectedIgPageId(igId)
          setIgAccountCache(igCache)
          if (selectedAccountId) savePagePref(selectedAccountId, pageId, igId)
        }}
      />
      <PartnershipAdsModal
        open={partnershipModalOpen}
        onClose={() => setPartnershipModalOpen(false)}
        pages={pages}
        selectedPageId={selectedPageId}
        selectedIgId={selectedIgPageId}
        igAccountCache={igAccountCache}
        value={partnership}
        onConfirm={setPartnership}
      />
      <MultilanguageAdsModal
        open={multilanguageOpen}
        onClose={() => setMultilanguageOpen(false)}
        value={multilanguage}
        onConfirm={setMultilanguage}
        basePrimaryText={primaryTexts.find(t => t.trim()) || ""}
        baseHeadline={headlines.find(h => h.trim()) || ""}
        baseDescription={descriptions.find(d => d.trim()) || ""}
      />
      <CollectionAdsModal
        open={collectionModalOpen}
        onClose={() => setCollectionModalOpen(false)}
        value={collectionAds}
        onConfirm={(v) => { setCollectionAds(v); setAdFormat({ type: v.enabled ? "collection" : "single" }) }}
        baseWebLink={webLink}
        adAccountId={selectedAccountId}
      />
      <CatalogAdsModal
        open={catalogModalOpen}
        onClose={() => setCatalogModalOpen(false)}
        value={catalogAds}
        onConfirm={(v) => { setCatalogAds(v); setAdFormat({ type: v.enabled ? "catalog" : "single" }) }}
        adAccountId={selectedAccountId}
      />
      <CarouselAdsModal
        open={carouselModalOpen}
        onClose={() => setCarouselModalOpen(false)}
        value={carouselAds}
        onConfirm={setCarouselAds}
        availableCreatives={selectedCreatives}
        baseHeadline={headlines.find(h => h.trim()) || ""}
        baseLinkUrl={webLink}
        baseCta={cta}
      />
      <FlexibleAdsModal
        open={flexibleModalOpen}
        onClose={() => setFlexibleModalOpen(false)}
        value={flexibleAds}
        onConfirm={setFlexibleAds}
        availableCreatives={selectedCreatives}
      />
      <CreativeGroupModal
        open={creativeGroupModalOpen}
        onClose={() => setCreativeGroupModalOpen(false)}
        value={flexibleAds}
        onConfirm={setFlexibleAds}
        availableCreatives={selectedCreatives}
      />
      <MultiPlacementAdsModal
        open={multiPlacementModalOpen}
        onClose={() => setMultiPlacementModalOpen(false)}
        value={multiPlacementAds}
        onConfirm={setMultiPlacementAds}
        availableCreatives={selectedCreatives}
      />

      {uploadDockOpen && (
        <UploadDock
          uploads={uploads}
          onCancel={cancelUpload}
          onClear={clearUploads}
          onClose={closeUploadDock}
        />
      )}

      <PreviewModal
        open={previewModalOpen}
        onClose={closePreviewModal}
        creatives={selectedCreatives}
        page={selectedPage}
        primaryText={primaryTexts.find(t => t.trim()) || ""}
        headline={headlines.find(h => h.trim()) || ""}
        description={descriptions.find(d => d.trim()) || ""}
        webLink={webLink}
        cta={cta}
        adNameOverrides={adNameOverrides}
        onUpdateCreative={(c) => setSelectedCreatives(prev => prev.map(x => x.id === c.id ? c : x))}
        confirmMode={previewConfirmMode}
        onConfirmLaunch={confirmPendingLaunch}
        launching={launching}
        showSkipOption={previewShowSkip}
        skipPreview={skipPreviewGate}
        onToggleSkipPreview={updateSkipPreviewGate}
      />

      <div className="flex flex-col">
        {/* ── Top bar ─────────────────────────────────────────────── */}
        <div className="flex items-end gap-4 px-4 pt-2 pb-2.5 border-b shrink-0 bg-background sticky top-0 z-[30] overflow-x-auto">

          {/* Ad Account custom dropdown */}
          <div className="flex flex-col gap-1 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium tracking-wide">Ad Account •</span>
              <PlatformStatusPopover />
            </div>
            <AdAccountDropdown
              accounts={adAccounts}
              selectedId={selectedAccountId}
              onSelect={setSelectedAccountId}
            />
          </div>

          {/* Divider */}
          <div className="w-px bg-border mb-1 shrink-0" style={{ height: 32 }} />

          {/* Facebook page pill → opens Ad Profiles modal */}
          <div className="flex flex-col gap-1 shrink-0">
            <div className="flex items-center gap-1">
              <IconBrandFacebook className="size-3 text-[#1877F2]" />
              <span className="text-xs text-muted-foreground">Facebook</span>
              {pagesError && (
                needsReconnect ? (
                  <a href="/connect" className="text-xs text-red-600 hover:underline" title={pagesError}>
                    Reconnect ⚠
                  </a>
                ) : (
                  <span title={pagesError} className="text-xs text-amber-600 cursor-help">⚠</span>
                )
              )}
            </div>
            <button
              onClick={() => setAdProfilesOpen(true)}
              title={pagesError || (selectedPage?.name) || "Select Facebook page"}
              className={cn(
                "h-8 flex items-center gap-1.5 px-2.5 rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-black dark:text-white hover:bg-zinc-50 dark:hover:bg-zinc-700/60 transition-colors min-w-[140px] max-w-[200px]",
                pagesError && "border-amber-300",
                validationErrors.page && "border-destructive"
              )}
            >
              {selectedPage?.picture?.data?.url ? (
                <img src={selectedPage.picture.data.url} className="size-5 rounded-full shrink-0 object-cover" alt="" />
              ) : (
                <div className="size-5 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-rose-400">{selectedPage?.name?.slice(0, 1) || "P"}</span>
                </div>
              )}
              <span className="text-sm truncate flex-1 text-left">
                {selectedPage?.name || (pagesError ? "No pages" : "Select page...")}
              </span>
              <IconChevronDown className="size-3.5 text-muted-foreground shrink-0" />
            </button>
          </div>

          {/* Instagram pill → same Ad Profiles modal */}
          <div className="flex flex-col gap-1 shrink-0">
            <div className="flex items-center gap-1">
              <IconBrandInstagram className="size-3 text-[#E1306C]" />
              <span className="text-xs text-muted-foreground">Instagram</span>
            </div>
            <button
              onClick={() => setAdProfilesOpen(true)}
              className="h-8 flex items-center gap-1.5 px-2.5 rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-black dark:text-white hover:bg-zinc-50 dark:hover:bg-zinc-700/60 transition-colors min-w-[140px] max-w-[200px]"
            >
              {(() => {
                const isFbActor = selectedIgPageId.startsWith("fb_")
                if (isFbActor && selectedPage?.picture?.data?.url) {
                  return <img src={selectedPage.picture.data.url} className="size-5 rounded-full shrink-0 object-cover" alt="" />
                }
                const igAccount = Object.values(igAccountCache).flat().find(ig => ig.id === selectedIgPageId)
                if (igAccount?.profile_pic) {
                  return <img src={igAccount.profile_pic} className="size-5 rounded-full shrink-0 object-cover" alt="" />
                }
                return (
                  <div className="size-5 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-purple-400">I</span>
                  </div>
                )
              })()}
              <span className="text-sm truncate flex-1 text-left">
                {(() => {
                  const isFbActor = selectedIgPageId.startsWith("fb_")
                  if (isFbActor) return "Use Facebook Page"
                  const igAccount = Object.values(igAccountCache).flat().find(ig => ig.id === selectedIgPageId)
                  if (igAccount?.username) return `@${igAccount.username}`
                  if (selectedIgPageId) return selectedIgPageId
                  return "Select account..."
                })()}
              </span>
              <IconChevronDown className="size-3.5 text-muted-foreground shrink-0" />
            </button>
          </div>

          {/* Right: mode toggle */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
              onClick={() => {
                if (mode === "gallery") {
                  // Sync gallery state → table rows when switching to table mode.
                  // Rows already present for a creative are kept as-is so table-mode
                  // edits survive a gallery round-trip; only new creatives get gallery defaults.
                  const ptList = primaryTexts.filter(t => t.trim())
                  const hlList = headlines.filter(h => h.trim())
                  const descList = descriptions.filter(d => d.trim())
                  const adSetIdList = selectedAdSets.map(a => a.id)
                  const newRow = (c: Creative | null, i: number): TableRow => ({
                    id: c ? `tr_${c.id}_${i}` : "tr_empty",
                    creative: c,
                    adName: c ? (adNameOverrides[c.id] || (c.file_name || "").replace(/\.[^/.]+$/, "")) : "",
                    primaryText: ptList[0] || "",
                    primaryTextVariations: ptList.slice(1),
                    headline: hlList[0] || "",
                    headlineVariations: hlList.slice(1),
                    description: descList[0] || "",
                    descriptionVariations: descList.slice(1),
                    adSetIds: adSetIdList,
                    cta,
                    webLink,
                  })
                  if (selectedCreatives.length > 0) {
                    setTableRows(selectedCreatives.map((c, i) => tableRows.find(r => r.creative?.id === c.id) || newRow(c, i)))
                  } else {
                    setTableRows(prev => [prev.find(r => !r.creative) || newRow(null, 0)])
                  }
                  setMode("table")
                } else {
                  // Sync table state → gallery form when switching back, so edits made
                  // in table mode aren't lost the next time gallery → table runs.
                  const firstRow = tableRows.find(r => r.creative || r.primaryText || r.headline || r.description)
                  if (firstRow) {
                    const pts = [firstRow.primaryText, ...(firstRow.primaryTextVariations || [])].filter(v => v.trim())
                    const hls = [firstRow.headline, ...(firstRow.headlineVariations || [])].filter(v => v.trim())
                    const descs = [firstRow.description, ...(firstRow.descriptionVariations || [])].filter(v => v.trim())
                    setPrimaryTexts(pts.length ? pts : [""])
                    setHeadlines(hls.length ? hls : [""])
                    setDescriptions(descs.length ? descs : [""])
                    if (firstRow.cta) setCta(firstRow.cta)
                    if (firstRow.webLink) setWebLink(firstRow.webLink)
                    if (firstRow.adSetIds.length) {
                      const matched = firstRow.adSetIds.map(id => allAdSets.find(a => a.id === id)).filter(Boolean) as AdSet[]
                      if (matched.length) setSelectedAdSets(matched)
                    }
                  }
                  setMode("gallery")
                }
              }}>
              {mode === "gallery"
                ? <><IconTable className="size-3.5" />Edit in Table Mode</>
                : <><IconLayoutGrid className="size-3.5" />Edit in Gallery Mode</>}
            </Button>
          </div>
        </div>

        {/* ── Main area ─────────────────────────────────────────── */}
        {mode === "gallery" ? (
          <div className="flex flex-col">
            <div className="flex flex-col lg:flex-row w-full" style={{ minHeight: 'calc(100vh - 80px)' }}>
            {/* Left panel — Ad Sets + Ad Setup */}
            <div className="flex flex-col gap-5 p-4 overflow-y-auto border-b lg:border-b-0 w-full lg:w-auto shrink-0" style={{ maxHeight: 'calc(100vh - 80px)', width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? leftPanelWidth : '100%' }}>
              <AdSetsPanel
                adAccountId={selectedAccountId}
                selectedAdSets={selectedAdSets}
                onSelect={a => setSelectedAdSets(prev => [...prev, a])}
                onRemove={id => setSelectedAdSets(prev => prev.filter(a => a.id !== id))}
                invalid={validationErrors.adsets}
                refreshKey={adSetsRefreshKey}
              />
              <div className="border-t border-border/60 pt-5">
                <AdSetupPanel
                  primaryTexts={primaryTexts} setPrimaryTexts={setPrimaryTexts}
                  headlines={headlines} setHeadlines={setHeadlines}
                  descriptions={descriptions} setDescriptions={setDescriptions}
                  cta={cta} setCta={setCta}
                  webLink={webLink} setWebLink={setWebLink}
                  launchAsActive={launchAsActive} setLaunchAsActive={setLaunchAsActive}
                  oneAdPerAdset={oneAdPerAdset} setOneAdPerAdset={setOneAdPerAdset}
                  utmParams={utmParams} setUtmParams={setUtmParams}
                  displayLink={displayLink} setDisplayLink={setDisplayLink}
                  adAccountId={selectedAccountId}
                  adAccountName={selectedAccount?.name || selectedAccountId}
                  orgName="tuanquang269"
                  selectedCreatives={selectedCreatives}
                  adSourceMode={adSourceMode} setAdSourceMode={setAdSourceMode}
                  adSourceIds={adSourceIds} setAdSourceIds={setAdSourceIds}
                  validationErrors={validationErrors}
                  onSettingsSaved={(s) => {
                    _setOneAdPerAdset(!!s.launch?.oneAdPerAdset)
                    setLaunchAsActive(!s.launch?.launchAsPaused)
                  }}
                />
              </div>
            </div>

            {/* Drag handle (Desktop only) */}
            <div 
              className="hidden lg:flex w-2 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 shrink-0 border-x transition-colors z-10"
              onMouseDown={startResizing}
            />
            {/* Right panel — Ads Gallery */}
            <div className="flex-1 flex flex-col min-w-[400px] lg:border-l overflow-hidden" style={{ maxHeight: 'calc(100vh - 80px)' }}>
              <div className={cn("flex items-center gap-2 px-4 py-2 border-b shrink-0", validationErrors.creatives && "border-b-destructive")}>
                <span className="text-sm font-semibold">Ads {selectedCreatives.length > 0 && <span className="text-muted-foreground font-normal">({selectedCreatives.length})</span>}</span>
                {selectedCreatives.length > 0 && (
                  <button
                    onClick={() => { setSelectedMediaIds(new Set()); setSelectedCreatives([]); setAdNameOverrides({}) }}
                    className="flex items-center justify-center size-5 rounded-md bg-red-500 hover:bg-red-600 transition-colors"
                    title="Clear all ads"
                  >
                    <IconX className="size-3 text-white" />
                  </button>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" className="gap-1.5 h-8 px-3 text-xs font-semibold shadow-sm" onClick={() => setCreateCampaignOpen(true)}>
                    <IconPlus className="size-3.5" />New Campaign
                  </Button>
                  <div className="h-5 w-px bg-border mx-0.5" />

                  {/* Partnership Ads */}
                  <button title="Partnership Ads" onClick={() => setPartnershipModalOpen(true)}
                    className={cn("size-7 flex items-center justify-center rounded hover:bg-muted/60 transition-colors relative",
                      partnership.enabled && !!partnership.partnerPageId ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground")}>
                    <IconUsers className="size-4" />
                    {partnership.enabled && !!partnership.partnerPageId && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />}
                  </button>

                  {/* Multilanguage */}
                  <button title="Multilanguage Ads" onClick={() => setMultilanguageOpen(true)}
                    className={cn("size-7 flex items-center justify-center rounded hover:bg-muted/60 transition-colors relative",
                      multilanguage.enabled && multilanguage.translations.length > 0 ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground")}>
                    <IconLanguage className="size-4" />
                    {multilanguage.enabled && multilanguage.translations.length > 0 && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />}
                  </button>

                  {/* Ad Format popover */}
                  <div ref={adFormatRef} className="relative">
                    <button title="Ad Format" onClick={() => setAdFormatPopoverOpen(o => !o)}
                      className={cn("size-7 flex items-center justify-center rounded hover:bg-muted/60 transition-colors relative",
                        adFormat.type !== "single" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground")}>
                      <IconBuildingStore className="size-4" />
                      {adFormat.type !== "single" && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />}
                    </button>
                    {adFormatPopoverOpen && (
                      <div className="absolute top-full right-0 mt-1.5 w-52 bg-popover border rounded-xl shadow-lg z-50 overflow-hidden p-1">
                        <button
                          onClick={() => { setAdFormatPopoverOpen(false); setCollectionModalOpen(true) }}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-accent transition-colors text-left",
                            adFormat.type === "collection" && "bg-primary/5"
                          )}
                        >
                          <IconShoppingBag className="size-4 text-muted-foreground" />
                          <span className="text-sm">Collection ads</span>
                          {adFormat.type === "collection" && <IconCheck className="size-3.5 text-primary ml-auto" />}
                        </button>
                        <button
                          onClick={() => { setAdFormatPopoverOpen(false); setCatalogModalOpen(true) }}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-accent transition-colors text-left",
                            adFormat.type === "catalog" && "bg-primary/5"
                          )}
                        >
                          <IconBox className="size-4 text-muted-foreground" />
                          <span className="text-sm">Catalog Ads</span>
                          {adFormat.type === "catalog" && <IconCheck className="size-3.5 text-primary ml-auto" />}
                        </button>
                        {adFormat.type !== "single" && (
                          <>
                            <div className="border-t my-1" />
                            <button
                              onClick={() => { setAdFormatPopoverOpen(false); setAdFormat({ type: "single" }) }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-accent transition-colors text-left text-muted-foreground"
                            >
                              <IconX className="size-3.5" />
                              <span className="text-sm">Reset to Single Image/Video</span>
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Carousel Ads */}
                  <button title="Create Carousel Ads" onClick={() => setCarouselModalOpen(true)}
                    className={cn("size-7 flex items-center justify-center rounded hover:bg-muted/60 transition-colors relative",
                      carouselAds.enabled && carouselAds.carousels.some(c => c.cards.length >= 2) ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground")}>
                    <IconLayout className="size-4" />
                    {carouselAds.enabled && carouselAds.carousels.some(c => c.cards.length >= 2) && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />}
                  </button>

                  {/* Flexible Ads */}
                  <button title="Flexible Ads (Group Media)" onClick={() => setFlexibleModalOpen(true)}
                    className={cn("size-7 flex items-center justify-center rounded hover:bg-muted/60 transition-colors relative",
                      flexibleAds.enabled && flexibleAds.flexibleAds.length > 0 ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground")}>
                    <IconStack2 className="size-4" />
                    {flexibleAds.enabled && flexibleAds.flexibleAds.length > 0 && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />}
                  </button>

                  {/* Multi Placement Ads */}
                  <button title="Multi Placement Ads" onClick={() => setMultiPlacementModalOpen(true)}
                    className={cn("size-7 flex items-center justify-center rounded hover:bg-muted/60 transition-colors relative",
                      multiPlacementAds.enabled && multiPlacementAds.groups.length > 0 ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground")}>
                    <IconLayoutGrid className="size-4" />
                    {multiPlacementAds.enabled && multiPlacementAds.groups.length > 0 && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />}
                  </button>
                </div>
              </div>

              {launchResult && (
                <LaunchResultModal result={launchResult} onClose={() => {
                  setLaunchResult(null)
                  setLaunchPhase("idle")
                }} />
              )}

              <GalleryMediaPanel
                selectedCreatives={selectedCreatives}
                onOpenModal={() => setMediaModalOpen(true)}
                onDeselect={id => {
                  setSelectedMediaIds(prev => { const s = new Set(prev); s.delete(id); return s })
                  setSelectedCreatives(prev => prev.filter(c => c.id !== id))
                  setAdNameOverrides(prev => { const n = { ...prev }; delete n[id]; return n })
                }}
                onRemoveAll={() => { setSelectedMediaIds(new Set()); setSelectedCreatives([]); setAdNameOverrides({}) }}
                onUploadFiles={handleUploadFiles}
                uploading={uploading}
                uploadProgress={uploadProgress}
                adNameOverrides={adNameOverrides}
                onAdNameChange={(id, name) => setAdNameOverrides(prev => ({ ...prev, [id]: name }))}
              />

              {error && (
                <div className="flex items-center gap-1.5 text-xs text-destructive px-4 pb-1">
                  <IconAlertCircle className="size-3.5 shrink-0" />{error}
                </div>
              )}

              <div className="flex items-center gap-2 px-4 py-3 border-t shrink-0">
                <Tip text="Preview the ads, then confirm to launch.">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => openPreview(() => doLaunch())} disabled={selectedCreatives.length === 0}><IconEye className="size-3.5" />Preview</Button>
                </Tip>
                <Tip text={nothingConfigured ? "Select media first — there is no setup to save yet." : "Save this launch setup as a draft."}>
                  <Button
                    variant="outline" size="sm"
                    className="gap-1.5 text-xs"
                    onClick={saveDraft}
                    disabled={savingDraft || nothingConfigured}
                  >
                    {savingDraft ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconBookmark className="size-3.5" />}
                    {savingDraft ? "Saving..." : "Save Draft"}
                  </Button>
                </Tip>
                <Tip text="Schedule ads to activate later.">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs"
                    onClick={() => { if (validate()) setScheduleModalOpen(true) }}>
                    <IconCalendar className="size-3.5" />Schedule
                  </Button>
                </Tip>
                {videoMissingThumbCount > 0 ? (
                  <div className="flex-1 flex flex-col items-center">
                    <Button variant="outline" className="w-full gap-2 font-medium border-amber-200 bg-amber-50/50 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400" disabled>
                      <IconAlertTriangle className="size-4" />
                      Missing Thumbnails
                    </Button>
                    <span className="text-[10px] text-amber-600 dark:text-amber-500 mt-1">{videoMissingThumbCount} video{videoMissingThumbCount !== 1 ? 's' : ''} missing thumbnail</span>
                  </div>
                ) : (
                  <Tip text={skipPreviewGate ? "Create the ads in Meta with the current setup." : "Preview the ads, then confirm to launch."} className="flex-1">
                    <Button className="w-full gap-2 font-medium" onClick={() => requestLaunch(() => doLaunch())} disabled={launching || selectedCreatives.length === 0}>
                      {launching ? <IconLoader2 className="size-4 animate-spin" /> : <IconRocket className="size-4" />}
                      {launching ? "Launching..." : "Launch Ads"}
                    </Button>
                  </Tip>
                )}
              </div>
            </div>
            </div>
            {relaunchBanner && (
              <div className="mx-4 mb-2 px-3 py-2 bg-primary/10 dark:bg-primary/20 border border-primary/20 dark:border-primary/20 rounded-lg text-xs text-primary/90 dark:text-primary flex items-center gap-2">
                <IconCircleCheck className="size-3.5 shrink-0" />
                {relaunchBanner}
              </div>
            )}
            <LaunchHistorySection
              reloadTrigger={historyReload}
              onRelaunch={handleRelaunch}
              onLoadDraft={handleLoadDraft}
              tabOverride={historyTabOverride}
              pages={pages}
            />
          </div>
        ) : (
          <>
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Table toolbar */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b shrink-0 flex-wrap">
              {/* Title + CSV + Search */}
              <span className="text-sm font-semibold whitespace-nowrap">Table ({tableRows.length} {tableRows.length === 1 ? "ad" : "ads"})</span>
              <button
                onClick={exportTableCSV}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border/60 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Export to CSV"
              >
                <IconDownload className="size-3" />CSV
              </button>
              <div className="relative">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
                <input
                  value={tableSearchQuery}
                  onChange={e => setTableSearchQuery(e.target.value)}
                  placeholder="Search by ad name or copy..."
                  className="pl-7 pr-3 py-1.5 text-xs bg-muted/40 border rounded-lg outline-none focus:ring-1 focus:ring-ring w-48 placeholder:text-muted-foreground/50"
                />
                {tableSearchQuery && (
                  <button onClick={() => setTableSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <IconX className="size-3" />
                  </button>
                )}
              </div>

              {/* Divider */}
              <div className="h-5 w-px bg-border mx-0.5" />

              {/* Auto-sync toggle */}
              <div className="flex items-center gap-1.5" title={tableAutoSync ? "Auto-sync ON: gallery changes propagate to all rows" : "Auto-sync OFF"}>
                <button
                  onClick={() => setTableAutoSync(s => !s)}
                  className={cn("relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors shrink-0",
                    tableAutoSync ? "bg-primary" : "bg-muted-foreground/30")}
                >
                  <span className={cn("inline-block size-3 rounded-full bg-white shadow-sm transition-transform",
                    tableAutoSync ? "translate-x-[18px]" : "translate-x-0.5")} />
                </button>
              </div>

              {/* Ad Profile button */}
              <button
                onClick={() => setAdProfilesOpen(true)}
                className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Ad Profile (Facebook & Instagram)"
              >
                <IconUsers className="size-3.5" />
              </button>

              {/* Sync button */}
              <button
                onClick={syncTableFromGallery}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Sync ad copy from Gallery Mode to all table rows"
              >
                <IconRefresh className="size-3.5" />Sync
              </button>

              {/* Configure columns */}
              <button
                onClick={() => { setToolbarNotice("Configure columns is not available yet."); setTimeout(() => setToolbarNotice(""), 3000) }}
                className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Configure columns"
              >
                <IconArrowsSort className="size-3.5" />
              </button>

              {/* Right section */}
              <div className="ml-auto flex items-center gap-1">
                {/* Column view buttons */}
                <button
                  onClick={() => setTableViewMode("single")}
                  className={cn("p-1.5 rounded transition-colors",
                    tableViewMode === "single"
                      ? "bg-primary/10 border border-primary/20 text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                  title="Single column view"
                >
                  <IconLayout className="size-3.5" />
                </button>
                <button
                  onClick={() => setTableViewMode("stacked")}
                  className={cn("p-1.5 rounded transition-colors",
                    tableViewMode === "stacked"
                      ? "bg-primary/10 border border-primary/20 text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                  title="Stacked view"
                >
                  <IconStack2 className="size-3.5" />
                </button>
                <button
                  onClick={() => setTableViewMode("grid")}
                  className={cn("p-1.5 rounded transition-colors",
                    tableViewMode === "grid"
                      ? "bg-primary/10 border border-primary/20 text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                  title="Grid view"
                >
                  <IconLayoutGrid className="size-3.5" />
                </button>
                <button
                  onClick={() => setTableViewMode("side-by-side")}
                  className={cn("p-1.5 rounded transition-colors",
                    tableViewMode === "side-by-side"
                      ? "bg-primary/10 border border-primary/20 text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                  title="Side-by-side view"
                >
                  <IconSelector className="size-3.5" />
                </button>

                {/* History panel toggle */}
                <button
                  onClick={() => setTableHistoryOpen(o => !o)}
                  className={cn("flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors",
                    tableHistoryOpen
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "border-border/60 hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                  )}
                  title={tableHistoryOpen ? "Hide history panel" : "Show history panel"}
                >
                  <IconClock className="size-3.5" />History
                </button>

                {/* Bulk Edit dropdown */}
                <div ref={tableBulkRef} className="relative">
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1 px-2.5"
                    onClick={() => setTableBulkOpen(o => !o)}
                  >
                    <IconPencil className="size-3" />Bulk Edit<IconChevronDown className="size-3" />
                  </Button>
                  {tableBulkOpen && (
                    <div className="absolute right-0 top-full mt-1 bg-popover border rounded-xl shadow-lg z-50 w-52 overflow-hidden py-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 py-1.5">Apply to all rows</p>
                      {[
                        { label: "Primary Text from Gallery", emptyMsg: "Primary Text is empty in Gallery Mode — nothing to apply.", apply: () => { const pt = primaryTexts.find(t => t.trim()) || ""; if (!pt) return false; setTableRows(prev => prev.map(r => ({ ...r, primaryText: pt }))); return true } },
                        { label: "Headline from Gallery", emptyMsg: "Headline is empty in Gallery Mode — nothing to apply.", apply: () => { const hl = headlines.find(h => h.trim()) || ""; if (!hl) return false; setTableRows(prev => prev.map(r => ({ ...r, headline: hl }))); return true } },
                        { label: "Description from Gallery", emptyMsg: "Description is empty in Gallery Mode — nothing to apply.", apply: () => { const descList = descriptions.filter(d => d.trim()); if (!descList.length) return false; setTableRows(prev => prev.map(r => ({ ...r, description: descList[0], descriptionVariations: descList.slice(1) }))); return true } },
                        { label: "Ad Sets from Gallery", emptyMsg: "No Ad Sets selected in Gallery Mode — nothing to apply.", apply: () => { const ids = selectedAdSets.map((a: AdSet) => a.id); if (!ids.length) return false; setTableRows(prev => prev.map(r => ({ ...r, adSetIds: ids }))); return true } },
                        { label: "CTA from Gallery", emptyMsg: "No CTA set in Gallery Mode — nothing to apply.", apply: () => { if (!cta) return false; setTableRows(prev => prev.map(r => ({ ...r, cta }))); return true } },
                      ].map(item => (
                        <button
                          key={item.label}
                          onClick={() => {
                            const applied = item.apply()
                            setTableBulkOpen(false)
                            setToolbarNotice(applied ? `Applied to all rows: ${item.label.replace(" from Gallery", "")}.` : item.emptyMsg)
                            setTimeout(() => setToolbarNotice(""), 3000)
                          }}
                          className="w-full px-3 py-2 text-xs text-left hover:bg-accent transition-colors"
                        >
                          {item.label}
                        </button>
                      ))}
                      <div className="border-t my-1" />
                      <button
                        onClick={() => {
                          setTableRows(prev => prev.map(r => ({ ...r, adSetIds: [] })))
                          setTableBulkOpen(false)
                          setToolbarNotice("Cleared Ad Sets on all rows.")
                          setTimeout(() => setToolbarNotice(""), 3000)
                        }}
                        className="w-full px-3 py-2 text-xs text-left hover:bg-accent transition-colors text-destructive"
                      >
                        Clear all Ad Sets
                      </button>
                    </div>
                  )}
                </div>

                {/* 3-dot more menu */}
                <div ref={tableMoreRef} className="relative">
                  <button
                    onClick={() => setTableMoreOpen(o => !o)}
                    className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                    title="More options"
                  >
                    <IconDotsVertical className="size-4" />
                  </button>
                  {tableMoreOpen && (
                    <div className="absolute right-0 top-full mt-1 bg-popover border rounded-xl shadow-lg z-50 w-44 overflow-hidden py-1">
                      <button onClick={() => { addTableRow(); setTableMoreOpen(false) }} className="w-full px-3 py-2 text-xs text-left hover:bg-accent transition-colors flex items-center gap-2">
                        <IconPlus className="size-3.5" />Add new row
                      </button>
                      <button onClick={() => { exportTableCSV(); setTableMoreOpen(false) }} className="w-full px-3 py-2 text-xs text-left hover:bg-accent transition-colors flex items-center gap-2">
                        <IconDownload className="size-3.5" />Export CSV
                      </button>
                      <button onClick={() => { setSheetsImportOpen(true); setTableMoreOpen(false) }} className="w-full px-3 py-2 text-xs text-left hover:bg-accent transition-colors flex items-center gap-2">
                        <IconTable className="size-3.5 text-emerald-600" />Import from Google Sheets
                      </button>
                      <button onClick={() => { syncTableFromGallery(); setTableMoreOpen(false) }} className="w-full px-3 py-2 text-xs text-left hover:bg-accent transition-colors flex items-center gap-2">
                        <IconRefresh className="size-3.5" />Sync from Gallery
                      </button>
                      <div className="border-t my-1" />
                      <button onClick={() => { setTableRows([{ id: String(Date.now()), creative: null, adName: "", primaryText: "", headline: "", description: "", adSetIds: [] }]); setTableMoreOpen(false) }} className="w-full px-3 py-2 text-xs text-left hover:bg-accent transition-colors flex items-center gap-2 text-destructive">
                        <IconTrash className="size-3.5" />Clear all rows
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {toolbarNotice && (
              <div className="absolute right-4 top-16 z-50 bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs text-foreground animate-in fade-in slide-in-from-top-1">
                {toolbarNotice}
              </div>
            )}

            <div className="flex flex-1 min-h-0 overflow-hidden">
              <TableMode
                rows={tableRows}
                adSets={allAdSets}
                onAddRow={addTableRow}
                onUpdateRow={updateTableRow}
                onDeleteRow={deleteTableRow}
                onDuplicateRow={duplicateTableRow}
                selectedPage={selectedPage}
                igAccountCache={igAccountCache}
                selectedIgPageId={selectedIgPageId}
                searchQuery={tableSearchQuery}
                launchAsActive={launchAsActive}
                onOpenCreativePicker={(rowId) => setCreativePickerRowId(rowId)}
                onUploadRowFiles={uploadTableRowFiles}
                pages={pages}
                selectedAccountId={selectedAccountId || ""}
                viewMode={tableViewMode}
              />
            </div>

            {error && (
              <div className="flex items-center gap-1.5 text-xs text-destructive px-4 py-1">
                <IconAlertCircle className="size-3.5" />{error}
              </div>
            )}

            <div className="flex items-center gap-2 px-4 py-3 border-t shrink-0">
              <Tip text="Preview the ads, then confirm to launch.">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => openPreview(() => {
                  const hasRowCreatives = tableRows.some(r => r.creative?.id && r.adSetIds.length > 0)
                  hasRowCreatives ? doTableLaunch() : doLaunch()
                })} disabled={selectedCreatives.length === 0}><IconEye className="size-3.5" />Preview Ads</Button>
              </Tip>
              <Tip text={nothingConfigured ? "Add a row first — there is no setup to save yet." : "Save this launch setup as a draft."}>
                <Button
                  variant="outline" size="sm"
                  className="gap-1.5 text-xs"
                  onClick={saveDraft}
                  disabled={savingDraft || nothingConfigured}
                >
                  {savingDraft ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconBookmark className="size-3.5" />}
                  {savingDraft ? "Saving..." : "Save Draft"}
                </Button>
              </Tip>
              <Tip text="Schedule ads to activate later.">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setScheduleModalOpen(true)}>
                  <IconCalendar className="size-3.5" />Schedule
                </Button>
              </Tip>
              <Tip text={skipPreviewGate ? "Create the ads in Meta with the current setup." : "Preview the ads, then confirm to launch."} className="flex-1">
                <Button
                  className="w-full gap-2 font-medium"
                  onClick={() => requestLaunch(() => {
                    const hasRowCreatives = tableRows.some(r => r.creative?.id && r.adSetIds.length > 0)
                    hasRowCreatives ? doTableLaunch() : doLaunch()
                  })}
                  disabled={launching}
                >
                  {launching ? <IconLoader2 className="size-4 animate-spin" /> : <IconRocket className="size-4" />}
                  {launching ? "Launching..." : "Launch Ads"}
                </Button>
              </Tip>
            </div>
          </div>
          {tableHistoryOpen && (
            <LaunchHistorySection
              reloadTrigger={historyReload}
              onRelaunch={handleRelaunch}
              onLoadDraft={handleLoadDraft}
              tabOverride={historyTabOverride}
              pages={pages}
            />
          )}
          </>
        )}

      </div>

      <SheetsImportDialog
        open={sheetsImportOpen}
        onOpenChange={setSheetsImportOpen}
        adAccountId={selectedAccountId || ""}
        onImport={handleSheetsImport}
      />
    </>
  )
}
