// Filter model for the Ads Manager chip bar (BL-43).
//
// Chips are AND-ed. Always. Two chips on the same field still AND — that matches
// Meta Ads Manager, where `name contains US` + `name contains COPY` narrows rather
// than widens. There is no OR, no grouping and no nesting in v1: `contains all of`
// is the only multi-term operator and it is per-chip.
//
// Everything here is pure and level-agnostic. The page owns the row shapes and
// passes an accessor context in — that keeps this file testable and stops the
// 4,700-line page from growing another 300.

import { COLUMN_MAP, type ColumnDef } from "./column-config"
import { localDateRangeToUtc } from "./local-date-range"

export type FilterLevel = "campaigns" | "adsets" | "ads"
export type FilterFieldType = NonNullable<ColumnDef["filterType"]>

export type FilterOperator =
  | "contains_all" | "not_contains" | "is" | "is_not" | "starts_with"
  | "gt" | "gte" | "lt" | "lte" | "eq" | "between" | "is_set" | "is_not_set"
  | "before" | "after" | "in_last_days"

export interface FilterChip {
  id: string
  field: string
  operator: FilterOperator
  /** One entry for most operators, two for `between`, none for `is_set` / `is_not_set`. */
  values: string[]
  /**
   * Frozen at apply time for `__selected_rows`. A snapshot, not a live binding —
   * deselecting rows afterwards must not change what the chip matches. Verified
   * against Meta, where `Filtering 9 ad sets` coexists with a `6 selected` counter.
   */
  snapshotIds?: string[]
  snapshotLevel?: FilterLevel
}

export interface FilterField {
  id: string
  label: string
  type: FilterFieldType
  levels: FilterLevel[]
  /** `entity` reads the row, `metric` reads insights, `special` is the selection snapshot. */
  source: "entity" | "metric" | "special"
}

export const SELECTED_ROWS_FIELD = "__selected_rows"
const ALL_LEVELS: FilterLevel[] = ["campaigns", "adsets", "ads"]

/**
 * Fields that are not columns. The name and ID of a row are rendered by the frozen
 * left block rather than by a ColumnDef, and the parent-name lookups are maps built
 * in the page — so they cannot come from COLUMN_DEFS and are declared here instead.
 */
const NON_COLUMN_FIELDS: FilterField[] = [
  { id: "name",          label: "Name",          type: "text", levels: ALL_LEVELS,          source: "entity" },
  { id: "id",            label: "ID",            type: "text", levels: ALL_LEVELS,          source: "entity" },
  { id: "campaign_name", label: "Campaign name", type: "text", levels: ALL_LEVELS,          source: "entity" },
  { id: "adset_name",    label: "Ad set name",   type: "text", levels: ["adsets", "ads"],   source: "entity" },
]

/**
 * Column labels are written for a table header, where there is room. `Purchase ROAS
 * (return on ad spend)` inside a chip pushes the input off the row, so filtering uses
 * a short form. Only the display string differs; the field id is the column id.
 */
const SHORT_LABELS: Record<string, string> = {
  roas: "ROAS",
  date_created: "Created",
}

/** Display order in the dropdown. Also the definition of "the v1 field set". */
const FIELD_ORDER = [
  "name", "id", "campaign_name", "adset_name",
  "objective", "spend", "impressions", "roas", "date_created",
]

function fromColumn(id: string): FilterField | null {
  const col = COLUMN_MAP[id]
  if (!col?.filterType || col.filterType === "none") return null
  return {
    id: col.id,
    label: SHORT_LABELS[col.id] ?? col.label,
    type: col.filterType,
    levels: col.filterLevels ?? ALL_LEVELS,
    source: col.filterType === "text" || col.filterType === "enum" ? "entity" : "metric",
  }
}

/**
 * The catalog is generated, not hand-maintained: a column becomes filterable by
 * gaining a `filterType`, and a new column gets a filter for free. That is why v1
 * ships 9 fields out of 60 without a second list to keep in sync.
 */
export const FILTER_FIELDS: FilterField[] = FIELD_ORDER
  .map(id => NON_COLUMN_FIELDS.find(f => f.id === id) ?? fromColumn(id))
  .filter((f): f is FilterField => Boolean(f))

export const SELECTED_ROWS_LABEL = "Filter selected rows only"

export function filterFieldById(id: string): FilterField | undefined {
  if (id === SELECTED_ROWS_FIELD) {
    return { id, label: SELECTED_ROWS_LABEL, type: "none", levels: ALL_LEVELS, source: "special" }
  }
  return FILTER_FIELDS.find(f => f.id === id)
}

export function fieldsForLevel(level: FilterLevel): FilterField[] {
  return FILTER_FIELDS.filter(f => f.levels.includes(level))
}

/**
 * A chip is invalid when its field does not exist at the current level — `Objective`
 * on the Ads tab, for example. Invalid chips are kept, greyed and tooltipped rather
 * than dropped: a filter that silently vanishes on a tab switch is worse than one
 * that is visibly inactive.
 */
export function isChipValidAt(chip: FilterChip, level: FilterLevel): boolean {
  if (chip.field === SELECTED_ROWS_FIELD) return true
  const field = filterFieldById(chip.field)
  return Boolean(field?.levels.includes(level))
}

export const OPERATORS: Record<FilterFieldType, Array<[FilterOperator, string]>> = {
  text: [
    ["contains_all", "contains all of"],
    ["not_contains", "doesn't contain"],
    ["is", "is"],
    ["is_not", "is not"],
    ["starts_with", "starts with"],
  ],
  enum: [["is", "is"], ["is_not", "is not"]],
  number: [
    ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["eq", "="],
    ["between", "between"], ["is_set", "is set"], ["is_not_set", "is not set"],
  ],
  currency: [
    ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["eq", "="],
    ["between", "between"], ["is_set", "is set"], ["is_not_set", "is not set"],
  ],
  percent: [
    ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["eq", "="],
    ["between", "between"], ["is_set", "is set"], ["is_not_set", "is not set"],
  ],
  date: [
    ["before", "before"], ["after", "after"], ["between", "between"],
    ["in_last_days", "in the last N days"],
  ],
  none: [["is", "is"]],
}

export function operatorsFor(type: FilterFieldType): Array<[FilterOperator, string]> {
  return OPERATORS[type] ?? OPERATORS.text
}

export function operatorLabel(type: FilterFieldType, op: FilterOperator): string {
  return operatorsFor(type).find(([id]) => id === op)?.[1] ?? op
}

export function defaultOperator(type: FilterFieldType): FilterOperator {
  return operatorsFor(type)[0][0]
}

export function operatorTakesNoValue(op: FilterOperator): boolean {
  return op === "is_set" || op === "is_not_set"
}

/** How the page exposes one row to the matcher. */
export interface ChipEvalContext {
  rowId: string
  /** Entity text for a field id — name, id, campaign_name, adset_name, objective. */
  text: (fieldId: string) => string
  /** Metric value, or null when it cannot be resolved. */
  number: (fieldId: string) => number | null
  /**
   * False when the row carries no insights row at all. This is what separates
   * "spent nothing" from "no data": without it, `spend < 100` silently sweeps in
   * every object that never delivered, because the metric resolvers return 0.
   */
  hasInsights: boolean
  /** ISO string from `created_time`, or null. */
  createdAt: string | null
  /** Parent ids for `__selected_rows` cross-level matching: a chip snapshot taken
   *  at the Campaigns tab holds campaign ids, so an Ad row matches via its
   *  `campaign_id` — not its own id. */
  campaignId?: string
  adsetId?: string
}

function matchText(op: FilterOperator, haystack: string, needle: string): boolean {
  const hay = haystack.toLowerCase()
  const q = needle.trim().toLowerCase()
  if (!q) return true
  switch (op) {
    // Meta's `contains all of` is per-word: every whitespace-separated term must appear.
    case "contains_all": return q.split(/\s+/).every(term => hay.includes(term))
    case "not_contains": return !hay.includes(q)
    case "is":           return hay === q
    case "is_not":       return hay !== q
    case "starts_with":  return hay.startsWith(q)
    default:             return hay.includes(q)
  }
}

function matchNumber(op: FilterOperator, value: number | null, hasInsights: boolean, values: string[]): boolean {
  const present = hasInsights && value !== null && Number.isFinite(value)
  if (op === "is_set")     return present
  if (op === "is_not_set") return !present
  if (!present) return false           // no insights row is not zero — see ChipEvalContext
  const n = value as number
  const a = Number(values[0])
  if (!Number.isFinite(a)) return true
  switch (op) {
    case "gt":  return n > a
    case "gte": return n >= a
    case "lt":  return n < a
    case "lte": return n <= a
    case "eq":  return n === a
    case "between": {
      const b = Number(values[1])
      return Number.isFinite(b) ? n >= Math.min(a, b) && n <= Math.max(a, b) : n >= a
    }
    default: return true
  }
}

function matchDate(op: FilterOperator, createdAt: string | null, values: string[]): boolean {
  if (!createdAt) return false
  const t = new Date(createdAt).getTime()
  if (!Number.isFinite(t)) return false
  if (op === "in_last_days") {
    const days = Number(values[0])
    if (!Number.isFinite(days)) return true
    return t >= Date.now() - days * 86_400_000
  }
  const offset = new Date().getTimezoneOffset()
  const first = localDateRangeToUtc(values[0], values[0], offset)
  const a = first.startIso ? Date.parse(first.startIso) : Number.NaN
  const aEnd = first.endExclusiveIso ? Date.parse(first.endExclusiveIso) : Number.NaN
  if (!Number.isFinite(a) || !Number.isFinite(aEnd)) return true
  switch (op) {
    case "before": return t < a
    case "after":  return t >= aEnd
    case "between": {
      const second = localDateRangeToUtc(values[1], values[1], offset)
      const b = second.startIso ? Date.parse(second.startIso) : Number.NaN
      const bEnd = second.endExclusiveIso ? Date.parse(second.endExclusiveIso) : Number.NaN
      if (!Number.isFinite(b) || !Number.isFinite(bEnd)) return t >= a && t < aEnd
      return t >= Math.min(a, b) && t < Math.max(aEnd, bEnd)
    }
    default: return true
  }
}

export function matchesChip(chip: FilterChip, ctx: ChipEvalContext): boolean {
  if (chip.field === SELECTED_ROWS_FIELD) {
    const ids = chip.snapshotIds ?? []
    return ids.includes(ctx.rowId) ||
      (ctx.campaignId ? ids.includes(ctx.campaignId) : false) ||
      (ctx.adsetId ? ids.includes(ctx.adsetId) : false)
  }
  const field = filterFieldById(chip.field)
  if (!field) return true

  switch (field.type) {
    case "text":
      return matchText(chip.operator, ctx.text(field.id), chip.values[0] ?? "")
    case "enum": {
      const current = ctx.text(field.id)
      const hit = chip.values.some(v => v.toLowerCase() === current.toLowerCase())
      return chip.operator === "is_not" ? !hit : hit
    }
    case "number":
    case "currency":
    case "percent":
      return matchNumber(chip.operator, ctx.number(field.id), ctx.hasInsights, chip.values)
    case "date":
      return matchDate(chip.operator, ctx.createdAt, chip.values)
    default:
      return true
  }
}

/**
 * Cheapest and most selective predicate first: the selection snapshot is a Set
 * membership test over a frozen id list, while a metric chip walks the insights row.
 */
export function orderChipsForEval(chips: FilterChip[]): FilterChip[] {
  return [...chips].sort((a, b) => {
    const rank = (c: FilterChip) =>
      c.field === SELECTED_ROWS_FIELD ? 0 : filterFieldById(c.field)?.source === "metric" ? 2 : 1
    return rank(a) - rank(b)
  })
}

export function chipSummary(chip: FilterChip): { label: string; operator: string; value: string } {
  if (chip.field === SELECTED_ROWS_FIELD) {
    return { label: "Filtering", operator: "", value: `${(chip.snapshotIds ?? []).length} selected` }
  }
  const field = filterFieldById(chip.field)
  const type = field?.type ?? "text"
  return {
    label: field?.label ?? chip.field,
    operator: operatorLabel(type, chip.operator),
    value: operatorTakesNoValue(chip.operator) ? "" : chip.values.filter(Boolean).join(" – "),
  }
}

export function newChipId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `chip_${Math.random().toString(36).slice(2)}`
}

// ─── Recent filters ───────────────────────────────────────────────────────────
// Per-browser, not per-account: migrations are locked on the shared Supabase
// project, so there is no table for this. Same pattern as adsmanager_col_presets.

export const RECENT_FILTERS_KEY = "adsmanager_recent_filters_v1"
const RECENT_LIMIT = 5

export type RecentFilter = Pick<FilterChip, "field" | "operator" | "values">

export function loadRecentFilters(): RecentFilter[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(RECENT_FILTERS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

export function rememberFilter(chip: FilterChip): RecentFilter[] {
  if (chip.field === SELECTED_ROWS_FIELD) return loadRecentFilters()
  const entry: RecentFilter = { field: chip.field, operator: chip.operator, values: chip.values }
  const key = (f: RecentFilter) => `${f.field}|${f.operator}|${f.values.join("|")}`
  const next = [entry, ...loadRecentFilters().filter(f => key(f) !== key(entry))].slice(0, RECENT_LIMIT)
  try { window.localStorage.setItem(RECENT_FILTERS_KEY, JSON.stringify(next)) } catch { /* quota or private mode */ }
  return next
}

/**
 * Hardcoded. Nothing measures which filters are actually popular — BL-12 is not
 * built — so this list is a starting point, not personalisation, and the UI must
 * not imply otherwise.
 */
export const POPULAR_FILTERS: RecentFilter[] = [
  { field: "spend", operator: "gt", values: ["0"] },
  { field: "impressions", operator: "gt", values: ["0"] },
  { field: "roas", operator: "gte", values: ["1"] },
]

// ─── Active filter bag ────────────────────────────────────────────────────────
// Survives refresh and in-app nav until the user clears a control. Scoped per
// ad account so switching accounts does not leak chips/date/status.

export const FILTER_STATE_KEY = "adsmanager_filter_state_v1"

export interface AdsManagerFilterState {
  tab: FilterLevel
  search: string
  statusFilter: "all" | "ACTIVE" | "PAUSED"
  chips: FilterChip[]
  campaignFilter: string[]
  adSetFilter: string[]
  datePreset: string
  customDateRange: { start: string; end: string } | null
  sortField: string | null
  sortDir: "asc" | "desc"
  breakdowns: string[]
}

function filterStateStorageKey(accountId: string): string {
  return `${FILTER_STATE_KEY}:${accountId}`
}

function isFilterLevel(v: unknown): v is FilterLevel {
  return v === "campaigns" || v === "adsets" || v === "ads"
}

function isStatusFilter(v: unknown): v is AdsManagerFilterState["statusFilter"] {
  return v === "all" || v === "ACTIVE" || v === "PAUSED"
}

function isChipLike(v: unknown): v is FilterChip {
  if (!v || typeof v !== "object") return false
  const c = v as FilterChip
  return typeof c.id === "string"
    && typeof c.field === "string"
    && typeof c.operator === "string"
    && Array.isArray(c.values)
}

function isDateString(v: unknown): v is string {
  return typeof v === "string" && Number.isFinite(new Date(v).getTime())
}

export function loadAdsManagerFilterState(accountId: string): AdsManagerFilterState | null {
  if (typeof window === "undefined" || !accountId) return null
  try {
    const raw = window.localStorage.getItem(filterStateStorageKey(accountId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AdsManagerFilterState>
    if (!parsed || typeof parsed !== "object") return null
    return {
      tab: isFilterLevel(parsed.tab) ? parsed.tab : "campaigns",
      search: typeof parsed.search === "string" ? parsed.search : "",
      statusFilter: isStatusFilter(parsed.statusFilter) ? parsed.statusFilter : "ACTIVE",
      chips: Array.isArray(parsed.chips) ? parsed.chips.filter(isChipLike) : [],
      campaignFilter: Array.isArray(parsed.campaignFilter) ? parsed.campaignFilter.filter((id): id is string => typeof id === "string") : [],
      adSetFilter: Array.isArray(parsed.adSetFilter) ? parsed.adSetFilter.filter((id): id is string => typeof id === "string") : [],
      datePreset: typeof parsed.datePreset === "string" && parsed.datePreset ? parsed.datePreset : "last_7d",
      customDateRange: parsed.customDateRange
        && isDateString(parsed.customDateRange.start)
        && isDateString(parsed.customDateRange.end)
        ? { start: parsed.customDateRange.start, end: parsed.customDateRange.end }
        : null,
      sortField: typeof parsed.sortField === "string" ? parsed.sortField : null,
      sortDir: parsed.sortDir === "desc" ? "desc" : "asc",
      breakdowns: Array.isArray(parsed.breakdowns)
        ? parsed.breakdowns.filter((id): id is string => typeof id === "string")
        : [],
    }
  } catch {
    return null
  }
}

export function saveAdsManagerFilterState(accountId: string, state: AdsManagerFilterState): void {
  if (typeof window === "undefined" || !accountId) return
  try {
    window.localStorage.setItem(filterStateStorageKey(accountId), JSON.stringify(state))
  } catch { /* quota or private mode */ }
}
