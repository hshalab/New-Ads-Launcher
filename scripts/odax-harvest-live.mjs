/**
 * Harvest the ODAX combinations Meta has ALREADY accepted, from live ad sets. Read-only.
 *
 * The validate_only sweep (scripts/odax-validate-grid.mjs) hits a wall that no amount of probing
 * gets past: Meta requires every ad set under a lowest-cost campaign to share one
 * optimization_goal, so validating a new goal against an existing campaign always fails with
 * subcode 1885760 regardless of whether the goal is legal for the objective. Answering "which goals
 * does this objective allow" that way would need a fresh campaign per objective — real objects in
 * live ad accounts.
 *
 * Existing ad sets are the same evidence without the write: every row here is a combination Meta
 * accepted at creation time. It proves support; it cannot prove absence (nobody having built a
 * TRAFFIC/REACH ad set is not evidence Meta refuses one).
 *
 *   node scripts/odax-harvest-live.mjs
 */
import { createHmac } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { config } from "dotenv"

config({ path: ".env.local", quiet: true })

const GRAPH = "https://graph.facebook.com/v25.0"
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA || "ads_launcher" },
})

const { data: conns } = await sb
  .from("facebook_connections")
  .select("id, access_token, token_status, connection_type")
  .eq("is_active", true)

function authParams(conn) {
  const params = { access_token: conn.access_token }
  const secret = process.env.FACEBOOK_APP_SECRET
  // Via tokens come from another Meta app and must not carry our proof; OAuth tokens must.
  if (secret && conn.connection_type === "oauth") {
    params.appsecret_proof = createHmac("sha256", secret).update(conn.access_token).digest("hex")
  }
  return params
}

async function graph(path, conn, params = {}) {
  const url = new URL(`${GRAPH}/${path}`)
  for (const [k, v] of Object.entries({ ...authParams(conn), ...params })) url.searchParams.set(k, v)
  const res = await fetch(url)
  return { ok: res.ok, body: await res.json() }
}

// token_status is stale in the DB — ask Meta which token actually works.
let conn = null
for (const c of conns || []) {
  const { ok } = await graph("me", c, { fields: "id" })
  if (ok) {
    conn = c
    break
  }
}
if (!conn) {
  console.error("No usable connection.")
  process.exit(1)
}

const { data: accounts } = await sb.from("ad_accounts").select("fb_ad_account_id, fb_account_id, name")
const seen = new Set()
/** objective → destination_type → optimization_goal → { count, windows:Set, example } */
const matrix = {}

for (const a of accounts || []) {
  const actId = (a.fb_account_id || a.fb_ad_account_id || "").replace(/^act_/, "")
  if (!actId || seen.has(actId)) continue
  seen.add(actId)

  const { ok, body } = await graph(`act_${actId}/adsets`, conn, {
    fields:
      "id,name,optimization_goal,billing_event,destination_type,attribution_spec,promoted_object,campaign{objective,bid_strategy}",
    limit: "500",
  })
  if (!ok) {
    console.log(`act_${actId}  ${a.name}  — unreadable: ${body.error?.message}`)
    continue
  }
  const rows = body.data || []
  console.log(`act_${actId}  ${a.name}  — ${rows.length} ad sets`)

  for (const s of rows) {
    const objective = s.campaign?.objective
    if (!objective) continue
    const dest = s.destination_type || "—"
    const goal = s.optimization_goal || "—"
    const bucket = ((matrix[objective] ??= {})[dest] ??= {})
    const cell = (bucket[goal] ??= { count: 0, windows: new Set(), billing: new Set(), example: s.id })
    cell.count++
    cell.billing.add(s.billing_event || "—")
    for (const w of s.attribution_spec || []) cell.windows.add(`${w.window_days}d_${w.event_type === "CLICK_THROUGH" ? "click" : w.event_type.toLowerCase()}`)
    if (!s.attribution_spec?.length) cell.windows.add("none")
  }
}

console.log("\n── combinations Meta has accepted in production ───────────────────────")
for (const objective of Object.keys(matrix).sort()) {
  console.log(`\n${objective}`)
  for (const dest of Object.keys(matrix[objective]).sort()) {
    for (const [goal, cell] of Object.entries(matrix[objective][dest]).sort()) {
      console.log(
        `  destination=${dest.padEnd(10)} goal=${goal.padEnd(22)} n=${String(cell.count).padStart(3)}  billing=${[...cell.billing].join("/")}  windows=${[...cell.windows].sort().join(",")}`
      )
    }
  }
}
