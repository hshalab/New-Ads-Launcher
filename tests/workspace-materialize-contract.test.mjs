import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const route = readFileSync(join(root, "app/api/ads-manager/workspace-materialize/route.ts"), "utf8")

describe("workspace materialize contract", () => {
  it("requires auth, launch permission, Via LAUNCH, and target-account ownership", () => {
    assert.match(route, /const ctx = await getAuthContext\(\)/)
    assert.match(route, /const denied = requireRole\(ctx\)/)
    assert.match(route, /getConnectionForAdAccount\(ctx\.orgId, adAccountId, "write"\)/)
    assert.match(route, /getOrgAdAccountInfo\(ctx\.orgId, adAccountId, connection\.access_token\)/)
    assert.match(route, /MISSING_LAUNCH_VIA/)
  })

  it("keeps local node IDs separate from optional Meta IDs", () => {
    assert.match(route, /type MaterializeNode[\s\S]*nodeId: string/)
    assert.match(route, /type MaterializeNode[\s\S]*metaId\?: string/)
    assert.match(route, /parentNodeId\?: string/)
    assert.match(route, /new Set\(nodes\.map\(node => node\.nodeId\)\)/)
  })

  it("proves every pre-existing Meta object belongs to the requested account before writing", () => {
    assert.match(route, /getResourceAccountId\(node\.metaId, connection\.access_token, tokenOpts\)/)
    assert.match(route, /normalizeAdAccountId\(adAccountId\)/)
    assert.match(route, /does not belong to the requested ad account/)
  })

  it("writes parent-first and always sends PAUSED", () => {
    assert.match(route, /const ORDER: Record<Level, number> = \{ campaign: 0, adset: 1, ad: 2 \}/)
    assert.match(route, /\.sort\(\(a, b\) => ORDER\[a\.level\] - ORDER\[b\.level\]\)/)
    assert.match(route, /createCampaign\([\s\S]*status: "PAUSED"/)
    assert.match(route, /createAdSet\([\s\S]*status: "PAUSED"/)
    assert.match(route, /createAd\([\s\S]*status: "PAUSED"/)
    assert.match(route, /updateNode\([\s\S]*status: "PAUSED"/)
  })

  it("resolves context-only hierarchy parents without modifying them", () => {
    assert.match(route, /contextOnly\?: boolean/)
    assert.match(route, /if \(node\.contextOnly\) continue/)
    assert.match(route, /if \(!node\.contextOnly\) \{[\s\S]*await updateNode/)
  })

  it("blocks dependent nodes after parent failures while retaining independent successes", () => {
    assert.match(route, /parentResult = resultsByNodeId\.get\(node\.parentNodeId\)/)
    assert.match(route, /status: "skipped"/)
    assert.match(route, /status: "failed"/)
    assert.match(route, /status: "materialized"/)
  })

  it("uses manual-Via Meta options for every write and resolves video thumbnails", () => {
    assert.match(route, /const tokenOpts = \{ isManual: isManual\(connection\) \}/)
    assert.match(route, /getVideoThumbnail\(node\.videoId, connection\.access_token, \{ skipProof: tokenOpts\.isManual \}\)/)
    assert.match(route, /createCampaign\([\s\S]*tokenOpts\)/)
    assert.match(route, /createAdSet\([\s\S]*tokenOpts\)/)
    assert.match(route, /createAd\([\s\S]*tokenOpts\)/)
  })

  it("creates exactly one partial batch on the first materialized ad, then updates the supplied batch", () => {
    assert.match(route, /if \(createdAds\.length > 0\)/)
    assert.match(route, /\.from\("launch_batches"\)\.insert\(/)
    assert.match(route, /status: "partial"/)
    assert.match(route, /batchId\?: string/)
    assert.match(route, /\.from\("launch_batches"\)\.update\(/)
    assert.match(route, /\.eq\("user_id", ctx\.user\.id\)/)
  })

  it("reports audit persistence failures and invalidates only successful Meta objects", () => {
    assert.match(route, /auditError/)
    assert.match(route, /success: !auditError && results\.every/)
    assert.match(route, /invalidateMetaReadCacheAfterWrite/)
  })

  it("writes special categories for new and existing campaigns", () => {
    assert.match(route, /special_ad_categories: node\.specialAdCategories/)
    assert.match(route, /special_ad_categories: node\.level === "campaign" \? node\.specialAdCategories : undefined/)
  })

  it("keeps MTO on a standard ad set and forwards URL parameters", () => {
    assert.match(route, /text_variations: \{[\s\S]*primaryTextVariations/)
    assert.match(route, /omit_degrees_of_freedom_spec: true/)
    assert.match(route, /url_tags: node\.urlParameters/)
  })
})
