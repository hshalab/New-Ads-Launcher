/**
 * Campaign shell helpers for BL-64 create-new flow.
 *
 * Create new campaign creates a real PAUSED Meta campaign only — no synthetic ad set / ad.
 * Attach / full hierarchy still uses `POST /api/facebook/create-campaign` and
 * `CampaignFormState` as its wire format. This module maps gate/form campaign fields into the
 * shell route payload and back into campaign-level form fields for editor edits.
 *
 * CBO: campaign owns daily budget + bid strategy (no cap/ROAS value).
 * ABO: campaign owns neither; ad set owns budget + strategy + value later.
 */

import { isBidStrategy } from "@/lib/create-campaign-bidding"
import type { BidStrategy } from "@/lib/create-campaign-bidding"
import { buildDeliveryFields } from "@/lib/odax-matrix"
import type { CampaignObjective } from "@/lib/odax-matrix"
import { buildTargeting } from "@/lib/create-campaign-targeting"
import type { CampaignFormState, SpecialAdCategory } from "@/components/ads-manager/create-flow/types"
import type { WorkspaceNode } from "@/components/ads-manager/UnifiedWorkspaceEditor"

export type DraftLevel = "campaign" | "adset" | "ad"

/**
 * Which node owns each form field. Exhaustive — adding a form field without placing it here is a
 * type error. Kept so later attach/editor mapping cannot silently drop fields (TD-38 class).
 *
 * `"gate"` = decided before the editor opens (objective, attach scope).
 */
export const FIELD_OWNER: Record<keyof CampaignFormState, DraftLevel | "gate"> = {
  existingCampaignId: "gate",
  existingCampaignName: "gate",
  objective: "gate",
  campaignName: "campaign",
  specialAdCategories: "campaign",
  advantageCampaignBudget: "campaign",
  campaignBudget: "campaign",
  // Strategy sits on campaign under CBO and on the ad set under ABO. Cap/ROAS value always ad set.
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

// ---------------------------------------------------------------------------- campaign shell

/**
 * Wire body for `POST /api/facebook/create-campaign-shell`.
 * Campaign fields only — no ad set, ad, creative, targeting, or cap value.
 */
export type CampaignShellPayload = {
  name: string
  objective: CampaignObjective
  specialAdCategories: SpecialAdCategory[]
  advantageCampaignBudget: boolean
  /** Major-unit string when CBO; omitted when ABO. */
  campaignBudget?: string
  /** Present only when CBO. Cap/ROAS amounts never live here. */
  campaignBidStrategy?: BidStrategy
}

/**
 * Map form/gate state → shell create payload.
 * Rejects attach-scope state: shell create is create-new only.
 */
export function formStateToCampaignShell(
  state: Pick<
    CampaignFormState,
    | "existingCampaignId"
    | "campaignName"
    | "objective"
    | "specialAdCategories"
    | "advantageCampaignBudget"
    | "campaignBudget"
    | "campaignBidStrategy"
  >
): CampaignShellPayload {
  if (state.existingCampaignId) {
    throw new Error("Campaign shell create is for new campaigns only; attach uses create-campaign")
  }

  const name = state.campaignName.trim() || "New Campaign"
  const cbo = state.advantageCampaignBudget
  const strategy: BidStrategy = isBidStrategy(state.campaignBidStrategy)
    ? state.campaignBidStrategy
    : "LOWEST_COST_WITHOUT_CAP"

  if (!cbo) {
    return {
      name,
      objective: state.objective,
      specialAdCategories: state.specialAdCategories,
      advantageCampaignBudget: false,
    }
  }

  return {
    name,
    objective: state.objective,
    specialAdCategories: state.specialAdCategories,
    advantageCampaignBudget: true,
    campaignBudget: state.campaignBudget.trim(),
    campaignBidStrategy: strategy,
  }
}

/** Campaign-level form fields after an editor edit of a live shell. */
export type CampaignShellEdit = {
  name: string
  specialAdCategories?: SpecialAdCategory[]
  advantageCampaignBudget: boolean
  /** Major units when CBO. */
  campaignBudget?: string
  campaignBidStrategy?: BidStrategy
}

/**
 * Fold campaign-shell editor fields back into form state.
 * Does not touch ad set / ad fields — those are created later via explicit child ops.
 */
export function applyCampaignShellEdit(
  state: CampaignFormState,
  edit: CampaignShellEdit
): CampaignFormState {
  const cbo = edit.advantageCampaignBudget
  const strategy =
    cbo && isBidStrategy(edit.campaignBidStrategy)
      ? edit.campaignBidStrategy
      : state.campaignBidStrategy

  return {
    ...state,
    campaignName: edit.name,
    specialAdCategories: edit.specialAdCategories ?? state.specialAdCategories,
    advantageCampaignBudget: cbo,
    campaignBudget: cbo
      ? (edit.campaignBudget?.trim() || state.campaignBudget)
      : state.campaignBudget,
    campaignBidStrategy: cbo ? strategy : state.campaignBidStrategy,
  }
}

// ---------------------------------------------------------------------------- entry hierarchy

export type EntryHierarchyDrafts = {
  adSet: WorkspaceNode
  ad: WorkspaceNode
  /**
   * "" when the ad set can go to Meta straight from the gate; otherwise the user-facing reason it
   * cannot yet (`buildDeliveryFields`). The ad is never materializable at gate time — Meta needs a
   * Page, a creative, headline, body and a link, none of which the gate collects.
   */
  adSetBlockedReason: string
}

/**
 * The two child drafts the editor opens on after `create-campaign-shell` returns.
 *
 * Field placement follows `FIELD_OWNER`: only `"adset"` fields reach the ad set node and only
 * `"ad"` fields reach the ad node. What the gate cannot know is left unset rather than defaulted —
 * a guessed pixel or Page is a silent spend decision.
 */
export function buildEntryHierarchyDrafts(
  state: CampaignFormState,
  campaignId: string,
  ids: { adSetNodeId: string; adNodeId: string },
): EntryHierarchyDrafts {
  const delivery = buildDeliveryFields({
    objective: state.objective,
    conversionLocation: state.conversionLocation,
    engagementType: state.engagementType,
    performanceGoal: state.performanceGoal,
    pixelId: state.pixelId || undefined,
    conversionEvent: state.conversionEvent || undefined,
    pageId: state.pageId || undefined,
    hasCostCap: Boolean(state.costPerResultGoal.trim()),
  })
  const resolved = typeof delivery === "string" ? null : delivery

  const adSet: WorkspaceNode = {
    id: ids.adSetNodeId,
    name: state.adSetName.trim() || "New ad set",
    status: "PAUSED",
    campaign_id: campaignId,
    targeting: buildTargeting(state),
    // CBO puts the budget on the campaign; sending one here is what Meta rejects.
    daily_budget: state.advantageCampaignBudget ? undefined : toMinorUnits(state.dailyBudget),
    optimization_goal: resolved?.optimizationGoal,
    billing_event: resolved?.billingEvent,
    destination_type: resolved?.destinationType,
    promoted_object: resolved?.promotedObject,
  }

  const ad: WorkspaceNode = {
    id: ids.adNodeId,
    name: state.adName.trim() || "New ad",
    status: "PAUSED",
    adset_id: ids.adSetNodeId,
    campaign_id: campaignId,
    page_id: state.pageId || undefined,
    primaryText: state.primaryText || undefined,
    headline: state.headline || undefined,
    link: state.destinationUrl || undefined,
    cta: state.callToAction,
  }

  return {
    adSet,
    ad,
    adSetBlockedReason: typeof delivery === "string" ? delivery : "",
  }
}

export type MaterializeNode = {
  nodeId: string
  level: DraftLevel
  metaId?: string
  contextOnly?: boolean
  parentNodeId?: string
  name?: string
  objective?: string
  specialAdCategories?: string[]
  dailyBudget?: string
  lifetimeBudget?: string
  bidStrategy?: string
  bidAmount?: string
  bidConstraints?: { roas_average_floor: number }
  targeting?: WorkspaceNode["targeting"]
  optimizationGoal?: string
  billingEvent?: string
  startTime?: string
  endTime?: string
  destinationType?: string
  promotedObject?: WorkspaceNode["promoted_object"]
  attributionSpec?: WorkspaceNode["attribution_spec"]
  dsaBeneficiary?: string
  dsaPayor?: string
  pageId?: string
  imageHash?: string
  videoId?: string
  thumbnailUrl?: string
  title?: string
  body?: string
  description?: string
  cta?: string
  linkUrl?: string
  primaryTextVariations?: string[]
  headlineVariations?: string[]
  descriptionVariations?: string[]
  urlParameters?: string
  creativeId?: string
  creativeThumb?: string
}

function materializeNode(node: WorkspaceNode, level: DraftLevel): MaterializeNode {
  const creative = node.creative
  return {
    nodeId: node.id,
    level,
    metaId: node.id.startsWith("local:") ? undefined : node.id,
    parentNodeId: level === "adset" ? node.campaign_id : level === "ad" ? node.adset_id : undefined,
    name: node.name,
    objective: node.objective,
    specialAdCategories: node.special_ad_categories,
    dailyBudget: node.daily_budget,
    lifetimeBudget: node.lifetime_budget,
    bidStrategy: node.bid_strategy,
    bidAmount: node.bid_amount,
    bidConstraints: node.bid_constraints?.roas_average_floor == null ? undefined : { roas_average_floor: node.bid_constraints.roas_average_floor },
    targeting: node.targeting,
    optimizationGoal: node.optimization_goal,
    billingEvent: node.billing_event,
    startTime: node.start_time,
    endTime: node.end_time || node.stop_time,
    destinationType: node.destination_type,
    promotedObject: node.promoted_object,
    attributionSpec: node.attribution_spec,
    dsaBeneficiary: node.advertiser?.id,
    dsaPayor: node.payer?.id,
    pageId: node.page_id,
    imageHash: node.image_hash,
    videoId: node.video_id || creative?.video_id,
    thumbnailUrl: node.thumb_url || creative?.thumbnail_url,
    title: node.headline || creative?.title,
    body: node.primaryText || creative?.body,
    description: node.description,
    cta: node.cta,
    linkUrl: node.link,
    primaryTextVariations: node.primary_text_variations,
    headlineVariations: node.headline_variations,
    descriptionVariations: node.description_variations,
    urlParameters: node.url_parameters,
    creativeId: node.portal_creative_id,
    creativeThumb: node.thumb_url || creative?.thumbnail_url,
  }
}

/**
 * Build the route payload. `nodes` are new or edited hierarchy entries to materialize/update.
 * `contextParents` are already-existing ancestors included only to satisfy the route's
 * "every parentNodeId must resolve within this request" rule — they are sent with
 * `contextOnly: true` so the route resolves their Meta ID without writing to them.
 */
export function workspaceDraftsToMaterializeNodes(
  nodes: Array<{ node: WorkspaceNode; level: DraftLevel }>,
  contextParents: Array<{ node: WorkspaceNode; level: DraftLevel }> = [],
): MaterializeNode[] {
  const order: Record<DraftLevel, number> = { campaign: 0, adset: 1, ad: 2 }
  const sortedNew = [...nodes].sort((a, b) => order[a.level] - order[b.level])
  const sortedContext = [...contextParents].sort((a, b) => order[a.level] - order[b.level])

  const context = sortedContext.map(({ node, level }) => ({
    ...materializeNode(node, level),
    metaId: node.id,
    contextOnly: true,
  }))
  const created = sortedNew.map(({ node, level }) => materializeNode(node, level))

  return [...context, ...created]
}
