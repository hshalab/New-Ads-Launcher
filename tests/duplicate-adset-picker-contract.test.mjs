import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = path => readFileSync(join(process.cwd(), path), "utf8")

const page = read("app/(dashboard)/launch/page.tsx")
const facebook = read("lib/facebook.ts")

/** The picker's prefix helper, lifted verbatim so the rule itself is tested, not just its presence. */
const source = /function sharedNamePrefix\(names: string\[\]\): string \{[\s\S]*?\n\}/.exec(page)?.[0] ?? ""
const sharedNamePrefix = new Function(
  "names",
  source.replace(/function sharedNamePrefix\(names: string\[\]\): string \{/, "").replace(/\}$/, "")
    .replace(/: string/g, "").replace(/let prefix = /, "let prefix = ")
)

describe("Duplicate ad set picker separates identically named ad sets", () => {
  it("carries the campaign and spend the adsets API already returns", () => {
    // getAdSets asks for both; the picker was the only place dropping them.
    assert.match(facebook, /"campaign_id", "campaign\{name\}"/)
    assert.match(facebook, /insights\.date_preset\(\$\{datePreset\}\)\{\$\{ADS_MANAGER_INSIGHT_FIELDS\}\}/)
    assert.match(page, /insights\?: \{ data\?: \{ spend\?: string \}\[\] \}/)
  })

  it("groups ad sets under one campaign header instead of repeating a truncated line", () => {
    assert.match(page, /const campaignGroups = \(\(\) => \{/)
    assert.match(page, /campaignGroups\.map\(group => \(/)
    assert.match(page, /sticky top-0 z-10/)
    // The header must wrap, never truncate — truncation is what hid the tail.
    assert.match(page, /text-xs font-medium leading-snug break-words/)
    assert.doesNotMatch(page, /\{a\.campaign_name \|\| "Campaign unavailable"\}/)
  })

  it("shows spend at both the campaign and the ad set level", () => {
    assert.match(page, /const adSetSpend = \(a: AdSet\) => Number\(a\.insights\?\.data\?\.\[0\]\?\.spend \|\| 0\)/)
    assert.match(page, /\{group\.adSets\.length\} ad set\{group\.adSets\.length > 1 \? "s" : ""\} · \{formatCurrency\(group\.spend\)\}/)
    assert.match(page, /\{formatCurrency\(adSetSpend\(a\)\)\} · 7d/)
    // Busiest campaigns and ad sets first — the list is a picker, not a ledger.
    assert.match(page, /list\.sort\(\(x, y\) => y\.spend - x\.spend\)/)
    assert.match(page, /group\.adSets\.sort\(\(x, y\) => adSetSpend\(y\) - adSetSpend\(x\)\)/)
  })

  it("matches the campaign name when searching, not just the ad set name", () => {
    assert.match(page, /\(a\.campaign_name \|\| ""\)\.toLowerCase\(\)\.includes\(search\.toLowerCase\(\)\)/)
    assert.match(page, /placeholder="Search by Ad Set name, campaign or ID"/)
  })

  it("confirms the selection by campaign, without truncating it", () => {
    assert.match(page, /In <span className="font-medium text-foreground">\{sourceAdSet\.campaign_name \|\| "an unavailable campaign"\}<\/span>/)
    assert.match(page, /mt-2 text-xs text-muted-foreground leading-snug break-words/)
  })
})

describe("sharedNamePrefix dims only what is genuinely shared", () => {
  it("finds the common opening and cuts it at a separator", () => {
    assert.equal(
      sharedNamePrefix(["PATI | Q3 | VN | Retarget", "PATI | Q3 | VN | Prospecting"]),
      "PATI | Q3 | VN | "
    )
  })

  it("never splits a word mid-way", () => {
    // "Summer" and "Summit" share "Summ" — not a separator boundary, so nothing is dimmed.
    assert.equal(sharedNamePrefix(["Campaign Summer", "Campaign Summit"]), "Campaign ")
    assert.equal(sharedNamePrefix(["Summer sale", "Summit sale"]), "")
  })

  it("stays silent when there is nothing worth dimming", () => {
    assert.equal(sharedNamePrefix([]), "")
    assert.equal(sharedNamePrefix(["Only one campaign"]), "", "a single group has no shared part")
    assert.equal(sharedNamePrefix(["Alpha", "Beta"]), "", "no common opening")
    assert.equal(sharedNamePrefix(["AB | x", "AB | y"]), "", "too short to be worth dimming")
  })

  it("refuses a prefix that would blank out a whole name", () => {
    // "PATI | Q3 | " is common, but the first name is exactly that — dimming it
    // all would render an apparently empty header.
    assert.equal(sharedNamePrefix(["PATI | Q3 | ", "PATI | Q3 | VN"]), "")
  })
})
