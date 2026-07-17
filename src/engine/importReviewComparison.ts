import type {
  ImportedDataset,
  ImportedInputNotice,
  ImportedObservationRecord,
} from './importers';
import type {
  ImportReviewComparisonMode,
  ImportReviewComparisonRow,
  ImportReviewComparisonSummary,
  ImportReviewComparisonTotals,
  ImportReviewItem,
} from './importReviewTypes';

type ImportReviewComparisonSource = {
  key: string;
  sourceName: string;
  notice: ImportedInputNotice;
  dataset: ImportedDataset;
  isPrimary?: boolean;
};

const compareImportTokens = (left: string | undefined, right: string | undefined): number =>
  (left ?? '').localeCompare(right ?? '', undefined, { numeric: true, sensitivity: 'base' });

const isComparableObservation = (observation: ImportedObservationRecord): boolean =>
  observation.sourceMeta?.method !== 'MEANTURNEDANGLE';

const isObservationIncludedInComparison = (
  observation: ImportedObservationRecord,
  mode: ImportReviewComparisonMode,
): boolean => (mode === 'all-raw' ? true : isComparableObservation(observation));

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

const makeComparisonTotals = (
  dataset: ImportedDataset,
  mode: ImportReviewComparisonMode,
): ImportReviewComparisonTotals => ({
  controlStations: dataset.controlStations.length,
  observations: dataset.observations.length,
  comparedObservations: dataset.observations.filter((observation) =>
    isObservationIncludedInComparison(observation, mode),
  ).length,
  warnings: dataset.trace.filter((entry) => entry.level === 'warning').length,
  errors: dataset.trace.filter((entry) => entry.level === 'error').length,
});

const accumulateComparisonRows = (
  dataset: ImportedDataset,
  mode: ImportReviewComparisonMode,
): Map<
  string,
  Omit<
    ImportReviewComparisonRow,
    'countsBySource' | 'minCount' | 'maxCount' | 'spread' | 'sourcePresenceCount'
  >
> => {
  const buckets = new Map<
    string,
    Omit<
      ImportReviewComparisonRow,
      'countsBySource' | 'minCount' | 'maxCount' | 'spread' | 'sourcePresenceCount'
    >
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

const buildSourceComparisonCounts = (
  dataset: ImportedDataset,
  mode: ImportReviewComparisonMode,
): Map<string, number> => {
  const counts = new Map<string, number>();
  dataset.observations
    .filter((observation) => isObservationIncludedInComparison(observation, mode))
    .forEach((observation) => {
      const key = [
        deriveObservationSetupId(observation),
        deriveObservationBacksightId(observation) ?? '',
        deriveObservationTargetId(observation),
        comparisonFamilyLabel(observation),
      ].join('|');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  return counts;
};

export const buildImportReviewComparisonSummary = (
  sources: ImportReviewComparisonSource[],
  mode: ImportReviewComparisonMode = 'non-mta-only',
): ImportReviewComparisonSummary => {
  const comparisonSources = sources.map((source) => ({
    key: source.key,
    sourceName: source.sourceName,
    notice: source.notice,
    importerId: source.dataset.importerId,
    formatLabel: source.dataset.formatLabel,
    isPrimary: source.isPrimary ?? false,
    totals: makeComparisonTotals(source.dataset, mode),
  }));

  const sourceCounts = sources.map((source) => buildSourceComparisonCounts(source.dataset, mode));
  const rowMeta = new Map(
    sources.flatMap((source) => [...accumulateComparisonRows(source.dataset, mode).entries()]),
  );
  const allKeys = [...new Set(sourceCounts.flatMap((counts) => [...counts.keys()]))];

  const rows = allKeys
    .map((key) => {
      const meta = rowMeta.get(key);
      const countsBySource = sourceCounts.map((counts) => counts.get(key) ?? 0);
      const minCount = Math.min(...countsBySource);
      const maxCount = Math.max(...countsBySource);
      return {
        key,
        setupLabel: meta?.setupLabel ?? key,
        targetLabel: meta?.targetLabel ?? '',
        family: meta?.family ?? '',
        countsBySource,
        minCount,
        maxCount,
        spread: maxCount - minCount,
        sourcePresenceCount: countsBySource.filter((value) => value > 0).length,
      };
    })
    .filter((row) => row.spread !== 0)
    .sort((left, right) => {
      const magnitudeCompare = right.spread - left.spread;
      if (magnitudeCompare !== 0) return magnitudeCompare;
      const sourceCompare = right.sourcePresenceCount - left.sourcePresenceCount;
      if (sourceCompare !== 0) return sourceCompare;
      const setupCompare = compareImportTokens(left.setupLabel, right.setupLabel);
      if (setupCompare !== 0) return setupCompare;
      const targetCompare = compareImportTokens(left.targetLabel, right.targetLabel);
      if (targetCompare !== 0) return targetCompare;
      return compareImportTokens(left.family, right.family);
    });

  return {
    mode,
    sources: comparisonSources,
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
