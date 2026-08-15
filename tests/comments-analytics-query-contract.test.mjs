import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const routeUrl = new URL("../app/api/comments/analytics/route.ts", import.meta.url)

test("comment analytics selects only the columns it aggregates", async () => {
  const route = await readFile(routeUrl, "utf8")

  // `select("*")` on `comments` ships the comment body and every Meta id for every
  // row in the window, to compute five numbers that never read them.
  assert.doesNotMatch(route, /from\("comments"\)\.select\("\*"\)/)

  const select = route.match(/const ANALYTICS_SELECT = "([^"]+)"/)
  assert.ok(select, "expected a named ANALYTICS_SELECT column list")
  const selected = new Set(select[1].split(",").map(column => column.trim()))

  // The guard that matters: narrowing the select is only safe while every column the
  // aggregation reads off a row is in the list. A new `c.<column>` in the reducers
  // without a matching column here reads `undefined` at runtime and silently skews
  // the totals — no error, just wrong numbers.
  const read = new Set([...route.matchAll(/\bc\.(\w+)/g)].map(match => match[1]))
  for (const column of read) {
    assert.ok(selected.has(column), `aggregation reads c.${column} but ANALYTICS_SELECT omits it`)
  }
})

test("comment analytics fetches its two windows concurrently", async () => {
  const route = await readFile(routeUrl, "utf8")

  // Current and previous windows are disjoint and independent. Awaiting them in
  // sequence doubles the latency of the page-manager comments panel for nothing.
  assert.match(route, /await Promise\.all\(\[q, qp\]\)/)
})
