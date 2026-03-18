import type { StationMap } from '../types';
import type {
  ControlConstraintSummary,
  CoordinateConstraintEquation,
  CoordinateConstraintRowPlacement,
  SolveParameterIndex,
} from './adjustmentSolveTypes';

export const buildCoordinateConstraints = (
  stations: StationMap,
  paramIndex: SolveParameterIndex,
  is2D: boolean,
): CoordinateConstraintEquation[] => {
  const constraints: CoordinateConstraintEquation[] = [];
  Object.entries(paramIndex).forEach(([stationId, idx]) => {
    const st = stations[stationId];
    if (!st) return;
    const hasCorrelatedXY =
      idx.x != null &&
      idx.y != null &&
      st.sx != null &&
      st.sy != null &&
      st.constraintX != null &&
      st.constraintY != null &&
      Number.isFinite(st.sx) &&
      Number.isFinite(st.sy) &&
      st.sx > 0 &&
      st.sy > 0 &&
      Number.isFinite(st.constraintCorrXY ?? Number.NaN) &&
      Math.abs(st.constraintCorrXY ?? 0) > 1e-12;
    const correlationKey = hasCorrelatedXY ? `CTRLXY:${stationId}` : undefined;
    const corrXY = hasCorrelatedXY
      ? Math.max(-0.999, Math.min(0.999, st.constraintCorrXY ?? 0))
      : undefined;
    if (
      idx.x != null &&
      st.sx != null &&
      st.constraintX != null &&
      Number.isFinite(st.sx) &&
      st.sx > 0
    ) {
      constraints.push({
        stationId,
        component: 'x',
        index: idx.x,
        target: st.constraintX,
        sigma: st.sx,
        correlationKey,
        corrXY,
      });
    }
    if (
      idx.y != null &&
      st.sy != null &&
      st.constraintY != null &&
      Number.isFinite(st.sy) &&
      st.sy > 0
    ) {
      constraints.push({
        stationId,
        component: 'y',
        index: idx.y,
        target: st.constraintY,
        sigma: st.sy,
        correlationKey,
        corrXY,
      });
    }
    if (
      !is2D &&
      idx.h != null &&
      st.sh != null &&
      st.constraintH != null &&
      Number.isFinite(st.sh) &&
      st.sh > 0
    ) {
      constraints.push({
        stationId,
        component: 'h',
        index: idx.h,
        target: st.constraintH,
        sigma: st.sh,
      });
    }
  });
  return constraints;
};

export const summarizeCoordinateConstraints = (
  constraints: CoordinateConstraintEquation[],
): ControlConstraintSummary => {
  const x = constraints.filter((constraint) => constraint.component === 'x').length;
  const y = constraints.filter((constraint) => constraint.component === 'y').length;
  const h = constraints.filter((constraint) => constraint.component === 'h').length;
  const xyCorrelated = new Set(
    constraints
      .map((constraint) => constraint.correlationKey)
      .filter((key): key is string => !!key),
  ).size;
  return { count: constraints.length, x, y, h, xyCorrelated };
};

export const applyCoordinateConstraintCorrelationWeights = (
  P: number[][],
  placements: CoordinateConstraintRowPlacement[],
): void => {
  const groups = new Map<
    string,
    {
      corrXY: number;
      x?: CoordinateConstraintRowPlacement;
      y?: CoordinateConstraintRowPlacement;
    }
  >();
  placements.forEach((placement) => {
    const key = placement.constraint.correlationKey;
    if (!key) return;
    const corrXY = placement.constraint.corrXY;
    if (!Number.isFinite(corrXY ?? Number.NaN)) return;
    const group = groups.get(key) ?? { corrXY: corrXY as number };
    if (placement.constraint.component === 'x') group.x = placement;
    if (placement.constraint.component === 'y') group.y = placement;
    groups.set(key, group);
  });

  groups.forEach((group) => {
    if (!group.x || !group.y) return;
    const sigmaX = group.x.constraint.sigma;
    const sigmaY = group.y.constraint.sigma;
    const corr = Math.max(-0.999, Math.min(0.999, group.corrXY));
    const denom = 1 - corr * corr;
    if (!Number.isFinite(denom) || denom <= 1e-9) return;
    const rowX = group.x.row;
    const rowY = group.y.row;
    const wXX = 1 / (sigmaX * sigmaX * denom);
    const wYY = 1 / (sigmaY * sigmaY * denom);
    const wXY = -corr / (sigmaX * sigmaY * denom);
    P[rowX][rowX] = wXX;
    P[rowY][rowY] = wYY;
    P[rowX][rowY] = wXY;
    P[rowY][rowX] = wXY;
  });
};

export const coordinateConstraintWeightedSum = (
  stations: StationMap,
  constraints: CoordinateConstraintEquation[],
): number => {
  let total = 0;
  const grouped = new Map<
    string,
    {
      corrXY: number;
      x?: CoordinateConstraintEquation;
      y?: CoordinateConstraintEquation;
    }
  >();

  constraints.forEach((constraint) => {
    const key = constraint.correlationKey;
    if (!key) {
      const st = stations[constraint.stationId];
      if (!st) return;
      const current =
        constraint.component === 'x' ? st.x : constraint.component === 'y' ? st.y : st.h;
      const v = constraint.target - current;
      total += (v * v) / (constraint.sigma * constraint.sigma);
      return;
    }
    const corrXY = constraint.corrXY;
    if (!Number.isFinite(corrXY ?? Number.NaN)) return;
    const group = grouped.get(key) ?? { corrXY: corrXY as number };
    if (constraint.component === 'x') group.x = constraint;
    if (constraint.component === 'y') group.y = constraint;
    grouped.set(key, group);
  });

  grouped.forEach((group) => {
    if (!group.x || !group.y) return;
    const st = stations[group.x.stationId];
    if (!st) return;
    const vX = group.x.target - st.x;
    const vY = group.y.target - st.y;
    const corr = Math.max(-0.999, Math.min(0.999, group.corrXY));
    const denom = 1 - corr * corr;
    if (!Number.isFinite(denom) || denom <= 1e-9) return;
    total +=
      (vX * vX) / (group.x.sigma * group.x.sigma * denom) +
      (vY * vY) / (group.y.sigma * group.y.sigma * denom) -
      (2 * corr * vX * vY) / (group.x.sigma * group.y.sigma * denom);
  });

  return total;
};
