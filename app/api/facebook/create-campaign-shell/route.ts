import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, getConnectionForAdAccount, isManual, MissingViaError, requireRole } from "@/lib/auth"
import { isBidStrategy } from "@/lib/create-campaign-bidding"
import { createCampaign } from "@/lib/facebook"
import { isCampaignObjective } from "@/lib/odax-matrix"
import { getOrgAdAccountInfo } from "../_utils"
import { invalidateMetaReadCacheAfterWrite } from "../_db-cache"

const SPECIAL_AD_CATEGORIES = new Set([
  "CREDIT",
  "EMPLOYMENT",
  "HOUSING",
  "ISSUES_ELECTIONS_POLITICS",
])

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
])

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function fail(status: number, message: string): never {
  throw new HttpError(status, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function campaignBudgetForHelper(value: unknown, currency: string): number {
  const raw = asString(value)
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())
  const valid = zeroDecimal ? /^\d+(\.0{1,2})?$/.test(raw) : /^\d+(\.\d{1,2})?$/.test(raw)
  const amount = Number.parseFloat(raw)
  if (!valid || !Number.isFinite(amount) || amount <= 0) {
    fail(400, `Campaign budget must be a valid ${currency.toUpperCase()} amount greater than 0`)
  }
  // createCampaign keeps its legacy major-unit API and multiplies the value by 100.
  return zeroDecimal ? amount / 100 : amount
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext()
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const denied = requireRole(ctx)
    if (denied) return denied

    const body = (await request.json()) as unknown
    if (!isRecord(body)) fail(400, "Invalid request body")

    const adAccountId = asString(body.adAccountId)
    if (!adAccountId) fail(400, "Ad account is required")

    const objective = asString(body.objective)
    if (!isCampaignObjective(objective)) fail(400, "Unsupported campaign objective")

    if (!Array.isArray(body.specialAdCategories)) fail(400, "Special ad categories must be a list")
    const specialAdCategories = body.specialAdCategories.map(asString)
    if (specialAdCategories.some(category => !SPECIAL_AD_CATEGORIES.has(category))) {
      fail(400, "Invalid special ad category")
    }

    if (typeof body.advantageCampaignBudget !== "boolean") {
      fail(400, "Campaign budget mode is required")
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
    if (!connection) return NextResponse.json({ error: "Facebook not connected" }, { status: 400 })

    const account = await getOrgAdAccountInfo(ctx.orgId, adAccountId, connection.access_token)
    if (!account) return NextResponse.json({ error: "Ad account not found or not authorized" }, { status: 403 })

    const cbo = body.advantageCampaignBudget
    const strategy = asString(body.campaignBidStrategy) || "LOWEST_COST_WITHOUT_CAP"
    if (cbo && !isBidStrategy(strategy)) fail(400, "Invalid campaign bid strategy")

    const campaign = await createCampaign(account.id, connection.access_token, {
      name: asString(body.name) || "New Campaign",
      objective,
      special_ad_categories: specialAdCategories,
      status: "PAUSED",
      daily_budget: cbo ? campaignBudgetForHelper(body.campaignBudget, account.currency || "USD") : undefined,
      bid_strategy: cbo ? strategy : undefined,
    }, { isManual: isManual(connection) })

    await invalidateMetaReadCacheAfterWrite({
      orgId: ctx.orgId,
      adAccountId: account.id,
      objectIds: [campaign.id],
    })

    return NextResponse.json({ success: true, campaignId: campaign.id })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : "Failed to create campaign"
    if (status >= 500) console.error("[create-campaign-shell] error:", error)
    return NextResponse.json({ error: message }, { status })
  }
}
