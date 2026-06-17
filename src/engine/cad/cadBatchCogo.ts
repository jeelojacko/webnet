import { createStableRuntimeId } from '../id';
import {
  cadArcEndTangentAzimuthDeg,
  cadBuildArcFromStartTangentRadiusDelta,
  cadParseBearingDegrees,
  cadParseDmsDegrees,
  cadPointFromAzimuthDistance,
  type CadArcDefinition,
  type CadNamedPoint,
  type CadWorldPoint,
} from './cadGeometry';
import { cadPointFromBearingDistance, formatCadBearing } from './cadCogo';
import type { CadCogoWarning } from './cadCogoTypes';
import type { CadDisplayPrimitive } from './cadTypes';

export type CadBatchCogoRowStatus = 'ok' | 'warning' | 'error';
export type CadBatchCogoRowKind = 'start' | 'line' | 'curve';
export type CadBatchCogoStartSource = 'selected' | 'input';

export interface CadBatchCogoPreviewRow {
  lineNumber: number;
  input: string;
  kind: CadBatchCogoRowKind;
  status: CadBatchCogoRowStatus;
  summary: string;
}

export interface CadBatchCogoLineOperation {
  kind: 'line';
  lineNumber: number;
  from: CadNamedPoint;
  to: CadNamedPoint;
  bearing: string;
  distance: number;
}

export interface CadBatchCogoCurveOperation {
  kind: 'curve';
  lineNumber: number;
  from: CadNamedPoint;
  to: CadNamedPoint;
  side: 'left' | 'right';
  radius: number;
  deltaDeg: number;
  definition: CadArcDefinition;
}

export type CadBatchCogoOperation = CadBatchCogoLineOperation | CadBatchCogoCurveOperation;

export interface CadBatchCogoDraft {
  sourceText: string;
  startPoint: CadNamedPoint | null;
  startPointSource: CadBatchCogoStartSource | null;
  endPoint: CadNamedPoint | null;
  operations: CadBatchCogoOperation[];
  previewRows: CadBatchCogoPreviewRow[];
  warnings: CadCogoWarning[];
  previewPrimitives: CadDisplayPrimitive[];
  generatedPointCount: number;
  generatedLineCount: number;
  generatedArcCount: number;
  canCommit: boolean;
}

interface CadBatchCogoDraftOptions {
  sourceText: string;
  selectedStartPoint?: CadNamedPoint | null;
}

const isNumeric = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return Number.isFinite(Number(trimmed));
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

const parseAbsolutePoint = (token: string): CadNamedPoint | null => {
  const { label, body } = splitLabelFromBody(token);
  const parts = body.split(',').map((part) => part.trim());
  if (parts.length !== 2 || !isNumeric(parts[0] ?? '') || !isNumeric(parts[1] ?? '')) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  return {
    x,
    y,
    label: label ?? `${x.toFixed(3)},${y.toFixed(3)}`,
  };
};

const normalizeAutoPointLabel = (sequence: number): string => `P${sequence}`;

const nextAvailableAutoPointLabel = (
  usedLabels: Set<string>,
  nextSequence: number,
): { label: string; nextSequence: number } => {
  let sequence = nextSequence;
  let label = normalizeAutoPointLabel(sequence);
  while (usedLabels.has(label.toUpperCase())) {
    sequence += 1;
    label = normalizeAutoPointLabel(sequence);
  }
  usedLabels.add(label.toUpperCase());
  return {
    label,
    nextSequence: sequence + 1,
  };
};

const parseBearingDistance = (
  token: string,
  basePoint: CadNamedPoint,
): { point: CadNamedPoint; bearing: string; distance: number } | null => {
  const { label, body } = splitLabelFromBody(token);
  const trimmed = body.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('@')) {
    const parts = trimmed.slice(1).split(',').map((part) => part.trim());
    if (parts.length !== 2 || !isNumeric(parts[0] ?? '') || !isNumeric(parts[1] ?? '')) return null;
    const azimuthDeg = Number(parts[0]);
    const distance = Number(parts[1]);
    if (!Number.isFinite(distance) || distance <= 0) return null;
    const point = cadPointFromAzimuthDistance(basePoint, azimuthDeg, distance);
    return {
      point: {
        ...point,
        label: label ?? `${trimmed}`,
      },
      bearing: formatCadBearing(((azimuthDeg % 360) + 360) % 360),
      distance,
    };
  }

  const commaParts = trimmed.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (commaParts.length === 2 && isNumeric(commaParts[1] ?? '')) {
    const distance = Number(commaParts[1]);
    const point = cadPointFromBearingDistance(basePoint, commaParts[0] ?? '', distance);
    if (!point || distance <= 0) return null;
    return {
      point: {
        ...point,
        label: label ?? `${commaParts[0]},${distance}`,
      },
      bearing: commaParts[0]!,
      distance,
    };
  }

  const match = /^(.+?)\s+([-+]?\d*\.?\d+)\s*$/.exec(trimmed);
  if (!match) return null;
  const bearingToken = (match[1] ?? '').trim();
  const distance = Number(match[2]);
  if (cadParseBearingDegrees(bearingToken) == null || !Number.isFinite(distance) || distance <= 0) {
    return null;
  }
  const point = cadPointFromBearingDistance(basePoint, bearingToken, distance);
  if (!point) return null;
  return {
    point: {
      ...point,
      label: label ?? `${bearingToken} ${distance}`,
    },
    bearing: bearingToken,
    distance,
  };
};

const parseCurveCall = (
  token: string,
): { label?: string; side: 'left' | 'right'; radius: number; deltaDeg: number } | null => {
  const { label, body } = splitLabelFromBody(token);
  const normalized = body.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const match = /^CURVE\s+(LEFT|RIGHT|L|R)\s+(?:R(?:ADIUS)?=?\s*)?([-+]?\d*\.?\d+)\s+(?:DELTA|D)\s*=?\s*(.+)$/i.exec(
    normalized,
  );
  if (!match) return null;
  const radius = Number(match[2]);
  const deltaDeg = cadParseDmsDegrees((match[3] ?? '').trim());
  if (!Number.isFinite(radius) || radius <= 0 || deltaDeg == null || deltaDeg <= 0) return null;
  return {
    label,
    side: /^(LEFT|L)$/i.test(match[1] ?? '') ? 'left' : 'right',
    radius,
    deltaDeg,
  };
};

const buildPreviewPointPrimitive = (
  id: string,
  point: CadWorldPoint,
): CadDisplayPrimitive => ({
  kind: 'point',
  id,
  layerId: 'preview',
  sourceEntityId: id,
  stroke: '#22d3ee',
  fill: '#22d3ee',
  point,
  radius: 2.6,
  opacity: 0.9,
});

const buildPreviewLinePrimitive = (
  id: string,
  start: CadWorldPoint,
  end: CadWorldPoint,
): CadDisplayPrimitive => ({
  kind: 'line',
  id,
  layerId: 'preview',
  sourceEntityId: id,
  stroke: '#22d3ee',
  points: [start, end],
  strokeWidth: 1.5,
  opacity: 0.85,
  strokeDasharray: '8 6',
});

const buildPreviewArcPrimitive = (
  id: string,
  definition: CadArcDefinition,
): CadDisplayPrimitive => ({
  kind: 'arc',
  id,
  layerId: 'preview',
  sourceEntityId: id,
  stroke: '#22d3ee',
  center: definition.center,
  radius: definition.radius,
  startAngleDeg: definition.startAngleDeg,
  endAngleDeg: definition.endAngleDeg,
  strokeWidth: 1.5,
  opacity: 0.85,
  strokeDasharray: '8 6',
});

export const cadDraftBatchCogo = ({
  sourceText,
  selectedStartPoint = null,
}: CadBatchCogoDraftOptions): CadBatchCogoDraft => {
  const previewRows: CadBatchCogoPreviewRow[] = [];
  const warnings: CadCogoWarning[] = [];
  const operations: CadBatchCogoOperation[] = [];
  const previewPrimitives: CadDisplayPrimitive[] = [];
  const lines = sourceText.split(/\r?\n/);

  let currentPoint = selectedStartPoint ? { ...selectedStartPoint } : null;
  let startPoint = selectedStartPoint ? { ...selectedStartPoint } : null;
  let startPointSource: CadBatchCogoStartSource | null = selectedStartPoint ? 'selected' : null;
  let currentTangentAzimuthDeg: number | null = null;
  let generatedPointCount = selectedStartPoint ? 1 : 0;
  let autoPointSequence = 1;
  let hasError = false;
  const usedLabels = new Set<string>();

  if (selectedStartPoint) {
    usedLabels.add(selectedStartPoint.label.toUpperCase());
    previewPrimitives.push(buildPreviewPointPrimitive('preview:batch:start:selected', selectedStartPoint));
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      return;
    }

    const normalized = trimmed.toUpperCase();
    if (normalized.startsWith('START ')) {
      const parsedPoint = parseAbsolutePoint(trimmed.slice(5).trim());
      if (!parsedPoint) {
        hasError = true;
        previewRows.push({
          lineNumber,
          input: rawLine,
          kind: 'start',
          status: 'error',
          summary: 'Invalid START row. Use `START LABEL=x,y` or `START x,y`.',
        });
        return;
      }
      startPoint = parsedPoint;
      currentPoint = parsedPoint;
      startPointSource = 'input';
      currentTangentAzimuthDeg = null;
      generatedPointCount = 1;
      usedLabels.add(parsedPoint.label.toUpperCase());
      previewPrimitives.push(buildPreviewPointPrimitive(`preview:batch:start:${lineNumber}`, parsedPoint));
      previewRows.push({
        lineNumber,
        input: rawLine,
        kind: 'start',
        status: 'ok',
        summary: `Start point ${parsedPoint.label} set at ${parsedPoint.x.toFixed(3)}, ${parsedPoint.y.toFixed(3)}.`,
      });
      return;
    }

    if (!currentPoint) {
      hasError = true;
      previewRows.push({
        lineNumber,
        input: rawLine,
        kind: normalized.startsWith('CURVE') ? 'curve' : 'line',
        status: 'error',
        summary: 'No start point. Select one before starting or add a `START` row first.',
      });
      return;
    }

    const parsedCurve = parseCurveCall(trimmed);
    if (parsedCurve) {
      if (currentTangentAzimuthDeg == null) {
        hasError = true;
        previewRows.push({
          lineNumber,
          input: rawLine,
          kind: 'curve',
          status: 'error',
          summary: 'Curve rows need an incoming tangent. Add at least one line before the first curve.',
        });
        return;
      }
      const definition = cadBuildArcFromStartTangentRadiusDelta(
        currentPoint,
        currentTangentAzimuthDeg,
        parsedCurve.radius,
        parsedCurve.deltaDeg,
        parsedCurve.side,
      );
      if (!definition) {
        hasError = true;
        previewRows.push({
          lineNumber,
          input: rawLine,
          kind: 'curve',
          status: 'error',
          summary: 'Curve row invalid. Use `CURVE LEFT R 50 DELTA 30` or `CURVE R 50 D 30-00-00`.',
        });
        return;
      }
      const autoCurveLabel =
        parsedCurve.label == null ? nextAvailableAutoPointLabel(usedLabels, autoPointSequence) : null;
      const nextPoint: CadNamedPoint = {
        ...definition.endPoint,
        label: parsedCurve.label ?? autoCurveLabel!.label,
      };
      if (parsedCurve.label) usedLabels.add(parsedCurve.label.toUpperCase());
      if (autoCurveLabel) autoPointSequence = autoCurveLabel.nextSequence;
      operations.push({
        kind: 'curve',
        lineNumber,
        from: { ...currentPoint },
        to: nextPoint,
        side: parsedCurve.side,
        radius: parsedCurve.radius,
        deltaDeg: parsedCurve.deltaDeg,
        definition,
      });
      previewPrimitives.push(buildPreviewArcPrimitive(`preview:batch:arc:${lineNumber}`, definition));
      previewPrimitives.push(buildPreviewPointPrimitive(`preview:batch:point:${lineNumber}`, nextPoint));
      previewRows.push({
        lineNumber,
        input: rawLine,
        kind: 'curve',
        status: 'ok',
        summary: `Curve ${parsedCurve.side} to ${nextPoint.label}: R=${parsedCurve.radius.toFixed(3)} Δ=${parsedCurve.deltaDeg.toFixed(4)}°`,
      });
      currentPoint = nextPoint;
      currentTangentAzimuthDeg = cadArcEndTangentAzimuthDeg({
        startAngleDeg: definition.startAngleDeg,
        endAngleDeg: definition.endAngleDeg,
      });
      generatedPointCount += 1;
      return;
    }

    const parsedLine = parseBearingDistance(trimmed, currentPoint);
    if (!parsedLine) {
      hasError = true;
      previewRows.push({
        lineNumber,
        input: rawLine,
        kind: 'line',
        status: 'error',
        summary:
          'Line row invalid. Use `N 35°24\'10" E 125.32`, `LABEL=N45-00-00E,100`, or `@45,100`.',
      });
      return;
    }
    const autoLineLabel =
      parsedLine.point.label === trimmed || parsedLine.point.label === `${parsedLine.bearing} ${parsedLine.distance}`
        ? nextAvailableAutoPointLabel(usedLabels, autoPointSequence)
        : null;
    const nextPoint: CadNamedPoint = {
      ...parsedLine.point,
      label: autoLineLabel?.label ?? parsedLine.point.label,
    };
    if (autoLineLabel) {
      autoPointSequence = autoLineLabel.nextSequence;
    } else {
      usedLabels.add(nextPoint.label.toUpperCase());
    }
    operations.push({
      kind: 'line',
      lineNumber,
      from: { ...currentPoint },
      to: nextPoint,
      bearing: parsedLine.bearing,
      distance: parsedLine.distance,
    });
    previewPrimitives.push(buildPreviewLinePrimitive(`preview:batch:line:${lineNumber}`, currentPoint, nextPoint));
    previewPrimitives.push(buildPreviewPointPrimitive(`preview:batch:point:${lineNumber}`, nextPoint));
    previewRows.push({
      lineNumber,
      input: rawLine,
      kind: 'line',
      status: 'ok',
      summary: `Line to ${nextPoint.label}: ${parsedLine.bearing} ${parsedLine.distance.toFixed(3)}`,
    });
    currentPoint = nextPoint;
    currentTangentAzimuthDeg = cadParseBearingDegrees(parsedLine.bearing);
    generatedPointCount += 1;
  });

  if (operations.length === 0 && sourceText.trim().length > 0 && !hasError) {
    warnings.push({
      code: 'BATCH_COGO_EMPTY',
      severity: 'warning',
      message: 'No drawable COGO rows were parsed from the supplied text.',
    });
  }

  if (!startPoint && sourceText.trim().length > 0) {
    warnings.push({
      code: 'BATCH_COGO_START_REQUIRED',
      severity: 'warning',
      message: 'Provide a selected start point or a `START` row before line or curve calls.',
    });
  }

  return {
    sourceText,
    startPoint,
    startPointSource,
    endPoint: currentPoint,
    operations,
    previewRows,
    warnings,
    previewPrimitives,
    generatedPointCount: operations.length > 0 ? generatedPointCount : 0,
    generatedLineCount: operations.filter((operation) => operation.kind === 'line').length,
    generatedArcCount: operations.filter((operation) => operation.kind === 'curve').length,
    canCommit:
      !hasError &&
      startPoint != null &&
      operations.length > 0 &&
      previewRows.some((row) => row.status === 'ok'),
  };
};

export const buildCadBatchCogoReportRows = (draft: CadBatchCogoDraft) => [
  { label: 'Rows Parsed', value: `${draft.previewRows.length}` },
  { label: 'Points', value: `${draft.generatedPointCount}` },
  { label: 'Lines', value: `${draft.generatedLineCount}` },
  { label: 'Arcs', value: `${draft.generatedArcCount}` },
  { label: 'Start', value: draft.startPoint?.label ?? '--' },
  { label: 'End', value: draft.endPoint?.label ?? '--' },
];

export const buildCadBatchCogoSummary = (draft: CadBatchCogoDraft): string =>
  `Generated ${draft.generatedPointCount} point${draft.generatedPointCount === 1 ? '' : 's'}, ${draft.generatedLineCount} line${draft.generatedLineCount === 1 ? '' : 's'}, and ${draft.generatedArcCount} arc${draft.generatedArcCount === 1 ? '' : 's'}.`;

export const buildCadBatchCogoPreviewId = (): string => createStableRuntimeId('cad-batch-cogo-preview');
