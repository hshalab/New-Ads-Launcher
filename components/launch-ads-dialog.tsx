  "use client"

import { useEffect, useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { IconLoader2, IconRocket, IconCheck, IconSearch, IconAlertTriangle, IconPlus, IconTrash, IconX, IconCalendar, IconClock, IconExternalLink, IconDownload, IconUpload } from "@tabler/icons-react"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { CustomAdSetDialog, type CampaignConfig } from "@/components/custom-adset-dialog"
import { AdSetTextDialog, type AdsetTextConfig } from "@/components/adset-text-dialog"
import { AdPerCreativeTextDialog, type AdCreativeTextConfig } from "@/components/ad-per-creative-text-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Campaign { id: string; name: string; status: string; effective_status: string }
interface AdSet { id: string; name: string; status: string; effective_status: string; daily_budget?: string; lifetime_budget?: string }
interface Ad { id: string; name: string; status: string; effective_status: string; creative?: { image_url?: string; thumbnail_url?: string } }
interface FacebookPage { id: string; name: string; category?: string; picture?: { data: { url: string } } }
interface Preset { id: string; name: string; objective: string; targeting: any; optimization_goal: string; bid_strategy?: string; adset_name?: string; campaign_name?: string }
interface PageLink { id: string; name: string; url: string }

type AdsetMode = "existing" | "new" | "per_creative" | "auto_divide" | "custom"

function parseCSV(text: string): string[][] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else field += ch
    } else {
      if (ch === '"' && field === "") inQuotes = true
      else if (ch === ",") { row.push(field); field = "" }
      else if (ch === "\n" || ch === "\r") {
        row.push(field); field = ""
        if (row.some(c => c !== "")) rows.push(row)
        row = []
        if (ch === "\r" && text[i + 1] === "\n") i++
      } else field += ch
    }
  }
  row.push(field)
  if (row.some(c => c !== "")) rows.push(row)
  return rows
}

interface Props {
  open: boolean
  onClose: () => void
  selectedCreativeIds: string[]
  adAccountId: string
}

export function LaunchAdsDialog({ open, onClose, selectedCreativeIds, adAccountId }: Props) {
  // Presets
  const [configSource, setConfigSource] = useState<"preset" | "ad">("ad")
  const [presets, setPresets] = useState<Preset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState("")
  const [loadingPresets, setLoadingPresets] = useState(false)

  // Template picker
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [adsets, setAdsets] = useState<AdSet[]>([])
  const [ads, setAds] = useState<Ad[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [selectedAdset, setSelectedAdset] = useState<AdSet | null>(null)
  const adsetCache = useRef<Map<string, AdSet[]>>(new Map())
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null)
  const [onlyActive, setOnlyActive] = useState(false)
  const [searchCampaign, setSearchCampaign] = useState("")
  const [searchAdset, setSearchAdset] = useState("")
  const [searchAd, setSearchAd] = useState("")
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [loadingAdsets, setLoadingAdsets] = useState(false)
  const [loadingAds, setLoadingAds] = useState(false)

  // Campaign options
  const [createNewCampaign, setCreateNewCampaign] = useState(false)
  const [newCampaignName, setNewCampaignName] = useState("")
  const [adsManagerCampaignName, setAdsManagerCampaignName] = useState("")
  const [adsManagerAdsetName, setAdsManagerAdsetName] = useState("")
  const [createMultipleCampaigns, setCreateMultipleCampaigns] = useState(false)
  const [multipleCampaignNames, setMultipleCampaignNames] = useState<string[]>(["", ""])
  const [creativeDistribution, setCreativeDistribution] = useState<"split" | "duplicate">("split")

  // Adset options
  const [adsetMode, setAdsetMode] = useState<AdsetMode>("existing")
  const [newAdsetName, setNewAdsetName] = useState("")
  const [adsetDailyBudget, setAdsetDailyBudget] = useState("10")
  const [adsetNamePattern, setAdsetNamePattern] = useState("{filename}")
  const [adsPerAdset, setAdsPerAdset] = useState(5)
  const [autoDividePattern, setAutoDividePattern] = useState("Ad Set {index:01}")
  const [customConfig, setCustomConfig] = useState<CampaignConfig[]>([])
  const [customDialogOpen, setCustomDialogOpen] = useState(false)

  // Ad text options
  const [useCommonText, setUseCommonText] = useState(false)
  const [commonHeadlines, setCommonHeadlines] = useState([""])
  const [commonPrimaryTexts, setCommonPrimaryTexts] = useState([""])
  const [commonDescription, setCommonDescription] = useState("")
  const [commonCta, setCommonCta] = useState("LEARN_MORE")
  const [commonWebsiteUrl, setCommonWebsiteUrl] = useState("")
  const [commonDisplayUrl, setCommonDisplayUrl] = useState("")
  const [useUniqueTextPerAdset, setUseUniqueTextPerAdset] = useState(false)
  const [adsetTextConfigs, setAdsetTextConfigs] = useState<AdsetTextConfig[]>([])
  const [adsetTextDialogOpen, setAdsetTextDialogOpen] = useState(false)
  const [useUniqueTextPerCreative, setUseUniqueTextPerCreative] = useState(false)
  const [creativeTextConfigs, setCreativeTextConfigs] = useState<AdCreativeTextConfig[]>([])
  const [adPerCreativeDialogOpen, setAdPerCreativeDialogOpen] = useState(false)

  // Ad name options
  const [useCustomAdName, setUseCustomAdName] = useState(false)
  const [adNamePattern, setAdNamePattern] = useState("{filename}")
  const [filenameTransform, setFilenameTransform] = useState<"title_case" | "uppercase" | "lowercase" | "clean" | "split" | null>(null)

  // Creatives details for preview
  const [creativeDetails, setCreativeDetails] = useState<{
    id: string; file_name: string; file_url: string; media_type: string
    headline?: string; primary_text?: string; description?: string; cta?: string; link_url?: string
    campaign_name?: string; adset_name?: string
  }[]>([])

  // Pages
  const [pages, setPages] = useState<FacebookPage[]>([])
  const [selectedPageId, setSelectedPageId] = useState("")
  const [pagesLoading, setPagesLoading] = useState(false)

  // Creative Enhancements
  const [useMetaDefaults, setUseMetaDefaults] = useState(false)
  const [imageEnhancements, setImageEnhancements] = useState<Set<string>>(new Set())
  const [videoEnhancements, setVideoEnhancements] = useState<Set<string>>(new Set())

  // Pixel Tracking
  const [pixels, setPixels] = useState<{ id: string; name: string }[]>([])
  const [selectedPixelId, setSelectedPixelId] = useState("")
  const [pixelEvent, setPixelEvent] = useState("PURCHASE")
  const [loadingPixels, setLoadingPixels] = useState(false)

  // Landing Pages
  const [pageLinks, setPageLinks] = useState<PageLink[]>([])

  // UTM Parameters
  const [useUtm, setUseUtm] = useState(false)
  const [utmSource, setUtmSource] = useState("facebook")
  const [utmMedium, setUtmMedium] = useState("paid")
  const [utmCampaign, setUtmCampaign] = useState("")
  const [utmContent, setUtmContent] = useState("")
  const [utmTerm, setUtmTerm] = useState("")

  // Publication Options
  const [createPaused, setCreatePaused] = useState(true)
  const [scheduleStart, setScheduleStart] = useState(false)
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined)
  const [scheduleHour, setScheduleHour] = useState("08")
  const [scheduleMinute, setScheduleMinute] = useState("00")

  // Launch
  const [launching, setLaunching] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState("")

  // CSV structure import
  const csvImportRef = useRef<HTMLInputElement>(null)
  const [csvImportSummary, setCsvImportSummary] = useState("")

  useEffect(() => {
    if (!open) return
    // Reset picker state mỗi lần mở dialog
    setSelectedCampaign(null)
    setSelectedAdset(null)
    setSelectedAd(null)
    setAdsets([])
    setAds([])
    adsetCache.current.clear()
    setLoadingCampaigns(true)
    fetch(`/api/facebook/campaigns?ad_account_id=${adAccountId}`)
      .then((r) => r.json())
      .then((d) => setCampaigns(d.campaigns || []))
      .finally(() => setLoadingCampaigns(false))

    fetch(`/api/creatives?ad_account_id=${encodeURIComponent(adAccountId)}&limit=200`)
      .then(r => r.json())
      .then(d => {
        const filtered = (d.creatives || []).filter((c: any) => selectedCreativeIds.includes(c.id))
        setCreativeDetails(filtered)
        // Pre-fill campaign/adset name từ creative đã lưu trong Ads Manager
        const firstWithCamp = filtered.find((c: any) => c.campaign_name)
        const firstWithAdset = filtered.find((c: any) => c.adset_name)
        if (firstWithCamp) {
          setAdsManagerCampaignName(firstWithCamp.campaign_name)
          setNewCampaignName(firstWithCamp.campaign_name)
        }
        if (firstWithAdset) {
          setAdsManagerAdsetName(firstWithAdset.adset_name)
          setNewAdsetName(firstWithAdset.adset_name)
        }
      })

    // Pages are required for launch — gate the dialog body until they land.
    let pagesCancelled = false
    setPagesLoading(true)
    ;(async () => {
      try {
        const cached = sessionStorage.getItem("fb_pages_cache")
        if (cached) {
          const { ts, pages: p } = JSON.parse(cached)
          if (Date.now() - ts < 10 * 60 * 1000 && Array.isArray(p)) {
            if (!pagesCancelled) {
              setPages(p)
              if (p.length > 0) setSelectedPageId(p[0].id)
              setPagesLoading(false)
            }
            return
          }
        }
      } catch {}
      try {
        const res = await fetch("/api/facebook/pages")
        const d = await res.json().catch(() => ({}))
        if (pagesCancelled) return
        const pl = d.pages || []
        setPages(pl)
        if (pl.length > 0) setSelectedPageId(pl[0].id)
        try { sessionStorage.setItem("fb_pages_cache", JSON.stringify({ ts: Date.now(), pages: pl })) } catch {}
      } catch {
        if (!pagesCancelled) setPages([])
      } finally {
        if (!pagesCancelled) setPagesLoading(false)
      }
    })()

    setLoadingPixels(true)
    fetch(`/api/facebook/pixels?ad_account_id=${adAccountId}`)
      .then((r) => r.json())
      .then((d) => {
        setPixels(d.pixels || [])
        if (d.pixels?.length > 0) setSelectedPixelId(d.pixels[0].id)
      })
      .catch(() => {})
      .finally(() => setLoadingPixels(false))

    fetch("/api/page-links")
      .then(r => r.json())
      .then(d => setPageLinks(d.pageLinks || []))
      .catch(() => {})

    setLoadingPresets(true)
    fetch("/api/presets")
      .then(r => r.json())
      .then(d => {
        const p = d.presets || []
        setPresets(p)
        if (p.length > 0) {
          setConfigSource("preset")
          setCreateNewCampaign(false)
          setCreateMultipleCampaigns(false)
          setAdsetMode("new")
        } else {
          setConfigSource("ad")
        }
      })
      .finally(() => setLoadingPresets(false))

    return () => { pagesCancelled = true }
  }, [open, adAccountId])

  useEffect(() => {
    if (!selectedCampaign || !adAccountId) { setAdsets([]); setSelectedAdset(null); return }
    setSelectedAdset(null)
    setAds([])
    setSelectedAd(null)
    const cacheKey = `${adAccountId}:${selectedCampaign.id}`
    if (adsetCache.current.has(cacheKey)) {
      setAdsets(adsetCache.current.get(cacheKey)!)
      return
    }
    const controller = new AbortController()
    setLoadingAdsets(true)
    fetch(`/api/facebook/adsets?ad_account_id=${adAccountId}&campaign_id=${selectedCampaign.id}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        const result = d.adSets || []
        adsetCache.current.set(cacheKey, result)
        setAdsets(result)
      })
      .catch((err) => { if (err.name !== "AbortError") setAdsets([{ id: "__error__", name: `⚠ ${err.message}`, status: "", effective_status: "" }]) })
      .finally(() => setLoadingAdsets(false))
    return () => controller.abort()
  }, [selectedCampaign, adAccountId])

  useEffect(() => {
    if (!selectedAdset) { setAds([]); setSelectedAd(null); return }
    setLoadingAds(true)
    fetch(`/api/facebook/ads?ad_account_id=${adAccountId}&adset_id=${selectedAdset.id}`)
      .then((r) => r.json())
      .then((d) => setAds(d.ads || []))
      .finally(() => setLoadingAds(false))
    setSelectedAd(null)
  }, [selectedAdset])

  useEffect(() => {
    if (!selectedAd) return
    if (selectedCampaign && !adsManagerCampaignName) setNewCampaignName(selectedCampaign.name)
    if (selectedAdset) {
      if (!adsManagerAdsetName) setNewAdsetName(selectedAdset.name)
      if (selectedAdset.daily_budget) {
        const dollars = Math.round(parseInt(selectedAdset.daily_budget) / 100)
        if (dollars >= 1) setAdsetDailyBudget(String(dollars))
      }
    }
  }, [selectedAd])

  useEffect(() => {
    if (!selectedPresetId || configSource !== "preset") return
    const p = presets.find(x => x.id === selectedPresetId)
    if (!p) return
    if (!adsManagerCampaignName && p.campaign_name) setNewCampaignName(p.campaign_name)
    if (!adsManagerAdsetName && p.adset_name) setNewAdsetName(p.adset_name)
  }, [selectedPresetId])

  const filteredCampaigns = campaigns
    .filter((c) => !onlyActive || c.effective_status === "ACTIVE")
    .filter((c) => c.name.toLowerCase().includes(searchCampaign.toLowerCase()))

  const filteredAdsets = adsets
    .filter((a) => !onlyActive || a.effective_status === "ACTIVE")
    .filter((a) => a.name.toLowerCase().includes(searchAdset.toLowerCase()))

  const filteredAds = ads
    .filter((a) => !onlyActive || a.effective_status === "ACTIVE")
    .filter((a) => a.name.toLowerCase().includes(searchAd.toLowerCase()))

  const today = new Date()
  const dateStr = `${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}/${today.getFullYear()}`
  const shortDateStr = `${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`

  const ins = (val: string, set: (v: string) => void, p: string) => set(val + p)

  const campaignOption = createMultipleCampaigns ? "multiple" : createNewCampaign ? "new" : "existing"
  const canLaunch = configSource === "preset"
    ? (!!selectedPresetId && !!selectedPageId && selectedCreativeIds.length > 0)
    : (!!selectedAd && !!selectedPageId && selectedCreativeIds.length > 0)

  const validationErrors: string[] = []
  if (campaignOption === "new" && !newCampaignName.trim())
    validationErrors.push("New campaign name is required")
  if (campaignOption === "multiple" && !multipleCampaignNames.some(n => n.trim()))
    validationErrors.push("At least one campaign name is required")
  if (adsetMode === "new" && !newAdsetName.trim())
    validationErrors.push("Ad set name is required")
  if (adsetMode !== "existing" && adsetMode !== "custom") {
    const b = Number(adsetDailyBudget)
    if (isNaN(b) || b < 1) validationErrors.push("Daily budget must be at least $1")
  }
  if (adsetMode === "custom" && canLaunch && customConfig.length === 0)
    validationErrors.push("Custom configuration is required — click 'Configure Ad Sets'")
  if (configSource === "preset" && campaignOption === "existing" && !selectedCampaign)
    validationErrors.push("Select a campaign — required when using a preset")
  if (configSource === "preset" && adsetMode === "existing" && !selectedAdset)
    validationErrors.push("Select an ad set — required when using a preset")
  if (scheduleStart && !scheduleDate)
    validationErrors.push("Please select a start date for scheduled launch")
  if (commonWebsiteUrl.trim() && !/^https?:\/\//.test(commonWebsiteUrl.trim()))
    validationErrors.push("Website URL must start with https://")
  const creativesWithoutUrl = creativeDetails.filter(c => !c.link_url?.trim())
  if (!commonWebsiteUrl.trim() && !useUniqueTextPerCreative && creativesWithoutUrl.length > 0)
    validationErrors.push(`Website URL is required — ${creativesWithoutUrl.length} creative(s) have no URL stored`)

  const applyPatLocal = (pat: string, idx: number, fname = "") =>
    pat.replace(/\{filename\}/g, fname)
       .replace(/\{index:001\}/g, String(idx).padStart(3,"0"))
       .replace(/\{index:01\}/g, String(idx).padStart(2,"0"))
       .replace(/\{index\}/g, String(idx))

  const getAdsetNamesForTextConfig = (): string[] => {
    if (adsetMode === "custom") return customConfig.flatMap(c => c.adsets.map(a => a.name))
    if (adsetMode === "per_creative") return creativeDetails.map((cr, i) =>
      applyPatLocal(adsetNamePattern || "{filename}", i + 1, cr.file_name.replace(/\.[^/.]+$/, "")))
    if (adsetMode === "auto_divide") {
      const count = Math.ceil(creativeDetails.length / (adsPerAdset || 5))
      return Array.from({ length: count }, (_, i) => applyPatLocal(autoDividePattern || "Ad Set {index:01}", i + 1))
    }
    if (adsetMode === "new") return [newAdsetName || "New Ad Set"]
    return [selectedAdset?.name || "Existing Ad Set"]
  }

  const handleLaunch = async () => {
    if (!canLaunch) return
    setLaunching(true)
    setError("")
    try {
      const res = await fetch("/api/facebook/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adAccountId,
          templateAdId: configSource === "ad" ? selectedAd?.id : undefined,
          presetId: configSource === "preset" ? selectedPresetId : undefined,
          creativeIds: selectedCreativeIds,
          campaignOption,
          existingCampaignId: campaignOption === "existing" ? selectedCampaign?.id : undefined,
          newCampaignName: campaignOption === "new" ? newCampaignName : undefined,
          multipleCampaignNames: campaignOption === "multiple" ? multipleCampaignNames.filter(n => n.trim()) : undefined,
          creativeDistribution: campaignOption === "multiple" ? creativeDistribution : undefined,
          adsetMode,
          existingAdsetId: adsetMode === "existing" ? selectedAdset?.id : undefined,
          newAdsetName: adsetMode === "new" ? newAdsetName : undefined,
          adsetNamePattern: (adsetMode === "per_creative" || adsetMode === "auto_divide") ? adsetNamePattern : undefined,
          autoDividePattern: adsetMode === "auto_divide" ? autoDividePattern : undefined,
          adsPerAdset: adsetMode === "auto_divide" ? adsPerAdset : undefined,
          adsetDailyBudget: adsetMode !== "existing" ? Number(adsetDailyBudget) : undefined,
          customConfig: adsetMode === "custom" ? customConfig : undefined,
          useCustomAdName,
          adNamePattern: useCustomAdName ? adNamePattern : undefined,
          filenameTransform: useCustomAdName ? filenameTransform : undefined,
          useCommonText,
          commonHeadlines: useCommonText ? commonHeadlines.filter(h => h.trim()) : undefined,
          commonPrimaryTexts: useCommonText ? commonPrimaryTexts.filter(p => p.trim()) : undefined,
          commonDescription: useCommonText ? commonDescription : undefined,
          commonCta: useCommonText ? commonCta : undefined,
          commonWebsiteUrl: commonWebsiteUrl || undefined,
          commonDisplayUrl: commonDisplayUrl || undefined,
          utmSource: useUtm ? utmSource : undefined,
          utmMedium: useUtm ? utmMedium : undefined,
          utmCampaign: useUtm ? utmCampaign : undefined,
          utmContent: useUtm ? utmContent : undefined,
          utmTerm: useUtm ? utmTerm : undefined,
          useUniqueTextPerAdset,
          adsetTextConfigs: useUniqueTextPerAdset ? adsetTextConfigs : undefined,
          useUniqueTextPerCreative,
          creativeTextConfigs: useUniqueTextPerCreative ? creativeTextConfigs : undefined,
          useMetaDefaults,
          imageEnhancements: useMetaDefaults ? undefined : Array.from(imageEnhancements),
          videoEnhancements: useMetaDefaults ? undefined : Array.from(videoEnhancements),
          createPaused,
          startTime: scheduleStart && scheduleDate ? (() => { const d = new Date(scheduleDate); d.setHours(Number(scheduleHour), Number(scheduleMinute), 0, 0); return d.toISOString() })() : undefined,
          pageId: selectedPageId,
          pixelId: selectedPixelId === "none" ? undefined : (selectedPixelId || undefined),
          pixelEvent: (selectedPixelId && selectedPixelId !== "none") ? pixelEvent : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLaunching(false)
    }
  }

  const handleClose = () => {
    setResult(null); setError("")
    setConfigSource("ad"); setSelectedPresetId("")
    setSelectedCampaign(null); setSelectedAdset(null); setSelectedAd(null)
    setCreateNewCampaign(false); setCreateMultipleCampaigns(false)
    setMultipleCampaignNames(["", ""]); setCreativeDistribution("split")
    setAdsetMode("existing"); setNewAdsetName(""); setAdsetDailyBudget("10")
    setAdsetNamePattern("{filename}"); setAdsPerAdset(5); setAutoDividePattern("Ad Set {index:01}")
    setCustomConfig([])
    setUseCustomAdName(false); setAdNamePattern("{filename}"); setFilenameTransform(null)
    setUseCommonText(false); setCommonHeadlines([""]); setCommonPrimaryTexts([""])
    setCommonDescription(""); setCommonCta("LEARN_MORE"); setCommonWebsiteUrl("")
    setUseUniqueTextPerAdset(false); setAdsetTextConfigs([])
    setUseUniqueTextPerCreative(false); setCreativeTextConfigs([])
    setUseMetaDefaults(false); setImageEnhancements(new Set()); setVideoEnhancements(new Set())
    setUseUtm(false); setUtmSource("facebook"); setUtmMedium("paid"); setUtmCampaign(""); setUtmContent(""); setUtmTerm("")
    setCreatePaused(true); setScheduleStart(false); setScheduleDate(undefined); setScheduleHour("08"); setScheduleMinute("00")
    setSelectedPixelId(pixels.length > 0 ? pixels[0].id : ""); setPixelEvent("PURCHASE")
    setCsvImportSummary("")
    onClose()
  }

  const applyParsedRows = (parsed: string[][]) => {
    if (parsed.length < 2) { setCsvImportSummary("File không có dữ liệu."); return }

    const headers = parsed[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, "_"))
    const dataRows = parsed.slice(1).filter(r => r.some(c => String(c).trim()))

    const col = (name: string) => headers.indexOf(name)
    const findCol = (...kws: string[]) => headers.findIndex(h => kws.some(k => h.includes(k)))

    const adsColIdx = headers.findIndex(h => h.includes("ads") && (h.includes("3") || h.includes("️⃣")))
    const linkIdx = col("link")
    if (adsColIdx === -1 && linkIdx === -1) { setCsvImportSummary("Không tìm thấy cột '3️⃣ Ads' hoặc 'link' — kiểm tra lại file."); return }

    const adsetIdx   = findCol("ad_set")
    const campIdx    = findCol("campaign")
    const pagesIdx   = col("pages")
    const headlineIdx = col("headline")
    const descIdx    = col("description")
    const ptIdx      = col("primary_text")
    const linkUrlIdx = col("link_ad_setting")

    const stripExt = (s: string) => s.replace(/\.[^/.]+$/, "")

    // filename → creativeId, bỏ đuôi khi so sánh
    const fileToId = new Map<string, string>()
    for (const c of creativeDetails) {
      fileToId.set(stripExt(c.file_name.toLowerCase().trim()), c.id)
    }

    const campaignMap = new Map<string, Map<string, string[]>>()
    const pageNameList: string[] = []
    const textConfigs: import("@/components/ad-per-creative-text-dialog").AdCreativeTextConfig[] = []
    const seenCreatives = new Set<string>()

    for (const row of dataRows) {
      // Dùng cột 3️⃣ Ads làm primary matcher, fallback về link
      let matchVal = ""
      if (adsColIdx !== -1) {
        matchVal = String(row[adsColIdx] ?? "").trim()
      }
      if (!matchVal && linkIdx !== -1) {
        matchVal = String(row[linkIdx] ?? "").trim()
      }
      if (!matchVal) continue

      // Khớp tên file: bỏ đuôi trước khi so sánh
      const baseName = (matchVal.split(/[/\\]/).pop() || matchVal).toLowerCase().trim()
      const creativeId = fileToId.get(stripExt(baseName))
      if (!creativeId) continue

      const campName  = (campIdx  !== -1 ? String(row[campIdx]  ?? "").trim() : "") || "Campaign 1"
      const adsetName = (adsetIdx !== -1 ? String(row[adsetIdx] ?? "").trim() : "") || "Ad Set 1"

      if (pagesIdx !== -1 && String(row[pagesIdx] ?? "").trim()) {
        const p = String(row[pagesIdx]).trim()
        if (!pageNameList.includes(p)) pageNameList.push(p)
      }

      // Text per-creative (mỗi video có copy khác nhau)
      if (!seenCreatives.has(creativeId)) {
        seenCreatives.add(creativeId)
        const headline = headlineIdx !== -1 ? String(row[headlineIdx] ?? "").trim() : ""
        const desc     = descIdx     !== -1 ? String(row[descIdx]     ?? "").trim() : ""
        const pt       = ptIdx       !== -1 ? String(row[ptIdx]       ?? "").trim() : ""
        const url      = linkUrlIdx  !== -1 ? String(row[linkUrlIdx]  ?? "").trim() : ""
        textConfigs.push({
          creativeId,
          headlines:    headline ? [headline] : [],
          primaryTexts: pt ? [pt] : [],
          description:  desc,
          cta:          "LEARN_MORE",
          websiteUrl:   url,
          displayUrl:   "",
        })
      }

      // Cấu trúc campaign/adset
      if (!campaignMap.has(campName)) campaignMap.set(campName, new Map())
      const adsetMap = campaignMap.get(campName)!
      if (!adsetMap.has(adsetName)) adsetMap.set(adsetName, [])
      if (!adsetMap.get(adsetName)!.includes(creativeId)) adsetMap.get(adsetName)!.push(creativeId)
    }

    if (campaignMap.size === 0) {
      setCsvImportSummary("Không khớp được creative nào — kiểm tra tên file trong cột 'link' phải trùng với file đã upload.")
      return
    }

    // Build CampaignConfig
    const config: CampaignConfig[] = []
    let totalAdsets = 0, totalCreatives = 0
    for (const [campName, adsetMap] of campaignMap.entries()) {
      const adsets: { name: string; creativeIds: string[] }[] = []
      for (const [adsetName, ids] of adsetMap.entries()) {
        adsets.push({ name: adsetName, creativeIds: ids })
        totalAdsets++; totalCreatives += ids.length
      }
      config.push({ name: campName, adsets })
    }

    setCustomConfig(config)
    setAdsetMode("custom")
    setCreateNewCampaign(false)
    setCreateMultipleCampaigns(false)

    // Pre-fill campaign/adset name từ dữ liệu Excel
    if (config.length > 0) {
      setNewCampaignName(config[0].name)
      if (config.length > 1) {
        setMultipleCampaignNames(config.map(c => c.name))
      }
      if (config[0].adsets.length > 0) {
        setNewAdsetName(config[0].adsets[0].name)
      }
    }

    // Khớp Facebook Page theo tên
    if (pageNameList.length > 0) {
      const searchName = pageNameList[0].toLowerCase()
      const match = pages.find(p =>
        p.name.toLowerCase().includes(searchName) || searchName.includes(p.name.toLowerCase())
      )
      if (match) setSelectedPageId(match.id)
    }

    // Dùng unique text per creative vì mỗi video có copy riêng
    if (textConfigs.length > 0) {
      setUseUniqueTextPerCreative(true)
      setUseCommonText(false)
      setCreativeTextConfigs(textConfigs)
    }

    // Pre-fill website URL từ creative đầu tiên nếu có
    const firstUrl = textConfigs.find(t => t.websiteUrl)?.websiteUrl
    if (firstUrl) setCommonWebsiteUrl(firstUrl)

    setCsvImportSummary(
      `✅ ${config.length} campaign, ${totalAdsets} adset, ${totalCreatives} creative khớp — text riêng cho từng creative`
    )
  }

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const isExcel = /\.(xlsx|xls)$/i.test(file.name)

    if (isExcel) {
      const reader = new FileReader()
      reader.onload = async ev => {
        try {
          const XLSX = await import("xlsx")
          const wb = XLSX.read(ev.target?.result, { type: "array" })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const parsed = (XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "", raw: false }) as any[][])
            .map(row => row.map(cell => String(cell ?? "").trim()))
          applyParsedRows(parsed)
        } catch (err: any) {
          setCsvImportSummary(`Lỗi đọc Excel: ${err.message}`)
        }
      }
      reader.readAsArrayBuffer(file)
    } else {
      const reader = new FileReader()
      reader.onload = ev => {
        const parsed = parseCSV(ev.target?.result as string)
        applyParsedRows(parsed)
      }
      reader.readAsText(file)
    }

    if (csvImportRef.current) csvImportRef.current.value = ""
  }

  const exportCsv = () => {
    if (!result?.created?.length) return
    const header = ["Ad Name", "Ad ID", "Creative File"]
    const rows = result.created.map((item: any) => [item.adName || item.name || "", item.adId || "", item.fileName || ""])
    const csv = [header, ...rows]
      .map((row: string[]) => row.map((cell: string) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `launch-results-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const placeholderBtns = (val: string, set: (v: string) => void, includeFilename = false) => (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-muted-foreground">Placeholders:</span>
      {includeFilename && <button type="button" onClick={() => ins(val, set, "{filename}")} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Filename</button>}
      <button type="button" onClick={() => ins(val, set, "{index}")} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Index</button>
      <button type="button" onClick={() => ins(val, set, "{index:01}")} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Index (01)</button>
      <button type="button" onClick={() => ins(val, set, "{index:001}")} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Index (001)</button>
      <button type="button" onClick={() => ins(val, set, ` ${dateStr}`)} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Date</button>
      <button type="button" onClick={() => ins(val, set, ` ${shortDateStr}`)} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Short Date</button>
    </div>
  )

  const applyFnTransform = (name: string) => {
    switch (filenameTransform) {
      case "title_case": return name.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
      case "uppercase": return name.toUpperCase()
      case "lowercase": return name.toLowerCase()
      case "clean": return name.replace(/[^a-zA-Z0-9\s]/g, "").trim()
      case "split": return name.replace(/[_-]/g, " ")
      default: return name
    }
  }

  const resolveAdName = (filename: string, index: number) => {
    if (!useCustomAdName) return filename
    const fname = applyFnTransform(filename)
    return adNamePattern
      .replace(/\{filename\}/g, fname)
      .replace(/\{index:001\}/g, String(index).padStart(3, "0"))
      .replace(/\{index:01\}/g, String(index).padStart(2, "0"))
      .replace(/\{index\}/g, String(index))
      .replace(/\{date:short\}/g, shortDateStr)
      .replace(/\{date\}/g, dateStr)
  }

  const budgetField = (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Daily Budget</span>
      <span className="text-sm">$</span>
      <Input
        type="number"
        value={adsetDailyBudget}
        onChange={(e) => setAdsetDailyBudget(e.target.value)}
        className="w-28 h-8"
        min="1"
      />
      <span className="text-sm text-muted-foreground">USD</span>
    </div>
  )

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-[95vw] h-[92vh] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconRocket className="size-5" />
            Launch Ads ({selectedCreativeIds.length} creatives)
          </DialogTitle>
        </DialogHeader>

        {pagesLoading && !result ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
              <IconLoader2 className="size-6 animate-spin text-primary" />
              <div className="font-medium text-foreground">Loading launcher…</div>
              <div>Loading Facebook pages…</div>
            </div>
          </div>
        ) : result ? (
          <div className="space-y-4">
            {/* Summary banner */}
            <div className={`rounded-lg border p-4 ${result.errors?.length === 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
              <div className={`flex items-center gap-2 font-medium ${result.errors?.length === 0 ? "text-green-700" : "text-amber-700"}`}>
                <IconCheck className="size-5" />
                {result.summary}
              </div>
              {result.adManagerUrl && (
                <a href={result.adManagerUrl} target="_blank" rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <IconExternalLink className="size-4" />
                  View Ads Manager
                </a>
              )}
            </div>
            {result.auditError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {result.auditError} Do not retry blindly; inspect Meta Ads Manager first to avoid duplicate ads.
              </div>
            )}

            {/* Created ads table */}
            {result.created?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium">Created Ads ({result.created.length})</h4>
                  <button type="button" onClick={exportCsv}
                    className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <IconDownload className="size-3.5" /> Export CSV
                  </button>
                </div>
                <div className="rounded border overflow-auto max-h-56">
                  <table data-table="compact" className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 border-b">
                      <tr>
                        <th className="text-left px-3 font-medium text-muted-foreground">Ad Name</th>
                        <th className="text-left px-3 font-medium text-muted-foreground w-40">Ad ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.created.map((item: any, i: number) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-3 max-w-xs truncate" title={item.adName}>{item.adName || item.name}</td>
                          <td className="px-3 font-mono text-muted-foreground">{item.adId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Errors */}
            {result.errors?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-destructive mb-2">Failed ({result.errors.length})</h4>
                <div className="space-y-1.5 max-h-40 overflow-auto">
                  {result.errors.map((e: any, i: number) => {
                    const cr = creativeDetails.find(c => c.id === e.creativeId)
                    return (
                      <div key={i} className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                        <span className="font-medium">{cr?.file_name || e.creativeId}:</span>
                        <span className="text-destructive ml-1.5">{e.error}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <Button onClick={handleClose} className="w-full">Done</Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Configuration Source */}
            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <h3 className="font-semibold">Configuration Source</h3>
                <p className="text-sm text-muted-foreground">Where to copy targeting &amp; bid settings from for your new ads.</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => {
                  setConfigSource("preset")
                  setCreateNewCampaign(false)
                  setCreateMultipleCampaigns(false)
                  if (adsetMode === "existing") setAdsetMode("new")
                }}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${configSource === "preset" ? "border-primary bg-primary/5" : "hover:bg-muted"}`}>
                  <p className={`text-sm font-medium ${configSource === "preset" ? "text-primary" : ""}`}>Saved Preset</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Use targeting saved from a previous ad set</p>
                </button>
                <button type="button" onClick={() => { setConfigSource("ad"); setAdsetMode("existing") }}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${configSource === "ad" ? "border-primary bg-primary/5" : "hover:bg-muted"}`}>
                  <p className={`text-sm font-medium ${configSource === "ad" ? "text-primary" : ""}`}>Pick from Facebook</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Browse campaigns → ad sets → ads</p>
                </button>
              </div>

              {/* Preset mode */}
              {configSource === "preset" && (
                <div className="space-y-2">
                  {loadingPresets ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <IconLoader2 className="size-4 animate-spin" /> Loading presets...
                    </div>
                  ) : presets.length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-center space-y-1">
                      <p className="text-sm text-muted-foreground">No presets saved yet.</p>
                      <a href="/presets" target="_blank" className="text-xs text-primary hover:underline">Go to Presets page to import one →</a>
                    </div>
                  ) : (
                    <select value={selectedPresetId} onChange={e => setSelectedPresetId(e.target.value)}
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                      <option value="">— Select a preset —</option>
                      {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                  {selectedPresetId && (() => {
                    const p = presets.find(x => x.id === selectedPresetId)
                    if (!p) return null
                    const parts: string[] = []
                    const countries = p.targeting?.geo_locations?.countries
                    if (countries?.length) parts.push(countries.join(", "))
                    if (p.targeting?.age_min || p.targeting?.age_max) parts.push(`Age ${p.targeting.age_min || ""}–${p.targeting.age_max || ""}`)
                    if (p.bid_strategy) parts.push(p.bid_strategy.replace(/_/g, " "))
                    return (
                      <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-xs space-y-0.5">
                        <p className="font-medium text-primary">{p.name}</p>
                        <p className="text-muted-foreground">{p.objective?.replace(/_/g, " ")}{parts.length ? " · " + parts.join(" · ") : ""}</p>
                        {p.adset_name && <p className="text-muted-foreground">From: {p.campaign_name} → {p.adset_name}</p>}
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Ad picker mode */}
              {configSource === "ad" && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
                    Only active
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {/* Campaigns */}
                    <div className="rounded-lg border">
                      <div className="border-b p-2 font-medium text-sm">Campaigns</div>
                      <div className="p-2">
                        <div className="relative mb-2">
                          <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                          <Input placeholder="Search..." value={searchCampaign} onChange={(e) => setSearchCampaign(e.target.value)} className="h-7 pl-6 text-xs" />
                        </div>
                        <div className="max-h-80 overflow-y-auto space-y-0.5">
                          {loadingCampaigns ? <div className="flex justify-center py-4"><IconLoader2 className="size-4 animate-spin" /></div>
                            : filteredCampaigns.map((c) => (
                              <button key={c.id} onClick={() => setSelectedCampaign(selectedCampaign?.id === c.id ? null : c)}
                                className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted break-words leading-tight ${selectedCampaign?.id === c.id ? "bg-primary/10 text-primary font-medium" : ""}`}>
                                {selectedCampaign?.id === c.id && <IconCheck className="inline size-3 mr-1" />}{c.name}
                              </button>
                            ))}
                        </div>
                      </div>
                    </div>
                    {/* Ad Sets */}
                    <div className="rounded-lg border">
                      <div className="border-b p-2 font-medium text-sm">Ad Sets</div>
                      <div className="p-2">
                        <div className="relative mb-2">
                          <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                          <Input placeholder="Search..." value={searchAdset} onChange={(e) => setSearchAdset(e.target.value)} className="h-7 pl-6 text-xs" />
                        </div>
                        <div className="max-h-80 overflow-y-auto space-y-0.5">
                          {!selectedCampaign ? <p className="text-center text-xs text-muted-foreground py-4">Select a campaign first</p>
                            : loadingAdsets ? <div className="flex justify-center py-4"><IconLoader2 className="size-4 animate-spin" /></div>
                            : filteredAdsets.length === 0 ? <p className="text-center text-xs text-muted-foreground py-4">No ad sets found in this campaign</p>
                            : filteredAdsets.map((a) => (
                              <button key={a.id} onClick={() => setSelectedAdset(selectedAdset?.id === a.id ? null : a)}
                                className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted break-words leading-tight ${selectedAdset?.id === a.id ? "bg-primary/10 text-primary font-medium" : ""}`}>
                                {selectedAdset?.id === a.id && <IconCheck className="inline size-3 mr-1" />}{a.name}
                              </button>
                            ))}
                        </div>
                      </div>
                    </div>
                    {/* Ads */}
                    <div className="rounded-lg border">
                      <div className="border-b p-2 font-medium text-sm">Ads</div>
                      <div className="p-2">
                        <div className="relative mb-2">
                          <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                          <Input placeholder="Search..." value={searchAd} onChange={(e) => setSearchAd(e.target.value)} className="h-7 pl-6 text-xs" />
                        </div>
                        <div className="max-h-80 overflow-y-auto space-y-0.5">
                          {!selectedAdset ? <p className="text-center text-xs text-muted-foreground py-4">Select an ad set first</p>
                            : loadingAds ? <div className="flex justify-center py-4"><IconLoader2 className="size-4 animate-spin" /></div>
                            : filteredAds.map((a) => (
                              <button key={a.id} onClick={() => setSelectedAd(selectedAd?.id === a.id ? null : a)}
                                className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted leading-tight flex items-center gap-2 ${selectedAd?.id === a.id ? "bg-primary/10 text-primary font-medium" : ""}`}>
                                {(a.creative?.thumbnail_url || a.creative?.image_url)
                                  ? <img src={a.creative.thumbnail_url || a.creative.image_url} alt="" className="size-10 rounded object-cover shrink-0" />
                                  : <div className="size-10 rounded bg-muted shrink-0" />}
                                <span className="break-words min-w-0">
                                  {selectedAd?.id === a.id && <IconCheck className="inline size-3 mr-1" />}{a.name}
                                </span>
                              </button>
                            ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Campaign Options */}
            <div className="space-y-3 rounded-lg border p-4">
                <h3 className="font-semibold">Campaign Options</h3>

                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                  <input type="checkbox" checked={createNewCampaign} onChange={(e) => { setCreateNewCampaign(e.target.checked); if (e.target.checked) { setCreateMultipleCampaigns(false); if (adsetMode === "existing") setAdsetMode("new") } }} className="size-4" />
                  Create new campaign
                </label>
                {createNewCampaign && (
                  <div className="ml-6 space-y-2">
                    <Input value={newCampaignName} onChange={(e) => setNewCampaignName(e.target.value)} placeholder="Campaign name..." />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">Placeholders:</span>
                      <button type="button" onClick={() => ins(newCampaignName, setNewCampaignName, ` ${dateStr}`)} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Date</button>
                      <button type="button" onClick={() => ins(newCampaignName, setNewCampaignName, ` ${shortDateStr}`)} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Short Date</button>
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                  <input type="checkbox" checked={createMultipleCampaigns} onChange={(e) => { setCreateMultipleCampaigns(e.target.checked); if (e.target.checked) { setCreateNewCampaign(false); if (adsetMode === "existing") setAdsetMode("new") } }} className="size-4" />
                  Create multiple new campaigns
                  {createMultipleCampaigns && (
                    <div className="ml-auto flex rounded-md border overflow-hidden text-xs">
                      <button type="button" onClick={() => setCreativeDistribution("split")} className={`px-3 py-1 ${creativeDistribution === "split" ? "bg-foreground text-background" : "hover:bg-muted"}`}>Split Creatives</button>
                      <button type="button" onClick={() => setCreativeDistribution("duplicate")} className={`px-3 py-1 ${creativeDistribution === "duplicate" ? "bg-foreground text-background" : "hover:bg-muted"}`}>Duplicate Creatives</button>
                    </div>
                  )}
                </label>
                {createMultipleCampaigns && (
                  <div className="ml-6 space-y-3">
                    {multipleCampaignNames.map((name, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex gap-2 items-center">
                          <Input value={name} onChange={(e) => { const u = [...multipleCampaignNames]; u[i] = e.target.value; setMultipleCampaignNames(u) }} placeholder={`Campaign ${i + 1}`} className="flex-1" />
                          {i === multipleCampaignNames.length - 1
                            ? <button type="button" onClick={() => setMultipleCampaignNames([...multipleCampaignNames, ""])} className="rounded border p-1.5 hover:bg-muted"><IconPlus className="size-4" /></button>
                            : <button type="button" onClick={() => setMultipleCampaignNames(multipleCampaignNames.filter((_, j) => j !== i))} className="rounded border p-1.5 hover:bg-muted text-destructive"><IconTrash className="size-4" /></button>}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs text-muted-foreground">Placeholders:</span>
                          <button type="button" onClick={() => { const u = [...multipleCampaignNames]; u[i] += String(i+1); setMultipleCampaignNames(u) }} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Index</button>
                          <button type="button" onClick={() => { const u = [...multipleCampaignNames]; u[i] += String(i+1).padStart(2,"0"); setMultipleCampaignNames(u) }} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Index (01)</button>
                          <button type="button" onClick={() => { const u = [...multipleCampaignNames]; u[i] += ` ${dateStr}`; setMultipleCampaignNames(u) }} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Date</button>
                          <button type="button" onClick={() => { const u = [...multipleCampaignNames]; u[i] += ` ${shortDateStr}`; setMultipleCampaignNames(u) }} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Short Date</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!createNewCampaign && !createMultipleCampaigns && configSource === "preset" && (
                  <div className="ml-6 space-y-1.5">
                    <p className="text-xs text-muted-foreground">Select existing campaign:</p>
                    <div className="relative">
                      <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input placeholder="Search..." value={searchCampaign} onChange={e => setSearchCampaign(e.target.value)} className="h-7 pl-6 text-xs" />
                    </div>
                    <div className="max-h-40 overflow-y-auto rounded border space-y-0.5 p-1">
                      {loadingCampaigns ? <div className="flex justify-center py-3"><IconLoader2 className="size-4 animate-spin" /></div>
                        : filteredCampaigns.map(c => (
                          <button key={c.id} type="button" onClick={() => setSelectedCampaign(selectedCampaign?.id === c.id ? null : c)}
                            className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted break-words leading-tight ${selectedCampaign?.id === c.id ? "bg-primary/10 text-primary font-medium" : ""}`}>
                            {selectedCampaign?.id === c.id && <IconCheck className="inline size-3 mr-1" />}{c.name}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                {!createNewCampaign && !createMultipleCampaigns && configSource === "ad" && selectedCampaign && (
                  <p className="ml-6 text-xs text-muted-foreground">Using existing: <span className="font-medium text-foreground">{selectedCampaign.name}</span></p>
                )}
            </div>

            {/* Ad Set Options */}
            <div className="space-y-3 rounded-lg border p-4">
                <h3 className="font-semibold">Ad Set Options</h3>

                {/* Option 1: Create new ad set */}
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                  <input type="checkbox" checked={adsetMode === "new"} onChange={() => setAdsetMode(adsetMode === "new" ? "existing" : "new")} className="size-4" />
                  Create new ad set
                </label>
                {adsetMode === "new" && (
                  <div className="ml-6 space-y-2">
                    <Input value={newAdsetName} onChange={(e) => setNewAdsetName(e.target.value)} placeholder="Ad set name..." />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">Placeholders:</span>
                      <button type="button" onClick={() => ins(newAdsetName, setNewAdsetName, ` ${dateStr}`)} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Date</button>
                      <button type="button" onClick={() => ins(newAdsetName, setNewAdsetName, ` ${shortDateStr}`)} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Short Date</button>
                    </div>
                    {budgetField}
                  </div>
                )}

                {/* Option 2: Per creative */}
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                  <input type="checkbox" checked={adsetMode === "per_creative"} onChange={() => setAdsetMode(adsetMode === "per_creative" ? "existing" : "per_creative")} className="size-4" />
                  Create new ad set per upload or group
                </label>
                {adsetMode === "per_creative" && (
                  <div className="ml-6 space-y-2">
                    <p className="text-xs text-muted-foreground">Ad Set Name Pattern</p>
                    <Input value={adsetNamePattern} onChange={(e) => setAdsetNamePattern(e.target.value)} placeholder="{filename}" />
                    {placeholderBtns(adsetNamePattern, setAdsetNamePattern, true)}
                    {budgetField}
                  </div>
                )}

                {/* Option 3: Auto-divide */}
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                  <input type="checkbox" checked={adsetMode === "auto_divide"} onChange={() => setAdsetMode(adsetMode === "auto_divide" ? "existing" : "auto_divide")} className="size-4" />
                  Auto-divide ads into ad sets
                </label>
                {adsetMode === "auto_divide" && (
                  <div className="ml-6 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Ads per ad set</span>
                      <Input type="number" value={adsPerAdset} onChange={(e) => setAdsPerAdset(Number(e.target.value))} className="w-20 h-8" min="1" />
                    </div>
                    <p className="text-xs text-muted-foreground">Ad Set Name Pattern</p>
                    <Input value={autoDividePattern} onChange={(e) => setAutoDividePattern(e.target.value)} placeholder="Ad Set {index:01}" />
                    {placeholderBtns(autoDividePattern, setAutoDividePattern)}
                    {budgetField}
                  </div>
                )}

                {/* Option 4: Custom */}
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                  <input type="checkbox" checked={adsetMode === "custom"} onChange={() => setAdsetMode(adsetMode === "custom" ? "existing" : "custom")} className="size-4" />
                  Build custom ad set configuration
                  {adsetMode === "custom" && (
                    <button type="button" onClick={() => setCustomDialogOpen(true)}
                      className="ml-2 rounded border border-primary text-primary px-3 py-0.5 text-xs hover:bg-primary/5">
                      {customConfig.length > 0 ? "Edit Configuration" : "Configure Ad Sets"}
                    </button>
                  )}
                </label>
                {adsetMode === "custom" && customConfig.length > 0 && (
                  <div className="ml-6 text-xs text-muted-foreground">
                    {customConfig.reduce((s, c) => s + c.adsets.length, 0)} ad sets, {customConfig.reduce((s, c) => s + c.adsets.reduce((ss, a) => ss + a.creativeIds.length, 0), 0)} ads configured
                  </div>
                )}

                {adsetMode === "existing" && configSource === "preset" && (
                  <div className="ml-6 space-y-1.5">
                    <p className="text-xs text-muted-foreground">Select existing ad set:</p>
                    <div className="relative">
                      <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input placeholder="Search..." value={searchAdset} onChange={e => setSearchAdset(e.target.value)} className="h-7 pl-6 text-xs" />
                    </div>
                    <div className="max-h-40 overflow-y-auto rounded border space-y-0.5 p-1">
                      {!selectedCampaign
                        ? <p className="text-center text-xs text-muted-foreground py-3">Select a campaign first (in Campaign Options above)</p>
                        : loadingAdsets ? <div className="flex justify-center py-3"><IconLoader2 className="size-4 animate-spin" /></div>
                        : filteredAdsets.map(a => (
                          <button key={a.id} type="button" onClick={() => setSelectedAdset(selectedAdset?.id === a.id ? null : a)}
                            className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted break-words leading-tight ${selectedAdset?.id === a.id ? "bg-primary/10 text-primary font-medium" : ""}`}>
                            {selectedAdset?.id === a.id && <IconCheck className="inline size-3 mr-1" />}{a.name}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                {adsetMode === "existing" && configSource === "ad" && selectedAdset && (
                  <p className="ml-6 text-xs text-muted-foreground">Using existing: <span className="font-medium text-foreground">{selectedAdset.name}</span></p>
                )}
            </div>

            {/* Ad Name Options */}
            <div className="space-y-3 rounded-lg border p-4">
              <h3 className="font-semibold">Ad Name Options</h3>
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input type="checkbox" checked={useCustomAdName} onChange={e => setUseCustomAdName(e.target.checked)} className="size-4" />
                Use custom ad name pattern
              </label>
              {useCustomAdName && (
                <div className="ml-6 space-y-3">
                  <Input value={adNamePattern} onChange={e => setAdNamePattern(e.target.value)} placeholder="{filename}" />
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Click to insert placeholders:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        ["{filename}", "Filename"],
                        ["{index}", "Index"],
                        ["{index:01}", "Index (01)"],
                        ["{index:001}", "Index (001)"],
                        ["{date:short}", "Short Date"],
                        ["{date}", "Date"],
                      ] as [string, string][]).map(([ph, label]) => (
                        <button key={ph} type="button" onClick={() => ins(adNamePattern, setAdNamePattern, ph)}
                          className="rounded border px-2 py-0.5 text-xs hover:bg-muted">{label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Extract from filename:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        ["title_case", "Title Case"],
                        ["uppercase", "UPPERCASE"],
                        ["lowercase", "lowercase"],
                        ["clean", "Clean"],
                        ["split", "Split"],
                      ] as const).map(([t, label]) => (
                        <button key={t} type="button" onClick={() => setFilenameTransform(filenameTransform === t ? null : t)}
                          className={`rounded border px-2 py-0.5 text-xs ${filenameTransform === t ? "border-primary text-primary bg-primary/5" : "hover:bg-muted"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Preview table — luôn hiện khi có creative */}
            {creativeDetails.length > 0 && (() => {
                  const today = new Date()
                  const dStr = `${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}/${today.getFullYear()}`
                  const sStr = `${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`
                  const applyPat = (pat: string, idx: number, fname = "") =>
                    pat.replace(/\{filename\}/g, fname)
                       .replace(/\{index:001\}/g, String(idx).padStart(3,"0"))
                       .replace(/\{index:01\}/g, String(idx).padStart(2,"0"))
                       .replace(/\{index\}/g, String(idx))
                       .replace(/ ?\$\{date\}/g, ` ${dStr}`)
                       .replace(/ ?\$\{shortDate\}/g, ` ${sStr}`)

                  type Row = { campId: string; campName: string; adsetId: string; adsetName: string; adName: string }
                  const rows: Row[] = []
                  let gIdx = 1

                  const campId = createNewCampaign ? "(new)" : createMultipleCampaigns ? "(new each)" : selectedCampaign?.id || "—"
                  const campName = createNewCampaign ? newCampaignName : createMultipleCampaigns ? "(multiple)" : selectedCampaign?.name || "—"

                  if (adsetMode === "custom" && customConfig.length > 0) {
                    customConfig.forEach(camp => {
                      camp.adsets.forEach(adset => {
                        adset.creativeIds.forEach(cid => {
                          const cr = creativeDetails.find(c => c.id === cid)
                          const fname = cr?.file_name.replace(/\.[^/.]+$/, "") || cid
                          rows.push({ campId: "(new)", campName: camp.name, adsetId: "(new)", adsetName: adset.name, adName: resolveAdName(fname, gIdx++) })
                        })
                      })
                    })
                  } else if (adsetMode === "per_creative") {
                    creativeDetails.forEach((cr, i) => {
                      const fname = cr.file_name.replace(/\.[^/.]+$/, "")
                      rows.push({ campId, campName, adsetId: "(new)", adsetName: applyPat(adsetNamePattern || "{filename}", i+1, fname), adName: resolveAdName(fname, gIdx++) })
                    })
                  } else if (adsetMode === "auto_divide") {
                    const chunkSize = adsPerAdset || 5
                    creativeDetails.forEach((cr, i) => {
                      const groupIdx = Math.floor(i / chunkSize) + 1
                      rows.push({ campId, campName, adsetId: "(new)", adsetName: applyPat(autoDividePattern || "Ad Set {index:01}", groupIdx), adName: resolveAdName(cr.file_name.replace(/\.[^/.]+$/, ""), gIdx++) })
                    })
                  } else {
                    const adsetId = adsetMode === "existing" ? (selectedAdset?.id || "—") : "(new)"
                    const adsetName = adsetMode === "existing" ? (selectedAdset?.name || "—") : newAdsetName
                    creativeDetails.forEach(cr => {
                      rows.push({ campId, campName, adsetId, adsetName, adName: resolveAdName(cr.file_name.replace(/\.[^/.]+$/, ""), gIdx++) })
                    })
                  }

                  return (
                    <div className="rounded-lg border overflow-hidden">
                      <div className="bg-muted/50 px-4 py-2 border-b">
                        <h3 className="font-semibold text-sm">Preview</h3>
                        <p className="text-xs text-muted-foreground">{rows.length} ad{rows.length !== 1 ? "s" : ""} will be created</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table data-table="compact" className="w-full text-xs">
                          <thead>
                            <tr className="border-b bg-muted/30">
                              <th className="text-left px-3 font-medium text-muted-foreground">CAMPAIGN ID</th>
                              <th className="text-left px-3 font-medium text-muted-foreground">CAMPAIGN NAME</th>
                              <th className="text-left px-3 font-medium text-muted-foreground">AD SET ID</th>
                              <th className="text-left px-3 font-medium text-muted-foreground">AD SET NAME</th>
                              <th className="text-left px-3 font-medium text-muted-foreground">AD NAME</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row, i) => {
                              const idCell = (val: string) => {
                                if (val === "(new)" || val === "(new each)")
                                  return <td className="px-3 text-xs italic text-emerald-600 dark:text-emerald-400 whitespace-nowrap">{val}</td>
                                if (val === "—")
                                  return <td className="px-3 text-muted-foreground">—</td>
                                return <td className="px-3 font-mono text-muted-foreground text-xs whitespace-nowrap">{val}</td>
                              }
                              return (
                                <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                                  {idCell(row.campId)}
                                  <td className="px-3 max-w-[180px] truncate" title={row.campName}>{row.campName}</td>
                                  {idCell(row.adsetId)}
                                  <td className="px-3 max-w-[180px] truncate" title={row.adsetName}>{row.adsetName}</td>
                                  <td className="px-3 max-w-[180px] truncate" title={row.adName}>{row.adName}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
            })()}

            {/* Ad Text Options */}
            <div className="space-y-3 rounded-lg border p-4">
              <h3 className="font-semibold">Ad Text Options</h3>

              {/* Option 1 */}
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input type="radio" name="adTextMode" checked={!useCommonText && !useUniqueTextPerAdset && !useUniqueTextPerCreative}
                  onChange={() => { setUseCommonText(false); setUseUniqueTextPerAdset(false); setUseUniqueTextPerCreative(false) }} className="size-4" />
                Use text from each creative (default)
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input type="radio" name="adTextMode" checked={useCommonText}
                  onChange={() => { setUseCommonText(true); setUseUniqueTextPerAdset(false); setUseUniqueTextPerCreative(false) }} className="size-4" />
                Apply common text to all ads
              </label>
              {useCommonText && (
                <div className="ml-6 space-y-4">
                  {/* Headlines */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Headlines</p>
                    <p className="text-xs text-muted-foreground">Multiple headlines will be cycled across ads (ad 1 → headline 1, ad 2 → headline 2, ...)</p>
                    {commonHeadlines.map((h, i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          value={h}
                          onChange={e => { const u = [...commonHeadlines]; u[i] = e.target.value; setCommonHeadlines(u) }}
                          placeholder={`Headline ${i + 1}`}
                          className="flex-1"
                          maxLength={255}
                        />
                        {commonHeadlines.length > 1 && (
                          <button type="button" onClick={() => setCommonHeadlines(commonHeadlines.filter((_, j) => j !== i))}
                            className="rounded border p-2 hover:bg-muted text-muted-foreground hover:text-foreground">
                            <IconX className="size-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => setCommonHeadlines([...commonHeadlines, ""])}
                      className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <IconPlus className="size-3" /> Add headline
                    </button>
                  </div>

                  {/* Primary Texts */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Primary Texts</p>
                    <p className="text-xs text-muted-foreground">Multiple primary texts will be cycled across ads</p>
                    {commonPrimaryTexts.map((pt, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <Textarea
                          value={pt}
                          onChange={e => { const u = [...commonPrimaryTexts]; u[i] = e.target.value; setCommonPrimaryTexts(u) }}
                          placeholder={`Primary text ${i + 1}`}
                          className="flex-1 min-h-[80px] resize-y"
                        />
                        {commonPrimaryTexts.length > 1 && (
                          <button type="button" onClick={() => setCommonPrimaryTexts(commonPrimaryTexts.filter((_, j) => j !== i))}
                            className="rounded border p-2 hover:bg-muted text-muted-foreground hover:text-foreground mt-0.5">
                            <IconX className="size-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => setCommonPrimaryTexts([...commonPrimaryTexts, ""])}
                      className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <IconPlus className="size-3" /> Add primary text
                    </button>
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Link Description</p>
                    <Input value={commonDescription} onChange={e => setCommonDescription(e.target.value)} placeholder="Description (optional)" />
                  </div>

                  {/* CTA */}
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Call to Action</p>
                    <select value={commonCta} onChange={e => setCommonCta(e.target.value)}
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                      {[
                        ["LEARN_MORE", "Learn More"],
                        ["SHOP_NOW", "Shop Now"],
                        ["SIGN_UP", "Sign Up"],
                        ["DOWNLOAD", "Download"],
                        ["GET_QUOTE", "Get Quote"],
                        ["SUBSCRIBE", "Subscribe"],
                        ["CONTACT_US", "Contact Us"],
                        ["APPLY_NOW", "Apply Now"],
                        ["GET_OFFER", "Get Offer"],
                        ["BOOK_TRAVEL", "Book Travel"],
                        ["NO_BUTTON", "No Button"],
                      ].map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Website URL */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Website URL <span className="text-xs font-normal text-muted-foreground">(optional)</span></p>
                      {pageLinks.length > 0 && (
                        <Select onValueChange={(val) => setCommonWebsiteUrl(val)}>
                          <SelectTrigger className="h-7 w-fit text-xs bg-muted/50 border-none hover:bg-muted">
                            <SelectValue placeholder="Quick select from Pages" />
                          </SelectTrigger>
                          <SelectContent>
                            {pageLinks.map(p => (
                              <SelectItem key={p.id} value={p.url}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <Input value={commonWebsiteUrl} onChange={e => setCommonWebsiteUrl(e.target.value)} placeholder="https://..." type="url" />
                  </div>

                  {/* Display URL */}
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Display URL <span className="text-xs font-normal text-muted-foreground">(optional)</span></p>
                    <p className="text-xs text-muted-foreground">Short URL shown in the ad (e.g. example.com/sale)</p>
                    <Input value={commonDisplayUrl} onChange={e => setCommonDisplayUrl(e.target.value)} placeholder="example.com/sale" />
                  </div>

                </div>
              )}

              {/* Option 2 */}
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input type="radio" name="adTextMode" checked={useUniqueTextPerAdset}
                  onChange={() => { setUseUniqueTextPerAdset(true); setUseCommonText(false); setUseUniqueTextPerCreative(false) }} className="size-4" />
                Write unique ad text per ad set
              </label>
              {useUniqueTextPerAdset && (
                <div className="ml-6">
                  <button type="button" onClick={() => setAdsetTextDialogOpen(true)}
                    className="rounded border border-primary text-primary px-3 py-1.5 text-sm hover:bg-primary/5">
                    {adsetTextConfigs.length > 0 ? `Edit Text (${getAdsetNamesForTextConfig().length} ad sets configured)` : "Configure Ad Set Text"}
                  </button>
                  {adsetTextConfigs.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {adsetTextConfigs.filter(c => c.headlines[0] || c.primaryTexts[0]).length} / {adsetTextConfigs.length} ad sets have text
                    </p>
                  )}
                </div>
              )}

              {/* Option 3 */}
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input type="radio" name="adTextMode" checked={useUniqueTextPerCreative}
                  onChange={() => { setUseUniqueTextPerCreative(true); setUseCommonText(false); setUseUniqueTextPerAdset(false) }} className="size-4" />
                Write unique ad text for each ad
              </label>
              {useUniqueTextPerCreative && (
                <div className="ml-6">
                  <button type="button" onClick={() => setAdPerCreativeDialogOpen(true)}
                    className="rounded border border-primary text-primary px-3 py-1.5 text-sm hover:bg-primary/5">
                    {creativeTextConfigs.length > 0 ? `Edit Text (${creativeDetails.length} ads configured)` : "Configure Ad Text"}
                  </button>
                  {creativeTextConfigs.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {creativeTextConfigs.filter(c => c.headlines?.[0] || c.primaryTexts?.[0]).length} / {creativeTextConfigs.length} ads have text
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Creative Enhancements */}
            {(() => {
              const IMAGE_OPTIONS = [
                { key: "add_music", label: "Add music" },
                { key: "image_brightness_and_contrast", label: "Adjust brightness and contrast" },
                { key: "cta_enhancements", label: "Enhance CTA" },
                { key: "relevant_comments", label: "Relevant comments" },
                { key: "image_animation", label: "Reveal details over time" },
                { key: "text_optimizations", label: "Text improvements" },
                { key: "translate_text", label: "Translate text" },
                { key: "image_touch_ups", label: "Visual touch-ups" },
              ]
              const VIDEO_OPTIONS = [
                { key: "add_music", label: "Add music" },
                { key: "video_effects", label: "Add video effects" },
                { key: "cta_enhancements", label: "Enhance CTA" },
                { key: "relevant_comments", label: "Relevant comments" },
                { key: "image_animation", label: "Reveal details over time" },
                { key: "text_optimizations", label: "Text improvements" },
                { key: "translate_text", label: "Translate text" },
                { key: "visual_touch_ups", label: "Visual touch-ups" },
              ]
              const allImgSelected = IMAGE_OPTIONS.every(o => imageEnhancements.has(o.key))
              const allVidSelected = VIDEO_OPTIONS.every(o => videoEnhancements.has(o.key))
              const allSelected = allImgSelected && allVidSelected
              const toggleImg = (key: string) => { const n = new Set(imageEnhancements); n.has(key) ? n.delete(key) : n.add(key); setImageEnhancements(n) }
              const toggleVid = (key: string) => { const n = new Set(videoEnhancements); n.has(key) ? n.delete(key) : n.add(key); setVideoEnhancements(n) }
              const selectAll = () => {
                if (allSelected) { setImageEnhancements(new Set()); setVideoEnhancements(new Set()) }
                else { setImageEnhancements(new Set(IMAGE_OPTIONS.map(o => o.key))); setVideoEnhancements(new Set(VIDEO_OPTIONS.map(o => o.key))) }
              }
              return (
                <div className="space-y-3 rounded-lg border p-4">
                  <div>
                    <h3 className="font-semibold">Creative Enhancements</h3>
                    <p className="text-sm text-muted-foreground">Select Advantage+ enhancements to enable.</p>
                  </div>
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="checkbox" checked={useMetaDefaults} onChange={e => { setUseMetaDefaults(e.target.checked); if (e.target.checked) { setImageEnhancements(new Set()); setVideoEnhancements(new Set()) } }} className="size-4" />
                      Use Meta Defaults
                    </label>
                    {!useMetaDefaults && (
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="checkbox" checked={allSelected} onChange={selectAll} className="size-4" />
                        Select All
                      </label>
                    )}
                  </div>
                  {!useMetaDefaults && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-sm font-medium">Images</p>
                          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
                            <input type="checkbox" checked={allImgSelected} onChange={() => setImageEnhancements(allImgSelected ? new Set() : new Set(IMAGE_OPTIONS.map(o => o.key)))} className="size-3.5" />
                            All
                          </label>
                        </div>
                        <div className="space-y-1.5">
                          {IMAGE_OPTIONS.map(opt => (
                            <label key={opt.key} className="flex items-center gap-2 cursor-pointer text-sm">
                              <input type="checkbox" checked={imageEnhancements.has(opt.key)} onChange={() => toggleImg(opt.key)} className="size-4 accent-primary" />
                              {opt.label}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-sm font-medium">Videos</p>
                          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
                            <input type="checkbox" checked={allVidSelected} onChange={() => setVideoEnhancements(allVidSelected ? new Set() : new Set(VIDEO_OPTIONS.map(o => o.key)))} className="size-3.5" />
                            All
                          </label>
                        </div>
                        <div className="space-y-1.5">
                          {VIDEO_OPTIONS.map(opt => (
                            <label key={opt.key} className="flex items-center gap-2 cursor-pointer text-sm">
                              <input type="checkbox" checked={videoEnhancements.has(opt.key)} onChange={() => toggleVid(opt.key)} className="size-4 accent-primary" />
                              {opt.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Pixel Tracking */}
            <div className="space-y-3 rounded-lg border p-4">
              <h3 className="font-semibold">Conversion Tracking (Optional)</h3>
              <p className="text-xs text-muted-foreground">Select a Facebook Pixel to track events like purchases or leads for Conversion objectives.</p>
              
              {loadingPixels ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><IconLoader2 className="size-4 animate-spin" /> Loading pixels...</div>
              ) : pixels.length === 0 ? (
                <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">No pixels found in this ad account.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Select Pixel</label>
                    <Select value={selectedPixelId} onValueChange={setSelectedPixelId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="No pixel selected" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {pixels.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name} ({p.id})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Conversion Event</label>
                    <Select value={pixelEvent} onValueChange={setPixelEvent} disabled={!selectedPixelId || selectedPixelId === "none"}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PURCHASE">Purchase</SelectItem>
                        <SelectItem value="LEAD">Lead</SelectItem>
                        <SelectItem value="ADD_TO_CART">Add to Cart</SelectItem>
                        <SelectItem value="INITIATE_CHECKOUT">Initiate Checkout</SelectItem>
                        <SelectItem value="COMPLETE_REGISTRATION">Complete Registration</SelectItem>
                        <SelectItem value="SUBSCRIBE">Subscribe</SelectItem>
                        <SelectItem value="CONTACT">Contact</SelectItem>
                        <SelectItem value="VIEW_CONTENT">View Content</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>

            {/* Publication Options */}
            <div className="space-y-3 rounded-lg border p-4">
              <h3 className="font-semibold">Publication Options</h3>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={createPaused} onChange={e => setCreatePaused(e.target.checked)} className="size-4 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Create ads in paused status</p>
                  <p className="text-xs text-muted-foreground">Ads will be created but won't run until you manually activate them in Meta Ads Manager.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={scheduleStart} onChange={e => { setScheduleStart(e.target.checked); if (!e.target.checked) { setScheduleDate(undefined); setScheduleHour("08"); setScheduleMinute("00") } }} className="size-4 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Schedule these ads to start at a specific time</p>
                  <p className="text-xs text-muted-foreground">Ads will remain paused until the scheduled time.</p>
                  {scheduleStart && (
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      {/* Date picker */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className={`flex items-center gap-2 h-9 px-3 rounded-md border text-sm transition-colors hover:bg-muted ${scheduleDate ? "text-foreground" : "text-muted-foreground"}`}>
                            <IconCalendar className="size-4 shrink-0" />
                            {scheduleDate
                              ? scheduleDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                              : "Pick a date"}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={scheduleDate}
                            onSelect={setScheduleDate}
                            disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>

                      {/* Time picker */}
                      {(() => {
                        const hours = Array.from({length: 24}, (_, i) => String(i).padStart(2,"0"))
                        const minutes = ["00","05","10","15","20","25","30","35","40","45","50","55"]
                        return (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" className="flex items-center gap-2 h-9 px-3 rounded-md border text-sm hover:bg-muted transition-colors">
                                <IconClock className="size-4 text-muted-foreground shrink-0" />
                                <span className="font-mono">{scheduleHour}:{scheduleMinute}</span>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-3" align="start">
                              <p className="text-xs font-medium text-muted-foreground mb-2">Select time</p>
                              <div className="flex gap-2">
                                {/* Hours column */}
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-xs text-muted-foreground uppercase tracking-wide">HH</span>
                                  <div className="h-48 overflow-y-auto scrollbar-thin flex flex-col gap-0.5 pr-1">
                                    {hours.map(h => (
                                      <button key={h} type="button" onClick={() => setScheduleHour(h)}
                                        className={`w-10 h-8 rounded text-sm font-mono transition-colors ${scheduleHour === h ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                                        {h}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex items-center pb-1 text-muted-foreground text-lg font-light">:</div>
                                {/* Minutes column */}
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-xs text-muted-foreground uppercase tracking-wide">MM</span>
                                  <div className="h-48 overflow-y-auto scrollbar-thin flex flex-col gap-0.5 pr-1">
                                    {minutes.map(m => (
                                      <button key={m} type="button" onClick={() => setScheduleMinute(m)}
                                        className={`w-10 h-8 rounded text-sm font-mono transition-colors ${scheduleMinute === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                                        {m}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )
                      })()}

                      {/* Preview */}
                      {scheduleDate && (
                        <span className="text-xs text-muted-foreground">
                          Starts {scheduleDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at {scheduleHour}:{scheduleMinute}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </label>
            </div>

            {/* UTM Parameters */}
            {(() => {
              const utmPreview = [
                utmSource && `utm_source=${utmSource}`,
                utmMedium && `utm_medium=${utmMedium}`,
                utmCampaign && `utm_campaign=${utmCampaign}`,
                utmContent && `utm_content=${utmContent}`,
                utmTerm && `utm_term=${utmTerm}`,
              ].filter(Boolean).join("&")
              return (
                <div className="space-y-3 rounded-lg border p-4">
                  <div>
                    <h3 className="font-semibold">URL Tracking (UTM)</h3>
                    <p className="text-sm text-muted-foreground">Appended to all destination URLs for analytics tracking.</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                    <input type="checkbox" checked={useUtm} onChange={e => setUseUtm(e.target.checked)} className="size-4" />
                    Add UTM parameters to all URLs
                  </label>
                  {useUtm && (
                    <div className="ml-6 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          ["utm_source", "Source", utmSource, setUtmSource, "facebook"],
                          ["utm_medium", "Medium", utmMedium, setUtmMedium, "paid"],
                          ["utm_campaign", "Campaign", utmCampaign, setUtmCampaign, "campaign_name"],
                          ["utm_content", "Content", utmContent, setUtmContent, "ad_name (optional)"],
                          ["utm_term", "Term", utmTerm, setUtmTerm, "keyword (optional)"],
                        ] as [string, string, string, (v: string) => void, string][]).map(([key, label, val, set, ph]) => (
                          <div key={key} className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">{label} <span className="font-mono text-xs">{key}</span></p>
                            <Input value={val} onChange={e => set(e.target.value)} placeholder={ph} className="h-8 text-xs" />
                          </div>
                        ))}
                      </div>
                      {utmPreview && (
                        <div className="rounded-md bg-muted px-3 py-2">
                          <p className="text-xs text-muted-foreground mb-1">Preview</p>
                          <p className="text-xs font-mono break-all text-foreground">?{utmPreview}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Facebook Page */}
            <div className="space-y-2 rounded-lg border p-4">
              <h3 className="font-semibold">Facebook Page</h3>
              <p className="text-xs text-muted-foreground">Page that will appear as the author of these ads.</p>
              {pages.length > 0 ? (
                <select value={selectedPageId} onChange={(e) => setSelectedPageId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                  {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <IconAlertTriangle className="size-3.5 shrink-0" />
                  No Facebook Pages found. Make sure your Facebook account is connected and has at least one Page.
                </div>
              )}
            </div>

            {/* Launch — luôn hiện, disable khi chưa đủ điều kiện */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <IconAlertTriangle className="size-4 shrink-0" />{error}
              </div>
            )}

            {canLaunch && validationErrors.length > 0 && (
              <div className="space-y-1.5">
                {validationErrors.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <IconAlertTriangle className="size-3.5 shrink-0" />{e}
                  </div>
                ))}
              </div>
            )}

            <Button onClick={handleLaunch} disabled={launching || !canLaunch || validationErrors.length > 0} className="w-full">
              {launching
                ? <><IconLoader2 className="size-4 animate-spin" /> Launching {selectedCreativeIds.length} ads...</>
                : <><IconRocket className="size-4" /> Launch {selectedCreativeIds.length} Ads</>}
            </Button>
            {launching && (
              <p className="text-center text-xs text-muted-foreground animate-pulse">
                Creating ads — this may take a moment for large batches
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>

    <CustomAdSetDialog
      open={customDialogOpen}
      onClose={() => setCustomDialogOpen(false)}
      creativeIds={selectedCreativeIds}
      campaignNames={
        createMultipleCampaigns ? multipleCampaignNames.filter(n => n.trim()) :
        createNewCampaign ? [newCampaignName || "Campaign 1"] :
        [selectedCampaign?.name || "Campaign 1"]
      }
      onApply={(cfg) => { setCustomConfig(cfg) }}
    />
    <AdSetTextDialog
      open={adsetTextDialogOpen}
      onClose={() => setAdsetTextDialogOpen(false)}
      adsetNames={getAdsetNamesForTextConfig()}
      initial={adsetTextConfigs}
      onApply={setAdsetTextConfigs}
    />
    <AdPerCreativeTextDialog
      open={adPerCreativeDialogOpen}
      onClose={() => setAdPerCreativeDialogOpen(false)}
      creatives={creativeDetails as any}
      initial={creativeTextConfigs}
      onApply={setCreativeTextConfigs}
    />
    </>
  )
}
