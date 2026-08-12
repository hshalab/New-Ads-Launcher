"use client"

import { useEffect, useMemo, useState } from "react"
import { getUtcOffsetLabel, wallClockToUtcDate } from "@/lib/timezone"
import { cn } from "@/lib/utils"
import {
  AdvertiserEntity,
  CampaignFormState,
  ConversionEvent,
  PerformanceGoal,
  PixelOption,
  PublisherPlatform,
} from "./types"
import { COUNTRIES, ZERO_DECIMAL_CURRENCIES, performanceOptions } from "./adset-options"

function AccountClock({ timezoneName }: { timezoneName: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const formatted = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: timezoneName,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(now)
    } catch {
      return null
    }
  }, [now, timezoneName])
  if (!formatted) return null
  return <span className="tabular-nums">{formatted}</span>
}

function UtcPreview({ value, timezoneName }: { value: string; timezoneName: string }) {
  const utc = useMemo(() => {
    if (!value) return null
    const date = wallClockToUtcDate(value, timezoneName)
    if (!date) return null
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
      hour12: false,
    }).format(date)
  }, [value, timezoneName])
  if (!utc) return null
  return <span className="tabular-nums">{utc} UTC</span>
}

export interface AdSetFormFieldsProps {
  value: CampaignFormState
  onChange: (updates: Partial<CampaignFormState>) => void
  mode: "create" | "edit"
  pixels: PixelOption[]
  pixelsLoading: boolean
  currency: string
  timezoneName?: string
  invalidFields?: Set<string>
  advertisers?: AdvertiserEntity[]
}

export function AdSetFormFields({
  value,
  onChange,
  mode,
  pixels,
  pixelsLoading,
  currency,
  timezoneName,
  invalidFields = new Set(),
  advertisers = [],
}: AdSetFormFieldsProps) {
  const options = performanceOptions(value.objective)
  const budgetStep = ZERO_DECIMAL_CURRENCIES.has(currency?.toUpperCase()) ? "1" : "0.01"

  const addCountry = (code: string) => {
    if (!value.locations.includes(code)) onChange({ locations: [...value.locations, code] })
  }
  const removeCountry = (code: string) => {
    onChange({ locations: value.locations.filter((item) => item !== code) })
  }

  const fieldCn = (key: string) =>
    cn(
      "mt-1.5 h-9 w-full rounded border bg-white px-3 text-xs outline-none focus:ring-1 dark:bg-background",
      invalidFields.has(key)
        ? "border-red-500 focus:border-red-500 focus:ring-red-200 dark:border-red-500"
        : "border-[#ccd0d5] focus:border-[#1877f2] focus:ring-[#1877f2] dark:border-gray-700"
    )

  return (
    <div className="space-y-6">
      {/* 1. Core & Budget/Schedule */}
      <div className="space-y-4 rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
        <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">
          {mode === "edit" ? "Ad Set Name & Status" : "Ad Set"}
        </h3>

        <div>
          <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
            Ad set name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            aria-invalid={invalidFields.has("adSetName")}
            className={fieldCn("adSetName")}
            value={value.adSetName}
            onChange={(e) => onChange({ adSetName: e.target.value })}
            placeholder="Enter an ad set name"
          />
        </div>

        <div className="border-t border-[#e4e6eb] pt-4 dark:border-gray-800">
          <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
            Daily ad set budget
          </label>
          <div className="relative mt-1.5 max-w-[220px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#65676b]">
              {currency}
            </span>
            <input
              type="number"
              min="1"
              step={budgetStep}
              value={value.dailyBudget}
              onChange={(e) => onChange({ dailyBudget: e.target.value })}
              aria-invalid={invalidFields.has("dailyBudget")}
              className={cn(fieldCn("dailyBudget"), "pl-14 pr-3")}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
              Start date{" "}
              {timezoneName && value.scheduleTimeBasis === "account" && (
                <span className="font-normal text-[#1877f2]">
                  ({timezoneName} · {getUtcOffsetLabel(timezoneName)})
                </span>
              )}
              {value.scheduleTimeBasis === "utc" && (
                <span className="font-normal text-[#1877f2]">(UTC)</span>
              )}
            </label>
            <input
              type="datetime-local"
              value={value.scheduleStart}
              onChange={(e) => onChange({ scheduleStart: e.target.value })}
              className="mt-1.5 h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"
            />
            {timezoneName && value.scheduleStart && value.scheduleTimeBasis === "account" && (
              <p className="mt-1 text-[11px] text-[#65676b]">
                → <UtcPreview value={value.scheduleStart} timezoneName={timezoneName} />
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
              End date{" "}
              {timezoneName && value.scheduleTimeBasis === "account" && (
                <span className="font-normal text-[#1877f2]">
                  ({timezoneName} · {getUtcOffsetLabel(timezoneName)})
                </span>
              )}
              {value.scheduleTimeBasis === "utc" && (
                <span className="font-normal text-[#1877f2]">(UTC)</span>
              )}
            </label>
            <input
              type="datetime-local"
              value={value.scheduleEnd}
              onChange={(e) => onChange({ scheduleEnd: e.target.value })}
              aria-invalid={invalidFields.has("scheduleEnd")}
              className={cn(
                "mt-1.5 h-9 w-full rounded border bg-white px-3 text-xs outline-none dark:bg-background",
                invalidFields.has("scheduleEnd")
                  ? "border-red-500 focus:border-red-500 dark:border-red-500"
                  : "border-[#ccd0d5] focus:border-[#1877f2] dark:border-gray-700"
              )}
            />
            {timezoneName && value.scheduleEnd && value.scheduleTimeBasis === "account" && (
              <p className="mt-1 text-[11px] text-[#65676b]">
                → <UtcPreview value={value.scheduleEnd} timezoneName={timezoneName} />
              </p>
            )}
          </div>
        </div>
        {timezoneName && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#65676b]">
            <span className="inline-flex items-center gap-1.5">
              Time basis:
              <select
                value={value.scheduleTimeBasis}
                onChange={(e) => onChange({ scheduleTimeBasis: e.target.value as "account" | "utc" })}
                className="h-7 rounded border border-[#ccd0d5] bg-white px-2 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"
              >
                <option value="account">Ad account time ({timezoneName})</option>
                <option value="utc">UTC</option>
              </select>
            </span>
            {value.scheduleTimeBasis === "account" && (
              <span>
                now{" "}
                <span className="font-semibold text-[#1c2b33] dark:text-gray-200">
                  <AccountClock timezoneName={timezoneName} />
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* 2. Conversion Settings */}
      <div className="space-y-4 rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
        <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">Conversion</h3>

        <div>
          <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
            Conversion location
          </label>
          <select
            value={value.conversionLocation}
            onChange={(e) => onChange({ conversionLocation: e.target.value as "website" })}
            className="mt-1.5 h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"
          >
            <option value="website">Website</option>
          </select>
        </div>

        <div className="rounded-lg border border-[#e4e6eb] bg-slate-50/50 p-4 dark:border-gray-800 dark:bg-muted/50">
          <div>
            <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
              Performance goal
            </label>
            <select
              value={value.performanceGoal}
              onChange={(e) => onChange({ performanceGoal: e.target.value as PerformanceGoal })}
              className="mt-1.5 h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {value.objective === "OUTCOME_SALES" && (
            <>
              <div className="mt-4">
                <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
                  Pixel <span className="text-red-500">*</span>
                </label>
                <select
                  value={value.pixelId}
                  onChange={(e) => onChange({ pixelId: e.target.value })}
                  aria-invalid={invalidFields.has("pixelId")}
                  className={cn(
                    "mt-1.5 h-9 w-full rounded border bg-white px-3 text-xs outline-none dark:bg-background",
                    invalidFields.has("pixelId")
                      ? "border-red-500 focus:border-red-500 dark:border-red-500"
                      : "border-[#ccd0d5] focus:border-[#1877f2] dark:border-gray-700"
                  )}
                  disabled={pixelsLoading}
                >
                  <option value="">{pixelsLoading ? "Loading Pixels..." : "Select a Pixel"}</option>
                  {pixels.map((pixel) => (
                    <option key={pixel.id} value={pixel.id}>
                      {pixel.name} ({pixel.id})
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-4">
                <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
                  Conversion event
                </label>
                <select
                  value={value.conversionEvent}
                  onChange={(e) => onChange({ conversionEvent: e.target.value as ConversionEvent })}
                  className="mt-1.5 h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"
                >
                  <option value="PURCHASE">Purchase</option>
                  <option value="ADD_TO_CART">Add to cart</option>
                  <option value="INITIATED_CHECKOUT">Initiate checkout</option>
                  <option value="LEAD">Lead</option>
                  <option value="COMPLETE_REGISTRATION">Complete registration</option>
                  <option value="VIEW_CONTENT">View content</option>
                </select>
              </div>
            </>
          )}
        </div>

        <div>
          <label className="text-xs font-semibold text-[#1c2b33] flex items-center justify-between dark:text-gray-200">
            Cost per result goal
            <span className="font-normal text-[#65676b]">Optional</span>
          </label>
          <div className="relative mt-1.5 max-w-[260px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#65676b]">
              {currency}
            </span>
            <input
              type="number"
              min="0"
              step={budgetStep}
              value={value.costPerResultGoal}
              onChange={(e) => onChange({ costPerResultGoal: e.target.value })}
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
          <p className="mt-1 text-[11px] text-[#65676b]">
            Meta will aim to get the most results possible for your budget.
          </p>
        </div>
      </div>

      {/* 3. Attribution Settings */}
      <div className="space-y-4 rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
        <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">Attribution Setting</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium uppercase tracking-wider text-[#65676b]">
            Click
            <select
              value={value.attributionClickDays}
              onChange={(e) => onChange({ attributionClickDays: e.target.value as "1" | "7" })}
              className="mt-1.5 h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs font-normal text-[#1c2b33] outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background dark:text-gray-200"
            >
              <option value="1">1 day</option>
              <option value="7">7 days</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-wider text-[#65676b]">
            View
            <select
              value={value.attributionViewDays}
              onChange={(e) => onChange({ attributionViewDays: e.target.value as "0" | "1" })}
              className="mt-1.5 h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs font-normal text-[#1c2b33] outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background dark:text-gray-200"
            >
              <option value="0">None</option>
              <option value="1">1 day</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-wider text-[#65676b]">
            Engaged-view
            <select
              value={value.mediaType === "video" && value.performanceGoal === "OFFSITE_CONVERSIONS" ? value.attributionEngagedViewDays : "0"}
              disabled={value.mediaType !== "video" || value.performanceGoal !== "OFFSITE_CONVERSIONS"}
              onChange={(e) => onChange({ attributionEngagedViewDays: e.target.value as "0" | "1" })}
              title={
                value.mediaType !== "video"
                  ? "Engaged-view attribution is available for video ads only"
                  : value.performanceGoal !== "OFFSITE_CONVERSIONS"
                    ? "Engaged-view attribution is not enabled for this performance goal"
                    : undefined
              }
              className="mt-1.5 h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs font-normal text-[#1c2b33] outline-none focus:border-[#1877f2] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:border-gray-700 dark:bg-background dark:text-gray-200 dark:disabled:bg-slate-900 dark:disabled:text-slate-500"
            >
              <option value="0">None</option>
              <option value="1">1 day</option>
            </select>
          </label>
        </div>
        <p className="mt-2 text-[11px] text-[#65676b]">
          Settings currently default to 7-day click and 1-day view. This determines how conversions are attributed and optimizes delivery.
        </p>
      </div>

      {/* 4. Audience */}
      <div className="space-y-5 rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">Audience</h3>
          <span className="flex items-center gap-1 rounded border border-purple-100 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 dark:border-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
            Advantage+ Audience
          </span>
        </div>

        {/* Custom Audiences */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
            Custom Audiences
          </label>
          {mode === "edit" && <div className="mb-2 flex flex-wrap gap-2">
            {value.customAudiences.map((ca) => (
              <span
                key={ca.id}
                className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {ca.name}
                <button
                  type="button"
                  onClick={() =>
                    onChange({ customAudiences: value.customAudiences.filter((c) => c.id !== ca.id) })
                  }
                  className="text-slate-400 hover:text-slate-600"
                  aria-label={`Remove ${ca.name}`}
                >
                  x
                </button>
              </span>
            ))}
          </div>}
          <input
            type="text"
            disabled
            title="Custom audience search is not built yet (BL-62)"
            placeholder="Custom audience search — not available yet"
            className="h-9 w-full cursor-not-allowed rounded border border-[#ccd0d5] bg-slate-50 px-3 text-xs text-slate-400 outline-none dark:border-gray-700 dark:bg-slate-900 dark:text-slate-500"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
            Locations <span className="text-red-500">*</span>
          </label>
          <div
            aria-invalid={invalidFields.has("locations")}
            className={cn(
              "mt-1.5 rounded border bg-white p-2 dark:bg-background",
              invalidFields.has("locations")
                ? "border-red-500 dark:border-red-500"
                : "border-[#ccd0d5] dark:border-gray-700"
            )}
          >
            <div className="mb-2 flex min-h-8 flex-wrap gap-2">
              {value.locations.map((countryCode) => (
                <span
                  key={countryCode}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-[#d1e7ff] bg-[#e7f3ff] px-2.5 py-1 text-xs font-medium text-[#1877f2] dark:border-blue-900 dark:bg-blue-900/30 dark:text-blue-400"
                >
                  {countryCode}
                  <button
                    type="button"
                    onClick={() => removeCountry(countryCode)}
                    className="flex size-4 items-center justify-center rounded-full hover:bg-[#d1e7ff] dark:hover:bg-blue-800"
                    aria-label={`Remove ${countryCode}`}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) addCountry(e.target.value)
              }}
              className="h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"
            >
              <option value="">Add country...</option>
              {COUNTRIES.filter((country) => !value.locations.includes(country.code)).map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name} ({country.code})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">Age</label>
            <div className="mt-1.5 flex items-center gap-2">
              <select
                value={value.ageMin}
                onChange={(e) => onChange({ ageMin: Number(e.target.value) })}
                aria-invalid={invalidFields.has("ageRange")}
                className={cn(
                  "h-9 flex-1 rounded border bg-white px-2 text-xs outline-none dark:bg-background",
                  invalidFields.has("ageRange")
                    ? "border-red-500 dark:border-red-500"
                    : "border-[#ccd0d5] focus:border-[#1877f2] dark:border-gray-700"
                )}
              >
                {Array.from({ length: 48 }, (_, i) => i + 18).map((age) => (
                  <option key={age} value={age}>
                    {age}
                  </option>
                ))}
              </select>
              <span className="text-xs text-[#65676b]">to</span>
              <select
                value={value.ageMax}
                onChange={(e) => onChange({ ageMax: Number(e.target.value) })}
                aria-invalid={invalidFields.has("ageRange")}
                className={cn(
                  "h-9 flex-1 rounded border bg-white px-2 text-xs outline-none dark:bg-background",
                  invalidFields.has("ageRange")
                    ? "border-red-500 dark:border-red-500"
                    : "border-[#ccd0d5] focus:border-[#1877f2] dark:border-gray-700"
                )}
              >
                {Array.from({ length: 48 }, (_, i) => i + 18).map((age) => (
                  <option key={age} value={age}>
                    {age === 65 ? "65+" : age}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">Gender</label>
            <select
              value={value.gender}
              onChange={(e) => onChange({ gender: e.target.value as CampaignFormState["gender"] })}
              className="mt-1.5 h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"
            >
              <option value="ALL">All genders</option>
              <option value="MALE">Men</option>
              <option value="FEMALE">Women</option>
            </select>
          </div>
        </div>

        {/* Detailed Targeting */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
            Detailed Targeting
          </label>
          {mode === "edit" && <div className="mb-2 flex flex-wrap gap-2">
            {value.detailedTargeting.map((dt) => (
              <span
                key={dt.id}
                className="inline-flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/30 dark:text-blue-400"
              >
                {dt.name}
                <button
                  type="button"
                  onClick={() =>
                    onChange({ detailedTargeting: value.detailedTargeting.filter((t) => t.id !== dt.id) })
                  }
                  className="text-blue-400 hover:text-blue-600"
                  aria-label={`Remove ${dt.name}`}
                >
                  x
                </button>
              </span>
            ))}
          </div>}
          <input
            type="text"
            disabled
            title="Detailed targeting search is not built yet (BL-62)"
            placeholder="Demographics, interests, behaviors — not available yet"
            className="h-9 w-full cursor-not-allowed rounded border border-[#ccd0d5] bg-slate-50 px-3 text-xs text-slate-400 outline-none dark:border-gray-700 dark:bg-slate-900 dark:text-slate-500"
          />

          <div className="mt-3 flex items-start gap-2 rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-muted/50">
            <input
              type="checkbox"
              id={`targetingExpansion-${mode}`}
              checked={value.targetingExpansion}
              onChange={(e) => onChange({ targetingExpansion: e.target.checked })}
              className="mt-0.5 rounded border-slate-300 text-[#1877f2] focus:ring-[#1877f2]"
            />
            <label
              htmlFor={`targetingExpansion-${mode}`}
              className="text-xs text-slate-700 dark:text-slate-300"
            >
              <span className="block font-medium">Advantage detailed targeting</span>
              <span className="mt-0.5 block text-slate-500">
                Reach people beyond your detailed targeting selections when it&apos;s likely to improve performance.
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* 5. Placements */}
      <div className="space-y-4 rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
        <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">Placements</h3>

        <div className="space-y-3">
          <label
            className={cn(
              "relative flex cursor-pointer items-start rounded-lg border-2 p-4 transition-colors",
              value.placementMode === "advantage"
                ? "border-[#1877f2] bg-[#e3f0fe]/30 dark:border-blue-600 dark:bg-blue-900/20"
                : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800"
            )}
          >
            <input
              type="radio"
              name={`placementMode-${mode}`}
              value="advantage"
              checked={value.placementMode === "advantage"}
              onChange={() => onChange({ placementMode: "advantage" })}
              className="mt-0.5 text-[#1877f2] focus:ring-[#1877f2]"
            />
            <div className="ml-3">
              <span className="block text-xs font-semibold text-slate-900 dark:text-slate-100">
                Advantage+ placements (Recommended)
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Meta&apos;s delivery system allocates budget across placements where they&apos;re likely to perform best.
              </span>
            </div>
          </label>

          <label
            className={cn(
              "relative flex cursor-pointer items-start rounded-lg border-2 p-4 transition-colors",
              value.placementMode === "manual"
                ? "border-slate-300 bg-white dark:border-slate-700 dark:bg-card"
                : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800"
            )}
          >
            <input
              type="radio"
              name={`placementMode-${mode}`}
              value="manual"
              checked={value.placementMode === "manual"}
              onChange={() => onChange({ placementMode: "manual" })}
              className="mt-0.5 text-[#1877f2] focus:ring-[#1877f2]"
            />
            <div className="ml-3 w-full">
              <span className="block text-xs font-medium text-slate-900 dark:text-slate-100">
                Manual placements
              </span>
              <span className="mt-0.5 mb-3 block text-xs text-slate-500">
                Manually choose where your ads appear.
              </span>

              <div
                className={cn(
                  "grid grid-cols-2 gap-3 transition-opacity",
                  value.placementMode === "advantage" && "pointer-events-none opacity-50"
                )}
              >
                {(["facebook", "instagram", "audience_network", "messenger"] as PublisherPlatform[]).map(
                  (platform) => (
                    <label key={platform} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={value.publisherPlatforms.includes(platform)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            onChange({ publisherPlatforms: [...value.publisherPlatforms, platform] })
                          } else {
                            onChange({
                              publisherPlatforms: value.publisherPlatforms.filter((p) => p !== platform),
                            })
                          }
                        }}
                        className="rounded border-slate-300 text-[#1877f2] focus:ring-[#1877f2]"
                      />
                      <span className="text-xs font-medium capitalize text-slate-700 dark:text-slate-300">
                        {platform.replace("_", " ")}
                      </span>
                    </label>
                  )
                )}
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* 6. Ad Transparency */}
      <div className="space-y-4 rounded-lg border border-[#e4e6eb] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-card">
        <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">Ad Transparency</h3>
        <p className="text-[11px] text-[#65676b]">
          Required for certain locations. Select a Page or Business as the Advertiser and Payer of record.
        </p>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
              Advertiser (selected locations)
            </label>
            <select
              value={value.advertiser ? `${value.advertiser.type}:${value.advertiser.id}` : ""}
              onChange={(e) => {
                const found = advertisers.find((a) => a && `${a.type}:${a.id}` === e.target.value)
                onChange({ advertiser: found ?? null })
              }}
              className="mt-1.5 h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"
            >
              <option value="">Select Advertiser...</option>
              {advertisers.filter(Boolean).map((a) => (
                <option key={`adv-${a!.id}`} value={`${a!.type}:${a!.id}`}>
                  {a!.name} ({a!.type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
              Payer (selected locations)
            </label>
            <select
              value={value.payer ? `${value.payer.type}:${value.payer.id}` : ""}
              onChange={(e) => {
                const found = advertisers.find((a) => a && `${a.type}:${a.id}` === e.target.value)
                onChange({ payer: found ?? null })
              }}
              className="mt-1.5 h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"
            >
              <option value="">Select Payer...</option>
              {advertisers.filter(Boolean).map((a) => (
                <option key={`pay-${a!.id}`} value={`${a!.type}:${a!.id}`}>
                  {a!.name} ({a!.type})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
