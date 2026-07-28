import { DEG_TO_RAD } from './angles';
import type { AdjustmentSolveWorkflowContext } from './adjustSolveWorkflowSettings';
import type { Observation } from '../types';

export const applySolveWorkflowObservationOverrides = (
  ctx: AdjustmentSolveWorkflowContext,
): void => {
  if (!ctx.overrides) return;

  ctx.observations.forEach((obs: Observation) => {
    const over = ctx.overrides?.[obs.id];
    if (!over) return;
    if (over.stdDev != null) {
      obs.stdDev = over.stdDev;
      if (obs.type === 'gps') {
        obs.stdDevE = over.stdDev;
        obs.stdDevN = over.stdDev;
        obs.corrEN = 0;
      }
    }
    if (over.obs == null) return;
    if (
      (obs.type === 'angle' ||
        obs.type === 'direction' ||
        obs.type === 'bearing' ||
        obs.type === 'dir' ||
        obs.type === 'zenith') &&
      typeof over.obs === 'number'
    ) {
      obs.obs = (over.obs as number) * DEG_TO_RAD;
    } else if ((obs.type === 'dist' || obs.type === 'lev') && typeof over.obs === 'number') {
      obs.obs = over.obs as number;
    } else if (obs.type === 'gps' && typeof over.obs === 'object') {
      const val = over.obs as { dE: number; dN: number };
      obs.obs = { dE: val.dE, dN: val.dN };
    }
  });
};
