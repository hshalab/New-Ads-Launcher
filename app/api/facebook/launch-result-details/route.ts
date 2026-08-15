import { NextRequest, NextResponse } from "next/server"

import { getOrgAdAccountInfo } from "../_utils"
import { getAuthContext, getConnectionForAdAccount, isManual } from "@/lib/auth"
import { GRAPH_API_BASE } from "@/lib/facebook"
import { secureMetaFetch } from "@/lib/meta-secure-fetch"

const FIELDS = [
  "id",
  "name",
  "effective_status",
  "campaign{id,name,bid_strategy,daily_budget,lifetime_budget}",
  "adset{id,name,bid_strategy,bid_amount,bid_constraints,optimization_goal,daily_budget,lifetime_budget}",
].join(",")

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const adAccountId = String(body.adAccountId || "").trim()
    const adIds = Array.from(new Set<string>(
      (Array.isArray(body.adIds) ? body.adIds : [])
        .map((id: unknown) => String(id || "").trim())
        .filter((id: string) => /^\d+$/.test(id))
    )).slice(0, 50)

    if (!/^(act_)?\d+$/.test(adAccountId) || adIds.length === 0) {
      return NextResponse.json({ error: "A valid adAccountId and adIds are required" }, { status: 400 })
    }

    const connection = await getConnectionForAdAccount(ctx.orgId, adAccountId, "read")
    if (!connection) return NextResponse.json({ ads: [], unavailable: true })

    const account = await getOrgAdAccountInfo(ctx.orgId, adAccountId, connection.access_token)
    if (!account) return NextResponse.json({ error: "Ad account does not belong to this organisation" }, { status: 403 })

    const params = new URLSearchParams({
      ids: adIds.join(","),
      fields: FIELDS,
      access_token: connection.access_token,
    })
    const response = await secureMetaFetch(
      `${GRAPH_API_BASE}/?${params}`,
      undefined,
      { skipProof: isManual(connection) },
    )
    const payload = await response.json()
    if (!response.ok || payload?.error) {
      return NextResponse.json({ error: payload?.error?.message || "Failed to load launch details" }, { status: 502 })
    }

    const ads = adIds.flatMap(id => {
      const item = payload?.[id]
      return item && !item.error ? [item] : []
    })
    return NextResponse.json({ ads, currency: account.currency || "USD" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load launch details"
    console.error("[launch-result-details]", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
