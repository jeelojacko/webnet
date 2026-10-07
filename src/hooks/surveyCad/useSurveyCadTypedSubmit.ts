import { handleSurveyCadAlignmentSubmit } from './useSurveyCadTypedSubmitAlignment';
import { handleSurveyCadLineConstructionSubmit } from './useSurveyCadTypedSubmitLineConstruction';
import { handleSurveyCadLineL1Submit } from './useSurveyCadLineL1Submit';
import { handleSurveyCadParcelSplitSubmit } from './useSurveyCadTypedSubmitParcelSplit';
import { handleSurveyCadShapeSubmit } from './useSurveyCadShapeSubmit';
import { handleSurveyCadSequenceReportSubmit } from './useSurveyCadTypedSubmitSequence';
import { handleSurveyCadTurnedPointSubmit } from './useSurveyCadTypedSubmitTurnedPoint';
import { isCadLineL1Key } from './useSurveyCadLineL1Keys';
import type { CadLineL1SessionState } from './useSurveyCadCommandTypes';
import type { HandleSurveyCadTypedSubmitOptions } from './useSurveyCadTypedSubmit.types';

export const handleSurveyCadTypedSubmit = (
  options: HandleSurveyCadTypedSubmitOptions,
): boolean => {
  if (isCadLineL1Key(options.session.key)) {
    return handleSurveyCadLineL1Submit({
      applyHistoryUpdate: options.applyHistoryUpdate,
      project: options.project,
      replaceSession: options.replaceSession,
      session: options.session as CadLineL1SessionState,
    });
  }
  return (
    handleSurveyCadShapeSubmit(options) ||
    handleSurveyCadSequenceReportSubmit(options) ||
    handleSurveyCadParcelSplitSubmit(options) ||
    handleSurveyCadTurnedPointSubmit(options) ||
    handleSurveyCadLineConstructionSubmit(options) ||
    handleSurveyCadAlignmentSubmit(options)
  );
};
