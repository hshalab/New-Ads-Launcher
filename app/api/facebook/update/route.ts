import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getConnectionForAdAccount, isManual, MissingViaError, requireRole } from "@/lib/auth"
import { getNodeTargeting, updateNode } from "@/lib/facebook"
import { mergeEditorTargeting } from "@/lib/targeting-merge"
import { assertMetaNodeUnchanged } from "@/lib/optimistic-update"
import { emitAndLog } from "@/lib/notifications/emit"
import { diffFields, formatMoneyMinor } from "@/lib/notifications/message"
import type { FieldChange, NotificationType, ObjectType } from "@/lib/notifications/types"
import { invalidateMetaReadCacheAfterWrite } from "../_db-cache"

type Level = "campaign" | "adset" | "ad"

/**
 * Which level the node is. Meta ids do not say, and asking Meta for a field the node
 * does not have is an error, so the read has to know first.
 *
 * The client sends `level`; the payload shape is the fallback for callers not yet
 * updated. Getting this wrong only affects wording and which fields are read back —
 * never whether the write happens.
 */
function resolveLevel(body: Record<string, any>): Level {
  const explicit = body.level
  if (explicit === "campaign" || explicit === "adset" || explicit === "ad") return explicit
  if (body.targeting !== undefined || body.optimization_goal !== undefined
    || body.bid_amount !== undefined || body.promoted_object !== undefined
    || body.publisher_platforms !== undefined) return "adset"
  if (body.objective !== undefined || body.special_ad_categories !== undefined) return "campaign"
  return "adset"
}

const LEVEL_OBJECT: Record<Level, ObjectType> = {
  campaign: "campaign",
  adset: "adset",
  ad: "ad",
}

const LEVEL_TYPE: Record<Level, NotificationType> = {
  campaign: "campaign.updated",
  adset: "adset.updated",
  ad: "ad.status_changed",
}

/** Fields safe to request per level — a nonexistent field is a Graph error, not a null. */
const READ_FIELDS: Record<Level, string[]> = {
  campaign: ["status", "daily_budget", "lifetime_budget", "start_time", "stop_time", "bid_strategy"],
  adset: [
    "status", "daily_budget", "lifetime_budget", "start_time", "end_time",
    "optimization_goal", "bid_strategy", "bid_amount",
  ],
  ad: ["status"],
}

const MONEY_FIELDS = new Set(["daily_budget", "lifetime_budget", "bid_amount"])

/** Meta stores money in minor units, so a raw diff reads "50000 → 70000". */
function humanizeMoney(changes: FieldChange[], currency: string): FieldChange[] {
  return changes.map(c =>
    MONEY_FIELDS.has(c.field)
      ? { ...c, from: formatMoneyMinor(c.from, currency) ?? c.from, to: formatMoneyMinor(c.to, currency) ?? c.to }
      : c
  )
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const denied = requireRole(ctx)
    if (denied) return denied

    const body = await request.json()
    const {
      id, name, status, daily_budget, lifetime_budget, start_time, end_time, adAccountId,
      optimization_goal, bid_strategy, bid_amount, attribution_spec, promoted_object, targeting,
      publisher_platforms, device_platforms, facebook_positions, instagram_positions,
      audience_network_positions, messenger_positions, advertiser, payer
    } = body

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    // Via MECE: mutation = WRITE → via launch của account → OAuth → block (VIA-MASTER.md)
    let connection
    try {
      connection = await getConnectionForAdAccount(ctx.orgId, adAccountId, "write")
    } catch (err) {
      if (err instanceof MissingViaError) {
        return NextResponse.json({ error: err.message, code: "MISSING_LAUNCH_VIA" }, { status: 400 })
      }
      throw err
    }
    if (!connection) return NextResponse.json({ error: "No Facebook connection found" }, { status: 401 })

    const level = resolveLevel(body)
    const expectedUpdatedTime = typeof body.expected_updated_time === "string"
      ? body.expected_updated_time
      : null

    // Read before write. Two jobs: refuse a write whose base has moved (Meta has no
    // version column, `updated_time` is the closest thing to an ETag), and capture the
    // old values so the notification can say what actually changed.
    const check = await assertMetaNodeUnchanged({
      nodeId: id,
      accessToken: connection.access_token,
      expectedUpdatedTime,
      fields: READ_FIELDS[level],
    })

    if (check.ok === false) {
      if (check.kind === "conflict") {
        return NextResponse.json(
          {
            code: "STALE_WRITE",
            message: "This item was updated by someone else while you were editing. Review the latest changes before saving.",
            current: check.node,
            currentUpdatedTime: check.updatedTime,
            conflictFields: [],
            overlappingFields: [],
          },
          { status: 409 }
        )
      }
      // The node could not be read. That is not a reason to skip the write the user
      // asked for — it only means this request goes through unguarded, and says so.
      console.warn(`[facebook/update] pre-read failed for ${id}: ${check.message}`)
    }

    const before = check.ok ? check.node : null

    // TD-37: same hazard as workspace-publish. Callers pass the ad set node they have in hand,
    // which is hydrated from a partial targeting read, and Meta replaces `targeting` wholesale.
    // Re-read, overlay only editor-owned keys, and drop the key entirely when nothing moved.
    let mergedTargeting: unknown = targeting
    if (level === "adset" && targeting !== undefined) {
      const remoteTargeting = await getNodeTargeting(id, connection.access_token, { isManual: isManual(connection) })
      const merge = mergeEditorTargeting(remoteTargeting, targeting)
      mergedTargeting = merge.changed ? merge.targeting : undefined
    }

    const payload = {
      name,
      status,
      daily_budget,
      lifetime_budget,
      start_time,
      end_time,
      optimization_goal,
      bid_strategy,
      bid_amount,
      attribution_spec,
      promoted_object,
      targeting: mergedTargeting,
      publisher_platforms,
      device_platforms,
      facebook_positions,
      instagram_positions,
      audience_network_positions,
      messenger_positions,
      advertiser,
      payer,
    }

    await updateNode(id, connection.access_token, payload, { isManual: isManual(connection) })

    // Only the keys the client actually sent are diffed — an omitted field asserts
    // nothing, and `diffFields` drops values that did not move.
    const sent = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined)
    )
    const changes = humanizeMoney(
      diffFields(before, sent),
      typeof body.currency === "string" ? body.currency : "USD"
    )

    if (changes.length > 0) {
      await emitAndLog("facebook.update", {
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        actorName: ctx.user.user_metadata?.full_name || ctx.user.email?.split("@")[0] || "Someone",
        type: LEVEL_TYPE[level],
        action: "updated",
        objectType: LEVEL_OBJECT[level],
        objectId: id,
        objectName: (name as string) || (before?.name as string) || null,
        changes,
        link: `/ads-manager?${level}=${id}`,
        // Editing the same node twice is two events. Timestamp keeps them distinct
        // while still collapsing a double-submit of the same click.
        dedupeKey: `${LEVEL_TYPE[level]}:${id}:${Math.floor(Date.now() / 5000)}`,
        source: "facebook.update",
      })
    }

    if (adAccountId) await invalidateMetaReadCacheAfterWrite({ orgId: ctx.orgId, adAccountId, objectIds: [id] })

    return NextResponse.json({
      success: true,
      changed: changes.map(c => c.field),
      versionChecked: check.ok ? check.checked : false,
    })
  } catch (err: any) {
    console.error("[facebook/update]", err)
    return NextResponse.json({ error: err.message || "Failed to update" }, { status: 500 })
  }
}
