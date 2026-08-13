/**
 * Ad set recommendation checks + the Campaign score derived from them.
 *
 * One module for both surfaces — the Create flow and the Editor — because the alternative is what
 * `buildAttributionSpec` already became in this repo: three copies that drifted. A check that fires
 * in the Editor must fire identically in the Create flow, or the score changes when you save
 * without anything about the ad set changing.
 *
 * **The score is AdLauncher's, not Meta's.** Meta has no campaign score; its quality /
 * engagement-rate / conversion-rate rankings are ad-level, need ~500 impressions, and therefore do
 * not exist for anything you are still building. This number is a restatement of the list below at
 * a lower resolution, nothing more, and every surface that shows it says so.
 *
 * The input is already-normalised primitives rather than either state shape. The two callers keep
 * their state differently (`CampaignFormState` vs Meta's draft shape) and `hasLocation` in
 * particular is not the same computation on both sides — the Editor's `geo_locations` can carry
 * cities and regions, the create form carries countries. Normalising at the call site keeps that
 * difference where it belongs.
 */

export interface AdSetRecommendation {
  level: "warning" | "info"
  title: string
  body: string
}

/** Performance goals that optimise for a website event and therefore require a Pixel. */
export const PIXEL_GOALS = new Set(["OFFSITE_CONVERSIONS", "CONVERSIONS"])

export interface RecommendationInput {
  /** Any geo targeting at all — country, region or city. */
  hasLocation: boolean
  optimizationGoal: string
  pixelId?: string | null
  /** How many publisher platforms are explicitly selected. 0 = Advantage+ placements. */
  publisherPlatformCount: number
  targetingExpansion: boolean
  ageMin: number
  ageMax: number
}

/**
 * Every check has to be actionable from the surface showing it — a recommendation the user cannot
 * act on where they are reading it is noise.
 */
export function buildAdSetRecommendations(input: RecommendationInput): AdSetRecommendation[] {
  const out: AdSetRecommendation[] = []

  if (!input.hasLocation) {
    out.push({
      level: "warning",
      title: "Add a location",
      body: "An ad set with no location cannot be delivered, and Meta rejects the update.",
    })
  }
  if (PIXEL_GOALS.has(input.optimizationGoal) && !input.pixelId) {
    out.push({
      level: "warning",
      title: "Select a Pixel",
      body: "This performance goal optimises for a website event, which needs a Pixel.",
    })
  }
  if (input.publisherPlatformCount > 0 && input.publisherPlatformCount < 3) {
    out.push({
      level: "info",
      title: "Consider Advantage+ placements",
      body: "Restricting placements narrows where budget can go, which usually raises cost per result.",
    })
  }
  if (!input.targetingExpansion) {
    out.push({
      level: "info",
      title: "Advantage detailed targeting is off",
      body: "Meta will not reach beyond your selections, even when it would perform better.",
    })
  }
  if (input.ageMax - input.ageMin < 10) {
    out.push({
      level: "info",
      title: "Narrow age range",
      body: `Ages ${input.ageMin}–${input.ageMax} restricts delivery. Widen it unless the restriction is deliberate.`,
    })
  }

  return out
}

/**
 * A warning is something Meta may refuse; an info is something that usually costs money. Exported
 * because the card explains the arithmetic to the user, and an explanation that is a second copy
 * of the numbers is one edit away from being a lie.
 */
export const WARNING_PENALTY = 25
export const INFO_PENALTY = 8

export type ScoreBand = "good" | "fair" | "poor"

export interface CampaignScore {
  value: number
  band: ScoreBand
  label: string
  warnings: number
  infos: number
}

export function campaignScore(recommendations: AdSetRecommendation[]): CampaignScore {
  const warnings = recommendations.filter((rec) => rec.level === "warning").length
  const infos = recommendations.length - warnings
  const value = Math.max(0, 100 - warnings * WARNING_PENALTY - infos * INFO_PENALTY)
  const band: ScoreBand = warnings > 0 ? (value >= 60 ? "fair" : "poor") : value >= 85 ? "good" : "fair"
  return {
    value,
    band,
    // A number with no word next to it invites the reading "Meta scored my campaign 84".
    label: band === "good" ? "Ready to launch" : band === "fair" ? "Worth a look" : "Needs attention",
    warnings,
    infos,
  }
}
