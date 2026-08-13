/**
 * TD-42 — the Ads Manager editor must obey the same ODAX table the create flow enforces.
 *
 * Behavioural assertions run against the real pure module; the route wiring (memoisation, guard
 * placement, degrade-open) is asserted against its source, because the route needs Meta and
 * Supabase to execute.
 *
 * Run: npx tsx --test tests/workspace-publish-odax-guard.test.mjs
 * (no CI — TD-12 — so this is run by hand.)
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { allowedPerformanceGoals, odaxRejectionForAdSet } from "../lib/workspace-odax-guard.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = relative => readFileSync(join(root, relative), "utf8")

describe("allowedPerformanceGoals", () => {
  it("returns the row's goals for a known objective + destination type", () => {
    assert.deepEqual(allowedPerformanceGoals("OUTCOME_TRAFFIC", "WEBSITE"), [
      "LINK_CLICKS",
      "LANDING_PAGE_VIEWS",
    ])
    assert.deepEqual(allowedPerformanceGoals("OUTCOME_SALES", "WEBSITE"), ["OFFSITE_CONVERSIONS"])
    assert.deepEqual(allowedPerformanceGoals("OUTCOME_ENGAGEMENT", "ON_VIDEO"), ["THRUPLAY"])
  })

  it("returns null — unknown, not disallowed — when the combination is not in the table", () => {
    assert.equal(allowedPerformanceGoals("OUTCOME_TRAFFIC", "ON_VIDEO"), null)
    assert.equal(allowedPerformanceGoals("OUTCOME_LEADS", "WEBSITE"), null)
    assert.equal(allowedPerformanceGoals(undefined, "WEBSITE"), null)
    assert.equal(allowedPerformanceGoals("OUTCOME_TRAFFIC", undefined), null)
    // Awareness has no destination_type at all, so it can never be resolved from one.
    assert.equal(allowedPerformanceGoals("OUTCOME_AWARENESS", "WEBSITE"), null)
  })
})

describe("odaxRejectionForAdSet — criterion 1: refuses what Meta would refuse", () => {
  it("rejects a conversions goal on a traffic campaign and names the alternatives", () => {
    const rejection = odaxRejectionForAdSet({
      optimizationGoal: "OFFSITE_CONVERSIONS",
      objective: "OUTCOME_TRAFFIC",
      destinationType: "WEBSITE",
    })
    assert.match(rejection, /OFFSITE_CONVERSIONS/)
    assert.match(rejection, /LINK_CLICKS, LANDING_PAGE_VIEWS/)
  })

  it("rejects a ThruPlay goal on a sales campaign", () => {
    assert.match(
      odaxRejectionForAdSet({
        optimizationGoal: "THRUPLAY",
        objective: "OUTCOME_SALES",
        destinationType: "WEBSITE",
      }),
      /not valid/
    )
  })
})

describe("odaxRejectionForAdSet — criterion 2: rejects nothing Meta would accept", () => {
  it("passes every goal listed in the row", () => {
    for (const goal of ["LINK_CLICKS", "LANDING_PAGE_VIEWS"]) {
      assert.equal(
        odaxRejectionForAdSet({
          optimizationGoal: goal,
          objective: "OUTCOME_TRAFFIC",
          destinationType: "WEBSITE",
        }),
        null
      )
    }
    assert.equal(
      odaxRejectionForAdSet({
        optimizationGoal: "POST_ENGAGEMENT",
        objective: "OUTCOME_ENGAGEMENT",
        destinationType: "ON_POST",
      }),
      null
    )
  })
})

describe("odaxRejectionForAdSet — criterion 4: degrades open", () => {
  it("passes when the objective read failed", () => {
    assert.equal(
      odaxRejectionForAdSet({ optimizationGoal: "THRUPLAY", destinationType: "WEBSITE" }),
      null
    )
  })

  it("passes when the ad set carries no destination_type", () => {
    assert.equal(
      odaxRejectionForAdSet({ optimizationGoal: "THRUPLAY", objective: "OUTCOME_SALES" }),
      null
    )
  })

  it("passes when the objective is outside the table", () => {
    assert.equal(
      odaxRejectionForAdSet({
        optimizationGoal: "THRUPLAY",
        objective: "OUTCOME_APP_PROMOTION",
        destinationType: "WEBSITE",
      }),
      null
    )
  })

  it("passes a change that carries no performance goal at all — a rename must not be guarded", () => {
    assert.equal(
      odaxRejectionForAdSet({ objective: "OUTCOME_SALES", destinationType: "WEBSITE" }),
      null
    )
  })
})

describe("workspace-publish wiring", () => {
  const route = read("app/api/ads-manager/workspace-publish/route.ts")

  it("guards before the Meta write, not after", () => {
    const guardAt = route.indexOf("odaxRejectionForAdSet")
    const writeAt = route.indexOf("await updateNode(")
    assert.ok(guardAt > -1 && writeAt > -1)
    assert.ok(guardAt < writeAt, "the ODAX guard must run before updateNode")
  })

  it("guards ad set changes only", () => {
    assert.match(route, /change\.level === "adset" && change\.node\.optimization_goal/)
  })

  it("criterion 3: reads the objective once per campaign, not once per ad set", () => {
    assert.match(route, /objectiveByCampaign\s*=\s*new Map/)
    assert.match(route, /objectiveByCampaign\.get\(campaignId\)/)
    assert.match(route, /objectiveByCampaign\.set\(campaignId, pending\)/)
  })

  it("keeps the existing failure shape so all three consumers render it unchanged", () => {
    // The guard throws into the same catch that already produces status: "failed" + message.
    assert.match(route, /status: "failed"/)
    assert.match(route, /if \(rejection\) throw new Error\(rejection\)/)
  })

  it("criterion 5: the editor's goal options come from the ODAX row, not the label map", () => {
    const editor = read("components/ads-manager/UnifiedWorkspaceEditor.tsx")
    assert.match(editor, /allowedPerformanceGoals\(campaignObjective, draft\.destination_type\)/)
    assert.match(editor, /goalOptions\.map\(\(\[val, label\]\)/)
    // OPT_LABEL survives as a fallback only — it must no longer be the option source.
    assert.doesNotMatch(editor, /Object\.entries\(OPT_LABEL\)\.map/)
  })

  it("the parent objective reaches the editor — the ad set node does not carry it", () => {
    assert.match(
      read("components/ads-manager/PerformancePopup.tsx"),
      /campaignObjective=\{activeCampaign\?\.objective\}/
    )
  })

  it("bid strategy labels have one source across create, editor, and the hierarchy table", () => {
    for (const file of [
      "components/ads-manager/UnifiedWorkspaceEditor.tsx",
      "app/(dashboard)/ads-manager/page.tsx",
    ]) {
      assert.match(read(file), /BID_LABEL: Record<string, string> = BID_STRATEGY_LABEL/)
      // MINIMUM_ROAS is not a Graph value; a local map keyed on it rendered the raw enum.
      assert.doesNotMatch(read(file), /MINIMUM_ROAS:/)
    }
  })

  it("switching bid strategy drops the value the new strategy cannot carry", () => {
    const editor = read("components/ads-manager/UnifiedWorkspaceEditor.tsx")
    assert.match(editor, /bid_amount: next === "LOWEST_COST_WITH_MIN_ROAS" \? undefined : draft\.bid_amount/)
    assert.match(editor, /bid_constraints: next === "LOWEST_COST_WITH_MIN_ROAS" \? draft\.bid_constraints : undefined/)
  })

  it("the objective reader never throws — criterion 4 depends on it", () => {
    const facebook = read("lib/facebook.ts")
    const start = facebook.indexOf("export async function getCampaignObjective")
    assert.ok(start > -1)
    const body = facebook.slice(start, start + 900)
    assert.match(body, /catch \{\s*return undefined/)
    assert.match(body, /if \(!res\.ok\) return undefined/)
  })
})
