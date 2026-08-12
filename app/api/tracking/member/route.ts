import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { summarizeLaunchBatches, workingDayStreak, isoWeekMonday, type TrackingBatch } from "@/lib/tracking/summary"
import { estimatedHoursSaved, leverageRatio, summarizeActivity, type ActivityRow, type PageActivityRow } from "@/lib/tracking/activity"
import { activityFor, EXCLUDED_MATCHES } from "@/lib/tracking/activity-catalog"
import { isMissingTable } from "@/lib/tracking/missing-table"
import { resolveTrackingWindow } from "@/lib/tracking/window"

export const dynamic = "force-dynamic"

const ACTIVITY_ROW_LIMIT = 5_000
const TIMELINE_LIMIT = 40

export async function GET(request: NextRequest) {
  const context = await getAuthContext()
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (context.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 })

  const url = new URL(request.url)
  const userId = url.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId is required." }, { status: 400 })

  const { since, until, days } = resolveTrackingWindow(url.searchParams)

  const db = createAdminClient()
  const [batchesResult, painpointResult, activityResult, pageActivityResult] = await Promise.all([
    db
      .from("launch_batches")
      .select("id,user_id,user_name,status,total_ads,failed_ads,duration_ms,created_at,ad_account_name,errors")
      .eq("org_id", context.orgId)
      .eq("user_id", userId)
      .gte("created_at", since)
      .lte("created_at", until)
      .order("created_at", { ascending: false }),
    db
      .from("weekly_painpoints")
      .select("note,week_start")
      .eq("org_id", context.orgId)
      .eq("user_id", userId)
      .eq("week_start", isoWeekMonday(new Date()))
      .maybeSingle(),
    // Scoped to this actor in the query, not filtered in Node: an admin drill-down
    // should not pull the whole org's log to show one person's work.
    db
      .from("activity_log")
      .select("actor_id,actor_name,object_type,action,object_name,created_at,source")
      .eq("org_id", context.orgId)
      .eq("actor_id", userId)
      .gte("created_at", since)
      .lte("created_at", until)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_ROW_LIMIT),
    db
      .from("page_manage_activity")
      .select("actor_id,module,created_at")
      .eq("org_id", context.orgId)
      .eq("actor_id", userId)
      .gte("created_at", since)
      .lte("created_at", until)
      .limit(ACTIVITY_ROW_LIMIT),
  ])

  if (batchesResult.error) {
    console.error("[tracking/member]", batchesResult.error)
    return NextResponse.json({ error: "Member data unavailable." }, { status: 500 })
  }

  const activityUnavailable = isMissingTable(activityResult.error)
  if (activityResult.error && !activityUnavailable) console.error("[tracking/member:activity]", activityResult.error)

  const batches = (batchesResult.data || []) as TrackingBatch[]
  const summary = summarizeLaunchBatches(batches)

  type LoggedRow = ActivityRow & { object_name?: string | null }
  const activityRows = (activityResult.data || []) as LoggedRow[]
  const pageRows = (pageActivityResult.data || []) as PageActivityRow[]

  const activity = summarizeActivity({ rows: activityRows, pageRows, batches, onlyUserId: userId })

  /**
   * What the person actually did, in order — the answer to "click a member and see
   * their activity detail". Launches come from launch_batches so the timeline is
   * complete even before activity_log is applied; catalog-unknown rows are dropped
   * rather than shown as a raw object_type nobody can interpret.
   */
  const timeline = [
    ...batches.flatMap(batch => batch.created_at ? [{
      at: batch.created_at,
      label: "Launch submitted",
      class: "produce" as const,
      detail: `${batch.ad_account_name || "Unknown ad account"} · ${Math.max(0, batch.total_ads || 0)} ads · ${batch.status}`,
    }] : []),
    ...activityRows.flatMap(row => {
      const pair = `${row.object_type}:${row.action}`
      if (EXCLUDED_MATCHES.has(pair)) return []
      const definition = activityFor(row.object_type, row.action)
      if (!definition) return []
      return [{ at: row.created_at, label: definition.label, class: definition.class, detail: row.object_name || "" }]
    }),
    ...pageRows.flatMap(row => {
      const definition = activityFor("page_manage", row.module)
      return definition ? [{ at: row.created_at, label: definition.label, class: definition.class, detail: "" }] : []
    }),
  ]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, TIMELINE_LIMIT)

  const [{ data: profile }, { data: account }] = await Promise.all([
    db.from("profiles").select("avatar_url").eq("id", userId).maybeSingle(),
    db.from("accounts").select("avatar_url").eq("id", userId).maybeSingle(),
  ])
  const avatarUrl = profile?.avatar_url || account?.avatar_url || null

  return NextResponse.json({
    userId,
    avatarUrl,
    days,
    summary,
    streak: workingDayStreak(batches.flatMap(batch => batch.created_at ? [batch.created_at] : [])),
    recentBatches: batches.slice(0, 10),
    painpoint: painpointResult.data?.note || "",
    activity: {
      available: !activityUnavailable,
      unavailableReason: activityUnavailable
        ? "activity_log is not applied on this project yet — only launches are recorded for this member."
        : null,
      ...activity,
      leverageRatio: leverageRatio(activity.byClass.reuse, summary.batches),
      estimatedHoursSaved: estimatedHoursSaved(activity.estimatedMinutesSaved, 0),
    },
    timeline,
  })
}
