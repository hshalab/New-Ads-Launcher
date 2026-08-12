"use client"

import { AdvertiserEntity, CampaignFormState, PixelOption } from "./types"
import { AdSetFormFields } from "./AdSetFormFields"

interface Props {
  state: CampaignFormState
  update: (updates: Partial<CampaignFormState>) => void
  pixels: PixelOption[]
  pixelsLoading: boolean
  currency: string
  timezoneName?: string
  invalidFields: Set<string>
  advertisers: AdvertiserEntity[]
}

export function AdSetLevel({ state, update, pixels, pixelsLoading, currency, timezoneName, invalidFields, advertisers }: Props) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8 pb-20">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-[#1c2b33] dark:text-gray-100">Ad Set</h1>
      </div>

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
      />
    </div>
  )
}
