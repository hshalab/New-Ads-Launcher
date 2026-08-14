export type CreatedNodeLevel = "campaign" | "adset" | "ad"

export type SessionCreatedNode = {
  nodeId: string
  level: CreatedNodeLevel
  metaId?: string
  parentNodeId?: string
  /**
   * This node existed on Meta before the session — it is in the ledger only so a child created
   * this session has a parent to link to. An anchor is never returned by `pendingDeletes`, so
   * Discard can never delete a campaign or ad set the buyer did not create here. Without this,
   * the only way to record "new ad set under a live campaign" was to enter the live campaign as
   * a created node, which made Discard delete a real, possibly spending, campaign.
   */
  anchor?: boolean
}

export type SessionCreatedLedger = {
  batchId?: string
  nodes: SessionCreatedNode[]
}

const DELETE_ORDER: Record<CreatedNodeLevel, number> = {
  campaign: 0,
  adset: 1,
  ad: 2,
}

const REQUIRED_PARENT_LEVEL: Record<CreatedNodeLevel, CreatedNodeLevel | null> = {
  campaign: null,
  adset: "campaign",
  ad: "adset",
}

function blank(value?: string): boolean {
  return !value || value.trim() === ""
}

export function createSessionCreatedLedger(): SessionCreatedLedger {
  return { nodes: [] }
}

export function appendCreatedNode(
  ledger: SessionCreatedLedger,
  node: SessionCreatedNode,
): SessionCreatedLedger {
  if (blank(node.nodeId)) throw new Error("Session-created node requires a node ID")
  if (node.metaId !== undefined && blank(node.metaId)) {
    throw new Error("Session-created node Meta ID cannot be whitespace-only")
  }
  if (ledger.nodes.some(({ nodeId }) => nodeId === node.nodeId)) {
    throw new Error(`Session-created node already exists: ${node.nodeId}`)
  }
  if (node.metaId && ledger.nodes.some(existing => existing.metaId === node.metaId)) {
    throw new Error(`Session-created node already maps to Meta ID: ${node.metaId}`)
  }

  // An anchor is a pre-existing Meta object, so its own ancestors are irrelevant here: nothing in
  // this ledger will ever write to or delete it. Requiring its parent would force the caller to
  // enter the whole live hierarchy, which is exactly the lie this flag removes.
  const requiredParentLevel = node.anchor ? null : REQUIRED_PARENT_LEVEL[node.level]
  if (requiredParentLevel) {
    const parent = node.parentNodeId
      ? ledger.nodes.find(existing => existing.nodeId === node.parentNodeId)
      : undefined
    if (!parent || parent.level !== requiredParentLevel) {
      throw new Error(`Session-created ${node.level} requires a ${requiredParentLevel} parent already in the ledger`)
    }
  }

  return { ...ledger, nodes: [...ledger.nodes, node] }
}

/**
 * Record a Meta object that already existed, purely as a parent for nodes created this session.
 * Idempotent: anchoring the same node twice is a no-op, so callers can anchor on every child add.
 */
export function anchorExistingNode(
  ledger: SessionCreatedLedger,
  node: { nodeId: string; level: CreatedNodeLevel; metaId: string },
): SessionCreatedLedger {
  if (blank(node.metaId)) throw new Error("An anchor must carry the Meta ID it already has")
  const existing = ledger.nodes.find(candidate => candidate.nodeId === node.nodeId)
  if (existing) {
    if (!existing.anchor) throw new Error(`Node is already recorded as session-created: ${node.nodeId}`)
    return ledger
  }

  return appendCreatedNode(ledger, { ...node, anchor: true })
}

/**
 * Resolve a node by either identity it can be known under: the local ID it was created with, or
 * the Meta ID it was remapped to after materialization. The UI renames a node to its Meta ID the
 * moment Meta returns one, so a later child arrives naming the parent by Meta ID while the ledger
 * still keys it by the local ID. Without this, the caller would anchor a node it actually created
 * — and the anchor would then shield it from Discard.
 */
export function findLedgerNode(
  ledger: SessionCreatedLedger,
  id: string,
): SessionCreatedNode | undefined {
  if (blank(id)) return undefined
  return ledger.nodes.find(node => node.nodeId === id || node.metaId === id)
}

export function remapCreatedNode(
  ledger: SessionCreatedLedger,
  nodeId: string,
  metaId: string,
): SessionCreatedLedger {
  if (blank(metaId)) throw new Error("Session-created node requires a Meta ID to remap to")
  const node = ledger.nodes.find(node => node.nodeId === nodeId)
  if (!node) throw new Error(`Session-created node not found: ${nodeId}`)
  if (node.anchor) throw new Error(`Anchored node is not session-created and cannot be remapped: ${nodeId}`)
  if (node.metaId && node.metaId !== metaId) {
    throw new Error(`Session-created node already maps to a different Meta ID: ${nodeId}`)
  }
  if (ledger.nodes.some(existing => existing.nodeId !== nodeId && existing.metaId === metaId)) {
    throw new Error(`Session-created node already maps to Meta ID: ${metaId}`)
  }

  return {
    ...ledger,
    nodes: ledger.nodes.map(node => node.nodeId === nodeId ? { ...node, metaId } : node),
  }
}

export function setBatchId(ledger: SessionCreatedLedger, batchId: string): SessionCreatedLedger {
  if (blank(batchId)) throw new Error("Session-created ledger requires a batch ID")
  if (ledger.batchId && ledger.batchId !== batchId) {
    throw new Error("Session-created objects cannot be associated with a different batch")
  }

  return ledger.batchId === batchId ? ledger : { ...ledger, batchId }
}

/**
 * Children before parents, newest first. Anchors are excluded: they existed before the session,
 * so deleting one would destroy a live, possibly spending, object the buyer never created here.
 */
export function pendingDeletes(ledger: SessionCreatedLedger): SessionCreatedNode[] {
  return ledger.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => !node.anchor && !blank(node.metaId))
    .sort((a, b) => DELETE_ORDER[b.node.level] - DELETE_ORDER[a.node.level] || b.index - a.index)
    .map(({ node }) => node)
}

/**
 * Removes by local node ID — never by Meta ID, which is not guaranteed unique across levels.
 * An anchor is never removed: nothing this session created it, so nothing this session deletes it.
 */
export function markDeleted(ledger: SessionCreatedLedger, nodeId: string): SessionCreatedLedger {
  if (!ledger.nodes.some(node => node.nodeId === nodeId && !node.anchor)) return ledger

  return {
    ...ledger,
    nodes: ledger.nodes.filter(node => node.nodeId !== nodeId),
  }
}
