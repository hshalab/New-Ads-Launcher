export type TrackingBatch = {
  id: string
  user_id: string
  user_name: string | null
  status: string
  total_ads: number | null
  failed_ads: number | null
  duration_ms: number | null
  created_at?: string | null
  ad_account_name?: string | null
  errors?: unknown
  created_ads?: unknown
  creative_ids?: string[]
}

export type TrackingMemberSummary = {
  userId: string
  name: string
  avatarUrl?: string | null
  batches: number
  fullSuccess: number
  nonSuccess: number
  adsCreated: number
  averageSessionDurationMs: number | null
}

export type TrackingCreative = {
  id: string
  fb_image_hash: string | null
  fb_video_id: string | null
}

function createdAds(batch: TrackingBatch) {
  return Math.max(0, batch.total_ads || 0)
}

export function summarizeLaunchBatches(batches: TrackingBatch[]) {
  const team = new Map<string, TrackingMemberSummary>()
  const memberDurations = new Map<string, number[]>()
  const durations = batches.flatMap(batch => batch.duration_ms === null ? [] : [batch.duration_ms])
  const fullSuccess = batches.filter(batch => batch.status === "success").length
  const adsCreated = batches.reduce((total, batch) => total + createdAds(batch), 0)

  for (const batch of batches) {
    const member = team.get(batch.user_id) || {
      userId: batch.user_id,
      name: batch.user_name || "Unknown",
      avatarUrl: null,
      batches: 0,
      fullSuccess: 0,
      nonSuccess: 0,
      adsCreated: 0,
      averageSessionDurationMs: null,
    }
    member.batches += 1
    member.fullSuccess += Number(batch.status === "success")
    member.nonSuccess += Number(batch.status !== "success")
    member.adsCreated += createdAds(batch)
    if (batch.duration_ms !== null) memberDurations.set(batch.user_id, [...(memberDurations.get(batch.user_id) || []), batch.duration_ms])
    team.set(batch.user_id, member)
  }

  for (const member of team.values()) {
    const values = memberDurations.get(member.userId) || []
    member.averageSessionDurationMs = values.length ? Math.round(values.reduce((total, duration) => total + duration, 0) / values.length) : null
  }

  return {
    batches: batches.length,
    fullSuccess,
    nonSuccess: batches.length - fullSuccess,
    adsCreated,
    successRate: batches.length ? Math.round((fullSuccess / batches.length) * 100) : 0,
    averageSessionDurationMs: durations.length
      ? Math.round(durations.reduce((total, duration) => total + duration, 0) / durations.length)
      : null,
    team: [...team.values()].sort((left, right) => right.batches - left.batches || left.name.localeCompare(right.name)),
  }
}

export function summarizeCreativeCoverage(creatives: TrackingCreative[], launchedCreativeIds: ReadonlySet<string>) {
  const readyCreatives = creatives.filter(creative => Boolean(creative.fb_image_hash || creative.fb_video_id))
  const launched = readyCreatives.filter(creative => launchedCreativeIds.has(creative.id)).length

  return {
    ready: readyCreatives.length,
    launched,
    unlaunched: readyCreatives.length - launched,
    launchRate: readyCreatives.length ? Math.round((launched / readyCreatives.length) * 100) : 0,
  }
}

export function toVietnamDateKey(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

function previousDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function isWorkingDate(dateKey: string) {
  const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
  return day !== 0 && day !== 6
}

export function workingDayStreak(launchTimes: string[], now = new Date()) {
  const launchDates = new Set(launchTimes.map(toVietnamDateKey).filter(isWorkingDate))
  let dateKey = toVietnamDateKey(now)
  while (!isWorkingDate(dateKey)) dateKey = previousDate(dateKey)

  let streak = 0
  while (launchDates.has(dateKey)) {
    streak += 1
    dateKey = previousDate(dateKey)
    while (!isWorkingDate(dateKey)) dateKey = previousDate(dateKey)
  }
  return streak
}

function storedErrorMessage(error: unknown) {
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "error" in error && typeof error.error === "string") return error.error
  return null
}

export function summarizeFailureReasons(batches: TrackingBatch[]) {
  const counts = new Map<string, number>()
  for (const batch of batches) {
    if (batch.status === "success" || !Array.isArray(batch.errors)) continue
    for (const error of batch.errors) {
      const label = storedErrorMessage(error)
      if (label) counts.set(label, (counts.get(label) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
}

export function isoWeekMonday(value: Date | string) {
  const date = new Date(`${toVietnamDateKey(value)}T00:00:00.000Z`)
  const day = date.getUTCDay()
  const offset = (day + 6) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

export type TrackingTimeSeriesPoint = {
  bucket: string
  batches: number
  fullSuccess: number
  nonSuccess: number
  adsCreated: number
  avgDurationMs: number | null
}

export function summarizeLaunchBatchesTimeSeries(batches: TrackingBatch[], days: number, range?: { since?: string; until?: string }): TrackingTimeSeriesPoint[] {
  const weekly = days >= 90
  const buckets = new Map<string, { batches: number; fullSuccess: number; nonSuccess: number; adsCreated: number; durations: number[] }>()
  const bucketKey = (value: Date | string) => (weekly ? isoWeekMonday(value) : toVietnamDateKey(value))

  if (range?.since && range?.until) {
    const current = new Date(range.since)
    const end = new Date(range.until)
    while (current <= end) {
      const key = bucketKey(current)
      if (!buckets.has(key)) {
        buckets.set(key, { batches: 0, fullSuccess: 0, nonSuccess: 0, adsCreated: 0, durations: [] })
      }
      current.setUTCDate(current.getUTCDate() + 1)
    }
  }

  for (const batch of batches) {
    if (!batch.created_at) continue
    const key = bucketKey(batch.created_at)
    const point = buckets.get(key) || { batches: 0, fullSuccess: 0, nonSuccess: 0, adsCreated: 0, durations: [] }
    point.batches += 1
    point.fullSuccess += Number(batch.status === "success")
    point.nonSuccess += Number(batch.status !== "success")
    point.adsCreated += createdAds(batch)
    if (batch.duration_ms !== null) point.durations.push(batch.duration_ms)
    buckets.set(key, point)
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, point]) => ({
      bucket,
      batches: point.batches,
      fullSuccess: point.fullSuccess,
      nonSuccess: point.nonSuccess,
      adsCreated: point.adsCreated,
      avgDurationMs: point.durations.length ? Math.round(point.durations.reduce((total, duration) => total + duration, 0) / point.durations.length) : null,
    }))
}
