/**
 * Session-scoped persistence for Ads Manager editor drafts.
 *
 * The editor used to live inside a modal, so its draft map was ordinary React state: a modal
 * never unmounts while you use it, and nothing was ever lost. Moving the editor to its own route
 * changes that — a node switch, a refresh, or an accidental back would destroy unpublished edits
 * with no warning. This store is what makes the route move safe, so it ships with it.
 *
 * Scope decisions:
 * - `sessionStorage`, not `localStorage`: a draft is a working state, not a saved document. It
 *   should not resurrect in a tab opened next week against targeting that has since moved.
 * - Keyed by ad account: drafts from one account must never surface while editing another.
 * - Last write wins across tabs. Two tabs editing the same ad set is out of scope, stated rather
 *   than solved.
 */

export type EditorDraftMap<T = unknown> = Record<string, T>

const PREFIX = "adsmgr:drafts:"
const WRITE_DEBOUNCE_MS = 300

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>()

function storageKey(accountId: string): string {
  return `${PREFIX}${accountId}`
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage
  } catch {
    // Private mode / blocked storage. Drafts degrade to in-memory, which is the old behaviour.
    return null
  }
}

/** Read the draft map for one ad account. Never throws — a corrupt entry reads as empty. */
export function loadEditorDrafts<T = unknown>(accountId: string): EditorDraftMap<T> {
  if (!accountId) return {}
  const store = storage()
  if (!store) return {}
  try {
    const raw = store.getItem(storageKey(accountId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed as EditorDraftMap<T>
  } catch {
    return {}
  }
}

/** Write the whole draft map, debounced per account so keystroke-level edits do not thrash. */
export function saveEditorDrafts<T = unknown>(accountId: string, drafts: EditorDraftMap<T>): void {
  if (!accountId) return
  const store = storage()
  if (!store) return
  const key = storageKey(accountId)
  const existing = pendingWrites.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    pendingWrites.delete(key)
    try {
      if (Object.keys(drafts).length === 0) store.removeItem(key)
      else store.setItem(key, JSON.stringify(drafts))
    } catch {
      // Quota or serialization failure: the in-memory map stays authoritative for this session.
    }
  }, WRITE_DEBOUNCE_MS)
  pendingWrites.set(key, timer)
}

/** Flush any debounced write immediately. Called before unload and before leaving the route. */
export function flushEditorDrafts<T = unknown>(accountId: string, drafts: EditorDraftMap<T>): void {
  if (!accountId) return
  const store = storage()
  if (!store) return
  const key = storageKey(accountId)
  const existing = pendingWrites.get(key)
  if (existing) {
    clearTimeout(existing)
    pendingWrites.delete(key)
  }
  try {
    if (Object.keys(drafts).length === 0) store.removeItem(key)
    else store.setItem(key, JSON.stringify(drafts))
  } catch {
    // ignore
  }
}

/** Drop every draft for an account — the "Discard all" path. */
export function clearEditorDrafts(accountId: string): void {
  flushEditorDrafts(accountId, {})
}

/**
 * The draft key used everywhere: `<level>:<node id>`. Exported so the publish path clears exactly
 * the keys it published and leaves failed ones staged.
 */
export function editorDraftKey(level: string, id: string): string {
  return `${level}:${id}`
}
