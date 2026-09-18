import type { CadPointStyle, CadProject, CadSurveyPointEntity } from './cadTypes';

/**
 * Phase 18D point-style defaults. Marker presentation only; every entry reuses
 * an existing CadPointSymbol shape (no new symbol geometry). Radius semantics:
 * markerScale multiplies the referenced symbol radius in drawing units (NOT
 * paper mm; see docs/evidence/phase18d-point-style-notes.md).
 */
export const DEFAULT_CAD_POINT_STYLES: CadPointStyle[] = [
  { id: 'point-style-standard', name: 'Standard', markerSymbolId: 'point-free', displayMarker: true },
  { id: 'point-style-survey', name: 'Survey Point', markerSymbolId: 'point-free', displayMarker: true },
  { id: 'point-style-control', name: 'Control Point', markerSymbolId: 'point-control', displayMarker: true },
  { id: 'point-style-monument', name: 'Monument', markerSymbolId: 'point-f2f-square', displayMarker: true },
  { id: 'point-style-boundary', name: 'Boundary Corner', markerSymbolId: 'point-f2f-triangle', displayMarker: true },
  { id: 'point-style-topo', name: 'Topo', markerSymbolId: 'point-f2f-dot', displayMarker: true },
  { id: 'point-style-tree', name: 'Tree', markerSymbolId: 'point-f2f-cross', displayMarker: true },
  { id: 'point-style-utility', name: 'Utility', markerSymbolId: 'point-f2f-x', displayMarker: true },
  {
    id: 'point-style-no-display',
    name: 'No Display',
    markerSymbolId: 'point-free',
    displayMarker: false,
    description: 'Hides the marker; label and layer visibility are unaffected.',
  },
];

export const DEFAULT_CAD_POINT_STYLE_ID = 'point-style-standard';

export const cloneCadPointStyles = (styles: CadPointStyle[]): CadPointStyle[] =>
  styles.map((style) => ({ ...style }));

/** Drawing-owned seed: deep copy, never the singleton by reference. */
export const createDefaultCadPointStyles = (): CadPointStyle[] =>
  cloneCadPointStyles(DEFAULT_CAD_POINT_STYLES);

/** Load-time backfill: missing table becomes defaults; unknown refs pass through. */
export const backfillCadPointStyles = (
  pointStyles: CadPointStyle[] | undefined,
): CadPointStyle[] =>
  pointStyles == null ? createDefaultCadPointStyles() : cloneCadPointStyles(pointStyles);

const LEGACY_STYLE_TO_POINT_STYLE: Record<string, string> = {
  'style-control-point': 'point-style-control',
  'style-point': 'point-style-survey',
};

const sanitizeCompatSegment = (segment: string): string =>
  segment.replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 48) || 'symbol';

/**
 * Pure legacy migration: entities with a legacy styleId->pointSymbolId get a
 * compatibility BASE pointStyleId that references the SAME symbol at scale 1,
 * so marker size is unchanged and marker color is unchanged (the 18C resolver
 * still owns color via the untouched legacy styleId). Entities with no style
 * (manual pure-ByLayer) get undefined (= drawing default). No coordinate
 * changes. Entities that already carry a pointStyleId are left untouched.
 */
export const migrateLegacySurveyPointStyles = (project: CadProject): CadProject => {
  const seeded =
    project.pointStyles == null
      ? createDefaultCadPointStyles()
      : cloneCadPointStyles(project.pointStyles);
  const bySymbol = new Map(seeded.map((style) => [style.markerSymbolId, style.id]));
  const compat: CadPointStyle[] = [];
  const entities = project.entities.map((entity) => {
    if (entity.type !== 'survey-point') return entity;
    const point = entity as CadSurveyPointEntity;
    if (point.pointStyleId != null) return point;
    if (point.styleId == null) return point;
    const mapped = LEGACY_STYLE_TO_POINT_STYLE[point.styleId];
    if (mapped != null) return { ...point, pointStyleId: mapped };
    const symbolId = project.styleLibrary.styles.find((style) => style.id === point.styleId)
      ?.pointSymbolId;
    if (symbolId == null) return point;
    const existing = bySymbol.get(symbolId);
    if (existing != null) return { ...point, pointStyleId: existing };
    const compatId = `point-style-compat-${sanitizeCompatSegment(symbolId)}`;
    bySymbol.set(symbolId, compatId);
    compat.push({ id: compatId, name: `Compat ${symbolId}`, markerSymbolId: symbolId, displayMarker: true });
    return { ...point, pointStyleId: compatId };
  });
  // Deterministic ordering: seeded defaults first, compat sorted by id.
  compat.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { ...project, pointStyles: [...seeded, ...compat], entities };
};

/** Base style for newly built points: control class -> Control Point, else Survey Point. */
export const basePointStyleIdForClass = (
  pointClass: CadSurveyPointEntity['pointClass'],
): string => (pointClass === 'control' ? 'point-style-control' : 'point-style-survey');
