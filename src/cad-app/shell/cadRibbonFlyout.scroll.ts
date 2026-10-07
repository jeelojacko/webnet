// Phase 21B / post-L1 — container-only "reveal the focused row" helper.
//
// The flyout is a vertical scroll box (`overflow-y: auto`) that stays
// DOM-descended from the ribbon strip's horizontal scroll container. Bringing
// an off-screen row into view must never touch an ancestor scroller: a plain
// `focus()` or `element.scrollIntoView()` pans the strip, and the resulting
// external-target scroll event self-closes the just-opened menu through the
// split button's scroll law.
//
// The math is deliberately scoped to the flyout's own `scrollTop` coordinate
// space. `offsetTop` is measured from this positioned container's padding edge
// — the same space `scrollTop` uses — so only `container.scrollTop` is ever
// written and the ribbon strip and page never move.

/**
 * Scroll `container` (the flyout `<ul>`) by the minimum amount that makes
 * `row` fully visible. No-op when the row is already visible, when either
 * argument is missing, or when the container cannot scroll.
 */
export function ensureCadRibbonFlyoutRowVisible(
  container: HTMLElement | null,
  row: HTMLElement | null,
): void {
  if (container == null || row == null) return;
  const rowTop = row.offsetTop;
  const rowBottom = rowTop + row.offsetHeight;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;
  if (rowTop < viewTop) {
    container.scrollTop = rowTop;
    return;
  }
  if (rowBottom > viewBottom) {
    container.scrollTop = rowBottom - container.clientHeight;
  }
}
