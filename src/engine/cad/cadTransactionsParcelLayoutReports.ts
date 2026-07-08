import type { CadParcelLayoutConstraintEvaluation } from './cadCogo';
import type { CadCogoReportRow } from './cadCogoTypes';
import type { CadParcelLayoutSettings } from './cadTypes';

export const formatParcelLayoutAutomaticMode = (
  automaticMode: CadParcelLayoutSettings['automaticMode'],
): string => {
  switch (automaticMode) {
    case 'single_preview':
      return 'Single preview';
    case 'fill_parent':
      return 'Fill parent';
    case 'off':
    default:
      return 'Off';
  }
};

export const formatParcelLayoutRemainderDistribution = (
  remainderDistribution: CadParcelLayoutSettings['remainderDistribution'],
): string => {
  switch (remainderDistribution) {
    case 'place_remainder_in_last_parcel':
      return 'Place remainder in last parcel';
    case 'create_parcel_from_remainder':
      return 'Create parcel from remainder';
    case 'redistribute_remainder':
      return 'Redistribute remainder';
    default:
      return remainderDistribution;
  }
};

const formatParcelLayoutSolutionPreference = (
  preference: CadParcelLayoutSettings['solutionPreference'],
): string => {
  switch (preference) {
    case 'closest_to_target_area':
      return 'Closest to target area';
    case 'smallest_area':
      return 'Smallest area';
    case 'largest_area':
      return 'Largest area';
    case 'most_rectangular':
      return 'Most rectangular';
    case 'shortest_frontage':
    default:
      return 'Shortest frontage';
  }
};

const formatParcelLayoutMeters = (value: number): string => `${value.toFixed(3)} m`;

export const buildParcelLayoutConstraintReportRows = (
  settings: CadParcelLayoutSettings,
): CadCogoReportRow[] => [
  { label: 'Minimum frontage', value: formatParcelLayoutMeters(settings.minFrontageMeters) },
  {
    label: 'Frontage at offset',
    value: settings.useFrontageAtOffset
      ? formatParcelLayoutMeters(settings.frontageOffsetMeters)
      : 'Off',
  },
  { label: 'Minimum width', value: formatParcelLayoutMeters(settings.minWidthMeters) },
  { label: 'Minimum depth', value: formatParcelLayoutMeters(settings.minDepthMeters) },
  {
    label: 'Maximum depth',
    value: settings.useMaxDepth
      ? formatParcelLayoutMeters(settings.maxDepthMeters)
      : 'Off',
  },
  {
    label: 'Solution preference',
    value: formatParcelLayoutSolutionPreference(settings.solutionPreference),
  },
];

export const buildParcelLayoutEvaluationReportRows = (
  evaluation: CadParcelLayoutConstraintEvaluation,
): CadCogoReportRow[] => {
  const rows: CadCogoReportRow[] = [];
  if (evaluation.frontageAtOffsetWidthMeters != null) {
    rows.push({
      label: 'Offset width achieved',
      value: formatParcelLayoutMeters(evaluation.frontageAtOffsetWidthMeters),
    });
  }
  if (evaluation.minimumSampledWidthMeters != null) {
    rows.push({
      label: 'Sampled minimum width',
      value: formatParcelLayoutMeters(evaluation.minimumSampledWidthMeters),
    });
  }
  if (evaluation.depthMeters != null) {
    rows.push({
      label: 'Child depth',
      value: formatParcelLayoutMeters(evaluation.depthMeters),
    });
  }
  return rows;
};

export const formatParcelLayoutRange = (values: number[]): string => {
  if (values.length === 0) return 'n/a';
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (Math.abs(min - max) <= 1e-9) return formatParcelLayoutMeters(min);
  return `${min.toFixed(3)}-${max.toFixed(3)} m`;
};
