/**
 * BL-64 tracer — the adapter that lets the editor render an unpublished hierarchy.
 *
 * Run: npx tsx --test tests/workspace-draft-adapter.test.mjs
 *
 * The property under test is the one that has actually failed on this codebase: a field the user
 * edits, that never reaches Meta. TD-38 was eight of them at once. Here the guard is a round trip —
 * form → three nodes → form must be the identity for every field the editor owns.
 */

import { test, describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  DRAFT_IDS,
  FIELD_OWNER,
  applyDraftHierarchy,
  applyDraftNode,
  formStateToDraftNodes,
  fromMinorUnits,
  isDraftId,
  toMinorUnits,
} from "../lib/workspace-draft-adapter.ts"
import { defaultCampaignState } from "../components/ads-manager/create-flow/types.ts"

/** A state with every field moved off its default, so a dropped field cannot hide behind one. */
const populated = {
  ...defaultCampaignState,
  campaignName: "Phantom 2.0",
  objective: "OUTCOME_SALES",
  specialAdCategories: ["HOUSING"],
  advantageCampaignBudget: true,
  campaignBudget: "250",
  campaignBidStrategy: "COST_CAP",

  adSetName: "US · PDP-main",
  conversionLocation: "website",
  engagementType: null,
  performanceGoal: "OFFSITE_CONVERSIONS",
  pixelId: "1234567890",
  conversionEvent: "ADD_TO_CART",
  costPerResultGoal: "12.50",
  roasGoal: "",
  attributionClickDays: "1",
  attributionViewDays: "1",
  attributionEngagedViewDays: "1",
  dailyBudget: "20",
  scheduleStart: "2026-08-14T05:06",
  scheduleEnd: "2026-08-20T05:06",
  scheduleTimeBasis: "utc",
  locations: ["US", "CA"],
  ageMin: 25,
  ageMax: 54,
  gender: "FEMALE",
  customAudiences: [{ id: "aud1", name: "Purchasers 180d" }],
  excludedCustomAudiences: [{ id: "aud2", name: "Recent buyers" }],
  detailedTargeting: [{ id: "int1", name: "Home improvement" }],
  targetingExpansion: false,
  placementMode: "manual",
  publisherPlatforms: ["facebook", "instagram"],
  advertiser: { type: "page", id: "p1", name: "PATI" },
  payer: { type: "business", id: "b1", name: "PATI Global" },

  adName: "Remake EN v3",
  pageId: "page-1",
  instagramId: "ig-1",
  creativeId: "cr-1",
  creativeFileName: "remake-en.mp4",
  creativePreviewUrl: "https://cdn.example.com/thumb.jpg",
  mediaUrl: "https://cdn.example.com/remake-en.mp4",
  mediaType: "video",
  creativeIds: ["cr-1", "cr-2"],
  selectedCreatives: [
    { id: "cr-1", file_name: "remake-en.mp4", preview_url: "https://cdn.example.com/t1.jpg", media_type: "video" },
  ],
  oneAdPerAdset: true,
  primaryText: "Primary",
  primaryTextVariations: ["Primary B"],
  headline: "Headline",
  headlineVariations: ["Headline B"],
  description: "Description",
  descriptionVariations: ["Description B"],
  callToAction: "SHOP_NOW",
  destinationUrl: "https://example.com/pdp",
  urlParameters: "utm_source=fb",
}

describe("units", () => {
  it("converts to and from Meta minor units without drifting", () => {
    assert.equal(toMinorUnits("12.50"), "1250")
    assert.equal(toMinorUnits("100"), "10000")
    assert.equal(fromMinorUnits("1250"), "12.50")
    assert.equal(fromMinorUnits("10000"), "100")
  })

  it("leaves an empty field empty rather than inventing a zero", () => {
    // "" and "0" mean different things to Meta: absent vs an explicit zero bid.
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
})

describe("form → draft nodes", () => {
  it("builds a three-level hierarchy wired to itself", () => {
    const { campaign, adset, ad } = formStateToDraftNodes(populated)
    assert.equal(campaign.id, DRAFT_IDS.campaign)
    assert.equal(adset.campaign_id, DRAFT_IDS.campaign)
    assert.equal(ad.adset_id, DRAFT_IDS.adset)
    assert.equal(ad.campaign_id, DRAFT_IDS.campaign)
  })

  it("marks draft ids so a route can never mistake one for a Meta id", () => {
    assert.ok(isDraftId(DRAFT_IDS.campaign))
    assert.ok(!isDraftId("120210000000000"))
    assert.ok(!isDraftId(undefined))
  })

  it("creates the hierarchy paused — nothing starts spending on publish", () => {
    const nodes = formStateToDraftNodes(populated)
    for (const node of Object.values(nodes)) assert.equal(node.status, "PAUSED")
  })

  describe("bidding", () => {
    it("CBO: strategy on the campaign, cap value on the ad set", () => {
      const { campaign, adset } = formStateToDraftNodes(populated)
      assert.equal(campaign.bid_strategy, "COST_CAP")
      assert.equal(campaign.daily_budget, "25000")
      assert.equal(adset.bid_strategy, undefined)
      assert.equal(adset.daily_budget, undefined)
      // Meta has no campaign-level bid_amount — the number always sits on the ad set.
      assert.equal(adset.bid_amount, "1250")
    })

    it("ABO: strategy moves to the ad set, campaign carries no budget or strategy", () => {
      const { campaign, adset } = formStateToDraftNodes({
        ...populated,
        advantageCampaignBudget: false,
      })
      assert.equal(campaign.daily_budget, undefined)
      assert.equal(campaign.bid_strategy, undefined)
      assert.equal(adset.bid_strategy, "COST_CAP")
      assert.equal(adset.daily_budget, "2000")
    })

    it("ROAS goal sends a floor and no bid_amount", () => {
      const { adset } = formStateToDraftNodes({
        ...populated,
        campaignBidStrategy: "LOWEST_COST_WITH_MIN_ROAS",
        costPerResultGoal: "12.50",
        roasGoal: "1.5",
      })
      // Meta rejects a ROAS floor sent alongside a bid amount.
      assert.equal(adset.bid_amount, undefined)
      assert.deepEqual(adset.bid_constraints, { roas_average_floor: 15000 })
    })

    it("Highest volume carries neither cap nor floor", () => {
      const { adset } = formStateToDraftNodes({
        ...populated,
        campaignBidStrategy: "LOWEST_COST_WITHOUT_CAP",
      })
      assert.equal(adset.bid_amount, undefined)
      assert.equal(adset.bid_constraints, undefined)
    })
  })

  describe("targeting", () => {
    it("Advantage+ placements omit publisher_platforms rather than listing all four", () => {
      const { adset } = formStateToDraftNodes({ ...populated, placementMode: "advantage" })
      assert.equal(adset.targeting?.publisher_platforms, undefined)
    })

    it("manual placements list exactly what was selected", () => {
      const { adset } = formStateToDraftNodes(populated)
      assert.deepEqual(adset.targeting?.publisher_platforms, ["facebook", "instagram"])
    })

    it("maps gender, geo and detailed targeting into the shapes Meta returns", () => {
      const { adset } = formStateToDraftNodes(populated)
      assert.deepEqual(adset.targeting?.genders, [2])
      assert.deepEqual(adset.targeting?.geo_locations, { countries: ["US", "CA"] })
      assert.deepEqual(adset.targeting?.flexible_spec, [
        { interests: [{ id: "int1", name: "Home improvement" }] },
      ])
      assert.equal(adset.targeting?.targeting_optimization, "none")
    })
  })

  it("resolves destination_type from the ODAX row, not from a second table", () => {
    const { adset } = formStateToDraftNodes(populated)
    assert.equal(adset.destination_type, "WEBSITE")
    const engagement = formStateToDraftNodes({
      ...populated,
      objective: "OUTCOME_ENGAGEMENT",
      conversionLocation: "on_your_ad",
      engagementType: "video_views",
      performanceGoal: "THRUPLAY",
    })
    assert.equal(engagement.adset.destination_type, "ON_VIDEO")
  })

  it("attaching to an existing campaign points the ad set at the Meta id", () => {
    const { campaign, adset } = formStateToDraftNodes({
      ...populated,
      existingCampaignId: "120210000000000",
      existingCampaignName: "PPE II Phantom 2.0",
    })
    assert.equal(campaign.name, "PPE II Phantom 2.0")
    assert.equal(campaign.draft_of, "120210000000000")
    assert.equal(adset.campaign_id, "120210000000000")
  })
})

describe("round trip", () => {
  it("is lossless for every field the editor owns", () => {
    const nodes = formStateToDraftNodes(populated)
    const returned = applyDraftHierarchy(populated, nodes)
    assert.deepEqual(returned, populated)
  })

  it("is lossless for untouched defaults", () => {
    const nodes = formStateToDraftNodes(defaultCampaignState)
    assert.deepEqual(applyDraftHierarchy(defaultCampaignState, nodes), defaultCampaignState)
  })

  it("is lossless under ABO, where the strategy lives on the other node", () => {
    const abo = { ...populated, advantageCampaignBudget: false }
    assert.deepEqual(applyDraftHierarchy(abo, formStateToDraftNodes(abo)), abo)
  })

  it("is lossless for a ROAS ad set", () => {
    const roas = {
      ...populated,
      campaignBidStrategy: "LOWEST_COST_WITH_MIN_ROAS",
      costPerResultGoal: "",
      roasGoal: "1.5",
    }
    assert.deepEqual(applyDraftHierarchy(roas, formStateToDraftNodes(roas)), roas)
  })

  it("is lossless for Awareness, which has no conversion location at all", () => {
    const awareness = {
      ...populated,
      objective: "OUTCOME_AWARENESS",
      conversionLocation: null,
      engagementType: null,
      performanceGoal: "REACH",
      pixelId: "",
      conversionEvent: defaultCampaignState.conversionEvent,
    }
    assert.deepEqual(applyDraftHierarchy(awareness, formStateToDraftNodes(awareness)), awareness)
  })
})

describe("per-node edits", () => {
  it("editing the ad set leaves the ad untouched", () => {
    const nodes = formStateToDraftNodes(populated)
    const edited = applyDraftNode(populated, { ...nodes.adset, name: "US · renamed" }, "adset")
    assert.equal(edited.adSetName, "US · renamed")
    assert.equal(edited.adName, populated.adName)
    assert.equal(edited.headline, populated.headline)
    assert.deepEqual(edited.selectedCreatives, populated.selectedCreatives)
  })

  it("editing the campaign leaves ad set targeting untouched", () => {
    const nodes = formStateToDraftNodes(populated)
    const edited = applyDraftNode(populated, { ...nodes.campaign, name: "Renamed" }, "campaign")
    assert.equal(edited.campaignName, "Renamed")
    assert.deepEqual(edited.locations, populated.locations)
    assert.equal(edited.gender, populated.gender)
  })

  it("attach scope: the campaign name is Meta's and the editor cannot rewrite it", () => {
    const attached = {
      ...populated,
      existingCampaignId: "120210000000000",
      existingCampaignName: "PPE II Phantom 2.0",
    }
    const nodes = formStateToDraftNodes(attached)
    const edited = applyDraftNode(attached, { ...nodes.campaign, name: "Hacked" }, "campaign")
    assert.equal(edited.campaignName, attached.campaignName)
    assert.equal(edited.existingCampaignName, "PPE II Phantom 2.0")
  })

  it("switching CBO off on the campaign node moves the budget decision to the ad set", () => {
    const nodes = formStateToDraftNodes(populated)
    const edited = applyDraftNode(populated, { ...nodes.campaign, daily_budget: "" }, "campaign")
    assert.equal(edited.advantageCampaignBudget, false)
    // The campaign budget the user typed is kept, not zeroed — toggling CBO back must restore it.
    assert.equal(edited.campaignBudget, populated.campaignBudget)
  })
})

test("the adapter never mutates the state it is given", () => {
  const snapshot = JSON.parse(JSON.stringify(populated))
  const nodes = formStateToDraftNodes(populated)
  applyDraftHierarchy(populated, nodes)
  assert.deepEqual(populated, snapshot)
})
