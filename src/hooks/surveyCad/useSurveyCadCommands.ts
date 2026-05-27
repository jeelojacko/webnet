import type { Dispatch, SetStateAction } from 'react';
import { useMemo, useState } from 'react';
import {
  buildCadInverseSummary,
  cadPointFromBearingDistance,
} from '../../engine/cad/cadCogo';
import {
  cadArcEndPoint,
  cadBuildArcFromStartCenterAngle,
  cadBuildArcFromStartCenterChord,
  cadBuildArcFromStartCenterEnd,
  cadBuildArcFromStartEndAngle,
  cadBuildArcFromStartEndDirection,
  cadBuildArcFromStartEndRadius,
  cadBuildArcFromThreePoints,
  cadBuildContinuedArc,
  cadBuildTangentCurve,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  type CadNamedPoint,
} from '../../engine/cad/cadGeometry';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadArcEntity, CadSnapCandidate } from '../../engine/cad/cadTypes';

type ActiveCommandKey =
  | 'POINT'
  | 'COGO_POINT'
  | 'LINE'
  | 'PLINE'
  | 'TRAVERSE'
  | 'ARC_3PT'
  | 'ARC_SCE'
  | 'ARC_SCA'
  | 'ARC_SCL'
  | 'ARC_SEA'
  | 'ARC_SED'
  | 'ARC_SER'
  | 'CONTINUE_CURVE'
  | 'TANGENT_CURVE'
  | 'INVERSE'
  | 'MOVE'
  | 'COPY'
  | 'PASTE';

type CommandSession =
  | {
      key: 'POINT';
      inputValue: string;
      resultText?: string;
    }
  | {
      key: 'COGO_POINT' | 'LINE' | 'INVERSE' | 'MOVE' | 'COPY';
      inputValue: string;
      startPoint: CadNamedPoint | null;
      resultText?: string;
    }
  | {
      key: 'PASTE';
      inputValue: string;
      startPoint: CadNamedPoint;
      sourceEntityIds: string[];
      resultText?: string;
    }
  | {
      key: 'PLINE';
      inputValue: string;
      points: CadNamedPoint[];
      resultText?: string;
    }
  | {
      key: 'TRAVERSE';
      inputValue: string;
      points: CadNamedPoint[];
      resultText?: string;
    }
  | {
      key: 'ARC_3PT';
      inputValue: string;
      points: CadNamedPoint[];
      resultText?: string;
    }
  | {
      key: 'ARC_SCE' | 'ARC_SCA' | 'ARC_SCL' | 'ARC_SEA' | 'ARC_SED' | 'ARC_SER';
      inputValue: string;
      points: CadNamedPoint[];
      resultText?: string;
    }
  | {
      key: 'CONTINUE_CURVE';
      inputValue: string;
      sourceArc: CadArcEntity;
      resultText?: string;
    }
  | {
      key: 'TANGENT_CURVE';
      inputValue: string;
      piPoint: CadNamedPoint | null;
      backTangentPoint: CadNamedPoint | null;
      aheadTangentPoint: CadNamedPoint | null;
      resultText?: string;
    };

interface UseSurveyCadCommandsArgs {
  activeSnap: CadSnapCandidate | null;
  previewPoint: { x: number; y: number; label: string } | null;
  history: CadHistoryState;
  selectionCount: number;
  selectedArcForContinue: CadArcEntity | null;
  reverseDirectionModifier: boolean;
  setHistory: Dispatch<SetStateAction<CadHistoryState>>;
}

export type CadCommandPreviewState =
  | {
      kind: 'point';
      point: { x: number; y: number };
    }
  | {
      kind: 'line';
      points: [{ x: number; y: number }, { x: number; y: number }];
    }
  | {
      kind: 'polyline';
      points: Array<{ x: number; y: number }>;
    }
  | {
      kind: 'arc';
      center: { x: number; y: number };
      radius: number;
      startAngleDeg: number;
      endAngleDeg: number;
    }
  | {
      kind: 'translate-selection';
      deltaX: number;
      deltaY: number;
      sourceEntityIds?: string[];
    };

interface UseSurveyCadCommandsResult {
  activeCommandKey: ActiveCommandKey | null;
  commandInputValue: string;
  commandPrompt: string;
  commandHelpText: string;
  commandPreview: CadCommandPreviewState | null;
  canUseActiveSnap: boolean;
  canFinishCommand: boolean;
  startPointCommand: () => void;
  startCogoPointCommand: () => void;
  startLineCommand: () => void;
  startPolylineCommand: () => void;
  startTraverseCommand: () => void;
  startArc3PointCommand: () => void;
  startArcStartCenterEndCommand: () => void;
  startArcStartCenterAngleCommand: () => void;
  startArcStartCenterChordCommand: () => void;
  startArcStartEndAngleCommand: () => void;
  startArcStartEndDirectionCommand: () => void;
  startArcStartEndRadiusCommand: () => void;
  startContinueCurveCommand: () => void;
  startTangentCurveCommand: () => void;
  startInverseCommand: () => void;
  startMoveCommand: () => void;
  startCopyCommand: () => void;
  startPasteCommand: (_sourceEntityIds: string[], _basePoint: CadNamedPoint) => void;
  cancelCommand: () => void;
  finishCommand: () => void;
  setCommandInputValue: (_value: string) => void;
  appendCommandInputValue: (_value: string) => void;
  backspaceCommandInputValue: () => void;
  submitCommandInput: () => void;
  useActiveSnap: () => void;
  consumeInteractionPoint: (_point: { x: number; y: number }, _label?: string) => void;
  handleEnterKey: () => void;
  handleEscapeKey: () => void;
}

const isNumeric = (value: string): boolean => value.trim().length > 0 && Number.isFinite(Number(value));

const splitLabelFromBody = (token: string): { label?: string; body: string } => {
  const normalized = token.trim();
  const labelIndex = normalized.indexOf('=');
  if (labelIndex < 0) return { body: normalized };
  return {
    label: normalized.slice(0, labelIndex).trim() || undefined,
    body: normalized.slice(labelIndex + 1).trim(),
  };
};

const parseAbsolutePoint = (token: string): CadNamedPoint | null => {
  const { label, body } = splitLabelFromBody(token);
  if (body.length === 0) return null;
  const parts = body.split(',').map((part) => part.trim());
  if (parts.length !== 2 || !isNumeric(parts[0]) || !isNumeric(parts[1])) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  return {
    x,
    y,
    label: label || `${x.toFixed(3)},${y.toFixed(3)}`,
  };
};

const parseRelativeBearingDistance = (
  token: string,
  basePoint: CadNamedPoint | null,
): CadNamedPoint | null => {
  if (!basePoint) return null;
  const { label, body } = splitLabelFromBody(token);
  if (body.length === 0) return null;
  const trimmed = body.trim();
  const prefixed = trimmed.startsWith('@');
  const directionBody = prefixed ? trimmed.slice(1).trim() : trimmed;
  const parts = directionBody.split(',').map((part) => part.trim());
  if (parts.length !== 2 || !isNumeric(parts[1])) return null;
  const directionToken = parts[0];
  const distance = Number(parts[1]);
  const looksLikeBearing = /^[NS]/i.test(directionToken);
  if (!prefixed && !looksLikeBearing) return null;
  const azimuthDeg = looksLikeBearing
    ? cadParseBearingDegrees(directionToken)
    : isNumeric(directionToken)
      ? Number(directionToken)
      : null;
  if (azimuthDeg == null) return null;
  const point = looksLikeBearing
    ? cadPointFromBearingDistance(basePoint, directionToken, distance)
    : cadPointFromAzimuthDistance(basePoint, azimuthDeg, distance);
  if (!point) return null;
  return {
    ...point,
    label: label || `${prefixed ? '@' : ''}${directionToken},${distance}`,
  };
};

const promptForSession = (session: CommandSession | null, fallbackStatus: string): string => {
  if (!session) return fallbackStatus;
  switch (session.key) {
    case 'POINT':
      return session.resultText ?? 'POINT active. Click in model space or enter `x,y` / `LABEL=x,y`, then press Enter.';
    case 'COGO_POINT':
      return session.resultText ??
        (session.startPoint
          ? `COGO_POINT active. Base ${session.startPoint.label} captured. Enter target as \`@azimuth,distance\`, \`N45-00-00E,100\`, or absolute \`x,y\`.`
          : 'COGO_POINT active. Click or enter the base point.');
    case 'LINE':
      return session.resultText ??
        (session.startPoint
          ? `LINE active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`, then press Enter.`
          : 'LINE active. Click or enter the start point.');
    case 'PLINE':
      return session.resultText ??
        (session.points.length > 0
          ? `PLINE active. ${session.points.length} vertex${session.points.length === 1 ? '' : 'es'} captured. Click the next point or press Enter on an empty input to finish once 2+ vertices exist.`
          : 'PLINE active. Click or enter the first vertex.');
    case 'TRAVERSE':
      return session.resultText ??
        (session.points.length > 0
          ? `TRAVERSE active. ${session.points.length} station${session.points.length === 1 ? '' : 's'} captured. Enter the next leg as \`@azimuth,distance\` or bearing-distance, or click another point.`
          : 'TRAVERSE active. Click or enter the first station.');
    case 'ARC_3PT':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC_3PT active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC_3PT active. Start ${session.points[0].label} captured. Enter the through point.`
            : `ARC_3PT active. Start ${session.points[0].label} and through ${session.points[1]?.label} captured. Enter the end point.`);
    case 'ARC_SCE':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SCE active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SCE active. Start ${session.points[0].label} captured. Enter the center point.`
            : `ARC SCE active. Start ${session.points[0].label} and center ${session.points[1]?.label} captured. Enter the end point.`);
    case 'ARC_SCA':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC SCA active. Click or enter the start point.'
              : `ARC SCA active. Start ${session.points[0].label} captured. Enter the center point.`)
          : `ARC SCA active. Enter the included angle in degrees.${''}`);
    case 'ARC_SCL':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC SCL active. Click or enter the start point.'
              : `ARC SCL active. Start ${session.points[0].label} captured. Enter the center point.`)
          : 'ARC SCL active. Enter the chord length.');
    case 'ARC_SEA':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SEA active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SEA active. Start ${session.points[0].label} captured. Enter the end point.`
            : 'ARC SEA active. Enter the included angle in degrees.');
    case 'ARC_SED':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SED active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SED active. Start ${session.points[0].label} captured. Enter the end point.`
            : 'ARC SED active. Enter the start direction as azimuth or survey bearing.');
    case 'ARC_SER':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SER active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SER active. Start ${session.points[0].label} captured. Enter the end point.`
            : 'ARC SER active. Enter the radius.');
    case 'CONTINUE_CURVE':
      return session.resultText ??
        `CONTINUE CURVE active. Source arc ${session.sourceArc.id} captured. Enter the next end point.`;
    case 'TANGENT_CURVE':
      return session.resultText ??
        (session.piPoint == null
          ? 'TANGENT_CURVE active. Click or enter the PI point.'
          : session.backTangentPoint == null
            ? `TANGENT_CURVE active. PI ${session.piPoint.label} captured. Enter the back tangent point.`
            : session.aheadTangentPoint == null
              ? `TANGENT_CURVE active. PI ${session.piPoint.label} and back point ${session.backTangentPoint.label} captured. Enter the ahead tangent point.`
              : `TANGENT_CURVE active. Enter the radius for PI ${session.piPoint.label}.`);
    case 'INVERSE':
      return session.resultText ??
        (session.startPoint
          ? `INVERSE active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`, then press Enter.`
          : 'INVERSE active. Click or enter the first point.');
    case 'MOVE':
      return session.resultText ??
        (session.startPoint
          ? `MOVE active. Base point ${session.startPoint.label} captured. Click the target point or enter \`@azimuth,distance\` / bearing-distance, then press Enter.`
          : 'MOVE active. Click or enter the base point for the current selection.');
    case 'COPY':
      return session.resultText ??
        (session.startPoint
          ? `COPY active. Base point ${session.startPoint.label} captured. Click the target point or enter \`@azimuth,distance\` / bearing-distance, then press Enter.`
          : 'COPY active. Click or enter the base point for the current selection.');
    case 'PASTE':
      return session.resultText ??
        `PASTE active. Clipboard base ${session.startPoint.label} captured. Click the insertion point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`, then press Enter.`;
  }
};

const helpTextForSession = (session: CommandSession | null): string => {
  if (!session) {
      return 'Interactive commands accept `x,y`, optional `LABEL=x,y`, `@azimuth,distance`, and survey bearing-distance like `N45-00-00E,100`.';
  }
  switch (session.key) {
    case 'POINT':
      return 'POINT input: click in the model space, or type `x,y` / `LABEL=x,y`. Enter commits. Esc cancels.';
    case 'COGO_POINT':
      return session.startPoint
        ? 'COGO_POINT target: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100` from the base point.'
        : 'COGO_POINT base point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'LINE':
      return session.startPoint
        ? 'LINE second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or `N45-00-00E,100` from the first point.'
        : 'LINE first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'PLINE':
      return session.points.length > 0
        ? 'PLINE next vertex: click in the model space or type `x,y`, `@azimuth,distance`, or bearing-distance from the last vertex. Press Enter on an empty input to finish after 2+ vertices.'
        : 'PLINE first vertex: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'TRAVERSE':
      return session.points.length > 0
        ? 'TRAVERSE next leg: click the next station, or type `@azimuth,distance` / `N45-00-00E,100` from the last station. Press Enter on an empty input to finish after 2+ stations.'
        : 'TRAVERSE first station: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'ARC_3PT':
      return session.points.length < 2
        ? 'ARC 3PT point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC 3PT end point: click in the model space or type `x,y` / `LABEL=x,y` to commit the arc.';
    case 'ARC_SCE':
      return session.points.length < 2
        ? 'ARC Start-Center-End point input: click in the model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.'
        : 'ARC Start-Center-End end point input: click in model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.';
    case 'ARC_SCA':
      return session.points.length < 2
        ? 'ARC Start-Center-Angle point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-Center-Angle value input: enter a positive included angle in degrees. Hold Ctrl to reverse direction.';
    case 'ARC_SCL':
      return session.points.length < 2
        ? 'ARC Start-Center-Length point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-Center-Length value input: enter a positive chord length. Hold Ctrl to reverse direction.';
    case 'ARC_SEA':
      return session.points.length < 2
        ? 'ARC Start-End-Angle point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-End-Angle value input: enter a positive included angle in degrees. Hold Ctrl to use the opposite bulge.';
    case 'ARC_SED':
      return session.points.length < 2
        ? 'ARC Start-End-Direction point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-End-Direction value input: enter a start tangent azimuth or survey bearing. Hold Ctrl to reverse the turn side.';
    case 'ARC_SER':
      return session.points.length < 2
        ? 'ARC Start-End-Radius point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-End-Radius value input: enter a positive radius. Hold Ctrl to use the opposite bulge.';
    case 'CONTINUE_CURVE':
      return 'Continue Curve input: click in the model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the continuation side.';
    case 'TANGENT_CURVE':
      return session.aheadTangentPoint
        ? 'Tangent curve radius input: numeric radius only.'
        : 'Tangent curve point input: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'INVERSE':
      return session.startPoint
        ? 'INVERSE second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the first point.'
        : 'INVERSE first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'MOVE':
      return session.startPoint
        ? 'MOVE target point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the base point.'
        : 'MOVE base point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'COPY':
      return session.startPoint
        ? 'COPY target point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the base point.'
        : 'COPY base point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'PASTE':
      return 'PASTE insertion point: click in the model space or type `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the clipboard base point.';
  }
};

export const useSurveyCadCommands = ({
  activeSnap,
  previewPoint,
  history,
  selectionCount,
  selectedArcForContinue,
  reverseDirectionModifier,
  setHistory,
}: UseSurveyCadCommandsArgs): UseSurveyCadCommandsResult => {
  const [session, setSession] = useState<CommandSession | null>(null);

  const statusPrompt = useMemo(
    () => promptForSession(session, history.commandState.prompt),
    [history.commandState.prompt, session],
  );
  const helpText = useMemo(() => helpTextForSession(session), [session]);
  const commandPreview = useMemo<CadCommandPreviewState | null>(() => {
    if (!session) return null;
    switch (session.key) {
      case 'POINT':
        if (!previewPoint) return null;
        return {
          kind: 'point',
          point: { x: previewPoint.x, y: previewPoint.y },
        };
      case 'COGO_POINT':
      case 'LINE':
      case 'INVERSE':
        if (!previewPoint) return null;
        if (!session.startPoint) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        return {
          kind: 'line',
          points: [
            { x: session.startPoint.x, y: session.startPoint.y },
            { x: previewPoint.x, y: previewPoint.y },
          ],
        };
      case 'PLINE':
      case 'TRAVERSE':
        if (!previewPoint) return null;
        if (session.points.length === 0) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        return {
          kind: 'polyline',
          points: [
            ...session.points.map((point) => ({ x: point.x, y: point.y })),
            { x: previewPoint.x, y: previewPoint.y },
          ],
        };
      case 'ARC_3PT':
        if (!previewPoint) return null;
        if (session.points.length === 0) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        if (session.points.length === 1) {
          return {
            kind: 'line',
            points: [
              { x: session.points[0].x, y: session.points[0].y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        return (() => {
          const previewArc = cadBuildArcFromThreePoints(session.points[0], session.points[1], previewPoint);
          return previewArc
            ? {
                kind: 'arc' as const,
                center: previewArc.center,
                radius: previewArc.radius,
                startAngleDeg: previewArc.startAngleDeg,
                endAngleDeg: previewArc.endAngleDeg,
              }
            : {
                kind: 'polyline' as const,
                points: [
                  { x: session.points[0].x, y: session.points[0].y },
                  { x: session.points[1].x, y: session.points[1].y },
                  { x: previewPoint.x, y: previewPoint.y },
                ],
              };
        })();
      case 'ARC_SCE':
        if (!previewPoint) return null;
        if (session.points.length === 0) {
          return { kind: 'point', point: { x: previewPoint.x, y: previewPoint.y } };
        }
        if (session.points.length === 1) {
          return {
            kind: 'line',
            points: [
              { x: session.points[0].x, y: session.points[0].y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        return (() => {
          const previewArc = cadBuildArcFromStartCenterEnd(
            session.points[0],
            session.points[1],
            previewPoint,
            reverseDirectionModifier,
          );
          return previewArc
            ? {
                kind: 'arc' as const,
                center: previewArc.center,
                radius: previewArc.radius,
                startAngleDeg: previewArc.startAngleDeg,
                endAngleDeg: previewArc.endAngleDeg,
              }
            : {
                kind: 'polyline' as const,
                points: [
                  { x: session.points[0].x, y: session.points[0].y },
                  { x: session.points[1].x, y: session.points[1].y },
                  { x: previewPoint.x, y: previewPoint.y },
                ],
              };
        })();
      case 'ARC_SCA':
      case 'ARC_SCL':
      case 'ARC_SEA':
      case 'ARC_SED':
      case 'ARC_SER': {
        if (session.points.length === 0) {
          if (!previewPoint) return null;
          return { kind: 'point', point: { x: previewPoint.x, y: previewPoint.y } };
        }
        if (session.points.length === 1) {
          if (!previewPoint) return null;
          return {
            kind: 'line',
            points: [
              { x: session.points[0].x, y: session.points[0].y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        const rawInput = session.inputValue.trim();
        if (rawInput.length === 0) {
          return {
            kind: 'line',
            points: [
              { x: session.points[0].x, y: session.points[0].y },
              { x: session.points[1].x, y: session.points[1].y },
            ],
          };
        }
        const numericValue = Number(rawInput);
        const directionValue =
          cadParseBearingDegrees(rawInput) ?? (Number.isFinite(numericValue) ? numericValue : null);
        const previewArc =
          session.key === 'ARC_SCA'
            ? cadBuildArcFromStartCenterAngle(
                session.points[0],
                session.points[1],
                numericValue,
                reverseDirectionModifier,
              )
            : session.key === 'ARC_SCL'
              ? cadBuildArcFromStartCenterChord(
                  session.points[0],
                  session.points[1],
                  numericValue,
                  reverseDirectionModifier,
                )
              : session.key === 'ARC_SEA'
                ? cadBuildArcFromStartEndAngle(
                    session.points[0],
                    session.points[1],
                    numericValue,
                    reverseDirectionModifier,
                  )
                : session.key === 'ARC_SER'
                  ? cadBuildArcFromStartEndRadius(
                      session.points[0],
                      session.points[1],
                      numericValue,
                      reverseDirectionModifier,
                    )
                  : directionValue == null
                    ? null
                    : cadBuildArcFromStartEndDirection(
                        session.points[0],
                        session.points[1],
                        directionValue,
                        reverseDirectionModifier,
                      );
        return previewArc
          ? {
              kind: 'arc' as const,
              center: previewArc.center,
              radius: previewArc.radius,
              startAngleDeg: previewArc.startAngleDeg,
              endAngleDeg: previewArc.endAngleDeg,
            }
          : {
              kind: 'line' as const,
              points: [
                { x: session.points[0].x, y: session.points[0].y },
                { x: session.points[1].x, y: session.points[1].y },
              ],
            };
      }
      case 'CONTINUE_CURVE': {
        if (!previewPoint) return null;
        const previewArc = cadBuildContinuedArc(
          session.sourceArc,
          previewPoint,
          reverseDirectionModifier,
        );
        return previewArc
          ? {
              kind: 'arc',
              center: previewArc.center,
              radius: previewArc.radius,
              startAngleDeg: previewArc.startAngleDeg,
              endAngleDeg: previewArc.endAngleDeg,
            }
          : {
              kind: 'line',
              points: [cadArcEndPoint(session.sourceArc), { x: previewPoint.x, y: previewPoint.y }],
            };
      }
      case 'TANGENT_CURVE':
        if (session.piPoint == null && !previewPoint) return null;
        if (session.piPoint == null) {
          if (!previewPoint) return null;
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        if (session.backTangentPoint == null) {
          if (!previewPoint) return null;
          return {
            kind: 'line',
            points: [
              { x: session.piPoint.x, y: session.piPoint.y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        if (session.aheadTangentPoint == null) {
          if (!previewPoint) return null;
          return {
            kind: 'polyline',
            points: [
              { x: session.backTangentPoint.x, y: session.backTangentPoint.y },
              { x: session.piPoint.x, y: session.piPoint.y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        if (session.inputValue.trim().length > 0) {
          const radius = Number(session.inputValue.trim());
          if (Number.isFinite(radius) && radius > 0) {
            const previewArc = cadBuildTangentCurve(
              session.piPoint,
              session.backTangentPoint,
              session.aheadTangentPoint,
              radius,
            );
            if (previewArc) {
              return {
                kind: 'arc',
                center: previewArc.center,
                radius: previewArc.radius,
                startAngleDeg: previewArc.startAngleDeg,
                endAngleDeg: previewArc.endAngleDeg,
              };
            }
          }
        }
        return {
          kind: 'polyline',
          points: [
            { x: session.backTangentPoint.x, y: session.backTangentPoint.y },
            { x: session.piPoint.x, y: session.piPoint.y },
            { x: session.aheadTangentPoint.x, y: session.aheadTangentPoint.y },
          ],
        };
      case 'MOVE':
      case 'COPY':
        if (!previewPoint) return null;
        if (!session.startPoint) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        return {
          kind: 'translate-selection',
          deltaX: previewPoint.x - session.startPoint.x,
          deltaY: previewPoint.y - session.startPoint.y,
        };
      case 'PASTE':
        if (!previewPoint) return null;
        return {
          kind: 'translate-selection',
          deltaX: previewPoint.x - session.startPoint.x,
          deltaY: previewPoint.y - session.startPoint.y,
          sourceEntityIds: session.sourceEntityIds,
        };
    }
  }, [previewPoint, reverseDirectionModifier, session]);

  const parseInputPoint = (inputValue: string, basePoint: CadNamedPoint | null): CadNamedPoint | null =>
    parseRelativeBearingDistance(inputValue, basePoint) ?? parseAbsolutePoint(inputValue);

  const commitArcDefinition = (
    modeLabel: string,
    arcDefinition: {
      center: { x: number; y: number };
      radius: number;
      startAngleDeg: number;
      endAngleDeg: number;
    } | null,
    metadata?: Record<string, unknown>,
  ) => {
    if (!arcDefinition) return false;
    setHistory((existing) =>
      runCadCommand(existing, {
        key: 'ARC_CREATE',
        modeLabel,
        definition: arcDefinition,
        metadata,
      }),
    );
    return true;
  };

  const consumePoint = (
    point: CadNamedPoint,
    options?: { suppressPointLabel?: boolean },
  ) => {
    setSession((current) => {
      if (!current) return current;
      if (current.key === 'POINT') {
        setHistory((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: point.x,
            y: point.y,
            label: options?.suppressPointLabel ? undefined : point.label,
          }),
        );
        return null;
      }
      if (current.key === 'COGO_POINT') {
        if (!current.startPoint) {
          return {
            ...current,
            startPoint: point,
            inputValue: '',
            resultText: undefined,
          };
        }
        const startPoint = current.startPoint;
        const directionLabel = current.inputValue.trim() || point.label;
        setHistory((existing) =>
          runCadCommand(existing, {
            key: 'COGO_POINT',
            x: point.x,
            y: point.y,
            basisLabel: startPoint.label,
            directionLabel,
          }),
        );
        return null;
      }
      if (current.key === 'PLINE' || current.key === 'TRAVERSE') {
        return {
          ...current,
          points: [...current.points, point],
          inputValue: '',
          resultText: undefined,
        };
      }
      if (current.key === 'ARC_3PT') {
        const nextPoints = [...current.points, point];
        if (nextPoints.length < 3) {
          return {
            ...current,
            points: nextPoints,
            inputValue: '',
            resultText: undefined,
          };
        }
        setHistory((existing) =>
          runCadCommand(existing, {
            key: 'ARC_3PT',
            start: nextPoints[0]!,
            through: nextPoints[1]!,
            end: nextPoints[2]!,
          }),
        );
        return null;
      }
      if (
        current.key === 'ARC_SCE' ||
        current.key === 'ARC_SCA' ||
        current.key === 'ARC_SCL' ||
        current.key === 'ARC_SEA' ||
        current.key === 'ARC_SED' ||
        current.key === 'ARC_SER'
      ) {
        const nextPoints = [...current.points, point];
        if (
          (current.key === 'ARC_SCE' && nextPoints.length < 3) ||
          (current.key !== 'ARC_SCE' && nextPoints.length < 2)
        ) {
          return {
            ...current,
            points: nextPoints,
            inputValue: '',
            resultText: undefined,
          };
        }
        if (current.key === 'ARC_SCE') {
          const committed = commitArcDefinition(
            'ARC_SCE',
            cadBuildArcFromStartCenterEnd(
              nextPoints[0]!,
              nextPoints[1]!,
              nextPoints[2]!,
              reverseDirectionModifier,
            ),
            {
              startLabel: nextPoints[0]!.label,
              centerLabel: nextPoints[1]!.label,
              endLabel: nextPoints[2]!.label,
            },
          );
          return committed ? null : { ...current, points: nextPoints, resultText: 'ARC SCE invalid. Adjust the points or hold Ctrl to reverse.' };
        }
        if (current.points.length < 2) {
          return {
            ...current,
            points: nextPoints,
            inputValue: '',
            resultText: undefined,
          };
        }
        return {
          ...current,
          resultText: 'This arc mode now needs a typed value. Enter it in the command bar.',
        };
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
        return committed
          ? null
          : { ...current, resultText: 'Continue Curve invalid. Choose a different endpoint or hold Ctrl to reverse.' };
      }
      if (current.key === 'TANGENT_CURVE') {
        if (!current.piPoint) {
          return {
            ...current,
            piPoint: point,
            inputValue: '',
            resultText: undefined,
          };
        }
        if (!current.backTangentPoint) {
          return {
            ...current,
            backTangentPoint: point,
            inputValue: '',
            resultText: undefined,
          };
        }
        if (!current.aheadTangentPoint) {
          return {
            ...current,
            aheadTangentPoint: point,
            inputValue: '',
            resultText: undefined,
          };
        }
        return current;
      }
      if (current.key === 'LINE') {
        if (!current.startPoint) {
          return {
            ...current,
            startPoint: point,
            inputValue: '',
            resultText: undefined,
          };
        }
        const startPoint = current.startPoint;
        setHistory((existing) =>
          runCadCommand(existing, {
            key: 'LINE',
            start: startPoint,
            end: point,
          }),
        );
        return null;
      }
      if (current.key === 'MOVE' || current.key === 'COPY') {
        if (!current.startPoint) {
          return {
            ...current,
            startPoint: point,
            inputValue: '',
            resultText: undefined,
          };
        }
        const deltaX = point.x - current.startPoint.x;
        const deltaY = point.y - current.startPoint.y;
        const transformKey: 'MOVE' | 'COPY' = current.key;
        setHistory((existing) =>
          runCadCommand(existing, {
            key: transformKey,
            deltaX,
            deltaY,
          }),
        );
        return null;
      }
      if (current.key === 'PASTE') {
        const deltaX = point.x - current.startPoint.x;
        const deltaY = point.y - current.startPoint.y;
        setHistory((existing) =>
          runCadCommand(existing, {
            key: 'PASTE',
            deltaX,
            deltaY,
            entityIds: current.sourceEntityIds,
          }),
        );
        return null;
      }
      if (!('startPoint' in current)) {
        return current;
      }
      if (!current.startPoint) {
        return {
          ...current,
          startPoint: point,
          inputValue: '',
          resultText: undefined,
        };
      }
      const inverse = buildCadInverseSummary(current.startPoint, point);
      return {
        ...current,
        startPoint: null,
        inputValue: '',
        resultText: `INVERSE ${current.startPoint.label} -> ${point.label}: distance ${inverse.distance.toFixed(3)}, azimuth ${inverse.azimuthDeg.toFixed(4)} deg, bearing ${inverse.bearing}.`,
      };
    });
  };

  const finishPolylineSession = () => {
    if (!session || session.key !== 'PLINE' || session.points.length < 2) return;
    setHistory((existing) =>
      runCadCommand(existing, {
        key: 'PLINE',
        vertices: session.points,
      }),
    );
    setSession(null);
  };

  const finishTraverseSession = () => {
    if (!session || session.key !== 'TRAVERSE' || session.points.length < 2) return;
    setHistory((existing) =>
      runCadCommand(existing, {
        key: 'TRAVERSE',
        vertices: session.points,
      }),
    );
    setSession(null);
  };

  const submitSessionInput = () => {
    if (!session) return;
    const basePoint =
      session.key === 'PLINE' ||
      session.key === 'TRAVERSE' ||
      session.key === 'ARC_3PT' ||
      session.key === 'ARC_SCE' ||
      session.key === 'ARC_SCA' ||
      session.key === 'ARC_SCL' ||
      session.key === 'ARC_SEA' ||
      session.key === 'ARC_SED' ||
      session.key === 'ARC_SER'
        ? session.points[session.points.length - 1] ?? null
        : session.key === 'CONTINUE_CURVE'
          ? {
              ...cadArcEndPoint(session.sourceArc),
              label: session.sourceArc.id,
            }
        : session.key === 'TANGENT_CURVE'
          ? session.aheadTangentPoint ?? session.backTangentPoint ?? session.piPoint
          : 'startPoint' in session
            ? session.startPoint
            : null;
    if (
      session.key === 'ARC_SCA' ||
      session.key === 'ARC_SCL' ||
      session.key === 'ARC_SEA' ||
      session.key === 'ARC_SED' ||
      session.key === 'ARC_SER'
    ) {
      if (session.points.length < 2) {
        const parsed = parseInputPoint(session.inputValue, basePoint);
        if (!parsed) {
          setSession({
            ...session,
            resultText: 'Arc point input invalid. Use `x,y` or `LABEL=x,y` for the required points.',
          });
          return;
        }
        consumePoint(parsed);
        return;
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
          : session.key === 'ARC_SCL'
            ? cadBuildArcFromStartCenterChord(
                session.points[0]!,
                session.points[1]!,
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
        startLabel: session.points[0]!.label,
        secondLabel: session.points[1]!.label,
      });
      if (committed) {
        setSession(null);
        return;
      }
      setSession({
        ...session,
        resultText:
          session.key === 'ARC_SED'
            ? 'Arc direction invalid. Enter a valid azimuth or survey bearing.'
            : 'Arc value invalid. Enter a valid positive value or hold Ctrl to reverse direction.',
      });
      return;
    }
    if (session.key === 'TANGENT_CURVE' && session.aheadTangentPoint) {
      const piPoint = session.piPoint;
      const backTangentPoint = session.backTangentPoint;
      const aheadTangentPoint = session.aheadTangentPoint;
      if (!piPoint || !backTangentPoint || !aheadTangentPoint) {
        setSession({
          ...session,
          resultText: 'Tangent curve points incomplete. Capture PI, back, and ahead points first.',
        });
        return;
      }
      const radius = Number(session.inputValue.trim());
      if (!Number.isFinite(radius) || radius <= 0) {
        setSession({
          ...session,
          resultText: 'Tangent curve radius invalid. Enter a positive numeric radius.',
        });
        return;
      }
      setHistory((existing) =>
        runCadCommand(existing, {
          key: 'TANGENT_CURVE',
          pi: piPoint,
          backTangentPoint,
          aheadTangentPoint,
          radius,
        }),
      );
      setSession(null);
      return;
    }
    const parsed = parseInputPoint(session.inputValue, basePoint);
    if (!parsed) {
      setSession({
        ...session,
        resultText:
          session.key === 'POINT'
            ? 'POINT input invalid. Use `x,y` or `LABEL=x,y`.'
            : session.key === 'TANGENT_CURVE' && session.aheadTangentPoint
              ? 'Tangent curve radius invalid. Enter a positive numeric radius.'
              : 'Command input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
      });
      return;
    }
    consumePoint(parsed);
  };

  const handleEnterKey = () => {
    if (!session) return;
    if (session.key === 'PLINE' && session.inputValue.trim().length === 0 && session.points.length >= 2) {
      finishPolylineSession();
      return;
    }
    if (session.key === 'TRAVERSE' && session.inputValue.trim().length === 0 && session.points.length >= 2) {
      finishTraverseSession();
      return;
    }
    if (session.inputValue.trim().length === 0) return;
    submitSessionInput();
  };

  const handleEscapeKey = () => {
    setSession(null);
  };

  return {
    activeCommandKey: session?.key ?? null,
    commandInputValue: session?.inputValue ?? '',
    commandPrompt: statusPrompt,
    commandHelpText: helpText,
    commandPreview,
    canUseActiveSnap:
      activeSnap != null &&
      session != null &&
      !(session.key === 'TANGENT_CURVE' && session.aheadTangentPoint != null),
    canFinishCommand:
      (session?.key === 'PLINE' || session?.key === 'TRAVERSE') &&
      session.points.length >= 2,
    startPointCommand: () => setSession({ key: 'POINT', inputValue: '' }),
    startCogoPointCommand: () =>
      setSession({
        key: 'COGO_POINT',
        inputValue: '',
        startPoint: null,
      }),
    startLineCommand: () =>
      setSession({
        key: 'LINE',
        inputValue: '',
        startPoint: null,
      }),
    startPolylineCommand: () =>
      setSession({
        key: 'PLINE',
        inputValue: '',
        points: [],
      }),
    startTraverseCommand: () =>
      setSession({
        key: 'TRAVERSE',
        inputValue: '',
        points: [],
      }),
    startArc3PointCommand: () =>
      setSession({
        key: 'ARC_3PT',
        inputValue: '',
        points: [],
      }),
    startArcStartCenterEndCommand: () =>
      setSession({
        key: 'ARC_SCE',
        inputValue: '',
        points: [],
      }),
    startArcStartCenterAngleCommand: () =>
      setSession({
        key: 'ARC_SCA',
        inputValue: '',
        points: [],
      }),
    startArcStartCenterChordCommand: () =>
      setSession({
        key: 'ARC_SCL',
        inputValue: '',
        points: [],
      }),
    startArcStartEndAngleCommand: () =>
      setSession({
        key: 'ARC_SEA',
        inputValue: '',
        points: [],
      }),
    startArcStartEndDirectionCommand: () =>
      setSession({
        key: 'ARC_SED',
        inputValue: '',
        points: [],
      }),
    startArcStartEndRadiusCommand: () =>
      setSession({
        key: 'ARC_SER',
        inputValue: '',
        points: [],
      }),
    startContinueCurveCommand: () => {
      if (!selectedArcForContinue) return;
      setSession({
        key: 'CONTINUE_CURVE',
        inputValue: '',
        sourceArc: selectedArcForContinue,
      });
    },
    startTangentCurveCommand: () =>
      setSession({
        key: 'TANGENT_CURVE',
        inputValue: '',
        piPoint: null,
        backTangentPoint: null,
        aheadTangentPoint: null,
      }),
    startInverseCommand: () =>
      setSession({
        key: 'INVERSE',
        inputValue: '',
        startPoint: null,
      }),
    startMoveCommand: () => {
      if (selectionCount === 0) return;
      setSession({
        key: 'MOVE',
        inputValue: '',
        startPoint: null,
      });
    },
    startCopyCommand: () => {
      if (selectionCount === 0) return;
      setSession({
        key: 'COPY',
        inputValue: '',
        startPoint: null,
      });
    },
    startPasteCommand: (sourceEntityIds, basePoint) => {
      if (sourceEntityIds.length === 0) return;
      setSession({
        key: 'PASTE',
        inputValue: '',
        startPoint: basePoint,
        sourceEntityIds,
      });
    },
    cancelCommand: () => setSession(null),
    finishCommand: () => {
      if (session?.key === 'PLINE') {
        finishPolylineSession();
        return;
      }
      if (session?.key === 'TRAVERSE') {
        finishTraverseSession();
      }
    },
    setCommandInputValue: (value) =>
      setSession((current) => (current ? { ...current, inputValue: value, resultText: undefined } : current)),
    appendCommandInputValue: (value) =>
      setSession((current) =>
        current ? { ...current, inputValue: `${current.inputValue}${value}`, resultText: undefined } : current,
      ),
    backspaceCommandInputValue: () =>
      setSession((current) =>
        current
          ? { ...current, inputValue: current.inputValue.slice(0, -1), resultText: undefined }
          : current,
      ),
    submitCommandInput: submitSessionInput,
    useActiveSnap: () => {
      if (!activeSnap) return;
      consumePoint(
        {
          x: activeSnap.x,
          y: activeSnap.y,
          label: activeSnap.label,
        },
        { suppressPointLabel: true },
      );
    },
    consumeInteractionPoint: (point, label) => {
      if (!session) return;
      consumePoint(
        {
          x: point.x,
          y: point.y,
          label: label ?? `${point.x.toFixed(3)},${point.y.toFixed(3)}`,
        },
        { suppressPointLabel: true },
      );
    },
    handleEnterKey,
    handleEscapeKey,
  };
};
