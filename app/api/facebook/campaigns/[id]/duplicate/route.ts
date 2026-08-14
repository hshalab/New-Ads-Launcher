import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getConnectionForAdAccount, MissingViaError } from "@/lib/auth"
import { invalidateMetaReadCacheAfterWrite } from "../../../_db-cache"

const GRAPH_API_BASE = "https://graph.facebook.com/v25.0"

// POST /api/facebook/campaigns/[id]/duplicate
// Body: { customName, count, dailyBudget, lifetimeBudget, bidStrategy, statusOption, launchAsActive, adAccountId,
//         mode: "ALL" | undefined,
//         adSetConfigs: [{ id, customName, copies, statusActive, startTime, endTime, customAttribution, deepCopy }] }
// mode: "ALL" — Ads Manager campaign-level duplicate: Meta deep_copy=true copies every child
//   ad set + ad atomically. adSetConfigs is ignored. Meta does not return child object ids for
//   a deep copy, so the response's adSets stays empty — the new campaign id is enough for the
//   caller (Editor draft-highlight targets the campaign, not its children).
// mode omitted — Launch's existing per-adSetConfig fine-grained copy (unchanged).
// Returns: { campaigns: [{ id, name, adSets: [...] }] }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const adAccountId = request.nextUrl.searchParams.get("ad_account_id") || body.adAccountId
    if (!adAccountId) return NextResponse.json({ error: "adAccountId is required" }, { status: 400 })

    const customName = body.customName || ""
    const count = Math.max(1, Math.min(20, body.count || 1))
    const status = ["ACTIVE", "PAUSED", "INHERITED"].includes(body.statusOption)
      ? body.statusOption
      : body.launchAsActive ? "ACTIVE" : "PAUSED"
    const adSetConfigs: any[] = Array.isArray(body.adSetConfigs) ? body.adSetConfigs : []

    let connection
    try {
      connection = await getConnectionForAdAccount(ctx.orgId, adAccountId, "write")
    } catch (err) {
      if (err instanceof MissingViaError) return NextResponse.json({ error: err.message, code: "MISSING_LAUNCH_VIA" }, { status: 400 })
      throw err
    }
    if (!connection) return NextResponse.json({ error: "No Facebook connection" }, { status: 400 })

    const results: any[] = []
    const warnings: string[] = []
    for (let i = 0; i < count; i++) {
      // Meta-style suffix: "Name - Copy 1", "Name - Copy 2" (customName usually already ends with " - Copy")
      const suffix = count > 1 ? ` ${i + 1}` : ""
      const finalName = (customName || "Copy") + suffix

      // Step 1: Create campaign copy via Meta /copies
      const copyParams = new URLSearchParams({
        access_token: connection.access_token,
        deep_copy: body.mode === "ALL" ? "true" : "false", // "true" for Ads Manager atomic copy-ALL child adsets+ads
        status_option: status,
      })
      const copyRes = await fetch(`${GRAPH_API_BASE}/${id}/copies?${copyParams}`, { method: "POST" })
      const copyData = await copyRes.json()
      console.log(`[duplicate campaign] /copies response (i=${i}):`, JSON.stringify(copyData))
      if (!copyRes.ok) {
        const msg = copyData.error?.message || "Failed to copy campaign"
        if (/rate limit|#4|request limit/i.test(msg)) {
          return NextResponse.json({ error: "Rate limited", rateLimited: true }, { status: 429 })
        }
        return NextResponse.json({ error: msg, partialResults: results }, { status: 500 })
      }
      const newCampaignId = copyData.copied_campaign_id || copyData.id
      if (!newCampaignId) {
        return NextResponse.json({
          error: "Meta did not return a new campaign ID",
          rawResponse: copyData,
          partialResults: results,
        }, { status: 500 })
      }

      // The copy exists even if a later override or copy fails.
      await invalidateMetaReadCacheAfterWrite({ orgId: ctx.orgId, adAccountId, objectIds: [newCampaignId] })

      // Apply campaign overrides (name + budget + bid strategy)
      // Wait briefly — Meta needs a moment after /copies before the new campaign is patchable
      await new Promise(r => setTimeout(r, 400))

      const updates: Record<string, string> = { name: finalName }
      if (body.dailyBudget) updates.daily_budget = String(Math.round(parseFloat(body.dailyBudget) * 100))
      if (body.lifetimeBudget) updates.lifetime_budget = String(Math.round(parseFloat(body.lifetimeBudget) * 100))
      if (body.bidStrategy && body.bidStrategy !== "inherit") updates.bid_strategy = body.bidStrategy

      let renamed = false
      const maxRetries = 3
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const patchBody = new URLSearchParams(updates)
          const patchRes = await fetch(`${GRAPH_API_BASE}/${newCampaignId}?access_token=${encodeURIComponent(connection.access_token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: patchBody.toString(),
          })
          const patchData = await patchRes.json().catch(() => ({}))
          console.log(`[duplicate campaign] PATCH ${newCampaignId} attempt ${attempt}:`, patchRes.status, JSON.stringify(patchData))
          if (patchRes.ok) {
            renamed = true
            break
          }
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 600 * attempt))
          } else {
            warnings.push(`Campaign ${newCampaignId} created but rename failed (${maxRetries} attempts): ${patchData.error?.message || "unknown"}`)
          }
        } catch (e: any) {
          if (attempt === maxRetries) {
            warnings.push(`Campaign ${newCampaignId} rename network error: ${e.message}`)
          }
        }
      }

      // Verify by fetching the new campaign
      try {
        const verifyRes = await fetch(`${GRAPH_API_BASE}/${newCampaignId}?fields=id,name,status,account_id&access_token=${connection.access_token}`)
        const verifyData = await verifyRes.json()
        console.log(`[duplicate campaign] verify ${newCampaignId} (renamed=${renamed}):`, JSON.stringify(verifyData))
      } catch {}

      // Step 2: Duplicate selected ad sets into new campaign (skipped if mode === "ALL")
      const adSets: any[] = []
      if (body.mode !== "ALL") {
        for (const cfg of adSetConfigs) {
          const copies = Math.max(1, cfg.copies || 1)
          for (let k = 0; k < copies; k++) {
            const aSuffix = copies > 1 ? ` ${k + 1}` : ""
            const adsetParams = new URLSearchParams({
              access_token: connection.access_token,
              campaign_id: newCampaignId,
              deep_copy: cfg.deepCopy ? "true" : "false",
              status_option: ["ACTIVE", "PAUSED", "INHERITED"].includes(cfg.statusOption)
                ? cfg.statusOption
                : cfg.statusActive ? "ACTIVE" : "PAUSED",
            })
            const aRes = await fetch(`${GRAPH_API_BASE}/${cfg.id}/copies?${adsetParams}`, { method: "POST" })
            const aData = await aRes.json()
            if (aRes.ok && aData.copied_adset_id) {
              const newAdSetId = aData.copied_adset_id
              // Rename + apply schedule overrides
              const aUpdates: Record<string, string> = {}
              if (cfg.customName) aUpdates.name = cfg.customName + aSuffix
              if (cfg.startTime) aUpdates.start_time = cfg.startTime
              if (cfg.endTime) aUpdates.end_time = cfg.endTime
              if (Object.keys(aUpdates).length > 0) {
                try {
                  await fetch(`${GRAPH_API_BASE}/${newAdSetId}`, {
                    method: "POST",
                    body: new URLSearchParams({ ...aUpdates, access_token: connection.access_token }),
                  })
                } catch {}
              }
              adSets.push({ id: newAdSetId, name: (cfg.customName || "Ad Set") + aSuffix })
            }
          }
        }
      }

      results.push({ id: newCampaignId, name: finalName, adSets })
    }

    return NextResponse.json({ campaigns: results, warnings })
  } catch (err: any) {
    console.error("[duplicate campaign] error:", err)
    return NextResponse.json({ error: err.message || "Failed to duplicate campaign" }, { status: 500 })
  }
}
