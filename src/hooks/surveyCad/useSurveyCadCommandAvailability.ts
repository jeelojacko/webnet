import type { CadSnapCandidate } from '../../engine/cad/cadTypes';
import type { CommandSession } from './useSurveyCadCommandTypes';

export interface SurveyCadCommandAvailability {
  canUseActiveSnap: boolean;
  canCycleActiveSnap: boolean;
  canFinishCommand: boolean;
  canCloseTraverseDraft: boolean;
}

const activeCommandAllowsSnap = (session: CommandSession | null): boolean =>
  session?.key !== 'TRIM' && session?.key !== 'EXTEND';

export const buildSurveyCadCommandAvailability = ({
  activeSnap,
  commandExpectsPointPick,
  session,
}: {
  activeSnap: CadSnapCandidate | null;
  commandExpectsPointPick: boolean;
  session: CommandSession | null;
}): SurveyCadCommandAvailability => ({
  canUseActiveSnap: activeSnap != null && commandExpectsPointPick && activeCommandAllowsSnap(session),
  canCycleActiveSnap: commandExpectsPointPick && activeCommandAllowsSnap(session),
  canFinishCommand:
    session?.key === 'PLINE'
      ? session.points.length >= 2
      : session?.key === 'TRAVERSE'
        ? session.points.length >= 2 &&
          (session.mode !== 'point-to-point' || session.closePoint != null)
        : session?.key === 'PARCEL_SPLIT_BEARING' || session?.key === 'PARCEL_SPLIT_AREA'
          ? session.splitPoint != null && session.inputValue.trim().length > 0
        : session?.key === 'BATCH_COGO'
          ? session.draft.canCommit
          : false,
  canCloseTraverseDraft:
    session?.key === 'TRAVERSE' &&
    session.points.length >= 3 &&
    (Math.abs(session.points[0]!.x - session.points[session.points.length - 1]!.x) > 1e-9 ||
      Math.abs(session.points[0]!.y - session.points[session.points.length - 1]!.y) > 1e-9),
});
