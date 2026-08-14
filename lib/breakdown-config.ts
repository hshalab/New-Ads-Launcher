// Breakdown options config — maps to Meta Ads Insights API parameters

export interface BreakdownOption {
  id: string
  label: string
  description?: string
  /** Query string fragment appended to the insights API URL, e.g. "breakdowns=age" */
  apiParam?: string
  /**
   * Meta's Ads Manager UI offers this dimension but the Insights API has no
   * breakdown field for it. Kept visible (the menu mirrors Meta's) but greyed
   * out and never sent — see META_BREAKDOWN_FIELDS.
   */
  unsupported?: boolean
}

export interface BreakdownGroup {
  id: string
  label: string
  options: BreakdownOption[]
}

/**
 * Every field the Ads Insights API (v25) accepts in `breakdowns`, limited to the
 * ones this menu can produce.
 *
 * Meta rejects the WHOLE request with error 100 when one field is not a real
 * breakdown, so a single invented entry blanks the table for every breakdown
 * selected alongside it — and the failure then sticks for 30s behind the route
 * cache's error backoff. This set is the single source of truth: the menu greys
 * out anything outside it and `app/api/facebook/breakdown-insights` refuses to
 * forward it. The same list, minus the ones this menu does not offer, is what
 * `app/api/insights/breakdown` has been running against Meta successfully.
 */
export const META_BREAKDOWN_FIELDS = new Set([
  "age",
  "gender",
  "country",
  "region",
  "dma",
  "publisher_platform",
  "platform_position",
  "impression_device",
  "device_platform",
  "media_type",
  "product_id",
  "hourly_stats_aggregated_by_advertiser_time_zone",
  "hourly_stats_aggregated_by_audience_time_zone",
])

/** Meta's accepted `time_increment` values: 1–90 days, "monthly", or "all_days". */
export function isValidTimeIncrement(value: string): boolean {
  if (value === "monthly" || value === "all_days") return true
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= 90
}

/** The breakdown fields in `fields` that Meta does not accept. Empty = safe to send. */
export function unsupportedBreakdownFields(fields: string[]): string[] {
  return fields.filter(field => !META_BREAKDOWN_FIELDS.has(field))
}

// ─── Popular (shortcuts shown at top of menu) ─────────────────────────────────

export const POPULAR_BREAKDOWNS: BreakdownOption[] = [
  { id: "day",       label: "Day",       apiParam: "time_increment=1"                                   },
  { id: "age",       label: "Age",       apiParam: "breakdowns=age"                                     },
  { id: "placement", label: "Placement", apiParam: "breakdowns=publisher_platform,platform_position"    },
  { id: "country",   label: "Country",   apiParam: "breakdowns=country"                                 },
  { id: "platform",  label: "Platform",  apiParam: "breakdowns=publisher_platform"                      },
]

// ─── Groups with submenus ─────────────────────────────────────────────────────

export const BREAKDOWN_GROUPS: BreakdownGroup[] = [
  {
    id: "time", label: "Time",
    options: [
      { id: "none",   label: "None"    },
      { id: "day",    label: "Day",      apiParam: "time_increment=1"       },
      { id: "week",   label: "Week",     apiParam: "time_increment=7"       },
      { id: "2weeks", label: "2 weeks",  apiParam: "time_increment=14"      },
      { id: "month",  label: "Month",    apiParam: "time_increment=monthly" },
    ],
  },
  {
    id: "demographics", label: "Demographics",
    options: [
      { id: "none",        label: "None"             },
      { id: "age",         label: "Age",              apiParam: "breakdowns=age"                  },
      { id: "gender",      label: "Gender",           apiParam: "breakdowns=gender"               },
      { id: "age_gender",  label: "Age and gender",   apiParam: "breakdowns=age,gender"           },
      { id: "audience_seg",label: "Audience segments",unsupported: true },
    ],
  },
  {
    id: "geography", label: "Geography",
    options: [
      { id: "none",    label: "None"       },
      { id: "country", label: "Country",   apiParam: "breakdowns=country" },
      { id: "region",  label: "Region",    apiParam: "breakdowns=region"  },
      { id: "dma",     label: "DMA region",apiParam: "breakdowns=dma"     },
      { id: "city",    label: "City",      unsupported: true },
    ],
  },
  {
    id: "delivery", label: "Delivery",
    options: [
      { id: "none",              label: "None"                                                                                },
      { id: "placement",         label: "Placement",                    apiParam: "breakdowns=publisher_platform,platform_position"               },
      { id: "platform",          label: "Platform",                     apiParam: "breakdowns=publisher_platform"                                  },
      { id: "reels_trending",    label: "Reels trending topic",         unsupported: true },
      { id: "tod_account",       label: "Time of day (ad account time zone)", description: "Available for the last 13 months.", apiParam: "breakdowns=hourly_stats_aggregated_by_advertiser_time_zone" },
      { id: "tod_viewer",        label: "Time of day (viewer's time zone)",   description: "Available for the last 13 months.", apiParam: "breakdowns=hourly_stats_aggregated_by_audience_time_zone"  },
      { id: "impression_device", label: "Impression device",            apiParam: "breakdowns=impression_device"                                   },
      { id: "platform_device",   label: "Platform and device",          apiParam: "breakdowns=publisher_platform,impression_device"                },
      { id: "placement_device",  label: "Placement and device",         apiParam: "breakdowns=publisher_platform,platform_position,impression_device"},
      { id: "media_type",        label: "Media type",                   apiParam: "breakdowns=media_type"                                          },
      { id: "product_id",        label: "Product ID",                   description: "Only returns rows for catalog (Advantage+ catalog) ads.", apiParam: "breakdowns=product_id" },
    ],
  },
  {
    id: "action", label: "Action",
    options: [
      { id: "none",              label: "None"                              },
      { id: "msg_purchase",      label: "Messaging purchase source",      unsupported: true },
      { id: "msg_outcome",       label: "Messaging outcome destination",  unsupported: true },
      { id: "business_ai",       label: "Business AI",                    unsupported: true },
      { id: "conv_device",       label: "Conversion device",              apiParam: "breakdowns=device_platform"                },
      { id: "carousel_card",     label: "Carousel card",                  unsupported: true },
      { id: "destination",       label: "Destination",                    unsupported: true },
      { id: "post_reaction",     label: "Post reaction type",             unsupported: true },
      { id: "brand",             label: "Brand",                          unsupported: true },
      { id: "category",          label: "Category",                       unsupported: true },
      { id: "video_sound",       label: "Video sound",                    unsupported: true },
      { id: "video_view_type",   label: "Video view type",                unsupported: true },
    ],
  },
  {
    id: "creative", label: "Creative",
    options: [
      { id: "none",            label: "None"            },
      { id: "flexible_format", label: "Flexible format",unsupported: true },
      { id: "related_media",   label: "Related media",  unsupported: true },
    ],
  },
  {
    id: "attribution", label: "Attribution",
    options: [
      { id: "none",                 label: "None"                  },
      // Attribution is a request parameter (action_attribution_windows), not a breakdown field.
      { id: "attribution_settings", label: "Attribution settings", unsupported: true },
      { id: "conversion_count",     label: "Conversion count",     unsupported: true },
    ],
  },
]

// ─── Flat lookup: option id → apiParam ───────────────────────────────────────

/** The `breakdowns=` fields inside an apiParam fragment, e.g. "age,gender" → ["age","gender"]. */
export function breakdownFieldsOf(apiParam: string): string[] {
  const match = /(?:^|&)breakdowns=([^&]*)/.exec(apiParam)
  return match ? match[1].split(",").map(f => f.trim()).filter(Boolean) : []
}

function timeIncrementOf(apiParam: string): string | null {
  const match = /(?:^|&)time_increment=([^&]*)/.exec(apiParam)
  return match ? match[1] : null
}

/**
 * An option only reaches the API if every field in it is one Meta accepts. This
 * is deliberately structural rather than a comment: an apiParam typo silently
 * drops the option out of the menu's working set instead of blanking the table.
 */
function isSendable(option: BreakdownOption): boolean {
  if (!option.apiParam || option.unsupported) return false
  if (unsupportedBreakdownFields(breakdownFieldsOf(option.apiParam)).length > 0) return false
  const increment = timeIncrementOf(option.apiParam)
  return increment === null || isValidTimeIncrement(increment)
}

export const BREAKDOWN_API_MAP: Record<string, string> = Object.fromEntries(
  [...POPULAR_BREAKDOWNS, ...BREAKDOWN_GROUPS.flatMap(g => g.options)]
    .filter(isSendable)
    .map(o => [o.id, o.apiParam!])
)

// ─── Flat list for search (deduped, no "none") ────────────────────────────────

const _seen = new Set<string>()
export const ALL_BREAKDOWN_OPTIONS: BreakdownOption[] = [
  ...POPULAR_BREAKDOWNS,
  ...BREAKDOWN_GROUPS.flatMap(g => g.options),
].filter(o => {
  if (o.id === "none" || _seen.has(o.id)) return false
  _seen.add(o.id)
  return true
})

const OPTION_GROUPS: Record<string, string> = Object.fromEntries(
  BREAKDOWN_GROUPS.flatMap(group => group.options.filter(o => o.id !== "none").map(o => [o.id, group.id]))
)

const TIME_IDS = new Set(BREAKDOWN_GROUPS.find(g => g.id === "time")?.options.filter(o => o.id !== "none").map(o => o.id) ?? [])
const PLATFORM_DEVICE_IDS = new Set(["platform", "placement", "impression_device"])

export function getBreakdownIncompatibility(id: string, selected: string[]): string | null {
  // Checked first so an option already in state stays removable.
  if (selected.includes(id)) return null
  if (id !== "none" && !BREAKDOWN_API_MAP[id]) {
    return "Meta's Insights API doesn't report this breakdown."
  }
  const group = OPTION_GROUPS[id]
  if (!group) return null

  const selectedWithoutId = selected.filter(s => s !== id)
  const dataSelected = selectedWithoutId.filter(s => OPTION_GROUPS[s] && !TIME_IDS.has(s))

  if (TIME_IDS.has(id)) {
    return selectedWithoutId.some(s => TIME_IDS.has(s)) ? "Only one time breakdown can be selected." : null
  }

  const otherGroup = dataSelected.find(s => OPTION_GROUPS[s] !== group)
  if (otherGroup) return `Can't combine with ${labelForBreakdown(otherGroup)}.`

  if (group === "demographics") {
    const simple = id === "age" || id === "gender"
    const hasSimple = dataSelected.some(s => s === "age" || s === "gender")
    const hasPacked = dataSelected.some(s => s === "age_gender" || s === "audience_seg")
    if (simple && hasPacked) return "Can't combine with this demographic breakdown."
    if (!simple && hasSimple) return "Can't combine with Age or Gender."
    if (!simple && dataSelected.length > 0) return "Only one of these breakdowns can be selected."
    return null
  }

  if (group === "delivery") {
    const pairable = PLATFORM_DEVICE_IDS.has(id)
    const selectedPairable = dataSelected.every(s => PLATFORM_DEVICE_IDS.has(s))
    if (!pairable && dataSelected.length > 0) return "Only one of these breakdowns can be selected."
    if (pairable && !selectedPairable) return "Can't combine with this delivery breakdown."
    if (id === "platform" && dataSelected.includes("placement")) return "Platform and Placement overlap."
    if (id === "placement" && dataSelected.includes("platform")) return "Placement and Platform overlap."
    return null
  }

  return dataSelected.length > 0 ? "Only one of these breakdowns can be selected." : null
}

export function isBreakdownCompatible(id: string, selected: string[]): boolean {
  return !getBreakdownIncompatibility(id, selected)
}

function labelForBreakdown(id: string): string {
  return ALL_BREAKDOWN_OPTIONS.find(o => o.id === id)?.label ?? "selected breakdown"
}
