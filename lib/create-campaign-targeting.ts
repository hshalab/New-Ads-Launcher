/**
 * Pure targeting builder for the Create Campaign flow.
 *
 * Extracted from `app/api/facebook/create-campaign/route.ts` so it can be asserted without a
 * Meta token or a Supabase session. The property that matters and that the tests hold:
 * **a state with untouched UI defaults must produce exactly the object this route sent before
 * TD-38 was fixed** — geo/age/gender and nothing else. Sending one extra spec field has silently
 * changed ad set behaviour on this product before (postmortems/2026-07-14-mto-text-variations-fix.md),
 * and there is no CI, no feature flag and no observability to catch a repeat.
 */

export type PublisherPlatform = "facebook" | "instagram" | "audience_network" | "messenger"

export const PUBLISHER_PLATFORMS: PublisherPlatform[] = [
  "facebook",
  "instagram",
  "audience_network",
  "messenger",
]

/** Meta rejects a campaign that would exceed this many ad sets. */
export const META_MAX_AD_SETS_PER_CAMPAIGN = 200

export interface TargetingInput {
  locations: string[]
  ageMin: number
  ageMax: number
  gender: "ALL" | "MALE" | "FEMALE"
  placementMode: "advantage" | "manual"
  publisherPlatforms: PublisherPlatform[]
  targetingExpansion: boolean
}

export interface MetaTargeting {
  geo_locations: { countries: string[] }
  age_min: number
  age_max: number
  genders?: number[]
  publisher_platforms?: PublisherPlatform[]
  targeting_automation?: { advantage_audience: 0 | 1 }
}

export function buildTargeting(state: TargetingInput): MetaTargeting {
  const targeting: MetaTargeting = {
    geo_locations: { countries: state.locations },
    age_min: state.ageMin,
    age_max: state.ageMax,
  }

  if (state.gender === "MALE") targeting.genders = [1]
  if (state.gender === "FEMALE") targeting.genders = [2]

  // Advantage+ placements means "let Meta choose", which is what omitting the key already does.
  if (state.placementMode === "manual") {
    targeting.publisher_platforms = state.publisherPlatforms
  }

  // Advantage+ audience is on by default at Meta, so only the opt-out needs to be transmitted.
  if (!state.targetingExpansion) {
    targeting.targeting_automation = { advantage_audience: 0 }
  }

  return targeting
}

export interface AttributionInput {
  mediaType: "image" | "video"
  performanceGoal: string
  attributionClickDays: "1" | "7"
  attributionViewDays: "0" | "1"
  attributionEngagedViewDays: "0" | "1"
}

export function buildAttributionSpec(state: AttributionInput) {
  return [
    { event_type: "CLICK_THROUGH", window_days: Number(state.attributionClickDays) },
    ...(state.attributionViewDays === "1" ? [{ event_type: "VIEW_THROUGH", window_days: 1 }] : []),
    // Engaged-view is video-only at Meta; the UI offers it only for video ads.
    ...(state.mediaType === "video" &&
    state.performanceGoal === "OFFSITE_CONVERSIONS" &&
    state.attributionEngagedViewDays === "1"
      ? [{ event_type: "ENGAGED_VIDEO_VIEW", window_days: 1 }]
      : []),
  ]
}

/**
 * One ad set per creative means N ad sets. Meta caps a campaign at 200 and rejects the 201st
 * mid-loop, leaving a half-built campaign that rollback does not touch — rollback only fires when
 * zero ads succeed. Returns the error message, or null when the batch is allowed (TD-40).
 */
export function adSetCountError(oneAdPerAdset: boolean, creativeCount: number): string | null {
  if (!oneAdPerAdset || creativeCount <= META_MAX_AD_SETS_PER_CAMPAIGN) return null
  return `One ad set per creative would need ${creativeCount} ad sets; Meta allows ${META_MAX_AD_SETS_PER_CAMPAIGN} per campaign. Split the selection or turn off "one ad per ad set".`
}
