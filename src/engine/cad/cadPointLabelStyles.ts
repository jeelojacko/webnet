import type {
  CadPointLabelStyle,
  CadProject,
  CadSurveyPointEntity,
  CadTextEntity,
} from './cadTypes';

/**
 * Phase 18D point-label-style defaults. Content/layout only; every entry
 * reuses the existing `label-default` text style. All base offsets are zero
 * (placement snapshots stay at the point until the F2F regen phase adds
 * deconfliction). No annotation scale (recorded future, not modeled).
 */
export const DEFAULT_CAD_POINT_LABEL_STYLES: CadPointLabelStyle[] = [
  {
    id: 'point-label-none',
    name: 'No Label',
    components: {},
    componentOrder: [],
    separator: ' ',
    elevationDecimals: 3,
    textStyleId: 'label-default',
    offsetX: 0,
    offsetY: 0,
    visible: false,
    description: 'Hides the label; point and layer visibility are unaffected.',
  },
  {
    id: 'point-label-point-number',
    name: 'Point Number',
    components: { pointNumber: true },
    componentOrder: ['pointNumber'],
    separator: ' ',
    elevationDecimals: 3,
    textStyleId: 'label-default',
    offsetX: 0,
    offsetY: 0,
    visible: true,
  },
  {
    id: 'point-label-point-number-elevation',
    name: 'Point Number + Elevation',
    components: { pointNumber: true, elevation: true },
    componentOrder: ['pointNumber', 'elevation'],
    separator: ' ',
    elevationDecimals: 3,
    textStyleId: 'label-default',
    offsetX: 0,
    offsetY: 0,
    visible: true,
  },
  {
    id: 'point-label-point-number-description',
    name: 'Point Number + Description',
    components: { pointNumber: true, description: true },
    componentOrder: ['pointNumber', 'description'],
    separator: ' ',
    elevationDecimals: 3,
    textStyleId: 'label-default',
    offsetX: 0,
    offsetY: 0,
    visible: true,
  },
  {
    id: 'point-label-description',
    name: 'Description',
    components: { description: true },
    componentOrder: ['description'],
    separator: ' ',
    elevationDecimals: 3,
    textStyleId: 'label-default',
    offsetX: 0,
    offsetY: 0,
    visible: true,
  },
  {
    id: 'point-label-elevation',
    name: 'Elevation',
    components: { elevation: true },
    componentOrder: ['elevation'],
    separator: ' ',
    elevationDecimals: 3,
    textStyleId: 'label-default',
    offsetX: 0,
    offsetY: 0,
    visible: true,
  },
  {
    id: 'point-label-point-number-description-elevation',
    name: 'Point Number + Description + Elevation',
    components: { pointNumber: true, description: true, elevation: true },
    componentOrder: ['pointNumber', 'description', 'elevation'],
    separator: ' ',
    elevationDecimals: 3,
    textStyleId: 'label-default',
    offsetX: 0,
    offsetY: 0,
    visible: true,
  },
  {
    id: 'point-label-f2f-full',
    name: 'F2F Full',
    components: { pointNumber: true, description: true, featureCode: true, elevation: true },
    // Compat order: stationId, description, primaryCode, elevation — matches
    // the legacy fieldToFinish buildLabelText part order exactly.
    componentOrder: ['pointNumber', 'description', 'featureCode', 'elevation'],
    separator: ' ',
    elevationDecimals: 3,
    textStyleId: 'label-default',
    offsetX: 0,
    offsetY: 0,
    visible: true,
    description: 'Reproduces the legacy F2F label text (order, separator, elevation format).',
  },
];

export const DEFAULT_CAD_POINT_LABEL_STYLE_ID = 'point-label-point-number';

export const F2F_FULL_LABEL_STYLE_ID = 'point-label-f2f-full';

export const cloneCadPointLabelStyles = (styles: CadPointLabelStyle[]): CadPointLabelStyle[] =>
  styles.map((style) => ({
    ...style,
    components: { ...style.components },
    componentOrder: [...style.componentOrder],
  }));

/** Drawing-owned seed: deep copy, never the singleton by reference. */
export const createDefaultCadPointLabelStyles = (): CadPointLabelStyle[] =>
  cloneCadPointLabelStyles(DEFAULT_CAD_POINT_LABEL_STYLES);

/** Load-time backfill: missing table becomes defaults; unknown refs pass through. */
export const backfillCadPointLabelStyles = (
  labelStyles: CadPointLabelStyle[] | undefined,
): CadPointLabelStyle[] =>
  labelStyles == null ? createDefaultCadPointLabelStyles() : cloneCadPointLabelStyles(labelStyles);

/** Minimal label source: both survey-point entities and F2F points fit. */
export interface PointLabelPoint {
  stationId: string;
  x: number;
  y: number;
  z?: number;
  description?: string;
  featureCode?: string;
}

const clampElevationDecimals = (decimals: number): number =>
  Number.isFinite(decimals) ? Math.min(4, Math.max(0, Math.floor(decimals))) : 3;

/**
 * Elevation in drawing units with the style's own decimals. Same rounding as
 * the legacy draft formatter at 3 decimals, but never reads global precision.
 */
export const formatPointLabelElevation = (zMeters: number, elevationDecimals: number): string => {
  const decimals = clampElevationDecimals(elevationDecimals);
  if (!Number.isFinite(zMeters)) return '';
  const factor = 10 ** decimals;
  return `EL ${(Math.round(zMeters * factor) / factor).toFixed(decimals)}`;
};

/**
 * ONE pure formatter for point label content. Exported for later
 * renderer/F2F/DXF use; those callers are NOT rewired yet.
 */
export const buildPointLabelContent = (
  point: PointLabelPoint,
  labelStyle: CadPointLabelStyle,
): string => {
  const parts: string[] = [];
  for (const component of labelStyle.componentOrder) {
    switch (component) {
      case 'pointNumber':
        if (labelStyle.components.pointNumber === true) parts.push(point.stationId);
        break;
      case 'description':
        if (labelStyle.components.description === true && point.description) {
          parts.push(point.description);
        }
        break;
      case 'featureCode':
        if (labelStyle.components.featureCode === true && point.featureCode) {
          parts.push(point.featureCode);
        }
        break;
      case 'elevation':
        if (labelStyle.components.elevation === true && Number.isFinite(point.z)) {
          parts.push(formatPointLabelElevation(point.z as number, labelStyle.elevationDecimals));
        }
        break;
    }
  }
  const body = parts.join(labelStyle.separator);
  return `${labelStyle.components.prefix ?? ''}${body}${labelStyle.components.suffix ?? ''}`;
};

export interface MaterializedPointLabel {
  text: string;
  x: number;
  y: number;
  rotationDeg: number;
  visible: boolean;
}

/**
 * ONE pure materializer: derived text via the central formatter (manual mode
 * returns the manual text), placement = point + (offsetOverride ?? style
 * offset), rotation override wins, visibility = style visibility.
 */
export const materializePointLabel = (
  label: CadTextEntity,
  point: PointLabelPoint,
  labelStyle: CadPointLabelStyle,
): MaterializedPointLabel => {
  const binding = label.pointLabel;
  const offset = binding?.offsetOverride ?? { dx: labelStyle.offsetX, dy: labelStyle.offsetY };
  return {
    text:
      binding?.content.mode === 'manual'
        ? binding.content.text
        : buildPointLabelContent(point, labelStyle),
    x: point.x + offset.dx,
    y: point.y + offset.dy,
    rotationDeg: binding?.rotationOverrideDeg ?? labelStyle.rotationDeg ?? 0,
    visible: labelStyle.visible,
  };
};

/**
 * Phase 18D bound-label resolver for renderer/export (single call site per
 * caller — do not duplicate). Returns the materialized label, or null when
 * the label has no binding OR the binding cannot resolve (missing point or
 * unknown style): callers fall back to the baked x/y/text snapshot.
 *
 * Orphan policy: a bound label whose source point was deleted, or whose
 * style id is unknown (e.g. table replaced on import), stays visible with
 * its baked snapshot so content is never silently dropped and export never
 * crashes. Rebind or delete the label to clear it; a future Toolspace pass
 * may surface orphans explicitly.
 */
export const materializeBoundPointLabel = (
  label: CadTextEntity,
  project: CadProject,
): MaterializedPointLabel | null => {
  const binding = label.pointLabel;
  if (binding == null) return null;
  const point = project.entities.find(
    (entry): entry is CadSurveyPointEntity =>
      entry.type === 'survey-point' && entry.id === binding.pointEntityId,
  );
  const labelStyle = (project.labelStyles ?? []).find(
    (entry) => entry.id === binding.labelStyleId,
  );
  if (point == null || labelStyle == null) return null;
  return materializePointLabel(
    label,
    {
      stationId: point.stationId,
      x: point.x,
      y: point.y,
      z: point.z,
      description: point.description,
      featureCode: point.featureCode,
    },
    labelStyle,
  );
};

const F2F_GENERATOR = 'FIELD_TO_FINISH';

const isFieldToFinishLabel = (label: CadTextEntity): boolean => {
  const metadata = label.metadata as Record<string, unknown> | undefined;
  const provenance = metadata?.['provenance'];
  return (
    typeof provenance === 'object' &&
    provenance !== null &&
    (provenance as Record<string, unknown>)['generatedBy'] === F2F_GENERATOR
  );
};

const f2fFullStyle = (): CadPointLabelStyle =>
  DEFAULT_CAD_POINT_LABEL_STYLES.find((style) => style.id === F2F_FULL_LABEL_STYLE_ID) ??
  DEFAULT_CAD_POINT_LABEL_STYLES[DEFAULT_CAD_POINT_LABEL_STYLES.length - 1]!;

/**
 * Provenance-gated legacy migration helper (pure; NOT auto-run on load —
 * exposed for the F2F regen phase). Match is checked against the legacy
 * formatter output plus placement using the pre-regen state passed in:
 * match → derived binding; mismatch → manual content + offsetOverride so the
 * current text/placement survives byte-identical; ambiguous (non-F2F label,
 * already bound, or anchor mismatch) → undefined (leave free, no binding).
 */
export const migrateLegacyLabelToBinding = (
  label: CadTextEntity,
  point: CadSurveyPointEntity,
): CadTextEntity | undefined => {
  if (label.pointLabel != null) return label;
  if (!isFieldToFinishLabel(label)) return undefined;
  if (label.anchorEntityId !== point.id) return undefined;
  const styleId = F2F_FULL_LABEL_STYLE_ID;
  const expected = buildPointLabelContent(point, f2fFullStyle());
  if (label.text === expected && label.x === point.x && label.y === point.y) {
    return {
      ...label,
      pointLabel: { pointEntityId: point.id, labelStyleId: styleId, content: { mode: 'derived' } },
    };
  }
  return {
    ...label,
    pointLabel: {
      pointEntityId: point.id,
      labelStyleId: styleId,
      offsetOverride: { dx: label.x - point.x, dy: label.y - point.y },
      content: { mode: 'manual', text: label.text },
    },
  };
};
