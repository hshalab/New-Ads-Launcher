import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const read = path => readFileSync(join(process.cwd(), path), "utf8")

// lib/create-campaign-targeting.ts is pure — no Next, no Supabase, no Meta token — so it can be
// transpiled and executed here. That is the point of the extraction: these are real assertions on
// the payload, not regex over source text.
const mod = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      ts.transpileModule(read("lib/create-campaign-targeting.ts"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText
    ).toString("base64")
)

const { buildTargeting, buildAttributionSpec, adSetCountError, META_MAX_AD_SETS_PER_CAMPAIGN } = mod

/** Mirrors `defaultCampaignState` in components/ads-manager/create-flow/types.ts. */
const defaults = {
  locations: ["US"],
  ageMin: 18,
  ageMax: 65,
  gender: "ALL",
  placementMode: "advantage",
  publisherPlatforms: ["facebook", "instagram", "audience_network", "messenger"],
  targetingExpansion: true,
}

describe("create-campaign targeting", () => {
  it("sends exactly the pre-TD-38 payload when every control is left at its default", () => {
    // This is the safety property that lets the fix ship without a feature flag: a buyer who
    // changes nothing gets byte-identical behaviour in both surfaces that mount this modal
    // (M-02 Ads Manager and M-01 Launch).
    assert.deepEqual(buildTargeting(defaults), {
      geo_locations: { countries: ["US"] },
      age_min: 18,
      age_max: 65,
    })
  })

  it("sends publisher_platforms only when the buyer picks manual placements", () => {
    assert.equal(buildTargeting(defaults).publisher_platforms, undefined)

    const manual = buildTargeting({
      ...defaults,
      placementMode: "manual",
      publisherPlatforms: ["facebook"],
    })
    assert.deepEqual(manual.publisher_platforms, ["facebook"])
  })

  it("transmits only the Advantage+ audience opt-out, never the opt-in", () => {
    assert.equal(buildTargeting(defaults).targeting_automation, undefined)
    assert.deepEqual(
      buildTargeting({ ...defaults, targetingExpansion: false }).targeting_automation,
      { advantage_audience: 0 }
    )
  })

  it("keeps gender mapping intact", () => {
    assert.deepEqual(buildTargeting({ ...defaults, gender: "MALE" }).genders, [1])
    assert.deepEqual(buildTargeting({ ...defaults, gender: "FEMALE" }).genders, [2])
    assert.equal(buildTargeting(defaults).genders, undefined)
  })
})

describe("create-campaign attribution spec", () => {
  it("defaults to 7-day click only", () => {
    assert.deepEqual(
      buildAttributionSpec({
        mediaType: "image",
        performanceGoal: "OFFSITE_CONVERSIONS",
        attributionClickDays: "7",
        attributionViewDays: "0",
        attributionEngagedViewDays: "0",
      }),
      [{ event_type: "CLICK_THROUGH", window_days: 7 }]
    )
  })

  it("adds engaged-video-view when the buyer enables it", () => {
    const spec = buildAttributionSpec({
      mediaType: "video",
      performanceGoal: "OFFSITE_CONVERSIONS",
      attributionClickDays: "1",
      attributionViewDays: "1",
      attributionEngagedViewDays: "1",
    })
    assert.deepEqual(spec.map(s => s.event_type), [
      "CLICK_THROUGH",
      "VIEW_THROUGH",
      "ENGAGED_VIDEO_VIEW",
    ])
  })

  it("never sends engaged-video-view for an image ad", () => {
    const spec = buildAttributionSpec({
      mediaType: "image",
      performanceGoal: "OFFSITE_CONVERSIONS",
      attributionClickDays: "1",
      attributionViewDays: "0",
      attributionEngagedViewDays: "1",
    })
    assert.deepEqual(spec, [{ event_type: "CLICK_THROUGH", window_days: 1 }])
  })

  it("does not add engaged-view outside OFFSITE_CONVERSIONS", () => {
    const spec = buildAttributionSpec({
      mediaType: "video",
      performanceGoal: "LINK_CLICKS",
      attributionClickDays: "1",
      attributionViewDays: "0",
      attributionEngagedViewDays: "1",
    })
    assert.deepEqual(spec, [{ event_type: "CLICK_THROUGH", window_days: 1 }])
  })
})

describe("create-campaign ad set cap (TD-40)", () => {
  it("allows a batch at exactly the cap", () => {
    assert.equal(adSetCountError(true, META_MAX_AD_SETS_PER_CAMPAIGN), null)
  })

  it("refuses one over the cap, naming the number", () => {
    const err = adSetCountError(true, META_MAX_AD_SETS_PER_CAMPAIGN + 1)
    assert.ok(err)
    assert.match(err, /201 ad sets/)
    assert.match(err, /200 per campaign/)
  })

  it("does not apply when all creatives share one ad set", () => {
    assert.equal(adSetCountError(false, 5000), null)
  })
})

describe("create-campaign route wiring", () => {
  it("uses the shared builder and sends the DSA fields to Meta", () => {
    const route = read("app/api/facebook/create-campaign/route.ts")
    const facebook = read("lib/facebook.ts")

    assert.match(route, /from "@\/lib\/create-campaign-targeting"/)
    assert.match(route, /getBusinessManagers/)
    assert.match(route, /dsa_beneficiary: dsa\.advertiserName/)
    assert.match(route, /dsa_payor: dsa\.payerName/)
    assert.match(facebook, /body\.dsa_beneficiary = params\.dsa_beneficiary/)
    assert.match(facebook, /body\.dsa_payor = params\.dsa_payor/)

    // The batch audit row is mandatory for every ads-creating path (CONTEXT.md).
    assert.match(route, /launch_batches/)
  })

  it("still parses the fields the UI collects", () => {
    const route = read("app/api/facebook/create-campaign/route.ts")
    for (const field of [
      "placementMode",
      "publisherPlatforms",
      "targetingExpansion",
      "attributionEngagedViewDays",
      "advertiser",
      "payer",
    ]) {
      assert.match(route, new RegExp(`rawState\\.${field}`), `${field} is never read from the body`)
    }
  })

  it("loads DSA options in Create and rejects unsupported audience payloads", () => {
    const modal = read("components/ads-manager/create-flow/CreateCampaignModal.tsx")
    const route = read("app/api/facebook/create-campaign/route.ts")
    assert.match(modal, /\/api\/facebook\/adset-advertisers/)
    assert.match(modal, /advertisers=\{advertisers\}/)
    assert.match(route, /customAudiences.*is not supported in Create Campaign yet/s)
  })
})
