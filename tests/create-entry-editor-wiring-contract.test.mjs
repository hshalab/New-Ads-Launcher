import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const page = readFileSync(join(root, "app/(dashboard)/ads-manager/page.tsx"), "utf8")
const popup = readFileSync(join(root, "components/ads-manager/PerformancePopup.tsx"), "utf8")
const adapter = readFileSync(join(root, "lib/workspace-draft-adapter.ts"), "utf8")
const handoff = readFileSync(join(root, "lib/workspace-entry-handoff.ts"), "utf8")
const modal = readFileSync(join(root, "components/ads-manager/create-flow/CreateCampaignModal.tsx"), "utf8")

describe("BL-64 slice 4 · Create → gate → editor default route", () => {
  it("Create opens the entry gate, not the legacy wizard, when the editor is available", () => {
    assert.match(page, /if \(workspaceAccess\.enabled\) \{ setCreateHierarchyError\(""\); setEntryGateOpen\(true\) \}/)
    assert.match(page, /<CreateEntryGate\s/)
    assert.match(page, /onContinue=\{startEditorCreate\}/)
  })

  it("creates one real PAUSED campaign shell before opening the editor", () => {
    assert.match(page, /fetch\("\/api\/facebook\/create-campaign-shell"/)
    assert.match(page, /formStateToCampaignShell\(formState\)/)
    // Attach scope must never create a campaign — it anchors the one that already exists.
    assert.match(page, /anchorExistingNode\(ledger, \{ nodeId: campaignId, level: "campaign", metaId: campaignId \}\)/)
  })

  it("materializes the ad set under the shell and reuses the session batch id", () => {
    assert.match(page, /fetch\("\/api\/ads-manager\/workspace-materialize"/)
    assert.match(page, /workspaceDraftsToMaterializeNodes\(/)
    assert.match(page, /ledger = setBatchId\(ledger, batchId\)/)
    assert.match(page, /ledger = remapCreatedNode\(ledger, adSetNodeId, outcome\.metaId as string\)/)
  })

  it("puts all three nodes in the session ledger so Discard can reverse them", () => {
    assert.match(page, /appendCreatedNode\(ledger, \{ nodeId: campaignId, level: "campaign", metaId: campaignId \}\)/)
    assert.match(page, /appendCreatedNode\(ledger, \{ nodeId: adSetNodeId, level: "adset", parentNodeId: campaignId \}\)/)
    assert.match(page, /appendCreatedNode\(ledger, \{ nodeId: adNodeId, level: "ad", parentNodeId: adSetNodeId \}\)/)
  })

  it("never strands the buyer: a shell failure stops, a child failure travels to the editor", () => {
    assert.match(page, /setCreateHierarchyError\(error instanceof Error \? error\.message : "Failed to create the campaign on Meta"\)/)
    assert.match(page, /childError = outcome\?\.message \|\| data\.auditError \|\| "The ad set was not created on Meta\."/)
    assert.match(page, /error: childError \|\| undefined/)
    assert.match(popup, /if \(handoff\.error\) setWorkspaceMaterializeError\(handoff\.error\)/)
  })

  it("does not address a local ad set id to the editor route", () => {
    assert.match(page, /adSetId: adSetId\.startsWith\("local:"\) \? undefined : adSetId/)
  })

  it("says 'New · paused' in the table, never 'Just published', for a created row", () => {
    assert.match(page, /justPublishedIds\.has\(id\) \? "Just published" : justCreatedIds\.has\(id\) \? "New · paused" : null/)
    assert.match(page, /<NewRowBadge label=\{newRowLabel\(c\.id\)\} \/>/)
    assert.match(page, /rowTint\(Boolean\(newRowLabel\(c\.id\)\), hasDraft\)/)
  })

  it("hands the staged hierarchy across the route boundary and consumes it once", () => {
    assert.match(page, /saveWorkspaceEntryHandoff\(\{/)
    assert.match(handoff, /store\.removeItem\(key\)/)
    assert.match(handoff, /sessionStorage/)
    assert.match(popup, /const handoff = takeWorkspaceEntryHandoff\(accountId, entryHandoffCampaignId\)/)
    assert.match(popup, /setSessionLedger\(handoff\.ledger\)/)
    assert.match(popup, /if \(handoff\.batchId\) setWorkspaceBatchId\(handoff\.batchId\)/)
  })

  it("never lets a stranded handoff leak into an editor opened on another campaign", () => {
    assert.match(handoff, /if \(handoff\.campaignId !== campaignId\) return null/)
    assert.match(handoff, /const expired = typeof handoff\.savedAt === "number"/)
    assert.match(popup, /const entryHandoffCampaignId = level === "campaign" \? rows\[0\]\?\.id \|\| "" : ""/)
  })

  it("highlights session-created nodes in the editor tree, excluding anchors", () => {
    assert.match(popup, /const sessionCreatedIds = useMemo/)
    assert.match(popup, /\.filter\(node => !node\.anchor\)/)
    assert.match(popup, /const isNew = sessionCreatedIds\.has\(activeCampaign\.id\)/)
    assert.match(popup, /const isNew = sessionCreatedIds\.has\(as\.id\)/)
    assert.match(popup, /const adIsNew = sessionCreatedIds\.has\(ad\.id\)/)
    assert.match(popup, /New · paused/)
  })

  it("keeps the ad set off Meta when the ODAX chain cannot be resolved yet", () => {
    assert.match(adapter, /export function buildEntryHierarchyDrafts/)
    assert.match(adapter, /const resolved = typeof delivery === "string" \? null : delivery/)
    assert.match(adapter, /adSetBlockedReason: typeof delivery === "string" \? delivery : ""/)
    // CBO puts the budget on the campaign; an ad set budget under CBO is rejected by Meta.
    assert.match(adapter, /daily_budget: state\.advantageCampaignBudget \? undefined : toMinorUnits\(state\.dailyBudget\)/)
    assert.match(adapter, /status: "PAUSED"/)
  })
})

describe("BL-64 slice 4 · the legacy wizard stays as the fallback path", () => {
  // Owner decision 15/08: no feature flag and no CI (TD-12/TD-06), so the previous Create Campaign
  // wizard is the only way back if the editor path breaks. These assertions exist so a later
  // cleanup pass cannot delete it as dead code.
  it("still ships the three wizard levels", () => {
    for (const file of ["CampaignLevel.tsx", "AdSetLevel.tsx", "AdLevel.tsx"]) {
      const source = readFileSync(join(root, "components/ads-manager/create-flow", file), "utf8")
      assert.ok(source.length > 0, `${file} must still exist`)
    }
  })

  it("still references all three levels from the wizard's editor phase", () => {
    assert.match(modal, /phase, setPhase\] = useState<"gate" \| "editor">/)
    assert.match(modal, /setPhase\("editor"\)/)
    assert.match(modal, /<CampaignLevel/)
    assert.match(modal, /<AdSetLevel/)
    assert.match(modal, /<AdLevel/)
  })

  it("keeps the wizard reachable by hand from the Ads Manager toolbar", () => {
    assert.match(page, /Classic\s*<\/button>/)
    assert.match(page, /Kept as the fallback while the editor create path settles \(BL-64\)/)
    assert.match(page, /<CreateCampaignModal/)
    assert.match(page, /onClick=\{\(\) => setCreateModalOpen\(true\)\}/)
  })

  it("falls back to the wizard when the workspace editor is not enabled for the role", () => {
    assert.match(page, /else setCreateModalOpen\(true\)/)
  })
})
