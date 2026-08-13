import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const route = await readFile(new URL("../app/api/launch-history/route.ts", import.meta.url), "utf8")

test("destructive launch-history actions require delete-capable roles despite service-role DB access", () => {
  const guards = route.match(/requireRole\(ctx, new Set\(\["admin", "editor"\]\)\)/g) || []
  assert.equal(guards.length, 2)
})
