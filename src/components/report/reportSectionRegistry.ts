import type { Observation } from '../../types';

export const REPORT_TABLE_WINDOW_SIZE = 100;
export const REPORT_DIAGNOSTIC_WINDOW_SIZE = 50;

export const OBSERVATION_FILTER_OPTIONS: Array<{
  value: 'all' | Observation['type'];
  label: string;
}> = [
  { value: 'all', label: 'All observation types' },
  { value: 'angle', label: 'Angles (TS)' },
  { value: 'direction', label: 'Directions (DB/DN)' },
  { value: 'dist', label: 'Distances (TS)' },
  { value: 'bearing', label: 'Bearings / Azimuths' },
  { value: 'dir', label: 'Directions (Azimuth)' },
  { value: 'zenith', label: 'Zenith / Vertical' },
  { value: 'gps', label: 'GPS Vectors' },
  { value: 'lev', label: 'Leveling dH' },
];

export const COLLAPSIBLE_DETAIL_SECTION_IDS = [
  'suspect-impact-analysis',
  'solve-profile-diagnostics',
  'auto-adjust-diagnostics',
  'auto-sideshot-candidates',
  'residual-diagnostics',
  'robust-diagnostics',
  'robust-vs-classical-suspects',
  'ts-correlation-diagnostics',
  'traverse-diagnostics',
  'traverse-closure-suspects',
  'gps-loop-diagnostics',
  'leveling-loop-diagnostics',
  'leveling-loop-suspects',
  'leveling-segment-suspects',
  'gps-loop-suspects',
  'direction-set-diagnostics',
  'direction-target-repeatability',
  'direction-face-treatment-diagnostics',
  'direction-reject-diagnostics',
  'direction-target-suspects-top',
  'direction-repeatability-multi-set',
  'direction-repeatability-suspects-top',
  'setup-diagnostics',
  'post-adjusted-sideshots-ts',
  'post-adjusted-gps-sideshot-vectors',
  'post-adjusted-gnss-topo-coordinates',
  'gps-rover-offsets',
  'per-type-summary',
  'relative-precision-unknowns',
  'angles-ts',
  'directions-db-dn',
  'bearings-azimuths',
  'directions-azimuth',
  'zenith-vertical-angles',
  'gps-vectors',
  'distances-ts',
  'leveling-dh',
] as const;

export type CollapsibleDetailSectionId = (typeof COLLAPSIBLE_DETAIL_SECTION_IDS)[number];

export const createCollapsedDetailSectionsState = (): Record<
  CollapsibleDetailSectionId,
  boolean
> => {
  const next = {} as Record<CollapsibleDetailSectionId, boolean>;
  COLLAPSIBLE_DETAIL_SECTION_IDS.forEach((id) => {
    next[id] = false;
  });
  return next;
};
