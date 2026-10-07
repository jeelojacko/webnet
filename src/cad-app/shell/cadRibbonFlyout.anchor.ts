// Phase 21B / post-L1 — pure viewport anchor for the fixed tool-family flyout.
//
// One source of truth for where the menu paints and how tall it may be. The
// menu is never positioned by subtracting a guessed/max height: the side with
// the most room is chosen from the caret rect, and that side's room becomes the
// inline max-height (natural content height wins whenever the room is larger).
import {
  CAD_RIBBON_FLYOUT_CARET_GAP_PX,
  CAD_RIBBON_FLYOUT_MAX_WIDTH_PX,
  CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX,
} from './cadRibbonFlyout.constants';

/** Which way the menu opens relative to the caret. */
export type CadRibbonFlyoutSide = 'down' | 'up';

/** The minimum viewport-space geometry the anchor needs from the caret. */
export interface CadRibbonFlyoutCaretRect {
  top: number;
  bottom: number;
  left: number;
}

/**
 * Viewport anchor for the fixed-position menu.
 *
 * `maxHeight` is the room actually available on `side` (never a fixed product
 * cap). Exactly one of `top`/`bottom` is set to match the fixed positioning
 * contract: downward menus anchor with `top = caret.bottom + gap`; upward menus
 * anchor with `bottom = viewportHeight - caret.top + gap`.
 */
export interface CadRibbonFlyoutAnchor {
  left: number;
  maxHeight: number;
  side: CadRibbonFlyoutSide;
  /** Viewport-space offset from the top; set when `side === 'down'`. */
  top: number | null;
  /** Viewport-space offset from the bottom; set when `side === 'up'`. */
  bottom: number | null;
}

/**
 * Resolve the fixed anchor for an open flyout.
 *
 * Space is measured from the caret rect plus the shared margin/gap. The roomier
 * side wins (a top ribbon normally opens down); the chosen side's room becomes
 * the inline max-height so the menu is always fully inside the viewport, at any
 * height. Horizontal left is clamped into `[margin, viewportWidth - maxWidth - margin]`.
 */
export function resolveCadRibbonFlyoutAnchor(
  caret: CadRibbonFlyoutCaretRect,
  viewportWidth: number,
  viewportHeight: number,
): CadRibbonFlyoutAnchor {
  const margin = CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX;
  const gap = CAD_RIBBON_FLYOUT_CARET_GAP_PX;
  const spaceBelow = viewportHeight - caret.bottom - gap - margin;
  const spaceAbove = caret.top - gap - margin;
  const side: CadRibbonFlyoutSide = spaceAbove > spaceBelow ? 'up' : 'down';
  // Positive and bounded even on a degenerate/tiny viewport.
  const maxHeight = Math.max(1, side === 'up' ? spaceAbove : spaceBelow);
  const maxLeft = Math.max(margin, viewportWidth - CAD_RIBBON_FLYOUT_MAX_WIDTH_PX - margin);
  const left = Math.max(margin, Math.min(caret.left, maxLeft));
  if (side === 'up') {
    return {
      left,
      maxHeight,
      side,
      top: null,
      bottom: viewportHeight - caret.top + gap,
    };
  }
  return {
    left,
    maxHeight,
    side,
    top: caret.bottom + gap,
    bottom: null,
  };
}
