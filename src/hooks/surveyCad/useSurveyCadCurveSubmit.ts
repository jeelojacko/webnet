import {
  cadArcPointByArcDistance,
  cadArcPointByChordDistance,
  cadArcSubdivisionPoints,
  cadBuildArcFromChordBearingRadius,
  cadBuildArcFromPiRadiusDelta,
  cadBuildCompoundCurve,
  cadBuildCurveMetricsSummaryFromRadiusDelta,
  cadBuildReverseCurve,
  cadOffsetArc,
  cadRadialBearingAtArcAngle,
  cadSolveCurveMetrics,
} from '../../engine/cad/cadCogo';
import { cadSignedSweepDeg } from '../../engine/cad/cadGeometry';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import type { CommandSession } from './useSurveyCadCommandTypes';
import {
  parseChordBearingCurveInput,
  parseCurveMeasureInput,
  parseCurveSideRadiusDeltaInput,
  parseCurveSolverInput,
  parseCurveSubdivisionInput,
  parseInputPoint,
  parseOffsetArcInput,
} from './useSurveyCadCommandParsing';
import type { HandleSurveyCadCurveSubmitOptions } from './useSurveyCadCurveSubmit.types';

const handleSelectedArcSubmit = ({
  applyHistoryUpdate,
  commitArcDefinition,
  publishReport,
  replaceSession,
  session,
}: Omit<HandleSurveyCadCurveSubmitOptions, 'consumePoint'>): boolean => {
  if (
    session.key !== 'RADIAL_BEARING' &&
    session.key !== 'POINT_ON_CURVE' &&
    session.key !== 'SUBDIVIDE_CURVE' &&
    session.key !== 'OFFSET_CURVE' &&
    session.key !== 'REVERSE_CURVE' &&
    session.key !== 'COMPOUND_CURVE'
  ) {
    return false;
  }

  if (session.key === 'RADIAL_BEARING') {
    const token = session.inputValue.trim().toUpperCase();
    const angleDeg =
      token === 'PC'
        ? session.arc.startAngleDeg
        : token === 'PT'
          ? session.arc.endAngleDeg
          : token === 'MID'
            ? session.arc.startAngleDeg + cadSignedSweepDeg(session.arc.startAngleDeg, session.arc.endAngleDeg) / 2
            : null;
    if (angleDeg == null) {
      replaceSession({
        ...session,
        resultText: 'RADIAL_BEARING input invalid. Use `PC`, `PT`, or `MID`.',
      });
      return true;
    }
    const bearing = cadRadialBearingAtArcAngle({ arc: session.arc, angleDeg });
    publishReport(
      'RADIAL_BEARING',
      'Radial Bearing',
      `Computed radial bearing on ${session.arc.id}`,
      [
        { label: 'Arc', value: session.arc.id },
        { label: 'Location', value: token },
        { label: 'Bearing', value: bearing },
      ],
    );
    replaceSession({
      ...session,
      inputValue: '',
      resultText: `RADIAL_BEARING ${session.arc.id} ${token}: ${bearing}.`,
    });
    return true;
  }

  if (session.key === 'POINT_ON_CURVE') {
    const parsed = parseCurveMeasureInput(session.inputValue);
    const point =
      parsed?.mode === 'arc'
        ? cadArcPointByArcDistance(session.arc, parsed.distance)
        : parsed?.mode === 'chord'
          ? cadArcPointByChordDistance(session.arc, parsed.distance)
          : null;
    if (!parsed || !point) {
      replaceSession({
        ...session,
        resultText: 'POINT_ON_CURVE input invalid. Use `ARC,distance` or `CHORD,distance` within the selected arc.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'POINT',
        x: point.x,
        y: point.y,
      }),
    );
    publishReport(
      'POINT_ON_CURVE',
      'Point On Curve',
      `Created point on ${session.arc.id}`,
      [
        { label: 'Arc', value: session.arc.id },
        { label: 'Mode', value: parsed.mode.toUpperCase() },
        { label: 'Distance', value: parsed.distance.toFixed(3), unit: 'm' },
        { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
        { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
      ],
    );
    replaceSession(null);
    return true;
  }

  if (session.key === 'SUBDIVIDE_CURVE') {
    const parsed = parseCurveSubdivisionInput(session.inputValue);
    const points = parsed ? cadArcSubdivisionPoints({ arc: session.arc, mode: parsed.mode, value: parsed.value }) : [];
    if (!parsed || points.length === 0) {
      replaceSession({
        ...session,
        resultText: 'SUBDIVIDE_CURVE input invalid. Use `EQUAL,count`, `ARC,interval`, or `CHORD,interval` that yields interior points.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      points.reduce(
        (current, point, index) =>
          runCadCommand(current, {
            key: 'POINT',
            x: point.x,
            y: point.y,
            label: `${session.arc.id}-${index + 1}`,
          }),
        existing,
      ),
    );
    publishReport(
      'SUBDIVIDE_CURVE',
      'Curve Subdivision',
      `Created ${points.length} subdivision point${points.length === 1 ? '' : 's'} on ${session.arc.id}`,
      [
        { label: 'Arc', value: session.arc.id },
        { label: 'Mode', value: parsed.mode.toUpperCase() },
        { label: 'Value', value: parsed.value.toFixed(3) },
        { label: 'Points', value: points.length.toString() },
      ],
    );
    replaceSession(null);
    return true;
  }

  if (session.key === 'OFFSET_CURVE') {
    const parsed = parseOffsetArcInput(session.inputValue);
    const definition =
      parsed &&
      cadOffsetArc({
        arc: session.arc,
        offsetDistance: parsed.offsetDistance,
        side: parsed.side,
      });
    if (!parsed || !definition) {
      replaceSession({
        ...session,
        resultText: 'OFFSET_CURVE input invalid. Use `Ldistance` or `Rdistance` with a valid remaining radius.',
      });
      return true;
    }
    commitArcDefinition('OFFSET_CURVE', {
      center: definition.center,
      radius: definition.radius,
      startAngleDeg: definition.startAngleDeg,
      endAngleDeg: definition.endAngleDeg,
    });
    publishReport(
      'OFFSET_CURVE',
      'Offset Curve',
      `Created offset curve from ${session.arc.id}`,
      [
        { label: 'Arc', value: session.arc.id },
        { label: 'Offset', value: `${parsed.side} ${parsed.offsetDistance.toFixed(3)} m` },
        { label: 'Radius', value: definition.radius.toFixed(3), unit: 'm' },
      ],
    );
    replaceSession(null);
    return true;
  }

  const parsed = parseCurveSideRadiusDeltaInput(session.inputValue);
  const definition =
    parsed &&
    (session.key === 'REVERSE_CURVE'
      ? cadBuildReverseCurve({
          sourceArc: session.arc,
          radius: parsed.radius,
          deltaDeg: parsed.deltaDeg,
        })
      : cadBuildCompoundCurve({
          sourceArc: session.arc,
          radius: parsed.radius,
          deltaDeg: parsed.deltaDeg,
        }));
  if (!parsed || !definition) {
    replaceSession({
      ...session,
      resultText: `${session.key} input invalid. Use \`Lradius,delta\` or \`Rradius,delta\` with a valid curve.`,
    });
    return true;
  }
  commitArcDefinition(session.key, definition, {
    sourceArcId: session.arc.id,
    side: parsed.side,
    radius: parsed.radius,
    deltaDeg: parsed.deltaDeg,
  });
  publishReport(
    session.key,
    session.key === 'REVERSE_CURVE' ? 'Reverse Curve' : 'Compound Curve',
    `Created ${session.key === 'REVERSE_CURVE' ? 'reverse' : 'compound'} curve from ${session.arc.id}`,
    [
      { label: 'Source Arc', value: session.arc.id },
      { label: 'Radius', value: parsed.radius.toFixed(3), unit: 'm' },
      { label: 'Delta', value: parsed.deltaDeg.toFixed(4), unit: 'deg' },
    ],
  );
  replaceSession(null);
  return true;
};

export const handleSurveyCadCurveSubmit = (options: HandleSurveyCadCurveSubmitOptions): boolean => {
  const {
    commitArcDefinition,
    consumePoint,
    publishReport,
    replaceSession,
    session,
  } = options;

  if (session.key === 'CURVE_SOLVER') {
    const parsed = parseCurveSolverInput(session.inputValue);
    const solution = parsed ? cadSolveCurveMetrics(parsed) : null;
    if (!parsed || !solution) {
      replaceSession({
        ...session,
        resultText: 'CURVE_SOLVER input invalid. Use `param1,param2,value1,value2` with a solvable pair.',
      });
      return true;
    }
    publishReport(
      'CURVE_SOLVER',
      'Curve Calculator',
      `Solved curve from ${parsed.pair}`,
      [
        { label: 'Pair', value: parsed.pair },
        { label: 'Radius', value: solution.radius.toFixed(3), unit: 'm' },
        { label: 'Delta', value: solution.deltaDeg.toFixed(4), unit: 'deg' },
        { label: 'Arc Length', value: solution.arcLength.toFixed(3), unit: 'm' },
        { label: 'Chord Length', value: solution.chordLength.toFixed(3), unit: 'm' },
        { label: 'Tangent Length', value: solution.tangentLength.toFixed(3), unit: 'm' },
        { label: 'External', value: solution.externalDistance.toFixed(3), unit: 'm' },
        { label: 'Middle Ordinate', value: solution.middleOrdinate.toFixed(3), unit: 'm' },
      ],
    );
    replaceSession({
      ...session,
      inputValue: '',
      resultText: `CURVE_SOLVER solved ${parsed.pair}: R ${solution.radius.toFixed(3)} m, Δ ${solution.deltaDeg.toFixed(4)} deg.`,
    });
    return true;
  }

  if (handleSelectedArcSubmit(options)) {
    return true;
  }

  if (session.key === 'PI_CURVE') {
    if (session.piPoint == null || session.backTangentPoint == null) {
      const parsedPoint = parseInputPoint(session.inputValue, session.piPoint);
      if (!parsedPoint) {
        replaceSession({
          ...session,
          resultText: 'PI_CURVE point input invalid. Use `x,y` or `LABEL=x,y`.',
        });
        return true;
      }
      consumePoint(parsedPoint);
      return true;
    }
    const parsed = parseCurveSideRadiusDeltaInput(session.inputValue);
    const definition =
      parsed &&
      cadBuildArcFromPiRadiusDelta({
        piPoint: session.piPoint,
        backTangentPoint: session.backTangentPoint,
        radius: parsed.radius,
        deltaDeg: parsed.deltaDeg,
        side: parsed.side,
      });
    const summary = parsed ? cadBuildCurveMetricsSummaryFromRadiusDelta(parsed.radius, parsed.deltaDeg) : null;
    if (!parsed || !definition || !summary) {
      replaceSession({
        ...session,
        resultText: 'PI_CURVE input invalid. Use `Lradius,delta` or `Rradius,delta` with a valid tangent setup.',
      });
      return true;
    }
    commitArcDefinition('PI_CURVE', definition, {
      piLabel: session.piPoint.label,
      backTangentLabel: session.backTangentPoint.label,
      side: parsed.side,
    });
    publishReport(
      'PI_CURVE',
      'PI Radius Delta Curve',
      `Created PI-radius-delta curve from ${session.piPoint.label}`,
      [
        { label: 'PI', value: session.piPoint.label },
        { label: 'Back Tangent', value: session.backTangentPoint.label },
        { label: 'Radius', value: parsed.radius.toFixed(3), unit: 'm' },
        { label: 'Delta', value: parsed.deltaDeg.toFixed(4), unit: 'deg' },
        { label: 'Tangent', value: summary.tangentLength.toFixed(3), unit: 'm' },
      ],
    );
    replaceSession(null);
    return true;
  }

  if (session.key === 'CHORD_BEARING_CURVE') {
    if (session.startPoint == null) {
      const parsedPoint = parseInputPoint(session.inputValue, null);
      if (!parsedPoint) {
        replaceSession({
          ...session,
          resultText: 'CHORD_BEARING_CURVE start input invalid. Use `x,y` or `LABEL=x,y`.',
        });
        return true;
      }
      consumePoint(parsedPoint);
      return true;
    }
    const parsed = parseChordBearingCurveInput(session.inputValue);
    const definition =
      parsed &&
      cadBuildArcFromChordBearingRadius({
        startPoint: session.startPoint,
        chordBearing: parsed.chordBearing,
        chordDistance: parsed.chordDistance,
        radius: parsed.radius,
        side: parsed.side,
      });
    if (!parsed || !definition) {
      replaceSession({
        ...session,
        resultText: 'CHORD_BEARING_CURVE input invalid. Use `bearing,chord,radius,L|R` with a valid radius.',
      });
      return true;
    }
    commitArcDefinition('CHORD_BEARING_CURVE', definition, {
      startLabel: session.startPoint.label,
      chordBearing: parsed.chordBearing,
      chordDistance: parsed.chordDistance,
      side: parsed.side,
    });
    publishReport(
      'CHORD_BEARING_CURVE',
      'Chord Bearing Curve',
      `Created curve from ${session.startPoint.label}`,
      [
        { label: 'Start', value: session.startPoint.label },
        { label: 'Chord Bearing', value: parsed.chordBearing },
        { label: 'Chord Length', value: parsed.chordDistance.toFixed(3), unit: 'm' },
        { label: 'Radius', value: parsed.radius.toFixed(3), unit: 'm' },
      ],
    );
    replaceSession(null);
    return true;
  }

  return false;
};
