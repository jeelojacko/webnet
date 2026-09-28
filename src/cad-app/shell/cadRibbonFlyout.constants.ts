// Phase 21B — single source of truth for the tool-family flyout box.
//
// These MUST match `.cad-ribbon-flyout` max-width / max-height in
// cadShell.css (22rem = 352px at the 16px root / 260px). Keeping the CSS box
// and the caret-anchor math on one constant set is what stops the fixed
// menu from painting off-viewport: CadRibbonSplitButton clamps the anchor
// with these numbers and also hands the element a viewport-capped inline
// max-height so tall menus scroll internally instead of running off screen.
export const CAD_RIBBON_FLYOUT_MAX_WIDTH_PX = 352; // 22rem
export const CAD_RIBBON_FLYOUT_MAX_HEIGHT_PX = 260;
/** Gap kept between the menu and every viewport edge. */
export const CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX = 8;
/** Gap between the caret/primary face and the menu. */
export const CAD_RIBBON_FLYOUT_CARET_GAP_PX = 2;

/**
 * Viewport anchor for the fixed-position menu. `maxHeight` is the
 * viewport-capped box height (never above the CSS max); the menu scrolls
 * internally when its rows exceed it.
 */
export interface CadRibbonFlyoutAnchor {
  top: number;
  left: number;
  maxHeight: number;
}
