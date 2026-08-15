import { NextRequest, NextResponse } from "next/server"
import {
  getAuthContext,
  getConnectionForAdAccount,
  isManual,
  MissingViaError,
  requireRole,
} from "@/lib/auth"
import {
  createAd,
  createAdSet,
  createCampaign,
  getResourceAccountId,
  getVideoThumbnail,
  updateNode,
} from "@/lib/facebook"
import { getOrgAdAccountInfo, normalizeAdAccountId } from "@/app/api/facebook/_utils"
import { invalidateMetaReadCacheAfterWrite } from "@/app/api/facebook/_db-cache"
import { createAdminClient } from "@/lib/supabase/admin"

export type Level = "campaign" | "adset" | "ad"

type MaterializeNode = {
  nodeId: string
  level: Level
  metaId?: string
  /** Existing hierarchy context: resolve this parent without updating it. */
  contextOnly?: boolean
  parentNodeId?: string
  name?: string
  objective?: string
  specialAdCategories?: string[]
  dailyBudget?: string
  lifetimeBudget?: string
  bidStrategy?: string
  bidAmount?: string
  bidConstraints?: { roas_average_floor: number }
  targeting?: unknown
  optimizationGoal?: string
  billingEvent?: string
  startTime?: string
  endTime?: string
  destinationType?: string
  promotedObject?: Record<string, unknown>
  attributionSpec?: unknown[]
  dsaBeneficiary?: string
  dsaPayor?: string
  pageId?: string
  imageHash?: string
  videoId?: string
  thumbnailUrl?: string
  title?: string
  body?: string
  description?: string
  cta?: string
  linkUrl?: string
  primaryTextVariations?: string[]
  headlineVariations?: string[]
  descriptionVariations?: string[]
  urlParameters?: string
  creativeId?: string
  creativeThumb?: string
}

type MaterializeRequest = {
  adAccountId: string
  nodes: MaterializeNode[]
  batchId?: string
}

type MaterializeResult = {
  nodeId: string
  level: Level
  metaId?: string
  status: "materialized" | "updated" | "failed" | "skipped"
  message?: string
}

const ORDER: Record<Level, number> = { campaign: 0, adset: 1, ad: 2 }

function moneyFromMinor(value?: string) {
  if (value == null || value === "") return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed / 100 : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function invalidRequest(nodes: MaterializeNode[]) {
  const nodeIds = new Set(nodes.map(node => node.nodeId))
  if (nodeIds.size !== nodes.length) return "Each workspace node needs a unique nodeId."

  for (const node of nodes) {
    if (!node?.nodeId || !Object.hasOwn(ORDER, node.level)) return "Invalid workspace node."
    if (node.level === "campaign" && node.parentNodeId) return "Campaign nodes cannot have a parent."
    // contextOnly nodes exist only so a sibling's parentNodeId can resolve to them —
    // they are not written to, so they need no resolvable parent of their own.
    if (node.contextOnly) continue
    if (node.level !== "campaign" && (!node.parentNodeId || !nodeIds.has(node.parentNodeId))) {
      return `${node.level} nodes require a workspace parent.`
    }
  }

  return null
}

async function verifyExistingNodes(
  nodes: MaterializeNode[],
  adAccountId: string,
  connection: { access_token: string },
  tokenOpts: { isManual: boolean },
) {
  const requestedAccountId = normalizeAdAccountId(adAccountId)
  for (const node of nodes) {
    if (!node.metaId) continue
    const resourceAccountId = await getResourceAccountId(node.metaId, connection.access_token, tokenOpts)
    if (normalizeAdAccountId(resourceAccountId || "") !== requestedAccountId) {
      throw new Error(`Workspace node ${node.nodeId} does not belong to the requested ad account.`)
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const denied = requireRole(ctx)
    if (denied) return denied

    const body = await request.json() as Partial<MaterializeRequest>
    const adAccountId = asString(body.adAccountId) || ""
    const nodes = Array.isArray(body.nodes) ? body.nodes as MaterializeNode[] : []
    const batchId = asString(body.batchId)
    if (!adAccountId) return NextResponse.json({ error: "adAccountId is required" }, { status: 400 })
    if (!nodes.length) return NextResponse.json({ error: "At least one workspace node is required" }, { status: 400 })

    const requestError = invalidRequest(nodes)
    if (requestError) return NextResponse.json({ error: requestError }, { status: 400 })

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

    const account = await getOrgAdAccountInfo(ctx.orgId, adAccountId, connection.access_token)
    if (!account) return NextResponse.json({ error: "Ad account does not belong to this organization" }, { status: 403 })

    const tokenOpts = { isManual: isManual(connection) }
    try {
      await verifyExistingNodes(nodes, adAccountId, connection, tokenOpts)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to validate existing workspace nodes"
      return NextResponse.json({ error: message }, { status: 403 })
    }

    const ordered = [...nodes].sort((a, b) => ORDER[a.level] - ORDER[b.level])
    const results: MaterializeResult[] = []
    const resultsByNodeId = new Map<string | undefined, MaterializeResult>()
    const resolvedMetaIds = new Map<string, string>()
    const createdAds: Array<{ id: string; node: MaterializeNode }> = []
    const writtenMetaIds: string[] = []

    for (const node of ordered) {
      const parentResult = resultsByNodeId.get(node.parentNodeId)
      if (node.parentNodeId && (!parentResult || !["materialized", "updated"].includes(parentResult.status))) {
        const skipped: MaterializeResult = {
          nodeId: node.nodeId,
          level: node.level,
          status: "skipped",
          message: "A parent workspace node failed, so this dependent node was not saved.",
        }
        results.push(skipped)
        resultsByNodeId.set(node.nodeId, skipped)
        continue
      }

      try {
        const parentMetaId = node.parentNodeId ? resolvedMetaIds.get(node.parentNodeId) : undefined
        let metaId: string
        let status: MaterializeResult["status"]

        if (node.metaId) {
          if (!node.contextOnly) {
            await updateNode(node.metaId, connection.access_token, {
              name: node.name,
              status: "PAUSED",
              special_ad_categories: node.level === "campaign" ? node.specialAdCategories : undefined,
              daily_budget: moneyFromMinor(node.dailyBudget),
              lifetime_budget: moneyFromMinor(node.lifetimeBudget),
              start_time: node.startTime,
              end_time: node.endTime,
              optimization_goal: node.optimizationGoal,
              bid_strategy: node.bidStrategy,
              bid_amount: node.level === "adset" ? moneyFromMinor(node.bidAmount) : undefined,
              bid_constraints: node.level === "adset" ? node.bidConstraints : undefined,
              attribution_spec: node.attributionSpec,
              promoted_object: node.promotedObject,
              targeting: node.targeting,
            }, tokenOpts)
          }
          metaId = node.metaId
          status = "updated"
        } else if (node.level === "campaign") {
          if (!node.name || !node.objective) throw new Error("Campaign name and objective are required.")
          const created = await createCampaign(adAccountId, connection.access_token, {
            name: node.name,
            objective: node.objective,
            special_ad_categories: node.specialAdCategories,
            status: "PAUSED",
            daily_budget: moneyFromMinor(node.dailyBudget),
            bid_strategy: node.bidStrategy,
            promoted_object: node.promotedObject,
          }, tokenOpts)
          metaId = created.id
          status = "materialized"
        } else if (node.level === "adset") {
          if (!parentMetaId) throw new Error("Ad set parent campaign was not materialized.")
          if (!node.name || !node.optimizationGoal || !node.billingEvent) {
            throw new Error("Ad set name, performance goal, and billing event are required.")
          }
          const created = await createAdSet(adAccountId, connection.access_token, {
            name: node.name,
            campaign_id: parentMetaId,
            targeting: node.targeting || {},
            optimization_goal: node.optimizationGoal,
            billing_event: node.billingEvent,
            bid_amount: node.bidAmount,
            bid_strategy: node.bidStrategy,
            bid_constraints: node.bidConstraints,
            daily_budget: node.dailyBudget,
            lifetime_budget: node.lifetimeBudget,
            status: "PAUSED",
            start_time: node.startTime,
            destination_type: node.destinationType,
            promoted_object: node.promotedObject,
            attribution_spec: node.attributionSpec,
            dsa_beneficiary: node.dsaBeneficiary,
            dsa_payor: node.dsaPayor,
          }, tokenOpts)
          metaId = created.id
          status = "materialized"
        } else {
          if (!parentMetaId) throw new Error("Ad parent ad set was not materialized.")
          if (!node.name || !node.pageId || !node.title || !node.body || !node.linkUrl || (!node.imageHash && !node.videoId)) {
            throw new Error("Ad name, Page, media, primary text, headline, and destination URL are required.")
          }
          const thumbnailUrl = node.videoId
            ? await getVideoThumbnail(node.videoId, connection.access_token, { skipProof: tokenOpts.isManual })
            : node.thumbnailUrl
          if (node.videoId && !thumbnailUrl) throw new Error("A fresh Meta video thumbnail could not be resolved.")
          const created = await createAd(adAccountId, connection.access_token, {
            name: node.name,
            adset_id: parentMetaId,
            page_id: node.pageId,
            image_hash: node.imageHash,
            video_id: node.videoId,
            thumbnail_url: thumbnailUrl || undefined,
            title: node.title,
            body: node.body,
            description: node.description,
            cta: node.cta || "LEARN_MORE",
            link_url: node.linkUrl,
            status: "PAUSED",
            text_variations: {
              bodies: node.primaryTextVariations || [],
              titles: node.headlineVariations || [],
              descriptions: node.descriptionVariations || [],
            },
            omit_degrees_of_freedom_spec: true,
            url_tags: node.urlParameters,
          }, tokenOpts)
          metaId = created.id
          status = "materialized"
          createdAds.push({ id: metaId, node })
        }

        const result: MaterializeResult = { nodeId: node.nodeId, level: node.level, metaId, status }
        results.push(result)
        resultsByNodeId.set(node.nodeId, result)
        resolvedMetaIds.set(node.nodeId, metaId)
        writtenMetaIds.push(metaId)
      } catch (error) {
        const result: MaterializeResult = {
          nodeId: node.nodeId,
          level: node.level,
          status: "failed",
          message: error instanceof Error ? error.message : "Meta materialization failed",
        }
        results.push(result)
        resultsByNodeId.set(node.nodeId, result)
      }
    }

    let persistedBatchId = batchId
    let auditError: string | null = null
    const adminDb = createAdminClient()

    if (createdAds.length > 0) {
      const adsetIds = Array.from(new Set(createdAds.map(({ node }) => node.parentNodeId).map(id => id ? resolvedMetaIds.get(id) : undefined).filter((id): id is string => Boolean(id))))
      const adsetNames = createdAds.map(({ node }) => node.parentNodeId ? nodes.find(candidate => candidate.nodeId === node.parentNodeId)?.name : undefined).filter((name): name is string => Boolean(name))
      const creativeIds = createdAds.map(({ node }) => node.creativeId).filter((id): id is string => Boolean(id))
      const creativeThumbs = createdAds.map(({ node }) => node.creativeThumb).filter((url): url is string => Boolean(url))
      const firstAd = createdAds[0]?.node
      const errors = results.filter(result => result.status === "failed").map(result => ({ nodeId: result.nodeId, error: result.message }))
      const batchValues = {
        org_id: ctx.orgId,
        user_id: ctx.user.id,
        user_name: ctx.user.full_name || ctx.user.email?.split("@")[0] || "Unknown",
        ad_account_id: adAccountId,
        ad_account_name: adAccountId,
        adset_ids: adsetIds,
        adset_names: Array.from(new Set(adsetNames)),
        creative_ids: creativeIds,
        creative_thumbs: creativeThumbs,
        primary_text: firstAd?.body || null,
        headline: firstAd?.title || null,
        cta: firstAd?.cta || null,
        web_link: firstAd?.linkUrl || null,
        page_id: firstAd?.pageId || null,
        status: "partial",
        total_ads: createdAds.length,
        failed_ads: errors.length,
        errors,
      }

      if (batchId) {
        const { error } = await adminDb
          .from("launch_batches").update(batchValues)
          .eq("id", batchId)
          .eq("user_id", ctx.user.id)
        if (error) auditError = `Meta objects were saved, but Launch History could not be updated: ${error.message}`
      } else {
        const { data, error } = await adminDb
          .from("launch_batches").insert(batchValues).select("id").single()
        if (error) {
          auditError = `Meta objects were saved, but Launch History could not be created: ${error.message}`
        } else {
          persistedBatchId = data.id
        }
      }
    }

    if (writtenMetaIds.length > 0) {
      await invalidateMetaReadCacheAfterWrite({ orgId: ctx.orgId, adAccountId, objectIds: writtenMetaIds })
    }

    return NextResponse.json({
      success: !auditError && results.every(result => result.status === "materialized" || result.status === "updated"),
      batchId: persistedBatchId,
      auditError,
      results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to materialize workspace"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
