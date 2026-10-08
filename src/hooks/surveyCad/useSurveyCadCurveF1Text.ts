import type { CommandSession } from './useSurveyCadCommandTypes';
import type { CurveF1Session } from './useSurveyCadCurveF1Session';
import { pickLabelOf } from './useSurveyCadCurveF1Session';

const lineName = (id: string | null): string => id ?? '?';

const linePairStage = (session: {
  firstEntityId: string | null;
  secondEntityId: string | null;
}): string | null => {
  if (!session.firstEntityId) return 'first';
  if (!session.secondEntityId) return 'second';
  return null;
};

export const promptForCurveF1Session = (session: CurveF1Session): string => {
  if (session.resultText) return session.resultText;
  switch (session.key) {
    case 'CURVE_BETWEEN_TWO_LINES':
    case 'CURVE_ON_TWO_LINES': {
      const stage = linePairStage(session);
      if (stage === 'first') return `${session.key} active. Click the first line body.`;
      if (stage === 'second') {
        return `${session.key} active. First line ${lineName(session.firstEntityId)} captured. Click the second line body.`;
      }
      const verb = session.key === 'CURVE_BETWEEN_TWO_LINES' ? 'trim both lines to PC/PT' : 'leave both lines unchanged';
      return `${session.key} active. Lines ${lineName(session.firstEntityId)} + ${lineName(session.secondEntityId)} captured (${verb}). Type the metric (R200, T50, C100, L150, E5, M2, D1.5 for degree) and press Enter. [U undoes one step]`;
    }
    case 'CURVE_THROUGH_POINT': {
      const stage = linePairStage(session);
      if (stage === 'first') return 'CURVE_THROUGH_POINT active. Click the first line body.';
      if (stage === 'second') {
        return `CURVE_THROUGH_POINT active. First line ${lineName(session.firstEntityId)} captured. Click the second line body.`;
      }
      if (!session.throughPoint) {
        return `CURVE_THROUGH_POINT active. Lines ${lineName(session.firstEntityId)} + ${lineName(session.secondEntityId)} captured. Click the point the curve must pass through.`;
      }
      return `CURVE_THROUGH_POINT active. Through-point ${pickLabelOf(session.throughPoint)} captured. Press Enter to commit (trims both lines), type L/R to choose a side, or U to step back.`;
    }
    case 'MULTIPLE_CURVES': {
      const stage = linePairStage(session);
      if (stage === 'first') return 'MULTIPLE_CURVES active. Click the first line body.';
      if (stage === 'second') {
        return `MULTIPLE_CURVES active. First line ${lineName(session.firstEntityId)} captured. Click the second line body.`;
      }
      if (session.count == null) return 'MULTIPLE_CURVES active. Type the curve count (2-10) and press Enter.';
      if (session.floatingIndex == null) {
        return `MULTIPLE_CURVES active. ${session.count} curves. Type the floating curve number (1-${session.count}, F<n>) and press Enter.`;
      }
      const next = session.segments.length + 1;
      if (session.segments.length < session.count) {
        const floating = next - 1 === session.floatingIndex ? ' (FLOATING: radius only, length solved)' : '';
        return `MULTIPLE_CURVES active. Enter curve ${next}/${session.count}${floating} as \`L120,R200\`. [U steps back one entry]`;
      }
      return `MULTIPLE_CURVES active. Chain of ${session.count} complete in preview. Press Enter to commit, or U to step back.`;
    }
    case 'CURVE_FROM_END': {
      if (!session.sourceEntityId) return 'CURVE_FROM_END active. Click a line or arc body near the end to continue from.';
      if (!session.mode) {
        return `CURVE_FROM_END active. Source ${lineName(session.sourceEntityId)} captured near its ${session.end ?? '?'} end. Type P for point mode (then click the endpoint), or R±radius for radius mode (R200 = right/CW, R-200 = left/CCW).`;
      }
      if (session.mode === 'point') {
        return session.endPoint
          ? `CURVE_FROM_END active. Endpoint ${pickLabelOf(session.endPoint)} captured. Press Enter to commit, or U to step back.`
          : 'CURVE_FROM_END active (point mode). Click the curve endpoint, or type it as `x,y`.';
      }
      if (session.signedRadius == null) {
        return 'CURVE_FROM_END active (radius mode). Type the signed radius: R200 = right/CW, R-200 = left/CCW.';
      }
      return `CURVE_FROM_END active. Radius ${session.signedRadius} captured. Type the extent (T50, C100, D30 for delta, L150, E5, M2) and press Enter. [U steps back]`;
    }
    case 'REVERSE_OR_COMPOUND': {
      if (!session.sourceEntityId) return 'REVERSE_OR_COMPOUND active. Click an arc body near the end to continue from.';
      if (!session.rcMode) {
        return `REVERSE_OR_COMPOUND active. Source arc ${lineName(session.sourceEntityId)} captured at its ${session.end ?? '?'} end. Type R for reverse (opposite turn) or C for compound (same turn).`;
      }
      if (session.radius == null) {
        return `REVERSE_OR_COMPOUND active (${session.rcMode}). Type the new radius (R200 or 200), DEG1.5 for degree-of-curve, then the extent — or click the endpoint for point mode after the radius.`;
      }
      return session.pointEnd
        ? `REVERSE_OR_COMPOUND active. Endpoint ${pickLabelOf(session.pointEnd)} captured. Press Enter to commit, or U to step back.`
        : `REVERSE_OR_COMPOUND active (${session.rcMode}, R ${session.radius}). Type the extent (T50, C100, D30 for delta, L150, E5, M2), or click the endpoint for point mode. [U steps back]`;
    }
  }
};

export const helpForCurveF1Session = (session: CurveF1Session): string => {
  switch (session.key) {
    case 'CURVE_BETWEEN_TWO_LINES':
      return 'CURVE_BETWEEN_TWO_LINES: click two line bodies (the click point selects the retained ray side), then type one metric — R (radius), T (tangent), C (chord), L (arc length), E (external), M (mid-ordinate), D (degree-of-curve). Commits one tangent arc and trims both lines to PC/PT in a single undo entry. U steps back one stage. Esc cancels with no changes.';
    case 'CURVE_ON_TWO_LINES':
      return 'CURVE_ON_TWO_LINES: identical arc geometry to Between (same clicks, same metric letters), but the source lines are left byte-unchanged. One undo entry. U steps back one stage. Esc cancels with no changes.';
    case 'CURVE_THROUGH_POINT':
      return 'CURVE_THROUGH_POINT: click two line bodies, then click the pass-through point. A unique tangent circle commits on Enter and trims both lines; no solution stays active with a message; multiple candidates require an explicit L/R side (never array order). U steps back one stage. Esc cancels with no changes.';
    case 'MULTIPLE_CURVES':
      return 'MULTIPLE_CURVES: click two line bodies, type the count (2-10), the floating curve number (its length is solved), then one `Llength,Rradius` entry per curve in order. The full chain previews before Enter commits all arcs in one undo entry; sources stay unchanged. U removes one entry at a time. Esc cancels with no changes.';
    case 'CURVE_FROM_END':
      return 'CURVE_FROM_END: click a line-or-arc body (nearest end wins; arcs continue forward from the picked end). Point mode (P, then click/type the endpoint) builds the tangent circle through both points; radius mode (signed R: positive = right/CW, negative = left) takes one extent metric T/C/D(delta)/L/E/M. The source is never modified. U steps back. Esc cancels with no changes.';
    case 'REVERSE_OR_COMPOUND': {
      const base =
        'REVERSE_OR_COMPOUND: click an arc body near the endpoint to continue from (G1 join, endpoint exact). R continues with the opposite turn (reverse), C with the same turn (compound).';
      return `${base} Type the new radius (or DEG for degree-of-curve), then one extent metric T/C/D(delta)/L/E/M — or click the endpoint for point mode. The source arc is never modified. U steps back. Esc cancels with no changes.`;
    }
  }
}

export const promptForLegacyArcPickSession = (
  session: Extract<CommandSession, { key: 'RADIAL_BEARING' | 'POINT_ON_CURVE' | 'SUBDIVIDE_CURVE' | 'OFFSET_CURVE' | 'REVERSE_CURVE' | 'COMPOUND_CURVE' }>,
  basePrompt: string,
): string => {
  if (session.resultText) return session.resultText;
  if (!session.arc) return `${session.key} active. Click an arc body to select the curve.`;
  return basePrompt;
};
