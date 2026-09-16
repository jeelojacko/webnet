import type { SuspectImpactRow } from '../../typesAdjustmentResult';

/** Human-readable failure reasons; failed rows show this text and never mm. */
export const describeSuspectImpactFailure = (row: SuspectImpactRow): string => {
  switch (row.failureReason) {
    case 'singular':
      return 're-solve singular';
    case 'insufficient-observations':
      return 'too few observations left';
    case 'invalid-after-removal':
      return 'invalid after removal';
    case 'solver-failed':
      return 're-solve failed';
    case 'cancelled':
      return 're-solve cancelled';
    case 'unsupported':
      return 'exclusion unsupported';
    case 'none':
      return 'ok';
    default:
      return 're-solve failed';
  }
};

/** Small shifts render in mm; larger shifts use the selected linear unit. */
export const formatLooShift = (
  shiftM: number,
  unitScale: number,
  units: 'm' | 'ft',
): string => {
  if (!Number.isFinite(shiftM)) return '-';
  if (units === 'm' && shiftM < 0.1) return `${(shiftM * 1000).toFixed(2)} mm`;
  return `${(shiftM * unitScale).toFixed(4)} ${units}`;
};
