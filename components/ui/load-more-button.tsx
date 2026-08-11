"use client"

import type { ReactNode } from "react"
import { IconChevronDown, IconLoader2 } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface LoadMoreButtonProps {
  onClick: () => void
  loading?: boolean
  remaining?: number
  loaded?: number
  className?: string
  variant?: "outline" | "ghost"
  children?: ReactNode
}

export function LoadMoreButton({
  onClick,
  loading = false,
  remaining,
  loaded,
  className,
  variant = "outline",
  children,
}: LoadMoreButtonProps) {
  const label = children
    ?? (remaining != null
      ? `Load more (${remaining} more)`
      : loaded != null
        ? `Load More (${loaded} loaded)`
        : "Load more")

  return (
    <div className={cn("flex justify-center", className)}>
      <Button
        type="button"
        variant={variant}
        size="sm"
        onClick={onClick}
        disabled={loading}
        className="gap-1.5 min-w-[140px] text-xs"
      >
        {loading ? (
          <>
            <IconLoader2 className="size-3.5 animate-spin" />
            Loading…
          </>
        ) : (
          <>
            <IconChevronDown className="size-3.5" />
            {label}
          </>
        )}
      </Button>
    </div>
  )
}
