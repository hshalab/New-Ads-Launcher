/**
 * Gate → editor handoff for the BL-64 create path.
 *
 * The editor is a route (`/ads-manager/editor`, intercepted by the `@editor` slot), so navigating
 * to it unmounts nothing on the table page but *mounts* a fresh `PerformancePopup`. Everything the
 * create path just built — the staged children, the session-created ledger that makes Discard able
 * to reverse them, the session's batch id — is component state that does not survive that
 * navigation, and it is far too large for URL params.
 *
 * Same scope decisions as `lib/editor-drafts.ts`: `sessionStorage`, keyed by ad account, never
 * throws. One difference: this payload is **consumed once**. Re-seeding a ledger on every refresh
 * would let Discard try to delete objects a previous pass already deleted, and would resurrect
 * drafts the buyer discarded. A refresh therefore forfeits the Discard affordance — the objects
 * stay PAUSED on Meta and remain deletable from the hierarchy table. Durable drafts are BL-59.
 */

import type { WorkspaceNode } from "@/components/ads-manager/UnifiedWorkspaceEditor"
import type { SessionCreatedLedger } from "@/lib/session-created-ledger"

export type WorkspaceEntryHandoff = {
  accountId: string
  campaignId: string
  /** Keyed `<level>:<node id>`, same shape as `workspaceDrafts`. */
  drafts: Record<string, WorkspaceNode>
  localCampaigns: Array<Record<string, unknown>>
  localAdSets: Array<Record<string, unknown>>
  localAds: Array<Record<string, unknown>>
  ledger: SessionCreatedLedger
  batchId?: string
  /** Meta ids created by this pass — highlighted in the tree as "New · paused". */
  createdMetaIds: string[]
  /** Surfaced verbatim in the editor when a child could not be created on Meta. Never swallowed. */
  error?: string
  savedAt?: number
}

const PREFIX = "adsmgr:entry-handoff:"
/**
 * A handoff the intended editor never picked up must not be inherited by an editor opened later on
 * a different campaign — that editor would get a ledger claiming nodes it did not create.
 */
const MAX_AGE_MS = 5 * 60 * 1000

function storageKey(accountId: string): string {
  return `${PREFIX}${accountId}`
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function saveWorkspaceEntryHandoff(handoff: WorkspaceEntryHandoff): void {
  if (!handoff.accountId) return
  const store = storage()
  if (!store) return
  try {
    store.setItem(storageKey(handoff.accountId), JSON.stringify({ ...handoff, savedAt: Date.now() }))
  } catch {
    // Quota or serialization failure. The editor still opens on the real campaign; it just opens
    // without the staged children, which is visible rather than silent.
  }
}

/**
 * Read and remove in one step, but only for the campaign the handoff was written for. A corrupt,
 * absent or expired entry reads as `null`; a live entry for a *different* campaign is left in place
 * so the editor it was meant for can still claim it.
 */
export function takeWorkspaceEntryHandoff(accountId: string, campaignId: string): WorkspaceEntryHandoff | null {
  if (!accountId || !campaignId) return null
  const store = storage()
  if (!store) return null
  const key = storageKey(accountId)
  try {
    const raw = store.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      store.removeItem(key)
      return null
    }
    const handoff = parsed as WorkspaceEntryHandoff
    const expired = typeof handoff.savedAt === "number" && Date.now() - handoff.savedAt > MAX_AGE_MS
    if (handoff.accountId !== accountId || !handoff.campaignId || expired) {
      store.removeItem(key)
      return null
    }
    if (handoff.campaignId !== campaignId) return null
    store.removeItem(key)
    return handoff
  } catch {
    try { store.removeItem(key) } catch { /* ignore */ }
    return null
  }
}

export function clearWorkspaceEntryHandoff(accountId: string): void {
  const store = storage()
  if (!store || !accountId) return
  try { store.removeItem(storageKey(accountId)) } catch { /* ignore */ }
}
