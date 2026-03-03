import { DEG_TO_RAD, radToDmsStr } from './angles';
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
} from './importers';

export type ImportReviewItemKind = 'control' | 'observation' | 'comment';
export type ImportReviewGroupKind = 'control' | 'setup' | 'resection' | 'gps';
export type ImportReviewOutputPreset = 'clean-webnet' | 'field-grouped' | 'ts-direction-set';

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

export interface BuildImportReviewTextOptions {
  includedItemIds: Set<string>;
  groupComments?: Record<string, string>;
  rowOverrides?: Record<string, string>;
  preset?: ImportReviewOutputPreset;
}

const prettifyToken = (value: string): string =>
  value
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatLinear = (value: number): string => value.toFixed(4);

const formatAngleDms = (valueDeg: number): string => radToDmsStr(valueDeg * DEG_TO_RAD);

const splitOverrideLines = (value: string | undefined): string[] =>
  value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0) ?? [];

const compareImportTokens = (left: string | undefined, right: string | undefined): number =>
  (left ?? '').localeCompare(right ?? '', undefined, { numeric: true, sensitivity: 'base' });

const deriveObservationSetupId = (observation: ImportedObservationRecord): string => {
  if (observation.kind === 'measurement' || observation.kind === 'angle') return observation.atId;
  return observation.fromId;
};

const isResectionSetupType = (value: string | undefined): boolean =>
  /resection/i.test((value ?? '').trim());

const normalizeFaceLabel = (value: string | undefined): string | null => {
  const normalized = (value ?? '').trim().toUpperCase();
  if (normalized === 'FACE1') return 'F1';
  if (normalized === 'FACE2') return 'F2';
  return normalized ? prettifyToken(normalized) : null;
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
      tokens.push(formatLinear(observation.verticalValue));
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

  if (isSetupAwareImporter && (observation.kind === 'measurement' || observation.kind === 'angle') && isResection) {
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
  item.groupKey = nextGroupKey;
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

const appendObservationLines = (
  lines: string[],
  observation: ImportedObservationRecord,
  state: {
    currentDeltaMode: 'delta-h' | 'zenith' | null;
    currentGpsMode: 'network' | 'sideshot' | null;
  },
) => {
  if (observation.kind === 'gnss-vector') {
    const desiredGpsMode = observation.gpsMode ?? 'network';
    if (state.currentGpsMode !== desiredGpsMode) {
      lines.push(`.GPS ${desiredGpsMode.toUpperCase()}`);
      state.currentGpsMode = desiredGpsMode;
    }
  }

  serializeImportedObservationRecord(observation).forEach((line) => {
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
    lines.push(line);
  });
};

const serializeTsDirectionSetMeasurement = (
  observation: ImportedMeasurementObservationRecord,
): string => {
  const isResection = isResectionSetupType(observation.sourceMeta?.setupType);
  if (isResection) {
    return ['DM', observation.toId, formatAngleDms(observation.angleDeg), formatLinear(observation.distanceM)].join(
      ' ',
    );
  }
  if (observation.toId === observation.fromId) {
    return ['D', `${observation.atId}-${observation.fromId}`, formatLinear(observation.distanceM)].join(' ');
  }
  return [
    'M',
    `${observation.atId}-${observation.fromId}-${observation.toId}`,
    formatAngleDms(observation.angleDeg),
    formatLinear(observation.distanceM),
  ].join(' ');
};

const serializeTsDirectionSetAngle = (observation: ImportedAngleObservationRecord): string => {
  if (isResectionSetupType(observation.sourceMeta?.setupType)) {
    return ['DN', observation.toId, formatAngleDms(observation.angleDeg)].join(' ');
  }
  return [
    'A',
    `${observation.atId}-${observation.fromId}-${observation.toId}`,
    formatAngleDms(observation.angleDeg),
  ].join(' ');
};

const serializeTsDirectionSetRecord = (observation: ImportedObservationRecord): string[] => {
  if (observation.kind === 'measurement') {
    return [serializeTsDirectionSetMeasurement(observation)];
  }
  if (observation.kind === 'angle') {
    return [serializeTsDirectionSetAngle(observation)];
  }
  if (observation.kind === 'distance') {
    return [['D', `${observation.fromId}-${observation.toId}`, formatLinear(observation.distanceM)].join(' ')];
  }
  if (observation.kind === 'bearing') {
    return [['B', `${observation.fromId}-${observation.toId}`, formatAngleDms(observation.bearingDeg)].join(' ')];
  }
  return serializeImportedObservationRecord(observation);
};

export const buildImportReviewDisplayTextMap = (
  dataset: ImportedDataset,
  model: ImportReviewModel,
  preset: ImportReviewOutputPreset,
  rowOverrides: Record<string, string> = {},
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
      output[item.id] = serializeImportedControlStationRecord(dataset.controlStations[item.index]);
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
  state: {
    currentDeltaMode: 'delta-h' | 'zenith' | null;
    currentGpsMode: 'network' | 'sideshot' | null;
  },
) => {
  if (overrideLines && overrideLines.length > 0) {
    overrideLines.forEach((line) => lines.push(line));
    return;
  }

  if (
    preset === 'ts-direction-set' &&
    (observation.kind === 'measurement' ||
      observation.kind === 'angle' ||
      observation.kind === 'distance' ||
      observation.kind === 'bearing')
  ) {
    serializeTsDirectionSetRecord(observation).forEach((line) => lines.push(line));
    return;
  }

  appendObservationLines(lines, observation, state);
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
  if (items.some((item) => item.kind === 'comment' || item.synthetic)) return items;
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
    const sourceLineCompare = (left.sourceLine ?? Number.MAX_SAFE_INTEGER) - (right.sourceLine ?? Number.MAX_SAFE_INTEGER);
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
  const state = {
    currentDeltaMode: null as 'delta-h' | 'zenith' | null,
    currentGpsMode: null as 'network' | 'sideshot' | null,
  };

  if (preset === 'ts-direction-set') {
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
      preset === 'ts-direction-set' &&
      group.kind === 'resection' &&
      group.backsightId &&
      includedItems.some((item) => item.kind === 'observation');

    if (isDirectionSetGroup) {
      lines.push(`DB ${group.setupId ?? includedItems[0]?.setupId ?? ''}`.trimEnd());
      lines.push(`DN ${group.backsightId} 000-00-00`);
    }

    const orderedItems =
      preset === 'field-grouped' && group.kind !== 'control'
        ? orderFieldGroupedItems(includedItems, group)
        : includedItems;
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
          splitOverrideLines(override).forEach((line) => lines.push(line));
        } else {
          lines.push(serializeImportedControlStationRecord(dataset.controlStations[item.index]));
        }
        return;
      }
      appendPresetObservationLines(
        lines,
        dataset.observations[item.index],
        preset,
        splitOverrideLines(options.rowOverrides?.[item.id]),
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
