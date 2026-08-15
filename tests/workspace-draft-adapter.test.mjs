/**
 * BL-64 — campaign shell adapter (create-new = campaign only).
 *
 * Run: npx tsx --test tests/workspace-draft-adapter.test.mjs
 */

import { test, describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  FIELD_OWNER,
  applyCampaignShellEdit,
  formStateToCampaignShell,
  fromMinorUnits,
  toMinorUnits,
  workspaceDraftsToMaterializeNodes,
} from "../lib/workspace-draft-adapter.ts"
import { defaultCampaignState } from "../components/ads-manager/create-flow/types.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = relative => readFileSync(join(root, relative), "utf8")

const shellBase = {
  existingCampaignId: "",
  campaignName: "Phantom 2.0",
  objective: "OUTCOME_SALES",
  specialAdCategories: ["HOUSING"],
  advantageCampaignBudget: true,
  campaignBudget: "250",
  campaignBidStrategy: "COST_CAP",
}

describe("units", () => {
  it("converts to and from Meta minor units without drifting", () => {
    assert.equal(toMinorUnits("12.50"), "1250")
    assert.equal(toMinorUnits("100"), "10000")
    assert.equal(fromMinorUnits("1250"), "12.50")
    assert.equal(fromMinorUnits("10000"), "100")
  })

  it("leaves an empty field empty rather than inventing a zero", () => {
    assert.equal(toMinorUnits(""), "")
    assert.equal(toMinorUnits("   "), "")
    assert.equal(fromMinorUnits(undefined), "")
  })
})

describe("field ownership", () => {
  it("names every form field — a new field cannot be silently dropped", () => {
    const formKeys = Object.keys(defaultCampaignState).sort()
    const mappedKeys = Object.keys(FIELD_OWNER).sort()
    assert.deepEqual(mappedKeys, formKeys)
  })

  it("assigns each field to a real level", () => {
    for (const [field, owner] of Object.entries(FIELD_OWNER)) {
      assert.ok(
        ["campaign", "adset", "ad", "gate"].includes(owner),
        `${field} has no valid owner: ${owner}`
      )
    }
  })

  it("keeps cap/ROAS values on the ad set, not the campaign", () => {
    assert.equal(FIELD_OWNER.costPerResultGoal, "adset")
    assert.equal(FIELD_OWNER.roasGoal, "adset")
    assert.equal(FIELD_OWNER.dailyBudget, "adset")
  })
})

describe("form → campaign shell", () => {
  it("emits campaign fields only — no ad set or ad keys", () => {
    const shell = formStateToCampaignShell(shellBase)
    assert.deepEqual(Object.keys(shell).sort(), [
      "advantageCampaignBudget",
      "campaignBidStrategy",
      "campaignBudget",
      "name",
      "objective",
      "specialAdCategories",
    ])
    assert.equal(shell.name, "Phantom 2.0")
    assert.equal(shell.objective, "OUTCOME_SALES")
    assert.deepEqual(shell.specialAdCategories, ["HOUSING"])
  })

  it("CBO: includes campaign budget and strategy, never cap/ROAS value", () => {
    const shell = formStateToCampaignShell(shellBase)
    assert.equal(shell.advantageCampaignBudget, true)
    assert.equal(shell.campaignBudget, "250")
    assert.equal(shell.campaignBidStrategy, "COST_CAP")
    assert.equal("costPerResultGoal" in shell, false)
    assert.equal("roasGoal" in shell, false)
    assert.equal("dailyBudget" in shell, false)
  })

  it("ABO: omits campaign budget and strategy entirely", () => {
    const shell = formStateToCampaignShell({
      ...shellBase,
      advantageCampaignBudget: false,
      campaignBudget: "999",
      campaignBidStrategy: "COST_CAP",
    })
    assert.equal(shell.advantageCampaignBudget, false)
    assert.equal(shell.campaignBudget, undefined)
    assert.equal(shell.campaignBidStrategy, undefined)
  })

  it("defaults blank name to New Campaign", () => {
    const shell = formStateToCampaignShell({ ...shellBase, campaignName: "   " })
    assert.equal(shell.name, "New Campaign")
  })

  it("rejects attach-scope state — shell is create-new only", () => {
    assert.throws(
      () =>
        formStateToCampaignShell({
          ...shellBase,
          existingCampaignId: "120210000000000",
        }),
      /new campaigns only/i
    )
  })

  it("never invents synthetic draft child ids", () => {
    const shell = formStateToCampaignShell(shellBase)
    const json = JSON.stringify(shell)
    assert.equal(json.includes("draft:"), false)
    assert.equal(json.includes("adset"), false)
    assert.equal(json.includes("adName"), false)
  })
})

describe("apply campaign shell edit", () => {
  it("updates campaign fields only", () => {
    const next = applyCampaignShellEdit(defaultCampaignState, {
      name: "Renamed",
      advantageCampaignBudget: true,
      campaignBudget: "80",
      campaignBidStrategy: "LOWEST_COST_WITHOUT_CAP",
      specialAdCategories: ["CREDIT"],
    })
    assert.equal(next.campaignName, "Renamed")
    assert.equal(next.campaignBudget, "80")
    assert.equal(next.campaignBidStrategy, "LOWEST_COST_WITHOUT_CAP")
    assert.deepEqual(next.specialAdCategories, ["CREDIT"])
    // Ad set / ad remain untouched
    assert.equal(next.adSetName, defaultCampaignState.adSetName)
    assert.equal(next.adName, defaultCampaignState.adName)
    assert.equal(next.dailyBudget, defaultCampaignState.dailyBudget)
    assert.equal(next.costPerResultGoal, defaultCampaignState.costPerResultGoal)
  })

  it("ABO toggle keeps previous campaign budget so flipping CBO back can restore it", () => {
    const cbo = {
      ...defaultCampaignState,
      advantageCampaignBudget: true,
      campaignBudget: "250",
      campaignBidStrategy: "COST_CAP",
    }
    const abo = applyCampaignShellEdit(cbo, {
      name: cbo.campaignName,
      advantageCampaignBudget: false,
    })
    assert.equal(abo.advantageCampaignBudget, false)
    assert.equal(abo.campaignBudget, "250")
  })
})

describe("workspace materialize adapter", () => {
  const campaign = { id: "campaign-1", name: "Existing campaign", objective: "OUTCOME_SALES" }
  const adset = {
    id: "local:adset-1",
    name: "Draft ad set",
    campaign_id: "campaign-1",
    daily_budget: "1250",
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: { age_min: 21 },
  }
  const ad = {
    id: "local:ad-1",
    name: "Draft ad",
    adset_id: "local:adset-1",
    page_id: "page-1",
    image_hash: "hash-1",
    primaryText: "Primary text",
    headline: "Headline",
    link: "https://example.com",
    cta: "SHOP_NOW",
    primary_text_variations: ["Variation"],
    url_parameters: "utm_source=facebook",
  }

  it("puts context parents first without writing them", () => {
    const nodes = workspaceDraftsToMaterializeNodes(
      [{ node: adset, level: "adset" }],
      [{ node: campaign, level: "campaign" }],
    )

    assert.deepEqual(nodes.map(node => [node.nodeId, node.level, node.contextOnly]), [
      ["campaign-1", "campaign", true],
      ["local:adset-1", "adset", undefined],
    ])
    assert.equal(nodes[0].metaId, "campaign-1")
    assert.equal(nodes[1].parentNodeId, "campaign-1")
  })

  it("orders local hierarchy parent-first and maps only route fields", () => {
    const nodes = workspaceDraftsToMaterializeNodes([
      { node: ad, level: "ad" },
      { node: adset, level: "adset" },
    ])

    assert.deepEqual(nodes.map(node => node.nodeId), ["local:adset-1", "local:ad-1"])
    assert.equal(nodes[0].metaId, undefined)
    assert.equal(nodes[0].dailyBudget, "1250")
    assert.equal(nodes[0].optimizationGoal, "OFFSITE_CONVERSIONS")
    assert.equal(nodes[0].billingEvent, "IMPRESSIONS")
    assert.deepEqual(nodes[0].targeting, { age_min: 21 })
    assert.equal(nodes[1].parentNodeId, "local:adset-1")
    assert.equal(nodes[1].imageHash, "hash-1")
    assert.equal(nodes[1].title, "Headline")
    assert.equal(nodes[1].body, "Primary text")
    assert.equal(nodes[1].linkUrl, "https://example.com")
    assert.deepEqual(nodes[1].primaryTextVariations, ["Variation"])
    assert.equal(nodes[1].urlParameters, "utm_source=facebook")
    assert.equal("draft_of" in nodes[1], false)
    assert.equal("creative_file_name" in nodes[1], false)
  })
})

describe("campaign shell route", () => {
  const route = read("app/api/facebook/create-campaign-shell/route.ts")

  it("holds the existing mutation gates before creating the Meta campaign", () => {
    const createAt = route.indexOf("await createCampaign(")
    assert.ok(createAt > -1)
    for (const gate of [
      "getAuthContext()",
      "requireRole(ctx)",
      'getConnectionForAdAccount(ctx.orgId, adAccountId, "write")',
      "getOrgAdAccountInfo(ctx.orgId, adAccountId, connection.access_token)",
    ]) {
      const gateAt = route.indexOf(gate)
      assert.ok(gateAt > -1 && gateAt < createAt, `${gate} must run before the Meta write`)
    }
  })

  it("creates only a paused campaign and invalidates reads after the write", () => {
    assert.match(route, /status: "PAUSED"/)
    assert.doesNotMatch(route, /createAdSet|createAd\(/)
    assert.match(route, /invalidateMetaReadCacheAfterWrite/)
    assert.match(route, /campaignId: campaign\.id/)
  })

  it("keeps ABO budget and strategy off the campaign", () => {
    assert.match(route, /daily_budget: cbo \? campaignBudgetForHelper[\s\S]+: undefined/)
    assert.match(route, /bid_strategy: cbo \? strategy : undefined/)
  })
})

test("the adapter never mutates the state it is given", () => {
  const snapshot = JSON.parse(JSON.stringify(defaultCampaignState))
  formStateToCampaignShell({
    existingCampaignId: defaultCampaignState.existingCampaignId,
    campaignName: defaultCampaignState.campaignName,
    objective: defaultCampaignState.objective,
    specialAdCategories: defaultCampaignState.specialAdCategories,
    advantageCampaignBudget: defaultCampaignState.advantageCampaignBudget,
    campaignBudget: defaultCampaignState.campaignBudget,
    campaignBidStrategy: defaultCampaignState.campaignBidStrategy,
  })
  applyCampaignShellEdit(defaultCampaignState, {
    name: "x",
    advantageCampaignBudget: false,
  })
  assert.deepEqual(defaultCampaignState, snapshot)
})
