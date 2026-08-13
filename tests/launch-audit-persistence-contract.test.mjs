import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const routes = [
  "../app/api/facebook/launch/route.ts",
  "../app/api/facebook/launch-direct/route.ts",
  "../app/api/facebook/launch-table-batch/route.ts",
]

test("all launch producers surface audit persistence failure after Meta mutation", async () => {
  for (const route of routes) {
    const source = await readFile(new URL(route, import.meta.url), "utf8")
    assert.match(source, /auditError/)
    assert.match(source, /Ads were created in Meta, but Launch History could not be saved/)
  }
})

test("launch UIs warn against blind retry when audit persistence fails", async () => {
  const page = await readFile(new URL("../app/(dashboard)/launch/page.tsx", import.meta.url), "utf8")
  const dialog = await readFile(new URL("../components/launch-ads-dialog.tsx", import.meta.url), "utf8")

  for (const source of [page, dialog]) {
    assert.match(source, /auditError/)
    assert.match(source, /Do not retry blindly/)
  }
})
