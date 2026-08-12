import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const read = path => readFileSync(join(root, path), "utf8")

describe("Ads Manager editor shell + MECE contract (BL-39 B8)", () => {
  const editor = read("components/ads-manager/UnifiedWorkspaceEditor.tsx")
  const popup = read("components/ads-manager/PerformancePopup.tsx")

  it("keeps top and bottom chrome as siblings of form scroll", () => {
    // Column: chrome, the scrolling middle, chrome. The middle is the only grid, so the Ad
    // preview column can never sit beside the breadcrumb or the Publish row.
    assert.match(editor, /flex h-full min-h-0 flex-col bg-\[#f5f6f7\]/)
    assert.match(editor, /shrink-0 border-b border-\[#e4e6eb\]/)
    assert.match(editor, /"grid min-h-0 flex-1 grid-cols-1"/)
    assert.match(editor, /"min-h-0 overflow-y-auto bg-white dark:bg-card"/)
    assert.match(editor, /shrink-0 space-y-3 border-t border-\[#e4e6eb\]/)
    // The two-column split is scoped to the middle row only.
    const gridIdx = editor.indexOf('"grid min-h-0 flex-1 grid-cols-1"')
    const asideIdx = editor.indexOf("<aside")
    const footerIdx = editor.indexOf("shrink-0 space-y-3 border-t")
    const headerIdx = editor.indexOf("shrink-0 border-b border-[#e4e6eb]")
    assert.ok(headerIdx < gridIdx, "chrome must open before the grid")
    assert.ok(asideIdx > gridIdx && asideIdx < footerIdx, "preview belongs inside the grid row")
    assert.match(editor, /By clicking Publish, you acknowledge that your use of Meta/)
    assert.match(editor, /Close/)
    assert.match(editor, /Discard draft/)
    // The count comes from the whole workspace, not this node, so Campaign / Ad set / Ad all
    // read the same number — that was half of red zone 2.
    assert.match(editor, /publishing \? "Publishing…" : draftCount > 1/)
    assert.match(editor, /draftCount\?: number/)
  })

  it("blocks Publish on the things Meta would reject, and says why", () => {
    assert.match(editor, /const blockers = \[/)
    assert.match(editor, /Name is required/)
    assert.match(editor, /Add at least one location/)
    assert.match(editor, /hasAnyLocation\(draft\.targeting\?\.geo_locations\)/)
    assert.match(editor, /disabled=\{!hasDraft \|\| readOnly \|\| publishing \|\| blockers\.length > 0\}/)
    // The footer states the reason at every level, not only where the blocker originates.
    assert.match(editor, /across this workspace/)
    assert.match(editor, /blockers\.join\(" · "\)/)
  })

  it("renders the trailing crumb as the title instead of repeating the name", () => {
    // Crumb tail + a second <h1> of the same name was red zone 1: three levels, three layouts.
    assert.match(editor, /const parentCrumbs = crumbs\.slice\(0, -1\)/)
    assert.match(editor, /const titleCrumb = crumbs\[crumbs\.length - 1\]/)
    assert.match(editor, /\{titleCrumb\}/)
    assert.doesNotMatch(editor, /const countries =/)
  })

  it("hoists the hierarchy toggle into the shared top chrome", () => {
    assert.match(editor, /onTogglePanel\?: \(\) => void/)
    assert.match(editor, /panelDisabled\?: boolean/)
    assert.match(editor, /aria-label=\{panelOpen \? "Hide hierarchy" : "Show hierarchy"\}/)
    assert.match(editor, /title=\{panelDisabled \? panelDisabledHint : undefined\}/)
  })

  it("parent edit pane is overflow-hidden so chrome stays fixed", () => {
    assert.match(popup, /effectiveWorkspaceView === "edit" \? "overflow-hidden"/)
  })

  it("shows hierarchy path, On/Off toggle, and kebab menu actions", () => {
    assert.match(editor, /aria-label="Hierarchy path"/)
    assert.match(editor, /statusOn \? "On" : "Off"/)
    assert.match(editor, /StatusToggle/)
    assert.match(editor, /aria-label="More options"/)
    assert.match(editor, /Review and publish/)
    assert.match(editor, /Copy ID/)
    assert.match(editor, /Duplicate · soon/)
  })

  it("uses CTA select and Facebook Page searchable dropdown on Ad", () => {
    assert.match(editor, /Call to action/)
    assert.match(editor, /Object\.entries\(CTA_LABEL\)\.map/)
    assert.match(editor, /aria-label="Facebook Page"/)
    assert.match(editor, /\/api\/facebook\/pages/)
    assert.match(editor, /Search by Page name or ID/)
    assert.match(editor, /updateCreative\(\{ page_id: page\.id \}\)/)
    assert.match(editor, /LockedControl label="Instagram profile"/)
    // No deferred-surface prose, and no "Create template" control either.
    assert.doesNotMatch(editor, /Create template/)
  })

  it("locks the Page when the ad runs an existing Page post", () => {
    // object_story_id means a dark post / existing post: replaceAdCreative cannot swap its Page.
    assert.match(editor, /const pageLocked = Boolean\(draft\.object_story_id\)/)
    assert.match(editor, /\{pageLocked \? \(/)
    assert.match(editor, /LockedControl label="Facebook Page"/)
    assert.match(editor, /This ad runs on an existing Page post/)
    assert.match(editor, /draft\.post_url/)
  })

  it("treats absent platform lists as Advantage+ placements", () => {
    assert.match(editor, /const manualPlacements = selectedPlatforms\.length > 0/)
    assert.match(editor, /delete targeting\.publisher_platforms/)
    assert.match(editor, /delete targeting\.device_platforms/)
    assert.match(editor, /Advantage\+ placements/)
    assert.match(editor, /Manual placements/)
    // Devices are editable in Manual mode; positions stay read-only this slice.
    assert.match(editor, /device_platforms: next/)
    assert.match(editor, /ReadOnlyChips label="Positions set in Meta"/)
  })

  it("renders the locked and read-only rows the specs require", () => {
    assert.match(editor, /LockedControl label="Conversion location"/)
    assert.match(editor, /DESTINATION_LABEL\[draft\.destination_type\]/)
    assert.match(editor, /LockedControl\s+label="Bid strategy"/)
    assert.match(editor, /Set at create\. Not reassigned in the editor\./)
  })

  it("keeps the preview rail on Ad only and drops the deferred rail cards", () => {
    assert.match(editor, /\{level === "ad" && \(\s*<aside/)
    assert.doesNotMatch(editor, /Recommendations/)
    assert.doesNotMatch(editor, /Advanced preview/i)
    assert.match(editor, /Advanced multi-placement preview is deferred to BL-39/)
  })

  it("does not render deferred-surface prose banners", () => {
    assert.doesNotMatch(editor, /function HiddenNote/)
    assert.doesNotMatch(editor, /Not available here/)
    assert.doesNotMatch(editor, /Not shown here/)
    assert.doesNotMatch(editor, /tracking_specs/)
  })

  it("splits Audience Controls vs Suggest and orders transparency before placements", () => {
    assert.match(editor, /Controls/)
    assert.match(editor, /Suggest an audience/)
    assert.match(editor, /Minimum age/)
    assert.match(editor, /Bid strategy/)
    assert.match(editor, /Object\.entries\(BID_LABEL\)\.map/)
    assert.doesNotMatch(editor, /Search interests, behaviors, demographics/i)
    // Locations is an editable field now, not a read-only chip list, so the empty state is a
    // publish blocker rather than "not loaded".
    assert.match(editor, /<LocationsField/)
    assert.match(editor, /excluded_geo_locations: excluded/)
    assert.match(editor, /Estimated audience size unavailable/)
    const transparencyIdx = editor.indexOf('title="Ad transparency"')
    const placementsIdx = editor.indexOf('title="Placements"')
    assert.ok(transparencyIdx > 0 && placementsIdx > transparencyIdx)
  })

  it("keeps video preview contract for Ad rail", () => {
    assert.match(editor, /videoSrc = videoId/)
    assert.match(editor, /\/api\/insights\/video-proxy\?videoId=/)
    assert.match(editor, /autoPlay/)
  })

  it("clamps preview primary text and only offers the toggle when it overflows", () => {
    assert.match(editor, /function ClampedPrimaryText/)
    assert.match(editor, /line-clamp-4/)
    // Measured after layout, not guessed from a character budget.
    assert.match(editor, /ResizeObserver/)
    assert.match(editor, /element\.scrollHeight - element\.clientHeight > 1/)
    assert.match(editor, /expanded \? "See less" : "See more"/)
  })
})

describe("Ads Manager editor shell modes (page + collapse view)", () => {
  const popup = read("components/ads-manager/PerformancePopup.tsx")
  const route = read("components/ads-manager/AdsManagerEditorRoute.tsx")
  const table = read("app/(dashboard)/ads-manager/page.tsx")

  it("renders as a page or a modal from one component", () => {
    assert.match(popup, /shell\?: "modal" \| "page"/)
    assert.match(popup, /const isPage = shell === "page"/)
    // Page mode fills the ads-manager layout slot; modal mode keeps the fixed backdrop.
    assert.match(popup, /absolute inset-y-0 right-0 z-40/)
    assert.match(popup, /fixed inset-0 z-50 bg-black\/50/)
  })

  it("collapse view uncovers the table and is disabled without one behind it", () => {
    assert.match(popup, /collapsed \? "left-\[32%\] border-l shadow-2xl" : "left-0"/)
    assert.match(popup, /canCollapse\?: boolean/)
    assert.match(popup, /disabled=\{!canCollapse\}/)
    assert.match(popup, /aria-label=\{collapsed \? "Expand to full page" : "Collapse view"\}/)
  })

  it("keeps exactly one navigator: the tree is not rendered in collapsed view", () => {
    assert.match(popup, /const treeVisible = sidebarOpen && !\(isPage && collapsed\)/)
    assert.match(popup, /\{treeVisible && \(/)
    // …and the editor's own toggle says why it is off rather than silently doing nothing.
    assert.match(popup, /panelDisabled=\{isPage && collapsed\}/)
    assert.match(popup, /panelDisabledHint="Hierarchy is off in collapsed view/)
  })

  it("survives navigation by persisting drafts per ad account", () => {
    // A route unmounts where a modal did not, so staged edits need to outlive the component.
    assert.match(popup, /loadEditorDrafts/)
    assert.match(popup, /saveEditorDrafts/)
    assert.match(popup, /flushEditorDrafts/)
    assert.match(popup, /clearEditorDrafts\(accountId\)/)
  })

  it("the table opens the editor as a route, not a modal", () => {
    assert.match(table, /router\.push\(`\/ads-manager\/editor\?\$\{editorParams\.toString\(\)\}`\)/)
    assert.match(table, /level: editorLevel/)
    assert.match(route, /shell="page"/)
    assert.match(route, /canCollapse=\{intercepted\}/)
    // Close returns to the table without stacking history when we soft-navigated in.
    assert.match(route, /router\.back\(\)/)
    assert.match(route, /router\.push\("\/ads-manager"\)/)
  })
})
