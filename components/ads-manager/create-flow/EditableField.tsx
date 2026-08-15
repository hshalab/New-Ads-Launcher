"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { IconPencil } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { CampaignFormState } from "./types"

/**
 * Read-only-by-default field rows with a pencil to edit, as Meta Ads Manager renders an ad set.
 *
 * Why not just show every input: the ad set form has 30+ controls and the rebuild has to reach
 * 100% field coverage. Expanded, that is a wall nobody scans; collapsed to one summary line each,
 * the whole ad set fits on a screen and coverage stops fighting legibility.
 * (`specs/create-campaign-rebuild/PRD.md` §6.5, `create-campaign-flow.html` §2.)
 *
 * `readOnly` is opt-in and defaults to false, because `AdSetFormFields` is also mounted by the
 * shipped production editor `components/ads-manager/EditAdSetDrawer.tsx` — which keeps its current
 * always-expanded layout until that surface is redesigned on its own ticket.
 */

interface FieldEditContextValue {
  readOnly: boolean
  activeField: string | null
  open: (id: string) => void
  commit: () => void
  cancel: () => void
}

const FieldEditContext = createContext<FieldEditContextValue>({
  readOnly: false,
  activeField: null,
  open: () => {},
  commit: () => {},
  cancel: () => {},
})

export interface EditableCardProps<T = CampaignFormState> {
  title: string
  /** Rendered at the top-right of the card header — badges, counters. */
  headerRight?: React.ReactNode
  subtitle?: React.ReactNode
  readOnly?: boolean
  /** Current form state, snapshotted when a row opens so Cancel can restore it. */
  snapshot?: T
  onRestore?: (snapshot: T) => void
  children: React.ReactNode
}

export function EditableCard<T = CampaignFormState>({
  title,
  headerRight,
  subtitle,
  readOnly = false,
  snapshot,
  onRestore,
  children,
}: EditableCardProps<T>) {
  const [activeField, setActiveField] = useState<string | null>(null)
  const [restorePoint, setRestorePoint] = useState<T | null>(null)

  // One row per card is editable at a time; opening another commits the previous one.
  const open = useCallback(
    (id: string) => {
      setRestorePoint(snapshot ?? null)
      setActiveField(id)
    },
    [snapshot]
  )

  const commit = useCallback(() => {
    setActiveField(null)
    setRestorePoint(null)
  }, [])

  const cancel = useCallback(() => {
    if (restorePoint && onRestore) onRestore(restorePoint)
    setActiveField(null)
    setRestorePoint(null)
  }, [restorePoint, onRestore])

  const ctx = useMemo<FieldEditContextValue>(
    () => ({ readOnly, activeField, open, commit, cancel }),
    [readOnly, activeField, open, commit, cancel]
  )

  return (
    <section className="rounded-lg border border-[#e4e6eb] bg-white shadow-sm dark:border-gray-800 dark:bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-[#e4e6eb] px-5 py-3.5 dark:border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-[#1c2b33] dark:text-gray-100">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-[#65676b]">{subtitle}</p>}
        </div>
        {headerRight}
      </header>
      <div className={cn(readOnly ? "divide-y divide-[#f0f2f5] dark:divide-gray-800" : "space-y-4 p-5")}>
        <FieldEditContext.Provider value={ctx}>{children}</FieldEditContext.Provider>
      </div>
    </section>
  )
}

export interface EditableFieldProps {
  /** Unique within the card. */
  id: string
  label: string
  required?: boolean
  /** The read-only summary. Falsy renders `placeholder` in muted grey — never an empty input. */
  display?: React.ReactNode
  placeholder?: string
  hint?: React.ReactNode
  invalid?: boolean
  /** Disables the pencil and explains why — for controls with no backend yet. */
  lockedReason?: string
  /**
   * Stay expanded even inside a read-only card. For the handful of controls a buyer sets on every
   * single launch — name, budget, schedule, the ODAX dropdowns, locations, age. Collapsing those
   * behind a pencil costs a click on the common path and makes the ad set step look unlike the
   * campaign and ad steps, which have no pencils at all. The pencil is for the long tail.
   */
  always?: boolean
  children: React.ReactNode
}

export function EditableField({
  id,
  label,
  required,
  display,
  placeholder = "Not set",
  hint,
  invalid,
  lockedReason,
  always,
  children,
}: EditableFieldProps) {
  const { readOnly, activeField, open, commit, cancel } = useContext(FieldEditContext)

  if (!readOnly || always) {
    return (
      // A read-only card lays its rows out with dividers and no padding, so an always-expanded row
      // has to bring its own.
      <div className={cn(readOnly && "px-5 py-4")}>
        <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
        {children}
        {hint && <p className="mt-1 text-[11px] text-[#65676b]">{hint}</p>}
      </div>
    )
  }

  const isEditing = activeField === id
  const isEmpty = display === null || display === undefined || display === "" || display === false

  if (!isEditing) {
    return (
      <div
        className={cn(
          "group flex items-start justify-between gap-4 px-5 py-3 transition-colors",
          invalid ? "bg-red-50/60 dark:bg-red-950/20" : "hover:bg-[#f7f8fa] dark:hover:bg-muted/40"
        )}
      >
        <div className="min-w-0">
          <p
            className={cn(
              "text-xs font-semibold",
              invalid ? "text-red-600 dark:text-red-400" : "text-[#1c2b33] dark:text-gray-200"
            )}
          >
            {label} {required && <span className="text-red-500">*</span>}
          </p>
          <div
            className={cn(
              "mt-0.5 text-xs",
              isEmpty ? "text-[#a0a4ab] dark:text-gray-500" : "text-[#65676b] dark:text-gray-400"
            )}
          >
            {isEmpty ? placeholder : display}
          </div>
          {lockedReason && <p className="mt-1 text-[11px] text-[#a0a4ab]">{lockedReason}</p>}
        </div>
        <button
          type="button"
          disabled={Boolean(lockedReason)}
          onClick={() => open(id)}
          aria-label={`Edit ${label}`}
          title={lockedReason ?? `Edit ${label}`}
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
            lockedReason
              ? "cursor-not-allowed text-[#c9ccd1]"
              : "text-[#65676b] hover:bg-[#e7f3ff] hover:text-[#1877f2] dark:hover:bg-blue-900/30"
          )}
        >
          <IconPencil size={15} stroke={1.8} />
        </button>
      </div>
    )
  }

  return (
    <div className="bg-[#f7f8fa] px-5 py-4 dark:bg-muted/40">
      <label className="text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-[#65676b]">{hint}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={commit}
          className="h-7 rounded bg-[#1877f2] px-3 text-xs font-semibold text-white hover:bg-[#166fe5]"
        >
          Done
        </button>
        <button
          type="button"
          onClick={cancel}
          className="h-7 rounded px-3 text-xs font-semibold text-[#65676b] hover:bg-[#e4e6eb] dark:hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * A block that is not a single labelled value — radio groups, checkbox grids. It keeps the card's
 * padding in read-only mode without pretending to be an editable row.
 */
export function EditableCardBlock({ children }: { children: React.ReactNode }) {
  const { readOnly } = useContext(FieldEditContext)
  return <div className={cn(readOnly && "px-5 py-4")}>{children}</div>
}
