import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path) => readFileSync(join(process.cwd(), path), "utf8")

/**
 * BL-58 · "there it is" after publish.
 *
 * A publish refetches from Meta and drops the new objects into a list that can be hundreds long,
 * sorted by spend, where a brand-new PAUSED object sinks to the bottom. Without the ids travelling
 * back up from the route the table has nothing to point at, so the invariants here are: the route
 * returns every ad set it created (not just the first), the modal hands them to its caller, and the
 * table holds them long enough to be seen.
 */
describe("Create Campaign publish highlight contract", () => {
  const route = read("app/api/facebook/create-campaign/route.ts")
  const modal = read("components/ads-manager/create-flow/CreateCampaignModal.tsx")
  const table = read("app/(dashboard)/ads-manager/page.tsx")

  it("returns every ad set the request produced, on both success paths", () => {
    // oneAdPerAdset copies ad sets; `actualAdSetIds` is the full set, adSet.id is only the first.
    assert.match(route, /adSetIds: actualAdSetIds/)
    assert.match(route, /adSetIds: \[adSet\.id\]/)
    // Two success responses — multi-creative and single-creative — must both carry the ids.
    assert.equal((route.match(/adSetIds:/g) || []).length, 2)
  })

  it("marks whether the campaign was created or attached to", () => {
    assert.equal((route.match(/attached: Boolean\(state\.existingCampaignId\)/g) || []).length, 2)
    assert.match(modal, /attached\?: boolean/)
    assert.match(modal, /data\.attached \? "Ad set published successfully\." : "Campaign published successfully\."/)
  })

  it("hands the ids to the caller through a typed result", () => {
    assert.match(modal, /export interface PublishResult/)
    assert.match(modal, /onSuccess\?: \(result: PublishResult\) => void/)
    // Falls back to the single-id field so an older response shape still points somewhere.
    assert.match(modal, /adSetIds: data\.adSetIds\?\.length \? data\.adSetIds : data\.adSetId \? \[data\.adSetId\] : \[\]/)
  })

  it("holds the published ids in the table and clears them on a timer", () => {
    assert.match(table, /const \[justPublishedIds, setJustPublishedIds\] = useState<Set<string>>/)
    assert.match(table, /const ids = \[result\.campaignId, \.\.\.result\.adSetIds\]/)
    // Clock starts after the refetch, otherwise it expires while the rows are still loading.
    assert.match(table, /await fetchMainData\(true\)\s*\n\s*justPublishedTimer\.current = setTimeout/)
    assert.match(table, /clearTimeout\(justPublishedTimer\.current\)/)
  })

  it("tints the row and badges it in all three tabs", () => {
    assert.match(table, /function rowTint\(isNew: boolean, hasDraft: boolean\)/)
    // Campaigns, ad sets, ads — one call per renderer.
    assert.equal((table.match(/rowTint\(justPublishedIds\.has\(/g) || []).length, 3)
    assert.equal((table.match(/>Just published<\/span>/g) || []).length, 3)
    // Just-published outranks the unpublished-draft tint; selection still outranks both.
    assert.match(table, /if \(isNew\) return \{[\s\S]*?tinted: true/)
    assert.match(table, /tinted && !isSel && tintRow/)
  })
})
