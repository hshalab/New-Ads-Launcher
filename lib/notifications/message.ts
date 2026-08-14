import type { FieldChange, NotificationAction, ObjectType } from "./types"

/**
 * Message construction: [Actor] + [Action] + [Object] + [Important change] + [Time].
 *
 * Time is not part of the stored string — `created_at` is the time, and the client
 * renders it relative. Everything else is derived from parts here so wording can
 * change without migrating a single row.
 */

const OBJECT_LABEL: Record<ObjectType, string> = {
  campaign: "Campaign",
  adset: "Ad Set",
  ad: "Ad",
  batch: "Batch",
  creative: "Creative",
  media_assignment: "media assets",
  upload_job: "upload",
  request: "Request",
  template: "Template",
  automation: "Automation",
  member: "Member",
  preset: "Ad set preset",
  draft: "Launch draft",
  painpoint: "Weekly painpoint",
  fallback: "Meta Ads Manager fallback",
  report: "Tracking report",
  app_status: "App status tab",
  facebook_connection: "Facebook connection",
  organization: "Organization",
}

/** Field names whose *values* must never reach a notification or the audit log. */
const SECRET_FIELD = /token|secret|password|proof|api[_-]?key|access[_-]?key|cookie|credential/i

/** Fields whose value is too large to be readable — report that they changed, not to what. */
const OPAQUE_FIELD = /^(targeting|steps|conditions|actions|trigger_config|promoted_object|attribution_spec|data|settings|notif_config)$/

const FIELD_LABEL: Record<string, string> = {
  daily_budget: "Budget",
  lifetime_budget: "Lifetime budget",
  budget_amount: "Budget",
  status: "Status",
  name: "Name",
  headline: "Headline",
  primary_text: "Primary text",
  description: "Description",
  cta: "Call to action",
  link_url: "Link",
  bid_amount: "Bid",
  bid_strategy: "Bid strategy",
  optimization_goal: "Optimization goal",
  start_time: "Start time",
  end_time: "End time",
  due_date: "Due date",
  role: "Role",
  targeting: "Targeting",
  steps: "Workflow steps",
  conditions: "Conditions",
  actions: "Actions",
}

export function labelForField(field: string): string {
  if (FIELD_LABEL[field]) return FIELD_LABEL[field]
  return field.replace(/_/g, " ").replace(/^./, c => c.toUpperCase())
}

function displayValue(field: string, value: unknown): string | null {
  if (SECRET_FIELD.test(field)) return "[redacted]"
  if (value === null || value === undefined || value === "") return null
  if (OPAQUE_FIELD.test(field)) return null
  if (typeof value === "object") return null
  return String(value)
}

/**
 * Diff two snapshots into the change list a notification carries.
 *
 * Only keys present in `after` are considered — a PATCH that omits a field is not
 * asserting anything about it. Equal values drop out, which is what makes
 * "edited and reverted" produce no notification at all.
 */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields?: readonly string[]
): FieldChange[] {
  if (!after) return []
  const keys = fields ?? Object.keys(after)
  const changes: FieldChange[] = []

  for (const field of keys) {
    if (!(field in after)) continue
    const from = before ? before[field] : undefined
    const to = after[field]
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue

    changes.push({
      field,
      label: labelForField(field),
      from: displayValue(field, from),
      to: displayValue(field, to),
    })
  }
  return changes
}

/** Strip secret values from a change list built elsewhere. */
export function redactChanges(changes: FieldChange[]): FieldChange[] {
  return changes.map(c =>
    SECRET_FIELD.test(c.field)
      ? { ...c, from: "[redacted]", to: "[redacted]" }
      : c
  )
}

const ACTION_VERB: Record<NotificationAction, string> = {
  launched: "launched",
  failed: "failed",
  updated: "updated",
  created: "created",
  deleted: "deleted",
  assigned: "assigned",
  paused: "paused",
  activated: "activated",
  completed: "completed",
  joined: "joined",
}

/** `12 ads`, `1 ad`, `Campaign "Summer Sale"`, `Campaign`. */
function describeTarget(
  objectType: ObjectType,
  objectName: string | null | undefined,
  count: number | null | undefined
): string {
  const label = OBJECT_LABEL[objectType]
  if (count && count >= 1 && !objectName) {
    const noun = label.toLowerCase()
    return count === 1 ? `1 ${noun}` : `${count} ${noun}${noun.endsWith("s") ? "" : "s"}`
  }
  return objectName ? `${label} "${objectName}"` : label
}

export function buildTitle(input: {
  actorName: string
  action: NotificationAction
  objectType: ObjectType
  objectName?: string | null
  count?: number | null
  /** Trailing clause: `{ preposition: "to", name: "Hooray 37" }` → `… to Hooray 37`. */
  context?: { preposition: string; name: string } | null
}): string {
  const { actorName, action, objectType, objectName, count, context } = input
  const verb = ACTION_VERB[action] ?? action
  const tail = context?.name ? ` ${context.preposition} ${context.name}` : ""

  if (action === "joined") return `${actorName} joined the workspace.`

  if (action === "failed") {
    const what = describeTarget(objectType, objectName, count)
    if (objectType === "batch" || objectType === "ad") return `Launch failed for ${what}${tail}.`
    if (objectType === "upload_job") return `Upload failed for ${what}${tail}.`
    return `${what} failed${tail}.`
  }

  return `${actorName} ${verb} ${describeTarget(objectType, objectName, count)}${tail}.`
}

/**
 * The [Important change] clause.
 *
 * At most two changes are spelled out — beyond that the sentence stops being
 * readable and the change history is the right place to look.
 */
export function buildBody(changes: FieldChange[], fallback?: string | null): string | null {
  if (!changes.length) return fallback ?? null

  const spoken = changes.slice(0, 2).map(c => {
    if (c.from !== null && c.to !== null) return `${c.label} changed from ${c.from} to ${c.to}`
    if (c.to !== null) return `${c.label} set to ${c.to}`
    if (c.from !== null) return `${c.label} cleared`
    return `${c.label} changed`
  })

  const rest = changes.length - spoken.length
  const tail = rest > 0 ? `, and ${rest} more field${rest === 1 ? "" : "s"}` : ""
  return `${spoken.join("; ")}${tail}.`
}

/** Meta stores money in minor units. `70000` on a USD account is `$700`. */
export function formatMoneyMinor(minor: unknown, currency = "USD"): string | null {
  const n = typeof minor === "string" ? Number(minor) : typeof minor === "number" ? minor : NaN
  if (!Number.isFinite(n)) return null
  const symbol = currency === "USD" ? "$" : ""
  const major = n / 100
  return `${symbol}${major.toLocaleString("en-US", { maximumFractionDigits: 2 })}${symbol ? "" : ` ${currency}`}`
}
