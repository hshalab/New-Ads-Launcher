"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  IconAlertCircle,
  IconCheck,
  IconFolder,
  IconLayoutGrid,
  IconLoader2,
  IconTable,
  IconX,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { useAdAccount } from "@/lib/ad-account-context"
import { cn } from "@/lib/utils"
import { AdLevel } from "./AdLevel"
import { AdSetLevel } from "./AdSetLevel"
import { CampaignLevel } from "./CampaignLevel"
import {
  CampaignFormState,
  CreativeAssetOption,
  defaultCampaignState,
  AdvertiserEntity,
  FacebookPageOption,
  InstagramOption,
  PixelOption,
} from "./types"

type Step = "campaign" | "adset" | "ad"
type PublishStatus = "idle" | "publishing" | "success" | "error"

function advertiserStillAvailable(entity: AdvertiserEntity | null, options: AdvertiserEntity[]) {
  return Boolean(entity && options.some((option) => option?.id === entity.id && option.type === entity.type))
}

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  initialState?: Partial<CampaignFormState>
}

interface CreateCampaignResponse {
  success?: boolean
  error?: string
  campaignId?: string
  adSetId?: string
  adId?: string
  batchId?: string | null
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
])

function isZeroDecimalCurrency(currency: string) {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function positiveMoney(value: string, currency: string) {
  const trimmed = value.trim()
  const valid = isZeroDecimalCurrency(currency)
    ? /^\d+(\.0{1,2})?$/.test(trimmed)
    : /^\d+(\.\d{1,2})?$/.test(trimmed)
  if (!valid) return false

  const amount = Number.parseFloat(value)
  return Number.isFinite(amount) && amount > 0
}

interface ValidationIssue {
  step: Step
  field: string
  message: string
}

function getValidationIssues(
  state: CampaignFormState,
  selectedAccountId: string,
  currency: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!selectedAccountId) issues.push({ step: "campaign", field: "adAccount", message: "Select an ad account first." })
  if (!state.campaignName.trim()) issues.push({ step: "campaign", field: "campaignName", message: "Campaign name is required." })
  if (state.advantageCampaignBudget && !positiveMoney(state.campaignBudget, currency)) {
    issues.push({ step: "campaign", field: "campaignBudget", message: `Budget must be a valid ${currency} amount greater than 0.` })
  }

  if (!state.adSetName.trim()) issues.push({ step: "adset", field: "adSetName", message: "Ad set name is required." })
  if (!state.locations.length) issues.push({ step: "adset", field: "locations", message: "Select at least one country." })
  if (state.ageMin < 18 || state.ageMax < state.ageMin || state.ageMax > 65) {
    issues.push({ step: "adset", field: "ageRange", message: "Age range must be between 18 and 65+." })
  }
  if (state.objective === "OUTCOME_SALES" && !state.pixelId) {
    issues.push({ step: "adset", field: "pixelId", message: "Select a Pixel for Sales conversion campaigns." })
  }
  if (!state.advantageCampaignBudget && !positiveMoney(state.dailyBudget, currency)) {
    issues.push({ step: "adset", field: "dailyBudget", message: `Budget must be a valid ${currency} amount greater than 0.` })
  }
  if (state.costPerResultGoal && !positiveMoney(state.costPerResultGoal, currency)) {
    issues.push({ step: "adset", field: "costPerResultGoal", message: `Cost goal must be a valid ${currency} amount greater than 0.` })
  }
  if (state.scheduleStart && state.scheduleEnd && new Date(state.scheduleEnd) <= new Date(state.scheduleStart)) {
    issues.push({ step: "adset", field: "scheduleEnd", message: "End date must be after start date." })
  }

  if (!state.adName.trim()) issues.push({ step: "ad", field: "adName", message: "Ad name is required." })
  if (!state.pageId) issues.push({ step: "ad", field: "pageId", message: "Select a Facebook Page." })
  const hasCreative = state.creativeIds.length > 0 || Boolean(state.creativeId)
  if (!hasCreative && !state.mediaUrl.trim()) {
    issues.push({ step: "ad", field: "media", message: "Upload a media file or enter a valid media URL." })
  } else if (!hasCreative && !isValidHttpUrl(state.mediaUrl)) {
    issues.push({ step: "ad", field: "media", message: "Enter a valid image or video URL." })
  }
  if (!state.primaryText.trim()) issues.push({ step: "ad", field: "primaryText", message: "Primary text is required." })
  if (!state.headline.trim()) issues.push({ step: "ad", field: "headline", message: "Headline is required." })
  if (!state.destinationUrl.trim() || !isValidHttpUrl(state.destinationUrl)) {
    issues.push({ step: "ad", field: "destinationUrl", message: "Enter a valid website URL." })
  }
  return issues
}

function validateState(
  state: CampaignFormState,
  selectedAccountId: string,
  currency: string,
  through: Step = "ad"
) {
  const stepOrder: Step[] = ["campaign", "adset", "ad"]
  const lastStep = stepOrder.indexOf(through)
  return getValidationIssues(state, selectedAccountId, currency)
    .find(issue => stepOrder.indexOf(issue.step) <= lastStep) || null
}

export function CreateCampaignModal({ open, onClose, onSuccess, initialState }: Props) {
  const [activeStep, setActiveStep] = useState<Step>("campaign")
  const [state, setState] = useState<CampaignFormState>(defaultCampaignState)
  const [isPublishing, setIsPublishing] = useState(false)
  const [formError, setFormError] = useState("")
  const [loadError, setLoadError] = useState("")
  const [createdIds, setCreatedIds] = useState<CreateCampaignResponse | null>(null)
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle")
  const [publishMessage, setPublishMessage] = useState("")
  const [showValidation, setShowValidation] = useState(false)

  const [pages, setPages] = useState<FacebookPageOption[]>([])
  const [pagesLoading, setPagesLoading] = useState(false)
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramOption[]>([])
  const [instagramLoading, setInstagramLoading] = useState(false)
  const [pixels, setPixels] = useState<PixelOption[]>([])
  const [pixelsLoading, setPixelsLoading] = useState(false)
  const [advertisers, setAdvertisers] = useState<AdvertiserEntity[]>([])
  const [isUploadingMedia, setIsUploadingMedia] = useState(false)
  const [mediaUploadError, setMediaUploadError] = useState("")
  const loadedAccountIdRef = useRef("")

  const { selectedAccountId, selectedAccount, loading: accountsLoading } = useAdAccount()
  const currency = (selectedAccount?.currency || "USD").toUpperCase()

  const update = (updates: Partial<CampaignFormState>) => {
    setState((previous) => ({ ...previous, ...updates }))
    setFormError("")
    setMediaUploadError("")
    setCreatedIds(null)
    setShowValidation(false)
  }

  const applyUploadedCreative = (creative: CreativeAssetOption) => {
    const previewUrl =
      creative.media_type === "video"
        ? creative.file_url || creative.fb_thumbnail_url || ""
        : creative.fb_thumbnail_url || creative.fb_image_url || creative.file_url || ""

    setState((previous) => ({
      ...previous,
      creativeId: creative.id,
      creativeFileName: creative.file_name,
      creativePreviewUrl: previewUrl,
      mediaType: creative.media_type,
      mediaUrl: "",
    }))
  }

  const refreshUploadedVideoPreview = async (creativeId: string) => {
    try {
      const res = await fetch(`/api/creatives/${creativeId}/thumbnail`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) return

      const previewUrl = data.source_url || data.thumbnail_url || ""
      if (!previewUrl) return

      setState((previous) => {
        if (previous.creativeId !== creativeId) return previous
        return {
          ...previous,
          creativePreviewUrl: previewUrl,
        }
      })
    } catch {}
  }

  const handleMediaFileSelected = async (file: File | null): Promise<CreativeAssetOption | null> => {
    if (!file) return null
    if (!selectedAccountId) {
      setMediaUploadError("Select an ad account before uploading media.")
      return null
    }

    const isVideo = file.type.startsWith("video/")
    const isImage = file.type.startsWith("image/")
    if (!isImage && !isVideo) {
      setMediaUploadError("Only image and video files are supported.")
      return null
    }

    const maxSize = isVideo ? 1024 * 1024 * 1024 : 30 * 1024 * 1024
    if (file.size > maxSize) {
      setMediaUploadError(
        isVideo
          ? "Video file is too large. Max 1GB."
          : "Image file is too large. Max 30MB."
      )
      return null
    }

    setIsUploadingMedia(true)
    setMediaUploadError("")
    setFormError("")

    try {
      const params = new URLSearchParams({
        filename: file.name,
        type: file.type,
        size: String(file.size),
        ad_account_id: selectedAccountId,
      })

      const res = await fetch(`/api/creatives/upload-binary?${params}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      })
      const data = await res.json()
      if (!res.ok || !data.creative) {
        throw new Error(data.error || "Failed to upload media")
      }

      const creative = data.creative as CreativeAssetOption
      applyUploadedCreative(creative)

      if (creative.media_type === "video" && !creative.fb_thumbnail_url && !!(creative as any).fb_video_id) {
        void refreshUploadedVideoPreview(creative.id)
      }
      return creative
    } catch (error) {
      setMediaUploadError(error instanceof Error ? error.message : "Failed to upload media")
      return null
    } finally {
      setIsUploadingMedia(false)
    }
  }

  const clearUploadedCreative = () => {
    setState((previous) => ({
      ...previous,
      creativeId: "",
      creativeFileName: "",
      creativePreviewUrl: "",
    }))
    setMediaUploadError("")
  }

  useEffect(() => {
    if (!open) return
    setState({
      ...defaultCampaignState,
      ...initialState,
      specialAdCategories: [...(initialState?.specialAdCategories || defaultCampaignState.specialAdCategories)],
      locations: [...(initialState?.locations || defaultCampaignState.locations)],
      customAudiences: [...(initialState?.customAudiences || defaultCampaignState.customAudiences)],
      excludedCustomAudiences: [...(initialState?.excludedCustomAudiences || defaultCampaignState.excludedCustomAudiences)],
      detailedTargeting: [...(initialState?.detailedTargeting || defaultCampaignState.detailedTargeting)],
      publisherPlatforms: [...(initialState?.publisherPlatforms || defaultCampaignState.publisherPlatforms)],
      creativeIds: [...(initialState?.creativeIds || defaultCampaignState.creativeIds)],
      selectedCreatives: [...(initialState?.selectedCreatives || defaultCampaignState.selectedCreatives)],
      primaryTextVariations: [...(initialState?.primaryTextVariations || defaultCampaignState.primaryTextVariations)],
      headlineVariations: [...(initialState?.headlineVariations || defaultCampaignState.headlineVariations)],
      descriptionVariations: [...(initialState?.descriptionVariations || defaultCampaignState.descriptionVariations)],
    })
    setActiveStep("campaign")
    setFormError("")
    setMediaUploadError("")
    setCreatedIds(null)
    setPublishStatus("idle")
    setPublishMessage("")
    setShowValidation(false)
  }, [initialState, open])

  useEffect(() => {
    if (!open) return

    if (!selectedAccountId) {
      setPages([])
      setPixels([])
      setInstagramAccounts([])
      setAdvertisers([])
      setPagesLoading(false)
      setPixelsLoading(false)
      setLoadError(accountsLoading ? "" : "Select an ad account first.")
      setState((previous) => ({
        ...previous,
        pageId: "",
        instagramId: "",
        pixelId: "",
        creativeId: "",
        creativeFileName: "",
        creativePreviewUrl: "",
      }))
      loadedAccountIdRef.current = ""
      return
    }

    let cancelled = false
    setLoadError("")
    setPages([])
    setPixels([])
    setInstagramAccounts([])
    setAdvertisers([])
    setPagesLoading(true)
    setPixelsLoading(true)

    if (loadedAccountIdRef.current && loadedAccountIdRef.current !== selectedAccountId) {
      setState((previous) => ({
        ...previous,
        pageId: "",
        instagramId: "",
        pixelId: "",
        creativeId: "",
        creativeFileName: "",
        creativePreviewUrl: "",
      }))
    }

    const load = async () => {
      try {
        const [pagesRes, pixelsRes, advertisersRes] = await Promise.all([
          fetch(`/api/facebook/pages?ad_account_id=${encodeURIComponent(selectedAccountId)}`),
          fetch(`/api/facebook/pixels?ad_account_id=${encodeURIComponent(selectedAccountId)}`),
          fetch(`/api/facebook/adset-advertisers?ad_account_id=${encodeURIComponent(selectedAccountId)}`),
        ])
        const pagesData = await pagesRes.json()
        const pixelsData = await pixelsRes.json()
        const advertisersData = await advertisersRes.json()

        if (!pagesRes.ok) throw new Error(pagesData.error || "Failed to load Pages")
        if (!pixelsRes.ok) throw new Error(pixelsData.error || "Failed to load Pixels")
        if (!advertisersRes.ok) throw new Error(advertisersData.error || "Failed to load advertisers")

        if (cancelled) return
        const nextPages = (pagesData.pages || []) as FacebookPageOption[]
        const nextPixels = (pixelsData.pixels || []) as PixelOption[]
        setPages(nextPages)
        setPixels(nextPixels)
        const nextAdvertisers = ((advertisersData.advertisers || []) as AdvertiserEntity[]).filter(
          (entity): entity is NonNullable<AdvertiserEntity> => Boolean(entity)
        )
        setAdvertisers(nextAdvertisers)
        loadedAccountIdRef.current = selectedAccountId
        setState((previous) => ({
          ...previous,
          pageId: nextPages.some((page) => page.id === previous.pageId) ? previous.pageId : "",
          instagramId: nextPages.some((page) => page.id === previous.pageId) ? previous.instagramId : "",
          pixelId: nextPixels.some((pixel) => pixel.id === previous.pixelId) ? previous.pixelId : "",
          advertiser: advertiserStillAvailable(previous.advertiser, nextAdvertisers)
            ? previous.advertiser
            : null,
          payer: advertiserStillAvailable(previous.payer, nextAdvertisers)
            ? previous.payer
            : null,
          creativeId: previous.creativeId,
          creativeFileName: previous.creativeFileName,
          creativePreviewUrl: previous.creativePreviewUrl,
        }))
      } catch (error) {
        if (!cancelled) {
          setPages([])
          setPixels([])
          setAdvertisers([])
          setLoadError(error instanceof Error ? error.message : "Failed to load account data")
        }
      } finally {
        if (!cancelled) {
          setPagesLoading(false)
          setPixelsLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open, selectedAccountId, accountsLoading])

  useEffect(() => {
    if (!open || !state.pageId || !selectedAccountId) {
      setInstagramAccounts([])
      setInstagramLoading(false)
      return
    }

    let cancelled = false
    setInstagramLoading(true)

    const loadInstagram = async () => {
      try {
        const params = new URLSearchParams({
          page_id: state.pageId,
          ad_account_id: selectedAccountId,
        })
        const res = await fetch(`/api/facebook/page-instagram?${params}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to load Instagram accounts")
        if (cancelled) return
        const accounts = (data.igAccounts || []) as InstagramOption[]
        setInstagramAccounts(accounts)
        setState((previous) => ({
          ...previous,
          instagramId: accounts.some((account) => account.id === previous.instagramId)
            ? previous.instagramId
            : "",
        }))
      } catch {
        if (!cancelled) setInstagramAccounts([])
      } finally {
        if (!cancelled) setInstagramLoading(false)
      }
    }

    void loadInstagram()
    return () => {
      cancelled = true
    }
  }, [open, selectedAccountId, state.pageId])

  const activeTitle = useMemo(() => {
    if (activeStep === "campaign") return state.campaignName || "New Campaign"
    if (activeStep === "adset") return state.adSetName || "New Ad Set"
    return state.adName || "New Ad"
  }, [activeStep, state.adName, state.adSetName, state.campaignName])
  const invalidFields = useMemo(() => {
    if (!showValidation) return new Set<string>()
    const issues = getValidationIssues(state, selectedAccountId, currency)
    // Only highlight the first issue to avoid overwhelming the UI with multiple red borders
    return issues.length > 0 ? new Set<string>([issues[0].field]) : new Set<string>()
  }, [showValidation, state, selectedAccountId, currency])

  const handleSaveAndContinue = () => {
    setFormError("")
    if (activeStep === "campaign") setActiveStep("adset")
    else if (activeStep === "adset") setActiveStep("ad")
  }

  const handlePublish = async () => {
    if (loadError) {
      setFormError(loadError)
      return
    }
    if (mediaUploadError) {
      setFormError(mediaUploadError)
      return
    }

    const validation = validateState(state, selectedAccountId, currency)
    if (validation) {
      setShowValidation(true)
      setActiveStep(validation.step)
      return
    }

    setIsPublishing(true)
    setPublishStatus("publishing")
    setPublishMessage("Creating campaign, ad set and ads in Meta...")
    setFormError("")
    setCreatedIds(null)
    onClose()

    try {
      const res = await fetch("/api/facebook/create-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adAccountId: selectedAccountId, state }),
      })
      const data = (await res.json()) as CreateCampaignResponse
      if (!res.ok || data.error) throw new Error(data.error || "Failed to publish campaign")

      setCreatedIds(data)
      setPublishStatus("success")
      setPublishMessage("Campaign published successfully.")
      onSuccess?.()
      setState(defaultCampaignState)
      setTimeout(() => setPublishStatus("idle"), 3000)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to publish campaign"
      setFormError(message)
      setPublishStatus("error")
      setPublishMessage(message)
    } finally {
      setIsPublishing(false)
    }
  }

  const publishDisabled =
    isPublishing ||
    isUploadingMedia ||
    pagesLoading ||
    pixelsLoading ||
    !selectedAccountId ||
    Boolean(loadError)

  // Account + Pages (+ Pixels) are required before the create flow can be filled in.
  // Keep the shell so the user can still close; block the body until metadata lands.
  const bootLoading =
    accountsLoading ||
    (!!selectedAccountId && (pagesLoading || pixelsLoading))

  if (!open) {
    return <CampaignPublishToast status={publishStatus} message={publishMessage} />
  }

  return (
    <>
      <CampaignPublishToast status={publishStatus} message={publishMessage} />
      <div className="fixed inset-0 z-50 flex justify-center bg-black/40">
      <div className="m-4 flex w-full max-w-[1250px] animate-in flex-col overflow-hidden rounded-lg border border-[#e4e6eb] bg-[#f5f6f7] shadow-2xl duration-200 fade-in zoom-in-95 dark:border-gray-800 dark:bg-background">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#e4e6eb] bg-white px-4 dark:border-gray-800 dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isPublishing}
              className="rounded-full p-1.5 transition-colors hover:bg-black/5 disabled:opacity-50"
            >
              <IconX className="size-5 text-[#65676b]" />
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-[#1c2b33] dark:text-gray-100">
                Create a New Campaign
              </h2>
              <p className="truncate text-xs text-[#65676b]">
                {bootLoading
                  ? accountsLoading
                    ? "Loading ad accounts…"
                    : "Loading Facebook pages…"
                  : activeTitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isPublishing}
              className="h-8 border-[#ccd0d5] text-xs font-semibold text-[#4b4f56]"
            >
              Close
            </Button>
          </div>
        </div>

        {bootLoading ? (
          <div className="flex min-h-[480px] flex-1 items-center justify-center bg-white dark:bg-card">
            <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
              <IconLoader2 className="size-6 animate-spin text-primary" />
              <div className="font-medium text-foreground">Loading campaign setup…</div>
              <div>
                {accountsLoading
                  ? "Loading ad accounts…"
                  : pagesLoading
                    ? "Loading Facebook pages…"
                    : "Loading account metadata…"}
              </div>
            </div>
          </div>
        ) : (
          <>
            {(formError || mediaUploadError || loadError || createdIds?.success) && (
              <div className="shrink-0 border-b border-[#e4e6eb] bg-white px-4 py-2 dark:border-gray-800 dark:bg-card">
                {formError || mediaUploadError || loadError ? (
                  <div className="flex items-start gap-2 text-xs text-red-600">
                    <IconAlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{formError || mediaUploadError || loadError}</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-xs text-green-700">
                    <IconCheck className="mt-0.5 size-4 shrink-0" />
                    <span>Campaign created successfully.</span>
                  </div>
                )}
              </div>
            )}

            <div className="relative flex flex-1 overflow-hidden">
              <div className="w-[280px] shrink-0 overflow-y-auto border-r border-[#e4e6eb] bg-white dark:border-gray-800 dark:bg-card">
                <div className="mt-2 space-y-0.5 p-2">
                  <StepButton
                    active={activeStep === "campaign"}
                    icon={IconFolder}
                    label={state.campaignName || "New Campaign"}
                    onClick={() => setActiveStep("campaign")}
                  />
                  <div className="relative pl-[21px]">
                    <div className="absolute bottom-0 left-[21px] top-0 w-px bg-[#e4e6eb] dark:bg-gray-800" />
                    <StepButton
                      active={activeStep === "adset"}
                      nested
                      icon={IconTable}
                      label={state.adSetName || "New Ad Set"}
                      onClick={() => setActiveStep("adset")}
                    />
                    <div className="relative pl-[21px]">
                      <div className="absolute bottom-1/2 left-[21px] top-0 w-px bg-[#e4e6eb] dark:bg-gray-800" />
                      <StepButton
                        active={activeStep === "ad"}
                        nested
                        icon={IconLayoutGrid}
                        label={state.adName || "New Ad"}
                        onClick={() => setActiveStep("ad")}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-card">
                <div className="flex-1 overflow-y-auto">
                  {activeStep === "campaign" && (
                  <CampaignLevel state={state} update={update} currency={currency} invalidFields={invalidFields} />
                  )}
                  {activeStep === "adset" && (
                    <AdSetLevel
                      state={state}
                      update={update}
                      pixels={pixels}
                      pixelsLoading={pixelsLoading}
                      currency={currency}
                      timezoneName={selectedAccount?.timezone_name}
                      invalidFields={invalidFields}
                      advertisers={advertisers}
                    />
                  )}
                  {activeStep === "ad" && (
                    <AdLevel
                      state={state}
                      update={update}
                      pages={pages}
                      pagesLoading={pagesLoading}
                      instagramAccounts={instagramAccounts}
                      instagramLoading={instagramLoading}
                      mediaUploading={isUploadingMedia}
                      mediaUploadError={mediaUploadError}
                      onSelectMediaFile={handleMediaFileSelected}
                      onClearUploadedCreative={clearUploadedCreative}
                      adAccountId={selectedAccountId}
                      adAccountName={selectedAccount?.name || selectedAccountId}
                      invalidFields={invalidFields}
                    />
                  )}
                </div>
                <div className="flex shrink-0 justify-end border-t border-[#e4e6eb] px-6 py-3 dark:border-gray-800">
                  {activeStep === "ad" ? (
                    <Button
                      onClick={handlePublish}
                      disabled={publishDisabled}
                      className="bg-[#31a24c] px-5 font-semibold text-white hover:bg-[#2b9244]"
                    >
                      Publish
                    </Button>
                  ) : (
                    <Button onClick={handleSaveAndContinue} className="bg-[#1877f2] px-5 font-semibold text-white hover:bg-[#166fe5]">
                      Save and continue
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
    </>
  )
}

function CampaignPublishToast({
  status,
  message,
}: {
  status: PublishStatus
  message: string
}) {
  if (status === "idle") return null

  const Icon = status === "publishing" ? IconLoader2 : status === "success" ? IconCheck : IconAlertCircle
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-5 z-[60] flex max-w-sm animate-in items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-xl slide-in-from-bottom-3 dark:bg-card"
    >
      <Icon
        className={cn(
          "size-5 shrink-0",
          status === "publishing" && "animate-spin text-blue-600",
          status === "success" && "text-green-600",
          status === "error" && "text-red-600"
        )}
      />
      <div>
        <p className="text-sm font-semibold">
          {status === "publishing" ? "Publishing campaign" : status === "success" ? "Publish complete" : "Publish failed"}
        </p>
        <p className="text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}

function StepButton({
  active,
  icon: Icon,
  label,
  nested = false,
  onClick,
}: {
  active: boolean
  icon: React.ElementType
  label: string
  nested?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
        active ? "bg-[#e3f0fe] dark:bg-blue-950/30" : "hover:bg-[#f5f6f7] dark:hover:bg-white/5"
      )}
    >
      {nested && <div className="absolute left-0 top-1/2 h-px w-3 bg-[#e4e6eb] dark:bg-gray-800" />}
      <div
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded",
          active ? "bg-[#1877f2]" : "bg-[#c9ccd1] dark:bg-gray-700"
        )}
      >
        <Icon className="size-3.5 text-white" />
      </div>
      <p
        className={cn(
          "min-w-0 flex-1 truncate text-xs font-medium",
          active ? "text-[#1877f2]" : "text-[#1c2b33] dark:text-gray-200"
        )}
      >
        {label}
      </p>
    </button>
  )
}
