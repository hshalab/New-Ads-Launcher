import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { publishEligibility } from "../lib/publish-eligibility.ts"

const completeWorkspace = {
  nodes: [
    { id: "campaign:1", level: "campaign", metaId: "camp_1" },
    { id: "adset:1", level: "adset", metaId: "adset_1", parentId: "campaign:1" },
    {
      id: "ad:1",
      level: "ad",
      metaId: "ad_1",
      parentId: "adset:1",
      creative: { fb_image_hash: "hash", fb_video_id: null },
    },
  ],
}

describe("publish eligibility", () => {
  it("allows a complete Meta-backed workspace with a launchable creative", () => {
    assert.deepEqual(publishEligibility(completeWorkspace), { eligible: true, reasons: [] })
  })

  it("blocks publish until every intended node has a Meta ID", () => {
    const result = publishEligibility({
      ...completeWorkspace,
      nodes: completeWorkspace.nodes.map(node =>
        node.id === "adset:1" ? { ...node, metaId: " " } : node,
      ),
    })

    assert.deepEqual(result, {
      eligible: false,
      reasons: [{ nodeId: "adset:1", code: "MISSING_META_ID" }],
    })
  })

  it("blocks publish when Save Draft still reports a node failure", () => {
    const result = publishEligibility({
      ...completeWorkspace,
      nodes: completeWorkspace.nodes.map(node =>
        node.id === "ad:1" ? { ...node, materializeError: "Meta rejected creative" } : node,
      ),
    })

    assert.deepEqual(result, {
      eligible: false,
      reasons: [{ nodeId: "ad:1", code: "MATERIALIZE_FAILED", message: "Meta rejected creative" }],
    })
  })

  it("blocks publish when an ad creative is not ready in Meta", () => {
    const result = publishEligibility({
      ...completeWorkspace,
      nodes: completeWorkspace.nodes.map(node =>
        node.id === "ad:1"
          ? { ...node, creative: { fb_image_hash: null, fb_video_id: null } }
          : node,
      ),
    })

    assert.deepEqual(result, {
      eligible: false,
      reasons: [{ nodeId: "ad:1", code: "CREATIVE_NOT_READY" }],
    })
  })

  it("reports all independently-blocking nodes", () => {
    const result = publishEligibility({
      nodes: [
        { id: "campaign:1", level: "campaign" },
        { id: "adset:1", level: "adset", metaId: "adset_1", materializeError: "Invalid budget" },
        {
          id: "ad:1",
          level: "ad",
          metaId: "ad_1",
          creative: { fb_image_hash: null, fb_video_id: null },
        },
      ],
    })

    assert.deepEqual(result, {
      eligible: false,
      reasons: [
        { nodeId: "campaign:1", code: "MISSING_META_ID" },
        { nodeId: "adset:1", code: "MATERIALIZE_FAILED", message: "Invalid budget" },
        { nodeId: "ad:1", code: "CREATIVE_NOT_READY" },
      ],
    })
  })
})
