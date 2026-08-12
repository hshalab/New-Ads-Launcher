"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { IconLoader2 } from "@tabler/icons-react"

/**
 * The spend history of an ad account this org no longer has.
 *
 * Everything shown here is reconstructed from `ad_account_metrics_snapshots` — the append-only
 * local sync history — because the account is gone from Meta and cannot be queried. Two things
 * follow from that and shape the whole component:
 *
 * 1. `amount_spent` in a snapshot is Meta's **lifetime** figure, not a daily one. The cumulative
 *    chart plots it directly; the daily chart plots the difference between consecutive days, and
 *    clamps negatives (a spend reset or a mid-history currency change would otherwise draw a spike
 *    below zero).
 * 2. The series only covers days AdLauncher actually synced. Gaps are real gaps in observation,
 *    not zero-spend days, which is why days without a snapshot are omitted rather than filled.
 *
 * Read-only by construction: there is no mutation path from this dialog.
 */

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF",
])

const GRID = "#e1e0d9"
const MUTED = "#898781"
const SPENT = "#007D1E"
const CAP = "#3a61f6"

/** Snapshots that fit ~45 days of history at the current sync cadence; the API caps this at 500. */
const HISTORY_LIMIT = 500

type Snapshot = {
  id: string
  spend_cap_minor: number | null
  remaining_minor: number | null
  amount_spent_minor: number | null
  account_status: number | null
  synced_at: string
}

export type RemovedAccountSummary = {
  id: string
  account_id: string
  name: string
  currency: string
  amount_spent: string | null
  spend_cap: string | null
  last_seen_at: string | null
}

function toMajor(minor: number | null | undefined, currency: string) {
  if (minor == null) return null
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? minor : minor / 100
}

function formatMoney(amount: number | null, currency: string) {
  if (amount == null) return "—"
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: zeroDecimal ? 0 : 2,
    maximumFractionDigits: zeroDecimal ? 0 : 2,
  }).format(amount)
}

function formatDay(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
}

export function RemovedAccountDetail({
  account,
  onClose,
}: {
  account: RemovedAccountSummary | null
  onClose: () => void
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(false)

  // Reopening on a different account while the first request is still in flight must not paint the
  // wrong account's history: only the newest request is allowed to write state.
  const requestRef = useRef(0)

  const loadHistory = useCallback(async (accountId: string) => {
    const request = ++requestRef.current
    setLoading(true)
    setSnapshots([])
    try {
      const response = await fetch(
        `/api/facebook/ad-account-metrics?account_id=${encodeURIComponent(accountId)}&limit=${HISTORY_LIMIT}`
      )
      const data = response.ok ? await response.json() : { snapshots: [] }
      if (request === requestRef.current) setSnapshots(data.snapshots || [])
    } catch {
      if (request === requestRef.current) setSnapshots([])
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (account) loadHistory(account.account_id)
  }, [account, loadHistory])

  const currency = account?.currency || "USD"

  /** One point per synced day, using that day's last snapshot. */
  const series = useMemo(() => {
    const byDay = new Map<string, Snapshot>()
    for (const snapshot of snapshots) {
      const day = (snapshot.synced_at || "").slice(0, 10)
      if (!day) continue
      const existing = byDay.get(day)
      if (!existing || snapshot.synced_at > existing.synced_at) byDay.set(day, snapshot)
    }

    const days = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b))
    const spentByIndex = days.map(([, snapshot]) => toMajor(snapshot.amount_spent_minor, currency))

    return days.map(([day, snapshot], index) => {
      const spent = spentByIndex[index]
      // Lifetime spend minus the previous sync's lifetime spend. Negative means the baseline moved,
      // not that money came back — show nothing rather than a downward bar.
      const previousSpent = index > 0 ? spentByIndex[index - 1] : null
      const daily = spent != null && previousSpent != null ? Math.max(spent - previousSpent, 0) : null
      return {
        day,
        label: formatDay(day),
        spent,
        daily,
        cap: toMajor(snapshot.spend_cap_minor, currency),
        remaining: toMajor(snapshot.remaining_minor, currency),
      }
    })
  }, [snapshots, currency])

  const latest = series.length > 0 ? series[series.length - 1] : null
  const totalSpent = latest?.spent ?? toMajor(account?.amount_spent != null ? Number(account.amount_spent) : null, currency)
  const spendCap = latest?.cap ?? toMajor(account?.spend_cap != null ? Number(account.spend_cap) : null, currency)
  const remaining = latest?.remaining ?? (spendCap != null && totalSpent != null ? Math.max(spendCap - totalSpent, 0) : null)
  const capUsed = spendCap && spendCap > 0 && totalSpent != null ? (totalSpent / spendCap) * 100 : null

  /** Every point at which the spend limit was set to a different value. */
  const capChanges = useMemo(() => {
    const changes: { day: string; from: number | null; to: number | null }[] = []
    let previous: number | null | undefined = undefined
    for (const point of series) {
      if (previous !== undefined && point.cap !== previous) {
        changes.push({ day: point.day, from: previous, to: point.cap })
      }
      previous = point.cap
    }
    return changes.reverse()
  }, [series])

  const dailySeries = series.filter(point => point.daily != null)

  return (
    <Dialog open={Boolean(account)} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {account?.name}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Read-only
            </span>
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{account?.account_id}</span> · last seen{" "}
            {account?.last_seen_at ? new Date(account.last_seen_at).toLocaleString() : "unknown"} · figures below come
            from AdLauncher&apos;s own sync history, not from Meta.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-16 text-center">
            <IconLoader2 className="mx-auto mb-2 size-5 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading spend history…</p>
          </div>
        ) : series.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No snapshot history was recorded for this account.
          </p>
        ) : (
          <div className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryTile label="Total spent" value={formatMoney(totalSpent, currency)} tone={SPENT} />
              <SummaryTile label="Spend limit" value={formatMoney(spendCap, currency)} tone={CAP} />
              <SummaryTile label="Remaining" value={formatMoney(remaining, currency)} />
              <SummaryTile
                label="Limit used"
                value={capUsed == null ? "—" : `${capUsed.toFixed(1)}%`}
                hint={spendCap == null ? "no limit was set" : undefined}
              />
            </div>

            {/* Cumulative spend against the limit */}
            <section>
              <h3 className="mb-1 text-sm font-semibold text-foreground">Total spent over time</h3>
              <p className="mb-2 text-xs text-muted-foreground">
                Lifetime spend as recorded at each sync{spendCap != null && ", with the spend limit as the dashed line"}.
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="removedSpendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SPENT} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={SPENT} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: MUTED }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10, fill: MUTED }} width={64} tickFormatter={v => formatMoney(Number(v), currency)} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(value: unknown) => formatMoney(Number(value), currency)}
                  />
                  {spendCap != null && (
                    <ReferenceLine
                      y={spendCap}
                      stroke={CAP}
                      strokeDasharray="4 4"
                      label={{ value: "Spend limit", position: "insideTopRight", fontSize: 10, fill: CAP }}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="spent"
                    name="Total spent"
                    stroke={SPENT}
                    strokeWidth={2}
                    fill="url(#removedSpendFill)"
                    connectNulls
                  />
                </AreaChart>
              </ResponsiveContainer>
            </section>

            {/* Per-day spend */}
            {dailySeries.length > 0 && (
              <section>
                <h3 className="mb-1 text-sm font-semibold text-foreground">Spend per day</h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  Difference between consecutive syncs. Days AdLauncher did not sync are absent, not zero.
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={dailySeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: MUTED }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 10, fill: MUTED }} width={64} tickFormatter={v => formatMoney(Number(v), currency)} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(value: unknown) => formatMoney(Number(value), currency)}
                    />
                    <Bar dataKey="daily" name="Spent that day" fill={SPENT} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </section>
            )}

            {/* Spend limit changes */}
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                Spend limit changes {capChanges.length > 0 && <span className="text-muted-foreground">({capChanges.length})</span>}
              </h3>
              {capChanges.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  The spend limit never changed across the recorded history.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {capChanges.map(change => (
                    <li key={change.day} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span className="text-muted-foreground">{formatDay(change.day)}</span>
                      <span className="text-foreground">
                        <span className="text-muted-foreground line-through">{formatMoney(change.from, currency)}</span>
                        {" → "}
                        <span className="font-semibold text-primary">{formatMoney(change.to, currency)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="text-xs text-muted-foreground">
              {series.length} synced day{series.length === 1 ? "" : "s"} recorded, {formatDay(series[0].day)} –{" "}
              {formatDay(series[series.length - 1].day)}.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SummaryTile({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold" style={tone ? { color: tone } : undefined}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  )
}
