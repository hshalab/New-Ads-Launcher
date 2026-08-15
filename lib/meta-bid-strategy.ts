type BidStrategyContext = {
  bidAmount?: string | number | null
  bidConstraints?: { roas_average_floor?: string | number } | null
  optimizationGoal?: string | null
  currency?: string
}

function formatMetaMoney(raw: string | number, currency: string) {
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency })
    const divisor = 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2)
    return formatter.format(Number(raw) / divisor)
  } catch {
    return `${(Number(raw) / 100).toLocaleString()} ${currency}`
  }
}

export function formatCampaignBidStrategy(strategy?: string | null, context: BidStrategyContext = {}) {
  if (!strategy) return "—"
  if (strategy === "COST_CAP") return "Cost cap"
  if (strategy === "LOWEST_COST_WITH_BID_CAP") return "Bid cap"
  if (strategy === "LOWEST_COST_WITH_MIN_ROAS") return "ROAS goal"
  if (strategy === "LOWEST_COST_WITHOUT_CAP") return context.optimizationGoal === "VALUE" ? "Highest value" : "Highest volume"
  return strategy
}

export function formatAdSetBidStrategy(strategy?: string | null, context: BidStrategyContext = {}) {
  if (!strategy) return "—"
  const amount = context.bidAmount != null && context.bidAmount !== "" && Number.isFinite(Number(context.bidAmount))
    ? formatMetaMoney(context.bidAmount, context.currency || "USD")
    : ""
  if (strategy === "COST_CAP") return `Cost per result goal${amount ? ` (${amount})` : ""}`
  if (strategy === "LOWEST_COST_WITH_BID_CAP") return `Bid cap${amount ? ` (${amount})` : ""}`
  if (strategy === "LOWEST_COST_WITH_MIN_ROAS") {
    const floor = Number(context.bidConstraints?.roas_average_floor)
    return Number.isFinite(floor) ? `ROAS goal (${floor / 10000})` : "ROAS goal"
  }
  if (strategy === "LOWEST_COST_WITHOUT_CAP") return context.optimizationGoal === "VALUE" ? "Highest value" : "Highest volume"
  return strategy
}
