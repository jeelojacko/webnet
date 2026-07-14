import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type {
  CadArcEntity,
  CadLineEntity,
  CadPolylineEntity,
} from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;

export const handleSurveyCadEditPointPick = ({
  applyHistoryUpdate,
  current,
  history,
  point,
  replaceSession,
}: {
  applyHistoryUpdate: ApplyHistoryUpdate;
  current: CommandSession;
  history: CadHistoryState;
  point: CommandPoint;
  replaceSession: ReplaceSession;
}): boolean => {
  if (current.key === 'MOVE' || current.key === 'COPY') {
    if (!current.startPoint) {
      replaceSession({
        ...current,
        startPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    const startPoint = current.startPoint;
    const transformKey: 'MOVE' | 'COPY' = current.key;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: transformKey,
        deltaX: point.x - startPoint.x,
        deltaY: point.y - startPoint.y,
      }),
    );
    replaceSession(null);
    return true;
  }

  if (current.key === 'TRIM') {
    const targetEntityId = point.snapSourceEntityId;
    if (!targetEntityId) {
      replaceSession({
        ...current,
        resultText: 'TRIM needs a direct line, polyline, or arc body click. Background points do not trim.',
      });
      return true;
    }
    if (current.firstEntityId == null || current.firstPickPoint == null) {
      replaceSession({
        ...current,
        firstEntityId: targetEntityId,
        firstPickPoint: point,
        firstSegmentId: point.snapSourceSegmentId,
        inputValue: '',
        resultText: 'TRIM first entity captured. Click target portion to trim against it.',
      });
      return true;
    }
    let committed = false;
    applyHistoryUpdate((existing) => {
      const next = runCadCommand(existing, {
        key: 'TRIM',
        cuttingEntityIds: [current.firstEntityId!],
        targetEntityId,
        pickPoint: { x: point.x, y: point.y },
        targetSegmentId: point.snapSourceSegmentId,
      });
      committed = next !== existing;
      return next;
    });
    replaceSession({
      ...current,
      firstEntityId: null,
      firstPickPoint: null,
      firstSegmentId: undefined,
      inputValue: '',
      resultText: committed
        ? `TRIM committed on ${targetEntityId}. Click the next cutting edge, then the next target, or press Enter/Esc to finish.`
        : current.firstEntityId === targetEntityId &&
            current.firstSegmentId === point.snapSourceSegmentId
          ? 'TRIM ignored the same pick twice. Click a different target entity or segment.'
          : `TRIM found no removable span on ${targetEntityId}. Check cutting-edge selection and click a different side.`,
    });
    return true;
  }

  if (current.key === 'EXTEND') {
    const targetEntityId = point.snapSourceEntityId;
    if (!targetEntityId) {
      replaceSession({
        ...current,
        resultText: 'EXT needs a direct line, polyline, or arc body click. Background points do not extend.',
      });
      return true;
    }
    if (current.firstTargetEntityId == null) {
      replaceSession({
        ...current,
        firstTargetEntityId: targetEntityId,
        firstTargetPickPoint: point,
        firstTargetSegmentId: point.snapSourceSegmentId,
        inputValue: '',
        resultText: 'EXT source entity captured. Click the boundary to extend to.',
      });
      return true;
    }
    let committed = false;
    applyHistoryUpdate((existing) => {
      const next = runCadCommand(existing, {
        key: 'EXTEND',
        boundaryEntityIds: [targetEntityId],
        targetEntityId: current.firstTargetEntityId!,
        targetPickPoint: {
          x: current.firstTargetPickPoint!.x,
          y: current.firstTargetPickPoint!.y,
        },
        targetSegmentId: current.firstTargetSegmentId,
      });
      committed = next !== existing;
      return next;
    });
    replaceSession({
      ...current,
      firstTargetEntityId: null,
      firstTargetPickPoint: null,
      firstTargetSegmentId: undefined,
      inputValue: '',
      resultText: committed
        ? `EXT committed on ${current.firstTargetEntityId ?? targetEntityId}. Click the next entity to extend, or press Enter/Esc to finish.`
        : current.firstTargetEntityId === targetEntityId
          ? 'EXT ignored the same entity twice. Click a different boundary entity.'
          : `EXT found no extend path on ${current.firstTargetEntityId}. Check the picked end and boundary.`,
    });
    return true;
  }

  if (current.key === 'FILLET') {
    if (current.radius == null) {
      replaceSession({
        ...current,
        resultText: 'FILLET needs a radius first. Enter a zero-or-greater numeric radius, then press Enter.',
      });
      return true;
    }
    const targetEntityId = point.snapSourceEntityId;
    if (!targetEntityId) {
      replaceSession({
        ...current,
        resultText: 'FILLET needs a direct entity click. Background points do not define a fillet corner.',
      });
      return true;
    }
    const targetEntity = history.present.project.entities.find(
      (entity): entity is CadLineEntity | CadPolylineEntity | CadArcEntity =>
        (entity.type === 'line' || entity.type === 'polyline' || entity.type === 'arc') &&
        entity.id === targetEntityId,
    );
    if (!targetEntity) {
      replaceSession({
        ...current,
        resultText: 'FILLET currently supports line, polyline, and arc corners only. Click a valid entity near the desired corner.',
      });
      return true;
    }
    if (current.firstEntityId == null || current.firstPickPoint == null) {
      replaceSession({
        ...current,
        firstEntityId: targetEntity.id,
        firstPickPoint: point,
        firstSegmentId: point.snapSourceSegmentId,
        inputValue: '',
        resultText: `FILLET first entity captured. Click the second entity for radius ${current.radius.toFixed(3)} m.`,
      });
      return true;
    }
    let committed = false;
    applyHistoryUpdate((existing) => {
      const next = runCadCommand(existing, {
        key: 'FILLET',
        radius: current.radius!,
        firstEntityId: current.firstEntityId!,
        firstPickPoint: { x: current.firstPickPoint!.x, y: current.firstPickPoint!.y },
        firstSegmentId: current.firstSegmentId,
        secondEntityId: targetEntity.id,
        secondPickPoint: { x: point.x, y: point.y },
        secondSegmentId: point.snapSourceSegmentId,
      });
      committed = next !== existing;
      return next;
    });
    replaceSession({
      ...current,
      firstEntityId: null,
      firstPickPoint: null,
      firstSegmentId: undefined,
      inputValue: '',
      resultText: committed
        ? `FILLET committed. Radius ${current.radius.toFixed(3)} m still active. Click two more entities, or press Enter/Esc to finish.`
        : current.firstEntityId === targetEntity.id &&
            current.firstSegmentId === point.snapSourceSegmentId
          ? 'FILLET ignored the same pick twice. Click a different second entity or segment near the same corner.'
          : `FILLET failed for ${current.radius.toFixed(3)} m. Check that the clicked entities can form that corner radius.`,
    });
    return true;
  }

  if (current.key === 'PASTE') {
    const startPoint = current.startPoint;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'PASTE',
        deltaX: point.x - startPoint.x,
        deltaY: point.y - startPoint.y,
        entityIds: current.sourceEntityIds,
      }),
    );
    replaceSession(null);
    return true;
  }

  return false;
};
