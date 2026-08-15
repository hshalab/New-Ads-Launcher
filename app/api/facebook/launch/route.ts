import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getConnectionForAdAccount, isManual, MissingViaError, requireRole } from "@/lib/auth"
import { assertLaunchable } from "@/lib/creative-readiness"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAdDetails, createCampaign, createAdSet, copyAdSet, createAd, getVideoThumbnail, getResourceAccountId, isFreshThumbnailUrl } from "@/lib/facebook"
import { adAccountBelongsToOrg, normalizeAdAccountId } from "../_utils"
import { notifyLaunchOutcome } from "@/lib/notifications/launch"
import { invalidateMetaReadCacheAfterWrite } from "../_db-cache"
import { mapWithConcurrency } from "@/lib/bounded-concurrency"

function applyPattern(pattern: string, ctx: { filename?: string; index?: number; date: string; shortDate: string }) {
  let r = pattern
  if (ctx.filename !== undefined) r = r.replace(/\{filename\}/g, ctx.filename)
  if (ctx.index !== undefined) {
    r = r.replace(/\{index:001\}/g, String(ctx.index).padStart(3, "0"))
    r = r.replace(/\{index:01\}/g, String(ctx.index).padStart(2, "0"))
    r = r.replace(/\{index\}/g, String(ctx.index))
  }
  return r
}

async function buildAdset(
  adAccountId: string, token: string, template: any,
  campaignId: string, name: string, dailyBudget?: number, startTime?: string,
  pageId?: string, resolvedObjective?: string,
  pixelId?: string, pixelEvent?: string,
  status = "PAUSED",
  tokenOpts?: { isManual?: boolean }
) {
  // Safe optimization goal per objective for adset-level budget (non-CBO) campaigns.
  // ENGAGED_USERS is CBO-only; for adset budgets, OUTCOME_ENGAGEMENT requires POST_ENGAGEMENT.
  const OBJECTIVE_SAFE_GOAL: Record<string, string> = {
    OUTCOME_ENGAGEMENT:    "POST_ENGAGEMENT",
    OUTCOME_AWARENESS:     "REACH",
    OUTCOME_TRAFFIC:       "LINK_CLICKS",
    OUTCOME_LEADS:         "LEAD_GENERATION",
    OUTCOME_SALES:         "OFFSITE_CONVERSIONS",
    OUTCOME_APP_PROMOTION: "APP_INSTALLS",
  }
  // Valid adset-level goals per objective (non-CBO)
  const OBJECTIVE_VALID_GOALS: Record<string, Set<string>> = {
    OUTCOME_ENGAGEMENT:    new Set(["POST_ENGAGEMENT", "PAGE_LIKES", "EVENT_RESPONSES", "REACH"]),
    OUTCOME_AWARENESS:     new Set(["REACH", "AD_RECALL_LIFT", "THRU_PLAYS", "IMPRESSIONS"]),
    OUTCOME_TRAFFIC:       new Set(["LINK_CLICKS", "LANDING_PAGE_VIEWS", "IMPRESSIONS", "REACH"]),
    OUTCOME_LEADS:         new Set(["LEAD_GENERATION", "QUALITY_LEAD", "LINK_CLICKS", "LANDING_PAGE_VIEWS"]),
    OUTCOME_SALES:         new Set(["OFFSITE_CONVERSIONS", "LINK_CLICKS", "LANDING_PAGE_VIEWS", "REACH"]),
    OUTCOME_APP_PROMOTION: new Set(["APP_INSTALLS", "LINK_CLICKS", "REACH"]),
  }
  // Remap legacy or CBO-only goals to their adset-budget equivalents
  const GOAL_REMAP: Record<string, string> = {
    ENGAGED_USERS:   "POST_ENGAGEMENT",   // CBO-only → adset equivalent
    OFFER_CLAIMS:    "POST_ENGAGEMENT",
    VALUE:           "OFFSITE_CONVERSIONS",
  }
  const campaignObjective: string = resolvedObjective || template.campaign?.objective || ""
  const rawGoal: string = template.adset.optimization_goal || ""
  const remappedGoal = GOAL_REMAP[rawGoal] ?? rawGoal
  const validForObjective = OBJECTIVE_VALID_GOALS[campaignObjective]
  const optimizationGoal =
    (remappedGoal && validForObjective?.has(remappedGoal))
      ? remappedGoal
      : (OBJECTIVE_SAFE_GOAL[campaignObjective] ?? "POST_ENGAGEMENT")

  const billingEvent = optimizationGoal === "THRU_PLAYS" ? "THRU_PLAYS" : "IMPRESSIONS"

  // OUTCOME_ENGAGEMENT requires destination_type so Facebook knows what kind of engagement to optimize for
  const destinationType = campaignObjective === "OUTCOME_ENGAGEMENT" ? "ON_POST" : undefined
  // promoted_object: only attach pixel+event for objectives that support conversion tracking
  const PIXEL_COMPATIBLE_OBJECTIVES = new Set(["OUTCOME_SALES", "OUTCOME_LEADS"])
  const promotedObject = pixelId && PIXEL_COMPATIBLE_OBJECTIVES.has(campaignObjective)
    ? { pixel_id: pixelId, custom_event_type: pixelEvent || "PURCHASE" }
    : (template.adset.promoted_object || undefined)
  // Keep only standard targeting fields to avoid v25 conflicts
  const rawTargeting = template.adset.targeting || {}
  const safeTargeting: Record<string, any> = {}
  if (rawTargeting.geo_locations) {
    // Strip location_types — deprecated in v25, causes validation errors
    const { location_types: _lt, ...geoRest } = rawTargeting.geo_locations
    safeTargeting.geo_locations = geoRest
  }
  if (rawTargeting.age_min) safeTargeting.age_min = rawTargeting.age_min
  if (rawTargeting.age_max) safeTargeting.age_max = rawTargeting.age_max
  if (rawTargeting.genders) safeTargeting.genders = rawTargeting.genders
  // flexible_spec (interest targeting) intentionally excluded — causes v25 API conflicts

  // Budget priority: explicit user input → template adset budget → undefined (will fail FB validation)
  let budgetCents: string | undefined
  if (dailyBudget && dailyBudget > 0) {
    budgetCents = String(Math.round(dailyBudget * 100))
  } else if (template.adset.daily_budget) {
    budgetCents = template.adset.daily_budget // already in cents from Facebook API
  }

  // If we have a real template adset ID, copy it to preserve all settings (attribution model, etc.)
  // EXCEPT legacy Dynamic Creative templates: copying would clone is_dynamic_creative=true
  // (set-on-create only, 1-ad cap) — build a fresh standard ad set from its settings instead.
  if (template.adset.id && !template.adset.is_dynamic_creative) {
    return copyAdSet(token, template.adset.id, {
      campaign_id: campaignId,
      name,
      daily_budget: dailyBudget,
      start_time: startTime,
      status,
    }, tokenOpts)
  }

  return createAdSet(adAccountId, token, {
    name,
    campaign_id: campaignId,
    targeting: safeTargeting,
    optimization_goal: optimizationGoal,
    billing_event: billingEvent,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    daily_budget: budgetCents,
    status,
    start_time: startTime,
    destination_type: destinationType,
    promoted_object: promotedObject,
    attribution_spec: template.adset.attribution_spec || undefined,
  }, tokenOpts)
}

interface TextOverride {
  headlines: string[]
  primaryTexts: string[]
  description: string
  cta: string
  websiteUrl: string
  displayUrl: string
}

function appendUtm(url: string, utmQuery: string): string {
  if (!utmQuery || !url) return url
  return url + (url.includes("?") ? "&" : "?") + utmQuery
}

async function createAdsInAdset(
  adsetId: string, creatives: any[], adAccountId: string,
  token: string, pageId: string, supabase: any,
  resolveName: (baseName: string, index: number) => string = (n) => n,
  startIndex = 1,
  textOverride?: TextOverride,
  creativeTextMap?: Map<string, any>,
  adStatus = "PAUSED",
  utmQuery = "",
  globalWebsiteUrl = "",
  globalDisplayUrl = "",
  tokenOpts?: { isManual?: boolean }
) {
  const outcomes = await mapWithConcurrency(creatives, 3, async (creative, i) => {
    const results: any[] = []
    const errors: any[] = []
    const baseName = creative.file_name.replace(/\.[^/.]+$/, "")
    const _pc = creativeTextMap?.get(creative.id)
    const pcHeadlines: string[] = _pc?.headlines?.filter((h: string) => h.trim()) || []
    const pcPrimaryTexts: string[] = _pc?.primaryTexts?.filter((p: string) => p.trim()) || []
    const pcHasContent = pcHeadlines.length > 0 || pcPrimaryTexts.length > 0 || !!_pc?.description?.trim() || !!_pc?.websiteUrl?.trim()
    const perCreative = pcHasContent ? _pc : undefined
    const title = pcHeadlines.length
      ? pcHeadlines[i % pcHeadlines.length]
      : (textOverride?.headlines?.length
          ? textOverride.headlines[i % textOverride.headlines.length]
          : creative.headline || "")
    const body = pcPrimaryTexts.length
      ? pcPrimaryTexts[i % pcPrimaryTexts.length]
      : (textOverride?.primaryTexts?.length
          ? textOverride.primaryTexts[i % textOverride.primaryTexts.length]
          : creative.primary_text || "")
    const description = perCreative?.description?.trim() ? perCreative.description : (textOverride ? textOverride.description : creative.description || "")
    const cta = perCreative ? perCreative.cta : (textOverride ? textOverride.cta : creative.cta || "LEARN_MORE")
    const rawUrl = perCreative?.websiteUrl?.trim() ? perCreative.websiteUrl : (textOverride?.websiteUrl || creative.link_url || globalWebsiteUrl || "")
    const link_url = appendUtm(rawUrl, utmQuery)
    const display_url = perCreative?.displayUrl?.trim() ? perCreative.displayUrl : (textOverride?.displayUrl?.trim() ? textOverride.displayUrl : (globalDisplayUrl || undefined))
    if (!link_url) {
      errors.push({ creativeId: creative.id, error: "Website URL is required. Add a URL in Ad Text Options → Website URL, or edit the creative to add a link." })
      return { results, errors }
    }
    const isValidUrl = /^https?:\/\/.+/.test(link_url)
    if (!isValidUrl) {
      errors.push({ creativeId: creative.id, error: `Invalid URL "${link_url}" — must start with http:// or https://` })
      return { results, errors }
    }

    const allTitles = Array.from(new Set([title, ...pcHeadlines, ...(textOverride?.headlines || [])].map((s: string) => s.trim()).filter(Boolean)))
    const allBodies = Array.from(new Set([body, ...pcPrimaryTexts, ...(textOverride?.primaryTexts || [])].map((s: string) => s.trim()).filter(Boolean)))
    const allDescs = Array.from(new Set([description].map((s: string) => s.trim()).filter(Boolean)))

    // Multiple Text Options (MTO): all text variations ride on ONE ad via asset_feed_spec with
    // optimization_type DEGREES_OF_FREEDOM (handled in createAd). The ad set stays standard —
    // no is_dynamic_creative, no 1-ad limit — and Meta optimizes text delivery per impression.
    const hasVariations = allTitles.length > 1 || allBodies.length > 1 || allDescs.length > 1

    let thumbnailUrl: string | undefined = creative.fb_thumbnail_url || undefined
    try {
      // Facebook v25 requires a current image_url in video_data.
      if (creative.fb_video_id && !isFreshThumbnailUrl(thumbnailUrl)) {
        thumbnailUrl = (await getVideoThumbnail(creative.fb_video_id, token, { skipProof: tokenOpts?.isManual })) || undefined
        if (thumbnailUrl) {
          await supabase.from("creatives").update({ fb_thumbnail_url: thumbnailUrl }).eq("id", creative.id)
        }
      }
    } catch (err: any) {
      errors.push({ creativeId: creative.id, error: `Thumbnail fetch failed: ${err.message}` })
    }

    const baseAdName = resolveName(baseName, startIndex + i)
    try {
      const ad = await createAd(adAccountId, token, {
        name: baseAdName,
        adset_id: adsetId,
        page_id: pageId,
        image_hash: creative.fb_image_hash || undefined,
        video_id: creative.fb_video_id || undefined,
        thumbnail_url: thumbnailUrl,
        title: allTitles[0] || title,
        body: allBodies[0] || body,
        description: allDescs[0] || description,
        cta,
        link_url,
        display_url,
        status: adStatus,
        text_variations: hasVariations
          ? { bodies: allBodies.length ? allBodies : [body], titles: allTitles.length ? allTitles : [title], descriptions: allDescs }
          : undefined,
      }, tokenOpts)
      await supabase.from("creatives").update({ fb_ad_id: ad.id }).eq("id", creative.id)
      results.push({
        creativeId: creative.id,
        adId: ad.id,
        adName: baseAdName,
        fileName: creative.file_name,
        adSetId: adsetId,
        thumbnailUrl: thumbnailUrl || creative.fb_thumbnail_url || creative.fb_image_url || creative.file_url || null,
        mediaType: creative.media_type || "image",
      })
    } catch (err: any) {
      errors.push({ creativeId: creative.id, error: err.message })
    }
    return { results, errors }
  })
  return {
    results: outcomes.flatMap(outcome => outcome.results),
    errors: outcomes.flatMap(outcome => outcome.errors),
  }
}

export async function POST(request: NextRequest) {
  try {
    const launchStartedAt = Date.now()
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const denied = requireRole(ctx)
    if (denied) return denied
    const authCtx = ctx

    const body = await request.json()
    const requestedId = body.adAccountId
    const supabase = createAdminClient()
    let adAccountId = requestedId

    if (!adAccountId) {
      const { data: firstAccount } = await supabase
        .from("ad_accounts")
        .select("fb_ad_account_id")
        .eq("org_id", ctx.orgId)
        .limit(1)
        .maybeSingle()
      if (!firstAccount?.fb_ad_account_id) {
        return NextResponse.json({ error: "No ad account found" }, { status: 400 })
      }
      adAccountId = firstAccount.fb_ad_account_id
    }

    // Via MECE: launch = WRITE → via launch của account → OAuth → block (VIA-MASTER.md)
    let connection
    try {
      connection = await getConnectionForAdAccount(ctx.orgId, adAccountId, "write")
    } catch (err) {
      if (err instanceof MissingViaError) {
        return NextResponse.json({ error: err.message, code: "MISSING_LAUNCH_VIA" }, { status: 400 })
      }
      throw err
    }
    if (!connection) return NextResponse.json({ error: "Facebook not connected" }, { status: 400 })

    if (!(await adAccountBelongsToOrg(ctx.orgId, adAccountId, connection.access_token))) {
      return NextResponse.json({ error: "Ad account not found or not authorized" }, { status: 403 })
    }

    const token = connection.access_token
    const tokenOpts = { isManual: isManual(connection) }

    const {
      templateAdId, presetId, creativeIds,
      campaignOption,         // "existing" | "new" | "multiple"
      existingCampaignId, newCampaignName,
      multipleCampaignNames, creativeDistribution,
      adsetMode,              // "existing" | "new" | "per_creative" | "auto_divide" | "custom"
      existingAdsetId, newAdsetName,
      adsetNamePattern, autoDividePattern, adsPerAdset,
      adsetDailyBudget,
      customConfig,           // CampaignConfig[] khi adsetMode = "custom"
      useCustomAdName, adNamePattern: adNamePatternBody, filenameTransform,
      useCommonText, commonHeadlines, commonPrimaryTexts, commonDescription, commonCta, commonWebsiteUrl, commonDisplayUrl,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
      useUniqueTextPerAdset, adsetTextConfigs,
      useUniqueTextPerCreative, creativeTextConfigs,
      useMetaDefaults, imageEnhancements, videoEnhancements,
      createPaused, startTime,
      pageId,
      pixelId, pixelEvent,
    } = body

    const creativeTextMap: Map<string, any> = new Map(
      useUniqueTextPerCreative ? (creativeTextConfigs || []).map((c: any) => [c.creativeId, c]) : []
    )

    const utmQuery = [
      utmSource && `utm_source=${encodeURIComponent(utmSource)}`,
      utmMedium && `utm_medium=${encodeURIComponent(utmMedium)}`,
      utmCampaign && `utm_campaign=${encodeURIComponent(utmCampaign)}`,
      utmContent && `utm_content=${encodeURIComponent(utmContent)}`,
      utmTerm && `utm_term=${encodeURIComponent(utmTerm)}`,
    ].filter(Boolean).join("&")

    const globalWebsiteUrl: string = commonWebsiteUrl || ""
    const globalDisplayUrl: string = commonDisplayUrl || ""

    const textOverride: TextOverride | undefined = useCommonText ? {
      headlines: (commonHeadlines || []).filter((h: string) => h.trim()),
      primaryTexts: (commonPrimaryTexts || []).filter((p: string) => p.trim()),
      description: commonDescription || "",
      cta: commonCta || "LEARN_MORE",
      websiteUrl: commonWebsiteUrl || "",
      displayUrl: commonDisplayUrl || "",
    } : undefined

    const getAdsetTextOverride = (adsetIndex: number): TextOverride | undefined => {
      if (!useUniqueTextPerAdset || !adsetTextConfigs?.length) return undefined
      const cfg = adsetTextConfigs[adsetIndex]
      if (!cfg) return undefined
      return {
        headlines: (cfg.headlines || []).filter((h: string) => h.trim()),
        primaryTexts: (cfg.primaryTexts || []).filter((p: string) => p.trim()),
        description: cfg.description || "",
        cta: cfg.cta || "LEARN_MORE",
        websiteUrl: cfg.websiteUrl || "",
        displayUrl: cfg.displayUrl || "",
      }
    }

    const adStatus = createPaused === false ? "ACTIVE" : "PAUSED"

    if (!templateAdId && !presetId) {
      return NextResponse.json({ error: "templateAdId or presetId is required" }, { status: 400 })
    }
    if (!creativeIds?.length) {
      return NextResponse.json({ error: "creativeIds are required" }, { status: 400 })
    }
    if (!pageId) {
      return NextResponse.json({ error: "No Facebook Page selected. Please select a Page before launching." }, { status: 400 })
    }
    const isCreatingNewCampaign = campaignOption === "new" || campaignOption === "multiple" || adsetMode === "custom"
    if (isCreatingNewCampaign && !adsetDailyBudget) {
      return NextResponse.json({ error: "Daily budget is required when creating a new campaign." }, { status: 400 })
    }

    const hasTextVariations = (() => {
      if (textOverride && (textOverride.headlines.length > 1 || textOverride.primaryTexts.length > 1)) return true
      for (const c of creativeTextConfigs || []) {
        const h = (c.headlines || []).filter((s: string) => s.trim()).length
        const p = (c.primaryTexts || []).filter((s: string) => s.trim()).length
        if (h > 1 || p > 1) return true
      }
      return false
    })()

    // Option B (Manual Split): variations are NEVER sent to Meta as asset_feed_spec/Dynamic Creative.
    // Instead each text combination becomes its own standard static ad (see createAdsInAdset).
    // This keeps ad sets standard, has no 1-ad/ad-set limit, and shows each combo as a distinct ad
    // in Ads Manager — at the cost of losing Meta's auto-mix optimization across text.
    const effectiveAdsetMode = adsetMode

    const today = new Date()
    const dateStr = `${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}/${today.getFullYear()}`
    const shortDateStr = `${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`

    const resolveAdName = (baseName: string, index: number): string => {
      if (!useCustomAdName || !adNamePatternBody) return baseName
      let fname = baseName
      switch (filenameTransform) {
        case "title_case": fname = fname.replace(/[_-]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()); break
        case "uppercase": fname = fname.toUpperCase(); break
        case "lowercase": fname = fname.toLowerCase(); break
        case "clean": fname = fname.replace(/[^a-zA-Z0-9\s]/g, "").trim(); break
        case "split": fname = fname.replace(/[_-]/g, " "); break
      }
      return adNamePatternBody
        .replace(/\{filename\}/g, fname)
        .replace(/\{index:001\}/g, String(index).padStart(3, "0"))
        .replace(/\{index:01\}/g, String(index).padStart(2, "0"))
        .replace(/\{index\}/g, String(index))
        .replace(/\{date:short\}/g, shortDateStr)
        .replace(/\{date\}/g, dateStr)
    }

    let template: any
    if (presetId) {
      const adminDb = createAdminClient()
      const { data: preset, error: presetErr } = await adminDb
        .from("ad_set_presets")
        .select("*")
        .eq("id", presetId)
        .eq("org_id", ctx.orgId)
        .single()
      if (presetErr || !preset) return NextResponse.json({ error: "Preset not found" }, { status: 404 })
      template = {
        adset: {
          targeting: preset.targeting || {},
          optimization_goal: preset.optimization_goal,
          billing_event: preset.billing_event,
          bid_strategy: preset.bid_strategy,
          bid_amount: preset.bid_amount,
          daily_budget: undefined,
          lifetime_budget: undefined,
          id: null,
          campaign_id: null,
          name: preset.adset_name || preset.name,
        },
        campaign: {
          objective: preset.objective,
          special_ad_categories: preset.special_ad_categories || [],
          name: preset.campaign_name || preset.name,
        },
      }
    } else {
      template = await getAdDetails(templateAdId, token, tokenOpts)
      const templateAcct = await getResourceAccountId(templateAdId, token, tokenOpts)
      if (templateAcct && templateAcct !== normalizeAdAccountId(adAccountId)) {
        return NextResponse.json({ error: "Template ad does not belong to the selected ad account. Choose a template in the same account." }, { status: 400 })
      }
    }

    const existingCampaignToCheck = existingCampaignId || template?.adset?.campaign_id
    if (existingCampaignToCheck) {
      const campAcct = await getResourceAccountId(existingCampaignToCheck, token, tokenOpts)
      if (campAcct && campAcct !== normalizeAdAccountId(adAccountId)) {
        return NextResponse.json({ error: "Campaign does not belong to the selected ad account." }, { status: 400 })
      }
    }
    if (existingAdsetId) {
      const adsetAcct = await getResourceAccountId(existingAdsetId, token, tokenOpts)
      if (adsetAcct && adsetAcct !== normalizeAdAccountId(adAccountId)) {
        return NextResponse.json({ error: "Ad set does not belong to the selected ad account." }, { status: 400 })
      }
    }
    const { data: creatives } = await supabase.from("creatives").select("*").in("id", creativeIds).eq("org_id", ctx.orgId)
    if (!creatives?.length) return NextResponse.json({ error: "No creatives found" }, { status: 400 })

    const launchCreatives = creatives as any[]

    try {
      launchCreatives.forEach(assertLaunchable)
    } catch (err: any) {
      if (err.name === "CreativeNotReadyError") {
        return NextResponse.json({
          error: err.message,
          creativeIds: [err.creative.id],
        }, { status: 400 })
      }
      throw err
    }

    const allResults: any[] = []
    const allErrors: any[] = []
    const launchedAdsets = new Map<string, string>()

    // Map legacy campaign objectives to v25 OUTCOME_* equivalents
    const LEGACY_OBJECTIVE_MAP: Record<string, string> = {
      PAGE_LIKES: "OUTCOME_ENGAGEMENT",
      POST_ENGAGEMENT: "OUTCOME_ENGAGEMENT",
      EVENT_RESPONSES: "OUTCOME_ENGAGEMENT",
      VIDEO_VIEWS: "OUTCOME_ENGAGEMENT",
      MESSAGES: "OUTCOME_ENGAGEMENT",
      REACH: "OUTCOME_AWARENESS",
      BRAND_AWARENESS: "OUTCOME_AWARENESS",
      LINK_CLICKS: "OUTCOME_TRAFFIC",
      LEAD_GENERATION: "OUTCOME_LEADS",
      CONVERSIONS: "OUTCOME_SALES",
      PRODUCT_CATALOG_SALES: "OUTCOME_SALES",
      CATALOG_SALES: "OUTCOME_SALES",
      STORE_TRAFFIC: "OUTCOME_SALES",
      APP_INSTALLS: "OUTCOME_APP_PROMOTION",
    }
    const resolvedObjective = LEGACY_OBJECTIVE_MAP[template.campaign.objective] ?? template.campaign.objective

    // Detect whether the template uses CBO (budget at campaign level) or non-CBO (budget at adset level)
    const isCBO = !!template.campaign.daily_budget
    // For CBO: budget goes to campaign; adsets have no budget
    // For non-CBO: campaign has is_adset_budget_sharing_enabled=false; budget goes to adsets
    const campaignDailyBudget = isCBO ? adsetDailyBudget : undefined
    const campaignBidStrategy = isCBO ? (template.campaign.bid_strategy || "LOWEST_COST_WITHOUT_CAP") : undefined
    const adsetBudgetAmount = isCBO ? undefined : adsetDailyBudget

    // Resolve adset for a given campaignId
    async function resolveAdset(campaignId: string, creativeSubset: any[], index = 1) {
      if (effectiveAdsetMode === "existing") {
        const adsetId = existingAdsetId || template.adset.id
        if (adsetId) launchedAdsets.set(adsetId, template.adset.name || adsetId)
        return adsetId
      }
      if (effectiveAdsetMode === "new") {
        const name = newAdsetName || template.adset.name
        const s = await buildAdset(adAccountId, token, template, campaignId, name, adsetBudgetAmount, startTime, pageId, resolvedObjective, pixelId, pixelEvent, adStatus, tokenOpts)
        launchedAdsets.set(s.id, name || s.id)
        return s.id
      }
      if (effectiveAdsetMode === "per_creative") {
        return null
      }
      if (effectiveAdsetMode === "auto_divide") {
        const name = applyPattern(autoDividePattern || "Ad Set {index:01}", { index, date: dateStr, shortDate: shortDateStr })
        const s = await buildAdset(adAccountId, token, template, campaignId, name, adsetBudgetAmount, startTime, pageId, resolvedObjective, pixelId, pixelEvent, adStatus, tokenOpts)
        launchedAdsets.set(s.id, name)
        return s.id
      }
    }

    let batchId: string | undefined
    let auditError: string | null = null
    async function saveLaunchBatch() {
      const status = allErrors.length === 0 ? "success" : allResults.length > 0 ? "partial" : "failed"
      const creativeThumbs = launchCreatives
        .map((c: any) => c.fb_thumbnail_url || c.fb_image_url || c.file_url || null)
        .filter(Boolean)
      const adsetIds = [...new Set([
        ...Array.from(launchedAdsets.keys()),
        ...allResults.map((r: any) => r.adSetId).filter(Boolean),
      ])] as string[]
      const adsetNames = adsetIds.map((id) => launchedAdsets.get(id) || id)
      const userName = authCtx.user.full_name || authCtx.user.email?.split("@")[0] || "Unknown"
      const { data: savedAccount } = await supabase
        .from("ad_accounts")
        .select("name")
        .eq("org_id", authCtx.orgId)
        .eq("fb_ad_account_id", adAccountId)
        .maybeSingle()

      const { data, error } = await supabase.from("launch_batches").insert({
        org_id: authCtx.orgId,
        user_id: authCtx.user.id,
        user_name: userName,
        ad_account_id: adAccountId,
        ad_account_name: savedAccount?.name || adAccountId,
        adset_ids: adsetIds,
        adset_names: adsetNames,
        creative_ids: creativeIds,
        creative_thumbs: creativeThumbs,
        primary_text: textOverride?.primaryTexts?.join("\n") || null,
        headline: textOverride?.headlines?.join("\n") || null,
        cta: textOverride?.cta || commonCta || null,
        web_link: textOverride?.websiteUrl || commonWebsiteUrl || null,
        page_id: pageId || null,
        status,
        total_ads: allResults.length,
        failed_ads: allErrors.length,
        duration_ms: Date.now() - launchStartedAt,
        errors: allErrors,
        created_ads: allResults.map((r: any) => ({
          adId: r.adId,
          adSetId: r.adSetId,
          adSetName: r.adSetId ? launchedAdsets.get(r.adSetId) || r.adSetId : undefined,
          creativeId: r.creativeId,
          fileName: r.fileName,
          thumbnailUrl: r.thumbnailUrl || null,
          mediaType: r.mediaType || "image",
        })),
      }).select("id").single()
      if (error) {
        console.error("[launch] Failed to save launch batch:", error)
        auditError = `Ads were created in Meta, but Launch History could not be saved: ${error.message}`
      } else {
        batchId = data?.id
        auditError = null
      }

      // This route wrote a batch row but never told anybody — the two other launch
      // routes did. Emitting here covers both exits (custom config and the normal
      // campaign loop) because both go through saveLaunchBatch.
      void notifyLaunchOutcome({
        orgId: authCtx.orgId,
        actorId: authCtx.user.id,
        actorName: userName,
        batchId: batchId ?? null,
        adAccountName: savedAccount?.name || adAccountId,
        targetName: adsetNames[0] || null,
        created: allResults.length,
        failed: allErrors.length,
        source: "launch",
      })
    }

    // Custom config mode: bypass normal campaign loop entirely
    if (adsetMode === "custom") {
      if (!customConfig?.length) {
        return NextResponse.json({ error: "Custom config is empty" }, { status: 400 })
      }
      let globalIdx = 1
      let adsetCounter = 0
      for (const campConfig of customConfig) {
        const camp = await createCampaign(adAccountId, token, {
          name: campConfig.name,
          objective: resolvedObjective,
          special_ad_categories: template.campaign.special_ad_categories || [],
          status: adStatus,
          daily_budget: campaignDailyBudget,
          bid_strategy: campaignBidStrategy,
        }, tokenOpts)
        for (const adsetConfig of campConfig.adsets) {
          if (!adsetConfig.creativeIds?.length) continue
          const adset = await buildAdset(adAccountId, token, template, camp.id, adsetConfig.name, adsetBudgetAmount, startTime, pageId, resolvedObjective, pixelId, pixelEvent, adStatus, tokenOpts)
          launchedAdsets.set(adset.id, adsetConfig.name)
          const adsetCreatives = creatives.filter((c: any) => adsetConfig.creativeIds.includes(c.id))
          const override = textOverride ?? getAdsetTextOverride(adsetCounter++)
          const { results, errors } = await createAdsInAdset(adset.id, adsetCreatives, adAccountId, token, pageId, supabase, resolveAdName, globalIdx, override, creativeTextMap, adStatus, utmQuery, globalWebsiteUrl, globalDisplayUrl, tokenOpts)
          globalIdx += adsetCreatives.length
          allResults.push(...results)
          allErrors.push(...errors)
        }
      }
      await saveLaunchBatch()
      if (allResults.length > 0) {
        await invalidateMetaReadCacheAfterWrite({ orgId: ctx.orgId, adAccountId, objectIds: allResults.map((item: any) => item.adId).filter(Boolean) })
      }
      return NextResponse.json({
        success: true, created: allResults, errors: allErrors,
        summary: `${allResults.length} ads created, ${allErrors.length} failed`,
        adManagerUrl: `/ads-manager?batch=${batchId || ""}`,
        batchId,
        auditError,
      })
    }

    // Resolve campaign(s)
    const campaignIds: string[] = []
    if (campaignOption === "multiple") {
      for (const name of (multipleCampaignNames || []).filter((n: string) => n.trim())) {
        const c = await createCampaign(adAccountId, token, {
          name, objective: resolvedObjective,
          special_ad_categories: template.campaign.special_ad_categories || [],
          status: adStatus,
          daily_budget: campaignDailyBudget,
          bid_strategy: campaignBidStrategy,
        }, tokenOpts)
        campaignIds.push(c.id)
      }
    } else if (campaignOption === "new") {
      const c = await createCampaign(adAccountId, token, {
        name: newCampaignName || template.campaign.name,
        objective: resolvedObjective,
        special_ad_categories: template.campaign.special_ad_categories || [],
        status: adStatus,
        daily_budget: campaignDailyBudget,
        bid_strategy: campaignBidStrategy,
      }, tokenOpts)
      campaignIds.push(c.id)
    } else {
      campaignIds.push(existingCampaignId || template.adset.campaign_id)
    }

    let adsetCounter = 0
    for (let ci = 0; ci < campaignIds.length; ci++) {
      const campaignId = campaignIds[ci]

      // Which creatives go to this campaign
      let campaignCreatives = creatives
      if (campaignOption === "multiple" && creativeDistribution === "split") {
        const chunkSize = Math.ceil(creatives.length / campaignIds.length)
        campaignCreatives = creatives.slice(ci * chunkSize, (ci + 1) * chunkSize)
      }

      if (effectiveAdsetMode === "per_creative") {
        // 1 ad set per creative
        for (let i = 0; i < campaignCreatives.length; i++) {
          const creative = campaignCreatives[i]
          const filename = creative.file_name.replace(/\.[^/.]+$/, "")
          const name = applyPattern(adsetNamePattern || "{filename}", { filename, index: i + 1, date: dateStr, shortDate: shortDateStr })
          const adset = await buildAdset(adAccountId, token, template, campaignId, name, adsetBudgetAmount, startTime, pageId, resolvedObjective, pixelId, pixelEvent, adStatus, tokenOpts)
          launchedAdsets.set(adset.id, name)
          const override = textOverride ?? getAdsetTextOverride(adsetCounter++)
          const { results, errors } = await createAdsInAdset(adset.id, [creative], adAccountId, token, pageId, supabase, resolveAdName, i + 1, override, creativeTextMap, adStatus, utmQuery, globalWebsiteUrl, globalDisplayUrl, tokenOpts)
          allResults.push(...results)
          allErrors.push(...errors)
        }
      } else if (effectiveAdsetMode === "auto_divide") {
        // chunk creatives into groups of N
        const chunkSize = adsPerAdset || 5
        const chunks: any[][] = []
        for (let i = 0; i < campaignCreatives.length; i += chunkSize) {
          chunks.push(campaignCreatives.slice(i, i + chunkSize))
        }
        let globalIdx = 1
        for (let i = 0; i < chunks.length; i++) {
          const adsetId = await resolveAdset(campaignId, chunks[i], i + 1)
          const override = textOverride ?? getAdsetTextOverride(adsetCounter++)
          const { results, errors } = await createAdsInAdset(adsetId!, chunks[i], adAccountId, token, pageId, supabase, resolveAdName, globalIdx, override, creativeTextMap, adStatus, utmQuery, globalWebsiteUrl, globalDisplayUrl, tokenOpts)
          globalIdx += chunks[i].length
          allResults.push(...results)
          allErrors.push(...errors)
        }
      } else {
        const adsetId = await resolveAdset(campaignId, campaignCreatives)
        if (adsetId) launchedAdsets.set(adsetId, launchedAdsets.get(adsetId) || template.adset.name || adsetId)
        const override = textOverride ?? getAdsetTextOverride(adsetCounter++)
        const { results, errors } = await createAdsInAdset(adsetId!, campaignCreatives, adAccountId, token, pageId, supabase, resolveAdName, 1, override, creativeTextMap, adStatus, utmQuery, globalWebsiteUrl, globalDisplayUrl, tokenOpts)
        allResults.push(...results)
        allErrors.push(...errors)
      }
    }

    await saveLaunchBatch()
    if (allResults.length > 0) {
      await invalidateMetaReadCacheAfterWrite({ orgId: ctx.orgId, adAccountId, objectIds: allResults.map((item: any) => item.adId).filter(Boolean) })
    }
    return NextResponse.json({
      success: true,
      created: allResults,
      errors: allErrors,
      summary: `${allResults.length} ads created, ${allErrors.length} failed`,
      adManagerUrl: `/ads-manager?batch=${batchId || ""}`,
      batchId,
      auditError,
    })
  } catch (err: any) {
    console.error("Launch error:", err)
    return NextResponse.json({ error: err.message || "Launch failed" }, { status: 500 })
  }
}
