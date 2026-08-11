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
    assert.match(editor, /flex min-h-0 min-w-0 flex-col bg-white/)
    assert.match(editor, /shrink-0 border-b border-\[#e4e6eb\]/)
    assert.match(editor, /min-h-0 flex-1 overflow-y-auto/)
    assert.match(editor, /shrink-0 space-y-3 border-t border-\[#e4e6eb\]/)
    assert.match(editor, /By clicking Publish, you acknowledge that your use of Meta/)
    assert.match(editor, /Close/)
    assert.match(editor, /Discard draft/)
    assert.match(editor, /\{publishing \? "Publishing…" : "Publish"\}/)
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
    // "Create template" survives only as prose inside the hidden-note, never as a control.
    assert.doesNotMatch(editor, /<Button[^>]*>\s*Create template/)
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

  it("states absent surfaces instead of rendering empty editable shells", () => {
    assert.match(editor, /function HiddenNote/)
    assert.match(editor, /tracking_specs/)
    assert.match(editor, /Languages &amp; translations/)
    assert.match(editor, /placement value rules, brand safety/)
  })

  it("splits Audience Controls vs Suggest and orders transparency before placements", () => {
    assert.match(editor, /Controls/)
    assert.match(editor, /Suggest an audience/)
    assert.match(editor, /Minimum age/)
    assert.match(editor, /Bid strategy/)
    assert.match(editor, /Object\.entries\(BID_LABEL\)\.map/)
    assert.doesNotMatch(editor, /Search interests, behaviors, demographics/i)
    assert.match(editor, /No locations loaded/)
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
})
