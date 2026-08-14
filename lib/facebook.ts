import { buildMetaHeaders, extractTokenFromUrl, secureMetaFetch, type MetaFetchOpts } from "@/lib/meta-secure-fetch"
import { withAppPrefix } from "@/lib/ad-name-prefix"
import { createHmac } from "crypto"
import * as Sentry from "@sentry/nextjs"

const GRAPH_API_VERSION = "v25.0"
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

// Error codes Meta returns for rate limits (HTTP 200 body OR non-OK status).
const META_RATE_LIMIT_CODES = new Set([4, 17, 32, 613])

function graphTokenParams(accessToken: string) {
  const params = new URLSearchParams({ access_token: accessToken })
  const appSecret = process.env.FACEBOOK_APP_SECRET || ""
  if (appSecret) {
    params.set("appsecret_proof", createHmac("sha256", appSecret).update(accessToken).digest("hex"))
  }
  return params
}

function throwMetaError(data: any, fallback: string): never {
  const code: number = data?.error?.code ?? 0
  const msg: string  = data?.error?.message ?? fallback
  const err = new Error(msg)
  if (META_RATE_LIMIT_CODES.has(code)) err.name = "MetaRateLimitError"
  throw err
}

// Read Meta rate-limit percentage from response headers.
// Returns 0–100 (highest % across all rate-limit dimensions / header types).
// Meta returns different headers depending on the API surface:
//   x-app-usage              — app-level quota (Graph API + Marketing API uploads)
//   x-business-use-case-usage — per-business quota (Marketing API management calls)
//   x-ad-account-usage       — per-ad-account quota
export function parseRateLimit(res: Response): number {
  const pcts: number[] = []
  try {
    const app = res.headers.get("x-app-usage")
    if (app) {
      const v = JSON.parse(app)
      pcts.push(v.call_count ?? 0, v.total_cputime ?? 0, v.total_time ?? 0)
    }
    const buc = res.headers.get("x-business-use-case-usage")
    if (buc) {
      const entries = (Object.values(JSON.parse(buc)) as any[][]).flat()
      entries.forEach((v: any) => pcts.push(v.call_count ?? 0, v.total_time ?? 0, v.total_cputime ?? 0))
    }
    const ad = res.headers.get("x-ad-account-usage")
    if (ad) {
      const v = JSON.parse(ad)
      pcts.push(v.acc_id_util_pct ?? 0)
    }
  } catch {}
  return pcts.length > 0 ? Math.max(...pcts) : 0
}

// NOTE: ads_management, ads_read, business_management, pages_manage_ads,
// catalog_management require App Review OR must be added in Facebook Developer
// Dashboard under Use Cases → Customize for dev mode to work.
export const FB_PERMISSIONS = [
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_engagement",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_manage_posts",
  "ads_read",
  "ads_management",
  "catalog_management",
].join(",")

export function getFacebookLoginUrl(redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_FACEBOOK_APP_ID!,
    redirect_uri: redirectUri,
    scope: FB_PERMISSIONS,
    response_type: "code",
    state,
  })
  return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params}`
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; token_type: string; expires_in: number }> {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID!,
    client_secret: process.env.FACEBOOK_APP_SECRET!,
    redirect_uri: redirectUri,
    code,
  })

  const res = await secureMetaFetch(`${GRAPH_API_BASE}/oauth/access_token?${params}`)
  if (!res.ok) {
    const error = await res.json()
    throw new Error(error.error?.message || "Failed to exchange code for token")
  }
  return res.json()
}

export async function getLongLivedToken(
  shortLivedToken: string
): Promise<{ access_token: string; token_type: string; expires_in: number }> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.FACEBOOK_APP_ID!,
    client_secret: process.env.FACEBOOK_APP_SECRET!,
    fb_exchange_token: shortLivedToken,
  })

  const res = await secureMetaFetch(`${GRAPH_API_BASE}/oauth/access_token?${params}`)
  if (!res.ok) {
    const error = await res.json()
    throw new Error(error.error?.message || "Failed to get long-lived token")
  }
  return res.json()
}

export interface FacebookUser {
  id: string
  name: string
  email?: string
  picture?: { data: { url: string } }
}

export async function getFacebookUser(accessToken: string): Promise<FacebookUser> {
  const res = await fetch(
    `${GRAPH_API_BASE}/me?fields=id,name,picture`,
    { headers: buildMetaHeaders(accessToken) }
  )
  if (!res.ok) {
    const error = await res.json()
    throw new Error(error.error?.message || "Failed to get user info")
  }
  return res.json()
}

export interface InstagramAccount {
  id: string
  username?: string
  profile_pic?: string
}

export interface MessengerUserProfile {
  id: string
  first_name?: string
  last_name?: string
  profile_pic?: string
}

export async function getMessengerUserProfile(psid: string, pageAccessToken: string): Promise<MessengerUserProfile | null> {
  const fields = "id,first_name,last_name,profile_pic"
  const params = graphTokenParams(pageAccessToken)
  params.set("fields", fields)
  const res = await fetch(`${GRAPH_API_BASE}/${encodeURIComponent(psid)}?${params.toString()}`)
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.error) {
    console.warn("[messenger-profile] unable to fetch customer profile", data?.error || res.status)
    return null
  }
  return data
}

export async function getMessengerUserPicture(psid: string, pageAccessToken: string): Promise<string | null> {
  const params = graphTokenParams(pageAccessToken)
  params.set("redirect", "false")
  params.set("type", "large")
  const res = await fetch(`${GRAPH_API_BASE}/${encodeURIComponent(psid)}/picture?${params.toString()}`)
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.error) {
    console.warn("[messenger-profile] unable to fetch customer picture", data?.error || res.status)
    return null
  }
  return data?.data?.url || null
}

export interface FacebookPage {
  id: string
  name: string
  access_token: string
  category: string
  picture?: { data: { url: string } }
  instagram_accounts?: { data: InstagramAccount[] }
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }

async function fetchAllMetaPages<T>(initialUrl: string, fallbackMessage: string, maxRows?: number): Promise<T[]> {
  const rows: T[] = []
  let url: string | null = initialUrl

  while (url) {
    const res: Response = await fetch(url)
    const data: any = await res.json()
    if (data?.error || !res.ok) throwMetaError(data, fallbackMessage)
    rows.push(...(data.data || []))
    if (maxRows && rows.length >= maxRows) return rows.slice(0, maxRows)
    url = data.paging?.next || null
  }

  return rows
}

export interface MetaPage<T> {
  data: T[]
  paging: {
    after?: string
    before?: string
    hasNext: boolean
    hasPrevious: boolean
  }
}

async function fetchMetaPage<T>(url: string, fallbackMessage: string): Promise<MetaPage<T>> {
  const response = await fetch(url)
  const body = await response.json() as {
    data?: T[]
    error?: unknown
    paging?: {
      next?: string
      previous?: string
      cursors?: { after?: string; before?: string }
    }
  }
  if (body?.error || !response.ok) throwMetaError(body, fallbackMessage)
  return {
    data: body.data || [],
    paging: {
      after: body.paging?.cursors?.after,
      before: body.paging?.cursors?.before,
      hasNext: Boolean(body.paging?.next),
      hasPrevious: Boolean(body.paging?.previous),
    },
  }
}

export async function getFacebookPages(accessToken: string): Promise<FacebookPage[]> {
  const url = `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token,category,picture&access_token=${accessToken}`
  const MAX_RETRIES = 3

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * Math.pow(2, attempt - 1)) // 1s → 2s → 4s

    const res  = await fetch(url)
    const data = await res.json()

    if (data?.error) {
      const code: number = data.error.code ?? 0
      const msg: string  = data.error.message ?? "Failed to get pages"
      if (META_RATE_LIMIT_CODES.has(code) && attempt < MAX_RETRIES) {
        console.warn(`[getFacebookPages] rate limit code=${code} attempt=${attempt}/${MAX_RETRIES}, retrying...`)
        continue
      }
      throwMetaError(data, msg)
    }

    if (!res.ok) throw new Error(`Failed to get pages (HTTP ${res.status})`)
    return data.data || []
  }

  throw new Error("Facebook API rate limit reached — /me/accounts")
}

// Fetch pages filtered by the business that owns the given ad account.
// Falls back to all /me/accounts pages if the account has no business (personal account).
export async function getAdAccountPages(adAccountId: string, userToken: string): Promise<FacebookPage[]> {
  const allPages = await getFacebookPages(userToken)

  try {
    const accountRes = await fetch(
      `${GRAPH_API_BASE}/${adAccountId}?fields=business&access_token=${userToken}`
    )
    if (!accountRes.ok) return allPages
    const accountData = await accountRes.json()
    const businessId = accountData.business?.id
    if (!businessId) return allPages

    const bizRes = await fetch(
      `${GRAPH_API_BASE}/${businessId}/pages?fields=id&limit=500&access_token=${userToken}`
    )
    if (!bizRes.ok) return allPages
    const bizData = await bizRes.json()
    const bizPageIds = new Set<string>((bizData.data || []).map((p: any) => p.id as string))

    const filtered = allPages.filter(p => bizPageIds.has(p.id))
    return filtered.length > 0 ? filtered : allPages
  } catch {
    return allPages
  }
}

// Fetch instagram accounts for a specific page using the page's own access token
export async function getPageInstagramAccounts(pageId: string, pageAccessToken: string): Promise<InstagramAccount[]> {
  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${pageId}?fields=instagram_accounts{id,username,profile_pic}&access_token=${pageAccessToken}`
    )
    if (!res.ok) return []
    const data = await res.json()
    return data.instagram_accounts?.data || []
  } catch {
    return []
  }
}

// Batch-fetch instagram accounts for multiple pages in a single Meta Batch API call.
// Reduces N separate requests to 1 (max 50 pages per batch).
export async function getBatchPageInstagramAccounts(
  pages: Array<{ id: string; access_token: string }>,
  userToken: string
): Promise<Map<string, InstagramAccount[]>> {
  const result = new Map<string, InstagramAccount[]>()
  const BATCH_SIZE = 50

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const chunk = pages.slice(i, i + BATCH_SIZE)
    const batch = chunk.map(p => ({
      method: "GET",
      relative_url: `${p.id}?fields=instagram_accounts{id,username,profile_pic}`,
      access_token: p.access_token,
    }))

    try {
      const body = new URLSearchParams({
        access_token: userToken,
        batch: JSON.stringify(batch),
      })
      const res = await secureMetaFetch(`${GRAPH_API_BASE}/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      })
      if (!res.ok) {
        for (const p of chunk) result.set(p.id, [])
        continue
      }
      const responses: Array<{ code: number; body: string } | null> = await res.json()
      for (let j = 0; j < chunk.length; j++) {
        const pageId = chunk[j].id
        const item = responses[j]
        if (!item || item.code !== 200) { result.set(pageId, []); continue }
        try {
          const data = JSON.parse(item.body)
          result.set(pageId, data.instagram_accounts?.data || [])
        } catch {
          result.set(pageId, [])
        }
      }
    } catch {
      for (const p of chunk) result.set(p.id, [])
    }
  }

  return result
}

export interface AdAccount {
  id: string
  account_id: string
  name: string
  account_status: number
  currency: string
  amount_spent?: string
  balance?: string
  spend_cap?: string
  timezone_name?: string
  business?: {
    id: string
    name?: string
  }
}

export async function getAdAccounts(accessToken: string): Promise<AdAccount[]> {
  let url: string | null = `${GRAPH_API_BASE}/me/adaccounts?fields=id,account_id,name,account_status,currency,amount_spent,balance,spend_cap,timezone_name,business{id,name}&limit=200&access_token=${accessToken}`
  const accounts: AdAccount[] = []
  const seen = new Set<string>()

  for (let page = 0; url && page < 100; page++) {
    if (seen.has(url)) throw new Error("Meta returned a repeated ad-account cursor")
    seen.add(url)
    const res: Response = await fetch(url)
    try {
      const { recordUsageHeaders } = await import("@/lib/rate-limit-store")
      recordUsageHeaders(res.headers)
    } catch {}
    if (!res.ok) {
      const error = await res.json()
      throw new Error(error.error?.message || "Failed to get ad accounts")
    }
    const data: { data?: AdAccount[]; paging?: { next?: string } } = await res.json()
    accounts.push(...(data.data || []))
    url = data.paging?.next || null
  }

  if (url) throw new Error("Ad-account list exceeded the 20,000-row safety limit")
  return accounts
}

export interface FacebookPixel {
  id: string
  name: string
}

export async function getPixels(
  adAccountId: string,
  accessToken: string
): Promise<FacebookPixel[]> {
  const res = await fetch(
    `${GRAPH_API_BASE}/${adAccountId}/adspixels?fields=id,name&access_token=${accessToken}`
  )
  if (!res.ok) {
    const error = await res.json()
    throw new Error(error.error?.message || "Failed to get pixels")
  }
  const data = await res.json()
  return data.data || []
}

// Campaign interfaces and functions
export interface CampaignInsight {
  spend: string
  impressions: string
  clicks: string
  reach?: string
  frequency?: string
  cpc?: string
  cpm?: string
  ctr?: string
  inline_link_clicks?: string
  unique_clicks?: string
  unique_inline_link_clicks?: string
  unique_link_clicks_ctr?: string
  actions?: { action_type: string; value: string }[]
  action_values?: { action_type: string; value: string }[]
  cost_per_action_type?: { action_type: string; value: string }[]
  video_avg_time_watched_actions?: { action_type: string; value: string }[]
  date_start: string
  date_stop: string
}

/**
 * Shared insights subfields for Ads Manager ECOM columns.
 * Exported because breakdown rows are scored by the same metric resolver as the
 * parent rows they sit under — request a shorter list there and the sub-rows
 * render 0 for every column the resolver can't find.
 */
export const ADS_MANAGER_INSIGHT_FIELDS = [
  "spend", "impressions", "clicks", "reach", "frequency", "cpm", "ctr",
  "inline_link_clicks", "unique_clicks", "unique_inline_link_clicks", "unique_link_clicks_ctr",
  "actions", "action_values", "cost_per_action_type",
  "video_avg_time_watched_actions",
].join(",")

export interface Campaign {
  id: string
  name: string
  status: string
  effective_status: string
  objective: string
  daily_budget?: string
  lifetime_budget?: string
  budget_remaining?: string
  spend_cap?: string
  bid_strategy?: string
  special_ad_categories?: string[]
  start_time?: string
  stop_time?: string
  created_time: string
  updated_time: string
  insights?: { data: CampaignInsight[] }
  adsets?: { summary: { total_count: number } }
}

export async function getCampaigns(
  adAccountId: string,
  accessToken: string,
  datePreset: string = "last_7d",
  timeRange?: string,
  maxRows?: number,
  activeOnly = false
): Promise<Campaign[]> {
  const pageLimit = maxRows ? Math.min(25, maxRows) : 25
  const statusFilter = activeOnly ? `&effective_status=${encodeURIComponent(JSON.stringify(["ACTIVE"]))}` : ""
  const insightsParam = timeRange
    ? `insights.time_range(${timeRange}){${ADS_MANAGER_INSIGHT_FIELDS}}`
    : `insights.date_preset(${datePreset}){${ADS_MANAGER_INSIGHT_FIELDS}}`
  const fields = [
    "id", "name", "status", "effective_status", "objective",
    "daily_budget", "lifetime_budget", "budget_remaining", "spend_cap", "bid_strategy",
    "start_time", "stop_time", "created_time", "updated_time",
    insightsParam,
    "adsets.limit(0).summary(true)",
  ].join(",")

  return fetchAllMetaPages<Campaign>(
    `${GRAPH_API_BASE}/${adAccountId}/campaigns?fields=${encodeURIComponent(fields)}&limit=${pageLimit}${statusFilter}&access_token=${accessToken}`,
    "Failed to get campaigns",
    maxRows
  )
}

export async function getCampaignsPage(
  adAccountId: string,
  accessToken: string,
  datePreset = "last_7d",
  timeRange?: string,
  limit = 20,
  activeOnly = false,
  after?: string
): Promise<MetaPage<Campaign>> {
  const insightsParam = timeRange
    ? `insights.time_range(${timeRange}){${ADS_MANAGER_INSIGHT_FIELDS}}`
    : `insights.date_preset(${datePreset}){${ADS_MANAGER_INSIGHT_FIELDS}}`
  const fields = [
    "id", "name", "status", "effective_status", "objective",
    "daily_budget", "lifetime_budget", "budget_remaining", "spend_cap", "bid_strategy",
    "start_time", "stop_time", "created_time", "updated_time",
    insightsParam,
    "adsets.limit(0).summary(true)",
  ].join(",")
  const params = new URLSearchParams({
    fields,
    limit: String(Math.min(20, Math.max(1, limit))),
    access_token: accessToken,
  })
  if (activeOnly) params.set("effective_status", JSON.stringify(["ACTIVE"]))
  if (after) params.set("after", after)
  return fetchMetaPage<Campaign>(
    `${GRAPH_API_BASE}/${adAccountId}/campaigns?${params}`,
    "Failed to get campaigns"
  )
}

// Ad Set interfaces and functions
export interface LearningStageInfo {
  status?: "LEARNING" | "SUCCESS" | "LEARNING_LIMITED" | string
  conversions?: number
  last_sig_edit_ts?: number
}

export interface AttributionSpecEntry {
  event_type?: string
  window_days?: number
}

export interface AdSet {
  id: string
  name: string
  status: string
  effective_status: string
  campaign_id: string
  campaign_name?: string
  daily_budget?: string
  lifetime_budget?: string
  budget_remaining?: string
  bid_strategy?: string
  bid_amount?: string
  optimization_goal?: string
  billing_event?: string
  is_dynamic_creative?: boolean
  attribution_spec?: AttributionSpecEntry[]
  learning_stage_info?: LearningStageInfo
  targeting?: {
    age_min?: number
    age_max?: number
    genders?: number[]
    geo_locations?: { countries?: string[] }
  }
  start_time?: string
  end_time?: string
  created_time: string
  insights?: { data: CampaignInsight[] }
}

export async function getAdSets(
  adAccountId: string,
  accessToken: string,
  campaignId?: string,
  datePreset: string = "last_7d",
  timeRange?: string,
  maxRows?: number,
  activeOnly = false
): Promise<AdSet[]> {
  const pageLimit = maxRows ? Math.min(25, maxRows) : 25
  const statusFilter = activeOnly ? `&effective_status=${encodeURIComponent(JSON.stringify(["ACTIVE"]))}` : ""
  const insightsParam = timeRange
    ? `insights.time_range(${timeRange}){${ADS_MANAGER_INSIGHT_FIELDS}}`
    : `insights.date_preset(${datePreset}){${ADS_MANAGER_INSIGHT_FIELDS}}`
  const fields = [
    "id", "name", "status", "effective_status", "campaign_id", "campaign{name}",
    "daily_budget", "lifetime_budget", "budget_remaining", "is_dynamic_creative",
    "optimization_goal", "billing_event", "bid_strategy", "bid_amount",
    "attribution_spec", "learning_stage_info{status,conversions}",
    "start_time", "end_time", "created_time",
    insightsParam,
  ].join(",")

  let url = `${GRAPH_API_BASE}/${adAccountId}/adsets?fields=${encodeURIComponent(fields)}&limit=${pageLimit}${statusFilter}&access_token=${accessToken}`
  if (campaignId) {
    url = `${GRAPH_API_BASE}/${campaignId}/adsets?fields=${encodeURIComponent(fields)}&limit=${pageLimit}${statusFilter}&access_token=${accessToken}`
  }

  const data = await fetchAllMetaPages<any>(url, "Failed to get ad sets", maxRows)

  // Flatten campaign.name → campaign_name for convenience
  return data.map((a: any) => ({
    ...a,
    campaign_name: a.campaign?.name ?? a.campaign_name ?? null,
  }))
}

export async function getAdSetsPage(
  adAccountId: string,
  accessToken: string,
  campaignId?: string,
  datePreset = "last_7d",
  timeRange?: string,
  limit = 20,
  activeOnly = false,
  after?: string
): Promise<MetaPage<AdSet>> {
  const insightsParam = timeRange
    ? `insights.time_range(${timeRange}){${ADS_MANAGER_INSIGHT_FIELDS}}`
    : `insights.date_preset(${datePreset}){${ADS_MANAGER_INSIGHT_FIELDS}}`
  const fields = [
    "id", "name", "status", "effective_status", "campaign_id", "campaign{name}",
    "daily_budget", "lifetime_budget", "budget_remaining", "is_dynamic_creative",
    "optimization_goal", "billing_event", "bid_strategy", "bid_amount",
    "attribution_spec", "learning_stage_info{status,conversions}",
    "start_time", "end_time", "created_time",
    insightsParam,
  ].join(",")
  const params = new URLSearchParams({
    fields,
    limit: String(Math.min(20, Math.max(1, limit))),
    access_token: accessToken,
  })
  if (activeOnly) params.set("effective_status", JSON.stringify(["ACTIVE"]))
  if (after) params.set("after", after)
  const ownerId = campaignId || adAccountId
  const page = await fetchMetaPage<AdSet & { campaign?: { name?: string } }>(
    `${GRAPH_API_BASE}/${ownerId}/adsets?${params}`,
    "Failed to get ad sets"
  )
  return {
    ...page,
    data: page.data.map(adSet => ({
      ...adSet,
      campaign_name: adSet.campaign?.name ?? adSet.campaign_name,
    })),
  }
}

// Ad interfaces and functions
export interface CreativeVariations {
  bodies: string[]
  titles: string[]
  descriptions: string[]
}

export interface Ad {
  id: string
  name: string
  status: string
  effective_status: string
  adset_id: string
  campaign_id: string
  creative?: {
    id: string
    name?: string
    title?: string
    body?: string
    image_url?: string
    thumbnail_url?: string
  }
  // Normalized from creative.asset_feed_spec (MTO / Dynamic Creative). Present when the ad
  // carries multiple text options — what Meta Ads Manager shows as expandable variations.
  creative_variations?: CreativeVariations
  created_time: string
}

// ponytail: inline normalization — expand later if more asset_feed_spec fields surface
function normalizeVariations(raw: any): CreativeVariations | undefined {
  if (!raw) return undefined
  const bodies = (raw.bodies || []).map((b: any) => b?.text).filter(Boolean)
  const titles = (raw.titles || []).map((t: any) => t?.text).filter(Boolean)
  const descriptions = (raw.descriptions || []).map((d: any) => d?.text).filter(Boolean)
  const multi = bodies.length > 1 || titles.length > 1 || descriptions.length > 1
  if (!multi) return undefined
  return { bodies, titles, descriptions }
}

export async function getAds(
  adAccountId: string,
  accessToken: string,
  adSetId?: string,
  datePreset: string = "last_7d",
  timeRange?: string,
  maxRows?: number,
  activeOnly = false
): Promise<Ad[]> {
  const pageLimit = maxRows ? Math.min(25, maxRows) : 25
  const statusFilter = activeOnly ? `&effective_status=${encodeURIComponent(JSON.stringify(["ACTIVE"]))}` : ""
  // Ads path is the heaviest: many rows × creative × insights. Keep slim creative
  // + small page size; unique_* scalars are cheap and needed by ECOM columns.
  const adsInsightFields = [
    "spend", "impressions", "clicks", "reach", "frequency", "cpm", "ctr",
    "inline_link_clicks", "unique_clicks", "unique_inline_link_clicks", "unique_link_clicks_ctr",
    "actions", "action_values", "cost_per_action_type",
    "video_avg_time_watched_actions",
  ].join(",")
  const insightsParam = timeRange
    ? `insights.time_range(${timeRange}){${adsInsightFields}}`
    : `insights.date_preset(${datePreset}){${adsInsightFields}}`
  const fields = [
    "id", "name", "status", "effective_status", "adset_id", "campaign_id",
    "adset{attribution_spec,is_dynamic_creative,bid_strategy,learning_stage_info{status,conversions}}",
    "creative{id,name,title,body,image_url,thumbnail_url,asset_feed_spec{bodies{text},titles{text},descriptions{text}}}",
    "created_time",
    insightsParam,
  ].join(",")

  // Page size 25 — Meta rejects large multi-edge ads payloads with
  // "Please reduce the amount of data you're asking for".
  let url = `${GRAPH_API_BASE}/${adAccountId}/ads?fields=${encodeURIComponent(fields)}&limit=${pageLimit}${statusFilter}&access_token=${accessToken}`
  if (adSetId) {
    url = `${GRAPH_API_BASE}/${adSetId}/ads?fields=${encodeURIComponent(fields)}&limit=${pageLimit}${statusFilter}&access_token=${accessToken}`
  }

  const ads = await fetchAllMetaPages<Ad & { creative?: any }>(url, "Failed to get ads", maxRows)
  return ads.map((ad) => {
    const creative = ad.creative
    const creative_variations = normalizeVariations(creative?.asset_feed_spec)
    if (!creative_variations) return ad

    const fallbackTitle = creative?.object_story_spec?.link_data?.name || creative?.object_story_spec?.video_data?.title || creative?.title
    const fallbackBody = creative?.object_story_spec?.link_data?.message || creative?.object_story_spec?.video_data?.message || creative?.body
    return {
      ...ad,
      creative: {
        ...creative,
        title: creative_variations.titles[0] || fallbackTitle,
        body: creative_variations.bodies[0] || fallbackBody,
      },
      creative_variations,
    }
  })
}

export async function getAdsPage(
  adAccountId: string,
  accessToken: string,
  adSetId?: string,
  datePreset = "last_7d",
  timeRange?: string,
  limit = 20,
  activeOnly = false,
  after?: string
): Promise<MetaPage<Ad>> {
  const adsInsightFields = [
    "spend", "impressions", "clicks", "reach", "frequency", "cpm", "ctr",
    "inline_link_clicks", "unique_clicks", "unique_inline_link_clicks", "unique_link_clicks_ctr",
    "actions", "action_values", "cost_per_action_type", "video_avg_time_watched_actions",
  ].join(",")
  const insightsParam = timeRange
    ? `insights.time_range(${timeRange}){${adsInsightFields}}`
    : `insights.date_preset(${datePreset}){${adsInsightFields}}`
  const fields = [
    "id", "name", "status", "effective_status", "adset_id", "campaign_id",
    "adset{attribution_spec,is_dynamic_creative,bid_strategy,learning_stage_info{status,conversions}}",
    "creative{id,name,title,body,image_url,thumbnail_url,asset_feed_spec{bodies{text},titles{text},descriptions{text}}}",
    "created_time",
    insightsParam,
  ].join(",")
  const params = new URLSearchParams({
    fields,
    limit: String(Math.min(20, Math.max(1, limit))),
    access_token: accessToken,
  })
  if (activeOnly) params.set("effective_status", JSON.stringify(["ACTIVE"]))
  if (after) params.set("after", after)
  const ownerId = adSetId || adAccountId
  const page = await fetchMetaPage<Ad & { creative?: Ad["creative"] & { asset_feed_spec?: unknown } }>(
    `${GRAPH_API_BASE}/${ownerId}/ads?${params}`,
    "Failed to get ads"
  )
  return {
    ...page,
    data: page.data.map(ad => {
      const creative_variations = normalizeVariations(ad.creative?.asset_feed_spec)
      return creative_variations ? { ...ad, creative_variations } : ad
    }),
  }
}

// Business Manager interfaces and functions
export interface BusinessManager {
  id: string
  name: string
}

export async function getBusinessManagers(
  accessToken: string
): Promise<BusinessManager[]> {
  const res = await fetch(
    `${GRAPH_API_BASE}/me/businesses?fields=id,name&access_token=${accessToken}`
  )
  if (!res.ok) {
    const error = await res.json()
    throw new Error(
      error.error?.message || "Failed to get business managers"
    )
  }
  const data = await res.json()
  return data.data || []
}

// Get pages owned by a Business Manager
export async function getBusinessPages(
  businessId: string,
  accessToken: string
): Promise<FacebookPage[]> {
  const res = await fetch(
    `${GRAPH_API_BASE}/${businessId}/owned_pages?fields=id,name,access_token,category,picture&access_token=${accessToken}`
  )
  if (!res.ok) {
    const error = await res.json()
    throw new Error(error.error?.message || "Failed to get business pages")
  }
  const data = await res.json()
  return data.data || []
}

// Get ad accounts owned by a Business Manager
export async function getBusinessAdAccounts(
  businessId: string,
  accessToken: string
): Promise<AdAccount[]> {
  const res = await fetch(
    `${GRAPH_API_BASE}/${businessId}/owned_ad_accounts?fields=id,account_id,name,account_status,currency&access_token=${accessToken}`
  )
  if (!res.ok) {
    const error = await res.json()
    throw new Error(
      error.error?.message || "Failed to get business ad accounts"
    )
  }
  const data = await res.json()
  return data.data || []
}

// Upload image to Meta Ad Account
// Returns hash, url, and permalink_url
export async function uploadImageToMeta(
  adAccountId: string,
  accessToken: string,
  fileBuffer: ArrayBuffer,
  fileName: string,
  opts?: MetaFetchOpts
): Promise<{ hash: string; url: string; url_128: string; rateLimitPct: number }> {
  const normId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const base64 = Buffer.from(fileBuffer).toString("base64")

  const formData = new FormData()
  formData.append("filename", fileName)
  formData.append("bytes", base64)

  const res = await fetch(
    `${GRAPH_API_BASE}/${normId}/adimages`,
    { method: "POST", body: formData, headers: buildMetaHeaders(accessToken, opts) }
  )
  const rateLimitPct = parseRateLimit(res)
  const resText = await res.text()
  let data: any = {}
  try { data = JSON.parse(resText) } catch (e) {
    throw new Error(`Meta Image Upload failed to parse JSON. Status: ${res.status}, Body: ${resText}`)
  }

  if (!res.ok) {
    throw new Error(data.error?.message || "Failed to upload image to Meta")
  }

  const images = data.images || {}
  const firstKey = Object.keys(images)[0]
  const img = images[firstKey] || {}

  return {
    hash: img.hash || "",
    url: img.url || "",
    url_128: img.url_128 || "",
    rateLimitPct,
  }
}


// Upload video to Meta Ad Account using Resumable Upload (recommended for stability)
// Phase 1: START, Phase 2: TRANSFER, Phase 3: FINISH
export async function uploadVideoToMeta(
  adAccountId: string,
  accessToken: string,
  fileBuffer: ArrayBuffer,
  fileName: string,
  opts?: MetaFetchOpts
): Promise<{ videoId: string; rateLimitPct: number }> {
  const normId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const fileSize = fileBuffer.byteLength
  
  // Phase 1: START
  const startParams = new URLSearchParams({
    access_token: accessToken,
    upload_phase: "start",
    file_size: fileSize.toString(),
  })
  
  const startRes = await secureMetaFetch(`${GRAPH_API_BASE}/${normId}/advideos`, {
    method: "POST",
    body: startParams,
  }, opts)
  
  const startText = await startRes.text()
  let startData: any = {}
  try { startData = JSON.parse(startText) } catch (e) {
    throw new Error(`Meta Video Upload START failed to parse JSON. Status: ${startRes.status}, Body: ${startText}`)
  }
  
  if (!startRes.ok) {
    throw new Error(`Meta Video Upload START failed: ${startData.error?.message || "Unknown error"}`)
  }
  
  const { upload_session_id, video_id } = startData
  
  // Phase 2: TRANSFER
  // Dynamically calculate chunk size to optimize for large files (like 200MB-300MB)
  let CHUNK_SIZE = 4 * 1024 * 1024 // Default 4MB
  if (fileSize > 150 * 1024 * 1024) {
    CHUNK_SIZE = 20 * 1024 * 1024 // 20MB chunks for files > 150MB
  } else if (fileSize > 50 * 1024 * 1024) {
    CHUNK_SIZE = 10 * 1024 * 1024 // 10MB chunks for files > 50MB
  }
  
  const MAX_CHUNK_ATTEMPTS = 4
  let startOffset = Number(startData.start_offset || "0")

  while (startOffset < fileSize) {
    const endOffset = Math.min(startOffset + CHUNK_SIZE, fileSize)

    let transferData: any = null
    let lastErr: string | null = null
    for (let cAttempt = 1; cAttempt <= MAX_CHUNK_ATTEMPTS; cAttempt++) {
      const chunkBuffer = fileBuffer.slice(startOffset, endOffset)
      const formData = new FormData()
      formData.append("access_token", accessToken)
      formData.append("upload_phase", "transfer")
      formData.append("upload_session_id", upload_session_id)
      formData.append("start_offset", String(startOffset))
      formData.append("video_file_chunk", new Blob([chunkBuffer]), fileName)

      try {
        const transferRes = await secureMetaFetch(`${GRAPH_API_BASE}/${normId}/advideos`, {
          method: "POST",
          body: formData,
        }, opts)

        const transferText = await transferRes.text()
        try {
          transferData = JSON.parse(transferText)
        } catch {
          Sentry.captureMessage("Meta Video Transfer Parsing Error", {
            level: "error",
            extra: { status: transferRes.status, bodyExcerpt: transferText.slice(0, 500) }
          })
          throw new Error(`failed to parse JSON. Status: ${transferRes.status}, Body: ${transferText}`)
        }

        if (!transferRes.ok) {
          Sentry.captureMessage("Meta Video Transfer Network Error", {
            level: "error",
            extra: {
              status: transferRes.status,
              errorCode: transferData?.error?.code,
              errorSubcode: transferData?.error?.error_subcode,
              message: transferData?.error?.message
            }
          })
          throw new Error(transferData?.error?.message || "Unknown error")
        }
        lastErr = null
        break
      } catch (e: any) {
        lastErr = e?.message || "Transfer error"
        if (cAttempt < MAX_CHUNK_ATTEMPTS) {
          // TD-22: Exponential backoff for chunk retry
          await new Promise(r => setTimeout(r, Math.pow(2, cAttempt) * 1000))
        }
      }
    }

    if (lastErr || !transferData) {
      throw new Error(`Meta Video Upload TRANSFER failed at offset ${startOffset} after ${MAX_CHUNK_ATTEMPTS} attempts: ${lastErr}`)
    }

    startOffset = Number(transferData.start_offset)
  }
  
  // Phase 3: FINISH
  const finishParams = new URLSearchParams({
    access_token: accessToken,
    upload_phase: "finish",
    upload_session_id: upload_session_id,
    title: fileName,
  })
  
  const finishRes = await secureMetaFetch(`${GRAPH_API_BASE}/${normId}/advideos`, {
    method: "POST",
    body: finishParams,
  }, opts)

  const rateLimitPct = parseRateLimit(finishRes)
  const finishText = await finishRes.text()
  let finishData: any = {}
  try { finishData = JSON.parse(finishText) } catch (e) {
    throw new Error(`Meta Video Upload FINISH failed to parse JSON. Status: ${finishRes.status}, Body: ${finishText}`)
  }

  if (!finishRes.ok) {
    throw new Error(`Meta Video Upload FINISH failed: ${finishData.error?.message || "Unknown error"}`)
  }

  return { videoId: video_id, rateLimitPct }
}

// Get full details of an ad including adset & campaign settings (for template copy)
export interface AdDetails {
  id: string
  name: string
  status: string
  adset: {
    id: string
    name: string
    campaign_id: string
    targeting: any
    optimization_goal: string
    billing_event: string
    bid_amount?: string
    bid_strategy?: string
    daily_budget?: string
    lifetime_budget?: string
    promoted_object?: Record<string, any>
    attribution_spec?: any[]
  }
  campaign: {
    id: string
    name: string
    objective: string
    special_ad_categories: string[]
    daily_budget?: string
    lifetime_budget?: string
    bid_strategy?: string
  }
}

export async function getAdDetails(adId: string, accessToken: string, opts?: { isManual?: boolean }): Promise<AdDetails> {
  const fields = [
    "id", "name", "status",
    "adset{id,name,campaign_id,targeting,optimization_goal,billing_event,bid_amount,bid_strategy,daily_budget,lifetime_budget,promoted_object,attribution_spec,is_dynamic_creative}",
    "campaign{id,name,objective,special_ad_categories,daily_budget,lifetime_budget,bid_strategy}",
  ].join(",")
  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${adId}?fields=${fields}&access_token=${accessToken}`, undefined, { skipProof: opts?.isManual })
  if (!res.ok) {
    const error = await res.json()
    throw new Error(error.error?.message || "Failed to get ad details")
  }
  return res.json()
}

// Batch-detect legacy Dynamic Creative ad sets (is_dynamic_creative=true, hard 1-ad cap).
// Best-effort: on API failure returns an empty set so the launch proceeds and Meta's own
// error (mapped in createAd) still surfaces per ad.
export async function getDynamicCreativeAdSets(adsetIds: string[], accessToken: string, opts?: MetaFetchOpts): Promise<Set<string>> {
  const out = new Set<string>()
  if (!adsetIds.length) return out
  try {
    const res = await secureMetaFetch(`${GRAPH_API_BASE}/?ids=${adsetIds.join(",")}&fields=is_dynamic_creative&access_token=${accessToken}`, undefined, opts)
    const data = await res.json()
    if (res.ok && data && !data.error) {
      for (const [id, v] of Object.entries<any>(data)) {
        if (v?.is_dynamic_creative) out.add(id)
      }
    }
  } catch (e) {
    console.warn("[getDynamicCreativeAdSets] lookup failed:", e)
  }
  return out
}

// Batch-fetch campaign_id + name for ad sets — needed to duplicate an ad set via copyAdSet,
// which requires the destination campaign_id. Best-effort: on failure the caller sees an
// empty map and reports "can't duplicate" per adset rather than crashing the whole launch.
export async function getAdSetCampaignsAndNames(adsetIds: string[], accessToken: string, opts?: MetaFetchOpts): Promise<Map<string, { campaign_id: string; name: string }>> {
  const out = new Map<string, { campaign_id: string; name: string }>()
  if (!adsetIds.length) return out
  try {
    const res = await secureMetaFetch(`${GRAPH_API_BASE}/?ids=${adsetIds.join(",")}&fields=campaign_id,name&access_token=${accessToken}`, undefined, opts)
    const data = await res.json()
    if (res.ok && data && !data.error) {
      for (const [id, v] of Object.entries<any>(data)) {
        if (v?.campaign_id) out.set(id, { campaign_id: v.campaign_id, name: v.name || id })
      }
    }
  } catch (e) {
    console.warn("[getAdSetCampaignsAndNames] lookup failed:", e)
  }
  return out
}

export async function getResourceAccountId(resourceId: string, accessToken: string, opts?: { isManual?: boolean }): Promise<string | null> {
  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${resourceId}?fields=account_id&access_token=${accessToken}`, undefined, { skipProof: opts?.isManual })
  const data = await res.json()
  if (!res.ok || data?.error) throw new Error(data?.error?.message || "Failed to validate Meta resource account")
  return data.account_id ? String(data.account_id) : null
}

export interface AttachTargetCampaign {
  id: string
  name: string
  objective: string
  account_id: string
  /** Present ⇒ CBO: the campaign owns the budget and its ad sets must not carry one. */
  daily_budget?: string
  lifetime_budget?: string
  status?: string
}

/**
 * Read the fields the "New ad set or ad" scope needs from an existing campaign.
 *
 * Three of them are load-bearing. `objective` drives the ODAX chain the new ad set must satisfy —
 * Meta only validates that link at ad-set creation, so a mismatch surfaces as error 100 after the
 * request is already half-done. A campaign-level budget (`daily_budget` / `lifetime_budget`) means
 * CBO, and an ad set created under a CBO campaign must not carry a budget of its own. `account_id`
 * is what proves the campaign belongs to the ad account this request is scoped to — without it a
 * caller could attach an ad set to any campaign id it can guess.
 */
export async function getCampaignForAttach(
  campaignId: string,
  accessToken: string,
  opts?: { isManual?: boolean }
): Promise<AttachTargetCampaign> {
  const fields = "id,name,objective,account_id,daily_budget,lifetime_budget,status"
  const res = await secureMetaFetch(
    `${GRAPH_API_BASE}/${campaignId}?fields=${fields}&access_token=${accessToken}`,
    undefined,
    { skipProof: opts?.isManual }
  )
  const data = await res.json()
  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || "Failed to read the selected campaign")
  }
  return data as AttachTargetCampaign
}

// Create a new campaign
export async function createCampaign(
  adAccountId: string,
  accessToken: string,
  params: { name: string; objective: string; special_ad_categories?: string[]; status?: string; daily_budget?: number; bid_strategy?: string; promoted_object?: Record<string, any> },
  opts?: { isManual?: boolean }
): Promise<{ id: string }> {
  const body = new URLSearchParams({
    name: params.name,
    objective: params.objective,
    special_ad_categories: JSON.stringify(params.special_ad_categories || []),
    status: params.status || "PAUSED",
    access_token: accessToken,
  })
  if (params.daily_budget) {
    // CBO mode: budget at campaign level
    body.set("daily_budget", String(Math.round(params.daily_budget * 100)))
    if (params.bid_strategy) body.set("bid_strategy", params.bid_strategy)
  } else {
    // Adset-level budgets: required by v25 when not using CBO
    body.set("is_adset_budget_sharing_enabled", "false")
  }
  if (params.promoted_object) body.set("promoted_object", JSON.stringify(params.promoted_object))
  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${adAccountId}/campaigns`, { method: "POST", body }, { skipProof: opts?.isManual })
  if (!res.ok) {
    const error = await res.json()
    const fb = error.error
    const detail = fb?.error_user_msg || fb?.error_user_title || ""
    throw new Error([fb?.message || "Failed to create campaign", detail].filter(Boolean).join(" — "))
  }
  return res.json()
}

// Create a new ad set (copy settings from template)
export async function createAdSet(
  adAccountId: string,
  accessToken: string,
  params: {
    name: string
    campaign_id: string
    targeting: any
    optimization_goal: string
    billing_event: string
    bid_amount?: string
    bid_strategy?: string
    bid_constraints?: { roas_average_floor: number }
    daily_budget?: string
    lifetime_budget?: string
    status?: string
    start_time?: string
    destination_type?: string
    promoted_object?: Record<string, any>
    attribution_spec?: any[]
    /** Ad transparency — Meta's DSA advertiser/payer, publicly visible in the Ad Library. */
    dsa_beneficiary?: string
    dsa_payor?: string
  },
  opts?: { isManual?: boolean }
): Promise<{ id: string }> {
  const body: Record<string, string> = {
    name: params.name,
    campaign_id: params.campaign_id,
    targeting: JSON.stringify(params.targeting || {}),
    optimization_goal: params.optimization_goal,
    billing_event: params.billing_event,
    status: params.status || "PAUSED",
    access_token: accessToken,
  }
  if (params.bid_amount) body.bid_amount = params.bid_amount
  if (params.bid_strategy) body.bid_strategy = params.bid_strategy
  if (params.bid_constraints) body.bid_constraints = JSON.stringify(params.bid_constraints)
  if (params.daily_budget) body.daily_budget = params.daily_budget
  if (params.lifetime_budget) body.lifetime_budget = params.lifetime_budget
  if (params.start_time) body.start_time = params.start_time
  if (params.destination_type) body.destination_type = params.destination_type
  if (params.promoted_object) body.promoted_object = JSON.stringify(params.promoted_object)
  if (params.attribution_spec) body.attribution_spec = JSON.stringify(params.attribution_spec)
  if (params.dsa_beneficiary) body.dsa_beneficiary = params.dsa_beneficiary
  if (params.dsa_payor) body.dsa_payor = params.dsa_payor

  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${adAccountId}/adsets`, {
    method: "POST",
    body: new URLSearchParams(body),
  }, { skipProof: opts?.isManual })
  if (!res.ok) {
    const error = await res.json()
    const fb = error.error
    const detail = fb?.error_user_msg || fb?.error_user_title || ""
    throw new Error([fb?.message || "Failed to create ad set", detail].filter(Boolean).join(" — "))
  }
  return res.json()
}

// Copy an existing ad set to a new campaign, preserving all settings (attribution model, etc.)
export async function copyAdSet(
  accessToken: string,
  sourceAdsetId: string,
  params: { campaign_id: string; name: string; daily_budget?: number; start_time?: string; status?: string },
  opts?: { isManual?: boolean }
): Promise<{ id: string }> {
  const body = new URLSearchParams({
    campaign_id: params.campaign_id,
    deep_copy: "false",
    status_option: params.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
    name: params.name,
    access_token: accessToken,
  })
  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${sourceAdsetId}/copies`, { method: "POST", body }, { skipProof: opts?.isManual })
  if (!res.ok) {
    const error = await res.json()
    const fb = error.error
    const detail = fb?.error_user_msg || fb?.error_user_title || ""
    throw new Error([fb?.message || "Failed to copy ad set", detail].filter(Boolean).join(" — "))
  }
  const data = await res.json()
  const newId: string = data.copied_adset_id || data.id

  // Update name and budget on the copy
  const patch = new URLSearchParams({ name: params.name, access_token: accessToken })
  if (params.daily_budget) patch.set("daily_budget", String(Math.round(params.daily_budget * 100)))
  if (params.start_time) patch.set("start_time", params.start_time)
  await secureMetaFetch(`${GRAPH_API_BASE}/${newId}`, { method: "POST", body: patch }, { skipProof: opts?.isManual })

  return { id: newId }
}

// Meta CDN thumbnails carry an oe= expiry as a hex Unix timestamp.
// Only a current Meta URL is launch-safe; other URLs must be refreshed from the video.
export function isFreshThumbnailUrl(url?: string | null, bufferMs = 5 * 60_000): boolean {
  if (!url) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  const host = parsed.hostname.toLowerCase()
  const isMetaCdn = host === "fbcdn.net" || host.endsWith(".fbcdn.net") || host === "facebook.com" || host.endsWith(".facebook.com")
  if (!isMetaCdn) return false

  const expiry = parsed.searchParams.get("oe")
  if (!expiry || !/^[0-9a-f]+$/i.test(expiry)) return false

  return Number.parseInt(expiry, 16) * 1000 - bufferMs > Date.now()
}

// Fetch a video's HD thumbnail URL from Facebook.
// Single call fetching both thumbnails and picture — prefers highest-res thumbnail.
export async function getVideoThumbnail(videoId: string, accessToken: string, opts?: MetaFetchOpts): Promise<string | null> {
  try {
    const res = await secureMetaFetch(
      `${GRAPH_API_BASE}/${videoId}?fields=thumbnails{uri,width,height,is_preferred},picture&access_token=${accessToken}`,
      undefined,
      opts
    )
    if (!res.ok) return null
    const data = await res.json()
    const thumbs: Array<{ uri: string; width: number; height: number; is_preferred?: boolean }> = data.thumbnails?.data || []
    if (thumbs.length > 0) {
      const preferred = thumbs.find(t => t.is_preferred)
      if (preferred?.uri) return preferred.uri
      const largest = thumbs.reduce((best, t) => (t.width * t.height) > (best.width * best.height) ? t : best, thumbs[0])
      if (largest?.uri) return largest.uri
    }
    return data.picture || null
  } catch {
    return null
  }
}

// Poll Meta until a video has finished processing (video_status === "ready").
// Upload video to Meta via public URL — Meta pulls the file itself (1 API call, no chunking).
// Prerequisite: fileUrl must be publicly accessible (e.g. Supabase Storage public bucket).
export async function uploadVideoUrlToMeta(
  adAccountId: string,
  accessToken: string,
  fileUrl: string,
  fileName: string,
  opts?: MetaFetchOpts
): Promise<{ videoId: string; rateLimitPct: number }> {
  const normId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`

  const params = new URLSearchParams({
    access_token: accessToken,
    file_url: fileUrl,
    name: fileName,
  })

  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${normId}/advideos`, {
    method: "POST",
    body: params,
  }, opts)

  const rateLimitPct = parseRateLimit(res)
  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error?.message || "Failed to upload video from URL to Meta")
  }

  return { videoId: data.id, rateLimitPct }
}

// Meta /advideos accepts upload immediately and returns an id, but the video is "processing"
// for 10s–2min. Using video_id in createAd before "ready" → ad created but renders no video.
// Returns { ready, status, errorMsg } so caller can surface accurate status.
export async function pollVideoReady(
  videoId: string,
  accessToken: string,
  maxWaitMs: number = 120_000,
  opts?: MetaFetchOpts
): Promise<{ ready: boolean; status: string; errorMsg?: string; waitedMs: number }> {
  // TD-37: Removed in-request setTimeout polling. Just check once.
  // The UI should poll job status or users should re-click launch, not block the HTTP route for 120s.
  const start = Date.now()
  const result = await checkVideoStatus(videoId, accessToken, opts)
  return {
    ...result,
    waitedMs: Date.now() - start
  }
}

// Perform a single check of a video's status on Meta
export async function checkVideoStatus(
  videoId: string,
  accessToken: string,
  opts?: MetaFetchOpts
): Promise<{ ready: boolean; status: string; errorMsg?: string }> {
  try {
    const res = await secureMetaFetch(
      `${GRAPH_API_BASE}/${videoId}?fields=status&access_token=${accessToken}`,
      undefined,
      opts
    )
    if (!res.ok) {
      return { ready: false, status: "unknown", errorMsg: "Failed to fetch status from Meta" }
    }
    const data = await res.json()
    const vstatus = data.status?.video_status as string | undefined
    
    if (vstatus === "ready") {
      return { ready: true, status: vstatus }
    }
    if (vstatus === "error") {
      const errMsg = data.status?.processing_phase?.errors?.[0]?.message
        || data.status?.uploading_phase?.errors?.[0]?.message
        || "Video processing failed on Meta"
      return { ready: false, status: vstatus, errorMsg: errMsg }
    }
    return { ready: false, status: vstatus || "unknown" }
  } catch (err) {
    return { ready: false, status: "error", errorMsg: err instanceof Error ? err.message : "Unknown error" }
  }
}

// Lightweight per-item status read for assignment progress. Unlike
// getVideoReadyData(), this deliberately does not request thumbnails or source URLs.
export async function getVideoProcessingStatus(
  videoId: string,
  accessToken: string,
  opts?: MetaFetchOpts
): Promise<{ ready: boolean; status: string; processingProgress: number | null; errorMsg?: string }> {
  try {
    const res = await secureMetaFetch(
      `${GRAPH_API_BASE}/${videoId}?fields=status&access_token=${accessToken}`,
      undefined,
      opts
    )
    if (!res.ok) {
      return { ready: false, status: "unknown", processingProgress: null, errorMsg: "Failed to fetch status from Meta" }
    }

    const data = await res.json()
    const status = (data.status?.video_status as string | undefined) || "unknown"
    const processingProgress = typeof data.status?.processing_progress === "number"
      ? data.status.processing_progress
      : null
    const errorMsg = status === "error"
      ? (data.status?.processing_phase?.errors?.[0]?.message
          || data.status?.uploading_phase?.errors?.[0]?.message
          || "Video processing failed on Meta")
      : undefined

    return { ready: status === "ready", status, processingProgress, errorMsg }
  } catch (error) {
    return {
      ready: false,
      status: "unknown",
      processingProgress: null,
      errorMsg: error instanceof Error ? error.message : "Failed to fetch status from Meta",
    }
  }
}

// Fetch a video's playable source URL from Facebook
export async function getVideoSource(videoId: string, accessToken: string, opts?: MetaFetchOpts): Promise<string | null> {
  try {
    const res = await secureMetaFetch(
      `${GRAPH_API_BASE}/${videoId}?fields=source&access_token=${accessToken}`,
      undefined,
      opts
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.source || null
  } catch {
    return null
  }
}

// Single call combining status + thumbnail + source — replaces 3 separate API calls.
export async function getVideoReadyData(
  videoId: string,
  accessToken: string,
  opts?: MetaFetchOpts
): Promise<{ ready: boolean; status: string; thumbnailUrl: string | null; sourceUrl: string | null; processingProgress: number | null; errorMsg?: string }> {
  try {
    const res = await secureMetaFetch(
      `${GRAPH_API_BASE}/${videoId}?fields=status,thumbnails{uri,width,height,is_preferred},picture,source&access_token=${accessToken}`,
      undefined,
      opts
    )
    if (!res.ok) return { ready: false, status: "unknown", thumbnailUrl: null, sourceUrl: null, processingProgress: null }
    const data = await res.json()
    const vstatus = (data.status?.video_status as string | undefined) || "unknown"
    const ready = vstatus === "ready"

    let thumbnailUrl: string | null = null
    if (ready) {
      const thumbs: Array<{ uri: string; width: number; height: number; is_preferred?: boolean }> = data.thumbnails?.data || []
      if (thumbs.length > 0) {
        const preferred = thumbs.find(t => t.is_preferred)
        thumbnailUrl = preferred?.uri
          || thumbs.reduce((best, t) => (t.width * t.height) > (best.width * best.height) ? t : best, thumbs[0])?.uri
          || null
      }
      if (!thumbnailUrl) thumbnailUrl = data.picture || null
    }

    const errorMsg = vstatus === "error"
      ? (data.status?.processing_phase?.errors?.[0]?.message
          || data.status?.uploading_phase?.errors?.[0]?.message
          || "Video processing failed on Meta")
      : undefined

    const processingProgress = typeof data.status?.processing_progress === "number"
      ? data.status.processing_progress
      : null

    return { ready, status: vstatus, thumbnailUrl, sourceUrl: data.source || null, processingProgress, errorMsg }
  } catch {
    return { ready: false, status: "error", thumbnailUrl: null, sourceUrl: null, processingProgress: null }
  }
}

// Create a new ad with a creative
export async function createAd(
  adAccountId: string,
  accessToken: string,
  params: {
    name: string
    adset_id: string
    page_id: string
    image_hash?: string
    video_id?: string
    thumbnail_url?: string
    title: string
    body: string
    description?: string
    cta: string
    link_url: string
    display_url?: string
    status?: string
    degrees_of_freedom_spec?: Record<string, any>
    branded_content_sponsor_page_id?: string
    partnership_display_mode?: "dynamic" | "both" | "first"
    multilanguage?: {
      defaultLanguage: string
      translations: Array<{
        language: string
        primaryText: string
        headline: string
        description: string
      }>
    }
    catalog_ads?: {
      catalogId: string
      productSetId?: string
      formatMode: "automatic" | "manual"
      format: "single" | "carousel"
      frameImageUrl?: string
      dynamicMedia: {
        optimizedMediaSelection: boolean
        automaticVideoCropping: boolean
        prioritizeVideo: boolean
      }
    }
    collection_ads?: {
      templateType: "storefront" | "lookbook" | "customer_acquisition"
      productSetId: string
      productCount: number
      order: "dynamic" | "specific"
      ieHeadline?: string
      destinationUrl: string
    }
    carousel_cards?: Array<{
      image_hash?: string
      video_id?: string
      name: string
      description?: string
      link: string
      call_to_action: { type: string; value: { link: string } }
    }>
    carousel_show_collection_tiles?: boolean
    carousel_show_single_media?: boolean
    flexible_asset_feed?: {
      image_hashes: string[]
      videos: { video_id: string; thumbnail_url?: string }[]
      group_asset_indices: Array<{ image_indices?: number[]; video_indices?: number[] }>
    }
    multi_placement?: {
      imageHashes: string[]
      videos: { video_id: string; thumbnail_url?: string }[]
      customRules: any[]
    }
    instagram_actor_id?: string  // IG account to associate with this ad's creative
    // Text variations — triggers asset_feed_spec for Dynamic Creative A/B testing
    text_variations?: {
      bodies: string[]       // all primary text versions (first = default)
      titles: string[]       // all headline versions (first = default)
      descriptions: string[] // all description versions
    }
    // Ad Source modes
    sitelinks?: Array<{ title: string; url: string }>
    object_story_id?: string   // Post ID mode: reuse existing dark post (carries social proof)
    reuse_creative_id?: string // Creative ID mode: reuse existing Meta creative_id
  },
  opts?: { isManual?: boolean } // via token (app khác phát hành) → skip appsecret_proof
): Promise<{ id: string }> {
  // Provenance marker. Normalised once here rather than at each mode below, so
  // every ad the app creates — all three launch routes and the automation
  // engine — carries it. Idempotent; see lib/ad-name-prefix.ts.
  params = { ...params, name: withAppPrefix(params.name) }

  // ── Post ID mode ─────────────────────────────────────────────────────────────
  // Reuse an existing Facebook dark post by its object_story_id.
  // The ad inherits all accumulated social proof (likes, comments, shares).
  if (params.object_story_id) {
    console.log("[createAd] post_id mode — object_story_id:", params.object_story_id)
    const b = new URLSearchParams({
      name: params.name,
      adset_id: params.adset_id,
      creative: JSON.stringify({ object_story_id: params.object_story_id }),
      status: params.status || "PAUSED",
      access_token: accessToken,
    })
    const normId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
    const r = await secureMetaFetch(`${GRAPH_API_BASE}/${normId}/ads`, { method: "POST", body: b }, { skipProof: opts?.isManual })
    const rText = await r.text()
    let rData: any = {}
    try { rData = JSON.parse(rText) } catch {}
    if (!r.ok) {
      const fb = rData.error
      throw new Error([fb?.message || "Failed to create ad (post_id mode)", fb?.error_user_msg].filter(Boolean).join(" — "))
    }
    console.log("[createAd] post_id mode OK:", rData.id)
    return { id: rData.id }
  }

  // ── Creative ID mode ──────────────────────────────────────────────────────────
  // Reuse an existing Meta creative by creative_id. No new creative is created.
  // No social proof is carried over; only the creative assets are reused.
  if (params.reuse_creative_id) {
    console.log("[createAd] creative_id mode — creative_id:", params.reuse_creative_id)
    const b = new URLSearchParams({
      name: params.name,
      adset_id: params.adset_id,
      creative: JSON.stringify({ creative_id: params.reuse_creative_id }),
      status: params.status || "PAUSED",
      access_token: accessToken,
    })
    const normId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
    const r = await secureMetaFetch(`${GRAPH_API_BASE}/${normId}/ads`, { method: "POST", body: b }, { skipProof: opts?.isManual })
    const rText = await r.text()
    let rData: any = {}
    try { rData = JSON.parse(rText) } catch {}
    if (!r.ok) {
      const fb = rData.error
      throw new Error([fb?.message || "Failed to create ad (creative_id mode)", fb?.error_user_msg].filter(Boolean).join(" — "))
    }
    console.log("[createAd] creative_id mode OK:", rData.id)
    return { id: rData.id }
  }

  const creativeSpec: any = {
    page_id: params.page_id,
    link_data: {
      link: params.link_url,
      message: params.body,
      name: params.title,
      description: params.description || "",
      call_to_action: { type: params.cta, value: { link: params.link_url } },
    },
  }
  if (params.instagram_actor_id) creativeSpec.instagram_actor_id = params.instagram_actor_id
  if (params.display_url) creativeSpec.link_data.display_url = params.display_url
  if (params.image_hash) creativeSpec.link_data.image_hash = params.image_hash
  if (params.sitelinks && params.sitelinks.length > 0) {
    creativeSpec.link_data.additional_data = {
      site_links: params.sitelinks.map(sl => ({ caption: sl.title, link: sl.url })),
    }
  }
  if (params.video_id) {
    // image_url is REQUIRED by Meta for video ads (subcode 1443226).
    // Block locally instead of wasting a Meta call on an absent or stale thumbnail.
    if (!isFreshThumbnailUrl(params.thumbnail_url)) {
      throw new Error(`Video ad blocked before Meta call: no fresh thumbnail resolved for video_id ${params.video_id}.`)
    }
    const videoData: any = {
      video_id: params.video_id,
      title: params.title,
      message: params.body,
      call_to_action: { type: params.cta, value: { link: params.link_url } },
      image_url: params.thumbnail_url,
    }
    // link_description is the correct field for description in video_data (not "description")
    if (params.description) videoData.link_description = params.description
    creativeSpec.video_data = videoData
    delete creativeSpec.link_data
  }

  // Carousel ads — replace link_data with multi_share + child_attachments
  if (params.carousel_cards && params.carousel_cards.length >= 2) {
    creativeSpec.link_data = {
      link: params.link_url,
      message: params.body,
      call_to_action: { type: params.cta, value: { link: params.link_url } },
      multi_share_optimized: true,
      multi_share_end_card: true,
      child_attachments: params.carousel_cards,
      ...(params.carousel_show_collection_tiles ? { format_option: "collection_video" } : {}),
      ...(params.carousel_show_single_media ? { format_option: "single_media" } : {}),
    }
    delete creativeSpec.video_data
  }

  const creativeJson: any = { object_story_spec: creativeSpec }
  // Sanitize MTO input: trim, drop empties, dedupe. Callers may include the base text as an
  // empty-string placeholder — Meta must never receive { text: "" } entries.
  const tvClean = params.text_variations
    ? {
        bodies: Array.from(new Set(params.text_variations.bodies.map(t => t.trim()).filter(Boolean))),
        titles: Array.from(new Set(params.text_variations.titles.map(t => t.trim()).filter(Boolean))),
        descriptions: Array.from(new Set(params.text_variations.descriptions.map(t => t.trim()).filter(Boolean))),
      }
    : null
  const tvHasMultiple = !!tvClean && (tvClean.bodies.length > 1 || tvClean.titles.length > 1 || tvClean.descriptions.length > 1)
  // MTO owns asset_feed_spec — formats that build their own spec/template take precedence.
  const tvConflict = !!(
    (params.multilanguage && params.multilanguage.translations.length > 0) ||
    params.catalog_ads || params.multi_placement || params.flexible_asset_feed ||
    (params.carousel_cards && params.carousel_cards.length >= 2)
  )
  const usesTextVariations = tvHasMultiple && !tvConflict
  if (tvHasMultiple && tvConflict) {
    console.warn("[createAd] text_variations ignored — a conflicting ad format (multilanguage/catalog/multi-placement/flexible/carousel) owns asset_feed_spec for this ad")
  }
  if (usesTextVariations) {
    // Explicitly OPT_OUT of all Advantage+ creative enhancements when using MTO.
    // standard_enhancements is deprecated; Meta now validates creative_features_spec keys against a fixed enum
    // (confirmed via API error #100): IG_VIDEO_NATIVE_SUBTITLE, IMAGE_ANIMATION, PRODUCT_BROWSING,
    // PRODUCT_METADATA_AUTOMATION, PROFILE_CARD, STANDARD_ENHANCEMENTS_CATALOG, TEXT_OVERLAY_TRANSLATION.
    // STANDARD_ENHANCEMENTS_CATALOG is the umbrella replacement for the old standard_enhancements field.
    const validFeatureKeys = [
      "IG_VIDEO_NATIVE_SUBTITLE", "IMAGE_ANIMATION", "PRODUCT_BROWSING",
      "PRODUCT_METADATA_AUTOMATION", "PROFILE_CARD", "STANDARD_ENHANCEMENTS_CATALOG",
      "TEXT_OVERLAY_TRANSLATION",
    ]
    const features: Record<string, any> = {}
    validFeatureKeys.forEach(key => {
      features[key] = { enroll_status: "OPT_OUT" }
    })
    creativeJson.degrees_of_freedom_spec = {
      creative_features_spec: features
    }
  } else if (params.degrees_of_freedom_spec) {
    creativeJson.degrees_of_freedom_spec = params.degrees_of_freedom_spec
  }
  // Multi Placement Ads — asset_feed_spec with placement-aware customization rules
  // Meta auto-picks best aspect for each placement; if customRules provided (manual mode),
  // it explicitly maps assets to placements
  if (params.multi_placement) {
    const mp = params.multi_placement
    const staleVideo = mp.videos.find(v => !isFreshThumbnailUrl(v.thumbnail_url))
    if (staleVideo) {
      throw new Error(`Multi-placement ad blocked before Meta call: no fresh thumbnail resolved for video_id ${staleVideo.video_id}.`)
    }
    const images = mp.imageHashes.map((h, i) => ({ hash: h, adlabels: [{ name: `img_${i}` }] }))
    const videos = mp.videos.map((v, i) => ({ video_id: v.video_id, thumbnail_url: v.thumbnail_url, adlabels: [{ name: `vid_${i}` }] }))

    const spec: any = {
      titles: [{ text: params.title }],
      bodies: [{ text: params.body }],
      link_urls: [{ website_url: params.link_url }],
      call_to_action_types: [params.cta],
      ad_formats: videos.length > 0 ? ["AUTOMATIC_FORMAT"] : ["SINGLE_IMAGE"],
    }
    if (images.length > 0) spec.images = images
    if (videos.length > 0) spec.videos = videos
    if (mp.customRules.length > 0) spec.asset_customization_rules = mp.customRules

    creativeJson.asset_feed_spec = spec
    delete creativeSpec.link_data
    delete creativeSpec.video_data
  }

  // Flexible Ads — build asset_feed_spec with grouped media variants
  // Each group of media becomes a "variant pool"; Meta picks combinations dynamically
  if (params.flexible_asset_feed) {
    const fa = params.flexible_asset_feed
    const staleVideo = fa.videos.find(v => !isFreshThumbnailUrl(v.thumbnail_url))
    if (staleVideo) {
      throw new Error(`Flexible ad blocked before Meta call: no fresh thumbnail resolved for video_id ${staleVideo.video_id}.`)
    }
    const images = fa.image_hashes.map(h => ({ hash: h }))
    const videos = fa.videos.map(v => ({ video_id: v.video_id, thumbnail_url: v.thumbnail_url }))

    creativeJson.asset_feed_spec = {
      titles: [{ text: params.title }],
      bodies: [{ text: params.body }],
      link_urls: [{ website_url: params.link_url }],
      call_to_action_types: [params.cta],
      ...(images.length > 0 && { images }),
      ...(videos.length > 0 && { videos }),
      ad_formats: videos.length > 0 ? ["AUTOMATIC_FORMAT"] : ["SINGLE_IMAGE"],
      // Group media variants: Meta uses these as alternatives within each group position
      groups: fa.group_asset_indices.map(g => ({
        image_indices: g.image_indices || [],
        video_indices: g.video_indices || [],
      })),
    }
    delete creativeSpec.link_data
    delete creativeSpec.video_data
  }

  // Text Variations (Multiple Text Options - MTO) via asset_feed_spec.
  // Format verified against a creative Ads Manager itself generated (creative 27968900572711731,
  // read via Graph API 2026-07-14): asset_feed_spec carries ONLY the text arrays plus
  // optimization_type "DEGREES_OF_FREEDOM"; media/link/CTA stay in object_story_spec, and the
  // base text fields are removed from link_data/video_data (text lives only in asset_feed_spec).
  // optimization_type is the discriminator — without it Meta defaults to REGULAR, treats the
  // creative as legacy Dynamic Creative, and rejects on standard ad sets with
  // "Dynamic creative ads can only be created under dynamic creative ad sets."
  if (usesTextVariations && tvClean) {
    // Empty arrays are OMITTED, not sent as [] — ground-truth creatives show e.g. bodies-only
    // MTO with no titles/descriptions fields at all.
    const spec: any = { optimization_type: "DEGREES_OF_FREEDOM" }
    if (tvClean.bodies.length > 0) spec.bodies = tvClean.bodies.map(t => ({ text: t }))
    if (tvClean.titles.length > 0) spec.titles = tvClean.titles.map(t => ({ text: t }))
    if (tvClean.descriptions.length > 0) spec.descriptions = tvClean.descriptions.map(t => ({ text: t }))
    creativeJson.asset_feed_spec = spec

    if (creativeSpec.link_data) {
      delete creativeSpec.link_data.message
      delete creativeSpec.link_data.name
      delete creativeSpec.link_data.description
    }
    if (creativeSpec.video_data) {
      delete creativeSpec.video_data.message
      delete creativeSpec.video_data.title
      delete creativeSpec.video_data.link_description
    }
  }

  // Partnership Ads: brand collaboration
  if (params.branded_content_sponsor_page_id) {
    creativeJson.branded_content_sponsor_page_id = params.branded_content_sponsor_page_id
    if (params.partnership_display_mode) {
      // Maps to Meta's collaborative_ads_partner field for header display
      creativeJson.partnership_display_mode = params.partnership_display_mode
    }
  }

  // Catalog Ads (DPA): rebuild creative around product set + template_data
  if (params.catalog_ads) {
    const ca = params.catalog_ads
    // Use template_data for catalog/dynamic ads — fields with {{product.*}} resolved by Meta
    const templateData: any = {
      message: params.body || "{{product.description}}",
      name: params.title || "{{product.name}}",
      description: "{{product.current_price}}",
      link: params.link_url || "{{product.url}}",
      call_to_action: { type: params.cta },
      format_option: ca.format === "carousel" ? "carousel_images" : "single_image",
    }
    creativeSpec.template_data = templateData
    creativeSpec.product_set_id = ca.productSetId || undefined
    delete creativeSpec.link_data
    delete creativeSpec.video_data

    // Frame image (overlay) — Meta expects image_url on template_data.image_layer_specs
    if (ca.frameImageUrl) {
      templateData.image_layer_specs = [{ image_source: "CATALOG", overlay_shape: "rectangle", image_url: ca.frameImageUrl }]
    }

    // Dynamic Media → creative_features_spec
    if (ca.dynamicMedia.optimizedMediaSelection) {
      creativeJson.creative_features_spec = {
        ...(creativeJson.creative_features_spec || {}),
        product_extensions: { enroll_status: "OPT_IN" },
      }
      if (ca.dynamicMedia.automaticVideoCropping) {
        creativeJson.creative_features_spec.video_auto_crop = { enroll_status: "OPT_IN" }
      }
      if (ca.dynamicMedia.prioritizeVideo) {
        creativeJson.creative_features_spec.video_priority = { enroll_status: "OPT_IN" }
      }
    }
  }

  // Collection Ads (Instant Experience / Instant Storefront):
  // Attach product_set_id to the creative spec while keeping link_data intact.
  // Meta auto-generates the Instant Experience canvas based on the product set + cover media.
  if (params.collection_ads) {
    const ca = params.collection_ads
    creativeSpec.product_set_id = ca.productSetId
    // Override description with IE headline if provided (shown inside the Instant Experience)
    if (ca.ieHeadline && creativeSpec.link_data) {
      creativeSpec.link_data.description = ca.ieHeadline
    }
    // Override the destination URL for the "See more" button inside the IE
    if (ca.destinationUrl && creativeSpec.link_data) {
      creativeSpec.link_data.link = ca.destinationUrl
      if (creativeSpec.link_data.call_to_action?.value) {
        creativeSpec.link_data.call_to_action.value.link = ca.destinationUrl
      }
    }
  }

  // Multilanguage Ads: per-locale text variations via asset_feed_spec
  if (params.multilanguage && params.multilanguage.translations.length > 0) {
    const titles: any[] = [{ text: params.title }]
    const bodies: any[] = [{ text: params.body }]
    const descriptions: any[] = params.description ? [{ text: params.description }] : []
    const customizationRules: any[] = []

    for (const t of params.multilanguage.translations) {
      titles.push({ text: t.headline || params.title, adlabels: [{ name: `headline_${t.language}` }] })
      bodies.push({ text: t.primaryText || params.body, adlabels: [{ name: `body_${t.language}` }] })
      if (t.description || params.description) {
        descriptions.push({ text: t.description || params.description, adlabels: [{ name: `desc_${t.language}` }] })
      }

      const rule: any = {
        customization_spec: { locales: [t.language] },
        title_label: { name: `headline_${t.language}` },
        body_label: { name: `body_${t.language}` },
      }
      if (t.description || params.description) {
        rule.description_label = { name: `desc_${t.language}` }
      }
      customizationRules.push(rule)
    }

    const assetFeedSpec: any = {
      titles,
      bodies,
      ad_formats: ["SINGLE_IMAGE"],
      call_to_action_types: [params.cta],
      link_urls: [{ website_url: params.link_url, display_url: params.display_url }],
      asset_customization_rules: customizationRules,
    }
    if (descriptions.length > 0) assetFeedSpec.descriptions = descriptions
    if (params.image_hash) assetFeedSpec.images = [{ hash: params.image_hash }]
    if (params.video_id) {
      assetFeedSpec.videos = [{ video_id: params.video_id, thumbnail_url: params.thumbnail_url }]
      assetFeedSpec.ad_formats = ["AUTOMATIC_FORMAT"]
    }

    creativeJson.asset_feed_spec = assetFeedSpec
  }

  const body = new URLSearchParams({
    name: params.name,
    adset_id: params.adset_id,
    creative: JSON.stringify(creativeJson),
    status: params.status || "PAUSED",
    access_token: accessToken,
  })
  const normId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  console.log(`[createAd] POST /${normId}/ads with creative spec:`, JSON.stringify(creativeJson, null, 2))
  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${normId}/ads`, { method: "POST", body }, { skipProof: opts?.isManual })
  const respText = await res.text()
  let respData: any = {}
  try { respData = JSON.parse(respText) } catch {}
  if (!res.ok) {
    const fb = respData.error
    const detail = fb?.error_user_msg || fb?.error_user_title || ""
    let msg = [fb?.message || "Failed to create ad", detail].filter(Boolean).join(" — ")
    // Legacy Dynamic Creative ad sets (is_dynamic_creative=true, 1-ad cap) reject standard/MTO ads
    // with a cryptic mismatch error — translate it into an actionable message.
    if (/dynamic creative/i.test(`${fb?.message || ""} ${detail}`)) {
      msg += " — Target ad set is a legacy Dynamic Creative ad set (capped at 1 ad). Launch into a new standard ad set instead."
    }
    console.error(`[createAd] FAILED (Status ${res.status}):`, JSON.stringify(respData, null, 2))
    throw new Error(msg)
  }
  console.log("[createAd] OK:", respData.id)

  // Immediately fetch the new ad's creative + status to surface server-side issues
  // (e.g. dark post creation failed → object_story_id missing → "Story Unavailable" preview)
  if (respData.id) {
    try {
      const verifyFields = "id,status,effective_status,issues_info,recommendations,creative{id,object_story_id,object_type,thumbnail_url,effective_object_story_id,status}"
      const vRes = await secureMetaFetch(`${GRAPH_API_BASE}/${respData.id}?fields=${verifyFields}&access_token=${accessToken}`, undefined, { skipProof: opts?.isManual })
      const vData = await vRes.json()
      console.log(`[createAd] verify ${respData.id}:`, JSON.stringify(vData, null, 2))
      if (vData.issues_info && vData.issues_info.length > 0) {
        console.warn(`[createAd] Meta reported issues for ad ${respData.id}:`, vData.issues_info)
      }
      if (vData.creative && !vData.creative.object_story_id && !vData.creative.effective_object_story_id) {
        const stillProcessing = vData.effective_status === "IN_PROCESS" || vData.creative.status === "IN_PROCESS"
        if (stillProcessing) {
          console.log(`[createAd] Ad ${respData.id} object_story_id pending — Meta IN_PROCESS, will populate in 1-3 min (normal).`)
        } else {
          console.warn(`[createAd] Ad ${respData.id} NO object_story_id and not IN_PROCESS — dark post failed → "Story Unavailable".`)
        }
      }
    } catch (e) {
      console.warn("[createAd] verify failed:", e)
    }
  }

  return respData
}

// ─── Existing Ads with Insights (for Existing Ads tab in Load Media) ───────

export interface ExistingAdItem {
  id: string
  name: string
  status: string
  effective_status: string
  date_created: string
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  page_name?: string
  page_id?: string
  post_id?: string
  post_url?: string
  object_story_id?: string
  effective_object_story_id?: string
  thumb_url?: string
  image_hash?: string
  video_id?: string
  media_type: "image" | "video" | "unknown"
  spend: number
  impressions: number
  reach: number
  results: number
  roas: number
  platform: string
  // Ad copy fields
  primaryText?: string
  headline?: string
  description?: string
  link?: string
  cta?: string
  // Set by getAdDetail only — lets callers confirm the ad really belongs to the
  // ad account the client claimed, instead of trusting the query param.
  account_id?: string
}

// One ad, normalized the same way getExistingAds normalizes a list. Used by the
// P0 template loop: "Save as Template" and "Duplicate to Launcher" both need the
// copy + media + a metrics snapshot for a single ad picked in Ads Manager.
export async function getAdDetail(
  adId: string,
  accessToken: string,
  opts: { datePreset?: string } = {}
): Promise<ExistingAdItem> {
  const datePreset = opts.datePreset || "last_30d"
  const fields = [
    "id",
    "name",
    "status",
    "effective_status",
    "created_time",
    "account_id",
    "campaign{id,name}",
    "adset{id,name}",
    "creative{id,title,body,thumbnail_url,image_hash,video_id,object_story_id,effective_object_story_id,object_story_spec{page_id,link_data,video_data}}",
    `insights.date_preset(${datePreset}){spend,impressions,reach,actions,purchase_roas}`,
  ].join(",")

  const params = graphTokenParams(accessToken)
  params.set("fields", fields)

  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${adId}?${params}`)
  const ad = await res.json()
  if (!res.ok || ad?.error) throwMetaError(ad, "Failed to fetch ad")

  const insights = ad.insights?.data?.[0] || {}
  const oss = ad.creative?.object_story_spec || {}
  const linkData = oss.link_data
  const videoData = oss.video_data
  const postId = ad.creative?.object_story_id || ad.creative?.effective_object_story_id
  const pageId = oss.page_id || (typeof postId === "string" && postId.includes("_") ? postId.split("_")[0] : undefined)

  const imageHash = ad.creative?.image_hash || linkData?.image_hash
  const videoId = ad.creative?.video_id || videoData?.video_id

  const actions = (insights.actions || []) as Array<{ action_type: string; value: string }>
  const purchases = actions.find(a => a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase")
  const leads = actions.find(a => a.action_type === "lead" || a.action_type === "offsite_conversion.fb_pixel_lead")
  const linkClicks = actions.find(a => a.action_type === "link_click")
  const roasArr = insights.purchase_roas || []

  return {
    id: ad.id,
    name: ad.name,
    status: ad.status,
    effective_status: ad.effective_status,
    date_created: ad.created_time,
    account_id: ad.account_id,
    campaign_id: ad.campaign?.id,
    campaign_name: ad.campaign?.name,
    adset_id: ad.adset?.id,
    adset_name: ad.adset?.name,
    page_id: pageId,
    post_id: postId,
    post_url: postId ? `https://www.facebook.com/${postId.split("_").join("/posts/")}` : undefined,
    object_story_id: ad.creative?.object_story_id,
    effective_object_story_id: ad.creative?.effective_object_story_id,
    thumb_url: ad.creative?.thumbnail_url,
    image_hash: imageHash,
    video_id: videoId,
    media_type: videoId ? "video" : imageHash ? "image" : "unknown",
    spend: parseFloat(insights.spend || "0"),
    impressions: parseInt(insights.impressions || "0", 10),
    reach: parseInt(insights.reach || "0", 10),
    results: parseFloat(purchases?.value || leads?.value || linkClicks?.value || "0"),
    roas: roasArr.length > 0 ? parseFloat(roasArr[0].value || "0") : 0,
    platform: "Web",
    // creative.body/title are the flat mirrors Meta keeps for non-story creatives;
    // object_story_spec wins when present because that is what the ad actually renders.
    primaryText: linkData?.message || videoData?.message || ad.creative?.body || undefined,
    headline: linkData?.name || videoData?.title || ad.creative?.title || undefined,
    description: linkData?.description || undefined,
    link: linkData?.link || videoData?.call_to_action?.value?.link || undefined,
    cta: linkData?.call_to_action?.type || videoData?.call_to_action?.type || undefined,
  }
}

export interface DarkPostAdItem {
  id: string
  name: string
  status: string
  effective_status: string
  date_created: string
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  page_name?: string
  page_id?: string
  post_id?: string
  post_url?: string
  object_story_id?: string
  effective_object_story_id?: string
  thumb_url?: string
  image_url?: string
  image_hash?: string
  video_id?: string
  media_type: "image" | "video" | "unknown"
  primaryText?: string
  headline?: string
  description?: string
  link?: string
}

export async function getDarkPostAds(
  adAccountId: string,
  accessToken: string,
  opts: { limit?: number; after?: string }
): Promise<{ ads: DarkPostAdItem[]; paging?: { after?: string; before?: string } }> {
  const accId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const limit = Math.min(opts.limit || 100, 100)

  const fields = [
    "id",
    "name",
    "status",
    "effective_status",
    "created_time",
    "campaign{id,name}",
    "adset{id,name}",
    "creative{id,thumbnail_url,image_hash,video_id,object_story_id,effective_object_story_id,object_story_spec{page_id,link_data{message,name,description,link,image_hash,picture},video_data{message,title,video_id,image_url,call_to_action},instagram_actor_id}}",
  ].join(",")

  const params = new URLSearchParams({
    fields,
    limit: String(limit),
    access_token: accessToken,
  })
  if (opts.after) params.set("after", opts.after)

  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${accId}/ads?${params}`)
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throwMetaError(e, "Failed to fetch dark post ads")
  }
  const data = await res.json()

  const pageIds = new Set<string>()
  for (const ad of (data.data || [])) {
    const storyId = ad.creative?.object_story_id || ad.creative?.effective_object_story_id
    const pid = ad.creative?.object_story_spec?.page_id || (typeof storyId === "string" && storyId.includes("_") ? storyId.split("_")[0] : undefined)
    if (pid) pageIds.add(pid)
  }

  const pageNameMap = new Map<string, string>()
  if (pageIds.size > 0) {
    try {
      const idsParam = Array.from(pageIds).join(",")
      const pageRes = await secureMetaFetch(`${GRAPH_API_BASE}/?ids=${idsParam}&fields=id,name&access_token=${accessToken}`)
      if (pageRes.ok) {
        const pageData = await pageRes.json()
        for (const pid of pageIds) {
          if (pageData[pid]?.name) pageNameMap.set(pid, pageData[pid].name)
        }
      }
    } catch {}
  }

  const imageHashes = new Set<string>()
  for (const ad of (data.data || [])) {
    const linkData = ad.creative?.object_story_spec?.link_data
    const imageHash = ad.creative?.image_hash || linkData?.image_hash
    if (imageHash) imageHashes.add(imageHash)
  }

  const imageUrlMap = new Map<string, string>()
  if (imageHashes.size > 0) {
    try {
      const hashesParam = JSON.stringify(Array.from(imageHashes))
      const imageRes = await secureMetaFetch(
        `${GRAPH_API_BASE}/${accId}/adimages?hashes=${encodeURIComponent(hashesParam)}&fields=hash,url,url_128&access_token=${accessToken}`
      )
      if (imageRes.ok) {
        const imageData = await imageRes.json()
        const images = Array.isArray(imageData.data)
          ? imageData.data
          : Object.values(imageData.images || {})
        for (const image of images as any[]) {
          if (image?.hash && (image.url || image.url_128)) {
            imageUrlMap.set(image.hash, image.url || image.url_128)
          }
        }
      }
    } catch {}
  }

  const ads: DarkPostAdItem[] = (data.data || []).map((ad: any) => {
    const oss = ad.creative?.object_story_spec || {}
    const objectStoryId = ad.creative?.object_story_id
    const effectiveObjectStoryId = ad.creative?.effective_object_story_id
    const postId = objectStoryId || effectiveObjectStoryId
    const pageId = oss.page_id || (typeof postId === "string" && postId.includes("_") ? postId.split("_")[0] : undefined)
    const linkData = oss.link_data
    const videoData = oss.video_data
    const imageHash = ad.creative?.image_hash || linkData?.image_hash
    const videoId = ad.creative?.video_id || videoData?.video_id
    const imageUrl = imageHash ? imageUrlMap.get(imageHash) : undefined

    return {
      id: ad.id,
      name: ad.name,
      status: ad.status,
      effective_status: ad.effective_status,
      date_created: ad.created_time,
      campaign_id: ad.campaign?.id,
      campaign_name: ad.campaign?.name,
      adset_id: ad.adset?.id,
      adset_name: ad.adset?.name,
      page_name: pageId ? pageNameMap.get(pageId) : undefined,
      page_id: pageId,
      post_id: postId,
      post_url: postId ? `https://www.facebook.com/${postId.split("_").join("/posts/")}` : undefined,
      object_story_id: objectStoryId,
      effective_object_story_id: effectiveObjectStoryId,
      thumb_url: ad.creative?.thumbnail_url,
      image_url: imageUrl || linkData?.picture || videoData?.image_url || undefined,
      image_hash: imageHash,
      video_id: videoId,
      media_type: videoId ? "video" : imageHash ? "image" : "unknown",
      primaryText: linkData?.message || videoData?.message || undefined,
      headline: linkData?.name || videoData?.title || undefined,
      description: linkData?.description || undefined,
      link: linkData?.link || videoData?.call_to_action?.value?.link || undefined,
    }
  })

  return { ads, paging: data.paging?.cursors }
}

export async function getExistingAds(
  adAccountId: string,
  accessToken: string,
  opts: { datePreset?: string; limit?: number; after?: string; activeOnly?: boolean; activeAdSetOnly?: boolean }
): Promise<{ ads: ExistingAdItem[]; paging?: { after?: string; before?: string }; totalCount?: number }> {
  const accId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const datePreset = opts.datePreset || "last_30d"
  const limit = opts.limit || 50

  const fields = [
    "id",
    "name",
    "status",
    "effective_status",
    "created_time",
    "campaign{id,name}",
    "adset{id,name}",
    "creative{id,thumbnail_url,image_hash,video_id,object_story_id,effective_object_story_id,object_story_spec{page_id,link_data,video_data,instagram_actor_id}}",
    `insights.date_preset(${datePreset}){spend,impressions,reach,actions,purchase_roas}`,
  ].join(",")

  const filtering: any[] = []
  if (opts.activeOnly) {
    filtering.push({ field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] })
  }
  if (opts.activeAdSetOnly) {
    filtering.push({ field: "adset.effective_status", operator: "IN", value: ["ACTIVE"] })
  }

  const params = new URLSearchParams({
    fields,
    limit: String(limit),
    access_token: accessToken,
  })
  if (filtering.length > 0) params.set("filtering", JSON.stringify(filtering))
  if (opts.after) params.set("after", opts.after)

  const url = `${GRAPH_API_BASE}/${accId}/ads?${params}`
  const res = await fetch(url)
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error?.message || "Failed to fetch existing ads")
  }
  const data = await res.json()

  // Collect unique page IDs to fetch page names in batch
  const pageIds = new Set<string>()
  for (const ad of (data.data || [])) {
    const storyId = ad.creative?.object_story_id || ad.creative?.effective_object_story_id
    const pid = ad.creative?.object_story_spec?.page_id || (typeof storyId === "string" && storyId.includes("_") ? storyId.split("_")[0] : undefined)
    if (pid) pageIds.add(pid)
  }

  const pageNameMap = new Map<string, string>()
  if (pageIds.size > 0) {
    try {
      const idsParam = Array.from(pageIds).join(",")
      const pageRes = await secureMetaFetch(`${GRAPH_API_BASE}/?ids=${idsParam}&fields=id,name&access_token=${accessToken}`)
      if (pageRes.ok) {
        const pageData = await pageRes.json()
        for (const pid of pageIds) {
          if (pageData[pid]?.name) pageNameMap.set(pid, pageData[pid].name)
        }
      }
    } catch {}
  }

  const ads: ExistingAdItem[] = (data.data || []).map((ad: any) => {
    const insights = ad.insights?.data?.[0] || {}
    const oss = ad.creative?.object_story_spec || {}
    const objectStoryId = ad.creative?.object_story_id
    const effectiveObjectStoryId = ad.creative?.effective_object_story_id
    const postId = objectStoryId || effectiveObjectStoryId
    const pageId = oss.page_id || (typeof postId === "string" && postId.includes("_") ? postId.split("_")[0] : undefined)
    const linkData = oss.link_data
    const videoData = oss.video_data

    // Extract creative
    const imageHash = ad.creative?.image_hash || linkData?.image_hash
    const videoId = ad.creative?.video_id || videoData?.video_id
    const thumb = ad.creative?.thumbnail_url

    // Results = sum of conversion-like actions
    const actions = (insights.actions || []) as Array<{ action_type: string; value: string }>
    const purchases = actions.find(a => a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase")
    const leads = actions.find(a => a.action_type === "lead" || a.action_type === "offsite_conversion.fb_pixel_lead")
    const link_clicks = actions.find(a => a.action_type === "link_click")
    const results = parseFloat(purchases?.value || leads?.value || link_clicks?.value || "0")

    // ROAS
    const roasArr = insights.purchase_roas || []
    const roas = roasArr.length > 0 ? parseFloat(roasArr[0].value || "0") : 0

    const ctaRaw = linkData?.call_to_action?.type || videoData?.call_to_action?.type
    return {
      id: ad.id,
      name: ad.name,
      status: ad.status,
      effective_status: ad.effective_status,
      date_created: ad.created_time,
      campaign_id: ad.campaign?.id,
      campaign_name: ad.campaign?.name,
      adset_id: ad.adset?.id,
      adset_name: ad.adset?.name,
      page_name: pageId ? pageNameMap.get(pageId) : undefined,
      page_id: pageId,
      post_id: postId,
      post_url: postId ? `https://www.facebook.com/${postId.split("_").join("/posts/")}` : undefined,
      object_story_id: objectStoryId,
      effective_object_story_id: effectiveObjectStoryId,
      thumb_url: thumb,
      image_hash: imageHash,
      video_id: videoId,
      media_type: videoId ? "video" : imageHash ? "image" : "unknown",
      spend: parseFloat(insights.spend || "0"),
      impressions: parseInt(insights.impressions || "0", 10),
      reach: parseInt(insights.reach || "0", 10),
      results,
      roas,
      platform: "Web",
      primaryText: linkData?.message || videoData?.message || undefined,
      headline: linkData?.name || videoData?.title || undefined,
      description: linkData?.description || undefined,
      link: linkData?.link || videoData?.call_to_action?.value?.link || undefined,
      cta: ctaRaw || undefined,
    }
  })

  return {
    ads,
    paging: data.paging?.cursors,
    totalCount: data.summary?.total_count,
  }
}

// ─── Product Catalogs (for Collection Ads) ──────────────────────────────────

export interface ProductCatalog { id: string; name: string; product_count?: number; vertical?: string }
export interface ProductSet { id: string; name: string; product_count?: number; filter?: any }
export interface CatalogProduct { id: string; name?: string; image_url?: string; price?: string; brand?: string }

// Fetch catalogs — tries multiple endpoints in parallel (via businesses + ad account business).
export async function getProductCatalogs(accessToken: string, adAccountId?: string): Promise<{ catalogs: ProductCatalog[]; debug: string[] }> {
  const seen = new Set<string>()
  const catalogs: ProductCatalog[] = []
  const debug: string[] = []

  const bizUrl = `${GRAPH_API_BASE}/me/businesses?fields=id,name,owned_product_catalogs.limit(100){id,name,product_count,vertical},client_product_catalogs.limit(100){id,name,product_count,vertical}&limit=50&access_token=${accessToken}`
  const accId = adAccountId ? (adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`) : null
  const accUrl = accId
    ? `${GRAPH_API_BASE}/${accId}?fields=business{id,name,owned_product_catalogs.limit(100){id,name,product_count,vertical}}&access_token=${accessToken}`
    : null

  const [bizRes, accRes] = await Promise.all([
    fetch(bizUrl).catch((e: any) => { debug.push(`/me/businesses network error: ${e.message}`); return null }),
    accUrl ? fetch(accUrl).catch((e: any) => { debug.push(`ad account network error: ${e.message}`); return null }) : Promise.resolve(null),
  ])

  if (bizRes?.ok) {
    try {
      const biz = await bizRes.json()
      let bizCount = 0, catCount = 0
      for (const b of (biz.data || [])) {
        bizCount++
        for (const c of (b.owned_product_catalogs?.data || [])) {
          if (!seen.has(c.id)) { seen.add(c.id); catalogs.push(c); catCount++ }
        }
        for (const c of (b.client_product_catalogs?.data || [])) {
          if (!seen.has(c.id)) { seen.add(c.id); catalogs.push(c); catCount++ }
        }
      }
      debug.push(`/me/businesses: ${bizCount} businesses, ${catCount} catalogs`)
    } catch (e: any) { debug.push(`/me/businesses parse error: ${e.message}`) }
  } else if (bizRes) {
    const e = await bizRes.json().catch(() => ({}))
    debug.push(`/me/businesses failed: ${e.error?.message || bizRes.status}`)
  }

  if (accRes?.ok) {
    try {
      const acc = await accRes.json()
      let added = 0
      for (const c of (acc.business?.owned_product_catalogs?.data || [])) {
        if (!seen.has(c.id)) { seen.add(c.id); catalogs.push(c); added++ }
      }
      debug.push(`ad account business catalogs: ${added}`)
    } catch (e: any) { debug.push(`ad account parse error: ${e.message}`) }
  } else if (accRes) {
    const e = await accRes.json().catch(() => ({}))
    debug.push(`ad account fetch failed: ${e.error?.message || accRes.status}`)
  }

  return { catalogs, debug }
}

export async function getProductSets(catalogId: string, accessToken: string): Promise<ProductSet[]> {
  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${catalogId}/product_sets?fields=id,name,product_count&limit=100&access_token=${accessToken}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || "Failed to fetch product sets")
  }
  const data = await res.json()
  return data.data || []
}

export async function getCatalogProducts(catalogId: string, accessToken: string, limit = 4): Promise<CatalogProduct[]> {
  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${catalogId}/products?fields=id,name,image_url,price,brand&limit=${limit}&access_token=${accessToken}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.data || []
}

// Set a single ad's status (ACTIVE | PAUSED)
export async function setAdStatus(adId: string, accessToken: string, status: "ACTIVE" | "PAUSED", opts?: { isManual?: boolean }): Promise<void> {
  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${adId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, access_token: accessToken }),
  }, { skipProof: opts?.isManual })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error?.message || `Failed to set ad ${adId} to ${status}`)
  }
}

export async function replaceAdCreative(
  adAccountId: string,
  adId: string,
  accessToken: string,
  params: {
    name: string
    status?: string
    page_id: string
    image_hash?: string
    video_id?: string
    thumbnail_url?: string
    body: string
    title: string
    description?: string
    cta: string
    link_url: string
    text_variations?: {
      bodies: string[]
      titles: string[]
      descriptions: string[]
    }
  },
  opts?: { isManual?: boolean }
): Promise<{ creativeId: string }> {
  const storySpec: Record<string, any> = {
    page_id: params.page_id,
    link_data: {
      link: params.link_url,
      message: params.body,
      name: params.title,
      description: params.description || "",
      call_to_action: { type: params.cta, value: { link: params.link_url } },
      ...(params.image_hash ? { image_hash: params.image_hash } : {}),
    },
  }
  if (params.video_id) {
    storySpec.video_data = {
      video_id: params.video_id,
      title: params.title,
      message: params.body,
      link_description: params.description || "",
      call_to_action: { type: params.cta, value: { link: params.link_url } },
      ...(params.thumbnail_url ? { image_url: params.thumbnail_url } : {}),
    }
    delete storySpec.link_data
  }

  const creative: Record<string, any> = { object_story_spec: storySpec }
  const variations = params.text_variations
  const bodies = Array.from(new Set([params.body, ...(variations?.bodies || [])].map(value => value.trim()).filter(Boolean))).slice(0, 5)
  const titles = Array.from(new Set([params.title, ...(variations?.titles || [])].map(value => value.trim()).filter(Boolean))).slice(0, 5)
  const descriptions = Array.from(new Set([params.description || "", ...(variations?.descriptions || [])].map(value => value.trim()).filter(Boolean))).slice(0, 5)
  if (bodies.length > 1 || titles.length > 1 || descriptions.length > 1) {
    creative.asset_feed_spec = {
      bodies: bodies.map(text => ({ text })),
      titles: titles.map(text => ({ text })),
      descriptions: descriptions.map(text => ({ text })),
      call_to_action_types: [params.cta],
      link_urls: [{ website_url: params.link_url }],
      ad_formats: [params.video_id ? "SINGLE_VIDEO" : "SINGLE_IMAGE"],
      ...(params.video_id
        ? { videos: [{ video_id: params.video_id, ...(params.thumbnail_url ? { thumbnail_url: params.thumbnail_url } : {}) }] }
        : { images: [{ hash: params.image_hash }] }),
    }
    creative.degrees_of_freedom_spec = {
      creative_features_spec: {
        STANDARD_ENHANCEMENTS_CATALOG: { enroll_status: "OPT_OUT" },
      },
    }
    delete storySpec.link_data
    delete storySpec.video_data
  }

  const normalizedAccountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const createBody = new URLSearchParams({
    name: `${params.name} creative`,
    creative: JSON.stringify(creative),
    access_token: accessToken,
  })
  const createResponse = await secureMetaFetch(
    `${GRAPH_API_BASE}/${normalizedAccountId}/adcreatives`,
    { method: "POST", body: createBody },
    { skipProof: opts?.isManual }
  )
  const createData = await createResponse.json()
  if (!createResponse.ok || createData?.error) {
    const detail = createData?.error?.error_user_msg || createData?.error?.error_user_title || ""
    throw new Error([createData?.error?.message || "Failed to create replacement creative", detail].filter(Boolean).join(" — "))
  }

  const creativeId = String(createData.id || "")
  const reassignBody = new URLSearchParams({
    creative: JSON.stringify({ creative_id: creativeId }),
    name: params.name,
    ...(params.status ? { status: params.status } : {}),
    access_token: accessToken,
  })
  const reassignResponse = await secureMetaFetch(
    `${GRAPH_API_BASE}/${adId}`,
    { method: "POST", body: reassignBody },
    { skipProof: opts?.isManual }
  )
  const reassignData = await reassignResponse.json()
  if (!reassignResponse.ok || reassignData?.error) {
    const detail = reassignData?.error?.error_user_msg || reassignData?.error?.error_user_title || ""
    const reason = [reassignData?.error?.message || "Failed to assign replacement creative", detail].filter(Boolean).join(" — ")
    throw new Error(`${reason}. New creative ${creativeId} was kept for retry.`)
  }
  return { creativeId }
}

// Campaign insights
export async function getCampaignInsights(
  campaignId: string,
  accessToken: string
): Promise<CampaignInsight[]> {
  const fields = "impressions,clicks,spend,cpc,cpm,ctr,reach"
  const res = await fetch(
    `${GRAPH_API_BASE}/${campaignId}/insights?fields=${fields}&date_preset=last_30d&access_token=${accessToken}`
  )
  if (!res.ok) {
    const error = await res.json()
    throw new Error(error.error?.message || "Failed to get campaign insights")
  }
  const data = await res.json()
  return data.data || []
}

/**
 * Read an ad set's *complete* targeting spec straight from Meta.
 *
 * Unlike the editor's detail read this requests `targeting` whole, with no sub-selection, so
 * the result carries the keys the editor never renders. Callers merge onto this before writing
 * — see `lib/targeting-merge.ts` and TD-37.
 */
export async function getNodeTargeting(
  nodeId: string,
  accessToken: string,
  opts?: { isManual?: boolean }
): Promise<unknown> {
  const res = await secureMetaFetch(
    `${GRAPH_API_BASE}/${nodeId}?fields=targeting&access_token=${encodeURIComponent(accessToken)}`,
    undefined,
    { skipProof: opts?.isManual }
  )
  if (!res.ok) {
    const error = await res.json().catch(() => null)
    throw new Error(error?.error?.message || "Failed to read current targeting")
  }
  const data = await res.json()
  return data?.targeting
}

/**
 * Read a campaign's objective, for validating an ad set edit against the ODAX table (TD-42).
 *
 * Never throws: the objective is used to *refuse* a change, so a failed read must leave the edit
 * exactly as permissive as it is today rather than blocking it.
 */
export async function getCampaignObjective(
  campaignId: string,
  accessToken: string,
  opts?: { isManual?: boolean }
): Promise<string | undefined> {
  try {
    const res = await secureMetaFetch(
      `${GRAPH_API_BASE}/${campaignId}?fields=objective&access_token=${encodeURIComponent(accessToken)}`,
      undefined,
      { skipProof: opts?.isManual }
    )
    if (!res.ok) return undefined
    const data = await res.json()
    return typeof data?.objective === "string" ? data.objective : undefined
  } catch {
    return undefined
  }
}

// Update a node (Campaign, AdSet, or Ad)
export async function updateNode(
  nodeId: string,
  accessToken: string,
  params: {
    name?: string
    status?: string
    daily_budget?: number
    lifetime_budget?: number
    start_time?: string
    end_time?: string
    // Ad set extended fields
    optimization_goal?: string
    bid_strategy?: string
    bid_amount?: number
    /** Ad-set only. ROAS floor for LOWEST_COST_WITH_MIN_ROAS, already scaled ×10000. */
    bid_constraints?: { roas_average_floor?: number }
    attribution_spec?: unknown
    promoted_object?: unknown
    targeting?: unknown
    publisher_platforms?: string[]
    device_platforms?: string[]
    facebook_positions?: string[]
    instagram_positions?: string[]
    audience_network_positions?: string[]
    messenger_positions?: string[]
    advertiser?: { type: "page" | "business"; id: string } | null
    payer?: { type: "page" | "business"; id: string } | null
  },
  opts?: { isManual?: boolean }
): Promise<{ success: boolean }> {
  const body = new URLSearchParams({ access_token: accessToken })
  if (params.name) body.set("name", params.name)
  if (params.status) body.set("status", params.status)
  if (params.daily_budget !== undefined) body.set("daily_budget", String(Math.round(params.daily_budget * 100)))
  if (params.lifetime_budget !== undefined) body.set("lifetime_budget", String(Math.round(params.lifetime_budget * 100)))
  if (params.start_time) body.set("start_time", params.start_time)
  if (params.end_time) body.set("end_time", params.end_time)
  if (params.optimization_goal) body.set("optimization_goal", params.optimization_goal)
  if (params.bid_strategy) body.set("bid_strategy", params.bid_strategy)
  if (params.bid_amount !== undefined) body.set("bid_amount", String(Math.round(params.bid_amount * 100)))
  if (params.bid_constraints !== undefined) body.set("bid_constraints", JSON.stringify(params.bid_constraints))
  if (params.attribution_spec !== undefined) body.set("attribution_spec", JSON.stringify(params.attribution_spec))
  if (params.promoted_object !== undefined) body.set("promoted_object", JSON.stringify(params.promoted_object))
  if (params.targeting !== undefined) body.set("targeting", JSON.stringify(params.targeting))
  if (params.publisher_platforms) body.set("publisher_platforms", JSON.stringify(params.publisher_platforms))
  if (params.device_platforms) body.set("device_platforms", JSON.stringify(params.device_platforms))
  if (params.facebook_positions) body.set("facebook_positions", JSON.stringify(params.facebook_positions))
  if (params.instagram_positions) body.set("instagram_positions", JSON.stringify(params.instagram_positions))
  if (params.audience_network_positions) body.set("audience_network_positions", JSON.stringify(params.audience_network_positions))
  if (params.messenger_positions) body.set("messenger_positions", JSON.stringify(params.messenger_positions))
  if (params.advertiser) body.set("advertiser", JSON.stringify(params.advertiser))
  if (params.payer) body.set("payer", JSON.stringify(params.payer))

  const res = await secureMetaFetch(
    `${GRAPH_API_BASE}/${nodeId}`,
    { method: "POST", body },
    { skipProof: opts?.isManual }
  )
  if (!res.ok) {
    const error = await res.json()
    const fb = error.error
    const detail = fb?.error_user_msg || fb?.error_user_title || ""
    throw new Error([fb?.message || "Failed to update node", detail].filter(Boolean).join(" — "))
  }
  return { success: true }
}

// Duplicate a node (Campaign, AdSet, or Ad)
export async function duplicateNode(
  nodeId: string,
  accessToken: string,
  params: {
    name?: string
    deep_copy?: boolean
    status_option?: "ACTIVE" | "PAUSED" | "INHERITED"
    /** Ad-level only: copy into a different ad set (Existing/New destination). Meta rejects this param on Campaign/AdSet nodes. */
    adset_id?: string
  },
  opts?: { isManual?: boolean }
): Promise<{ id: string }> {
  const body = new URLSearchParams({ access_token: accessToken })
  if (params.name) body.set("rename_strategy", JSON.stringify({ strategy: "NEW_NAME", new_name: params.name }))
  if (params.deep_copy !== undefined) body.set("deep_copy", String(params.deep_copy))
  if (params.status_option) body.set("status_option", params.status_option)
  if (params.adset_id) body.set("adset_id", params.adset_id)

  const res = await secureMetaFetch(`${GRAPH_API_BASE}/${nodeId}/copies`, { method: "POST", body }, { skipProof: opts?.isManual })
  if (!res.ok) {
    const error = await res.json()
    const fb = error.error
    const detail = fb?.error_user_msg || fb?.error_user_title || ""
    throw new Error([fb?.message || "Failed to duplicate node", detail].filter(Boolean).join(" — "))
  }
  const data = await res.json()
  return { id: data.copied_node_id || data.copied_campaign_id || data.copied_adset_id || data.copied_ad_id || data.id }
}
