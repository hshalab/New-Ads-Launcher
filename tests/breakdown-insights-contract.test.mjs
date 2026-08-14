import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = path => readFileSync(join(process.cwd(), path), "utf8")

const config = read("lib/breakdown-config.ts")
const route = read("app/api/facebook/breakdown-insights/route.ts")
const page = read("app/(dashboard)/ads-manager/page.tsx")

/**
 * Every field the menu can put in `breakdowns=`, parsed out of the config the
 * same way the app does. One invented field makes Meta reject the whole
 * request, which the UI shows as "this breakdown has no data".
 */
const META_BREAKDOWN_FIELDS = new Set(
  (/export const META_BREAKDOWN_FIELDS = new Set\(\[([\s\S]*?)\]\)/.exec(config)?.[1] ?? "")
    .split(",")
    .map(entry => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
)

const apiParams = [...config.matchAll(/apiParam:\s*"([^"]+)"/g)].map(m => m[1])

describe("Breakdown menu only offers fields Meta actually reports", () => {
  it("parses a non-empty field set and a non-empty menu", () => {
    assert.ok(META_BREAKDOWN_FIELDS.size > 5, "META_BREAKDOWN_FIELDS failed to parse")
    assert.ok(apiParams.length > 5, "no apiParam entries parsed")
  })

  it("has no apiParam pointing at a field outside that set", () => {
    const bad = []
    for (const param of apiParams) {
      const fields = /(?:^|&)breakdowns=([^&]*)/.exec(param)?.[1]
      if (!fields) continue
      for (const field of fields.split(",").map(f => f.trim()).filter(Boolean)) {
        if (!META_BREAKDOWN_FIELDS.has(field)) bad.push(field)
      }
    }
    assert.deepEqual(bad, [], `apiParam fields Meta does not accept: ${bad.join(", ")}`)
  })

  it("keeps every time_increment within Meta's 1-90 | monthly | all_days range", () => {
    for (const param of apiParams) {
      const increment = /(?:^|&)time_increment=([^&]*)/.exec(param)?.[1]
      if (!increment) continue
      const valid = increment === "monthly" || increment === "all_days" ||
        (Number.isInteger(Number(increment)) && Number(increment) >= 1 && Number(increment) <= 90)
      assert.ok(valid, `invalid time_increment: ${increment}`)
    }
  })

  it("drops the fields that were never real Meta breakdowns", () => {
    for (const field of ["audience_segment_type", "city", "skan_conversion_id", "media_asset_url",
      "business_asset_tag", "carousel_card_name", "website_ctr", "reaction_type", "product_brand",
      "product_category", "video_sound_status", "video_view_type", "creative_media_type",
      "storytelling_type", "attribution_setting", "conversion_timeline"]) {
      assert.doesNotMatch(config, new RegExp(`breakdowns=[^"]*${field}`), `${field} is still sent to Meta`)
    }
  })

  it("greys unsendable options out rather than hiding them", () => {
    assert.match(config, /unsupported\?: boolean/)
    assert.match(config, /\.filter\(isSendable\)/)
    assert.match(config, /Meta's Insights API doesn't report this breakdown\./)
    // The dropdown already disables on this reason — no component branch needed.
    assert.match(read("components/ads-manager/BreakdownDropdown.tsx"), /getBreakdownIncompatibility\(opt\.id, selected\)/)
  })
})

describe("Breakdown route asks Meta for complete, valid data", () => {
  it("rejects invalid breakdowns and time increments by name instead of forwarding them", () => {
    assert.match(route, /unsupportedBreakdownFields\(/)
    assert.match(route, /isValidTimeIncrement\(timeIncrement\)/)
    assert.match(route, /status: 400/)
  })

  it("requests the same insight columns the parent rows use", () => {
    assert.match(route, /import \{ ADS_MANAGER_INSIGHT_FIELDS \} from "@\/lib\/facebook"/)
    assert.match(route, /const fullFields = \[idField, "date_start", "date_stop", ADS_MANAGER_INSIGHT_FIELDS\]/)
    assert.match(read("lib/facebook.ts"), /export const ADS_MANAGER_INSIGHT_FIELDS/)
  })

  it("no longer drops rows with an impressions filter", () => {
    assert.doesNotMatch(route, /field: "impressions", operator: "GREATER_THAN"/)
  })

  it("falls back instead of returning nothing when Meta refuses the request shape", () => {
    assert.match(route, /const attempts: Attempt\[\] = \[/)
    assert.match(route, /filtering: null/)
    assert.match(route, /minimalFields/)
    // A rate limit must not be retried through the ladder.
    assert.match(route, /if \(err\?\.name === "MetaRateLimitError"\) throw err/)
  })

  it("re-applies the object scope in code when Meta's filter was dropped", () => {
    assert.match(route, /!attempt\.filtering && ids\.length > 0/)
    assert.match(route, /rows\.filter\(row => ids\.includes\(String\(row\[idField\] \|\| ""\)\)\)/)
  })

  it("caps pagination and reports the cap", () => {
    assert.match(route, /pages >= MAX_PAGES/)
    assert.match(route, /truncated = true/)
    assert.match(route, /return \{ data: scoped, warning: attempt\.warning, truncated \}/)
  })
})

describe("Ads Manager surfaces breakdown gaps instead of showing zeros", () => {
  it("carries every returned metric into the row the resolver scores", () => {
    assert.match(page, /ins: \{\r?\n\s*\.\.\.item,/)
  })

  it("shows a warning banner when the data came back degraded or truncated", () => {
    assert.match(page, /setBreakdownWarning\(\[/)
    assert.match(page, /id\.truncated \?/)
    assert.match(page, /Incomplete breakdown data: \{breakdownWarning\}/)
    assert.match(page, /!breakdownError && breakdownWarning &&/)
  })
})
