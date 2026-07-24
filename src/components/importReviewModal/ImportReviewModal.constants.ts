import type { ImportReviewOutputPreset } from '../../engine/importReview';

export const PRESET_OPTIONS: {
  value: ImportReviewOutputPreset;
  label: string;
  description: string;
}[] = [
  {
    value: 'clean-webnet',
    label: 'Clean WebNet',
    description: 'Preserve direct WebNet-style imported rows with clean grouping comments.',
  },
  {
    value: 'field-grouped',
    label: 'Field Grouped',
    description: 'Keep grouped setup comments while leaving row formats close to the raw import.',
  },
  {
    value: 'ts-direction-set',
    label: 'TS Direction Set',
    description:
      'Shape angle/measurement groups into DB/DN/DM/DE-style setup blocks where possible.',
  },
  {
    value: 'industry-style',
    label: 'Industry Style',
    description:
      'For JobXML direct readings, preserve raw HZ/zenith/distance ingredients into round-grouped DB/DM/DE blocks.',
  },
];
