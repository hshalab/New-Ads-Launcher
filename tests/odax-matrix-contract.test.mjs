import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const read = path => readFileSync(join(process.cwd(), path), "utf8")

// lib/odax-matrix.ts is pure data + pure functions, so the real module runs here. These assertions
// are the reason the table is allowed to be the single source of truth for both the ad set form and
// app/api/facebook/create-campaign/route.ts: if the table is wrong, it is wrong in one place and
// this file fails.
const mod = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      ts.transpileModule(read("lib/odax-matrix.ts"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText
    ).toString("base64")
)

const {
  ODAX_ROWS,
  OBJECTIVES,
  conversionLocationsFor,
  engagementTypesFor,
  performanceGoalsFor,
  resolveOdaxRow,
  normalizeOdaxSelection,
  buildDeliveryFields,
} = mod

const credentials = { pixelId: "PIXEL_1", conversionEvent: "PURCHASE", pageId: "PAGE_1" }

describe("ODAX matrix", () => {
  it("builds valid Meta delivery fields for every row in the table", () => {
    for (const row of ODAX_ROWS) {
      for (const goal of row.performanceGoals) {
        const built = buildDeliveryFields({
          objective: row.objective,
          conversionLocation: row.conversionLocation,
          engagementType: row.engagementType,
          performanceGoal: goal.value,
          ...credentials,
        })
        assert.equal(
          typeof built,
          "object",
          `${row.objective}/${row.conversionLocation}/${row.engagementType}/${goal.value} did not build: ${built}`
        )
        assert.equal(built.optimizationGoal, goal.value)
        assert.equal(built.billingEvent, "IMPRESSIONS")
        assert.equal(built.destinationType, row.destinationType)
      }
    }
  })

  it("sends no destination_type for Awareness — it has no destination", () => {
    const built = buildDeliveryFields({
      objective: "OUTCOME_AWARENESS",
      conversionLocation: null,
      engagementType: null,
      performanceGoal: "REACH",
    })
    assert.equal(built.destinationType, undefined)
    assert.equal(built.promotedObject, undefined)
  })

  it("sends the destination_type each engagement type requires, not WEBSITE for everything", () => {
    // The pre-rebuild route hardcoded destination_type: "WEBSITE" on every ad set it created.
    const video = buildDeliveryFields({
      objective: "OUTCOME_ENGAGEMENT",
      conversionLocation: "on_your_ad",
      engagementType: "video_views",
      performanceGoal: "THRUPLAY",
    })
    const post = buildDeliveryFields({
      objective: "OUTCOME_ENGAGEMENT",
      conversionLocation: "on_your_ad",
      engagementType: "post_engagement",
      performanceGoal: "POST_ENGAGEMENT",
      ...credentials,
    })
    assert.equal(video.destinationType, "ON_VIDEO")
    assert.equal(post.destinationType, "ON_POST")
    assert.deepEqual(post.promotedObject, { page_id: "PAGE_1" })
  })

  it("refuses to build without the promoted object Meta requires", () => {
    const noPixel = buildDeliveryFields({
      objective: "OUTCOME_SALES",
      conversionLocation: "website",
      engagementType: null,
      performanceGoal: "OFFSITE_CONVERSIONS",
    })
    assert.equal(typeof noPixel, "string")

    const noPage = buildDeliveryFields({
      objective: "OUTCOME_ENGAGEMENT",
      conversionLocation: "on_your_ad",
      engagementType: "post_engagement",
      performanceGoal: "POST_ENGAGEMENT",
    })
    assert.equal(typeof noPage, "string")
  })

  it("refuses an off-matrix combination instead of guessing", () => {
    // Sales + ThruPlay is the class of request that used to reach Meta and fail with error 100
    // after the campaign had already been created.
    const built = buildDeliveryFields({
      objective: "OUTCOME_SALES",
      conversionLocation: "website",
      engagementType: null,
      performanceGoal: "THRUPLAY",
      ...credentials,
    })
    assert.equal(typeof built, "string")
  })

  it("normalizes any stale selection onto a row that exists", () => {
    // Every objective, crossed with a deliberately wrong location/engagement/goal.
    for (const objective of OBJECTIVES) {
      for (const conversionLocation of [null, "website", "on_your_ad", "somewhere_else"]) {
        for (const engagementType of [null, "video_views", "post_engagement", "nonsense"]) {
          const selection = normalizeOdaxSelection({
            objective,
            conversionLocation,
            engagementType,
            performanceGoal: "THRUPLAY",
          })
          const row = resolveOdaxRow(
            selection.objective,
            selection.conversionLocation,
            selection.engagementType
          )
          assert.ok(row, `no row for ${JSON.stringify(selection)}`)
          assert.ok(
            row.performanceGoals.some(goal => goal.value === selection.performanceGoal),
            `goal ${selection.performanceGoal} is not offered by ${JSON.stringify(selection)}`
          )
        }
      }
    }
  })

  it("switching Sales to Engagement drops OFFSITE_CONVERSIONS", () => {
    const next = normalizeOdaxSelection({
      objective: "OUTCOME_ENGAGEMENT",
      conversionLocation: "website",
      engagementType: null,
      performanceGoal: "OFFSITE_CONVERSIONS",
    })
    assert.notEqual(next.performanceGoal, "OFFSITE_CONVERSIONS")
    assert.equal(next.conversionLocation, "website")
  })

  it("offers no conversion location for Awareness, so the card can be hidden", () => {
    assert.deepEqual(conversionLocationsFor("OUTCOME_AWARENESS"), [])
    assert.deepEqual(engagementTypesFor("OUTCOME_AWARENESS", null), [])
    assert.deepEqual(performanceGoalsFor("OUTCOME_AWARENESS", null, null).map(g => g.value), ["REACH"])
  })

  it("offers an engagement type only where one exists", () => {
    assert.deepEqual(
      engagementTypesFor("OUTCOME_ENGAGEMENT", "on_your_ad").map(option => option.value),
      ["video_views", "post_engagement"]
    )
    assert.deepEqual(engagementTypesFor("OUTCOME_ENGAGEMENT", "website"), [])
    assert.deepEqual(engagementTypesFor("OUTCOME_SALES", "website"), [])
  })

  it("every dropdown combination the UI can produce is buildable", () => {
    // The property that makes an invalid ad set unreachable from the form: walk the table exactly
    // the way the three selects do, and assert each triple builds.
    for (const objective of OBJECTIVES) {
      const locations = conversionLocationsFor(objective)
      const locationValues = locations.length === 0 ? [null] : locations.map(option => option.value)
      for (const location of locationValues) {
        const engagements = engagementTypesFor(objective, location)
        const engagementValues =
          engagements.length === 0 ? [null] : engagements.map(option => option.value)
        for (const engagement of engagementValues) {
          const goals = performanceGoalsFor(objective, location, engagement)
          assert.ok(goals.length > 0, `no goal for ${objective}/${location}/${engagement}`)
          for (const goal of goals) {
            const built = buildDeliveryFields({
              objective,
              conversionLocation: location,
              engagementType: engagement,
              performanceGoal: goal.value,
              ...credentials,
            })
            assert.equal(typeof built, "object", `${objective}/${location}/${goal.value}: ${built}`)
          }
        }
      }
    }
  })

  it("refuses a cost per result goal where Meta rejects COST_CAP", () => {
    // Awareness/REACH is the one row marked. The route turns costPerResultGoal into
    // bid_strategy: COST_CAP, and Meta only validates the pair when the ad set is created —
    // by which time the campaign exists and an error 100 leaves it orphaned.
    const awareness = ODAX_ROWS.find(row => row.objective === "OUTCOME_AWARENESS")
    assert.equal(awareness.allowsCostCap, false)

    const refused = buildDeliveryFields({
      objective: "OUTCOME_AWARENESS",
      conversionLocation: null,
      engagementType: null,
      performanceGoal: "REACH",
      hasCostCap: true,
      ...credentials,
    })
    assert.equal(typeof refused, "string")
    assert.match(refused, /cost per result goal/i)

    // Same selection without the cost cap still builds — the refusal is about the pair, not the row.
    assert.equal(
      typeof buildDeliveryFields({
        objective: "OUTCOME_AWARENESS",
        conversionLocation: null,
        engagementType: null,
        performanceGoal: "REACH",
        ...credentials,
      }),
      "object"
    )
  })

  it("never picks a conversion event for the user", () => {
    // custom_event_type decides what the campaign optimizes for. Defaulting it to PURCHASE spends
    // the budget on a goal nobody chose, so a missing value is a 400 like a missing pixel is.
    const built = buildDeliveryFields({
      objective: "OUTCOME_SALES",
      conversionLocation: "website",
      engagementType: null,
      performanceGoal: "OFFSITE_CONVERSIONS",
      pixelId: "PIXEL_1",
    })
    assert.equal(typeof built, "string")
    assert.match(built, /conversion event is required/i)

    const source = read("lib/odax-matrix.ts")
    assert.doesNotMatch(source, /conversionEvent \|\| "PURCHASE"/)
    assert.doesNotMatch(read("app/api/facebook/create-campaign/route.ts"), /rawState\.conversionEvent\) \|\| "PURCHASE"/)
  })

  it("hides the cost cap input in the form using the same table field", () => {
    const form = read("components/ads-manager/create-flow/AdSetFormFields.tsx")
    assert.match(form, /const allowsCostCap = odaxRow\?\.allowsCostCap !== false/)
    assert.match(form, /\{allowsCostCap && \(/)
    // Hiding alone would leave a stale value the route rejects.
    assert.match(form, /if \(!allowsCostCap && value\.costPerResultGoal\) onChange\(\{ costPerResultGoal: "" \}\)/)
    // And the route must actually ask the table about it.
    assert.match(read("app/api/facebook/create-campaign/route.ts"), /hasCostCap: Boolean\(state\.costPerResultGoal\)/)
  })
})
