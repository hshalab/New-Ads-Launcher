/**
 * Pure CBO/ABO bid-strategy normalization for Create Campaign.
 *
 * `bid_strategy` sits on whichever level owns budget: campaign under CBO, ad set under ABO.
 * Cap value (`bid_amount`) and ROAS floor (`bid_constraints`) always live on the ad set —
 * that is Meta's contract even when the campaign owns the strategy. Hidden/stale values for
 * the inactive strategy must never reach Meta.
 *
 * ROAS (`LOWEST_COST_WITH_MIN_ROAS`) requires optimization_goal=VALUE. The current ODAX matrix
 * has no VALUE row (BL-56), so callers must not offer it in the UI yet — resolveBidding still
 * enforces the guard server-side in case a stale client ever sends it.
 */

export type BidStrategy =
  | "LOWEST_COST_WITHOUT_CAP"
  | "COST_CAP"
  | "LOWEST_COST_WITH_BID_CAP"
  | "LOWEST_COST_WITH_MIN_ROAS"

export const BID_STRATEGIES: BidStrategy[] = [
  "LOWEST_COST_WITHOUT_CAP",
  "COST_CAP",
  "LOWEST_COST_WITH_BID_CAP",
  "LOWEST_COST_WITH_MIN_ROAS",
]

export const BID_STRATEGY_LABEL: Record<BidStrategy, string> = {
  LOWEST_COST_WITHOUT_CAP: "Highest volume",
  COST_CAP: "Cost per result goal",
  LOWEST_COST_WITH_BID_CAP: "Bid cap",
  LOWEST_COST_WITH_MIN_ROAS: "ROAS goal",
}

export function isBidStrategy(value: unknown): value is BidStrategy {
  return typeof value === "string" && (BID_STRATEGIES as string[]).includes(value)
}

export interface BiddingFormSlice {
  advantageCampaignBudget: boolean
  campaignBidStrategy: BidStrategy | string
  /** Cap value for COST_CAP and BID_CAP — same field, one at a time. */
  costPerResultGoal: string
  /** ROAS floor for LOWEST_COST_WITH_MIN_ROAS, entered as a decimal (e.g. "1.5"). */
  roasGoal: string
}

/**
 * Clear the value(s) that do not belong to the active strategy. Called on strategy change and on
 * CBO/ABO toggle so a stale hidden field never survives to publish. One atomic patch.
 */
export function clearIncompatibleBiddingFields(
  strategy: BidStrategy
): { costPerResultGoal?: string; roasGoal?: string } {
  if (strategy === "LOWEST_COST_WITH_MIN_ROAS") return { costPerResultGoal: "" }
  if (strategy === "LOWEST_COST_WITHOUT_CAP") return { costPerResultGoal: "", roasGoal: "" }
  return { roasGoal: "" } // COST_CAP / LOWEST_COST_WITH_BID_CAP keep costPerResultGoal
}

export interface ResolvedBidding {
  campaignBidStrategy?: BidStrategy
  adSetBidStrategy?: BidStrategy
  /** Minor-units string for ad-set bid_amount, or undefined. */
  bidAmount?: string
  bidConstraints?: { roas_average_floor: number }
  /** True when COST_CAP is active — feeds ODAX `hasCostCap`. */
  hasCostCap: boolean
}

export interface ResolveBiddingInput {
  advantageCampaignBudget: boolean
  /** Attach branch: campaign already exists in Meta — never send campaign strategy/budget. */
  existingCampaignId?: string
  campaignBidStrategy?: string
  costPerResultGoal?: string
  roasGoal?: string
  /** Ad set `optimization_goal` after ODAX resolve — gates MIN_ROAS. */
  optimizationGoal?: string
  toMinorUnits: (value: string, label: string) => string
  fail: (status: number, message: string) => never
}

/**
 * Authoritative server-side bidding payload. Strategy sits on campaign under CBO, ad set under
 * ABO or attach; cap/ROAS values always resolve onto the ad set.
 */
export function resolveBidding(input: ResolveBiddingInput): ResolvedBidding {
  const cbo = input.advantageCampaignBudget && !input.existingCampaignId
  const strategy: BidStrategy = isBidStrategy(input.campaignBidStrategy)
    ? input.campaignBidStrategy
    : "LOWEST_COST_WITHOUT_CAP"

  let bidAmount: string | undefined
  let bidConstraints: { roas_average_floor: number } | undefined

  if (strategy === "COST_CAP" || strategy === "LOWEST_COST_WITH_BID_CAP") {
    const label = strategy === "COST_CAP" ? "Cost per result goal" : "Bid cap"
    if (!input.costPerResultGoal?.trim()) input.fail(400, `${label} is required for this bid strategy`)
    bidAmount = input.toMinorUnits(input.costPerResultGoal!, label)
  } else if (strategy === "LOWEST_COST_WITH_MIN_ROAS") {
    if (input.optimizationGoal !== "VALUE") {
      input.fail(
        400,
        "ROAS goal requires optimization goal VALUE, which is not available for this objective yet"
      )
    }
    const raw = (input.roasGoal || "").trim()
    if (!raw) input.fail(400, "ROAS goal is required for this bid strategy")
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n) || n <= 0) input.fail(400, "ROAS goal must be greater than 0")
    // UI collects a plain ROAS multiplier (1.5 = 1.5x); Meta wants it scaled ×10000.
    const floor = Math.round(n * 10000)
    if (floor < 100 || floor > 10_000_000) {
      input.fail(400, "ROAS goal must be between 0.01 and 1000")
    }
    bidConstraints = { roas_average_floor: floor }
    // Never send bid_amount alongside MIN_ROAS.
  }
  // LOWEST_COST_WITHOUT_CAP: no companion field.

  // Attach branch: the existing campaign owns its own strategy in Meta already. We only add
  // ad-set-level companions when the user actually set one for a cap strategy; we never send a
  // campaign strategy or claim LOWEST_COST_WITHOUT_CAP is the real state of someone else's campaign.
  if (input.existingCampaignId) {
    return {
      adSetBidStrategy: bidAmount || bidConstraints ? strategy : undefined,
      bidAmount,
      bidConstraints,
      hasCostCap: strategy === "COST_CAP",
    }
  }

  return cbo
    ? { campaignBidStrategy: strategy, bidAmount, bidConstraints, hasCostCap: strategy === "COST_CAP" }
    : { adSetBidStrategy: strategy, bidAmount, bidConstraints, hasCostCap: strategy === "COST_CAP" }
}
