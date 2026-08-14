import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getConnectionForAdAccount, isManual, MissingViaError } from "@/lib/auth"
import { createCampaign } from "@/lib/facebook"
import { invalidateMetaReadCacheAfterWrite } from "../../_db-cache"

const GRAPH_API_BASE = "https://graph.facebook.com/v25.0"

// POST /api/facebook/campaigns/duplicate-adsets
// Body: { targetCampaignIds, newCampaignName, adAccountId, adSetConfigs: [{
//   id, customName, copies, statusActive, startTime, endTime,
//   customAttribution, attrViewDays, attrClickDays, attrEngagedViewDays,
//   deepCopy, selectedAdIds, duplicatedAdsStatus
// }] }
// For each target campaign × each adSetConfig (× copies), copies the source ad set into target campaign.
// Optionally applies attribution_spec override and copies selected ads.
// newCampaignName (Ad Set "New" destination): when set, creates one new PAUSED campaign first —
// inheriting objective/special_ad_categories from adSetConfigs[0]'s source campaign — and uses it
// as the sole target, ignoring any supplied targetCampaignIds. Additive: existing
// targetCampaignIds-only callers (Launch) are unaffected.
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const suppliedTargetCampaignIds: string[] = Array.isArray(body.targetCampaignIds) ? body.targetCampaignIds : []
    const newCampaignName = typeof body.newCampaignName === "string" ? body.newCampaignName.trim() : ""
    const adSetConfigs: any[] = Array.isArray(body.adSetConfigs) ? body.adSetConfigs : []
    const adAccountId = request.nextUrl.searchParams.get("ad_account_id") || body.adAccountId

    if (suppliedTargetCampaignIds.length === 0 && !newCampaignName) {
      return NextResponse.json({ error: "targetCampaignIds or newCampaignName required" }, { status: 400 })
    }
    if (adSetConfigs.length === 0) {
      return NextResponse.json({ error: "Select at least one ad set to duplicate" }, { status: 400 })
    }
    if (!adAccountId) return NextResponse.json({ error: "adAccountId is required" }, { status: 400 })

    let connection
    try {
      connection = await getConnectionForAdAccount(ctx.orgId, adAccountId, "write")
    } catch (err) {
      if (err instanceof MissingViaError) return NextResponse.json({ error: err.message, code: "MISSING_LAUNCH_VIA" }, { status: 400 })
      throw err
    }
    if (!connection) return NextResponse.json({ error: "No Facebook connection" }, { status: 400 })

    let targetCampaignIds = suppliedTargetCampaignIds
    if (newCampaignName) {
      const sourceAdsetId = adSetConfigs[0].id
      const sourceRes = await fetch(
        `${GRAPH_API_BASE}/${sourceAdsetId}?fields=campaign{objective,special_ad_categories}&access_token=${encodeURIComponent(connection.access_token)}`
      )
      const sourceData = await sourceRes.json()
      if (!sourceRes.ok || !sourceData.campaign?.objective) {
        return NextResponse.json({ error: "Could not resolve source campaign objective for new campaign" }, { status: 400 })
      }
      const campaignAdAccountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
      try {
        const newCampaign = await createCampaign(campaignAdAccountId, connection.access_token, {
          name: newCampaignName,
          objective: sourceData.campaign.objective,
          special_ad_categories: sourceData.campaign.special_ad_categories || [],
          status: "PAUSED",
        }, { isManual: isManual(connection) })
        targetCampaignIds = [newCampaign.id]
      } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to create new campaign" }, { status: 500 })
      }
    }

    const buildAttributionSpec = (cfg: any): { event_type: string; window_days: number }[] | null => {
      if (!cfg.customAttribution) return null
      const spec: { event_type: string; window_days: number }[] = []
      const view = parseInt(cfg.attrViewDays || "0")
      const click = parseInt(cfg.attrClickDays || "0")
      const engaged = parseInt(cfg.attrEngagedViewDays || "0")
      if (view > 0) spec.push({ event_type: "VIEW_THROUGH", window_days: view })
      if (click > 0) spec.push({ event_type: "CLICK_THROUGH", window_days: click })
      if (engaged > 0) spec.push({ event_type: "ENGAGED_VIDEO_VIEW", window_days: engaged })
      return spec.length > 0 ? spec : null
    }

    const results: any[] = []
    const errors: string[] = []
    const warnings: string[] = []

    for (const targetCampaignId of targetCampaignIds) {
      const adSets: any[] = []
      for (const cfg of adSetConfigs) {
        const copies = Math.max(1, cfg.copies || 1)
        // Decide deep_copy strategy:
        // - If deepCopy true and selectedAdIds covers all ads → use Meta deep_copy=true (atomic, faster)
        // - If deepCopy true with subset → create empty ad set, then copy selected ads individually
        // - If deepCopy false → no ad copying
        const wantDeepCopy = !!cfg.deepCopy
        // null = "not specified" (use Meta deep_copy=true), [] = "explicitly empty" (no ads)
        const selectedAdIds: string[] | null = cfg.selectedAdIds === null ? null : Array.isArray(cfg.selectedAdIds) ? cfg.selectedAdIds : null
        const statusOption = ["ACTIVE", "PAUSED", "INHERITED"].includes(cfg.statusOption)
          ? cfg.statusOption
          : cfg.statusActive ? "ACTIVE" : "PAUSED"
        const duplicatedAdsStatus = ["ACTIVE", "PAUSED", "INHERITED"].includes(cfg.duplicatedAdsStatus)
          ? cfg.duplicatedAdsStatus
          : "PAUSED"

        for (let k = 0; k < copies; k++) {
          const aSuffix = copies > 1 ? ` ${k + 1}` : ""
          // Use Meta deep_copy=true only when: deepCopy requested AND no specific subset chosen (null)
          // If selectedAdIds is an empty array [], user explicitly wants no ads copied → don't deep copy
          const useDeepCopyFlag = wantDeepCopy && selectedAdIds === null
          const adsetParams = new URLSearchParams({
            access_token: connection.access_token,
            campaign_id: targetCampaignId,
            deep_copy: useDeepCopyFlag ? "true" : "false",
            status_option: statusOption,
          })
          const aRes = await fetch(`${GRAPH_API_BASE}/${cfg.id}/copies?${adsetParams}`, { method: "POST" })
          const aData = await aRes.json()
          if (!aRes.ok) {
            const msg = aData.error?.message || "copy failed"
            errors.push(`Ad set ${cfg.id} → campaign ${targetCampaignId}: ${msg}`)
            if (/rate limit|#4|request limit/i.test(msg)) {
              return NextResponse.json({ error: "Rate limited", rateLimited: true, partialResults: results }, { status: 429 })
            }
            continue
          }
          const newAdSetId = aData.copied_adset_id || aData.id
          if (!newAdSetId) {
            errors.push(`Ad set ${cfg.id} → campaign ${targetCampaignId}: Meta returned no copied ad set ID`)
            continue
          }

          // PATCH name + schedule + attribution_spec
          // Wait briefly — Meta needs a moment after /copies before the new ad set is patchable
          await new Promise(r => setTimeout(r, 400))

          const aUpdates: Record<string, string> = {}
          if (cfg.customName) aUpdates.name = cfg.customName + aSuffix
          if (cfg.startTime) aUpdates.start_time = cfg.startTime
          if (cfg.endTime) aUpdates.end_time = cfg.endTime
          const attrSpec = buildAttributionSpec(cfg)
          if (attrSpec) aUpdates.attribution_spec = JSON.stringify(attrSpec)

          if (Object.keys(aUpdates).length > 0) {
            const maxRetries = 3
            let renamed = false
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                const patchBody = new URLSearchParams(aUpdates)
                const pRes = await fetch(`${GRAPH_API_BASE}/${newAdSetId}?access_token=${encodeURIComponent(connection.access_token)}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: patchBody.toString(),
                })
                const pData = await pRes.json().catch(() => ({}))
                console.log(`[duplicate-adsets] PATCH ${newAdSetId} attempt ${attempt}:`, pRes.status, JSON.stringify(pData))
                if (pRes.ok) {
                  renamed = true
                  break
                }
                if (attempt < maxRetries) {
                  await new Promise(r => setTimeout(r, 600 * attempt))
                } else {
                  warnings.push(`Ad set ${newAdSetId} created but rename failed (${maxRetries} attempts): ${pData.error?.message || "unknown"}`)
                }
              } catch (e: any) {
                if (attempt === maxRetries) {
                  warnings.push(`Ad set ${newAdSetId} rename network error: ${e.message}`)
                }
              }
            }
            if (!renamed) console.warn(`[duplicate-adsets] Ad set ${newAdSetId} kept Meta default name (rename failed)`)
          }

          // Copy selected ads individually if subset chosen (and not using deep_copy=true)
          const copiedAdIds: string[] = []
          if (wantDeepCopy && selectedAdIds !== null && selectedAdIds.length > 0 && !useDeepCopyFlag) {
            for (const sourceAdId of selectedAdIds) {
              try {
                const copyAdParams = new URLSearchParams({
                  access_token: connection.access_token,
                  adset_id: newAdSetId,
                  status_option: duplicatedAdsStatus,
                })
                const adRes = await fetch(`${GRAPH_API_BASE}/${sourceAdId}/copies?${copyAdParams}`, { method: "POST" })
                const adData = await adRes.json()
                if (adRes.ok && (adData.copied_ad_id || adData.id)) {
                  copiedAdIds.push(adData.copied_ad_id || adData.id)
                } else if (adData.error) {
                  warnings.push(`Ad ${sourceAdId} copy failed: ${adData.error.message}`)
                }
              } catch (e: any) {
                warnings.push(`Ad ${sourceAdId} copy network error: ${e.message}`)
              }
            }
          }

          adSets.push({
            id: newAdSetId,
            name: (cfg.customName || "Ad Set") + aSuffix,
            copiedAdIds,
            usedDeepCopy: useDeepCopyFlag,
          })
        }
      }
      results.push({ id: targetCampaignId, adSets })
    }

    const createdAdSetCount = results.reduce((count, campaign) => count + campaign.adSets.length, 0)
    if (createdAdSetCount === 0 && errors.length > 0) {
      return NextResponse.json({
        error: errors[0],
        errors,
        warnings,
        partialResults: results,
      }, { status: 502 })
    }

    if (createdAdSetCount > 0 || newCampaignName) {
      const objectIds = results.flatMap(campaign => campaign.adSets.map((adSet: { id: string }) => adSet.id))
      if (newCampaignName) objectIds.push(...targetCampaignIds)
      await invalidateMetaReadCacheAfterWrite({ orgId: ctx.orgId, adAccountId, objectIds })
    }
    return NextResponse.json({ campaigns: results, errors, warnings })
  } catch (err: any) {
    console.error("[duplicate-adsets] error:", err)
    return NextResponse.json({ error: err.message || "Failed to duplicate ad sets" }, { status: 500 })
  }
}
