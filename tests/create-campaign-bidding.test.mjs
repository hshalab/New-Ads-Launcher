/**
 * Behavioural contract for CBO/ABO bid strategy resolution.
 *
 * Run: npx tsx --test tests/create-campaign-bidding.test.mjs
 * (imports the TypeScript module directly; there is no CI — TD-12 — so this is run by hand.)
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  clearIncompatibleBiddingFields,
  resolveBidding,
} from "../lib/create-campaign-bidding.ts"

const toMinorUnits = value => String(Math.round(Number.parseFloat(value) * 100))
const fail = (status, message) => {
  const error = new Error(message)
  error.status = status
  throw error
}
const base = { toMinorUnits, fail, optimizationGoal: "OFFSITE_CONVERSIONS" }

describe("resolveBidding — CBO puts the strategy on the campaign", () => {
  it("Highest volume sends a campaign strategy and no companion value", () => {
    const out = resolveBidding({
      ...base,
      advantageCampaignBudget: true,
      campaignBidStrategy: "LOWEST_COST_WITHOUT_CAP",
    })
    assert.equal(out.campaignBidStrategy, "LOWEST_COST_WITHOUT_CAP")
    assert.equal(out.adSetBidStrategy, undefined)
    assert.equal(out.bidAmount, undefined)
    assert.equal(out.bidConstraints, undefined)
    assert.equal(out.hasCostCap, false)
  })

  it("Cost cap keeps the strategy on the campaign but the amount on the ad set", () => {
    const out = resolveBidding({
      ...base,
      advantageCampaignBudget: true,
      campaignBidStrategy: "COST_CAP",
      costPerResultGoal: "12.50",
    })
    assert.equal(out.campaignBidStrategy, "COST_CAP")
    assert.equal(out.adSetBidStrategy, undefined)
    assert.equal(out.bidAmount, "1250")
    assert.equal(out.hasCostCap, true)
  })

  it("Bid cap does not flip hasCostCap", () => {
    const out = resolveBidding({
      ...base,
      advantageCampaignBudget: true,
      campaignBidStrategy: "LOWEST_COST_WITH_BID_CAP",
      costPerResultGoal: "3",
    })
    assert.equal(out.campaignBidStrategy, "LOWEST_COST_WITH_BID_CAP")
    assert.equal(out.bidAmount, "300")
    assert.equal(out.hasCostCap, false)
  })

  it("rejects a cap strategy with no amount", () => {
    assert.throws(
      () =>
        resolveBidding({
          ...base,
          advantageCampaignBudget: true,
          campaignBidStrategy: "COST_CAP",
          costPerResultGoal: "  ",
        }),
      /Cost per result goal is required/
    )
  })
})

describe("resolveBidding — ABO puts the strategy on the ad set", () => {
  it("no campaign bid field when campaign budget is off", () => {
    const out = resolveBidding({
      ...base,
      advantageCampaignBudget: false,
      campaignBidStrategy: "COST_CAP",
      costPerResultGoal: "8",
    })
    assert.equal(out.campaignBidStrategy, undefined)
    assert.equal(out.adSetBidStrategy, "COST_CAP")
    assert.equal(out.bidAmount, "800")
  })

  it("defaults to Highest volume when the client sends garbage", () => {
    const out = resolveBidding({
      ...base,
      advantageCampaignBudget: false,
      campaignBidStrategy: "NOT_A_STRATEGY",
    })
    assert.equal(out.adSetBidStrategy, "LOWEST_COST_WITHOUT_CAP")
    assert.equal(out.bidAmount, undefined)
  })
})

describe("resolveBidding — ROAS", () => {
  it("is blocked while the optimization goal is not VALUE", () => {
    assert.throws(
      () =>
        resolveBidding({
          ...base,
          advantageCampaignBudget: true,
          campaignBidStrategy: "LOWEST_COST_WITH_MIN_ROAS",
          roasGoal: "1.5",
        }),
      /optimization goal VALUE/
    )
  })

  it("scales the floor ×10000 and never sends a bid amount", () => {
    const out = resolveBidding({
      ...base,
      optimizationGoal: "VALUE",
      advantageCampaignBudget: true,
      campaignBidStrategy: "LOWEST_COST_WITH_MIN_ROAS",
      roasGoal: "1.5",
      costPerResultGoal: "99",
    })
    assert.deepEqual(out.bidConstraints, { roas_average_floor: 15000 })
    assert.equal(out.bidAmount, undefined)
    assert.equal(out.hasCostCap, false)
  })

  it("rejects a floor outside Meta's range", () => {
    assert.throws(
      () =>
        resolveBidding({
          ...base,
          optimizationGoal: "VALUE",
          advantageCampaignBudget: true,
          campaignBidStrategy: "LOWEST_COST_WITH_MIN_ROAS",
          roasGoal: "0.005",
        }),
      /between 0.01 and 1000/
    )
  })
})

describe("resolveBidding — attach branch", () => {
  it("never asserts a strategy on a campaign AdLauncher does not own", () => {
    const out = resolveBidding({
      ...base,
      advantageCampaignBudget: true,
      existingCampaignId: "120000",
      campaignBidStrategy: "LOWEST_COST_WITHOUT_CAP",
    })
    assert.equal(out.campaignBidStrategy, undefined)
    assert.equal(out.adSetBidStrategy, undefined)
  })

  it("still lands a cap the user actually typed on the new ad set", () => {
    const out = resolveBidding({
      ...base,
      advantageCampaignBudget: true,
      existingCampaignId: "120000",
      campaignBidStrategy: "COST_CAP",
      costPerResultGoal: "5",
    })
    assert.equal(out.campaignBidStrategy, undefined)
    assert.equal(out.adSetBidStrategy, "COST_CAP")
    assert.equal(out.bidAmount, "500")
  })
})

describe("clearIncompatibleBiddingFields", () => {
  it("drops both companions for Highest volume", () => {
    assert.deepEqual(clearIncompatibleBiddingFields("LOWEST_COST_WITHOUT_CAP"), {
      costPerResultGoal: "",
      roasGoal: "",
    })
  })

  it("keeps the cap value for cap strategies and drops the ROAS goal", () => {
    assert.deepEqual(clearIncompatibleBiddingFields("COST_CAP"), { roasGoal: "" })
    assert.deepEqual(clearIncompatibleBiddingFields("LOWEST_COST_WITH_BID_CAP"), { roasGoal: "" })
  })

  it("drops the cap value for ROAS", () => {
    assert.deepEqual(clearIncompatibleBiddingFields("LOWEST_COST_WITH_MIN_ROAS"), {
      costPerResultGoal: "",
    })
  })
})
