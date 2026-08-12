import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getFacebookConnection } from "@/lib/auth"

const GRAPH_API_BASE = "https://graph.facebook.com/v25.0"

// GET /api/facebook/adsets/[id]/detail
// Returns full ad set info + parent campaign info for the duplicate modal preview
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const connection = await getFacebookConnection(ctx.orgId)
    if (!connection) return NextResponse.json({ error: "No Facebook connection" }, { status: 400 })

    // Fetch ad set with all relevant fields
    const adsetFields = [
      "id", "name", "status", "effective_status",
      "daily_budget", "lifetime_budget",
      "start_time", "end_time",
      "pacing_type",
      "optimization_goal", "billing_event", "bid_strategy", "bid_amount",
      "destination_type", "attribution_spec", "promoted_object{pixel_id,custom_event_type}",
      // excluded_geo_locations must stay hydrated: it is a REMOVABLE_TARGETING_KEYS member, so an
      // unhydrated absence would be read as "the user removed every exclusion" at publish time.
      "targeting{geo_locations,excluded_geo_locations,age_min,age_max,genders,custom_audiences,excluded_custom_audiences,flexible_spec,targeting_optimization,publisher_platforms,device_platforms,facebook_positions,instagram_positions,audience_network_positions,messenger_positions}",
      "campaign_id",
      "ads.summary(true){id}",
    ].join(",")

    const adsetRes = await fetch(`${GRAPH_API_BASE}/${id}?fields=${adsetFields}&access_token=${connection.access_token}`)
    const adsetData = await adsetRes.json()
    if (!adsetRes.ok) {
      const msg = adsetData.error?.message || "Failed to fetch ad set"
      if (/rate limit|#4|request limit/i.test(msg)) {
        return NextResponse.json({ error: "Rate limited", rateLimited: true }, { status: 429 })
      }
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    // Fetch parent campaign
    const campaignFields = ["id", "name", "objective", "daily_budget", "lifetime_budget", "buying_type", "special_ad_categories"].join(",")
    let campaignData: any = null
    if (adsetData.campaign_id) {
      const cRes = await fetch(`${GRAPH_API_BASE}/${adsetData.campaign_id}?fields=${campaignFields}&access_token=${connection.access_token}`)
      if (cRes.ok) {
        campaignData = await cRes.json()
        // Detect CBO: campaign has budget set
        campaignData.is_cbo = !!(campaignData.daily_budget || campaignData.lifetime_budget)
      }
    }

    return NextResponse.json({
      adSet: {
        ...adsetData,
        ad_count: adsetData.ads?.summary?.total_count ?? 0,
      },
      campaign: campaignData,
    })
  } catch (err: any) {
    console.error("[adset detail] error:", err)
    return NextResponse.json({ error: err.message || "Failed to fetch detail" }, { status: 500 })
  }
}
