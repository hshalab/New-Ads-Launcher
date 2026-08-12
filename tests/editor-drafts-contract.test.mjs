import { describe, it, before, beforeEach } from "node:test"
import assert from "node:assert/strict"

/**
 * The editor moved from a modal to a route, so unpublished edits now have to survive an unmount.
 * These tests pin the four properties that make that safe: session scope, per-account isolation,
 * a flush that beats the debounce, and never throwing when storage is unavailable or corrupt.
 */

class FakeStorage {
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
}

let sessionStorage
let lib

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

before(async () => {
  sessionStorage = new FakeStorage()
  globalThis.window = {
    get sessionStorage() { return sessionStorage },
    get localStorage() { throw new Error("drafts must never touch localStorage") },
  }
  lib = await import("../lib/editor-drafts.ts")
})

beforeEach(() => {
  sessionStorage = new FakeStorage()
})

describe("editor drafts · persistence contract", () => {
  it("round-trips a draft map for one ad account", async () => {
    const drafts = { "adset:123": { name: "Retarget · VN" } }
    lib.saveEditorDrafts("act_1", drafts)
    await wait(350)

    assert.deepEqual(lib.loadEditorDrafts("act_1"), drafts)
  })

  it("never leaks drafts between ad accounts", async () => {
    lib.saveEditorDrafts("act_1", { "ad:1": { name: "A" } })
    lib.flushEditorDrafts("act_2", { "ad:2": { name: "B" } })
    await wait(350)

    assert.deepEqual(lib.loadEditorDrafts("act_1"), { "ad:1": { name: "A" } })
    assert.deepEqual(lib.loadEditorDrafts("act_2"), { "ad:2": { name: "B" } })
  })

  it("flush wins the race against the debounce, so beforeunload loses nothing", () => {
    lib.saveEditorDrafts("act_1", { "ad:1": { name: "typed" } })
    // No wait: the debounced write has not fired yet. This is the tab-close case.
    lib.flushEditorDrafts("act_1", { "ad:1": { name: "typed" } })

    assert.deepEqual(lib.loadEditorDrafts("act_1"), { "ad:1": { name: "typed" } })
  })

  it("a later flush is not overwritten by an earlier pending debounce", async () => {
    lib.saveEditorDrafts("act_1", { "ad:1": { name: "stale" } })
    lib.flushEditorDrafts("act_1", { "ad:1": { name: "fresh" } })
    await wait(350)

    assert.deepEqual(lib.loadEditorDrafts("act_1"), { "ad:1": { name: "fresh" } })
  })

  it("an empty map removes the entry rather than storing {}", () => {
    lib.flushEditorDrafts("act_1", { "ad:1": { name: "A" } })
    lib.clearEditorDrafts("act_1")

    assert.equal(sessionStorage.getItem("adsmgr:drafts:act_1"), null)
    assert.deepEqual(lib.loadEditorDrafts("act_1"), {})
  })

  it("reads corrupt or non-object entries as empty instead of throwing", () => {
    for (const raw of ["{not json", "[1,2]", "null", '"a string"']) {
      sessionStorage.setItem("adsmgr:drafts:act_1", raw)
      assert.deepEqual(lib.loadEditorDrafts("act_1"), {}, `corrupt payload: ${raw}`)
    }
  })

  it("degrades to in-memory when storage is blocked, and still does not throw", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.window, "sessionStorage")
    Object.defineProperty(globalThis.window, "sessionStorage", {
      configurable: true,
      get() { throw new Error("SecurityError: storage blocked") },
    })
    try {
      assert.deepEqual(lib.loadEditorDrafts("act_1"), {})
      lib.saveEditorDrafts("act_1", { "ad:1": {} })
      lib.flushEditorDrafts("act_1", { "ad:1": {} })
      lib.clearEditorDrafts("act_1")
    } finally {
      Object.defineProperty(globalThis.window, "sessionStorage", original)
    }
  })

  it("ignores calls with no ad account", () => {
    lib.saveEditorDrafts("", { "ad:1": {} })
    lib.flushEditorDrafts("", { "ad:1": {} })
    assert.deepEqual(lib.loadEditorDrafts(""), {})
    assert.equal(sessionStorage.getItem("adsmgr:drafts:"), null)
  })

  it("keys a draft by level and id, so the same numeric id at two levels never collides", () => {
    assert.equal(lib.editorDraftKey("adset", "123"), "adset:123")
    assert.notEqual(lib.editorDraftKey("ad", "123"), lib.editorDraftKey("adset", "123"))
  })
})
