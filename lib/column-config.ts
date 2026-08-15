// Config-driven column definitions for the Ads Manager table

export type ColumnTab = "key_metrics" | "tracking" | "ad_settings" | "advanced" | "custom"
export type ColumnSection =
  | "results_spend"
  | "delivery"
  | "distribution"
  | "engagement"
  | "tracking_section"
  | "ad_settings_section"
  | "advanced_section"
  | "custom_metrics_section"

export type CustomMetricFormat = "numeric" | "percentage" | "currency"
export type CustomMetricAccess = "only_you" | "business"

export type ColumnFilterType = "text" | "enum" | "number" | "currency" | "percent" | "date" | "none"
export type ColumnFilterLevel = "campaigns" | "adsets" | "ads"

export interface ColumnDef {
  id: string
  label: string        // shown in modal checkbox list
  headerLabel: string  // shown in table <th>
  description: string  // Meta-style tooltip definition
  tab: ColumnTab
  section: ColumnSection
  sectionLabel: string
  sortKey?: string
  // A column becomes filterable in the Ads Manager chip bar by gaining a filterType.
  // Absent or "none" means not filterable — that is how v1 exposes a handful of the
  // 60 columns without a second catalog to keep in sync. See lib/ads-manager-filters.ts.
  filterType?: ColumnFilterType
  filterLevels?: ColumnFilterLevel[]   // default: all three
}

export const COLUMN_DEFS: ColumnDef[] = [
  // ── Key metrics: Results and spend ────────────────────────────────────────
  { id: "spend",             label: "Amount spent",                         headerLabel: "Amount spent",                         description: "The estimated total amount of money you've spent on your campaign, ad set or ad during its schedule.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend", sortKey: "spend", filterType: "currency"  },
  { id: "results",           label: "Results",                              headerLabel: "Results",                              description: "The number of times your ads achieved an outcome, based on the objective and settings you selected.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend" },
  { id: "cost_per_result",   label: "Cost per result",                      headerLabel: "Cost per result",                      description: "The average cost per result from your ads, calculated as amount spent divided by results.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend" },
  { id: "budget",            label: "Budget",                               headerLabel: "Budget",                               description: "The budget owned by this campaign or ad set, or the parent budget used by this row.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend", sortKey: "budget" },
  { id: "lifetime_budget",   label: "Lifetime budget",                      headerLabel: "Lifetime budget",                      description: "The maximum amount that you're willing to spend over the lifetime of your campaign or ad set.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend" },
  { id: "purchases",         label: "Purchases",                            headerLabel: "Purchases",                            description: "The number of purchase events attributed to your ads.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend" },
  { id: "purchase_value",    label: "Purchases conversion value",            headerLabel: "Purchases conversion value",            description: "The total value returned from purchase conversion events attributed to your ads.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend" },
  { id: "avg_order_value",   label: "Average order value",                  headerLabel: "Average order value",                  description: "The average value of each purchase, calculated as purchases conversion value divided by purchases.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend" },
  { id: "roas",              label: "Purchase ROAS (return on ad spend)",    headerLabel: "Purchase ROAS (return on ad spend)",    description: "The total return on ad spend from purchases. Calculated as purchases conversion value divided by amount spent.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend", filterType: "number" },
  { id: "cost_per_purchase", label: "Cost per purchase",                    headerLabel: "Cost per purchase",                    description: "The average cost for each purchase attributed to your ads.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend" },
  { id: "cost_per_lead",     label: "Cost per lead",                        headerLabel: "Cost per lead",                        description: "The average cost for each lead attributed to your ads.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend" },
  { id: "shopify_score",     label: "Shopify score",                        headerLabel: "Shopify score",                        description: "Shopify-derived performance score. Requires a Shopify data source integration.", tab: "key_metrics", section: "results_spend", sectionLabel: "Results and spend" },

  // ── Key metrics: Delivery ─────────────────────────────────────────────────
  { id: "delivery",          label: "Delivery",                             headerLabel: "Delivery",                             description: "The delivery status of your campaign, ad set or ad. This table normalizes delivery to Active or Off.", tab: "key_metrics", section: "delivery", sectionLabel: "Delivery" },
  { id: "effective_status",  label: "Delivery status",                      headerLabel: "Delivery status",                      description: "The current effective delivery status returned by Meta.", tab: "key_metrics", section: "delivery", sectionLabel: "Delivery" },

  // ── Key metrics: Distribution ─────────────────────────────────────────────
  { id: "impressions",       label: "Impressions",                          headerLabel: "Impressions",                          description: "The number of times your ads were on screen.", tab: "key_metrics", section: "distribution", sectionLabel: "Distribution", filterType: "number" },
  { id: "reach",             label: "Reach",                                headerLabel: "Reach",                                description: "The number of Meta accounts that saw your ads at least once.", tab: "key_metrics", section: "distribution", sectionLabel: "Distribution" },
  { id: "cpm",               label: "CPM (cost per 1,000 impressions)",      headerLabel: "CPM (cost per 1,000 impressions)",      description: "The average cost for 1,000 impressions.", tab: "key_metrics", section: "distribution", sectionLabel: "Distribution" },
  { id: "frequency",         label: "Frequency",                            headerLabel: "Frequency",                            description: "The average number of times that each Meta account saw your ad.", tab: "key_metrics", section: "distribution", sectionLabel: "Distribution" },

  // ── Key metrics: Engagement ───────────────────────────────────────────────
  { id: "clicks",             label: "Clicks (all)",                        headerLabel: "Clicks (all)",                        description: "The number of clicks on your ads, including link clicks and other clicks.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "ctr",                label: "CTR (all)",                           headerLabel: "CTR (all)",                           description: "The percentage of times people saw your ad and performed any click. Calculated as clicks divided by impressions.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "cpc",                label: "CPC (all)",                           headerLabel: "CPC (all)",                           description: "The average cost for each click (all), calculated as amount spent divided by clicks.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "link_clicks",        label: "Link clicks",                         headerLabel: "Link clicks",                         description: "The number of clicks on links within the ad that led to destinations or experiences on or off Meta technologies.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "unique_clicks",      label: "Unique clicks (all)",                 headerLabel: "Unique clicks (all)",                 description: "The number of Meta accounts that clicked your ad.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "unique_link_clicks", label: "Unique link clicks",                  headerLabel: "Unique link clicks",                  description: "The number of Meta accounts that performed a link click.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "unique_link_ctr",    label: "Unique CTR (link click-through rate)", headerLabel: "Unique CTR (link click-through rate)", description: "The percentage of Meta accounts reached that performed a link click.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "cost_per_unique_click", label: "Cost per unique click (all)",       headerLabel: "Cost per unique click (all)",       description: "The average cost for each Meta account that clicked your ad.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "cost_per_link_click", label: "CPC (cost per link click)",           headerLabel: "CPC (cost per link click)",           description: "The average cost for each link click.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "landing_page_views", label: "Landing page views",                  headerLabel: "Landing page views",                  description: "The number of times people loaded your website after clicking your ad.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "lpv_rate",           label: "Landing page views rate per link clicks", headerLabel: "Landing page views rate per link clicks", description: "The percentage of link clicks that resulted in a landing page view.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "content_views",      label: "Content views",                       headerLabel: "Content views",                       description: "The number of ViewContent events attributed to your ads.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "add_to_cart",        label: "Adds to cart",                        headerLabel: "Adds to cart",                        description: "The number of add-to-cart events attributed to your ads.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "cost_per_add_to_cart", label: "Cost per add to cart",              headerLabel: "Cost per add to cart",              description: "The average cost for each add-to-cart event attributed to your ads.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "initiate_checkout",  label: "Checkouts initiated",                 headerLabel: "Checkouts initiated",                 description: "The number of checkout initiated events attributed to your ads.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "cost_per_initiate_checkout", label: "Cost per checkout initiated", headerLabel: "Cost per checkout initiated", description: "The average cost for each checkout initiated event attributed to your ads.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "leads",              label: "Leads",                               headerLabel: "Leads",                               description: "The number of lead events attributed to your ads.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "purchase_conv_rate", label: "Purchase conversion rate",            headerLabel: "Purchase conversion rate",            description: "The percentage of clicks that resulted in a purchase.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "avg_watch_time",     label: "Video average play time",             headerLabel: "Video average play time",             description: "The average length of time people played your video ad.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "video_100",          label: "Video plays at 100%",                 headerLabel: "Video plays at 100%",                 description: "The number of times your video was played to 100% of its length.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "video_25",           label: "Video plays at 25%",                  headerLabel: "Video plays at 25%",                  description: "The number of times your video was played to 25% of its length.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "video_50",           label: "Video plays at 50%",                  headerLabel: "Video plays at 50%",                  description: "The number of times your video was played to 50% of its length.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "video_75",           label: "Video plays at 75%",                  headerLabel: "Video plays at 75%",                  description: "The number of times your video was played to 75% of its length.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },
  { id: "video_views_3s",     label: "3-second video plays",                headerLabel: "3-second video plays",                description: "The number of times your video played for at least 3 seconds, or for nearly its total length if shorter than 3 seconds.", tab: "key_metrics", section: "engagement", sectionLabel: "Engagement" },

  // ── Tracking ──────────────────────────────────────────────────────────────
  { id: "attribution_setting", label: "Attribution setting",                headerLabel: "Attribution setting",                description: "The conversion attribution setting used for reporting results.", tab: "tracking", section: "tracking_section", sectionLabel: "Tracking" },
  { id: "schedule_start",      label: "Starts",                             headerLabel: "Starts",                             description: "The date when your campaign, ad set or ad is scheduled to start.", tab: "tracking", section: "tracking_section", sectionLabel: "Tracking" },
  { id: "schedule_end",        label: "Ends",                               headerLabel: "Ends",                               description: "The date when your campaign, ad set or ad is scheduled to end.", tab: "tracking", section: "tracking_section", sectionLabel: "Tracking" },

  // ── Ad settings ───────────────────────────────────────────────────────────
  { id: "bid_strategy",         label: "Bid strategy",                       headerLabel: "Bid strategy",                       description: "The strategy Meta uses to bid for this campaign or ad set.", tab: "ad_settings", section: "ad_settings_section", sectionLabel: "Ad settings" },
  { id: "boosted_object_id",    label: "Boosted object ID",                  headerLabel: "Boosted object ID",                  description: "The ID of the object being boosted.", tab: "ad_settings", section: "ad_settings_section", sectionLabel: "Ad settings" },
  { id: "buying_type",          label: "Buying type",                        headerLabel: "Buying type",                        description: "The method by which you pay for and target ads in your campaign.", tab: "ad_settings", section: "ad_settings_section", sectionLabel: "Ad settings" },
  { id: "objective",            label: "Objective",                          headerLabel: "Objective",                          description: "The campaign objective selected for your ads.", tab: "ad_settings", section: "ad_settings_section", sectionLabel: "Ad settings", filterType: "enum", filterLevels: ["campaigns"] },
  { id: "smart_promotion_type", label: "Smart promotion type",               headerLabel: "Smart promotion type",               description: "The smart promotion type configured for the campaign.", tab: "ad_settings", section: "ad_settings_section", sectionLabel: "Ad settings" },
  { id: "special_ad_category",  label: "Special ad category",                headerLabel: "Special ad category",                description: "The special ad category declared for regulated ad content.", tab: "ad_settings", section: "ad_settings_section", sectionLabel: "Ad settings" },

  // ── Advanced ──────────────────────────────────────────────────────────────
  { id: "account_id",        label: "Account ID",        headerLabel: "Account ID",        description: "The Meta ad account ID associated with this row.", tab: "advanced", section: "advanced_section", sectionLabel: "Advanced" },
  { id: "budget_remaining",  label: "Budget remaining",  headerLabel: "Budget remaining",  description: "The amount of budget remaining, when returned by Meta.", tab: "advanced", section: "advanced_section", sectionLabel: "Advanced" },
  { id: "date_created",      label: "Created",           headerLabel: "Created",           description: "The date this object was created.", tab: "advanced", section: "advanced_section", sectionLabel: "Advanced", filterType: "date" },
  { id: "issues_info",       label: "Issues",            headerLabel: "Issues",            description: "Delivery or review issues returned by Meta.", tab: "advanced", section: "advanced_section", sectionLabel: "Advanced" },
  { id: "optimization_goal", label: "Optimization goal", headerLabel: "Optimization goal", description: "The optimization goal used by Meta to deliver this ad set.", tab: "advanced", section: "advanced_section", sectionLabel: "Advanced" },
  { id: "spend_cap",         label: "Spend cap",         headerLabel: "Spend cap",         description: "The maximum amount that can be spent by the campaign.", tab: "advanced", section: "advanced_section", sectionLabel: "Advanced" },
  { id: "updated_time",      label: "Updated",           headerLabel: "Updated",           description: "The date this object was last updated.", tab: "advanced", section: "advanced_section", sectionLabel: "Advanced" },
]

export const COLUMN_MAP: Record<string, ColumnDef> = Object.fromEntries(
  COLUMN_DEFS.map(c => [c.id, c])
)

export interface ColumnPreset {
  id: string
  label: string
  columns: string[]
  isDefault?: boolean
}

export const DEFAULT_PRESETS: ColumnPreset[] = [
  { id: "performance", label: "Performance", isDefault: true, columns: ["delivery", "spend", "results", "cost_per_result", "budget"] },
  { id: "performance_and_clicks", label: "Performance and clicks", isDefault: true, columns: ["delivery", "spend", "results", "cost_per_result", "budget", "schedule_start", "schedule_end", "impressions", "clicks", "ctr", "cpc"] },
  { id: "engagement", label: "Engagement", isDefault: true, columns: ["delivery", "spend", "results", "cost_per_result", "impressions", "clicks", "ctr", "add_to_cart", "video_views_3s"] },
  { id: "delivery", label: "Delivery", isDefault: true, columns: ["delivery", "spend", "impressions", "reach", "frequency", "cpm"] },
  {
    id: "ecom",
    label: "ECOM",
    isDefault: true,
    columns: [
      "delivery", "attribution_setting", "bid_strategy", "budget", "spend", "roas", "purchase_value",
      "impressions", "frequency", "cpm",
      "cost_per_unique_click", "unique_link_ctr", "ctr", "cost_per_link_click",
      "unique_link_clicks", "lpv_rate", "content_views",
      "add_to_cart", "cost_per_add_to_cart",
      "initiate_checkout", "cost_per_initiate_checkout",
      "purchases", "cost_per_purchase",
      "avg_watch_time"
    ],
  },
]

const LEGACY_ECOM_COLUMNS = DEFAULT_PRESETS.find(preset => preset.id === "ecom")!.columns.filter(
  column => column !== "bid_strategy",
)

export function migrateStoredColumnOrder(columns: string[]): string[] {
  const isLegacyEcom = columns.length === LEGACY_ECOM_COLUMNS.length
    && columns.every((column, index) => column === LEGACY_ECOM_COLUMNS[index])
  if (!isLegacyEcom) return columns

  const migrated = [...columns]
  migrated.splice(migrated.indexOf("budget"), 0, "bid_strategy")
  return migrated
}

export function resolveStoredColumnOrder(columns: string[], activePresetId: string | null): string[] {
  return DEFAULT_PRESETS.find(preset => preset.id === activePresetId)?.columns ?? migrateStoredColumnOrder(columns)
}

export function getActivePreset(
  cols: string[],
  customPresets: ColumnPreset[] = []
): ColumnPreset | null {
  return [...DEFAULT_PRESETS, ...customPresets].find(
    p => p.columns.length === cols.length && p.columns.every((c, i) => c === cols[i])
  ) || null
}

export interface CustomMetricConfig {
  id: string
  name: string
  description?: string
  format: CustomMetricFormat
  formula: string[] // Array of metric IDs and math operators e.g. ["spend", "/", "purchases"]
  access: CustomMetricAccess
}

export function toColumnDef(custom: CustomMetricConfig): ColumnDef {
  return {
    id: custom.id,
    label: custom.name,
    headerLabel: custom.name,
    description: custom.description || "Custom metric",
    tab: "custom",
    section: "custom_metrics_section",
    sectionLabel: "Custom metrics"
  }
}
