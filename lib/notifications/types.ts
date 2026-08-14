/**
 * Notification vocabulary.
 *
 * A notification is stored as its *parts*, not as a finished sentence:
 *
 *   [Actor] + [Action] + [Object] + [Important change] + [Time]
 *
 * `title`/`body` are still written so rows stay readable by the pre-v2 client and by
 * any row created before 20260803_notifications_v2.sql was applied, but the parts are
 * what the renderer, the grouping logic and the change-history view read.
 */

export const NOTIFICATION_TYPES = [
  "ad.launched",
  "ad.launch_failed",
  "ad.status_changed",
  "ad.deleted",
  "campaign.updated",
  "adset.updated",
  "media.assigned",
  "media.upload_completed",
  "media.upload_failed",
  "creative.updated",
  "asset.uploaded",
  "request.assigned",
  "request.status_changed",
  "request.updated",
  "automation.updated",
  "automation.approval_pending",
  "automation.failed",
  "template.created",
  "template.updated",
  "member.joined",
  "member.role_changed",
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export type ObjectType =
  | "campaign"
  | "adset"
  | "ad"
  | "batch"
  | "creative"
  | "media_assignment"
  | "upload_job"
  | "request"
  | "template"
  | "automation"
  | "member"
  // Audit-only object types. Added for Tracking's App Activity block: these acts are
  // real work but nobody needs to be told about them, so they are written with
  // recordActivity() and never with emitNotification(). No NOTIFICATION_TYPE maps to
  // them on purpose — a notification for "someone saved a preset" is spam.
  | "preset"
  | "draft"
  | "painpoint"
  | "fallback"
  | "report"
  | "app_status"
  | "facebook_connection"
  | "organization"

/** One field that actually changed. `from`/`to` are already display-formatted. */
export type FieldChange = {
  field: string
  label: string
  from: string | null
  to: string | null
}

export type NotificationAction =
  | "launched"
  | "failed"
  | "updated"
  | "created"
  | "deleted"
  | "assigned"
  | "paused"
  | "activated"
  | "completed"
  | "joined"

/**
 * Which roles may receive which type.
 *
 * This is the permission check, not decoration: a `commenter` has no route into
 * ads-manager, so a launch notification linking there would be a dead link and a
 * leak of ad-account activity. Roles come from org_members.role — see
 * app/api/orgs/[id]/members/route.ts VALID_ROLES.
 */
export const ALL_ROLES = [
  "admin",
  "editor",
  "launcher",
  "uploader",
  "analyst",
  "commenter",
] as const

const LAUNCH_AUDIENCE = ["admin", "editor", "launcher"] as const
const MEDIA_AUDIENCE = ["admin", "editor", "launcher", "uploader"] as const
const OPS_AUDIENCE = ["admin", "editor"] as const

export const ROLE_VISIBILITY: Record<NotificationType, readonly string[]> = {
  "ad.launched": LAUNCH_AUDIENCE,
  "ad.launch_failed": LAUNCH_AUDIENCE,
  "ad.status_changed": LAUNCH_AUDIENCE,
  "ad.deleted": LAUNCH_AUDIENCE,
  "campaign.updated": LAUNCH_AUDIENCE,
  "adset.updated": LAUNCH_AUDIENCE,
  "media.assigned": MEDIA_AUDIENCE,
  "media.upload_completed": MEDIA_AUDIENCE,
  "media.upload_failed": MEDIA_AUDIENCE,
  "creative.updated": MEDIA_AUDIENCE,
  "asset.uploaded": MEDIA_AUDIENCE,
  "request.assigned": MEDIA_AUDIENCE,
  "request.status_changed": MEDIA_AUDIENCE,
  "request.updated": MEDIA_AUDIENCE,
  "automation.updated": OPS_AUDIENCE,
  "automation.approval_pending": OPS_AUDIENCE,
  "automation.failed": OPS_AUDIENCE,
  "template.created": LAUNCH_AUDIENCE,
  "template.updated": LAUNCH_AUDIENCE,
  "member.joined": OPS_AUDIENCE,
  "member.role_changed": OPS_AUDIENCE,
}

/** Emoji shown in the dropdown. Keyed by type so a new type never silently falls back. */
export const TYPE_ICON: Record<NotificationType, string> = {
  "ad.launched": "🚀",
  "ad.launch_failed": "⛔",
  "ad.status_changed": "⏯️",
  "ad.deleted": "🗑️",
  "campaign.updated": "✏️",
  "adset.updated": "✏️",
  "media.assigned": "📎",
  "media.upload_completed": "✅",
  "media.upload_failed": "⛔",
  "creative.updated": "✏️",
  "asset.uploaded": "🖼️",
  "request.assigned": "📌",
  "request.status_changed": "🔄",
  "request.updated": "✏️",
  "automation.updated": "⚡",
  "automation.approval_pending": "🔔",
  "automation.failed": "⛔",
  "template.created": "📋",
  "template.updated": "✏️",
  "member.joined": "👋",
  "member.role_changed": "🔑",
}

/** Types that report a failure — the UI tints these and never groups them away. */
export const FAILURE_TYPES: ReadonlySet<string> = new Set<string>([
  "ad.launch_failed",
  "media.upload_failed",
  "automation.failed",
])

/**
 * Legacy type ids written before 20260803. Kept so old rows still render with the
 * right icon and are not mistaken for an unknown type. `inspo_saved` had an icon in
 * the dropdown but no producer anywhere in the codebase — it is listed here for the
 * rows that never existed, and is not part of NOTIFICATION_TYPES.
 */
export const LEGACY_TYPE_ICON: Record<string, string> = {
  ad_launched: "🚀",
  template_created: "📋",
  asset_uploaded: "🖼️",
  member_joined: "👋",
  inspo_saved: "💡",
}

export function iconForType(type: string): string {
  return (
    TYPE_ICON[type as NotificationType] ??
    LEGACY_TYPE_ICON[type] ??
    "🔔"
  )
}
