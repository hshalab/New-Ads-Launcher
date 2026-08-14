// Existing Ads post-reuse: synthetic creative id -> validated Meta post identity.
// Synthetic creative id format: `existing_<adId>`. It carries no asset of its own;
// the ad is launched by reusing the source ad's `object_story_id` (`<pageId>_<postId>`).
export const EXISTING_PREFIX = "existing_"

export const isExistingAdCreativeId = (id: string): boolean => id.startsWith(EXISTING_PREFIX)

export interface ExistingAdSource {
  adId: string
  postId: string
}

export function resolveExistingAdSources(
  creativeIds: string[],
  sources: Record<string, ExistingAdSource> | undefined,
  pageId: string,
): {
  resolved: Map<string, ExistingAdSource>
  errors: { creativeId: string; error: string }[]
} {
  const resolved = new Map<string, ExistingAdSource>()
  const errors: { creativeId: string; error: string }[] = []

  for (const creativeId of creativeIds) {
    const source = sources?.[creativeId]

    if (!source || !source.adId || !source.postId) {
      errors.push({ creativeId, error: "Existing ad has no post to reuse" })
      continue
    }

    if (creativeId !== `${EXISTING_PREFIX}${source.adId}`) {
      errors.push({ creativeId, error: "Existing ad source does not match creative id" })
      continue
    }

    const [postPageId, ...rest] = source.postId.split("_")
    if (!postPageId || rest.length === 0 || !rest.join("_")) {
      errors.push({ creativeId, error: "Existing ad post id is malformed" })
      continue
    }

    if (postPageId !== pageId) {
      errors.push({ creativeId, error: "Existing ad belongs to a different Page" })
      continue
    }

    resolved.set(creativeId, source)
  }

  return { resolved, errors }
}
