import type {
  CadParcelLayoutAutomaticMode,
  CadParcelLayoutRemainderDistribution,
  CadParcelLayoutSolutionPreference,
} from '../../engine/cad/cadTypes';

export const sectionLabelClassName =
  'text-[8px] font-semibold uppercase tracking-[0.1em] text-cyan-200';
export const rowClassName = 'grid grid-cols-[minmax(0,1fr),auto] items-start gap-1.5';
export const inputClassName =
  'w-20 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] leading-3 text-slate-100 outline-none focus:border-cyan-500';
export const selectClassName =
  'w-28 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] leading-3 text-slate-100 outline-none focus:border-cyan-500';
export const buttonClassName =
  'rounded border border-slate-700 bg-slate-950/85 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.04em] leading-3 text-slate-100 transition-colors hover:border-cyan-500/70 hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500';

export const solutionPreferenceOptions: Array<{
  value: CadParcelLayoutSolutionPreference;
  label: string;
}> = [
  { value: 'shortest_frontage', label: 'Shortest frontage' },
  { value: 'smallest_area', label: 'Smallest area' },
  { value: 'largest_area', label: 'Largest area' },
  { value: 'most_rectangular', label: 'Most rectangular' },
  { value: 'closest_to_target_area', label: 'Closest to target area' },
];

export const automaticModeOptions: Array<{ value: CadParcelLayoutAutomaticMode; label: string }> =
  [
    { value: 'off', label: 'Off' },
    { value: 'single_preview', label: 'Single preview' },
    { value: 'fill_parent', label: 'Fill parent' },
  ];

export const remainderOptions: Array<{
  value: CadParcelLayoutRemainderDistribution;
  label: string;
}> = [
  { value: 'place_remainder_in_last_parcel', label: 'Place remainder in last parcel' },
  { value: 'create_parcel_from_remainder', label: 'Create parcel from remainder' },
  { value: 'redistribute_remainder', label: 'Redistribute remainder' },
];

export const parseNumericInput = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
