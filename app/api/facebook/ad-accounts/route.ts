import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getFacebookConnection } from "@/lib/auth"
import { getAdAccounts } from "@/lib/facebook"
import { createAdminClient } from "@/lib/supabase/admin"
import { getDbCachedFacebookMetadata } from "../_db-cache"
import { annotateAdAccounts, persistAdAccountMetrics } from "@/lib/sync-ad-accounts"

const AD_ACCOUNTS_TTL_MS = 15 * 60 * 1000

async function getSavedAdAccounts(orgId: string) {
  const supabase = createAdminClient()
  const data: any[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from("ad_accounts")
      .select("fb_ad_account_id, fb_account_id, name, currency, account_status, amount_spent_minor, balance_minor, spend_cap_minor, timezone_name, owner_business_id, owner_business_name, ownership")
      .eq("org_id", orgId)
      .order("name")
      .range(from, from + pageSize - 1)

    if (error) return []
    data.push(...(page || []))
    if (!page || page.length < pageSize) break
  }
  if (!data.length) return []

  return data.map((row: any) => ({
    id: row.fb_ad_account_id,
    account_id: row.fb_account_id || row.fb_ad_account_id?.replace(/^act_/, ""),
    name: row.name || row.fb_ad_account_id,
    currency: row.currency || "USD",
    account_status: row.account_status ?? 0,
    amount_spent: row.amount_spent_minor != null ? String(row.amount_spent_minor) : undefined,
    balance: row.balance_minor != null ? String(row.balance_minor) : undefined,
    spend_cap: row.spend_cap_minor != null ? String(row.spend_cap_minor) : undefined,
    timezone_name: row.timezone_name || undefined,
    owner_business: row.owner_business_id ? { id: row.owner_business_id, name: row.owner_business_name || undefined } : undefined,
    ownership: row.ownership || "unknown",
    fromSnapshot: true,
  }))
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const connection = await getFacebookConnection(ctx.orgId)
    if (!connection) {
      const saved = await getSavedAdAccounts(ctx.orgId)
      return NextResponse.json({
        adAccounts: saved,
        connected: false,
        needsReconnect: true,
        fromSnapshot: saved.length > 0,
        readOnly: saved.length > 0,
      })
    }

    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true"
    const result = await getDbCachedFacebookMetadata({
      orgId: ctx.orgId,
      cacheKey: "facebook:ad-accounts",
      ttlMs: AD_ACCOUNTS_TTL_MS,
      forceRefresh,
      loader: () => getAdAccounts(connection.access_token),
    })

    const supabase = createAdminClient()
    const adAccounts = await annotateAdAccounts(supabase, ctx.orgId, result.value)
    const syncedAt = new Date().toISOString()

    if (forceRefresh) {
      await persistAdAccountMetrics(supabase, ctx.orgId, ctx.user.id, adAccounts, syncedAt)
    }

    return NextResponse.json({
      adAccounts,
      connected: true,
      cached: result.source !== "meta",
      stale: result.stale,
      retryAfterMs: result.retryAfterMs,
      saved: forceRefresh,
      syncedAt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch ad accounts"
    const lower = msg.toLowerCase()
    const isRateLimit   = lower.includes("too many calls") || lower.includes("rate limit") || lower.includes("#4 ")
    const isTokenExpiry = lower.includes("expired") || lower.includes("invalid") || lower.includes("oauth") || lower.includes("session")
    console.error("[ad-accounts]", msg)
    const ctx = await getAuthContext()
    if (ctx) {
      const saved = await getSavedAdAccounts(ctx.orgId)
      if (saved.length > 0) {
        return NextResponse.json({
          error: msg,
          rateLimited: isRateLimit,
          needsReconnect: isTokenExpiry,
          adAccounts: saved,
          fromSnapshot: true,
          readOnly: true,
          metaUnavailable: true,
        })
      }
    }
    return NextResponse.json(
      {
        error: msg,
        rateLimited: isRateLimit,
        needsReconnect: isTokenExpiry,
        adAccounts: [],
      },
      { status: isRateLimit ? 429 : isTokenExpiry ? 401 : 500 }
    )
  }
}
