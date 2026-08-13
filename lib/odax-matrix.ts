/**
 * ODAX matrix — the single source of truth for the four-link chain
 *
 *   objective → conversion location → engagement type → performance goal
 *
 * and for the Meta fields that chain determines (`destination_type`, `promoted_object`).
 *
 * Why one module used by BOTH the client and the route: Meta validates the chain only when the
 * ad set is created, which is *after* the campaign already exists. A mismatch leaves an orphan
 * campaign and surfaces as error 100 "Invalid parameter" with no field name. Generating the
 * dropdowns and the request from the same table is what makes an invalid combination unreachable
 * rather than merely unlikely. This is option B in
 * `specs/create-campaign-rebuild/create-campaign-flow.html` §9.
 *
 * Scope note: this table covers only combinations the route can actually build today. Message
 * destinations, Calls, App and Instagram profile need `promoted_object` plumbing that does not
 * exist yet — they are BL-56, and they are absent from the table rather than present and broken.
 */

export type CampaignObjective =
  | "OUTCOME_SALES"
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_ENGAGEMENT"
  | "OUTCOME_AWARENESS"

export type ConversionLocation = "website" | "on_your_ad"

export type EngagementType = "video_views" | "post_engagement"

export type PerformanceGoal =
  | "OFFSITE_CONVERSIONS"
  | "LINK_CLICKS"
  | "LANDING_PAGE_VIEWS"
  | "REACH"
  | "THRUPLAY"
  | "POST_ENGAGEMENT"

/** Meta ad set `destination_type`. Awareness sends none — it has no destination. */
export type MetaDestinationType = "WEBSITE" | "ON_VIDEO" | "ON_POST"

export interface PerformanceGoalOption {
  value: PerformanceGoal
  label: string
}

export interface OdaxRow {
  objective: CampaignObjective
  /** null = this objective has no conversion location card in Ads Manager (Awareness). */
  conversionLocation: ConversionLocation | null
  conversionLocationLabel: string
  /** null = this conversion location has no engagement type sub-choice. */
  engagementType: EngagementType | null
  engagementTypeLabel: string
  destinationType?: MetaDestinationType
  performanceGoals: PerformanceGoalOption[]
  /** Meta requires `promoted_object.pixel_id` + `custom_event_type`. */
  requiresPixel?: boolean
  /** Meta requires `promoted_object.page_id`. */
  requiresPage?: boolean
  /**
   * `false` = Meta rejects `bid_strategy: COST_CAP` for this row's performance goal, so a cost per
   * result goal cannot be sent with it. Absent = allowed.
   *
   * Only the goal we know Meta refuses is marked. The others stay allowed until a real 400 says
   * otherwise — guessing the restriction wider would silently remove a bid strategy that works
   * today, which is the same class of harm as sending one that doesn't.
   */
  allowsCostCap?: boolean
}

export const ODAX_ROWS: OdaxRow[] = [
  {
    objective: "OUTCOME_SALES",
    conversionLocation: "website",
    conversionLocationLabel: "Website",
    engagementType: null,
    engagementTypeLabel: "",
    destinationType: "WEBSITE",
    performanceGoals: [{ value: "OFFSITE_CONVERSIONS", label: "Maximize number of conversions" }],
    requiresPixel: true,
  },
  {
    objective: "OUTCOME_TRAFFIC",
    conversionLocation: "website",
    conversionLocationLabel: "Website",
    engagementType: null,
    engagementTypeLabel: "",
    destinationType: "WEBSITE",
    performanceGoals: [
      { value: "LINK_CLICKS", label: "Maximize number of link clicks" },
      { value: "LANDING_PAGE_VIEWS", label: "Maximize number of landing page views" },
    ],
  },
  {
    objective: "OUTCOME_ENGAGEMENT",
    conversionLocation: "on_your_ad",
    conversionLocationLabel: "On your ad",
    engagementType: "video_views",
    engagementTypeLabel: "Video views",
    destinationType: "ON_VIDEO",
    performanceGoals: [{ value: "THRUPLAY", label: "Maximize ThruPlay views" }],
  },
  {
    objective: "OUTCOME_ENGAGEMENT",
    conversionLocation: "on_your_ad",
    conversionLocationLabel: "On your ad",
    engagementType: "post_engagement",
    engagementTypeLabel: "Post engagement",
    destinationType: "ON_POST",
    performanceGoals: [{ value: "POST_ENGAGEMENT", label: "Maximize number of engagements" }],
    requiresPage: true,
  },
  {
    objective: "OUTCOME_ENGAGEMENT",
    conversionLocation: "website",
    conversionLocationLabel: "Website",
    engagementType: null,
    engagementTypeLabel: "",
    destinationType: "WEBSITE",
    performanceGoals: [
      { value: "LINK_CLICKS", label: "Maximize number of link clicks" },
      { value: "LANDING_PAGE_VIEWS", label: "Maximize number of landing page views" },
    ],
  },
  {
    objective: "OUTCOME_AWARENESS",
    conversionLocation: null,
    conversionLocationLabel: "",
    engagementType: null,
    engagementTypeLabel: "",
    performanceGoals: [{ value: "REACH", label: "Maximize reach of ads" }],
    allowsCostCap: false,
  },
]

export const OBJECTIVES: CampaignObjective[] = [
  "OUTCOME_SALES",
  "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_AWARENESS",
]

export function isCampaignObjective(value: unknown): value is CampaignObjective {
  return typeof value === "string" && (OBJECTIVES as string[]).includes(value)
}

/**
 * Conversion locations offered for an objective, in Ads Manager order. An empty array means the
 * objective has no conversion location at all and the card must be hidden — not rendered with one
 * dead option (`create-campaign-flow.html` §10: an untransmitted field gets no input).
 */
export function conversionLocationsFor(
  objective: CampaignObjective
): Array<{ value: ConversionLocation; label: string }> {
  const seen = new Set<ConversionLocation>()
  const out: Array<{ value: ConversionLocation; label: string }> = []
  for (const row of ODAX_ROWS) {
    if (row.objective !== objective || !row.conversionLocation) continue
    if (seen.has(row.conversionLocation)) continue
    seen.add(row.conversionLocation)
    out.push({ value: row.conversionLocation, label: row.conversionLocationLabel })
  }
  return out
}

/** Engagement types for one objective + conversion location. Empty means no sub-choice exists. */
export function engagementTypesFor(
  objective: CampaignObjective,
  conversionLocation: ConversionLocation | null
): Array<{ value: EngagementType; label: string }> {
  return ODAX_ROWS.filter(
    (row) =>
      row.objective === objective &&
      row.conversionLocation === conversionLocation &&
      row.engagementType !== null
  ).map((row) => ({ value: row.engagementType!, label: row.engagementTypeLabel }))
}

/** The one row a (objective, location, engagement) triple selects, or null if the triple is invalid. */
export function resolveOdaxRow(
  objective: CampaignObjective,
  conversionLocation: ConversionLocation | null,
  engagementType: EngagementType | null
): OdaxRow | null {
  const candidates = ODAX_ROWS.filter((row) => row.objective === objective)
  if (candidates.length === 0) return null

  const locations = conversionLocationsFor(objective)
  const location = locations.length === 0 ? null : conversionLocation
  const byLocation = candidates.filter((row) => row.conversionLocation === location)
  if (byLocation.length === 0) return null

  const engagements = byLocation.filter((row) => row.engagementType !== null)
  if (engagements.length === 0) return byLocation[0]
  return engagements.find((row) => row.engagementType === engagementType) ?? null
}

export function performanceGoalsFor(
  objective: CampaignObjective,
  conversionLocation: ConversionLocation | null,
  engagementType: EngagementType | null
): PerformanceGoalOption[] {
  return resolveOdaxRow(objective, conversionLocation, engagementType)?.performanceGoals ?? []
}

export interface OdaxSelection {
  objective: CampaignObjective
  conversionLocation: ConversionLocation | null
  engagementType: EngagementType | null
  performanceGoal: PerformanceGoal
}

/**
 * Coerce a partial/stale selection onto the nearest valid row. Called on the client whenever the
 * objective or a parent link changes — a Sales→Engagement switch would otherwise leave
 * `OFFSITE_CONVERSIONS` selected — and on the server as the validation of last resort, so a
 * hand-rolled request cannot reach `createAdSet` with an off-matrix combination.
 */
export function normalizeOdaxSelection(input: {
  objective: CampaignObjective
  conversionLocation?: ConversionLocation | null
  engagementType?: EngagementType | null
  performanceGoal?: PerformanceGoal
}): OdaxSelection {
  const { objective } = input

  const locations = conversionLocationsFor(objective)
  const conversionLocation =
    locations.length === 0
      ? null
      : locations.some((option) => option.value === input.conversionLocation)
        ? (input.conversionLocation as ConversionLocation)
        : locations[0].value

  const engagements = engagementTypesFor(objective, conversionLocation)
  const engagementType =
    engagements.length === 0
      ? null
      : engagements.some((option) => option.value === input.engagementType)
        ? (input.engagementType as EngagementType)
        : engagements[0].value

  const goals = performanceGoalsFor(objective, conversionLocation, engagementType)
  const performanceGoal =
    goals.find((goal) => goal.value === input.performanceGoal)?.value ?? goals[0].value

  return { objective, conversionLocation, engagementType, performanceGoal }
}

export interface DeliveryFields {
  optimizationGoal: PerformanceGoal
  billingEvent: "IMPRESSIONS"
  destinationType?: MetaDestinationType
  promotedObject?: Record<string, string>
}

export interface DeliveryInput extends OdaxSelection {
  pixelId?: string
  conversionEvent?: string
  pageId?: string
  /** The request carries a cost per result goal, which the route turns into `COST_CAP`. */
  hasCostCap?: boolean
}

/**
 * Build the ad set delivery fields for a normalized selection, or return the user-facing reason
 * it cannot be built. Callers must treat a string as a 400 — never fall through to `createAdSet`.
 */
export function buildDeliveryFields(input: DeliveryInput): DeliveryFields | string {
  const row = resolveOdaxRow(input.objective, input.conversionLocation, input.engagementType)
  if (!row) return "This objective and conversion location combination is not supported"

  const goal = row.performanceGoals.find((option) => option.value === input.performanceGoal)
  if (!goal) return `Performance goal is not available for ${row.conversionLocationLabel || "this objective"}`

  // The route builds `bid_strategy: COST_CAP` from this. Meta validates the pair at ad set
  // creation — after the campaign exists — so refusing here is what keeps the campaign from
  // being orphaned by an error 100 with no field name.
  if (input.hasCostCap && row.allowsCostCap === false) {
    return `A cost per result goal cannot be used with "${goal.label}" — remove it or choose a different performance goal`
  }

  const promotedObject: Record<string, string> = {}
  if (row.requiresPixel) {
    if (!input.pixelId) return "Pixel is required for website conversion campaigns"
    // No default: `custom_event_type` decides what the campaign optimizes for, and quietly
    // picking PURCHASE spends the user's budget on a goal they never chose.
    if (!input.conversionEvent) return "A conversion event is required for website conversion campaigns"
    promotedObject.pixel_id = input.pixelId
    promotedObject.custom_event_type = input.conversionEvent
  }
  if (row.requiresPage) {
    if (!input.pageId) return "A Facebook Page is required for post engagement campaigns"
    promotedObject.page_id = input.pageId
  }

  return {
    optimizationGoal: goal.value,
    billingEvent: "IMPRESSIONS",
    destinationType: row.destinationType,
    promotedObject: Object.keys(promotedObject).length > 0 ? promotedObject : undefined,
  }
}
