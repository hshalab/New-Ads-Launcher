"use client"

import { useMemo } from "react"
import { AdvertiserEntity, CampaignFormState, PixelOption } from "./types"
import { AdSetFormFields } from "./AdSetFormFields"
import { AdSetInsightsSidebar } from "../AdSetInsightsSidebar"
import { buildAdSetRecommendations, campaignScore } from "@/lib/adset-recommendations"
import type { TargetingInput } from "@/lib/create-campaign-targeting"

interface Props {
  state: CampaignFormState
  update: (updates: Partial<CampaignFormState>) => void
  pixels: PixelOption[]
  pixelsLoading: boolean
  currency: string
  timezoneName?: string
  invalidFields: Set<string>
  advertisers: AdvertiserEntity[]
  accountId: string
}

export function AdSetLevel({
  state,
  update,
  pixels,
  pixelsLoading,
  currency,
  timezoneName,
  invalidFields,
  advertisers,
  accountId,
}: Props) {
  // The exact shape `buildTargeting` and the create route consume, so the estimate is computed
  // from the targeting that would actually be sent — not from a parallel reading of the form.
  const targeting = useMemo<TargetingInput>(
    () => ({
      locations: state.locations,
      ageMin: state.ageMin,
      ageMax: state.ageMax,
      gender: state.gender,
      placementMode: state.placementMode,
      publisherPlatforms: state.publisherPlatforms,
      targetingExpansion: state.targetingExpansion,
    }),
    [
      state.locations,
      state.ageMin,
      state.ageMax,
      state.gender,
      state.placementMode,
      state.publisherPlatforms,
      state.targetingExpansion,
    ]
  )

  // Same checks the Editor runs, from lib/adset-recommendations.ts. Advantage+ placements sends no
  // publisher_platforms at all, so the count is zero there rather than four — the placement check
  // is about a *restricted* manual selection.
  const recommendations = useMemo(
    () =>
      buildAdSetRecommendations({
        hasLocation: state.locations.length > 0,
        optimizationGoal: state.performanceGoal,
        pixelId: state.pixelId,
        publisherPlatformCount:
          state.placementMode === "manual" ? state.publisherPlatforms.length : 0,
        targetingExpansion: state.targetingExpansion,
        ageMin: state.ageMin,
        ageMax: state.ageMax,
      }),
    [
      state.locations,
      state.performanceGoal,
      state.pixelId,
      state.placementMode,
      state.publisherPlatforms,
      state.targetingExpansion,
      state.ageMin,
      state.ageMax,
    ]
  )

  const score = useMemo(() => campaignScore(recommendations), [recommendations])

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 pb-10">
      <div className="mb-5 flex items-center gap-2">
        <h1 className="text-xl font-bold text-[#1c2b33] dark:text-gray-100">Ad Set</h1>
      </div>

      {/* Form left, insights right. The rail sits beside the Conversion card — the score and the
          audience estimate both answer questions the conversion + targeting choices raise, and
          they are read while those choices are being made, not after. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <AdSetFormFields
            value={state}
            onChange={update}
            mode="create"
            pixels={pixels}
            pixelsLoading={pixelsLoading}
            currency={currency}
            timezoneName={timezoneName}
            invalidFields={invalidFields}
            advertisers={advertisers}
            readOnlyFields
          />
        </div>

        <AdSetInsightsSidebar
          accountId={accountId}
          optimizationGoal={state.performanceGoal}
          targeting={targeting}
          recommendations={recommendations}
          score={score}
        />
      </div>
    </div>
  )
}
