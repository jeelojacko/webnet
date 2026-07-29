import { cadComputeTurnedAnglePoint } from '../../engine/cad/cadCogo';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import {
  parseInputPoint,
  parseLeftRightAngleDistance,
} from './useSurveyCadCommandParsing';
import type { HandleSurveyCadTypedSubmitOptions } from './useSurveyCadTypedSubmit.types';

export const handleSurveyCadTurnedPointSubmit = ({
  applyHistoryUpdate,
  consumePoint,
  publishReport,
  replaceSession,
  session,
}: HandleSurveyCadTypedSubmitOptions): boolean => {
  if (session.key !== 'TURNED_POINT') return false;
  if (session.occupyPoint == null || session.backsightPoint == null) {
    const parsedPoint = parseInputPoint(session.inputValue, session.occupyPoint);
    if (!parsedPoint) {
      replaceSession({
        ...session,
        resultText: 'TURNED_POINT point input invalid. Use `x,y` or `LABEL=x,y`.',
      });
      return true;
    }
    consumePoint(parsedPoint);
    return true;
  }
  const parsed = parseLeftRightAngleDistance(session.inputValue);
  if (!parsed) {
    replaceSession({
      ...session,
      resultText: 'TURNED_POINT input invalid. Use `Langle,distance` or `Rangle,distance`.',
    });
    return true;
  }
  const point = cadComputeTurnedAnglePoint({
    occupyPoint: session.occupyPoint,
    backsightPoint: session.backsightPoint,
    angleDeg: parsed.angleDeg,
    distance: parsed.distance,
    side: parsed.side,
  });
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, {
      key: 'POINT',
      x: point.x,
      y: point.y,
      label: parsed.label,
    }),
  );
  publishReport(
    'TURNED_POINT',
    'Turned Angle + Distance',
    `Created point from ${session.occupyPoint.label} using ${parsed.side} angle`,
    [
      { label: 'Occupy', value: session.occupyPoint.label },
      { label: 'Backsight', value: session.backsightPoint.label },
      { label: 'Turn', value: `${parsed.side} ${parsed.angleDeg.toFixed(4)} deg` },
      { label: 'Distance', value: parsed.distance.toFixed(3), unit: 'm' },
      { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
      { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
    ],
  );
  replaceSession(null);
  return true;
};
