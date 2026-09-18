import type { CadSurface, CadSurfaceStyle } from './cadTypes';

/**
 * Phase 18F surface display styles (engine-adjacent seed + CRUD).
 *
 * Seed styles: Triangles, Triangles+Points, Boundary, No Display. Styles are
 * display intent only (see canonical CadSurfaceStyle in cadTypes.ts) —
 * switching styles never rebuilds the mesh and never affects the revision.
 * Delete is blocked while a surface references the style (rewire via
 * replacementId); the last remaining style is never deleted.
 */

export const SURFACE_STYLE_TRIANGLES_ID = 'surface-style-triangles';
export const SURFACE_STYLE_TRIANGLES_POINTS_ID = 'surface-style-triangles-points';
export const SURFACE_STYLE_BOUNDARY_ID = 'surface-style-boundary';
export const SURFACE_STYLE_NONE_ID = 'surface-style-none';
export const SURFACE_STYLE_CONTOURS_ID = 'surface-style-contours';
export const SURFACE_STYLE_CONTOURS_TRIANGLES_ID = 'surface-style-contours-triangles';

/** Phase 18H shared contour defaults: minor 1, every 5th major, base 0, major labels on. */
export const SURFACE_CONTOUR_STYLE_DEFAULTS = {
  minorContourInterval: 1,
  majorContourEvery: 5,
  contourBaseElevation: 0,
  showContourLabels: true,
  labelMajorOnly: true,
  contourLabelSpacing: 40,
  contourLabelPrecision: 1,
} as const;

const contourSeedFields = (): CadSurfaceStyle => ({
  id: '',
  name: '',
  showContours: true,
  ...SURFACE_CONTOUR_STYLE_DEFAULTS,
});

const seedSurfaceStyles = (): CadSurfaceStyle[] => [
  { id: SURFACE_STYLE_TRIANGLES_ID, name: 'Triangles', showTriangles: true },
  {
    id: SURFACE_STYLE_TRIANGLES_POINTS_ID,
    name: 'Triangles+Points',
    showTriangles: true,
    showPoints: true,
  },
  { id: SURFACE_STYLE_BOUNDARY_ID, name: 'Boundary', showBoundary: true },
  { id: SURFACE_STYLE_NONE_ID, name: 'No Display' },
  { ...contourSeedFields(), id: SURFACE_STYLE_CONTOURS_ID, name: 'Contours' },
  {
    ...contourSeedFields(),
    id: SURFACE_STYLE_CONTOURS_TRIANGLES_ID,
    name: 'Contours + Triangles',
    showTriangles: true,
  },
];

export const cloneCadSurfaceStyles = (styles: CadSurfaceStyle[]): CadSurfaceStyle[] =>
  styles.map((style) => ({
    ...style,
    ...(style.minorContour ? { minorContour: { ...style.minorContour } } : {}),
    ...(style.majorContour ? { majorContour: { ...style.majorContour } } : {}),
  }));

/** Load-time backfill: legacy drawings (field absent) get the seed styles. */
export const backfillCadSurfaceStyles = (
  styles: CadSurfaceStyle[] | undefined,
): CadSurfaceStyle[] => (styles == null ? seedSurfaceStyles() : cloneCadSurfaceStyles(styles));

export const isSurfaceStyleNameTaken = (
  styles: CadSurfaceStyle[],
  name: string,
  exceptId?: string,
): boolean =>
  styles.some(
    (style) => style.id !== exceptId && style.name.toLowerCase() === name.trim().toLowerCase(),
  );

const sanitizeStyle = (style: CadSurfaceStyle): CadSurfaceStyle | null => {
  if (typeof style.id !== 'string' || style.id.trim() === '') return null;
  if (typeof style.name !== 'string' || style.name.trim() === '') return null;
  return { ...style, id: style.id, name: style.name.trim() };
};

export const createCadSurfaceStyle = (
  styles: CadSurfaceStyle[],
  style: CadSurfaceStyle,
): CadSurfaceStyle[] | null => {
  const next = sanitizeStyle(style);
  if (!next || styles.some((entry) => entry.id === next.id)) return null;
  if (isSurfaceStyleNameTaken(styles, next.name)) return null;
  return [...styles, next];
};

export const duplicateCadSurfaceStyle = (
  styles: CadSurfaceStyle[],
  styleId: string,
  newId: string,
  name: string,
): CadSurfaceStyle[] | null => {
  const source = styles.find((entry) => entry.id === styleId);
  if (!source || typeof newId !== 'string' || newId.trim() === '') return null;
  if (styles.some((entry) => entry.id === newId)) return null;
  return createCadSurfaceStyle(styles, { ...source, id: newId, name });
};

export const renameCadSurfaceStyle = (
  styles: CadSurfaceStyle[],
  styleId: string,
  name: string,
): CadSurfaceStyle[] | null => {
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (!styles.some((entry) => entry.id === styleId)) return null;
  if (isSurfaceStyleNameTaken(styles, name, styleId)) return null;
  return styles.map((entry) => (entry.id === styleId ? { ...entry, name: name.trim() } : entry));
};

export const updateCadSurfaceStyle = (
  styles: CadSurfaceStyle[],
  styleId: string,
  patch: Pick<
    CadSurfaceStyle,
    | 'color'
    | 'opacity'
    | 'showTriangles'
    | 'showContours'
    | 'showPoints'
    | 'showBoundary'
    | 'minorContourInterval'
    | 'majorContourEvery'
    | 'contourBaseElevation'
    | 'minorContour'
    | 'majorContour'
    | 'showContourLabels'
    | 'labelMajorOnly'
    | 'contourLabelSpacing'
    | 'contourLabelPrecision'
  > & { description?: string | null },
): CadSurfaceStyle[] | null => {
  if (!styles.some((entry) => entry.id === styleId)) return null;
  if (patch.opacity !== undefined && (typeof patch.opacity !== 'number' || patch.opacity < 0 || patch.opacity > 1)) {
    return null;
  }
  if (
    (patch.minorContourInterval !== undefined &&
      (typeof patch.minorContourInterval !== 'number' ||
        !Number.isFinite(patch.minorContourInterval) ||
        patch.minorContourInterval <= 0)) ||
    (patch.majorContourEvery !== undefined &&
      (!Number.isInteger(patch.majorContourEvery) || patch.majorContourEvery < 1)) ||
    (patch.contourBaseElevation !== undefined &&
      (typeof patch.contourBaseElevation !== 'number' || !Number.isFinite(patch.contourBaseElevation))) ||
    (patch.contourLabelSpacing !== undefined &&
      (typeof patch.contourLabelSpacing !== 'number' ||
        !Number.isFinite(patch.contourLabelSpacing) ||
        patch.contourLabelSpacing <= 0)) ||
    (patch.contourLabelPrecision !== undefined &&
      (!Number.isInteger(patch.contourLabelPrecision) ||
        patch.contourLabelPrecision < 0 ||
        patch.contourLabelPrecision > 6))
  ) {
    return null;
  }
  return styles.map((entry) => {
    if (entry.id !== styleId) return entry;
    const next: CadSurfaceStyle = { ...entry };
    if (patch.color !== undefined) {
      if (patch.color == null) delete next.color;
      else next.color = patch.color;
    }
    if (patch.opacity !== undefined) next.opacity = patch.opacity;
    for (const key of ['showTriangles', 'showContours', 'showPoints', 'showBoundary'] as const) {
      if (patch[key] !== undefined) next[key] = patch[key];
    }
    for (const key of [
      'minorContourInterval',
      'majorContourEvery',
      'contourBaseElevation',
      'minorContour',
      'majorContour',
      'showContourLabels',
      'labelMajorOnly',
      'contourLabelSpacing',
      'contourLabelPrecision',
    ] as const) {
      if (patch[key] !== undefined) {
        if (patch[key] == null) delete next[key];
        else (next[key] as unknown) = patch[key];
      }
    }
    if (patch.description !== undefined) {
      if (patch.description == null) delete next.description;
      else next.description = patch.description;
    }
    return next;
  });
};

/**
 * Delete with refcount guard: blocked while a surface references the style
 * unless a valid replacementId rewires those refs. Never deletes the last
 * remaining style. Returns the next { styles, surfaces } or null.
 */
export const deleteCadSurfaceStyle = (
  styles: CadSurfaceStyle[],
  surfaces: CadSurface[],
  styleId: string,
  replacementId?: string,
): { styles: CadSurfaceStyle[]; surfaces: CadSurface[] } | null => {
  if (!styles.some((entry) => entry.id === styleId) || styles.length <= 1) return null;
  const referenced = surfaces.some((surface) => surface.styleId === styleId);
  if (referenced && replacementId == null) return null;
  if (replacementId !== undefined) {
    if (replacementId === styleId || !styles.some((entry) => entry.id === replacementId)) {
      return null;
    }
  }
  return {
    styles: styles.filter((entry) => entry.id !== styleId),
    surfaces:
      replacementId != null
        ? surfaces.map((surface) =>
            surface.styleId === styleId ? { ...surface, styleId: replacementId } : surface,
          )
        : surfaces,
  };
};
