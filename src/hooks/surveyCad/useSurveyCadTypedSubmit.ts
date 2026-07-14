import {
  cadBuildParcelReportSummary,
  buildCadDistanceSummary,
  buildCadMultiInverseSummary,
  cadConvertAreaSquareMeters,
  cadComputeDeflectionAnglePoint,
  cadComputeTurnedAnglePoint,
  cadExtendLineByDistance,
  cadOffsetPointFromLine,
  cadPointAtDistanceAlongLine,
  cadPointAtFractionAlongLine,
} from '../../engine/cad/cadCogo';
import {
  cadBuildAlignmentStationPoints,
  cadBuildOffsetAlignmentDraft,
  cadPointAtAlignmentStationOffset,
} from '../../engine/cad/cadAlignment';
import { cadParseBearingDegrees } from '../../engine/cad/cadGeometry';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import {
  parseAlignmentIntervalInput,
  parseAlignmentOffsetCreateInput,
  parseAlignmentStationEquationInput,
  parseAlignmentStationOffsetInput,
  parseDistanceOrPercent,
  parseInputPoint,
  parseLeftRightAngleDistance,
  parseOffsetPointInput,
} from './useSurveyCadCommandParsing';
import type { SurveyCadReportPublisher } from './useSurveyCadCommandReports';

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
type ConsumePoint = (_point: CommandPoint) => void;

interface HandleSurveyCadTypedSubmitOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  consumePoint: ConsumePoint;
  publishReport: SurveyCadReportPublisher;
  replaceSession: ReplaceSession;
  session: CommandSession;
}

const handleSequenceReportSubmit = ({
  consumePoint,
  publishReport,
  replaceSession,
  session,
}: Omit<HandleSurveyCadTypedSubmitOptions, 'applyHistoryUpdate'>): boolean => {
  if (session.key === 'MULTI_INVERSE') {
    if (session.inputValue.trim().length === 0) {
      if (session.points.length < 2) return true;
      const multi = buildCadMultiInverseSummary(session.points);
      publishReport(
        'MULTI_INVERSE',
        'Multi-Point Inverse',
        `Computed ${multi.legs.length} inverse leg${multi.legs.length === 1 ? '' : 's'}`,
        [
          ...multi.legs.flatMap((leg, index) => ([
            { label: `Leg ${index + 1}`, value: `${leg.fromLabel} -> ${leg.toLabel}` },
            { label: `Leg ${index + 1} Bearing`, value: leg.bearing },
            { label: `Leg ${index + 1} Distance`, value: leg.distance.toFixed(3), unit: 'm' },
          ])),
          { label: 'Total distance', value: multi.totalDistance.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession({
        ...session,
        points: [],
        resultText: `MULTI_INVERSE reported ${multi.legs.length} legs, total ${multi.totalDistance.toFixed(3)} m.`,
      });
      return true;
    }
    const parsedPoint = parseInputPoint(session.inputValue, session.points[session.points.length - 1] ?? null);
    if (!parsedPoint) {
      replaceSession({
        ...session,
        resultText: 'MULTI_INVERSE point input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance.',
      });
      return true;
    }
    consumePoint(parsedPoint);
    return true;
  }

  if (session.key === 'AREA') {
    if (session.inputValue.trim().length === 0) {
      if (session.points.length < 3) return true;
      const report = cadBuildParcelReportSummary({
        parcelName: 'Area Sequence',
        vertices: session.points,
        vertexLabels: session.points.map((point) => point.label),
      });
      if (!report) {
        replaceSession({
          ...session,
          resultText: 'AREA could not build a valid loop from the captured point sequence.',
        });
        return true;
      }
      const convertedArea = cadConvertAreaSquareMeters(report.areaSquareMeters);
      publishReport(
        'AREA',
        'Area by Point Sequence',
        `Computed area from ${report.courseCount} side${report.courseCount === 1 ? '' : 's'}.`,
        [
          { label: 'Points', value: session.points.map((point) => point.label).join(' -> ') },
          { label: 'Area', value: report.areaSquareMeters.toFixed(3), unit: 'm2' },
          { label: 'Area (ha)', value: convertedArea.hectares.toFixed(4), unit: 'ha' },
          { label: 'Area (ac)', value: convertedArea.acres.toFixed(4), unit: 'ac' },
          { label: 'Area (ft2)', value: convertedArea.squareFeet.toFixed(3), unit: 'ft2' },
          { label: 'Perimeter', value: report.perimeterMeters.toFixed(3), unit: 'm' },
          { label: 'Closure dN', value: report.closureDeltaY.toFixed(3), unit: 'm' },
          { label: 'Closure dE', value: report.closureDeltaX.toFixed(3), unit: 'm' },
          { label: 'Closure', value: report.closureDistanceMeters.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession({
        ...session,
        points: [],
        resultText: `AREA reported ${report.courseCount} sides, ${report.areaSquareMeters.toFixed(3)} m².`,
      });
      return true;
    }
    const parsedPoint = parseInputPoint(session.inputValue, session.points[session.points.length - 1] ?? null);
    if (!parsedPoint) {
      replaceSession({
        ...session,
        resultText: 'AREA point input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance.',
      });
      return true;
    }
    consumePoint(parsedPoint);
    return true;
  }

  return false;
};

const handleParcelSplitSubmit = ({
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
        resultText: 'PARCEL SPLIT bearing invalid. Enter an azimuth or survey bearing like `N45-00-00E`.',
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

const handleTurnedPointSubmit = ({
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

const handleLineConstructionSubmit = ({
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

const handleAlignmentSubmit = ({
  applyHistoryUpdate,
  replaceSession,
  session,
}: Omit<HandleSurveyCadTypedSubmitOptions, 'consumePoint' | 'publishReport'>): boolean => {
  if (session.key === 'ALIGNMENT_OFFSET_POINT') {
    const parsed = parseAlignmentStationOffsetInput(session.inputValue);
    const point = parsed
      ? cadPointAtAlignmentStationOffset(session.alignment, parsed.station, parsed.offset)
      : null;
    if (!parsed || !point) {
      replaceSession({
        ...session,
        resultText: 'STA PT input invalid. Use `station,offset` or `LABEL=station,offset` within the selected alignment range.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'ALIGNMENT_OFFSET_POINT',
        alignmentEntityId: session.alignment.id,
        station: parsed.station,
        offset: parsed.offset,
        label: parsed.label,
      }),
    );
    replaceSession(null);
    return true;
  }

  if (session.key === 'ALIGNMENT_OFFSET_CREATE') {
    const parsed = parseAlignmentOffsetCreateInput(session.inputValue);
    const draft = parsed ? cadBuildOffsetAlignmentDraft(session.alignment, parsed.offset) : null;
    if (!parsed || !draft) {
      replaceSession({
        ...session,
        resultText: 'ALIGN OFF input invalid. Use `offset` or `NAME=offset` for a buildable selected alignment.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'ALIGNMENT_OFFSET_CREATE',
        alignmentEntityId: session.alignment.id,
        offset: parsed.offset,
        name: parsed.name,
      }),
    );
    replaceSession(null);
    return true;
  }

  if (session.key === 'ALIGNMENT_STATION_EQUATION') {
    const parsed = parseAlignmentStationEquationInput(session.inputValue);
    if (!parsed) {
      replaceSession({
        ...session,
        resultText: 'STA EQ input invalid. Use `backStation,aheadStation`, with ahead at or above back.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'ALIGNMENT_STATION_EQUATION',
        alignmentEntityId: session.alignment.id,
        backStation: parsed.backStation,
        aheadStation: parsed.aheadStation,
      }),
    );
    replaceSession(null);
    return true;
  }

  if (session.key !== 'ALIGNMENT_INTERVAL_POINTS') return false;
  const parsed = parseAlignmentIntervalInput(session.inputValue);
  const points = parsed
    ? cadBuildAlignmentStationPoints(session.alignment, {
        startStation: parsed.startStation,
        endStation: parsed.endStation,
        interval: parsed.interval,
        includeStart: true,
        includeEnd: true,
      })
    : [];
  if (!parsed || points.length === 0) {
    replaceSession({
      ...session,
      resultText: 'STA INT input invalid. Use `interval` or `start,end,interval` within the selected alignment range.',
    });
    return true;
  }
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, {
      key: 'ALIGNMENT_INTERVAL_POINTS',
      alignmentEntityId: session.alignment.id,
      interval: parsed.interval,
      startStation: parsed.startStation,
      endStation: parsed.endStation,
      labelPrefix: parsed.labelPrefix,
    }),
  );
  replaceSession(null);
  return true;
};

export const handleSurveyCadTypedSubmit = (
  options: HandleSurveyCadTypedSubmitOptions,
): boolean =>
  handleSequenceReportSubmit(options) ||
  handleParcelSplitSubmit(options) ||
  handleTurnedPointSubmit(options) ||
  handleLineConstructionSubmit(options) ||
  handleAlignmentSubmit(options);
