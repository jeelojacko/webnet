import {
  buildCircleCenterDiameterScalar,
  buildCircleCenterRadiusScalar,
  MAX_SHAPE_POLYGON_SIDES,
  MIN_SHAPE_POLYGON_SIDES,
  type RegularPolygonMode,
} from '../../engine/cad/cadGeometryShapeBuilders';
import { solveCadCircleTangentTangentRadius } from '../../engine/cad/cadGeometryCircleTangentSolvers';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import { parseInputPoint } from './useSurveyCadCommandPointParsing';
import type { HandleSurveyCadTypedSubmitOptions } from './useSurveyCadTypedSubmit.types';

const parsePolygonSides = (rawInput: string): number | null => {
  const trimmed = rawInput.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const sides = Number(trimmed);
  if (
    !Number.isInteger(sides) ||
    sides < MIN_SHAPE_POLYGON_SIDES ||
    sides > MAX_SHAPE_POLYGON_SIDES
  ) {
    return null;
  }
  return sides;
};

const parsePolygonMode = (rawInput: string): RegularPolygonMode | null => {
  const normalized = rawInput.trim().toUpperCase();
  if (normalized === '' || normalized === 'I' || normalized === 'INSCRIBED') return 'inscribed';
  if (normalized === 'C' || normalized === 'CIRCUMSCRIBED') return 'circumscribed';
  return null;
};

export const handleSurveyCadShapeSubmit = ({
  applyHistoryUpdate,
  consumePoint,
  replaceSession,
  session,
}: Pick<
  HandleSurveyCadTypedSubmitOptions,
  'applyHistoryUpdate' | 'consumePoint' | 'replaceSession' | 'session'
>): boolean => {
  if (session.key === 'RECTANGLE') {
    const parsed = parseInputPoint(session.inputValue, session.firstCorner);
    if (!parsed) {
      replaceSession({
        ...session,
        resultText: session.firstCorner
          ? 'RECTANGLE corner invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.'
          : 'RECTANGLE corner invalid. Use `x,y` or `LABEL=x,y`.',
      });
      return true;
    }
    consumePoint(parsed);
    return true;
  }
  if (session.key === 'CIRCLE' || session.key === 'CIRCLECD') {
    const isDiameter = session.key === 'CIRCLECD';
    const noun = isDiameter ? 'diameter' : 'radius';
    if (!session.center) {
      const parsed = parseInputPoint(session.inputValue, null);
      if (!parsed) {
        replaceSession({
          ...session,
          resultText: `${session.key} center invalid. Use \`x,y\` or \`LABEL=x,y\`.`,
        });
        return true;
      }
      consumePoint(parsed);
      return true;
    }
    const center = session.center;
    const scalar = Number(session.inputValue.trim());
    if (session.inputValue.trim() !== '' && Number.isFinite(scalar) && scalar > 0) {
      const built = isDiameter
        ? buildCircleCenterDiameterScalar(center, scalar)
        : buildCircleCenterRadiusScalar(center, scalar);
      if (!built) {
        replaceSession({
          ...session,
          inputValue: '',
          resultText: `${session.key} ${noun} degenerate. Enter a positive finite ${noun}.`,
        });
        return true;
      }
      applyHistoryUpdate((existing) =>
        isDiameter
          ? runCadCommand(existing, { key: 'CIRCLECD', center, diameter: scalar })
          : runCadCommand(existing, { key: 'CIRCLE', center, radius: scalar }),
      );
      replaceSession(null);
      return true;
    }
    const parsed = parseInputPoint(session.inputValue, session.center);
    if (!parsed) {
      replaceSession({
        ...session,
        resultText: `${session.key} ${noun} invalid. Enter a positive ${noun} or a point (\`x,y\`, \`LABEL=x,y\`, \`@azimuth,distance\`).`,
      });
      return true;
    }
    consumePoint(parsed);
    return true;
  }
  if (session.key === 'CIRCLE2P' || session.key === 'CIRCLE3P') {
    const basePoint =
      session.key === 'CIRCLE2P'
        ? session.first
        : session.points[session.points.length - 1] ?? null;
    const parsed = parseInputPoint(session.inputValue, basePoint);
    if (!parsed) {
      replaceSession({
        ...session,
        resultText: `${session.key} point invalid. Use \`x,y\`, \`LABEL=x,y\`, \`@azimuth,distance\`, or survey bearing-distance.`,
      });
      return true;
    }
    consumePoint(parsed);
    return true;
  }
  if (session.key === 'CIRCLETTR') {
    if (!session.first || !session.second) {
      replaceSession({
        ...session,
        inputValue: '',
        resultText: 'CIRCLETTR needs two tangent object picks (line, polyline, arc, or circle) before the radius.',
      });
      return true;
    }
    const radius = Number(session.inputValue.trim());
    if (!Number.isFinite(radius) || radius <= 0) {
      replaceSession({
        ...session,
        inputValue: '',
        resultText: 'CIRCLETTR radius invalid. Enter a positive radius after two tangent picks.',
      });
      return true;
    }
    const solved = solveCadCircleTangentTangentRadius(session.first, session.second, radius);
    if (solved.status !== 'SOLVED') {
      replaceSession({
        ...session,
        inputValue: '',
        resultText:
          solved.status === 'AMBIGUOUS'
            ? 'CIRCLETTR is ambiguous for those picks. Pick a different tangent or radius.'
            : 'CIRCLETTR found no tangent circle for that radius. Pick a different tangent or radius.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'CIRCLETTR',
        first: session.first!,
        second: session.second!,
        radius,
      }),
    );
    replaceSession(null);
    return true;
  }
  if (session.key === 'CIRCLETTT') {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: 'CIRCLETTT accepts three tangent object picks. Click a line, polyline, arc, or circle.',
    });
    return true;
  }
  if (session.key !== 'POLYGON') return false;
  if (session.phase === 'sides') {
    const sides = parsePolygonSides(session.inputValue);
    if (sides == null) {
      replaceSession({
        ...session,
        resultText: `POLYGON sides invalid. Enter an integer ${MIN_SHAPE_POLYGON_SIDES}-${MAX_SHAPE_POLYGON_SIDES}.`,
      });
      return true;
    }
    replaceSession({
      ...session,
      sides,
      phase: 'mode',
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  if (session.phase === 'mode') {
    const mode = parsePolygonMode(session.inputValue);
    if (!mode) {
      replaceSession({
        ...session,
        resultText: 'POLYGON mode invalid. Enter `I` for Inscribed or `C` for Circumscribed (empty = Inscribed).',
      });
      return true;
    }
    replaceSession({
      ...session,
      mode,
      phase: 'center',
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  const parsed = parseInputPoint(session.inputValue, session.center);
  if (!parsed) {
    replaceSession({
      ...session,
      resultText:
        session.phase === 'radius' && session.center
          ? 'POLYGON radius point invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100` from the center.'
          : 'POLYGON center invalid. Use `x,y` or `LABEL=x,y`.',
    });
    return true;
  }
  consumePoint(parsed);
  return true;
};
