import { cloneSurveyCadPersistedState } from './cad/cadPersistence';
import { clonePlanningMapState } from './planningMapState';
import type { SurveyCadPersistedState } from './cad/cadTypes';
import type { PlanningMapState } from '../types';

export interface SurveyCadSidecarFile {
  kind: 'webnet-survey-cad';
  schemaVersion: 1;
  exportedAt: string;
  surveyCad: SurveyCadPersistedState;
}

export const clonePlanningMapStateForProjectExport = (
  state: PlanningMapState,
): PlanningMapState => ({
  ...clonePlanningMapState(state),
  obstaclePolygons: [],
});

export const buildSurveyCadSidecarText = (
  surveyCad: SurveyCadPersistedState,
  exportedAt = new Date().toISOString(),
): string =>
  JSON.stringify(
    {
      kind: 'webnet-survey-cad',
      schemaVersion: 1,
      exportedAt,
      surveyCad: cloneSurveyCadPersistedState(surveyCad),
    } satisfies SurveyCadSidecarFile,
    null,
    2,
  );
