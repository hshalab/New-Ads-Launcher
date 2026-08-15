import { NextRequest, NextResponse } from "next/server"
import { notifyLaunchOutcome } from "@/lib/notifications/launch"
import { invalidateMetaReadCacheAfterWrite } from "../_db-cache"
import { getAuthContext, getConnectionForAdAccount, isManual, MissingViaError, requireRole } from "@/lib/auth"
import { isLaunchable } from "@/lib/creative-readiness"
import { isExistingAdCreativeId, resolveExistingAdSources, type ExistingAdSource } from "@/lib/existing-ad-launch"
import { createAdminClient } from "@/lib/supabase/admin"
import { createAd, getVideoThumbnail, getResourceAccountId, getDynamicCreativeAdSets, getAdSetCampaignsAndNames, copyAdSet, pollVideoReady, isFreshThumbnailUrl } from "@/lib/facebook"
import { adAccountBelongsToOrg, normalizeAdAccountId } from "@/app/api/facebook/_utils"
import { mapWithConcurrency } from "@/lib/bounded-concurrency"

// Simple launch: create ads directly in existing ad sets.
// N creatives × M ad sets = N×M ads. No campaign/adset creation needed.
export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const denied = requireRole(ctx)
    if (denied) return denied

    const supabase = createAdminClient()

    const body = await request.json()
    const {
      adAccountId,
      adAccountName,
      adSetIds,
      adSetNames,
      creativeIds,
      adName: rowAdName,
      pageId,
      instagramAccountId,
      headline,
      headlineVariations,
      primaryText,
      primaryTextVariations,
      description,
      descriptionVariations,
      cta,
      webLink,
      createPaused,
      startTime: scheduledStart,
      endTime: scheduledEnd,
      partnerPageId,
      partnershipDisplayMode,
      multilanguage,
      catalogAds,
      carouselAds,
      flexibleAds,
      multiPlacementAds,
      adSourceMode,  // "new_ad" | "post_id" | "creative_id"
      adSourceIds,   // Record<creativeId, objectStoryId | metaCreativeId>
      existingAdSources, // Record<existing_<adId>, ExistingAdSource>
      enhancements,  // DefaultAdSettings["enhancements"] | undefined
      launchSettings, // DefaultAdSettings["launch"] | undefined
      collectionAds, // CollectionAds config | undefined
      sitelinks,     // SitelinkItem[] | undefined
    } = body

    if (!adAccountId) return NextResponse.json({ error: "adAccountId is required" }, { status: 400 })
    if (!adSetIds?.length) return NextResponse.json({ error: "Select at least one ad set" }, { status: 400 })
    if (!creativeIds?.length) return NextResponse.json({ error: "Select at least one creative" }, { status: 400 })
    if (!pageId) return NextResponse.json({ error: "Select a Facebook Page" }, { status: 400 })
    if (!webLink) return NextResponse.json({ error: "Web link (URL) is required" }, { status: 400 })
    if (!webLink.startsWith("http")) return NextResponse.json({ error: "URL must start with http:// or https://" }, { status: 400 })

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

    // Verify ad account belongs to this org — checks DB first, falls back to live Meta API
    const belongs = await adAccountBelongsToOrg(ctx.orgId, adAccountId, token)
    if (!belongs) {
      return NextResponse.json({ error: "Ad account not found or not authorized" }, { status: 403 })
    }

    const wrongAccountAdSet = await Promise.all(
      (adSetIds as string[]).map(async (adSetId) => {
        const accountId = await getResourceAccountId(adSetId, token, tokenOpts)
        return accountId && accountId !== normalizeAdAccountId(adAccountId) ? adSetId : null
      })
    ).then(ids => ids.find(Boolean))
    if (wrongAccountAdSet) {
      return NextResponse.json({ error: "Ad set does not belong to the selected ad account." }, { status: 400 })
    }

    // Existing Ads post reuse: synthetic `existing_<adId>` ids carry no DB row —
    // partition them out before the creatives query, resolve their object_story_id
    // locally (no Meta call), and splice pseudo-creatives back in below.
    const realCreativeIds: string[] = (creativeIds as string[]).filter((id: string) => !isExistingAdCreativeId(id))
    const existingCreativeIds: string[] = (creativeIds as string[]).filter((id: string) => isExistingAdCreativeId(id))

    let creatives: any[] = []
    if (realCreativeIds.length > 0) {
      const { data, error: creativeErr } = await supabase
        .from("creatives")
        .select("*")
        .in("id", realCreativeIds)
        .eq("org_id", ctx.orgId)

      if (creativeErr || !data?.length) {
        return NextResponse.json({ error: "Creatives not found" }, { status: 400 })
      }
      creatives = data

      const foundIds = new Set(creatives.map((c: any) => c.id))
      const missingIds = realCreativeIds.filter((id) => !foundIds.has(id))
      if (missingIds.length > 0) {
        return NextResponse.json(
          { error: `Creatives not found: ${missingIds.join(", ")}` },
          { status: 400 },
        )
      }
    }

    const errors: any[] = []

    if (existingCreativeIds.length > 0) {
      const { resolved, errors: existingErrors } = resolveExistingAdSources(
        existingCreativeIds,
        existingAdSources as Record<string, ExistingAdSource> | undefined,
        pageId,
      )
      if (existingErrors.length > 0) {
        // Fail the entire request before Meta writes when any Existing Ad source is invalid.
        return NextResponse.json({
          error: existingErrors.length === 1
            ? existingErrors[0].error
            : `${existingErrors.length} Existing Ad(s) have an invalid post source.`,
          errors: existingErrors.map(({ creativeId, error }) => ({
            creativeId,
            fileName: `Existing Ad ${creativeId.slice("existing_".length)}`,
            error,
          })),
        }, { status: 400 })
      }

      // Splice pseudo-creatives (no DB row) into `creatives`, preserving request order.
      for (const id of existingCreativeIds) {
        const source = resolved.get(id)
        if (!source) continue
        creatives.push({
          id,
          file_name: `Existing Ad ${source.adId}`,
          object_story_id: source.postId,
          is_existing_ad: true,
        })
      }
      const orderIndex = new Map((creativeIds as string[]).map((id: string, i: number) => [id, i]))
      creatives.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0))
    }

    if (creatives.length === 0) {
      return NextResponse.json({ error: errors[0]?.error || "Creatives not found" }, { status: 400 })
    }

    // Launchability = Meta has the asset. Video processing readiness is checked
    // by pollVideoReady below; the seam here is the asset id, not status.
    // Existing-Ad pseudo-creatives reuse a post via object_story_id — exempt.
    const notUploaded = creatives.filter((c: any) => !c.is_existing_ad && !isLaunchable(c))
    if (notUploaded.length > 0) {
      return NextResponse.json({
        error: `${notUploaded.length} creative(s) not yet uploaded to Meta. Open Ads Manager and upload them before launching.`,
        creativeIds: notUploaded.map((c: any) => c.id),
      }, { status: 400 })
    }

    // Scheduled ads must start PAUSED — cron job activates them at scheduled_at
    const adStatus = scheduledStart ? "PAUSED" : (createPaused === false ? "ACTIVE" : "PAUSED")
    const created: any[] = []

    // Quick lookup: adSetId → adSetName (for enriching created[] entries)
    const adSetNameMap = new Map<string, string>(
      (adSetIds || []).map((id: string, i: number) => [id, (adSetNames || [])[i] || id])
    )

    // Skip polling for videos that already have a fb_thumbnail_url (proxy: thumbnail only exists
    // after Meta finishes processing). Only poll the recently-uploaded ones.
    const videosToCheck: { creativeId: string; videoId: string; fileName: string }[] = creatives
      .filter((c: any) => !c.is_existing_ad && c.fb_video_id && !c.fb_thumbnail_url)
      .map((c: any) => ({ creativeId: c.id, videoId: c.fb_video_id, fileName: c.file_name }))

    if (videosToCheck.length > 0) {
      console.log(`[launch-direct] Polling ${videosToCheck.length} unprocessed video(s) for "ready" status (max 120s)…`)
      // Professional videos from Drive often need 45-90s to process. 120s is a safe expert-recommended limit.
      const readyResults = await Promise.all(
        videosToCheck.map(v => pollVideoReady(v.videoId, token, 120_000, { skipProof: tokenOpts.isManual }).then(r => ({ ...v, ...r })))
      )
      const stillNotReady = readyResults.filter(r => !r.ready)
      for (const nr of stillNotReady) {
        errors.push({
          creativeId: nr.creativeId,
          fileName: nr.fileName,
          error: `Video still processing on Meta. Wait 30-60s after upload then re-launch. (${nr.errorMsg})`,
        })
        const idx = creatives.findIndex((c: any) => c.id === nr.creativeId)
        if (idx >= 0) creatives.splice(idx, 1)
      }
      if (stillNotReady.length === videosToCheck.length && creatives.length === 0) {
        return NextResponse.json({
          success: false,
          errors,
          totalAds: 0,
          summary: `All ${stillNotReady.length} video(s) still processing. Upload finishes uploading first → Meta processes for ~10-30s → then launch.`,
        }, { status: 400 })
      }
      const ready = readyResults.filter(r => r.ready)
      console.log(`[launch-direct] ${ready.length}/${videosToCheck.length} videos ready (max wait ${Math.max(...readyResults.map(r => r.waitedMs))}ms)`)

      // Save thumbnails asynchronously (defer generation/checks) or retrieve immediately
      ready.forEach((r) => {
        const cr: any = creatives.find((c: any) => c.id === r.creativeId)
        if (!cr) return

        // Retrieve immediately without a blocking poll loop to prevent thread stalls.
        // A background worker or subsequent read will populate if not ready yet.
        getVideoThumbnail(r.videoId, token, { skipProof: tokenOpts.isManual })
          .then(async (thumbUrl) => {
            if (thumbUrl) {
              cr.fb_thumbnail_url = thumbUrl
              await supabase.from("creatives").update({ fb_thumbnail_url: thumbUrl }).eq("id", r.creativeId)
            }
          })
          .catch(err => {
            console.error(`[launch-direct] Deferred thumbnail fetch failed for ${r.videoId}:`, err)
          })
      })
    }

    // ── Multi Placement Ads branch ──────────────────────────────────
    // Each group → ONE ad per ad set, using asset_feed_spec with placement customization rules
    // Maps each media's aspect to the appropriate placement (Feed/Stories/Reels)
    if (multiPlacementAds && Array.isArray(multiPlacementAds.groups) && multiPlacementAds.groups.length > 0) {
      const creativeMap = new Map(creatives.map((c: any) => [c.id, c]))
      const placementMap: Record<string, { publisher_platforms: string[]; positions: { key: string; values: string[] } }> = {
        feed: { publisher_platforms: ["facebook", "instagram"], positions: { key: "facebook_positions", values: ["feed"] } },
        story: { publisher_platforms: ["facebook", "instagram"], positions: { key: "facebook_positions", values: ["story"] } },
        reels: { publisher_platforms: ["facebook", "instagram"], positions: { key: "facebook_positions", values: ["facebook_reels"] } },
        right_column: { publisher_platforms: ["facebook"], positions: { key: "facebook_positions", values: ["right_hand_column"] } },
        marketplace: { publisher_platforms: ["facebook"], positions: { key: "facebook_positions", values: ["marketplace"] } },
        explore: { publisher_platforms: ["instagram"], positions: { key: "instagram_positions", values: ["explore"] } },
      }

      for (const adSetId of adSetIds) {
        for (const grp of multiPlacementAds.groups) {
          const existingIds = grp.creativeIds.filter(isExistingAdCreativeId)
          if (existingIds.length > 0) {
            errors.push(...existingIds.map((creativeId: string) => ({
              adSetId,
              multiGroup: grp.name,
              creativeId,
              fileName: `Existing Ad ${creativeId.slice("existing_".length)}`,
              error: "Existing Ads post reuse is not supported in multi-placement ads",
            })))
            continue
          }

          const imageHashes: string[] = []
          const videos: any[] = []
          const customRules: any[] = []

          for (const cid of grp.creativeIds) {
            const cr: any = creativeMap.get(cid)
            if (!cr) continue
            let assetIdx: number, assetType: "image" | "video"
            if (cr.fb_image_hash) {
              imageHashes.push(cr.fb_image_hash)
              assetIdx = imageHashes.length - 1
              assetType = "image"
            } else if (cr.fb_video_id) {
              if (!isFreshThumbnailUrl(cr.fb_thumbnail_url)) {
                cr.fb_thumbnail_url = (await getVideoThumbnail(cr.fb_video_id, token, { skipProof: tokenOpts.isManual })) || undefined
                if (cr.fb_thumbnail_url) {
                  await supabase.from("creatives").update({ fb_thumbnail_url: cr.fb_thumbnail_url }).eq("id", cr.id)
                }
              }
              videos.push({ video_id: cr.fb_video_id, thumbnail_url: cr.fb_thumbnail_url || undefined })
              assetIdx = videos.length - 1
              assetType = "video"
            } else continue

            // Manual placements override
            const userPlacements: string[] = grp.placements?.[cid] || []
            if (multiPlacementAds.manualPlacements && userPlacements.length > 0) {
              for (const pk of userPlacements) {
                const pmap = placementMap[pk]
                if (!pmap) continue
                customRules.push({
                  customization_spec: {
                    publisher_platforms: pmap.publisher_platforms,
                    [pmap.positions.key]: pmap.positions.values,
                  },
                  ...(assetType === "image" ? { image_label: { name: `img_${assetIdx}` } } : { video_label: { name: `vid_${assetIdx}` } }),
                })
              }
            }
          }

          if (imageHashes.length + videos.length < 2) {
            errors.push({ adSetId, multiGroup: grp.name, error: "Multi-placement group needs ≥2 media" })
            continue
          }

          try {
            const ad = await createAd(adAccountId, token, {
              name: grp.name,
              adset_id: adSetId,
              page_id: pageId,
              title: headline || "",
              body: primaryText || "",
              cta: cta || "LEARN_MORE",
              link_url: webLink,
              status: adStatus,
              branded_content_sponsor_page_id: partnerPageId || undefined,
              partnership_display_mode: partnershipDisplayMode || undefined,
              multi_placement: {
                imageHashes,
                videos,
                customRules,
              },
            }, tokenOpts)
            created.push({ adId: ad.id, adSetId, adSetName: adSetNameMap.get(adSetId) || adSetId, multiGroup: grp.name, mediaCount: imageHashes.length + videos.length })
          } catch (err: any) {
            errors.push({ adSetId, multiGroup: grp.name, error: err.message || "Multi-placement ad failed" })
          }
        }
      }
    } else
    // ── Flexible Ads branch ─────────────────────────────────────────
    // Each Flexible Ad → ONE ad per ad set, using asset_feed_spec to hold all media variants.
    if (Array.isArray(flexibleAds) && flexibleAds.length > 0) {
      const creativeMap = new Map(creatives.map((c: any) => [c.id, c]))
      for (const adSetId of adSetIds) {
        for (const fa of flexibleAds) {
          const existingIds = fa.groups.flatMap((group: any) =>
            group.creativeIds.filter(isExistingAdCreativeId)
          )
          if (existingIds.length > 0) {
            errors.push(...existingIds.map((creativeId: string) => ({
              adSetId,
              flexibleAd: fa.name,
              creativeId,
              fileName: `Existing Ad ${creativeId.slice("existing_".length)}`,
              error: "Existing Ads post reuse is not supported in flexible ads",
            })))
            continue
          }

          const allImageHashes: string[] = []
          const allVideos: { video_id: string; thumbnail_url?: string }[] = []
          const groupAssetIndex: Array<{ image_indices?: number[]; video_indices?: number[] }> = []

          for (const g of fa.groups) {
            const imgIdx: number[] = []
            const vidIdx: number[] = []
            for (const cid of g.creativeIds) {
              const cr: any = creativeMap.get(cid)
              if (!cr) continue
              if (cr.fb_image_hash) {
                allImageHashes.push(cr.fb_image_hash)
                imgIdx.push(allImageHashes.length - 1)
              } else if (cr.fb_video_id) {
                if (!isFreshThumbnailUrl(cr.fb_thumbnail_url)) {
                  cr.fb_thumbnail_url = (await getVideoThumbnail(cr.fb_video_id, token, { skipProof: tokenOpts.isManual })) || undefined
                  if (cr.fb_thumbnail_url) {
                    await supabase.from("creatives").update({ fb_thumbnail_url: cr.fb_thumbnail_url }).eq("id", cr.id)
                  }
                }
                allVideos.push({ video_id: cr.fb_video_id, thumbnail_url: cr.fb_thumbnail_url || undefined })
                vidIdx.push(allVideos.length - 1)
              }
            }
            groupAssetIndex.push({ image_indices: imgIdx, video_indices: vidIdx })
          }

          if (allImageHashes.length + allVideos.length === 0) {
            errors.push({ adSetId, flexibleAd: fa.name, error: "No valid uploaded media in flexible ad" })
            continue
          }

          try {
            const ad = await createAd(adAccountId, token, {
              name: fa.name,
              adset_id: adSetId,
              page_id: pageId,
              title: headline || "",
              body: primaryText || "",
              cta: cta || "LEARN_MORE",
              link_url: webLink,
              status: adStatus,
              branded_content_sponsor_page_id: partnerPageId || undefined,
              partnership_display_mode: partnershipDisplayMode || undefined,
              flexible_asset_feed: {
                image_hashes: allImageHashes,
                videos: allVideos,
                group_asset_indices: groupAssetIndex,
              },
            }, tokenOpts)
            created.push({ adId: ad.id, adSetId, adSetName: adSetNameMap.get(adSetId) || adSetId, flexibleAd: fa.name, groups: fa.groups.length })
          } catch (err: any) {
            errors.push({ adSetId, flexibleAd: fa.name, error: err.message || "Flexible ad failed" })
          }
        }
      }
    } else
    // ── Carousel Ads branch ─────────────────────────────────────────
    // If carouselAds[] provided, each carousel becomes ONE ad with N child cards (per ad set).
    if (Array.isArray(carouselAds) && carouselAds.length > 0) {
      const creativeMap = new Map(creatives.map((c: any) => [c.id, c]))
      for (const adSetId of adSetIds) {
        for (const carousel of carouselAds) {
          const existingIds = carousel.cards
            .map((card: any) => card.creativeId)
            .filter(isExistingAdCreativeId)
          if (existingIds.length > 0) {
            errors.push(...existingIds.map((creativeId: string) => ({
              adSetId,
              carousel: carousel.name,
              creativeId,
              fileName: `Existing Ad ${creativeId.slice("existing_".length)}`,
              error: "Existing Ads post reuse is not supported in carousel ads",
            })))
            continue
          }

          const childCards: any[] = []
          for (const card of carousel.cards) {
            const cr: any = creativeMap.get(card.creativeId)
            if (!cr || (!cr.fb_image_hash && !cr.fb_video_id)) continue
            childCards.push({
              image_hash: cr.fb_image_hash || undefined,
              video_id: cr.fb_video_id || undefined,
              name: card.headline || headline || "",
              description: card.description || "",
              link: card.linkUrl || webLink,
              call_to_action: { type: card.cta || cta || "LEARN_MORE", value: { link: card.linkUrl || webLink } },
            })
          }
          if (childCards.length < 2) {
            errors.push({ adSetId, carousel: carousel.name, error: "Carousel needs at least 2 valid cards" })
            continue
          }
          try {
            const ad = await createAd(adAccountId, token, {
              name: carousel.name,
              adset_id: adSetId,
              page_id: pageId,
              image_hash: undefined,
              video_id: undefined,
              title: headline || "",
              body: primaryText || "",
              cta: cta || "LEARN_MORE",
              link_url: webLink,
              status: adStatus,
              branded_content_sponsor_page_id: partnerPageId || undefined,
              partnership_display_mode: partnershipDisplayMode || undefined,
              carousel_cards: childCards,
              carousel_show_collection_tiles: !!carousel.showAsCollectionTiles,
              carousel_show_single_media: !!carousel.showAsSingleMedia,
            }, tokenOpts)
            created.push({ adId: ad.id, adSetId, adSetName: adSetNameMap.get(adSetId) || adSetId, carousel: carousel.name, cards: childCards.length })
          } catch (err: any) {
            errors.push({ adSetId, carousel: carousel.name, error: err.message || "Carousel ad failed" })
          }
        }
      }
      // Skip the standard per-creative loop when carousels are used
    } else {
    // ── Standard per-creative loop ──────────────────────────────────
    // Preflight: MTO ads (standard, DEGREES_OF_FREEDOM) are rejected by legacy Dynamic Creative
    // ad sets (1-ad cap). Detect them up front and fail with an actionable per-adset error
    // instead of N cryptic Meta errors.
    const reqHasVariations =
      (headlineVariations || []).some((s: string) => s?.trim()) ||
      (primaryTextVariations || []).some((s: string) => s?.trim()) ||
      (descriptionVariations || []).some((s: string) => s?.trim())
    const legacyDynamicAdsets = reqHasVariations
      ? await getDynamicCreativeAdSets(adSetIds as string[], token, { skipProof: tokenOpts.isManual })
      : new Set<string>()

    // oneAdPerAdset (Special Ad Testing): N adsets × M creatives must produce N*M adsets,
    // each with exactly 1 ad — not N ads round-robined across the original adsets. The first
    // creative reuses each original adset; creatives 2..M get a fresh adset via copyAdSet
    // (deep_copy: false — structure only, no ads), which needs the source adset's campaign_id.
    const adSetCampaigns = launchSettings?.oneAdPerAdset
      ? await getAdSetCampaignsAndNames(adSetIds as string[], token, { skipProof: tokenOpts.isManual })
      : new Map<string, { campaign_id: string; name: string }>()

    for (const [adSetIndex, adSetId] of (adSetIds as string[]).entries()) {
      if (legacyDynamicAdsets.has(adSetId)) {
        errors.push({
          adSetId,
          error: `Ad set "${adSetNameMap.get(adSetId) || adSetId}" is a legacy Dynamic Creative ad set (capped at 1 ad) and can't take ads with multiple text options. Pick or create a standard ad set instead.`,
        })
        continue
      }
      // ponytail: optimize the observed standard 10-ad publish; grouped flexible/carousel specs stay serial until they show the same latency.
      const outcomes = await mapWithConcurrency(creatives, 3, async (creative, creativeIndex) => {
        const created: any[] = []
        const errors: any[] = []
        if (!creative.is_existing_ad && !creative.fb_image_hash && !creative.fb_video_id) {
          errors.push({
            adSetId,
            creativeId: creative.id,
            fileName: creative.file_name,
            error: "Creative not yet uploaded to Meta. Open the Ads Manager page and upload it first.",
          })
          return { created, errors }
        }

        // Resolve the adset this ad actually lands in. oneAdPerAdset + not the first
        // creative for this adset → duplicate the original adset instead of reusing it.
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

        const adName = (rowAdName?.trim()) || creative.file_name.replace(/\.[^/.]+$/, "")
        const sourceId = adSourceIds?.[creative.id] || ""

        // Existing Ads always reuse their validated source post, independently of
        // the global manual-paste source mode. They have no creatives DB row.
        if (creative.is_existing_ad) {
          try {
            const ad = await createAd(adAccountId, token, {
              name: adName,
              adset_id: targetAdSetId,
              page_id: pageId,
              object_story_id: creative.object_story_id,
              title: "", body: "", cta: cta || "LEARN_MORE", link_url: webLink || "",
              status: adStatus,
            }, tokenOpts)
            created.push({
              adId: ad.id,
              adSetId: targetAdSetId,
              adSetName: adSetNameMap.get(targetAdSetId) || targetAdSetId,
              creativeId: creative.id,
              fileName: creative.file_name,
              thumbnailUrl: null,
              mediaType: "existing_ad",
              mode: "existing_ad_post",
            })
          } catch (err: any) {
            errors.push({ adSetId: targetAdSetId, creativeId: creative.id, fileName: creative.file_name, error: err.message || "Failed to reuse existing ad post" })
          }
          return { created, errors }
        }

        // ── Post ID mode ──────────────────────────────────────────────────────
        if (adSourceMode === "post_id" && sourceId) {
          try {
            const ad = await createAd(adAccountId, token, {
              name: adName,
              adset_id: targetAdSetId,
              page_id: pageId,
              object_story_id: sourceId,
              title: "", body: "", cta: cta || "LEARN_MORE", link_url: webLink || "",
              status: adStatus,
            }, tokenOpts)
            await supabase.from("creatives").update({ fb_ad_id: ad.id }).eq("id", creative.id)
            created.push({ adId: ad.id, adSetId: targetAdSetId, adSetName: adSetNameMap.get(targetAdSetId) || targetAdSetId, creativeId: creative.id, fileName: creative.file_name, thumbnailUrl: creative.fb_thumbnail_url || creative.fb_image_url || null, mediaType: creative.media_type || "image", mode: "post_id" })
          } catch (err: any) {
            errors.push({ adSetId: targetAdSetId, creativeId: creative.id, fileName: creative.file_name, error: err.message || "Failed (post_id mode)" })
          }
          return { created, errors }
        }

        // ── Creative ID mode ──────────────────────────────────────────────────
        if (adSourceMode === "creative_id" && sourceId) {
          try {
            const ad = await createAd(adAccountId, token, {
              name: adName,
              adset_id: targetAdSetId,
              page_id: pageId,
              reuse_creative_id: sourceId,
              title: "", body: "", cta: cta || "LEARN_MORE", link_url: webLink || "",
              status: adStatus,
            }, tokenOpts)
            await supabase.from("creatives").update({ fb_ad_id: ad.id }).eq("id", creative.id)
            created.push({ adId: ad.id, adSetId: targetAdSetId, adSetName: adSetNameMap.get(targetAdSetId) || targetAdSetId, creativeId: creative.id, fileName: creative.file_name, thumbnailUrl: creative.fb_thumbnail_url || creative.fb_image_url || null, mediaType: creative.media_type || "image", mode: "creative_id" })
          } catch (err: any) {
            errors.push({ adSetId: targetAdSetId, creativeId: creative.id, fileName: creative.file_name, error: err.message || "Failed (creative_id mode)" })
          }
          return { created, errors }
        }

        // ── New ad mode (default) ─────────────────────────────────────────────
        // Meta requires a current image_url in video_data (subcode 1443226).
        let thumbnailUrl: string | undefined
        if (creative.fb_video_id) {
          if (isFreshThumbnailUrl(creative.fb_thumbnail_url)) {
            thumbnailUrl = creative.fb_thumbnail_url
          } else {
            thumbnailUrl = (await getVideoThumbnail(creative.fb_video_id, token, { skipProof: tokenOpts.isManual })) || undefined
            if (thumbnailUrl) {
              await supabase.from("creatives").update({ fb_thumbnail_url: thumbnailUrl }).eq("id", creative.id)
            }
          }
        }

        try {
          const rowTitle = (headline || creative.headline || "").trim()
          const rowBody  = (primaryText || creative.primary_text || "").trim()
          const rowDesc  = (description || (creative as any).description || "").trim()

          // Multiple Text Options (MTO): merge base text with variations and send them all on ONE ad
          // via asset_feed_spec with optimization_type DEGREES_OF_FREEDOM (handled in createAd).
          // Works on standard ad sets — no is_dynamic_creative, no 1-ad limit, N ads per ad set OK.
          const allBodies = Array.from(new Set([rowBody,  ...(primaryTextVariations  || [])].map((s: string) => s.trim()).filter(Boolean)))
          const allTitles = Array.from(new Set([rowTitle, ...(headlineVariations || [])].map((s: string) => s.trim()).filter(Boolean)))
          const allDescs  = Array.from(new Set([rowDesc,  ...(descriptionVariations || [])].map((s: string) => s.trim()).filter(Boolean)))
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
            sitelinks: sitelinks && sitelinks.length > 0 ? sitelinks : undefined,
            text_variations: hasVariations
              ? { bodies: allBodies.length ? allBodies : [rowBody], titles: allTitles.length ? allTitles : [rowTitle], descriptions: allDescs }
              : undefined,
          }, tokenOpts)

          await supabase.from("creatives").update({ fb_ad_id: ad.id }).eq("id", creative.id)

          created.push({
            adId: ad.id,
            adSetId: targetAdSetId,
            adSetName: adSetNameMap.get(targetAdSetId) || targetAdSetId,
            creativeId: creative.id,
            fileName: creative.file_name,
            thumbnailUrl: thumbnailUrl || creative.fb_thumbnail_url || creative.fb_image_url || null,
            mediaType: creative.media_type || "image",
          })
        } catch (err: any) {
          errors.push({
            adSetId: targetAdSetId,
            creativeId: creative.id,
            fileName: creative.file_name,
            error: err.message || "Failed to create ad",
          })
        }
        return { created, errors }
      })
      created.push(...outcomes.flatMap(outcome => outcome.created))
      errors.push(...outcomes.flatMap(outcome => outcome.errors))
    }
    } // end else (standard branch)

    const durationMs = Date.now() - startTime
    const batchStatus = errors.length === 0 ? "success" : created.length > 0 ? "partial" : "failed"

    // Collect creative thumbnails for history display
    const creativeThumbs = creatives
      .map((c: any) => c.fb_thumbnail_url || c.fb_image_url || c.file_url || null)
      .filter(Boolean) as string[]

    const userName = ctx.user.full_name || ctx.user.email?.split("@")[0] || "Unknown"

    const finalAdSetIds = Array.from(new Set(created.map((c: any) => c.adSetId)))
    const finalAdSetNames = finalAdSetIds.map(id => adSetNameMap.get(id) || id)

    const adminDb = createAdminClient()
    const { data: batchRecord, error: batchErr } = await adminDb.from("launch_batches").insert({
      org_id: ctx.orgId,
      user_id: ctx.user.id,
      user_name: userName,
      ad_account_id: adAccountId,
      ad_account_name: adAccountName || adAccountId,
      adset_ids: finalAdSetIds.length > 0 ? finalAdSetIds : adSetIds,
      adset_names: finalAdSetNames.length > 0 ? finalAdSetNames : (adSetNames || adSetIds),
      creative_ids: creativeIds,
      creative_thumbs: creativeThumbs,
      primary_text: primaryText || null,
      headline: headline || null,
      cta: cta || null,
      web_link: webLink || null,
      page_id: pageId || null,
      status: batchStatus,
      total_ads: created.length,
      failed_ads: errors.length,
      duration_ms: durationMs,
      errors: errors,
      created_ads: created,
    }).select("id").single()
    if (batchErr) {
      console.error("[launch-direct] Failed to save launch batch:", batchErr)
    }
    const batchId: string | null = batchRecord?.id || null
    const auditError = batchErr
      ? `Ads were created in Meta, but Launch History could not be saved: ${batchErr.message}`
      : null

    let scheduleError: string | null = null

    // Save scheduled activation record so cron job can activate at the right time
    if (scheduledStart && created.length > 0) {
      const adIds = created
        .map((c: any) => c.adId)
        .filter(Boolean) as string[]
      if (adIds.length > 0) {
        const adminDb = createAdminClient()
        const { error: activationError } = await adminDb.from("scheduled_activations").insert({
          org_id: ctx.orgId,
          ad_account_id: adAccountId,
          ad_ids: adIds,
          scheduled_at: scheduledStart,
          end_time: scheduledEnd || null,
          status: "pending",
        })
        if (activationError) {
          scheduleError = `Ads were created PAUSED, but scheduling failed: ${activationError.message}`
          console.error("[launch-direct] Failed to save scheduled activation:", activationError)
          if (batchId) {
            await adminDb.from("launch_batches").update({
              status: "partial",
              errors: [...errors, { type: "schedule", error: scheduleError }],
            }).eq("id", batchId)
          }
        }
      }
    }

    void notifyLaunchOutcome({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: userName,
      batchId,
      adAccountName: adAccountName || adAccountId,
      targetName: finalAdSetNames[0] || null,
      created: created.length,
      failed: errors.length + Number(Boolean(scheduleError)),
      source: "launch-direct",
    })

    if (created.length > 0) {
      await invalidateMetaReadCacheAfterWrite({
        orgId: ctx.orgId,
        adAccountId,
        objectIds: created.map((item: any) => item.adId).filter(Boolean),
      })
    }

    return NextResponse.json({
      success: true,
      batchId,
      auditError,
      created,
      errors,
      totalAds: created.length,
      durationMs,
      scheduled: scheduledStart && !scheduleError ? { at: scheduledStart, end: scheduledEnd || null } : null,
      scheduleError,
      summary: scheduledStart
        ? `${created.length} ads scheduled for ${new Date(scheduledStart).toLocaleString()}${errors.length ? `, ${errors.length} failed` : ""}`
        : `${created.length} ads created${errors.length ? `, ${errors.length} failed` : ""}`,
    })
  } catch (err: any) {
    console.error("[launch-direct] error:", err)
    return NextResponse.json({ error: err.message || "Launch failed" }, { status: 500 })
  }
}
