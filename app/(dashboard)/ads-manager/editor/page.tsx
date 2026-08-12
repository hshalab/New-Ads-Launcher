import { Suspense } from "react"
import { AdsManagerEditorRoute } from "@/components/ads-manager/AdsManagerEditorRoute"

/**
 * Standalone editor: refresh, a pasted link, or a new tab. No table is mounted behind it, so
 * Collapse view is disabled — `intercepted` stays false.
 */
export default function EditorPage() {
  return (
    <div className="relative h-full min-h-0">
      <Suspense fallback={null}>
        <AdsManagerEditorRoute />
      </Suspense>
    </div>
  )
}
