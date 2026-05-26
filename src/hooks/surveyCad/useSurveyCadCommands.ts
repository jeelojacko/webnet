import type { Dispatch, SetStateAction } from 'react';
import { useMemo, useState } from 'react';
import {
  cadAzimuthDeg,
  cadDistance,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  type CadNamedPoint,
} from '../../engine/cad/cadGeometry';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadSnapCandidate } from '../../engine/cad/cadTypes';

type ActiveCommandKey = 'POINT' | 'LINE' | 'PLINE' | 'INVERSE' | 'MOVE' | 'COPY';

type CommandSession =
  | {
      key: 'POINT';
      inputValue: string;
      resultText?: string;
    }
  | {
      key: 'LINE' | 'INVERSE' | 'MOVE' | 'COPY';
      inputValue: string;
      startPoint: CadNamedPoint | null;
      resultText?: string;
    }
  | {
      key: 'PLINE';
      inputValue: string;
      points: CadNamedPoint[];
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
  startLineCommand: () => void;
  startPolylineCommand: () => void;
  startInverseCommand: () => void;
  startMoveCommand: () => void;
  startCopyCommand: () => void;
  cancelCommand: () => void;
  finishCommand: () => void;
  setCommandInputValue: (_value: string) => void;
  submitCommandInput: () => void;
  useActiveSnap: () => void;
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
  const point = cadPointFromAzimuthDistance(basePoint, azimuthDeg, distance);
  return {
    ...point,
    label: label || `${prefixed ? '@' : ''}${directionToken},${distance}`,
  };
};

const promptForSession = (session: CommandSession | null, fallbackStatus: string): string => {
  if (!session) return fallbackStatus;
  switch (session.key) {
    case 'POINT':
      return session.resultText ?? 'POINT active. Enter `x,y` or `LABEL=x,y`, then Submit. Hover geometry and Use Snap also works.';
    case 'LINE':
      return session.resultText ??
        (session.startPoint
          ? `LINE active. Start at ${session.startPoint.label}. Enter end \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`, then Submit.`
          : 'LINE active. Enter or snap the start point.');
    case 'PLINE':
      return session.resultText ??
        (session.points.length > 0
          ? `PLINE active. ${session.points.length} vertex${session.points.length === 1 ? '' : 'es'} captured. Submit next point, then Finish when ready.`
          : 'PLINE active. Enter or snap the first vertex.');
    case 'INVERSE':
      return session.resultText ??
        (session.startPoint
          ? `INVERSE active. Start at ${session.startPoint.label}. Enter end \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`, then Submit.`
          : 'INVERSE active. Enter or snap the first point.');
    case 'MOVE':
      return session.resultText ??
        (session.startPoint
          ? `MOVE active. Base point ${session.startPoint.label} captured. Enter target point, \`@azimuth,distance\`, or bearing-distance, then Submit.`
          : 'MOVE active. Enter or snap the base point for the current selection.');
    case 'COPY':
      return session.resultText ??
        (session.startPoint
          ? `COPY active. Base point ${session.startPoint.label} captured. Enter target point, \`@azimuth,distance\`, or bearing-distance, then Submit.`
          : 'COPY active. Enter or snap the base point for the current selection.');
  }
};

const helpTextForSession = (session: CommandSession | null): string => {
  if (!session) {
    return 'Interactive commands accept `x,y`, optional `LABEL=x,y`, `@azimuth,distance`, and survey bearing-distance like `N45-00-00E,100`.';
  }
  switch (session.key) {
    case 'POINT':
      return 'POINT input: `x,y` or `LABEL=x,y`. `Use Snap` creates a new manual point at the hovered snap location.';
    case 'LINE':
      return session.startPoint
        ? 'LINE second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or `N45-00-00E,100` from the first point.'
        : 'LINE first point: `x,y`, `LABEL=x,y`, or hover geometry then `Use Snap`.';
    case 'PLINE':
      return session.points.length > 0
        ? 'PLINE next vertex: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the last vertex. Use `Finish PLINE` after at least 2 vertices.'
        : 'PLINE first vertex: `x,y`, `LABEL=x,y`, or hover geometry then `Use Snap`.';
    case 'INVERSE':
      return session.startPoint
        ? 'INVERSE second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the first point.'
        : 'INVERSE first point: `x,y`, `LABEL=x,y`, or hover geometry then `Use Snap`.';
    case 'MOVE':
      return session.startPoint
        ? 'MOVE target point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the base point.'
        : 'MOVE base point: `x,y`, `LABEL=x,y`, or hover geometry then `Use Snap`.';
    case 'COPY':
      return session.startPoint
        ? 'COPY target point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the base point.'
        : 'COPY base point: `x,y`, `LABEL=x,y`, or hover geometry then `Use Snap`.';
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

  const consumePoint = (point: CadNamedPoint, fromSnap = false) => {
    setSession((current) => {
      if (!current) return current;
      if (current.key === 'POINT') {
        setHistory((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: point.x,
            y: point.y,
            label: fromSnap ? undefined : point.label,
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
      const distance = cadDistance(current.startPoint, point);
      const azimuthDeg = cadAzimuthDeg(current.startPoint, point);
      return {
        ...current,
        startPoint: null,
        inputValue: '',
        resultText: `INVERSE ${current.startPoint.label} -> ${point.label}: distance ${distance.toFixed(3)}, azimuth ${azimuthDeg.toFixed(4)} deg.`,
      };
    });
  };

  return {
    activeCommandKey: session?.key ?? null,
    commandInputValue: session?.inputValue ?? '',
    commandPrompt: statusPrompt,
    commandHelpText: helpText,
    canUseActiveSnap: activeSnap != null && session != null,
    canFinishCommand: session?.key === 'PLINE' && session.points.length >= 2,
    startPointCommand: () => setSession({ key: 'POINT', inputValue: '' }),
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
    finishCommand: () => {
      if (!session || session.key !== 'PLINE' || session.points.length < 2) return;
      setHistory((existing) =>
        runCadCommand(existing, {
          key: 'PLINE',
          vertices: session.points,
        }),
      );
      setSession(null);
    },
    setCommandInputValue: (value) =>
      setSession((current) => (current ? { ...current, inputValue: value, resultText: undefined } : current)),
    submitCommandInput: () => {
      if (!session) return;
      const basePoint =
        session.key === 'PLINE'
          ? session.points[session.points.length - 1] ?? null
          : 'startPoint' in session
            ? session.startPoint
            : null;
      const parsed = parseInputPoint(session.inputValue, basePoint);
      if (!parsed) {
        setSession({
          ...session,
          resultText:
            session.key === 'POINT'
              ? 'POINT input invalid. Use `x,y` or `LABEL=x,y`.'
              : 'Command input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
        });
        return;
      }
      consumePoint(parsed);
    },
    useActiveSnap: () => {
      if (!activeSnap) return;
      consumePoint(
        {
          x: activeSnap.x,
          y: activeSnap.y,
          label: activeSnap.label,
        },
        true,
      );
    },
  };
};
