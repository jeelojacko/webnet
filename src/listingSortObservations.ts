export type ListingSortObservationsBy =
  | 'input'
  | 'name'
  | 'residual'
  | 'stdError'
  | 'stdResidual';

export const DEFAULT_LISTING_SORT_OBSERVATIONS_BY: ListingSortObservationsBy = 'stdResidual';

export const normalizeListingSortObservationsBy = (
  value: unknown,
  options?: {
    fallback?: ListingSortObservationsBy;
    legacyResidualMeansStdResidual?: boolean;
  },
): ListingSortObservationsBy => {
  const fallback = options?.fallback ?? DEFAULT_LISTING_SORT_OBSERVATIONS_BY;
  const legacyResidualMeansStdResidual = options?.legacyResidualMeansStdResidual === true;
  if (value === 'input' || value === 'name' || value === 'stdError' || value === 'stdResidual') {
    return value;
  }
  if (value === 'residual') {
    return legacyResidualMeansStdResidual ? 'stdResidual' : 'residual';
  }
  return fallback;
};

