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

  it("gives Ad the preview rail and Ad Set the insights rail, and Campaign neither", () => {
    // The rail is shared chrome now: preview at the ad, audience estimate + recommendations at the
    // ad set. Campaign has no targeting, so an audience estimate there would be a number about
    // nothing — that is why hasRail excludes it.
    assert.match(editor, /const hasRail = level === "ad" \|\| level === "adset"/)
    assert.match(editor, /\{hasRail && \(\s*<aside/)
    assert.match(editor, /\{level === "ad" && \(\s*<section/)
    assert.match(editor, /<EstimatedAudienceCard/)
    assert.match(editor, /<CampaignRecommendationsCard/)
    assert.doesNotMatch(editor, /Advanced preview/i)
    assert.match(editor, /Advanced multi-placement preview is deferred to BL-39/)
  })

  it("estimates the audience from the targeting Meta would actually receive", () => {
    // A different targeting object would make the number a confident lie about a different
    // audience, so the rail maps the draft into the same TargetingInput the create route uses.
    assert.match(editor, /const estimateTargeting: TargetingInput/)
    assert.match(editor, /locations: draft\?\.targeting\?\.geo_locations\?\.countries \|\| \[\]/)
    assert.match(editor, /optimizationGoal=\{draft\.optimization_goal \|\| ""\}/)
    assert.ok(editor.indexOf("const estimateTargeting") < editor.indexOf("if (loading && !draft)"))
    assert.ok(editor.indexOf("const adSetRecommendations") < editor.indexOf("if (loading && !draft)"))
    assert.ok(editor.indexOf("const estimateTargeting") < editor.indexOf("if (level === \"ad\" && !readOnly && pagesLoading"))
    assert.ok(editor.indexOf("const adSetRecommendations") < editor.indexOf("if (level === \"ad\" && !readOnly && pagesLoading"))
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

  it("keeps required rows open and moves secondary options behind pencils", () => {
    assert.match(editor, /import \{ EditableCard, EditableCardBlock, EditableField \}/)
    assert.match(editor, /title="Campaign structure"/)
    assert.match(editor, /id="special-ad-categories"/)
    assert.match(editor, /id="attribution-setting"/)
    assert.match(editor, /id="text-variations"/)
    assert.match(editor, /id="url-parameters"/)
    assert.match(editor, /id="one-ad-per-adset"/)
  })

  it("wires Editor MTO and URL parameters without Dynamic Creative", () => {
    assert.match(editor, /<VariationFields draft=\{draft\} updateCreative=\{updateCreative\}/)
    assert.match(editor, /url_parameters: event\.target\.value/)
    const publish = read("app/api/ads-manager/workspace-publish/route.ts")
    assert.match(publish, /omit_degrees_of_freedom_spec: true/)
    assert.match(publish, /url_tags: change\.node\.url_parameters/)
    assert.match(publish, /special_ad_categories: change\.level === "campaign" \? change\.node\.special_ad_categories : undefined/)
  })

  it("keeps Special Ad Categories always visible, not pencil-collapsed", () => {
    // Compliance-weighted: hiding it behind a pencil was the bug — it must render every time the
    // Campaign structure card is open, read-only or not.
    const specialAdCategoriesBlock = editor.slice(
      editor.indexOf('id="special-ad-categories"'),
      editor.indexOf('id="special-ad-categories"') + 200
    )
    assert.match(specialAdCategoriesBlock, /always/)
  })

  it("edits schedule_time_basis at the ad set as a pencil field, converts to UTC before it reaches Meta", () => {
    // The basis is a display preference only — Meta never sees it. Both wire fields stay pure UTC
    // ISO regardless of which basis produced them, so publish needs no new transform.
    assert.match(editor, /id="schedule-time-basis"/)
    assert.match(editor, /draft\.schedule_time_basis === "utc" \? "UTC" : `Ad account time/)
    assert.match(editor, /value=\{draft\.schedule_time_basis \|\| "account"\}/)
    assert.match(editor, /onChange=\{event => setDraft\(\{ \.\.\.draft, schedule_time_basis: event\.target\.value as "account" \| "utc" \}\)\}/)
    assert.match(editor, /function scheduleToUtc\(value: string, basis: "account" \| "utc", timezoneName\?: string\)/)
    assert.match(editor, /wallClockToUtcIso\(value, timezoneName\)/)
    // No new payload field — updateNode/materialize keep taking start_time/end_time as UTC ISO.
    const publish = read("app/api/ads-manager/workspace-publish/route.ts")
    assert.doesNotMatch(publish, /schedule_time_basis/)
    // timezoneName reaches the editor from both PerformancePopup mount points.
    const popup = read("components/ads-manager/PerformancePopup.tsx")
    assert.match(popup, /timezoneName\?: string/)
    assert.match(popup, /timezoneName=\{timezoneName\}/)
    const table = read("app/(dashboard)/ads-manager/page.tsx")
    assert.match(table, /timezoneName=\{selectedAccount\?\.timezone_name\}/)
    const route = read("components/ads-manager/AdsManagerEditorRoute.tsx")
    assert.match(route, /timezoneName=\{selectedAccount/)
  })

  it("wraps Audience secondary rows behind pencils, keeps Placements as one always-visible block", () => {
    // Detailed targeting/expansion and custom/excluded audiences are single-value read-only
    // summaries — they get individual EditableField rows. Placements is a radio-driven checkbox
    // grid with no single value to summarize, so it stays one EditableCardBlock instead of being
    // forced into fields it doesn't fit.
    assert.match(editor, /<EditableCard<WorkspaceNode>\s*\n?\s*title="Audience"/)
    assert.match(editor, /id="audience-locations"/)
    assert.match(editor, /id="audience-min-age"/)
    assert.match(editor, /id="detailed-targeting-expansion"/)
    assert.match(editor, /id="custom-audiences-include"/)
    assert.match(editor, /id="excluded-custom-audiences"/)
    assert.match(editor, /lockedReason="Custom audience membership is managed in Meta Ads Manager, not here\."/)
    assert.match(editor, /<EditableCard<WorkspaceNode> title="Placements" readOnly snapshot=\{draft\} onRestore=\{setDraft\}>/)
    assert.match(editor, /<EditableCardBlock>[\s\S]*placementMode[\s\S]*<\/EditableCardBlock>/)
    // Always-visible fields the coordinator named must survive the pass unchanged.
    assert.match(editor, /<LocationsField/)
    assert.match(editor, /Minimum age \(control\)/)
  })

  it("packages ad-set locations behind a pencil, not always-visible", () => {
    // Owner correction: locations moved from the always block into its own pencil row. A buyer
    // must be able to confirm geo targeting from the collapsed summary alone.
    const locationsFieldBlock = editor.slice(
      editor.indexOf('id="audience-locations"'),
      editor.indexOf('id="audience-locations"') + 400
    )
    assert.doesNotMatch(locationsFieldBlock, /\balways\b/)
    assert.match(locationsFieldBlock, /display=\{locationsSummary\(/)
    assert.match(editor, /function locationsSummary\(geo\?: GeoLocations, excluded\?: GeoLocations\)/)
    // Age/gender stays always-visible — only locations collapsed in this change.
    const minAgeBlock = editor.slice(
      editor.indexOf('id="audience-min-age"'),
      editor.indexOf('id="audience-min-age"') + 100
    )
    assert.match(minAgeBlock, /\balways\b/)
    // Collapse must not change what reaches Meta: geo/excluded still spread the whole object and
    // still let excluded_geo_locations go absent (not empty) to remove every exclusion.
    assert.match(editor, /geo_locations: geo,/)
    assert.match(editor, /excluded_geo_locations: excluded,/)
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

describe("Feedback entry point stays available on the Editor route", () => {
  const bubble = read("components/feedback-bubble.tsx")

  it("does not suppress the trigger on /ads-manager/editor", () => {
    // The Editor is the surface used most — removing the entry point there was an overcorrection
    // of the original overlap bug. Fix is a route-scoped reposition, not a route-scoped bail-out.
    assert.doesNotMatch(bubble, /if \(pathname\?\.startsWith\("\/ads-manager\/editor"\)\) return null/)
  })

  it("shifts clear of the Editor footer (Close/Save Draft/Publish) instead of overlapping it", () => {
    assert.match(bubble, /const isEditorRoute = pathname\?\.startsWith\("\/ads-manager\/editor"\)/)
    assert.match(bubble, /isEditorRoute \? "bottom-28" : "bottom-6"/)
  })
})
