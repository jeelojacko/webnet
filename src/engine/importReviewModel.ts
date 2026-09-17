import type {
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedObservationRecord,
  ImportedTraceEntry,
} from './importers';
import { describeSourceUnits, needsUnitConfirmation } from './importUnitProvenance';
import { detectStationDefinitionConflicts } from './importSourceIdentity';
import type {
  ImportReviewGroup,
  ImportReviewItem,
  ImportReviewItemKind,
  ImportReviewModel,
  ImportReviewWorkspaceSource,
} from './importReviewTypes';
import {
  deriveObservationSetupId,
  isResectionSetupType,
  normalizeFaceLabel,
  prettifyToken,
} from './importReviewFormatters';
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

export const STAGED_SOURCE_SUMMARY_VERSION = 1;

export interface StagedSourceSummary {
  sourceKey?: string;
  sourceName?: string;
  importerId: string;
  formatLabel: string;
  /** Human-readable units, e.g. `ft (declared by source)`. */
  unitsLabel: string;
  /** True when commit must stay disabled until the user confirms units. */
  unitConfirmationRequired: boolean;
  controlCount: number;
  observationCount: number;
  warningCount: number;
  errorCount: number;
  /** Interpreted CSV column mapping (`canonical -> header`), when applicable. */
  columnMapping?: Record<string, string>;
  /** Relation to already-staged sources (`Possible revision of X`). */
  relationNote?: string;
  warnings: ImportedTraceEntry[];
}

export const buildStagedSourceSummary = (
  dataset: ImportedDataset,
  options: { sourceKey?: string; sourceName?: string; relationNote?: string } = {},
): StagedSourceSummary => ({
  sourceKey: options.sourceKey,
  sourceName: options.sourceName,
  importerId: dataset.importerId,
  formatLabel: dataset.formatLabel,
  unitsLabel: describeSourceUnits(dataset.sourceUnits),
  unitConfirmationRequired: needsUnitConfirmation(dataset),
  controlCount: dataset.controlStations.length,
  observationCount: dataset.observations.length,
  warningCount: dataset.trace.filter((entry) => entry.level === 'warning').length,
  errorCount: dataset.trace.filter((entry) => entry.level === 'error').length,
  columnMapping: dataset.columnMapping ? { ...dataset.columnMapping } : undefined,
  relationNote: options.relationNote,
  warnings: dataset.trace.filter((entry) => entry.level === 'warning'),
});

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

const cloneImportedRecordWithSource = <T extends ImportedControlStationRecord | ImportedObservationRecord>(
  record: T,
  sourceKey: string,
  sourceName: string,
): T =>
  ({
    ...record,
    importSourceKey: sourceKey,
    importSourceName: sourceName,
  }) as T;

const scopeImportReviewModel = (
  model: ImportReviewModel,
  sourceKey: string,
  sourceName: string,
  controlOffset: number,
  observationOffset: number,
): ImportReviewModel => ({
  groups: model.groups.map((group) => ({
    ...group,
    key: `${sourceKey}:${group.key}`,
    sourceKey,
    sourceName,
    itemIds: group.itemIds.map((itemId) => `${sourceKey}:${itemId}`),
  })),
  items: model.items.map((item) => ({
    ...item,
    id: `${sourceKey}:${item.id}`,
    groupKey: `${sourceKey}:${item.groupKey}`,
    sourceKey,
    sourceName,
    index:
      item.kind === 'control'
        ? item.index + controlOffset
        : item.kind === 'observation'
          ? item.index + observationOffset
          : item.index,
  })),
  warnings: [...model.warnings],
  errors: [...model.errors],
});

export const appendImportReviewSource = (
  dataset: ImportedDataset,
  model: ImportReviewModel,
  source: ImportReviewWorkspaceSource,
): { dataset: ImportedDataset; reviewModel: ImportReviewModel } => {
  const controlOffset = dataset.controlStations.length;
  const observationOffset = dataset.observations.length;
  const scopedModel = scopeImportReviewModel(
    buildImportReviewModel(source.dataset),
    source.key,
    source.sourceName,
    controlOffset,
    observationOffset,
  );

  const mergedControlStations = [
    ...dataset.controlStations,
    ...source.dataset.controlStations.map((station) =>
      cloneImportedRecordWithSource(station, source.key, source.sourceName),
    ),
  ];
  // Phase 17C — same ID with differing coords across staged sources is a
  // BLOCKING STATION_DEFINITION_CONFLICT (never silent last-wins). Exact
  // same ID+coords merges silently; repeated observations are untouched.
  const seenConflictKeys = new Set(
    dataset.trace
      .filter((entry) => entry.sourceCode === 'STATION_DEFINITION_CONFLICT' && entry.raw != null)
      .map((entry) => entry.raw as string),
  );
  const conflictEntries: ImportedTraceEntry[] = [];
  detectStationDefinitionConflicts(mergedControlStations).forEach((conflict) => {
    if (seenConflictKeys.has(conflict.stationId)) return;
    seenConflictKeys.add(conflict.stationId);
    conflictEntries.push({
      level: 'warning',
      sourceCode: 'STATION_DEFINITION_CONFLICT',
      message: conflict.reason,
      raw: conflict.stationId,
    });
  });

  return {
    dataset: {
      ...dataset,
      comments: [...dataset.comments, ...source.dataset.comments],
      controlStations: mergedControlStations,
      observations: [
        ...dataset.observations,
        ...source.dataset.observations.map((observation) =>
          cloneImportedRecordWithSource(observation, source.key, source.sourceName),
        ),
      ],
      trace: [...dataset.trace, ...source.dataset.trace, ...conflictEntries],
    },
    reviewModel: {
      groups: [...model.groups, ...scopedModel.groups],
      items: [...model.items, ...scopedModel.items],
      warnings: [...model.warnings, ...scopedModel.warnings, ...conflictEntries],
      errors: [...model.errors, ...scopedModel.errors],
    },
  };
};
