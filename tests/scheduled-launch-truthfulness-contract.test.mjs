import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const direct = await readFile(new URL("../app/api/facebook/launch-direct/route.ts", import.meta.url), "utf8")
const table = await readFile(new URL("../app/api/facebook/launch-table-batch/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/(dashboard)/launch/page.tsx", import.meta.url), "utf8")

test("scheduled launch never reports success when the activation row was not persisted", () => {
  assert.match(direct, /error: activationError/)
  assert.match(direct, /scheduled: scheduledStart && !scheduleError/)
  assert.match(table, /scheduleErrors\.length > 0/)
  assert.match(page, /scheduleError/)
})
