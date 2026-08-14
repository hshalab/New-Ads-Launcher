"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  IconActivity,
  IconAlertTriangle,
  IconClock,
  IconLoader2,
  IconRefresh,
  IconServer,
  IconWifi,
} from "@tabler/icons-react"
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  VERDICT_LABEL,
  formatAge,
  formatMs,
  metaQuotaLevel,
  worstLevel,
  type CreativeReadiness,
  type JobHeartbeat,
  type LaunchReliability,
  type MetaQuota,
  type StatusLevel,
  type StatusWindow,
  type UploadQueue,
} from "@/lib/tracking/app-status"

/**
 * App status — the system-side tab of Tracking, MECE with Usage.
 *
 * Usage answers "are people using it and is it delivering". This answers "is the
 * machine healthy": latency, error taxonomy, Meta quota, job freshness, queue depth.
 * Deliberately number-dense and low on prose — the reader is checking, not learning.
 */

type AppStatusPayload = {
  generatedAt: string
  window: StatusWindow
  serverLevel: StatusLevel
  launch: LaunchReliability
  jobs: JobHeartbeat[]
  jobsLevel: StatusLevel
  queue: UploadQueue
  creative: CreativeReadiness
}

type RateLimitPayload = {
  status?: "ok" | "warning" | "blocked"
  maxPct?: number
  maxAppPct?: number
  maxBizPct?: number
  snapshotAgeSeconds?: number | null
  estimatedMinutesUntilOK?: number | null
  cacheBlocked?: boolean
  error?: string
}

const LEVEL_STYLE: Record<StatusLevel, { dot: string; text: string; ring: string; wash: string }> = {
  healthy: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", ring: "border-emerald-500/40", wash: "from-emerald-500/15" },
  attention: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", ring: "border-amber-500/40", wash: "from-amber-500/15" },
  critical: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400", ring: "border-red-500/40", wash: "from-red-500/15" },
  unknown: { dot: "bg-muted-foreground", text: "text-muted-foreground", ring: "border-muted-foreground/30", wash: "from-muted/40" },
}

const JOB_STATE_STYLE: Record<JobHeartbeat["state"], { label: string; className: string }> = {
  active: { label: "active", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  quiet: { label: "quiet", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  never: { label: "no output", className: "bg-muted text-muted-foreground" },
  unknown: { label: "unreadable", className: "bg-muted text-muted-foreground" },
}

function StatusDot({ level, pulse = false }: { level: StatusLevel; pulse?: boolean }) {
  return (
    <span className="relative flex size-2.5">
      {pulse && level === "healthy" && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
      )}
      <span className={cn("relative inline-flex size-2.5 rounded-full", LEVEL_STYLE[level].dot)} />
    </span>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: StatusLevel }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold tabular-nums", tone && LEVEL_STYLE[tone].text)}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Panel({
  title,
  icon,
  level,
  meta,
  children,
}: {
  title: string
  icon: React.ReactNode
  level: StatusLevel
  meta?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {meta && <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{meta}</span>}
          <StatusDot level={level} />
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function UsageBar({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  const color = clamped >= 90 ? "bg-red-500" : clamped >= 75 ? "bg-amber-500" : "bg-emerald-500"
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold tabular-nums">{clamped}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all duration-700", color)} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

const TOOLTIP_STYLE = {
  background: "#1a1a19",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 8,
  fontSize: 12,
  color: "#ffffff",
} as const

export function AppStatusTab() {
  const [window, setWindow] = useState<StatusWindow>("24h")
  const [data, setData] = useState<AppStatusPayload | null>(null)
  const [quota, setQuota] = useState<RateLimitPayload | null>(null)
  const [quotaUnavailable, setQuotaUnavailable] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/tracking/app-status?window=${window}`, { cache: "no-store" })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || "App status is unavailable.")
      setData(body)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "App status is unavailable.")
    } finally {
      setLoading(false)
    }
  }, [window])

  /**
   * Meta quota comes from the route the Rate Limit page already owns, so this tab
   * adds no Meta call site of its own. Its failure is isolated: no connection means
   * the quota panel says so, and every other panel still renders.
   */
  const loadQuota = useCallback(async () => {
    try {
      const response = await fetch("/api/facebook/rate-limit-status", { cache: "no-store" })
      const body: RateLimitPayload = await response.json()
      if (!response.ok) {
        setQuota(null)
        setQuotaUnavailable(body?.error || "Meta quota is unreadable.")
        return
      }
      setQuota(body)
      setQuotaUnavailable(null)
    } catch {
      setQuota(null)
      setQuotaUnavailable("Meta quota is unreadable.")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadQuota()
    // Adoption signal for this tab (B7). Fire and forget — it must never block a read.
    void fetch("/api/tracking/app-status", { method: "POST" }).catch(() => {})
  }, [loadQuota])

  const metaQuota: MetaQuota | null = useMemo(
    () =>
      quota
        ? {
            maxPct: quota.maxPct ?? 0,
            appPct: quota.maxAppPct ?? 0,
            bizPct: quota.maxBizPct ?? 0,
            snapshotAgeSeconds: quota.snapshotAgeSeconds ?? null,
            blocked: Boolean(quota.cacheBlocked) || quota.status === "blocked",
            estimatedMinutesUntilOK: quota.estimatedMinutesUntilOK ?? null,
          }
        : null,
    [quota],
  )

  const quotaLevel = metaQuotaLevel(metaQuota)
  const overall: StatusLevel = data ? worstLevel([data.serverLevel, quotaLevel]) : "unknown"
  const jobsOnTime = data ? data.jobs.filter(job => job.state === "active").length : 0

  const series = useMemo(
    () =>
      (data?.launch.series || []).map(point => ({
        ...point,
        p95Seconds: point.p95Ms === null ? null : Math.round(point.p95Ms / 100) / 10,
      })),
    [data?.launch.series],
  )
  const hasLaunchActivity = (data?.launch.batches || 0) > 0

  if (!data && loading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <IconAlertTriangle className="size-4" />
        {error}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-5">
      {/* Verdict band */}
      <div className={cn("rounded-2xl border-2 bg-gradient-to-r to-transparent p-5", LEVEL_STYLE[overall].ring, LEVEL_STYLE[overall].wash)}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <StatusDot level={overall} pulse />
            <div>
              <h2 className={cn("text-xl font-semibold tracking-tight", LEVEL_STYLE[overall].text)}>{VERDICT_LABEL[overall]}</h2>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                checked {new Date(data.generatedAt).toLocaleTimeString("en-GB")} · org scope · window {data.window}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex rounded-lg border bg-background p-0.5">
              {(["24h", "7d"] as const).map(value => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setWindow(value)}
                  className={cn(
                    "rounded-md px-3 py-1 font-mono text-xs transition",
                    window === value ? "bg-muted font-semibold" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void load()
                void loadQuota()
              }}
              disabled={loading}
            >
              {loading ? <IconLoader2 className="size-4 animate-spin" /> : <IconRefresh className="size-4" />}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Launch success"
            value={data.launch.successRate === null ? "—" : `${data.launch.successRate}%`}
            sub={`${data.launch.batches} batches · ${data.window}`}
            tone={data.launch.level}
          />
          <Stat label="Launch p95" value={formatMs(data.launch.p95Ms)} sub={`p50 ${formatMs(data.launch.p50Ms)}`} />
          <Stat
            label="Meta quota used"
            value={metaQuota ? `${Math.round(metaQuota.maxPct)}%` : "—"}
            sub={metaQuota ? `${100 - Math.round(metaQuota.maxPct)}% headroom` : quotaUnavailable || "unreadable"}
            tone={quotaLevel}
          />
          <Stat
            label="Jobs producing"
            value={`${jobsOnTime}/${data.jobs.length}`}
            sub="within expected cadence"
            tone={data.jobsLevel}
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* Launch pipeline */}
        <Panel
          title="Launch pipeline"
          icon={<IconActivity className="size-4 text-muted-foreground" />}
          level={data.launch.level}
          meta={`${data.launch.adsCreated} ads · ${data.launch.adsFailed} failed`}
        >
          {hasLaunchActivity ? (
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="label" stroke="#898781" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis yAxisId="left" allowDecimals={false} stroke="#898781" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={34} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#a78bfa"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={38}
                    tickFormatter={value => `${value}s`}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={{ color: "#ffffff" }}
                    labelStyle={{ color: "#898781" }}
                    formatter={(value, name) => {
                      if (name === "p95Seconds") return [value === null ? "—" : `${value}s`, "p95 duration"]
                      return [String(value), String(name)]
                    }}
                  />
                  <Bar yAxisId="left" dataKey="success" name="success" stackId="b" fill="#10b981" fillOpacity={0.75} maxBarSize={22} />
                  <Bar yAxisId="left" dataKey="partial" name="partial" stackId="b" fill="#f59e0b" fillOpacity={0.8} maxBarSize={22} />
                  <Bar yAxisId="left" dataKey="failed" name="failed" stackId="b" fill="#ef4444" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={22} />
                  <Line yAxisId="right" type="monotone" dataKey="p95Seconds" name="p95Seconds" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No launches in this window. Idle is not unhealthy.</p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Success" value={String(data.launch.success)} />
            <Stat label="Partial" value={String(data.launch.partial)} tone={data.launch.partial > 0 ? "attention" : undefined} />
            <Stat label="Failed" value={String(data.launch.failed)} tone={data.launch.failed > 0 ? "critical" : undefined} />
            <Stat label="Slowest" value={formatMs(data.launch.maxMs)} />
          </div>

          {data.launch.topErrors.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Error taxonomy</p>
              {data.launch.topErrors.map(item => (
                <div key={item.label} className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-2.5 py-1.5">
                  <span className="truncate font-mono text-[11px]">{item.label}</span>
                  <strong className="font-mono text-xs tabular-nums">{item.count}</strong>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Meta API */}
        <Panel
          title="Meta API"
          icon={<IconWifi className="size-4 text-muted-foreground" />}
          level={quotaLevel}
          meta={metaQuota?.snapshotAgeSeconds != null ? `snapshot ${Math.round(metaQuota.snapshotAgeSeconds)}s old` : undefined}
        >
          {metaQuota ? (
            <div className="space-y-4">
              <UsageBar label="App-level usage (x-app-usage)" pct={metaQuota.appPct} />
              <UsageBar label="Business ADS_MANAGEMENT usage" pct={metaQuota.bizPct} />
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Headroom" value={`${Math.max(0, 100 - Math.round(metaQuota.maxPct))}%`} tone={quotaLevel} />
                <Stat label="Throttled" value={metaQuota.blocked ? "yes" : "no"} tone={metaQuota.blocked ? "critical" : "healthy"} />
                <Stat
                  label="Recovery"
                  value={metaQuota.estimatedMinutesUntilOK ? `${metaQuota.estimatedMinutesUntilOK}m` : "—"}
                  sub={metaQuota.estimatedMinutesUntilOK ? "Meta estimate" : "not throttled"}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Read from Meta response headers via <span className="font-mono">/api/facebook/rate-limit-status</span> — the same source as <span className="font-mono">/rate-limit</span>. This tab adds no Meta calls.
              </p>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">{quotaUnavailable || "Meta quota is unreadable."}</p>
          )}
        </Panel>

        {/* Background jobs */}
        <Panel
          title="Background jobs"
          icon={<IconClock className="size-4 text-muted-foreground" />}
          level={data.jobsLevel}
          meta={`${jobsOnTime}/${data.jobs.length} producing`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Job</th>
                  <th className="pb-2 text-right font-medium">Cadence</th>
                  <th className="pb-2 text-right font-medium">Last output</th>
                  <th className="pb-2 text-right font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map(job => (
                  <tr key={job.key} className="border-b last:border-0">
                    <td className="py-2.5">
                      <p className="font-medium">{job.label}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{job.evidence}</p>
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {job.expectedEveryMinutes}m
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs tabular-nums">{formatAge(job.ageMinutes)}</td>
                    <td className="py-2.5 text-right">
                      <span className={cn("rounded-md px-2 py-0.5 font-mono text-[11px]", JOB_STATE_STYLE[job.state].className)}>
                        {JOB_STATE_STYLE[job.state].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Heartbeat is <strong>inferred from output</strong>: there is no cron run record (TD-45). A job that ran and had nothing to do looks identical to one that did not run, so this never reports an outage — only how long since it last produced anything.
          </p>
        </Panel>

        {/* Upload queue + creative readiness */}
        <Panel
          title="Upload queue"
          icon={<IconServer className="size-4 text-muted-foreground" />}
          level={data.queue.level}
          meta={data.queue.available ? `${data.queue.jobsInWindow} jobs · 7d` : undefined}
        >
          {data.queue.available ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="Pending"
                  value={String(data.queue.pendingItems)}
                  sub={data.queue.oldestPendingMinutes === null ? "empty" : `oldest ${formatAge(data.queue.oldestPendingMinutes)}`}
                  tone={data.queue.level === "critical" ? "critical" : undefined}
                />
                <Stat label="Running" value={String(data.queue.runningItems)} />
                <Stat label="Done" value={String(data.queue.doneItems)} />
                <Stat
                  label="Failed"
                  value={String(data.queue.failedItems)}
                  sub={`${data.queue.retriedItems} retried`}
                  tone={data.queue.failedItems > 0 ? "attention" : undefined}
                />
              </div>

              {data.queue.topErrors.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Upload failures</p>
                  {data.queue.topErrors.map(item => (
                    <div key={item.label} className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-2.5 py-1.5">
                      <span className="truncate font-mono text-[11px]">{item.label}</span>
                      <strong className="font-mono text-xs tabular-nums">{item.count}</strong>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{data.queue.unavailableReason}</p>
          )}

          <div className="mt-5 border-t pt-4">
            {!data.creative.available ? (
              <p className="text-sm text-muted-foreground">{data.creative.unavailableReason}</p>
            ) : (
              <>
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Creative readiness — Meta holds the asset</p>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {data.creative.readinessRate === null ? "—" : `${data.creative.readinessRate}%`}
              </span>
            </div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
              {data.creative.total > 0 && (
                <>
                  <div className="bg-emerald-500" style={{ width: `${(data.creative.metaReady / data.creative.total) * 100}%` }} />
                  <div className="bg-muted-foreground/40" style={{ width: `${(data.creative.awaitingUpload / data.creative.total) * 100}%` }} />
                  <div className="bg-red-500" style={{ width: `${(data.creative.errored / data.creative.total) * 100}%` }} />
                </>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-muted-foreground">
              <span><span className="text-emerald-500">■</span> {data.creative.metaReady} ready</span>
              <span><span className="text-muted-foreground">■</span> {data.creative.awaitingUpload} awaiting upload</span>
              <span><span className="text-red-500">■</span> {data.creative.errored} error</span>
              <span>{data.creative.total} total</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Counted by <span className="font-mono">fb_image_hash</span> / <span className="font-mono">fb_video_id</span>, not by <span className="font-mono">status</span>.
            </p>
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
