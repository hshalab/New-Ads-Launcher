import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = path => readFileSync(join(process.cwd(), path), "utf8")

describe("Duplicate ad cross-campaign destination contract", () => {
  it("loads account-wide ad sets instead of reusing the current hierarchy page", () => {
    const page = read("app/(dashboard)/ads-manager/page.tsx")

    assert.match(page, /duplicateAdSetOptions/)
    assert.match(page, /\/api\/facebook\/adsets\?ad_account_id=\$\{encodeURIComponent\(selectedAccountId\)\}&date_preset=last_7d/)
    assert.match(page, /adSet\.status === "ACTIVE" \|\| adSet\.status === "PAUSED"/)
    assert.match(page, /filteredDuplicateAdSetOptions\.map/)
    assert.match(page, /role="listbox" className="max-h-60 overflow-y-auto/)
    assert.match(page, /placeholder="Search campaign or ad set"/)
    assert.doesNotMatch(page, /\{adSets\.map\(adSet => <option key=\{adSet\.id\} value=\{adSet\.id\}>\{adSet\.name\}<\/option>\)\}/)
    assert.doesNotMatch(page, /<select[^>]*id="duplicate-target-adset"/)
  })

  it("keeps the existing ownership-checked target_adset_id write seam", () => {
    const page = read("app/(dashboard)/ads-manager/page.tsx")
    const route = read("app/api/facebook/duplicate/route.ts")

    assert.match(page, /target_adset_id: duplicateDestination === "existing" \? duplicateTargetId : undefined/)
    assert.match(route, /getResourceAccountId\(target_adset_id/)
    assert.match(route, /Target ad set access denied/)
  })

  it("separates AdLauncher workflow from Meta delivery status at every level", () => {
    const page = read("app/(dashboard)/ads-manager/page.tsx")
    const campaignRoute = read("app/api/facebook/campaigns/[id]/duplicate/route.ts")
    const adSetRoute = read("app/api/facebook/campaigns/duplicate-adsets/route.ts")
    const adRoute = read("app/api/facebook/duplicate/route.ts")

    // The recommendation step is back, but the CTAs it once carried are not.
    assert.doesNotMatch(page, /Apply and duplicate|>\s*Choose destination\s*</)
    assert.match(page, /"Keep in the same ad set"/)
    assert.match(page, /"Copy to another ad set"/)
    assert.match(page, /different ad set or campaign/)
    // Meta rejects INHERITED on these copy endpoints, so the delivery axis is a two-way toggle.
    assert.doesNotMatch(page, /"source", "Match source"/)
    assert.doesNotMatch(page, /\? "INHERITED"/)
    assert.match(page, /useState<"paused" \| "active">\("paused"\)/)
    assert.match(page, /"paused", "Paused"/)
    assert.match(page, /"active", "On"/)
    assert.match(page, /const statusOption = duplicateDeliveryStatus === "active" \? "ACTIVE" : "PAUSED"/)
    assert.match(page, /Draft\/Publish controls the AdLauncher editing workflow only/)
    assert.match(page, /executeDuplicate\("draft"\)/)
    assert.match(page, /executeDuplicate\("publish"\)/)
    assert.match(page, /\n\s+Save as draft\r?\n/)
    assert.match(page, /\n\s+Publish duplicate\r?\n/)
    assert.match(campaignRoute, /\["ACTIVE", "PAUSED", "INHERITED"\]\.includes\(body\.statusOption\)/)
    assert.match(campaignRoute, /status_option: status/)
    assert.match(adSetRoute, /\["ACTIVE", "PAUSED", "INHERITED"\]\.includes\(cfg\.statusOption\)/)
    assert.match(adSetRoute, /status_option: statusOption/)
    assert.match(adRoute, /\["ACTIVE", "PAUSED", "INHERITED"\]\.includes\(status_option\)/)
    assert.match(adRoute, /status_option: statusOption/)
  })
})

describe("Duplicate wizard contract (recommendation gate → one destination screen)", () => {
  const page = read("app/(dashboard)/ads-manager/page.tsx")

  it("opens on the recommendation step with the tick already on", () => {
    assert.match(page, /type DuplicateStep = "recommend" \| "destination" \| "options" \| "gate"/)
    assert.match(page, /useState\(true\)\r?\n\s*const \[duplicateRec2, setDuplicateRec2\] = useState\(true\)/)
    assert.match(page, /setDuplicateStep\(tab === "campaigns" \? "options" : "recommend"\)/)
    assert.match(page, /Choose recommendations to apply/)
  })

  it("names the recommendation CTA after what the tick does — Duplicate when on, Continue when off", () => {
    const footer = page.slice(page.indexOf('{duplicateStep === "recommend" ? ('), page.indexOf('} : duplicateStep === "destination" ? ('))
    assert.match(footer, /Close/)
    assert.match(footer, /\{duplicateRecApplied \? "Duplicate" : "Continue"\}/)
    // The two CTAs removed earlier stay removed.
    assert.doesNotMatch(footer, /Choose destination/)
  })

  it("sends the applied path to a warning gate instead of publishing immediately", () => {
    assert.match(page, /setDuplicateStep\(duplicateRecApplied \? "gate" : tab === "ads" \? "destination" : "options"\)/)
    assert.match(page, /Nothing has been created on Meta yet/)
    // The gate must keep the draft escape hatch, not only a publish button.
    const gateFooter = page.slice(page.indexOf('Nothing has been created on Meta yet'))
    assert.match(gateFooter, /executeDuplicate\("draft"\)/)
  })

  it("decides campaign and ad set on one screen, greying out the impossible ad set options", () => {
    assert.match(page, /if \(duplicateStep === "destination"\) setDuplicateStep\("options"\)/)
    assert.match(page, /Select a campaign for your ads/)
    assert.match(page, /Select an ad set for your ads/)
    assert.match(page, /\["original", "Keep in the same campaign"/)
    assert.match(page, /\["existing", "Copy to another campaign"/)
    assert.match(page, /\["new", "Create a new campaign"/)
    // Rendered but disabled — never filtered out, so the buyer sees why the choice is closed.
    assert.match(page, /const optionDisabled = !canPickAdSetDestination\(option\)/)
    assert.match(page, /disabled=\{optionDisabled\}/)
    assert.doesNotMatch(page, /\.filter\(canPickAdSetDestination\)/)
    // Continue is blocked until both halves of the screen are valid.
    assert.match(page, /duplicateStep === "destination" \? campaignStepValid && adSetStepValid : true/)
  })

  it("copies N selected ads into ONE new ad set instead of one ad set per ad", () => {
    assert.match(page, /const duplicateAdsIntoNewAdSet = async \(\) => \{/)
    assert.match(page, /if \(tab === "ads" && duplicateDestination === "new"\) await duplicateAdsIntoNewAdSet\(\)/)
    // Every selected ad of one source ad set travels in a single config, so Meta copies that ad set once.
    assert.match(page, /selectedAdIds: groupAds\.map\(ad => ad\.id\)/)
    assert.match(page, /adSetConfigs: \[\.\.\.byAdSet\]\.map/)
    // The loop must not re-run the same call per ad.
    assert.match(page, /for \(const id of \(tab === "ads" && duplicateDestination === "new" \? \[\] : ids\)\)/)
  })

  it("routes the chosen campaign into the duplicate write", () => {
    assert.match(page, /targetCampaignIds: duplicateAdCampaignDestination === "new"/)
    assert.match(page, /newCampaignName: duplicateAdCampaignDestination === "new"/)
    // An ad set from another campaign is never offered, and "original" is impossible once the campaign moves.
    assert.match(page, /duplicateAdCampaignDestination !== "existing" \|\| adSet\.campaign_id === duplicateAdCampaignTargetId/)
    assert.match(page, /if \(duplicateAdCampaignDestination === "new"\) return option === "new"/)
    assert.match(page, /if \(duplicateAdCampaignDestination === "existing"\) return option !== "original"/)
  })
})
