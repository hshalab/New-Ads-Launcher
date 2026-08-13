import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path) => readFileSync(join(process.cwd(), path), "utf8")

/**
 * BL-58 · "New ad set or ad" attach scope.
 *
 * The load-bearing invariant is that a client-supplied campaign id never becomes the rollback
 * target. `campaignId` feeds Graph DELETE; assigning an existing campaign to it would destroy live
 * delivery when the ad-set write fails.
 */
describe("Create Campaign attach scope contract", () => {
  const route = read("app/api/facebook/create-campaign/route.ts")
  const facebook = read("lib/facebook.ts")
  const gate = read("components/ads-manager/create-flow/CreateEntryGate.tsx")
  const modal = read("components/ads-manager/create-flow/CreateCampaignModal.tsx")
  const campaignLevel = read("components/ads-manager/create-flow/CampaignLevel.tsx")
  const types = read("components/ads-manager/create-flow/types.ts")

  it("reads the attach target through a dedicated helper and never invents its fields", () => {
    assert.match(facebook, /export async function getCampaignForAttach/)
    assert.match(facebook, /id,name,objective,account_id,daily_budget,lifetime_budget,status/)
    assert.match(facebook, /skipProof: opts\?\.isManual/)
    assert.match(route, /getCampaignForAttach\(state\.existingCampaignId/)
  })

  it("assigns campaignId only after createCampaign — never from the client id", () => {
    // The attach branch sets `campaign = { id: existing.id }` and must leave campaignId null.
    assert.match(route, /let campaignId: string \| null = null/)
    assert.match(
      route,
      /campaign = \{ id: existing\.id \}[\s\S]*?\} else \{[\s\S]*?campaign = await createCampaign[\s\S]*?campaignId = campaign\.id/
    )
    // Client-supplied id must never be written into the rollback variable.
    assert.doesNotMatch(route, /campaignId\s*=\s*state\.existingCampaignId/)
    assert.doesNotMatch(route, /campaignId\s*=\s*existing\.id/)
  })

  it("rolls back only objects this request created", () => {
    assert.match(route, /async function rollbackMetaObject/)
    // Zero-success multi-creative: create branch deletes the campaign; attach branch deletes ad sets.
    assert.match(
      route,
      /if \(created\.length === 0\) \{\s*if \(campaignId\) await rollbackMetaObject\(campaignId, token\)\s*else for \(const id of actualAdSetIds\) await rollbackMetaObject\(id, token\)/
    )
    // Catch block still keyed on campaignId — so attach failures never DELETE the parent.
    assert.match(route, /if \(campaignId && rollbackToken\) await rollbackMetaObject\(campaignId, rollbackToken\)/)
  })

  it("enforces tenancy, objective match, and CBO/ABO budget ownership on attach", () => {
    assert.match(route, /That campaign belongs to a different ad account/)
    assert.match(route, /existing\.objective !== state\.objective/)
    assert.match(route, /const campaignOwnsBudget = Boolean\(existing\.daily_budget \|\| existing\.lifetime_budget\)/)
    assert.match(route, /has no campaign budget, so this ad set needs a daily budget/)
    // Campaign budget is never sent on the attach branch.
    assert.match(route, /state\.advantageCampaignBudget && !state\.existingCampaignId/)
  })

  it("skips campaign-name validation when attaching and still writes launch_batches on both scopes", () => {
    assert.match(route, /if \(!state\.existingCampaignId && !state\.campaignName\)/)
    // Both multi-creative and single-creative branches still insert launch_batches.
    const batchInserts = route.match(/\.from\("launch_batches"\)\.insert/g) || []
    assert.equal(batchInserts.length, 2)
  })

  it("wires the entry gate picker, read-only campaign step, and modal attach handoff", () => {
    assert.match(types, /existingCampaignId: string/)
    assert.match(types, /existingCampaignName: string/)
    assert.match(gate, /CampaignScope = "new" \| "existing"/)
    assert.match(gate, /New ad set or ad/)
    assert.match(gate, /function attachBlockedReason/)
    assert.match(gate, /\/api\/facebook\/campaigns\?ad_account_id=/)
    // Loading state set in the radio handler, not the effect body.
    assert.match(gate, /setCampaignsState\("loading"\)/)
    assert.doesNotMatch(
      gate,
      /useEffect\(\(\) => \{[\s\S]*?setCampaignsState\("loading"\)[\s\S]*?\}, \[open, scope, accountId\]\)/
    )
    assert.match(modal, /existingCampaignId: existingCampaign\.id/)
    assert.match(modal, /setActiveStep\(scope === "existing" \? "adset" : "campaign"\)/)
    assert.match(campaignLevel, /if \(state\.existingCampaignId\)/)
  })
})
