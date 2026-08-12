import assert from "node:assert/strict"
import test from "node:test"
import { summarizeCreativeCoverage, summarizeFailureReasons, summarizeLaunchBatches, workingDayStreak } from "../lib/tracking/summary.ts"

test("summarizes successful, non-successful, and created ads once per batch", () => {
  const summary = summarizeLaunchBatches([
    { id: "gallery", user_id: "buyer-a", user_name: "Kevin", status: "success", total_ads: 3, failed_ads: 0, duration_ms: 1_000 },
    { id: "direct", user_id: "buyer-a", user_name: "Kevin", status: "partial", total_ads: 4, failed_ads: 1, duration_ms: 3_000 },
    { id: "table", user_id: "buyer-b", user_name: "Seth", status: "failed", total_ads: 0, failed_ads: 2, duration_ms: null },
  ])

  assert.deepEqual(summary, {
    batches: 3,
    fullSuccess: 1,
    nonSuccess: 2,
    adsCreated: 7,
    successRate: 33,
    averageSessionDurationMs: 2_000,
    team: [
      { userId: "buyer-a", name: "Kevin", avatarUrl: null, batches: 2, fullSuccess: 1, nonSuccess: 1, adsCreated: 7, averageSessionDurationMs: 2_000 },
      // A member whose only batch recorded no duration averages to null, not to 0 —
      // "not timed" and "instant" are different facts.
      { userId: "buyer-b", name: "Seth", avatarUrl: null, batches: 1, fullSuccess: 0, nonSuccess: 1, adsCreated: 0, averageSessionDurationMs: null },
    ],
  })
})

test("counts only launch-ready Creatives with a successful launch as covered", () => {
  const coverage = summarizeCreativeCoverage([
    { id: "launched-image", fb_image_hash: "hash", fb_video_id: null },
    { id: "unlaunched-video", fb_image_hash: null, fb_video_id: "video" },
    { id: "not-ready", fb_image_hash: null, fb_video_id: null },
  ], new Set(["launched-image", "not-ready"]))

  assert.deepEqual(coverage, { ready: 2, launched: 1, unlaunched: 1, launchRate: 50 })
})

test("counts consecutive weekday launch dates in Vietnam time", () => {
  const streak = workingDayStreak([
    "2026-08-03T02:00:00.000Z",
    "2026-07-31T02:00:00.000Z",
    "2026-07-30T02:00:00.000Z",
  ], new Date("2026-08-03T12:00:00.000Z"))

  assert.equal(streak, 3)
})

test("keeps failure reasons unclassified and groups identical stored messages", () => {
  const reasons = summarizeFailureReasons([
    { id: "a", user_id: "buyer", user_name: "Buyer", status: "partial", total_ads: 2, failed_ads: 1, duration_ms: null, errors: [{ error: "Invalid URL" }] },
    { id: "b", user_id: "buyer", user_name: "Buyer", status: "failed", total_ads: 1, failed_ads: 1, duration_ms: null, errors: [{ error: "Invalid URL" }, { error: "Meta error 190" }] },
  ])

  assert.deepEqual(reasons, [
    { label: "Invalid URL", count: 2 },
    { label: "Meta error 190", count: 1 },
  ])
})
