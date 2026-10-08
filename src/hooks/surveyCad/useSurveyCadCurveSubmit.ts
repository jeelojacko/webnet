import {
  cadArcPointByArcDistance,
  cadArcPointByChordDistance,
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
import type { CadProject } from '../../engine/cad/cadTypes';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
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

/** Count only survey-point entities: subdivide labels are never marker points. */
const countSurveyPointEntities = (project: CadProject): number =>
  project.entities.filter((entity) => entity.type === 'survey-point').length;

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
  // Dead-click fix: arc-less sessions prompt for an arc pick (the pick
  // handler fills `arc`); typed input without an arc stays active.
  if (!session.arc) {
    replaceSession({
      ...session,
      resultText: `${session.key} needs an arc first. Click an arc body, then type the input.`,
    });
    return true;
  }
  const arc = session.arc;

  if (session.key === 'RADIAL_BEARING') {
    const token = session.inputValue.trim().toUpperCase();
    const angleDeg =
      token === 'PC'
        ? arc.startAngleDeg
        : token === 'PT'
          ? arc.endAngleDeg
          : token === 'MID'
            ? arc.startAngleDeg + cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg) / 2
            : null;
    if (angleDeg == null) {
      replaceSession({
        ...session,
        resultText: 'RADIAL_BEARING input invalid. Use `PC`, `PT`, or `MID`.',
      });
      return true;
    }
    const bearing = cadRadialBearingAtArcAngle({ arc: arc, angleDeg });
    publishReport(
      'RADIAL_BEARING',
      'Radial Bearing',
      `Computed radial bearing on ${arc.id}`,
      [
        { label: 'Arc', value: arc.id },
        { label: 'Location', value: token },
        { label: 'Bearing', value: bearing },
      ],
    );
    replaceSession({
      ...session,
      inputValue: '',
      resultText: `RADIAL_BEARING ${arc.id} ${token}: ${bearing}.`,
    });
    return true;
  }

  if (session.key === 'POINT_ON_CURVE') {
    const parsed = parseCurveMeasureInput(session.inputValue);
    const point =
      parsed?.mode === 'arc'
        ? cadArcPointByArcDistance(arc, parsed.distance)
        : parsed?.mode === 'chord'
          ? cadArcPointByChordDistance(arc, parsed.distance)
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
      `Created point on ${arc.id}`,
      [
        { label: 'Arc', value: arc.id },
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
    if (!parsed) {
      replaceSession({
        ...session,
        resultText: 'SUBDIVIDE_CURVE input invalid. Use `EQUAL,count`, `ARC,interval`, or `CHORD,interval` that yields interior points.',
      });
      return true;
    }
    // Atomic marker points: every interior point lands in ONE history entry
    // via SUBDIVIDE_CURVE_CREATE (the arc is never split).
    // The transaction emits one survey-point per interior point PLUS one
    // anchored text label per point, so a raw entity delta double-counts.
    // Derive the visible count from committed survey-points only.
    let committedCount: number | null = null;
    applyHistoryUpdate((existing) => {
      const next = runCadCommand(existing, {
        key: 'SUBDIVIDE_CURVE_CREATE',
        arcEntityId: arc.id,
        mode: parsed.mode,
        value: parsed.value,
      });
      if (next !== existing) {
        committedCount =
          countSurveyPointEntities(next.present.project) - countSurveyPointEntities(existing.present.project);
      }
      return next;
    });
    if (committedCount == null) {
      replaceSession({
        ...session,
        resultText: 'SUBDIVIDE_CURVE input yields no interior marker points (locked source, degenerate chord, or empty division). The session stays active.',
      });
      return true;
    }
    publishReport(
      'SUBDIVIDE_CURVE',
      'Curve Subdivision',
      `Created ${committedCount} subdivision marker point${committedCount === 1 ? '' : 's'} on ${arc.id}`,
      [
        { label: 'Arc', value: arc.id },
        { label: 'Mode', value: parsed.mode.toUpperCase() },
        { label: 'Value', value: parsed.value.toFixed(3) },
        { label: 'Marker Points', value: String(committedCount) },
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
        arc: arc,
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
      `Created offset curve from ${arc.id}`,
      [
        { label: 'Arc', value: arc.id },
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
          sourceArc: arc,
          radius: parsed.radius,
          deltaDeg: parsed.deltaDeg,
        })
      : cadBuildCompoundCurve({
          sourceArc: arc,
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
    sourceArcId: arc.id,
    side: parsed.side,
    radius: parsed.radius,
    deltaDeg: parsed.deltaDeg,
  });
  publishReport(
    session.key,
    session.key === 'REVERSE_CURVE' ? 'Reverse Curve' : 'Compound Curve',
    `Created ${session.key === 'REVERSE_CURVE' ? 'reverse' : 'compound'} curve from ${arc.id}`,
    [
      { label: 'Source Arc', value: arc.id },
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
