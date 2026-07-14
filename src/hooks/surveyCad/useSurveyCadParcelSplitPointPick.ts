import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';

type ReplaceSession = (_nextSession: CommandSession | null) => void;

export const handleSurveyCadParcelSplitPointPick = ({
  current,
  point,
  replaceSession,
}: {
  current: CommandSession;
  point: CommandPoint;
  replaceSession: ReplaceSession;
}): boolean => {
  if (current.key === 'PARCEL_SPLIT_BEARING') {
    if (current.splitPoint == null) {
      replaceSession({
        ...current,
        splitPoint: point,
        inputValue: '',
        resultText: `PARCEL SPLIT bearing through point ${point.label} captured. Enter the bearing, then press Enter.`,
      });
    }
    return true;
  }

  if (current.key === 'PARCEL_SPLIT_AREA') {
    if (current.splitPoint == null) {
      replaceSession({
        ...current,
        splitPoint: point,
        inputValue: '',
        resultText: `PARCEL SPLIT area through point ${point.label} captured. Enter the target area in square meters, then press Enter.`,
      });
    }
    return true;
  }

  return false;
};
