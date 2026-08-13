import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getConnectionForAdAccount } from "@/lib/auth"
import { GRAPH_API_BASE } from "@/lib/facebook"
import { buildTargeting, type TargetingInput } from "@/lib/create-campaign-targeting"

/**
 * Estimated audience size for the ad set being composed — the right-rail card Meta shows next to
 * the Audience section (`specs/create-campaign-rebuild/create-campaign-flow.html` §6).
 *
 * The number is Meta's, not ours: `act_<id>/delivery_estimate` returns the monthly-active bounds
 * for a targeting spec under a given optimization goal. Building the spec with the same
 * `buildTargeting` the create route uses is the point — an estimate computed from a different
 * targeting object would be a confident lie about a different audience.
 *
 * Read path, so this uses the **Via NON-LAUNCH** connection (`"read"`), same as
 * `adset-advertisers`. It creates nothing and must never be given the write slot.
 */

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const adAccountId: string = body.ad_account_id || ""
    const optimizationGoal: string = body.optimization_goal || ""
    const targetingInput = body.targeting as TargetingInput | undefined

    if (!adAccountId) {
      return NextResponse.json({ error: "ad_account_id is required" }, { status: 400 })
    }
    if (!optimizationGoal) {
      return NextResponse.json({ error: "optimization_goal is required" }, { status: 400 })
    }
    if (!targetingInput || !Array.isArray(targetingInput.locations) || targetingInput.locations.length === 0) {
      // No country selected is a legitimate in-progress state, not an error worth a 500.
      return NextResponse.json({ estimateReady: false, reason: "no_locations" })
    }

    const connection = await getConnectionForAdAccount(ctx.orgId, adAccountId, "read")
    if (!connection) {
      return NextResponse.json({ error: "No Facebook connection found" }, { status: 400 })
    }

    const params = new URLSearchParams({
      optimization_goal: optimizationGoal,
      targeting_spec: JSON.stringify(buildTargeting(targetingInput)),
      access_token: connection.access_token,
    })

    const res = await fetch(`${GRAPH_API_BASE}/${adAccountId}/delivery_estimate?${params}`)
    const data = await res.json()

    if (!res.ok) {
      // Meta rejects some goal/targeting pairs outright. That is information for the card, not a
      // reason to fail the whole ad set step, so it comes back as a soft "not ready".
      return NextResponse.json({
        estimateReady: false,
        reason: data?.error?.message || "Meta could not estimate this audience",
      })
    }

    const estimate = Array.isArray(data.data) ? data.data[0] : null
    if (!estimate) return NextResponse.json({ estimateReady: false, reason: "no_estimate" })

    return NextResponse.json({
      estimateReady: estimate.estimate_ready !== false,
      lowerBound: estimate.estimate_mau_lower_bound ?? null,
      upperBound: estimate.estimate_mau_upper_bound ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to estimate audience size"
    console.error("[delivery-estimate] error:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
