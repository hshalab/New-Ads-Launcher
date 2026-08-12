/**
 * Creative readiness module.
 *
 * `creatives.status` is the **Meta upload lifecycle**, not a file-readiness or
 * launch lifecycle. The vocabulary lives here so raw status strings cannot drift
 * across the Portal import, upload cron, and launch routes (see TD-30).
 *
 * Lifecycle:
 *   pending → processing → ready, error off the side
 *   pending → ready is legal for images (no Meta transcoding step).
 *
 * Launchability is NOT status: it is "Meta has the asset" — `fb_image_hash` or
 * `fb_video_id` present. A creative can be `ready` and still carry no asset id
 * if status drifted; launch routes must ask `assertLaunchable`, never `status`.
 */

export type CreativeStatus = "pending" | "processing" | "ready" | "error"

export const CREATIVE_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  READY: "ready",
  ERROR: "error",
} as const satisfies Record<string, CreativeStatus>

export type LaunchableCreative = {
  id: string
  status: CreativeStatus
  fb_image_hash: string | null
  fb_video_id: string | null
  file_name: string | null
}

/** A creative is launchable iff Meta has the asset — status alone is not proof. */
export function isLaunchable(c: {
  fb_image_hash?: string | null
  fb_video_id?: string | null
}): boolean {
  return Boolean(c.fb_image_hash || c.fb_video_id)
}

export class CreativeNotReadyError extends Error {
  constructor(public readonly creative: LaunchableCreative) {
    super(
      `Creative "${creative.file_name ?? creative.id}" not yet uploaded to Meta. ` +
      `Open Ads Manager and upload it before launching.`,
    )
    this.name = "CreativeNotReadyError"
  }
}

/** Throw if a creative is not launchable. Tests and launch routes cross this seam. */
export function assertLaunchable(c: LaunchableCreative): void {
  if (!isLaunchable(c)) throw new CreativeNotReadyError(c)
}

/**
 * Guard the upload cron's status writes. Only `pending` and `processing`
 * creatives may be marked uploaded/ready; anything else is a corrupted state
 * we want to surface loudly rather than silently overwrite.
 */
export function assertCanMarkUploaded(current: string): void {
  if (current !== CREATIVE_STATUS.PENDING && current !== CREATIVE_STATUS.PROCESSING) {
    throw new Error(
      `Cannot mark creative uploaded from status "${current}" (expected pending or processing)`,
    )
  }
}
