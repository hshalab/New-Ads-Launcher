/**
 * App status — the system-side half of Tracking.
 *
 * MECE with the Usage tab: Usage answers "did people use the app and did their
 * launches reach Meta". This answers "is the machine healthy" — latency, error
 * taxonomy, Meta quota headroom, background-job freshness, queue depth. Both
 * read `launch_batches`; they ask different questions of it.
 *
 * Everything here is pure so it can be asserted without a database — the same
 * seam `lib/tracking/summary.ts` uses. The route does the I/O, this does the maths.
 *
 * The honesty rule that shapes the whole file: a failed read is `unknown`, never
 * zero and never healthy. Rendering a zero as health is the exact failure this
 * tab exists to prevent (TD-06, TD-34).
 */

import { summarizeFailureReasons, toVietnamDateKey, type TrackingBatch } from "./summary"

export type StatusLevel = "healthy" | "attention" | "critical" | "unknown"

export type StatusWindow = "24h" | "7d"

/** Ranked worst-first so `worstLevel` can fold a set of blocks into one verdict. */
const LEVEL_RANK: Record<StatusLevel, number> = { critical: 3, attention: 2, unknown: 1, healthy: 0 }

export function worstLevel(levels: StatusLevel[]): StatusLevel {
  return levels.reduce<StatusLevel>((worst, level) => (LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst), "healthy")
}

// ── Launch pipeline reliability ──────────────────────────────────────────────

export type LaunchSeriesPoint = {
  /** ISO hour (`2026-08-14T09`) for 24h, or Vietnam date key (`2026-08-14`) for 7d. */
  bucket: string
  label: string
  success: number
  partial: number
  failed: number
  p95Ms: number | null
}

export type LaunchReliability = {
  batches: number
  success: number
  partial: number
  failed: number
  /** null when the window is empty — 0% would claim a failure that never happened. */
  successRate: number | null
  adsCreated: number
  adsFailed: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
  series: LaunchSeriesPoint[]
  topErrors: Array<{ label: string; count: number }>
  level: StatusLevel
}

/** Nearest-rank percentile. With batch counts in the tens, interpolation would be false precision. */
export function percentile(values: number[], fraction: number): number | null {
  const sorted = values.filter(value => Number.isFinite(value)).sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const rank = Math.max(1, Math.ceil(fraction * sorted.length))
  return sorted[rank - 1]
}

function vietnamHourKey(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value
  // Intl renders midnight as "24" in some ICU versions; normalise it back to the day it belongs to.
  const hour = part("hour") === "24" ? "00" : part("hour")
  return `${part("year")}-${part("month")}-${part("day")}T${hour}`
}

/** Buckets the window ends up with, empty ones included, so a gap reads as a gap. */
function emptyBuckets(window: StatusWindow, now: Date): LaunchSeriesPoint[] {
  const points: LaunchSeriesPoint[] = []
  if (window === "24h") {
    for (let offset = 23; offset >= 0; offset -= 1) {
      const at = new Date(now.getTime() - offset * 3_600_000).toISOString()
      const bucket = vietnamHourKey(at)
      points.push({ bucket, label: `${bucket.slice(11)}h`, success: 0, partial: 0, failed: 0, p95Ms: null })
    }
    return points
  }
  for (let offset = 6; offset >= 0; offset -= 1) {
    const bucket = toVietnamDateKey(new Date(now.getTime() - offset * 86_400_000))
    points.push({ bucket, label: bucket.slice(5), success: 0, partial: 0, failed: 0, p95Ms: null })
  }
  return points
}

/**
 * A batch is `success`, or it is not. `partial` and `failed` are both "needs review"
 * to the Usage tab; here they stay separate because they mean different things about
 * the machine — partial means Meta accepted some ads, failed means it accepted none.
 */
export function summarizeLaunchReliability(
  batches: TrackingBatch[],
  window: StatusWindow,
  now = new Date(),
): LaunchReliability {
  const success = batches.filter(batch => batch.status === "success").length
  const failed = batches.filter(batch => batch.status === "failed").length
  const partial = batches.length - success - failed
  const durations = batches.flatMap(batch => (typeof batch.duration_ms === "number" ? [batch.duration_ms] : []))

  const buckets = new Map(emptyBuckets(window, now).map(point => [point.bucket, point]))
  const bucketDurations = new Map<string, number[]>()
  for (const batch of batches) {
    if (!batch.created_at) continue
    const key = window === "24h" ? vietnamHourKey(batch.created_at) : toVietnamDateKey(batch.created_at)
    const point = buckets.get(key)
    if (!point) continue
    if (batch.status === "success") point.success += 1
    else if (batch.status === "failed") point.failed += 1
    else point.partial += 1
    if (typeof batch.duration_ms === "number") {
      bucketDurations.set(key, [...(bucketDurations.get(key) || []), batch.duration_ms])
    }
  }
  for (const [key, values] of bucketDurations) {
    const point = buckets.get(key)
    if (point) point.p95Ms = percentile(values, 0.95)
  }

  const successRate = batches.length === 0 ? null : Math.round((success / batches.length) * 1000) / 10

  return {
    batches: batches.length,
    success,
    partial,
    failed,
    successRate,
    adsCreated: batches.reduce((total, batch) => total + Math.max(0, batch.total_ads || 0), 0),
    adsFailed: batches.reduce((total, batch) => total + Math.max(0, batch.failed_ads || 0), 0),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations.length === 0 ? null : Math.max(...durations),
    series: [...buckets.values()],
    topErrors: summarizeFailureReasons(batches).slice(0, 5),
    level: launchLevel(successRate, failed),
  }
}

/**
 * An empty window is `healthy`, not `unknown`: nobody launched, and the pipeline
 * being idle is not the pipeline being broken. Idle-ness is the Usage tab's question.
 */
function launchLevel(successRate: number | null, failed: number): StatusLevel {
  if (successRate === null) return "healthy"
  if (failed > 0 || successRate < 80) return "critical"
  if (successRate < 95) return "attention"
  return "healthy"
}

// ── Background jobs — heartbeat inferred from output ─────────────────────────

/**
 * There is no `cron_runs` table (TD-45). Freshness is inferred from the last row
 * each job writes, which means **`quiet` is ambiguous by construction**: a job that
 * ran and had nothing to do is indistinguishable from a job that did not run.
 *
 * So this never reports `down`. It reports how long it has been since the job last
 * produced anything, and lets a human read it. Claiming an outage we cannot prove
 * would make this tab exactly as untrustworthy as having no tab.
 */
export type JobState = "active" | "quiet" | "never" | "unknown"

export type JobHeartbeat = {
  key: string
  label: string
  route: string
  expectedEveryMinutes: number
  lastOutputAt: string | null
  ageMinutes: number | null
  state: JobState
  /** The table and column that stand in for a heartbeat, named so the reader can check it. */
  evidence: string
}

/** How many missed cadences before output silence is worth showing. Wide, because silence is ambiguous. */
const QUIET_AFTER_CADENCES = 3

export function jobHeartbeat(
  input: {
    key: string
    label: string
    route: string
    expectedEveryMinutes: number
    evidence: string
    lastOutputAt: string | null
    failed?: boolean
  },
  now = new Date(),
): JobHeartbeat {
  const base = {
    key: input.key,
    label: input.label,
    route: input.route,
    expectedEveryMinutes: input.expectedEveryMinutes,
    evidence: input.evidence,
  }
  if (input.failed) return { ...base, lastOutputAt: null, ageMinutes: null, state: "unknown" }
  if (!input.lastOutputAt) return { ...base, lastOutputAt: null, ageMinutes: null, state: "never" }

  const ageMinutes = Math.max(0, Math.round((now.getTime() - new Date(input.lastOutputAt).getTime()) / 60_000))
  const quietThreshold = input.expectedEveryMinutes * QUIET_AFTER_CADENCES
  return {
    ...base,
    lastOutputAt: input.lastOutputAt,
    ageMinutes,
    state: ageMinutes <= quietThreshold ? "active" : "quiet",
  }
}

/**
 * `quiet` is `attention`, never `critical` — see the ambiguity note above. `unknown`
 * (the read itself failed) is the one that stays `unknown`; a broken query is not a
 * clean bill of health.
 */
export function jobsLevel(jobs: JobHeartbeat[]): StatusLevel {
  if (jobs.length === 0) return "unknown"
  if (jobs.some(job => job.state === "unknown")) return "unknown"
  if (jobs.some(job => job.state === "quiet" || job.state === "never")) return "attention"
  return "healthy"
}

// ── Upload queue and creative readiness ─────────────────────────────────────

export type UploadQueue = {
  available: boolean
  unavailableReason: string | null
  pendingItems: number
  runningItems: number
  doneItems: number
  failedItems: number
  retriedItems: number
  oldestPendingMinutes: number | null
  jobsInWindow: number
  topErrors: Array<{ label: string; count: number }>
  level: StatusLevel
}

export type QueueItemRow = {
  status: string
  retry_count: number | null
  run_at: string | null
  error_msg: string | null
  updated_at?: string | null
}

/** A job item stuck pending this long has missed ~24 cron passes; worth a human look. */
const STUCK_PENDING_MINUTES = 120

export function summarizeUploadQueue(
  input: { items: QueueItemRow[]; jobsInWindow: number; available: boolean; unavailableReason?: string | null },
  now = new Date(),
): UploadQueue {
  if (!input.available) {
    return {
      available: false,
      unavailableReason: input.unavailableReason || "media_upload_jobs is not applied on this project.",
      pendingItems: 0,
      runningItems: 0,
      doneItems: 0,
      failedItems: 0,
      retriedItems: 0,
      oldestPendingMinutes: null,
      jobsInWindow: 0,
      topErrors: [],
      level: "unknown",
    }
  }

  const byStatus = (status: string) => input.items.filter(item => item.status === status)
  const pending = byStatus("pending")
  const failed = byStatus("failed")

  const pendingAges = pending.flatMap(item =>
    item.run_at ? [Math.max(0, Math.round((now.getTime() - new Date(item.run_at).getTime()) / 60_000))] : [],
  )
  const oldestPendingMinutes = pendingAges.length === 0 ? null : Math.max(...pendingAges)

  const errorCounts = new Map<string, number>()
  for (const item of failed) {
    const label = (item.error_msg || "Unknown upload error").slice(0, 160)
    errorCounts.set(label, (errorCounts.get(label) || 0) + 1)
  }

  return {
    available: true,
    unavailableReason: null,
    pendingItems: pending.length,
    runningItems: byStatus("running").length,
    doneItems: byStatus("done").length,
    failedItems: failed.length,
    retriedItems: input.items.filter(item => (item.retry_count || 0) > 0).length,
    oldestPendingMinutes,
    jobsInWindow: input.jobsInWindow,
    topErrors: [...errorCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 4),
    level: queueLevel(failed.length, oldestPendingMinutes),
  }
}

function queueLevel(failedItems: number, oldestPendingMinutes: number | null): StatusLevel {
  if (oldestPendingMinutes !== null && oldestPendingMinutes > STUCK_PENDING_MINUTES) return "critical"
  if (failedItems > 0) return "attention"
  return "healthy"
}

/**
 * Creative readiness, counted the way `lib/creative-readiness.ts` defines it: Meta has
 * the asset when `fb_image_hash` or `fb_video_id` is populated. `status` is the Meta
 * *upload* lifecycle and is reported beside it, not instead of it — reading `ready` as
 * "the file is usable" is what cut the Portal pipeline once (CONTEXT.md).
 */
export type CreativeReadiness = {
  available: boolean
  unavailableReason: string | null
  total: number
  metaReady: number
  awaitingUpload: number
  errored: number
  readinessRate: number | null
}

export function summarizeCreativeReadiness(
  creatives: Array<{ status: string | null; fb_image_hash: string | null; fb_video_id: string | null }>,
): CreativeReadiness {
  const isMetaReady = (row: (typeof creatives)[number]) => Boolean(row.fb_image_hash) || Boolean(row.fb_video_id)
  const metaReady = creatives.filter(isMetaReady).length
  const errored = creatives.filter(row => !isMetaReady(row) && row.status === "error").length
  return {
    available: true,
    unavailableReason: null,
    total: creatives.length,
    metaReady,
    awaitingUpload: creatives.length - metaReady - errored,
    errored,
    readinessRate: creatives.length === 0 ? null : Math.round((metaReady / creatives.length) * 1000) / 10,
  }
}

// ── Meta API quota (shape of the existing /api/facebook/rate-limit-status) ───

export type MetaQuota = {
  maxPct: number
  appPct: number
  bizPct: number
  snapshotAgeSeconds: number | null
  blocked: boolean
  estimatedMinutesUntilOK: number | null
}

export function metaQuotaLevel(quota: MetaQuota | null): StatusLevel {
  if (!quota) return "unknown"
  if (quota.blocked || quota.maxPct >= 90) return "critical"
  if (quota.maxPct >= 75) return "attention"
  return "healthy"
}

// ── The one-word verdict ────────────────────────────────────────────────────

export const VERDICT_LABEL: Record<StatusLevel, string> = {
  healthy: "All systems operational",
  attention: "Degraded — needs attention",
  critical: "Failing — action required",
  unknown: "Partially unobservable",
}

export function formatAge(minutes: number | null): string {
  if (minutes === null) return "—"
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function formatMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—"
  if (value < 1_000) return `${Math.round(value)}ms`
  const seconds = value / 1_000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds % 60)}s`
}
