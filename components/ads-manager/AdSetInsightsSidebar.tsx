"use client"

import { useEffect, useRef, useState } from "react"
import {
  IconAlertTriangle,
  IconBulb,
  IconGauge,
  IconInfoCircle,
  IconUsers,
} from "@tabler/icons-react"
import type { TargetingInput } from "@/lib/create-campaign-targeting"
import type { AdSetRecommendation, CampaignScore } from "@/lib/adset-recommendations"
import { INFO_PENALTY, WARNING_PENALTY } from "@/lib/adset-recommendations"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Campaign score + Estimated audience size + Campaign recommendations — the right rail beside an
 * ad set. Mounted by the Editor and, since the score gave the create flow something it can answer
 * honestly before anything is saved, by the create flow as well.
 *
 * What each card can and cannot say at create time is not the same, and the copy carries the
 * difference rather than hiding it: the score is computed from the form in front of you and is
 * always true; the audience estimate is a real Meta call and needs an account, a goal and a
 * location; Meta's own `recommendations` edge needs a campaign that exists and is deliberately not
 * read here at all.
 *
 * The props are deliberately primitive rather than a form-state object, because the two surfaces
 * that mount this keep their state in different shapes — the create flow in `CampaignFormState`,
 * the Editor in Meta's own draft shape. Each maps to `TargetingInput` (the same type
 * `buildTargeting` and the create route use) so the estimate is always computed from the targeting
 * that would actually be sent.
 */

export type { AdSetRecommendation }

/**
 * The `?` affordance next to a card title. `title` alone is not enough here — these numbers are
 * easy to mistake for Meta's, and a native tooltip does not appear on touch and cannot be styled
 * to hold two sentences legibly.
 */
function InfoHint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="ml-auto flex size-4 shrink-0 items-center justify-center rounded-full text-[#a0a4ab] transition-colors hover:text-[#65676b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconInfoCircle size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[260px] leading-relaxed">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const SCORE_TONE: Record<CampaignScore["band"], { text: string; track: string; bar: string }> = {
  good: {
    text: "text-emerald-600 dark:text-emerald-400",
    track: "bg-emerald-100 dark:bg-emerald-950/40",
    bar: "bg-emerald-500",
  },
  fair: {
    text: "text-amber-600 dark:text-amber-400",
    track: "bg-amber-100 dark:bg-amber-950/40",
    bar: "bg-amber-500",
  },
  poor: {
    text: "text-rose-600 dark:text-rose-400",
    track: "bg-rose-100 dark:bg-rose-950/40",
    bar: "bg-rose-500",
  },
}

export function CampaignScoreCard({ score }: { score: CampaignScore }) {
  const tone = SCORE_TONE[score.band]
  return (
    <section className="rounded-lg border border-[#e4e6eb] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-card">
      <div className="flex items-center gap-2">
        <IconGauge size={16} className="text-[#65676b]" />
        <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">Campaign score</h3>
        <InfoHint label="How the campaign score is calculated">
          AdLauncher&apos;s own score, not Meta&apos;s — Meta has no campaign score. It starts at 100
          and subtracts {WARNING_PENALTY} for each warning and {INFO_PENALTY} for each suggestion in
          Campaign recommendations below, so it is that list at a lower resolution.
        </InfoHint>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className={cn("text-2xl font-bold tabular-nums", tone.text)}>{score.value}</span>
        <span className="text-xs text-[#65676b]">/ 100</span>
        <span className={cn("ml-auto text-xs font-semibold", tone.text)}>{score.label}</span>
      </div>

      <div className={cn("mt-2 h-1.5 w-full overflow-hidden rounded-full", tone.track)}>
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", tone.bar)}
          style={{ width: `${score.value}%` }}
        />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[#a0a4ab]">
        {score.warnings === 0 && score.infos === 0
          ? "No checks failed against these settings."
          : `${score.warnings} warning${score.warnings === 1 ? "" : "s"}, ${score.infos} suggestion${
              score.infos === 1 ? "" : "s"
            }.`}
      </p>
    </section>
  )
}

interface EstimateState {
  status: "idle" | "loading" | "ready" | "unavailable"
  lowerBound?: number | null
  upperBound?: number | null
  reason?: string
}

const compact = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)

export function EstimatedAudienceCard({
  accountId,
  optimizationGoal,
  targeting,
}: {
  accountId: string
  optimizationGoal: string
  targeting: TargetingInput
}) {
  const [estimate, setEstimate] = useState<EstimateState>({ status: "idle" })
  const requestSeq = useRef(0)

  // Serialised so the effect re-runs on a value change rather than on every parent render — an
  // object literal prop would refire on each keystroke and spend Meta rate-limit headroom
  // (lib/rate-limit-store.ts) on an unchanged audience.
  const targetingKey = JSON.stringify(targeting)

  useEffect(() => {
    if (!accountId || !optimizationGoal) return
    const seq = ++requestSeq.current

    const timer = setTimeout(async () => {
      setEstimate({ status: "loading" })
      try {
        const res = await fetch("/api/facebook/delivery-estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ad_account_id: accountId,
            optimization_goal: optimizationGoal,
            targeting: JSON.parse(targetingKey),
          }),
        })
        const data = await res.json()
        if (seq !== requestSeq.current) return
        if (!res.ok || !data.estimateReady) {
          setEstimate({
            status: "unavailable",
            reason:
              data.reason === "no_locations"
                ? "Add at least one country to see an estimate"
                : data.reason || data.error || "Estimate not available",
          })
          return
        }
        setEstimate({
          status: "ready",
          lowerBound: data.lowerBound,
          upperBound: data.upperBound,
        })
      } catch {
        if (seq !== requestSeq.current) return
        setEstimate({ status: "unavailable", reason: "Estimate not available" })
      }
    }, 600)

    return () => clearTimeout(timer)
  }, [accountId, optimizationGoal, targetingKey])

  return (
    <section className="rounded-lg border border-[#e4e6eb] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-card">
      <div className="flex items-center gap-2">
        <IconUsers size={16} className="text-[#65676b]" />
        <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">
          Estimated audience size
        </h3>
        <InfoHint label="What the estimated audience size means">
          Monthly active people on Meta technologies matching this targeting, returned by Meta&apos;s
          delivery estimate. It moves with your locations, age, gender and placements — it is not a
          prediction of results, and it says nothing about budget.
        </InfoHint>
      </div>

      <div className="mt-3">
        {!accountId && <p className="text-xs text-[#65676b]">Select an ad account first.</p>}
        {accountId && !optimizationGoal && (
          <p className="text-xs text-[#65676b]">Set a performance goal to see an estimate.</p>
        )}
        {accountId && optimizationGoal && (estimate.status === "loading" || estimate.status === "idle") && (
          <div className="h-6 w-40 animate-pulse rounded bg-[#f0f2f5] dark:bg-muted" />
        )}
        {accountId &&
          estimate.status === "ready" &&
          (estimate.lowerBound != null && estimate.upperBound != null ? (
            <p className="text-lg font-semibold tabular-nums text-[#1c2b33] dark:text-gray-100">
              {compact(estimate.lowerBound)} – {compact(estimate.upperBound)}
            </p>
          ) : (
            <p className="text-xs text-[#65676b]">Meta returned no range for this audience.</p>
          ))}
        {accountId && estimate.status === "unavailable" && (
          <p className="text-xs text-[#65676b]">{estimate.reason || "Estimate not available"}</p>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[#a0a4ab]">
        Monthly active people on Meta technologies matching this targeting. Estimates are from Meta
        and are not a prediction of results.
      </p>
    </section>
  )
}

export function CampaignRecommendationsCard({
  recommendations,
}: {
  recommendations: AdSetRecommendation[]
}) {
  return (
    <section className="rounded-lg border border-[#e4e6eb] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-card">
      <div className="flex items-center gap-2">
        <IconBulb size={16} className="text-[#65676b]" />
        <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">
          Campaign recommendations
        </h3>
        <InfoHint label="Where the recommendations come from">
          Checks AdLauncher runs against this ad set&apos;s own settings — a warning is something
          Meta may refuse, a suggestion is something that usually raises cost per result.
          Meta&apos;s own recommendations edge needs a campaign that already exists and is not read
          here.
        </InfoHint>
      </div>

      {recommendations.length === 0 ? (
        <p className="mt-3 text-xs text-[#65676b]">
          Nothing to flag. This ad set passes every check we can run against its current settings.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {recommendations.map((rec) => (
            <li key={rec.title} className="flex gap-2">
              {rec.level === "warning" ? (
                <IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-[#e29e09]" />
              ) : (
                <IconInfoCircle size={15} className="mt-0.5 shrink-0 text-[#65676b]" />
              )}
              <div>
                <p
                  className={cn(
                    "text-xs font-semibold",
                    rec.level === "warning"
                      ? "text-[#1c2b33] dark:text-gray-100"
                      : "text-[#1c2b33] dark:text-gray-200"
                  )}
                >
                  {rec.title}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#65676b]">{rec.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-[#f0f2f5] pt-2 text-[11px] leading-relaxed text-[#a0a4ab] dark:border-gray-800">
        Checks run by AdLauncher against this ad set&apos;s settings. Meta&apos;s own recommendations
        edge is not read here.
      </p>
    </section>
  )
}

export function AdSetInsightsSidebar({
  accountId,
  optimizationGoal,
  targeting,
  recommendations,
  score,
}: {
  accountId: string
  optimizationGoal: string
  targeting: TargetingInput
  recommendations: AdSetRecommendation[]
  /** Omitted by the Editor, which shows the recommendation list without the summary number. */
  score?: CampaignScore
}) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
      {score && <CampaignScoreCard score={score} />}
      <EstimatedAudienceCard
        accountId={accountId}
        optimizationGoal={optimizationGoal}
        targeting={targeting}
      />
      <CampaignRecommendationsCard recommendations={recommendations} />
    </aside>
  )
}
