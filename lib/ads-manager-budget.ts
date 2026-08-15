export type BudgetOwner = "campaign" | "adset"

type BudgetNode = {
  id?: string
  daily_budget?: string
  lifetime_budget?: string
}

export type BudgetDisplay = {
  amountMinor: string | null
  period: "Daily" | "Lifetime" | null
  owner: BudgetOwner | null
  label: string
  editable: boolean
}

function ownBudget(node?: BudgetNode | null) {
  if (node?.daily_budget) return { amountMinor: node.daily_budget, period: "Daily" as const }
  if (node?.lifetime_budget) return { amountMinor: node.lifetime_budget, period: "Lifetime" as const }
  return null
}

export function getBudgetDisplay(
  level: "campaign" | "adset" | "ad",
  node: BudgetNode,
  campaign?: BudgetNode | null,
  adset?: BudgetNode | null,
): BudgetDisplay {
  const own = ownBudget(node)
  if (level === "campaign") {
    if (own) return { ...own, owner: "campaign", label: "", editable: true }
    return { amountMinor: null, period: null, owner: "adset", label: "Using ad set budget", editable: false }
  }

  const campaignBudget = ownBudget(campaign)
  if (campaignBudget) {
    return { ...campaignBudget, owner: "campaign", label: "Using campaign budget", editable: false }
  }

  if (level === "adset") {
    if (own) return { ...own, owner: "adset", label: "", editable: true }
    return { amountMinor: null, period: null, owner: "campaign", label: "Using campaign budget", editable: false }
  }

  const adsetBudget = ownBudget(adset)
  if (adsetBudget) {
    return { ...adsetBudget, owner: "adset", label: "Using ad set budget", editable: false }
  }

  if (adset) {
    return { amountMinor: null, period: null, owner: "campaign", label: "Using campaign budget", editable: false }
  }

  return { amountMinor: null, period: null, owner: null, label: "-", editable: false }
}
