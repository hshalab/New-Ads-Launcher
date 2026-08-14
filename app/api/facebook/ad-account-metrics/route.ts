import { NextRequest, NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { localDateRangeToUtc, parseTimezoneOffset } from "@/lib/local-date-range"

function normalizeAdAccountId(id?: string | null) {
  return (id || "").replace(/^act_/, "")
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const params = request.nextUrl.searchParams
    const accountId = normalizeAdAccountId(params.get("account_id"))
    const dateFrom = params.get("date_from")
    const dateTo = params.get("date_to")
    const timezoneOffset = parseTimezoneOffset(params.get("timezone_offset"))
    const limitParam = Number(params.get("limit") || 100)
    const isAllAccounts = !accountId && (dateFrom || dateTo)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100
    const { startIso, endExclusiveIso } = localDateRangeToUtc(dateFrom, dateTo, timezoneOffset)
    if ((dateFrom && !startIso) || (dateTo && !endExclusiveIso)) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const select = `
        id,
        fb_ad_account_id,
        fb_account_id,
        name,
        account_status,
        currency,
        timezone_name,
        spend_cap_minor,
        remaining_minor,
        amount_spent_minor,
        ownership,
        owner_business_name,
        synced_at
      `

    const fetchPage = async (from?: number, to?: number) => {
      let query = supabase
        .from("ad_account_metrics_snapshots")
        .select(select)
        .eq("org_id", ctx.orgId)
        .order("synced_at", { ascending: false })

      if (accountId) {
        query = query.or(
          `fb_account_id.eq.${accountId},fb_account_id.eq.act_${accountId},fb_ad_account_id.eq.${accountId},fb_ad_account_id.eq.act_${accountId}`
        )
      }
      if (startIso) query = query.gte("synced_at", startIso)
      if (endExclusiveIso) query = query.lt("synced_at", endExclusiveIso)
      query = from !== undefined && to !== undefined ? query.range(from, to) : query.limit(limit)
      return query
    }

    let snapshots: any[] = []
    if (dateFrom || dateTo) {
      const pageSize = 1000
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await fetchPage(from, from + pageSize - 1)
        if (error) {
          console.error("Failed to fetch ad account metric snapshots:", error)
          return NextResponse.json({ snapshots: [], warning: error.message })
        }
        snapshots.push(...(data || []))
        if (!data || data.length < pageSize) break
      }
    } else {
      const { data, error } = await fetchPage()
      if (error) {
        console.error("Failed to fetch ad account metric snapshots:", error)
        return NextResponse.json({ snapshots: [], warning: error.message })
      }
      snapshots = data || []
    }

    // When querying all accounts with a date range, keep only the latest snapshot per account
    if (isAllAccounts) {
      const seen = new Set<string>()
      snapshots = snapshots.filter(s => {
        const key = normalizeAdAccountId(s.fb_ad_account_id)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }

    return NextResponse.json({ snapshots })
  } catch (err) {
    console.error("Failed to fetch ad account metrics:", err)
    return NextResponse.json({ snapshots: [], warning: "Failed to fetch ad account metrics" })
  }
}
