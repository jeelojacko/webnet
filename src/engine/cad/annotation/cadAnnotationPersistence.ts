/**
 * Phase 18O professional annotation load-path helpers (backfill + sanitize).
 *
 * Schema stays 2 (all tables additive + trailing). Rules:
 *  - Missing annotation tables backfill with the documented seed defaults so
 *    legacy schema-2/1 drawings open with a usable annotation library.
 *  - Existing tables are sanitized in place: finite > 0 numerics, bounded
 *    enums, unique ids. Ids are NEVER invented — a dangling style/text/entity
 *    reference stays dangling (honest broken ref + fallback display).
 *  - Anchor references are shape-checked but never re-bound and never
 *    silently converted to `fixed`; a broken source stays a broken reference.
 *  - Legacy `CadTextStyle` (id/name/fontFamily/fontSize only) round-trips
 *    byte-identically: sanitize only ever removes invalid professional
 *    optionals.
 *
 * Pure: no unit conversion, no id minting, no mutation of the input.
 */
import type {
  CadAnnotationAnchor,
  CadAnnotationArcPointAnchor,
  CadAnnotationBlockInsertionAnchor,
  CadAnnotationLineEndpointAnchor,
  CadAnnotationSurveyPointAnchor,
} from './cadAnnotationAnchors';
import {
  createDefaultCadAnnotationSettings,
  sanitizeCadAnnotationSettings,
} from './cadAnnotationSettings';
import { validateCadProfessionalTextStyle } from './cadAnnotationValidation';
import { ANNOTATION_ARROWHEAD_SEEDS } from './cadAnnotationArrowheads';
import {
  seedBearingLabelStyles,
  seedCurveLabelStyles,
  seedDimensionStyles,
  seedLeaderStyles,
  seedProfessionalTextStyles,
} from './cadAnnotationSeeds';
import type {
  CadBearingDistanceLabelEntity,
  CadBearingLabelStyle,
  CadCurveLabelEntity,
  CadCurveLabelField,
  CadCurveLabelStyle,
  CadDimensionEntity,
  CadDimensionKind,
  CadDimensionStyle,
  CadEntity,
  CadLeaderEntity,
  CadLeaderStyle,
  CadMTextAttachment,
  CadMTextEntity,
  CadProject,
  CadTextStyle,
} from '../cadTypes';

export interface CadAnnotationSanitizeDiagnostic {
  code:
    | 'CAD_ANNOTATION_ENTITY_DROPPED'
    | 'CAD_ANNOTATION_STYLE_DROPPED'
    | 'CAD_ANNOTATION_STYLE_DUPLICATE_DROPPED';
  message: string;
  entityId?: string;
  styleId?: string;
}

/** Fallback text style id when an annotation style is missing its own ref. */
export const ANNOTATION_DEFAULT_TEXT_STYLE_ID = seedProfessionalTextStyles()[0].id;
/** Fallback arrowhead block id when a style is missing its own ref. */
export const ANNOTATION_DEFAULT_ARROW_BLOCK_ID = ANNOTATION_ARROWHEAD_SEEDS[0].id;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const positiveOr = (value: unknown, fallback: number): number =>
  isFiniteNumber(value) && value > 0 ? value : fallback;

const nonNegativeIntOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const finitePoint = (value: unknown): { x: number; y: number } | undefined => {
  if (!isRecord(value)) return undefined;
  return isFiniteNumber(value.x) && isFiniteNumber(value.y)
    ? { x: value.x, y: value.y }
    : undefined;
};

/**
 * Load-time backfill: seed missing annotation style tables + professional
 * text styles + settings without touching present ones. Block definitions
 * are intentionally NOT touched (legacy drawings keep their own library).
 * Idempotent.
 */
export const backfillCadAnnotationTables = (project: CadProject): CadProject => {
  const existingTextStyles = Array.isArray(project.styleLibrary?.textStyles)
    ? project.styleLibrary.textStyles
    : [];
  const existingIds = new Set(existingTextStyles.map((style) => style.id));
  const missingTextStyles = seedProfessionalTextStyles().filter(
    (style) => !existingIds.has(style.id),
  );
  return {
    ...project,
    styleLibrary: {
      ...project.styleLibrary,
      textStyles: [...existingTextStyles, ...missingTextStyles],
    },
    ...(!Array.isArray(project.dimensionStyles)
      ? { dimensionStyles: seedDimensionStyles().map((style) => ({ ...style })) }
      : {}),
    ...(!Array.isArray(project.leaderStyles)
      ? { leaderStyles: seedLeaderStyles().map((style) => ({ ...style })) }
      : {}),
    ...(!Array.isArray(project.bearingLabelStyles)
      ? {
          bearingLabelStyles: seedBearingLabelStyles().map((style) => ({
            ...style,
            offset: { ...style.offset },
          })),
        }
      : {}),
    ...(!Array.isArray(project.curveLabelStyles)
      ? {
          curveLabelStyles: seedCurveLabelStyles().map((style) => ({
            ...style,
            fields: [...style.fields],
            offset: { ...style.offset },
          })),
        }
      : {}),
    ...(project.annotationSettings == null
      ? { annotationSettings: createDefaultCadAnnotationSettings() }
      : {}),
  };
};

// ---------------------------------------------------------------------------
// Text style professional fields
// ---------------------------------------------------------------------------

const sanitizeTextStyle = (style: CadTextStyle): CadTextStyle => {
  if (validateCadProfessionalTextStyle(style).ok) return { ...style };
  const next: CadTextStyle = { ...style };
  if (
    next.heightMode !== undefined &&
    next.heightMode !== 'legacy-screen' &&
    next.heightMode !== 'model' &&
    next.heightMode !== 'paper'
  ) {
    delete next.heightMode;
  }
  if (next.modelHeight !== undefined && !positiveOr(next.modelHeight, 0)) delete next.modelHeight;
  if (next.paperHeightMm !== undefined && !positiveOr(next.paperHeightMm, 0))
    delete next.paperHeightMm;
  if (next.widthFactor !== undefined && !positiveOr(next.widthFactor, 0)) delete next.widthFactor;
  if (next.lineSpacingFactor !== undefined && !positiveOr(next.lineSpacingFactor, 0)) {
    delete next.lineSpacingFactor;
  }
  if (next.fontWeight !== undefined && next.fontWeight !== 'normal' && next.fontWeight !== 'bold') {
    delete next.fontWeight;
  }
  if (next.fontStyle !== undefined && next.fontStyle !== 'normal' && next.fontStyle !== 'italic') {
    delete next.fontStyle;
  }
  // A height mode whose required height was dropped reverts to legacy.
  if (next.heightMode === 'model' && next.modelHeight === undefined) delete next.heightMode;
  if (next.heightMode === 'paper' && next.paperHeightMm === undefined) delete next.heightMode;
  return next;
};

// ---------------------------------------------------------------------------
// Style tables
// ---------------------------------------------------------------------------

const uniqueById = <T extends { id: string }>(
  entries: readonly T[],
  diagnostics: CadAnnotationSanitizeDiagnostic[],
): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      diagnostics.push({
        code: 'CAD_ANNOTATION_STYLE_DUPLICATE_DROPPED',
        message: `Duplicate annotation style id "${entry.id}" dropped (first occurrence wins).`,
        styleId: entry.id,
      });
      continue;
    }
    seen.add(entry.id);
    result.push(entry);
  }
  return result;
};

const isStyleRecord = (value: unknown): value is Record<string, unknown> & { id: string } =>
  isRecord(value) && typeof value.id === 'string' && value.id.length > 0;

const defaultDimensionSeed = seedDimensionStyles()[0];
const defaultLeaderSeed = seedLeaderStyles()[0];
const defaultBearingSeed = seedBearingLabelStyles()[0];
const defaultCurveSeed = seedCurveLabelStyles()[0];

const ARROW_SIZE_MODES = ['model', 'paper'] as const;
const BEARING_CONTENTS = ['bearing', 'distance', 'bearing-distance', 'distance-bearing'] as const;
const BEARING_SEPARATORS = ['newline', 'space', 'slash'] as const;
const CURVE_FIELDS: readonly CadCurveLabelField[] = ['radius', 'delta', 'length', 'chord'];

const arrowSizeModeOr = (value: unknown): 'model' | 'paper' | undefined =>
  typeof value === 'string' && (ARROW_SIZE_MODES as readonly string[]).includes(value)
    ? (value as 'model' | 'paper')
    : undefined;

const sanitizeDimensionStyle = (value: unknown): CadDimensionStyle | undefined => {
  if (!isStyleRecord(value)) return undefined;
  const seed = seedDimensionStyles().find((entry) => entry.id === value.id) ?? defaultDimensionSeed;
  return {
    id: value.id,
    name: stringOr(value.name, value.id),
    textStyleId: stringOr(value.textStyleId, ANNOTATION_DEFAULT_TEXT_STYLE_ID),
    arrowBlockDefinitionId: stringOr(
      value.arrowBlockDefinitionId,
      ANNOTATION_DEFAULT_ARROW_BLOCK_ID,
    ),
    arrowSize: positiveOr(value.arrowSize, seed.arrowSize),
    ...(arrowSizeModeOr(value.arrowSizeMode) != null
      ? { arrowSizeMode: arrowSizeModeOr(value.arrowSizeMode) }
      : {}),
    textGap: positiveOr(value.textGap, seed.textGap),
    extensionOffset: positiveOr(value.extensionOffset, seed.extensionOffset),
    extensionOvershoot: positiveOr(value.extensionOvershoot, seed.extensionOvershoot),
    decimalPrecision: nonNegativeIntOr(value.decimalPrecision, seed.decimalPrecision),
    ...(optionalString(value.prefix) != null ? { prefix: optionalString(value.prefix) } : {}),
    ...(optionalString(value.suffix) != null ? { suffix: optionalString(value.suffix) } : {}),
  };
};

const sanitizeLeaderStyle = (value: unknown): CadLeaderStyle | undefined => {
  if (!isStyleRecord(value)) return undefined;
  const seed = seedLeaderStyles().find((entry) => entry.id === value.id) ?? defaultLeaderSeed;
  return {
    id: value.id,
    name: stringOr(value.name, value.id),
    textStyleId: stringOr(value.textStyleId, ANNOTATION_DEFAULT_TEXT_STYLE_ID),
    arrowBlockDefinitionId: stringOr(
      value.arrowBlockDefinitionId,
      ANNOTATION_DEFAULT_ARROW_BLOCK_ID,
    ),
    arrowSize: positiveOr(value.arrowSize, seed.arrowSize),
    ...(arrowSizeModeOr(value.arrowSizeMode) != null
      ? { arrowSizeMode: arrowSizeModeOr(value.arrowSizeMode) }
      : {}),
    landingLength: positiveOr(value.landingLength, seed.landingLength),
    textGap: positiveOr(value.textGap, seed.textGap),
  };
};

const sanitizeBearingLabelStyle = (value: unknown): CadBearingLabelStyle | undefined => {
  if (!isStyleRecord(value)) return undefined;
  const seed =
    seedBearingLabelStyles().find((entry) => entry.id === value.id) ?? defaultBearingSeed;
  const content =
    typeof value.content === 'string' &&
    (BEARING_CONTENTS as readonly string[]).includes(value.content)
      ? (value.content as CadBearingLabelStyle['content'])
      : seed.content;
  const separator =
    typeof value.separator === 'string' &&
    (BEARING_SEPARATORS as readonly string[]).includes(value.separator)
      ? (value.separator as CadBearingLabelStyle['separator'])
      : seed.separator;
  return {
    id: value.id,
    name: stringOr(value.name, value.id),
    textStyleId: stringOr(value.textStyleId, ANNOTATION_DEFAULT_TEXT_STYLE_ID),
    content,
    separator,
    offset: finitePoint(value.offset) ?? { ...seed.offset },
    decimalPrecision: nonNegativeIntOr(value.decimalPrecision, seed.decimalPrecision),
  };
};

const sanitizeCurveLabelStyle = (value: unknown): CadCurveLabelStyle | undefined => {
  if (!isStyleRecord(value)) return undefined;
  const seed = seedCurveLabelStyles().find((entry) => entry.id === value.id) ?? defaultCurveSeed;
  const rawFields = Array.isArray(value.fields) ? value.fields : seed.fields;
  const fields = rawFields.filter(
    (field): field is CadCurveLabelField =>
      typeof field === 'string' && (CURVE_FIELDS as readonly string[]).includes(field),
  );
  return {
    id: value.id,
    name: stringOr(value.name, value.id),
    textStyleId: stringOr(value.textStyleId, ANNOTATION_DEFAULT_TEXT_STYLE_ID),
    fields: fields.length > 0 ? fields : [...seed.fields],
    offset: finitePoint(value.offset) ?? { ...seed.offset },
    decimalPrecision: nonNegativeIntOr(value.decimalPrecision, seed.decimalPrecision),
  };
};

const sanitizeStyleTable = <T>(
  entries: readonly unknown[] | undefined,
  sanitize: (_value: unknown) => T | undefined,
  diagnostics: CadAnnotationSanitizeDiagnostic[],
  label: string,
): T[] | undefined => {
  if (entries == null) return undefined;
  if (!Array.isArray(entries)) return undefined;
  const result: T[] = [];
  for (const entry of entries) {
    const sanitized = sanitize(entry);
    if (sanitized == null) {
      diagnostics.push({
        code: 'CAD_ANNOTATION_STYLE_DROPPED',
        message: `Malformed annotation ${label} entry dropped.`,
      });
      continue;
    }
    result.push(sanitized);
  }
  return result;
};

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

const REFERENCE_KINDS = ['survey-point', 'line-endpoint', 'arc-point', 'block-insertion'] as const;

/**
 * Shape-sanitize one anchor. Never resolves, re-binds, or converts to fixed:
 * a reference whose source is gone stays a broken reference with its
 * persisted fallback point preserved.
 */
export const sanitizeCadAnnotationAnchor = (value: unknown): CadAnnotationAnchor | undefined => {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'fixed') {
    return isFiniteNumber(value.x) && isFiniteNumber(value.y)
      ? { kind: 'fixed', x: value.x, y: value.y }
      : undefined;
  }
  if (
    typeof value.kind !== 'string' ||
    !(REFERENCE_KINDS as readonly string[]).includes(value.kind)
  ) {
    return undefined;
  }
  if (typeof value.entityId !== 'string' || value.entityId.length === 0) return undefined;
  if (!isFiniteNumber(value.fallbackX) || !isFiniteNumber(value.fallbackY)) return undefined;
  const base = {
    entityId: value.entityId,
    fallbackX: value.fallbackX,
    fallbackY: value.fallbackY,
  };
  switch (value.kind) {
    case 'survey-point':
      return { kind: 'survey-point', ...base } satisfies CadAnnotationSurveyPointAnchor;
    case 'block-insertion':
      return { kind: 'block-insertion', ...base } satisfies CadAnnotationBlockInsertionAnchor;
    case 'line-endpoint':
      if (value.endpoint !== 'start' && value.endpoint !== 'end') return undefined;
      return {
        kind: 'line-endpoint',
        ...base,
        endpoint: value.endpoint,
      } satisfies CadAnnotationLineEndpointAnchor;
    case 'arc-point':
      if (value.point !== 'center' && value.point !== 'start' && value.point !== 'end')
        return undefined;
      return {
        kind: 'arc-point',
        ...base,
        point: value.point,
      } satisfies CadAnnotationArcPointAnchor;
    default:
      return undefined;
  }
};

const sanitizeAnchorList = (value: unknown): CadAnnotationAnchor[] =>
  Array.isArray(value)
    ? value
        .map(sanitizeCadAnnotationAnchor)
        .filter((anchor): anchor is CadAnnotationAnchor => anchor != null)
    : [];

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

const M_TEXT_ATTACHMENTS: readonly CadMTextAttachment[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

const isAttachment = (value: unknown): value is CadMTextAttachment =>
  typeof value === 'string' && (M_TEXT_ATTACHMENTS as readonly string[]).includes(value);

const DIMENSION_KINDS: readonly CadDimensionKind[] = [
  'linear',
  'aligned',
  'angular',
  'radius',
  'diameter',
];

const withEntityId = <T extends CadEntity>(entity: T): T | undefined =>
  typeof entity.id === 'string' && entity.id.length > 0 ? entity : undefined;

const sanitizeMText = (entity: CadMTextEntity): CadMTextEntity | undefined => {
  if (!isFiniteNumber(entity.x) || !isFiniteNumber(entity.y)) return undefined;
  return withEntityId({
    ...entity,
    text: typeof entity.text === 'string' ? entity.text : '',
    textStyleId: stringOr(entity.textStyleId, ANNOTATION_DEFAULT_TEXT_STYLE_ID),
    rotationDeg: isFiniteNumber(entity.rotationDeg) ? entity.rotationDeg : 0,
    attachment: isAttachment(entity.attachment) ? entity.attachment : 'middle-center',
  });
};

const sanitizeLeader = (entity: CadLeaderEntity): CadLeaderEntity | undefined => {
  const arrowAnchor = sanitizeCadAnnotationAnchor(entity.arrowAnchor);
  if (arrowAnchor == null || entity.arrowAnchor == null) return undefined;
  const vertices = Array.isArray(entity.vertices)
    ? entity.vertices
        .map((vertex) => finitePoint(vertex))
        .filter((vertex): vertex is { x: number; y: number } => vertex != null)
    : [];
  return withEntityId({
    ...entity,
    arrowAnchor,
    vertices,
    text: typeof entity.text === 'string' ? entity.text : '',
    leaderStyleId: stringOr(entity.leaderStyleId, 'std-leader'),
    ...(entity.textStyleId != null
      ? { textStyleId: stringOr(entity.textStyleId, ANNOTATION_DEFAULT_TEXT_STYLE_ID) }
      : {}),
    ...(isAttachment(entity.textAttachment) ? { textAttachment: entity.textAttachment } : {}),
  });
};

const sanitizeDimension = (entity: CadDimensionEntity): CadDimensionEntity | undefined => {
  if (!isFiniteNumber(entity.dimLinePoint?.x) || !isFiniteNumber(entity.dimLinePoint?.y)) {
    return undefined;
  }
  if (typeof entity.dimensionKind !== 'string' || !DIMENSION_KINDS.includes(entity.dimensionKind)) {
    return undefined;
  }
  const textPoint = finitePoint(entity.textPoint);
  return withEntityId({
    ...entity,
    dimensionKind: entity.dimensionKind,
    anchors: sanitizeAnchorList(entity.anchors),
    ...(sanitizeCadAnnotationAnchor(entity.defPoint1) != null
      ? { defPoint1: sanitizeCadAnnotationAnchor(entity.defPoint1) }
      : {}),
    ...(sanitizeCadAnnotationAnchor(entity.defPoint2) != null
      ? { defPoint2: sanitizeCadAnnotationAnchor(entity.defPoint2) }
      : {}),
    ...(entity.orientation === 'horizontal' ||
    entity.orientation === 'vertical' ||
    entity.orientation === 'aligned'
      ? { orientation: entity.orientation }
      : {}),
    dimLinePoint: { x: entity.dimLinePoint.x, y: entity.dimLinePoint.y },
    ...(textPoint != null ? { textPoint } : {}),
    dimensionStyleId: stringOr(entity.dimensionStyleId, 'std-500'),
    ...(optionalString(entity.textOverride) != null ? { textOverride: entity.textOverride } : {}),
  });
};

const sanitizeBearingLabel = (
  entity: CadBearingDistanceLabelEntity,
): CadBearingDistanceLabelEntity | undefined => {
  if (typeof entity.sourceEntityId !== 'string' || entity.sourceEntityId.length === 0)
    return undefined;
  return withEntityId({
    ...entity,
    labelStyleId: stringOr(entity.labelStyleId, 'bearing-default'),
    offset: finitePoint(entity.offset) ?? { x: 0, y: 0 },
    ...(entity.side === 'left' || entity.side === 'right' || entity.side === 'auto'
      ? { side: entity.side }
      : {}),
    ...(optionalString(entity.manualTextOverride) != null
      ? { manualTextOverride: entity.manualTextOverride }
      : {}),
  });
};

const sanitizeCurveLabel = (entity: CadCurveLabelEntity): CadCurveLabelEntity | undefined => {
  if (typeof entity.sourceEntityId !== 'string' || entity.sourceEntityId.length === 0)
    return undefined;
  return withEntityId({
    ...entity,
    labelStyleId: stringOr(entity.labelStyleId, 'curve-default'),
    offset: finitePoint(entity.offset) ?? { x: 0, y: 0 },
    ...(optionalString(entity.manualTextOverride) != null
      ? { manualTextOverride: entity.manualTextOverride }
      : {}),
  });
};

const sanitizeAnnotationEntity = (
  entity: CadEntity,
  diagnostics: CadAnnotationSanitizeDiagnostic[],
): CadEntity | undefined => {
  const dropped = (): undefined => {
    diagnostics.push({
      code: 'CAD_ANNOTATION_ENTITY_DROPPED',
      message: `Malformed ${entity.type} annotation "${entity.id}" dropped on load.`,
      entityId: entity.id,
    });
    return undefined;
  };
  switch (entity.type) {
    case 'mtext':
      return sanitizeMText(entity) ?? dropped();
    case 'leader':
      return sanitizeLeader(entity) ?? dropped();
    case 'dimension':
      return sanitizeDimension(entity) ?? dropped();
    case 'bearing-label':
      return sanitizeBearingLabel(entity) ?? dropped();
    case 'curve-label':
      return sanitizeCurveLabel(entity) ?? dropped();
    default:
      return entity;
  }
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Load-time sanitize + backfill of the professional annotation slice.
 * Returns the patched project (never fails the open) plus diagnostics.
 */
export const sanitizeAnnotationTables = (
  project: CadProject,
): { project: CadProject; diagnostics: CadAnnotationSanitizeDiagnostic[] } => {
  const diagnostics: CadAnnotationSanitizeDiagnostic[] = [];
  const backfilled = backfillCadAnnotationTables(project);
  const textStyles = (backfilled.styleLibrary?.textStyles ?? []).map(sanitizeTextStyle);
  const dimensionStyles = sanitizeStyleTable(
    backfilled.dimensionStyles,
    sanitizeDimensionStyle,
    diagnostics,
    'dimension style',
  );
  const leaderStyles = sanitizeStyleTable(
    backfilled.leaderStyles,
    sanitizeLeaderStyle,
    diagnostics,
    'leader style',
  );
  const bearingLabelStyles = sanitizeStyleTable(
    backfilled.bearingLabelStyles,
    sanitizeBearingLabelStyle,
    diagnostics,
    'bearing label style',
  );
  const curveLabelStyles = sanitizeStyleTable(
    backfilled.curveLabelStyles,
    sanitizeCurveLabelStyle,
    diagnostics,
    'curve label style',
  );
  const entities = backfilled.entities
    .map((entity) => sanitizeAnnotationEntity(entity, diagnostics))
    .filter((entity): entity is CadEntity => entity != null);
  return {
    project: {
      ...backfilled,
      styleLibrary: { ...backfilled.styleLibrary, textStyles },
      entities,
      ...(dimensionStyles != null
        ? { dimensionStyles: uniqueById(dimensionStyles, diagnostics) }
        : {}),
      ...(leaderStyles != null ? { leaderStyles: uniqueById(leaderStyles, diagnostics) } : {}),
      ...(bearingLabelStyles != null
        ? { bearingLabelStyles: uniqueById(bearingLabelStyles, diagnostics) }
        : {}),
      ...(curveLabelStyles != null
        ? { curveLabelStyles: uniqueById(curveLabelStyles, diagnostics) }
        : {}),
      annotationSettings: sanitizeCadAnnotationSettings(backfilled.annotationSettings),
    },
    diagnostics,
  };
};
