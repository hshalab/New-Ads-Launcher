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
})
