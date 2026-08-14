import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  jobsLevel,
  summarizeCreativeReadiness,
} from "../lib/tracking/app-status.ts"

describe("App status honesty contract", () => {
  it("does not call a job healthy before it has produced output", () => {
    assert.equal(jobsLevel([{ state: "never" }]), "attention")
    assert.equal(jobsLevel([{ state: "unknown" }]), "unknown")
  })

  it("keeps creative readiness buckets mutually exclusive", () => {
    const result = summarizeCreativeReadiness([
      { status: "error", fb_image_hash: "hash", fb_video_id: null },
      { status: "error", fb_image_hash: null, fb_video_id: null },
      { status: "pending", fb_image_hash: null, fb_video_id: null },
    ])

    assert.deepEqual(
      [result.metaReady, result.errored, result.awaitingUpload, result.total],
      [1, 1, 1, 3],
    )
  })
})
