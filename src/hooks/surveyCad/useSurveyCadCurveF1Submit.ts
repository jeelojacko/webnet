import type { CadCurveMetricMode } from '../../engine/cad/cadCurveMetricsSolver';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CommandSession } from './useSurveyCadCommandTypes';
import { parseInputPoint } from './useSurveyCadCommandParsing';
import type { SurveyCadReportPublisher } from './useSurveyCadCommandReports';
import {
  isBackstepToken,
  isCurveF1Session,
  parseCurveF1ChainSegment,
  parseCurveF1Count,
  parseCurveF1DegreeRadius,
  parseCurveF1ExtentToken,
  parseCurveF1Floating,
  parseCurveF1MetricToken,
  parseCurveF1SignedRadius,
  pickLabelOf,
  solveF1Chain,
  solveF1FromEnd,
  solveF1LinePairArc,
  solveF1ReverseCompound,
  solveF1ThroughArc,
  type CadCurveF1ExtentMode,
  type CurveF1Session,
} from './useSurveyCadCurveF1Session';
import {
  stay,
  type ApplyHistoryUpdate,
  type ReplaceSession,
} from './useSurveyCadCurveF1SubmitShared';

// Point picks (including native LINE_CIRCLE_INTX) live in the dedicated
// module; re-exported so the consume-point hook and F1 session tests keep
// importing both entry points from this module.
export { handleCurveF1PointPick } from './useSurveyCadCurveF1PointPick';

export interface CurveF1SubmitOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  publishReport: SurveyCadReportPublisher;
  replaceSession: ReplaceSession;
  session: CommandSession;
  project: CadProject;
}

const commitF1 = (
  project: CadProject,
  applyHistoryUpdate: ApplyHistoryUpdate,
  publishReport: SurveyCadReportPublisher,
  replaceSession: ReplaceSession,
  session: CommandSession,
  command: Parameters<typeof runCadCommand>[1],
  report: { toolKey: string; title: string; summary: string; rows: Array<{ label: string; value: string; unit?: string }> },
  successText: string,
): boolean => {
  void project;
  let committed = false;
  applyHistoryUpdate((existing) => {
    const next = runCadCommand(existing, command);
    if (next !== existing) committed = true;
    return next;
  });
  if (!committed) {
    stay(session, replaceSession, `${session.key} commit rejected (locked/hidden source or invalid geometry). The session stays active.`);
    return true;
  }
  publishReport(report.toolKey, report.title, report.summary, report.rows);
  replaceSession(null);
  void successText;
  return true;
};

const metricRows = (metrics: { radius: number; deltaDeg: number; tangentLength: number; arcLength: number; chordLength: number }) => [
  { label: 'Radius', value: metrics.radius.toFixed(3), unit: 'm' },
  { label: 'Delta', value: metrics.deltaDeg.toFixed(4), unit: 'deg' },
  { label: 'Tangent', value: metrics.tangentLength.toFixed(3), unit: 'm' },
  { label: 'Arc Length', value: metrics.arcLength.toFixed(3), unit: 'm' },
  { label: 'Chord', value: metrics.chordLength.toFixed(3), unit: 'm' },
];

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Typed submit (backstep-aware; invalid input stays active).            */
/* ------------------------------------------------------------------ */

const backstepLinePair = (session: CurveF1Session, replaceSession: ReplaceSession): boolean => {
  switch (session.key) {
    case 'CURVE_BETWEEN_TWO_LINES':
    case 'CURVE_ON_TWO_LINES':
      if (session.metricMode != null || session.metricValue != null) {
        replaceSession({ ...session, metricMode: null, metricValue: null, inputValue: '', resultText: undefined });
        return true;
      }
      break;
    case 'CURVE_THROUGH_POINT':
      if (session.candidateSide) {
        replaceSession({ ...session, candidateSide: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.throughPoint) {
        replaceSession({ ...session, throughPoint: null, inputValue: '', resultText: undefined });
        return true;
      }
      break;
    case 'MULTIPLE_CURVES':
      if (session.segments.length > 0) {
        replaceSession({ ...session, segments: session.segments.slice(0, -1), inputValue: '', resultText: undefined });
        return true;
      }
      if (session.floatingIndex != null) {
        replaceSession({ ...session, floatingIndex: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.count != null) {
        replaceSession({ ...session, count: null, inputValue: '', resultText: undefined });
        return true;
      }
      break;
    case 'CURVE_FROM_END':
      if (session.endPoint) {
        replaceSession({ ...session, endPoint: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.extentMode != null || session.extentValue != null) {
        replaceSession({ ...session, extentMode: null, extentValue: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.signedRadius != null) {
        replaceSession({ ...session, signedRadius: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.mode) {
        replaceSession({ ...session, mode: null, inputValue: '', resultText: undefined });
        return true;
      }
      break;
    case 'REVERSE_OR_COMPOUND':
      if (session.pointEnd) {
        replaceSession({ ...session, pointEnd: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.extentMode != null || session.extentValue != null) {
        replaceSession({ ...session, extentMode: null, extentValue: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.radius != null) {
        replaceSession({ ...session, radius: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.rcMode) {
        replaceSession({ ...session, rcMode: null, inputValue: '', resultText: undefined });
        return true;
      }
      break;
  }
  if ('secondEntityId' in session && session.secondEntityId) {
    replaceSession({ ...session, secondEntityId: null, secondPickPoint: null, inputValue: '', resultText: undefined });
    return true;
  }
  if ('firstEntityId' in session && session.firstEntityId) {
    replaceSession({ ...session, firstEntityId: null, firstPickPoint: null, inputValue: '', resultText: undefined });
    return true;
  }
  if ('sourceEntityId' in session && session.sourceEntityId) {
    if (session.key === 'CURVE_FROM_END') {
      replaceSession({ ...session, sourceEntityId: null, pickPoint: null, end: null, inputValue: '', resultText: undefined });
      return true;
    }
    replaceSession({ ...session, sourceEntityId: null, end: null, inputValue: '', resultText: undefined });
    return true;
  }
  return false;
};

const submitLinePairMetric = (
  options: CurveF1SubmitOptions,
  session: Extract<CommandSession, { key: 'CURVE_BETWEEN_TWO_LINES' | 'CURVE_ON_TWO_LINES' }>,
  token: string,
): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession, project } = options;
  if (token.length === 0) {
    if (session.firstEntityId && session.secondEntityId && session.metricMode && session.metricValue != null) {
      const solved = solveF1LinePairArc(project, session, { mode: session.metricMode, value: session.metricValue });
      if (!solved) {
        stay(session, replaceSession, `${session.key} has no tangent arc for the stored metric. Re-pick a line (click) or type another metric; U steps back.`);
        return true;
      }
      return commitLinePairArc(options, session, solved.result, {
        mode: session.metricMode,
        value: session.metricValue,
      });
    }
    stay(session, replaceSession, `${session.key} needs both line picks plus one metric (R200, T50, C100, L150, E5, M2, D1.5).`);
    return true;
  }
  if (isBackstepToken(token)) {
    if (!backstepLinePair(session, replaceSession)) stay(session, replaceSession, `${session.key} has nothing to undo.`);
    return true;
  }
  const parsed = parseCurveF1MetricToken(token);
  if (!parsed) {
    stay(session, replaceSession, `${session.key} metric invalid. Use R200, T50, C100, L150, E5, M2, or D1.5 (degree-of-curve); a bare number is a radius.`);
    return true;
  }
  if (!session.firstEntityId || !session.secondEntityId) {
    stay(session, replaceSession, `${session.key} needs both line picks first. Click two line bodies, then type the metric.`);
    return true;
  }
  const solved = solveF1LinePairArc(project, { ...session, metricMode: parsed.mode, metricValue: parsed.value }, parsed);
  if (!solved) {
    replaceSession({ ...session, metricMode: parsed.mode, metricValue: parsed.value, inputValue: '', resultText: `${session.key} has no tangent arc for ${parsed.mode} ${parsed.value}. The metric is stored — re-pick a line or type another metric; U steps back.` });
    return true;
  }
  void applyHistoryUpdate;
  void publishReport;
  return commitLinePairArc(options, session, solved.result, parsed);
};

const commitLinePairArc = (
  options: CurveF1SubmitOptions,
  session: Extract<CommandSession, { key: 'CURVE_BETWEEN_TWO_LINES' | 'CURVE_ON_TWO_LINES' }>,
  result: { arc: { center: { x: number; y: number }; radius: number; startAngleDeg: number; endAngleDeg: number }; metrics: { radius: number; deltaDeg: number; tangentLength: number; arcLength: number; chordLength: number } },
  metric: { mode: CadCurveMetricMode; value: number },
): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession } = options;
  const trim = session.key === 'CURVE_BETWEEN_TWO_LINES';
  return commitF1(
    options.project,
    applyHistoryUpdate,
    publishReport,
    replaceSession,
    session,
    {
      key: trim ? 'CURVE_BETWEEN_TWO_LINES_CREATE' : 'CURVE_ON_TWO_LINES_CREATE',
      firstEntityId: session.firstEntityId!,
      firstPickPoint: { x: session.firstPickPoint!.x, y: session.firstPickPoint!.y },
      secondEntityId: session.secondEntityId!,
      secondPickPoint: { x: session.secondPickPoint!.x, y: session.secondPickPoint!.y },
      metric,
    } as Parameters<typeof runCadCommand>[1],
    {
      toolKey: session.key,
      title: trim ? 'Curve Between Two Lines' : 'Curve On Two Lines',
      summary: `Created tangent curve between ${session.firstEntityId} and ${session.secondEntityId}`,
      rows: [
        ...metricRows(result.metrics),
        { label: 'Sources', value: trim ? 'Trimmed to PC/PT' : 'Unchanged' },
      ],
    },
    `${session.key} committed.`,
  );
};

const submitThroughPoint = (options: CurveF1SubmitOptions, session: Extract<CommandSession, { key: 'CURVE_THROUGH_POINT' }>, token: string): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession, project } = options;
  if (token.length === 0) {
    if (!session.firstEntityId || !session.secondEntityId || !session.throughPoint) {
      stay(session, replaceSession, 'CURVE_THROUGH_POINT needs two line picks plus the pass-through point.');
      return true;
    }
    const outcome = solveF1ThroughArc(project, session, session.throughPoint);
    if (!outcome) {
      stay(session, replaceSession, 'CURVE_THROUGH_POINT has no tangent circle through that point for these lines. Re-pick a line or the point; U steps back.');
      return true;
    }
    if (!outcome.ok) {
      if (outcome.code !== 'MULTIPLE_SOLUTIONS') {
        stay(session, replaceSession, 'CURVE_THROUGH_POINT has no tangent circle through that point for these lines. The session stays active.');
        return true;
      }
      if (!session.candidateSide) {
        stay(session, replaceSession, `CURVE_THROUGH_POINT found ${outcome.candidates.length} tangent circles through that point. Type L or R to choose a side (never array order).`);
        return true;
      }
    }
    // Defensive check: MULTIPLE_SOLUTIONS is reachable (two tangent circles
    // that share a computed side), so the stored candidateSide must be
    // consulted before any commit. Candidates are never picked by array
    // order: a side is only usable when exactly one candidate matches it.
    let candidate = outcome.ok ? outcome.result : null;
    if (session.candidateSide) {
      const sided = outcome.candidates.filter((entry) => entry.side === session.candidateSide);
      if (sided.length !== 1) {
        stay(session, replaceSession, 'CURVE_THROUGH_POINT side choice is not unique (multiple candidates share that side). Clear it with U and re-pick the pass point; the session stays active.');
        return true;
      }
      candidate = sided[0]!;
    }
    if (!candidate) {
      stay(session, replaceSession, 'CURVE_THROUGH_POINT has no tangent circle through that point for these lines. The session stays active.');
      return true;
    }
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      session,
      {
        key: 'CURVE_THROUGH_POINT_CREATE',
        firstEntityId: session.firstEntityId!,
        firstPickPoint: { x: session.firstPickPoint!.x, y: session.firstPickPoint!.y },
        secondEntityId: session.secondEntityId!,
        secondPickPoint: { x: session.secondPickPoint!.x, y: session.secondPickPoint!.y },
        throughPoint: { x: session.throughPoint.x, y: session.throughPoint.y },
        ...(session.candidateSide ? { candidateSide: session.candidateSide } : {}),
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: 'Curve Through Point',
        summary: `Created tangent curve through ${pickLabelOf(session.throughPoint)}`,
        rows: [...metricRows(candidate.metrics), { label: 'Sources', value: 'Trimmed to PC/PT' }],
      },
      'CURVE_THROUGH_POINT committed.',
    );
  }
  if (isBackstepToken(token)) {
    if (!backstepLinePair(session, replaceSession)) stay(session, replaceSession, 'CURVE_THROUGH_POINT has nothing to undo.');
    return true;
  }
  const upper = token.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'R' || upper === 'RIGHT') {
    const side = upper.startsWith('L') ? 'left' : 'right';
    replaceSession({ ...session, candidateSide: side as 'left' | 'right', inputValue: '', resultText: undefined });
    return true;
  }
  if (!session.firstEntityId || !session.secondEntityId) {
    stay(session, replaceSession, 'CURVE_THROUGH_POINT needs both line picks first. Click two line bodies.');
    return true;
  }
  if (!session.throughPoint) {
    const parsed = parseInputPoint(token, null);
    if (!parsed) {
      stay(session, replaceSession, 'CURVE_THROUGH_POINT point invalid. Click the pass-through point or type `x,y`.');
      return true;
    }
    replaceSession({ ...session, throughPoint: parsed, inputValue: '', resultText: undefined });
    return true;
  }
  stay(session, replaceSession, 'CURVE_THROUGH_POINT holds its point. Press Enter to commit, type L/R for a side choice, or U to step back.');
  return true;
};

const submitMultiple = (options: CurveF1SubmitOptions, session: Extract<CommandSession, { key: 'MULTIPLE_CURVES' }>, token: string): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession, project } = options;
  if (token.length === 0) {
    if (session.count == null || session.floatingIndex == null || session.segments.length !== session.count) {
      stay(session, replaceSession, 'MULTIPLE_CURVES needs the count, floating index, and one `Llength,Rradius` entry per curve.');
      return true;
    }
    const solved = solveF1Chain(project, session);
    if (!solved) {
      stay(session, replaceSession, 'MULTIPLE_CURVES cannot fit that chain between the lines. Edit entries with U, then re-enter; the session stays active.');
      return true;
    }
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      session,
      {
        key: 'MULTIPLE_CURVES_CREATE',
        firstEntityId: session.firstEntityId!,
        firstPickPoint: { x: session.firstPickPoint!.x, y: session.firstPickPoint!.y },
        secondEntityId: session.secondEntityId!,
        secondPickPoint: { x: session.secondPickPoint!.x, y: session.secondPickPoint!.y },
        segments: session.segments.map((segment, index) => ({
          radius: segment.radius,
          length: segment.length,
          floating: index === session.floatingIndex,
        })),
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: 'Multiple Curves',
        summary: `Created ${session.count}-curve chain (floating ${session.floatingIndex + 1})`,
        rows: solved.result.rows.map((row) => ({
          label: `Curve ${row.index + 1}${row.floating ? ' (floating)' : ''}`,
          value: `R ${row.radius.toFixed(3)} m, L ${row.arcLength.toFixed(3)} m`,
        })),
      },
      'MULTIPLE_CURVES committed.',
    );
  }
  if (isBackstepToken(token)) {
    if (!backstepLinePair(session, replaceSession)) stay(session, replaceSession, 'MULTIPLE_CURVES has nothing to undo.');
    return true;
  }
  if (!session.firstEntityId || !session.secondEntityId) {
    stay(session, replaceSession, 'MULTIPLE_CURVES needs both line picks first. Click two line bodies.');
    return true;
  }
  if (session.count == null) {
    const count = parseCurveF1Count(token);
    if (count == null) {
      stay(session, replaceSession, 'MULTIPLE_CURVES count invalid. Type the curve count 2-10.');
      return true;
    }
    replaceSession({ ...session, count, inputValue: '', resultText: undefined });
    return true;
  }
  if (session.floatingIndex == null) {
    const floating = parseCurveF1Floating(token, session.count);
    if (floating == null) {
      stay(session, replaceSession, `MULTIPLE_CURVES floating index invalid. Type 1-${session.count} (F<n>); that curve's length is solved.`);
      return true;
    }
    replaceSession({ ...session, floatingIndex: floating, inputValue: '', resultText: undefined });
    return true;
  }
  if (session.segments.length >= session.count) {
    stay(session, replaceSession, 'MULTIPLE_CURVES chain entries are complete. Press Enter to commit or U to edit the last entry.');
    return true;
  }
  const segment = parseCurveF1ChainSegment(token);
  if (!segment) {
    stay(session, replaceSession, `MULTIPLE_CURVES entry invalid. Type curve ${session.segments.length + 1}/${session.count} as \`L120,R200\`.`);
    return true;
  }
  const segments = [...session.segments, segment];
  replaceSession({
    ...session,
    segments,
    inputValue: '',
    resultText: segments.length === session.count ? undefined : undefined,
  });
  return true;
};

const submitFromEnd = (options: CurveF1SubmitOptions, session: Extract<CommandSession, { key: 'CURVE_FROM_END' }>, token: string): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession, project } = options;
  const commitPoint = (endPoint: { x: number; y: number; label: string }): boolean => {
    const solved = solveF1FromEnd(project, { ...session, mode: 'point', endPoint }, null);
    if (!solved) {
      replaceSession({ ...session, mode: 'point', endPoint, inputValue: '', resultText: 'CURVE_FROM_END point mode has no tangent circle for that endpoint (collinear?). Re-pick; the session stays active.' });
      return true;
    }
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      { ...session, mode: 'point', endPoint },
      {
        key: 'CURVE_FROM_END_CREATE',
        sourceEntityId: session.sourceEntityId!,
        pickPoint: { x: session.pickPoint!.x, y: session.pickPoint!.y },
        endPoint: { x: endPoint.x, y: endPoint.y },
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: 'Curve From End (Point)',
        summary: `Created point-mode continuation from ${session.sourceEntityId}`,
        rows: [
          ...(solved.metrics ? metricRows(solved.metrics) : []),
          { label: 'Source', value: 'Unchanged' },
        ],
      },
      'CURVE_FROM_END committed.',
    );
  };
  const commitRadius = (extentMode: CadCurveF1ExtentMode, extentValue: number): boolean => {
    const solved = solveF1FromEnd(project, { ...session, mode: 'radius', extentMode, extentValue }, null);
    if (!solved || !solved.metrics) {
      replaceSession({ ...session, mode: 'radius', extentMode, extentValue, inputValue: '', resultText: 'CURVE_FROM_END radius mode cannot build that extent. Type another extent; the session stays active.' });
      return true;
    }
    const side = session.signedRadius! > 0 ? 'right (CW)' : 'left (CCW)';
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      { ...session, mode: 'radius', extentMode, extentValue },
      {
        key: 'CURVE_FROM_END_CREATE',
        sourceEntityId: session.sourceEntityId!,
        pickPoint: { x: session.pickPoint!.x, y: session.pickPoint!.y },
        signedRadius: session.signedRadius!,
        metric: { mode: extentMode, value: extentValue },
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: 'Curve From End (Radius)',
        summary: `Created radius-mode continuation from ${session.sourceEntityId}`,
        rows: [
          { label: 'Side', value: side },
          ...metricRows(solved.metrics),
          { label: 'Source', value: 'Unchanged' },
        ],
      },
      'CURVE_FROM_END committed.',
    );
  };
  if (token.length === 0) {
    if (!session.sourceEntityId || !session.pickPoint) {
      stay(session, replaceSession, 'CURVE_FROM_END needs a source pick first. Click a line-or-arc body near the end to continue from.');
      return true;
    }
    if (session.mode === 'point' && session.endPoint) return commitPoint(session.endPoint);
    if (session.mode === 'radius' && session.signedRadius != null && session.extentMode && session.extentValue != null) {
      return commitRadius(session.extentMode, session.extentValue);
    }
    stay(session, replaceSession, 'CURVE_FROM_END is incomplete. Type P (point mode) or R±radius (radius mode).');
    return true;
  }
  if (isBackstepToken(token)) {
    if (!backstepLinePair(session, replaceSession)) stay(session, replaceSession, 'CURVE_FROM_END has nothing to undo.');
    return true;
  }
  if (!session.sourceEntityId || !session.pickPoint) {
    const parsed = parseInputPoint(token, null);
    if (parsed) {
      stay(session, replaceSession, 'CURVE_FROM_END needs its source first. Click a line-or-arc body near the end to continue from.');
      return true;
    }
    stay(session, replaceSession, 'CURVE_FROM_END needs a source pick first. Click a line-or-arc body near the end to continue from.');
    return true;
  }
  const upper = token.trim().toUpperCase();
  if (!session.mode) {
    if (upper === 'P' || upper === 'POINT') {
      replaceSession({ ...session, mode: 'point', inputValue: '', resultText: undefined });
      return true;
    }
    const signed = parseCurveF1SignedRadius(token);
    if (signed != null) {
      replaceSession({ ...session, mode: 'radius', signedRadius: signed, inputValue: '', resultText: undefined });
      return true;
    }
    const parsed = parseInputPoint(token, null);
    if (parsed) return commitPoint(parsed);
    stay(session, replaceSession, 'CURVE_FROM_END choice invalid. Type P for point mode or R±radius for radius mode (R200 = right/CW, R-200 = left/CCW).');
    return true;
  }
  if (session.mode === 'point') {
    if (session.endPoint) {
      stay(session, replaceSession, 'CURVE_FROM_END holds its endpoint. Press Enter to commit or U to step back.');
      return true;
    }
    const parsed = parseInputPoint(token, null);
    if (!parsed) {
      stay(session, replaceSession, 'CURVE_FROM_END endpoint invalid. Click the endpoint or type `x,y`.');
      return true;
    }
    return commitPoint(parsed);
  }
  if (session.signedRadius == null) {
    const signed = parseCurveF1SignedRadius(token);
    if (signed == null) {
      stay(session, replaceSession, 'CURVE_FROM_END radius invalid. Type R200 (right/CW) or R-200 (left/CCW).');
      return true;
    }
    replaceSession({ ...session, signedRadius: signed, inputValue: '', resultText: undefined });
    return true;
  }
  const extent = parseCurveF1ExtentToken(token);
  if (!extent) {
    stay(session, replaceSession, 'CURVE_FROM_END extent invalid. Use T50, C100, D30 (delta), L150, E5, or M2.');
    return true;
  }
  if (extent.kind === 'delta') {
    const value = Math.abs(session.signedRadius) * ((extent.deltaDeg * Math.PI) / 180);
    return commitRadius('arc', value);
  }
  return commitRadius(extent.mode, extent.value);
};

const submitReverseCompound = (
  options: CurveF1SubmitOptions,
  session: Extract<CommandSession, { key: 'REVERSE_OR_COMPOUND' }>,
  token: string,
): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession, project } = options;
  const commitMetric = (extentMode: CadCurveF1ExtentMode, extentValue: number): boolean => {
    const solved = solveF1ReverseCompound(project, { ...session, extentMode, extentValue }, null);
    if (!solved || !solved.metrics) {
      replaceSession({ ...session, extentMode, extentValue, inputValue: '', resultText: `REVERSE_OR_COMPOUND ${session.rcMode} cannot build that extent. Type another extent; the session stays active.` });
      return true;
    }
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      { ...session, extentMode, extentValue },
      {
        key: 'REVERSE_COMPOUND_CURVE_CREATE',
        sourceEntityId: session.sourceEntityId!,
        mode: session.rcMode!,
        end: session.end!,
        radius: session.radius!,
        extent: { mode: extentMode, value: extentValue },
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: session.rcMode === 'reverse' ? 'Reverse Curve' : 'Compound Curve',
        summary: `Created ${session.rcMode} continuation from ${session.sourceEntityId}`,
        rows: [
          { label: 'End', value: session.end! },
          ...metricRows(solved.metrics),
          { label: 'Source', value: 'Unchanged' },
        ],
      },
      'REVERSE_OR_COMPOUND committed.',
    );
  };
  const commitPointEnd = (pointEnd: { x: number; y: number; label: string }): boolean => {
    const solved = solveF1ReverseCompound(project, { ...session, pointEnd }, null);
    if (!solved) {
      replaceSession({ ...session, pointEnd, inputValue: '', resultText: `REVERSE_OR_COMPOUND ${session.rcMode} has no tangent circle for that endpoint. Re-pick; the session stays active.` });
      return true;
    }
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      { ...session, pointEnd },
      {
        key: 'REVERSE_COMPOUND_CURVE_CREATE',
        sourceEntityId: session.sourceEntityId!,
        mode: session.rcMode!,
        end: session.end!,
        radius: session.radius!,
        extent: session.extentMode && session.extentValue != null
          ? { mode: session.extentMode, value: session.extentValue }
          : { mode: 'arc' as const, value: 1 },
        pointEnd: { x: pointEnd.x, y: pointEnd.y },
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: session.rcMode === 'reverse' ? 'Reverse Curve' : 'Compound Curve',
        summary: `Created ${session.rcMode} point-mode continuation from ${session.sourceEntityId}`,
        rows: [
          { label: 'End', value: session.end! },
          ...(solved.metrics ? metricRows(solved.metrics) : []),
          { label: 'Source', value: 'Unchanged' },
        ],
      },
      'REVERSE_OR_COMPOUND committed.',
    );
  };
  if (token.length === 0) {
    if (!session.sourceEntityId) {
      stay(session, replaceSession, 'REVERSE_OR_COMPOUND needs a source arc pick first. Click an arc body near the endpoint.');
      return true;
    }
    if (!session.rcMode) {
      stay(session, replaceSession, 'REVERSE_OR_COMPOUND needs R (reverse, opposite turn) or C (compound, same turn).');
      return true;
    }
    if (session.radius == null) {
      stay(session, replaceSession, 'REVERSE_OR_COMPOUND needs the new radius (R200, 200, or DEG1.5).');
      return true;
    }
    if (session.pointEnd) return commitPointEnd(session.pointEnd);
    if (session.extentMode && session.extentValue != null) return commitMetric(session.extentMode, session.extentValue);
    stay(session, replaceSession, 'REVERSE_OR_COMPOUND needs one extent (T50, C100, D30, L150, E5, M2) or a clicked endpoint.');
    return true;
  }
  if (isBackstepToken(token)) {
    if (!backstepLinePair(session, replaceSession)) stay(session, replaceSession, 'REVERSE_OR_COMPOUND has nothing to undo.');
    return true;
  }
  if (!session.sourceEntityId) {
    stay(session, replaceSession, 'REVERSE_OR_COMPOUND needs a source arc pick first. Click an arc body near the endpoint.');
    return true;
  }
  const upper = token.trim().toUpperCase();
  if (!session.rcMode) {
    if (upper === 'R' || upper === 'REVERSE') {
      replaceSession({ ...session, rcMode: 'reverse', inputValue: '', resultText: undefined });
      return true;
    }
    if (upper === 'C' || upper === 'COMPOUND') {
      replaceSession({ ...session, rcMode: 'compound', inputValue: '', resultText: undefined });
      return true;
    }
    stay(session, replaceSession, 'REVERSE_OR_COMPOUND choice invalid. Type R for reverse (opposite turn) or C for compound (same turn).');
    return true;
  }
  if (session.radius == null) {
    if (upper === 'P' || upper === 'POINT') {
      stay(session, replaceSession, 'REVERSE_OR_COMPOUND point mode still needs the new radius first. Type R200 (or 200, DEG1.5), then click the endpoint.');
      return true;
    }
    const degreeRadius = parseCurveF1DegreeRadius(token);
    if (degreeRadius != null) {
      replaceSession({ ...session, radius: degreeRadius, inputValue: '', resultText: undefined });
      return true;
    }
    const radius = parseCurveF1SignedRadius(token);
    const positive = token.trim().length > 0 && Number(token.trim()) > 0 ? Number(token.trim()) : null;
    const next = radius != null ? Math.abs(radius) : positive;
    if (next == null || !Number.isFinite(next) || next <= 0) {
      stay(session, replaceSession, 'REVERSE_OR_COMPOUND radius invalid. Type R200 (or a positive number), or DEG1.5 for degree-of-curve.');
      return true;
    }
    replaceSession({ ...session, radius: next, inputValue: '', resultText: undefined });
    return true;
  }
  if (session.pointEnd) {
    stay(session, replaceSession, 'REVERSE_OR_COMPOUND holds its endpoint. Press Enter to commit or U to step back.');
    return true;
  }
  const extent = parseCurveF1ExtentToken(token);
  if (!extent) {
    const parsed = parseInputPoint(token, null);
    if (parsed) return commitPointEnd(parsed);
    stay(session, replaceSession, 'REVERSE_OR_COMPOUND extent invalid. Use T50, C100, D30 (delta), L150, E5, M2 — or click/type the endpoint for point mode.');
    return true;
  }
  if (extent.kind === 'delta') {
    return commitMetric('arc', session.radius * ((extent.deltaDeg * Math.PI) / 180));
  }
  return commitMetric(extent.mode, extent.value);
};

export const handleSurveyCadCurveF1Submit = (options: CurveF1SubmitOptions): boolean => {
  const { session } = options;
  if (!isCurveF1Session(session)) return false;
  const token = session.inputValue.trim();
  switch (session.key) {
    case 'CURVE_BETWEEN_TWO_LINES':
    case 'CURVE_ON_TWO_LINES':
      return submitLinePairMetric(options, session, token);
    case 'CURVE_THROUGH_POINT':
      return submitThroughPoint(options, session, token);
    case 'MULTIPLE_CURVES':
      return submitMultiple(options, session, token);
    case 'CURVE_FROM_END':
      return submitFromEnd(options, session, token);
    case 'REVERSE_OR_COMPOUND':
      return submitReverseCompound(options, session, token);
  }
};
