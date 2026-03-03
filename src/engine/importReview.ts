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

export interface ImportReviewItem {
  id: string;
  kind: ImportReviewItemKind;
  index: number;
  groupKey: string;
  importedData: string;
  sourceType: string;
  sourceLine?: number;
  sourceCode?: string;
}

export interface ImportReviewGroup {
  key: string;
  label: string;
  defaultComment: string;
  itemIds: string[];
}

export interface ImportReviewModel {
  groups: ImportReviewGroup[];
  items: ImportReviewItem[];
  warnings: ImportedTraceEntry[];
  errors: ImportedTraceEntry[];
}

const prettifyToken = (value: string): string =>
  value
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const deriveObservationSetupId = (observation: ImportedObservationRecord): string => {
  if (observation.kind === 'measurement' || observation.kind === 'angle') return observation.atId;
  return observation.fromId;
};

const deriveObservationGroup = (
  observation: ImportedObservationRecord,
): { key: string; label: string; defaultComment: string } => {
  if (observation.kind === 'gnss-vector') {
    const mode = observation.gpsMode === 'sideshot' ? 'GPS Sideshot' : 'GPS Network';
    const key = `gps:${observation.gpsMode ?? 'network'}:${observation.fromId}`;
    return {
      key,
      label: `${mode} ${observation.fromId}`,
      defaultComment: `${mode.toUpperCase()} ${observation.fromId}`,
    };
  }

  const setupId = deriveObservationSetupId(observation);
  return {
    key: `setup:${setupId}`,
    label: `Setup ${setupId}`,
    defaultComment: `SETUP ${setupId}`,
  };
};

const deriveSourceType = (
  kind: ImportReviewItemKind,
  record: ImportedControlStationRecord | ImportedObservationRecord,
): string => {
  if (kind === 'control') return 'Control Point';
  if (record.kind === 'gnss-vector') return 'GNSS Vector';
  if (record.kind === 'distance') return 'Distance';
  if (record.kind === 'distance-vertical') return 'Distance + Vertical';
  if (record.kind === 'vertical') return 'Vertical';
  if (record.kind === 'bearing') return 'Bearing';
  if (record.kind === 'angle') return 'Angle';
  if (record.kind === 'measurement') return 'Measurement';
  return prettifyToken(record.kind);
};

const previewLineForObservation = (observation: ImportedObservationRecord): string => {
  const lines = serializeImportedObservationRecord(observation).filter((line) => !line.startsWith('.'));
  return lines.join(' | ');
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
      importedData: serializeImportedControlStationRecord(station),
      sourceType: deriveSourceType('control', station),
      sourceLine: station.sourceLine,
      sourceCode: station.sourceCode,
    };
    items.push(item);
    controlGroup.itemIds.push(id);
  });

  dataset.observations.forEach((observation, index) => {
    const groupMeta = deriveObservationGroup(observation);
    const group = ensureGroup(groupMeta);
    const id = `observation:${index}`;
    const item: ImportReviewItem = {
      id,
      kind: 'observation',
      index,
      groupKey: group.key,
      importedData: previewLineForObservation(observation),
      sourceType: deriveSourceType('observation', observation),
      sourceLine: observation.sourceLine,
      sourceCode: observation.sourceCode,
    };
    items.push(item);
    group.itemIds.push(id);
  });

  return {
    groups: groups.filter((group) => group.itemIds.length > 0),
    items,
    warnings: dataset.trace.filter((entry) => entry.level === 'warning'),
    errors: dataset.trace.filter((entry) => entry.level === 'error'),
  };
};

export interface BuildImportReviewTextOptions {
  includedItemIds: Set<string>;
  groupComments?: Record<string, string>;
}

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

export const buildImportReviewText = (
  dataset: ImportedDataset,
  model: ImportReviewModel,
  options: BuildImportReviewTextOptions,
): string => {
  const lines: string[] = [];
  const itemLookup = new Map(model.items.map((item) => [item.id, item]));
  const state = {
    currentDeltaMode: null as 'delta-h' | 'zenith' | null,
    currentGpsMode: null as 'network' | 'sideshot' | null,
  };

  lines.push('.UNITS M');
  if (dataset.controlStations.some((station) => station.coordinateMode === 'local')) {
    lines.push('.ORDER EN');
  }

  model.groups.forEach((group) => {
    const includedItems = group.itemIds
      .map((itemId) => itemLookup.get(itemId))
      .filter((item): item is ImportReviewItem => Boolean(item))
      .filter((item) => options.includedItemIds.has(item.id));

    if (includedItems.length === 0) return;

    const comment = options.groupComments?.[group.key]?.trim() ?? group.defaultComment;
    if (lines.length > 0) lines.push('');
    if (comment) lines.push(`# ${comment}`);

    includedItems.forEach((item) => {
      if (item.kind === 'control') {
        lines.push(serializeImportedControlStationRecord(dataset.controlStations[item.index]));
        return;
      }
      appendObservationLines(lines, dataset.observations[item.index], state);
    });
  });

  lines.push('');
  return lines.join('\n');
};
