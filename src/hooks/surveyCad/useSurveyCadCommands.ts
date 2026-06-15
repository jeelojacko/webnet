import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCadInverseSummary,
  formatCadBearing,
  cadPointFromBearingDistance,
} from '../../engine/cad/cadCogo';
import { buildCadCogoComputation } from '../../engine/cad/cadCogoTypes';
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
import type {
  CadArcEntity,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
} from '../../engine/cad/cadTypes';

type CommandPoint = CadNamedPoint & {
  snapSourceSegmentId?: string;
  snapSourceEntityId?: string;
  snapKind?: CadSnapKind;
};

type ActiveCommandKey =
  | 'POINT'
  | 'COGO_POINT'
  | 'LINE'
  | 'PLINE'
  | 'TRAVERSE'
  | 'ARC_3PT'
  | 'ARC_SCE'
  | 'ARC_CSE'
  | 'ARC_SCA'
  | 'ARC_CSA'
  | 'ARC_SCL'
  | 'ARC_CSL'
  | 'ARC_SEA'
  | 'ARC_SED'
  | 'ARC_SER'
  | 'CONTINUE_CURVE'
  | 'TANGENT_CURVE'
  | 'INVERSE'
  | 'MOVE'
  | 'COPY'
  | 'TRIM'
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
      startPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'PASTE';
      inputValue: string;
      startPoint: CommandPoint;
      sourceEntityIds: string[];
      resultText?: string;
    }
  | {
      key: 'TRIM';
      inputValue: string;
      cuttingEntityIds: string[];
      resultText?: string;
    }
  | {
      key: 'PLINE';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key: 'TRAVERSE';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key: 'ARC_3PT';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key:
        | 'ARC_SCE'
        | 'ARC_CSE'
        | 'ARC_SCA'
        | 'ARC_CSA'
        | 'ARC_SCL'
        | 'ARC_CSL'
        | 'ARC_SEA'
        | 'ARC_SED'
        | 'ARC_SER';
      inputValue: string;
      points: CommandPoint[];
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
      piPoint: CommandPoint | null;
      backTangentPoint: CommandPoint | null;
      aheadTangentPoint: CommandPoint | null;
      resultText?: string;
    };

interface UseSurveyCadCommandsArgs {
  activeSnap: CadSnapCandidate | null;
  previewPoint: { x: number; y: number; label: string } | null;
  history: CadHistoryState;
  selectionCount: number;
  trimCuttingEntityIds: string[];
  selectedArcForContinue: CadArcEntity | null;
  reverseDirectionModifier: boolean;
  applyHistoryUpdate: (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
  onReportComputation?: (
    _computation: ReturnType<typeof buildCadCogoComputation> | null,
  ) => void;
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
  snapConstructionContext: CadSnapConstructionContext;
  commandExpectsPointPick: boolean;
  canUseActiveSnap: boolean;
  canCycleActiveSnap: boolean;
  canFinishCommand: boolean;
  startPointCommand: () => void;
  startCogoPointCommand: () => void;
  startLineCommand: () => void;
  startPolylineCommand: () => void;
  startTraverseCommand: () => void;
  startArc3PointCommand: () => void;
  startArcStartCenterEndCommand: () => void;
  startArcCenterStartEndCommand: () => void;
  startArcStartCenterAngleCommand: () => void;
  startArcCenterStartAngleCommand: () => void;
  startArcStartCenterChordCommand: () => void;
  startArcCenterStartChordCommand: () => void;
  startArcStartEndAngleCommand: () => void;
  startArcStartEndDirectionCommand: () => void;
  startArcStartEndRadiusCommand: () => void;
  startContinueCurveCommand: () => void;
  startTangentCurveCommand: () => void;
  startInverseCommand: () => void;
  startMoveCommand: () => void;
  startCopyCommand: () => void;
  startTrimCommand: () => void;
  startPasteCommand: (_sourceEntityIds: string[], _basePoint: CommandPoint) => void;
  cancelCommand: () => void;
  finishCommand: () => void;
  setCommandInputValue: (_value: string) => void;
  appendCommandInputValue: (_value: string) => void;
  backspaceCommandInputValue: () => void;
  submitCommandInput: () => void;
  useActiveSnap: () => void;
  consumeInteractionPoint: (
    _point: { x: number; y: number },
    _label?: string,
    _options?: { snapSourceSegmentId?: string; snapSourceEntityId?: string; snapKind?: CadSnapKind },
  ) => void;
  handleEnterKey: () => void;
  handleEscapeKey: () => void;
}

const isNumeric = (value: string): boolean => value.trim().length > 0 && Number.isFinite(Number(value));

const ARC_TANGENT_SEED_KINDS = new Set<CadSnapKind>([
  'nearest',
  'endpoint',
  'arc-midpoint',
  'quadrant',
  'center',
]);

const tangentSeedArcEntityIdFromPoint = (point: CommandPoint | null): string | null => {
  if (!point?.snapSourceEntityId || !point.snapKind) return null;
  if (!ARC_TANGENT_SEED_KINDS.has(point.snapKind)) return null;
  return point.snapSourceEntityId;
};

const tangentSeedPointFromPoint = (
  point: CommandPoint | null,
): { x: number; y: number } | null =>
  tangentSeedArcEntityIdFromPoint(point) ? { x: point!.x, y: point!.y } : null;

const sessionExpectsPointPick = (session: CommandSession | null): boolean => {
  if (!session) return false;
  switch (session.key) {
    case 'POINT':
    case 'COGO_POINT':
    case 'LINE':
    case 'INVERSE':
    case 'MOVE':
    case 'COPY':
    case 'TRIM':
    case 'PASTE':
    case 'PLINE':
    case 'TRAVERSE':
    case 'ARC_3PT':
    case 'CONTINUE_CURVE':
      return true;
    case 'ARC_SCE':
    case 'ARC_CSE':
      return session.points.length < 3;
    case 'ARC_SCA':
    case 'ARC_CSA':
    case 'ARC_SCL':
    case 'ARC_CSL':
    case 'ARC_SEA':
    case 'ARC_SED':
    case 'ARC_SER':
      return session.points.length < 2;
    case 'TANGENT_CURVE':
      return session.aheadTangentPoint == null;
  }
};

const splitLabelFromBody = (token: string): { label?: string; body: string } => {
  const normalized = token.trim();
  const labelIndex = normalized.indexOf('=');
  if (labelIndex < 0) return { body: normalized };
  return {
    label: normalized.slice(0, labelIndex).trim() || undefined,
    body: normalized.slice(labelIndex + 1).trim(),
  };
};

const parseAbsolutePoint = (token: string): CommandPoint | null => {
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
  basePoint: CommandPoint | null,
): CommandPoint | null => {
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
    case 'ARC_CSE':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC CSE active. Click or enter the center point.'
          : session.points.length === 1
            ? `ARC CSE active. Center ${session.points[0].label} captured. Enter the start point.`
            : `ARC CSE active. Center ${session.points[0].label} and start ${session.points[1]?.label} captured. Enter the end point.`);
    case 'ARC_SCA':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC SCA active. Click or enter the start point.'
              : `ARC SCA active. Start ${session.points[0].label} captured. Enter the center point.`)
          : `ARC SCA active. Enter the included angle in degrees.${''}`);
    case 'ARC_CSA':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC CSA active. Click or enter the center point.'
              : `ARC CSA active. Center ${session.points[0].label} captured. Enter the start point.`)
          : 'ARC CSA active. Enter the included angle in degrees.');
    case 'ARC_SCL':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC SCL active. Click or enter the start point.'
              : `ARC SCL active. Start ${session.points[0].label} captured. Enter the center point.`)
          : 'ARC SCL active. Enter the chord length.');
    case 'ARC_CSL':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC CSL active. Click or enter the center point.'
              : `ARC CSL active. Center ${session.points[0].label} captured. Enter the start point.`)
          : 'ARC CSL active. Enter the chord length.');
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
    case 'TRIM':
      return session.resultText ??
        `TRIM active. ${session.cuttingEntityIds.length} cutting edge${session.cuttingEntityIds.length === 1 ? '' : 's'} selected. Click line, polyline, or arc portion to remove. Enter or Esc ends the command.`;
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
        ? 'ARC 3PT point input: click in the model space or type `x,y` / `LABEL=x,y`. The through point fixes the arc side, so Ctrl flip is not used here.'
        : 'ARC 3PT end point: click in the model space or type `x,y` / `LABEL=x,y` to commit the arc. The through point fixes the arc side, so Ctrl flip is not used here.';
    case 'ARC_SCE':
      return session.points.length < 2
        ? 'ARC Start-Center-End point input: click in the model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.'
        : 'ARC Start-Center-End end point input: click in model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.';
    case 'ARC_CSE':
      return session.points.length < 2
        ? 'ARC Center-Start-End point input: click in the model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.'
        : 'ARC Center-Start-End end point input: click in model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.';
    case 'ARC_SCA':
      return session.points.length < 2
        ? 'ARC Start-Center-Angle point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-Center-Angle value input: enter a positive included angle in degrees. Hold Ctrl to reverse direction.';
    case 'ARC_CSA':
      return session.points.length < 2
        ? 'ARC Center-Start-Angle point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Center-Start-Angle value input: enter a positive included angle in degrees. Hold Ctrl to reverse direction.';
    case 'ARC_SCL':
      return session.points.length < 2
        ? 'ARC Start-Center-Length point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-Center-Length value input: enter a positive chord length. Hold Ctrl to reverse direction.';
    case 'ARC_CSL':
      return session.points.length < 2
        ? 'ARC Center-Start-Length point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Center-Start-Length value input: enter a positive chord length. Hold Ctrl to reverse direction.';
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
    case 'TRIM':
      return 'TRIM uses current selected line/polyline/arc entities as cutting edges. Click the side of another line/polyline/arc to remove. Enter or Esc ends the trim loop.';
    case 'PASTE':
      return 'PASTE insertion point: click in the model space or type `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the clipboard base point.';
  }
};

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

export const useSurveyCadCommands = ({
  activeSnap,
  previewPoint,
  history,
  selectionCount,
  trimCuttingEntityIds,
  selectedArcForContinue,
  reverseDirectionModifier,
  applyHistoryUpdate,
  onReportComputation,
}: UseSurveyCadCommandsArgs): UseSurveyCadCommandsResult => {
  const [session, setSession] = useState<CommandSession | null>(null);
  const sessionRef = useRef<CommandSession | null>(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const replaceSession = (nextSession: CommandSession | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
  };

  const updateSession = (
    updater: (_session: CommandSession | null) => CommandSession | null,
  ) => {
    const nextSession = updater(sessionRef.current);
    replaceSession(nextSession);
  };

  const beginSession = (nextSession: CommandSession) => {
    onReportComputation?.(null);
    replaceSession(nextSession);
  };

  const statusPrompt = useMemo(
    () => promptForSession(session, history.commandState.prompt),
    [history.commandState.prompt, session],
  );
  const helpText = useMemo(() => helpTextForSession(session), [session]);
  const commandExpectsPointPick = useMemo(() => sessionExpectsPointPick(session), [session]);
  const snapConstructionContext = useMemo<CadSnapConstructionContext>(() => {
    if (!session) {
      return { active: false, basePoint: null };
    }
    switch (session.key) {
      case 'POINT':
        return { active: false, basePoint: null };
      case 'COGO_POINT':
      case 'LINE':
      case 'INVERSE':
        return session.startPoint
          ? {
              active: true,
              basePoint: { x: session.startPoint.x, y: session.startPoint.y },
              scopeSeedSegmentId: session.startPoint.snapSourceSegmentId ?? null,
              tangentSeedArcEntityId: tangentSeedArcEntityIdFromPoint(session.startPoint),
              tangentSeedPoint: tangentSeedPointFromPoint(session.startPoint),
            }
          : { active: false, basePoint: null };
      case 'MOVE':
      case 'COPY':
      case 'TRIM':
        return { active: false, basePoint: null };
      case 'PASTE':
        return {
          active: true,
          basePoint: { x: session.startPoint.x, y: session.startPoint.y },
          scopeSeedSegmentId: session.startPoint.snapSourceSegmentId ?? null,
          tangentSeedArcEntityId: tangentSeedArcEntityIdFromPoint(session.startPoint),
          tangentSeedPoint: tangentSeedPointFromPoint(session.startPoint),
        };
      case 'PLINE':
      case 'TRAVERSE':
      case 'ARC_3PT':
        return session.points.length > 0
          ? {
              active: true,
              basePoint: {
                x: session.points[session.points.length - 1]!.x,
                y: session.points[session.points.length - 1]!.y,
              },
              tangentSeedArcEntityId: tangentSeedArcEntityIdFromPoint(
                session.points[session.points.length - 1]!,
              ),
              tangentSeedPoint: tangentSeedPointFromPoint(
                session.points[session.points.length - 1]!,
              ),
            }
          : { active: false, basePoint: null };
      case 'ARC_SCE':
      case 'ARC_CSE':
        return session.points.length < 3 && session.points.length > 0
          ? {
              active: true,
              basePoint: {
                x: session.points[session.points.length - 1]!.x,
                y: session.points[session.points.length - 1]!.y,
              },
              tangentSeedArcEntityId: tangentSeedArcEntityIdFromPoint(
                session.points[session.points.length - 1]!,
              ),
              tangentSeedPoint: tangentSeedPointFromPoint(
                session.points[session.points.length - 1]!,
              ),
            }
          : { active: false, basePoint: null };
      case 'ARC_SCA':
      case 'ARC_CSA':
      case 'ARC_SCL':
      case 'ARC_CSL':
      case 'ARC_SEA':
      case 'ARC_SED':
      case 'ARC_SER':
        return session.points.length < 2 && session.points.length > 0
          ? {
              active: true,
              basePoint: {
                x: session.points[session.points.length - 1]!.x,
                y: session.points[session.points.length - 1]!.y,
              },
            }
          : { active: false, basePoint: null };
      case 'CONTINUE_CURVE': {
        const endPoint = cadArcEndPoint(session.sourceArc);
        return {
          active: true,
          basePoint: endPoint,
          tangentSeedArcEntityId: session.sourceArc.id,
          tangentSeedPoint: endPoint,
        };
      }
      case 'TANGENT_CURVE':
        return session.aheadTangentPoint == null
          ? session.backTangentPoint
            ? { active: true, basePoint: { x: session.backTangentPoint.x, y: session.backTangentPoint.y } }
            : session.piPoint
              ? { active: true, basePoint: { x: session.piPoint.x, y: session.piPoint.y } }
              : { active: false, basePoint: null }
          : { active: false, basePoint: null };
    }
  }, [session]);
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
      case 'ARC_CSE':
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
          const previewArc =
            session.key === 'ARC_SCE'
              ? cadBuildArcFromStartCenterEnd(
                  session.points[0],
                  session.points[1],
                  previewPoint,
                  reverseDirectionModifier,
                )
              : buildCenterFirstArcDefinition(
                  'ARC_CSE',
                  [...session.points, previewPoint as CadNamedPoint],
                  null,
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
      case 'ARC_CSA':
      case 'ARC_SCL':
      case 'ARC_CSL':
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
            : session.key === 'ARC_CSA'
              ? buildCenterFirstArcDefinition(
                  'ARC_CSA',
                  session.points,
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
              : session.key === 'ARC_CSL'
                ? buildCenterFirstArcDefinition(
                    'ARC_CSL',
                    session.points,
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
      case 'TRIM':
        if (!previewPoint) return null;
        if (session.key === 'TRIM') {
          return null;
        }
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

const parseInputPoint = (inputValue: string, basePoint: CommandPoint | null): CommandPoint | null =>
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
    applyHistoryUpdate((existing) =>
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
    point: CommandPoint,
    options?: { suppressPointLabel?: boolean },
  ) => {
    const current = sessionRef.current;
    if (!current) return;
    if (current.key === 'POINT') {
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: point.x,
          y: point.y,
          label: options?.suppressPointLabel ? undefined : point.label,
        }),
      );
      replaceSession(null);
      return;
    }
    if (current.key === 'COGO_POINT') {
      if (!current.startPoint) {
        replaceSession({
          ...current,
          startPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      const directionLabel = current.inputValue.trim() || point.label;
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'COGO_POINT',
          x: point.x,
          y: point.y,
          basisLabel: current.startPoint!.label,
          directionLabel,
        }),
      );
      replaceSession(null);
      return;
    }
    if (current.key === 'PLINE' || current.key === 'TRAVERSE') {
      replaceSession({
        ...current,
        points: [...current.points, point],
        inputValue: '',
        resultText: undefined,
      });
      return;
    }
    if (current.key === 'ARC_3PT') {
      const nextPoints = [...current.points, point];
      if (nextPoints.length < 3) {
        replaceSession({
          ...current,
          points: nextPoints,
          inputValue: '',
          resultText: undefined,
        });
        return;
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
      return;
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
        return;
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
            : buildCenterFirstArcDefinition('ARC_CSE', nextPoints, null, reverseDirectionModifier),
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
        return;
      }
      if (current.points.length < 2) {
        replaceSession({
          ...current,
          points: nextPoints,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      replaceSession({
        ...current,
        resultText: 'This arc mode now needs a typed value. Enter it in the command bar.',
      });
      return;
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
      return;
    }
    if (current.key === 'TANGENT_CURVE') {
      if (!current.piPoint) {
        replaceSession({
          ...current,
          piPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      if (!current.backTangentPoint) {
        replaceSession({
          ...current,
          backTangentPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      if (!current.aheadTangentPoint) {
        replaceSession({
          ...current,
          aheadTangentPoint: point,
          inputValue: '',
          resultText: undefined,
        });
      }
      return;
    }
    if (current.key === 'LINE') {
      if (!current.startPoint) {
        replaceSession({
          ...current,
          startPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      const startPoint = current.startPoint;
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'LINE',
          start: startPoint,
          end: point,
        }),
      );
      replaceSession(null);
      return;
    }
    if (current.key === 'MOVE' || current.key === 'COPY') {
      if (!current.startPoint) {
        replaceSession({
          ...current,
          startPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
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
      return;
    }
    if (current.key === 'TRIM') {
      const targetEntityId = point.snapSourceEntityId;
      if (!targetEntityId) {
        replaceSession({
          ...current,
          resultText: 'TRIM needs a direct line, polyline, or arc body click. Background points do not trim.',
        });
        return;
      }
      let committed = false;
      applyHistoryUpdate((existing) => {
        const next = runCadCommand(existing, {
          key: 'TRIM',
          cuttingEntityIds: current.cuttingEntityIds,
          targetEntityId,
          pickPoint: { x: point.x, y: point.y },
          targetSegmentId: point.snapSourceSegmentId,
        });
        committed = next !== existing;
        return next;
      });
      replaceSession({
        ...current,
        inputValue: '',
        resultText: committed
          ? `TRIM committed on ${targetEntityId}. Click another object side to keep trimming, or press Enter/Esc to finish.`
          : current.cuttingEntityIds.includes(targetEntityId)
            ? 'TRIM ignored selected cutting edge. Click a different line, polyline, or arc to trim.'
            : `TRIM found no removable span on ${targetEntityId}. Check cutting-edge selection and click a different side.`,
      });
      return;
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
      return;
    }
    if (!('startPoint' in current)) return;
    if (!current.startPoint) {
      replaceSession({
        ...current,
        startPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return;
    }
    const inverse = buildCadInverseSummary(current.startPoint, point);
    onReportComputation?.(
      buildCadCogoComputation({
        createdEntities: [],
        report: {
          title: 'Inverse',
          summary: `Computed inverse from ${current.startPoint.label} to ${point.label}`,
          rows: [
            { label: 'From', value: current.startPoint.label },
            { label: 'To', value: point.label },
            { label: 'Distance', value: inverse.distance.toFixed(3), unit: 'm' },
            { label: 'Azimuth', value: inverse.azimuthDeg.toFixed(4), unit: 'deg' },
            { label: 'Bearing', value: formatCadBearing(inverse.azimuthDeg) },
          ],
        },
        warnings: [],
        provenance: {
          id: `inverse:${current.startPoint.label}:${point.label}:${inverse.distance.toFixed(6)}:${inverse.azimuthDeg.toFixed(6)}`,
          toolKey: 'INVERSE',
          inputs: {
            from: current.startPoint,
            to: point,
          },
          resultSummary: `Inverse ${current.startPoint.label} to ${point.label}`,
          createdAtIso: new Date().toISOString(),
        },
      }),
    );
    replaceSession({
      ...current,
      startPoint: null,
      inputValue: '',
      resultText: `INVERSE ${current.startPoint.label} -> ${point.label}: distance ${inverse.distance.toFixed(3)}, azimuth ${inverse.azimuthDeg.toFixed(4)} deg, bearing ${inverse.bearing}.`,
    });
  };

  const finishPolylineSession = () => {
    if (!session || session.key !== 'PLINE' || session.points.length < 2) return;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'PLINE',
        vertices: session.points,
      }),
    );
    replaceSession(null);
  };

  const finishTraverseSession = () => {
    if (!session || session.key !== 'TRAVERSE' || session.points.length < 2) return;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'TRAVERSE',
        vertices: session.points,
      }),
    );
    replaceSession(null);
  };

  const submitSessionInput = () => {
    if (!session) return;
    const basePoint =
      session.key === 'PLINE' ||
      session.key === 'TRAVERSE' ||
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
      session.key === 'ARC_CSA' ||
      session.key === 'ARC_SCL' ||
      session.key === 'ARC_CSL' ||
      session.key === 'ARC_SEA' ||
      session.key === 'ARC_SED' ||
      session.key === 'ARC_SER'
    ) {
      if (session.points.length < 2) {
        const parsed = parseInputPoint(session.inputValue, basePoint);
        if (!parsed) {
          replaceSession({
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
        return;
      }
      replaceSession({
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
        replaceSession({
          ...session,
          resultText: 'Tangent curve points incomplete. Capture PI, back, and ahead points first.',
        });
        return;
      }
      const radius = Number(session.inputValue.trim());
      if (!Number.isFinite(radius) || radius <= 0) {
        replaceSession({
          ...session,
          resultText: 'Tangent curve radius invalid. Enter a positive numeric radius.',
        });
        return;
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
      return;
    }
    const parsed = parseInputPoint(session.inputValue, basePoint);
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
      return;
    }
    consumePoint(parsed);
  };

  const handleEnterKey = () => {
    if (!session) return;
    if (session.key === 'TRIM') {
      replaceSession(null);
      return;
    }
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
    replaceSession(null);
  };

  return {
    activeCommandKey: session?.key ?? null,
    commandInputValue: session?.inputValue ?? '',
    commandPrompt: statusPrompt,
    commandHelpText: helpText,
    commandPreview,
    snapConstructionContext,
    commandExpectsPointPick,
    canUseActiveSnap:
      activeSnap != null &&
      commandExpectsPointPick &&
      session?.key !== 'TRIM',
    canCycleActiveSnap:
      commandExpectsPointPick &&
      session?.key !== 'TRIM',
    canFinishCommand:
      (session?.key === 'PLINE' || session?.key === 'TRAVERSE') &&
      session.points.length >= 2,
    startPointCommand: () => beginSession({ key: 'POINT', inputValue: '' }),
    startCogoPointCommand: () =>
      beginSession({
        key: 'COGO_POINT',
        inputValue: '',
        startPoint: null,
      }),
    startLineCommand: () =>
      beginSession({
        key: 'LINE',
        inputValue: '',
        startPoint: null,
      }),
    startPolylineCommand: () =>
      beginSession({
        key: 'PLINE',
        inputValue: '',
        points: [],
      }),
    startTraverseCommand: () =>
      beginSession({
        key: 'TRAVERSE',
        inputValue: '',
        points: [],
      }),
    startArc3PointCommand: () =>
      beginSession({
        key: 'ARC_3PT',
        inputValue: '',
        points: [],
      }),
    startArcStartCenterEndCommand: () =>
      beginSession({
        key: 'ARC_SCE',
        inputValue: '',
        points: [],
      }),
    startArcCenterStartEndCommand: () =>
      beginSession({
        key: 'ARC_CSE',
        inputValue: '',
        points: [],
      }),
    startArcStartCenterAngleCommand: () =>
      beginSession({
        key: 'ARC_SCA',
        inputValue: '',
        points: [],
      }),
    startArcCenterStartAngleCommand: () =>
      beginSession({
        key: 'ARC_CSA',
        inputValue: '',
        points: [],
      }),
    startArcStartCenterChordCommand: () =>
      beginSession({
        key: 'ARC_SCL',
        inputValue: '',
        points: [],
      }),
    startArcCenterStartChordCommand: () =>
      beginSession({
        key: 'ARC_CSL',
        inputValue: '',
        points: [],
      }),
    startArcStartEndAngleCommand: () =>
      beginSession({
        key: 'ARC_SEA',
        inputValue: '',
        points: [],
      }),
    startArcStartEndDirectionCommand: () =>
      beginSession({
        key: 'ARC_SED',
        inputValue: '',
        points: [],
      }),
    startArcStartEndRadiusCommand: () =>
      beginSession({
        key: 'ARC_SER',
        inputValue: '',
        points: [],
      }),
    startContinueCurveCommand: () => {
      if (!selectedArcForContinue) return;
      beginSession({
        key: 'CONTINUE_CURVE',
        inputValue: '',
        sourceArc: selectedArcForContinue,
      });
    },
    startTangentCurveCommand: () =>
      beginSession({
        key: 'TANGENT_CURVE',
        inputValue: '',
        piPoint: null,
        backTangentPoint: null,
        aheadTangentPoint: null,
      }),
    startInverseCommand: () =>
      beginSession({
        key: 'INVERSE',
        inputValue: '',
        startPoint: null,
      }),
    startMoveCommand: () => {
      if (selectionCount === 0) return;
      beginSession({
        key: 'MOVE',
        inputValue: '',
        startPoint: null,
      });
    },
    startCopyCommand: () => {
      if (selectionCount === 0) return;
      beginSession({
        key: 'COPY',
        inputValue: '',
        startPoint: null,
      });
    },
    startTrimCommand: () => {
      if (trimCuttingEntityIds.length === 0) return;
      beginSession({
        key: 'TRIM',
        inputValue: '',
        cuttingEntityIds: trimCuttingEntityIds,
      });
    },
    startPasteCommand: (sourceEntityIds, basePoint) => {
      if (sourceEntityIds.length === 0) return;
      beginSession({
        key: 'PASTE',
        inputValue: '',
        startPoint: basePoint,
        sourceEntityIds,
      });
    },
    cancelCommand: () => replaceSession(null),
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
      updateSession((current) =>
        current && current.key !== 'TRIM'
          ? { ...current, inputValue: value, resultText: undefined }
          : current,
      ),
    appendCommandInputValue: (value) =>
      updateSession((current) =>
        current && current.key !== 'TRIM'
          ? { ...current, inputValue: `${current.inputValue}${value}`, resultText: undefined }
          : current,
      ),
    backspaceCommandInputValue: () =>
      updateSession((current) =>
        current && current.key !== 'TRIM'
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
          snapSourceSegmentId: activeSnap.sourceSegmentId,
          snapSourceEntityId: activeSnap.sourceEntityId,
          snapKind: activeSnap.kind,
        },
        { suppressPointLabel: true },
      );
    },
    consumeInteractionPoint: (point, label, options) => {
      if (!session) return;
      consumePoint(
        {
          x: point.x,
          y: point.y,
          label: label ?? `${point.x.toFixed(3)},${point.y.toFixed(3)}`,
          snapSourceSegmentId: options?.snapSourceSegmentId,
          snapSourceEntityId: options?.snapSourceEntityId,
          snapKind: options?.snapKind,
        },
        { suppressPointLabel: true },
      );
    },
    handleEnterKey,
    handleEscapeKey,
  };
};
