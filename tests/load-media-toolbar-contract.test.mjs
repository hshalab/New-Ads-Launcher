import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The Load Media modal's Media Library tab.
 *
 * Three defects were removed here and all three are the kind that grow back, because each one
 * *looked* like a working feature:
 *
 *  1. A "Search" button with no onClick, beside an input that already filtered on every
 *     keystroke. It taught users the list was stale until they clicked it.
 *  2. Four filter chips — Uploader, Channels, Workspace, Source — whose option arrays were
 *     hardcoded `[]` and which no filter predicate read. They opened, highlighted, and did
 *     nothing. Same for the "Include" dropdown, whose three checkboxes had no onChange.
 *  3. Three stacked bordered rows above the table (search / filters / actions) in a 94vh
 *     modal. The actions row was already right-aligned, so it folded into the search row.
 *
 * Source-contract assertions, like tests/media-detail-sheet-contract.test.mjs — this repo has
 * no DOM runner, and what is worth protecting is structural.
 *
 *   node --test tests/load-media-toolbar-contract.test.mjs
 */

const root = process.cwd()
const MODAL = "components/shared/load-media-modal.tsx"
const src = () => readFileSync(join(root, MODAL), "utf8")

/** The Media Library tab's JSX: from its branch test to the Vault tab's. */
const libraryTab = () => {
  const s = src()
  const start = s.indexOf('{mediaTab === "library" ? (')
  const end = s.indexOf(') : mediaTab === "vault" ? (')
  assert.ok(start > 0 && end > start, "could not locate the Media Library tab branch")
  return s.slice(start, end)
}

describe("Load Media: Create Campaign layering", () => {
  it("renders above the Classic Create Campaign parent dialog", () => {
    const createModal = readFileSync(join(root, "components/ads-manager/create-flow/CreateCampaignModal.tsx"), "utf8")
    const dialog = readFileSync(join(root, "components/ui/dialog.tsx"), "utf8")
    assert.match(createModal, /fixed inset-0 z-\[60\]/)
    assert.match(src(), /className="z-\[70\][^"]*"/)
    assert.match(src(), /overlayClassName="z-\[70\]"/)
    assert.match(dialog, /overlayClassName\?: string/)
    assert.match(dialog, /<DialogOverlay className=\{overlayClassName\}/)
  })

  it("opens from Classic Create unless its upload is active", () => {
    const adLevel = readFileSync(join(root, "components/ads-manager/create-flow/AdLevel.tsx"), "utf8")
    assert.match(adLevel, /onClick=\{\(\) => setPickerOpen\(true\)\}/)
    assert.match(adLevel, /disabled=\{mediaUploading\}/)
    assert.match(adLevel, /<LoadMediaModal[\s\S]*open=\{pickerOpen\}/)
  })
})

describe("Load Media: no separate search UI", () => {
  it("has no Search submit button", () => {
    // Typing filters live. A button here can only imply otherwise.
    assert.doesNotMatch(src(), /<Button[^>]*>\s*Search\s*<\/Button>/)
  })

  it("still filters on every keystroke", () => {
    const tab = libraryTab()
    assert.match(tab, /onChange=\{e => setSearch\(e\.target\.value\)\}/)
    // …and the predicate still consumes it.
    assert.match(src(), /const matchSearch = !search \|\| m\.name\.toLowerCase\(\)\.includes\(search\.toLowerCase\(\)\)/)
  })

  it("drops the Include dropdown and its dead state", () => {
    const s = src()
    // Three checkboxes with no onChange, so nothing could be included or excluded.
    assert.doesNotMatch(s, /"Archived", "Deleted", "Other workspaces"/)
    assert.doesNotMatch(s, /includeOpen/, "setIncludeOpen was only ever read by the removed dropdown")
  })
})

describe("Load Media: Existing Ads has no search button either", () => {
  /** The Existing Ads tab's JSX. */
  const existingTab = () => {
    const s = src()
    const start = s.indexOf(') : mediaTab === "existing" ? (')
    const end = s.indexOf(') : mediaTab === "gdrive"')
    assert.ok(start > 0 && end > start, "could not locate the Existing Ads tab branch")
    return s.slice(start, end)
  }

  it("has no Search button in the toolbar", () => {
    const tab = existingTab()
    // This one *had* an onClick, which made it harder to spot: `fetchExistingAds(true)` — the
    // exact handler the Refresh button beside it already used.
    assert.doesNotMatch(tab, /<IconSearch className="size-3\.5" \/>Search/)
  })

  it("never sent the query to the API, which is why the button could not work", () => {
    const s = src()
    const fetcher = s.slice(s.indexOf("const fetchExistingAds = async"), s.indexOf("const filteredExisting"))
    assert.doesNotMatch(fetcher, /existingSearch/, "if the query is ever sent, this row needs rethinking, not just a button")
  })

  it("keeps the live client-side filter that does the searching", () => {
    assert.match(src(), /const filteredExisting = existingAds\.filter\(a =>\s*\n?\s*!existingSearch \|\| a\.name\.toLowerCase\(\)\.includes\(existingSearch\.toLowerCase\(\)\)/)
  })

  it("keeps Refresh, which is the behaviour the Search button actually had", () => {
    const tab = existingTab()
    assert.match(tab, /onClick=\{\(\) => fetchExistingAds\(true\)\} disabled=\{existingLoading\}/)
  })

  it("drops the toolbar's inert Include dropdown but keeps the footer's real one", () => {
    const s = src()
    // Two controls labelled "Include": checkboxes with no onChange in the toolbar, and the
    // Creatives/Full/Ad-settings mode picker in the footer. Only the second one did anything.
    assert.doesNotMatch(s, /"Archived ads", "Deleted ads", "Inactive ads"/)
    assert.match(s, /existingIncludeMode === "creatives" \? "Creatives only"/)
    // The footer picker shares this state, so the removal must not have taken it with it.
    assert.match(s, /const \[existingIncludeOpen, setExistingIncludeOpen\] = useState\(false\)/)
  })
})

describe("Load Media: only filters that filter", () => {
  const DEAD = ["uploader", "channels", "workspace", "source"]
  const LIVE = ["fileType", "status", "dimensions", "dateAdded"]

  for (const id of DEAD) {
    it(`does not render an inert ${id} chip`, () => {
      assert.doesNotMatch(src(), new RegExp(`<FilterChip id="${id}"`))
    })

    it(`drops ${id} from the filters state, so nothing can set it`, () => {
      // Leaving the key would leave ClearFiltersButton resetting a field with no control.
      const state = src()
      const block = state.slice(state.indexOf("const [filters, setFilters] = useState<{"), state.indexOf("const [portalTree"))
      assert.doesNotMatch(block, new RegExp(`\\b${id}\\b`))
    })
  }

  for (const id of LIVE) {
    it(`keeps ${id}, which the predicate actually reads`, () => {
      assert.match(src(), new RegExp(`filters\\.${id} !== "all"`))
    })
  }

  it("populates every remaining chip's options from data or a fixed set", () => {
    const s = src()
    const opts = s.slice(s.indexOf("const filterOptions = {"), s.indexOf("// Media Library uses fbMedia"))
    // The removed four were `[] as string[]`. No survivor may be empty.
    assert.doesNotMatch(opts, /\[\] as string\[\]/, "an empty option list is a chip that cannot do anything")
  })
})

describe("Load Media: one toolbar instead of three rows", () => {
  it("puts the media actions in the same row as the search input", () => {
    const tab = libraryTab()
    const toolbarEnd = tab.indexOf("<FilterChip")
    const toolbar = tab.slice(0, toolbarEnd)
    for (const action of ["Upload New Media", "Upload Folder", "Refresh list", "Paste list"]) {
      assert.ok(toolbar.includes(action), `${action} must sit in the toolbar, above the filter row`)
    }
    // The overflow menu and the upload-pause indicator came along with them.
    assert.match(toolbar, /aria-label="More actions"/)
    assert.match(toolbar, /uploadPauseMsg/)
  })

  it("leaves exactly two bordered rows between the tabs and the table header", () => {
    const tab = libraryTab()
    const head = tab.slice(0, tab.indexOf("{/* Table header */}"))
    const rows = head.match(/border-b shrink-0/g) || []
    assert.equal(rows.length, 2, `expected toolbar + filters, found ${rows.length} bordered rows`)
  })

  it("keeps the toolbar usable at narrow widths", () => {
    const tab = libraryTab()
    const toolbar = tab.slice(0, tab.indexOf("<FilterChip"))
    // Without wrap + a min width the input collapses to nothing beside five buttons.
    assert.match(toolbar, /flex flex-wrap items-center/)
    assert.match(toolbar, /min-w-\[220px\]/)
    // Labels collapse to icons rather than overflowing.
    assert.ok((toolbar.match(/hidden sm:inline/g) || []).length >= 4)
  })
})

describe("Load Media: the date chip and clear button exist once", () => {
  it("defines each once", () => {
    const s = src()
    assert.equal((s.match(/const DateChip = \(\) =>/g) || []).length, 1)
    assert.equal((s.match(/const ClearFiltersButton = \(/g) || []).length, 1)
  })

  it("uses both from the Library and the Vault tab", () => {
    const s = src()
    // Two copies of this markup had already drifted apart — the Library one was missing the
    // cursor and focus-ring classes every other chip in the file carries.
    assert.equal((s.match(/<DateChip \/>/g) || []).length, 2)
    assert.equal((s.match(/<ClearFiltersButton keys=/g) || []).length, 2)
  })

  it("scopes Clear filters to the calling tab's own filters", () => {
    const s = src()
    // Testing every key made Brand (Vault-only) light up Clear filters in the Library tab.
    assert.match(s, /<ClearFiltersButton keys=\{\["fileType", "status", "dimensions", "dateAdded"\]\}/)
    assert.match(s, /<ClearFiltersButton keys=\{\["brand", "product", "language", "dateAdded"\]\}/)
    assert.match(s, /if \(!keys\.some\(k => filters\[k\] !== "all"\)\) return null/)
  })
})
