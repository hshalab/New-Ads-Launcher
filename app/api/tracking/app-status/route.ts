import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { recordActivity } from "@/lib/notifications/emit"
import { isMissingTable } from "@/lib/tracking/missing-table"
import type { TrackingBatch } from "@/lib/tracking/summary"
import {
  jobHeartbeat,
  jobsLevel,
  summarizeCreativeReadiness,
  summarizeLaunchReliability,
  summarizeUploadQueue,
  worstLevel,
  type JobHeartbeat,
  type QueueItemRow,
  type StatusWindow,
} from "@/lib/tracking/app-status"

export const dynamic = "force-dynamic"

/**
 * App status — the machine-side read of Tracking.
 *
 * Deliberately DB-only. The Meta quota block is fetched by the client from the
 * existing `/api/facebook/rate-limit-status`, so this change adds **no new Meta
 * call site**: a monitoring feature that spends the quota it monitors is
 * self-defeating, and the Rate Limit page (M-14) already owns that call.
 *
 * Impact Trace: `.scratch/tracking-app-status/impact-trace.md`.
 */

/**
 * The cron cadences documented in `scripts/cron-adlauncher.sh`, paired with the table
 * each job writes. There is no heartbeat record (TD-45), so "did it run" is inferred
 * from "did it produce anything" — which cannot distinguish a job that ran and found
 * nothing to do from a job that never ran. Hence `quiet`, never `down`.
 */
const JOB_DEFINITIONS = [
  {
    key: "activate-scheduled-ads",
    label: "Scheduled ad activation",
    route: "/api/cron/activate-scheduled-ads",
    expectedEveryMinutes: 5,
    evidence: "scheduled_activations.created_at",
  },
  {
    key: "upload-to-facebook",
    label: "Media upload to Meta",
    route: "/api/cron/upload-to-facebook",
    expectedEveryMinutes: 5,
    evidence: "media_upload_job_items.updated_at",
  },
  {
    key: "sync-portal-media",
    label: "Creative Portal sync",
    route: "/api/cron/sync-portal-media",
    expectedEveryMinutes: 5,
    evidence: "portal_media_items.updated_at",
  },
  {
    key: "automation-triggers",
    label: "Automation triggers",
    route: "/api/cron/check-*-triggers",
    expectedEveryMinutes: 15,
    evidence: "automation_executions.executed_at",
  },
  {
    key: "sync-ad-accounts",
    label: "Ad account / metrics sync",
    route: "/api/cron/sync-ad-accounts",
    expectedEveryMinutes: 60,
    evidence: "ad_account_metrics_snapshots.synced_at",
  },
] as const

type LatestResult = { value: string | null; failed: boolean }

function latest(result: { data: unknown; error: unknown }, column: string): LatestResult {
  if (result.error) return { value: null, failed: true }
  const row = Array.isArray(result.data) ? result.data[0] : result.data
  const value = row && typeof row === "object" ? (row as Record<string, unknown>)[column] : null
  return { value: typeof value === "string" ? value : null, failed: false }
}

export async function GET(request: NextRequest) {
  const context = await getAuthContext()
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const requested = new URL(request.url).searchParams.get("window")
  const window: StatusWindow = requested === "7d" ? "7d" : "24h"
  const now = new Date()
  const since = new Date(now.getTime() - (window === "7d" ? 7 : 1) * 86_400_000).toISOString()
  /** Queue failures are rarer than launches; a wider lens keeps the error list useful. */
  const queueSince = new Date(now.getTime() - 7 * 86_400_000).toISOString()

  const db = createAdminClient()

  const [
    batchesResult,
    jobsResult,
    creativesResult,
    scheduledResult,
    portalResult,
    automationResult,
    accountSyncResult,
  ] = await Promise.all([
    db
      .from("launch_batches")
      .select("id,user_id,user_name,status,total_ads,failed_ads,duration_ms,created_at,errors")
      .eq("org_id", context.orgId)
      .gte("created_at", since)
      .order("created_at", { ascending: false }),
    // Items carry no org_id — scoping goes through the parent job or the queue leaks
    // across orgs. This join is the tenancy boundary for the whole block.
    db
      .from("media_upload_jobs")
      .select("id,status,total_items,created_at,media_upload_job_items(status,retry_count,run_at,error_msg,updated_at)")
      .eq("org_id", context.orgId)
      .gte("created_at", queueSince),
    db.from("creatives").select("status,fb_image_hash,fb_video_id").eq("org_id", context.orgId),
    db
      .from("scheduled_activations")
      .select("created_at")
      .eq("org_id", context.orgId)
      .order("created_at", { ascending: false })
      .limit(1),
    db
      .from("portal_media_items")
      .select("updated_at")
      .eq("org_id", context.orgId)
      .order("updated_at", { ascending: false })
      .limit(1),
    db
      .from("automation_executions")
      .select("executed_at")
      .eq("org_id", context.orgId)
      .order("executed_at", { ascending: false })
      .limit(1),
    db
      .from("ad_account_metrics_snapshots")
      .select("synced_at")
      .eq("org_id", context.orgId)
      .order("synced_at", { ascending: false })
      .limit(1),
  ])

  if (batchesResult.error) {
    console.error("[tracking:app-status]", batchesResult.error)
    return NextResponse.json({ error: "App status is unavailable." }, { status: 500 })
  }

  const batches = (batchesResult.data || []) as TrackingBatch[]
  const launch = summarizeLaunchReliability(batches, window, now)

  // ── Upload queue ──────────────────────────────────────────────────────────
  type JobRow = { id: string; created_at: string | null; media_upload_job_items: QueueItemRow[] | null }
  const jobRows = (jobsResult.data || []) as JobRow[]
  const queueItems = jobRows.flatMap(job => job.media_upload_job_items || [])
  const queueUnavailable = Boolean(jobsResult.error)
  if (jobsResult.error && !isMissingTable(jobsResult.error)) console.error("[tracking:app-status:queue]", jobsResult.error)
  const queue = summarizeUploadQueue(
    {
      items: queueItems,
      jobsInWindow: jobRows.length,
      available: !queueUnavailable,
      unavailableReason: queueUnavailable ? "The media upload queue tables are not readable on this project." : null,
    },
    now,
  )

  // ── Background jobs ───────────────────────────────────────────────────────
  const queueHeartbeat = queueItems
    .flatMap(item => (item.updated_at ? [item.updated_at] : []))
    .sort()
    .at(-1) ?? null
  const evidenceByKey: Record<string, LatestResult> = {
    "activate-scheduled-ads": latest(scheduledResult, "created_at"),
    "upload-to-facebook": { value: queueHeartbeat, failed: queueUnavailable && !isMissingTable(jobsResult.error) },
    "sync-portal-media": latest(portalResult, "updated_at"),
    "automation-triggers": latest(automationResult, "executed_at"),
    "sync-ad-accounts": latest(accountSyncResult, "synced_at"),
  }
  const jobs: JobHeartbeat[] = JOB_DEFINITIONS.map(definition =>
    jobHeartbeat(
      { ...definition, lastOutputAt: evidenceByKey[definition.key].value, failed: evidenceByKey[definition.key].failed },
      now,
    ),
  )

  // ── Creative readiness ────────────────────────────────────────────────────
  if (creativesResult.error) console.error("[tracking:app-status:creatives]", creativesResult.error)
  const creative = creativesResult.error
    ? {
        ...summarizeCreativeReadiness([]),
        available: false,
        unavailableReason: "Creative readiness is unreadable on this project.",
      }
    : summarizeCreativeReadiness(
        (creativesResult.data || []) as Array<{ status: string | null; fb_image_hash: string | null; fb_video_id: string | null }>,
      )

  /**
   * The verdict folds only the blocks this route can see. Meta quota is added on the
   * client once `/api/facebook/rate-limit-status` answers — so a green band here is
   * never claiming anything about Meta's throttle state.
   */
  const serverLevel = worstLevel([launch.level, jobsLevel(jobs), queue.level, creative.available ? "healthy" : "unknown"])

  return NextResponse.json({
    generatedAt: now.toISOString(),
    window,
    serverLevel,
    launch,
    jobs,
    jobsLevel: jobsLevel(jobs),
    queue,
    creative,
  })
}

/**
 * Adoption signal for the tab itself (B7 of the business gate). `app_status:completed`
 * is intentionally absent from ACTIVITY_CATALOG, exactly like the report export, so it
 * can never inflate anybody's valuable-action count — it only answers "is anyone
 * opening this". Without it, an unused tab and a load-bearing one look identical
 * (BL-12), which is the failure this whole pipeline exists to stop.
 */
export async function POST() {
  const context = await getAuthContext()
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const result = await recordActivity({
    orgId: context.orgId,
    actorId: context.user.id,
    actorName: context.user.full_name || context.user.email?.split("@")[0] || "Someone",
    objectType: "app_status",
    objectId: `tracking-app-status:${context.user.id}`,
    objectName: "App status tab",
    action: "completed",
  })

  return NextResponse.json({ ok: result.ok, degraded: result.degraded })
}
