import { NextRequest, NextResponse } from "next/server"
import {
  getAuthContext,
  getConnectionForAdAccount,
  isManual,
  MissingViaError,
  requireRole,
} from "@/lib/auth"
import { getCampaignObjective, getNodeTargeting, replaceAdCreative, updateNode } from "@/lib/facebook"
import { odaxRejectionForAdSet } from "@/lib/workspace-odax-guard"
import { mergeEditorTargeting } from "@/lib/targeting-merge"
import { createAdminClient } from "@/lib/supabase/admin"
import { invalidateMetaReadCacheAfterWrite } from "@/app/api/facebook/_db-cache"

type Level = "campaign" | "adset" | "ad"

type WorkspaceChange = {
  level: Level
  node: {
    id: string
    name?: string
    status?: string
    special_ad_categories?: string[]
    campaign_id?: string
    adset_id?: string
    daily_budget?: string
    lifetime_budget?: string
    start_time?: string
    stop_time?: string
    end_time?: string
    optimization_goal?: string
    /** Meta's conversion location for this ad set. Needed to resolve the ODAX row (TD-42). */
    destination_type?: string
    bid_strategy?: string
    bid_amount?: string
    bid_constraints?: { roas_average_floor?: number }
    attribution_spec?: unknown
    promoted_object?: unknown
    targeting?: unknown
    advertiser?: { type: "page" | "business"; id: string } | null
    payer?: { type: "page" | "business"; id: string } | null
    creative_edit?: boolean
    portal_creative_id?: string
    page_id?: string
    image_hash?: string
    video_id?: string
    thumb_url?: string
    primaryText?: string
    headline?: string
    description?: string
    link?: string
    cta?: string
    primary_text_variations?: string[]
    headline_variations?: string[]
    description_variations?: string[]
    url_parameters?: string
  }
}

type PublishResult = {
  id: string
  level: Level
  status: "published" | "failed" | "skipped"
  message?: string
}

const ORDER: Record<Level, number> = { campaign: 0, adset: 1, ad: 2 }

function moneyFromMinor(value?: string) {
  if (value == null || value === "") return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed / 100 : undefined
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const denied = requireRole(ctx)
    if (denied) return denied

    const body = await request.json()
    const adAccountId = typeof body.adAccountId === "string" ? body.adAccountId : ""
    const changes = Array.isArray(body.changes) ? body.changes as WorkspaceChange[] : []
    if (!adAccountId) return NextResponse.json({ error: "adAccountId is required" }, { status: 400 })
    if (!changes.length) return NextResponse.json({ error: "No changes to publish" }, { status: 400 })
    if (changes.some(change => !change?.node?.id || !ORDER.hasOwnProperty(change.level))) {
      return NextResponse.json({ error: "Invalid workspace change" }, { status: 400 })
    }

    let connection
    try {
      connection = await getConnectionForAdAccount(ctx.orgId, adAccountId, "write")
    } catch (error) {
      if (error instanceof MissingViaError) {
        return NextResponse.json({ error: error.message, code: "MISSING_LAUNCH_VIA" }, { status: 400 })
      }
      throw error
    }
    if (!connection) return NextResponse.json({ error: "No Facebook write connection found" }, { status: 401 })

    const ordered = [...changes].sort((a, b) => ORDER[a.level] - ORDER[b.level])
    const failed = new Set<string>()
    const results: PublishResult[] = []

    // One objective read per campaign per request, not per ad set — a bulk edit of 10 ad sets in
    // one campaign is a hot path (TD-42 impact trace, plane 6 · rate limiting).
    const objectiveByCampaign = new Map<string, Promise<string | undefined>>()
    const campaignObjective = (campaignId: string) => {
      const cached = objectiveByCampaign.get(campaignId)
      if (cached) return cached
      const pending = getCampaignObjective(campaignId, connection.access_token, {
        isManual: isManual(connection),
      })
      objectiveByCampaign.set(campaignId, pending)
      return pending
    }

    for (const change of ordered) {
      const parentFailed = change.level === "adset"
        ? Boolean(change.node.campaign_id && failed.has(change.node.campaign_id))
        : change.level === "ad"
          ? Boolean(
              (change.node.adset_id && failed.has(change.node.adset_id))
              || (change.node.campaign_id && failed.has(change.node.campaign_id))
            )
          : false

      if (parentFailed) {
        results.push({
          id: change.node.id,
          level: change.level,
          status: "skipped",
          message: "A parent object failed, so this dependent change was not published.",
        })
        continue
      }

      try {
        // TD-42: the editor offered every performance goal regardless of objective, so an edit
        // could carry a combination Meta refuses. Refuse it here, before the write, with a message
        // that names what would have worked. The guard degrades open on every unknown — a false
        // rejection would block real edits for everyone at once, and there are no feature flags.
        if (change.level === "adset" && change.node.optimization_goal && change.node.campaign_id) {
          const rejection = odaxRejectionForAdSet({
            optimizationGoal: change.node.optimization_goal,
            objective: await campaignObjective(change.node.campaign_id),
            destinationType: change.node.destination_type,
          })
          if (rejection) throw new Error(rejection)
        }

        if (change.level === "ad" && change.node.creative_edit) {
          let imageHash = change.node.image_hash
          let videoId = change.node.video_id
          let thumbnailUrl = change.node.thumb_url
          if (change.node.portal_creative_id) {
            const supabase = createAdminClient()
            const { data: assignment } = await supabase
              .from("portal_media_assignments")
              .select("creative_id")
              .eq("org_id", ctx.orgId)
              .eq("ad_account_id", adAccountId)
              .eq("creative_id", change.node.portal_creative_id)
              .maybeSingle()
            if (!assignment) throw new Error("Selected media is not an approved Creative Portal assignment for this ad account.")

            const { data: creative } = await supabase
              .from("creatives")
              .select("fb_image_hash, fb_video_id, fb_thumbnail_url, file_url")
              .eq("org_id", ctx.orgId)
              .eq("id", change.node.portal_creative_id)
              .maybeSingle()
            if (!creative?.fb_image_hash && !creative?.fb_video_id) {
              throw new Error("Selected Creative Portal media is not ready in Meta yet.")
            }
            imageHash = creative.fb_image_hash || undefined
            videoId = creative.fb_video_id || undefined
            thumbnailUrl = creative.fb_thumbnail_url || creative.file_url || undefined
          }
          if (!imageHash && !videoId) throw new Error("The existing or selected media is not reusable in Meta.")
          if (!change.node.page_id || !change.node.link || !change.node.primaryText || !change.node.headline) {
            throw new Error("Page, destination URL, primary text, and headline are required.")
          }
          await replaceAdCreative(adAccountId, change.node.id, connection.access_token, {
            name: change.node.name || "Ad",
            status: change.node.status,
            page_id: change.node.page_id,
            image_hash: imageHash,
            video_id: videoId,
            thumbnail_url: thumbnailUrl,
            body: change.node.primaryText,
            title: change.node.headline,
            description: change.node.description,
            cta: change.node.cta || "LEARN_MORE",
            link_url: change.node.link,
            text_variations: {
              bodies: change.node.primary_text_variations || [],
              titles: change.node.headline_variations || [],
              descriptions: change.node.description_variations || [],
            },
            omit_degrees_of_freedom_spec: true,
            url_tags: change.node.url_parameters,
          }, { isManual: isManual(connection) })
          results.push({ id: change.node.id, level: change.level, status: "published" })
          continue
        }

        // TD-37: Meta replaces `targeting` wholesale, but the editor draft is hydrated from a
        // partial read. Never forward the draft as-is — re-read what Meta has and overlay only
        // the keys the editor owns, then send nothing at all when the result is unchanged
        // (a rename must not rewrite targeting).
        let targetingToSend: unknown = undefined
        if (change.level === "adset" && change.node.targeting !== undefined) {
          const remoteTargeting = await getNodeTargeting(
            change.node.id,
            connection.access_token,
            { isManual: isManual(connection) }
          )
          const merged = mergeEditorTargeting(remoteTargeting, change.node.targeting)
          if (merged.changed) targetingToSend = merged.targeting
        }

        await updateNode(change.node.id, connection.access_token, {
          name: change.node.name,
          status: change.node.status,
          special_ad_categories: change.level === "campaign" ? change.node.special_ad_categories : undefined,
          daily_budget: moneyFromMinor(change.node.daily_budget),
          lifetime_budget: moneyFromMinor(change.node.lifetime_budget),
          start_time: change.node.start_time,
          end_time: change.level === "campaign" ? change.node.stop_time : change.node.end_time,
          optimization_goal: change.node.optimization_goal,
          bid_strategy: change.node.bid_strategy,
          // bid_amount and bid_constraints are ad-set-only fields in Meta's model — a campaign takes
          // bid_strategy alone. ROAS never travels with a bid_amount.
          bid_amount:
            change.level === "adset" && change.node.bid_strategy !== "LOWEST_COST_WITH_MIN_ROAS"
              ? moneyFromMinor(change.node.bid_amount)
              : undefined,
          bid_constraints: change.level === "adset" ? change.node.bid_constraints : undefined,
          attribution_spec: change.node.attribution_spec,
          promoted_object: change.node.promoted_object,
          targeting: targetingToSend,
          advertiser: change.node.advertiser,
          payer: change.node.payer,
        }, { isManual: isManual(connection) })

        results.push({ id: change.node.id, level: change.level, status: "published" })
      } catch (error) {
        failed.add(change.node.id)
        results.push({
          id: change.node.id,
          level: change.level,
          status: "failed",
          message: error instanceof Error ? error.message : "Meta update failed",
        })
      }
    }

    const publishedIds = results.filter(result => result.status === "published").map(result => result.id)
    if (publishedIds.length > 0) {
      await invalidateMetaReadCacheAfterWrite({ orgId: ctx.orgId, adAccountId, objectIds: publishedIds })
    }

    return NextResponse.json({
      success: results.every(result => result.status === "published"),
      results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to publish workspace changes"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
