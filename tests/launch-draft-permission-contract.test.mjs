import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("launch draft mutations enforce launch roles despite service-role DB access", async () => {
  const source = await readFile(new URL("../app/api/launch-drafts/route.ts", import.meta.url), "utf8")

  assert.match(source, /import \{ getAuthContext, requireRole \} from "@\/lib\/auth"/)

  const post = source.slice(source.indexOf("export async function POST"), source.indexOf("export async function DELETE"))
  const del = source.slice(source.indexOf("export async function DELETE"))

  for (const mutation of [post, del]) {
    assert.match(mutation, /const denied = requireRole\(ctx\)/)
    assert.match(mutation, /if \(denied\) return denied/)
  }
})
