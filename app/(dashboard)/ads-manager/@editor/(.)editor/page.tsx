import { Suspense } from "react"
import { AdsManagerEditorRoute } from "@/components/ads-manager/AdsManagerEditorRoute"

/**
 * Intercepted route: reached by soft navigation from the Ads Manager table, which stays mounted
 * in `children`. `intercepted` is what enables Collapse view.
 */
export default function InterceptedEditorPage() {
  return (
    <Suspense fallback={null}>
      <AdsManagerEditorRoute intercepted />
    </Suspense>
  )
}
