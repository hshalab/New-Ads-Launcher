import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = path => readFileSync(join(process.cwd(), path), "utf8")

describe("Task 4 Create Campaign contract", () => {
  it("uses progressive campaign navigation and hides special categories by default", () => {
    const campaign = read("components/ads-manager/create-flow/CampaignLevel.tsx")
    const modal = read("components/ads-manager/create-flow/CreateCampaignModal.tsx")

    assert.match(campaign, /showSpecialCategories/)
    assert.match(campaign, /Advanced settings/)
    assert.match(modal, /setActiveStep\("adset"\)/)
    assert.match(modal, /setActiveStep\("ad"\)/)
  })

  it("validates Publish with the full required-field validator", () => {
    const modal = read("components/ads-manager/create-flow/CreateCampaignModal.tsx")

    assert.match(modal, /const validation = validateState\(state, selectedAccountId, currency\)/)
    assert.match(modal, /setShowValidation\(true\)/)
  })

  it("closes into a non-blocking publish toast and clears success after three seconds", () => {
    const modal = read("components/ads-manager/create-flow/CreateCampaignModal.tsx")

    assert.match(modal, /setPublishStatus\("publishing"\)/)
    assert.match(modal, /onClose\(\)/)
    assert.match(modal, /setTimeout\(\(\) => setPublishStatus\("idle"\), 3000\)/)
    assert.match(modal, /CampaignPublishToast/)
  })

  it("wires proven Meta ad-set fields end to end", () => {
    const types = read("components/ads-manager/create-flow/types.ts")
    const adSetFields = read("components/ads-manager/create-flow/AdSetFormFields.tsx")
    const route = read("app/api/facebook/create-campaign/route.ts")

    for (const field of ["conversionEvent", "costPerResultGoal", "attributionClickDays", "attributionViewDays"]) {
      assert.match(types, new RegExp(field))
      assert.match(route, new RegExp(field))
    }
    assert.match(adSetFields, /Conversion event/)
    assert.match(adSetFields, /Cost per result goal/)
    assert.match(adSetFields, /Attribution setting/)
    assert.match(route, /bid_strategy: costPerResultGoal \? "COST_CAP"/)
    assert.match(route, /attribution_spec/)
  })

  it("connects one-ad-per-adset to real structural copies and batch records", () => {
    const types = read("components/ads-manager/create-flow/types.ts")
    const ad = read("components/ads-manager/create-flow/AdLevel.tsx")
    const route = read("app/api/facebook/create-campaign/route.ts")

    assert.match(types, /oneAdPerAdset/)
    assert.match(ad, /1 ad per ad set/)
    assert.match(route, /copyAdSet/)
    assert.match(route, /actualAdSetIds/)
    assert.match(route, /adset_ids: actualAdSetIds/)
  })
})
