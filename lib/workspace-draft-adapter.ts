/**
 * The bridge that lets the Ads Manager editor be the *only* editing surface (BL-64).
 *
 * A new campaign has no Meta ids, so it cannot be a normal editor draft. Rather than give the
 * editor a second state model, the create flow's `CampaignFormState` stays the single source of
 * truth and the wire format for `POST /api/facebook/create-campaign` — that route keeps its auth,
 * org scoping, Via LAUNCH resolution, ODAX validation, rollback and `launch_batches` insert
 * untouched. This module renders that state *as* three `WorkspaceNode`s for the editor, and folds
 * the editor's per-node edits back into it.
 *
 * Two invariants the tests hold:
 *
 *  1. **Round trip is lossless.** `apply(apply(apply(state, nodes)))` === `state`. A field that
 *     survives the trip out but not the trip back is a field the user edits and Meta never sees —
 *     the exact defect class TD-38 was (`create-campaign/route.ts` silently dropping eight
 *     targeting fields).
 *  2. **The mapping is total.** `FIELD_OWNER` names every key of `CampaignFormState`, so adding a
 *     field to the form without deciding which node owns it is a type error, not a silent drop.
 *
 * Units: the form holds human strings ("100", "1.5"); Meta and `WorkspaceNode` hold minor units
 * (budget/bid ×100, ROAS floor ×10000). Conversion happens here and nowhere else.
 */

import { resolveOdaxRow } from "@/lib/odax-matrix"
import { isBidStrategy } from "@/lib/create-campaign-bidding"
import type { BidStrategy } from "@/lib/create-campaign-bidding"
import type { WorkspaceNode } from "@/components/ads-manager/UnifiedWorkspaceEditor"
import type {
  AdvertiserEntity,
  AttributionClickDays,
  AttributionEngagedViewDays,
  AttributionViewDays,
  CampaignFormState,
  ConversionEvent,
  GenderTargeting,
  MediaType,
  PlacementMode,
  PublisherPlatform,
  TargetingOption,
} from "@/components/ads-manager/create-flow/types"

export type DraftLevel = "campaign" | "adset" | "ad"

/**
 * Synthetic ids for the unpublished hierarchy. They are deliberately not Meta-shaped (Meta ids are
 * all digits) so a draft node can never be mistaken for a live object by a route that takes an id.
 */
export const DRAFT_IDS = {
  campaign: "draft:campaign",
  adset: "draft:adset",
  ad: "draft:ad",
} as const

export function isDraftId(id: string | undefined | null): boolean {
  return typeof id === "string" && id.startsWith("draft:")
}

export type DraftHierarchy = {
  campaign: WorkspaceNode
  adset: WorkspaceNode
  ad: WorkspaceNode
}

/**
 * Which node owns each form field. Exhaustive by construction — `Record<keyof CampaignFormState, …>`
 * fails to compile when a field is added to the form and not placed here.
 *
 * `"gate"` = decided before the editor opens (objective, setup scope) and rendered read-only, the
 * way Meta locks objective and buying type after create.
 */
export const FIELD_OWNER: Record<keyof CampaignFormState, DraftLevel | "gate"> = {
  existingCampaignId: "gate",
  existingCampaignName: "gate",
  objective: "gate",
  campaignName: "campaign",
  specialAdCategories: "campaign",
  advantageCampaignBudget: "campaign",
  campaignBudget: "campaign",
  // One form field, two homes: the strategy sits on the campaign under CBO and on the ad set under
  // ABO, because that is where Meta accepts it. The *value* it caps always sits on the ad set.
  campaignBidStrategy: "campaign",

  adSetName: "adset",
  conversionLocation: "adset",
  engagementType: "adset",
  performanceGoal: "adset",
  pixelId: "adset",
  conversionEvent: "adset",
  costPerResultGoal: "adset",
  roasGoal: "adset",
  attributionClickDays: "adset",
  attributionViewDays: "adset",
  attributionEngagedViewDays: "adset",
  dailyBudget: "adset",
  scheduleStart: "adset",
  scheduleEnd: "adset",
  scheduleTimeBasis: "adset",
  locations: "adset",
  ageMin: "adset",
  ageMax: "adset",
  gender: "adset",
  customAudiences: "adset",
  excludedCustomAudiences: "adset",
  detailedTargeting: "adset",
  targetingExpansion: "adset",
  placementMode: "adset",
  publisherPlatforms: "adset",
  advertiser: "adset",
  payer: "adset",

  adName: "ad",
  pageId: "ad",
  instagramId: "ad",
  creativeId: "ad",
  creativeFileName: "ad",
  creativePreviewUrl: "ad",
  mediaUrl: "ad",
  mediaType: "ad",
  creativeIds: "ad",
  selectedCreatives: "ad",
  oneAdPerAdset: "ad",
  primaryText: "ad",
  primaryTextVariations: "ad",
  headline: "ad",
  headlineVariations: "ad",
  description: "ad",
  descriptionVariations: "ad",
  callToAction: "ad",
  destinationUrl: "ad",
  urlParameters: "ad",
}

// ---------------------------------------------------------------------------- units

/** "12.34" → "1234". Empty or unparseable → "" so an untouched field stays untouched. */
export function toMinorUnits(value: string): string {
  if (!value.trim()) return ""
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return ""
  return String(Math.round(parsed * 100))
}

/** "1234" → "12.34", trimming the trailing ".00" the form never shows. */
export function fromMinorUnits(value: string | undefined): string {
  if (!value) return ""
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return ""
  const major = parsed / 100
  return Number.isInteger(major) ? String(major) : major.toFixed(2)
}

const capStrategies = new Set<BidStrategy>(["COST_CAP", "LOWEST_COST_WITH_BID_CAP"])

function genderCodes(gender: GenderTargeting): number[] | undefined {
  if (gender === "MALE") return [1]
  if (gender === "FEMALE") return [2]
  return undefined
}

function genderFromCodes(codes: number[] | undefined): GenderTargeting {
  if (codes?.[0] === 1) return "MALE"
  if (codes?.[0] === 2) return "FEMALE"
  return "ALL"
}

/**
 * Meta returns detailed targeting as `flexible_spec: [{ interests: [...] }]`. The form holds a flat
 * list because the create flow only ever produces one OR-group.
 */
function toFlexibleSpec(options: TargetingOption[]): unknown[] | undefined {
  if (options.length === 0) return undefined
  return [{ interests: options.map(option => ({ id: option.id, name: option.name })) }]
}

function fromFlexibleSpec(spec: unknown[] | undefined): TargetingOption[] {
  const first = spec?.[0] as { interests?: TargetingOption[] } | undefined
  return (first?.interests || []).map(option => ({ id: option.id, name: option.name }))
}

function attributionSpec(state: CampaignFormState): { event_type: string; window_days: number }[] {
  const spec = [{ event_type: "CLICK_THROUGH", window_days: Number(state.attributionClickDays) }]
  if (state.attributionViewDays !== "0") {
    spec.push({ event_type: "VIEW_THROUGH", window_days: Number(state.attributionViewDays) })
  }
  if (state.attributionEngagedViewDays !== "0") {
    spec.push({ event_type: "ENGAGED_VIDEO_VIEW", window_days: Number(state.attributionEngagedViewDays) })
  }
  return spec
}

function windowDays(
  spec: { event_type: string; window_days: number }[] | undefined,
  eventType: string
): string {
  const match = spec?.find(entry => entry.event_type === eventType)
  return match ? String(match.window_days) : "0"
}

// ---------------------------------------------------------------------------- form → nodes

export function formStateToDraftNodes(state: CampaignFormState): DraftHierarchy {
  const cbo = state.advantageCampaignBudget
  const strategy: BidStrategy = isBidStrategy(state.campaignBidStrategy)
    ? state.campaignBidStrategy
    : "LOWEST_COST_WITHOUT_CAP"
  const row = resolveOdaxRow(state.objective, state.conversionLocation, state.engagementType)

  const campaign: WorkspaceNode = {
    id: DRAFT_IDS.campaign,
    // Attach scope: the campaign belongs to Meta already, so its name is the existing one and the
    // editor renders the whole campaign node read-only.
    name: state.existingCampaignId ? state.existingCampaignName : state.campaignName,
    status: "PAUSED",
    objective: state.objective,
    buying_type: "AUCTION",
    special_ad_categories: state.specialAdCategories,
    daily_budget: cbo ? toMinorUnits(state.campaignBudget) : undefined,
    bid_strategy: cbo ? strategy : undefined,
    draft_of: state.existingCampaignId || undefined,
  }

  const adset: WorkspaceNode = {
    id: DRAFT_IDS.adset,
    campaign_id: state.existingCampaignId || DRAFT_IDS.campaign,
    name: state.adSetName,
    status: "PAUSED",
    daily_budget: cbo ? undefined : toMinorUnits(state.dailyBudget),
    conversion_location: state.conversionLocation || undefined,
    engagement_type: state.engagementType || undefined,
    destination_type: row?.destinationType,
    optimization_goal: state.performanceGoal,
    bid_strategy: cbo ? undefined : strategy,
    // The cap value lives on the ad set at every budget mode — Meta has no campaign-level
    // `bid_amount`. Under CBO the campaign owns the strategy and the ad set owns its number.
    bid_amount: capStrategies.has(strategy) ? toMinorUnits(state.costPerResultGoal) : undefined,
    bid_constraints:
      strategy === "LOWEST_COST_WITH_MIN_ROAS" && state.roasGoal.trim()
        ? { roas_average_floor: Math.round(Number.parseFloat(state.roasGoal) * 10000) }
        : undefined,
    promoted_object: state.pixelId
      ? { pixel_id: state.pixelId, custom_event_type: state.conversionEvent }
      : undefined,
    attribution_spec: attributionSpec(state),
    start_time: state.scheduleStart || undefined,
    stop_time: state.scheduleEnd || undefined,
    schedule_time_basis: state.scheduleTimeBasis,
    targeting: {
      geo_locations: { countries: state.locations },
      age_min: state.ageMin,
      age_max: state.ageMax,
      genders: genderCodes(state.gender),
      custom_audiences: state.customAudiences,
      excluded_custom_audiences: state.excludedCustomAudiences,
      flexible_spec: toFlexibleSpec(state.detailedTargeting),
      // Meta reports audience expansion as `targeting_optimization` on read; the create path sends
      // `targeting_automation.advantage_audience`. The editor reads the former, so emit that.
      targeting_optimization: state.targetingExpansion ? "expansion_all" : "none",
      // Advantage+ placements means "let Meta choose", which is what an absent key already says.
      publisher_platforms: state.placementMode === "manual" ? state.publisherPlatforms : undefined,
    },
    advertiser: state.advertiser,
    payer: state.payer,
  }

  const ad: WorkspaceNode = {
    id: DRAFT_IDS.ad,
    campaign_id: state.existingCampaignId || DRAFT_IDS.campaign,
    adset_id: DRAFT_IDS.adset,
    name: state.adName,
    status: "PAUSED",
    page_id: state.pageId,
    instagram_id: state.instagramId || undefined,
    portal_creative_id: state.creativeId || undefined,
    creative_ids: state.creativeIds,
    selected_creatives: state.selectedCreatives,
    creative_file_name: state.creativeFileName || undefined,
    thumb_url: state.creativePreviewUrl || undefined,
    media_url: state.mediaUrl || undefined,
    media_type: state.mediaType,
    one_ad_per_adset: state.oneAdPerAdset,
    primaryText: state.primaryText,
    primary_text_variations: state.primaryTextVariations,
    headline: state.headline,
    headline_variations: state.headlineVariations,
    description: state.description,
    description_variations: state.descriptionVariations,
    cta: state.callToAction,
    link: state.destinationUrl,
    url_parameters: state.urlParameters || undefined,
  }

  return { campaign, adset, ad }
}

// ---------------------------------------------------------------------------- node → form

/**
 * Fold one edited node back into the form state. Called per `onDraftChange` from the editor, so it
 * must be pure and must touch only the fields `FIELD_OWNER` assigns to that level — otherwise
 * editing the ad set would reset the ad.
 */
export function applyDraftNode(
  state: CampaignFormState,
  node: WorkspaceNode,
  level: DraftLevel
): CampaignFormState {
  if (level === "campaign") return applyCampaign(state, node)
  if (level === "adset") return applyAdSet(state, node)
  return applyAd(state, node)
}

function applyCampaign(state: CampaignFormState, node: WorkspaceNode): CampaignFormState {
  const cbo = node.daily_budget != null && node.daily_budget !== ""
  const strategy = isBidStrategy(node.bid_strategy) ? node.bid_strategy : state.campaignBidStrategy
  return {
    ...state,
    ...(state.existingCampaignId ? {} : { campaignName: node.name }),
    specialAdCategories: (node.special_ad_categories || []) as CampaignFormState["specialAdCategories"],
    advantageCampaignBudget: cbo,
    campaignBudget: cbo ? fromMinorUnits(node.daily_budget) : state.campaignBudget,
    campaignBidStrategy: cbo ? strategy : state.campaignBidStrategy,
  }
}

function applyAdSet(state: CampaignFormState, node: WorkspaceNode): CampaignFormState {
  const targeting = node.targeting || {}
  const cbo = state.advantageCampaignBudget
  const strategy = !cbo && isBidStrategy(node.bid_strategy) ? node.bid_strategy : state.campaignBidStrategy
  const roasFloor = node.bid_constraints?.roas_average_floor
  return {
    ...state,
    adSetName: node.name,
    conversionLocation: (node.conversion_location as CampaignFormState["conversionLocation"]) ?? null,
    engagementType: (node.engagement_type as CampaignFormState["engagementType"]) ?? null,
    performanceGoal: (node.optimization_goal || state.performanceGoal) as CampaignFormState["performanceGoal"],
    pixelId: node.promoted_object?.pixel_id || "",
    conversionEvent: (node.promoted_object?.custom_event_type || state.conversionEvent) as ConversionEvent,
    campaignBidStrategy: strategy,
    costPerResultGoal: capStrategies.has(strategy) ? fromMinorUnits(node.bid_amount) : "",
    roasGoal:
      strategy === "LOWEST_COST_WITH_MIN_ROAS" && roasFloor ? String(roasFloor / 10000) : "",
    attributionClickDays: windowDays(node.attribution_spec, "CLICK_THROUGH") as AttributionClickDays,
    attributionViewDays: windowDays(node.attribution_spec, "VIEW_THROUGH") as AttributionViewDays,
    attributionEngagedViewDays: windowDays(
      node.attribution_spec,
      "ENGAGED_VIDEO_VIEW"
    ) as AttributionEngagedViewDays,
    dailyBudget: cbo ? state.dailyBudget : fromMinorUnits(node.daily_budget),
    scheduleStart: node.start_time || "",
    scheduleEnd: node.stop_time || "",
    scheduleTimeBasis: node.schedule_time_basis || state.scheduleTimeBasis,
    locations: targeting.geo_locations?.countries || [],
    ageMin: targeting.age_min ?? state.ageMin,
    ageMax: targeting.age_max ?? state.ageMax,
    gender: genderFromCodes(targeting.genders),
    customAudiences: targeting.custom_audiences || [],
    excludedCustomAudiences: targeting.excluded_custom_audiences || [],
    detailedTargeting: fromFlexibleSpec(targeting.flexible_spec),
    targetingExpansion: targeting.targeting_optimization === "expansion_all",
    placementMode: (targeting.publisher_platforms?.length ? "manual" : "advantage") as PlacementMode,
    publisherPlatforms: (targeting.publisher_platforms?.length
      ? targeting.publisher_platforms
      : state.publisherPlatforms) as PublisherPlatform[],
    advertiser: (node.advertiser ?? null) as AdvertiserEntity,
    payer: (node.payer ?? null) as AdvertiserEntity,
  }
}

function applyAd(state: CampaignFormState, node: WorkspaceNode): CampaignFormState {
  return {
    ...state,
    adName: node.name,
    pageId: node.page_id || "",
    instagramId: node.instagram_id || "",
    creativeId: node.portal_creative_id || "",
    creativeFileName: node.creative_file_name || "",
    creativePreviewUrl: node.thumb_url || "",
    mediaUrl: node.media_url || "",
    mediaType: (node.media_type || state.mediaType) as MediaType,
    creativeIds: node.creative_ids || [],
    selectedCreatives: node.selected_creatives || [],
    oneAdPerAdset: Boolean(node.one_ad_per_adset),
    primaryText: node.primaryText || "",
    primaryTextVariations: node.primary_text_variations || [],
    headline: node.headline || "",
    headlineVariations: node.headline_variations || [],
    description: node.description || "",
    descriptionVariations: node.description_variations || [],
    callToAction: node.cta || state.callToAction,
    destinationUrl: node.link || "",
    urlParameters: node.url_parameters || "",
  }
}

/** Convenience for the round-trip property and for rehydrating after a discard. */
export function applyDraftHierarchy(
  state: CampaignFormState,
  nodes: DraftHierarchy
): CampaignFormState {
  let next = applyCampaign(state, nodes.campaign)
  next = applyAdSet(next, nodes.adset)
  return applyAd(next, nodes.ad)
}
