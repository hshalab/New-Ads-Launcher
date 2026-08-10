"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { IconAlertTriangle, IconCalendarTime, IconChartBar, IconCheck, IconChevronDown, IconChevronRight, IconCopy, IconInfoCircle, IconLoader2, IconMail, IconNote, IconPhoto, IconRefresh, IconRocket, IconStar } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { AdsDateRangePicker, getPresetRange } from "@/components/ads-manager/AdsDateRangePicker"
import { CLASS_DESCRIPTION, CLASS_LABEL, CLASS_ORDER, type ActivityClass } from "@/lib/tracking/activity-catalog"
import { mergeUsageRows } from "@/lib/tracking/activity"
import { buildTrackingReport } from "@/lib/tracking/report"
import { Bar, CartesianGrid, ComposedChart, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

type TeamMember = {
  userId: string
  name: string
  avatarUrl?: string | null
  batches: number
  fullSuccess: number
  nonSuccess: number
  adsCreated: number
  averageSessionDurationMs: number | null
}

type TrackingSummary = {
  batches: number
  fullSuccess: number
  nonSuccess: number
  adsCreated: number
  successRate: number
  averageSessionDurationMs: number | null
  team: TeamMember[]
}

type TimeSeriesPoint = {
  bucket: string
  batches: number
  fullSuccess: number
  nonSuccess: number
  adsCreated: number
  avgDurationMs: number | null
}



type MemberDetail = {
  userId: string
  avatarUrl?: string | null
  days: number
  summary: TrackingSummary
  streak: number
  recentBatches: Array<{
    id: string
    status: string
    total_ads: number | null
    failed_ads: number | null
    duration_ms: number | null
    created_at: string | null
    ad_account_name: string | null
  }>
  painpoint: string
  activity?: ActivityBlock & { available: boolean; unavailableReason: string | null }
  timeline?: Array<{ at: string; label: string; class: ActivityClass; detail: string }>
}

type ActivityTypeCount = {
  key: string
  label: string
  class: ActivityClass
  status: "live" | "pending_emit" | "not_instrumented"
  /** Which shipped screen the action happens on — the class drill-down reads this. */
  surface: string
  count: number
}

type ActivityMember = {
  userId: string
  name: string
  actions: number
  activeDays: number
  breadth: number
  byClass: Record<ActivityClass, number>
}

type ActivityBlock = {
  total: number
  byClass: Record<ActivityClass, number>
  byType: ActivityTypeCount[]
  byMember: ActivityMember[]
  activeMembers: number
  activeDays: number
  unused: ActivityTypeCount[]
  notInstrumented: ActivityTypeCount[]
  leverageRatio: number | null
  estimatedHoursSaved: number
}

type ActivityPayload = {
  available: boolean
  instrumentedSince: string | null
  unavailableReason: string | null
  truncated: boolean
  automationRuns: number
  automationCoverage: number | null
  mine: ActivityBlock
  team?: ActivityBlock
}

type PreviousPayload = {
  batches: number
  adsCreated: number
  successRate: number
  deltaBatches: number | null
  deltaAdsCreated: number | null
  deltaSuccessRate: number
  deltaActivity: number | null
  deltaActiveMembers: number | null
  deltaAutomationRuns: number | null
}

type TrackingData = {
  days: number
  generatedAt: string
  role: string
  currentUserId: string
  activity: ActivityPayload
  previous: PreviousPayload
  admin?: TrackingSummary
  adminTimeSeries?: TimeSeriesPoint[]
  teamStreaks?: Record<string, number>
  failureReasons?: Array<{ label: string; count: number }>
  mine: TrackingSummary
  myBatches: Array<{
    id: string
    status: string
    total_ads: number | null
    failed_ads: number | null
    duration_ms: number | null
    created_at: string | null
    ad_account_name: string | null
  }>
  myStreak: number
  myFailureReasons: Array<{ label: string; count: number }>
  creative: {
    ready: number
    launched: number
    unlaunched: number
    launchRate: number
  }
  creatorDataStatus: "awaiting_portal"
  painpoint: string
}

const METRIC_METHODOLOGY = {
  successRate: "% batches with status = success out of all batches in the period.",
  e2eRate: "Y / X where X = all Meta Ads Manager ads across connected org ad accounts, Y = ads whose name contains [app].",
  adsCreated: "Sum of (total_ads − failed_ads) across batches in the period.",
  needsReview: "Batches whose status is not success (partial or failed).",
  avgDuration: "Mean server-side batch duration_ms in the period.",
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) return "-"
  const seconds = Math.round(durationMs / 1_000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}

function formatBucket(bucket: string, days: number) {
  const date = new Date(`${bucket}T00:00:00.000Z`)
  if (days >= 90) {
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })
  }
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", timeZone: "UTC" })
}

function getLabelName(key: string) {
  switch (key) {
    case "fullSuccess": return "Full Success Batches"
    case "adsCreated": return "Ads Created"
    case "nonSuccess": return "Needs Review Batches"
    case "avgDurationMs": return "Average Duration"
    case "e2eRate": return "E2E Launch Rate"
    default: return key
  }
}

function TrackingMemberAvatar({ name, avatarUrl, size = "sm" }: { name?: string | null; avatarUrl?: string | null; size?: "sm" | "default" | "lg" }) {
  return (
    <Avatar size={size}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={name || ""} />}
      <AvatarFallback>{name?.charAt(0)?.toUpperCase() || "?"}</AvatarFallback>
    </Avatar>
  )
}

function TrendChart({ series, dataKey, days, color = "#3987e5" }: { series: any[]; dataKey: string; days: number; color?: string }) {
  if (series.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No data in this period.</p>
  }
  const isPercent = dataKey === "e2eRate"
  const isComposed = dataKey === "adsCreated" && series.some(p => p.e2eRate != null)
  const xProps = { dataKey: "bucket" as const, tickFormatter: (v: string) => formatBucket(String(v), days), stroke: "#898781", tick: { fontSize: 11 }, tickLine: false as const, axisLine: false as const, minTickGap: 24 }

  if (isComposed) {
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis {...xProps} />
            <YAxis yAxisId="left" stroke="#898781" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="#10b981" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${v}%`} />
            <Tooltip
              contentStyle={{ background: "#1a1a19", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, fontSize: 12, color: "#ffffff" }}
              itemStyle={{ color: "#ffffff" }}
              labelStyle={{ color: "#898781" }}
              labelFormatter={v => formatBucket(String(v), days)}
              formatter={(value, name) => {
                if (name === "e2eRate") return [`${value}%`, "E2E Launch Rate"]
                if (name === "adsCreated") return [String(value), "Ads Created"]
                return [String(value), getLabelName(String(name))]
              }}
            />
            <Bar yAxisId="right" dataKey="e2eRate" name="e2eRate" fill="#10b981" fillOpacity={0.25} radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Line yAxisId="left" type="monotone" dataKey="adsCreated" name="adsCreated" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (isPercent) {
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis {...xProps} />
            <YAxis stroke="#898781" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} domain={[0, 100]} tickFormatter={v => `${v}%`} />
            <Tooltip
              contentStyle={{ background: "#1a1a19", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, fontSize: 12, color: "#ffffff" }}
              itemStyle={{ color: "#ffffff" }}
              labelStyle={{ color: "#898781" }}
              labelFormatter={v => formatBucket(String(v), days)}
              formatter={value => [`${value}%`, "E2E Launch Rate"]}
            />
            <Bar dataKey="e2eRate" name="e2eRate" fill={color} fillOpacity={0.7} radius={[3, 3, 0, 0]} maxBarSize={28} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis {...xProps} />
          <YAxis stroke="#898781" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            contentStyle={{ background: "#1a1a19", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, fontSize: 12, color: "#ffffff" }}
            itemStyle={{ color: "#ffffff" }}
            labelStyle={{ color: "#898781" }}
            labelFormatter={v => formatBucket(String(v), days)}
            formatter={value => dataKey === "avgDurationMs" ? [formatDuration(Number(value)), "Duration"] : [String(value), getLabelName(String(dataKey))]}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}


const CLASS_BAR: Record<ActivityClass, string> = {
  produce: "bg-primary",
  reuse: "bg-emerald-500",
  govern: "bg-amber-500",
  collaborate: "bg-violet-500",
}

/** A period-over-period change. Renders nothing when there is no comparable base — an unknown is not 0%. */
function DeltaBadge({ value, unit = "%" }: { value: number | null | undefined; unit?: string }) {
  if (value === null || value === undefined) return <span className="text-xs font-normal text-muted-foreground">no prior data</span>
  if (value === 0) return <span className="text-xs font-normal text-muted-foreground">flat vs previous</span>
  return (
    <span className={`text-xs font-normal tabular-nums ${value > 0 ? "text-emerald-600" : "text-amber-600"}`}>
      {value > 0 ? "+" : ""}{value}{unit} vs previous
    </span>
  )
}

/**
 * The App Activity half of Usage: what people did in the app beyond pressing Launch.
 *
 * Three honesty rules are visible in the markup, not just in the data layer:
 *   - an activity nobody could record renders as "not instrumented", never as 0,
 *   - anything derived from a stated assumption carries the word "estimated",
 *   - a period with no comparable base says so instead of showing +0%.
 */
function ActivityPanel({
  payload,
  block,
  scope,
  deltaActions,
  deltaMembers,
}: {
  payload: ActivityPayload
  block: ActivityBlock
  scope: "team" | "mine"
  deltaActions?: number | null
  deltaMembers?: number | null
}) {
  const used = block.byType.filter(type => type.count > 0)
  const maxClass = Math.max(1, ...CLASS_ORDER.map(key => block.byClass[key]))
  /** Which class the reader opened, to answer "Produce counts actions on what, exactly?" */
  const [openClass, setOpenClass] = useState<ActivityClass | null>(null)
  const classRows = openClass
    ? block.byType.filter(type => type.class === openClass).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    : []

  const tiles = [
    {
      label: "Valuable actions",
      value: block.total,
      note: scope === "team" ? "All members, launches included" : "Yours, launches included",
      delta: scope === "team" ? deltaActions : undefined,
    },
    scope === "team"
      ? { label: "Active members", value: block.activeMembers, note: "At least one valuable action", delta: deltaMembers }
      : { label: "Active days", value: block.activeDays, note: `Days you did something, of the period`, delta: undefined },
    {
      label: "Automation coverage",
      value: payload.automationCoverage === null ? "—" : `${payload.automationCoverage}%`,
      note: payload.automationCoverage === null ? "No automation runs and no manual govern actions" : `${payload.automationRuns} runs, org-wide`,
      delta: undefined,
    },
    {
      label: "Est. hours saved",
      value: `~${block.estimatedHoursSaved}h`,
      note: "Estimated from stated assumptions — not measured",
      delta: undefined,
    },
  ]

  return (
    <section className="rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
        <div>
          <h2 className="font-semibold">App activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The work that makes launches possible or cheaper. Page views, logins and filters are deliberately excluded — only actions a person decided on that left a durable record count.
          </p>
        </div>
        <IconChartBar className="size-5 text-muted-foreground" />
      </div>

      {!payload.available && (
        <div className="flex items-start gap-2 border-b bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-500">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{payload.unavailableReason} Everything below counts launches only — it is not evidence that nothing else happened.</span>
        </div>
      )}
      {payload.truncated && (
        <div className="border-b bg-muted/40 p-4 text-xs text-muted-foreground">
          Row cap reached for this period — counts are a floor, not a total. Narrow the reporting period for exact numbers.
        </div>
      )}

      <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(tile => (
          <div key={tile.label} className="rounded-xl border bg-muted/20 p-4">
            <p className="text-sm text-muted-foreground">{tile.label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{tile.value}</p>
            <p className="mt-2 text-xs text-muted-foreground">{tile.note}</p>
            {tile.delta !== undefined && <p className="mt-1"><DeltaBadge value={tile.delta} /></p>}
          </div>
        ))}
      </div>

      <details className="border-t">
        <summary className="cursor-pointer list-none p-5 text-sm text-muted-foreground transition hover:text-foreground">
          <span className="inline-flex items-center gap-1.5">
            <IconChevronRight className="size-3.5 transition-transform [details[open]_&]:rotate-90" />
            Breakdown — what those actions were, and what the app still cannot see
          </span>
        </summary>

        <div className="grid gap-5 border-t p-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium">Where the work goes</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Four kinds of value. A team that only produces is a team with no leverage. Click a class to see exactly which actions, on which screens, are counted into it.
          </p>
          <div className="mt-4 space-y-3">
            {CLASS_ORDER.map(key => (
              <button
                key={key}
                type="button"
                onClick={() => setOpenClass(key)}
                className="block w-full rounded-lg p-2 text-left transition hover:bg-muted/50"
              >
                <div className="flex items-baseline justify-between text-sm">
                  <span className="inline-flex items-center gap-1">
                    {CLASS_LABEL[key]}
                    <IconChevronRight className="size-3.5 text-muted-foreground" />
                  </span>
                  <strong className="tabular-nums">{block.byClass[key]}</strong>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${CLASS_BAR[key]}`} style={{ width: `${Math.round((block.byClass[key] / maxClass) * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{CLASS_DESCRIPTION[key]}</p>
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Reuse per launch: <strong className="tabular-nums">{block.leverageRatio === null ? "—" : block.leverageRatio}</strong>
            {" "}— a ratio, not a rate. The share of launches that reused a template needs template.applied, which nothing records yet.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-medium">Most used this period</h3>
          {used.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nothing recorded in this period.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {used.slice(0, 8).map(type => (
                <div key={type.key} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`size-1.5 shrink-0 rounded-full ${CLASS_BAR[type.class]}`} />
                    <span className="truncate">{type.label}</span>
                  </span>
                  <strong className="tabular-nums">{type.count}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

        <div className="grid gap-5 border-t p-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium">Shipped but unused</h3>
          <p className="mt-1 text-xs text-muted-foreground">Instrumented, genuinely at zero this period. This is the list that decides what to fix, teach or delete.</p>
          {block.unused.length === 0 ? (
            <p className="mt-3 text-sm text-emerald-600">Every instrumented activity was used at least once.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {block.unused.map(type => (
                <span key={type.key} className="rounded-full border border-amber-500/30 bg-amber-500/5 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-500">{type.label}</span>
              ))}
            </div>
          )}
        </div>
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-medium"><IconInfoCircle className="size-3.5 text-muted-foreground" />Not measurable yet</h3>
          <p className="mt-1 text-xs text-muted-foreground">No producer records these, so they are reported as unavailable — never as zero. Each one is a slice of BL-12.</p>
          {block.notInstrumented.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Everything in the catalog is instrumented.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {block.notInstrumented.map(type => (
                <span key={type.key} className="rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">{type.label}</span>
              ))}
            </div>
          )}
        </div>
        </div>
      </details>

      {payload.instrumentedSince && (
        <p className="border-t p-4 text-xs text-muted-foreground">
          App activity has been recorded since {new Date(payload.instrumentedSince).toLocaleDateString("vi-VN")}. Any part of this period before that date is short by construction.
        </p>
      )}

      {/*
        A class total is only trustworthy if you can see what it is made of. Without this
        list "Produce 42" is a number nobody can check, and an unverifiable number on a
        dashboard eventually stops being read.
      */}
      <Dialog open={openClass !== null} onOpenChange={open => { if (!open) setOpenClass(null) }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{openClass ? `${CLASS_LABEL[openClass]} — ${block.byClass[openClass]} action${block.byClass[openClass] === 1 ? "" : "s"}` : ""}</DialogTitle>
            <DialogDescription>
              {openClass ? CLASS_DESCRIPTION[openClass] : ""} Every action counted into this class, and the shipped function it comes from
              {scope === "team" ? ", across the whole team" : ", yours only"}, in this period.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {classRows.map(type => (
              <div key={type.key} className="rounded-lg border p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <span className={`size-1.5 shrink-0 rounded-full ${CLASS_BAR[type.class]}`} />
                    <span className="truncate">{type.label}</span>
                  </span>
                  {type.status === "live" ? (
                    <strong className="tabular-nums">{type.count}</strong>
                  ) : (
                    <span className="shrink-0 rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">not measurable</span>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{type.surface}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            An activity marked <em>not measurable</em> shows no number at all rather than 0: the function exists and people use it, but nothing records who did it, so a 0 would be a claim the app cannot make. Those are slices of BL-12.
          </p>
        </DialogContent>
      </Dialog>
    </section>
  )
}

async function readJsonResponse<T = Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text) throw new Error(`Server returned an empty response (${response.status}).`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Server returned an invalid response (${response.status}).`)
  }
}

type WeeklyReportConfig = {
  to: string[]
  cc: string | null
  scheduleAvailable: boolean
  schedule: {
    enabled: boolean
    weekday: number
    send_time: string
    timezone: string
    pending_review: boolean
    last_due_local_date: string | null
    last_sent_at: string | null
  }
}

type WeeklyEmailPreview = {
  to: string[]
  cc: string
  subject: string
  html: string
  text: string
  previewToken: string
}

type E2ETimeSeriesPoint = { bucket: string; totalAds: number; appAds: number; e2eRate: number }

type E2ERatePayload = {
  e2eRate: number | null
  totalAds: number
  appAds: number
  reason?: string
  timeSeries?: E2ETimeSeriesPoint[]
}

type TrackingPeriod = { from: Date; to: Date }

function resolvePeriod(preset: string, customStart?: Date, customEnd?: Date): TrackingPeriod {
  if ((preset === "custom" || preset === "maximum") && customStart && customEnd) return { from: customStart, to: customEnd }
  const { start, end } = getPresetRange(preset)
  return { from: start, to: end }
}

function dateParam(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function inclusiveDays(period: TrackingPeriod) {
  return Math.round((period.to.getTime() - period.from.getTime()) / 86_400_000) + 1
}

export default function TrackingPage() {
  const reportCaptureRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<TrackingData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [e2eData, setE2eData] = useState<E2ERatePayload | null>(null)
  const isAdminView = data?.role === "admin"
  const [periodPreset, setPeriodPreset] = useState("last_7d")
  const [customStart, setCustomStart] = useState<Date | undefined>(undefined)
  const [customEnd, setCustomEnd] = useState<Date | undefined>(undefined)
  const period = resolvePeriod(periodPreset, customStart, customEnd)
  const [openMetric, setOpenMetric] = useState<null | "successRate" | "adsCreated" | "needsReview" | "avgDuration" | "e2eRate">(null)
  const [memberDetail, setMemberDetail] = useState<{ userId: string; name: string; avatarUrl?: string | null } | null>(null)
  const [memberData, setMemberData] = useState<MemberDetail | null>(null)
  const [memberLoading, setMemberLoading] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [weeklyConfig, setWeeklyConfig] = useState<WeeklyReportConfig | null>(null)
  const [weeklyBusy, setWeeklyBusy] = useState(false)
  const [weeklyError, setWeeklyError] = useState<string | null>(null)
  const [emailPreview, setEmailPreview] = useState<WeeklyEmailPreview | null>(null)
  const [humanizerOpinion, setHumanizerOpinion] = useState("")

  const periodQuery = `from=${dateParam(period.from)}&to=${dateParam(period.to)}`
  const days = data?.days ?? inclusiveDays(period)
  const humanizerOpinionText = humanizerOpinion.trim()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [response, e2eResponse] = await Promise.all([
        fetch(`/api/tracking?${periodQuery}`, { cache: "no-store" }),
        fetch(`/api/tracking/e2e-rate?${periodQuery}`, { cache: "no-store" }).catch(() => null),
      ])
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Tracking data is unavailable.")
      setData(body)
      if (e2eResponse?.ok) {
        setE2eData(await e2eResponse.json())
      } else {
        setE2eData(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Tracking data is unavailable.")
    } finally {
      setLoading(false)
    }
  }, [periodQuery])

  useEffect(() => { void load() }, [load])

  const loadWeeklyConfig = useCallback(async () => {
    if (!isAdminView) return
    try {
      const response = await fetch("/api/tracking/weekly-report", { cache: "no-store" })
      const body = await readJsonResponse<WeeklyReportConfig & { error?: string }>(response)
      if (!response.ok) throw new Error(body.error || "Weekly report settings are unavailable.")
      setWeeklyConfig(body)
    } catch (cause) {
      setWeeklyError(cause instanceof Error ? cause.message : "Weekly report settings are unavailable.")
    }
  }, [isAdminView])

  useEffect(() => {
    if (reportOpen && isAdminView) void loadWeeklyConfig()
  }, [reportOpen, isAdminView, loadWeeklyConfig])

  useEffect(() => {
    if (!memberDetail) { setMemberData(null); return }
    void (async () => {
      setMemberLoading(true)
      try {
        const res = await fetch(`/api/tracking/member?userId=${encodeURIComponent(memberDetail.userId)}&${periodQuery}`, { cache: "no-store" })
        const body = await res.json()
        if (res.ok) setMemberData(body)
      } catch { /* ignore */ }
      finally { setMemberLoading(false) }
    })()
  }, [memberDetail, days, periodQuery])

  const summary = isAdminView ? data?.admin : data?.mine
  const series = data?.adminTimeSeries || []
  const mergedSeries = useMemo<Array<TimeSeriesPoint & { e2eRate: number | null }>>(() => {
    const e2eByBucket = new Map((e2eData?.timeSeries || []).map(point => [point.bucket, point.e2eRate]))
    return series.map(point => ({ ...point, e2eRate: e2eByBucket.get(point.bucket) ?? null }))
  }, [series, e2eData?.timeSeries])

  const isTeamScope = isAdminView
  const metricConfig = summary ? [
    { key: "successRate" as const, label: "Full-batch success", value: `${summary.successRate}%`, note: `${summary.fullSuccess} / ${summary.batches} batches`, warning: false, dataKey: "fullSuccess" as const, methodology: METRIC_METHODOLOGY.successRate, delta: isTeamScope ? data?.previous?.deltaSuccessRate ?? null : undefined, deltaUnit: " pts" },
    { key: "adsCreated" as const, label: "Ads created", value: summary.adsCreated, note: "Excludes failed ads", warning: false, dataKey: "adsCreated" as const, methodology: METRIC_METHODOLOGY.adsCreated, delta: isTeamScope ? data?.previous?.deltaAdsCreated ?? null : undefined, deltaUnit: "%" },
    { key: "needsReview" as const, label: "Needs review", value: summary.nonSuccess, note: "Partial or failed batches", warning: summary.nonSuccess > 0, dataKey: "nonSuccess" as const, methodology: METRIC_METHODOLOGY.needsReview, delta: undefined, deltaUnit: "%" },
    { key: "avgDuration" as const, label: "Avg launch duration", value: formatDuration(summary.averageSessionDurationMs), note: "Server-side batch duration", warning: false, dataKey: "avgDurationMs" as const, methodology: METRIC_METHODOLOGY.avgDuration, delta: undefined, deltaUnit: "%" },
  ] : []
  const northStarMetric = summary ? {
    key: "e2eRate" as const,
    label: "E2E launch rate",
    value: e2eData?.e2eRate == null ? "—" : `${e2eData.e2eRate}%`,
    note: e2eData ? `${e2eData.appAds} / ${e2eData.totalAds} Meta ads tagged [app] in this period` : "Loading Meta ads",
    warning: false,
    methodology: METRIC_METHODOLOGY.e2eRate,
    delta: undefined,
    deltaUnit: "%",
  } : null
  const openSupportingMetric = openMetric && openMetric !== "e2eRate" ? metricConfig.find(m => m.key === openMetric) : null
  const openMetricDefinition = openMetric === "e2eRate" ? northStarMetric : openSupportingMetric
  const allMetrics = northStarMetric ? [northStarMetric, ...metricConfig] : metricConfig

  const activity = data?.activity
  const activityBlock = isAdminView ? activity?.team : activity?.mine

  // One row per person from the two half-pictures. A member who launched but recorded no
  // other activity, and one who did plenty without launching, both belong in the table.
  const usageRows = mergeUsageRows(data?.admin?.team || [], activity?.team?.byMember || [])

  /**
   * The report is built from the payload already on screen, so the number a PM pastes
   * into a message and the number the dashboard shows can never disagree.
   */
  const reportInput = data && activity ? {
    days: data.days,
    generatedAt: data.generatedAt,
    orgName: null,
    delivery: isAdminView && data.admin ? data.admin : data.mine,
    previous: data.previous,
    creative: data.creative,
    e2e: e2eData,
    failureReasons: (isAdminView ? data.failureReasons : data.myFailureReasons) || [],
    activity: (isAdminView ? activity.team : activity.mine) || null,
    activityAvailable: activity.available,
    instrumentedSince: activity.instrumentedSince,
    automationRuns: activity.automationRuns,
    automationCoverage: activity.automationCoverage,
    opinion: humanizerOpinionText || null,
  } : null
  const baseReport = reportInput ? buildTrackingReport(reportInput) : ""
  const weeklyBaseSnapshot = data && data.admin && activity?.team ? {
    report: {
      days: data.days,
      generatedAt: data.generatedAt,
      orgName: null,
      delivery: data.admin,
      previous: data.previous,
      creative: data.creative,
      e2e: e2eData,
      failureReasons: data.failureReasons || [],
      activity: activity.team,
      activityAvailable: activity.available,
      instrumentedSince: activity.instrumentedSince,
      automationRuns: activity.automationRuns,
      automationCoverage: activity.automationCoverage,
      opinion: humanizerOpinionText || null,
    },
    team: usageRows.map(member => ({
      name: member.name,
      adsCreated: member.adsCreated,
      batches: member.batches,
      actions: member.actions,
      activeDays: member.activeDays,
      breadth: member.breadth,
    })),
  } : null

  const weeklySnapshot = weeklyBaseSnapshot
  const reportMarkdown = baseReport

  /** Adoption of Tracking itself is otherwise unmeasurable — see /api/tracking/export. */
  function recordExport() {
    void fetch("/api/tracking/export", { method: "POST" })
  }

  async function copyReport() {
    if (!reportMarkdown) return
    try {
      await navigator.clipboard.writeText(reportMarkdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
      recordExport()
    } catch {
      setCopied(false)
    }
  }

  async function copyReportImage() {
    const node = reportCaptureRef.current
    if (!node) return
    try {
      const html2canvas = (await import("html2canvas")).default
      const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2, useCORS: true, logging: false })
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob) { reject(new Error("image blob empty")); return }
          try {
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
            setCopied(true)
            setTimeout(() => setCopied(false), 2_000)
            recordExport()
            resolve()
          } catch (err) {
            // Fallback: download as PNG when clipboard write is blocked
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = "adlauncher-report.png"
            a.click()
            URL.revokeObjectURL(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2_000)
            recordExport()
            resolve()
          }
        }, "image/png")
      })
    } catch (err) {
      console.error("[report] image copy failed:", err)
      setCopied(false)
    }
  }

  async function previewWeeklyEmail() {
    if (!weeklySnapshot) return
    setWeeklyBusy(true)
    setWeeklyError(null)
    try {
      const response = await fetch("/api/tracking/weekly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", snapshot: weeklySnapshot }),
      })
      const body = await readJsonResponse<WeeklyEmailPreview & { error?: string }>(response)
      if (!response.ok) throw new Error(body.error || "Email preview failed.")
      setEmailPreview(body)
      recordExport()
    } catch (cause) {
      setWeeklyError(cause instanceof Error ? cause.message : "Email preview failed.")
    } finally {
      setWeeklyBusy(false)
    }
  }

  async function sendWeeklyEmail() {
    if (!weeklySnapshot || !emailPreview) return
    setWeeklyBusy(true)
    setWeeklyError(null)
    try {
      const response = await fetch("/api/tracking/weekly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", snapshot: weeklySnapshot, previewToken: emailPreview.previewToken }),
      })
      const body = await readJsonResponse<{ ok?: boolean; error?: string }>(response)
      if (!response.ok) throw new Error(body.error || "Email delivery failed.")
      setEmailPreview(null)
      await loadWeeklyConfig()
    } catch (cause) {
      setWeeklyError(cause instanceof Error ? cause.message : "Email delivery failed.")
    } finally {
      setWeeklyBusy(false)
    }
  }

  async function saveWeeklySchedule() {
    if (!weeklyConfig) return
    setWeeklyBusy(true)
    setWeeklyError(null)
    try {
      const response = await fetch("/api/tracking/weekly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "schedule",
          enabled: weeklyConfig.schedule.enabled,
          weekday: weeklyConfig.schedule.weekday,
          sendTime: weeklyConfig.schedule.send_time,
          timezone: weeklyConfig.schedule.timezone,
        }),
      })
      const body = await readJsonResponse<{ schedule: WeeklyReportConfig["schedule"]; error?: string }>(response)
      if (!response.ok) throw new Error(body.error || "Could not save weekly schedule.")
      setWeeklyConfig(current => current ? { ...current, schedule: body.schedule } : current)
    } catch (cause) {
      setWeeklyError(cause instanceof Error ? cause.message : "Could not save weekly schedule.")
    } finally {
      setWeeklyBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Active organization</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tracking System</h1>
          <p className="mt-2 text-sm text-muted-foreground">Usage — delivery and app activity — plus Creative coverage, for the selected reporting period.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setReportOpen(true)} disabled={!data}>
            <IconNote className="size-4" />
            Report
          </Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <IconLoader2 className="size-4 animate-spin" /> : <IconRefresh className="size-4" />}
            Refresh
          </Button>
        </div>
      </header>

      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><IconAlertTriangle className="size-4" />{error}</div>}
      {loading && !data && <div className="flex min-h-64 items-center justify-center"><IconLoader2 className="size-6 animate-spin text-muted-foreground" /></div>}

      {data && <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{isAdminView ? "Team usage" : "My usage"}</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Reporting period</span>
            <AdsDateRangePicker
              preset={periodPreset}
              customStart={customStart}
              customEnd={customEnd}
              onChange={(nextPreset, nextStart, nextEnd) => {
                setPeriodPreset(nextPreset)
                setCustomStart(nextStart)
                setCustomEnd(nextEnd)
              }}
            />
          </div>
        </div>

        {summary && (
          <div className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Delivery</h2>
              <p className="mt-1 text-sm text-muted-foreground">What reached Meta: batches submitted and ads created.</p>
            </div>

            {northStarMetric && (
              <button
                type="button"
                onClick={() => setOpenMetric("e2eRate")}
                className="group relative flex w-full flex-col justify-between overflow-hidden rounded-2xl border-2 border-primary/50 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent p-6 text-left shadow-md transition hover:border-primary/80 hover:shadow-lg"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                      <IconStar className="size-5 text-primary fill-primary/30" />
                      E2E launch rate
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {northStarMetric.note}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-5xl font-extrabold tracking-tight tabular-nums text-primary group-hover:scale-105 transition-transform duration-200">
                      {northStarMetric.value}
                    </p>
                  </div>
                </div>
                <div className="mt-4 border-t border-muted/50 pt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{northStarMetric.methodology}</span>
                  <span className="inline-flex items-center gap-1 text-primary group-hover:underline"><IconChartBar className="size-3.5" />View snapshot</span>
                </div>
              </button>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metricConfig.map(metric => (
                <button key={metric.key} type="button" onClick={() => setOpenMetric(metric.key)} className="rounded-xl border bg-card p-5 text-left shadow-sm transition hover:border-foreground/20">
                  <p className="text-sm text-muted-foreground">{metric.label}</p>
                  {/* Delta on the same line as the number it qualifies: it is a footnote to
                      that number, and on its own row it read as a second metric. */}
                  <p className={`mt-2 flex flex-wrap items-baseline gap-x-2 text-3xl font-semibold tabular-nums ${metric.warning ? "text-amber-600" : ""}`}>
                    {metric.value}
                    {metric.delta !== undefined && <DeltaBadge value={metric.delta} unit={metric.deltaUnit} />}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">{metric.note}</p>
                  <p className="mt-3 inline-flex items-center gap-1 text-xs text-primary"><IconChartBar className="size-3" />Trend &amp; definition</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {isAdminView && data.admin && (
          <section className="rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b p-5">
              <div>
                <h2 className="font-semibold">Usage by member</h2>
                <p className="mt-1 text-sm text-muted-foreground">Launches and app activity in one row per person. Click a member for their detail and timeline.</p>
              </div>
              <IconRocket className="size-5 text-muted-foreground" />
            </div>
            {usageRows.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Nothing recorded in the selected reporting period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table data-table="comfortable" className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 font-medium">Member</th>
                      <th className="px-5 text-right font-medium" title="Ads that reached Meta: total ads minus failed ads, across every launch mode.">Ads launched</th>
                      <th className="px-5 text-right font-medium" title="Launch batches submitted in this period.">Batches</th>
                      <th className="px-5 text-right font-medium" title="Valuable actions in the app, launches included — creatives, templates, presets, edits, automation, page work. Page views, logins and filters do not count.">App actions</th>
                      <th className="px-5 text-right font-medium" title={`Days out of ${days} on which this person did at least one valuable action (Vietnam calendar days).`}>Active days</th>
                      <th className="px-5 text-right font-medium" title="How many distinct kinds of action the person used — how broadly, not how much.">Features used</th>
                      <th className="px-5 text-right font-medium" title="Consecutive days ending today with at least one launch.">Streak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageRows.map(member => {
                      const isSelf = member.userId === data.currentUserId
                      return (
                        <tr key={member.userId} className={`border-b last:border-0 ${isSelf ? "opacity-60" : "cursor-pointer hover:bg-muted/30"}`} onClick={() => { if (!isSelf) setMemberDetail({ userId: member.userId, name: member.name, avatarUrl: member.avatarUrl }) }} title={isSelf ? "Your own row" : "Open member detail"}>
                          <td className="px-5 font-medium">
                            <div className="flex items-center gap-2">
                              <TrackingMemberAvatar name={member.name} avatarUrl={member.avatarUrl} />
                              <span>{member.name}{isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</span>
                            </div>
                          </td>
                          <td className="px-5 text-right font-medium tabular-nums">{member.adsCreated}</td>
                          <td className="px-5 text-right tabular-nums text-muted-foreground">{member.batches}</td>
                          <td className="px-5 text-right tabular-nums">{activity?.available ? member.actions : "—"}</td>
                          <td className="px-5 text-right tabular-nums">{activity?.available ? `${member.activeDays}/${days}` : "—"}</td>
                          <td className="px-5 text-right tabular-nums text-muted-foreground">{activity?.available ? member.breadth : "—"}</td>
                          <td className="px-5 text-right tabular-nums text-muted-foreground">{(data.teamStreaks || {})[member.userId] || 0}d</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t p-4 text-xs text-muted-foreground">
              {activity?.available
                ? "Sorted by ads launched, then app actions. It is a sort, not a score — the table describes how the product is used, not how hard anyone worked."
                : "App activity is not recorded on this project yet, so those three columns show — rather than 0. Launch columns are complete."}
            </p>
          </section>
        )}

        {isAdminView && data.admin && (
          <details className="rounded-xl border bg-card shadow-sm">
            <summary className="cursor-pointer list-none p-5 text-sm text-muted-foreground transition hover:text-foreground">
              <span className="inline-flex items-center gap-1.5">
                <IconChevronRight className="size-3.5 transition-transform [details[open]_&]:rotate-90" />
                Launch funnel and failure reasons
              </span>
            </summary>
          <div className="grid gap-4 border-t p-5 lg:grid-cols-2">
            <section>
              <h3 className="text-sm font-medium">Launch funnel</h3>
              <p className="mt-1 text-xs text-muted-foreground">Only recorded stages are measured.</p>
              <div className="mt-5 space-y-4 text-sm">
                <div>
                  <div className="flex justify-between"><span>Submitted launch</span><strong>{data.admin.batches}</strong></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full w-full bg-primary" /></div>
                </div>
                <div>
                  <div className="flex justify-between"><span>Full success</span><strong>{data.admin.fullSuccess}</strong></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-500" style={{ width: `${data.admin.successRate}%` }} /></div>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">Open flow, setup campaign, and setup ad set are unavailable: the app does not record these events.</p>
            </section>
            <section>
              <h3 className="text-sm font-medium">Failure reasons</h3>
              <p className="mt-1 text-xs text-muted-foreground">Unclassified stored error messages. Not app-vs-Meta attribution.</p>
              {(data.failureReasons || []).length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No stored failure reasons in this period.</p> : <div className="mt-4 space-y-2">{(data.failureReasons || []).slice(0, 5).map(reason => <div key={reason.label} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm"><span className="truncate">{reason.label}</span><strong className="tabular-nums">{reason.count}</strong></div>)}</div>}
            </section>
          </div>
          </details>
        )}

        {isAdminView && activity && activityBlock && (
          <ActivityPanel
            payload={activity}
            block={activityBlock}
            scope="team"
            deltaActions={data.previous.deltaActivity}
            deltaMembers={data.previous.deltaActiveMembers}
          />
        )}

        <p className="flex items-center gap-2 text-xs text-muted-foreground"><IconChartBar className="size-3.5" />Updated {new Date(data.generatedAt).toLocaleString()}</p>
      </>}

      <Dialog open={openMetric !== null} onOpenChange={open => { if (!open) setOpenMetric(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{openMetricDefinition?.label}</DialogTitle>
            <DialogDescription>{openMetricDefinition?.methodology}</DialogDescription>
          </DialogHeader>
          {openMetric === "e2eRate" ? (
            <div className="space-y-4">
              <p className="text-center text-sm text-muted-foreground">
                Real-time Meta snapshot: {e2eData?.appAds ?? 0} app-launched ads out of {e2eData?.totalAds ?? 0} total ads.
              </p>
              {e2eData?.timeSeries && (
                <TrendChart series={e2eData.timeSeries} dataKey="e2eRate" days={days} color="#10b981" />
              )}
            </div>
          ) : openSupportingMetric ? (
            <TrendChart
              series={openSupportingMetric.dataKey === "adsCreated" ? mergedSeries : series}
              dataKey={openSupportingMetric.dataKey}
              days={days}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4 pr-8">
              <div>
                <DialogTitle>Period report</DialogTitle>
                <DialogDescription>{isAdminView ? "Organization operating view" : "Your usage"} · last {days} days · measured values stay distinct from estimates and unavailable data.</DialogDescription>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" title={copied ? "Đã copy" : "Copy report"} className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-2 text-muted-foreground transition hover:text-foreground">
                    {copied ? <IconCheck className="size-4 text-emerald-600" /> : <IconCopy className="size-4" />}
                    <IconChevronDown className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => void copyReport()} className="gap-2 text-xs">
                    <IconCopy className="size-4" /> Copy markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void copyReportImage()} className="gap-2 text-xs">
                    <IconPhoto className="size-4" /> Copy as image
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4 pr-2">
            <div ref={reportCaptureRef} className="space-y-5 rounded-xl bg-background p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {allMetrics.map(metric => {
                const isE2e = metric.key === "e2eRate"
                return (
                  <div key={metric.key} className={isE2e ? "rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 p-4 shadow-sm" : "rounded-lg border bg-muted/20 p-3"}>
                    <p className={`flex items-center gap-1.5 text-xs ${isE2e ? "font-medium text-primary" : "text-muted-foreground"}`}>
                      {isE2e && <IconStar className="size-3.5 fill-primary/30" />}
                      {metric.label}
                    </p>
                    <p className={`mt-1.5 flex flex-wrap items-baseline gap-x-1.5 font-semibold tabular-nums ${isE2e ? "text-4xl text-primary" : "text-xl"} ${metric.warning ? "text-amber-600" : ""}`}>
                      {metric.value}
                      {metric.delta !== undefined && <DeltaBadge value={metric.delta} unit={metric.deltaUnit} />}
                    </p>
                  </div>
                )
              })}
            </div>

            {isAdminView && data?.admin && (
              <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <section className="rounded-xl border bg-gradient-to-br from-blue-500/10 via-card to-card p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Executive readout</p>
                  <p className="mt-3 text-lg font-medium leading-relaxed">
                    {e2eData?.e2eRate != null
                      ? <><strong className="text-primary">{e2eData.e2eRate}%</strong> of ads on Meta this period were launched end-to-end via AdLauncher (<strong>{e2eData.appAds}/{e2eData.totalAds}</strong> ads tagged [app]).</>
                      : "E2E launch rate is unavailable this period (no Meta connection or no ads on connected accounts)."}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Supporting: {data.admin.adsCreated} ads from {data.admin.batches} batches at {data.admin.successRate}% full-batch success.
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {activity?.available && activity.team
                      ? `${activity.team.activeMembers} members recorded ${activity.team.total} measurable app actions across ${activity.team.activeDays} active days. Estimated time saved: ~${activity.team.estimatedHoursSaved}h.`
                      : "App activity is unavailable; delivery remains fully measured."}
                  </p>
                </section>
                <section className={`rounded-xl border p-5 ${data.admin.nonSuccess > 0 ? "border-amber-500/30 bg-amber-500/5" : "bg-emerald-500/5"}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Attention</p>
                  <p className="mt-3 text-3xl font-semibold tabular-nums">{data.admin.nonSuccess}</p>
                  <p className="mt-1 text-sm">batches need review</p>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{data.creative.unlaunched} of {data.creative.ready} ready creatives remain unlaunched. {data.failureReasons?.[0] ? `Top stored error: ${data.failureReasons[0].label} (${data.failureReasons[0].count}).` : "No stored failure reason."}</p>
                </section>
              </div>
            )}

            {isAdminView && mergedSeries.length > 0 && (
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Ads created — organization, last {days} days</p>
                <div className="-mb-2 mt-1 h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={mergedSeries} margin={{ top: 24, right: 8, bottom: 0, left: -16 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                      <XAxis dataKey="bucket" tickFormatter={v => formatBucket(String(v), days)} stroke="#898781" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis yAxisId="left" stroke="#898781" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={32} />
                      {mergedSeries.some(p => p.e2eRate != null) && (
                        <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="#10b981" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={36} tickFormatter={v => `${v}%`} />
                      )}
                      <Tooltip
                        contentStyle={{ background: "#1a1a19", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, fontSize: 12, color: "#ffffff" }}
                        itemStyle={{ color: "#ffffff" }}
                        labelStyle={{ color: "#898781" }}
                        labelFormatter={v => formatBucket(String(v), days)}
                        formatter={(value, name) => name === "e2eRate" ? [`${value}%`, "E2E Launch Rate"] : [String(value), "Ads Created"]}
                      />
                      {mergedSeries.some(p => p.e2eRate != null) && (
                        <Bar yAxisId="right" dataKey="e2eRate" name="e2eRate" fill="#10b981" fillOpacity={0.25} radius={[3, 3, 0, 0]} maxBarSize={28} />
                      )}
                      <Line yAxisId="left" type="monotone" dataKey="adsCreated" name="adsCreated" stroke="#3987e5" strokeWidth={2} dot={false} activeDot={{ r: 3 }}>
                        <LabelList dataKey="adsCreated" position="top" fill="#ffffff" fontSize={14} fontWeight={800} stroke="#2563eb" strokeWidth={4} paintOrder="stroke" />
                      </Line>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {isAdminView && (
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl border p-5">
                  <div className="flex items-center justify-between"><div><h3 className="font-semibold">Team usage</h3><p className="mt-1 text-xs text-muted-foreground">Measurable contribution, not a performance score.</p></div><IconChartBar className="size-5 text-muted-foreground" /></div>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b text-xs text-muted-foreground"><tr><th className="py-2 text-left font-medium">Member</th><th className="py-2 text-right font-medium">Ads</th><th className="py-2 text-right font-medium">Actions</th><th className="py-2 text-right font-medium">Days</th></tr></thead>
                      <tbody>{usageRows.slice(0, 8).map(member => <tr key={member.userId} className="border-b last:border-0"><td className="py-2.5 font-medium">{member.name}</td><td className="py-2.5 text-right tabular-nums">{member.adsCreated}</td><td className="py-2.5 text-right tabular-nums">{activity?.available ? member.actions : "-"}</td><td className="py-2.5 text-right tabular-nums text-muted-foreground">{activity?.available ? `${member.activeDays}/${days}` : "-"}</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>
                <section className="rounded-xl border p-5">
                  <div><h3 className="font-semibold">App activity</h3><p className="mt-1 text-xs text-muted-foreground">Action mix across the operating workflow.</p></div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {activity?.available && activity.team ? CLASS_ORDER.map(key => <div key={key} className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{CLASS_LABEL[key]}</p><p className="mt-1 text-xl font-semibold tabular-nums">{activity.team!.byClass[key]}</p></div>) : <p className="col-span-2 text-sm text-muted-foreground">App activity unavailable. No zero is inferred.</p>}
                  </div>
                </section>
              </div>
            )}
            </div>

            {isAdminView && (
              <section className="rounded-xl border bg-muted/15 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><div className="flex items-center gap-2"><IconMail className="size-5" /><h3 className="font-semibold">Weekly email</h3>{weeklyConfig?.schedule.pending_review && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700">Review due</span>}</div><p className="mt-1 text-xs text-muted-foreground">To Kevin, Seth · CC PATI-BOM. Preview approval required before every send.</p></div>
                  <Button onClick={() => void previewWeeklyEmail()} disabled={weeklyBusy || !weeklySnapshot}><IconMail className="size-4" />Preview email</Button>
                </div>
                <label className="mt-4 block text-xs font-medium text-muted-foreground">
                  Humanizer opinion
                  <textarea value={humanizerOpinion} onChange={event => setHumanizerOpinion(event.target.value)} maxLength={2000} rows={3} placeholder="Nhập nhận định thủ công cho email report. Bỏ trống để app tự viết." className="mt-1 block w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
                </label>
                {weeklyConfig && <div className="mt-4 grid gap-3 rounded-lg border bg-background p-4 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end">
                  <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={weeklyConfig.schedule.enabled} onChange={event => setWeeklyConfig(current => current ? { ...current, schedule: { ...current.schedule, enabled: event.target.checked } } : current)} />Weekly</label>
                  <label className="text-xs text-muted-foreground">Day<select value={weeklyConfig.schedule.weekday} onChange={event => setWeeklyConfig(current => current ? { ...current, schedule: { ...current.schedule, weekday: Number(event.target.value) } } : current)} className="mt-1 block w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground"><option value={1}>Monday</option><option value={2}>Tuesday</option><option value={3}>Wednesday</option><option value={4}>Thursday</option><option value={5}>Friday</option><option value={6}>Saturday</option></select></label>
                  <label className="text-xs text-muted-foreground">Time · Vietnam<input type="time" value={weeklyConfig.schedule.send_time} onChange={event => setWeeklyConfig(current => current ? { ...current, schedule: { ...current.schedule, send_time: event.target.value } } : current)} className="mt-1 block w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground" /></label>
                  <Button variant="outline" onClick={() => void saveWeeklySchedule()} disabled={weeklyBusy || !weeklyConfig.scheduleAvailable}><IconCalendarTime className="size-4" />Save</Button>
                </div>}
                <p className="mt-3 text-xs text-muted-foreground">Schedule creates a pending preview at the selected time; it never sends unattended. Production evaluation depends on BL-23.</p>
                {weeklyConfig && !weeklyConfig.scheduleAvailable && <p className="mt-2 text-xs text-amber-700">Apply `20260807_weekly_report_schedules.sql` to enable scheduling.</p>}
                {weeklyError && <p className="mt-2 text-sm text-destructive">{weeklyError}</p>}
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={emailPreview !== null} onOpenChange={open => { if (!open) setEmailPreview(null) }}>
        <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden">
          <DialogHeader><DialogTitle>Email preview</DialogTitle><DialogDescription>Final gate. Confirm recipients, subject and rendered content before real delivery.</DialogDescription></DialogHeader>
          {emailPreview && <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-2 pr-2">
            <div className="grid gap-2 rounded-lg border bg-muted/20 p-4 text-sm"><div><span className="inline-block w-16 text-muted-foreground">To</span>{emailPreview.to.join(", ")}</div><div><span className="inline-block w-16 text-muted-foreground">CC</span>{emailPreview.cc}</div><div><span className="inline-block w-16 text-muted-foreground">Subject</span><strong>{emailPreview.subject}</strong></div></div>
            <iframe title="Weekly report email preview" sandbox="" srcDoc={emailPreview.html} className="h-[52vh] w-full rounded-lg border bg-white" />
            {weeklyError && <p className="text-sm text-destructive">{weeklyError}</p>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEmailPreview(null)}>Back</Button><Button onClick={() => void sendWeeklyEmail()} disabled={weeklyBusy}>{weeklyBusy ? <IconLoader2 className="size-4 animate-spin" /> : <IconMail className="size-4" />}Send email</Button></div>
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={memberDetail !== null} onOpenChange={open => { if (!open) { setMemberDetail(null); setMemberData(null) } }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {memberData && <TrackingMemberAvatar name={memberDetail?.name} avatarUrl={memberData.avatarUrl ?? memberDetail?.avatarUrl} size="default" />}
              {memberDetail?.name}
            </DialogTitle>
            <DialogDescription>Delivery and app activity in the last {days} days.</DialogDescription>
          </DialogHeader>
          {memberLoading ? (
            <div className="flex min-h-32 items-center justify-center"><IconLoader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : memberData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: "Batches", value: memberData.summary.batches },
                  { label: "Full success", value: memberData.summary.fullSuccess },
                  { label: "Needs review", value: memberData.summary.nonSuccess },
                  { label: "Ads created", value: memberData.summary.adsCreated },
                  { label: "Streak", value: `${memberData.streak}d` },
                  { label: "Avg duration", value: formatDuration(memberData.summary.averageSessionDurationMs) },
                ].map(stat => (
                  <div key={stat.label} className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{stat.value}</p>
                  </div>
                ))}
              </div>
              {memberData.activity && (
                <div className="space-y-4 rounded-lg border p-4">
                  <div>
                    <h3 className="text-sm font-medium">App activity</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Work beyond pressing Launch. {memberData.activity.available ? "" : memberData.activity.unavailableReason}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "Actions", value: memberData.activity.total },
                      { label: "Active days", value: memberData.activity.activeDays },
                      { label: "Breadth", value: memberData.activity.byType.filter(type => type.count > 0).length },
                      { label: "Est. saved", value: `~${memberData.activity.estimatedHoursSaved}h` },
                    ].map(stat => (
                      <div key={stat.label} className="rounded-lg bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">{stat.label}</p>
                        <p className="mt-1 text-lg font-semibold tabular-nums">{stat.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {CLASS_ORDER.map(key => (
                      <span key={key} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" title={CLASS_DESCRIPTION[key]}>
                        <span className={`size-1.5 rounded-full ${CLASS_BAR[key]}`} />
                        {CLASS_LABEL[key]}
                        <strong className="tabular-nums">{memberData.activity!.byClass[key]}</strong>
                      </span>
                    ))}
                  </div>
                  {memberData.activity.byType.filter(type => type.count > 0).length > 0 && (
                    <div className="space-y-2">
                      {memberData.activity.byType.filter(type => type.count > 0).map(type => (
                        <div key={type.key} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-1.5 text-xs">
                          <span className="flex min-w-0 items-center gap-2"><span className={`size-1.5 shrink-0 rounded-full ${CLASS_BAR[type.class]}`} /><span className="truncate">{type.label}</span></span>
                          <strong className="tabular-nums">{type.count}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {memberData.timeline && memberData.timeline.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium">Activity timeline</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Most recent first. Only recorded, person-initiated actions — cron and automation runs are excluded.</p>
                  <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto rounded-md border p-2">
                    {memberData.timeline.map((entry, index) => (
                      <div key={`${entry.at}-${index}`} className="flex items-start gap-2 rounded px-2 py-1 text-xs hover:bg-muted/40">
                        <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${CLASS_BAR[entry.class]}`} />
                        <span className="w-28 shrink-0 text-muted-foreground">{new Date(entry.at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="font-medium">{entry.label}</span>
                        {entry.detail && <span className="truncate text-muted-foreground">— {entry.detail}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium">Recent batches</h3>
                <div className="mt-2 max-h-48 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <tbody>
                      {memberData.recentBatches.map(batch => (
                        <tr key={batch.id} className="border-b last:border-0">
                          <td className="px-3 py-2 text-muted-foreground">{batch.created_at ? new Date(batch.created_at).toLocaleDateString() : "-"}</td>
                          <td className="px-3 py-2">{batch.ad_account_name || "Unknown"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Math.max(0, (batch.total_ads || 0) - (batch.failed_ads || 0))}</td>
                          <td className="px-3 py-2 text-right"><span className={batch.status === "success" ? "text-emerald-600" : "text-amber-600"}>{batch.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {memberData.painpoint && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Painpoint this week</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{memberData.painpoint}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
