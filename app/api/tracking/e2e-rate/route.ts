import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getFacebookConnection } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { GRAPH_API_BASE } from "@/lib/facebook"
import { secureMetaFetch } from "@/lib/meta-secure-fetch"
import { toVietnamDateKey, isoWeekMonday } from "@/lib/tracking/summary"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const context = await getAuthContext()
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(request.url)
    const fromParam = url.searchParams.get("from")
    const toParam = url.searchParams.get("to")

    const sinceDate = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : null
    const untilDate = toParam ? new Date(`${toParam}T23:59:59.999Z`) : null

    const db = createAdminClient()

    // Get all connected ad accounts for the organization
    const { data: accounts, error: dbError } = await db
      .from("ad_accounts")
      .select("fb_ad_account_id, name")
      .eq("org_id", context.orgId)

    if (dbError) {
      console.error("[e2e-rate] DB error fetching ad accounts:", dbError)
      return NextResponse.json({ error: "Database error fetching accounts" }, { status: 500 })
    }

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ e2eRate: null, totalAds: 0, appAds: 0 })
    }

    const connection = await getFacebookConnection(context.orgId)
    if (!connection || !connection.access_token) {
      return NextResponse.json({ e2eRate: null, totalAds: 0, appAds: 0, reason: "No active Meta connection" })
    }

    let totalAds = 0
    let appAds = 0

    const days = sinceDate && untilDate
      ? Math.round((untilDate.getTime() - sinceDate.getTime()) / 86_400_000) + 1
      : 7
    const weekly = days >= 90
    const buckets = new Map<string, { totalAds: number; appAds: number }>()
    const bucketKey = (value: Date | string) => (weekly ? isoWeekMonday(value) : toVietnamDateKey(value))

    if (sinceDate && untilDate) {
      const current = new Date(sinceDate)
      while (current <= untilDate) {
        const key = bucketKey(current)
        if (!buckets.has(key)) {
          buckets.set(key, { totalAds: 0, appAds: 0 })
        }
        current.setUTCDate(current.getUTCDate() + 1)
      }
    }

    // Fetch ads from all connected ad accounts in parallel (with safe limits)
    await Promise.all(
      accounts.map(async (acc) => {
        const accId = acc.fb_ad_account_id.startsWith("act_")
          ? acc.fb_ad_account_id
          : `act_${acc.fb_ad_account_id}`

        let nextUrl = `${GRAPH_API_BASE}/${accId}/ads?fields=id,name,created_time&limit=1000&access_token=${connection.access_token}`
        let accountTotal = 0
        let stopFetching = false

        while (nextUrl && !stopFetching) {
          try {
            const res = await secureMetaFetch(nextUrl)
            if (!res.ok) {
              const err = await res.json().catch(() => ({}))
              console.error(`[e2e-rate] Meta API error for ${accId}:`, err)
              break
            }

            const body = await res.json()
            const data = body.data || []

            for (const ad of data) {
              if (ad.created_time && sinceDate) {
                const created = new Date(ad.created_time)
                if (created < sinceDate) {
                  stopFetching = true
                  continue
                }
              }

              if (ad.created_time && untilDate) {
                const created = new Date(ad.created_time)
                if (created > untilDate) {
                  continue
                }
              }

              accountTotal += 1
              totalAds += 1

              const nameLower = (ad.name || "").toLowerCase()
              const isApp = nameLower.includes("[app]")
              if (isApp) {
                appAds += 1
              }

              if (ad.created_time) {
                const key = bucketKey(ad.created_time)
                let point = buckets.get(key)
                if (!point) {
                  point = { totalAds: 0, appAds: 0 }
                  buckets.set(key, point)
                }
                point.totalAds += 1
                if (isApp) {
                  point.appAds += 1
                }
              }
            }

            // Safe boundary: max 5000 ads per account to avoid timeouts
            if (accountTotal >= 5000) {
              break
            }

            nextUrl = body.paging?.next || ""
          } catch (fetchErr) {
            console.error(`[e2e-rate] Fetch failed for ${accId}:`, fetchErr)
            break
          }
        }
      })
    )

    const e2eRate = totalAds > 0 ? Math.round((appAds / totalAds) * 100) : 0

    const timeSeries = [...buckets.entries()]
      .map(([bucket, val]) => ({
        bucket,
        totalAds: val.totalAds,
        appAds: val.appAds,
        e2eRate: val.totalAds > 0 ? Math.round((val.appAds / val.totalAds) * 100) : 0,
      }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket))

    return NextResponse.json({
      e2eRate,
      totalAds,
      appAds,
      timeSeries,
    })
  } catch (err) {
    console.error("[e2e-rate] Top-level handler crash:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to calculate E2E Launch Rate" },
      { status: 500 }
    )
  }
}
