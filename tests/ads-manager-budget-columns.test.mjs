import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { getBudgetDisplay } from "../lib/ads-manager-budget.ts"
import { COLUMN_MAP, DEFAULT_PRESETS, migrateStoredColumnOrder, resolveStoredColumnOrder } from "../lib/column-config.ts"
import { formatAdSetBidStrategy, formatCampaignBidStrategy } from "../lib/meta-bid-strategy.ts"

describe("Ads Manager budget ownership", () => {
  it("shows own campaign and ad set budgets as editable amounts", () => {
    assert.deepEqual(getBudgetDisplay("campaign", { daily_budget: "4000" }), {
      amountMinor: "4000", period: "Daily", owner: "campaign", label: "", editable: true,
    })
    assert.deepEqual(getBudgetDisplay("adset", { lifetime_budget: "9000" }), {
      amountMinor: "9000", period: "Lifetime", owner: "adset", label: "", editable: true,
    })
  })

  it("labels CBO and ABO inheritance from the loaded Meta hierarchy", () => {
    assert.equal(getBudgetDisplay("adset", {}, { daily_budget: "4000" }).label, "Using campaign budget")
    assert.equal(getBudgetDisplay("adset", { daily_budget: "2000" }, { daily_budget: "4000" }).label, "Using campaign budget")
    assert.equal(getBudgetDisplay("adset", {}).label, "Using campaign budget")
    assert.equal(getBudgetDisplay("ad", {}, {}, { daily_budget: "2000" }).label, "Using ad set budget")
    assert.equal(getBudgetDisplay("ad", {}, { daily_budget: "4000" }, {}).label, "Using campaign budget")
    assert.equal(getBudgetDisplay("ad", {}, null, {}).label, "Using campaign budget")
    assert.equal(getBudgetDisplay("campaign", {}).label, "Using ad set budget")
  })
})

describe("Ads Manager Budget and Bid Strategy columns", () => {
  it("uses Budget in Customize Columns and orders ECOM bid strategy before budget", () => {
    assert.equal(COLUMN_MAP.budget.label, "Budget")
    assert.equal(COLUMN_MAP.budget.headerLabel, "Budget")
    const ecom = DEFAULT_PRESETS.find(preset => preset.id === "ecom")
    assert.ok(ecom)
    assert.equal(ecom.columns.indexOf("bid_strategy") + 1, ecom.columns.indexOf("budget"))
  })

  it("migrates only the persisted legacy ECOM order", () => {
    const ecom = DEFAULT_PRESETS.find(preset => preset.id === "ecom")
    assert.ok(ecom)
    const legacy = ecom.columns.filter(column => column !== "bid_strategy")
    assert.deepEqual(migrateStoredColumnOrder(legacy), ecom.columns)
    assert.deepEqual(migrateStoredColumnOrder(["delivery", "budget"]), ["delivery", "budget"])
  })

  it("refreshes any selected built-in preset from its current definition", () => {
    for (const preset of DEFAULT_PRESETS) {
      assert.deepEqual(resolveStoredColumnOrder(["stale_column"], preset.id), preset.columns)
    }
    assert.deepEqual(resolveStoredColumnOrder(["delivery", "budget"], "custom_1"), ["delivery", "budget"])
  })

  it("uses the Launch popup formatter for every Ads Manager hierarchy level", () => {
    const page = readFileSync(join(process.cwd(), "app/(dashboard)/ads-manager/page.tsx"), "utf8")
    const launchPage = readFileSync(join(process.cwd(), "app/(dashboard)/launch/page.tsx"), "utf8")
    const loadCopy = readFileSync(join(process.cwd(), "components/shared/load-copy-modal.tsx"), "utf8")
    const facebook = readFileSync(join(process.cwd(), "lib/facebook.ts"), "utf8")

    assert.equal(formatCampaignBidStrategy("COST_CAP"), "Cost cap")
    assert.equal(formatAdSetBidStrategy("COST_CAP", { bidAmount: "4000", currency: "USD" }), "Cost per result goal ($40.00)")
    assert.equal(formatAdSetBidStrategy("LOWEST_COST_WITH_MIN_ROAS", { bidConstraints: { roas_average_floor: 25000 } }), "ROAS goal (2.5)")
    assert.equal(formatAdSetBidStrategy("LOWEST_COST_WITHOUT_CAP", { optimizationGoal: "VALUE" }), "Highest value")
    assert.equal(formatAdSetBidStrategy("UNKNOWN_META_VALUE"), "UNKNOWN_META_VALUE")

    assert.match(page, /formatCampaignBidStrategy\(/)
    assert.match(page, /formatAdSetBidStrategy\(/)
    assert.match(launchPage, /formatCampaignBidStrategy\(/)
    assert.match(launchPage, /formatAdSetBidStrategy\(/)
    assert.ok(facebook.match(/"daily_budget", "lifetime_budget", "budget_remaining", "spend_cap", "bid_strategy"/g)?.length >= 2)
    assert.match(facebook, /adset\{attribution_spec,is_dynamic_creative,bid_strategy,bid_amount,bid_constraints,optimization_goal/)
    assert.ok(facebook.match(/campaign\{bid_strategy\}/g)?.length >= 2)
    assert.match(facebook, /campaign\{name,bid_strategy\}/)
    assert.match(page, /const rawBidStrategy =/)
    assert.match(page, /adSet\.campaign_bid_strategy/)
    assert.match(page, /ad\.campaign\?\.bid_strategy/)
    assert.doesNotMatch(loadCopy, /IconTrash|deleteTemplate|onDelete/)
  })
})
