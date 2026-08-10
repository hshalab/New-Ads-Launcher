"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  IconAlertCircle, IconAlertTriangle, IconLoader2, IconPlayerPlay, IconX,
} from "@tabler/icons-react"

interface PreviewEntity {
  id: string
  name?: string
  effective_status?: string
}

function conditionBullets(text: string): string[] {
  const prefix = "If "
  if (!text.startsWith(prefix)) return [text]
  return text.slice(prefix.length).split(" and ")
}

/**
 * "If your rule were to run now, what would it touch?"
 *
 * Meta's own dialog pairs this answer with a Run button, and so does ours — but Run is a
 * real mutation with no undo, so it asks for a second confirmation once it knows the count.
 */
export function RulePreviewDialog({
  open, onClose, ruleId, ruleName, actionLabel, conditionText, adAccountId, onExecuted,
}: {
  open: boolean
  onClose: () => void
  ruleId: string
  ruleName: string
  actionLabel: string
  conditionText: string
  adAccountId: string
  onExecuted: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [entities, setEntities] = useState<PreviewEntity[]>([])
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    if (!ruleId || !adAccountId) return
    setLoading(true)
    setError("")
    setConfirming(false)
    try {
      const res = await fetch(`/api/facebook/rules/${ruleId}/preview?adAccountId=${adAccountId}`)
      const d = await res.json()
      if (!res.ok) return setError(d.error || "Preview failed")
      setEntities(d.entities || [])
      setTruncated(Boolean(d.truncated))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [ruleId, adAccountId])

  useEffect(() => { if (open) load() }, [open, load])

  async function handleRun() {
    setRunning(true)
    setError("")
    try {
      const res = await fetch(`/api/facebook/rules/${ruleId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adAccountId }),
      })
      const d = await res.json()
      if (!res.ok) return setError(d.error || "Run failed")
      onExecuted()
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background rounded-xl shadow-2xl border w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="min-w-0">
            <h2 className="font-semibold text-lg">Preview of rule results</h2>
            <p className="text-xs text-muted-foreground truncate">{ruleName}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <IconX className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="text-sm space-y-1">
            <div className="font-medium">{actionLabel}</div>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1 mt-1">
              {conditionBullets(conditionText).map((cond, idx) => (
                <li key={idx}>{cond}</li>
              ))}
            </ul>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-sm">
              <IconAlertCircle className="size-4 flex-shrink-0 mt-0.5" />{error}
            </div>
          ) : entities.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              If this rule ran now, nothing would meet its conditions.
            </p>
          ) : (
            <>
              <p className="text-sm">
                If this rule ran now, it would affect{" "}
                <span className="font-semibold">{entities.length}{truncated ? "+" : ""}</span>{" "}
                {entities.length === 1 ? "entity" : "entities"}:
              </p>
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {entities.map(e => (
                  <div key={e.id} className="px-3 py-2 text-sm">
                    <div className="truncate">{e.name || e.id}</div>
                    <div className="text-xs text-muted-foreground font-mono">{e.id}</div>
                  </div>
                ))}
              </div>
              {truncated && (
                <p className="text-xs text-muted-foreground">
                  Meta returned only the first page — the real count is higher.
                </p>
              )}
            </>
          )}

          {confirming && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-400 text-sm">
              <IconAlertTriangle className="size-4 flex-shrink-0 mt-0.5" />
              <span>
                Running now applies the action to {entities.length} {entities.length === 1 ? "entity" : "entities"} immediately.
                There is no undo — turning them back on is manual.
              </span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {confirming ? (
            <Button variant="destructive" onClick={handleRun} disabled={running}>
              {running ? <IconLoader2 className="size-4 animate-spin mr-1" /> : <IconPlayerPlay className="size-4 mr-1" />}
              Yes, run it now
            </Button>
          ) : (
            <Button onClick={() => setConfirming(true)} disabled={loading || Boolean(error) || entities.length === 0}>
              <IconPlayerPlay className="size-4 mr-1" /> Run
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
