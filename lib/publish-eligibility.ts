import { isLaunchable } from "./creative-readiness"

export type PublishLevel = "campaign" | "adset" | "ad"

export type PublishWorkspaceNode = {
  id: string
  level: PublishLevel
  metaId?: string
  parentId?: string
  materializeError?: string
  creative?: {
    fb_image_hash?: string | null
    fb_video_id?: string | null
  }
}

export type PublishBlocker =
  | { code: "MISSING_LEVEL"; level: PublishLevel }
  | { code: "MISSING_META_ID"; nodeId: string }
  | { code: "MATERIALIZE_FAILED"; nodeId: string; message: string }
  | { code: "CREATIVE_NOT_READY"; nodeId: string }

export type PublishEligibility = {
  eligible: boolean
  reasons: PublishBlocker[]
}

const REQUIRED_LEVELS: PublishLevel[] = ["campaign", "adset", "ad"]

export function publishEligibility({
  nodes,
}: {
  nodes: PublishWorkspaceNode[]
}): PublishEligibility {
  const reasons: PublishBlocker[] = []

  for (const level of REQUIRED_LEVELS) {
    if (!nodes.some(node => node.level === level)) reasons.push({ code: "MISSING_LEVEL", level })
  }

  for (const node of nodes) {
    if (!node.metaId?.trim()) reasons.push({ code: "MISSING_META_ID", nodeId: node.id })
    if (node.materializeError) {
      reasons.push({ code: "MATERIALIZE_FAILED", nodeId: node.id, message: node.materializeError })
    }
    if (node.level === "ad" && !isLaunchable(node.creative ?? {})) {
      reasons.push({ code: "CREATIVE_NOT_READY", nodeId: node.id })
    }
  }

  return { eligible: reasons.length === 0, reasons }
}
