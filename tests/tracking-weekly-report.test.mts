import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { buildWeeklyReportEmail, isWeeklyReportDue, WEEKLY_REPORT_CC } from "../lib/tracking/weekly-report.ts"

const report = {
  days: 7,
  generatedAt: "2026-08-07T09:00:00.000Z",
  orgName: "PATI <script>alert(1)</script>",
  delivery: { batches: 10, fullSuccess: 8, nonSuccess: 2, adsCreated: 42, successRate: 80, averageSessionDurationMs: 90_000 },
  previous: { deltaBatches: 25, deltaAdsCreated: 20, deltaSuccessRate: 5, deltaActivity: 10, deltaActiveMembers: 0, deltaAutomationRuns: null },
  creative: { ready: 20, launched: 15, unlaunched: 5, launchRate: 75 },
  failureReasons: [{ label: "Meta rejected <img src=x onerror=alert(1)>", count: 2 }],
  activity: {
    total: 31,
    byClass: { produce: 8, launch: 10, control: 7, reuse: 4, govern: 2, collaborate: 0 },
    byType: [],
    activeMembers: 3,
    activeDays: 5,
    unused: [],
    notInstrumented: [],
    leverageRatio: 0.4,
    estimatedHoursSaved: 6,
  },
  activityAvailable: true,
  instrumentedSince: "2026-08-01T00:00:00.000Z",
  automationRuns: 0,
  automationCoverage: 0,
}

test("builds the approved weekly subject and an escaped management report", () => {
  assert.equal(WEEKLY_REPORT_CC, "wpjpwk7o7pbxz@patigroup.com")
  const email = buildWeeklyReportEmail({
    report,
    team: [
      { name: "Kevin", adsCreated: 22, batches: 5, actions: 16, activeDays: 5, breadth: 4 },
      { name: "Seth", adsCreated: 20, batches: 5, actions: 15, activeDays: 4, breadth: 3 },
    ],
  })

  assert.equal(email.subject, "[INFORM - Tech/Raymond] AdLauncher Weekly Report (07/08/2026)")
  assert.match(email.html, /Management readout/)
  assert.match(email.html, /Team usage/)
  assert.match(email.html, /App activity/)
  assert.doesNotMatch(email.html, /KR tracking|75\/100|recorded fallbacks/)
  assert.match(email.html, /Kevin/)
  assert.doesNotMatch(email.html, /<script>|<img src=x/)
  assert.match(email.html, /&lt;script&gt;/)
})

test("weekly schedule becomes due once per local weekday", () => {
  const schedule = { enabled: true, weekday: 5, sendTime: "16:00", timezone: "Asia/Ho_Chi_Minh", lastDueLocalDate: null }

  assert.equal(isWeeklyReportDue(schedule, new Date("2026-08-07T09:05:00.000Z")), "2026-08-07")
  assert.equal(isWeeklyReportDue({ ...schedule, lastDueLocalDate: "2026-08-07" }, new Date("2026-08-07T09:05:00.000Z")), null)
  assert.equal(isWeeklyReportDue(schedule, new Date("2026-08-06T09:05:00.000Z")), null)
})

test("report delivery keeps preview and admin gates visible in code", async () => {
  const [page, route, cron, migration] = await Promise.all([
    readFile(new URL("../app/(dashboard)/tracking/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tracking/weekly-report/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cron/weekly-report-reviews/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260807_weekly_report_schedules.sql", import.meta.url), "utf8"),
  ])

  assert.match(page, /Preview email/)
  assert.match(page, /Send email/)
  assert.match(route, /context\.role !== "admin"/)
  assert.match(route, /verifyPreviewToken/)
  assert.match(route, /sendEmail/)
  assert.match(cron, /pending_review/)
  assert.match(migration, /is_org_admin\(org_id\)/)
  assert.doesNotMatch(page, /<pre className=/)
})

test("buildWeeklyReportEmail respects custom humanizer opinion override", () => {
  const customOpinion = "This is a custom humanizer opinion from Seth."
  const email = buildWeeklyReportEmail({
    report: { ...report, opinion: customOpinion },
    team: [],
  })
  assert.match(email.html, /This is a custom humanizer opinion from Seth\./)
  assert.doesNotMatch(email.html, /Humanizer opinion — Adoption rate is unavailable/)
})
