import { DEG_TO_RAD, RAD_TO_DEG, dmsToRad, radToDmsStr } from './angles';
import type {
  ImportedAngleObservationRecord,
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedMeasurementObservationRecord,
  ImportedObservationRecord,
  ImportedTraceEntry,
} from './importers';
import {
  serializeImportedControlStationRecord,
  serializeImportedObservationRecord,
} from './importedRecordSerialization';
import type { CoordMode, FaceNormalizationMode } from '../types';

export type ImportReviewItemKind = 'control' | 'observation' | 'comment';
export type ImportReviewGroupKind = 'control' | 'setup' | 'resection' | 'gps';
export type ImportReviewOutputPreset = 'clean-webnet' | 'field-grouped' | 'ts-direction-set';
export type ImportReviewRowTypeOverride =
  | 'auto'
  | 'measurement'
  | 'distance'
  | 'distance-vertical'
  | 'angle'
  | 'vertical'
  | 'bearing'
  | 'direction-angle'
  | 'direction-measurement';

export interface ImportReviewItem {
  id: string;
  kind: ImportReviewItemKind;
  index: number;
  groupKey: string;
  sourceType: string;
  sourceLine?: number;
  sourceCode?: string;
  sourceMethod?: string;
  sourceClassification?: string;
  sourceObservationKind?: ImportedObservationRecord['kind'];
  setupId?: string;
  backsightId?: string;
  targetId?: string;
  stationId?: string;
  synthetic?: boolean;
  defaultText?: string;
}

export interface ImportReviewGroup {
  key: string;
  kind: ImportReviewGroupKind;
  label: string;
  defaultComment: string;
  synthetic?: boolean;
  manualOrder?: boolean;
  setupId?: string;
  backsightId?: string;
  itemIds: string[];
}

export interface ImportReviewModel {
  groups: ImportReviewGroup[];
  items: ImportReviewItem[];
  warnings: ImportedTraceEntry[];
  errors: ImportedTraceEntry[];
}

export interface ImportReviewComparisonTotals {
  controlStations: number;
  observations: number;
  comparedObservations: number;
  warnings: number;
  errors: number;
}

export type ImportReviewComparisonMode = 'non-mta-only' | 'all-raw';

export interface ImportReviewComparisonRow {
  key: string;
  setupLabel: string;
  targetLabel: string;
  family: string;
  primaryCount: number;
  comparisonCount: number;
  delta: number;
}

export interface ImportReviewComparisonSummary {
  mode: ImportReviewComparisonMode;
  primarySourceName: string;
  comparisonSourceName: string;
  primaryImporterId: string;
  comparisonImporterId: string;
  primaryTotals: ImportReviewComparisonTotals;
  comparisonTotals: ImportReviewComparisonTotals;
  rows: ImportReviewComparisonRow[];
}

export interface BuildImportReviewTextOptions {
  includedItemIds: Set<string>;
  groupComments?: Record<string, string>;
  itemCommentLines?: Record<string, string[]>;
  rowOverrides?: Record<string, string>;
  rowTypeOverrides?: Record<string, ImportReviewRowTypeOverride>;
  fixedItemIds?: Set<string>;
  preset?: ImportReviewOutputPreset;
  faceNormalizationMode?: FaceNormalizationMode;
  syntheticDirectionBacksightMode?: 'auto' | 'always' | 'never';
  emitDirectionFaceHints?: boolean;
  coordMode?: CoordMode;
  force2D?: boolean;
}

const isComparableObservation = (observation: ImportedObservationRecord): boolean =>
  observation.sourceMeta?.method !== 'MEANTURNEDANGLE';

const isObservationIncludedInComparison = (
  observation: ImportedObservationRecord,
  mode: ImportReviewComparisonMode,
): boolean => (mode === 'all-raw' ? true : isComparableObservation(observation));

const prettifyToken = (value: string): string =>
  value
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatLinear = (value: number): string => value.toFixed(4);

const formatAngleDms = (valueDeg: number): string => radToDmsStr(valueDeg * DEG_TO_RAD);
const formatFromToToken = (fromId: string, toId: string): string => `${fromId}-${toId}`;

const splitOverrideLines = (value: string | undefined): string[] =>
  value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0) ?? [];

const compareImportTokens = (left: string | undefined, right: string | undefined): number =>
  (left ?? '').localeCompare(right ?? '', undefined, { numeric: true, sensitivity: 'base' });

const comparisonFamilyLabel = (observation: ImportedObservationRecord): string => {
  if (observation.kind === 'measurement') return 'M';
  if (observation.kind === 'angle') return 'A';
  if (observation.kind === 'distance-vertical') return 'DV';
  if (observation.kind === 'distance') return 'D';
  if (observation.kind === 'vertical') return 'V';
  if (observation.kind === 'bearing') return 'B';
  if (observation.kind === 'gnss-vector') return 'G';
  return 'Obs';
};

const comparisonFamilyLabelForKind = (kind: ImportedObservationRecord['kind']): string => {
  if (kind === 'measurement') return 'M';
  if (kind === 'angle') return 'A';
  if (kind === 'distance-vertical') return 'DV';
  if (kind === 'distance') return 'D';
  if (kind === 'vertical') return 'V';
  if (kind === 'bearing') return 'B';
  if (kind === 'gnss-vector') return 'G';
  return 'Obs';
};

const deriveObservationSetupId = (observation: ImportedObservationRecord): string => {
  if (observation.kind === 'measurement' || observation.kind === 'angle') return observation.atId;
  return observation.fromId;
};

const deriveObservationBacksightId = (
  observation: ImportedObservationRecord,
): string | undefined =>
  observation.kind === 'measurement' || observation.kind === 'angle'
    ? observation.fromId
    : undefined;

const deriveObservationTargetId = (observation: ImportedObservationRecord): string =>
  observation.kind === 'measurement' || observation.kind === 'angle'
    ? observation.toId
    : observation.toId;

const isResectionSetupType = (value: string | undefined): boolean =>
  /resection/i.test((value ?? '').trim());

const normalizeFaceLabel = (value: string | undefined): string | null => {
  const normalized = (value ?? '').trim().toUpperCase();
  if (normalized === 'FACE1') return 'F1';
  if (normalized === 'FACE2') return 'F2';
  return normalized ? prettifyToken(normalized) : null;
};

type DirectionFaceBucket = 'face1' | 'face2' | 'unresolved';

const normalizeDirectionFace = (value: string | undefined): DirectionFaceBucket => {
  const normalized = (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (normalized === 'FACE1' || normalized === 'F1' || normalized === '1') return 'face1';
  if (normalized === 'FACE2' || normalized === 'F2' || normalized === '2') return 'face2';
  return 'unresolved';
};

const inferDirectionFaceFromZenithDeg = (
  zenithDeg: number | undefined,
  windowDeg = 45,
): DirectionFaceBucket => {
  if (!Number.isFinite(zenithDeg as number)) return 'unresolved';
  const wrapped = ((((zenithDeg as number) % 360) + 360) % 360) as number;
  const distanceTo = (center: number): number => {
    let delta = Math.abs(wrapped - center) % 360;
    if (delta > 180) delta = 360 - delta;
    return delta;
  };
  const dFace1 = distanceTo(90);
  const dFace2 = distanceTo(270);
  if (dFace1 <= windowDeg && dFace2 > windowDeg) return 'face1';
  if (dFace2 <= windowDeg && dFace1 > windowDeg) return 'face2';
  return 'unresolved';
};

const normalizeDirectionAngleDeg = (valueDeg: number): number => {
  const wrapped = ((valueDeg % 360) + 360) % 360;
  return wrapped === 360 ? 0 : wrapped;
};

const parseDirectionAngleTokenDeg = (token: string | undefined): number | undefined => {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  const dmsValue = dmsToRad(trimmed) * RAD_TO_DEG;
  if (Number.isFinite(dmsValue)) return normalizeDirectionAngleDeg(dmsValue);
  const numericValue = Number.parseFloat(trimmed);
  if (Number.isFinite(numericValue)) return normalizeDirectionAngleDeg(numericValue);
  return undefined;
};

const parseDirectionLineTarget = (line: string): string | undefined => {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return undefined;
  const code = tokens[0]?.toUpperCase();
  if (code !== 'DN' && code !== 'DM') return undefined;
  return tokens[1];
};

const parseDirectionFaceHintToken = (token: string | undefined): DirectionFaceBucket | null => {
  const raw = token?.trim();
  if (!raw) return null;
  let normalized = raw.toUpperCase().replace(/[^A-Z0-9=]/g, '');
  if (!normalized) return null;
  if (normalized.startsWith('FACE=')) normalized = normalized.slice(5);
  if (normalized.startsWith('FACE')) normalized = normalized.slice(4);
  if (normalized === 'F1') normalized = '1';
  if (normalized === 'F2') normalized = '2';
  if (normalized === '1') return 'face1';
  if (normalized === '2') return 'face2';
  return null;
};

const appendDirectionLineFaceHint = (line: string, face: DirectionFaceBucket): string => {
  if (face === 'unresolved') return line;
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return line;
  const code = tokens[0]?.toUpperCase();
  if (code !== 'DN' && code !== 'DM') return line;
  if (tokens.some((token) => parseDirectionFaceHintToken(token) != null)) return line;
  tokens.push(face === 'face1' ? 'F1' : 'F2');
  return tokens.join(' ');
};

const normalizeDirectionLineFace2ToFace1 = (line: string): string | null => {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return null;
  const code = tokens[0]?.toUpperCase();
  if (code !== 'DN' && code !== 'DM') return null;
  const angleDeg = parseDirectionAngleTokenDeg(tokens[2]);
  if (!Number.isFinite(angleDeg as number)) return null;
  tokens[2] = formatAngleDms(normalizeDirectionAngleDeg((angleDeg as number) - 180));
  return tokens.join(' ');
};

export const isImportReviewMtaItem = (item: ImportReviewItem): boolean =>
  item.kind === 'observation' && item.sourceMethod === 'MEANTURNEDANGLE';

export const isImportReviewRawMeasurementItem = (item: ImportReviewItem): boolean =>
  item.kind === 'observation' &&
  Boolean(item.sourceMethod) &&
  item.sourceMethod !== 'MEANTURNEDANGLE';

const deriveSourceType = (
  kind: ImportReviewItemKind,
  record: ImportedControlStationRecord | ImportedObservationRecord,
): string => {
  if (kind === 'control') return 'Control Point';
  if (kind === 'comment') return 'Comment';
  const classification = record.sourceMeta?.classification;
  const faceLabel = normalizeFaceLabel(record.sourceMeta?.face);
  const withFace = (value: string): string => (faceLabel ? `${value} (${faceLabel})` : value);
  if (record.sourceMeta?.method === 'MEANTURNEDANGLE') {
    return withFace(record.kind === 'angle' ? 'MTA Angle' : 'MTA Measurement');
  }
  if (classification === 'BackSight') {
    return withFace('Backsight Shot');
  }
  if (classification === 'Check') {
    return withFace('Check Shot');
  }
  if (record.kind === 'gnss-vector') return 'GNSS Vector';
  if (record.kind === 'distance') return 'Distance';
  if (record.kind === 'distance-vertical') return 'Distance + Vertical';
  if (record.kind === 'vertical') return 'Vertical';
  if (record.kind === 'bearing') return 'Bearing';
  if (record.kind === 'angle') return 'Angle';
  if (record.kind === 'measurement') return 'Measurement';
  return prettifyToken(record.kind);
};

const serializeObservationPreview = (
  observation: ImportedObservationRecord,
  preset: ImportReviewOutputPreset,
): string => {
  const isResection =
    (observation.kind === 'measurement' || observation.kind === 'angle') &&
    isResectionSetupType(observation.sourceMeta?.setupType);

  if (preset !== 'ts-direction-set' || !isResection) {
    return serializeImportedObservationRecord(observation)
      .filter((line) => !line.startsWith('.'))
      .join(' | ');
  }

  if (observation.kind === 'measurement') {
    const tokens = [
      'DM',
      observation.toId,
      formatAngleDms(observation.angleDeg),
      formatLinear(observation.distanceM),
    ];
    if (observation.verticalMode && observation.verticalValue != null) {
      tokens.push(
        observation.verticalMode === 'zenith'
          ? formatAngleDms(observation.verticalValue)
          : formatLinear(observation.verticalValue),
      );
    }
    if (observation.hiM != null || observation.htM != null) {
      tokens.push(`${formatLinear(observation.hiM ?? 0)}/${formatLinear(observation.htM ?? 0)}`);
    }
    return tokens.join(' ');
  }

  if (observation.kind === 'angle') {
    return ['DN', observation.toId, formatAngleDms(observation.angleDeg)].join(' ');
  }

  return serializeImportedObservationRecord(observation)
    .filter((line) => !line.startsWith('.'))
    .join(' | ');
};

const hasExplicitFixedOrFloatTokens = (tokens: string[]): boolean =>
  tokens.some((token) => token === '!' || token === '*');

const isHiHtToken = (token: string | undefined): boolean => Boolean(token && token.includes('/'));

const fixedTokenCountForRecordLine = (line: string, coordMode: CoordMode): number => {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || hasExplicitFixedOrFloatTokens(tokens)) return 0;
  const code = tokens[0]?.toUpperCase();
  if (!code || code.startsWith('#') || code.startsWith('.')) return 0;

  if (code === 'C' || code === 'P' || code === 'PH' || code === 'CH') {
    return coordMode === '2D' ? 2 : 3;
  }

  if (
    code === 'D' ||
    code === 'A' ||
    code === 'B' ||
    code === 'V' ||
    code === 'DN' ||
    code === 'L'
  ) {
    return 1;
  }

  if (code === 'DV') {
    return 2;
  }

  if (code === 'G') {
    return tokens.length >= 11 ? 3 : 2;
  }

  if (code === 'M' || code === 'DM') {
    const verticalToken = tokens[4];
    return isHiHtToken(verticalToken) || verticalToken == null ? 2 : 3;
  }

  if (code === 'BM') {
    const verticalToken = tokens[5];
    return isHiHtToken(verticalToken) || verticalToken == null ? 2 : 3;
  }

  return 1;
};

const appendFixedTokensToLine = (line: string, coordMode: CoordMode): string => {
  const count = fixedTokenCountForRecordLine(line, coordMode);
  if (count <= 0) return line;
  return `${line} ${Array.from({ length: count }, () => '!').join(' ')}`;
};

const applyFixedTokensToLines = (
  lines: string[],
  fixed: boolean,
  coordMode: CoordMode,
): string[] => {
  if (!fixed) return lines;
  let applied = false;
  return lines.map((line) => {
    if (applied || line.startsWith('.')) return line;
    const nextLine = appendFixedTokensToLine(line, coordMode);
    if (nextLine !== line) applied = true;
    return nextLine;
  });
};

const serializeDistanceFocusedObservation = (observation: ImportedObservationRecord): string[] => {
  if (observation.kind === 'measurement') {
    return [
      ['D', observation.atId, observation.toId, formatLinear(observation.distanceM)].join(' '),
    ];
  }
  if (observation.kind === 'distance-vertical') {
    return [
      ['D', observation.fromId, observation.toId, formatLinear(observation.distanceM)].join(' '),
    ];
  }
  if (observation.kind === 'distance') {
    return [
      ['D', observation.fromId, observation.toId, formatLinear(observation.distanceM)].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeDistanceVerticalFocusedObservation = (
  observation: ImportedObservationRecord,
): string[] => {
  if (observation.kind === 'measurement') {
    if (observation.verticalMode && observation.verticalValue != null) {
      return [
        observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF',
        [
          'DV',
          observation.atId,
          observation.toId,
          formatLinear(observation.distanceM),
          observation.verticalMode === 'zenith'
            ? formatAngleDms(observation.verticalValue)
            : formatLinear(observation.verticalValue),
        ].join(' '),
      ];
    }
    return [
      ['D', observation.atId, observation.toId, formatLinear(observation.distanceM)].join(' '),
    ];
  }
  if (observation.kind === 'distance-vertical') {
    return [
      observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF',
      [
        'DV',
        observation.fromId,
        observation.toId,
        formatLinear(observation.distanceM),
        observation.verticalMode === 'zenith'
          ? formatAngleDms(observation.verticalValue)
          : formatLinear(observation.verticalValue),
      ].join(' '),
    ];
  }
  if (observation.kind === 'distance') {
    return [
      ['D', observation.fromId, observation.toId, formatLinear(observation.distanceM)].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeAngleFocusedObservation = (observation: ImportedObservationRecord): string[] => {
  if (observation.kind === 'measurement') {
    return [
      [
        'A',
        `${observation.atId}-${observation.fromId}-${observation.toId}`,
        formatAngleDms(observation.angleDeg),
      ].join(' '),
    ];
  }
  if (observation.kind === 'angle') {
    return [
      [
        'A',
        `${observation.atId}-${observation.fromId}-${observation.toId}`,
        formatAngleDms(observation.angleDeg),
      ].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeVerticalFocusedObservation = (observation: ImportedObservationRecord): string[] => {
  if (
    observation.kind === 'measurement' &&
    observation.verticalMode &&
    observation.verticalValue != null
  ) {
    return [
      observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF',
      [
        'V',
        formatFromToToken(observation.atId, observation.toId),
        observation.verticalMode === 'zenith'
          ? formatAngleDms(observation.verticalValue)
          : formatLinear(observation.verticalValue),
      ].join(' '),
    ];
  }
  if (observation.kind === 'distance-vertical' || observation.kind === 'vertical') {
    return [
      observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF',
      [
        'V',
        formatFromToToken(observation.fromId, observation.toId),
        observation.verticalMode === 'zenith'
          ? formatAngleDms(observation.verticalValue)
          : formatLinear(observation.verticalValue),
      ].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeBearingFocusedObservation = (observation: ImportedObservationRecord): string[] => {
  if (observation.kind === 'bearing') {
    return [
      ['B', observation.fromId, observation.toId, formatLinear(observation.bearingDeg)].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeDirectionAngleFocusedObservation = (
  observation: ImportedObservationRecord,
): string[] => {
  if (observation.kind === 'measurement') {
    return [['DN', observation.toId, formatAngleDms(observation.angleDeg)].join(' ')];
  }
  if (observation.kind === 'angle') {
    return [['DN', observation.toId, formatAngleDms(observation.angleDeg)].join(' ')];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeDirectionMeasurementFocusedObservation = (
  observation: ImportedObservationRecord,
): string[] => {
  if (observation.kind === 'measurement') {
    const tokens = [
      'DM',
      observation.toId,
      formatAngleDms(observation.angleDeg),
      formatLinear(observation.distanceM),
    ];
    if (observation.verticalMode && observation.verticalValue != null) {
      tokens.push(
        observation.verticalMode === 'zenith'
          ? formatAngleDms(observation.verticalValue)
          : formatLinear(observation.verticalValue),
      );
    }
    return [tokens.join(' ')];
  }
  if (observation.kind === 'angle') {
    return [['DN', observation.toId, formatAngleDms(observation.angleDeg)].join(' ')];
  }
  return serializeImportedObservationRecord(observation);
};

const buildGroupMeta = (
  importerId: string,
  observation: ImportedObservationRecord,
): Omit<ImportReviewGroup, 'itemIds'> => {
  if (observation.kind === 'gnss-vector') {
    const mode = observation.gpsMode === 'sideshot' ? 'GPS Sideshot' : 'GPS Network';
    return {
      key: `gps:${observation.gpsMode ?? 'network'}:${observation.fromId}`,
      kind: 'gps',
      label: `${mode} ${observation.fromId}`,
      defaultComment: `${mode.toUpperCase()} ${observation.fromId}`,
      setupId: observation.fromId,
    };
  }

  const setupId = deriveObservationSetupId(observation);
  const isSetupAwareImporter = new Set([
    'jobxml',
    'fieldgenius-raw',
    'carlson-rw5',
    'tds-raw',
    'dbx-export',
  ]).has(importerId);
  const setupType = observation.sourceMeta?.setupType;
  const isResection = importerId === 'jobxml' && isResectionSetupType(setupType);

  if (
    isSetupAwareImporter &&
    (observation.kind === 'measurement' || observation.kind === 'angle') &&
    isResection
  ) {
    return {
      key: `resection:${setupId}:bs:${observation.fromId}`,
      kind: 'resection',
      label: `Resection ${setupId}${observation.fromId ? ` (BS ${observation.fromId})` : ''}`,
      defaultComment: `RESECTION ${setupId}`,
      setupId,
      backsightId: observation.fromId,
    };
  }

  if (
    isSetupAwareImporter &&
    (observation.kind === 'measurement' || observation.kind === 'angle') &&
    observation.fromId
  ) {
    return {
      key: `setup:${setupId}:bs:${observation.fromId}`,
      kind: 'setup',
      label: `Setup ${setupId} (BS ${observation.fromId})`,
      defaultComment: `SETUP ${setupId}`,
      setupId,
      backsightId: observation.fromId,
    };
  }

  return {
    key: `setup:${setupId}`,
    kind: 'setup',
    label: `Setup ${setupId}`,
    defaultComment: `SETUP ${setupId}`,
    setupId,
  };
};

const makeObservationItem = (
  observation: ImportedObservationRecord,
  index: number,
  groupKey: string,
): ImportReviewItem => {
  if (observation.kind === 'measurement' || observation.kind === 'angle') {
    return {
      id: `observation:${index}`,
      kind: 'observation',
      index,
      groupKey,
      sourceType: deriveSourceType('observation', observation),
      sourceLine: observation.sourceLine,
      sourceCode: observation.sourceCode,
      sourceMethod: observation.sourceMeta?.method,
      sourceClassification: observation.sourceMeta?.classification,
      sourceObservationKind: observation.kind,
      setupId: observation.atId,
      backsightId: observation.fromId,
      targetId: observation.toId,
    };
  }

  if (observation.kind === 'gnss-vector') {
    return {
      id: `observation:${index}`,
      kind: 'observation',
      index,
      groupKey,
      sourceType: deriveSourceType('observation', observation),
      sourceLine: observation.sourceLine,
      sourceCode: observation.sourceCode,
      sourceMethod: observation.sourceMeta?.method,
      sourceClassification: observation.sourceMeta?.classification,
      sourceObservationKind: observation.kind,
      setupId: observation.fromId,
      targetId: observation.toId,
    };
  }

  return {
    id: `observation:${index}`,
    kind: 'observation',
    index,
    groupKey,
    sourceType: deriveSourceType('observation', observation),
    sourceLine: observation.sourceLine,
    sourceCode: observation.sourceCode,
    sourceMethod: observation.sourceMeta?.method,
    sourceClassification: observation.sourceMeta?.classification,
    sourceObservationKind: observation.kind,
    setupId: observation.fromId,
    targetId: observation.toId,
  };
};

export const buildImportReviewModel = (dataset: ImportedDataset): ImportReviewModel => {
  const groups: ImportReviewGroup[] = [];
  const groupIndex = new Map<string, number>();
  const items: ImportReviewItem[] = [];
  const ensureGroup = (group: Omit<ImportReviewGroup, 'itemIds'>): ImportReviewGroup => {
    const existingIndex = groupIndex.get(group.key);
    if (existingIndex != null) return groups[existingIndex];
    const next: ImportReviewGroup = { ...group, itemIds: [] };
    groupIndex.set(group.key, groups.length);
    groups.push(next);
    return next;
  };

  const controlGroup = ensureGroup({
    key: 'control',
    kind: 'control',
    label: 'Control',
    defaultComment: 'CONTROL',
  });

  dataset.controlStations.forEach((station, index) => {
    const id = `control:${index}`;
    const item: ImportReviewItem = {
      id,
      kind: 'control',
      index,
      groupKey: controlGroup.key,
      sourceType: deriveSourceType('control', station),
      sourceLine: station.sourceLine,
      sourceCode: station.sourceCode,
      stationId: station.stationId,
    };
    items.push(item);
    controlGroup.itemIds.push(id);
  });

  dataset.observations.forEach((observation, index) => {
    const groupMeta = buildGroupMeta(dataset.importerId, observation);
    const group = ensureGroup(groupMeta);
    const item = makeObservationItem(observation, index, group.key);
    items.push(item);
    group.itemIds.push(item.id);
  });

  return {
    groups: groups.filter((group) => group.itemIds.length > 0),
    items,
    warnings: dataset.trace.filter((entry) => entry.level === 'warning'),
    errors: dataset.trace.filter((entry) => entry.level === 'error'),
  };
};

export const buildImportReviewComparisonSummary = (
  primaryDataset: ImportedDataset,
  primarySourceName: string,
  comparisonDataset: ImportedDataset,
  comparisonSourceName: string,
  mode: ImportReviewComparisonMode = 'non-mta-only',
): ImportReviewComparisonSummary => {
  const makeTotals = (dataset: ImportedDataset): ImportReviewComparisonTotals => ({
    controlStations: dataset.controlStations.length,
    observations: dataset.observations.length,
    comparedObservations: dataset.observations.filter((observation) =>
      isObservationIncludedInComparison(observation, mode),
    ).length,
    warnings: dataset.trace.filter((entry) => entry.level === 'warning').length,
    errors: dataset.trace.filter((entry) => entry.level === 'error').length,
  });

  const accumulate = (
    dataset: ImportedDataset,
  ): Map<string, Omit<ImportReviewComparisonRow, 'primaryCount' | 'comparisonCount' | 'delta'>> => {
    const buckets = new Map<
      string,
      Omit<ImportReviewComparisonRow, 'primaryCount' | 'comparisonCount' | 'delta'>
    >();
    dataset.observations
      .filter((observation) => isObservationIncludedInComparison(observation, mode))
      .forEach((observation) => {
        const setupId = deriveObservationSetupId(observation);
        const backsightId = deriveObservationBacksightId(observation);
        const targetId = deriveObservationTargetId(observation);
        const family = comparisonFamilyLabel(observation);
        const key = [setupId, backsightId ?? '', targetId, family].join('|');
        if (!buckets.has(key)) {
          buckets.set(key, {
            key,
            setupLabel: backsightId ? `Setup ${setupId} (BS ${backsightId})` : `Setup ${setupId}`,
            targetLabel: targetId,
            family,
          });
        }
      });
    return buckets;
  };

  const primaryCounts = new Map<string, number>();
  primaryDataset.observations
    .filter((observation) => isObservationIncludedInComparison(observation, mode))
    .forEach((observation) => {
      const key = [
        deriveObservationSetupId(observation),
        deriveObservationBacksightId(observation) ?? '',
        deriveObservationTargetId(observation),
        comparisonFamilyLabel(observation),
      ].join('|');
      primaryCounts.set(key, (primaryCounts.get(key) ?? 0) + 1);
    });

  const comparisonCounts = new Map<string, number>();
  comparisonDataset.observations
    .filter((observation) => isObservationIncludedInComparison(observation, mode))
    .forEach((observation) => {
      const key = [
        deriveObservationSetupId(observation),
        deriveObservationBacksightId(observation) ?? '',
        deriveObservationTargetId(observation),
        comparisonFamilyLabel(observation),
      ].join('|');
      comparisonCounts.set(key, (comparisonCounts.get(key) ?? 0) + 1);
    });

  const rowMeta = new Map([
    ...accumulate(primaryDataset).entries(),
    ...accumulate(comparisonDataset).entries(),
  ]);

  const rows = [...new Set([...primaryCounts.keys(), ...comparisonCounts.keys()])]
    .map((key) => {
      const meta = rowMeta.get(key);
      const primaryCount = primaryCounts.get(key) ?? 0;
      const comparisonCount = comparisonCounts.get(key) ?? 0;
      return {
        key,
        setupLabel: meta?.setupLabel ?? key,
        targetLabel: meta?.targetLabel ?? '',
        family: meta?.family ?? '',
        primaryCount,
        comparisonCount,
        delta: primaryCount - comparisonCount,
      };
    })
    .filter((row) => row.delta !== 0)
    .sort((left, right) => {
      const magnitudeCompare = Math.abs(right.delta) - Math.abs(left.delta);
      if (magnitudeCompare !== 0) return magnitudeCompare;
      const setupCompare = compareImportTokens(left.setupLabel, right.setupLabel);
      if (setupCompare !== 0) return setupCompare;
      const targetCompare = compareImportTokens(left.targetLabel, right.targetLabel);
      if (targetCompare !== 0) return targetCompare;
      return compareImportTokens(left.family, right.family);
    });

  return {
    mode,
    primarySourceName,
    comparisonSourceName,
    primaryImporterId: primaryDataset.importerId,
    comparisonImporterId: comparisonDataset.importerId,
    primaryTotals: makeTotals(primaryDataset),
    comparisonTotals: makeTotals(comparisonDataset),
    rows,
  };
};

export const buildImportReviewComparisonKeyForItem = (
  item: ImportReviewItem,
  mode: ImportReviewComparisonMode,
): string | null => {
  if (item.kind !== 'observation' || !item.sourceObservationKind) return null;
  if (mode === 'non-mta-only' && item.sourceMethod === 'MEANTURNEDANGLE') return null;
  const setupId = item.setupId ?? '';
  const backsightId = item.backsightId ?? '';
  const targetId = item.targetId ?? '';
  const family = comparisonFamilyLabelForKind(item.sourceObservationKind);
  return [setupId, backsightId, targetId, family].join('|');
};

const cloneImportReviewModel = (model: ImportReviewModel): ImportReviewModel => ({
  groups: model.groups.map((group) => ({
    ...group,
    itemIds: [...group.itemIds],
  })),
  items: model.items.map((item) => ({ ...item })),
  warnings: [...model.warnings],
  errors: [...model.errors],
});

export const duplicateImportReviewItem = (
  model: ImportReviewModel,
  itemId: string,
  nextId: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const sourceItem = nextModel.items.find((item) => item.id === itemId);
  if (!sourceItem || sourceItem.kind === 'comment') return nextModel;
  const group = nextModel.groups.find((entry) => entry.key === sourceItem.groupKey);
  if (!group) return nextModel;
  const insertIndex = group.itemIds.indexOf(itemId);
  const duplicateItem: ImportReviewItem = {
    ...sourceItem,
    id: nextId,
    synthetic: true,
  };
  nextModel.items.push(duplicateItem);
  group.itemIds.splice(insertIndex + 1, 0, nextId);
  return nextModel;
};

export const createImportReviewGroupFromItem = (
  model: ImportReviewModel,
  itemId: string,
  nextGroupKey: string,
  label: string,
  defaultComment: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const item = nextModel.items.find((entry) => entry.id === itemId);
  if (!item || item.groupKey === 'control') return nextModel;
  const sourceGroupIndex = nextModel.groups.findIndex((group) => group.key === item.groupKey);
  if (sourceGroupIndex < 0) return nextModel;
  const sourceGroup = nextModel.groups[sourceGroupIndex];
  const nextGroup: ImportReviewGroup = {
    key: nextGroupKey,
    kind: sourceGroup.kind === 'control' ? 'setup' : sourceGroup.kind,
    label,
    defaultComment,
    synthetic: true,
    manualOrder: true,
    setupId: item.setupId ?? sourceGroup.setupId,
    backsightId: item.backsightId ?? sourceGroup.backsightId,
    itemIds: [itemId],
  };
  sourceGroup.itemIds = sourceGroup.itemIds.filter((entry) => entry !== itemId);
  item.groupKey = nextGroupKey;
  nextModel.groups.splice(sourceGroupIndex + 1, 0, nextGroup);
  return nextModel;
};

export const createEmptyImportReviewGroup = (
  model: ImportReviewModel,
  nextGroupKey: string,
  label: string,
  defaultComment: string,
  afterGroupKey?: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  if (nextModel.groups.some((group) => group.key === nextGroupKey)) return nextModel;
  const insertAfterIndex =
    afterGroupKey != null
      ? nextModel.groups.findIndex((group) => group.key === afterGroupKey)
      : nextModel.groups.length - 1;
  const nextGroup: ImportReviewGroup = {
    key: nextGroupKey,
    kind: 'setup',
    label,
    defaultComment,
    synthetic: true,
    manualOrder: true,
    itemIds: [],
  };
  nextModel.groups.splice(Math.max(insertAfterIndex, 0) + 1, 0, nextGroup);
  return nextModel;
};

export const removeImportReviewGroup = (
  model: ImportReviewModel,
  groupKey: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  nextModel.groups = nextModel.groups.filter(
    (group) => !(group.key === groupKey && group.synthetic && group.itemIds.length === 0),
  );
  return nextModel;
};

export const insertImportReviewCommentRow = (
  model: ImportReviewModel,
  afterItemId: string,
  nextId: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const sourceItem = nextModel.items.find((item) => item.id === afterItemId);
  if (!sourceItem) return nextModel;
  const group = nextModel.groups.find((entry) => entry.key === sourceItem.groupKey);
  if (!group) return nextModel;
  const insertIndex = group.itemIds.indexOf(afterItemId);
  const commentItem: ImportReviewItem = {
    id: nextId,
    kind: 'comment',
    index: -1,
    groupKey: sourceItem.groupKey,
    sourceType: 'Comment',
    synthetic: true,
    defaultText: '# COMMENT',
  };
  nextModel.items.push(commentItem);
  group.itemIds.splice(insertIndex + 1, 0, nextId);
  return nextModel;
};

export const moveImportReviewItem = (
  model: ImportReviewModel,
  itemId: string,
  nextGroupKey: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const item = nextModel.items.find((entry) => entry.id === itemId);
  if (!item || item.groupKey === nextGroupKey) return nextModel;
  const sourceGroup = nextModel.groups.find((group) => group.key === item.groupKey);
  const targetGroup = nextModel.groups.find((group) => group.key === nextGroupKey);
  if (!sourceGroup || !targetGroup) return nextModel;
  sourceGroup.itemIds = sourceGroup.itemIds.filter((entry) => entry !== itemId);
  targetGroup.itemIds.push(itemId);
  sourceGroup.manualOrder = true;
  targetGroup.manualOrder = true;
  item.groupKey = nextGroupKey;
  return nextModel;
};

export const reorderImportReviewItemWithinGroup = (
  model: ImportReviewModel,
  itemId: string,
  direction: 'up' | 'down',
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const item = nextModel.items.find((entry) => entry.id === itemId);
  if (!item) return nextModel;
  const group = nextModel.groups.find((entry) => entry.key === item.groupKey);
  if (!group) return nextModel;
  const index = group.itemIds.indexOf(itemId);
  if (index < 0) return nextModel;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= group.itemIds.length) return nextModel;
  const [moved] = group.itemIds.splice(index, 1);
  group.itemIds.splice(targetIndex, 0, moved);
  group.manualOrder = true;
  return nextModel;
};

export const removeImportReviewItem = (
  model: ImportReviewModel,
  itemId: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const item = nextModel.items.find((entry) => entry.id === itemId);
  if (!item?.synthetic) return nextModel;
  nextModel.items = nextModel.items.filter((entry) => entry.id !== itemId);
  nextModel.groups.forEach((group) => {
    group.itemIds = group.itemIds.filter((entry) => entry !== itemId);
  });
  return nextModel;
};

const serializeTsDirectionSetMeasurement = (
  observation: ImportedMeasurementObservationRecord,
): string => {
  return [
    'DM',
    observation.toId,
    formatAngleDms(observation.angleDeg),
    formatLinear(observation.distanceM),
  ].join(' ');
};

const serializeTsDirectionSetAngle = (observation: ImportedAngleObservationRecord): string => {
  return ['DN', observation.toId, formatAngleDms(observation.angleDeg)].join(' ');
};

const serializeTsDirectionSetRecord = (observation: ImportedObservationRecord): string[] => {
  if (observation.kind === 'measurement') {
    return [serializeTsDirectionSetMeasurement(observation)];
  }
  if (observation.kind === 'angle') {
    return [serializeTsDirectionSetAngle(observation)];
  }
  if (observation.kind === 'distance') {
    return [
      ['D', `${observation.fromId}-${observation.toId}`, formatLinear(observation.distanceM)].join(
        ' ',
      ),
    ];
  }
  if (observation.kind === 'bearing') {
    return [
      [
        'B',
        `${observation.fromId}-${observation.toId}`,
        formatAngleDms(observation.bearingDeg),
      ].join(' '),
    ];
  }
  return serializeImportedObservationRecord(observation);
};

const serializeObservationForImport = (
  observation: ImportedObservationRecord,
  preset: ImportReviewOutputPreset,
  rowTypeOverride: ImportReviewRowTypeOverride,
): string[] => {
  if (rowTypeOverride === 'distance') {
    return serializeDistanceFocusedObservation(observation);
  }
  if (rowTypeOverride === 'distance-vertical') {
    return serializeDistanceVerticalFocusedObservation(observation);
  }
  if (rowTypeOverride === 'angle') {
    return serializeAngleFocusedObservation(observation);
  }
  if (rowTypeOverride === 'vertical') {
    return serializeVerticalFocusedObservation(observation);
  }
  if (rowTypeOverride === 'bearing') {
    return serializeBearingFocusedObservation(observation);
  }
  if (rowTypeOverride === 'direction-angle') {
    return serializeDirectionAngleFocusedObservation(observation);
  }
  if (rowTypeOverride === 'direction-measurement') {
    return serializeDirectionMeasurementFocusedObservation(observation);
  }
  if (rowTypeOverride === 'measurement') {
    return serializeImportedObservationRecord(observation);
  }
  if (preset === 'ts-direction-set') {
    return serializeTsDirectionSetRecord(observation);
  }
  return serializeImportedObservationRecord(observation);
};

const slopeZenithToHorizontalDistance = (slopeDistanceM: number, zenithDeg: number): number => {
  const zenithRad = zenithDeg * DEG_TO_RAD;
  const horizontal = slopeDistanceM * Math.sin(zenithRad);
  return Number.isFinite(horizontal) ? Math.abs(horizontal) : slopeDistanceM;
};

export const convertImportedDatasetSlopeZenithToHd2D = (
  dataset: ImportedDataset,
): ImportedDataset => {
  const controlStations = dataset.controlStations.map((station) => ({
    ...station,
    heightM: undefined,
    sigmaHeightM: undefined,
  }));
  const observations = dataset.observations.flatMap((observation) => {
    if (observation.kind === 'vertical') {
      return [];
    }
    if (
      observation.kind === 'measurement' &&
      observation.verticalMode === 'zenith' &&
      observation.verticalValue != null &&
      Number.isFinite(observation.verticalValue)
    ) {
      const horizontalDistanceM = slopeZenithToHorizontalDistance(
        observation.distanceM,
        observation.verticalValue,
      );
      return [
        {
          ...observation,
          distanceM: horizontalDistanceM,
          verticalMode: undefined,
          verticalValue: undefined,
          hiM: undefined,
          htM: undefined,
          note: observation.note
            ? `${observation.note}; converted SD+zenith -> HD`
            : 'converted SD+zenith -> HD',
        } as ImportedObservationRecord,
      ];
    }
    if (
      observation.kind === 'distance-vertical' &&
      observation.verticalMode === 'zenith' &&
      Number.isFinite(observation.verticalValue)
    ) {
      const horizontalDistanceM = slopeZenithToHorizontalDistance(
        observation.distanceM,
        observation.verticalValue,
      );
      return [
        {
          kind: 'distance',
          fromId: observation.fromId,
          toId: observation.toId,
          distanceM: horizontalDistanceM,
          sourceLine: observation.sourceLine,
          sourceCode: observation.sourceCode,
          description: observation.description,
          sourceMeta: observation.sourceMeta,
          note: observation.note
            ? `${observation.note}; converted SD+zenith -> HD`
            : 'converted SD+zenith -> HD',
        } as ImportedObservationRecord,
      ];
    }
    return [observation];
  });
  return {
    ...dataset,
    controlStations,
    observations,
  };
};

export const buildImportReviewDisplayTextMap = (
  dataset: ImportedDataset,
  model: ImportReviewModel,
  preset: ImportReviewOutputPreset,
  coordMode: CoordMode = '3D',
  rowOverrides: Record<string, string> = {},
  force2D = false,
): Record<string, string> => {
  const output: Record<string, string> = {};
  model.items.forEach((item) => {
    const override = rowOverrides[item.id];
    if (override != null) {
      output[item.id] = override;
      return;
    }
    if (item.kind === 'comment') {
      output[item.id] = item.defaultText ?? '# COMMENT';
      return;
    }
    if (item.kind === 'control') {
      output[item.id] = serializeImportedControlStationRecord(
        dataset.controlStations[item.index],
        coordMode,
        force2D,
      );
      return;
    }
    output[item.id] =
      preset === 'ts-direction-set'
        ? serializeTsDirectionSetRecord(dataset.observations[item.index]).join(' | ')
        : serializeObservationPreview(dataset.observations[item.index], preset);
  });
  return output;
};

const appendPresetObservationLines = (
  lines: string[],
  observation: ImportedObservationRecord,
  preset: ImportReviewOutputPreset,
  overrideLines: string[] | undefined,
  rowTypeOverride: ImportReviewRowTypeOverride,
  fixed: boolean,
  coordMode: CoordMode,
  state: {
    currentDeltaMode: 'delta-h' | 'zenith' | null;
    currentGpsMode: 'network' | 'sideshot' | null;
  },
) => {
  if (overrideLines && overrideLines.length > 0) {
    applyFixedTokensToLines(overrideLines, fixed, coordMode).forEach((line) => lines.push(line));
    return;
  }
  const serializedLines = applyFixedTokensToLines(
    serializeObservationForImport(observation, preset, rowTypeOverride),
    fixed,
    coordMode,
  );
  serializedLines.forEach((line) => {
    if (line === '.DELTA ON') {
      if (state.currentDeltaMode !== 'delta-h') {
        lines.push(line);
        state.currentDeltaMode = 'delta-h';
      }
      return;
    }
    if (line === '.DELTA OFF') {
      if (state.currentDeltaMode !== 'zenith') {
        lines.push(line);
        state.currentDeltaMode = 'zenith';
      }
      return;
    }
    if (line.startsWith('.GPS ')) {
      const desiredGpsMode = /SIDESHOT/i.test(line) ? 'sideshot' : 'network';
      if (state.currentGpsMode !== desiredGpsMode) {
        lines.push(line);
        state.currentGpsMode = desiredGpsMode;
      }
      return;
    }
    lines.push(line);
  });
};

const isDirectionSetRowType = (value: ImportReviewRowTypeOverride): boolean =>
  value === 'direction-angle' || value === 'direction-measurement';

const isDirectionSetObservationItem = (
  observation: ImportedObservationRecord,
  rowTypeOverride: ImportReviewRowTypeOverride,
  preset: ImportReviewOutputPreset,
  group: ImportReviewGroup,
): boolean => {
  if (observation.kind !== 'measurement' && observation.kind !== 'angle') return false;
  if (rowTypeOverride === 'direction-angle' || rowTypeOverride === 'direction-measurement') {
    return true;
  }
  if (rowTypeOverride !== 'auto') return false;
  return preset === 'ts-direction-set' && (group.kind === 'resection' || group.kind === 'setup');
};

const resolveDirectionFaceBucket = (
  observation: ImportedObservationRecord,
  zenithWindowDeg = 45,
): DirectionFaceBucket => {
  const metadataFace = normalizeDirectionFace(observation.sourceMeta?.face);
  if (metadataFace !== 'unresolved') return metadataFace;
  if (observation.kind !== 'measurement' || observation.verticalMode !== 'zenith') {
    return 'unresolved';
  }
  return inferDirectionFaceFromZenithDeg(observation.verticalValue, zenithWindowDeg);
};

const shouldEmitSyntheticBacksightDnForDirectionBlock = (
  mode: 'auto' | 'always' | 'never',
  backsightId: string | undefined,
  lines: string[],
): boolean => {
  if (!backsightId) return false;
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return !lines.some((line) => parseDirectionLineTarget(line) === backsightId);
};

const buildFaceAwareDirectionSetLines = (
  dataset: ImportedDataset,
  orderedItems: ImportReviewItem[],
  group: ImportReviewGroup,
  preset: ImportReviewOutputPreset,
  rowOverrides: Record<string, string> | undefined,
  rowTypeOverrides: Record<string, ImportReviewRowTypeOverride> | undefined,
  fixedItemIds: Set<string> | undefined,
  coordMode: CoordMode,
  faceNormalizationMode: FaceNormalizationMode | undefined,
  syntheticDirectionBacksightMode: 'auto' | 'always' | 'never',
  emitDirectionFaceHints: boolean,
): string[] | null => {
  const serializedEntries: Array<{ line: string; face: DirectionFaceBucket }> = [];
  const commentLines: string[] = [];
  const zenithWindowDeg = 45;

  for (const item of orderedItems) {
    if (item.kind === 'comment') {
      const commentOverride = rowOverrides?.[item.id];
      splitOverrideLines(commentOverride ?? item.defaultText ?? '# COMMENT').forEach((line) =>
        commentLines.push(line),
      );
      continue;
    }
    if (item.kind !== 'observation') {
      return null;
    }
    const observation = dataset.observations[item.index];
    const rowTypeOverride = rowTypeOverrides?.[item.id] ?? 'auto';
    if (!isDirectionSetObservationItem(observation, rowTypeOverride, preset, group)) {
      return null;
    }
    const overrideLines = splitOverrideLines(rowOverrides?.[item.id]);
    const serializedLines = applyFixedTokensToLines(
      overrideLines.length > 0
        ? overrideLines
        : serializeObservationForImport(observation, preset, rowTypeOverride),
      fixedItemIds?.has(item.id) ?? false,
      coordMode,
    );
    const faceBucket = resolveDirectionFaceBucket(observation, zenithWindowDeg);

    for (const rawLine of serializedLines) {
      if (!rawLine.trim() || rawLine.startsWith('#')) {
        if (rawLine.trim()) commentLines.push(rawLine);
        continue;
      }
      if (rawLine.startsWith('.')) return null;
      if (!parseDirectionLineTarget(rawLine)) return null;
      serializedEntries.push({ line: rawLine, face: faceBucket });
    }
  }

  if (serializedEntries.length === 0) return null;

  const mode = faceNormalizationMode ?? 'on';
  const splitByFace = mode === 'off';
  const normalizeFace2 = mode !== 'off';
  const nextLines: string[] = [...commentLines];
  const setupId = group.setupId ?? '';
  const backsightId = group.backsightId;

  if (!splitByFace) {
    const normalizedLines = serializedEntries.map((entry) => {
      const normalizedLine =
        normalizeFace2 && entry.face === 'face2'
          ? normalizeDirectionLineFace2ToFace1(entry.line) ?? entry.line
          : entry.line;
      if (!emitDirectionFaceHints) return normalizedLine;
      const effectiveFace: DirectionFaceBucket = entry.face === 'unresolved' ? 'unresolved' : 'face1';
      return appendDirectionLineFaceHint(normalizedLine, effectiveFace);
    });
    nextLines.push(`DB ${setupId}`.trimEnd());
    if (
      shouldEmitSyntheticBacksightDnForDirectionBlock(
        syntheticDirectionBacksightMode,
        backsightId,
        normalizedLines,
      )
    ) {
      nextLines.push(`DN ${backsightId} 000-00-00`);
    }
    normalizedLines.forEach((line) => nextLines.push(line));
    nextLines.push('DE');
    return nextLines;
  }

  const decorateSplitLine = (line: string, face: DirectionFaceBucket): string =>
    emitDirectionFaceHints ? appendDirectionLineFaceHint(line, face) : line;
  const face1Lines = serializedEntries
    .filter((entry) => entry.face === 'face1')
    .map((entry) => decorateSplitLine(entry.line, 'face1'));
  const face2Lines = serializedEntries
    .filter((entry) => entry.face === 'face2')
    .map((entry) => decorateSplitLine(entry.line, 'face2'));
  const unresolvedLines = serializedEntries
    .filter((entry) => entry.face === 'unresolved')
    .map((entry) => decorateSplitLine(entry.line, 'unresolved'));
  const blocks = [
    { label: '# FACE 1', lines: face1Lines },
    { label: '# FACE 2', lines: face2Lines },
    { label: '# FACE UNRESOLVED', lines: unresolvedLines },
  ].filter((block) => block.lines.length > 0);
  const useFaceLabels = blocks.length > 1;

  blocks.forEach((block, index) => {
    if (index > 0) nextLines.push('');
    if (useFaceLabels) nextLines.push(block.label);
    nextLines.push(`DB ${setupId}`.trimEnd());
    if (
      shouldEmitSyntheticBacksightDnForDirectionBlock(
        syntheticDirectionBacksightMode,
        backsightId,
        block.lines,
      )
    ) {
      nextLines.push(`DN ${backsightId} 000-00-00`);
    }
    block.lines.forEach((line) => nextLines.push(line));
    nextLines.push('DE');
  });

  return nextLines;
};

const isBacksightTargetItem = (item: ImportReviewItem, group: ImportReviewGroup): boolean =>
  item.kind === 'observation' &&
  Boolean(group.backsightId) &&
  Boolean(item.targetId) &&
  item.targetId === group.backsightId;

const getFieldGroupedOrderRank = (item: ImportReviewItem, group: ImportReviewGroup): number => {
  if (item.kind !== 'observation') return 99;
  if (isBacksightTargetItem(item, group)) {
    if (item.sourceClassification === 'BackSight') return 0;
    if (item.sourceClassification === 'Check') return 1;
    if (item.sourceMethod === 'MEANTURNEDANGLE') return 2;
    return 3;
  }
  if (item.sourceMethod === 'MEANTURNEDANGLE') return 2;
  if (item.sourceClassification === 'Check') return 1;
  return 0;
};

const orderFieldGroupedItems = (
  items: ImportReviewItem[],
  group: ImportReviewGroup,
): ImportReviewItem[] => {
  if (group.manualOrder || items.some((item) => item.kind === 'comment' || item.synthetic))
    return items;
  return [...items].sort((left, right) => {
    if (left.kind === 'comment' || right.kind === 'comment') return 0;
    const leftBacksight = isBacksightTargetItem(left, group) ? 0 : 1;
    const rightBacksight = isBacksightTargetItem(right, group) ? 0 : 1;
    if (leftBacksight !== rightBacksight) return leftBacksight - rightBacksight;
    const targetCompare = compareImportTokens(left.targetId, right.targetId);
    if (targetCompare !== 0) return targetCompare;
    const leftRank = getFieldGroupedOrderRank(left, group);
    const rightRank = getFieldGroupedOrderRank(right, group);
    if (leftRank !== rightRank) return leftRank - rightRank;
    const sourceLineCompare =
      (left.sourceLine ?? Number.MAX_SAFE_INTEGER) - (right.sourceLine ?? Number.MAX_SAFE_INTEGER);
    if (sourceLineCompare !== 0) return sourceLineCompare;
    return compareImportTokens(left.id, right.id);
  });
};

const resolveFieldGroupedSection = (
  item: ImportReviewItem,
  group: ImportReviewGroup,
): string | null => {
  if (item.kind !== 'observation') return null;
  if (isBacksightTargetItem(item, group) && group.backsightId) {
    return `BACKSIGHT ${group.backsightId}`;
  }
  if (item.targetId) {
    return `${group.kind === 'resection' ? 'RESECTION TARGET' : 'TARGET'} ${item.targetId}`;
  }
  if (item.sourceClassification === 'Check') return 'CHECK OBS';
  if (item.sourceMethod === 'MEANTURNEDANGLE') return 'MTA OBS';
  if (item.sourceMethod) return 'RAW OBS';
  return null;
};

export const buildImportReviewText = (
  dataset: ImportedDataset,
  model: ImportReviewModel,
  options: BuildImportReviewTextOptions,
): string => {
  const lines: string[] = [];
  const itemLookup = new Map(model.items.map((item) => [item.id, item]));
  const preset = options.preset ?? 'clean-webnet';
  const coordMode: CoordMode =
    options.force2D === true
      ? '2D'
      : (options.coordMode ?? (preset === 'ts-direction-set' ? '2D' : '3D'));
  const state = {
    currentDeltaMode: null as 'delta-h' | 'zenith' | null,
    currentGpsMode: null as 'network' | 'sideshot' | null,
  };

  if (coordMode === '2D') {
    lines.push('.2D');
  }
  lines.push('.UNITS M');
  lines.push('.ORDER EN');

  model.groups.forEach((group) => {
    const includedItems = group.itemIds
      .map((itemId) => itemLookup.get(itemId))
      .filter((item): item is ImportReviewItem => Boolean(item))
      .filter((item) => options.includedItemIds.has(item.id));

    if (includedItems.length === 0) return;

    const comment = options.groupComments?.[group.key]?.trim() ?? group.defaultComment;
    if (lines.length > 0) lines.push('');
    if (comment) lines.push(`# ${comment}`);

    const isDirectionSetGroup =
      Boolean(group.backsightId) &&
      includedItems.some((item) => item.kind === 'observation') &&
      ((preset === 'ts-direction-set' && (group.kind === 'resection' || group.kind === 'setup')) ||
        includedItems.some((item) =>
          isDirectionSetRowType(options.rowTypeOverrides?.[item.id] ?? 'auto'),
        ));
    const syntheticBacksightMode = options.syntheticDirectionBacksightMode ?? 'auto';

    const orderedItems =
      (preset === 'field-grouped' || preset === 'ts-direction-set') && group.kind !== 'control'
        ? orderFieldGroupedItems(includedItems, group)
        : includedItems;

    if (isDirectionSetGroup) {
      const faceAwareLines = buildFaceAwareDirectionSetLines(
        dataset,
        orderedItems,
        group,
        preset,
        options.rowOverrides,
        options.rowTypeOverrides,
        options.fixedItemIds,
        coordMode,
        options.faceNormalizationMode,
        syntheticBacksightMode,
        options.emitDirectionFaceHints ?? false,
      );
      if (faceAwareLines) {
        faceAwareLines.forEach((line) => lines.push(line));
        return;
      }
    }

    const hasExplicitBacksightPointing =
      Boolean(group.backsightId) &&
      includedItems.some(
        (item) =>
          item.kind === 'observation' &&
          item.targetId === group.backsightId &&
          item.sourceClassification === 'BackSight',
      );
    const emitSyntheticBacksightDn =
      isDirectionSetGroup &&
      group.backsightId &&
      (syntheticBacksightMode === 'always' ||
        (syntheticBacksightMode === 'auto' && !hasExplicitBacksightPointing));

    if (isDirectionSetGroup) {
      lines.push(`DB ${group.setupId ?? includedItems[0]?.setupId ?? ''}`.trimEnd());
      if (emitSyntheticBacksightDn) {
        lines.push(`DN ${group.backsightId} 000-00-00`);
      }
    }
    const distinctFieldSections =
      preset === 'field-grouped'
        ? new Set(
            orderedItems
              .map((item) => resolveFieldGroupedSection(item, group))
              .filter((value): value is string => Boolean(value)),
          )
        : new Set<string>();
    let lastFieldSection: string | null = null;

    orderedItems.forEach((item) => {
      const itemCommentLines = options.itemCommentLines?.[item.id] ?? [];
      itemCommentLines.forEach((line) => lines.push(line));

      if (item.kind === 'comment') {
        const override = options.rowOverrides?.[item.id];
        const commentLines = splitOverrideLines(override ?? item.defaultText ?? '# COMMENT');
        commentLines.forEach((line) => lines.push(line));
        return;
      }

      if (
        preset === 'field-grouped' &&
        group.kind !== 'control' &&
        distinctFieldSections.size > 1
      ) {
        const nextSection = resolveFieldGroupedSection(item, group);
        if (nextSection && nextSection !== lastFieldSection) {
          lines.push(`# ${nextSection}`);
          lastFieldSection = nextSection;
        }
      }

      if (item.kind === 'control') {
        const override = options.rowOverrides?.[item.id];
        if (override?.trim()) {
          applyFixedTokensToLines(
            splitOverrideLines(override),
            options.fixedItemIds?.has(item.id) ?? false,
            coordMode,
          ).forEach((line) => lines.push(line));
        } else {
          const controlLine = serializeImportedControlStationRecord(
            dataset.controlStations[item.index],
            coordMode,
            options.force2D === true,
          );
          lines.push(
            options.fixedItemIds?.has(item.id)
              ? appendFixedTokensToLine(controlLine, coordMode)
              : controlLine,
          );
        }
        return;
      }
      appendPresetObservationLines(
        lines,
        dataset.observations[item.index],
        preset,
        splitOverrideLines(options.rowOverrides?.[item.id]),
        options.rowTypeOverrides?.[item.id] ?? 'auto',
        options.fixedItemIds?.has(item.id) ?? false,
        coordMode,
        state,
      );
    });

    if (isDirectionSetGroup) {
      lines.push('DE');
    }
  });

  lines.push('');
  return lines.join('\n');
};
