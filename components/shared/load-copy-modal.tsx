"use client"

import { useEffect, useMemo, useState } from "react"
import {
  IconBuildingStore,
  IconCopy,
  IconLoader2,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

export interface AdCopyValues {
  primaryText: string
  headline: string
  description?: string
  link?: string
  cta: string
}

interface AdCopyTemplate extends AdCopyValues {
  id: string
  name: string
  createdAt: string
}

interface ExistingAd extends AdCopyValues {
  id: string
  name?: string
}

interface DbAdCopyTemplate {
  id: string
  name: string
  primary_text?: string
  headline?: string
  description?: string
  link?: string
  cta?: string
  created_at: string
}

interface Props {
  open: boolean
  onClose: () => void
  adAccountId: string
  adAccountName: string
  current: AdCopyValues
  onApply: (copy: AdCopyValues) => void
}

const dbToTemplate = (template: DbAdCopyTemplate): AdCopyTemplate => ({
  id: template.id,
  name: template.name,
  primaryText: template.primary_text || "",
  headline: template.headline || "",
  description: template.description || "",
  link: template.link || "",
  cta: template.cta || "SHOP_NOW",
  createdAt: template.created_at,
})

export function LoadCopyModal({
  open,
  onClose,
  adAccountId,
  adAccountName,
  current,
  onApply,
}: Props) {
  const [source, setSource] = useState<"templates" | "ads">("templates")
  const [templates, setTemplates] = useState<AdCopyTemplate[]>([])
  const [existingAds, setExistingAds] = useState<ExistingAd[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [templateName, setTemplateName] = useState("")

  useEffect(() => {
    if (!open) return
    setSource("templates")
    setSearch("")
    setTemplateName("")
    setLoading(true)
    fetch("/api/templates")
      .then(response => response.json())
      .then(data => setTemplates((data.templates || []).map(dbToTemplate)))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false))
  }, [open])

  const loadExistingAds = async () => {
    setSource("ads")
    if (existingAds.length || !adAccountId) return
    setLoading(true)
    try {
      const response = await fetch(
        `/api/facebook/existing-ads?ad_account_id=${encodeURIComponent(adAccountId)}&active_only=1&limit=100`
      )
      const data = await response.json()
      const seen = new Set<string>()
      setExistingAds((data.ads || []).filter((ad: ExistingAd) => {
        if (!ad.primaryText && !ad.headline) return false
        const key = `${ad.primaryText || ""}|${ad.headline || ""}|${ad.link || ""}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }))
    } finally {
      setLoading(false)
    }
  }

  const defaultCopy = useMemo<AdCopyValues | null>(() => {
    if (!open || !adAccountId) return null
    try {
      const raw = localStorage.getItem(`default_ad_settings_${adAccountId}`)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return {
        primaryText: parsed.adCopy?.primaryText || "",
        headline: parsed.adCopy?.headline || "",
        description: parsed.adCopy?.description || "",
        link: parsed.links?.webLink || "",
        cta: parsed.adCopy?.cta || "SHOP_NOW",
      }
    } catch {
      return null
    }
  }, [open, adAccountId])

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const values = source === "templates" ? templates : existingAds
    if (!query) return values
    return values.filter(item =>
      [item.name, item.primaryText, item.headline].some(value => value?.toLowerCase().includes(query))
    )
  }, [existingAds, search, source, templates])

  const apply = (copy: AdCopyValues) => {
    onApply(copy)
    onClose()
  }

  const saveCurrent = async () => {
    if (!templateName.trim() || !adAccountId) return
    setSaving(true)
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_account_id: adAccountId,
          name: templateName.trim(),
          primary_text: current.primaryText,
          headline: current.headline,
          description: current.description || "",
          link: current.link || "",
          cta: current.cta,
        }),
      })
      const data = await response.json()
      if (response.ok && data.template) {
        setTemplates(previous => [dbToTemplate(data.template), ...previous])
        setTemplateName("")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <div className="flex items-start justify-between gap-3 border-b py-4 pl-5 pr-16 sm:items-center">
          <div className="min-w-0">
            <DialogTitle className="text-base">Load copy</DialogTitle>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <IconBuildingStore className="size-3.5" />
              {adAccountName || "Selected ad account"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant={source === "templates" ? "default" : "outline"}
              onClick={() => setSource("templates")}
            >
              Templates
            </Button>
            <Button
              size="sm"
              variant={source === "ads" ? "default" : "outline"}
              onClick={loadExistingAds}
            >
              <IconCopy className="mr-1.5 size-3.5" />
              Previous ads
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 border-b bg-muted/20 px-5 py-3">
          <div className="relative flex-1">
            <IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search copy..."
              className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          {source === "templates" && (
            <>
              <input
                value={templateName}
                onChange={event => setTemplateName(event.target.value)}
                placeholder="Save current as..."
                className="h-9 w-44 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
              />
              <Button size="sm" onClick={saveCurrent} disabled={saving || !templateName.trim()}>
                {saving ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlus className="size-4" />}
              </Button>
            </>
          )}
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <IconLoader2 className="size-5 animate-spin" />
              Loading copy...
            </div>
          ) : (
            <>
              {source === "templates" && defaultCopy && (defaultCopy.primaryText || defaultCopy.headline) && (
                <CopyRow name="Default settings" copy={defaultCopy} onApply={() => apply(defaultCopy)} />
              )}
              {rows.map(item => (
                <CopyRow
                  key={item.id}
                  name={item.name || "Previous ad"}
                  copy={item}
                  onApply={() => apply(item)}
                />
              ))}
              {rows.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">No copy found.</p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CopyRow({
  name,
  copy,
  onApply,
}: {
  name: string
  copy: AdCopyValues
  onApply: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{name}</p>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {copy.primaryText || "No primary text"}
        </p>
        <p className="mt-1 truncate text-xs font-medium">{copy.headline || "No headline"}</p>
      </div>
      <Button size="sm" onClick={onApply}>Apply</Button>
    </div>
  )
}
