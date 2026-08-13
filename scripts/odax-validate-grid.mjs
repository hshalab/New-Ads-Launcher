/**
 * Settle TD-39 and the "which performance goals does Meta actually allow" question without
 * creating a single object.
 *
 * Meta validates the ODAX chain (objective → destination_type → optimization_goal) and the
 * attribution_spec rules only at ad set creation — which is *after* the campaign exists. That is
 * why guessing has been expensive here. `execution_options: ["validate_only"]` runs the full
 * server-side validation and creates nothing, so the whole grid can be swept for the price of N
 * HTTP calls.
 *
 * Reads a Via LAUNCH token because POST /adsets is a write endpoint (Via MECE, CONTEXT.md) even
 * though this particular POST writes nothing. Via tokens are issued by a different Meta app, so
 * `appsecret_proof` must NOT be attached — that is the trap in lib/meta-secure-fetch.ts.
 *
 *   node scripts/odax-validate-grid.mjs            # discover, then sweep
 *   node scripts/odax-validate-grid.mjs --discover # stop after discovery
 */
import { createHmac } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { config } from "dotenv"

config({ path: ".env.local", quiet: true })

const GRAPH = "https://graph.facebook.com/v25.0"
const DISCOVER_ONLY = process.argv.includes("--discover")

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA || "ads_launcher" },
})

/**
 * Ad accounts we can validate through, Via LAUNCH first. OAuth is the documented fallback when no
 * launch slot is filled — `getConnectionForAdAccount(…, "write")` takes exactly this path — and it
 * sits outside the Via classification, so using it here is not a MECE breach.
 */
async function launchTargets() {
  const { data: accounts, error } = await sb
    .from("ad_accounts")
    .select("fb_ad_account_id, fb_account_id, name, org_id, launch_connection_id")
  if (error) throw error
  if (!accounts?.length) return []

  const viaIds = [...new Set(accounts.map((a) => a.launch_connection_id).filter(Boolean))]
  const { data: conns, error: connErr } = await sb
    .from("facebook_connections")
    .select("id, access_token, label, token_status, is_active, connection_type")
    .eq("is_active", true)
  if (connErr) throw connErr

  const byId = new Map(conns.map((c) => [c.id, c]))

  // `token_status` in the DB is stale — nothing revalidates it, so a session Meta invalidated
  // months ago still reads "valid". Ask Meta instead of the column.
  let oauth = null
  for (const c of conns.filter((c) => c.connection_type === "oauth")) {
    const { ok } = await graph("me", c, { fields: "id" })
    if (ok) {
      oauth = c
      break
    }
    console.warn(`⚠ OAuth connection ${c.id} reads token_status="${c.token_status}" but Meta rejects it.`)
  }

  const usable = accounts
    .map((a) => {
      const via = a.launch_connection_id ? byId.get(a.launch_connection_id) : null
      const healthyVia =
        via?.is_active && via.token_status === "valid" && via.connection_type === "manual_token" ? via : null
      return { ...a, conn: healthyVia || oauth, slot: healthyVia ? "via-launch" : "oauth-fallback" }
    })
    .filter((a) => a.conn)

  if (viaIds.length === 0) {
    console.warn("⚠ No ad account has a Via LAUNCH slot filled — falling back to the OAuth connection.")
  }
  // Same fb_ad_account_id appears more than once in this table; one probe per account is enough.
  const seen = new Set()
  return usable.filter((a) => {
    const key = a.fb_ad_account_id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Via tokens come from another Meta app and must NOT carry a proof built from our app secret;
 * OAuth tokens are ours and must. Getting this backwards is the trap documented in
 * lib/meta-secure-fetch.ts.
 */
function authParams(conn) {
  const params = { access_token: conn.access_token }
  const secret = process.env.FACEBOOK_APP_SECRET
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

/**
 * One usable campaign per objective, preferring PAUSED so nothing live is touched.
 *
 * The campaign's own shape decides what a valid ad set looks like under it, and getting that wrong
 * makes every goal fail identically — which reads like "Meta rejects this goal" when it means "Meta
 * never got as far as the goal". Two shapes matter:
 *   • CBO (campaign carries the budget) → the ad set must NOT send daily_budget.
 *   • A ROAS/bid-cap bid strategy → the ad set must send bid_constraints, so it is useless as a
 *     probe. Prefer a campaign without one.
 */
async function campaignsByObjective(actId, conn) {
  const { ok, body } = await graph(`act_${actId}/campaigns`, conn, {
    fields: "id,name,objective,status,bid_strategy,daily_budget,lifetime_budget",
    limit: "200",
  })
  if (!ok) return { error: body.error?.message || JSON.stringify(body) }
  const rank = (c) => {
    const constrained = c.bid_strategy && c.bid_strategy !== "LOWEST_COST_WITHOUT_CAP"
    // Lower is better: unconstrained bidding first, then PAUSED.
    return (constrained ? 2 : 0) + (c.status === "PAUSED" ? 0 : 1)
  }
  const out = {}
  for (const c of body.data || []) {
    c.isCbo = Boolean(c.daily_budget || c.lifetime_budget)
    const prev = out[c.objective]
    if (!prev || rank(c) < rank(prev)) out[c.objective] = c
  }
  return { campaigns: out }
}

const targets = await launchTargets()
if (!targets.length) {
  console.error("No ad account has a healthy Via LAUNCH connection. Nothing to validate against.")
  process.exit(1)
}

console.log(`Candidate ad accounts: ${targets.length}\n`)
/** Accounts that are readable AND carry at least one campaign of an objective in the grid. */
const usable = []
for (const t of targets) {
  const actId = (t.fb_account_id || t.fb_ad_account_id || "").replace(/^act_/, "")
  const { campaigns, error } = await campaignsByObjective(actId, t.conn)
  if (error) {
    console.log(`  act_${actId}  ${t.name}  —  UNREADABLE: ${error}`)
    continue
  }
  const found = Object.entries(campaigns)
  if (!found.length) continue
  usable.push({ ...t, actId, campaigns })
  console.log(`  act_${actId}  ${t.name}  [${t.slot}]  objectives=${found.length}`)
  for (const [objective, c] of found) console.log(`      ${objective.padEnd(20)} ${c.id}  ${c.status}  ${c.name}`)
}

if (!usable.length) {
  console.error("\nNo readable account has a campaign to validate an ad set against.")
  process.exit(1)
}
if (DISCOVER_ONLY) process.exit(0)

// ── The grid ────────────────────────────────────────────────────────────────────────────────────
// Goals worth testing per objective: what the matrix already ships, plus the ones §8.1 lists as
// missing. destination_type mirrors lib/odax-matrix.ts.
// destinations is a list, not a value: a goal Meta refuses under one destination_type may be legal
// under another, and testing a single destination cannot tell "this goal is unsupported" apart from
// "this destination is". `null` means send no destination_type at all.
const GRID = {
  OUTCOME_AWARENESS: {
    destinations: [null],
    goals: ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY"],
  },
  OUTCOME_TRAFFIC: {
    destinations: ["WEBSITE", null],
    goals: ["LINK_CLICKS", "LANDING_PAGE_VIEWS", "IMPRESSIONS", "REACH", "DAILY_UNIQUE_REACH"],
  },
  OUTCOME_ENGAGEMENT: {
    destinations: ["ON_POST", "ON_VIDEO", "WEBSITE", null],
    goals: ["POST_ENGAGEMENT", "THRUPLAY", "LINK_CLICKS", "LANDING_PAGE_VIEWS", "IMPRESSIONS", "REACH"],
  },
  OUTCOME_SALES: {
    destinations: ["WEBSITE", null],
    goals: ["OFFSITE_CONVERSIONS", "LINK_CLICKS", "LANDING_PAGE_VIEWS", "IMPRESSIONS", "REACH"],
  },
}

/** TD-39: does Meta accept a 7-day click window on goals other than OFFSITE_CONVERSIONS? */
const WINDOWS = [
  { label: "none", spec: null },
  { label: "1d_click", spec: [{ event_type: "CLICK_THROUGH", window_days: 1 }] },
  { label: "7d_click", spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }] },
]

async function validateAdSet({ actId, conn, campaign, goal, destination, window }) {
  const body = {
    name: `odax-validate ${goal} ${destination || "no-dest"} ${window.label}`,
    campaign_id: campaign.id,
    optimization_goal: goal,
    billing_event: "IMPRESSIONS",
    status: "PAUSED",
    targeting: JSON.stringify({ geo_locations: { countries: ["VN"] } }),
    execution_options: JSON.stringify(["validate_only"]),
  }
  // Under CBO the campaign holds the budget and an ad-set budget is rejected outright — which would
  // fail every goal identically and look like a goal verdict.
  if (!campaign.isCbo) body.daily_budget = 100000
  if (destination) body.destination_type = destination
  if (window.spec) body.attribution_spec = JSON.stringify(window.spec)

  const url = new URL(`${GRAPH}/act_${actId}/adsets`)
  for (const [k, v] of Object.entries(authParams(conn))) url.searchParams.set(k, v)
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  })
  const json = await res.json()
  if (res.ok) return { pass: true }
  const err = json.error || {}
  return {
    pass: false,
    code: err.code,
    sub: err.error_subcode,
    msg: err.error_user_msg || err.message || JSON.stringify(json),
  }
}

console.log("\n── validate_only sweep (creates nothing) ──────────────────────────────\n")
const results = []
// The rules under test are platform-wide, so each objective only needs one campaign anywhere.
// Walking accounts until every objective has been covered beats picking one account that happens
// to be missing three of the four.
const covered = new Set()
for (const t of usable) {
  for (const [objective, cfg] of Object.entries(GRID)) {
    if (covered.has(objective)) continue
    const campaign = t.campaigns[objective]
    if (!campaign) continue
    covered.add(objective)

    console.log(
      `\n${objective}  (campaign ${campaign.id}, act_${t.actId}, ${campaign.isCbo ? "CBO" : "ABO"}, bid=${campaign.bid_strategy || "—"})`
    )
    for (const goal of cfg.goals) {
      // A goal counts as supported if ANY destination accepts it. Find that destination first with
      // no attribution_spec, then vary the window against it — otherwise the window verdict is
      // measuring the destination.
      // `null` is itself a candidate destination ("send no destination_type"), so a found flag —
      // not the truthiness of `accepted` — decides whether the goal is supported.
      let found = false
      let accepted = null
      let lastError = null
      for (const destination of cfg.destinations) {
        const r = await validateAdSet({ actId: t.actId, conn: t.conn, campaign, goal, destination, window: WINDOWS[0] })
        results.push({ objective, goal, destination, window: "none", ...r })
        if (r.pass) {
          found = true
          accepted = destination
          break
        }
        lastError = r
      }

      const row = [goal.padEnd(20), String(accepted ?? "no-dest").padEnd(9), found ? "none:OK" : `none:${lastError.code}${lastError.sub ? "/" + lastError.sub : ""}`]
      if (found) {
        for (const window of WINDOWS.slice(1)) {
          const r = await validateAdSet({ actId: t.actId, conn: t.conn, campaign, goal, destination: accepted, window })
          results.push({ objective, goal, destination: accepted, window: window.label, ...r })
          row.push(r.pass ? `${window.label}:OK` : `${window.label}:${r.code}${r.sub ? "/" + r.sub : ""}`)
        }
      }
      console.log("  " + row.join("  "))
      if (!found) console.log(`      ↳ ${lastError.msg}`)
    }
  }
  if (covered.size === Object.keys(GRID).length) break
}

for (const objective of Object.keys(GRID)) {
  if (!covered.has(objective)) console.log(`\n${objective}: no campaign found in any account — NOT TESTED`)
}

console.log("\n── summary ───────────────────────────────────────────────────────────")
// A goal is supported if SOME destination validates it with no attribution_spec at all.
const goalWorks = new Map()
for (const r of results) {
  if (r.window !== "none") continue
  const key = `${r.objective}|${r.goal}`
  const prev = goalWorks.get(key)
  if (!prev?.pass) goalWorks.set(key, { pass: r.pass, destination: r.destination })
}
for (const [key, v] of goalWorks) {
  const [objective, goal] = key.split("|")
  console.log(`${v.pass ? "✅" : "❌"} ${objective}  ${goal}${v.pass ? `  (destination_type: ${v.destination ?? "none"})` : ""}`)
}

console.log("\nattribution_spec (TD-39):")
for (const objective of Object.keys(GRID)) {
  for (const goal of GRID[objective].goals) {
    if (!goalWorks.get(`${objective}|${goal}`)?.pass) continue
    const w7 = results.find((r) => r.objective === objective && r.goal === goal && r.window === "7d_click")
    const w1 = results.find((r) => r.objective === objective && r.goal === goal && r.window === "1d_click")
    console.log(
      `  ${objective} ${goal}: 1d_click ${w1?.pass ? "OK" : "REJECTED"}, 7d_click ${w7?.pass ? "OK" : "REJECTED"}`
    )
  }
}
