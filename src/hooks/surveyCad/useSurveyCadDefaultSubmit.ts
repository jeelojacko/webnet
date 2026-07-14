import {
  cadArcEndPoint,
  cadBuildArcFromStartCenterAngle,
  cadBuildArcFromStartCenterChord,
  cadBuildArcFromStartCenterEnd,
  cadBuildArcFromStartEndAngle,
  cadBuildArcFromStartEndDirection,
  cadBuildArcFromStartEndRadius,
  cadParseBearingDegrees,
  type CadNamedPoint,
} from '../../engine/cad/cadGeometry';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import {
  normalizeDraftPoint,
  parseAbsolutePoint,
  parseInputPoint,
} from './useSurveyCadCommandParsing';

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
type ConsumePoint = (_point: CommandPoint) => void;
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

interface HandleSurveyCadDefaultSubmitOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  commitArcDefinition: CommitArcDefinition;
  consumePoint: ConsumePoint;
  projectStationIds: string[];
  replaceSession: ReplaceSession;
  reverseDirectionModifier: boolean;
  session: CommandSession;
}

const buildCenterFirstArcDefinition = (
  commandKey: 'ARC_CSE' | 'ARC_CSA' | 'ARC_CSL',
  points: CadNamedPoint[],
  value: number | null,
  reverseDirectionModifier: boolean,
) => {
  if (points.length < 2) return null;
  if (commandKey === 'ARC_CSE') {
    if (points.length < 3) return null;
    return cadBuildArcFromStartCenterEnd(
      points[1]!,
      points[0]!,
      points[2]!,
      reverseDirectionModifier,
    );
  }
  if (value == null) return null;
  return commandKey === 'ARC_CSA'
    ? cadBuildArcFromStartCenterAngle(points[1]!, points[0]!, value, reverseDirectionModifier)
    : cadBuildArcFromStartCenterChord(points[1]!, points[0]!, value, reverseDirectionModifier);
};

const basePointForSession = (session: CommandSession): CommandPoint | null => {
  if (
    session.key === 'PLINE' ||
    session.key === 'ARC_3PT' ||
    session.key === 'ARC_SCE' ||
    session.key === 'ARC_CSE' ||
    session.key === 'ARC_SCA' ||
    session.key === 'ARC_CSA' ||
    session.key === 'ARC_SCL' ||
    session.key === 'ARC_CSL' ||
    session.key === 'ARC_SEA' ||
    session.key === 'ARC_SED' ||
    session.key === 'ARC_SER'
  ) {
    return session.points[session.points.length - 1] ?? null;
  }
  if (session.key === 'CONTINUE_CURVE') {
    return {
      ...cadArcEndPoint(session.sourceArc),
      label: session.sourceArc.id,
    };
  }
  if (session.key === 'TANGENT_CURVE') {
    return session.aheadTangentPoint ?? session.backTangentPoint ?? session.piPoint;
  }
  return 'startPoint' in session ? session.startPoint : null;
};

const handleTraverseSubmit = ({
  projectStationIds,
  replaceSession,
  session,
}: Pick<
  HandleSurveyCadDefaultSubmitOptions,
  'projectStationIds' | 'replaceSession' | 'session'
>): boolean => {
  if (session.key !== 'TRAVERSE') return false;
  const rawInput = session.inputValue.trim();
  const parsedPoint =
    session.inputPoints.length === 0
      ? parseAbsolutePoint(rawInput)
      : parseInputPoint(rawInput, session.inputPoints[session.inputPoints.length - 1] ?? null);
  if (!parsedPoint) {
    replaceSession({
      ...session,
      resultText:
        session.inputPoints.length === 0
          ? 'Traverse start input invalid. Use `x,y` or `LABEL=x,y`.'
          : 'Traverse leg input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
    });
    return true;
  }
  const normalizedPoint = normalizeDraftPoint(parsedPoint, session.inputPoints, projectStationIds, {
    rawInput,
  });
  replaceSession({
    ...session,
    points: [...session.inputPoints, normalizedPoint],
    inputPoints: [...session.inputPoints, normalizedPoint],
    legInputs:
      session.inputPoints.length === 0 ? session.legInputs : [...session.legInputs, rawInput],
    adjustment: null,
    inputValue: '',
    resultText: undefined,
  });
  return true;
};

const handleFilletSubmit = ({
  replaceSession,
  session,
}: Pick<HandleSurveyCadDefaultSubmitOptions, 'replaceSession' | 'session'>): boolean => {
  if (session.key !== 'FILLET') return false;
  const radius = Number(session.inputValue.trim());
  if (!Number.isFinite(radius) || radius < 0) {
    replaceSession({
      ...session,
      resultText: 'FILLET radius invalid. Enter a zero-or-greater numeric radius, then press Enter.',
    });
    return true;
  }
  replaceSession({
    ...session,
    radius,
    inputValue: '',
    firstEntityId: null,
    firstPickPoint: null,
    firstSegmentId: undefined,
    resultText: `FILLET radius ${radius.toFixed(3)} m set. Click the first line, polyline, or arc near the corner to round.`,
  });
  return true;
};

const handleArcValueSubmit = ({
  commitArcDefinition,
  consumePoint,
  replaceSession,
  reverseDirectionModifier,
  session,
}: Omit<HandleSurveyCadDefaultSubmitOptions, 'applyHistoryUpdate' | 'projectStationIds'>): boolean => {
  if (
    session.key !== 'ARC_SCA' &&
    session.key !== 'ARC_CSA' &&
    session.key !== 'ARC_SCL' &&
    session.key !== 'ARC_CSL' &&
    session.key !== 'ARC_SEA' &&
    session.key !== 'ARC_SED' &&
    session.key !== 'ARC_SER'
  ) {
    return false;
  }

  const basePoint = basePointForSession(session);
  if (session.points.length < 2) {
    const parsed = parseInputPoint(session.inputValue, basePoint);
    if (!parsed) {
      replaceSession({
        ...session,
        resultText: 'Arc point input invalid. Use `x,y` or `LABEL=x,y` for the required points.',
      });
      return true;
    }
    consumePoint(parsed);
    return true;
  }

  const rawInput = session.inputValue.trim();
  const numericValue = Number(rawInput);
  const directionValue =
    cadParseBearingDegrees(rawInput) ?? (Number.isFinite(numericValue) ? numericValue : null);
  const arcDefinition =
    session.key === 'ARC_SCA'
      ? cadBuildArcFromStartCenterAngle(
          session.points[0]!,
          session.points[1]!,
          numericValue,
          reverseDirectionModifier,
        )
      : session.key === 'ARC_CSA'
        ? buildCenterFirstArcDefinition(
            'ARC_CSA',
            session.points,
            numericValue,
            reverseDirectionModifier,
          )
        : session.key === 'ARC_SCL'
          ? cadBuildArcFromStartCenterChord(
              session.points[0]!,
              session.points[1]!,
              numericValue,
              reverseDirectionModifier,
            )
          : session.key === 'ARC_CSL'
            ? buildCenterFirstArcDefinition(
                'ARC_CSL',
                session.points,
                numericValue,
                reverseDirectionModifier,
              )
            : session.key === 'ARC_SEA'
              ? cadBuildArcFromStartEndAngle(
                  session.points[0]!,
                  session.points[1]!,
                  numericValue,
                  reverseDirectionModifier,
                )
              : session.key === 'ARC_SER'
                ? cadBuildArcFromStartEndRadius(
                    session.points[0]!,
                    session.points[1]!,
                    numericValue,
                    reverseDirectionModifier,
                  )
                : directionValue == null
                  ? null
                  : cadBuildArcFromStartEndDirection(
                      session.points[0]!,
                      session.points[1]!,
                      directionValue,
                      reverseDirectionModifier,
                    );
  const committed = commitArcDefinition(session.key, arcDefinition, {
    startLabel:
      session.key === 'ARC_CSA' || session.key === 'ARC_CSL'
        ? session.points[1]!.label
        : session.points[0]!.label,
    secondLabel:
      session.key === 'ARC_CSA' || session.key === 'ARC_CSL'
        ? session.points[0]!.label
        : session.points[1]!.label,
  });
  if (committed) {
    replaceSession(null);
    return true;
  }
  replaceSession({
    ...session,
    resultText:
      session.key === 'ARC_SED'
        ? 'Arc direction invalid. Enter a valid azimuth or survey bearing.'
        : 'Arc value invalid. Enter a valid positive value or hold Ctrl to reverse direction.',
  });
  return true;
};

const handleTangentCurveRadiusSubmit = ({
  applyHistoryUpdate,
  replaceSession,
  session,
}: Pick<
  HandleSurveyCadDefaultSubmitOptions,
  'applyHistoryUpdate' | 'replaceSession' | 'session'
>): boolean => {
  if (session.key !== 'TANGENT_CURVE' || !session.aheadTangentPoint) return false;
  const piPoint = session.piPoint;
  const backTangentPoint = session.backTangentPoint;
  const aheadTangentPoint = session.aheadTangentPoint;
  if (!piPoint || !backTangentPoint || !aheadTangentPoint) {
    replaceSession({
      ...session,
      resultText: 'Tangent curve points incomplete. Capture PI, back, and ahead points first.',
    });
    return true;
  }
  const radius = Number(session.inputValue.trim());
  if (!Number.isFinite(radius) || radius <= 0) {
    replaceSession({
      ...session,
      resultText: 'Tangent curve radius invalid. Enter a positive numeric radius.',
    });
    return true;
  }
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, {
      key: 'TANGENT_CURVE',
      pi: piPoint,
      backTangentPoint,
      aheadTangentPoint,
      radius,
    }),
  );
  replaceSession(null);
  return true;
};

const handlePointInputFallback = ({
  consumePoint,
  replaceSession,
  session,
}: Pick<
  HandleSurveyCadDefaultSubmitOptions,
  'consumePoint' | 'replaceSession' | 'session'
>): boolean => {
  const parsed = parseInputPoint(session.inputValue, basePointForSession(session));
  if (!parsed) {
    replaceSession({
      ...session,
      resultText:
        session.key === 'POINT'
          ? 'POINT input invalid. Use `x,y` or `LABEL=x,y`.'
          : session.key === 'TANGENT_CURVE' && session.aheadTangentPoint
            ? 'Tangent curve radius invalid. Enter a positive numeric radius.'
            : 'Command input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
    });
    return true;
  }
  consumePoint(parsed);
  return true;
};

export const handleSurveyCadDefaultSubmit = (
  options: HandleSurveyCadDefaultSubmitOptions,
): void => {
  if (
    handleTraverseSubmit(options) ||
    handleFilletSubmit(options) ||
    handleArcValueSubmit(options) ||
    handleTangentCurveRadiusSubmit(options) ||
    handlePointInputFallback(options)
  ) {
    return;
  }
};
