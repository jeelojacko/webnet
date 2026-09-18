import { computeCadSurfaceSourceRevision, fnv1a } from './cadSurfaceRevision';
import type {
  CadProject,
  CadSurface,
  CadVolumeResult,
  CadVolumeSurface,
  CadVolumeSurfaceStyle,
  VolumeSurfaceStatus,
} from './cadTypes';

/**
 * Phase 18I volume-surface model helpers (persistence + derived status only).
 *
 * Volume relationships hold base/comparison TIN refs; everything derived
 * (revision, status, cache) is session-only and never trusted from disk.
 * Styles are display intent only — recoloring NEVER recalculates and never
 * changes the volume revision.
 */

export const VOLUME_STYLE_CUT_FILL_ID = 'volume-style-cut-fill';
export const VOLUME_STYLE_CUT_ONLY_ID = 'volume-style-cut-only';
export const VOLUME_STYLE_FILL_ONLY_ID = 'volume-style-fill-only';
export const VOLUME_STYLE_NONE_ID = 'volume-style-none';

const CUT_COLOR = '#d64545';
const FILL_COLOR = '#3d7dd6';

const seedVolumeSurfaceStyles = (): CadVolumeSurfaceStyle[] => [
  {
    id: VOLUME_STYLE_CUT_FILL_ID,
    name: 'Cut/Fill',
    showCut: true,
    showFill: true,
    cutColor: CUT_COLOR,
    fillColor: FILL_COLOR,
    opacity: 0.5,
  },
  {
    id: VOLUME_STYLE_CUT_ONLY_ID,
    name: 'Cut Only',
    showCut: true,
    showFill: false,
    cutColor: CUT_COLOR,
    fillColor: FILL_COLOR,
    opacity: 0.5,
  },
  {
    id: VOLUME_STYLE_FILL_ONLY_ID,
    name: 'Fill Only',
    showCut: false,
    showFill: true,
    cutColor: CUT_COLOR,
    fillColor: FILL_COLOR,
    opacity: 0.5,
  },
  {
    id: VOLUME_STYLE_NONE_ID,
    name: 'No Display',
    showCut: false,
    showFill: false,
    cutColor: CUT_COLOR,
    fillColor: FILL_COLOR,
    opacity: 0,
  },
];

export const cloneCadVolumeSurface = (volume: CadVolumeSurface): CadVolumeSurface => ({ ...volume });

export const cloneCadVolumeSurfaces = (volumes: CadVolumeSurface[] | undefined): CadVolumeSurface[] =>
  (volumes ?? []).map(cloneCadVolumeSurface);

/** Load-time backfill: legacy drawings (field absent) open with no volumes. */
export const backfillVolumeSurfaces = (volumes: CadVolumeSurface[] | undefined): CadVolumeSurface[] =>
  cloneCadVolumeSurfaces(volumes);

export const cloneCadVolumeSurfaceStyles = (
  styles: CadVolumeSurfaceStyle[],
): CadVolumeSurfaceStyle[] => styles.map((style) => ({ ...style }));

/** Load-time backfill: legacy drawings get the deterministic seed styles. */
export const backfillVolumeSurfaceStyles = (
  styles: CadVolumeSurfaceStyle[] | undefined,
): CadVolumeSurfaceStyle[] =>
  styles == null ? seedVolumeSurfaceStyles() : cloneCadVolumeSurfaceStyles(styles);

// ---------------------------------------------------------------------------
// Relationship revision (relationship-only; styles/layers/names excluded)
// ---------------------------------------------------------------------------

export interface VolumeSurfaceRevisionInput {
  baseId: string;
  /** Source TIN content revision; null = never built (still identity-bearing). */
  baseRev: string | null;
  cmpId: string;
  cmpRev: string | null;
}

/** `vrev1:` FNV-1a over both source ids + content revisions (order-sensitive). */
export const computeVolumeSurfaceRevision = (input: VolumeSurfaceRevisionInput): string =>
  `vrev1:${fnv1a(
    [
      'base',
      input.baseId,
      input.baseRev ?? 'none',
      'cmp',
      input.cmpId,
      input.cmpRev ?? 'none',
    ].join('#'),
  )}`;

// ---------------------------------------------------------------------------
// Derived status (pure; never a persisted flag)
// ---------------------------------------------------------------------------

export interface VolumeSurfaceStatusState {
  building: boolean;
  /** Cached result for this volume, if any (session cache only). */
  result?: CadVolumeResult | null;
  /** Session override: source TIN is CURRENT for the current source revision. */
  baseCurrent?: boolean;
  comparisonCurrent?: boolean;
  /** Last session failure diagnostic for this volume. */
  diagnostic?: string;
}

const sourceCurrent = (
  project: CadProject,
  surfaceId: string,
): { surface: CadSurface; revision: string } | null => {
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  return { surface, revision: computeCadSurfaceSourceRevision(project, surface) };
};

/**
 * Pure volume status:
 * BUILDING > BROKEN_REFERENCE (missing/same source) > SOURCE_NOT_CURRENT
 * (either source TIN not current) > UNBUILT/FAILED (no result) >
 * NEEDS_RECALC (result revision stale) > NO_OVERLAP (zero common area) >
 * CURRENT (both sources current AND result revision matches).
 */
export const deriveVolumeSurfaceStatus = (
  project: CadProject,
  volume: CadVolumeSurface,
  state: VolumeSurfaceStatusState,
): VolumeSurfaceStatus => {
  if (state.building) return 'BUILDING';
  const base = sourceCurrent(project, volume.baseSurfaceId);
  const comparison = sourceCurrent(project, volume.comparisonSurfaceId);
  if (!base || !comparison) return 'BROKEN_REFERENCE';
  if (base.surface.id === comparison.surface.id) return 'BROKEN_REFERENCE';
  const baseCurrent = state.baseCurrent ?? base.surface.cachedRevision === base.revision;
  const comparisonCurrent =
    state.comparisonCurrent ?? comparison.surface.cachedRevision === comparison.revision;
  if (!baseCurrent || !comparisonCurrent) return 'SOURCE_NOT_CURRENT';
  const revision = computeVolumeSurfaceRevision({
    baseId: base.surface.id,
    baseRev: base.revision,
    cmpId: comparison.surface.id,
    cmpRev: comparison.revision,
  });
  const result = state.result ?? null;
  if (result == null) return state.diagnostic ? 'FAILED' : 'UNBUILT';
  if (result.revision !== revision) return 'NEEDS_RECALC';
  if (!(result.overlapArea > 0)) return 'NO_OVERLAP';
  return 'CURRENT';
};

// ---------------------------------------------------------------------------
// Style CRUD (mirrors cadSurfaceStyles.ts; never touches geometry)
// ---------------------------------------------------------------------------

export const isVolumeSurfaceStyleNameTaken = (
  styles: CadVolumeSurfaceStyle[],
  name: string,
  exceptId?: string,
): boolean =>
  styles.some(
    (style) => style.id !== exceptId && style.name.toLowerCase() === name.trim().toLowerCase(),
  );

const sanitizeStyle = (style: CadVolumeSurfaceStyle): CadVolumeSurfaceStyle | null => {
  if (typeof style.id !== 'string' || style.id.trim() === '') return null;
  if (typeof style.name !== 'string' || style.name.trim() === '') return null;
  if (typeof style.showCut !== 'boolean' || typeof style.showFill !== 'boolean') return null;
  if (typeof style.cutColor !== 'string' || style.cutColor.trim() === '') return null;
  if (typeof style.fillColor !== 'string' || style.fillColor.trim() === '') return null;
  if (typeof style.opacity !== 'number' || !Number.isFinite(style.opacity)) return null;
  if (style.opacity < 0 || style.opacity > 1) return null;
  return { ...style, id: style.id, name: style.name.trim() };
};

export const createCadVolumeSurfaceStyle = (
  styles: CadVolumeSurfaceStyle[],
  style: CadVolumeSurfaceStyle,
): CadVolumeSurfaceStyle[] | null => {
  const next = sanitizeStyle(style);
  if (!next || styles.some((entry) => entry.id === next.id)) return null;
  if (isVolumeSurfaceStyleNameTaken(styles, next.name)) return null;
  return [...styles, next];
};

export const duplicateCadVolumeSurfaceStyle = (
  styles: CadVolumeSurfaceStyle[],
  styleId: string,
  newId: string,
  name: string,
): CadVolumeSurfaceStyle[] | null => {
  const source = styles.find((entry) => entry.id === styleId);
  if (!source || typeof newId !== 'string' || newId.trim() === '') return null;
  if (styles.some((entry) => entry.id === newId)) return null;
  return createCadVolumeSurfaceStyle(styles, { ...source, id: newId, name });
};

export const renameCadVolumeSurfaceStyle = (
  styles: CadVolumeSurfaceStyle[],
  styleId: string,
  name: string,
): CadVolumeSurfaceStyle[] | null => {
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (!styles.some((entry) => entry.id === styleId)) return null;
  if (isVolumeSurfaceStyleNameTaken(styles, name, styleId)) return null;
  return styles.map((entry) => (entry.id === styleId ? { ...entry, name: name.trim() } : entry));
};

export type CadVolumeSurfaceStylePatch = Partial<
  Pick<
    CadVolumeSurfaceStyle,
    'showCut' | 'showFill' | 'showZeroBoundary' | 'cutColor' | 'fillColor' | 'opacity'
  >
>;

export const updateCadVolumeSurfaceStyle = (
  styles: CadVolumeSurfaceStyle[],
  styleId: string,
  patch: CadVolumeSurfaceStylePatch,
): CadVolumeSurfaceStyle[] | null => {
  if (!styles.some((entry) => entry.id === styleId)) return null;
  if (patch.opacity !== undefined && (typeof patch.opacity !== 'number' || patch.opacity < 0 || patch.opacity > 1)) {
    return null;
  }
  for (const key of ['showCut', 'showFill', 'showZeroBoundary'] as const) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') return null;
  }
  for (const key of ['cutColor', 'fillColor'] as const) {
    if (patch[key] !== undefined && (typeof patch[key] !== 'string' || patch[key].trim() === '')) {
      return null;
    }
  }
  return styles.map((entry) => {
    if (entry.id !== styleId) return entry;
    const next: CadVolumeSurfaceStyle = { ...entry };
    if (patch.showCut !== undefined) next.showCut = patch.showCut;
    if (patch.showFill !== undefined) next.showFill = patch.showFill;
    if (patch.cutColor !== undefined) next.cutColor = patch.cutColor;
    if (patch.fillColor !== undefined) next.fillColor = patch.fillColor;
    if (patch.opacity !== undefined) next.opacity = patch.opacity;
    if (patch.showZeroBoundary !== undefined) {
      if (patch.showZeroBoundary) next.showZeroBoundary = true;
      else delete next.showZeroBoundary;
    }
    return next;
  });
};

/**
 * Delete with refcount guard: blocked while a volume references the style
 * unless a valid replacementId rewires those refs. Never deletes the last
 * remaining style. Returns the next { styles, volumeSurfaces } or null.
 */
export const deleteCadVolumeSurfaceStyle = (
  styles: CadVolumeSurfaceStyle[],
  volumes: CadVolumeSurface[],
  styleId: string,
  replacementId?: string,
): { styles: CadVolumeSurfaceStyle[]; volumeSurfaces: CadVolumeSurface[] } | null => {
  if (!styles.some((entry) => entry.id === styleId) || styles.length <= 1) return null;
  const referenced = volumes.some((volume) => volume.styleId === styleId);
  if (referenced && replacementId == null) return null;
  if (replacementId !== undefined) {
    if (replacementId === styleId || !styles.some((entry) => entry.id === replacementId)) {
      return null;
    }
  }
  return {
    styles: styles.filter((entry) => entry.id !== styleId),
    volumeSurfaces:
      replacementId != null
        ? volumes.map((volume) =>
            volume.styleId === styleId ? { ...volume, styleId: replacementId } : volume,
          )
        : volumes,
  };
};
