import {
  ODAX_ROWS,
  isCampaignObjective,
  type MetaDestinationType,
  type PerformanceGoal,
} from "@/lib/odax-matrix"

/**
 * The ODAX rules, applied to an *existing* ad set rather than to a form.
 *
 * `lib/odax-matrix.ts` is the one table that says which performance goals a campaign objective and
 * conversion location permit. The create flow and `create-campaign/route.ts` both read it; the Ads
 * Manager editor never did (TD-42), so an edit could set a goal Meta rejects — and since the
 * create→editor handoff shipped, the editor is the surface every new object lands on.
 *
 * This module is deliberately pure and deliberately *permissive*: it can only refuse a goal when it
 * knows the exact row. Anything it cannot resolve degrades open, because a false rejection blocks a
 * real edit for every user at once (no feature flags — TD-12/TD-06), which is worse than letting
 * Meta reject the combination the way it does today.
 */

/**
 * Every performance goal permitted for this objective + Meta `destination_type`.
 *
 * Returns `null` when the combination is not in the table — unknown, not disallowed.
 */
export function allowedPerformanceGoals(
  objective: string | undefined,
  destinationType: string | undefined
): PerformanceGoal[] | null {
  if (!isCampaignObjective(objective)) return null
  if (!destinationType) return null

  const rows = ODAX_ROWS.filter(
    row => row.objective === objective && row.destinationType === (destinationType as MetaDestinationType)
  )
  if (!rows.length) return null

  const goals = new Set<PerformanceGoal>()
  for (const row of rows) for (const goal of row.performanceGoals) goals.add(goal.value)
  return [...goals]
}

/**
 * The rejection message for an ad set change, or `null` to let the change through.
 *
 * Naming the allowed goals matters: `workspace-publish` returns this straight to the buyer, and the
 * only alternative feedback they get today is Meta's own error, which does not say what *would*
 * have worked.
 */
export function odaxRejectionForAdSet(input: {
  optimizationGoal?: string
  objective?: string
  destinationType?: string
}): string | null {
  const { optimizationGoal, objective, destinationType } = input
  if (!optimizationGoal) return null

  const allowed = allowedPerformanceGoals(objective, destinationType)
  if (!allowed) return null
  if (allowed.includes(optimizationGoal as PerformanceGoal)) return null

  return `Performance goal ${optimizationGoal} is not valid for a ${objective} campaign with this conversion location. Meta accepts: ${allowed.join(", ")}.`
}
