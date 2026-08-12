import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  mergeEditorTargeting,
  EDITOR_OWNED_TARGETING_KEYS,
  REMOVABLE_TARGETING_KEYS,
} from "../lib/targeting-merge.ts"

const root = process.cwd()
const read = path => readFileSync(join(root, path), "utf8")

// Keys the editor's detail read never requests. Meta replaces `targeting` wholesale, so if a
// publish forwards the draft as-is these are erased. This is the TD-37 regression set.
const UNREAD_KEYS = {
  locales: [6, 24],
  exclusions: { interests: [{ id: "1", name: "Cats" }] },
  targeting_automation: { advantage_audience: 1 },
  brand_safety_content_filter_levels: ["FACEBOOK_STANDARD"],
}

const remoteTargeting = () => ({
  ...UNREAD_KEYS,
  geo_locations: { countries: ["US"], location_types: ["home"] },
  excluded_geo_locations: { countries: ["CA"] },
  age_min: 18,
  age_max: 65,
  genders: [],
  publisher_platforms: ["facebook", "instagram"],
  device_platforms: ["mobile", "desktop"],
  facebook_positions: ["feed"],
  instagram_positions: ["stream"],
})

/** What the editor holds after a partial detail read — note the unread keys are simply absent. */
const draftFromPartialRead = () => ({
  geo_locations: { countries: ["US"], location_types: ["home"] },
  excluded_geo_locations: { countries: ["CA"] },
  age_min: 18,
  age_max: 65,
  genders: [],
  publisher_platforms: ["facebook", "instagram"],
  device_platforms: ["mobile", "desktop"],
  facebook_positions: ["feed"],
  instagram_positions: ["stream"],
})

describe("TD-37 · ad set targeting merge", () => {
  it("preserves every key the editor never read", () => {
    const draft = draftFromPartialRead()
    draft.age_min = 25 // a real edit, so the merge is actually sent

    const { targeting, changed } = mergeEditorTargeting(remoteTargeting(), draft)

    assert.equal(changed, true)
    assert.equal(targeting.age_min, 25)
    for (const [key, value] of Object.entries(UNREAD_KEYS)) {
      assert.deepEqual(targeting[key], value, `${key} must survive the merge`)
    }
  })

  it("reports no change for a name-only edit, so no targeting key is sent", () => {
    // The draft is byte-identical to the remote sub-selection: the buyer only renamed the ad set.
    const { changed } = mergeEditorTargeting(remoteTargeting(), draftFromPartialRead())
    assert.equal(changed, false)
  })

  it("ignores key order when deciding whether anything moved", () => {
    const reordered = Object.fromEntries(Object.entries(draftFromPartialRead()).reverse())
    const { changed } = mergeEditorTargeting(remoteTargeting(), reordered)
    assert.equal(changed, false)
  })

  it("treats absent platform lists as Advantage+ and strips orphaned positions", () => {
    const draft = draftFromPartialRead()
    delete draft.publisher_platforms
    delete draft.device_platforms

    const { targeting, changed } = mergeEditorTargeting(remoteTargeting(), draft)

    assert.equal(changed, true)
    assert.ok(!("publisher_platforms" in targeting))
    assert.ok(!("device_platforms" in targeting))
    // Meta rejects position lists with no owning platform.
    assert.ok(!("facebook_positions" in targeting))
    assert.ok(!("instagram_positions" in targeting))
    // …and the unread keys still survive the Advantage+ switch.
    assert.deepEqual(targeting.locales, UNREAD_KEYS.locales)
  })

  it("drops position lists for platforms the buyer deselected", () => {
    const draft = draftFromPartialRead()
    draft.publisher_platforms = ["facebook"]

    const { targeting } = mergeEditorTargeting(remoteTargeting(), draft)

    assert.deepEqual(targeting.publisher_platforms, ["facebook"])
    assert.deepEqual(targeting.facebook_positions, ["feed"])
    assert.ok(!("instagram_positions" in targeting))
  })

  it("keeps remote values for owned keys the draft did not load", () => {
    // Not the Advantage+ case: a non-removable owned key missing from the draft means
    // "never hydrated", and the remote value must win rather than being deleted.
    const draft = draftFromPartialRead()
    delete draft.age_max
    delete draft.geo_locations

    const { targeting } = mergeEditorTargeting(remoteTargeting(), draft)

    assert.equal(targeting.age_max, 65)
    assert.deepEqual(targeting.geo_locations, { countries: ["US"], location_types: ["home"] })
  })

  it("never overlays read-only audience keys the editor cannot edit", () => {
    // custom_audiences / excluded_custom_audiences / flexible_spec render as chips only. Remote
    // wins, so a trimmed read can never be written back over the real spec.
    const owned = [...EDITOR_OWNED_TARGETING_KEYS]
    assert.ok(!owned.includes("custom_audiences"))
    assert.ok(!owned.includes("excluded_custom_audiences"))
    assert.ok(!owned.includes("flexible_spec"))

    const remote = { ...remoteTargeting(), custom_audiences: [{ id: "1", name: "Buyers", extra: true }] }
    const draft = { ...draftFromPartialRead(), custom_audiences: [{ id: "1", name: "Buyers" }], age_min: 30 }

    const { targeting } = mergeEditorTargeting(remote, draft)
    assert.deepEqual(targeting.custom_audiences, [{ id: "1", name: "Buyers", extra: true }])
  })

  it("removing the last exclusion is expressed by absence, not an empty object", () => {
    // The Locations editor returns `undefined` when the last excluded location is deleted.
    // Without excluded_geo_locations in REMOVABLE_TARGETING_KEYS the remote value would win and
    // the removal would silently bounce back.
    const draft = draftFromPartialRead()
    delete draft.excluded_geo_locations

    const { targeting, changed } = mergeEditorTargeting(remoteTargeting(), draft)

    assert.equal(changed, true)
    assert.ok(!("excluded_geo_locations" in targeting))
  })

  it("edits an exclusion rather than dropping it when the draft still carries one", () => {
    const draft = draftFromPartialRead()
    draft.excluded_geo_locations = { countries: ["CA", "MX"] }

    const { targeting, changed } = mergeEditorTargeting(remoteTargeting(), draft)

    assert.equal(changed, true)
    assert.deepEqual(targeting.excluded_geo_locations, { countries: ["CA", "MX"] })
  })

  it("every removable key is hydrated by the ad set detail read", () => {
    // A removable key that the detail read does not request means "never loaded" would be
    // indistinguishable from "the user deleted it" — TD-37 in reverse.
    const detailRoute = read("app/api/facebook/adsets/[id]/detail/route.ts")
    for (const key of REMOVABLE_TARGETING_KEYS) {
      assert.ok(
        detailRoute.includes(key),
        `${key} is removable, so the detail read must hydrate it`
      )
    }
  })

  it("survives a remote read that returned no targeting at all", () => {
    const { targeting, changed } = mergeEditorTargeting(undefined, { age_min: 30 })
    assert.equal(changed, true)
    assert.equal(targeting.age_min, 30)
  })
})

describe("TD-37 · write paths merge before writing", () => {
  const publishRoute = read("app/api/ads-manager/workspace-publish/route.ts")
  const updateRoute = read("app/api/facebook/update/route.ts")
  const facebookLib = read("lib/facebook.ts")

  it("workspace-publish re-reads targeting before the Meta write", () => {
    assert.match(publishRoute, /import \{ mergeEditorTargeting \} from "@\/lib\/targeting-merge"/)
    assert.match(publishRoute, /getNodeTargeting/)
    // The re-read must be gated on the ad set level and precede updateNode.
    const readIdx = publishRoute.indexOf("const remoteTargeting = await getNodeTargeting")
    const writeIdx = publishRoute.indexOf("await updateNode(change.node.id")
    assert.ok(readIdx > 0 && writeIdx > readIdx, "targeting must be re-read before updateNode")
    assert.match(publishRoute, /change\.level === "adset" && change\.node\.targeting !== undefined/)
  })

  it("workspace-publish sends the merged spec, never the raw draft", () => {
    assert.match(publishRoute, /targeting: targetingToSend/)
    assert.doesNotMatch(publishRoute, /targeting: change\.node\.targeting/)
    // Unchanged merge leaves targetingToSend undefined, and updateNode skips undefined keys.
    assert.match(publishRoute, /let targetingToSend: unknown = undefined/)
    assert.match(publishRoute, /if \(merged\.changed\) targetingToSend = merged\.targeting/)
    assert.match(facebookLib, /if \(params\.targeting !== undefined\) body\.set\("targeting"/)
  })

  it("facebook/update merges on the same rule", () => {
    assert.match(updateRoute, /import \{ mergeEditorTargeting \} from "@\/lib\/targeting-merge"/)
    assert.match(updateRoute, /level === "adset" && targeting !== undefined/)
    assert.match(updateRoute, /mergedTargeting = merge\.changed \? merge\.targeting : undefined/)
    assert.match(updateRoute, /targeting: mergedTargeting/)
  })

  it("getNodeTargeting reads targeting whole, with no sub-selection", () => {
    assert.match(facebookLib, /export async function getNodeTargeting/)
    assert.match(facebookLib, /\?fields=targeting&access_token=/)
    // A sub-selection here would reintroduce TD-37 inside the fix itself.
    assert.doesNotMatch(facebookLib, /fields=targeting\{/)
    assert.match(facebookLib, /skipProof: opts\?\.isManual/)
  })
})
