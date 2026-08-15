import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = path => readFileSync(join(process.cwd(), path), "utf8")

describe("Launch result details contract", () => {
  it("renders the requested result columns and removes Ad ID", () => {
    const page = read("app/(dashboard)/launch/page.tsx")
    const modal = page.slice(
      page.indexOf("function LaunchResultModal"),
      page.indexOf("function LaunchHistory")
    )

    const headers = [
      "#", "Thumb", "Campaign name", "Bid strategy", "Campaign budget",
      "Adset name", "Bid strategy", "Adset budget", "Ad name", "Status",
    ]
    let cursor = -1
    for (const header of headers) {
      const next = modal.indexOf(`>${header}<`, cursor + 1)
      assert.ok(next > cursor, `${header} must appear in order`)
      cursor = next
    }
    assert.doesNotMatch(modal, />Ad ID</)
    assert.match(page, /Using campaign budget/)
    assert.match(page, /Using ad set budget/)
    assert.match(page, /strategy === "COST_CAP"/)
    assert.match(page, /Cost per result goal/)
    assert.match(page, /return "Cost cap"/)
    assert.match(page, /adset\.bid_amount/)
    assert.match(page, /strategy === "LOWEST_COST_WITH_BID_CAP"/)
    assert.match(page, /strategy === "LOWEST_COST_WITH_MIN_ROAS"/)
  })

  it("hydrates immediate and history results through one Via NON-LAUNCH Meta batch read", () => {
    const route = read("app/api/facebook/launch-result-details/route.ts")
    const page = read("app/(dashboard)/launch/page.tsx")

    assert.match(route, /getConnectionForAdAccount\(ctx\.orgId, adAccountId, "read"\)/)
    assert.match(route, /secureMetaFetch/)
    assert.match(route, /ids/)
    assert.match(route, /campaign\{id,name,bid_strategy,daily_budget,lifetime_budget\}/)
    assert.match(route, /adset\{id,name,bid_strategy,bid_amount,bid_constraints,optimization_goal,daily_budget,lifetime_budget\}/)
    assert.match(route, /currency: account\.currency \|\| "USD"/)
    assert.match(page, /\/api\/facebook\/launch-result-details/)
  })
})
