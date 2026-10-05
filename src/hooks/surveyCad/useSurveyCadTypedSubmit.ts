import { handleSurveyCadAlignmentSubmit } from './useSurveyCadTypedSubmitAlignment';
import { handleSurveyCadLineConstructionSubmit } from './useSurveyCadTypedSubmitLineConstruction';
import { handleSurveyCadParcelSplitSubmit } from './useSurveyCadTypedSubmitParcelSplit';
import { handleSurveyCadShapeSubmit } from './useSurveyCadShapeSubmit';
import { handleSurveyCadSequenceReportSubmit } from './useSurveyCadTypedSubmitSequence';
import { handleSurveyCadTurnedPointSubmit } from './useSurveyCadTypedSubmitTurnedPoint';
import type { HandleSurveyCadTypedSubmitOptions } from './useSurveyCadTypedSubmit.types';

export const handleSurveyCadTypedSubmit = (
  options: HandleSurveyCadTypedSubmitOptions,
): boolean =>
  handleSurveyCadShapeSubmit(options) ||
  handleSurveyCadSequenceReportSubmit(options) ||
  handleSurveyCadParcelSplitSubmit(options) ||
  handleSurveyCadTurnedPointSubmit(options) ||
  handleSurveyCadLineConstructionSubmit(options) ||
  handleSurveyCadAlignmentSubmit(options);
