import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const producers = await Promise.all([
  "../app/api/facebook/launch/route.ts",
  "../app/api/facebook/launch-direct/route.ts",
  "../app/api/facebook/launch-table-batch/route.ts",
  "../app/api/facebook/create-campaign/route.ts",
].map(path => readFile(new URL(path, import.meta.url), "utf8")))

test("launch batch total_ads stores successful creations; consumers must not subtract failed_ads", () => {
  for (const source of producers) assert.match(source, /total_ads:\s*(?:allResults|created|totalCreated)\.length|total_ads:\s*totalCreated|total_ads:\s*1/)
})
