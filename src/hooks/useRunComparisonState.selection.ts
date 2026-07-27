import type { ComparisonSelection } from '../engine/qaWorkflow';

export const DEFAULT_COMPARISON_SELECTION: ComparisonSelection = {
  baselineRunId: null,
  pinnedBaselineRunId: null,
  stationMovementThreshold: 0.001,
  residualDeltaThreshold: 0.25,
};

export const sanitizeComparisonSelection = (
  selection: ComparisonSelection,
  availableIds: Set<string>,
): ComparisonSelection => ({
  ...selection,
  baselineRunId:
    selection.baselineRunId && availableIds.has(selection.baselineRunId)
      ? selection.baselineRunId
      : null,
  pinnedBaselineRunId:
    selection.pinnedBaselineRunId && availableIds.has(selection.pinnedBaselineRunId)
      ? selection.pinnedBaselineRunId
      : null,
});
