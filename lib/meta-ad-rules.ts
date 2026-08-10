/**
 * Meta Automated Rules — single source of truth for the adrules_library contract.
 *
 * Everything that encodes to or decodes from Meta's evaluation_spec / execution_spec /
 * schedule_spec lives here. Routes and UI must not hand-roll these shapes: the previous
 * implementation kept one action list in the page and a different one in the route, so
 * picking "Turn On Ad" silently created a notification-only rule.
 *
 * Spec reference: specs/automate/06-meta-ui-reference.md (verified against real Ads Manager).
 *
 * VERIFIED 2026-08-06 against 36 live rules across three ad accounts, read back through
 * GET /api/facebook/rules. That pass corrected six things this file had wrong: the metric
 * field names, the execution_options shape, the subscriber field name, the missing
 * CHANGE_CAMPAIGN_BUDGET type, the attribution_window filter, and the fact that
 * `entity_type` is a filter and not a readable field.
 *
 * Still unverified, because no live rule exercises them: the CUSTOM schedule shape, the
 * NOTIFICATION execution type, and the metrics marked `unverified` in METRIC_CATALOG.
 * Each is flagged at its definition.
 */

export type RuleEntityType = "CAMPAIGN" | "ADSET" | "AD"
export type RuleScheduleType = "SEMI_HOURLY" | "DAILY" | "CUSTOM"
export type RuleValueUnit = "currency" | "number" | "percent" | "ratio"

export interface RuleCondition {
  /** key into METRIC_CATALOG */
  metric: string
  operator: string
  value: string
}

export interface CustomScheduleWindow {
  /** minutes from midnight, account timezone */
  startMinute: number
  endMinute: number
  /** 0 = Sunday … 6 = Saturday */
  days: number[]
}

export interface RuleDraft {
  name: string
  entityType: RuleEntityType
  /** only entities currently active are evaluated — mirrors Meta's own note */
  activeOnly: boolean
  action: string
  /** for budget/bid actions */
  actionAmount?: string
  actionUnit?: "ABSOLUTE" | "PERCENTAGE"
  /** ceiling for an increase, floor for a decrease — major units, converted on encode */
  actionLimit?: string
  /** minutes before the same entity may be acted on again (Meta's action_frequency) */
  actionFrequencyMinutes?: number
  conditions: RuleCondition[]
  timeRange: string
  scheduleType: RuleScheduleType
  customWindows?: CustomScheduleWindow[]
  /** Meta user ids that receive rule results */
  subscribers?: string[]
  notifyOnFacebook?: boolean
}

/* ------------------------------------------------------------------ *
 * Catalogs
 * ------------------------------------------------------------------ */

export const ENTITY_TYPES: { value: RuleEntityType; label: string; plural: string }[] = [
  { value: "CAMPAIGN", label: "Campaign", plural: "campaigns" },
  { value: "ADSET", label: "Ad set", plural: "ad sets" },
  { value: "AD", label: "Ad", plural: "ads" },
]

/**
 * `field` is the name Meta expects inside evaluation_spec.filters.
 * `unit` drives both input affordance and how we render the condition back as English.
 * `conversionLagged` marks metrics whose value keeps moving for hours/days after the
 * spend happened — these are the ones that make short time ranges dangerous (trap T2).
 */
export const METRIC_CATALOG: Record<
  string,
  {
    field: string
    label: string
    unit: RuleValueUnit
    conversionLagged?: boolean
    /** true when no live rule uses this field, so the exact spelling is still a guess */
    unverified?: boolean
  }
> = {
  // Confirmed present in live rules — spelling is exact.
  lifetime_spent: { field: "lifetime_spent", label: "Lifetime spent", unit: "currency" },
  spent: { field: "spent", label: "Spent (in time range)", unit: "currency" },
  frequency: { field: "frequency", label: "Frequency", unit: "number" },
  link_clicks: { field: "link_click", label: "Link clicks", unit: "number" },
  cpc_link: { field: "cost_per_link_click", label: "Cost per link click", unit: "currency" },
  purchases: {
    field: "offsite_conversion.fb_pixel_purchase",
    label: "Purchases (Meta pixel)",
    unit: "number",
    conversionLagged: true,
  },
  cost_per_purchase: {
    field: "cost_per_purchase_fb",
    label: "Cost per purchase (Meta pixel)",
    unit: "currency",
    conversionLagged: true,
  },
  purchase_roas: {
    field: "website_purchase_roas",
    label: "Website purchase ROAS",
    unit: "ratio",
    conversionLagged: true,
  },

  // Standard Meta metric names, but no live rule uses them here. Treat a Graph
  // "(#100) Tried accessing nonexisting field" on one of these as a spelling bug.
  impressions: { field: "impressions", label: "Impressions", unit: "number", unverified: true },
  reach: { field: "reach", label: "Reach", unit: "number", unverified: true },
  clicks: { field: "clicks", label: "Clicks (all)", unit: "number", unverified: true },
  cpc: { field: "cpc", label: "CPC (all)", unit: "currency", unverified: true },
  cpm: { field: "cpm", label: "CPM", unit: "currency", unverified: true },
  ctr: { field: "ctr", label: "CTR", unit: "percent", unverified: true },
}

/**
 * Filters Meta puts in `evaluation_spec.filters` that are not conditions. They describe the
 * rule itself, so rendering them as conditions produces noise like
 * "attribution_window is ACCOUNT_DEFAULT" in the middle of an English sentence.
 */
export const STRUCTURAL_FILTER_FIELDS = [
  "entity_type",
  "time_preset",
  "attribution_window",
  "effective_status",
]

/**
 * Filters that narrow *which* entities the rule applies to. Meta shows these in the
 * "Applied to" column, not in "Action & condition". The live account leans on
 * `campaign.name CONTAIN "CBO"` to scope rules to a naming convention.
 */
export const SCOPE_FILTER_LABELS: Record<string, string> = {
  "campaign.name": "campaign name",
  "campaign.id": "campaign",
  "adset.name": "ad set name",
  "adset.id": "ad set",
  "ad.name": "ad name",
  "adset.budget_reset_period": "ad set budget period",
  "campaign.budget_reset_period": "campaign budget period",
}

/** What the condition builder offers. Comparison only — the rest are decode-side. */
export const OPERATORS: { value: string; label: string; english: string }[] = [
  { value: "GREATER_THAN", label: ">", english: "is greater than" },
  { value: "LESS_THAN", label: "<", english: "is less than" },
  { value: "EQUAL", label: "=", english: "is" },
  { value: "NOT_EQUAL", label: "≠", english: "is not" },
  { value: "GREATER_THAN_OR_EQUAL_TO", label: "≥", english: "is at least" },
  { value: "LESS_THAN_OR_EQUAL_TO", label: "≤", english: "is at most" },
]

/**
 * Every operator we may have to *read*, including the three the picker does not offer.
 * Live rules use CONTAIN for name scoping, IN for id lists and budget periods, and
 * IN_RANGE for ROAS bands — a rule written in Ads Manager must still render here.
 */
const OPERATOR_ENGLISH: Record<string, string> = {
  ...Object.fromEntries(OPERATORS.map(o => [o.value, o.english])),
  CONTAIN: "contains",
  NOT_CONTAIN: "does not contain",
  IN: "is one of",
  NOT_IN: "is not one of",
  IN_RANGE: "is between",
  NOT_IN_RANGE: "is not between",
  ANY: "is any of",
  ALL: "is all of",
  NONE: "is none of",
}

export function operatorEnglish(operator: string): string {
  return OPERATOR_ENGLISH[operator] ?? operator.toLowerCase().replace(/_/g, " ")
}

/**
 * One entry per user-facing action. `executionType` is what Meta receives; several of our
 * actions collapse onto the same Meta execution_type and differ only by entity scope,
 * which is why the entity type must be carried separately in evaluation_spec.
 */
export interface RuleAction {
  value: string
  label: (plural: string) => string
  /** what Meta receives for ad-set and ad rules */
  executionType: string
  /**
   * Campaign budget lives on a different execution type. Live rules show both
   * CHANGE_BUDGET (5) and CHANGE_CAMPAIGN_BUDGET (6) in the same account.
   */
  campaignExecutionType?: string
  needsAmount?: boolean
  amountUnit?: "ABSOLUTE" | "PERCENTAGE"
  /** budget mutations reset learning if applied too often — trap T1 */
  budgetMutating?: boolean
  /** no live rule uses this execution type; the string is from Meta's docs, not observed */
  unverified?: boolean
}

export const ACTIONS: RuleAction[] = [
  { value: "PAUSE", label: p => `Turn off ${p}`, executionType: "PAUSE" },
  { value: "UNPAUSE", label: p => `Turn on ${p}`, executionType: "UNPAUSE" },
  {
    value: "INCREASE_BUDGET_PERCENT",
    label: p => `Increase daily budget of ${p} by %`,
    executionType: "CHANGE_BUDGET",
    campaignExecutionType: "CHANGE_CAMPAIGN_BUDGET",
    needsAmount: true,
    amountUnit: "PERCENTAGE",
    budgetMutating: true,
  },
  {
    value: "DECREASE_BUDGET_PERCENT",
    label: p => `Decrease daily budget of ${p} by %`,
    executionType: "CHANGE_BUDGET",
    campaignExecutionType: "CHANGE_CAMPAIGN_BUDGET",
    needsAmount: true,
    amountUnit: "PERCENTAGE",
    budgetMutating: true,
  },
  {
    value: "INCREASE_BUDGET_ABSOLUTE",
    label: p => `Increase daily budget of ${p} by amount`,
    executionType: "CHANGE_BUDGET",
    campaignExecutionType: "CHANGE_CAMPAIGN_BUDGET",
    needsAmount: true,
    amountUnit: "ABSOLUTE",
    budgetMutating: true,
  },
  {
    value: "DECREASE_BUDGET_ABSOLUTE",
    label: p => `Decrease daily budget of ${p} by amount`,
    executionType: "CHANGE_BUDGET",
    campaignExecutionType: "CHANGE_CAMPAIGN_BUDGET",
    needsAmount: true,
    amountUnit: "ABSOLUTE",
    budgetMutating: true,
  },
  {
    value: "NOTIFICATION",
    label: () => "Send notification only",
    executionType: "NOTIFICATION",
    unverified: true,
  },
]

/**
 * Which execution_type this action becomes. Campaign budget is a separate type, so the
 * entity has to be known before the spec can be built — this is why entity type is not
 * merely a filter for us.
 */
export function resolveExecutionType(action: RuleAction, entityType: RuleEntityType): string {
  if (entityType === "CAMPAIGN" && action.campaignExecutionType) return action.campaignExecutionType
  return action.executionType
}

/** Decode side: both budget types map back to the same four budget actions. */
export function findActionByExecutionType(executionType: string): RuleAction | undefined {
  return ACTIONS.find(
    a => a.executionType === executionType || a.campaignExecutionType === executionType
  )
}

export interface MetaChangeSpec {
  amount?: string | number
  unit?: string
  limit?: string | number
}

/**
 * Meta has no increase/decrease execution type — direction lives in the sign of
 * `change_spec.amount`, and the unit distinguishes percent from absolute. Reading the
 * execution type alone labels a `-50` rule "Increase daily budget", which is the exact
 * opposite of what it does.
 */
export function resolveActionValue(executionType: string, changeSpec?: MetaChangeSpec): string {
  const base = findActionByExecutionType(executionType)
  if (!base) return "NOTIFICATION"
  if (!base.needsAmount) return base.value
  const direction = Number(changeSpec?.amount ?? 0) < 0 ? "DECREASE" : "INCREASE"
  const unit = changeSpec?.unit === "ABSOLUTE" ? "ABSOLUTE" : "PERCENT"
  return `${direction}_BUDGET_${unit}`
}

/**
 * `time_preset` values, in Meta's own spelling. The day-count suffix is `D`, not `_DAYS` —
 * live rules return `LAST_3D`. The `_DAYS` spelling this list used to carry was invented,
 * so the picker offered a preset Meta would have rejected, and the list column fell through
 * to printing the raw enum for every rule that used the real one.
 *
 * Observed on the 36 live rules: TODAY (3), YESTERDAY (3), LAST_3D (10), LIFETIME (19),
 * MAXIMUM (1). The rest are Meta's documented presets that no rule here exercises.
 */
export const TIME_RANGES: { value: string; label: string; days: number }[] = [
  { value: "TODAY", label: "Today", days: 1 },
  { value: "YESTERDAY", label: "Yesterday", days: 1 },
  { value: "LAST_3D", label: "Last 3 days", days: 3 },
  { value: "LAST_7D", label: "Last 7 days", days: 7 },
  { value: "LAST_14D", label: "Last 14 days", days: 14 },
  { value: "LAST_28D", label: "Last 28 days", days: 28 },
  { value: "LAST_30D", label: "Last 30 days", days: 30 },
  { value: "THIS_MONTH", label: "This month", days: 31 },
  { value: "LAST_MONTH", label: "Last month", days: 31 },
  { value: "LIFETIME", label: "Lifetime", days: 9999 },
  { value: "MAXIMUM", label: "37 months (maximum)", days: 9999 },
]

/**
 * A preset Meta returns that this list has never heard of must still read as English.
 * Printing `LAST_90D` in a column is how the previous spelling mistake stayed invisible.
 */
export function timeRangeLabel(value: string): string {
  const known = TIME_RANGES.find(t => t.value === value)
  if (known) return known.label
  const days = /^LAST_(\d+)D$/.exec(value)
  if (days) return `Last ${days[1]} days`
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, c => c.toUpperCase())
}

/** Meta evaluates and reports rules in the ad account's timezone, not the viewer's. */
export const ACCOUNT_TIMEZONE_NOTE = "All rule times are in the ad account's timezone"

/* ------------------------------------------------------------------ *
 * Encode — draft → Meta spec
 * ------------------------------------------------------------------ */

/** Meta takes monetary rule values in the account currency's minor unit (cents). */
export function toMinorUnits(value: string): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return "0"
  return String(Math.round(n * 100))
}

export function fromMinorUnits(value: string | number): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return "0"
  return (n / 100).toFixed(2)
}

function encodeConditionValue(metricKey: string, value: string): string {
  const metric = METRIC_CATALOG[metricKey]
  if (metric?.unit === "currency") return toMinorUnits(value)
  return String(value)
}

export function buildEvaluationSpec(draft: RuleDraft) {
  const filters: { field: string; value: unknown; operator: string }[] = [
    { field: "entity_type", value: draft.entityType, operator: "EQUAL" },
    { field: "time_preset", value: draft.timeRange, operator: "EQUAL" },
    // Present on 32 of 36 live rules. Omitting it lets Meta pick, which means two rules
    // written the same way can judge the same metric on different attribution — the kind
    // of difference nobody notices until the numbers disagree.
    { field: "attribution_window", value: "ACCOUNT_DEFAULT", operator: "EQUAL" },
  ]

  if (draft.activeOnly) {
    // Mirrors Meta's own copy: "your rule will apply to <entities> that are active at
    // the time the rule runs".
    filters.push({ field: "effective_status", value: ["ACTIVE"], operator: "IN" })
  }

  for (const c of draft.conditions) {
    const metric = METRIC_CATALOG[c.metric]
    if (!metric) continue
    filters.push({
      field: metric.field,
      value: encodeConditionValue(c.metric, c.value),
      operator: c.operator,
    })
  }

  return { evaluation_type: "SCHEDULE", filters }
}

/**
 * execution_options is an **array** of `{field, value, operator}` — not the flat object an
 * earlier version of this file emitted. Field order follows the live rules so a diff
 * against Ads Manager's own output stays readable.
 */
export function buildExecutionSpec(draft: RuleDraft) {
  const action = ACTIONS.find(a => a.value === draft.action)
  if (!action) throw new Error(`Unknown rule action: ${draft.action}`)

  const options: { field: string; value: unknown; operator: string }[] = []

  // `user_ids`, not `subscribers`. Every live rule carries it.
  if (draft.subscribers?.length) {
    options.push({ field: "user_ids", value: draft.subscribers.map(String), operator: "EQUAL" })
  }

  // Minutes Meta must wait before acting on the same entity again. 11 of 36 live rules set
  // it, always on budget rules — it is the throttle that keeps trap T1 from firing daily.
  if (draft.actionFrequencyMinutes) {
    options.push({
      field: "action_frequency",
      value: String(draft.actionFrequencyMinutes),
      operator: "EQUAL",
    })
  }

  if (draft.notifyOnFacebook !== false) {
    options.push({
      field: "alert_preferences",
      value: { instant: { trigger: "CHANGE" }, summary: { trigger: "CHANGE" } },
      operator: "EQUAL",
    })
  }

  if (action.needsAmount) {
    const raw = draft.actionAmount ?? "0"
    const unit = draft.actionUnit ?? action.amountUnit ?? "PERCENTAGE"
    const sign = draft.action.startsWith("DECREASE") ? -1 : 1
    const magnitude =
      unit === "ABSOLUTE" ? Number(toMinorUnits(raw)) : Math.round(Number(raw) || 0)
    // amount is a STRING and the sign carries the direction — Meta has no separate
    // increase/decrease type. `limit` is the ceiling for an increase and the floor for a
    // decrease, in minor units; `target_field` is null for daily budget.
    const changeSpec: Record<string, unknown> = {
      amount: String(sign * magnitude),
      unit,
      target_field: null,
    }
    if (draft.actionLimit) changeSpec.limit = toMinorUnits(draft.actionLimit)
    options.push({ field: "change_spec", value: changeSpec, operator: "EQUAL" })
  }

  const spec: Record<string, unknown> = {
    execution_type: resolveExecutionType(action, draft.entityType),
  }
  if (options.length) spec.execution_options = options
  return spec
}

export function buildScheduleSpec(draft: RuleDraft) {
  if (draft.scheduleType === "CUSTOM" && draft.customWindows?.length) {
    return {
      schedule_type: "CUSTOM",
      schedule: draft.customWindows.map(w => ({
        start_minute: w.startMinute,
        end_minute: w.endMinute,
        days: w.days,
      })),
    }
  }
  return { schedule_type: draft.scheduleType }
}

/* ------------------------------------------------------------------ *
 * Decode — Meta rule → what the list needs to render
 * ------------------------------------------------------------------ */

export interface ParsedRule {
  id: string
  name: string
  /** Meta's own value: ENABLED · DISABLED · HAS_ISSUES · DELETED */
  status: string
  enabled: boolean
  /**
   * Meta accepted the rule and then stopped being able to run it — a deleted target, a
   * metric the account no longer reports. It is neither on nor off, and collapsing it into
   * the toggle is exactly trap T7: the operator sees a switch in the "on" position and
   * assumes the rule is protecting the account.
   */
  hasIssues: boolean
  entityType: RuleEntityType
  timeRange: string
  scheduleType: string
  actionLabel: string
  conditionText: string
  appliedTo: string
  createdTime?: string
}

export function parseSpec(spec: unknown): any {
  if (!spec) return null
  if (typeof spec === "string") {
    try {
      return JSON.parse(spec)
    } catch {
      return null
    }
  }
  return spec
}

/**
 * Meta encodes a range as one comma-joined string ("4,6"), not as two values, so
 * IN_RANGE has to be split before each half can be formatted.
 */
function formatValue(field: string, value: unknown, operator = "EQUAL"): string {
  const entry = Object.values(METRIC_CATALOG).find(m => m.field === field)
  const isRange = operator === "IN_RANGE" || operator === "NOT_IN_RANGE"

  const parts = Array.isArray(value)
    ? value.map(v => String(v))
    : isRange
      ? String(value ?? "").split(",")
      : [String(value ?? "")]

  const rendered = parts.map(p => {
    const t = p.trim()
    if (!entry) return t
    if (entry.unit === "currency") return `$${fromMinorUnits(t)}`
    if (entry.unit === "percent") return `${t}%`
    return t
  })

  return isRange ? rendered.join(" and ") : rendered.join(", ")
}

function labelForField(field: string): string {
  const entry = Object.values(METRIC_CATALOG).find(m => m.field === field)
  return entry?.label ?? field
}

/** One entry of evaluation_spec.filters / execution_spec.execution_options. */
interface RuleFilter {
  field: string
  value: unknown
  operator: string
}

/** Filter values are usually scalar but Meta will return a single-element array. */
function readFilterValue(filters: RuleFilter[], field: string): unknown {
  const value = filters.find(f => f.field === field)?.value
  return Array.isArray(value) ? value[0] : value
}

/** Reads one execution_option out of the array shape Meta actually returns. */
function readExecutionOption(execution: { execution_options?: unknown } | null, field: string) {
  const options = execution?.execution_options
  if (!Array.isArray(options)) return undefined
  return (options as RuleFilter[]).find(o => o?.field === field)?.value
}

/** `campaign.name` scopes the rule; `offsite_conversion.fb_pixel_purchase` is a metric. */
function isScopeFilter(field: string): boolean {
  return field in SCOPE_FILTER_LABELS || /^(campaign|adset|ad)\./.test(field)
}

function isConditionFilter(field: string): boolean {
  return !STRUCTURAL_FILTER_FIELDS.includes(field) && !isScopeFilter(field)
}

function describeScope(f: RuleFilter): string {
  const label = SCOPE_FILTER_LABELS[f.field] ?? f.field
  const value = Array.isArray(f.value)
    ? f.value.map(v => String(v)).join(", ")
    : String(f.value ?? "")
  const quoted = f.operator === "CONTAIN" || f.operator === "NOT_CONTAIN" ? `"${value}"` : value
  return `${label} ${operatorEnglish(f.operator)} ${quoted}`
}

/** Reproduces Meta's "Action & condition" column, e.g.
 *  "Turn off ad sets" / "If Lifetime Spent is greater than $27.00 and Purchases (Meta pixel) is less than 1" */
export function parseRule(raw: any): ParsedRule {
  const evaluation = parseSpec(raw?.evaluation_spec)
  const execution = parseSpec(raw?.execution_spec)
  const schedule = parseSpec(raw?.schedule_spec)
  const filters: RuleFilter[] = evaluation?.filters ?? []

  const entityType = (readFilterValue(filters, "entity_type") as RuleEntityType) ?? "ADSET"
  const timeRange = String(readFilterValue(filters, "time_preset") ?? "LIFETIME")
  const plural = ENTITY_TYPES.find(e => e.value === entityType)?.plural ?? "entities"

  const executionType = execution?.execution_type ?? raw?.actions?.[0]?.type ?? ""
  const changeSpec = readExecutionOption(execution, "change_spec") as MetaChangeSpec | undefined
  const action = ACTIONS.find(a => a.value === resolveActionValue(executionType, changeSpec))

  let actionLabel = action ? action.label(plural) : executionType || "—"
  if (action?.needsAmount && changeSpec) {
    // The generic label ends in "by %" / "by amount" — with a real rule in hand, say the
    // number. `limit` is the ceiling or floor Meta will not cross, in minor units.
    const magnitude = Math.abs(Number(changeSpec.amount ?? 0))
    const isAbsolute = changeSpec.unit === "ABSOLUTE"
    const amountText = isAbsolute ? `$${fromMinorUnits(magnitude)}` : `${magnitude}%`
    const direction = Number(changeSpec.amount ?? 0) < 0 ? "Decrease" : "Increase"
    const bound =
      changeSpec.limit != null
        ? ` (${direction === "Increase" ? "up to" : "not below"} $${fromMinorUnits(changeSpec.limit)})`
        : ""
    actionLabel = `${direction} daily budget of ${plural} by ${amountText}${bound}`
  }

  const conditionFilters = filters.filter(f => isConditionFilter(f.field))
  const conditionText = conditionFilters.length
    ? "If " +
      conditionFilters
        .map(
          f =>
            `${labelForField(f.field)} ${operatorEnglish(f.operator)} ${formatValue(f.field, f.value, f.operator)}`
        )
        .join(" and ")
    : "No conditions"

  // Meta's own "Applied to" column: the entity set, narrowed by any scope filters.
  const activeOnly = filters.some(f => f.field === "effective_status")
  const scopes = filters.filter(f => isScopeFilter(f.field)).map(describeScope)
  const appliedTo =
    `${activeOnly ? "Active" : "All"} ${plural}` +
    (scopes.length ? ` where ${scopes.join(" and ")}` : "")

  const status = raw?.status ?? "DISABLED"

  return {
    id: String(raw?.id ?? ""),
    name: raw?.name ?? "(untitled rule)",
    status,
    enabled: status === "ENABLED",
    hasIssues: status === "HAS_ISSUES",
    entityType,
    timeRange,
    scheduleType: schedule?.schedule_type ?? "DAILY",
    actionLabel,
    conditionText,
    appliedTo,
    createdTime: raw?.created_time,
  }
}

/**
 * Meta rule → editable draft. The edit form must round-trip: opening a rule and saving it
 * unchanged has to produce the same spec, otherwise editing silently rewrites the rule.
 */
export function ruleToDraft(raw: any): RuleDraft {
  const evaluation = parseSpec(raw?.evaluation_spec)
  const execution = parseSpec(raw?.execution_spec)
  const schedule = parseSpec(raw?.schedule_spec)
  const filters: RuleFilter[] = evaluation?.filters ?? []

  const entityType = (readFilterValue(filters, "entity_type") as RuleEntityType) ?? "ADSET"
  const timeRange = String(readFilterValue(filters, "time_preset") ?? "LIFETIME")
  const activeOnly = filters.some(f => f.field === "effective_status")

  // Same split as parseRule: structural filters describe the rule, scope filters narrow it,
  // and only what remains is an editable condition. Feeding a scope filter into the
  // condition editor would let a save turn `campaign.name CONTAIN "CBO"` into a metric.
  const conditions: RuleCondition[] = filters
    .filter(f => isConditionFilter(f.field))
    .map(f => {
      const entry = Object.entries(METRIC_CATALOG).find(([, m]) => m.field === f.field)
      const key = entry?.[0] ?? f.field
      const unit = entry?.[1].unit
      return {
        metric: key,
        operator: String(f.operator ?? "GREATER_THAN"),
        value: unit === "currency" ? fromMinorUnits(String(f.value)) : String(f.value ?? ""),
      }
    })

  const executionType = execution?.execution_type ?? ""
  const changeSpec = readExecutionOption(execution, "change_spec") as MetaChangeSpec | undefined
  // amount arrives as a string with the sign attached.
  const amount = Number(changeSpec?.amount ?? 0)
  const unit = changeSpec?.unit === "ABSOLUTE" ? "ABSOLUTE" : "PERCENTAGE"
  const action = resolveActionValue(executionType, changeSpec)

  const subscribers = readExecutionOption(execution, "user_ids")
  const actionFrequency = readExecutionOption(execution, "action_frequency")

  return {
    name: raw?.name ?? "",
    entityType,
    activeOnly,
    action,
    actionAmount: changeSpec
      ? unit === "ABSOLUTE"
        ? fromMinorUnits(Math.abs(amount))
        : String(Math.abs(amount))
      : undefined,
    actionUnit: unit,
    actionLimit: changeSpec?.limit != null ? fromMinorUnits(changeSpec.limit) : undefined,
    actionFrequencyMinutes: actionFrequency != null ? Number(actionFrequency) : undefined,
    conditions,
    timeRange,
    scheduleType: (schedule?.schedule_type as RuleScheduleType) ?? "DAILY",
    customWindows: (schedule?.schedule ?? []).map((w: any) => ({
      startMinute: Number(w.start_minute ?? 0),
      endMinute: Number(w.end_minute ?? 0),
      days: w.days ?? [],
    })),
    subscribers: Array.isArray(subscribers) ? subscribers.map(String) : [],
    notifyOnFacebook: readExecutionOption(execution, "alert_preferences") != null,
  }
}

/* ------------------------------------------------------------------ *
 * Naming — the thing Meta has no field for
 * ------------------------------------------------------------------ */

/**
 * Meta gives rules one free-text name, so operators invent their own scheme. The live
 * account uses `ALL - OFF - Camp - (ROAS)`; specs/automate/06-meta-ui-reference.md §1.
 * We generate that name from the structured fields instead of asking people to retype it.
 */
const ENTITY_TOKEN: Record<RuleEntityType, string> = {
  CAMPAIGN: "Camp",
  ADSET: "Adset",
  AD: "Ad",
}

const ACTION_TOKEN: Record<string, string> = {
  PAUSE: "OFF",
  UNPAUSE: "ON",
  CHANGE_BUDGET: "BUDGET",
  CHANGE_CAMPAIGN_BUDGET: "BUDGET",
  NOTIFICATION: "ALERT",
}

/** Metrics that act as a spend floor rather than as the thing being judged. */
const SPEND_FLOOR_METRICS = ["spent", "lifetime_spent"]

const METRIC_TOKEN: Record<string, string> = {
  spent: "Spend",
  lifetime_spent: "Spend",
  purchases: "Sale",
  cost_per_purchase: "CPP",
  purchase_roas: "ROAS",
  cpc: "CPC",
  cpc_link: "CPC",
  cpm: "CPM",
  ctr: "CTR",
  frequency: "Freq",
  link_clicks: "Clicks",
}

export function suggestRuleName(draft: RuleDraft, scopeLabel = "ALL"): string {
  const action = ACTIONS.find(a => a.value === draft.action)
  const actionToken = action ? ACTION_TOKEN[action.executionType] ?? action.executionType : "?"

  // The spend floor is a guard, not the point of the rule — name it after what it judges.
  const judging = draft.conditions.filter(c => !SPEND_FLOOR_METRICS.includes(c.metric))
  const metrics = (judging.length ? judging : draft.conditions)
    .map(c => METRIC_TOKEN[c.metric] ?? METRIC_CATALOG[c.metric]?.label ?? c.metric)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(", ")

  return `${scopeLabel} - ${actionToken} - ${ENTITY_TOKEN[draft.entityType]} - (${metrics || "no metric"})`
}

/* ------------------------------------------------------------------ *
 * Schedule description — trap T5, two timezones
 * ------------------------------------------------------------------ */

export const PACIFIC_TZ = "America/Los_Angeles"

/** "12:00" Pacific rendered in the viewer's own timezone, so nobody has to do the maths. */
export function pacificHourInLocal(hour: number): string {
  // Any date works — we only need the current UTC offset difference.
  const probe = new Date()
  probe.setUTCHours(12, 0, 0, 0)
  const pacificHour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: PACIFIC_TZ }).format(probe)
  )
  const localHour = probe.getHours()
  const shifted = (((hour + (localHour - pacificHour)) % 24) + 24) % 24
  return `${String(shifted).padStart(2, "0")}:00`
}

export function describeSchedule(scheduleType: string): { label: string; detail: string } {
  if (scheduleType === "SEMI_HOURLY") {
    return {
      label: "Continuously",
      detail: "Runs as often as possible — usually every 30–60 minutes.",
    }
  }
  if (scheduleType === "CUSTOM") {
    return {
      label: "Custom",
      detail:
        "Runs on the days and times you choose. If start and end are the same, it runs once, within 30–60 minutes of that time.",
    }
  }
  return {
    label: "Daily",
    detail: `Runs once a day between 12:00 and 01:00 Pacific Time (${pacificHourInLocal(12)}–${pacificHourInLocal(1)} your time).`,
  }
}

/* ------------------------------------------------------------------ *
 * Guards — the traps from specs/automate/03-workflows.md
 * ------------------------------------------------------------------ */

export interface RuleWarning {
  code: "T1_BUDGET_CHURN" | "T2_ATTRIBUTION_LAG" | "T2_NO_SPEND_FLOOR" | "T6_NO_UNDO"
  severity: "block" | "warn"
  message: string
}

/**
 * Meta only prints a passive note about metric delay. We check the two combinations that
 * actually destroy accounts and say so at the moment the rule is written.
 */
export function checkRuleWarnings(draft: RuleDraft): RuleWarning[] {
  const warnings: RuleWarning[] = []
  const action = ACTIONS.find(a => a.value === draft.action)
  const range = TIME_RANGES.find(t => t.value === draft.timeRange)
  const usesLaggedMetric = draft.conditions.some(c => METRIC_CATALOG[c.metric]?.conversionLagged)
  // 18 of the 20 live spend floors use `lifetime_spent`, not `spent` — a check that only
  // knew about `spent` would warn on almost every correctly written rule.
  const hasSpendFloor = draft.conditions.some(
    c =>
      SPEND_FLOOR_METRICS.includes(c.metric) &&
      (c.operator === "GREATER_THAN" || c.operator === "GREATER_THAN_OR_EQUAL_TO")
  )

  // T1 — a budget change every 30-60 minutes keeps the ad set permanently in learning.
  if (action?.budgetMutating && draft.scheduleType === "SEMI_HOURLY") {
    warnings.push({
      code: "T1_BUDGET_CHURN",
      severity: "block",
      message:
        "A budget change on the continuous schedule runs every 30–60 minutes and will keep resetting the learning phase. Use Daily, or a custom window.",
    })
  }

  // T2 — conversion metrics keep moving for hours; judging them on today's data kills winners.
  if (usesLaggedMetric && range && range.days <= 1) {
    warnings.push({
      code: "T2_ATTRIBUTION_LAG",
      severity: "warn",
      message:
        "Conversion metrics keep changing for hours after the spend. On a 1-day window this rule will act on incomplete data — 3 days or more is safer.",
    })
  }

  // T2b — the pattern every rule in Seth's account uses: a spend floor before judging efficiency.
  if (usesLaggedMetric && !hasSpendFloor) {
    warnings.push({
      code: "T2_NO_SPEND_FLOOR",
      severity: "warn",
      message:
        "Without a minimum Spent condition this rule will judge brand-new entities that have barely spent anything.",
    })
  }

  // T6 — turning things off in bulk has no undo on Meta's side.
  if (action?.executionType === "PAUSE") {
    warnings.push({
      code: "T6_NO_UNDO",
      severity: "warn",
      message: "Turning entities off cannot be undone automatically. Preview the rule before enabling it.",
    })
  }

  return warnings
}
