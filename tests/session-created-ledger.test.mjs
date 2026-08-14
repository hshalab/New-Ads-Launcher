import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  anchorExistingNode,
  appendCreatedNode,
  createSessionCreatedLedger,
  findLedgerNode,
  markDeleted,
  pendingDeletes,
  remapCreatedNode,
  setBatchId,
} from "../lib/session-created-ledger.ts"

const campaign = { nodeId: "campaign:local", level: "campaign", metaId: "camp_1" }
const adset = {
  nodeId: "adset:local",
  level: "adset",
  metaId: "adset_1",
  parentNodeId: campaign.nodeId,
}
const ad = {
  nodeId: "ad:local",
  level: "ad",
  metaId: "ad_1",
  parentNodeId: adset.nodeId,
}

describe("session-created ledger", () => {
  it("records created nodes without mutating the previous ledger", () => {
    const empty = createSessionCreatedLedger()
    const next = appendCreatedNode(empty, campaign)

    assert.deepEqual(empty.nodes, [])
    assert.deepEqual(next.nodes, [campaign])
  })

  it("remaps a local node to its Meta ID after materialization", () => {
    const ledger = appendCreatedNode(createSessionCreatedLedger(), campaign)
    const withAdSet = appendCreatedNode(ledger, {
      nodeId: "adset:local",
      level: "adset",
      parentNodeId: campaign.nodeId,
    })

    const next = remapCreatedNode(withAdSet, "adset:local", "adset_1")

    assert.equal(next.nodes[1].metaId, "adset_1")
  })

  it("rejects blank IDs, duplicate Meta IDs, and broken parent chains", () => {
    const ledger = appendCreatedNode(createSessionCreatedLedger(), campaign)

    assert.throws(() => appendCreatedNode(ledger, { ...adset, nodeId: "   " }), /node ID/i)
    assert.throws(() => appendCreatedNode(ledger, { ...adset, metaId: campaign.metaId }), /Meta ID/i)
    assert.throws(
      () => appendCreatedNode(ledger, { ...ad, parentNodeId: campaign.nodeId }),
      /parent/i,
    )
    assert.throws(() => remapCreatedNode(ledger, campaign.nodeId, "   "), /Meta ID/i)
  })

  it("keeps one batch ID for the session", () => {
    const first = setBatchId(createSessionCreatedLedger(), "batch_1")

    assert.equal(setBatchId(first, "batch_1").batchId, "batch_1")
    assert.throws(() => setBatchId(first, "batch_2"), /different batch/i)
  })

  it("lists materialized nodes in reverse dependency order for discard", () => {
    const ledger = [campaign, adset, ad].reduce(appendCreatedNode, createSessionCreatedLedger())

    assert.deepEqual(
      pendingDeletes(ledger).map(node => node.metaId),
      ["ad_1", "adset_1", "camp_1"],
    )
  })

  it("retains a failed delete for retry while removing a confirmed delete", () => {
    const ledger = [campaign, adset, ad].reduce(appendCreatedNode, createSessionCreatedLedger())
    const afterAd = markDeleted(ledger, ad.nodeId)

    assert.deepEqual(
      pendingDeletes(afterAd).map(node => node.metaId),
      ["adset_1", "camp_1"],
    )
    assert.equal(markDeleted(afterAd, "unknown"), afterAd)
  })

  it("rejects a blank or replacement batch ID", () => {
    assert.throws(() => setBatchId(createSessionCreatedLedger(), " "), /batch ID/i)
    assert.throws(
      () => setBatchId(setBatchId(createSessionCreatedLedger(), "batch_1"), "batch_2"),
      /different batch/i,
    )
  })

  it("rejects a whitespace-only Meta ID on append", () => {
    const ledger = createSessionCreatedLedger()
    assert.throws(() => appendCreatedNode(ledger, { ...campaign, metaId: "   " }), /Meta ID/i)
  })

  it("rejects remapping to a Meta ID another node already holds", () => {
    const ledger = [campaign, { ...adset, metaId: undefined }].reduce(appendCreatedNode, createSessionCreatedLedger())
    assert.throws(() => remapCreatedNode(ledger, adset.nodeId, campaign.metaId), /already maps|already/i)
  })

  it("does not treat a whitespace-only Meta ID as materialized", () => {
    const ledger = appendCreatedNode(createSessionCreatedLedger(), { ...campaign, metaId: undefined })
    const withBlank = { ...ledger, nodes: [{ ...ledger.nodes[0], metaId: "   " }] }
    assert.deepEqual(pendingDeletes(withBlank), [])
  })
})

describe("session-created ledger hierarchy", () => {
  it("requires a campaign before an ad set and an ad set before an ad", () => {
    assert.throws(() => appendCreatedNode(createSessionCreatedLedger(), adset), /parent/i)
    const withCampaign = appendCreatedNode(createSessionCreatedLedger(), campaign)
    assert.throws(() => appendCreatedNode(withCampaign, ad), /parent/i)
  })

  it("anchors a live parent without requiring its own ancestors", () => {
    const withLiveCampaign = anchorExistingNode(createSessionCreatedLedger(), {
      nodeId: "camp_live",
      level: "campaign",
      metaId: "camp_live",
    })
    const withNewAdSet = appendCreatedNode(withLiveCampaign, {
      nodeId: "adset:local",
      level: "adset",
      metaId: "adset_1",
      parentNodeId: "camp_live",
    })

    // The whole point: the live campaign is representable as a parent and still undeletable.
    assert.deepEqual(pendingDeletes(withNewAdSet).map(node => node.metaId), ["adset_1"])
  })

  it("anchors a live ad set the same way, so an ad can hang off it", () => {
    const withLiveAdSet = anchorExistingNode(createSessionCreatedLedger(), {
      nodeId: "adset_live",
      level: "adset",
      metaId: "adset_live",
    })
    const withNewAd = appendCreatedNode(withLiveAdSet, {
      nodeId: "ad:local",
      level: "ad",
      metaId: "ad_1",
      parentNodeId: "adset_live",
    })

    assert.deepEqual(pendingDeletes(withNewAd).map(node => node.metaId), ["ad_1"])
  })

  it("is idempotent so callers can anchor on every child add", () => {
    const once = anchorExistingNode(createSessionCreatedLedger(), {
      nodeId: "camp_live",
      level: "campaign",
      metaId: "camp_live",
    })

    assert.equal(anchorExistingNode(once, { nodeId: "camp_live", level: "campaign", metaId: "camp_live" }), once)
    assert.equal(once.nodes.length, 1)
  })

  it("refuses to anchor a node this session created, or to anchor without a Meta ID", () => {
    const created = appendCreatedNode(createSessionCreatedLedger(), campaign)

    assert.throws(
      () => anchorExistingNode(created, { nodeId: campaign.nodeId, level: "campaign", metaId: campaign.metaId }),
      /already recorded as session-created/i,
    )
    assert.throws(
      () => anchorExistingNode(createSessionCreatedLedger(), { nodeId: "camp_live", level: "campaign", metaId: "  " }),
      /Meta ID/i,
    )
  })

  it("finds a materialized node by its Meta ID so it is never re-anchored", () => {
    const created = appendCreatedNode(createSessionCreatedLedger(), {
      nodeId: "local:campaign:a",
      level: "campaign",
    })
    const materialized = remapCreatedNode(created, "local:campaign:a", "camp_9")

    assert.equal(findLedgerNode(materialized, "camp_9")?.nodeId, "local:campaign:a")
    assert.equal(findLedgerNode(materialized, "local:campaign:a")?.metaId, "camp_9")
    assert.equal(findLedgerNode(materialized, "unknown"), undefined)
    assert.equal(findLedgerNode(materialized, ""), undefined)
  })

  it("never remaps or deletes an anchor", () => {
    const anchored = anchorExistingNode(createSessionCreatedLedger(), {
      nodeId: "camp_live",
      level: "campaign",
      metaId: "camp_live",
    })

    assert.throws(() => remapCreatedNode(anchored, "camp_live", "camp_other"), /anchor/i)
    assert.equal(markDeleted(anchored, "camp_live"), anchored)
  })

  it("deletes exactly one node by its local node ID", () => {
    const ledger = appendCreatedNode(
      appendCreatedNode(createSessionCreatedLedger(), campaign),
      { nodeId: "adset:dup", level: "adset", parentNodeId: campaign.nodeId },
    )
    const afterCampaign = markDeleted(ledger, campaign.nodeId)

    assert.deepEqual(afterCampaign.nodes.map(node => node.nodeId), ["adset:dup"])
  })
})
