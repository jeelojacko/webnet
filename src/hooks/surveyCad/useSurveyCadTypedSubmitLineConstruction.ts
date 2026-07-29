import {
  buildCadDistanceSummary,
  cadComputeDeflectionAnglePoint,
  cadExtendLineByDistance,
  cadOffsetPointFromLine,
  cadPointAtDistanceAlongLine,
  cadPointAtFractionAlongLine,
} from '../../engine/cad/cadCogo';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import {
  parseDistanceOrPercent,
  parseLeftRightAngleDistance,
  parseOffsetPointInput,
} from './useSurveyCadCommandParsing';
import type { HandleSurveyCadTypedSubmitOptions } from './useSurveyCadTypedSubmit.types';

export const handleSurveyCadLineConstructionSubmit = ({
  applyHistoryUpdate,
  publishReport,
  replaceSession,
  session,
}: Omit<HandleSurveyCadTypedSubmitOptions, 'consumePoint'>): boolean => {
  if (session.key === 'DEFLECT_POINT') {
    const parsed = parseLeftRightAngleDistance(session.inputValue);
    if (!parsed) {
      replaceSession({
        ...session,
        resultText: 'DEFLECT_POINT input invalid. Use `Langle,distance` or `Rangle,distance`.',
      });
      return true;
    }
    const point = cadComputeDeflectionAnglePoint({
      lineStart: session.lineStart,
      lineEnd: session.lineEnd,
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
      'DEFLECT_POINT',
      'Deflection Angle + Distance',
      `Created deflection point from ${session.lineStart.label}-${session.lineEnd.label}`,
      [
        { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
        { label: 'Deflection', value: `${parsed.side} ${parsed.angleDeg.toFixed(4)} deg` },
        { label: 'Distance', value: parsed.distance.toFixed(3), unit: 'm' },
        { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
        { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
      ],
    );
    replaceSession(null);
    return true;
  }

  if (session.key === 'POINT_ALONG_LINE') {
    const parsed = parseDistanceOrPercent(session.inputValue);
    const point =
      parsed?.fraction != null
        ? cadPointAtFractionAlongLine(session.lineStart, session.lineEnd, parsed.fraction)
        : parsed?.distance != null
          ? cadPointAtDistanceAlongLine(session.lineStart, session.lineEnd, parsed.distance)
          : null;
    if (!parsed || !point) {
      replaceSession({
        ...session,
        resultText: 'POINT_ALONG_LINE input invalid. Use distance or percent like `25` or `50%`.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'POINT',
        x: point.x,
        y: point.y,
        label: parsed.label,
      }),
    );
    publishReport(
      'POINT_ALONG_LINE',
      'Point Along Line',
      `Created point along ${session.lineStart.label}-${session.lineEnd.label}`,
      [
        { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
        parsed.fraction != null
          ? { label: 'Fraction', value: (parsed.fraction * 100).toFixed(3), unit: '%' }
          : { label: 'Distance', value: (parsed.distance ?? 0).toFixed(3), unit: 'm' },
        { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
        { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
      ],
    );
    replaceSession(null);
    return true;
  }

  if (session.key === 'EXTEND_LINE') {
    const distance = Number(session.inputValue.trim());
    const point = Number.isFinite(distance)
      ? cadExtendLineByDistance(session.lineStart, session.lineEnd, distance)
      : null;
    if (!point) {
      replaceSession({
        ...session,
        resultText: 'EXTEND_LINE input invalid. Enter a positive extension distance.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'LINE',
        start: session.lineEnd,
        end: {
          ...point,
          label: `${session.lineEnd.label}+${distance.toFixed(3)}`,
        },
      }),
    );
    publishReport(
      'EXTEND_LINE',
      'Extend Line by Distance',
      `Extended ${session.lineStart.label}-${session.lineEnd.label} by ${distance.toFixed(3)} m`,
      [
        { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
        { label: 'Extension', value: distance.toFixed(3), unit: 'm' },
        { label: 'End Northing', value: point.y.toFixed(3), unit: 'm' },
        { label: 'End Easting', value: point.x.toFixed(3), unit: 'm' },
      ],
    );
    replaceSession(null);
    return true;
  }

  if (session.key !== 'OFFSET_POINT') return false;
  const parsed = parseOffsetPointInput(session.inputValue);
  const lineLength = buildCadDistanceSummary(session.lineStart, session.lineEnd).distance2d;
  const alongDistance =
    parsed?.alongFraction != null ? parsed.alongFraction * lineLength : parsed?.alongDistance;
  const point =
    parsed && alongDistance != null
      ? cadOffsetPointFromLine({
          lineStart: session.lineStart,
          lineEnd: session.lineEnd,
          alongDistance,
          offsetDistance: parsed.offsetDistance,
          side: parsed.side,
        })
      : null;
  if (!parsed || alongDistance == null || !point) {
    replaceSession({
      ...session,
      resultText: 'OFFSET_POINT input invalid. Use `Loffset,along` or `Roffset,along`.',
    });
    return true;
  }
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, {
      key: 'POINT',
      x: point.x,
      y: point.y,
      label: parsed.label,
    }),
  );
  publishReport(
    'OFFSET_POINT',
    'Offset Point',
    `Created offset point from ${session.lineStart.label}-${session.lineEnd.label}`,
    [
      { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
      { label: 'Offset', value: `${parsed.side} ${parsed.offsetDistance.toFixed(3)} m` },
      { label: 'Along', value: alongDistance.toFixed(3), unit: 'm' },
      { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
      { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
    ],
  );
  replaceSession(null);
  return true;
};
