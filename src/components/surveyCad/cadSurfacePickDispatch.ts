/**
 * STRUCT-194.6 — pure surface-pick dispatcher.
 *
 * Extracted verbatim from the long inline `onSurfacePickPoint` callback in
 * `SurveyCadWorkspace`. `createCadSurfacePickDispatch` is a plain factory (no
 * React hooks, no global registry, no render-time side effects) that returns
 * the pick handler bound to the current render's session callbacks, pick
 * state, inquiry closures, and setters.
 *
 * Preserved EXACT eight-stage short-circuit precedence:
 *   1. surface point edit session consumes the pick,
 *   2. surface bulk selection consumes the pick,
 *   3. surface bulk edit session consumes the pick,
 *   4. surface topology edit session consumes the pick,
 *   5. block INSERT pick (one undo per applied non-repeat pick; a rejected or
 *      repeat pick stays armed),
 *   6. analysis pick (answer only when non-null; ALWAYS clears the pick),
 *   7. volume pick (same),
 *   8. surface elevation / slope pick (sets the last inquiry only on a hit;
 *      ALWAYS clears the pick).
 * Each earlier branch returns immediately; an idle pointer with no armed mode
 * is a no-op. The pick point is world coordinates.
 */
import type { Dispatch, SetStateAction } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { CadBlockUiOp } from '../../cad-app/blocks/cadBlockUiCommands';
import { querySurfaceElevationText, querySurfaceSlopeText, type CadSurfaceInquiry } from '../../cad-app/shell/cadSurfaceSnapshot';

export type CadSurfacePickPoint = { x: number; y: number };

/** Minimal session shape: only the active flag and the pick sink are read. */
export interface CadSurfacePickSession {
  session: unknown;
  handlePick: (_point: CadSurfacePickPoint) => void;
}

export interface CadSurfacePickEditSessions {
  pointEdit: CadSurfacePickSession;
  bulkSelection: CadSurfacePickSession;
  bulkEdit: CadSurfacePickSession;
  edit: CadSurfacePickSession;
}

export interface CadSurfacePickBlockInsertState {
  definitionId: string;
  scale: number;
  rotationDeg: number;
  repeat: boolean;
}

export interface CadSurfacePickPicks {
  blockInsertPick: CadSurfacePickBlockInsertState | null;
  analysisPick: { analysisId: string } | null;
  volumePick: { volumeId: string } | null;
  surfacePick: { surfaceId: string; mode: 'elevation' | 'slope' } | null;
}

export interface CadSurfacePickSetters {
  setBlockInsertPick: Dispatch<SetStateAction<CadSurfacePickBlockInsertState | null>>;
  setAnalysisPickAnswer: Dispatch<SetStateAction<{ analysisId: string; text: string } | null>>;
  setAnalysisPick: Dispatch<SetStateAction<{ analysisId: string } | null>>;
  setVolumePickAnswer: Dispatch<SetStateAction<{ volumeId: string; text: string } | null>>;
  setVolumePick: Dispatch<SetStateAction<{ volumeId: string } | null>>;
  setLastSurfaceInquiry: Dispatch<SetStateAction<CadSurfaceInquiry | null>>;
  setSurfacePick: Dispatch<SetStateAction<{ surfaceId: string; mode: 'elevation' | 'slope' } | null>>;
}

export interface CadSurfacePickContext {
  editSessions: CadSurfacePickEditSessions;
  picks: CadSurfacePickPicks;
  project: CadProject;
  surfaceCache: CadSurfaceCache;
  inquiries: {
    describeAnalysisAt: (_analysisId: string, _x: number, _y: number) => string | null;
    describeVolumeDifference: (_volumeId: string, _x: number, _y: number) => string | null;
  };
  runBlockOp: (_op: CadBlockUiOp) => { applied: boolean; reason?: string };
  setters: CadSurfacePickSetters;
}

/** Build the pick handler over the explicit render context. */
export const createCadSurfacePickDispatch = (
  context: CadSurfacePickContext,
): ((_worldPoint: CadSurfacePickPoint) => void) => {
  const { editSessions, picks, project, surfaceCache, inquiries, runBlockOp, setters } = context;
  return (worldPoint) => {
    if (editSessions.pointEdit.session) {
      editSessions.pointEdit.handlePick(worldPoint);
      return;
    }
    if (editSessions.bulkSelection.session) {
      editSessions.bulkSelection.handlePick(worldPoint);
      return;
    }
    if (editSessions.bulkEdit.session) {
      editSessions.bulkEdit.handlePick(worldPoint);
      return;
    }
    if (editSessions.edit.session) {
      editSessions.edit.handlePick(worldPoint);
      return;
    }
    if (picks.blockInsertPick) {
      const outcome = runBlockOp({
        kind: 'insert',
        definitionId: picks.blockInsertPick.definitionId,
        x: worldPoint.x,
        y: worldPoint.y,
        rotationDeg: picks.blockInsertPick.rotationDeg,
        scale: picks.blockInsertPick.scale,
      });
      // Repeat loop: stay armed for the next point; a rejected insert also
      // stays armed (user adjusts scale/rotation). Esc (or Cancel) ends it.
      if (outcome.applied && !picks.blockInsertPick.repeat) setters.setBlockInsertPick(null);
      return;
    }
    if (picks.analysisPick) {
      const text = inquiries.describeAnalysisAt(picks.analysisPick.analysisId, worldPoint.x, worldPoint.y);
      if (text != null) {
        setters.setAnalysisPickAnswer({ analysisId: picks.analysisPick.analysisId, text });
      }
      setters.setAnalysisPick(null);
      return;
    }
    if (picks.volumePick) {
      const text = inquiries.describeVolumeDifference(picks.volumePick.volumeId, worldPoint.x, worldPoint.y);
      if (text != null) {
        setters.setVolumePickAnswer({ volumeId: picks.volumePick.volumeId, text });
      }
      setters.setVolumePick(null);
      return;
    }
    if (!picks.surfacePick) return;
    const surfacePick = picks.surfacePick;
    const text = surfacePick.mode === 'slope'
      ? querySurfaceSlopeText(project, surfaceCache, surfacePick.surfaceId, worldPoint.x, worldPoint.y)
      : querySurfaceElevationText(project, surfaceCache, surfacePick.surfaceId, worldPoint.x, worldPoint.y);
    if (text != null) {
      const surface = project.surfaces?.find((entry) => entry.id === surfacePick.surfaceId);
      setters.setLastSurfaceInquiry({
        surfaceId: surfacePick.surfaceId,
        surfaceName: surface?.name ?? surfacePick.surfaceId,
        x: worldPoint.x,
        y: worldPoint.y,
        text,
      });
    }
    setters.setSurfacePick(null);
  };
};
