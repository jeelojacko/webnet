import {
  cadIntersectBearingDistance,
  cadIntersectBearings,
  cadIntersectDistanceDistance,
  cadIntersectLineCircle,
  cadIntersectOffsetLines,
  cadIntersectSkew,
} from '../../engine/cad/cadCogo';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import {
  parseBearingDistanceIntersectionInput,
  parseDistancePairInput,
  parseDualBearingInput,
  parseDualOffsetInput,
  parseInputPoint,
  parseSideDistanceInput,
} from './useSurveyCadCommandParsing';
import type { SurveyCadReportPublisher } from './useSurveyCadCommandReports';

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
type ConsumePoint = (_point: CommandPoint) => void;

interface HandleSurveyCadIntersectionSubmitOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  consumePoint: ConsumePoint;
  publishReport: SurveyCadReportPublisher;
  replaceSession: ReplaceSession;
  session: CommandSession;
}

const addPoint = (
  applyHistoryUpdate: ApplyHistoryUpdate,
  point: { x: number; y: number },
) => {
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, {
      key: 'POINT',
      x: point.x,
      y: point.y,
    }),
  );
};

const handleTwoPointIntersectionSubmit = ({
  applyHistoryUpdate,
  consumePoint,
  publishReport,
  replaceSession,
  session,
}: HandleSurveyCadIntersectionSubmitOptions): boolean => {
  if (
    session.key !== 'BEARING_BEARING_INTX' &&
    session.key !== 'BEARING_DISTANCE_INTX' &&
    session.key !== 'DISTANCE_DISTANCE_INTX'
  ) {
    return false;
  }

  if (session.firstPoint == null || session.secondPoint == null) {
    const parsedPoint = parseInputPoint(session.inputValue, session.firstPoint);
    if (!parsedPoint) {
      replaceSession({
        ...session,
        resultText: `${session.key} point input invalid. Use \`x,y\` or \`LABEL=x,y\`.`,
      });
      return true;
    }
    consumePoint(parsedPoint);
    return true;
  }

  if (session.key === 'BEARING_BEARING_INTX') {
    const parsed = parseDualBearingInput(session.inputValue);
    const solution =
      parsed &&
      cadIntersectBearings({
        firstPoint: session.firstPoint,
        firstBearing: parsed.firstBearing,
        secondPoint: session.secondPoint,
        secondBearing: parsed.secondBearing,
        firstLabel: session.firstPoint.label,
        secondLabel: session.secondPoint.label,
      });
    if (!parsed || !solution) {
      replaceSession({
        ...session,
        resultText: 'BEARING_BEARING_INTX input invalid. Use `bearing1;bearing2` with non-parallel bearings.',
      });
      return true;
    }
    addPoint(applyHistoryUpdate, solution.point);
    publishReport(
      'BEARING_BEARING_INTX',
      'Bearing-Bearing Intersection',
      `Computed bearing intersection from ${session.firstPoint.label} and ${session.secondPoint.label}`,
      [
        { label: 'Origin 1', value: session.firstPoint.label },
        { label: 'Bearing 1', value: parsed.firstBearing },
        { label: 'Origin 2', value: session.secondPoint.label },
        { label: 'Bearing 2', value: parsed.secondBearing },
        { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
        { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
      ],
    );
    replaceSession(null);
    return true;
  }

  if (session.key === 'BEARING_DISTANCE_INTX') {
    const parsed = parseBearingDistanceIntersectionInput(session.inputValue);
    const solutions =
      parsed
        ? cadIntersectBearingDistance({
            bearingPoint: session.firstPoint,
            bearing: parsed.bearing,
            distancePoint: session.secondPoint,
            distance: parsed.distance,
            bearingLabel: session.firstPoint.label,
            distanceLabel: session.secondPoint.label,
          })
        : [];
    const primary = solutions[0];
    if (!parsed || !primary) {
      replaceSession({
        ...session,
        resultText: 'BEARING_DISTANCE_INTX input invalid. Use `bearing;distance` and a solvable radius.',
      });
      return true;
    }
    addPoint(applyHistoryUpdate, primary.point);
    publishReport(
      'BEARING_DISTANCE_INTX',
      'Bearing-Distance Intersection',
      `Computed bearing-distance intersection from ${session.firstPoint.label} and ${session.secondPoint.label}`,
      [
        { label: 'Bearing origin', value: session.firstPoint.label },
        { label: 'Bearing', value: parsed.bearing },
        { label: 'Distance center', value: session.secondPoint.label },
        { label: 'Radius', value: parsed.distance.toFixed(3), unit: 'm' },
        { label: 'Chosen Northing', value: primary.point.y.toFixed(3), unit: 'm' },
        { label: 'Chosen Easting', value: primary.point.x.toFixed(3), unit: 'm' },
      ],
      solutions.slice(1).map((solution, index) => ({
        id: `bd-alt-${index + 2}`,
        label: `${solution.label}: N ${solution.point.y.toFixed(3)} E ${solution.point.x.toFixed(3)}`,
        point: solution.point,
      })),
    );
    replaceSession(null);
    return true;
  }

  const parsed = parseDistancePairInput(session.inputValue);
  const solutions =
    parsed
      ? cadIntersectDistanceDistance({
          firstPoint: session.firstPoint,
          firstDistance: parsed.firstDistance,
          secondPoint: session.secondPoint,
          secondDistance: parsed.secondDistance,
          firstLabel: session.firstPoint.label,
          secondLabel: session.secondPoint.label,
        })
      : [];
  const primary = solutions[0];
  if (!parsed || !primary) {
    replaceSession({
      ...session,
      resultText: 'DISTANCE_DISTANCE_INTX input invalid. Use `distance1,distance2` with intersecting circles.',
    });
    return true;
  }
  addPoint(applyHistoryUpdate, primary.point);
  publishReport(
    'DISTANCE_DISTANCE_INTX',
    'Distance-Distance Intersection',
    `Computed distance-distance intersection from ${session.firstPoint.label} and ${session.secondPoint.label}`,
    [
      { label: 'Center 1', value: session.firstPoint.label },
      { label: 'Radius 1', value: parsed.firstDistance.toFixed(3), unit: 'm' },
      { label: 'Center 2', value: session.secondPoint.label },
      { label: 'Radius 2', value: parsed.secondDistance.toFixed(3), unit: 'm' },
      { label: 'Chosen Northing', value: primary.point.y.toFixed(3), unit: 'm' },
      { label: 'Chosen Easting', value: primary.point.x.toFixed(3), unit: 'm' },
    ],
    solutions.slice(1).map((solution, index) => ({
      id: `dd-alt-${index + 2}`,
      label: `${solution.label}: N ${solution.point.y.toFixed(3)} E ${solution.point.x.toFixed(3)}`,
      point: solution.point,
    })),
  );
  replaceSession(null);
  return true;
};

const handleLineIntersectionSubmit = ({
  applyHistoryUpdate,
  consumePoint,
  publishReport,
  replaceSession,
  session,
}: HandleSurveyCadIntersectionSubmitOptions): boolean => {
  if (
    session.key !== 'LINE_CIRCLE_INTX' &&
    session.key !== 'OFFSET_INTX' &&
    session.key !== 'SKEW_INTX'
  ) {
    return false;
  }

  if (session.key === 'LINE_CIRCLE_INTX') {
    if (session.targetPoint == null) {
      const parsedPoint = parseInputPoint(session.inputValue, session.lineEnd);
      if (!parsedPoint) {
        replaceSession({
          ...session,
          resultText: 'LINE_CIRCLE_INTX center input invalid. Use `x,y` or `LABEL=x,y`.',
        });
        return true;
      }
      consumePoint(parsedPoint);
      return true;
    }
    const radius = Number(session.inputValue.trim());
    const solutions = Number.isFinite(radius)
      ? cadIntersectLineCircle({
          lineStart: session.lineStart,
          lineEnd: session.lineEnd,
          center: session.targetPoint,
          radius,
          lineLabel: `${session.lineStart.label}-${session.lineEnd.label}`,
          centerLabel: session.targetPoint.label,
        })
      : [];
    const primary = solutions[0];
    if (!primary) {
      replaceSession({
        ...session,
        resultText: 'LINE_CIRCLE_INTX radius invalid or no intersection found.',
      });
      return true;
    }
    addPoint(applyHistoryUpdate, primary.point);
    publishReport(
      'LINE_CIRCLE_INTX',
      'Line-Circle Intersection',
      `Computed line-circle intersection on ${session.lineStart.label}-${session.lineEnd.label}`,
      [
        { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
        { label: 'Center', value: session.targetPoint.label },
        { label: 'Radius', value: radius.toFixed(3), unit: 'm' },
        { label: 'Chosen Northing', value: primary.point.y.toFixed(3), unit: 'm' },
        { label: 'Chosen Easting', value: primary.point.x.toFixed(3), unit: 'm' },
      ],
      solutions.slice(1).map((solution, index) => ({
        id: `lc-alt-${index + 2}`,
        label: `${solution.label}: N ${solution.point.y.toFixed(3)} E ${solution.point.x.toFixed(3)}`,
        point: solution.point,
      })),
    );
    replaceSession(null);
    return true;
  }

  if (session.key === 'OFFSET_INTX') {
    const parsed = parseDualOffsetInput(session.inputValue);
    const solution =
      parsed &&
      cadIntersectOffsetLines({
        firstLineStart: session.firstLineStart,
        firstLineEnd: session.firstLineEnd,
        firstOffset: parsed.firstOffset,
        secondLineStart: session.secondLineStart,
        secondLineEnd: session.secondLineEnd,
        secondOffset: parsed.secondOffset,
        firstLabel: `${session.firstLineStart.label}-${session.firstLineEnd.label}`,
        secondLabel: `${session.secondLineStart.label}-${session.secondLineEnd.label}`,
      });
    if (!parsed || !solution) {
      replaceSession({
        ...session,
        resultText: 'OFFSET_INTX input invalid. Use `Loff1,Roff2` with non-parallel offset lines.',
      });
      return true;
    }
    addPoint(applyHistoryUpdate, solution.point);
    publishReport(
      'OFFSET_INTX',
      'Offset Intersection',
      `Computed offset intersection from two selected lines`,
      [
        { label: 'Line 1', value: `${session.firstLineStart.label}-${session.firstLineEnd.label}` },
        { label: 'Offset 1', value: parsed.firstOffset.toFixed(3), unit: 'm' },
        { label: 'Line 2', value: `${session.secondLineStart.label}-${session.secondLineEnd.label}` },
        { label: 'Offset 2', value: parsed.secondOffset.toFixed(3), unit: 'm' },
        { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
        { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
      ],
    );
    replaceSession(null);
    return true;
  }

  if (session.targetPoint == null) {
    const parsedPoint = parseInputPoint(session.inputValue, session.lineEnd);
    if (!parsedPoint) {
      replaceSession({
        ...session,
        resultText: 'SKEW_INTX point input invalid. Use `x,y` or `LABEL=x,y`.',
      });
      return true;
    }
    consumePoint(parsedPoint);
    return true;
  }
  const parsed = parseSideDistanceInput(session.inputValue);
  const solution =
    parsed &&
    cadIntersectSkew({
      lineStart: session.lineStart,
      lineEnd: session.lineEnd,
      fromPoint: session.targetPoint,
      angleDeg: parsed.distance,
      side: parsed.side,
      lineLabel: `${session.lineStart.label}-${session.lineEnd.label}`,
      pointLabel: session.targetPoint.label,
    });
  if (!parsed || !solution) {
    replaceSession({
      ...session,
      resultText: 'SKEW_INTX input invalid. Use `Langle` or `Rangle` with a non-parallel skew.',
    });
    return true;
  }
  addPoint(applyHistoryUpdate, solution.point);
  publishReport(
    'SKEW_INTX',
    'Skew Intersection',
    `Computed skew intersection from ${session.targetPoint.label} onto ${session.lineStart.label}-${session.lineEnd.label}`,
    [
      { label: 'Source point', value: session.targetPoint.label },
      { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
      { label: 'Skew', value: `${parsed.side} ${parsed.distance.toFixed(4)} deg` },
      { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
      { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
    ],
  );
  replaceSession(null);
  return true;
};

export const handleSurveyCadIntersectionSubmit = (
  options: HandleSurveyCadIntersectionSubmitOptions,
): boolean =>
  handleTwoPointIntersectionSubmit(options) || handleLineIntersectionSubmit(options);
