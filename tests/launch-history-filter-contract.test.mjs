import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const page = await readFile(new URL("../app/(dashboard)/launch/page.tsx", import.meta.url), "utf8")

test("history tab state and search match the visible controls", () => {
  assert.match(page, /setStatusFilter\("all"\)/)
  assert.match(page, /b\.id\.toLowerCase\(\)\.includes\(q\)/)
  assert.match(page, /b\.created_ads\?\.some\(ad => ad\.fileName/)
  assert.match(page, /if \(res\.ok\) setDrafts/)
})
