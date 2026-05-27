import type { Dispatch, SetStateAction } from 'react';
import { useMemo, useState } from 'react';
import {
  buildCadInverseSummary,
  cadPointFromBearingDistance,
} from '../../engine/cad/cadCogo';
import { cadParseBearingDegrees, cadPointFromAzimuthDistance, type CadNamedPoint } from '../../engine/cad/cadGeometry';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadSnapCandidate } from '../../engine/cad/cadTypes';

type ActiveCommandKey =
  | 'POINT'
  | 'COGO_POINT'
  | 'LINE'
  | 'PLINE'
  | 'ARC_3PT'
  | 'TANGENT_CURVE'
  | 'INVERSE'
  | 'MOVE'
  | 'COPY';

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
      key: 'PLINE';
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
      key: 'TANGENT_CURVE';
      inputValue: string;
      piPoint: CadNamedPoint | null;
      backTangentPoint: CadNamedPoint | null;
      aheadTangentPoint: CadNamedPoint | null;
      resultText?: string;
    };

interface UseSurveyCadCommandsArgs {
  activeSnap: CadSnapCandidate | null;
  history: CadHistoryState;
  selectionCount: number;
  setHistory: Dispatch<SetStateAction<CadHistoryState>>;
}

interface UseSurveyCadCommandsResult {
  activeCommandKey: ActiveCommandKey | null;
  commandInputValue: string;
  commandPrompt: string;
  commandHelpText: string;
  canUseActiveSnap: boolean;
  canFinishCommand: boolean;
  startPointCommand: () => void;
  startCogoPointCommand: () => void;
  startLineCommand: () => void;
  startPolylineCommand: () => void;
  startArc3PointCommand: () => void;
  startTangentCurveCommand: () => void;
  startInverseCommand: () => void;
  startMoveCommand: () => void;
  startCopyCommand: () => void;
  cancelCommand: () => void;
  finishCommand: () => void;
  setCommandInputValue: (_value: string) => void;
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
    case 'ARC_3PT':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC_3PT active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC_3PT active. Start ${session.points[0].label} captured. Enter the through point.`
            : `ARC_3PT active. Start ${session.points[0].label} and through ${session.points[1]?.label} captured. Enter the end point.`);
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
    case 'ARC_3PT':
      return session.points.length < 2
        ? 'ARC 3PT point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC 3PT end point: click in the model space or type `x,y` / `LABEL=x,y` to commit the arc.';
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
  }
};

export const useSurveyCadCommands = ({
  activeSnap,
  history,
  selectionCount,
  setHistory,
}: UseSurveyCadCommandsArgs): UseSurveyCadCommandsResult => {
  const [session, setSession] = useState<CommandSession | null>(null);

  const statusPrompt = useMemo(
    () => promptForSession(session, history.commandState.prompt),
    [history.commandState.prompt, session],
  );
  const helpText = useMemo(() => helpTextForSession(session), [session]);

  const parseInputPoint = (inputValue: string, basePoint: CadNamedPoint | null): CadNamedPoint | null =>
    parseRelativeBearingDistance(inputValue, basePoint) ?? parseAbsolutePoint(inputValue);

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
      if (current.key === 'PLINE') {
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

  const submitSessionInput = () => {
    if (!session) return;
    const basePoint =
      session.key === 'PLINE' || session.key === 'ARC_3PT'
        ? session.points[session.points.length - 1] ?? null
        : session.key === 'TANGENT_CURVE'
          ? session.aheadTangentPoint ?? session.backTangentPoint ?? session.piPoint
          : 'startPoint' in session
            ? session.startPoint
            : null;
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
    canUseActiveSnap:
      activeSnap != null &&
      session != null &&
      !(session.key === 'TANGENT_CURVE' && session.aheadTangentPoint != null),
    canFinishCommand: session?.key === 'PLINE' && session.points.length >= 2,
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
    startArc3PointCommand: () =>
      setSession({
        key: 'ARC_3PT',
        inputValue: '',
        points: [],
      }),
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
    cancelCommand: () => setSession(null),
    finishCommand: finishPolylineSession,
    setCommandInputValue: (value) =>
      setSession((current) => (current ? { ...current, inputValue: value, resultText: undefined } : current)),
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
