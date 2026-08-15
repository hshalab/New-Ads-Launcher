/**
 * crawl-inspo.mjs — MacMini cron script
 * Crawls Meta Ad Library and indexes ads into inspo_ads_index table.
 *
 * Setup on MacMini:
 *   1. Copy .env.local values to this script or use dotenv
 *   2. Run: node scripts/crawl-inspo.mjs
 *   3. Add the crontab line printed directly below this block (every 6 hours).
 *
 * Usage:
 *   node scripts/crawl-inspo.mjs               # default crawl
 *   node scripts/crawl-inspo.mjs --country VN  # specific country
 *   node scripts/crawl-inspo.mjs --limit 200   # more ads per term
 */

// The crontab line lives outside the block comment on purpose: its `*/6` closes a
// `/** */` block, which is what made this whole file fail to parse.
// crontab: 0 */6 * * * cd /path/to/project && node scripts/crawl-inspo.mjs >> /tmp/crawl-inspo.log 2>&1

import { createClient } from "@supabase/supabase-js"

// ── Config — edit these or load from env ─────────────────────────────────────
const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL        || "https://vrnstjkxumaaduqswkji.supabase.co"
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY       || ""
const AD_LIBRARY_TOKEN    = process.env.FACEBOOK_AD_LIBRARY_TOKEN       || ""
const SCHEMA              = process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA  || "ads_launcher"

// Parse CLI args
const args    = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => i % 2 === 0 ? [a.replace("--",""), arr[i+1]] : null).filter(Boolean))
const COUNTRY = args.country || "US"
const LIMIT   = parseInt(args.limit || "50")
const DRY_RUN = args["dry-run"] === "true"

// ── Search terms to crawl ─────────────────────────────────────────────────────
const SEARCH_TERMS = [
  // E-commerce
  "shop now", "buy now", "sale", "free shipping", "limited offer",
  "new collection", "best seller", "discount", "exclusive deal", "flash sale",
  // Beauty & Health
  "skincare", "beauty", "wellness", "supplement", "vitamins",
  // Fashion
  "fashion", "clothing", "shoes", "accessories", "style",
  // Food & Beverage
  "food delivery", "restaurant", "coffee", "healthy food", "organic",
  // Tech & Apps
  "app", "software", "download", "digital", "online course",
  // Finance
  "save money", "invest", "insurance", "credit card", "loan",
  // Home
  "home decor", "furniture", "kitchen", "cleaning", "garden",
  // Fitness
  "fitness", "gym", "workout", "weight loss", "muscle",
  // Travel
  "travel", "hotel", "flight", "vacation", "booking",
  // Baby & Kids
  "baby", "kids", "parenting", "toys", "education",
]

const GRAPH = "https://graph.facebook.com/v25.0/ads_archive"
const FIELDS = [
  "id", "page_name", "page_id",
  "ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_descriptions",
  "ad_snapshot_url", "ad_delivery_start_time", "ad_delivery_stop_time",
  "publisher_platforms", "languages", "eu_total_reach", "impressions", "spend",
].join(",")

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function safeStr(arr) {
  if (!arr) return ""
  if (typeof arr === "string") return arr
  if (Array.isArray(arr)) return arr[0] || ""
  return ""
}

function rangeUpper(obj) {
  if (!obj) return null
  if (typeof obj === "number") return obj
  return parseInt(obj.upper_bound || obj.max || 0) || null
}

function normalizeAd(raw, searchTerm) {
  const start = raw.ad_delivery_start_time
  const stop  = raw.ad_delivery_stop_time
  const runningDays = start
    ? Math.max(0, Math.floor((new Date(stop || Date.now()).getTime() - new Date(start).getTime()) / 86400000))
    : null

  // Detect media type from snapshot URL hint
  const snapshotUrl = raw.ad_snapshot_url || ""
  const mediaType = "image" // default; video detection needs snapshot fetch

  return {
    id:               raw.id,
    page_id:          raw.page_id || null,
    page_name:        safeStr(raw.page_name) || "Unknown",
    primary_text:     safeStr(raw.ad_creative_bodies) || null,
    headline:         safeStr(raw.ad_creative_link_titles) || null,
    description:      safeStr(raw.ad_creative_link_descriptions) || null,
    ad_snapshot_url:  snapshotUrl || null,
    media_url:        null, // filled later if needed
    media_type:       mediaType,
    publisher_platforms: Array.isArray(raw.publisher_platforms) ? raw.publisher_platforms : [],
    languages:        Array.isArray(raw.languages) ? raw.languages : [],
    status:           raw.ad_delivery_stop_time ? "inactive" : "active",
    first_seen_at:    start ? new Date(start).toISOString() : null,
    last_seen_at:     stop  ? new Date(stop).toISOString()  : null,
    running_days:     runningDays,
    views_upper:      rangeUpper(raw.eu_total_reach) || rangeUpper(raw.impressions),
    spend_upper:      rangeUpper(raw.spend),
    country:          COUNTRY,
    categories:       searchTerm ? [searchTerm] : [],
    indexed_at:       new Date().toISOString(),
    updated_at:       new Date().toISOString(),
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function crawlTerm(term) {
  const params = new URLSearchParams({
    access_token:       AD_LIBRARY_TOKEN,
    search_terms:       term,
    ad_reached_countries: JSON.stringify([COUNTRY]),
    ad_active_status:   "ALL",
    ad_type:            "ALL",
    fields:             FIELDS,
    limit:              String(LIMIT),
  })

  const res  = await fetch(`${GRAPH}?${params}`)
  const data = await res.json()

  if (data.error) {
    console.error(`  ✗ Meta API error for "${term}":`, data.error.message)
    return []
  }

  return (data.data || []).map(ad => normalizeAd(ad, term))
}

async function main() {
  if (!AD_LIBRARY_TOKEN) {
    console.error("❌ FACEBOOK_AD_LIBRARY_TOKEN not set. Add to .env.local")
    process.exit(1)
  }
  if (!SUPABASE_SERVICE_KEY) {
    console.error("❌ SUPABASE_SERVICE_ROLE_KEY not set")
    process.exit(1)
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    db: { schema: SCHEMA }
  })

  console.log(`🚀 Starting Inspo crawl — country: ${COUNTRY}, limit: ${LIMIT}/term, ${SEARCH_TERMS.length} terms`)
  if (DRY_RUN) console.log("🧪 DRY RUN — not saving to DB")

  let totalSaved = 0
  let totalFailed = 0

  for (let i = 0; i < SEARCH_TERMS.length; i++) {
    const term = SEARCH_TERMS[i]
    process.stdout.write(`  [${i+1}/${SEARCH_TERMS.length}] "${term}" ... `)

    try {
      const ads = await crawlTerm(term)
      process.stdout.write(`${ads.length} ads`)

      if (!DRY_RUN && ads.length > 0) {
        const { error } = await db
          .from("inspo_ads_index")
          .upsert(ads, { onConflict: "id", ignoreDuplicates: false })

        if (error) {
          console.error(`\n    ✗ DB error:`, error.message)
          totalFailed += ads.length
        } else {
          totalSaved += ads.length
          process.stdout.write(` ✓\n`)
        }
      } else {
        process.stdout.write(` (dry run)\n`)
        totalSaved += ads.length
      }
    } catch (err) {
      console.error(`\n    ✗ Error: ${err.message}`)
      totalFailed++
    }

    // Rate limit: wait 500ms between terms
    if (i < SEARCH_TERMS.length - 1) await sleep(500)
  }

  console.log(`\n✅ Done! Saved: ${totalSaved} | Failed: ${totalFailed}`)
  console.log(`📊 Total ads in index — check Supabase inspo_ads_index table`)
}

main().catch(err => {
  console.error("Fatal error:", err)
  process.exit(1)
})
