import { NextRequest, NextResponse } from "next/server"
import { notifyLaunchOutcome } from "@/lib/notifications/launch"
import { invalidateMetaReadCacheAfterWrite } from "../_db-cache"
import { getAuthContext, getConnectionForAdAccount, isManual, MissingViaError, requireRole } from "@/lib/auth"
import { isLaunchable } from "@/lib/creative-readiness"
import { createAdminClient } from "@/lib/supabase/admin"
import { createAd, getVideoThumbnail, getResourceAccountId, getAdSetCampaignsAndNames, copyAdSet, pollVideoReady, isFreshThumbnailUrl } from "@/lib/facebook"
import { adAccountBelongsToOrg, normalizeAdAccountId } from "@/app/api/facebook/_utils"
import { mapWithConcurrency } from "@/lib/bounded-concurrency"

// Table Mode batch launch: accepts all rows in one request.
// Auth, account validation, creative fetch happen ONCE instead of N times.
// Independent ad writes use a small cap; each copy still finishes before its dependent ad write.
export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const denied = requireRole(ctx)
    if (denied) return denied

    const supabase = createAdminClient()
    const adminDb = createAdminClient()

    const body = await request.json()
    const { rows, adAccountId, adAccountName, pageName: batchPageName } = body

    if (!rows?.length) return NextResponse.json({ error: "No rows provided" }, { status: 400 })
    if (!adAccountId) return NextResponse.json({ error: "adAccountId is required" }, { status: 400 })

    const batchHasTextVariations = rows.some((row: any) =>
      (row.headlineVariations || []).filter((s: string) => s?.trim()).length > 0 ||
      (row.primaryTextVariations || []).filter((s: string) => s?.trim()).length > 0 ||
      (row.descriptionVariations || []).filter((s: string) => s?.trim()).length > 0
    )
    if (batchHasTextVariations) {
      return NextResponse.json({
        error: "Multiple text options require a new Dynamic Creative ad set. Use the campaign launch flow (New/Per-creative ad set mode) instead of batch launching into existing ad sets.",
        code: "VARIATIONS_NEED_NEW_ADSET",
      }, { status: 400 })
    }

    // Via MECE: launch = WRITE → via launch của account → OAuth → block (VIA-MASTER.md)
    let connection
    try {
      connection = await getConnectionForAdAccount(ctx.orgId, adAccountId, "write")
    } catch (err) {
      if (err instanceof MissingViaError) {
        return NextResponse.json({ error: err.message, code: "MISSING_LAUNCH_VIA" }, { status: 400 })
      }
      throw err
    }
    if (!connection) return NextResponse.json({ error: "Facebook not connected" }, { status: 400 })

    const token = connection.access_token
    const tokenOpts = { isManual: isManual(connection) }

    // Validate ad account once for all rows
    const belongs = await adAccountBelongsToOrg(ctx.orgId, adAccountId, token)
    if (!belongs) return NextResponse.json({ error: "Ad account not found or not authorized" }, { status: 403 })

    const batchAdSetIds = [...new Set(rows.flatMap((r: any) => r.adSetIds || []))] as string[]
    const wrongAdSet = await Promise.all(
      batchAdSetIds.map(async (adSetId) => {
        const accountId = await getResourceAccountId(adSetId, token, tokenOpts)
        return accountId && accountId !== normalizeAdAccountId(adAccountId) ? adSetId : null
      })
    ).then(ids => ids.find(Boolean))
    if (wrongAdSet) {
      return NextResponse.json({ error: "Ad set does not belong to the selected ad account." }, { status: 400 })
    }

    // Fetch all creatives in one DB query
    const allCreativeIds = [...new Set(rows.flatMap((r: any) => r.creativeIds || []))] as string[]
    const { data: allCreatives } = await supabase
      .from("creatives")
      .select("*")
      .in("id", allCreativeIds)
      .eq("org_id", ctx.orgId)

    const notReady = (allCreatives || []).filter((c: any) => !isLaunchable(c))
    if (notReady.length > 0) {
      const names = notReady.map((c: any) => `"${c.file_name}" (${c.status})`).join(", ")
      return NextResponse.json({
        error: `Some media isn't ready to launch yet (uploading or processing on Meta): ${names}. Please wait until it finishes and try again.`
      }, { status: 400 })
    }

    const creativeMap = new Map((allCreatives || []).map((c: any) => [c.id, c]))

    // Poll all unprocessed videos in parallel across all rows
    const allVideosToCheck = [...creativeMap.values()]
      .filter((c: any) => c.fb_video_id && !c.fb_thumbnail_url)
      .map((c: any) => ({ creativeId: c.id, videoId: c.fb_video_id, fileName: c.file_name }))

    if (allVideosToCheck.length > 0) {
      const readyResults = await Promise.all(
        allVideosToCheck.map(v => pollVideoReady(v.videoId, token, 120_000, { skipProof: tokenOpts.isManual }).then(r => ({ ...v, ...r })))
      )
      // Trigger thumbnail updates asynchronously instead of serial thread sleeps
      readyResults.filter(r => r.ready).forEach((r) => {
        const cr: any = creativeMap.get(r.creativeId)
        if (!cr) return
        getVideoThumbnail(r.videoId, token, { skipProof: tokenOpts.isManual })
          .then(async (thumbUrl) => {
            if (thumbUrl) {
              cr.fb_thumbnail_url = thumbUrl
              await supabase.from("creatives").update({ fb_thumbnail_url: thumbUrl }).eq("id", r.creativeId)
            }
          })
          .catch(err => {
            console.error(`[launch-table-batch] Deferred thumbnail fetch failed for ${r.videoId}:`, err)
          })
      })
    }

    // Pre-fetch campaign IDs for all ad sets across all rows if any row uses oneAdPerAdset
    const needsCampaignIds = rows.some((r: any) => r.launchSettings?.oneAdPerAdset)
    const adSetCampaigns = needsCampaignIds
      ? await getAdSetCampaignsAndNames(batchAdSetIds, token, { skipProof: tokenOpts.isManual })
      : new Map<string, { campaign_id: string; name: string }>()

    const userName = ctx.user.full_name || ctx.user.email?.split("@")[0] || "Unknown"
    const rowResults: any[] = []

    for (const row of rows) {
      const rowStart = Date.now()
      const {
        adSetIds, adSetNames, creativeIds,
        adName: rowAdName, pageId, instagramAccountId,
        headline, headlineVariations, primaryText, primaryTextVariations,
        description, descriptionVariations, cta, webLink,
        createPaused, startTime: scheduledStart, endTime: scheduledEnd,
        partnerPageId, partnershipDisplayMode, multilanguage, catalogAds,
        collectionAds, sitelinks, adSourceMode, adSourceIds, enhancements, launchSettings,
      } = row

      const adSetNameMap = new Map<string, string>(
        (adSetIds || []).map((id: string, i: number) => [id, (adSetNames || [])[i] || id])
      )
      const adStatus = scheduledStart ? "PAUSED" : (createPaused === false ? "ACTIVE" : "PAUSED")
      const rowCreatives: any[] = (creativeIds || []).map((id: string) => creativeMap.get(id)).filter(Boolean)
      const created: any[] = []
      const errors: any[] = []

      for (const [adSetIndex, adSetId] of (adSetIds || []).entries()) {
        const outcomes = await mapWithConcurrency(rowCreatives, 3, async (creative, creativeIndex) => {
          const created: any[] = []
          const errors: any[] = []
          if (!isLaunchable(creative)) {
            errors.push({ adSetId, creativeId: creative.id, fileName: creative.file_name, error: "Creative not yet uploaded to Meta." })
            return { created, errors }
          }

          let targetAdSetId = adSetId
          if (launchSettings?.oneAdPerAdset && creativeIndex > 0) {
            const adSetInfo = adSetCampaigns.get(adSetId)
            if (!adSetInfo) {
              errors.push({ adSetId, creativeId: creative.id, fileName: creative.file_name, error: "Cannot duplicate ad set: campaign_id lookup failed." })
              return { created, errors }
            }
            try {
              const copy = await copyAdSet(token, adSetId, {
                campaign_id: adSetInfo.campaign_id,
                name: adSetInfo.name,
                status: adStatus,
              }, tokenOpts)
              targetAdSetId = copy.id
              adSetNameMap.set(targetAdSetId, adSetInfo.name)
            } catch (err: any) {
              errors.push({ adSetId, creativeId: creative.id, fileName: creative.file_name, error: `Failed to duplicate ad set: ${err.message || "Unknown error"}` })
              return { created, errors }
            }
          }

          const adName = rowAdName?.trim() || creative.file_name.replace(/\.[^/.]+$/, "")
          const sourceId = adSourceIds?.[creative.id] || ""

          if (adSourceMode === "post_id" && sourceId) {
            try {
              const ad = await createAd(adAccountId, token, {
                name: adName, adset_id: targetAdSetId, page_id: pageId,
                object_story_id: sourceId, title: "", body: "",
                cta: cta || "LEARN_MORE", link_url: webLink || "", status: adStatus,
              }, tokenOpts)
              await supabase.from("creatives").update({ fb_ad_id: ad.id }).eq("id", creative.id)
              created.push({ adId: ad.id, adSetId: targetAdSetId, adSetName: adSetNameMap.get(targetAdSetId) || targetAdSetId, creativeId: creative.id, fileName: creative.file_name, mode: "post_id" })
            } catch (err: any) {
              errors.push({ adSetId: targetAdSetId, creativeId: creative.id, fileName: creative.file_name, error: err.message })
            }
            return { created, errors }
          }

          if (adSourceMode === "creative_id" && sourceId) {
            try {
              const ad = await createAd(adAccountId, token, {
                name: adName, adset_id: targetAdSetId, page_id: pageId,
                reuse_creative_id: sourceId, title: "", body: "",
                cta: cta || "LEARN_MORE", link_url: webLink || "", status: adStatus,
              }, tokenOpts)
              await supabase.from("creatives").update({ fb_ad_id: ad.id }).eq("id", creative.id)
              created.push({ adId: ad.id, adSetId: targetAdSetId, adSetName: adSetNameMap.get(targetAdSetId) || targetAdSetId, creativeId: creative.id, fileName: creative.file_name, mode: "creative_id" })
            } catch (err: any) {
              errors.push({ adSetId: targetAdSetId, creativeId: creative.id, fileName: creative.file_name, error: err.message })
            }
            return { created, errors }
          }

          let thumbnailUrl: string | undefined
          if (creative.fb_video_id) {
            if (isFreshThumbnailUrl(creative.fb_thumbnail_url)) {
              thumbnailUrl = creative.fb_thumbnail_url
            } else {
              thumbnailUrl = (await getVideoThumbnail(creative.fb_video_id, token, { skipProof: tokenOpts.isManual })) || undefined
              if (thumbnailUrl) await supabase.from("creatives").update({ fb_thumbnail_url: thumbnailUrl }).eq("id", creative.id)
            }
          }

          try {
            const rowTitle = (headline || creative.headline || "").trim()
            const rowBody  = (primaryText || creative.primary_text || "").trim()
            const rowDesc  = (description || creative.description || "").trim()

            const allBodies = Array.from(new Set([rowBody,  ...(primaryTextVariations || [])].map((s: string) => s.trim()).filter(Boolean)))
            const allTitles = Array.from(new Set([rowTitle, ...(headlineVariations    || [])].map((s: string) => s.trim()).filter(Boolean)))
            const allDescs  = Array.from(new Set([rowDesc,  ...(descriptionVariations || [])].map((s: string) => s.trim()).filter(Boolean)))

            // Multiple Text Options (MTO): all variations on ONE ad via asset_feed_spec with
            // optimization_type DEGREES_OF_FREEDOM (handled in createAd). Ad set stays standard.
            const hasVariations = allBodies.length > 1 || allTitles.length > 1 || allDescs.length > 1

            const ad = await createAd(adAccountId, token, {
              name: adName,
              adset_id: targetAdSetId,
              page_id: pageId,
              instagram_actor_id: instagramAccountId || undefined,
              image_hash: creative.fb_image_hash || undefined,
              video_id: creative.fb_video_id || undefined,
              thumbnail_url: thumbnailUrl,
              title: allTitles[0] || rowTitle,
              body: allBodies[0] || rowBody,
              description: allDescs[0] || rowDesc,
              cta: cta || creative.cta || "LEARN_MORE",
              link_url: webLink || creative.link_url || "",
              status: adStatus,
              branded_content_sponsor_page_id: partnerPageId || undefined,
              partnership_display_mode: partnershipDisplayMode || undefined,
              multilanguage: multilanguage || undefined,
              catalog_ads: catalogAds || undefined,
              collection_ads: collectionAds || undefined,
              sitelinks: sitelinks?.length > 0 ? sitelinks : undefined,
              text_variations: hasVariations
                ? { bodies: allBodies.length ? allBodies : [rowBody], titles: allTitles.length ? allTitles : [rowTitle], descriptions: allDescs }
                : undefined,
            }, tokenOpts)

            await supabase.from("creatives").update({ fb_ad_id: ad.id }).eq("id", creative.id)

            created.push({
              adId: ad.id, adSetId: targetAdSetId, adSetName: adSetNameMap.get(targetAdSetId) || targetAdSetId,
              creativeId: creative.id, fileName: creative.file_name,
              thumbnailUrl: thumbnailUrl || creative.fb_thumbnail_url || creative.fb_image_url || null,
              mediaType: creative.media_type || "image",
            })
          } catch (err: any) {
            errors.push({ adSetId: targetAdSetId, creativeId: creative.id, fileName: creative.file_name, error: err.message || "Failed to create ad" })
          }
          return { created, errors }
        })
        created.push(...outcomes.flatMap(outcome => outcome.created))
        errors.push(...outcomes.flatMap(outcome => outcome.errors))
      }

      rowResults.push({ created, errors, totalAds: created.length, durationMs: Date.now() - rowStart, scheduledStart, scheduledEnd })
    }

    // Aggregate all rows → ONE batch record
    const allCreated   = rowResults.flatMap(r => r.created)
    const allErrors    = rowResults.flatMap(r => r.errors)
    const totalCreated = allCreated.length
    const totalFailed  = allErrors.length

    const originalAdSetIds   = [...new Set(rows.flatMap((r: any) => r.adSetIds   || []))] as string[]
    const originalAdSetNames = [...new Set(rows.flatMap((r: any) => r.adSetNames || []))] as string[]

    const finalAdSetIds = [...new Set(allCreated.map(c => c.adSetId))] as string[]
    const finalAdSetNames = finalAdSetIds.map(id => {
      const match = allCreated.find(c => c.adSetId === id)
      return match ? match.adSetName : id
    })

    const allThumbs      = [...new Set(
      [...creativeMap.values()].map((c: any) => c.fb_thumbnail_url || c.fb_image_url || c.file_url || null).filter(Boolean)
    )] as string[]

    const firstRow    = rows[0] || {}
    const batchStatus = allErrors.length === 0 ? "success" : allCreated.length > 0 ? "partial" : "failed"

    const { data: batchRecord, error: batchErr } = await adminDb.from("launch_batches").insert({
      org_id: ctx.orgId,
      user_id: ctx.user.id,
      user_name: userName,
      ad_account_id: adAccountId,
      ad_account_name: adAccountName || adAccountId,
      adset_ids: finalAdSetIds.length > 0 ? finalAdSetIds : originalAdSetIds,
      adset_names: finalAdSetNames.length > 0 ? finalAdSetNames : originalAdSetNames,
      creative_ids: allCreativeIds,
      creative_thumbs: allThumbs,
      primary_text: firstRow.primaryText || null,
      headline: firstRow.headline || null,
      cta: firstRow.cta || null,
      web_link: firstRow.webLink || null,
      page_id: firstRow.pageId || null,
      page_name: batchPageName || null,
      status: batchStatus,
      total_ads: totalCreated,
      failed_ads: totalFailed,
      duration_ms: Date.now() - startTime,
      errors: allErrors,
      created_ads: allCreated,
    }).select("id").single()

    if (batchErr) console.error("[launch-table-batch] Failed to save batch record:", batchErr)
    const auditError = batchErr
      ? `Ads were created in Meta, but Launch History could not be saved: ${batchErr.message}`
      : null

    const scheduleErrors: { scheduledStart: string; error: string }[] = []

    // Save scheduled activations per row
    for (const row of rowResults) {
      if (row.scheduledStart && row.created.length > 0) {
        const adIds = row.created.map((c: any) => c.adId).filter(Boolean) as string[]
        if (adIds.length > 0) {
          const { error: activationError } = await adminDb.from("scheduled_activations").insert({
            org_id: ctx.orgId,
            ad_account_id: adAccountId,
            ad_ids: adIds,
            scheduled_at: row.scheduledStart,
            end_time: row.scheduledEnd || null,
            status: "pending",
          })
          if (activationError) {
            const error = `Ads were created PAUSED, but scheduling failed: ${activationError.message}`
            row.scheduleError = error
            scheduleErrors.push({ scheduledStart: row.scheduledStart, error })
          }
        }
      }
    }

    const batchId = batchRecord?.id || null
    if (batchId && scheduleErrors.length > 0) {
      await adminDb.from("launch_batches").update({
        status: "partial",
        errors: [...allErrors, ...scheduleErrors.map(item => ({ type: "schedule", ...item }))],
      }).eq("id", batchId)
    }

    // Table mode launches many rows at once, so a partial failure is the common case,
    // not the edge case — it is the one this route most needs to report.
    void notifyLaunchOutcome({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: userName,
      batchId,
      adAccountName: adAccountName || adAccountId,
      targetName: finalAdSetNames[0] || originalAdSetNames[0] || null,
      created: totalCreated,
      failed: totalFailed + scheduleErrors.length,
      source: "launch-table-batch",
    })

    if (totalCreated > 0) {
      await invalidateMetaReadCacheAfterWrite({
        orgId: ctx.orgId,
        adAccountId,
        objectIds: allCreated.map(item => item.adId).filter(Boolean),
      })
    }

    return NextResponse.json({
      success: true,
      batchId,
      auditError,
      rows: rowResults.map(r => ({ ...r, batchId })),
      totalCreated,
      totalFailed,
      scheduleErrors,
      durationMs: Date.now() - startTime,
    })
  } catch (err: any) {
    console.error("[launch-table-batch] error:", err)
    return NextResponse.json({ error: err.message || "Launch failed" }, { status: 500 })
  }
}
