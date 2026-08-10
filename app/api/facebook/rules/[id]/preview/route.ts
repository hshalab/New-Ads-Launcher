import { NextRequest, NextResponse } from "next/server"
import {
  METRIC_CATALOG,
  SCOPE_FILTER_LABELS,
  STRUCTURAL_FILTER_FIELDS,
  parseSpec,
  type RuleEntityType,
} from "@/lib/meta-ad-rules"
import { GRAPH, RULE_FIELDS, graphError, isErrorResponse, resolveRuleRequest } from "../../_shared"

export const dynamic = "force-dynamic"

interface RuleFilter {
  field: string
  value: unknown
  operator: string
}

const ENTITY_EDGE: Record<RuleEntityType, string> = {
  CAMPAIGN: "campaigns",
  ADSET: "adsets",
  AD: "ads",
}

const ENTITY_FIELDS: Record<RuleEntityType, string> = {
  CAMPAIGN: "id,name,effective_status",
  ADSET: "id,name,effective_status,campaign{id,name}",
  AD: "id,name,effective_status,adset{id,name},campaign{id,name}",
}

const INSIGHT_FIELDS = [
  "spend",
  "frequency",
  "impressions",
  "reach",
  "clicks",
  "cpc",
  "cpm",
  "ctr",
  "actions",
  "cost_per_action_type",
  "purchase_roas",
].join(",")

function readFilterValue(filters: RuleFilter[], field: string): unknown {
  const value = filters.find(f => f.field === field)?.value
  return Array.isArray(value) ? value[0] : value
}

function isScopeFilter(field: string): boolean {
  return field in SCOPE_FILTER_LABELS || /^(campaign|adset|ad)\./.test(field)
}

function isConditionFilter(field: string): boolean {
  return !STRUCTURAL_FILTER_FIELDS.includes(field) && !isScopeFilter(field)
}

function scalarValues(value: unknown) {
  return (Array.isArray(value) ? value : [value]).map(v => String(v ?? "").toLowerCase())
}

function entityFieldValue(entity: any, entityType: RuleEntityType, field: string): string {
  if (field === "campaign.name") return entityType === "CAMPAIGN" ? entity.name ?? "" : entity.campaign?.name ?? ""
  if (field === "campaign.id") return entityType === "CAMPAIGN" ? entity.id ?? "" : entity.campaign?.id ?? entity.campaign_id ?? ""
  if (field === "adset.name") return entityType === "ADSET" ? entity.name ?? "" : entity.adset?.name ?? ""
  if (field === "adset.id") return entityType === "ADSET" ? entity.id ?? "" : entity.adset?.id ?? entity.adset_id ?? ""
  if (field === "ad.name") return entityType === "AD" ? entity.name ?? "" : ""
  if (field === "ad.id") return entityType === "AD" ? entity.id ?? "" : ""
  if (field === "effective_status") return entity.effective_status ?? ""
  return ""
}

function matchesTextFilter(actual: string, operator: string, value: unknown): boolean {
  const left = actual.toLowerCase()
  const right = scalarValues(value)
  if (operator === "CONTAIN") return right.some(v => left.includes(v))
  if (operator === "NOT_CONTAIN") return right.every(v => !left.includes(v))
  if (operator === "IN" || operator === "EQUAL") return right.includes(left)
  if (operator === "NOT_IN" || operator === "NOT_EQUAL") return !right.includes(left)
  return true
}

function arrayValue(rows: any[] | undefined, actionType: string): number {
  return Number(rows?.find(r => r.action_type === actionType)?.value ?? 0)
}

function metricValue(insights: any, field: string): number {
  if (!insights) return 0
  if (field === "lifetime_spent" || field === "spent") return Number(insights.spend ?? 0)
  if (field === "link_click") return arrayValue(insights.actions, "link_click") || Number(insights.clicks ?? 0)
  if (field === "offsite_conversion.fb_pixel_purchase") return arrayValue(insights.actions, field)
  if (field === "cost_per_purchase_fb") return arrayValue(insights.cost_per_action_type, "offsite_conversion.fb_pixel_purchase")
  if (field === "website_purchase_roas") return arrayValue(insights.purchase_roas, field) || Number(insights.purchase_roas?.[0]?.value ?? 0)
  return Number(insights[field] ?? 0)
}

function compareMetric(actualRaw: number, filter: RuleFilter): boolean {
  const metric = Object.values(METRIC_CATALOG).find(m => m.field === filter.field)
  const actual = metric?.unit === "currency" ? Math.round(actualRaw * 100) : actualRaw
  const target = Number(filter.value)

  if (filter.operator === "IN_RANGE" || filter.operator === "NOT_IN_RANGE") {
    const [min, max] = String(filter.value ?? "").split(",").map(Number)
    const matched = actual >= min && actual <= max
    return filter.operator === "IN_RANGE" ? matched : !matched
  }
  if (!Number.isFinite(target)) return false
  if (filter.operator === "GREATER_THAN") return actual > target
  if (filter.operator === "LESS_THAN") return actual < target
  if (filter.operator === "EQUAL") return Math.abs(actual - target) < 0.0001
  if (filter.operator === "NOT_EQUAL") return Math.abs(actual - target) >= 0.0001
  if (filter.operator === "GREATER_THAN_OR_EQUAL_TO") return actual >= target
  if (filter.operator === "LESS_THAN_OR_EQUAL_TO") return actual <= target
  return false
}

async function graphGet(url: string) {
  const res = await fetch(url)
  const data = await res.json()
  if (data.error) throw data
  return data
}

async function fetchEntities(url: string) {
  const entities: any[] = []
  let next: string | null = url
  let pages = 0

  while (next && pages < 5) {
    const data = await graphGet(next)
    entities.push(...(data.data || []))
    next = data.paging?.next || null
    pages++
  }

  return { entities, truncated: Boolean(next) }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await resolveRuleRequest(request, "read")
    if (isErrorResponse(resolved)) return resolved
    const { id } = await params

    const rule = await graphGet(`${GRAPH}/${id}?fields=${RULE_FIELDS}&access_token=${resolved.token}`)
    const filters: RuleFilter[] = parseSpec(rule.evaluation_spec)?.filters ?? []
    const entityType = (readFilterValue(filters, "entity_type") as RuleEntityType) ?? "ADSET"
    const timePreset = String(readFilterValue(filters, "time_preset") ?? "LIFETIME").toLowerCase()
    const fields = `${ENTITY_FIELDS[entityType]},insights.date_preset(${timePreset}){${INSIGHT_FIELDS}}`
    const edge = ENTITY_EDGE[entityType]
    const { entities, truncated } = await fetchEntities(
      `${GRAPH}/${resolved.accountPath}/${edge}?fields=${encodeURIComponent(fields)}&limit=500&access_token=${resolved.token}`
    )

    const scopeFilters = filters.filter(f => isScopeFilter(f.field) || f.field === "effective_status")
    const conditionFilters = filters.filter(f => isConditionFilter(f.field))
    const matched = entities.filter(entity => {
      if (!scopeFilters.every(f => matchesTextFilter(entityFieldValue(entity, entityType, f.field), f.operator, f.value))) return false
      const insights = entity.insights?.data?.[0]
      return conditionFilters.every(f => compareMetric(metricValue(insights, f.field), f))
    })

    return NextResponse.json({
      entities: matched.map(({ id, name, effective_status }) => ({ id, name, effective_status })),
      count: matched.length,
      truncated,
    })
  } catch (err: any) {
    if (err?.error) return graphError(err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
