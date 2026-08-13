import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const route = await readFile(new URL("../app/api/launch-history/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/(dashboard)/launch/page.tsx", import.meta.url), "utf8")

test("Scheduled tab reads scheduled_activations instead of rendering a hardcoded empty state", () => {
  assert.match(route, /from\("scheduled_activations"\)/)
  assert.match(route, /\.eq\("org_id", ctx\.orgId\)/)
  assert.match(page, /params\.set\("scheduled", "1"\)/)
  assert.match(page, /filteredScheduled\.map/)
})
