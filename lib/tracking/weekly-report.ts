import type { ReportInput } from "./report"

export const WEEKLY_REPORT_TO = ["kevin@patigroup.com", "seth@patigroup.com"] as const
export const WEEKLY_REPORT_CC = "wpjpwk7o7pbxz@patigroup.com"
export const DEFAULT_REPORT_TIMEZONE = "Asia/Ho_Chi_Minh"

export type WeeklyReportTeamRow = {
  name: string
  adsCreated: number
  batches: number
  actions: number
  activeDays: number
  breadth: number
}

export type WeeklyReportSnapshot = {
  report: ReportInput
  team: WeeklyReportTeamRow[]
}

export type WeeklyReportSchedule = {
  enabled: boolean
  weekday: number
  sendTime: string
  timezone: string
  lastDueLocalDate: string | null
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatDate(date: Date, timezone = DEFAULT_REPORT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone,
  }).format(date)
}

function signed(value: number | null, suffix = "%"): string {
  if (value === null) return "n/a"
  return `${value > 0 ? "+" : ""}${value}${suffix}`
}

function riskSentence(report: ReportInput): string {
  const risks: string[] = []
  if (report.delivery.nonSuccess > 0) risks.push(`${report.delivery.nonSuccess} launch batches need review`)
  if (report.creative.unlaunched > 0) risks.push(`${report.creative.unlaunched} ready creatives remain unlaunched`)
  if (report.failureReasons[0]) risks.push(`top stored error: ${report.failureReasons[0].label} (${report.failureReasons[0].count})`)
  return risks.length ? risks.join("; ") : "No measured delivery risk in this period."
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.SERVER_URL || "https://ads.patigroup.com"
}

/**
 * Humanizer opinion — the one qualitative read a PM/user would give this number, not
 * another restated stat. E2E rate IS the app's adoption rate: every ad on Meta launched
 * outside AdLauncher (no [app] tag) is a user who had to bypass the app to get work done.
 */
function humanizerOpinion(report: ReportInput): string {
  if (report.opinion) return report.opinion
  const e2e = report.e2e
  if (!e2e || e2e.e2eRate === null) {
    return "Humanizer opinion — Adoption rate is unavailable this period, so we can't tell if the team is actually using the app or working around it. Confirm the Meta connection is live before trusting any other number in this report."
  }
  if (e2e.e2eRate >= 100) {
    return "Humanizer opinion — 100% adoption: every ad on Meta this period went through AdLauncher. From a PM lens, the app is not a side tool, it's the only way work gets done here — a strong signal to keep investing in it rather than defending its usage."
  }
  if (e2e.e2eRate >= 80) {
    return `Humanizer opinion — Adoption is high (${e2e.e2eRate}%) but not full: ${e2e.totalAds - e2e.appAds} ads this period skipped the app and went straight to Meta Ads Manager. Worth asking the team directly why — a missing feature or a habit is a very different fix.`
  }
  return `Humanizer opinion — Adoption is at ${e2e.e2eRate}%, meaning ${e2e.totalAds - e2e.appAds} of ${e2e.totalAds} ads bypassed AdLauncher entirely. From a user's perspective that's a vote against the app for most of their launches — treat this as a usability or trust gap, not a reporting gap.`
}

function bucketLabel(bucket: string): string {
  const [year, month, day] = bucket.split("-")
  return year && month && day ? `${day}/${month}` : bucket
}

function e2eBarChart(report: ReportInput): string {
  const points = report.e2e?.timeSeries || []
  if (points.length === 0) return ""
  return `
    <div style="margin:16px 0 0;padding:16px 0 0;border-top:1px solid rgba(16,185,129,.25)">
      <div style="margin:0 0 10px;font-size:13px;font-weight:bold;color:rgb(31,35,41)">E2E launch rate by day</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">
        ${points.map(point => `
        <tr>
          <td width="48" style="padding:4px 8px 4px 0;color:rgb(100,106,115)">${escapeHtml(bucketLabel(point.bucket))}</td>
          <td style="padding:4px 0">
            <div style="height:12px;background:rgb(232,245,240);border-radius:999px;overflow:hidden">
              <div style="height:12px;width:${Math.max(0, Math.min(100, point.e2eRate))}%;background:rgb(16,185,129);border-radius:999px"></div>
            </div>
          </td>
          <td width="90" style="padding:4px 0 4px 10px;text-align:right;color:rgb(60,66,75);font-variant-numeric:tabular-nums">${point.e2eRate}% · ${point.appAds}/${point.totalAds}</td>
        </tr>`).join("")}
      </table>
    </div>`
}

export function buildWeeklyReportEmail({ report, team }: WeeklyReportSnapshot): { subject: string; html: string; text: string } {
  const date = new Date(report.generatedAt)
  const subject = `[INFORM - Tech/Raymond] AdLauncher Weekly Report (${formatDate(date)})`
  const activity = report.activityAvailable ? report.activity : null
  const orgName = escapeHtml(report.orgName || "AdLauncher")
  const risk = riskSentence(report)
  const teamRows = team.slice(0, 20).map(row => `
    <tr>
      <td style="border-bottom:1px solid rgb(222,224,227);padding:9px 8px"><b>${escapeHtml(row.name)}</b></td>
      <td style="border-bottom:1px solid rgb(222,224,227);padding:9px 8px;text-align:right">${row.adsCreated}</td>
      <td style="border-bottom:1px solid rgb(222,224,227);padding:9px 8px;text-align:right">${row.actions}</td>
      <td style="border-bottom:1px solid rgb(222,224,227);padding:9px 8px;text-align:right">${row.activeDays}/${report.days}</td>
      <td style="border-bottom:1px solid rgb(222,224,227);padding:9px 8px;text-align:right">${row.breadth}</td>
    </tr>`).join("")

  const activityMix = activity
    ? Object.entries(activity.byClass).map(([key, value]) => `<li><b>${escapeHtml(key)}</b>: ${value}</li>`).join("")
    : "<li>App activity unavailable; launch delivery remains measured.</li>"

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:rgb(245,246,248);font-family:Arial,sans-serif;color:rgb(31,35,41)">
  <div style="max-width:720px;margin:24px auto;background:white;border:1px solid rgb(222,224,227);border-radius:12px;overflow:hidden">
    <div style="padding:24px 28px;background:rgb(20,86,240);color:white">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="${appUrl()}/icon.png" width="28" height="28" alt="AdLauncher" style="border-radius:6px;background:white;padding:2px;display:block" />
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">AdLauncher · ${orgName}</div>
      </div>
      <h1 style="margin:8px 0 0;font-size:24px">Weekly operating report</h1>
      <p style="margin:6px 0 0;opacity:.85">Last ${report.days} days · generated ${formatDate(date)}</p>
    </div>
    <div style="padding:24px 28px">
      ${report.e2e && report.e2e.e2eRate !== null ? `
      <div style="padding:22px 24px;margin:0 0 20px;background:linear-gradient(135deg,rgba(20,86,240,.14),rgba(20,86,240,.04));border:2px solid rgba(20,86,240,.4);border-radius:12px">
        <div style="display:flex;align-items:baseline;gap:12px">
          <b style="font-size:44px;line-height:1;color:rgb(20,86,240)">${report.e2e.e2eRate}%</b>
          <span style="font-size:14px;color:rgb(60,66,75)">of ads on Meta this period were launched via AdLauncher (${report.e2e.appAds}/${report.e2e.totalAds} ads tagged [app], measured)</span>
        </div>
        ${e2eBarChart(report)}
      </div>` : `
      <div style="padding:16px 18px;margin:0 0 20px;background:rgb(242,243,245);border-radius:8px">
        <span style="font-size:13px;color:rgb(100,106,115)">E2E launch rate unavailable this period (no Meta connection or no ads on connected accounts).</span>
      </div>`}
      <h2 style="font-size:18px;margin:0 0 12px">Supporting metrics</h2>
      <table width="100%" cellpadding="0" cellspacing="8" style="margin:0 -8px 20px">
        <tr>
          <td style="padding:12px;border:1px solid rgb(222,224,227);border-radius:8px"><span style="font-size:12px;color:rgb(100,106,115)">ADS LAUNCHED</span><br><b style="font-size:24px">${report.delivery.adsCreated}</b><br><span style="font-size:12px;color:rgb(100,106,115)">${signed(report.previous.deltaAdsCreated)} vs prior</span></td>
          <td style="padding:12px;border:1px solid rgb(222,224,227);border-radius:8px"><span style="font-size:12px;color:rgb(100,106,115)">FULL SUCCESS</span><br><b style="font-size:24px">${report.delivery.successRate}%</b><br><span style="font-size:12px;color:rgb(100,106,115)">${signed(report.previous.deltaSuccessRate, " pts")} vs prior</span></td>
          <td style="padding:12px;border:1px solid rgb(222,224,227);border-radius:8px"><span style="font-size:12px;color:rgb(100,106,115)">APP ACTIONS</span><br><b style="font-size:24px">${activity ? activity.total : "-"}</b><br><span style="font-size:12px;color:rgb(100,106,115)">${activity ? signed(report.previous.deltaActivity) : "unavailable"}</span></td>
          <td style="padding:12px;border:1px solid rgb(222,224,227);border-radius:8px"><span style="font-size:12px;color:rgb(100,106,115)">ACTIVE MEMBERS</span><br><b style="font-size:24px">${activity ? activity.activeMembers : "-"}</b><br><span style="font-size:12px;color:rgb(100,106,115)">${activity ? `${activity.activeDays} active days` : "unavailable"}</span></td>
        </tr>
      </table>

      <div style="padding:14px 16px;background:rgb(242,243,245);border-left:3px solid rgb(20,86,240);border-radius:0 8px 8px 0">
        <b>Management readout</b>
        <p style="margin:6px 0 0;line-height:1.6">${report.e2e && report.e2e.e2eRate !== null ? `${report.e2e.e2eRate}% of ads on Meta this period were launched end-to-end via AdLauncher (${report.e2e.appAds}/${report.e2e.totalAds}). ` : ""}The team delivered ${report.delivery.adsCreated} ads from ${report.delivery.batches} batches at ${report.delivery.successRate}% full-batch success. ${activity ? `${activity.activeMembers} members recorded ${activity.total} measurable app actions across ${activity.activeDays} active days.` : "App activity is not measurable on this project yet."}</p>
        <p style="margin:8px 0 0;line-height:1.6;font-size:13px;color:rgb(79,70,229)">${escapeHtml(humanizerOpinion(report))}</p>
      </div>

      <h2 style="font-size:18px;margin:24px 0 10px">Team usage</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
        <thead><tr style="background:rgb(242,243,245)"><th style="padding:9px 8px;text-align:left">Member</th><th style="padding:9px 8px;text-align:right">Ads</th><th style="padding:9px 8px;text-align:right">Actions</th><th style="padding:9px 8px;text-align:right">Active days</th><th style="padding:9px 8px;text-align:right">Features</th></tr></thead>
        <tbody>${teamRows || `<tr><td colspan="5" style="padding:12px;color:rgb(100,106,115)">No team usage recorded.</td></tr>`}</tbody>
      </table>

      <h2 style="font-size:18px;margin:24px 0 8px">App activity</h2>
      <ul style="margin:0;padding-left:20px;line-height:1.7">${activityMix}</ul>
      ${activity ? `<p style="color:rgb(100,106,115);font-size:13px">Estimated time saved: <b>~${activity.estimatedHoursSaved}h</b>. Automation coverage: <b>${report.automationCoverage === null ? "unavailable" : `${report.automationCoverage}%`}</b>.</p>` : ""}

      <h2 style="font-size:18px;margin:24px 0 8px">Risks and attention</h2>
      <p style="margin:0;line-height:1.6">${escapeHtml(risk)}</p>
    </div>
    <div style="padding:14px 28px;border-top:1px solid rgb(222,224,227);font-size:12px;color:rgb(100,106,115)">Measured from AdLauncher delivery and activity records. Unavailable never means zero.</div>
  </div>
</body></html>`

  const text = [
    `AdLauncher Weekly Report - ${formatDate(date)}`,
    report.e2e && report.e2e.e2eRate !== null
      ? `E2E launch rate: ${report.e2e.e2eRate}% (${report.e2e.appAds}/${report.e2e.totalAds} Meta ads tagged [app], measured).`
      : "E2E launch rate: unavailable this period.",
    `Executive readout: ${report.e2e && report.e2e.e2eRate !== null ? `${report.e2e.e2eRate}% of Meta ads this period came through AdLauncher. ` : ""}${report.delivery.adsCreated} ads, ${report.delivery.successRate}% full success, ${report.delivery.nonSuccess} batches need review.`,
    humanizerOpinion(report),
    activity ? `App activity: ${activity.total} actions, ${activity.activeMembers} active members, ${activity.activeDays} active days.` : "App activity: unavailable.",
    `Risk: ${risk}`,
    "Team usage:",
    ...team.map(row => `- ${row.name}: ${row.adsCreated} ads, ${row.actions} actions, ${row.activeDays}/${report.days} active days, ${row.breadth} features.`),
  ].join("\n")

  return { subject, html, text }
}

function zonedParts(now: Date, timezone: string): { localDate: string; weekday: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now)
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || ""
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"))
    return {
      localDate: `${get("year")}-${get("month")}-${get("day")}`,
      weekday,
      minutes: Number(get("hour")) * 60 + Number(get("minute")),
    }
  } catch {
    return null
  }
}

export function isWeeklyReportDue(schedule: WeeklyReportSchedule, now = new Date()): string | null {
  if (!schedule.enabled || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.sendTime)) return null
  const local = zonedParts(now, schedule.timezone)
  if (!local || local.weekday !== schedule.weekday || local.localDate === schedule.lastDueLocalDate) return null
  const [hour, minute] = schedule.sendTime.split(":").map(Number)
  return local.minutes >= hour * 60 + minute ? local.localDate : null
}
