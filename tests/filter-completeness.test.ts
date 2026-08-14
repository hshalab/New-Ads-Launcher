import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { isValidDateOnly, localDateRangeToUtc } from "../lib/local-date-range"

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

describe("local calendar boundaries", () => {
  it("includes the complete local day instead of cutting at UTC midnight", () => {
    const range = localDateRangeToUtc("2026-08-14", "2026-08-14", -420)
    assert.deepEqual(range, {
      startIso: "2026-08-13T17:00:00.000Z",
      endExclusiveIso: "2026-08-14T17:00:00.000Z",
    })
  })

  it("rejects invalid date-only values", () => {
    assert.deepEqual(localDateRangeToUtc("2026-02-30", "nope", -420), {})
    assert.equal(isValidDateOnly("2026-02-30"), false)
    assert.equal(isValidDateOnly("2024-02-29"), true)
  })
})

describe("filter completeness contracts", () => {
  it("drains Ads Manager cursors for search, chips, and Paused", () => {
    const page = read("app/(dashboard)/ads-manager/page.tsx")
    assert.match(page, /search\.trim\(\) \|\| chips\.length > 0 \|\| statusFilter === "PAUSED"/)
    assert.match(page, /void fetchAllRemainingRows\(\)/)
    assert.match(page, /const range = \(datePreset === "custom" \|\| datePreset === "maximum"\)/)
    assert.match(page, /return `time_range=/)
  })

  it("filters Assets before pagination and returns complete facets", () => {
    const page = read("app/(dashboard)/assets/page.tsx")
    const route = read("app/api/creatives/route.ts")
    assert.match(page, /params\.set\("readiness", filterStatus\)/)
    assert.match(page, /params\.set\("timezone_offset", String\(new Date\(\)\.getTimezoneOffset\(\)\)\)/)
    assert.match(route, /const scoped = rows\.map/)
    assert.match(route, /const filtered = scoped\.filter/)
    assert.match(route, /const sorted = sortCreativesByLatestAssignment\(filtered\)/)
    assert.match(route, /facets,/)
    assert.match(route, /total: sorted\.length/)
    assert.match(route, /date_from must not be after date_to/)
  })

  it("follows complete Ad Account and snapshot pagination", () => {
    const facebook = read("lib/facebook.ts")
    const metrics = read("app/api/facebook/ad-account-metrics/route.ts")
    assert.match(facebook, /while|for \(let page = 0; url && page < 100/)
    assert.match(facebook, /url = data\.paging\?\.next \|\| null/)
    assert.match(metrics, /for \(let from = 0; ; from \+= pageSize\)/)
    assert.match(metrics, /query\.lt\("synced_at", endExclusiveIso\)/)
  })

  it("uses the displayed date range and every insight page for Templates", () => {
    const hook = read("hooks/use-top-performing.ts")
    const route = read("app/api/facebook/top-performing/route.ts")
    assert.match(hook, /since: formatDateOnly\(range\.start\)/)
    assert.match(hook, /until: formatDateOnly\(range\.end\)/)
    assert.match(route, /time_range: JSON\.stringify\(\{ since, until \}\)/)
    assert.match(route, /while \(insUrl && pageCount < 100\)/)
    assert.match(route, /for \(let offset = 0; offset < sorted\.length; offset \+= 50\)/)
    assert.doesNotMatch(route, /pageCount < 5/)
    assert.match(route, /since must not be after until/)
  })

  it("does not claim every calendar is Pacific Time", () => {
    const picker = read("components/ads-manager/AdsDateRangePicker.tsx")
    assert.doesNotMatch(picker, /Dates are shown in Pacific Time/)
    assert.match(picker, /Dates use your local timezone/)
  })
})
