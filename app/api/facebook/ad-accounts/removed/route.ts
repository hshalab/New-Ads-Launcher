import { NextResponse } from "next/server"
import { getAuthContext } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * GET /api/facebook/ad-accounts/removed
 *
 * Ad accounts this org used to have, and no longer does — read-only, from local history.
 *
 * Where the data comes from: `ad_accounts` is wiped and rebuilt whenever the Facebook connection
 * is replaced (`/api/facebook/connection`), so it only ever describes accounts Meta currently
 * hands back. `ad_account_metrics_snapshots` is append-only and keeps every account this org has
 * ever synced. The difference between the two sets is what this route returns: accounts removed
 * from the Business Portfolio, revoked, or otherwise no longer visible to the token — together
 * with the last figures we ever saw for them.
 *
 * There is no `deleted_at` column and there will not be one: migrations are locked on the shared
 * project. That is also why nothing here is authoritative about *why* an account disappeared —
 * only that we stopped seeing it, and when.
 *
 * Everything returned is historical. It must never be offered as a selectable ad account, and the
 * UI that renders it is read-only.
 */

/** Guard against an unbounded scan if snapshot history grows faster than expected. */
const MAX_SNAPSHOT_ROWS = 20000

type SnapshotRow = {
  fb_ad_account_id: string
  fb_account_id: string | null
  name: string | null
  account_status: number | null
  currency: string | null
  timezone_name: string | null
  amount_spent_minor: number | null
  balance_minor: number | null
  spend_cap_minor: number | null
  owner_business_id: string | null
  owner_business_name: string | null
  ownership: string | null
  synced_at: string | null
}

export type RemovedAdAccount = {
  id: string
  account_id: string
  name: string
  currency: string
  account_status: number | null
  amount_spent: string | null
  spend_cap: string | null
  balance: string | null
  timezone_name: string | null
  owner_business: { id: string; name?: string } | null
  ownership: string
  last_seen_at: string | null
}

export async function GET() {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = createAdminClient()

    const { data: live, error: liveError } = await supabase
      .from("ad_accounts")
      .select("fb_ad_account_id")
      .eq("org_id", ctx.orgId)

    if (liveError) throw new Error(liveError.message)

    const liveIds = (live || []).map((row: { fb_ad_account_id: string }) => row.fb_ad_account_id).filter(Boolean)

    // With no current account list there is nothing to subtract from, and every historical account
    // would look removed. Say so rather than inventing 20 deletions.
    if (liveIds.length === 0) {
      return NextResponse.json({ accounts: [], unavailable: true })
    }

    const { data: history, error: historyError } = await supabase
      .from("ad_account_metrics_snapshots")
      .select("fb_ad_account_id")
      .eq("org_id", ctx.orgId)
      .not("fb_ad_account_id", "in", `(${liveIds.join(",")})`)
      .limit(MAX_SNAPSHOT_ROWS)

    if (historyError) throw new Error(historyError.message)

    const removedIds = Array.from(
      new Set((history || []).map((row: { fb_ad_account_id: string }) => row.fb_ad_account_id).filter(Boolean))
    )
    if (removedIds.length === 0) return NextResponse.json({ accounts: [] })

    // One newest snapshot per removed account. The id list is bounded by how many ad accounts the
    // org has ever held, so this fans out over tens of rows, not thousands.
    const latest = await Promise.all(
      removedIds.map(async id => {
        const { data } = await supabase
          .from("ad_account_metrics_snapshots")
          .select(
            "fb_ad_account_id, fb_account_id, name, account_status, currency, timezone_name, amount_spent_minor, balance_minor, spend_cap_minor, owner_business_id, owner_business_name, ownership, synced_at"
          )
          .eq("org_id", ctx.orgId)
          .eq("fb_ad_account_id", id)
          .order("synced_at", { ascending: false })
          .limit(1)
        return data?.[0] || null
      })
    )

    const accounts: RemovedAdAccount[] = latest
      .filter((row): row is SnapshotRow => Boolean(row))
      .map(row => ({
        id: row.fb_ad_account_id,
        account_id: row.fb_account_id || String(row.fb_ad_account_id || "").replace(/^act_/, ""),
        name: row.name || row.fb_ad_account_id,
        currency: row.currency || "USD",
        account_status: row.account_status ?? null,
        amount_spent: row.amount_spent_minor != null ? String(row.amount_spent_minor) : null,
        spend_cap: row.spend_cap_minor != null ? String(row.spend_cap_minor) : null,
        balance: row.balance_minor != null ? String(row.balance_minor) : null,
        timezone_name: row.timezone_name || null,
        owner_business: row.owner_business_id
          ? { id: row.owner_business_id, name: row.owner_business_name || undefined }
          : null,
        ownership: row.ownership || "unknown",
        last_seen_at: row.synced_at || null,
      }))
      .sort((a, b) => (b.last_seen_at || "").localeCompare(a.last_seen_at || ""))

    return NextResponse.json({ accounts })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load removed ad accounts"
    console.error("[ad-accounts/removed]", message)
    return NextResponse.json({ error: message, accounts: [] }, { status: 500 })
  }
}
