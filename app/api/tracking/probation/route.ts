import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { isFallbackKind } from "@/lib/tracking/fallback"
import { isMissingTable } from "@/lib/tracking/missing-table"
import { isProbationSubject } from "@/lib/tracking/probation"
import { isoWeekMonday } from "@/lib/tracking/summary"

export const dynamic = "force-dynamic"

const MONTH_START = "2026-08-01"
const MONTH_END = "2026-09-01"

async function subjectContext() {
  const context = await getAuthContext()
  if (!context) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (!isProbationSubject(context.user)) {
    return { error: NextResponse.json({ error: "This report belongs to one person." }, { status: 403 }) }
  }
  return { context }
}

export async function GET() {
  const auth = await subjectContext()
  if (auth.error) return auth.error
  const { context } = auth
  const db = createAdminClient()

  const [launchResult, fallbackResult, controlResult] = await Promise.all([
    db
      .from("launch_batches")
      .select("user_name,status,total_ads,failed_ads,created_at")
      .eq("org_id", context.orgId)
      .gte("created_at", `${MONTH_START}T00:00:00.000Z`)
      .lt("created_at", `${MONTH_END}T00:00:00.000Z`),
    db
      .from("kr_fallbacks")
      .select("id,kind,occurred_at")
      .eq("org_id", context.orgId)
      .eq("user_id", context.user.id)
      .gte("occurred_at", `${MONTH_START}T00:00:00.000Z`)
      .lt("occurred_at", `${MONTH_END}T00:00:00.000Z`)
      .order("occurred_at", { ascending: false }),
    db
      .from("activity_log")
      .select("actor_id,actor_name,object_type,action,source,created_at")
      .eq("org_id", context.orgId)
      .in("object_type", ["campaign", "adset", "ad"])
      .eq("action", "updated")
      .gte("created_at", `${MONTH_START}T00:00:00.000Z`)
      .lt("created_at", `${MONTH_END}T00:00:00.000Z`),
  ])

  if (launchResult.error) {
    console.error("[tracking/probation]", launchResult.error)
    return NextResponse.json({ error: "Launch evidence unavailable." }, { status: 500 })
  }

  const fallbackAvailable = !isMissingTable(fallbackResult.error)
  const controlAvailable = !isMissingTable(controlResult.error)
  if (fallbackResult.error && fallbackAvailable) {
    console.error("[tracking/probation:fallback]", fallbackResult.error)
    return NextResponse.json({ error: "Fallback evidence unavailable." }, { status: 500 })
  }
  if (controlResult.error && controlAvailable) {
    console.error("[tracking/probation:control]", controlResult.error)
    return NextResponse.json({ error: "Control evidence unavailable." }, { status: 500 })
  }

  const weeks = new Map<string, { launchers: Map<string, number>; controlActors: Map<string, number>; fallbacks: Array<{ id: string; kind: "launch" | "control"; occurredAt: string }> }>()
  const ensureWeek = (week: string) => {
    const existing = weeks.get(week)
    if (existing) return existing
    const created = { launchers: new Map<string, number>(), controlActors: new Map<string, number>(), fallbacks: [] as Array<{ id: string; kind: "launch" | "control"; occurredAt: string }> }
    weeks.set(week, created)
    return created
  }

  for (const batch of launchResult.data || []) {
    if (batch.status !== "success") continue
    const ads = Math.max(0, (batch.total_ads as number) || 0)
    if (ads === 0) continue
    const bucket = ensureWeek(isoWeekMonday(batch.created_at as string))
    const name = (batch.user_name as string | null) || "Unknown"
    bucket.launchers.set(name, (bucket.launchers.get(name) || 0) + 1)
  }

  for (const event of controlResult.data || []) {
    if (!event.actor_id || ["cron", "automation", "system"].includes(String(event.source || "app").toLowerCase())) continue
    const bucket = ensureWeek(isoWeekMonday(event.created_at as string))
    const name = (event.actor_name as string | null) || "Unknown"
    bucket.controlActors.set(name, (bucket.controlActors.get(name) || 0) + 1)
  }

  for (const event of fallbackResult.data || []) {
    if (!isFallbackKind(event.kind)) continue
    ensureWeek(isoWeekMonday(event.occurred_at as string)).fallbacks.push({
      id: String(event.id),
      kind: event.kind,
      occurredAt: event.occurred_at as string,
    })
  }

  // Keep empty weeks visible. Otherwise month-to-date silently averages only weeks
  // with activity and turns missing evidence into a better score.
  const firstWeek = isoWeekMonday(`${MONTH_START}T00:00:00.000Z`)
  for (let cursor = new Date(`${firstWeek}T00:00:00.000Z`); cursor < new Date(`${MONTH_END}T00:00:00.000Z`); cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    ensureWeek(cursor.toISOString().slice(0, 10))
  }

  const currentWeek = isoWeekMonday(new Date())
  const anchor = currentWeek >= MONTH_START && currentWeek < MONTH_END ? currentWeek : MONTH_START
  ensureWeek(anchor)

  return NextResponse.json({
    monthStart: MONTH_START,
    monthEnd: MONTH_END,
    currentWeek,
    fallbackAvailable,
    fallbackUnavailableReason: fallbackAvailable ? null : "Apply 20260807_kr_fallbacks.sql to enable one-tap fallback tracking.",
    controlAvailable,
    controlUnavailableReason: controlAvailable ? null : "Apply 20260803_activity_log.sql to measure successful Ads Manager control.",
    weeks: [...weeks.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([week, value], index) => ({
      week,
      index: index + 1,
      isCurrent: week === currentWeek,
      launchers: [...value.launchers.entries()].map(([name, batches]) => ({ name, batches })),
      controlActors: [...value.controlActors.entries()].map(([name, actions]) => ({ name, actions })),
      fallbacks: value.fallbacks,
    })),
  })
}

export async function POST(request: NextRequest) {
  const auth = await subjectContext()
  if (auth.error) return auth.error
  const { context } = auth
  const body = await request.json().catch(() => null)
  if (!isFallbackKind(body?.kind)) return NextResponse.json({ error: "kind must be launch or control." }, { status: 400 })

  const { data, error } = await createAdminClient()
    .from("kr_fallbacks")
    .insert({ org_id: context.orgId, user_id: context.user.id, kind: body.kind })
    .select("id,kind,occurred_at")
    .single()

  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: "Fallback tracking migration is not applied." }, { status: 503 })
    console.error("[tracking/probation:fallback:create]", error)
    return NextResponse.json({ error: "Could not record fallback." }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await subjectContext()
  if (auth.error) return auth.error
  const { context } = auth
  const id = new URL(request.url).searchParams.get("id")
  if (!id || !/^\d+$/.test(id)) return NextResponse.json({ error: "A valid fallback id is required." }, { status: 400 })

  const { error } = await createAdminClient()
    .from("kr_fallbacks")
    .delete()
    .eq("id", id)
    .eq("org_id", context.orgId)
    .eq("user_id", context.user.id)

  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: "Fallback tracking migration is not applied." }, { status: 503 })
    console.error("[tracking/probation:fallback:delete]", error)
    return NextResponse.json({ error: "Could not undo fallback." }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
