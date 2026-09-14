import { createStableRuntimeId } from '../id';
import {
  DEFAULT_DRAFT_PAPER_TEXT_HEIGHTS_MM,
  DEFAULT_DRAFT_PRECISION_PROFILE,
} from './cadStyles';
import type { CadLayer, CadLineTypeId } from './cadTypes';

export type DraftTextAlignment = 'left' | 'center' | 'right';
export type DraftSheetOrientation = 'portrait' | 'landscape';

export interface DraftPaperTextStyle {
  id: string;
  name: string;
  paperHeightMm: number;
  fontFamily: string;
  alignment: DraftTextAlignment;
}

export interface DraftLineStyle {
  id: string;
  name: string;
  lineweightMm: number;
  color?: string;
  lineTypeId?: CadLineTypeId;
}

export interface DraftLabelStyle {
  id: string;
  name: string;
  textStyleId: string;
  lineStyleId?: string;
}

export interface DraftAnnotationStyles {
  textStyles: DraftPaperTextStyle[];
  lineStyles: DraftLineStyle[];
  labelStyles: DraftLabelStyle[];
}

export interface DraftPrecisionProfile {
  bearingDecimals: number;
  distanceDecimals: number;
  areaDecimals: number;
  coordinateDecimals: number;
  unitsMode: 'm' | 'ft';
}

export interface DraftSheetMargins {
  topMm: number;
  bottomMm: number;
  leftMm: number;
  rightMm: number;
}

export interface DraftSheetViewport {
  id: string;
  name: string;
  modelCenterX: number;
  modelCenterY: number;
  scaleDenominator: number;
  paperXmm: number;
  paperYmm: number;
  paperWidthMm: number;
  paperHeightMm: number;
  /** Viewport-only clockwise rotation (deg); model coordinates untouched. */
  rotationDeg: number;
  clipXmm?: number;
  clipYmm?: number;
  clipWidthMm?: number;
  clipHeightMm?: number;
  layerOverrides?: Record<string, { visible?: boolean }>;
}

export interface DraftDocumentLabel {
  id: string;
  text: string;
  xModel: number;
  yModel: number;
  layerId: string;
  heightMm?: number;
  provenance?: string;
  overrideText?: string;
}

export interface DraftSheetObject {
  id: string;
  kind: string;
  layerId: string;
  paperXmm: number;
  paperYmm: number;
  text?: string;
  rotationDeg?: number;
}

export interface DraftSheet {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  orientation: DraftSheetOrientation;
  margins: DraftSheetMargins;
  viewports: DraftSheetViewport[];
  titleBlockId?: string;
  sheetObjects: DraftSheetObject[];
}

export interface DraftTitleBlockDefinition {
  id: string;
  name: string;
  fieldNames: string[];
}

export interface DraftDocumentMetadata {
  createdAt: string;
  updatedAt: string;
  author?: string;
  description?: string;
}

export interface DraftDocument {
  version: 1;
  modelSpaceProjectId: string;
  layers: CadLayer[];
  annotationStyles: DraftAnnotationStyles;
  precision: DraftPrecisionProfile;
  sheets: DraftSheet[];
  titleBlockDefinitions: DraftTitleBlockDefinition[];
  labels: DraftDocumentLabel[];
  metadata: DraftDocumentMetadata;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const CAD_LAYER_ROLES = new Set([
  'points',
  'control-points',
  'observation-lines',
  'error-ellipses',
  'labels',
  'parcels',
  'planning',
]);

const isCadLayerRole = (value: unknown): value is CadLayer['role'] =>
  typeof value === 'string' && CAD_LAYER_ROLES.has(value);

const asFinite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

export const createBlankDraftAnnotationStyles = (): DraftAnnotationStyles => ({
  textStyles: [
    {
      id: createStableRuntimeId('draft-text-style'),
      name: 'Normal',
      paperHeightMm: DEFAULT_DRAFT_PAPER_TEXT_HEIGHTS_MM.normal,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      alignment: 'left',
    },
  ],
  lineStyles: [
    {
      id: createStableRuntimeId('draft-line-style'),
      name: 'Normal',
      lineweightMm: 0.25,
      lineTypeId: 'continuous',
    },
  ],
  labelStyles: [],
});

export const createBlankDraftDocument = ({
  projectId,
  layers = [],
}: {
  projectId: string;
  layers?: CadLayer[];
}): DraftDocument => {
  const nowIso = new Date().toISOString();
  const styles = createBlankDraftAnnotationStyles();
  return {
    version: 1,
    modelSpaceProjectId: projectId,
    layers: layers.map((layer) => ({ ...layer })),
    annotationStyles: styles,
    precision: { ...DEFAULT_DRAFT_PRECISION_PROFILE },
    sheets: [],
    titleBlockDefinitions: [],
    labels: [],
    metadata: { createdAt: nowIso, updatedAt: nowIso },
  };
};

export const createDraftSheet = ({
  name,
  widthMm = 297,
  heightMm = 210,
  orientation = 'landscape',
}: {
  name: string;
  widthMm?: number;
  heightMm?: number;
  orientation?: DraftSheetOrientation;
}): DraftSheet => ({
  id: createStableRuntimeId('draft-sheet'),
  name,
  widthMm,
  heightMm,
  orientation,
  margins: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
  viewports: [],
  sheetObjects: [],
});

export const cloneDraftDocument = (draft: DraftDocument): DraftDocument => ({
  version: 1,
  modelSpaceProjectId: draft.modelSpaceProjectId,
  layers: draft.layers.map((layer) => ({ ...layer })),
  annotationStyles: {
    textStyles: draft.annotationStyles.textStyles.map((entry) => ({ ...entry })),
    lineStyles: draft.annotationStyles.lineStyles.map((entry) => ({ ...entry })),
    labelStyles: draft.annotationStyles.labelStyles.map((entry) => ({ ...entry })),
  },
  precision: { ...draft.precision },
  sheets: draft.sheets.map((sheet) => ({
    ...sheet,
    margins: { ...sheet.margins },
    viewports: sheet.viewports.map((viewport) => ({
      ...viewport,
      ...(viewport.layerOverrides ? { layerOverrides: { ...viewport.layerOverrides } } : {}),
    })),
    sheetObjects: sheet.sheetObjects.map((object) => ({ ...object })),
  })),
  labels: draft.labels.map((label) => ({ ...label })),
  titleBlockDefinitions: draft.titleBlockDefinitions.map((entry) => ({
    ...entry,
    fieldNames: [...entry.fieldNames],
  })),
  metadata: { ...draft.metadata },
});

const sanitizeTextStyle = (value: unknown): DraftPaperTextStyle | undefined => {
  if (!isRecord(value)) return undefined;
  return {
    id: asString(value.id, createStableRuntimeId('draft-text-style')),
    name: asString(value.name, 'Unnamed'),
    paperHeightMm: asFinite(value.paperHeightMm, DEFAULT_DRAFT_PAPER_TEXT_HEIGHTS_MM.normal),
    fontFamily: asString(value.fontFamily, 'sans-serif'),
    alignment: value.alignment === 'center' || value.alignment === 'right' ? value.alignment : 'left',
  };
};

const sanitizeLineStyle = (value: unknown): DraftLineStyle | undefined => {
  if (!isRecord(value)) return undefined;
  const lineStyle: DraftLineStyle = {
    id: asString(value.id, createStableRuntimeId('draft-line-style')),
    name: asString(value.name, 'Unnamed'),
    lineweightMm: asFinite(value.lineweightMm, 0.25),
  };
  if (typeof value.color === 'string') lineStyle.color = value.color;
  if (typeof value.lineTypeId === 'string') lineStyle.lineTypeId = value.lineTypeId;
  return lineStyle;
};

const sanitizeLabelStyle = (value: unknown): DraftLabelStyle | undefined => {
  if (!isRecord(value) || typeof value.textStyleId !== 'string') return undefined;
  const labelStyle: DraftLabelStyle = {
    id: asString(value.id, createStableRuntimeId('draft-label-style')),
    name: asString(value.name, 'Unnamed'),
    textStyleId: value.textStyleId,
  };
  if (typeof value.lineStyleId === 'string') labelStyle.lineStyleId = value.lineStyleId;
  return labelStyle;
};

// Stable ids: a present non-empty id always survives; generation is only
// for genuinely missing ids so sanitize-serialize-sanitize is idempotent.
const stableId = (value: unknown, prefix: string): string =>
  typeof value === 'string' && value.length > 0 ? value : createStableRuntimeId(prefix);

const sanitizeLayerOverrides = (value: unknown): Record<string, { visible?: boolean }> | undefined => {
  if (!isRecord(value)) return undefined;
  const overrides: Record<string, { visible?: boolean }> = {};
  for (const [layerId, override] of Object.entries(value)) {
    if (typeof layerId !== 'string' || layerId.length === 0 || !isRecord(override)) continue;
    if (typeof override.visible === 'boolean') overrides[layerId] = { visible: override.visible };
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
};

const sanitizeSheet = (value: unknown): DraftSheet | undefined => {
  if (!isRecord(value)) return undefined;
  const margins = isRecord(value.margins) ? value.margins : {};
  return {
    id: stableId(value.id, 'draft-sheet'),
    name: asString(value.name, 'Unnamed sheet'),
    widthMm: asFinite(value.widthMm, 297),
    heightMm: asFinite(value.heightMm, 210),
    orientation: value.orientation === 'portrait' ? 'portrait' : 'landscape',
    margins: {
      topMm: asFinite(margins.topMm, 10),
      bottomMm: asFinite(margins.bottomMm, 10),
      leftMm: asFinite(margins.leftMm, 10),
      rightMm: asFinite(margins.rightMm, 10),
    },
    viewports: Array.isArray(value.viewports)
      ? value.viewports.flatMap((entry): DraftSheetViewport[] => {
          if (!isRecord(entry)) return [];
          const viewport: DraftSheetViewport = {
            id: stableId(entry.id, 'draft-viewport'),
            name: asString(entry.name, 'Viewport'),
            modelCenterX: asFinite(entry.modelCenterX, 0),
            modelCenterY: asFinite(entry.modelCenterY, 0),
            scaleDenominator: asFinite(entry.scaleDenominator, 1000),
            paperXmm: asFinite(entry.paperXmm, 10),
            paperYmm: asFinite(entry.paperYmm, 10),
            paperWidthMm: asFinite(entry.paperWidthMm, 100),
            paperHeightMm: asFinite(entry.paperHeightMm, 100),
            rotationDeg: asFinite(entry.rotationDeg, 0),
          };
          const clip = isRecord(entry.clip) ? entry.clip : entry;
          if (typeof clip.clipXmm === 'number' && Number.isFinite(clip.clipXmm)) viewport.clipXmm = clip.clipXmm;
          if (typeof clip.clipYmm === 'number' && Number.isFinite(clip.clipYmm)) viewport.clipYmm = clip.clipYmm;
          if (typeof clip.clipWidthMm === 'number' && Number.isFinite(clip.clipWidthMm) && clip.clipWidthMm > 0) {
            viewport.clipWidthMm = clip.clipWidthMm;
          }
          if (typeof clip.clipHeightMm === 'number' && Number.isFinite(clip.clipHeightMm) && clip.clipHeightMm > 0) {
            viewport.clipHeightMm = clip.clipHeightMm;
          }
          const overrides = sanitizeLayerOverrides(entry.layerOverrides);
          if (overrides) viewport.layerOverrides = overrides;
          return [viewport];
        })
      : [],
    titleBlockId: typeof value.titleBlockId === 'string' ? value.titleBlockId : undefined,
    sheetObjects: Array.isArray(value.sheetObjects)
      ? value.sheetObjects.flatMap((entry): DraftSheetObject[] => {
          if (!isRecord(entry) || typeof entry.layerId !== 'string') return [];
          const object: DraftSheetObject = {
            id: stableId(entry.id, 'draft-sheet-object'),
            kind: asString(entry.kind, 'text'),
            layerId: entry.layerId,
            paperXmm: asFinite(entry.paperXmm, 0),
            paperYmm: asFinite(entry.paperYmm, 0),
          };
          if (typeof entry.text === 'string') object.text = entry.text;
          if (typeof entry.rotationDeg === 'number' && Number.isFinite(entry.rotationDeg)) {
            object.rotationDeg = entry.rotationDeg;
          }
          return [object];
        })
      : [],
  };
};

export const sanitizeDraftDocument = (
  value: unknown,
  projectId: string,
  layers: CadLayer[],
): DraftDocument | undefined => {
  if (value == null) return createBlankDraftDocument({ projectId, layers });
  if (!isRecord(value)) return undefined;
  const styles = isRecord(value.annotationStyles) ? value.annotationStyles : {};
  const precision = isRecord(value.precision) ? value.precision : {};
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const fallback = DEFAULT_DRAFT_PRECISION_PROFILE;
  return {
    version: 1,
    modelSpaceProjectId:
      typeof value.modelSpaceProjectId === 'string' ? value.modelSpaceProjectId : projectId,
    layers: Array.isArray(value.layers)
      ? value.layers.flatMap((entry): CadLayer[] => {
          if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') {
            return [];
          }
          const layer: CadLayer = {
            id: entry.id,
            name: entry.name,
            color: asString(entry.color, '#ffffff'),
            visible: entry.visible !== false,
            locked: entry.locked === true,
            role: isCadLayerRole(entry.role) ? entry.role : 'planning',
          };
          if (typeof entry.lineTypeId === 'string') layer.lineTypeId = entry.lineTypeId;
          if (typeof entry.defaultStyleId === 'string') layer.defaultStyleId = entry.defaultStyleId;
          if (typeof entry.printable === 'boolean') layer.printable = entry.printable;
          if (typeof entry.lineweightMm === 'number' && Number.isFinite(entry.lineweightMm)) {
            layer.lineweightMm = entry.lineweightMm;
          }
          return [layer];
        })
      : layers.map((layer) => ({ ...layer })),
    annotationStyles: {
      textStyles: Array.isArray(styles.textStyles)
        ? styles.textStyles.flatMap((entry): DraftPaperTextStyle[] => {
            const sanitized = sanitizeTextStyle(entry);
            return sanitized ? [sanitized] : [];
          })
        : [],
      lineStyles: Array.isArray(styles.lineStyles)
        ? styles.lineStyles.flatMap((entry): DraftLineStyle[] => {
            const sanitized = sanitizeLineStyle(entry);
            return sanitized ? [sanitized] : [];
          })
        : [],
      labelStyles: Array.isArray(styles.labelStyles)
        ? styles.labelStyles.flatMap((entry): DraftLabelStyle[] => {
            const sanitized = sanitizeLabelStyle(entry);
            return sanitized ? [sanitized] : [];
          })
        : [],
    },
    precision: {
      bearingDecimals: asFinite(precision.bearingDecimals, fallback.bearingDecimals),
      distanceDecimals: asFinite(precision.distanceDecimals, fallback.distanceDecimals),
      areaDecimals: asFinite(precision.areaDecimals, fallback.areaDecimals),
      coordinateDecimals: asFinite(precision.coordinateDecimals, fallback.coordinateDecimals),
      unitsMode: precision.unitsMode === 'ft' ? 'ft' : 'm',
    },
    sheets: Array.isArray(value.sheets)
      ? value.sheets.flatMap((entry): DraftSheet[] => {
          const sanitized = sanitizeSheet(entry);
          return sanitized ? [sanitized] : [];
        })
      : [],
    titleBlockDefinitions: Array.isArray(value.titleBlockDefinitions)
      ? value.titleBlockDefinitions.flatMap((entry): DraftTitleBlockDefinition[] => {
          if (!isRecord(entry)) return [];
          return [
            {
              id: stableId(entry.id, 'draft-title-block'),
              name: asString(entry.name, 'Unnamed title block'),
              fieldNames: Array.isArray(entry.fieldNames)
                ? entry.fieldNames.filter((name): name is string => typeof name === 'string')
                : [],
            },
          ];
        })
      : [],
    labels: Array.isArray(value.labels)
      ? value.labels.flatMap((entry): DraftDocumentLabel[] => {
          if (!isRecord(entry) || typeof entry.text !== 'string' || typeof entry.layerId !== 'string') return [];
          const label: DraftDocumentLabel = {
            id: stableId(entry.id, 'draft-label'),
            text: entry.text,
            xModel: asFinite(entry.xModel, 0),
            yModel: asFinite(entry.yModel, 0),
            layerId: entry.layerId,
          };
          if (typeof entry.heightMm === 'number' && Number.isFinite(entry.heightMm) && entry.heightMm > 0) {
            label.heightMm = entry.heightMm;
          }
          if (typeof entry.provenance === 'string') label.provenance = entry.provenance;
          if (typeof entry.overrideText === 'string') label.overrideText = entry.overrideText;
          return [label];
        })
      : [],
    metadata: {
      createdAt: asString(metadata.createdAt, new Date().toISOString()),
      updatedAt: asString(metadata.updatedAt, new Date().toISOString()),
      ...(typeof metadata.author === 'string' ? { author: metadata.author } : {}),
      ...(typeof metadata.description === 'string' ? { description: metadata.description } : {}),
    },
  };
};
