import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const popup = readFileSync(join(root, "components/ads-manager/PerformancePopup.tsx"), "utf8")
const editor = readFileSync(join(root, "components/ads-manager/UnifiedWorkspaceEditor.tsx"), "utf8")
const deleteRoute = readFileSync(join(root, "app/api/facebook/delete/route.ts"), "utf8")

describe("BL-64 Discard on Meta (session-created ledger ↔ /api/facebook/delete)", () => {
  it("tracks session-created objects in the ledger, not in an ad-hoc array", () => {
    assert.match(popup, /from "@\/lib\/session-created-ledger"/)
    assert.match(popup, /useState<SessionCreatedLedger>\(createSessionCreatedLedger\)/)
  })

  it("anchors a pre-existing parent instead of recording it as session-created", () => {
    assert.match(popup, /anchorExistingNode\(current, \{ nodeId: parentId, level: parentLevel, metaId: parentId \}\)/)
    assert.match(popup, /appendCreatedNode\(withParent, \{/)
    // A parent this session created must be reused by its ledger node ID, never re-anchored.
    assert.match(popup, /const known = findLedgerNode\(current, parentId\)/)
  })

  it("teaches the ledger the Meta ID and the batch ID after Save Draft", () => {
    assert.match(popup, /setSessionLedger\(current => setBatchId\(current, data\.batchId as string\)\)/)
    assert.match(popup, /remapCreatedNode\(current, result\.nodeId, result\.metaId as string\)/)
  })

  it("deletes children before parents, sending only ledger nodes", () => {
    assert.match(popup, /const pending = pendingDeletes\(sessionLedger\)/)
    assert.match(popup, /fetch\("\/api\/facebook\/delete"/)
    assert.match(popup, /ids: pending\.map\(node => node\.metaId\)/)
  })

  it("keeps a failed delete in the ledger so the button retries it", () => {
    assert.match(popup, /markDeleted\(ledger, node\.nodeId\)/)
    assert.match(popup, /Press again to retry/)
  })

  it("clears the drafts and tree rows only for objects Meta confirmed deleted", () => {
    assert.match(popup, /removedIds\.has\(node\.id\)/)
    assert.match(popup, /setLocalAdSets\(current => current\.filter\(row => !removedIds\.has\(String\(row\.id\)\)\)\)/)
    assert.match(popup, /setLocalAds\(current => current\.filter\(row => !removedIds\.has\(String\(row\.id\)\)\)\)/)
  })

  it("words the two discards differently — one clears the browser, one deletes on Meta", () => {
    // Both controls now live only on the Review screen (popup) — the Edit-view footer (editor)
    // dropped its own copies so the footer carries fewer CTAs; local discard there is the kebab
    // menu's "Discard draft" instead.
    assert.match(popup, /Discard local edits/)
    assert.match(popup, /Delete \$\{metaDraftCount\} draft\(s\) on Meta/)
    assert.doesNotMatch(editor, /Delete \$\{metaDraftCount\}/)
  })

  it("disables the Meta delete when this session created nothing there", () => {
    assert.match(popup, /const metaDraftCount = pendingDeletes\(sessionLedger\)\.length/)
    assert.match(popup, /metaDraftCount === 0/)
  })

  it("warns before close that Save Draft objects survive a local discard", () => {
    assert.match(popup, /will remain there/)
  })

  it("creates ad sets and ads inside the editor instead of leaving it", () => {
    assert.match(popup, /<HierarchyCreateMenu/)
    assert.match(popup, /onCreateAdSet=\{activeCampaign \? \(\) => createWorkspaceChild\("campaign", activeCampaign\.id\) : undefined\}/)
    assert.match(popup, /onCreateAd=\{activeAdSet \? \(\) => createWorkspaceChild\("adset", activeAdSet\.id, activeCampaign\?\.id\) : undefined\}/)
    // Only a campaign has no parent here, so only a campaign may leave for the create flow.
    assert.match(popup, /onCreateCampaign=\{onCreate\}/)
  })

  it("offers a back control in the workspace rail that respects the unsaved-draft guard", () => {
    assert.match(popup, /aria-label="Back to Ads Manager"/)
    assert.match(popup, /onClick=\{requestWorkspaceClose\}\r?\n\s*className="grid size-9 place-items-center/)
  })

  it("gates the delete route on role, not just on authentication", () => {
    assert.match(deleteRoute, /requireRole/)
    assert.match(deleteRoute, /const denied = requireRole\(ctx\)\s+if \(denied\) return denied/)
  })
})
