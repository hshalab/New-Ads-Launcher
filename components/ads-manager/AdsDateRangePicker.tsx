"use client"

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { IconCalendar, IconChevronDown, IconChevronLeft, IconChevronRight } from "@tabler/icons-react"

// ─── Presets (matches Facebook API date_preset values) ────────────────────────

export const DATE_PICKER_PRESETS = [
  { value: "today",       label: "Today"         },
  { value: "yesterday",   label: "Yesterday"     },
  { value: "last_7d",     label: "Last 7 days"   },
  { value: "last_14d",    label: "Last 14 days"  },
  { value: "last_30d",    label: "Last 30 days"  },
  { value: "last_90d",    label: "Last 90 days"  },
  { value: "this_week",   label: "This week"     },
  { value: "this_month",  label: "This month"    },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_month",  label: "Last month"    },
  { value: "this_year",   label: "Year to date"  },
  { value: "last_year",   label: "Last year"     },
  { value: "maximum",     label: "Maximum"       },
]

// Meta Insights rejects any window whose start is more than 37 months before today.
// "Maximum" must respect that floor — showing the account's real created_time as the
// start would display a range the API cannot fulfil (returns "Invalid time range").
const META_INSIGHTS_MAX_LOOKBACK_MONTHS = 37

function metaInsightsFloor(today: Date, months: number): Date {
  const floor = new Date(today)
  floor.setMonth(floor.getMonth() - months)
  floor.setHours(0, 0, 0, 0)
  return floor
}

export function getPresetRange(
  preset: string,
  maximumStart?: Date,
  maximumLookbackMonths: number | null = META_INSIGHTS_MAX_LOOKBACK_MONTHS,
): { start: Date; end: Date } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = (n: number) => { const x = new Date(today); x.setDate(x.getDate() + n); return x }
  switch (preset) {
    case "maximum": {
      if (maximumLookbackMonths === null) return { start: maximumStart ?? new Date(1970, 0, 1), end: today }
      const floor = metaInsightsFloor(today, maximumLookbackMonths)
      const raw = maximumStart ?? floor
      return { start: raw < floor ? floor : raw, end: today }
    }
    case "today":      return { start: today,   end: today }
    case "yesterday":  return { start: d(-1),   end: d(-1) }
    case "last_7d":    return { start: d(-6),   end: today }
    case "last_14d":   return { start: d(-13),  end: today }
    case "last_30d":   return { start: d(-29),  end: today }
    case "last_90d":   return { start: d(-89),  end: today }
    case "this_week":  return { start: d(-((today.getDay() + 6) % 7)), end: today }
    case "this_month": return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today }
    case "this_quarter": return { start: new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1), end: today }
    case "last_month": {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const e = new Date(today.getFullYear(), today.getMonth(), 0)
      return { start: s, end: e }
    }
    case "this_year":  return { start: new Date(today.getFullYear(), 0, 1), end: today }
    case "last_year": {
      const s = new Date(today.getFullYear() - 1, 0, 1)
      const e = new Date(today.getFullYear() - 1, 11, 31)
      return { start: s, end: e }
    }
    default:           return { start: d(-6),   end: today }
  }
}

function fmt(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function fmtInput(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

// ─── Calendar grid ────────────────────────────────────────────────────────────

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"]
const DAYS   = ["Su","Mo","Tu","We","Th","Fr","Sa"]

function todayMidnight() {
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return t
}

function CalGrid({
  year, month, startDate, endDate, hoverDate, onDay, onHover,
}: {
  year: number; month: number
  startDate: Date | null; endDate: Date | null; hoverDate: Date | null
  onDay: (d: Date) => void
  onHover: (d: Date | null) => void
}) {
  const firstDow   = new Date(year, month, 1).getDay()
  const daysInMo   = new Date(year, month + 1, 0).getDate()
  const todayDate  = todayMidnight()
  const effEnd     = endDate ?? hoverDate

  const dayClass = (d: Date) => {
    const sel     = (startDate && sameDay(d, startDate)) || (effEnd && sameDay(d, effEnd))
    const inRange = (() => {
      if (!startDate || !effEnd) return false
      const [lo, hi] = startDate <= effEnd ? [startDate, effEnd] : [effEnd, startDate]
      return d > lo && d < hi
    })()
    const isStart = !!(startDate && sameDay(d, startDate))
    const isEnd   = !!(effEnd && sameDay(d, effEnd))
    const isToday = sameDay(d, todayDate)

    if (sel) {
      return cn(
        "bg-[#1877f2] text-white font-semibold z-10 relative",
        isStart && effEnd && !sameDay(startDate!, effEnd) && "rounded-l-full",
        isEnd   && startDate && !sameDay(startDate, effEnd) && "rounded-r-full",
        (!effEnd || sameDay(startDate!, effEnd)) && "rounded-full"
      )
    }
    if (inRange) return "bg-[#e7f3ff] text-[#1877f2]"
    if (isToday) return "border border-[#1877f2] text-[#1877f2] font-semibold rounded-full"
    return "text-[#1c2b33] dark:text-foreground hover:bg-muted/50 rounded-full"
  }

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMo }, (_, i) => i + 1),
  ]

  return (
    <div className="w-[210px] select-none">
      <p className="text-center text-xs font-semibold mb-3 text-[#1c2b33] dark:text-white">
        {MONTHS[month]} {year}
      </p>
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] text-muted-foreground font-medium uppercase py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />
          const date = new Date(year, month, day)
          const isFuture = date > todayDate
          return (
            <div
              key={i}
              onClick={() => { if (!isFuture) onDay(date) }}
              onMouseEnter={() => { if (!isFuture) onHover(date) }}
              onMouseLeave={() => onHover(null)}
              className={cn(
                "h-8 flex items-center justify-center text-xs cursor-pointer transition-colors",
                isFuture && "text-muted-foreground/30 pointer-events-none",
                dayClass(date)
              )}
            >
              {day}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main picker ──────────────────────────────────────────────────────────────

interface Props {
  preset: string
  customStart?: Date
  customEnd?: Date
  accountId?: string
  onChange: (preset: string, customStart?: Date, customEnd?: Date) => void
  /** Always show the panel (no trigger button). Used when parent owns the open state. */
  inline?: boolean
  /** Apply on preset click / completed custom range; hide Apply button. */
  autoApply?: boolean
  /** Hide the selected range label on the trigger button. */
  hideLabel?: boolean
  /** Include an "All time" preset that emits empty string (Assets filter). */
  allowAllTime?: boolean
  allTimeLabel?: string
  onClose?: () => void
  timezoneLabel?: string
  maximumLookbackMonths?: number | null
}

type Mode = "preset" | "custom"

const PANEL_W = 600
const PANEL_MARGIN = 8

export function AdsDateRangePicker({
  preset, customStart, customEnd, accountId, onChange,
  inline = false, autoApply = false, hideLabel = false,
  allowAllTime = false, allTimeLabel = "All time", onClose, timezoneLabel,
  maximumLookbackMonths = META_INSIGHTS_MAX_LOOKBACK_MONTHS,
}: Props) {
  const [maxStart, setMaxStart] = useState<Date | null>(null)
  const [open,        setOpen]        = useState(inline)
  // pending mode + selection (not applied until Apply, unless autoApply)
  const [mode,        setMode]        = useState<Mode>(preset === "custom" ? "custom" : "preset")
  const [pending,     setPending]     = useState(preset === "custom" ? "" : preset)
  const [rangeStart,  setRangeStart]  = useState<Date | null>(null)
  const [rangeEnd,    setRangeEnd]    = useState<Date | null>(null)
  const [hoverDate,   setHoverDate]   = useState<Date | null>(null)
  const [leftYear,    setLeftYear]    = useState(new Date().getFullYear())
  const [leftMonth,   setLeftMonth]   = useState(new Date().getMonth())
  const [panelPos,    setPanelPos]    = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const placePanel = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Prefer right-align under trigger; clamp so full panel stays in viewport.
    let left = r.right - PANEL_W
    if (left < PANEL_MARGIN) left = PANEL_MARGIN
    if (left + PANEL_W > vw - PANEL_MARGIN) left = Math.max(PANEL_MARGIN, vw - PANEL_W - PANEL_MARGIN)
    let top = r.bottom + 4
    // Flip above if not enough room below (panel ~420px tall).
    if (top + 420 > vh - PANEL_MARGIN && r.top > 420) {
      top = Math.max(PANEL_MARGIN, r.top - 420 - 4)
    }
    setPanelPos({ top, left })
  }, [])

  useLayoutEffect(() => {
    if (!open || inline) return
    placePanel()
    const onResize = () => placePanel()
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onResize, true)
    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onResize, true)
    }
  }, [open, inline, placePanel])

  const rightYear  = leftMonth === 11 ? leftYear + 1 : leftYear
  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1

  // Sync pending state from props whenever the popover opens.
  useEffect(() => {
    if (!open) return
    if ((preset === "custom" || preset === "maximum") && customStart && customEnd) {
      setMode(preset === "custom" ? "custom" : "preset")
      setPending(preset === "maximum" ? "maximum" : "")
      setRangeStart(customStart)
      setRangeEnd(customEnd)
      setLeftYear(customStart.getFullYear())
      setLeftMonth(customStart.getMonth())
    } else if (preset === "" && allowAllTime) {
      setMode("preset")
      setPending("")
      setRangeStart(null)
      setRangeEnd(null)
    } else {
      setMode("preset")
      setPending(preset)
      const { start, end } = getPresetRange(preset, maxStart ?? undefined, maximumLookbackMonths)
      setRangeStart(start)
      setRangeEnd(end)
      setLeftYear(start.getFullYear())
      setLeftMonth(start.getMonth())
    }
  }, [open]) // eslint-disable-line

  // Reset once the account changes so Maximum refetches this account's own created_time
  // instead of reusing the previous ad account's range.
  useEffect(() => {
    setMaxStart(null)
  }, [accountId])

  // Once account created_time arrives, refresh Maximum range if selected — and push the
  // resolved range up to the parent so it re-queries with the real start, not the 2018
  // placeholder it may have applied before created_time loaded.
  useEffect(() => {
    if (!maxStart) return
    if (pending === "maximum" || preset === "maximum") {
      const { start, end } = getPresetRange("maximum", maxStart, maximumLookbackMonths)
      setRangeStart(start)
      setRangeEnd(end)
      if (preset === "maximum") onChange("maximum", start, end)
    }
  }, [maxStart]) // eslint-disable-line

  useEffect(() => {
    if (!open || inline) return
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setOpen(false)
      onClose?.()
    }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open, inline, onClose])

  // Lazy-fetch the account's created_time so "Maximum" spans from creation to today.
  // Fetch even when the picker is closed if Maximum is already the active preset,
  // so a page load or account switch with Maximum selected does not stay on the
  // 2018 placeholder.
  useEffect(() => {
    if (!accountId || maxStart) return
    const wantFetch = open || preset === "maximum" || pending === "maximum"
    if (!wantFetch) return
    let cancelled = false
    fetch(`/api/facebook/ad-accounts/created-time?ad_account_id=${encodeURIComponent(accountId)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d.created_time) return
        const parsed = new Date(d.created_time)
        if (!isNaN(parsed.getTime())) setMaxStart(parsed)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, accountId, maxStart, preset, pending])

  const closePicker = () => {
    setOpen(false)
    onClose?.()
  }

  const selectPreset = (p: string) => {
    setMode("preset")
    setPending(p)
    if (p === "" && allowAllTime) {
      setRangeStart(null)
      setRangeEnd(null)
      if (autoApply) {
        onChange("")
        closePicker()
      }
      return
    }
    const { start, end } = getPresetRange(p, maxStart ?? undefined, maximumLookbackMonths)
    setRangeStart(start)
    setRangeEnd(end)
    setLeftYear(start.getFullYear())
    setLeftMonth(start.getMonth())
    if (autoApply) {
      if (p === "maximum") onChange("maximum", start, end)
      else onChange(p)
      closePicker()
    }
  }

  const switchToCustom = () => {
    setMode("custom")
    setPending("")
  }

  const handleDay = (d: Date) => {
    const todayDate = todayMidnight()
    if (d > todayDate) return
    setMode("custom")
    setPending("")
    // First click sets start; second click sets end.
    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(d); setRangeEnd(null)
    } else {
      const start = d < rangeStart ? d : rangeStart
      const end = d < rangeStart ? rangeStart : d
      setRangeStart(start)
      setRangeEnd(end)
      if (autoApply) {
        onChange("custom", start, end)
        closePicker()
      }
    }
  }

  const apply = () => {
    if (mode === "preset") {
      // Meta's API doesn't reliably support date_preset=maximum; send the resolved
      // account-created-time range while keeping the UI preset label as Maximum.
      if (pending === "" && allowAllTime) onChange("")
      else if (pending === "maximum" && rangeStart) onChange("maximum", rangeStart, rangeEnd ?? rangeStart)
      else if (pending) onChange(pending)
    } else if (rangeStart) {
      onChange("custom", rangeStart, rangeEnd ?? rangeStart)
    }
    closePicker()
  }

  const reset = () => {
    setMode("preset")
    selectPreset("last_7d")
  }

  const prevMonth = () => {
    if (leftMonth === 0) { setLeftMonth(11); setLeftYear(y => y - 1) }
    else setLeftMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (leftMonth === 11) { setLeftMonth(0); setLeftYear(y => y + 1) }
    else setLeftMonth(m => m + 1)
  }

  const today = new Date()
  const disableNextMonth = rightYear > today.getFullYear() || (rightYear === today.getFullYear() && rightMonth >= today.getMonth())

  // Header label reflects applied state (props), not pending.
  const btnLabel = (() => {
    if (allowAllTime && (preset === "" || preset === "all_time")) return allTimeLabel
    if (preset === "custom" && customStart && customEnd)
      return `${fmt(customStart)} – ${fmt(customEnd)}`
    if (preset === "maximum" && customStart && customEnd)
      return `Maximum: ${fmt(customStart)} – ${fmt(customEnd)}`
    const p = DATE_PICKER_PRESETS.find(x => x.value === preset)
    if (!p) return allowAllTime ? allTimeLabel : "Select range"
    const { start, end } = getPresetRange(preset, maxStart ?? undefined, maximumLookbackMonths)
    return `${p.label}: ${fmt(start)} – ${fmt(end)}`
  })()

  const isCustomValid = mode === "custom" && rangeStart
  const canApply = (mode === "preset" && (pending !== "" || (allowAllTime && pending === ""))) || !!isCustomValid

  const presetList = allowAllTime
    ? [{ value: "", label: allTimeLabel }, ...DATE_PICKER_PRESETS]
    : DATE_PICKER_PRESETS

  const panelBody = (
    <div
      ref={panelRef}
      className={cn(
        "bg-white dark:bg-card border rounded-xl shadow-2xl overflow-hidden w-[600px]",
        inline ? "relative z-[60]" : "fixed z-[60]",
      )}
      style={!inline && panelPos ? { top: panelPos.top, left: panelPos.left } : undefined}
    >
      <div className="flex">
        {/* ── Left: preset list ── */}
        <div className="w-[150px] border-r shrink-0 flex flex-col bg-white dark:bg-card py-1.5 max-h-[420px] overflow-y-auto">
          {presetList.map(p => (
            <button
              key={p.value || "all_time"}
              type="button"
              onClick={() => selectPreset(p.value)}
              className={cn(
                "w-full text-left px-4 py-[7px] text-xs transition-colors whitespace-nowrap",
                mode === "preset" && pending === p.value
                  ? "bg-[#e7f3ff] text-[#1877f2] font-semibold"
                  : "text-[#1c2b33] dark:text-foreground hover:bg-muted/40"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* ── Right: month nav + two-month calendar + inputs + footer ── */}
        <div className="flex-1 flex flex-col p-4 bg-white dark:bg-card min-w-0">
          <div className="flex items-start justify-between relative mb-2">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1 rounded hover:bg-muted/50 transition-colors"
              aria-label="Previous month"
            >
              <IconChevronLeft className="size-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={nextMonth}
              disabled={disableNextMonth}
              className={cn(
                "p-1 rounded transition-colors",
                disableNextMonth ? "opacity-30 cursor-not-allowed" : "hover:bg-muted/50"
              )}
              aria-label="Next month"
            >
              <IconChevronRight className="size-4 text-muted-foreground" />
            </button>
          </div>

          <div className="flex items-start justify-center gap-6">
            <CalGrid
              year={leftYear} month={leftMonth}
              startDate={rangeStart} endDate={rangeEnd} hoverDate={hoverDate}
              onDay={handleDay} onHover={setHoverDate}
            />
            <CalGrid
              year={rightYear} month={rightMonth}
              startDate={rangeStart} endDate={rangeEnd} hoverDate={hoverDate}
              onDay={handleDay} onHover={setHoverDate}
            />
          </div>

          {/* From / To inputs — always visible, editing switches to custom mode */}
          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={switchToCustom}
              className={cn(
                "size-2 rounded-full shrink-0",
                mode === "custom" ? "bg-[#1877f2]" : "bg-muted-foreground/30"
              )}
              aria-label="Use custom range"
            />
            <select
              value={mode === "custom" ? "custom" : pending}
              onChange={e => e.target.value === "custom" ? switchToCustom() : selectPreset(e.target.value)}
              className="h-9 px-2 text-xs border rounded-md bg-background w-[130px] shrink-0"
            >
              {presetList.map(p => <option key={p.value || "all_time"} value={p.value}>{p.label}</option>)}
              <option value="custom">Custom</option>
            </select>
            <input
              type="date"
              max={fmtInput(todayMidnight())}
              value={rangeStart ? fmtInput(rangeStart) : ""}
              onChange={e => {
                const v = e.target.value
                if (!v) return
                const d = new Date(v + "T00:00:00")
                if (d > todayMidnight()) return
                setMode("custom")
                setPending("")
                setRangeStart(d)
                if (rangeEnd && d > rangeEnd) setRangeEnd(null)
              }}
              className="h-9 px-2 text-xs border rounded-md bg-background flex-1 min-w-0"
            />
            <span className="text-muted-foreground text-xs shrink-0">–</span>
            <input
              type="date"
              max={fmtInput(todayMidnight())}
              value={rangeEnd ? fmtInput(rangeEnd) : ""}
              onChange={e => {
                const v = e.target.value
                if (!v) return
                const d = new Date(v + "T00:00:00")
                if (d > todayMidnight()) return
                setMode("custom")
                setPending("")
                setRangeEnd(d)
                if (rangeStart && d < rangeStart) setRangeStart(d)
                if (autoApply && rangeStart) {
                  const start = d < rangeStart ? d : rangeStart
                  const end = d < rangeStart ? rangeStart : d
                  onChange("custom", start, end)
                  closePicker()
                }
              }}
              className="h-9 px-2 text-xs border rounded-md bg-background flex-1 min-w-0"
            />
          </div>

          <div className="flex items-center justify-between mt-4 pt-3 border-t">
            <span className="text-[11px] text-muted-foreground">
              {timezoneLabel ?? (accountId
                ? "Meta reports dates in the selected ad account's timezone"
                : "Dates use your local timezone")}
            </span>
            {!autoApply && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closePicker}
                  className="h-8 px-3 text-xs border rounded-lg hover:bg-muted/50 transition-colors font-medium text-[#1c2b33] dark:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={!canApply}
                  className={cn(
                    "h-8 px-4 text-xs rounded-lg font-semibold transition-colors",
                    canApply
                      ? "bg-[#1877f2] text-white hover:bg-[#1464d8]"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                >
                  Update
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div ref={wrapRef} className="relative">
      {!inline && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 h-8 px-3 text-xs border rounded-lg hover:bg-muted/50 transition-colors whitespace-nowrap"
        >
          <IconCalendar className="size-3.5 text-muted-foreground shrink-0" />
          {!hideLabel && <span className="text-[#1c2b33] dark:text-foreground">{btnLabel}</span>}
          <IconChevronDown className="size-3 text-muted-foreground shrink-0" />
        </button>
      )}

      {(open || inline) && (
        inline
          ? panelBody
          : mounted
            ? createPortal(panelBody, document.body)
            : null
      )}
    </div>
  )
}
