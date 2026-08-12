/**
 * Safe merge of editor-staged targeting onto the ad set's live Meta targeting.
 *
 * Meta treats `targeting` as a whole-object REPLACE: whatever you POST becomes the entire
 * targeting spec. The Ads Manager editor hydrates its draft from a partial detail read
 * (`app/api/facebook/adsets/[id]/detail/route.ts` requests a targeting sub-selection), so the
 * draft never carries `excluded_geo_locations`, `locales`, `exclusions`, `targeting_automation`
 * or `brand_safety_content_filter_levels`. Publishing the draft verbatim erased them — TD-37.
 *
 * The fix: re-read targeting from Meta at publish time and overlay only the keys the editor
 * actually writes. Everything else is remote-wins.
 */

/**
 * Keys the editor has a real write path for. Read-only surfaces (`custom_audiences`,
 * `excluded_custom_audiences`, `flexible_spec` — rendered as chips, never mutated) are
 * deliberately excluded: remote-wins is strictly safer than writing back a value that only
 * ever came from a trimmed read.
 */
export const EDITOR_OWNED_TARGETING_KEYS = [
  "geo_locations",
  "excluded_geo_locations",
  "age_min",
  "age_max",
  "genders",
  "targeting_optimization",
  "publisher_platforms",
  "device_platforms",
] as const

/**
 * Keys where *absence* in the draft is itself the edit. Advantage+ placements are expressed by
 * having no platform lists at all, so the editor deletes these rather than sending an empty
 * array. For every other owned key, absence means "not loaded" and the remote value survives.
 *
 * `excluded_geo_locations` joined this list when the Locations editor shipped an Exclude control:
 * removing the last exclusion is expressed by the key being gone, so without it here a removal
 * would silently bounce back from the remote read on the next publish. This is only safe because
 * the ad set detail read now requests the key — see
 * `app/api/facebook/adsets/[id]/detail/route.ts`. Adding a removable key without also hydrating
 * it recreates TD-37 in the opposite direction: absence would mean "never loaded" and we would
 * delete a value the user never touched.
 */
export const REMOVABLE_TARGETING_KEYS = [
  "publisher_platforms",
  "device_platforms",
  "excluded_geo_locations",
] as const

/** Meta rejects position lists for platforms that are not selected. */
const POSITION_KEY_BY_PLATFORM: Record<string, string> = {
  facebook: "facebook_positions",
  instagram: "instagram_positions",
  audience_network: "audience_network_positions",
  messenger: "messenger_positions",
}

type Targeting = Record<string, unknown>

function asTargeting(value: unknown): Targeting {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Targeting) } : {}
}

/** Key-order-insensitive deep compare, so a reserialized-but-identical spec is not a change. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const entries = Object.entries(value as Targeting)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`
}

export type TargetingMerge = {
  /** The full spec to POST. Only meaningful when `changed` is true. */
  targeting: Targeting
  /** False when the merge is byte-equivalent to what Meta already has — caller must omit the key. */
  changed: boolean
}

/**
 * Overlay the editor-owned keys of `draft` onto `remote`, preserving every key the editor
 * cannot see.
 *
 * @param remote  targeting as just read from Meta — the base that must survive
 * @param draft   targeting as staged by the editor, possibly missing keys it never read
 */
export function mergeEditorTargeting(remote: unknown, draft: unknown): TargetingMerge {
  const base = asTargeting(remote)
  const staged = asTargeting(draft)
  const merged: Targeting = { ...base }

  for (const key of EDITOR_OWNED_TARGETING_KEYS) {
    const stagedValue = staged[key]
    if (stagedValue !== undefined) {
      merged[key] = stagedValue
      continue
    }
    // Absent and removable → the editor deleted it (Advantage+ placements).
    if ((REMOVABLE_TARGETING_KEYS as readonly string[]).includes(key)) delete merged[key]
    // Absent and not removable → the draft never loaded it; keep whatever Meta has.
  }

  const platforms = Array.isArray(merged.publisher_platforms) ? merged.publisher_platforms as string[] : []
  for (const [platform, positionKey] of Object.entries(POSITION_KEY_BY_PLATFORM)) {
    if (!platforms.includes(platform)) delete merged[positionKey]
  }

  return { targeting: merged, changed: stableStringify(merged) !== stableStringify(base) }
}
