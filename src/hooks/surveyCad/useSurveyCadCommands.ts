import { useEffect, useMemo, useRef, useState } from 'react';
import { dmsToRad } from '../../engine/angles';
import {
  buildCadDistanceSummary,
  buildCadInverseSummary,
  buildCadMultiInverseSummary,
  cadComputeDeflectionAnglePoint,
  cadComputeTurnedAnglePoint,
  cadExtendLineByDistance,
  cadIntersectBearingDistance,
  cadIntersectBearings,
  cadIntersectDistanceDistance,
  cadIntersectLineCircle,
  cadIntersectOffsetLines,
  cadIntersectPerpendicular,
  cadIntersectSkew,
  cadOffsetPointFromLine,
  cadPointAtDistanceAlongLine,
  cadPointAtFractionAlongLine,
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
  CadLineEntity,
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
  | 'MULTI_INVERSE'
  | 'BEARING_REPORT'
  | 'DISTANCE_REPORT'
  | 'TURNED_POINT'
  | 'DEFLECT_POINT'
  | 'POINT_ALONG_LINE'
  | 'EXTEND_LINE'
  | 'OFFSET_POINT'
  | 'BEARING_BEARING_INTX'
  | 'BEARING_DISTANCE_INTX'
  | 'DISTANCE_DISTANCE_INTX'
  | 'LINE_CIRCLE_INTX'
  | 'PERP_INTX'
  | 'OFFSET_INTX'
  | 'SKEW_INTX'
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
      key: 'BEARING_REPORT' | 'DISTANCE_REPORT';
      inputValue: string;
      startPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'MULTI_INVERSE';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key: 'TURNED_POINT';
      inputValue: string;
      occupyPoint: CommandPoint | null;
      backsightPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'DEFLECT_POINT' | 'POINT_ALONG_LINE' | 'EXTEND_LINE' | 'OFFSET_POINT';
      inputValue: string;
      lineStart: CommandPoint;
      lineEnd: CommandPoint;
      resultText?: string;
    }
  | {
      key: 'BEARING_BEARING_INTX' | 'BEARING_DISTANCE_INTX' | 'DISTANCE_DISTANCE_INTX';
      inputValue: string;
      firstPoint: CommandPoint | null;
      secondPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'LINE_CIRCLE_INTX' | 'PERP_INTX' | 'SKEW_INTX';
      inputValue: string;
      lineStart: CommandPoint;
      lineEnd: CommandPoint;
      targetPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'OFFSET_INTX';
      inputValue: string;
      firstLineStart: CommandPoint;
      firstLineEnd: CommandPoint;
      secondLineStart: CommandPoint;
      secondLineEnd: CommandPoint;
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
  selectedLineForCoreCogo: CadLineEntity | null;
  selectedLinePairForIntersection: [CadLineEntity, CadLineEntity] | null;
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
  startMultiInverseCommand: () => void;
  startBearingReportCommand: () => void;
  startDistanceReportCommand: () => void;
  startTurnedPointCommand: () => void;
  startDeflectionPointCommand: () => void;
  startPointAlongLineCommand: () => void;
  startExtendLineCommand: () => void;
  startOffsetPointCommand: () => void;
  startBearingBearingIntersectionCommand: () => void;
  startBearingDistanceIntersectionCommand: () => void;
  startDistanceDistanceIntersectionCommand: () => void;
  startLineCircleIntersectionCommand: () => void;
  startPerpendicularIntersectionCommand: () => void;
  startOffsetIntersectionCommand: () => void;
  startSkewIntersectionCommand: () => void;
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
    case 'BEARING_REPORT':
    case 'DISTANCE_REPORT':
    case 'MOVE':
    case 'COPY':
    case 'TRIM':
    case 'PASTE':
    case 'PLINE':
    case 'TRAVERSE':
    case 'MULTI_INVERSE':
    case 'BEARING_BEARING_INTX':
    case 'BEARING_DISTANCE_INTX':
    case 'DISTANCE_DISTANCE_INTX':
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
    case 'TURNED_POINT':
      return session.backsightPoint == null;
    case 'LINE_CIRCLE_INTX':
    case 'PERP_INTX':
    case 'SKEW_INTX':
      return session.targetPoint == null;
    case 'OFFSET_INTX':
    case 'DEFLECT_POINT':
    case 'POINT_ALONG_LINE':
    case 'EXTEND_LINE':
    case 'OFFSET_POINT':
      return false;
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

const parseAngleValueDeg = (token: string): number | null => {
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;
  if (/^[+-]?\d{1,3}-\d{1,2}-\d{1,2}(?:\.\d+)?$/.test(trimmed)) {
    return (dmsToRad(trimmed) * 180) / Math.PI;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const parseLeftRightAngleDistance = (
  token: string,
): { label?: string; side: 'left' | 'right'; angleDeg: number; distance: number } | null => {
  const { label, body } = splitLabelFromBody(token);
  const match = /^([LR])\s*([^,]+)\s*,\s*([-+]?\d*\.?\d+)\s*$/i.exec(body);
  if (!match) return null;
  const angleDeg = parseAngleValueDeg(match[2] ?? '');
  const distance = Number(match[3]);
  if (angleDeg == null || !Number.isFinite(distance) || distance <= 0) return null;
  return {
    label,
    side: (match[1] ?? '').toUpperCase() === 'L' ? 'left' : 'right',
    angleDeg,
    distance,
  };
};

const parseDistanceOrPercent = (
  token: string,
): { label?: string; distance?: number; fraction?: number } | null => {
  const { label, body } = splitLabelFromBody(token);
  const trimmed = body.trim();
  if (trimmed.endsWith('%')) {
    const percent = Number(trimmed.slice(0, -1));
    if (!Number.isFinite(percent)) return null;
    return { label, fraction: percent / 100 };
  }
  const distance = Number(trimmed);
  if (!Number.isFinite(distance)) return null;
  return { label, distance };
};

const parseOffsetPointInput = (
  token: string,
): { label?: string; side: 'left' | 'right'; offsetDistance: number; alongDistance?: number; alongFraction?: number } | null => {
  const { label, body } = splitLabelFromBody(token);
  const match = /^([LR])\s*([-+]?\d*\.?\d+)\s*,\s*(.+)$/i.exec(body);
  if (!match) return null;
  const offsetDistance = Number(match[2]);
  const along = parseDistanceOrPercent(match[3] ?? '');
  if (!Number.isFinite(offsetDistance) || !along) return null;
  return {
    label,
    side: (match[1] ?? '').toUpperCase() === 'L' ? 'left' : 'right',
    offsetDistance,
    alongDistance: along.distance,
    alongFraction: along.fraction,
  };
};

const parseDualBearingInput = (
  token: string,
): { firstBearing: string; secondBearing: string } | null => {
  const parts = token.split(/[;|]/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length !== 2) return null;
  if (cadParseBearingDegrees(parts[0]) == null || cadParseBearingDegrees(parts[1]) == null) return null;
  return {
    firstBearing: parts[0]!,
    secondBearing: parts[1]!,
  };
};

const parseBearingDistanceIntersectionInput = (
  token: string,
): { bearing: string; distance: number } | null => {
  const parts = token.split(/[;|]/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length !== 2) return null;
  const distance = Number(parts[1]);
  if (cadParseBearingDegrees(parts[0]) == null || !Number.isFinite(distance) || distance < 0) return null;
  return {
    bearing: parts[0]!,
    distance,
  };
};

const parseDistancePairInput = (
  token: string,
): { firstDistance: number; secondDistance: number } | null => {
  const parts = token.split(',').map((part) => part.trim());
  if (parts.length !== 2) return null;
  const firstDistance = Number(parts[0]);
  const secondDistance = Number(parts[1]);
  if (!Number.isFinite(firstDistance) || !Number.isFinite(secondDistance)) return null;
  return { firstDistance, secondDistance };
};

const parseSideDistanceInput = (
  token: string,
): { side: 'left' | 'right'; distance: number } | null => {
  const match = /^([LR])\s*([-+]?\d*\.?\d+)\s*$/i.exec(token.trim());
  if (!match) return null;
  const distance = Number(match[2]);
  if (!Number.isFinite(distance)) return null;
  return {
    side: (match[1] ?? '').toUpperCase() === 'L' ? 'left' : 'right',
    distance,
  };
};

const parseDualOffsetInput = (
  token: string,
): { firstOffset: number; secondOffset: number } | null => {
  const parts = token.split(',').map((part) => part.trim());
  if (parts.length !== 2) return null;
  const first = parseSideDistanceInput(parts[0] ?? '');
  const second = parseSideDistanceInput(parts[1] ?? '');
  if (!first || !second) return null;
  return {
    firstOffset: first.side === 'left' ? first.distance : -first.distance,
    secondOffset: second.side === 'left' ? second.distance : -second.distance,
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
    case 'MULTI_INVERSE':
      return session.resultText ??
        (session.points.length > 0
          ? `MULTI_INVERSE active. ${session.points.length} point${session.points.length === 1 ? '' : 's'} captured. Click the next point or press Enter on an empty input to report the sequence.`
          : 'MULTI_INVERSE active. Click or enter the first point.');
    case 'BEARING_REPORT':
      return session.resultText ??
        (session.startPoint
          ? `BEARING report active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`.`
          : 'BEARING report active. Click or enter the first point.');
    case 'DISTANCE_REPORT':
      return session.resultText ??
        (session.startPoint
          ? `DISTANCE report active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`.`
          : 'DISTANCE report active. Click or enter the first point.');
    case 'TURNED_POINT':
      return session.resultText ??
        (session.occupyPoint == null
          ? 'TURNED_POINT active. Click or enter the occupied point.'
          : session.backsightPoint == null
            ? `TURNED_POINT active. Occupied point ${session.occupyPoint.label} captured. Click or enter the backsight point.`
            : `TURNED_POINT active. Enter \`Langle,distance\` or \`Rangle,distance\` from ${session.occupyPoint.label}.`);
    case 'DEFLECT_POINT':
      return session.resultText ??
        `DEFLECT_POINT active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter \`Langle,distance\` or \`Rangle,distance\`.`;
    case 'POINT_ALONG_LINE':
      return session.resultText ??
        `POINT_ALONG_LINE active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter distance or percent like \`25\` or \`50%\`.`;
    case 'EXTEND_LINE':
      return session.resultText ??
        `EXTEND_LINE active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter extension distance.`;
    case 'OFFSET_POINT':
      return session.resultText ??
        `OFFSET_POINT active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter \`Loffset,along\` or \`Roffset,along\`, with along as distance or percent.`;
    case 'BEARING_BEARING_INTX':
      return session.resultText ??
        (session.firstPoint == null
          ? 'BEARING_BEARING_INTX active. Click or enter the first origin point.'
          : session.secondPoint == null
            ? `BEARING_BEARING_INTX active. First origin ${session.firstPoint.label} captured. Click or enter the second origin point.`
            : `BEARING_BEARING_INTX active. Enter \`bearing1;bearing2\` from ${session.firstPoint.label} and ${session.secondPoint.label}.`);
    case 'BEARING_DISTANCE_INTX':
      return session.resultText ??
        (session.firstPoint == null
          ? 'BEARING_DISTANCE_INTX active. Click or enter the bearing origin point.'
          : session.secondPoint == null
            ? `BEARING_DISTANCE_INTX active. Bearing origin ${session.firstPoint.label} captured. Click or enter the distance center point.`
            : `BEARING_DISTANCE_INTX active. Enter \`bearing;distance\` from ${session.firstPoint.label} against ${session.secondPoint.label}.`);
    case 'DISTANCE_DISTANCE_INTX':
      return session.resultText ??
        (session.firstPoint == null
          ? 'DISTANCE_DISTANCE_INTX active. Click or enter the first center point.'
          : session.secondPoint == null
            ? `DISTANCE_DISTANCE_INTX active. First center ${session.firstPoint.label} captured. Click or enter the second center point.`
            : `DISTANCE_DISTANCE_INTX active. Enter \`distance1,distance2\` from ${session.firstPoint.label} and ${session.secondPoint.label}.`);
    case 'LINE_CIRCLE_INTX':
      return session.resultText ??
        (session.targetPoint == null
          ? `LINE_CIRCLE_INTX active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Click or enter the circle center point.`
          : `LINE_CIRCLE_INTX active. Enter the radius from center ${session.targetPoint.label}.`);
    case 'PERP_INTX':
      return session.resultText ??
        (session.targetPoint == null
          ? `PERP_INTX active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Click or enter the external point.`
          : `PERP_INTX active. Press Enter to create the perpendicular foot from ${session.targetPoint.label}.`);
    case 'OFFSET_INTX':
      return session.resultText ??
        `OFFSET_INTX active. Enter \`Loff1,Roff2\` for ${session.firstLineStart.label}-${session.firstLineEnd.label} and ${session.secondLineStart.label}-${session.secondLineEnd.label}.`;
    case 'SKEW_INTX':
      return session.resultText ??
        (session.targetPoint == null
          ? `SKEW_INTX active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Click or enter the source point.`
          : `SKEW_INTX active. Enter \`Langle\` or \`Rangle\` from ${session.targetPoint.label}.`);
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
    case 'MULTI_INVERSE':
      return session.points.length > 0
        ? 'MULTI_INVERSE next point: click in model space or type `x,y` / relative bearing-distance. Press Enter on an empty input to finish the report.'
        : 'MULTI_INVERSE first point: click in model space or type `x,y` / `LABEL=x,y`.';
    case 'BEARING_REPORT':
      return session.startPoint
        ? 'BEARING report second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the first point.'
        : 'BEARING report first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'DISTANCE_REPORT':
      return session.startPoint
        ? 'DISTANCE report second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the first point.'
        : 'DISTANCE report first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'TURNED_POINT':
      return session.backsightPoint
        ? 'TURNED_POINT value input: enter `Langle,distance` or `Rangle,distance`. Angle accepts decimal degrees or `dd-mm-ss`.'
        : 'TURNED_POINT point input: click in model space or type `x,y` / `LABEL=x,y` for occupied and backsight points.';
    case 'DEFLECT_POINT':
      return 'DEFLECT_POINT value input: enter `Langle,distance` or `Rangle,distance`. Angle accepts decimal degrees or `dd-mm-ss`.';
    case 'POINT_ALONG_LINE':
      return 'POINT_ALONG_LINE input: enter distance from start, or percent like `50%`.';
    case 'EXTEND_LINE':
      return 'EXTEND_LINE input: enter extension distance from the selected line end.';
    case 'OFFSET_POINT':
      return 'OFFSET_POINT input: enter `Loffset,along` or `Roffset,along`; along may be distance or percent like `50%`.';
    case 'BEARING_BEARING_INTX':
      return session.secondPoint
        ? 'BEARING_BEARING_INTX input: enter `bearing1;bearing2`, for example `N45-00-00E;S10-00-00E`.'
        : 'BEARING_BEARING_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for both origin points.';
    case 'BEARING_DISTANCE_INTX':
      return session.secondPoint
        ? 'BEARING_DISTANCE_INTX input: enter `bearing;distance`, for example `N45-00-00E;25.000`.'
        : 'BEARING_DISTANCE_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the bearing origin and distance center.';
    case 'DISTANCE_DISTANCE_INTX':
      return session.secondPoint
        ? 'DISTANCE_DISTANCE_INTX input: enter `distance1,distance2`.'
        : 'DISTANCE_DISTANCE_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for both circle centers.';
    case 'LINE_CIRCLE_INTX':
      return session.targetPoint
        ? 'LINE_CIRCLE_INTX input: enter the circle radius as a positive number.'
        : 'LINE_CIRCLE_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the circle center.';
    case 'PERP_INTX':
      return session.targetPoint
        ? 'PERP_INTX creates the perpendicular foot immediately after the external point is captured.'
        : 'PERP_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the external point.';
    case 'OFFSET_INTX':
      return 'OFFSET_INTX input: enter `Loff1,Roff2` style offsets for the two selected lines.';
    case 'SKEW_INTX':
      return session.targetPoint
        ? 'SKEW_INTX input: enter `Langle` or `Rangle`, for example `R30`.'
        : 'SKEW_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the source point.';
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
  selectedLineForCoreCogo,
  selectedLinePairForIntersection,
  reverseDirectionModifier,
  applyHistoryUpdate,
  onReportComputation,
}: UseSurveyCadCommandsArgs): UseSurveyCadCommandsResult => {
  const [session, setSession] = useState<CommandSession | null>(null);
  const sessionRef = useRef<CommandSession | null>(session);
  const selectedLineCommandPoints = useMemo(
    () =>
      selectedLineForCoreCogo
        ? {
            start: {
              x: selectedLineForCoreCogo.fromX,
              y: selectedLineForCoreCogo.fromY,
              label: selectedLineForCoreCogo.fromStationId,
            } as CommandPoint,
            end: {
              x: selectedLineForCoreCogo.toX,
              y: selectedLineForCoreCogo.toY,
              label: selectedLineForCoreCogo.toStationId,
            } as CommandPoint,
          }
        : null,
    [selectedLineForCoreCogo],
  );
  const selectedLinePairCommandPoints = useMemo(
    () =>
      selectedLinePairForIntersection
        ? {
            first: {
              start: {
                x: selectedLinePairForIntersection[0].fromX,
                y: selectedLinePairForIntersection[0].fromY,
                label: selectedLinePairForIntersection[0].fromStationId,
              } as CommandPoint,
              end: {
                x: selectedLinePairForIntersection[0].toX,
                y: selectedLinePairForIntersection[0].toY,
                label: selectedLinePairForIntersection[0].toStationId,
              } as CommandPoint,
            },
            second: {
              start: {
                x: selectedLinePairForIntersection[1].fromX,
                y: selectedLinePairForIntersection[1].fromY,
                label: selectedLinePairForIntersection[1].fromStationId,
              } as CommandPoint,
              end: {
                x: selectedLinePairForIntersection[1].toX,
                y: selectedLinePairForIntersection[1].toY,
                label: selectedLinePairForIntersection[1].toStationId,
              } as CommandPoint,
            },
          }
        : null,
    [selectedLinePairForIntersection],
  );

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

  const publishReport = (
    toolKey: string,
    title: string,
    summary: string,
    rows: Array<{ label: string; value: string; unit?: string }>,
    alternatives: Array<{ id: string; label: string; point?: { x: number; y: number } }> = [],
  ) => {
    onReportComputation?.(
      buildCadCogoComputation({
        createdEntities: [],
        report: {
          title,
          summary,
          rows,
        },
        warnings: [],
        alternatives,
        provenance: {
          id: `${toolKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          toolKey,
          inputs: {},
          resultSummary: summary,
          createdAtIso: new Date().toISOString(),
        },
      }),
    );
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
      case 'BEARING_REPORT':
      case 'DISTANCE_REPORT':
        return session.startPoint
          ? {
              active: true,
              basePoint: { x: session.startPoint.x, y: session.startPoint.y },
              scopeSeedSegmentId: session.startPoint.snapSourceSegmentId ?? null,
              tangentSeedArcEntityId: tangentSeedArcEntityIdFromPoint(session.startPoint),
              tangentSeedPoint: tangentSeedPointFromPoint(session.startPoint),
            }
          : { active: false, basePoint: null };
      case 'MULTI_INVERSE':
        return session.points.length > 0
          ? {
              active: true,
              basePoint: {
                x: session.points[session.points.length - 1]!.x,
                y: session.points[session.points.length - 1]!.y,
              },
            }
          : { active: false, basePoint: null };
      case 'BEARING_BEARING_INTX':
      case 'BEARING_DISTANCE_INTX':
      case 'DISTANCE_DISTANCE_INTX':
        return session.secondPoint
          ? { active: false, basePoint: null }
          : session.firstPoint
            ? {
                active: true,
                basePoint: { x: session.firstPoint.x, y: session.firstPoint.y },
              }
            : { active: false, basePoint: null };
      case 'TURNED_POINT':
        return session.backsightPoint
          ? { active: false, basePoint: null }
          : session.occupyPoint
            ? {
                active: true,
                basePoint: { x: session.occupyPoint.x, y: session.occupyPoint.y },
              }
            : { active: false, basePoint: null };
      case 'DEFLECT_POINT':
      case 'POINT_ALONG_LINE':
      case 'EXTEND_LINE':
      case 'OFFSET_POINT':
      case 'OFFSET_INTX':
        return { active: false, basePoint: null };
      case 'LINE_CIRCLE_INTX':
      case 'PERP_INTX':
      case 'SKEW_INTX':
        return session.targetPoint
          ? { active: false, basePoint: null }
          : {
              active: true,
              basePoint: { x: session.lineEnd.x, y: session.lineEnd.y },
            };
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
      case 'BEARING_REPORT':
      case 'BEARING_BEARING_INTX':
      case 'BEARING_DISTANCE_INTX':
      case 'DISTANCE_DISTANCE_INTX':
      case 'DISTANCE_REPORT':
        if (!previewPoint) return null;
        if ('startPoint' in session && !session.startPoint) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        if ('firstPoint' in session && !session.firstPoint) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        if ('firstPoint' in session && session.firstPoint && !session.secondPoint) {
          return {
            kind: 'line',
            points: [
              { x: session.firstPoint.x, y: session.firstPoint.y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        return {
          kind: 'line',
          points: [
            { x: ('startPoint' in session ? session.startPoint!.x : session.firstPoint!.x), y: ('startPoint' in session ? session.startPoint!.y : session.firstPoint!.y) },
            { x: previewPoint.x, y: previewPoint.y },
          ],
        };
      case 'MULTI_INVERSE':
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
      case 'TURNED_POINT':
        if (!previewPoint) return null;
        if (session.occupyPoint == null) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        if (session.backsightPoint == null) {
          return {
            kind: 'line',
            points: [
              { x: session.occupyPoint.x, y: session.occupyPoint.y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        return null;
      case 'DEFLECT_POINT':
      case 'POINT_ALONG_LINE':
      case 'EXTEND_LINE':
      case 'OFFSET_POINT':
      case 'OFFSET_INTX':
        return null;
      case 'LINE_CIRCLE_INTX':
      case 'PERP_INTX':
      case 'SKEW_INTX':
        if (!previewPoint || session.targetPoint != null) return null;
        return {
          kind: 'line',
          points: [
            { x: session.lineEnd.x, y: session.lineEnd.y },
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
    if (current.key === 'MULTI_INVERSE') {
      replaceSession({
        ...current,
        points: [...current.points, point],
        inputValue: '',
        resultText: undefined,
      });
      return;
    }
    if (current.key === 'BEARING_REPORT' || current.key === 'DISTANCE_REPORT') {
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
      const inverse = buildCadInverseSummary(startPoint, point);
      const distance = buildCadDistanceSummary(startPoint, point);
      if (current.key === 'BEARING_REPORT') {
        publishReport(
          'BEARING_REPORT',
          'Bearing Between Points',
          `Computed bearing from ${startPoint.label} to ${point.label}`,
          [
            { label: 'From', value: startPoint.label },
            { label: 'To', value: point.label },
            { label: 'Bearing', value: inverse.bearing },
            { label: 'Azimuth', value: inverse.azimuthDeg.toFixed(4), unit: 'deg' },
          ],
        );
        replaceSession({
          ...current,
          startPoint: null,
          inputValue: '',
          resultText: `BEARING ${startPoint.label} -> ${point.label}: ${inverse.bearing}, azimuth ${inverse.azimuthDeg.toFixed(4)} deg.`,
        });
        return;
      }
      publishReport(
        'DISTANCE_REPORT',
        'Distance Between Points',
        `Computed distance from ${startPoint.label} to ${point.label}`,
        [
          { label: 'From', value: startPoint.label },
          { label: 'To', value: point.label },
          { label: 'Distance', value: distance.distance2d.toFixed(3), unit: 'm' },
          { label: 'dE', value: distance.deltaX.toFixed(3), unit: 'm' },
          { label: 'dN', value: distance.deltaY.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession({
        ...current,
        startPoint: null,
        inputValue: '',
        resultText: `DISTANCE ${startPoint.label} -> ${point.label}: ${distance.distance2d.toFixed(3)} m.`,
      });
      return;
    }
    if (current.key === 'TURNED_POINT') {
      if (!current.occupyPoint) {
        replaceSession({
          ...current,
          occupyPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      if (!current.backsightPoint) {
        replaceSession({
          ...current,
          backsightPoint: point,
          inputValue: '',
          resultText: undefined,
        });
      }
      return;
    }
    if (
      current.key === 'BEARING_BEARING_INTX' ||
      current.key === 'BEARING_DISTANCE_INTX' ||
      current.key === 'DISTANCE_DISTANCE_INTX'
    ) {
      if (!current.firstPoint) {
        replaceSession({
          ...current,
          firstPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      if (!current.secondPoint) {
        replaceSession({
          ...current,
          secondPoint: point,
          inputValue: '',
          resultText: undefined,
        });
      }
      return;
    }
    if (current.key === 'LINE_CIRCLE_INTX' || current.key === 'SKEW_INTX') {
      if (!current.targetPoint) {
        replaceSession({
          ...current,
          targetPoint: point,
          inputValue: '',
          resultText: undefined,
        });
      }
      return;
    }
    if (current.key === 'PERP_INTX') {
      const solution = cadIntersectPerpendicular({
        lineStart: current.lineStart,
        lineEnd: current.lineEnd,
        fromPoint: point,
        lineLabel: `${current.lineStart.label}-${current.lineEnd.label}`,
        pointLabel: point.label,
      });
      if (!solution) {
        replaceSession({
          ...current,
          resultText: 'PERP_INTX could not compute a perpendicular foot from that point.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: solution.point.x,
          y: solution.point.y,
        }),
      );
      publishReport(
        'PERP_INTX',
        'Perpendicular Intersection',
        `Computed perpendicular foot from ${point.label} to ${current.lineStart.label}-${current.lineEnd.label}`,
          [
            { label: 'Point', value: point.label },
            { label: 'Line', value: `${current.lineStart.label}-${current.lineEnd.label}` },
            { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
            { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
            {
              label: 'Offset',
              value: buildCadDistanceSummary(point, solution.point).distance2d.toFixed(3),
              unit: 'm',
            },
          ],
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
    if (session.key === 'MULTI_INVERSE') {
      if (session.inputValue.trim().length === 0) {
        if (session.points.length < 2) return;
        const multi = buildCadMultiInverseSummary(session.points);
        publishReport(
          'MULTI_INVERSE',
          'Multi-Point Inverse',
          `Computed ${multi.legs.length} inverse leg${multi.legs.length === 1 ? '' : 's'}`,
          [
            ...multi.legs.flatMap((leg, index) => ([
              { label: `Leg ${index + 1}`, value: `${leg.fromLabel} -> ${leg.toLabel}` },
              { label: `Leg ${index + 1} Bearing`, value: leg.bearing },
              { label: `Leg ${index + 1} Distance`, value: leg.distance.toFixed(3), unit: 'm' },
            ])),
            { label: 'Total distance', value: multi.totalDistance.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession({
          ...session,
          points: [],
          resultText: `MULTI_INVERSE reported ${multi.legs.length} legs, total ${multi.totalDistance.toFixed(3)} m.`,
        });
        return;
      }
      const parsedPoint = parseInputPoint(session.inputValue, session.points[session.points.length - 1] ?? null);
      if (!parsedPoint) {
        replaceSession({
          ...session,
          resultText: 'MULTI_INVERSE point input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance.',
        });
        return;
      }
      consumePoint(parsedPoint);
      return;
    }
    if (session.key === 'TURNED_POINT') {
      if (session.occupyPoint == null || session.backsightPoint == null) {
        const parsedPoint = parseInputPoint(session.inputValue, session.occupyPoint);
        if (!parsedPoint) {
          replaceSession({
            ...session,
            resultText: 'TURNED_POINT point input invalid. Use `x,y` or `LABEL=x,y`.',
          });
          return;
        }
        consumePoint(parsedPoint);
        return;
      }
      const parsed = parseLeftRightAngleDistance(session.inputValue);
      if (!parsed) {
        replaceSession({
          ...session,
          resultText: 'TURNED_POINT input invalid. Use `Langle,distance` or `Rangle,distance`.',
        });
        return;
      }
      const point = cadComputeTurnedAnglePoint({
        occupyPoint: session.occupyPoint,
        backsightPoint: session.backsightPoint,
        angleDeg: parsed.angleDeg,
        distance: parsed.distance,
        side: parsed.side,
      });
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: point.x,
          y: point.y,
          label: parsed.label,
        }),
      );
      publishReport(
        'TURNED_POINT',
        'Turned Angle + Distance',
        `Created point from ${session.occupyPoint.label} using ${parsed.side} angle`,
        [
          { label: 'Occupy', value: session.occupyPoint.label },
          { label: 'Backsight', value: session.backsightPoint.label },
          { label: 'Turn', value: `${parsed.side} ${parsed.angleDeg.toFixed(4)} deg` },
          { label: 'Distance', value: parsed.distance.toFixed(3), unit: 'm' },
          { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
          { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession(null);
      return;
    }
    if (
      session.key === 'DEFLECT_POINT' ||
      session.key === 'POINT_ALONG_LINE' ||
      session.key === 'EXTEND_LINE' ||
      session.key === 'OFFSET_POINT'
    ) {
      if (session.key === 'DEFLECT_POINT') {
        const parsed = parseLeftRightAngleDistance(session.inputValue);
        if (!parsed) {
          replaceSession({
            ...session,
            resultText: 'DEFLECT_POINT input invalid. Use `Langle,distance` or `Rangle,distance`.',
          });
          return;
        }
        const point = cadComputeDeflectionAnglePoint({
          lineStart: session.lineStart,
          lineEnd: session.lineEnd,
          angleDeg: parsed.angleDeg,
          distance: parsed.distance,
          side: parsed.side,
        });
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: point.x,
            y: point.y,
            label: parsed.label,
          }),
        );
        publishReport(
          'DEFLECT_POINT',
          'Deflection Angle + Distance',
          `Created deflection point from ${session.lineStart.label}-${session.lineEnd.label}`,
          [
            { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
            { label: 'Deflection', value: `${parsed.side} ${parsed.angleDeg.toFixed(4)} deg` },
            { label: 'Distance', value: parsed.distance.toFixed(3), unit: 'm' },
            { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
            { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }
      if (session.key === 'POINT_ALONG_LINE') {
        const parsed = parseDistanceOrPercent(session.inputValue);
        const point =
          parsed?.fraction != null
            ? cadPointAtFractionAlongLine(session.lineStart, session.lineEnd, parsed.fraction)
            : parsed?.distance != null
              ? cadPointAtDistanceAlongLine(session.lineStart, session.lineEnd, parsed.distance)
              : null;
        if (!parsed || !point) {
          replaceSession({
            ...session,
            resultText: 'POINT_ALONG_LINE input invalid. Use distance or percent like `25` or `50%`.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: point.x,
            y: point.y,
            label: parsed.label,
          }),
        );
        publishReport(
          'POINT_ALONG_LINE',
          'Point Along Line',
          `Created point along ${session.lineStart.label}-${session.lineEnd.label}`,
          [
            { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
            parsed.fraction != null
              ? { label: 'Fraction', value: (parsed.fraction * 100).toFixed(3), unit: '%' }
              : { label: 'Distance', value: (parsed.distance ?? 0).toFixed(3), unit: 'm' },
            { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
            { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }
      if (session.key === 'EXTEND_LINE') {
        const distance = Number(session.inputValue.trim());
        const point = Number.isFinite(distance)
          ? cadExtendLineByDistance(session.lineStart, session.lineEnd, distance)
          : null;
        if (!point) {
          replaceSession({
            ...session,
            resultText: 'EXTEND_LINE input invalid. Enter a positive extension distance.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'LINE',
            start: session.lineEnd,
            end: {
              ...point,
              label: `${session.lineEnd.label}+${distance.toFixed(3)}`,
            },
          }),
        );
        publishReport(
          'EXTEND_LINE',
          'Extend Line by Distance',
          `Extended ${session.lineStart.label}-${session.lineEnd.label} by ${distance.toFixed(3)} m`,
          [
            { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
            { label: 'Extension', value: distance.toFixed(3), unit: 'm' },
            { label: 'End Northing', value: point.y.toFixed(3), unit: 'm' },
            { label: 'End Easting', value: point.x.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }
      const parsed = parseOffsetPointInput(session.inputValue);
      const lineLength = buildCadDistanceSummary(session.lineStart, session.lineEnd).distance2d;
      const alongDistance =
        parsed?.alongFraction != null ? parsed.alongFraction * lineLength : parsed?.alongDistance;
      const point =
        parsed && alongDistance != null
          ? cadOffsetPointFromLine({
              lineStart: session.lineStart,
              lineEnd: session.lineEnd,
              alongDistance,
              offsetDistance: parsed.offsetDistance,
              side: parsed.side,
            })
          : null;
      if (!parsed || alongDistance == null || !point) {
        replaceSession({
          ...session,
          resultText: 'OFFSET_POINT input invalid. Use `Loffset,along` or `Roffset,along`.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: point.x,
          y: point.y,
          label: parsed.label,
        }),
      );
      publishReport(
        'OFFSET_POINT',
        'Offset Point',
        `Created offset point from ${session.lineStart.label}-${session.lineEnd.label}`,
        [
          { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
          { label: 'Offset', value: `${parsed.side} ${parsed.offsetDistance.toFixed(3)} m` },
          { label: 'Along', value: alongDistance.toFixed(3), unit: 'm' },
          { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
          { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession(null);
      return;
    }
    if (
      session.key === 'BEARING_BEARING_INTX' ||
      session.key === 'BEARING_DISTANCE_INTX' ||
      session.key === 'DISTANCE_DISTANCE_INTX'
    ) {
      if (session.firstPoint == null || session.secondPoint == null) {
        const parsedPoint = parseInputPoint(session.inputValue, session.firstPoint);
        if (!parsedPoint) {
          replaceSession({
            ...session,
            resultText: `${session.key} point input invalid. Use \`x,y\` or \`LABEL=x,y\`.`,
          });
          return;
        }
        consumePoint(parsedPoint);
        return;
      }

      if (session.key === 'BEARING_BEARING_INTX') {
        const parsed = parseDualBearingInput(session.inputValue);
        const solution =
          parsed &&
          cadIntersectBearings({
            firstPoint: session.firstPoint,
            firstBearing: parsed.firstBearing,
            secondPoint: session.secondPoint,
            secondBearing: parsed.secondBearing,
            firstLabel: session.firstPoint.label,
            secondLabel: session.secondPoint.label,
          });
        if (!parsed || !solution) {
          replaceSession({
            ...session,
            resultText: 'BEARING_BEARING_INTX input invalid. Use `bearing1;bearing2` with non-parallel bearings.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: solution.point.x,
            y: solution.point.y,
          }),
        );
        publishReport(
          'BEARING_BEARING_INTX',
          'Bearing-Bearing Intersection',
          `Computed bearing intersection from ${session.firstPoint.label} and ${session.secondPoint.label}`,
          [
            { label: 'Origin 1', value: session.firstPoint.label },
            { label: 'Bearing 1', value: parsed.firstBearing },
            { label: 'Origin 2', value: session.secondPoint.label },
            { label: 'Bearing 2', value: parsed.secondBearing },
            { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
            { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }

      if (session.key === 'BEARING_DISTANCE_INTX') {
        const parsed = parseBearingDistanceIntersectionInput(session.inputValue);
        const solutions =
          parsed
            ? cadIntersectBearingDistance({
                bearingPoint: session.firstPoint,
                bearing: parsed.bearing,
                distancePoint: session.secondPoint,
                distance: parsed.distance,
                bearingLabel: session.firstPoint.label,
                distanceLabel: session.secondPoint.label,
              })
            : [];
        const primary = solutions[0];
        if (!parsed || !primary) {
          replaceSession({
            ...session,
            resultText: 'BEARING_DISTANCE_INTX input invalid. Use `bearing;distance` and a solvable radius.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: primary.point.x,
            y: primary.point.y,
          }),
        );
        publishReport(
          'BEARING_DISTANCE_INTX',
          'Bearing-Distance Intersection',
          `Computed bearing-distance intersection from ${session.firstPoint.label} and ${session.secondPoint.label}`,
          [
            { label: 'Bearing origin', value: session.firstPoint.label },
            { label: 'Bearing', value: parsed.bearing },
            { label: 'Distance center', value: session.secondPoint.label },
            { label: 'Radius', value: parsed.distance.toFixed(3), unit: 'm' },
            { label: 'Chosen Northing', value: primary.point.y.toFixed(3), unit: 'm' },
            { label: 'Chosen Easting', value: primary.point.x.toFixed(3), unit: 'm' },
          ],
          solutions.slice(1).map((solution, index) => ({
            id: `bd-alt-${index + 2}`,
            label: `${solution.label}: N ${solution.point.y.toFixed(3)} E ${solution.point.x.toFixed(3)}`,
            point: solution.point,
          })),
        );
        replaceSession(null);
        return;
      }

      const parsed = parseDistancePairInput(session.inputValue);
      const solutions =
        parsed
          ? cadIntersectDistanceDistance({
              firstPoint: session.firstPoint,
              firstDistance: parsed.firstDistance,
              secondPoint: session.secondPoint,
              secondDistance: parsed.secondDistance,
              firstLabel: session.firstPoint.label,
              secondLabel: session.secondPoint.label,
            })
          : [];
      const primary = solutions[0];
      if (!parsed || !primary) {
        replaceSession({
          ...session,
          resultText: 'DISTANCE_DISTANCE_INTX input invalid. Use `distance1,distance2` with intersecting circles.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: primary.point.x,
          y: primary.point.y,
        }),
      );
      publishReport(
        'DISTANCE_DISTANCE_INTX',
        'Distance-Distance Intersection',
        `Computed distance-distance intersection from ${session.firstPoint.label} and ${session.secondPoint.label}`,
        [
          { label: 'Center 1', value: session.firstPoint.label },
          { label: 'Radius 1', value: parsed.firstDistance.toFixed(3), unit: 'm' },
          { label: 'Center 2', value: session.secondPoint.label },
          { label: 'Radius 2', value: parsed.secondDistance.toFixed(3), unit: 'm' },
          { label: 'Chosen Northing', value: primary.point.y.toFixed(3), unit: 'm' },
          { label: 'Chosen Easting', value: primary.point.x.toFixed(3), unit: 'm' },
        ],
        solutions.slice(1).map((solution, index) => ({
          id: `dd-alt-${index + 2}`,
          label: `${solution.label}: N ${solution.point.y.toFixed(3)} E ${solution.point.x.toFixed(3)}`,
          point: solution.point,
        })),
      );
      replaceSession(null);
      return;
    }
    if (
      session.key === 'LINE_CIRCLE_INTX' ||
      session.key === 'OFFSET_INTX' ||
      session.key === 'SKEW_INTX'
    ) {
      if (session.key === 'LINE_CIRCLE_INTX') {
        if (session.targetPoint == null) {
          const parsedPoint = parseInputPoint(session.inputValue, session.lineEnd);
          if (!parsedPoint) {
            replaceSession({
              ...session,
              resultText: 'LINE_CIRCLE_INTX center input invalid. Use `x,y` or `LABEL=x,y`.',
            });
            return;
          }
          consumePoint(parsedPoint);
          return;
        }
        const radius = Number(session.inputValue.trim());
        const solutions = Number.isFinite(radius)
          ? cadIntersectLineCircle({
              lineStart: session.lineStart,
              lineEnd: session.lineEnd,
              center: session.targetPoint,
              radius,
              lineLabel: `${session.lineStart.label}-${session.lineEnd.label}`,
              centerLabel: session.targetPoint.label,
            })
          : [];
        const primary = solutions[0];
        if (!primary) {
          replaceSession({
            ...session,
            resultText: 'LINE_CIRCLE_INTX radius invalid or no intersection found.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: primary.point.x,
            y: primary.point.y,
          }),
        );
        publishReport(
          'LINE_CIRCLE_INTX',
          'Line-Circle Intersection',
          `Computed line-circle intersection on ${session.lineStart.label}-${session.lineEnd.label}`,
          [
            { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
            { label: 'Center', value: session.targetPoint.label },
            { label: 'Radius', value: radius.toFixed(3), unit: 'm' },
            { label: 'Chosen Northing', value: primary.point.y.toFixed(3), unit: 'm' },
            { label: 'Chosen Easting', value: primary.point.x.toFixed(3), unit: 'm' },
          ],
          solutions.slice(1).map((solution, index) => ({
            id: `lc-alt-${index + 2}`,
            label: `${solution.label}: N ${solution.point.y.toFixed(3)} E ${solution.point.x.toFixed(3)}`,
            point: solution.point,
          })),
        );
        replaceSession(null);
        return;
      }
      if (session.key === 'OFFSET_INTX') {
        const parsed = parseDualOffsetInput(session.inputValue);
        const solution =
          parsed &&
          cadIntersectOffsetLines({
            firstLineStart: session.firstLineStart,
            firstLineEnd: session.firstLineEnd,
            firstOffset: parsed.firstOffset,
            secondLineStart: session.secondLineStart,
            secondLineEnd: session.secondLineEnd,
            secondOffset: parsed.secondOffset,
            firstLabel: `${session.firstLineStart.label}-${session.firstLineEnd.label}`,
            secondLabel: `${session.secondLineStart.label}-${session.secondLineEnd.label}`,
          });
        if (!parsed || !solution) {
          replaceSession({
            ...session,
            resultText: 'OFFSET_INTX input invalid. Use `Loff1,Roff2` with non-parallel offset lines.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: solution.point.x,
            y: solution.point.y,
          }),
        );
        publishReport(
          'OFFSET_INTX',
          'Offset Intersection',
          `Computed offset intersection from two selected lines`,
          [
            { label: 'Line 1', value: `${session.firstLineStart.label}-${session.firstLineEnd.label}` },
            { label: 'Offset 1', value: parsed.firstOffset.toFixed(3), unit: 'm' },
            { label: 'Line 2', value: `${session.secondLineStart.label}-${session.secondLineEnd.label}` },
            { label: 'Offset 2', value: parsed.secondOffset.toFixed(3), unit: 'm' },
            { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
            { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }
      if (session.targetPoint == null) {
        const parsedPoint = parseInputPoint(session.inputValue, session.lineEnd);
        if (!parsedPoint) {
          replaceSession({
            ...session,
            resultText: 'SKEW_INTX point input invalid. Use `x,y` or `LABEL=x,y`.',
          });
          return;
        }
        consumePoint(parsedPoint);
        return;
      }
      const parsed = parseSideDistanceInput(session.inputValue);
      const solution =
        parsed &&
        cadIntersectSkew({
          lineStart: session.lineStart,
          lineEnd: session.lineEnd,
          fromPoint: session.targetPoint,
          angleDeg: parsed.distance,
          side: parsed.side,
          lineLabel: `${session.lineStart.label}-${session.lineEnd.label}`,
          pointLabel: session.targetPoint.label,
        });
      if (!parsed || !solution) {
        replaceSession({
          ...session,
          resultText: 'SKEW_INTX input invalid. Use `Langle` or `Rangle` with a non-parallel skew.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: solution.point.x,
          y: solution.point.y,
        }),
      );
      publishReport(
        'SKEW_INTX',
        'Skew Intersection',
        `Computed skew intersection from ${session.targetPoint.label} onto ${session.lineStart.label}-${session.lineEnd.label}`,
        [
          { label: 'Source point', value: session.targetPoint.label },
          { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
          { label: 'Skew', value: `${parsed.side} ${parsed.distance.toFixed(4)} deg` },
          { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
          { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession(null);
      return;
    }
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
    if (session.key === 'MULTI_INVERSE' && session.inputValue.trim().length === 0 && session.points.length >= 2) {
      submitSessionInput();
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
    startMultiInverseCommand: () =>
      beginSession({
        key: 'MULTI_INVERSE',
        inputValue: '',
        points: [],
      }),
    startBearingReportCommand: () =>
      beginSession({
        key: 'BEARING_REPORT',
        inputValue: '',
        startPoint: null,
      }),
    startDistanceReportCommand: () =>
      beginSession({
        key: 'DISTANCE_REPORT',
        inputValue: '',
        startPoint: null,
      }),
    startTurnedPointCommand: () =>
      beginSession({
        key: 'TURNED_POINT',
        inputValue: '',
        occupyPoint: null,
        backsightPoint: null,
      }),
    startDeflectionPointCommand: () => {
      if (!selectedLineCommandPoints) return;
      beginSession({
        key: 'DEFLECT_POINT',
        inputValue: '',
        lineStart: selectedLineCommandPoints.start,
        lineEnd: selectedLineCommandPoints.end,
      });
    },
    startPointAlongLineCommand: () => {
      if (!selectedLineCommandPoints) return;
      beginSession({
        key: 'POINT_ALONG_LINE',
        inputValue: '',
        lineStart: selectedLineCommandPoints.start,
        lineEnd: selectedLineCommandPoints.end,
      });
    },
    startExtendLineCommand: () => {
      if (!selectedLineCommandPoints) return;
      beginSession({
        key: 'EXTEND_LINE',
        inputValue: '',
        lineStart: selectedLineCommandPoints.start,
        lineEnd: selectedLineCommandPoints.end,
      });
    },
    startOffsetPointCommand: () => {
      if (!selectedLineCommandPoints) return;
      beginSession({
        key: 'OFFSET_POINT',
        inputValue: '',
        lineStart: selectedLineCommandPoints.start,
        lineEnd: selectedLineCommandPoints.end,
      });
    },
    startBearingBearingIntersectionCommand: () =>
      beginSession({
        key: 'BEARING_BEARING_INTX',
        inputValue: '',
        firstPoint: null,
        secondPoint: null,
      }),
    startBearingDistanceIntersectionCommand: () =>
      beginSession({
        key: 'BEARING_DISTANCE_INTX',
        inputValue: '',
        firstPoint: null,
        secondPoint: null,
      }),
    startDistanceDistanceIntersectionCommand: () =>
      beginSession({
        key: 'DISTANCE_DISTANCE_INTX',
        inputValue: '',
        firstPoint: null,
        secondPoint: null,
      }),
    startLineCircleIntersectionCommand: () => {
      if (!selectedLineCommandPoints) return;
      beginSession({
        key: 'LINE_CIRCLE_INTX',
        inputValue: '',
        lineStart: selectedLineCommandPoints.start,
        lineEnd: selectedLineCommandPoints.end,
        targetPoint: null,
      });
    },
    startPerpendicularIntersectionCommand: () => {
      if (!selectedLineCommandPoints) return;
      beginSession({
        key: 'PERP_INTX',
        inputValue: '',
        lineStart: selectedLineCommandPoints.start,
        lineEnd: selectedLineCommandPoints.end,
        targetPoint: null,
      });
    },
    startOffsetIntersectionCommand: () => {
      if (!selectedLinePairCommandPoints) return;
      beginSession({
        key: 'OFFSET_INTX',
        inputValue: '',
        firstLineStart: selectedLinePairCommandPoints.first.start,
        firstLineEnd: selectedLinePairCommandPoints.first.end,
        secondLineStart: selectedLinePairCommandPoints.second.start,
        secondLineEnd: selectedLinePairCommandPoints.second.end,
      });
    },
    startSkewIntersectionCommand: () => {
      if (!selectedLineCommandPoints) return;
      beginSession({
        key: 'SKEW_INTX',
        inputValue: '',
        lineStart: selectedLineCommandPoints.start,
        lineEnd: selectedLineCommandPoints.end,
        targetPoint: null,
      });
    },
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
