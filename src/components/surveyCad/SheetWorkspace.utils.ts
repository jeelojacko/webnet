import {
  STANDARD_VIEWPORT_SCALES,
  suggestViewportScale,
} from '../../engine/cad/cadSheets';
import type {
  DraftSheet,
  DraftSheetObject,
  DraftSheetViewport,
} from '../../engine/cad/cadDraftTypes';
import type { PaperSelection } from './SheetWorkspace.types';

/** Rotation pins to 0–360 (NaN/non-finite → 0); -45° reads as 315°. */
export const normalizeRotationDeg = (deg: number): number =>
  typeof deg !== 'number' || !Number.isFinite(deg) ? 0 : ((deg % 360) + 360) % 360;

export const isViewportLocked = (viewport: DraftSheetViewport): boolean =>
  viewport.locked === true;

/**
 * GO gate: layout ops touch paper fields / modelCenter / scale / rotation
 * only. Move/resize below never alter modelCenter, scaleDenominator, or any
 * model coordinate — enforced by construction (fresh object, paper keys).
 */
export const moveViewportPaper = (
  viewport: DraftSheetViewport,
  dxMm: number,
  dyMm: number,
): DraftSheetViewport => {
  if (isViewportLocked(viewport)) return viewport;
  return { ...viewport, paperXmm: viewport.paperXmm + dxMm, paperYmm: viewport.paperYmm + dyMm };
};

/** Resize touches paper W/H only; scale + center are preserved (§25). */
export const resizeViewportPaper = (
  viewport: DraftSheetViewport,
  widthMm: number,
  heightMm: number,
): DraftSheetViewport => {
  if (isViewportLocked(viewport)) return viewport;
  return {
    ...viewport,
    paperWidthMm: Math.max(1, widthMm),
    paperHeightMm: Math.max(1, heightMm),
  };
};

/** Pan View: modelCenter moves, the paper frame is fixed (locked blocks). */
export const panViewportModelCenter = (
  viewport: DraftSheetViewport,
  center: { x: number; y: number },
): DraftSheetViewport => {
  if (isViewportLocked(viewport)) return viewport;
  return { ...viewport, modelCenterX: center.x, modelCenterY: center.y };
};

export const setViewportDenominator = (
  viewport: DraftSheetViewport,
  scaleDenominator: number,
): DraftSheetViewport | undefined => {
  if (isViewportLocked(viewport)) return undefined;
  if (!Number.isFinite(scaleDenominator) || scaleDenominator <= 0) return undefined;
  return { ...viewport, scaleDenominator };
};

/** Insertion-grip move for north-arrow / scale-bar / plan-note objects. */
export const movePaperObject = (
  object: DraftSheetObject,
  dxMm: number,
  dyMm: number,
): DraftSheetObject => ({ ...object, paperXmm: object.paperXmm + dxMm, paperYmm: object.paperYmm + dyMm });

/**
 * Fit scale with an explicit exact-vs-standard choice — never silent
 * rounding. 'exact' takes suggestViewportScale verbatim; 'standard' rounds
 * UP to the next standard scale (exact itself when already standard or
 * beyond the largest standard).
 */
export const resolveFitScale = (
  args: { modelWidthM: number; modelHeightM: number; paperWidthMm: number; paperHeightMm: number },
  mode: 'exact' | 'standard',
): number | undefined => {
  const exact = suggestViewportScale(args);
  if (exact == null) return undefined;
  if (mode === 'exact') return exact;
  return STANDARD_VIEWPORT_SCALES.find((den) => den >= exact) ?? exact;
};

export interface PaperSnapPoint { x: number; y: number; label: string }

/**
 * Bounded paper snaps: sheet corners, margin rect corners, viewport
 * corners + edge midpoints, legacy title-bar corners, object insertions.
 * Paper picks never snap to model geometry through viewports.
 */
export const paperSnapPoints = (sheet: DraftSheet): PaperSnapPoint[] => {
  const points: PaperSnapPoint[] = [
    { x: 0, y: 0, label: 'sheet corner' },
    { x: sheet.widthMm, y: 0, label: 'sheet corner' },
    { x: 0, y: sheet.heightMm, label: 'sheet corner' },
    { x: sheet.widthMm, y: sheet.heightMm, label: 'sheet corner' },
    { x: sheet.margins.leftMm, y: sheet.margins.topMm, label: 'margin' },
    { x: sheet.widthMm - sheet.margins.rightMm, y: sheet.margins.topMm, label: 'margin' },
    { x: sheet.margins.leftMm, y: sheet.heightMm - sheet.margins.bottomMm, label: 'margin' },
    { x: sheet.widthMm - sheet.margins.rightMm, y: sheet.heightMm - sheet.margins.bottomMm, label: 'margin' },
  ];
  sheet.viewports.forEach((viewport) => {
    const { paperXmm: x, paperYmm: y, paperWidthMm: w, paperHeightMm: h } = viewport;
    points.push(
      { x, y, label: 'viewport corner' },
      { x: x + w, y, label: 'viewport corner' },
      { x, y: y + h, label: 'viewport corner' },
      { x: x + w, y: y + h, label: 'viewport corner' },
      { x: x + w / 2, y, label: 'viewport midpoint' },
      { x: x + w / 2, y: y + h, label: 'viewport midpoint' },
      { x, y: y + h / 2, label: 'viewport midpoint' },
      { x: x + w, y: y + h / 2, label: 'viewport midpoint' },
    );
  });
  // Legacy title-bar footprint (matches the legacy title builder).
  const barH = 14;
  const barY = sheet.heightMm - sheet.margins.bottomMm - barH;
  const barX = sheet.margins.leftMm;
  const barW = sheet.widthMm - sheet.margins.leftMm - sheet.margins.rightMm;
  points.push(
    { x: barX, y: barY, label: 'title corner' },
    { x: barX + barW, y: barY, label: 'title corner' },
    { x: barX, y: barY + barH, label: 'title corner' },
    { x: barX + barW, y: barY + barH, label: 'title corner' },
  );
  sheet.sheetObjects.forEach((object) => {
    points.push({ x: object.paperXmm, y: object.paperYmm, label: 'object insertion' });
  });
  return points;
};

export const nearestPaperSnap = (
  points: PaperSnapPoint[],
  pick: { x: number; y: number },
  toleranceMm: number,
): PaperSnapPoint | null => {
  let best: PaperSnapPoint | null = null;
  let bestDist = toleranceMm;
  points.forEach((point) => {
    const dist = Math.hypot(point.x - pick.x, point.y - pick.y);
    if (dist <= bestDist) {
      bestDist = dist;
      best = point;
    }
  });
  return best;
};

export const viewportPaperContains = (
  viewport: DraftSheetViewport,
  xMm: number,
  yMm: number,
): boolean =>
  xMm >= viewport.paperXmm &&
  xMm <= viewport.paperXmm + viewport.paperWidthMm &&
  yMm >= viewport.paperYmm &&
  yMm <= viewport.paperYmm + viewport.paperHeightMm;

export type ViewportCorner = 'nw' | 'ne' | 'sw' | 'se';

export const viewportCornerAt = (
  viewport: DraftSheetViewport,
  pick: { x: number; y: number },
  toleranceMm: number,
): ViewportCorner | null => {
  const corners: Record<ViewportCorner, { x: number; y: number }> = {
    nw: { x: viewport.paperXmm, y: viewport.paperYmm },
    ne: { x: viewport.paperXmm + viewport.paperWidthMm, y: viewport.paperYmm },
    sw: { x: viewport.paperXmm, y: viewport.paperYmm + viewport.paperHeightMm },
    se: { x: viewport.paperXmm + viewport.paperWidthMm, y: viewport.paperYmm + viewport.paperHeightMm },
  };
  for (const [name, point] of Object.entries(corners)) {
    if (Math.hypot(point.x - pick.x, point.y - pick.y) <= toleranceMm) return name as ViewportCorner;
  }
  return null;
};

/** Corner resize: the dragged corner moves, the opposite anchors (§25 scale fixed). */
export const resizeViewportFromCorner = (
  viewport: DraftSheetViewport,
  corner: ViewportCorner,
  pick: { x: number; y: number },
): DraftSheetViewport => {
  const x0 = viewport.paperXmm;
  const y0 = viewport.paperYmm;
  const x1 = x0 + viewport.paperWidthMm;
  const y1 = y0 + viewport.paperHeightMm;
  const anchorX = corner.includes('e') ? x0 : x1;
  const anchorY = corner.includes('s') ? y0 : y1;
  const left = Math.min(anchorX, pick.x);
  const top = Math.min(anchorY, pick.y);
  const moved = moveViewportPaper({ ...viewport, paperXmm: left, paperYmm: top }, 0, 0);
  return resizeViewportPaper(moved, Math.abs(pick.x - anchorX), Math.abs(pick.y - anchorY));
};

/** Deterministic hit test: viewports topmost-last, then objects by id. */
export const hitTestPaper = (
  sheet: DraftSheet,
  xMm: number,
  yMm: number,
  toleranceMm = 2,
): PaperSelection => {
  for (let index = sheet.viewports.length - 1; index >= 0; index -= 1) {
    const viewport = sheet.viewports[index] as DraftSheetViewport;
    if (viewportPaperContains(viewport, xMm, yMm)) return { kind: 'viewport', viewportId: viewport.id };
  }
  const ordered = [...sheet.sheetObjects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const hit = ordered.find(
    (object) => Math.hypot(object.paperXmm - xMm, object.paperYmm - yMm) <= toleranceMm,
  );
  return hit ? { kind: 'paper-object', objectId: hit.id } : null;
};
