// ponytail: runnable self-check for existing-ad post-reuse resolution.
// Run: npx tsx --tsconfig New-Ads-Launcher/tsconfig.json New-Ads-Launcher/lib/existing-ad-launch.self-check.ts
import assert from "node:assert"
import {
  EXISTING_PREFIX,
  isExistingAdCreativeId,
  resolveExistingAdSources,
} from "./existing-ad-launch"

let pass = 0
const ok = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log("  ✓", name)
}

console.log("existing-ad-launch self-check")

ok("isExistingAdCreativeId matches only the synthetic prefix", () => {
  assert.equal(isExistingAdCreativeId(`${EXISTING_PREFIX}123`), true)
  assert.equal(isExistingAdCreativeId("creative-uuid"), false)
})

ok("resolves a valid source", () => {
  const { resolved, errors } = resolveExistingAdSources(
    ["existing_123"],
    { existing_123: { adId: "123", postId: "999_555" } },
    "999",
  )
  assert.equal(errors.length, 0)
  assert.deepEqual(resolved.get("existing_123"), { adId: "123", postId: "999_555" })
})

ok("rejects missing/empty postId", () => {
  const { resolved, errors } = resolveExistingAdSources(
    ["existing_123"],
    { existing_123: { adId: "123", postId: "" } },
    "999",
  )
  assert.equal(resolved.size, 0)
  assert.equal(errors.length, 1)
})

ok("rejects source map key not matching existing_<adId>", () => {
  const { resolved, errors } = resolveExistingAdSources(
    ["existing_123"],
    { existing_999: { adId: "123", postId: "999_555" } },
    "999",
  )
  assert.equal(resolved.size, 0)
  assert.equal(errors.length, 1)
})

ok("rejects page prefix mismatch (never infers post id)", () => {
  const { resolved, errors } = resolveExistingAdSources(
    ["existing_123"],
    { existing_123: { adId: "123", postId: "888_555" } },
    "999",
  )
  assert.equal(resolved.size, 0)
  assert.equal(errors.length, 1)
  assert.match(errors[0].error, /different Page/)
})

ok("rejects malformed postId shape", () => {
  const { resolved, errors } = resolveExistingAdSources(
    ["existing_123"],
    { existing_123: { adId: "123", postId: "notavalidpost" } },
    "999",
  )
  assert.equal(resolved.size, 0)
  assert.equal(errors.length, 1)
})

ok("no source map at all rejects every requested id", () => {
  const { resolved, errors } = resolveExistingAdSources(["existing_1", "existing_2"], undefined, "999")
  assert.equal(resolved.size, 0)
  assert.equal(errors.length, 2)
})

console.log(`\n${pass} checks passed`)
