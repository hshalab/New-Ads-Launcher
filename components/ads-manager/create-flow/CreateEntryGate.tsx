"use client"

import { useEffect, useMemo, useState } from "react"
import {
  IconArrowUpRight,
  IconCheck,
  IconEye,
  IconMessageCircle2,
  IconSearch,
  IconSettings,
  IconShoppingBag,
  IconSparkles,
  IconX,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { CampaignObjective, isCampaignObjective } from "@/lib/odax-matrix"
import { cn } from "@/lib/utils"

/**
 * The four gates Meta puts between "Create" and the editor — scope, buying type, objective, setup
 * mode (`specs/create-campaign-rebuild/create-campaign-flow.html` §1, G1–G4).
 *
 * They are not decoration. The objective decides which `destination_type` values are legal, which
 * decides which `optimization_goal` values are legal. Meta only checks that chain when the *ad set*
 * is created — after the campaign already exists — so an objective picked halfway down a form
 * surfaces as error 100 plus an orphan campaign. Choosing it at the gate is what lets
 * `lib/odax-matrix.ts` generate a form in which no invalid combination is reachable.
 *
 * The **New ad set or ad** scope attaches to a campaign that already exists. Its objective is then
 * Meta's, not the user's — so the objective list is replaced by a campaign picker, and campaigns
 * whose objective this app cannot build are listed but not selectable, with the reason. Picking one
 * would otherwise fail at ad-set creation with error 100, which is exactly what these gates exist to
 * make unreachable.
 *
 * Reservation buying stays visible-but-disabled: hiding it would misrepresent Ads Manager, enabling
 * it would misrepresent what this app can send.
 */

export type SetupMode = "recommended" | "manual"
export type CampaignScope = "new" | "existing"

/** The campaign an ad set is being attached to, reduced to what the create flow has to obey. */
export interface EntryGateCampaignRef {
  id: string
  name: string
  objective: CampaignObjective
  /** Campaign-level budget ⇒ CBO: the new ad set must not carry a budget of its own. */
  hasCampaignBudget: boolean
}

export interface EntryGateResult {
  scope: CampaignScope
  objective: CampaignObjective
  setupMode: SetupMode
  /** Present only when `scope === "existing"`. */
  existingCampaign?: EntryGateCampaignRef
}

interface CampaignRow {
  id: string
  name: string
  objective?: string
  status?: string
  effective_status?: string
  daily_budget?: string | number | null
  lifetime_budget?: string | number | null
}

interface ObjectiveOption {
  value: string
  label: string
  desc: string
  goodFor: string[]
  /** Present = the app cannot build this objective yet, and why. */
  blockedReason?: string
}

// Ads Manager order. The two blocked entries need `promoted_object` plumbing that does not exist
// (lead forms, app store ids) — BL-56.
const OBJECTIVES: ObjectiveOption[] = [
  {
    value: "OUTCOME_AWARENESS",
    label: "Awareness",
    desc: "Show your ads to people who are most likely to remember them.",
    goodFor: ["Reach", "Brand awareness", "Video views", "Store location awareness"],
  },
  {
    value: "OUTCOME_TRAFFIC",
    label: "Traffic",
    desc: "Send people to a destination, like your website, app or Facebook event.",
    goodFor: ["Link clicks", "Landing page views", "Instagram profile visits"],
  },
  {
    value: "OUTCOME_ENGAGEMENT",
    label: "Engagement",
    desc: "Get more messages, purchases through messaging, video views, post engagement, Page likes or event responses.",
    goodFor: ["Video views", "Post engagement", "Conversions on your website"],
  },
  {
    value: "OUTCOME_LEADS",
    label: "Leads",
    desc: "Collect leads for your business or brand.",
    goodFor: ["Instant forms", "Messages", "Calls", "Sign-ups"],
    blockedReason: "Needs lead form / call plumbing — not built yet (BL-56).",
  },
  {
    value: "OUTCOME_APP_PROMOTION",
    label: "App promotion",
    desc: "Find new people to install your app and keep using it.",
    goodFor: ["App installs", "App events"],
    blockedReason: "Needs an app id and store URL in promoted_object — not built yet (BL-56).",
  },
  {
    value: "OUTCOME_SALES",
    label: "Sales",
    desc: "Find people likely to purchase your product or service.",
    goodFor: ["Conversions", "Catalogue sales", "Messages", "Calls"],
  },
]

/** Why this campaign cannot receive a new ad set from here, or "" when it can. */
function attachBlockedReason(campaign: CampaignRow): string {
  const objective = campaign.objective || ""
  if (!isCampaignObjective(objective)) {
    return `Legacy objective (${objective || "unknown"}) — Meta no longer accepts new ad sets built this way.`
  }
  return OBJECTIVES.find((option) => option.value === objective)?.blockedReason || ""
}

interface Props {
  open: boolean
  /** Seeds the picker so reopening the gate from the editor shows what is already chosen. */
  objective: CampaignObjective
  setupMode: SetupMode
  /** Needed by the campaign picker; without it the existing-campaign scope has nothing to list. */
  accountId: string
  onCancel: () => void
  onContinue: (result: EntryGateResult) => void
}

export function CreateEntryGate({ open, objective, setupMode, accountId, onCancel, onContinue }: Props) {
  const [pane, setPane] = useState<"objective" | "setup">("objective")
  const [selected, setSelected] = useState<string>(objective)
  const [mode, setMode] = useState<SetupMode>(setupMode)
  const [scope, setScope] = useState<CampaignScope>("new")
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [campaignsState, setCampaignsState] = useState<"idle" | "loading" | "error">("idle")
  const [campaignQuery, setCampaignQuery] = useState("")
  const [chosenCampaignId, setChosenCampaignId] = useState("")

  // Loaded on demand: the create-new path is the common one and must not pay for a Meta read it
  // will never use. The route caches for 15 minutes (app/api/facebook/campaigns/route.ts).
  // Loading state is set in the scope radio handler — never here — so this effect only writes
  // terminal states inside the fetch callbacks (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open || scope !== "existing" || !accountId) return
    let cancelled = false
    fetch(`/api/facebook/campaigns?ad_account_id=${encodeURIComponent(accountId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (data?.error) {
          setCampaignsState("error")
          return
        }
        setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : [])
        setCampaignsState("idle")
      })
      .catch(() => {
        if (!cancelled) setCampaignsState("error")
      })
    return () => {
      cancelled = true
    }
  }, [open, scope, accountId])

  const visibleCampaigns = useMemo(() => {
    const query = campaignQuery.trim().toLowerCase()
    const rows = query
      ? campaigns.filter((row) => row.name?.toLowerCase().includes(query) || row.id.includes(query))
      : campaigns
    return rows.slice(0, 60)
  }, [campaigns, campaignQuery])

  const chosenCampaign = campaigns.find((row) => row.id === chosenCampaignId) || null

  if (!open) return null

  const active = OBJECTIVES.find((option) => option.value === selected) ?? OBJECTIVES[0]
  const canContinue =
    scope === "new"
      ? isCampaignObjective(selected)
      : Boolean(chosenCampaign) && !attachBlockedReason(chosenCampaign as CampaignRow)

  const submit = () => {
    if (!canContinue) return
    if (scope === "existing" && chosenCampaign) {
      // No setup pane on this branch: placements and targeting stay the user's choice in the
      // editor, but the budget mode is the campaign's and is read off it here rather than asked.
      onContinue({
        scope: "existing",
        objective: chosenCampaign.objective as CampaignObjective,
        setupMode: "recommended",
        existingCampaign: {
          id: chosenCampaign.id,
          name: chosenCampaign.name,
          objective: chosenCampaign.objective as CampaignObjective,
          hasCampaignBudget: Boolean(chosenCampaign.daily_budget || chosenCampaign.lifetime_budget),
        },
      })
      return
    }
    if (pane === "objective") {
      setPane("setup")
      return
    }
    onContinue({ scope: "new", objective: selected as CampaignObjective, setupMode: mode })
  }

  return (
    // z-60 for the same reason as CreateCampaignModal: the global feedback bubble is z-50 and
    // would otherwise float above this dialog's scrim.
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[86vh] w-full max-w-[1040px] animate-in flex-col overflow-hidden rounded-lg bg-white shadow-2xl duration-150 fade-in dark:bg-card">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#e4e6eb] px-5 dark:border-gray-800">
          <h2 className="text-base font-semibold text-[#1c2b33] dark:text-gray-100">
            {pane === "objective" ? "Create new campaign" : "Choose a campaign setup"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-1.5 transition-colors hover:bg-black/5"
            aria-label="Close"
          >
            <IconX className="size-5 text-[#65676b]" />
          </button>
        </div>

        {pane === "objective" ? (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
              {/* G1 · scope */}
              <p className="mb-2 text-xs font-semibold text-[#1c2b33] dark:text-gray-200">Campaign</p>
              <div className="space-y-1.5">
                <GateRadio
                  checked={scope === "new"}
                  label="Create new campaign"
                  onSelect={() => {
                    setScope("new")
                    setCampaignsState("idle")
                  }}
                />
                <GateRadio
                  checked={scope === "existing"}
                  label="New ad set or ad"
                  note="Add to a campaign that already exists."
                  onSelect={() => {
                    setScope("existing")
                    setCampaignsState("loading")
                  }}
                />
              </div>

              {scope === "new" ? (
                <>
                  {/* G2 · buying type */}
                  <p className="mb-2 mt-5 text-xs font-semibold text-[#1c2b33] dark:text-gray-200">Buying type</p>
                  <select
                    value="AUCTION"
                    onChange={() => {}}
                    className="h-9 w-full max-w-md rounded border border-[#ccd0d5] bg-white px-3 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"
                  >
                    <option value="AUCTION">Auction</option>
                    <option value="RESERVED" disabled>
                      Reservation — reach &amp; frequency, not supported
                    </option>
                  </select>

                  {/* G3 · objective */}
                  <p className="mb-2 mt-5 text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
                    Choose a campaign objective
                  </p>
                  <div className="max-w-xl space-y-1">
                    {OBJECTIVES.map((option) => {
                      const isSelected = option.value === selected
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={Boolean(option.blockedReason)}
                          title={option.blockedReason}
                          onClick={() => setSelected(option.value)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded px-3 py-2.5 text-left text-sm transition-colors",
                            option.blockedReason
                              ? "cursor-not-allowed text-[#a0a4ab]"
                              : isSelected
                                ? "bg-[#e7f3ff] font-semibold text-[#1877f2] dark:bg-blue-900/30"
                                : "text-[#1c2b33] hover:bg-[#f0f2f5] dark:text-gray-200 dark:hover:bg-muted"
                          )}
                        >
                          <span>{option.label}</span>
                          {isSelected && !option.blockedReason && <IconCheck className="size-4 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : (
                // G3′ · the campaign replaces the objective: on this branch the objective is read
                // off the campaign, never chosen.
                <>
                  <p className="mb-2 mt-5 text-xs font-semibold text-[#1c2b33] dark:text-gray-200">
                    Choose a campaign
                  </p>
                  <div className="relative mb-2 max-w-xl">
                    <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#a0a4ab]" />
                    <input
                      value={campaignQuery}
                      onChange={(event) => setCampaignQuery(event.target.value)}
                      placeholder="Search by name or ID"
                      className="h-9 w-full rounded border border-[#ccd0d5] bg-white pl-8 pr-3 text-xs outline-none focus:border-[#1877f2] dark:border-gray-700 dark:bg-background"
                    />
                  </div>

                  {campaignsState === "loading" && (
                    <div className="max-w-xl space-y-1.5">
                      {[0, 1, 2, 3].map((row) => (
                        <div key={row} className="h-9 animate-pulse rounded bg-[#f0f2f5] dark:bg-muted" />
                      ))}
                    </div>
                  )}
                  {campaignsState === "error" && (
                    <p className="text-[11px] text-[#e29e09]">
                      Could not load campaigns from Meta. Try again, or create a new campaign.
                    </p>
                  )}
                  {campaignsState === "idle" && visibleCampaigns.length === 0 && (
                    <p className="text-[11px] text-[#65676b]">
                      {campaigns.length === 0
                        ? "This ad account has no campaigns yet."
                        : "No campaign matches that search."}
                    </p>
                  )}

                  <div className="max-w-xl space-y-1">
                    {visibleCampaigns.map((row) => {
                      const blocked = attachBlockedReason(row)
                      const isSelected = row.id === chosenCampaignId
                      return (
                        <button
                          key={row.id}
                          type="button"
                          disabled={Boolean(blocked)}
                          title={blocked || row.name}
                          onClick={() => setChosenCampaignId(row.id)}
                          className={cn(
                            "flex w-full flex-col items-start gap-0.5 rounded px-3 py-2.5 text-left text-sm transition-colors",
                            blocked
                              ? "cursor-not-allowed text-[#a0a4ab]"
                              : isSelected
                                ? "bg-[#e7f3ff] text-[#1877f2] dark:bg-blue-900/30"
                                : "text-[#1c2b33] hover:bg-[#f0f2f5] dark:text-gray-200 dark:hover:bg-muted"
                          )}
                        >
                          <span className={cn("w-full truncate", isSelected && "font-semibold")}>{row.name}</span>
                          <span className="text-[11px] text-[#a0a4ab]">
                            {row.effective_status || row.status || "—"} ·{" "}
                            {row.daily_budget || row.lifetime_budget ? "Campaign budget" : "Ad set budget"}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Text-only context — never a full-height empty frame. Primary flow stays left. */}
            <aside className="shrink-0 border-t border-[#e4e6eb] bg-[#f7f8fa] p-4 dark:border-gray-800 dark:bg-background lg:w-[280px] lg:border-l lg:border-t-0">
              <div className="rounded border border-[#e4e6eb] bg-white p-4 dark:border-gray-800 dark:bg-card lg:sticky lg:top-0">
                {scope === "new" ? (
                  <>
                    <ObjectiveVisual objective={active.value} label={active.label} />
                    <h3 className="mt-4 text-sm font-semibold text-[#1c2b33] dark:text-gray-100">{active.label}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-[#65676b]">{active.desc}</p>
                    <p className="mt-4 text-xs font-semibold text-[#1c2b33] dark:text-gray-200">Good for:</p>
                    <ul className="mt-2 space-y-1.5">
                      {active.goodFor.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-xs text-[#65676b]">
                          <IconCheck className="mt-0.5 size-3.5 shrink-0 text-[#31a24c]" />
                          {item}
                        </li>
                      ))}
                    </ul>
                    {active.blockedReason && (
                      <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                        {active.blockedReason}
                      </p>
                    )}
                  </>
                ) : chosenCampaign ? (
                  <AttachSummary campaign={chosenCampaign} />
                ) : (
                  <>
                    <div
                      role="img"
                      aria-label="Choose an existing campaign"
                      className="relative mb-4 h-28 overflow-hidden rounded bg-gradient-to-br from-[#eef1f6] via-[#f4f7fb] to-[#e7f3ff]"
                    >
                      <span className="absolute -right-2 -top-2 rounded-full bg-white/70 p-4 shadow-sm" aria-hidden="true">
                        <IconSettings className="size-10 text-[#1877f2]" stroke={1.5} />
                      </span>
                      <span className="absolute bottom-4 left-4 text-xs font-semibold text-[#1c2b33]">
                        Existing campaign
                      </span>
                      <span className="absolute bottom-1.5 left-4 text-[10px] text-[#65676b]">
                        Inherit objective &amp; budget mode
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-[#65676b]">
                      Pick the campaign this ad set belongs to. Its objective and budget mode already
                      exist in Meta. The next step opens at the ad set.
                    </p>
                  </>
                )}
              </div>
            </aside>
          </div>
        ) : (
          // G4 · setup mode
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <SetupCard
                selected={mode === "recommended"}
                onSelect={() => setMode("recommended")}
                icon={IconSparkles}
                title="Recommended settings"
                chips={["Streamlined", "Best practices"]}
                desc="Start with Advantage+ audience and Advantage+ placements, and set the budget at campaign level."
                bullets={[
                  "Advantage+ placements on",
                  "Advantage detailed targeting on",
                  "Advantage campaign budget on",
                ]}
              />
              <SetupCard
                selected={mode === "manual"}
                onSelect={() => setMode("manual")}
                icon={IconSettings}
                title="Manual campaign"
                chips={["Finer control"]}
                desc="Choose every setting yourself — placements, targeting, and where the budget lives."
                bullets={[
                  "Pick placements per platform",
                  "Budget at campaign or ad set",
                  "Nothing is preset for you",
                ]}
              />
            </div>
            <p className="mt-4 text-[11px] text-[#65676b]">
              Either way every setting stays editable in the next step. This only decides what is
              switched on when the editor opens.
            </p>
          </div>
        )}

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[#e4e6eb] px-5 py-3 dark:border-gray-800">
          <Button
            variant="outline"
            onClick={pane === "objective" ? onCancel : () => setPane("objective")}
            className="h-9 border-[#ccd0d5] px-5 text-xs font-semibold text-[#4b4f56]"
          >
            {pane === "objective" ? "Cancel" : "Back"}
          </Button>
          <Button
            onClick={submit}
            disabled={!canContinue}
            className="h-9 bg-[#1877f2] px-5 font-semibold text-white hover:bg-[#166fe5]"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * What the user is agreeing to inherit. Budget mode is the one that changes the next screen: under
 * a CBO campaign the ad set's daily budget field disappears, because Meta rejects a budget there.
 */
function AttachSummary({ campaign }: { campaign: CampaignRow }) {
  const blocked = attachBlockedReason(campaign)
  const objectiveLabel =
    OBJECTIVES.find((option) => option.value === campaign.objective)?.label || campaign.objective || "Unknown"
  const cbo = Boolean(campaign.daily_budget || campaign.lifetime_budget)

  return (
    <>
      <ObjectiveVisual objective={campaign.objective || ""} label={objectiveLabel} />
      <h3 className="mt-4 text-sm font-semibold text-[#1c2b33] dark:text-gray-100">{campaign.name}</h3>
      <p className="mt-1 font-mono text-[11px] text-[#a0a4ab]">{campaign.id}</p>

      <p className="mt-5 text-xs font-semibold text-[#1c2b33] dark:text-gray-200">Inherited from this campaign:</p>
      <dl className="mt-2 space-y-2">
        {[
          ["Objective", objectiveLabel],
          ["Status", campaign.effective_status || campaign.status || "—"],
          ["Budget", cbo ? "Campaign budget (CBO) — the ad set carries none" : "Ad set budget — this ad set sets its own"],
        ].map(([label, value]) => (
          <div key={label} className="flex gap-2 text-xs">
            <dt className="w-20 shrink-0 text-[#65676b]">{label}</dt>
            <dd className="min-w-0 text-[#1c2b33] dark:text-gray-200">{value}</dd>
          </div>
        ))}
      </dl>

      {blocked ? (
        <p className="mt-5 rounded border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {blocked}
        </p>
      ) : (
        <p className="mt-5 text-[11px] leading-relaxed text-[#65676b]">
          Continue opens the editor at the ad set. The campaign step is read-only — nothing here
          edits a campaign that is already running.
        </p>
      )}
    </>
  )
}

function ObjectiveVisual({ objective, label }: { objective: string; label: string }) {
  // Meta-style objective art: soft gradient plate + icon scene. No remote assets.
  const scene =
    objective === "OUTCOME_AWARENESS"
      ? {
          Icon: IconEye,
          title: "Reach more people",
          detail: "Build recognition",
          plate: "bg-gradient-to-br from-[#7ec8ff] via-[#b8e0ff] to-[#f0f7ff]",
          blob: "bg-[#45a1f0]/35",
          iconBg: "bg-white/90 text-[#1877f2]",
        }
      : objective === "OUTCOME_TRAFFIC"
        ? {
            Icon: IconArrowUpRight,
            title: "Drive visits",
            detail: "Send people to a destination",
            plate: "bg-gradient-to-br from-[#5ec4ff] via-[#9dd8ff] to-[#eaf6ff]",
            blob: "bg-[#1b8cff]/30",
            iconBg: "bg-white/90 text-[#1877f2]",
          }
        : objective === "OUTCOME_ENGAGEMENT"
          ? {
              Icon: IconMessageCircle2,
              title: "Start conversations",
              detail: "Earn meaningful interactions",
              plate: "bg-gradient-to-br from-[#9b8cff] via-[#c4b5ff] to-[#f1edff]",
              blob: "bg-[#6c5ce7]/30",
              iconBg: "bg-white/90 text-[#5b4cdb]",
            }
          : objective === "OUTCOME_SALES"
            ? {
                Icon: IconShoppingBag,
                title: "Grow sales",
                detail: "Find likely customers",
                plate: "bg-gradient-to-br from-[#4fd1a5] via-[#8ee4c5] to-[#e9faf3]",
                blob: "bg-[#0d9488]/28",
                iconBg: "bg-white/90 text-[#0f766e]",
              }
            : {
                Icon: IconSparkles,
                title: label,
                detail: "Campaign objective",
                plate: "bg-gradient-to-br from-[#c5cbd6] via-[#e1e5ec] to-[#f5f6f8]",
                blob: "bg-[#8b93a3]/25",
                iconBg: "bg-white/90 text-[#4b5563]",
              }

  const SceneIcon = scene.Icon
  return (
    <div
      role="img"
      aria-label={`${label} campaign objective illustration`}
      className={cn("relative h-36 overflow-hidden rounded-md", scene.plate)}
    >
      <span className={cn("absolute -right-6 -top-8 size-28 rounded-full blur-sm", scene.blob)} aria-hidden="true" />
      <span className={cn("absolute -left-8 bottom-6 size-20 rounded-full blur-md", scene.blob)} aria-hidden="true" />
      <span
        className={cn(
          "absolute right-4 top-1/2 flex size-16 -translate-y-1/2 items-center justify-center rounded-2xl shadow-md",
          scene.iconBg
        )}
        aria-hidden="true"
      >
        <SceneIcon className="size-8" stroke={1.6} />
      </span>
      {/* One stack, not two spans pinned to their own `bottom` offsets — `detail` wraps to two lines
          at this width and used to climb over `title`. */}
      <span className="absolute inset-x-4 bottom-3 flex max-w-[58%] flex-col gap-0.5">
        <span className="text-xs font-semibold leading-snug text-[#1c2b33]">{scene.title}</span>
        <span className="text-[10px] leading-snug text-[#4b5563]/90">{scene.detail}</span>
      </span>
    </div>
  )
}

function GateRadio({
  checked,
  label,
  note,
  disabled,
  onSelect,
}: {
  checked: boolean
  label: string
  note?: string
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded px-3 py-2 text-left transition-colors",
        disabled ? "cursor-not-allowed" : "hover:bg-[#f0f2f5] dark:hover:bg-muted"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-[#1877f2]" : "border-[#c9ccd1]"
        )}
      >
        {checked && <span className="size-2 rounded-full bg-[#1877f2]" />}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-xs", disabled ? "text-[#a0a4ab]" : "text-[#1c2b33] dark:text-gray-200")}>
          {label}
        </span>
        {note && <span className="mt-0.5 block text-[11px] text-[#a0a4ab]">{note}</span>}
      </span>
    </button>
  )
}

function SetupCard({
  selected,
  onSelect,
  icon: Icon,
  title,
  chips,
  desc,
  bullets,
}: {
  selected: boolean
  onSelect: () => void
  icon: React.ElementType
  title: string
  chips: string[]
  desc: string
  bullets: string[]
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-full flex-col items-start gap-3 rounded-lg border p-4 text-left transition-colors",
        selected
          ? "border-[#1877f2] bg-[#e7f3ff]/40 ring-1 ring-[#1877f2] dark:bg-blue-900/20"
          : "border-[#ccd0d5] hover:bg-[#f5f6f7] dark:border-gray-700 dark:hover:bg-muted/50"
      )}
    >
      <span className={cn("rounded-full p-2", selected ? "bg-[#1877f2]/10" : "bg-muted")}>
        <Icon className={cn("size-4", selected ? "text-[#1877f2]" : "text-muted-foreground")} />
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span className={cn("text-sm font-semibold", selected ? "text-[#1877f2]" : "text-[#1c2b33] dark:text-gray-100")}>
          {title}
        </span>
        {chips.map((chip) => (
          <span
            key={chip}
            className="rounded-full bg-[#f0f2f5] px-2 py-0.5 text-[10px] font-medium text-[#65676b] dark:bg-muted"
          >
            {chip}
          </span>
        ))}
      </span>
      <span className="text-xs leading-relaxed text-[#65676b]">{desc}</span>
      <span className="mt-auto space-y-1 pt-1">
        {bullets.map((bullet) => (
          <span key={bullet} className="flex items-start gap-2 text-[11px] text-[#65676b]">
            <IconCheck className="mt-0.5 size-3 shrink-0 text-[#31a24c]" />
            {bullet}
          </span>
        ))}
      </span>
    </button>
  )
}
