// Phase 21B / post-L1 — single source of truth for the tool-family flyout box.
//
// Only the immutable box properties live here. `CAD_RIBBON_FLYOUT_MAX_WIDTH_PX`
// mirrors `.cad-ribbon-flyout` max-width in cadShell.css (22rem = 352px at the
// 16px root); the viewport margin and caret gap feed the anchor math.
//
// There is deliberately NO product max-height constant. The menu prefers its
// natural content height and is capped only by the actual viewport room on the
// chosen side (`resolveCadRibbonFlyoutAnchor` in cadRibbonFlyout.anchor.ts):
// a full desktop viewport shows every row, and only a short viewport scrolls.
export const CAD_RIBBON_FLYOUT_MAX_WIDTH_PX = 352; // 22rem
/** Gap kept between the menu and every viewport edge. */
export const CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX = 8;
/** Gap between the caret/primary face and the menu. */
export const CAD_RIBBON_FLYOUT_CARET_GAP_PX = 2;
