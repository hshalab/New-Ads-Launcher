import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const page = await readFile(new URL("../app/(dashboard)/launch/page.tsx", import.meta.url), "utf8")
const tableRoute = await readFile(new URL("../app/api/facebook/launch-table-batch/route.ts", import.meta.url), "utf8")

test("Gallery and Table launch gate on Meta asset IDs, not creatives.status", () => {
  assert.match(page, /selectedCreatives\.filter\(c => !isLaunchable\(c\)\)/)
  assert.match(tableRoute, /allCreatives \|\| \[\]\)\.filter\(\(c: any\) => !isLaunchable\(c\)\)/)
  assert.doesNotMatch(page, /selectedCreatives\.filter\(c => c\.status !== "ready"\)/)
  assert.doesNotMatch(tableRoute, /allCreatives \|\| \[\]\)\.filter\(\(c: any\) => c\.status !== "ready"\)/)
})
