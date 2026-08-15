import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { planDuplicateAdTopology } from "../lib/facebook-duplicate-client.ts"

const selectedAds = [
  { id: "ad-1", adsetId: "adset-1", campaignId: "campaign-1" },
  { id: "ad-2", adsetId: "adset-2", campaignId: "campaign-2" },
]

describe("Duplicate Ads topology", () => {
  it("defaults multiple selected ads into one fixed campaign and ad set group", () => {
    assert.deepEqual(planDuplicateAdTopology(selectedAds, false, true), [
      { sourceCampaignId: "campaign-1", adGroups: [selectedAds] },
    ])
  })

  it("creates one ad set group per ad when enabled", () => {
    assert.deepEqual(planDuplicateAdTopology(selectedAds, true, true), [
      { sourceCampaignId: "campaign-1", adGroups: [[selectedAds[0]]] },
      { sourceCampaignId: "campaign-2", adGroups: [[selectedAds[1]]] },
    ])
  })

  it("keeps all one-ad groups in one campaign when a fixed campaign is selected", () => {
    assert.deepEqual(planDuplicateAdTopology(selectedAds, true, false), [
      {
        sourceCampaignId: "campaign-1",
        adGroups: [[selectedAds[0]], [selectedAds[1]]],
      },
    ])
  })
})

describe("Duplicate Ads topology UI contract", () => {
  const page = readFileSync(join(process.cwd(), "app/(dashboard)/ads-manager/page.tsx"), "utf8")
  const launchPage = readFileSync(join(process.cwd(), "app/(dashboard)/launch/page.tsx"), "utf8")

  it("shows an Ads-only toggle that is off by default", () => {
    assert.match(page, /duplicateOneAdPerAdSet, setDuplicateOneAdPerAdSet\] = useState\(false\)/)
    assert.match(page, /tab === "ads" && \(duplicateStep === "options" \|\| duplicateStep === "gate"\)/)
    assert.match(page, /role="switch"/)
    assert.match(page, /1 ad per ad set/)
  })

  it("routes OFF into one fixed target and ON into new ad-set creation", () => {
    assert.match(page, /planDuplicateAdTopology\(/)
    assert.match(page, /const duplicateCreatesAdSets = tab === "ads" && \(duplicateDestination === "new" \|\| duplicateOneAdPerAdSet\)/)
    assert.match(page, /const fixedTargetAdSetId = duplicateDestination === "existing" \? duplicateTargetId : firstSelectedAd\?\.adset_id/)
    assert.match(page, /target_adset_id: fixedTargetAdSetId/)
  })

  it("shares the Launch Duplicate Campaign and Ad Set client flow", () => {
    assert.match(page, /from "@\/lib\/facebook-duplicate-client"/)
    assert.match(launchPage, /from "@\/lib\/facebook-duplicate-client"/)
    assert.match(page, /duplicateCampaignCopies\(/)
    assert.match(page, /duplicateAdSetsIntoCampaigns\(/)
    assert.match(launchPage, /duplicateCampaignCopies\(/)
    assert.match(launchPage, /duplicateAdSetsIntoCampaigns\(/)
  })
})
