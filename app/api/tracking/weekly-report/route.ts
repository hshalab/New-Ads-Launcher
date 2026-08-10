import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { recordActivity } from "@/lib/notifications/emit"
import { sendEmail } from "@/lib/send-email"
import { createAdminClient } from "@/lib/supabase/admin"
import { isMissingTable } from "@/lib/tracking/missing-table"
import { createPreviewToken, verifyPreviewToken } from "@/lib/tracking/report-preview-token"
import {
  buildWeeklyReportEmail,
  DEFAULT_REPORT_TIMEZONE,
  WEEKLY_REPORT_CC,
  WEEKLY_REPORT_TO,
  type WeeklyReportSnapshot,
} from "@/lib/tracking/weekly-report"

export const dynamic = "force-dynamic"

const NOREPLY_EXTRA_TO = "thanhtin@patigroup.com"

function weeklyReportTo(): string[] {
  const sender = process.env.SMTP_FROM || process.env.SMTP_USER || ""
  const email = sender.match(/<([^>]+)>/)?.[1] || sender
  const to = [...WEEKLY_REPORT_TO] as string[]
  if (email.trim().toLowerCase().startsWith("noreply@") && !to.includes(NOREPLY_EXTRA_TO)) to.push(NOREPLY_EXTRA_TO)
  return to
}

function finite(value: unknown, min = 0, max = 1_000_000): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
}

function parseSnapshot(value: unknown): WeeklyReportSnapshot | null {
  if (!value || typeof value !== "object" || JSON.stringify(value).length > 100_000) return null
  const snapshot = value as WeeklyReportSnapshot
  const report = snapshot.report
  if (!report || !Number.isInteger(report.days) || !finite(report.days, 1, 366) || !Number.isFinite(new Date(report.generatedAt).getTime())) return null
  if (report.opinion !== undefined && report.opinion !== null && (typeof report.opinion !== "string" || report.opinion.length > 2000)) return null
  if (!report.delivery || !finite(report.delivery.batches) || !finite(report.delivery.adsCreated) || !finite(report.delivery.successRate, 0, 100)) return null
  if (!report.previous || !report.creative || !Array.isArray(report.failureReasons) || report.failureReasons.length > 20) return null
  if (report.e2e !== null && report.e2e !== undefined) {
    if (!finite(report.e2e.totalAds) || !finite(report.e2e.appAds, 0, report.e2e.totalAds) || (report.e2e.e2eRate !== null && !finite(report.e2e.e2eRate, 0, 100))) return null
    if (report.e2e.timeSeries !== undefined) {
      if (!Array.isArray(report.e2e.timeSeries) || report.e2e.timeSeries.length > 366) return null
      if (report.e2e.timeSeries.some(point => typeof point.bucket !== "string" || point.bucket.length > 16 || !finite(point.totalAds) || !finite(point.appAds, 0, point.totalAds) || !finite(point.e2eRate, 0, 100))) return null
    }
  }
  if (!Array.isArray(snapshot.team) || snapshot.team.length > 100) return null
  if (snapshot.team.some(row => typeof row.name !== "string" || row.name.length > 120 || !finite(row.adsCreated) || !finite(row.actions) || !finite(row.activeDays, 0, report.days) || !finite(row.breadth, 0, 100))) return null
  if (report.activityAvailable && (!report.activity || !finite(report.activity.total) || !finite(report.activity.activeMembers, 0, 1000) || !finite(report.activity.activeDays, 0, report.days))) return null
  return snapshot
}

function validTimezone(value: string): boolean {
  if (!value || value.length > 64) return false
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

async function reportContext(orgId: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single()
  if (error) throw new Error(error.message)
  return {
    orgName: data.name as string,
    cc: WEEKLY_REPORT_CC,
  }
}

export async function GET() {
  const context = await getAuthContext()
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (context.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 })

  const db = createAdminClient()
  let scheduleResult
  let recipients
  try {
    ;[scheduleResult, recipients] = await Promise.all([
      db.from("weekly_report_schedules").select("enabled,weekday,send_time,timezone,pending_review,last_due_local_date,last_sent_at").eq("org_id", context.orgId).maybeSingle(),
      reportContext(context.orgId),
    ])
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Weekly report settings are unavailable." }, { status: 500 })
  }
  const { data: schedule, error } = scheduleResult
  const unavailable = isMissingTable(error)
  if (error && !unavailable) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    to: weeklyReportTo(),
    cc: recipients.cc || null,
    scheduleAvailable: !unavailable,
    schedule: schedule || {
      enabled: false,
      weekday: 5,
      send_time: "16:00",
      timezone: DEFAULT_REPORT_TIMEZONE,
      pending_review: false,
      last_due_local_date: null,
      last_sent_at: null,
    },
  })
}

export async function POST(request: NextRequest) {
  const context = await getAuthContext()
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (context.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 })

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  const db = createAdminClient()

  if (body.action === "schedule") {
    const enabled = body.enabled
    const weekday = body.weekday
    const sendTime = body.sendTime
    const timezone = body.timezone
    if (typeof enabled !== "boolean" || !Number.isInteger(weekday) || !finite(weekday, 0, 6) || typeof sendTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(sendTime) || typeof timezone !== "string" || !validTimezone(timezone)) {
      return NextResponse.json({ error: "Invalid weekly schedule." }, { status: 400 })
    }
    const { data, error } = await db.from("weekly_report_schedules").upsert({
      org_id: context.orgId,
      created_by: context.user.id,
      enabled,
      weekday,
      send_time: sendTime,
      timezone,
      updated_at: new Date().toISOString(),
    }, { onConflict: "org_id" }).select("enabled,weekday,send_time,timezone,pending_review,last_due_local_date,last_sent_at").single()
    if (error) return NextResponse.json({ error: isMissingTable(error) ? "Apply 20260807_weekly_report_schedules.sql before enabling schedules." : error.message }, { status: 503 })
    return NextResponse.json({ ok: true, schedule: data })
  }

  const parsed = parseSnapshot(body.snapshot)
  if (!parsed) return NextResponse.json({ error: "Invalid report snapshot." }, { status: 400 })
  let recipients
  try {
    recipients = await reportContext(context.orgId)
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Weekly report recipients are unavailable." }, { status: 500 })
  }
  if (!recipients.cc) return NextResponse.json({ error: "PATI-BOM email is missing. Set the BOM email in Organization settings." }, { status: 409 })
  const snapshot = { ...parsed, report: { ...parsed.report, orgName: recipients.orgName } }
  const email = buildWeeklyReportEmail(snapshot)
  const to = weeklyReportTo()

  if (body.action === "preview") {
    let previewToken
    try {
      previewToken = createPreviewToken({ snapshot, orgId: context.orgId, userId: context.user.id, to, cc: recipients.cc })
    } catch (cause) {
      return NextResponse.json({ error: cause instanceof Error ? cause.message : "Report preview security is unavailable." }, { status: 500 })
    }
    return NextResponse.json({ ...email, to, cc: recipients.cc, previewToken })
  }

  if (body.action !== "send" || typeof body.previewToken !== "string") return NextResponse.json({ error: "Preview is required before sending." }, { status: 400 })
  if (!verifyPreviewToken({ token: body.previewToken, snapshot, orgId: context.orgId, userId: context.user.id, to, cc: recipients.cc })) {
    return NextResponse.json({ error: "Preview expired or report changed. Preview again before sending." }, { status: 409 })
  }

  const result = await sendEmail({ to, cc: recipients.cc, subject: email.subject, html: email.html, text: email.text })
  if (!result.ok) return NextResponse.json({ error: result.error || "Email delivery failed." }, { status: 502 })

  const sentAt = new Date().toISOString()
  const update = await db.from("weekly_report_schedules").update({ pending_review: false, last_sent_at: sentAt, updated_at: sentAt }).eq("org_id", context.orgId)
  if (update.error && !isMissingTable(update.error)) console.error("[weekly-report] schedule update failed", update.error)
  await recordActivity({
    orgId: context.orgId,
    actorId: context.user.id,
    actorName: context.user.full_name || context.user.email?.split("@")[0] || "Admin",
    objectType: "report",
    objectId: `weekly:${sentAt.slice(0, 10)}`,
    objectName: "AdLauncher Weekly Report",
    action: "completed",
    source: "weekly_report_email",
  })
  return NextResponse.json({ ok: true, sentAt })
}
