"use client"

import { useEffect, useMemo, useState } from "react"
import { getUtcOffsetLabel, wallClockToUtcDate } from "@/lib/timezone"
import { cn } from "@/lib/utils"
import {
  conversionLocationsFor,
  engagementTypesFor,
  performanceGoalsFor,
  resolveOdaxRow,
} from "@/lib/odax-matrix"
import {
  AdvertiserEntity,
  CampaignFormState,
  ConversionEvent,
  ConversionLocation,
  EngagementType,
  PerformanceGoal,
  PixelOption,
  PublisherPlatform,
} from "./types"
import { COUNTRIES, ZERO_DECIMAL_CURRENCIES } from "./adset-options"
import { BidStrategySection } from "./BidStrategySection"
import { BID_STRATEGY_LABEL, isBidStrategy, type BidStrategy } from "@/lib/create-campaign-bidding"
import { EditableCard, EditableField } from "./EditableField"

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

const CONVERSION_EVENT_LABELS: Record<ConversionEvent, string> = {
  PURCHASE: "Purchase",
  ADD_TO_CART: "Add to cart",
  INITIATED_CHECKOUT: "Initiate checkout",
  LEAD: "Lead",
  COMPLETE_REGISTRATION: "Complete registration",
  VIEW_CONTENT: "View content",
}

function formatDateTime(value: string) {
  if (!value) return ""
  return value.replace("T", " ")
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
  /**
   * Collapse every row to a read-only line with a pencil (PRD §6.5). Opt-in: the shipped
   * `EditAdSetDrawer` keeps the expanded layout until it is redesigned on its own ticket.
   */
  readOnlyFields?: boolean
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
  readOnlyFields = false,
}: AdSetFormFieldsProps) {
  const budgetStep = ZERO_DECIMAL_CURRENCIES.has(currency?.toUpperCase()) ? "1" : "0.01"

  // Every conditional below is derived from the one ODAX table the route also reads, so a
  // dropdown can never offer a combination `buildDeliveryFields` would reject.
  const locationOptions = conversionLocationsFor(value.objective)
  const engagementOptions = engagementTypesFor(value.objective, value.conversionLocation)
  const goalOptions = performanceGoalsFor(
    value.objective,
    value.conversionLocation,
    value.engagementType
  )
  const odaxRow = resolveOdaxRow(value.objective, value.conversionLocation, value.engagementType)
  const needsPixel = Boolean(odaxRow?.requiresPixel)
  const allowsCostCap = odaxRow?.allowsCostCap !== false
  const activeStrategy: BidStrategy = isBidStrategy(value.campaignBidStrategy)
    ? value.campaignBidStrategy
    : "LOWEST_COST_WITHOUT_CAP"
  const capStrategyActive =
    activeStrategy === "COST_CAP" || activeStrategy === "LOWEST_COST_WITH_BID_CAP"
  // Switching to a goal that cannot take a cost cap must drop the strategy and its value too, not
  // just hide the input — a hidden field the route still rejects is worse than a visible one.
  useEffect(() => {
    if (allowsCostCap) return
    if (capStrategyActive) {
      onChange({ campaignBidStrategy: "LOWEST_COST_WITHOUT_CAP", costPerResultGoal: "" })
    } else if (value.costPerResultGoal) {
      onChange({ costPerResultGoal: "" })
    }
  }, [allowsCostCap, capStrategyActive, value.costPerResultGoal, onChange])

  const addCountry = (code: string) => {
    if (!value.locations.includes(code)) onChange({ locations: [...value.locations, code] })
  }
  const removeCountry = (code: string) => {
    onChange({ locations: value.locations.filter((item) => item !== code) })
  }

  const restore = (snapshot: CampaignFormState) => onChange(snapshot)

  const fieldCn = (key: string) =>
    cn(
      "mt-1.5 h-9 w-full rounded border bg-white px-3 text-xs outline-none focus:ring-1 dark:bg-background",
      invalidFields.has(key)
        ? "border-red-500 focus:border-red-500 focus:ring-red-200 dark:border-red-500"
        : "border-[#ccd0d5] focus:border-[#1877f2] focus:ring-[#1877f2] dark:border-gray-700"
    )
  const selectCn =
    "mt-1.5 h-9 w-full rounded border border-[#ccd0d5] bg-white px-3 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"

  const cardProps = { readOnly: readOnlyFields, snapshot: value, onRestore: restore }

  const attributionSummary = [
    `${value.attributionClickDays}-day click`,
    value.attributionViewDays === "1" ? "1-day view" : null,
    value.mediaType === "video" &&
    value.performanceGoal === "OFFSITE_CONVERSIONS" &&
    value.attributionEngagedViewDays === "1"
      ? "1-day engaged-view"
      : null,
  ]
    .filter(Boolean)
    .join(", ")

  const placementSummary =
    value.placementMode === "advantage"
      ? "Advantage+ placements"
      : value.publisherPlatforms.length > 0
        ? `Manual — ${value.publisherPlatforms.map((p) => p.replace("_", " ")).join(", ")}`
        : "Manual — no platform selected"

  return (
    <div className="space-y-5">
      {/* 1. Ad set name, budget, schedule */}
      <EditableCard title={mode === "edit" ? "Ad Set Name & Status" : "Ad Set"} {...cardProps}>
        <EditableField
          id="adSetName"
          label="Ad set name"
          required
          always
          display={value.adSetName}
          placeholder="Not set"
          invalid={invalidFields.has("adSetName")}
        >
          <input
            type="text"
            aria-invalid={invalidFields.has("adSetName")}
            className={fieldCn("adSetName")}
            value={value.adSetName}
            onChange={(e) => onChange({ adSetName: e.target.value })}
            placeholder="Enter an ad set name"
          />
        </EditableField>

        {/* Advantage campaign budget moves the budget to the campaign; the ad set value is not
            sent, so the input is not shown (create-campaign-flow.html §10). */}
        {value.advantageCampaignBudget ? (
          <EditableField
            id="dailyBudgetLocked"
            label="Daily ad set budget"
            // On the attach branch the amount lives on a campaign we did not read a budget from,
            // so quoting this form's number would state a figure that is not the campaign's.
            display={
              value.existingCampaignId
                ? "Set at campaign level by the existing campaign"
                : `Set at campaign level — ${currency} ${value.campaignBudget}`
            }
            lockedReason="Advantage campaign budget is on; Meta distributes the campaign budget across ad sets."
          >
            <div />
          </EditableField>
        ) : (
          <EditableField
            id="dailyBudget"
            label="Daily ad set budget"
            always
            display={value.dailyBudget ? `${currency} ${value.dailyBudget}` : ""}
            invalid={invalidFields.has("dailyBudget")}
          >
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
          </EditableField>
        )}

        <EditableField
          id="scheduleStart"
          label="Start date"
          always
          display={
            value.scheduleStart ? (
              <span>
                {formatDateTime(value.scheduleStart)}
                {timezoneName && value.scheduleTimeBasis === "account" && (
                  <span className="ml-1.5 text-[#a0a4ab]">
                    ({timezoneName} · {getUtcOffsetLabel(timezoneName)})
                  </span>
                )}
                {value.scheduleTimeBasis === "utc" && <span className="ml-1.5 text-[#a0a4ab]">(UTC)</span>}
              </span>
            ) : (
              ""
            )
          }
          placeholder="Start running immediately"
        >
          <input
            type="datetime-local"
            value={value.scheduleStart}
            onChange={(e) => onChange({ scheduleStart: e.target.value })}
            className={selectCn}
          />
          {timezoneName && value.scheduleStart && value.scheduleTimeBasis === "account" && (
            <p className="mt-1 text-[11px] text-[#65676b]">
              → <UtcPreview value={value.scheduleStart} timezoneName={timezoneName} />
            </p>
          )}
        </EditableField>

        <EditableField
          id="scheduleEnd"
          label="End date"
          always
          display={value.scheduleEnd ? formatDateTime(value.scheduleEnd) : ""}
          placeholder="No end date"
          invalid={invalidFields.has("scheduleEnd")}
        >
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
        </EditableField>

        {timezoneName && (
          <EditableField
            id="scheduleTimeBasis"
            label="Time basis"
            display={
              value.scheduleTimeBasis === "utc" ? (
                "UTC"
              ) : (
                <span>
                  Ad account time ({timezoneName}) · now{" "}
                  <span className="font-semibold text-[#1c2b33] dark:text-gray-200">
                    <AccountClock timezoneName={timezoneName} />
                  </span>
                </span>
              )
            }
          >
            <select
              value={value.scheduleTimeBasis}
              onChange={(e) => onChange({ scheduleTimeBasis: e.target.value as "account" | "utc" })}
              className={selectCn}
            >
              <option value="account">Ad account time ({timezoneName})</option>
              <option value="utc">UTC</option>
            </select>
          </EditableField>
        )}
      </EditableCard>

      {/* 2. Conversion — the ODAX chain */}
      <EditableCard
        title={locationOptions.length > 0 ? "Conversion" : "Optimization & delivery"}
        {...cardProps}
      >
        {locationOptions.length > 0 && (
          <EditableField
            id="conversionLocation"
            label="Conversion location"
            required
            always
            display={odaxRow?.conversionLocationLabel}
            hint="Choose where you want to drive traffic. You'll enter more details later."
          >
            <select
              value={value.conversionLocation ?? ""}
              onChange={(e) => onChange({ conversionLocation: e.target.value as ConversionLocation })}
              className={selectCn}
            >
              {locationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </EditableField>
        )}

        {engagementOptions.length > 0 && (
          <EditableField
            id="engagementType"
            label="Engagement type"
            required
            always
            display={odaxRow?.engagementTypeLabel}
          >
            <select
              value={value.engagementType ?? ""}
              onChange={(e) => onChange({ engagementType: e.target.value as EngagementType })}
              className={selectCn}
            >
              {engagementOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </EditableField>
        )}

        <EditableField
          id="performanceGoal"
          label="Performance goal"
          required
          always
          display={goalOptions.find((option) => option.value === value.performanceGoal)?.label}
        >
          <select
            value={value.performanceGoal}
            onChange={(e) => onChange({ performanceGoal: e.target.value as PerformanceGoal })}
            className={selectCn}
          >
            {goalOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </EditableField>

        {needsPixel && (
          <>
            <EditableField
              id="pixelId"
              label="Pixel"
              required
              always
              display={pixels.find((pixel) => pixel.id === value.pixelId)?.name}
              placeholder={pixelsLoading ? "Loading Pixels…" : "Select a Pixel"}
              invalid={invalidFields.has("pixelId")}
            >
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
            </EditableField>

            <EditableField
              id="conversionEvent"
              label="Conversion event"
              always
              display={CONVERSION_EVENT_LABELS[value.conversionEvent]}
            >
              <select
                value={value.conversionEvent}
                onChange={(e) => onChange({ conversionEvent: e.target.value as ConversionEvent })}
                className={selectCn}
              >
                {(Object.keys(CONVERSION_EVENT_LABELS) as ConversionEvent[]).map((event) => (
                  <option key={event} value={event}>
                    {CONVERSION_EVENT_LABELS[event]}
                  </option>
                ))}
              </select>
            </EditableField>
          </>
        )}

        {/* Under CBO the campaign owns the strategy — Campaign level renders the picker instead, and
            the route still lands the cap value on this ad set. */}
        {!value.advantageCampaignBudget && (
          <EditableField
            id="bidStrategy"
            label="Bid strategy"
            display={`${BID_STRATEGY_LABEL[activeStrategy]}${
              value.costPerResultGoal ? ` · ${currency} ${value.costPerResultGoal}` : ""
            }`}
            hint="The bid strategy sits on whichever level owns the budget."
            invalid={invalidFields.has("costPerResultGoal")}
          >
            <BidStrategySection
              strategy={value.campaignBidStrategy}
              costPerResultGoal={value.costPerResultGoal}
              onChange={onChange}
              currency={currency}
              budgetStep={budgetStep}
              invalidFields={invalidFields}
              allowsCostCap={allowsCostCap}
            />
          </EditableField>
        )}
      </EditableCard>

      {/* 3. Attribution */}
      <EditableCard title="Attribution Setting" {...cardProps}>
        <EditableField
          id="attribution"
          label="Attribution setting"
          display={attributionSummary}
          hint="This determines how conversions are attributed and optimizes delivery."
        >
          <div className="mt-1.5 grid gap-3 sm:grid-cols-3">
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
                value={
                  value.mediaType === "video" && value.performanceGoal === "OFFSITE_CONVERSIONS"
                    ? value.attributionEngagedViewDays
                    : "0"
                }
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
        </EditableField>
      </EditableCard>

      {/* 4. Audience */}
      <EditableCard
        title="Audience"
        {...cardProps}
        headerRight={
          value.targetingExpansion ? (
            <span className="flex items-center gap-1 rounded border border-purple-100 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 dark:border-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
              Advantage+ Audience
            </span>
          ) : null
        }
      >
        <EditableField
          id="customAudiences"
          label="Custom Audiences"
          display={
            value.customAudiences.length > 0
              ? value.customAudiences.map((audience) => audience.name).join(", ")
              : ""
          }
          placeholder="None"
          lockedReason="Custom audience search is not built yet (BL-62)"
        >
          <div className="mt-1.5">
            {value.customAudiences.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {value.customAudiences.map((ca) => (
                  <span
                    key={ca.id}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {ca.name}
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          customAudiences: value.customAudiences.filter((c) => c.id !== ca.id),
                        })
                      }
                      className="text-slate-400 hover:text-slate-600"
                      aria-label={`Remove ${ca.name}`}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              disabled
              title="Custom audience search is not built yet (BL-62)"
              placeholder="Custom audience search — not available yet"
              className="h-9 w-full cursor-not-allowed rounded border border-[#ccd0d5] bg-slate-50 px-3 text-xs text-slate-400 outline-none dark:border-gray-700 dark:bg-slate-900 dark:text-slate-500"
            />
          </div>
        </EditableField>

        <EditableField
          id="locations"
          label="Locations"
          required
          always
          display={value.locations.join(", ")}
          placeholder="No country selected"
          invalid={invalidFields.has("locations")}
        >
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
        </EditableField>

        <EditableField
          id="ageRange"
          label="Age"
          always
          display={`${value.ageMin} – ${value.ageMax === 65 ? "65+" : value.ageMax}`}
          invalid={invalidFields.has("ageRange")}
        >
          <div className="mt-1.5 flex max-w-[260px] items-center gap-2">
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
        </EditableField>

        <EditableField
          id="gender"
          label="Gender"
          display={
            value.gender === "ALL" ? "All genders" : value.gender === "MALE" ? "Men" : "Women"
          }
        >
          <select
            value={value.gender}
            onChange={(e) => onChange({ gender: e.target.value as CampaignFormState["gender"] })}
            className={cn(selectCn, "max-w-[260px]")}
          >
            <option value="ALL">All genders</option>
            <option value="MALE">Men</option>
            <option value="FEMALE">Women</option>
          </select>
        </EditableField>

        <EditableField
          id="detailedTargeting"
          label="Detailed Targeting"
          display={
            value.detailedTargeting.length > 0
              ? value.detailedTargeting.map((item) => item.name).join(", ")
              : ""
          }
          placeholder="None"
          lockedReason="Detailed targeting search is not built yet (BL-62)"
        >
          <div className="mt-1.5">
            {value.detailedTargeting.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {value.detailedTargeting.map((dt) => (
                  <span
                    key={dt.id}
                    className="inline-flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/30 dark:text-blue-400"
                  >
                    {dt.name}
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          detailedTargeting: value.detailedTargeting.filter((t) => t.id !== dt.id),
                        })
                      }
                      className="text-blue-400 hover:text-blue-600"
                      aria-label={`Remove ${dt.name}`}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              disabled
              title="Detailed targeting search is not built yet (BL-62)"
              placeholder="Demographics, interests, behaviors — not available yet"
              className="h-9 w-full cursor-not-allowed rounded border border-[#ccd0d5] bg-slate-50 px-3 text-xs text-slate-400 outline-none dark:border-gray-700 dark:bg-slate-900 dark:text-slate-500"
            />
          </div>
        </EditableField>

        <EditableField
          id="targetingExpansion"
          label="Advantage detailed targeting"
          display={value.targetingExpansion ? "On" : "Off"}
          hint="Reach people beyond your detailed targeting selections when it's likely to improve performance."
        >
          <div className="mt-1.5 flex items-start gap-2 rounded border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-background">
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
                Reach people beyond your detailed targeting selections when it&apos;s likely to improve
                performance.
              </span>
            </label>
          </div>
        </EditableField>
      </EditableCard>

      {/* 5. Placements */}
      <EditableCard title="Placements" {...cardProps}>
        <EditableField id="placements" label="Placements" display={placementSummary}>
          <div className="mt-1.5 space-y-3">
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
                  Meta&apos;s delivery system allocates budget across placements where they&apos;re likely
                  to perform best.
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
                                publisherPlatforms: value.publisherPlatforms.filter(
                                  (p) => p !== platform
                                ),
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
        </EditableField>
      </EditableCard>

      {/* 6. Ad transparency — publicly visible in the Meta Ad Library */}
      <EditableCard
        title="Ad Transparency"
        subtitle="Required for certain locations. Select a Page or Business as the Advertiser and Payer of record."
        {...cardProps}
      >
        <EditableField
          id="advertiser"
          label="Advertiser (selected locations)"
          display={value.advertiser?.name}
          placeholder="Ad account default"
        >
          <select
            value={value.advertiser ? `${value.advertiser.type}:${value.advertiser.id}` : ""}
            onChange={(e) => {
              const found = advertisers.find((a) => a && `${a.type}:${a.id}` === e.target.value)
              onChange({ advertiser: found ?? null })
            }}
            className={selectCn}
          >
            <option value="">Select Advertiser...</option>
            {advertisers.filter(Boolean).map((a) => (
              <option key={`adv-${a!.id}`} value={`${a!.type}:${a!.id}`}>
                {a!.name} ({a!.type})
              </option>
            ))}
          </select>
        </EditableField>

        <EditableField
          id="payer"
          label="Payer (selected locations)"
          display={value.payer?.name}
          placeholder="Ad account default"
        >
          <select
            value={value.payer ? `${value.payer.type}:${value.payer.id}` : ""}
            onChange={(e) => {
              const found = advertisers.find((a) => a && `${a.type}:${a.id}` === e.target.value)
              onChange({ payer: found ?? null })
            }}
            className={selectCn}
          >
            <option value="">Select Payer...</option>
            {advertisers.filter(Boolean).map((a) => (
              <option key={`pay-${a!.id}`} value={`${a!.type}:${a!.id}`}>
                {a!.name} ({a!.type})
              </option>
            ))}
          </select>
        </EditableField>
      </EditableCard>
    </div>
  )
}
