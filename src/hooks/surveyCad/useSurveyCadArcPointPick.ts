import {
  cadBuildArcFromStartCenterEnd,
  cadBuildContinuedArc,
} from '../../engine/cad/cadGeometry';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
type CommitArcDefinition = (
  _modeLabel: string,
  _arcDefinition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  } | null,
  _metadata?: Record<string, unknown>,
) => boolean;

const buildCenterFirstArcDefinition = (
  points: CommandPoint[],
  reverseDirectionModifier: boolean,
) => {
  if (points.length < 3) return null;
  return cadBuildArcFromStartCenterEnd(
    points[1]!,
    points[0]!,
    points[2]!,
    reverseDirectionModifier,
  );
};

export const handleSurveyCadArcPointPick = ({
  commitArcDefinition,
  applyHistoryUpdate,
  current,
  point,
  replaceSession,
  reverseDirectionModifier,
}: {
  commitArcDefinition: CommitArcDefinition;
  applyHistoryUpdate: ApplyHistoryUpdate;
  current: CommandSession;
  point: CommandPoint;
  replaceSession: ReplaceSession;
  reverseDirectionModifier: boolean;
}): boolean => {
  if (current.key === 'ARC_3PT') {
    const nextPoints = [...current.points, point];
    if (nextPoints.length < 3) {
      replaceSession({
        ...current,
        points: nextPoints,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'ARC_3PT',
        start: nextPoints[0]!,
        through: nextPoints[1]!,
        end: nextPoints[2]!,
      }),
    );
    replaceSession(null);
    return true;
  }

  if (
    current.key === 'ARC_SCE' ||
    current.key === 'ARC_CSE' ||
    current.key === 'ARC_SCA' ||
    current.key === 'ARC_CSA' ||
    current.key === 'ARC_SCL' ||
    current.key === 'ARC_CSL' ||
    current.key === 'ARC_SEA' ||
    current.key === 'ARC_SED' ||
    current.key === 'ARC_SER'
  ) {
    const nextPoints = [...current.points, point];
    if (
      ((current.key === 'ARC_SCE' || current.key === 'ARC_CSE') && nextPoints.length < 3) ||
      current.key !== 'ARC_SCE' && current.key !== 'ARC_CSE' && nextPoints.length < 2
    ) {
      replaceSession({
        ...current,
        points: nextPoints,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (current.key === 'ARC_SCE' || current.key === 'ARC_CSE') {
      const committed = commitArcDefinition(
        current.key,
        current.key === 'ARC_SCE'
          ? cadBuildArcFromStartCenterEnd(
              nextPoints[0]!,
              nextPoints[1]!,
              nextPoints[2]!,
              reverseDirectionModifier,
            )
          : buildCenterFirstArcDefinition(nextPoints, reverseDirectionModifier),
        {
          startLabel: current.key === 'ARC_SCE' ? nextPoints[0]!.label : nextPoints[1]!.label,
          centerLabel: current.key === 'ARC_SCE' ? nextPoints[1]!.label : nextPoints[0]!.label,
          endLabel: nextPoints[2]!.label,
        },
      );
      replaceSession(
        committed
          ? null
          : {
              ...current,
              points: nextPoints,
              resultText: `${current.key === 'ARC_SCE' ? 'ARC SCE' : 'ARC CSE'} invalid. Adjust the points or hold Ctrl to reverse.`,
            },
      );
      return true;
    }
    if (current.points.length < 2) {
      replaceSession({
        ...current,
        points: nextPoints,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    replaceSession({
      ...current,
      resultText: 'This arc mode now needs a typed value. Enter it in the command bar.',
    });
    return true;
  }

  if (current.key === 'CONTINUE_CURVE') {
    const committed = commitArcDefinition(
      'CONTINUE_CURVE',
      cadBuildContinuedArc(current.sourceArc, point, reverseDirectionModifier),
      {
        sourceArcId: current.sourceArc.id,
        endLabel: point.label,
      },
    );
    replaceSession(
      committed
        ? null
        : {
            ...current,
            resultText: 'Continue Curve invalid. Choose a different endpoint or hold Ctrl to reverse.',
          },
    );
    return true;
  }

  if (current.key === 'TANGENT_CURVE') {
    if (!current.piPoint) {
      replaceSession({
        ...current,
        piPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (!current.backTangentPoint) {
      replaceSession({
        ...current,
        backTangentPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (!current.aheadTangentPoint) {
      replaceSession({
        ...current,
        aheadTangentPoint: point,
        inputValue: '',
        resultText: undefined,
      });
    }
    return true;
  }

  return false;
};
