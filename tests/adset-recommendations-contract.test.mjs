import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const read = path => readFileSync(join(process.cwd(), path), "utf8")

// lib/adset-recommendations.ts is pure, so the real module runs here.
const mod = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      ts.transpileModule(read("lib/adset-recommendations.ts"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText
    ).toString("base64")
)

const { buildAdSetRecommendations, campaignScore, WARNING_PENALTY, INFO_PENALTY } = mod

/** A settings object that trips no check. */
const clean = {
  hasLocation: true,
  optimizationGoal: "LINK_CLICKS",
  pixelId: "",
  publisherPlatformCount: 0,
  targetingExpansion: true,
  ageMin: 18,
  ageMax: 65,
}

describe("ad set recommendations", () => {
  it("flags nothing when every check passes, and scores 100", () => {
    const recs = buildAdSetRecommendations(clean)
    assert.deepEqual(recs, [])
    const score = campaignScore(recs)
    assert.equal(score.value, 100)
    assert.equal(score.band, "good")
  })

  it("warns on the two things Meta will refuse", () => {
    const noLocation = buildAdSetRecommendations({ ...clean, hasLocation: false })
    assert.equal(noLocation.length, 1)
    assert.equal(noLocation[0].level, "warning")

    // A pixel goal without a pixel. OFFSITE_CONVERSIONS is what the Sales/Website ODAX row sends.
    const noPixel = buildAdSetRecommendations({ ...clean, optimizationGoal: "OFFSITE_CONVERSIONS" })
    assert.equal(noPixel.length, 1)
    assert.equal(noPixel[0].level, "warning")

    // Same goal with a pixel is clean — the check is about the pair.
    assert.deepEqual(
      buildAdSetRecommendations({
        ...clean,
        optimizationGoal: "OFFSITE_CONVERSIONS",
        pixelId: "PIXEL_1",
      }),
      []
    )
  })

  it("treats Advantage+ placements as unrestricted, not as four platforms", () => {
    // The create flow sends 0 for Advantage+ because buildTargeting omits publisher_platforms
    // entirely. A count of 4 (every platform ticked, manually) is also unrestricted.
    assert.deepEqual(buildAdSetRecommendations({ ...clean, publisherPlatformCount: 0 }), [])
    assert.deepEqual(buildAdSetRecommendations({ ...clean, publisherPlatformCount: 4 }), [])
    const restricted = buildAdSetRecommendations({ ...clean, publisherPlatformCount: 2 })
    assert.equal(restricted.length, 1)
    assert.equal(restricted[0].level, "info")
  })

  it("scores by the same penalties the card tells the user about", () => {
    const oneInfo = campaignScore(buildAdSetRecommendations({ ...clean, targetingExpansion: false }))
    assert.equal(oneInfo.value, 100 - INFO_PENALTY)
    assert.equal(oneInfo.infos, 1)

    const oneWarning = campaignScore(buildAdSetRecommendations({ ...clean, hasLocation: false }))
    assert.equal(oneWarning.value, 100 - WARNING_PENALTY)
    assert.equal(oneWarning.warnings, 1)

    // A warning never reads as "good", however few points it costs.
    assert.notEqual(oneWarning.band, "good")

    // The floor holds when every check trips at once.
    const worst = campaignScore(
      buildAdSetRecommendations({
        hasLocation: false,
        optimizationGoal: "OFFSITE_CONVERSIONS",
        pixelId: "",
        publisherPlatformCount: 1,
        targetingExpansion: false,
        ageMin: 25,
        ageMax: 30,
      })
    )
    assert.equal(worst.warnings, 2)
    assert.equal(worst.infos, 3)
    assert.ok(worst.value >= 0)
    assert.equal(worst.band, "poor")
  })

  it("is the only definition of the checks — both surfaces call it", () => {
    // Three copies of buildAttributionSpec is the precedent this guards against. If either surface
    // grows its own copy, the score changes when an ad set is saved without anything changing.
    const editor = read("components/ads-manager/UnifiedWorkspaceEditor.tsx")
    const create = read("components/ads-manager/create-flow/AdSetLevel.tsx")
    for (const [name, source] of [["editor", editor], ["create flow", create]]) {
      assert.match(source, /buildAdSetRecommendations\(/, `${name} does not call the shared builder`)
      assert.match(
        source,
        /from "@\/lib\/adset-recommendations"/,
        `${name} does not import from the shared module`
      )
      assert.doesNotMatch(
        source,
        /title: "Add a location"/,
        `${name} has its own copy of a check`
      )
    }
  })

  it("says whose score it is, on the card itself", () => {
    // The number is easy to misread as Meta's. Meta has no campaign score.
    const card = read("components/ads-manager/AdSetInsightsSidebar.tsx")
    assert.match(card, /not Meta&apos;s/)
    assert.match(card, /WARNING_PENALTY/)
    assert.match(card, /INFO_PENALTY/)
  })

  it("keeps the create modal above the global feedback bubble", () => {
    // components/feedback-bubble.tsx is `fixed right-6 z-50` (bottom offset varies by route) and
    // mounts after the modal, so at equal z it would paint over the footer's Publish button.
    assert.match(read("components/feedback-bubble.tsx"), /fixed right-6 z-50/)
    for (const path of [
      "components/ads-manager/create-flow/CreateCampaignModal.tsx",
      "components/ads-manager/create-flow/CreateEntryGate.tsx",
    ]) {
      assert.match(read(path), /fixed inset-0 z-\[60\]/, `${path} is not above the feedback bubble`)
    }
  })
})
