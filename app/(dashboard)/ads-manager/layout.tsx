/**
 * Ads Manager shell.
 *
 * The `@editor` parallel slot lets the editor render OVER a still-mounted table on soft
 * navigation, which is the whole point of Collapse view — there has to be a live table behind the
 * overlay for collapsing to reveal anything.
 *
 * `relative` here, not `fixed` in the editor: the editor covers the Ads Manager main area and
 * leaves the app sidebar alone. The children wrapper owns the scroll so the editor cannot scroll
 * away with the table underneath it.
 */
export default function AdsManagerLayout({
  children,
  editor,
}: {
  children: React.ReactNode
  editor: React.ReactNode
}) {
  return (
    <div className="relative h-full min-h-0">
      <div className="h-full overflow-auto">{children}</div>
      {editor}
    </div>
  )
}
