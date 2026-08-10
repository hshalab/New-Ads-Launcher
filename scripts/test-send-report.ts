import { createAdminClient } from "../lib/supabase/admin"
import { getFacebookConnection } from "../lib/auth"
import { GRAPH_API_BASE } from "../lib/facebook"
import { secureMetaFetch } from "../lib/meta-secure-fetch"
import { toVietnamDateKey, isoWeekMonday } from "../lib/tracking/summary"
import {
  summarizeCreativeCoverage,
  summarizeFailureReasons,
  summarizeLaunchBatches,
  summarizeLaunchBatchesTimeSeries,
  workingDayStreak,
  type TrackingBatch,
  type TrackingCreative,
} from "../lib/tracking/summary"
import {
  automationCoverage,
  delta,
  estimatedHoursSaved,
  leverageRatio,
  summarizeActivity,
  type ActivityRow,
  type PageActivityRow,
} from "../lib/tracking/activity"
import { buildWeeklyReportEmail, type WeeklyReportSnapshot } from "../lib/tracking/weekly-report"
import { sendEmail } from "../lib/send-email"
import { resolveTrackingWindow } from "../lib/tracking/window"
import * as dotenv from "dotenv"
import * as path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, "../.env.local") })

const RECIPIENT = "raymond.nguyen1707@gmail.com"
const DAYS = 7
const ACTIVITY_ROW_LIMIT = 10_000

async function run() {
  console.log("Fetching configuration and database...")
  const db = createAdminClient()

  // Grab the first org
  const { data: orgs, error: orgError } = await db.from("organizations").select("id, name").limit(1)
  if (orgError || !orgs || orgs.length === 0) {
    throw new Error("No organization found: " + (orgError?.message || "empty"))
  }
  const org = orgs[0]
  console.log(`Using organization: ${org.name} (${org.id})`)

  // Grab an admin user for context
  const { data: members, error: memberError } = await db
    .from("org_members")
    .select("user_id")
    .eq("org_id", org.id)
    .eq("role", "admin")
    .limit(1)
  if (memberError || !members || members.length === 0) {
    throw new Error("No admin user found")
  }
  const { data: profile } = await db.from("profiles").select("full_name").eq("id", members[0].user_id).maybeSingle()
  const user = { id: members[0].user_id, full_name: profile?.full_name || "Admin" }
  console.log(`Using admin actor: ${user.full_name}`)

  const params = new URLSearchParams()
  params.set("days", String(DAYS))
  const { since, until, previousSince, previousUntil, days } = resolveTrackingWindow(params)

  console.log(`Date window: ${since} to ${until}`)

  const activitySelect = "actor_id,actor_name,object_type,action,created_at,source"

  console.log("Running DB queries...")
  const [
    recentBatchesResult,
    previousBatchesResult,
    successfulBatchesResult,
    creativesResult,
    activityResult,
    previousActivityResult,
    pageActivityResult,
    automationRunsResult,
    previousAutomationRunsResult,
    firstActivityResult,
  ] = await Promise.all([
    db
      .from("launch_batches")
      .select("id,user_id,user_name,status,total_ads,failed_ads,duration_ms,created_at,ad_account_name,errors")
      .eq("org_id", org.id)
      .gte("created_at", since)
      .lte("created_at", until)
      .order("created_at", { ascending: false }),
    db
      .from("launch_batches")
      .select("id,user_id,user_name,status,total_ads,failed_ads,duration_ms,created_at")
      .eq("org_id", org.id)
      .gte("created_at", previousSince)
      .lte("created_at", previousUntil),
    db
      .from("launch_batches")
      .select("creative_ids")
      .eq("org_id", org.id)
      .eq("status", "success"),
    db
      .from("creatives")
      .select("id,fb_image_hash,fb_video_id")
      .eq("org_id", org.id),
    db
      .from("activity_log")
      .select(activitySelect)
      .eq("org_id", org.id)
      .gte("created_at", since)
      .lte("created_at", until)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_ROW_LIMIT),
    db
      .from("activity_log")
      .select(activitySelect)
      .eq("org_id", org.id)
      .gte("created_at", previousSince)
      .lte("created_at", previousUntil)
      .limit(ACTIVITY_ROW_LIMIT),
    db
      .from("page_manage_activity")
      .select("actor_id,module,created_at")
      .eq("org_id", org.id)
      .gte("created_at", since)
      .lte("created_at", until)
      .limit(ACTIVITY_ROW_LIMIT),
    db
      .from("automation_executions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .gte("executed_at", since)
      .lte("executed_at", until),
    db
      .from("automation_executions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .gte("executed_at", previousSince)
      .lte("executed_at", previousUntil),
    db
      .from("activity_log")
      .select("created_at")
      .eq("org_id", org.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  if (recentBatchesResult.error) throw recentBatchesResult.error
  if (creativesResult.error) throw creativesResult.error

  const batches = (recentBatchesResult.data || []) as TrackingBatch[]
  const previousBatches = (previousBatchesResult.data || []) as TrackingBatch[]
  const launchedCreativeIds = new Set((successfulBatchesResult.data || []).flatMap(batch => batch.creative_ids || []))

  const activityRows = (activityResult.data || []) as ActivityRow[]
  const previousActivityRows = (previousActivityResult.data || []) as ActivityRow[]
  const pageRows = (pageActivityResult.data || []) as PageActivityRow[]
  const automationRuns = automationRunsResult.count || 0
  const previousAutomationRuns = previousAutomationRunsResult.count || 0

  const teamActivity = summarizeActivity({ rows: activityRows, pageRows, batches })
  const previousTeamActivity = summarizeActivity({ rows: previousActivityRows, batches: previousBatches })

  const summary = summarizeLaunchBatches(batches)
  const previousSummary = summarizeLaunchBatches(previousBatches)

  const activityBlock = (scope: typeof teamActivity, batchCount: number) => ({
    ...scope,
    leverageRatio: leverageRatio(scope.byClass.reuse, batchCount),
    estimatedHoursSaved: estimatedHoursSaved(scope.estimatedMinutesSaved, 0),
  })

  // 2. Fetch E2E from Meta if possible
  console.log("Fetching E2E launch rate from Meta...")
  let e2eData: any = null
  try {
    const { data: accounts, error: dbError } = await db
      .from("ad_accounts")
      .select("fb_ad_account_id, name")
      .eq("org_id", org.id)

    if (dbError) throw dbError

    const connection = await getFacebookConnection(org.id)
    if (accounts && accounts.length > 0 && connection && connection.access_token) {
      let totalAds = 0
      let appAds = 0
      const buckets = new Map<string, { totalAds: number; appAds: number }>()
      const bucketKey = (value: Date | string) => toVietnamDateKey(value)
      const sinceDate = new Date(`${since}T00:00:00.000Z`)
      const untilDate = new Date(`${until}T23:59:59.999Z`)

      const current = new Date(sinceDate)
      while (current <= untilDate) {
        buckets.set(bucketKey(current), { totalAds: 0, appAds: 0 })
        current.setUTCDate(current.getUTCDate() + 1)
      }

      await Promise.all(
        accounts.map(async (acc) => {
          const accId = acc.fb_ad_account_id.startsWith("act_")
            ? acc.fb_ad_account_id
            : `act_${acc.fb_ad_account_id}`

          let nextUrl = `${GRAPH_API_BASE}/${accId}/ads?fields=id,name,created_time&limit=1000&access_token=${connection.access_token}`
          let accountTotal = 0
          let stopFetching = false

          while (nextUrl && !stopFetching) {
            const res = await secureMetaFetch(nextUrl)
            if (!res.ok) break
            const body = await res.json()
            const data = body.data || []

            for (const ad of data) {
              if (ad.created_time) {
                const created = new Date(ad.created_time)
                if (created < sinceDate) {
                  stopFetching = true
                  continue
                }
                if (created > untilDate) continue
              }

              accountTotal += 1
              totalAds += 1

              const nameLower = (ad.name || "").toLowerCase()
              const isApp = nameLower.includes("[app]")
              if (isApp) appAds += 1

              if (ad.created_time) {
                const key = bucketKey(ad.created_time)
                let point = buckets.get(key)
                if (!point) {
                  point = { totalAds: 0, appAds: 0 }
                  buckets.set(key, point)
                }
                point.totalAds += 1
                if (isApp) point.appAds += 1
              }
            }

            if (accountTotal >= 5000) break
            nextUrl = body.paging?.next || ""
          }
        })
      )

      e2eData = {
        e2eRate: totalAds > 0 ? Math.round((appAds / totalAds) * 100) : 0,
        totalAds,
        appAds,
        timeSeries: [...buckets.entries()]
          .map(([bucket, val]) => ({
            bucket,
            totalAds: val.totalAds,
            appAds: val.appAds,
            e2eRate: val.totalAds > 0 ? Math.round((val.appAds / val.totalAds) * 100) : 0,
          }))
          .sort((a, b) => a.bucket.localeCompare(b.bucket)),
      }
    }
  } catch (err) {
    console.error("Meta fetch skipped or failed:", err)
  }

  // 3. Assemble snapshot
  const teamList = summarizeLaunchBatches(batches)
  const usageRows = teamList.team.map(member => ({
    name: member.name,
    adsCreated: member.adsCreated,
    batches: member.batches,
    actions: 0,
    activeDays: 0,
    breadth: 0,
  }))

  const snapshot: WeeklyReportSnapshot = {
    report: {
      days,
      generatedAt: new Date().toISOString(),
      orgName: org.name,
      delivery: summary,
      previous: {
        deltaBatches: delta(summary.batches, previousSummary.batches),
        deltaAdsCreated: delta(summary.adsCreated, previousSummary.adsCreated),
        deltaSuccessRate: summary.successRate - previousSummary.successRate,
        deltaActivity: delta(teamActivity.total, previousTeamActivity.total),
        deltaActiveMembers: delta(teamActivity.activeMembers, previousTeamActivity.activeMembers),
        deltaAutomationRuns: delta(automationRuns, previousAutomationRuns),
      },
      creative: summarizeCreativeCoverage((creativesResult.data || []) as TrackingCreative[], launchedCreativeIds),
      e2e: e2eData,
      failureReasons: summarizeFailureReasons(batches),
      activity: {
        ...teamActivity,
        leverageRatio: leverageRatio(teamActivity.byClass.reuse, summary.batches),
        estimatedHoursSaved: estimatedHoursSaved(teamActivity.estimatedMinutesSaved, automationRuns),
      },
      activityAvailable: !activityResult.error,
      instrumentedSince: firstActivityResult.data?.created_at || null,
      automationRuns,
      automationCoverage: automationCoverage(automationRuns, teamActivity.byClass.govern),
    },
    team: usageRows,
  }

  console.log("Generating email report components...")
  const email = buildWeeklyReportEmail(snapshot)

  console.log(`Sending to override recipient: ${RECIPIENT}...`)
  const result = await sendEmail({
    to: RECIPIENT,
    subject: `[TEST] ${email.subject}`,
    html: email.html,
    text: email.text,
  })

  if (result.ok) {
    console.log("Email report sent successfully!")
  } else {
    throw new Error(result.error || "Failed to send email.")
  }
}

run().catch(console.error)
