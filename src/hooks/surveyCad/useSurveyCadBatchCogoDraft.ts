import { cadDraftBatchCogo } from '../../engine/cad/cadBatchCogo';
import type { CommandPoint } from './useSurveyCadCommandTypes';

export type BatchCogoDraftBuilder = (
  _inputValue: string,
  _startPoint?: CommandPoint | null,
) => ReturnType<typeof cadDraftBatchCogo>;

export const createBatchCogoDraftBuilder = (
  selectedStartPointForBatchCogo: CommandPoint | null,
): BatchCogoDraftBuilder =>
  (inputValue, startPoint = selectedStartPointForBatchCogo) =>
    cadDraftBatchCogo({
      sourceText: inputValue,
      selectedStartPoint: startPoint
        ? {
            x: startPoint.x,
            y: startPoint.y,
            label: startPoint.label,
          }
        : null,
    });
