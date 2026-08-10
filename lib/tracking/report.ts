/**
 * The PM → CEO report, built from exactly the numbers already on screen.
 *
 * No second pipeline, no second definition of a metric: whatever the dashboard shows
 * is what gets pasted into Lark. If the two could disagree, the report would be the
 * one people quote and the dashboard the one nobody trusts.
 *
 * Honesty rules baked in here rather than left to whoever writes the message:
 *   - every number is tagged measured / estimated / unavailable,
 *   - "not instrumented" is never printed as 0,
 *   - a period that starts before activity_log did says so in the footer.
 */

import { CLASS_LABEL, type ActivityClass } from "./activity-catalog"

export type ReportActivity = {
  total: number
  byClass: Record<ActivityClass, number>
  byType: Array<{ key: string; label: string; class: ActivityClass; status: string; count: number }>
  activeMembers: number
  activeDays: number
  unused: Array<{ key: string; label: string }>
  notInstrumented: Array<{ key: string; label: string }>
  leverageRatio: number | null
  estimatedHoursSaved: number
}

export type ReportInput = {
  days: number
  generatedAt: string
  orgName?: string | null
  delivery: {
    batches: number
    fullSuccess: number
    nonSuccess: number
    adsCreated: number
    successRate: number
    averageSessionDurationMs: number | null
  }
  previous: {
    deltaBatches: number | null
    deltaAdsCreated: number | null
    deltaSuccessRate: number
    deltaActivity: number | null
    deltaActiveMembers: number | null
    deltaAutomationRuns: number | null
  }
  creative: { ready: number; launched: number; unlaunched: number; launchRate: number }
  e2e?: { e2eRate: number | null; totalAds: number; appAds: number; timeSeries?: Array<{ bucket: string; totalAds: number; appAds: number; e2eRate: number }> } | null
  failureReasons: Array<{ label: string; count: number }>
  activity: ReportActivity | null
  activityAvailable: boolean
  instrumentedSince: string | null
  automationRuns: number
  automationCoverage: number | null
  /** Admin-written override for the email's Humanizer opinion line. Falls back to the auto-generated read when blank. */
  opinion?: string | null
}

/**
 * The report as a printable page — the PDF path.
 *
 * A print dialog is the whole PDF engine here: no library, no server render, and the
 * file the reader gets is the same text the dashboard showed. It handles exactly the
 * four things `buildTrackingReport` and `buildProbationReport` emit — `#`/`##` headings,
 * `**bold**`, `_italic_` — because a general Markdown parser would be a dependency
 * bought to render output we control.
 *
 * Everything is escaped before any tag is added, so a stored error message containing
 * `<script>` prints as text.
 */
export function reportToHtml(markdown: string, title = "Tracking report"): string {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const inline = (value: string) =>
    escape(value)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/_([^_]+)_/g, "<em>$1</em>")

  const body = markdown
    .split("\n")
    .map(line => {
      const text = line.trim()
      if (!text) return ""
      if (text.startsWith("## ")) return `<h2>${inline(text.slice(3))}</h2>`
      if (text.startsWith("# ")) return `<h1>${inline(text.slice(2))}</h1>`
      return `<p>${inline(text)}</p>`
    })
    .filter(Boolean)
    .join("\n")

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
    body{font:14px/1.65 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a19;max-width:46rem;margin:2.5rem auto;padding:0 1.5rem}
    h1{font-size:1.35rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:1.5rem 0 .25rem}
    p{margin:.45rem 0}em{color:#666;font-style:normal;font-size:.85em}
    @media print{body{margin:0}}
  </style></head><body>${body}</body></html>`
}

function signed(value: number | null, suffix = "%"): string {
  if (value === null) return "n/a"
  const sign = value > 0 ? "+" : ""
  return `${sign}${value}${suffix}`
}

function duration(ms: number | null): string {
  if (ms === null) return "unavailable"
  const seconds = Math.round(ms / 1000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}

/**
 * Four lines, one per question a reader actually has: what came out, what it cost, what
 * is at risk, who used it. The long version explained every metric inline and nobody
 * read past the second heading — a report that is skimmed is a report that is used, so
 * the definitions moved to the dashboard (where the tile that shows the number also
 * explains it) and only the label — measured / estimated / unavailable — stays here.
 */
export function buildTrackingReport(input: ReportInput): string {
  const { delivery, previous, creative, activity } = input
  const lines: string[] = []

  lines.push(`# Tracking — ${input.orgName || "AdLauncher"} · last ${input.days} days`)
  lines.push(`_${new Date(input.generatedAt).toLocaleDateString("vi-VN")} · vs previous ${input.days} days · measured = counted · **estimated** = from a stated assumption · unavailable ≠ 0_`)
  lines.push("")

  if (input.e2e && input.e2e.e2eRate !== null) {
    lines.push(`**North Star — E2E launch rate** — **${input.e2e.e2eRate}%** of ads on Meta were launched via AdLauncher (${input.e2e.appAds}/${input.e2e.totalAds} ads tagged [app] across connected accounts, measured)`)
    lines.push("")
  }

  lines.push(`**Output** — ${delivery.adsCreated} ads (${signed(previous.deltaAdsCreated)}) · ${delivery.batches} batches (${signed(previous.deltaBatches)}), ${delivery.successRate}% full success (${signed(previous.deltaSuccessRate, " pts")}) · avg session ${duration(delivery.averageSessionDurationMs)}`)

  const efficiency: string[] = []
  if (activity && input.activityAvailable) {
    efficiency.push(`${activity.total} actions, ${activity.activeMembers} members (${signed(previous.deltaActivity)})`)
    efficiency.push((Object.keys(activity.byClass) as ActivityClass[]).map(key => `${CLASS_LABEL[key]} ${activity.byClass[key]}`).join(" · "))
    efficiency.push(`reuse/launch ${activity.leverageRatio === null ? "unavailable" : activity.leverageRatio}`)
    efficiency.push(`~${activity.estimatedHoursSaved}h saved (**estimated**)`)
  } else {
    efficiency.push("**App activity:** unavailable — activity_log is not applied on this project yet")
  }
  efficiency.push(`**Automation coverage:** ${input.automationCoverage === null ? "unavailable" : `${input.automationCoverage}%`} (${input.automationRuns} runs, ${signed(previous.deltaAutomationRuns)})`)
  lines.push(`**Efficiency** — ${efficiency.join(" · ")}`)

  const topReason = input.failureReasons[0]
  lines.push(`**Risk** — ${delivery.nonSuccess}/${delivery.batches} batches need review · ${topReason ? `top error "${topReason.label}" ×${topReason.count} (unclassified)` : "no stored errors"} · ${creative.unlaunched}/${creative.ready} ready creatives never launched (lifetime)`)

  if (activity && input.activityAvailable) {
    const adoption: string[] = [`${activity.activeMembers} active (${signed(previous.deltaActiveMembers)}), ${activity.activeDays} active days`]
    const top = activity.byType.filter(type => type.count > 0).slice(0, 3)
    adoption.push(top.length ? `top: ${top.map(type => `${type.label} (${type.count})`).join(", ")}` : "nothing recorded")
    if (activity.unused.length) adoption.push(`unused: ${activity.unused.map(type => type.label).join(", ")}`)
    // Never folded into "unused" — these are at no number at all, not at zero.
    if (activity.notInstrumented.length) adoption.push(`Not measurable yet: ${activity.notInstrumented.map(type => type.label).join(", ")}`)
    lines.push(`**Adoption** — ${adoption.join(" · ")}`)
  } else {
    lines.push("**Adoption:** unavailable until activity_log is applied (decision D1).")
  }

  if (input.instrumentedSince) {
    lines.push("")
    lines.push(`_App activity recorded only since ${new Date(input.instrumentedSince).toLocaleDateString("vi-VN")} — earlier days in this window are short by construction._`)
  }

  return lines.join("\n")
}
