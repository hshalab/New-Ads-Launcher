"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { IconCheck, IconLoader2 } from "@tabler/icons-react"
import { useAdAccount } from "@/lib/ad-account-context"
import { cn } from "@/lib/utils"

type AccountOwnership = "own" | "agency" | "unknown"

interface OverviewAccount {
  id: string
  account_id: string
  name: string
  account_status: number
  currency: string
  amount_spent?: string
  balance?: string
  spend_cap?: string
  timezone_name?: string
  business?: { id: string; name?: string }
  owner_business?: { id: string; name?: string }
  ownership?: AccountOwnership
}

interface AccountSummary {
  spend?: string
  actions?: { action_type: string; value: string }[]
}

interface CampaignRow {
  id: string
  name: string
  effective_status: string
  insights?: { data?: AccountSummary[] }
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF",
])

const ACCOUNT_STATUS_LABELS: Record<number, { label: string; tone: "green" | "red" | "amber" | "blue" | "gray" }> = {
  1: { label: "Active", tone: "green" },
  2: { label: "Disabled", tone: "red" },
  3: { label: "Unsettled", tone: "amber" },
  7: { label: "Pending review", tone: "blue" },
  8: { label: "Pending settlement", tone: "amber" },
  9: { label: "In grace period", tone: "amber" },
  100: { label: "Pending closure", tone: "gray" },
  101: { label: "Closed", tone: "gray" },
}

const TONE_DOT: Record<string, string> = {
  green: "bg-[#34b1aa]",
  red: "bg-[#f95f53]",
  amber: "bg-[#e29e09]",
  blue: "bg-[#3a61f6]",
  gray: "bg-[#a3a3a3]",
}
const TONE_BADGE: Record<string, string> = {
  green: "bg-[rgba(52,177,170,0.12)] text-[#08766f]",
  red: "bg-[rgba(249,95,83,0.10)] text-[#b03b32]",
  amber: "bg-[rgba(226,158,9,0.12)] text-[#946007]",
  blue: "bg-[rgba(58,96,246,0.12)] text-[#2747c9]",
  gray: "bg-[rgba(163,163,163,0.16)] text-[#5c5c5c]",
}

function parseMinorMoney(value?: string | number | null, currency = "USD") {
  if (value === undefined || value === null || value === "") return null
  const raw = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(raw)) return null
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? raw : raw / 100
}

function formatMajorMoney(amount: number, currency = "USD", compact = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2,
  }).format(amount)
}

function formatMinorMoney(value?: string | number | null, currency = "USD") {
  const amount = parseMinorMoney(value, currency)
  if (amount === null) return "—"
  return formatMajorMoney(amount, currency)
}

function parseMetaMoney(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return 0
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function getPurchaseCount(summary?: AccountSummary | null) {
  const actions = summary?.actions || []
  const aliases = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]
  const found = aliases.map(alias => actions.find(a => a.action_type === alias)).find(Boolean)
  return found ? Number(found.value || 0) || 0 : 0
}

function Field({ label, value, hint, tag }: { label: string; value: ReactNode; hint?: string; tag?: "RO" | "WR" }) {
  return (
    <div className="px-4 py-3.5 border-t border-border/60 first:border-t-0 [&:nth-child(2)]:border-t-0">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {tag === "RO" && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">RO</span>}
        {tag === "WR" && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">WR</span>}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-xs font-medium text-muted-foreground">{hint}</div>}
    </div>
  )
}

function Card({ title, tag, children }: { title: string; tag?: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex h-11 items-center justify-between border-b border-border/60 bg-muted/40 px-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {tag && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{tag}</span>}
      </div>
      {children}
    </div>
  )
}

export function AccountOverviewCards({ account }: { account: OverviewAccount | undefined }) {
  const router = useRouter()
  // This page keeps its own account list and does not read the provider for selection (see
  // AdAccountsManager). It does write to it here, so that following "View more" lands on Insights
  // already pointed at the account whose numbers were just on screen.
  const { setSelectedAccountId } = useAdAccount()
  const [oppScore, setOppScore] = useState<number | null>(null)
  const [oppLoading, setOppLoading] = useState(false)
  const [oppAvailable, setOppAvailable] = useState(false)
  const [summary, setSummary] = useState<AccountSummary | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [insightsLoading, setInsightsLoading] = useState(false)

  useEffect(() => {
    if (!account) return
    let cancelled = false
    const accountId = account.id || account.account_id

    async function loadOverview() {
      setInsightsLoading(true)
      setOppLoading(true)
      const [oppRes, summaryRes, campaignRes] = await Promise.allSettled([
        fetch(`/api/facebook/opportunity-score?ad_account_id=${encodeURIComponent(accountId)}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/insights/account-summary?adAccountId=${encodeURIComponent(accountId)}&datePreset=last_7d`).then(r => r.ok ? r.json() : null),
        fetch(`/api/facebook/campaigns?ad_account_id=${encodeURIComponent(accountId)}&date_preset=last_7d&limit=5&active_only=true`).then(r => r.ok ? r.json() : null),
      ])
      if (cancelled) return
      const opp = oppRes.status === "fulfilled" ? oppRes.value : null
      setOppScore(typeof opp?.score === "number" ? opp.score : null)
      setOppAvailable(Boolean(opp?.available))
      setOppLoading(false)
      const summaryPayload = summaryRes.status === "fulfilled" ? summaryRes.value : null
      setSummary(summaryPayload?.summary || null)
      const campaignPayload = campaignRes.status === "fulfilled" ? campaignRes.value : null
      setCampaigns((campaignPayload?.campaigns || []).slice(0, 5))
      setInsightsLoading(false)
    }

    loadOverview()
    return () => { cancelled = true }
  }, [account])

  if (!account) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        Select an ad account to view its overview.
      </div>
    )
  }

  const currency = account.currency || "USD"
  const status = ACCOUNT_STATUS_LABELS[account.account_status] ?? { label: `Status ${account.account_status}`, tone: "gray" as const }
  const spent = parseMinorMoney(account.amount_spent, currency)
  const cap = parseMinorMoney(account.spend_cap, currency)
  const hasLimit = cap !== null && cap > 0
  const remaining = hasLimit && spent !== null ? Math.max(cap - spent, 0) : null
  const usedPct = hasLimit && spent !== null ? Math.min((spent / cap) * 100, 100) : null
  const ownerName = account.owner_business?.name || account.business?.name
  const latestSpend = parseMetaMoney(summary?.spend)
  const purchases = getPurchaseCount(summary)
  const perPurchase = purchases ? latestSpend / purchases : null
  const nextStep = account.account_status !== 1
    ? { title: "Review account delivery status", body: "This ad account is not active. Open Meta settings before launch.", cta: "Review status" }
    : !hasLimit
      ? { title: "Set an account spending limit", body: "Add a spend cap to prevent accidental overspend across campaigns.", cta: "Get started" }
      : campaigns.length === 0
        ? { title: "Create or sync active campaigns", body: "No active campaign returned for the last 7 days on this account.", cta: "Create campaign" }
        : { title: "Review weekly delivery", body: "Check active campaigns with spend but no purchases before scaling budget.", cta: "View campaigns" }

  // "View more" on a results tile means "show me the ads behind this number" — Insights is the
  // surface that breaks purchases and cost-per-purchase down by campaign, ad and creative.
  const openInsights = () => {
    setSelectedAccountId(account.id || account.account_id)
    router.push("/insights")
  }

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-gradient-to-br from-primary/10 to-cyan-500/5 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold tracking-tight text-foreground">{account.name}</span>
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE_BADGE[status.tone])}>
              <span className={cn("size-1.5 rounded-full", TONE_DOT[status.tone])} />
              {status.label}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Account ID <span className="font-mono">{account.account_id}</span>
            {ownerName && <> · {ownerName}</>}
          </div>
        </div>
        <div className="flex gap-3">
          <Stat label="Spent" value={formatMinorMoney(account.amount_spent, currency)} />
          <Stat label="Balance" value={formatMinorMoney(account.balance, currency)} />
          {hasLimit && remaining !== null && <Stat label="Remaining" value={formatMajorMoney(remaining, currency)} accent />}
        </div>
      </div>

      {/* Row 1: Opportunity score + Latest results */}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card title="Opportunity score" tag="Meta">
          <div className="flex items-center gap-5 p-4">
            <div className="relative grid size-24 shrink-0 place-items-center rounded-full">
              <svg className="absolute inset-0 size-24 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="9" className="text-muted" />
                <circle
                  cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round"
                  className="text-primary"
                  strokeDasharray={`${(oppAvailable && oppScore ? oppScore : 0) * 2.64} 264`}
                />
              </svg>
              {oppLoading
                ? <IconLoader2 className="size-5 animate-spin text-primary" />
                : <div className="text-center"><div className="text-2xl font-bold text-foreground">{oppAvailable ? oppScore : "—"}</div><div className="text-xs text-muted-foreground">points</div></div>}
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Opportunity score</div>
              <p className="mt-1 text-sm text-muted-foreground">Apply recommendations proven to help performance.</p>
              {!oppAvailable && !oppLoading && <p className="mt-2 text-xs text-muted-foreground">Unavailable for this account/token.</p>}
            </div>
          </div>
        </Card>

        <Card title="Latest results" tag="Last 7 days">
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <MetricTile label="Purchases" value={insightsLoading ? "…" : purchases.toLocaleString()} link="View more" onLink={openInsights} />
            <MetricTile label="Per purchase" value={insightsLoading ? "…" : perPurchase == null ? "—" : formatMajorMoney(perPurchase, currency)} link="View more" onLink={openInsights} />
            <MetricTile label="Amount spent" value={insightsLoading ? "…" : formatMajorMoney(latestSpend, currency, true)} />
          </div>
        </Card>
      </div>

      {/* Campaign trends */}
      <Card title="Campaign trends" tag="Last 7 days">
        <div className="divide-y divide-border/60">
          {insightsLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading campaign trends…</div>
          ) : campaigns.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No active campaign data available for the last 7 days.</div>
          ) : campaigns.map(campaign => {
            const ins = campaign.insights?.data?.[0]
            const campaignPurchases = getPurchaseCount(ins)
            const campaignSpend = parseMetaMoney(ins?.spend)
            return (
              <div key={campaign.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_120px_140px] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{campaign.name}</div>
                  <span className="mt-1 inline-flex rounded-full bg-[rgba(52,177,170,0.12)] px-2 py-0.5 text-xs font-medium capitalize text-[#08766f]">{campaign.effective_status.toLowerCase().replace(/_/g, " ")}</span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Purchases</div>
                  <div className="text-lg font-semibold text-foreground">{campaignPurchases}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Amount spent</div>
                  <div className="text-sm font-semibold text-foreground">{formatMajorMoney(campaignSpend, currency, true)}</div>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Next step */}
      <Card title="Next step" tag="1 task">
        <div className="p-4">
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full w-[18%] bg-[#e29e09]" /></div>
          <div className="mt-4 flex gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><IconCheck className="size-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{nextStep.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{nextStep.body}</p>
              <button className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white">{nextStep.cta}</button>
            </div>
          </div>
        </div>
      </Card>

      {/* Status & Billing */}
      <Card title="Status & Billing" tag="Read-only">
        <div className="grid grid-cols-2">
          <Field label="Account name" value={account.name} tag="WR" />
          <Field label="Status" value={<span className="inline-flex items-center gap-1.5 text-foreground"><span className={cn("size-1.5 rounded-full", TONE_DOT[status.tone])} />{status.label}</span>} hint={`account_status = ${account.account_status}`} tag="RO" />
          <Field label="Currency" value={currency} tag="RO" />
          <Field label="Timezone" value={account.timezone_name || "—"} tag="RO" />
          <Field label="Amount spent" value={formatMinorMoney(account.amount_spent, currency)} tag="RO" />
          <Field label="Balance" value={formatMinorMoney(account.balance, currency)} tag="RO" />
        </div>
      </Card>

      {/* ASL */}
      <Card title="Account Spending Limit" tag="spend_cap">
        <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Current limit</div>
            <div className="mt-0.5 text-2xl font-bold text-foreground">
              {hasLimit ? formatMinorMoney(account.spend_cap, currency) : "No limit"}
            </div>
            <div className="mt-1 text-xs font-medium text-muted-foreground">
              {hasLimit && spent !== null
                ? `${formatMinorMoney(account.amount_spent, currency)} spent · ${remaining !== null ? formatMajorMoney(remaining, currency) : "—"} remaining`
                : "No spending cap set on this account"}
            </div>
            {hasLimit && usedPct !== null && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", usedPct >= 90 ? "bg-[#f95f53]" : usedPct >= 70 ? "bg-[#e29e09]" : "bg-[#34b1aa]")}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
            )}
          </div>
          <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">Read-only in this slice</span>
        </div>
      </Card>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-[120px] rounded-lg border border-border/60 bg-background/60 px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("text-base font-bold", accent ? "text-primary" : "text-foreground")}>{value}</div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  link,
  onLink,
}: {
  label: string
  value: string
  link?: string
  onLink?: () => void
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-foreground">{label}</div>
      <div className="mt-1 text-3xl font-normal leading-none text-foreground">{value}</div>
      {link && (
        <button
          type="button"
          onClick={onLink}
          className="mt-2 text-sm font-medium text-primary hover:underline"
        >
          {link}
        </button>
      )}
    </div>
  )
}

