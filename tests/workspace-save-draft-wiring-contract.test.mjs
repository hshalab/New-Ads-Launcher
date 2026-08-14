import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const popup = readFileSync(join(root, "components/ads-manager/PerformancePopup.tsx"), "utf8")
const editor = readFileSync(join(root, "components/ads-manager/UnifiedWorkspaceEditor.tsx"), "utf8")

describe("BL-64 Save Draft wiring (editor ↔ workspace-materialize)", () => {
  it("offers Create ad set / Create ad instead of the deferred placeholder", () => {
    assert.doesNotMatch(editor, /Create ad · soon/)
    assert.match(editor, /Create ad set/)
    assert.match(editor, /onCreateChild\?\.\(\)/)
  })

  it("renders Save Draft distinct from Publish, and disables it while either runs", () => {
    assert.match(editor, /savingDraft \? "Saving…" : "Save Draft"/)
    assert.match(editor, /disabled=\{!hasDraft \|\| readOnly \|\| savingDraft \|\| publishing\}/)
  })

  it("creates a synthetic child under the selected node as a local: draft", () => {
    assert.match(popup, /const createWorkspaceChild = useCallback/)
    assert.match(popup, /const nodeId = `local:\$\{childLevel\}:/)
    assert.match(popup, /status: "PAUSED"/)
    // Tree rows too, or the new node cannot be selected from the hierarchy.
    assert.match(popup, /setLocalAdSets\(current => \[\.\.\.current/)
    assert.match(popup, /setLocalAds\(current => \[\.\.\.current/)
  })

  it("never fetches Meta detail for a node that exists only in this session", () => {
    assert.match(popup, /if \(workspaceDetailId\.startsWith\("local:"\)\) return/)
  })

  it("Save Draft posts to workspace-materialize with the session batch id", () => {
    assert.match(popup, /fetch\("\/api\/ads-manager\/workspace-materialize"/)
    assert.match(popup, /batchId: workspaceBatchId/)
    assert.match(popup, /workspaceDraftsToMaterializeNodes\(staged, contextParents\)/)
    assert.match(popup, /setWorkspaceBatchId\(data\.batchId as string\)/)
  })

  it("sends existing ancestors as context parents rather than as writes", () => {
    assert.match(popup, /const contextParents: Array<\{ node: WorkspaceNode; level: DraftLevel \}> = \[\]/)
    assert.match(popup, /parentId\.startsWith\("local:"\) \|\| stagedIds\.has\(parentId\)/)
  })

  it("remaps a local node id to its Meta id everywhere it is referenced", () => {
    assert.match(popup, /const remapLocalNodeId = useCallback/)
    assert.match(popup, /if \(next\.campaign_id === localId\) next\.campaign_id = metaId/)
    assert.match(popup, /if \(next\.adset_id === localId\) next\.adset_id = metaId/)
    assert.match(popup, /setActiveNodeId\(current => current === localId \? metaId : current\)/)
  })

  it("records per-node materialize failures and clears them on the next edit", () => {
    assert.match(popup, /materializeError: result\.message \|\| "Save Draft failed on Meta\."/)
    assert.match(popup, /\{ \.\.\.node, materializeError: undefined \}/)
  })

  it("blocks Publish while any staged node has no Meta object yet", () => {
    assert.match(popup, /entries\.filter\(\(\[, node\]\) => node\.id\.startsWith\("local:"\)\)/)
    assert.match(popup, /does not exist on Meta yet\. Use Save Draft first/)
  })

  it("stops claiming nothing reaches Meta before Publish", () => {
    assert.doesNotMatch(popup, /nothing hits Meta until Publish/)
    assert.doesNotMatch(popup, /Meta is not updated until you publish/)
    assert.match(popup, /Save Draft is different: it creates any new node/)
    // The two discards must not read alike: one clears the browser, one would delete on Meta.
    assert.match(popup, /Discard local edits/)
    assert.match(popup, /Objects already created on Meta by Save Draft are not deleted\./)
  })
})
