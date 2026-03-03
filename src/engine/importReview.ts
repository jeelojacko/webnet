import { DEG_TO_RAD, radToDmsStr } from './angles';
import type {
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedObservationRecord,
  ImportedTraceEntry,
} from './importers';
import {
  serializeImportedControlStationRecord,
  serializeImportedObservationRecord,
} from './importers';

export type ImportReviewItemKind = 'control' | 'observation';
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
  setupId?: string;
  backsightId?: string;
  targetId?: string;
  stationId?: string;
}

export interface ImportReviewGroup {
  key: string;
  kind: ImportReviewGroupKind;
  label: string;
  defaultComment: string;
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

const deriveSourceType = (
  kind: ImportReviewItemKind,
  record: ImportedControlStationRecord | ImportedObservationRecord,
): string => {
  if (kind === 'control') return 'Control Point';
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

const getPresetRowLines = (
  observation: ImportedObservationRecord,
  preset: ImportReviewOutputPreset,
): string[] => {
  if (preset !== 'ts-direction-set') {
    return serializeImportedObservationRecord(observation);
  }

  if (observation.kind === 'measurement') {
    const line = serializeObservationPreview(observation, preset);
    return [line];
  }

  if (observation.kind === 'angle') {
    return [serializeObservationPreview(observation, preset)];
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
    if (item.kind === 'control') {
      output[item.id] = serializeImportedControlStationRecord(dataset.controlStations[item.index]);
      return;
    }
    output[item.id] = serializeObservationPreview(dataset.observations[item.index], preset);
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
    (observation.kind === 'measurement' || observation.kind === 'angle') &&
    isResectionSetupType(observation.sourceMeta?.setupType)
  ) {
    getPresetRowLines(observation, preset).forEach((line) => lines.push(line));
    return;
  }

  appendObservationLines(lines, observation, state);
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

    if (
      preset === 'ts-direction-set' &&
      group.kind === 'resection' &&
      group.backsightId &&
      includedItems.some((item) => {
        const observation = dataset.observations[item.index];
        return observation.kind === 'measurement' || observation.kind === 'angle';
      })
    ) {
      const directionItems = includedItems.filter((item) => {
        const observation = dataset.observations[item.index];
        return observation.kind === 'measurement' || observation.kind === 'angle';
      });
      const otherItems = includedItems.filter((item) => {
        const observation = dataset.observations[item.index];
        return observation.kind !== 'measurement' && observation.kind !== 'angle';
      });

      otherItems.forEach((item) => {
        if (item.kind === 'control') {
          lines.push(options.rowOverrides?.[item.id] ?? serializeImportedControlStationRecord(dataset.controlStations[item.index]));
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

      lines.push(`DB ${group.setupId ?? includedItems[0]?.setupId ?? ''}`.trimEnd());
      lines.push(`DN ${group.backsightId} 000-00-00`);
      directionItems.forEach((item) => {
        appendPresetObservationLines(
          lines,
          dataset.observations[item.index],
          preset,
          splitOverrideLines(options.rowOverrides?.[item.id]),
          state,
        );
      });
      lines.push('DE');
      return;
    }

    includedItems.forEach((item) => {
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
  });

  lines.push('');
  return lines.join('\n');
};
