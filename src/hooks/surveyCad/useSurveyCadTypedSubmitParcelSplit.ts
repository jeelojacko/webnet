import { cadParseBearingDegrees } from '../../engine/cad/cadGeometry';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import { parseInputPoint } from './useSurveyCadCommandParsing';
import type { HandleSurveyCadTypedSubmitOptions } from './useSurveyCadTypedSubmit.types';

export const handleSurveyCadParcelSplitSubmit = ({
  applyHistoryUpdate,
  consumePoint,
  replaceSession,
  session,
}: Omit<HandleSurveyCadTypedSubmitOptions, 'publishReport'>): boolean => {
  if (session.key === 'PARCEL_SPLIT_BEARING') {
    if (session.splitPoint == null) {
      const parsedPoint = parseInputPoint(session.inputValue, null);
      if (!parsedPoint) {
        replaceSession({
          ...session,
          resultText: 'PARCEL SPLIT bearing through point invalid. Use `x,y` or `LABEL=x,y`.',
        });
        return true;
      }
      consumePoint(parsedPoint);
      return true;
    }
    const bearing = session.inputValue.trim();
    if (cadParseBearingDegrees(bearing) == null) {
      replaceSession({
        ...session,
        resultText:
          'PARCEL SPLIT bearing invalid. Enter an azimuth or survey bearing like `N45-00-00E`.',
      });
      return true;
    }
    let committed = false;
    applyHistoryUpdate((existing) => {
      const next = runCadCommand(existing, {
        key: 'PARCEL_SPLIT_BEARING',
        parcelEntityId: session.parcel.id,
        throughPointX: session.splitPoint!.x,
        throughPointY: session.splitPoint!.y,
        throughPointLabel: session.splitPoint!.label,
        bearing,
      });
      committed = next !== existing;
      return next;
    });
    replaceSession(
      committed
        ? null
        : {
            ...session,
            resultText: `PARCEL SPLIT bearing failed on ${session.parcel.parcelName}. Check that the through point and bearing cross the parcel boundary exactly twice.`,
          },
    );
    return true;
  }

  if (session.key === 'PARCEL_SPLIT_AREA') {
    if (session.splitPoint == null) {
      const parsedPoint = parseInputPoint(session.inputValue, null);
      if (!parsedPoint) {
        replaceSession({
          ...session,
          resultText: 'PARCEL SPLIT area through point invalid. Use `x,y` or `LABEL=x,y`.',
        });
        return true;
      }
      consumePoint(parsedPoint);
      return true;
    }
    const targetAreaSquareMeters = Number(session.inputValue.trim());
    if (!Number.isFinite(targetAreaSquareMeters) || targetAreaSquareMeters <= 0) {
      replaceSession({
        ...session,
        resultText: 'PARCEL SPLIT area invalid. Enter a positive target area in square meters.',
      });
      return true;
    }
    let committed = false;
    applyHistoryUpdate((existing) => {
      const next = runCadCommand(existing, {
        key: 'PARCEL_SPLIT_AREA',
        parcelEntityId: session.parcel.id,
        throughPointX: session.splitPoint!.x,
        throughPointY: session.splitPoint!.y,
        throughPointLabel: session.splitPoint!.label,
        targetAreaSquareMeters,
      });
      committed = next !== existing;
      return next;
    });
    replaceSession(
      committed
        ? null
        : {
            ...session,
            resultText: `PARCEL SPLIT area failed on ${session.parcel.parcelName}. Check that the through point is inside the parcel and the target area is achievable from that point.`,
          },
    );
    return true;
  }

  return false;
};
