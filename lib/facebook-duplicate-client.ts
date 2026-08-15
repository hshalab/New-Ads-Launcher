export type DuplicateAdTopologyInput = {
  id: string
  adsetId: string
  campaignId: string
}

export type DuplicateAdTopologyGroup<T extends DuplicateAdTopologyInput> = {
  sourceCampaignId: string
  adGroups: T[][]
}

export function planDuplicateAdTopology<T extends DuplicateAdTopologyInput>(
  selectedAds: T[],
  oneAdPerAdSet: boolean,
  preserveSourceCampaigns: boolean,
): DuplicateAdTopologyGroup<T>[] {
  if (selectedAds.length === 0) return []
  if (!oneAdPerAdSet) {
    return [{ sourceCampaignId: selectedAds[0].campaignId, adGroups: [selectedAds] }]
  }
  if (!preserveSourceCampaigns) {
    return [{ sourceCampaignId: selectedAds[0].campaignId, adGroups: selectedAds.map(ad => [ad]) }]
  }

  const byCampaign = new Map<string, T[]>()
  for (const ad of selectedAds) {
    byCampaign.set(ad.campaignId, [...(byCampaign.get(ad.campaignId) || []), ad])
  }
  return [...byCampaign].map(([sourceCampaignId, ads]) => ({
    sourceCampaignId,
    adGroups: ads.map(ad => [ad]),
  }))
}

type DuplicateCampaignResponse = {
  campaigns?: Array<{ id: string; name: string; adSets?: Array<{ id: string; name: string }> }>
  warnings?: string[]
}

export type DuplicateAdSetsResponse = {
  campaigns?: Array<{
    id: string
    adSets?: Array<{ id: string; name: string; copiedAdIds?: string[] }>
  }>
  errors?: string[]
  warnings?: string[]
}

async function postDuplicate<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || data.errors?.[0] || `HTTP ${response.status}`)
  return data as T
}

export function duplicateCampaignCopies(sourceCampaignId: string, body: Record<string, unknown>) {
  return postDuplicate<DuplicateCampaignResponse>(
    `/api/facebook/campaigns/${encodeURIComponent(sourceCampaignId)}/duplicate`,
    body,
  )
}

export function duplicateAdSetsIntoCampaigns(body: Record<string, unknown>) {
  return postDuplicate<DuplicateAdSetsResponse>("/api/facebook/campaigns/duplicate-adsets", body)
}

export function duplicateSingleAdSet(
  sourceAdSetId: string,
  adAccountId: string,
  body: Record<string, unknown>,
) {
  return postDuplicate<{ adSet: Record<string, unknown> }>(
    `/api/facebook/adsets/${encodeURIComponent(sourceAdSetId)}/duplicate?ad_account_id=${encodeURIComponent(adAccountId)}`,
    body,
  )
}
