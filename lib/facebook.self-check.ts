// ponytail: runnable self-check for the pre-Meta thumbnail gate.
// Run: npx tsx lib/facebook.self-check.ts
import assert from "node:assert"
import { isFreshThumbnailUrl, createAd } from "./facebook"

let pass = 0
const ok = (name: string, fn: () => void | Promise<void>) => {
  const done = () => { pass++; console.log("  ✓", name) }
  const r = fn()
  return r instanceof Promise ? r.then(done) : (done(), Promise.resolve())
}

const hex = (msFromNow: number) => Math.floor((Date.now() + msFromNow) / 1000).toString(16)
const metaUrl = (oe: string) => `https://scontent.xx.fbcdn.net/v/t15.jpg?stp=dst-jpg&oe=${oe}`

console.log("facebook thumbnail gate self-check")

const run = async () => {
  await ok("expired oe= is stale (the 10 failed creatives of batch a8fbc482)", () => {
    assert.equal(isFreshThumbnailUrl(metaUrl(hex(-6 * 86400_000))), false)
  })

  await ok("future oe= is fresh (the 5 that launched)", () => {
    assert.equal(isFreshThumbnailUrl(metaUrl(hex(4 * 86400_000))), true)
  })

  await ok("oe= inside the 5-minute buffer is stale", () => {
    assert.equal(isFreshThumbnailUrl(metaUrl(hex(60_000))), false)
  })

  await ok("missing / malformed / non-Meta URLs are stale", () => {
    assert.equal(isFreshThumbnailUrl(null), false)
    assert.equal(isFreshThumbnailUrl(""), false)
    assert.equal(isFreshThumbnailUrl("not a url"), false)
    assert.equal(isFreshThumbnailUrl("https://scontent.xx.fbcdn.net/v/t15.jpg"), false)
    assert.equal(isFreshThumbnailUrl(`https://evil-fbcdn.net.attacker.com/x?oe=${hex(86400_000)}`), false)
    assert.equal(isFreshThumbnailUrl("https://xyz.supabase.co/storage/v1/object/public/thumb.jpg"), false)
  })

  // Proves the gate fires before any network call: an obviously invalid token would
  // surface as a Meta error, not this message.
  await ok("createAd throws locally when a video ad has no fresh thumbnail", async () => {
    await assert.rejects(
      () => createAd("act_0", "invalid-token", {
        name: "x", adset_id: "1", page_id: "1",
        video_id: "v1", thumbnail_url: metaUrl(hex(-86400_000)),
        title: "t", body: "b", cta: "LEARN_MORE", link_url: "https://example.com",
      } as any),
      /no fresh thumbnail resolved for video_id v1/,
    )
    await assert.rejects(
      () => createAd("act_0", "invalid-token", {
        name: "x", adset_id: "1", page_id: "1",
        video_id: "v2",
        title: "t", body: "b", cta: "LEARN_MORE", link_url: "https://example.com",
      } as any),
      /no fresh thumbnail resolved for video_id v2/,
    )
  })

  await ok("nested video formats are gated before Meta too", async () => {
    const base = {
      name: "x", adset_id: "1", page_id: "1",
      title: "t", body: "b", cta: "LEARN_MORE", link_url: "https://example.com",
    }
    await assert.rejects(
      () => createAd("act_0", "invalid-token", {
        ...base,
        multi_placement: { imageHashes: [], videos: [{ video_id: "mp1" }], customRules: [] },
      } as any),
      /Multi-placement ad blocked before Meta call/,
    )
    await assert.rejects(
      () => createAd("act_0", "invalid-token", {
        ...base,
        flexible_asset_feed: { image_hashes: [], videos: [{ video_id: "fa1" }], group_asset_indices: [] },
      } as any),
      /Flexible ad blocked before Meta call/,
    )
  })

  console.log(`\n${pass} checks passed`)
}

run().catch((e) => { console.error(e); process.exit(1) })
