"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type LaunchPhase =
  | "idle"
  | "validating"
  | "preparing"
  | "launching"
  | "success"
  | "error"

export interface LaunchProgressAd {
  name: string
  status: string
}

interface LaunchProgressDialogProps {
  phase: LaunchPhase
  open: boolean
  onOpenChange: (open: boolean) => void
  error?: string | null
  plannedAds?: LaunchProgressAd[]
  result?: { success: number; errors: number; total: number; ads?: LaunchProgressAd[] } | null
}

export function LaunchProgressDialog({
  phase,
  open,
  onOpenChange,
  error,
  plannedAds = [],
  result
}: LaunchProgressDialogProps) {
  const getStatusContent = () => {
    switch (phase) {
      case "idle":
        return null
      case "validating":
        return (
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <IconLoader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm text-muted-foreground">Validating creatives and ad sets...</p>
          </div>
        )
      case "preparing":
        return (
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <IconLoader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm text-muted-foreground">Preparing launch payload...</p>
          </div>
        )
      case "launching":
        return (
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <IconLoader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm text-muted-foreground">Launching ads to Meta...</p>
          </div>
        )
      case "success":
        return (
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <IconCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-center">
              <p className="font-medium">Launch Complete!</p>
              {result && (
                <p className="text-sm text-muted-foreground mt-1">
                  Successfully created {result.success} out of {result.total} ads.
                  {result.errors > 0 && ` (${result.errors} failed)`}
                </p>
              )}
            </div>
            <Button onClick={() => onOpenChange(false)} className="mt-2">
              Close
            </Button>
          </div>
        )
      case "error":
        return (
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <IconX className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <div className="text-center">
              <p className="font-medium">Launch Failed</p>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1 max-w-[300px]">
                {error || "An unknown error occurred during launch."}
              </p>
            </div>
            <Button onClick={() => onOpenChange(false)} variant="secondary" className="mt-2">
              Close
            </Button>
          </div>
        )
    }
  }

  if (!open && phase !== "idle") {
    const active = phase === "validating" || phase === "preparing" || phase === "launching"
    const ads = result?.ads || plannedAds

    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-20 z-[60] w-[min(360px,calc(100vw-6rem))] overflow-hidden rounded-xl border bg-background text-left shadow-lg"
      >
        <div className="flex w-full items-center gap-3 px-4 py-3 text-left">
          {active && <IconLoader2 className="size-5 shrink-0 animate-spin text-blue-500" />}
          {phase === "success" && <IconCheck className="size-5 shrink-0 text-green-600" />}
          {phase === "error" && <IconX className="size-5 shrink-0 text-red-600" />}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {active ? "Launching ads..." : phase === "success" ? "Launch complete" : "Launch failed"}
            </span>
            <span className="block text-xs text-muted-foreground">
              {result ? `${result.success}/${result.total} succeeded` : `${ads.length} ads in progress`}
            </span>
          </span>
        </div>

        <div className="border-t px-4 py-3">
          {ads.length > 0 ? (
            <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
              {ads.map((ad, index) => (
                <div key={`${ad.name}-${index}`} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate" title={ad.name}>{ad.name}</span>
                  {ad.status === "launching" ? (
                    <span className="flex shrink-0 items-center gap-1 text-blue-600 dark:text-blue-400">
                      <IconLoader2 className="size-3 animate-spin" />Launching
                    </span>
                  ) : (
                    <span className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 font-medium capitalize",
                      ad.status === "error"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    )}>
                      {ad.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Preparing ad rows...</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {phase === "success" ? "Success" : phase === "error" ? "Error" : "Launching Ads"}
          </DialogTitle>
          <DialogDescription className="hidden">
            Status of your current ad launch operation.
          </DialogDescription>
        </DialogHeader>
        {getStatusContent()}
      </DialogContent>
    </Dialog>
  )
}
