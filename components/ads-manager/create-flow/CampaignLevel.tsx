"use client"

import {
  IconChartArrowsVertical,
  IconChevronDown,
  IconSpeakerphone,
  IconShoppingCart,
  IconThumbUp,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { SetupMode } from "./CreateEntryGate"
import { CampaignFormState, CampaignObjective, SpecialAdCategory } from "./types"
import { BidStrategySection } from "./BidStrategySection"
import { clearIncompatibleBiddingFields } from "@/lib/create-campaign-bidding"

interface Props {
  state: CampaignFormState
  update: (updates: Partial<CampaignFormState>) => void
  currency: string
  invalidFields: Set<string>
  setupMode: SetupMode
  /** Reopens the entry gate — the objective is chosen there, not here. */
  onChangeObjective: () => void
}

// Labels for the objective chosen at the gate. The objective only fixes the first link of the ODAX
// chain; conversion location, engagement type and performance goal come from `lib/odax-matrix.ts`
// at the ad set.
const OBJECTIVES: Array<{
  value: CampaignObjective
  label: string
  desc: string
  icon: React.ElementType
}> = [
  {
    value: "OUTCOME_SALES",
    label: "Sales",
    desc: "Create a website conversion campaign using a Pixel purchase event.",
    icon: IconShoppingCart,
  },
  {
    value: "OUTCOME_TRAFFIC",
    label: "Traffic",
    desc: "Send people to a website and optimize for link clicks or landing page views.",
    icon: IconChartArrowsVertical,
  },
  {
    value: "OUTCOME_ENGAGEMENT",
    label: "Engagement",
    desc: "Get video views or post engagement on your ad, or send engaged people to a website.",
    icon: IconThumbUp,
  },
  {
    value: "OUTCOME_AWARENESS",
    label: "Awareness",
    desc: "Reach people in your selected countries with a paused awareness campaign.",
    icon: IconSpeakerphone,
  },
]

const SPECIAL_CATEGORIES: Array<{ value: SpecialAdCategory; label: string }> = [
  { value: "CREDIT", label: "Credit" },
  { value: "EMPLOYMENT", label: "Employment" },
  { value: "HOUSING", label: "Housing" },
  { value: "ISSUES_ELECTIONS_POLITICS", label: "Social issues, elections or politics" },
]

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
])

export function CampaignLevel({
  state,
  update,
  currency,
  invalidFields,
  setupMode,
  onChangeObjective,
}: Props) {
  const budgetStep = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? "1" : "0.01"
  const [showSpecialCategories, setShowSpecialCategories] = useState(false)
  const objective = OBJECTIVES.find((option) => option.value === state.objective)

  const toggleCategory = (category: SpecialAdCategory) => {
    update({
      specialAdCategories: state.specialAdCategories.includes(category)
        ? state.specialAdCategories.filter((item) => item !== category)
        : [...state.specialAdCategories, category],
    })
  }

  // "New ad set or ad" scope: this campaign is already live in Meta. Every control below would
  // either be discarded on publish or would edit something the user did not ask to edit, so the
  // step becomes a read-only statement of what the ad set is inheriting.
  if (state.existingCampaignId) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-[#1c2b33] dark:text-gray-100">Campaign</h1>
          <span className="rounded-full bg-[#f0f2f5] px-2.5 py-1 text-[11px] font-medium text-[#65676b] dark:bg-muted">
            Existing · read-only
          </span>
        </div>

        <div className="space-y-4 rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
          <div>
            <span className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">Campaign name</span>
            <p className="mt-1 text-sm text-[#1c2b33] dark:text-gray-100">{state.existingCampaignName}</p>
            <p className="mt-0.5 font-mono text-[11px] text-[#a0a4ab]">{state.existingCampaignId}</p>
          </div>

          <div className="space-y-3 border-t border-[#e4e6eb] pt-4 dark:border-gray-800">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-[#1c2b33] dark:text-gray-300">Campaign objective</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f3ff] px-2.5 py-1 text-xs font-semibold text-[#1877f2] dark:bg-blue-900/30">
                {objective && <objective.icon className="size-3.5" />}
                {objective?.label || state.objective}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-[#1c2b33] dark:text-gray-300">Budget</span>
              <span className="text-xs font-medium text-[#4b4f56] dark:text-gray-400">
                {state.advantageCampaignBudget
                  ? "Campaign budget (CBO) — set on the campaign"
                  : "Ad set budget — set on the next step"}
              </span>
            </div>
          </div>

          <p className="border-t border-[#e4e6eb] pt-4 text-xs leading-relaxed text-[#65676b] dark:border-gray-800">
            Publishing adds an ad set and its ads to this campaign. Nothing here changes the
            campaign itself — to run different campaign settings,{" "}
            <button
              type="button"
              onClick={onChangeObjective}
              className="font-semibold text-[#1877f2] hover:underline"
            >
              create a new campaign
            </button>
            .
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-[#1c2b33] dark:text-gray-100">Campaign</h1>
      </div>

      <div className="space-y-4 rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
        <div>
          <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
            Campaign name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            aria-invalid={invalidFields.has("campaignName")}
            className={cn(
              "mt-1.5 h-9 w-full rounded border bg-white px-3 text-xs outline-none focus:ring-1 dark:bg-background",
              invalidFields.has("campaignName")
                ? "border-red-500 focus:border-red-500 focus:ring-red-200 dark:border-red-500"
                : "border-[#ccd0d5] focus:border-[#1877f2] focus:ring-[#1877f2] dark:border-gray-700"
            )}
            value={state.campaignName}
            onChange={(event) => update({ campaignName: event.target.value })}
            placeholder="Enter a campaign name"
          />
        </div>
      </div>

      <div className="rounded-lg border border-[#e4e6eb] bg-white shadow-sm dark:border-gray-800 dark:bg-card">
        <button
          type="button"
          onClick={() => setShowSpecialCategories(value => !value)}
          className="flex w-full items-center justify-between gap-4 p-5 text-left"
        >
          <span>
            <span className="block text-sm font-semibold text-[#1c2b33] dark:text-gray-100">
              Advanced settings
            </span>
            <span className="mt-1 block text-xs text-[#65676b]">
              Special Ad Categories{state.specialAdCategories.length ? ` · ${state.specialAdCategories.length} selected` : ""}
            </span>
          </span>
          <IconChevronDown className={cn("size-4 text-[#65676b] transition-transform", showSpecialCategories && "rotate-180")} />
        </button>
        {showSpecialCategories && (
          <div className="space-y-3 border-t border-[#e4e6eb] p-5 dark:border-gray-800">
            <p className="text-xs text-[#65676b]">
              Select only categories that apply. Leave all unchecked for no categories.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SPECIAL_CATEGORIES.map((category) => (
                <label
                  key={category.value}
                  className="flex cursor-pointer items-center gap-2 rounded border border-[#ccd0d5] px-3 py-2 text-xs dark:border-gray-700"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[#1877f2]"
                    checked={state.specialAdCategories.includes(category.value)}
                    onChange={() => toggleCategory(category.value)}
                  />
                  <span className="text-[#1c2b33] dark:text-gray-200">{category.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4 rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
        <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">
          Campaign details
        </h3>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#1c2b33] dark:text-gray-300">Buying type</span>
          <span className="text-xs font-medium text-[#4b4f56] dark:text-gray-400">Auction</span>
        </div>

        {/* Objective was decided at the entry gate. It is shown, not re-picked: changing it
            re-normalizes the whole ODAX chain, so it goes back through the gate. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="block text-xs text-[#1c2b33] dark:text-gray-300">Campaign objective</span>
            <span className="mt-0.5 block text-xs text-[#65676b]">{objective?.desc}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f3ff] px-2.5 py-1 text-xs font-semibold text-[#1877f2] dark:bg-blue-900/30">
              {objective && <objective.icon className="size-3.5" />}
              {objective?.label}
            </span>
            <button
              type="button"
              onClick={onChangeObjective}
              className="rounded px-2 py-1 text-xs font-semibold text-[#1877f2] hover:bg-[#e7f3ff] dark:hover:bg-blue-900/30"
            >
              Change
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-[#1c2b33] dark:text-gray-300">Campaign setup</span>
          <span className="text-xs font-medium text-[#4b4f56] dark:text-gray-400">
            {setupMode === "recommended" ? "Recommended settings" : "Manual campaign"}
          </span>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">
              Advantage campaign budget
            </h3>
            <p className="mt-1 text-xs text-[#65676b]">
              When enabled, the daily budget is set at campaign level. When disabled, budget is set on the ad set.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              // Toggling budget level moves who owns the strategy. Reset to Highest volume and drop
              // the companion values in the same patch so nothing stale survives the switch.
              update({
                advantageCampaignBudget: !state.advantageCampaignBudget,
                campaignBidStrategy: "LOWEST_COST_WITHOUT_CAP",
                ...clearIncompatibleBiddingFields("LOWEST_COST_WITHOUT_CAP"),
              })
            }
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
              state.advantageCampaignBudget ? "bg-[#1877f2]" : "bg-[#c9ccd1] dark:bg-gray-600"
            )}
            aria-label="Toggle campaign budget"
          >
            <span
              className={cn(
                "inline-block size-4 rounded-full bg-white shadow-sm transition-transform",
                state.advantageCampaignBudget ? "translate-x-4" : "translate-x-1"
              )}
            />
          </button>
        </div>

        {state.advantageCampaignBudget && (
          <div className="border-t border-[#e4e6eb] pt-4 dark:border-gray-800">
            <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
              Daily campaign budget <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1.5 max-w-[220px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#65676b]">
                {currency}
              </span>
              <input
                type="number"
                min="1"
                step={budgetStep}
                value={state.campaignBudget}
                onChange={(event) => update({ campaignBudget: event.target.value })}
                aria-invalid={invalidFields.has("campaignBudget")}
                className={cn(
                  "h-9 w-full rounded border bg-white pl-14 pr-3 text-xs outline-none focus:ring-1 dark:bg-background",
                  invalidFields.has("campaignBudget")
                    ? "border-red-500 focus:border-red-500 focus:ring-red-200 dark:border-red-500"
                    : "border-[#ccd0d5] focus:border-[#1877f2] focus:ring-[#1877f2] dark:border-gray-700"
                )}
              />
            </div>

            <div className="mt-4 border-t border-[#e4e6eb] pt-4 dark:border-gray-800">
              <h4 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">Budget strategy</h4>
              <p className="mt-1 mb-3 text-xs text-[#65676b]">
                With campaign budget on, the bid strategy is set here and applies to every ad set in this
                campaign.
              </p>
              <BidStrategySection
                strategy={state.campaignBidStrategy}
                costPerResultGoal={state.costPerResultGoal}
                onChange={update}
                currency={currency}
                budgetStep={budgetStep}
                invalidFields={invalidFields}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
