"use client"

import { cn } from "@/lib/utils"
import {
  BID_STRATEGY_LABEL,
  clearIncompatibleBiddingFields,
  isBidStrategy,
  type BidStrategy,
} from "@/lib/create-campaign-bidding"

/**
 * Budget strategy picker plus the one value input the chosen strategy needs.
 *
 * Rendered at campaign level when Advantage campaign budget owns the budget (CBO) and at ad set
 * level otherwise (ABO) — the strategy always sits on whichever level owns budget, which is Meta's
 * contract. Both cases write the same `campaignBidStrategy` / `costPerResultGoal` form fields; the
 * route decides which Meta object receives them.
 *
 * ROAS goal (`LOWEST_COST_WITH_MIN_ROAS`) is deliberately absent: it requires
 * `optimization_goal=VALUE` and the ODAX matrix has no VALUE row yet (BL-56). The route still
 * guards it server-side.
 */
const OFFERED: BidStrategy[] = ["LOWEST_COST_WITHOUT_CAP", "COST_CAP", "LOWEST_COST_WITH_BID_CAP"]

const CAP_HINT: Record<string, string> = {
  COST_CAP: "Meta keeps your average cost per result at or below this amount.",
  LOWEST_COST_WITH_BID_CAP: "Meta will not bid more than this amount in any auction.",
}

export interface BidStrategySectionProps {
  strategy: string
  costPerResultGoal: string
  onChange: (patch: { campaignBidStrategy?: BidStrategy; costPerResultGoal?: string; roasGoal?: string }) => void
  currency: string
  budgetStep: string
  invalidFields?: Set<string>
  /** ODAX row says this performance goal cannot take a cap — offer Highest volume only. */
  allowsCostCap?: boolean
  className?: string
}

export function BidStrategySection({
  strategy,
  costPerResultGoal,
  onChange,
  currency,
  budgetStep,
  invalidFields = new Set(),
  allowsCostCap = true,
  className,
}: BidStrategySectionProps) {
  const active: BidStrategy = isBidStrategy(strategy) ? strategy : "LOWEST_COST_WITHOUT_CAP"
  const options = allowsCostCap ? OFFERED : ["LOWEST_COST_WITHOUT_CAP" as BidStrategy]
  const needsCap = active === "COST_CAP" || active === "LOWEST_COST_WITH_BID_CAP"

  // One atomic patch: changing strategy also drops the value that no longer belongs to it, so a
  // stale hidden field can never survive to publish.
  const selectStrategy = (next: BidStrategy) =>
    onChange({ campaignBidStrategy: next, ...clearIncompatibleBiddingFields(next) })

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">Bid strategy</label>
        <select
          value={active}
          onChange={(event) => selectStrategy(event.target.value as BidStrategy)}
          className="mt-1.5 h-9 w-full max-w-[260px] rounded border border-[#ccd0d5] bg-white px-3 text-xs outline-none focus:border-[#1877f2] focus:ring-1 focus:ring-[#1877f2] dark:border-gray-700 dark:bg-background"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {BID_STRATEGY_LABEL[option]}
            </option>
          ))}
        </select>
      </div>

      {needsCap && (
        <div>
          <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
            {BID_STRATEGY_LABEL[active]} <span className="text-red-500">*</span>
          </label>
          <div className="relative mt-1.5 max-w-[260px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#65676b]">
              {currency}
            </span>
            <input
              type="number"
              min="0"
              step={budgetStep}
              value={costPerResultGoal}
              onChange={(event) => onChange({ costPerResultGoal: event.target.value })}
              placeholder="0.00"
              aria-invalid={invalidFields.has("costPerResultGoal")}
              className={cn(
                "h-9 w-full rounded border bg-white pl-14 pr-3 text-xs outline-none dark:bg-background",
                invalidFields.has("costPerResultGoal")
                  ? "border-red-500 focus:border-red-500 dark:border-red-500"
                  : "border-[#ccd0d5] focus:border-[#1877f2] dark:border-gray-700"
              )}
            />
          </div>
          <p className="mt-1 text-[11px] text-[#65676b]">{CAP_HINT[active]}</p>
        </div>
      )}
    </div>
  )
}
