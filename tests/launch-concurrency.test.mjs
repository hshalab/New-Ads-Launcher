import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { mapWithConcurrency } from "../lib/bounded-concurrency.ts"

describe("bounded launch concurrency", () => {
  it("caps active work and preserves input order", async () => {
    let active = 0
    let maxActive = 0
    const completed = []
    const results = await mapWithConcurrency([40, 5, 25, 10, 20, 1], 3, async (delay, index) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, delay))
      completed.push(index)
      active--
      return `result-${index}`
    })

    assert.equal(maxActive, 3)
    assert.notDeepEqual(completed, [0, 1, 2, 3, 4, 5])
    assert.deepEqual(results, ["result-0", "result-1", "result-2", "result-3", "result-4", "result-5"])
  })

  it("rejects invalid limits", async () => {
    await assert.rejects(() => mapWithConcurrency([1], 0, async value => value), RangeError)
  })
})

describe("launch route wiring", () => {
  const routes = [
    "app/api/facebook/launch/route.ts",
    "app/api/facebook/launch-direct/route.ts",
    "app/api/facebook/launch-table-batch/route.ts",
  ]

  it("uses concurrency 3 in every ad-creating launch route", () => {
    for (const route of routes) {
      const source = readFileSync(join(process.cwd(), route), "utf8")
      assert.match(source, /mapWithConcurrency/)
      assert.match(source, /mapWithConcurrency\([^\n]+, 3,/)
      assert.match(source, /launch_batches/)
    }
  })

  it("keeps one-ad-per-ad-set copy before its dependent ad write", () => {
    for (const route of routes.slice(1)) {
      const source = readFileSync(join(process.cwd(), route), "utf8")
      assert.match(source, /mapWithConcurrency[\s\S]+copyAdSet[\s\S]+createAd/)
    }
  })
})
