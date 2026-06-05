import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type {
  CadBounds,
  CadGripHandle,
  CadDisplayPrimitive,
  CadDisplayScene,
  CadSnapCandidate,
  CadSnapKind,
} from '../../engine/cad/cadTypes';
import type { CadParcelReportSummary } from '../../engine/cad/cadCogo';
import { cadClosestPointOnArc, cadSignedSweepDeg } from '../../engine/cad/cadGeometry';
import type { CadSnapPreferences } from '../../hooks/surveyCad/useSurveyCadSnapping';

interface SurveyCadPreviewProps {
  scene: CadDisplayScene;
  viewBounds: CadBounds | null;
  selectedEntityIds: readonly string[];
  selectedParcelReport: CadParcelReportSummary | null;
  activeSnap: CadSnapCandidate | null;
  commandPreviewPrimitives: readonly CadDisplayPrimitive[];
  gripHandles?: readonly CadGripHandle[];
  gripPreviewPrimitives?: readonly CadDisplayPrimitive[];
  activeGripHandleId?: string | null;
  commandStatusText: string;
  commandHelpText: string;
  commandModifierHint: string;
  constructionHint: string;
  snapPreferences: CadSnapPreferences;
  commandInputValue: string;
  commandInputPlaceholder: string;
  commandInputEnabled: boolean;
  viewport: { zoom: number; panX: number; panY: number };
  commandActive: boolean;
  commandPointInputActive: boolean;
  onViewportChange: (_viewport: { zoom: number; panX: number; panY: number }) => void;
  onSelectEntity: (_entityId: string, _appendToSelection?: boolean) => void;
  onSelectEntities: (_entityIds: string[], _appendToSelection?: boolean) => void;
  onStartGripEdit?: (_handleId: string) => void;
  onUpdateGripEdit?: (_worldPoint: { x: number; y: number }) => void;
  onFinishGripEdit?: (_worldPoint?: { x: number; y: number }) => void;
  onCancelGripEdit?: () => void;
  onConsumeInteractionPoint: (
    _worldPoint: { x: number; y: number },
    _label?: string,
    _options?: { snapSourceSegmentId?: string; snapSourceEntityId?: string; snapKind?: CadSnapKind },
  ) => void;
  onPointerWorldPointChange: (
    _worldPoint: { x: number; y: number } | null,
    _toleranceWorld?: number,
    _options?: {
      lockConstruction?: boolean;
      visibleBounds?: CadBounds | null;
      restrictedGripHandles?: readonly CadGripHandle[];
    },
  ) => void;
  onSnapPreferenceChange: (_kind: CadSnapKind, _enabled: boolean) => void;
  onCommandInputChange: (_value: string) => void;
  onCommandInputEnter: () => void;
  onCommandInputEscape: () => void;
  onZoomExtents: () => void;
}

const WIDTH = 900;
const HEIGHT = 520;
const PADDING = 36;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4096;
const SNAP_TOLERANCE_SCREEN_UNITS = 18;
const SNAP_TOLERANCE_SCREEN_MIN_UNITS = 5;
const GRIP_SNAP_COMMIT_EPSILON = 1e-9;
const SNAP_MENU_LABELS: Record<CadSnapKind, string> = {
  'point-node': 'Points',
  endpoint: 'Endpoints',
  midpoint: 'Midpoints',
  center: 'Centers',
  'arc-midpoint': 'Arc Midpoints',
  quadrant: 'Quadrants',
  intersection: 'Intersections',
  'apparent-intersection': 'Apparent Int',
  extension: 'Extensions',
  perpendicular: 'Perpendicular',
  parallel: 'Parallel',
  direction: 'Directions',
  tangent: 'Tangent',
  nearest: 'Nearest',
};

const SNAP_BADGE_LABELS: Record<CadSnapKind, string> = {
  'point-node': 'Point',
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  center: 'Center',
  'arc-midpoint': 'Arc Mid',
  quadrant: 'Quadrant',
  intersection: 'Intersection',
  'apparent-intersection': 'Apparent Int',
  extension: 'Extension',
  perpendicular: 'Perpendicular',
  parallel: 'Parallel',
  direction: 'Direction',
  tangent: 'Tangent',
  nearest: 'Nearest',
};

const SNAP_ACCENT_BY_KIND: Record<CadSnapKind, { stroke: string; fill: string; text: string }> = {
  'point-node': { stroke: '#38bdf8', fill: '#082f49', text: '#e0f2fe' },
  endpoint: { stroke: '#22c55e', fill: '#052e16', text: '#dcfce7' },
  midpoint: { stroke: '#a3e635', fill: '#1a2e05', text: '#ecfccb' },
  center: { stroke: '#f59e0b', fill: '#451a03', text: '#fef3c7' },
  'arc-midpoint': { stroke: '#fb7185', fill: '#4c0519', text: '#ffe4e6' },
  quadrant: { stroke: '#c084fc', fill: '#3b0764', text: '#f3e8ff' },
  intersection: { stroke: '#f97316', fill: '#431407', text: '#ffedd5' },
  'apparent-intersection': { stroke: '#ef4444', fill: '#450a0a', text: '#fee2e2' },
  extension: { stroke: '#14b8a6', fill: '#042f2e', text: '#ccfbf1' },
  perpendicular: { stroke: '#eab308', fill: '#422006', text: '#fef9c3' },
  parallel: { stroke: '#6366f1', fill: '#1e1b4b', text: '#e0e7ff' },
  direction: { stroke: '#2dd4bf', fill: '#0f172a', text: '#ccfbf1' },
  tangent: { stroke: '#f43f5e', fill: '#4c0519', text: '#ffe4e6' },
  nearest: { stroke: '#94a3b8', fill: '#0f172a', text: '#e2e8f0' },
};

type ScreenBox = {
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
};

type DragState =
  | { kind: 'none' }
  | { kind: 'pan'; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | { kind: 'box'; box: ScreenBox; appendToSelection: boolean }
  | { kind: 'grip'; handleId: string; startClientX: number; startClientY: number };

const normalizeBounds = (bounds: CadBounds | null): CadBounds => {
  if (!bounds) {
    return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  }
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  return {
    minX: bounds.minX - width * 0.08,
    minY: bounds.minY - height * 0.08,
    maxX: bounds.maxX + width * 0.08,
    maxY: bounds.maxY + height * 0.08,
  };
};

const useProjector = (bounds: CadBounds | null, viewport: { zoom: number; panX: number; panY: number }) =>
  useMemo(() => {
    const normalized = normalizeBounds(bounds);
    const width = normalized.maxX - normalized.minX;
    const height = normalized.maxY - normalized.minY;
    const baseScale = Math.min((WIDTH - PADDING * 2) / width, (HEIGHT - PADDING * 2) / height);
    const project = (x: number, y: number) => ({
      x: PADDING + (x - normalized.minX) * baseScale * viewport.zoom + viewport.panX,
      y: HEIGHT - PADDING - (y - normalized.minY) * baseScale * viewport.zoom + viewport.panY,
    });
    return {
      baseScale,
      scale: baseScale * viewport.zoom,
      normalized,
      project,
      unproject: (viewX: number, viewY: number) => ({
        x: normalized.minX + (viewX - PADDING - viewport.panX) / (baseScale * viewport.zoom),
        y:
          normalized.minY +
          (HEIGHT - PADDING - viewY + viewport.panY) / (baseScale * viewport.zoom),
      }),
    };
  }, [bounds, viewport]);

const visibleWorldBoundsFromViewport = (
  unproject: (_viewX: number, _viewY: number) => { x: number; y: number },
): CadBounds => {
  const topLeft = unproject(0, 0);
  const topRight = unproject(WIDTH, 0);
  const bottomLeft = unproject(0, HEIGHT);
  const bottomRight = unproject(WIDTH, HEIGHT);
  return {
    minX: Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y),
    maxX: Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x),
    maxY: Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y),
  };
};

const primitiveBounds = (
  primitive: CadDisplayPrimitive,
  project: (_x: number, _y: number) => { x: number; y: number },
  scale: number,
): { minX: number; minY: number; maxX: number; maxY: number } => {
  switch (primitive.kind) {
    case 'line': {
      const start = project(primitive.points[0].x, primitive.points[0].y);
      const end = project(primitive.points[1].x, primitive.points[1].y);
      return {
        minX: Math.min(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxX: Math.max(start.x, end.x),
        maxY: Math.max(start.y, end.y),
      };
    }
    case 'point': {
      const point = project(primitive.point.x, primitive.point.y);
      return {
        minX: point.x - primitive.radius - 2,
        minY: point.y - primitive.radius - 2,
        maxX: point.x + primitive.radius + 2,
        maxY: point.y + primitive.radius + 2,
      };
    }
    case 'arc': {
      const center = project(primitive.center.x, primitive.center.y);
      const radius = Math.max(primitive.radius * scale, 1.2);
      return {
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius,
      };
    }
    case 'text': {
      const point = project(primitive.point.x, primitive.point.y);
      const lines = primitive.text.split('\n');
      const longestLine = lines.reduce(
        (current, line) => Math.max(current, line.length),
        0,
      );
      const width = Math.max(24, longestLine * primitive.fontSize * 0.55);
      const height = Math.max(primitive.fontSize, lines.length * primitive.fontSize * 1.2);
      const anchorOffset =
        primitive.textAnchor === 'middle' ? width / 2 : primitive.textAnchor === 'end' ? width : 0;
      return {
        minX: point.x - anchorOffset,
        minY: point.y - primitive.fontSize,
        maxX: point.x - anchorOffset + width,
        maxY: point.y - primitive.fontSize + height,
      };
    }
    case 'ellipse': {
      const center = project(primitive.center.x, primitive.center.y);
      const radiusX = Math.max(primitive.semiMajor * scale, 1.2);
      const radiusY = Math.max(primitive.semiMinor * scale, 0.9);
      return {
        minX: center.x - radiusX,
        minY: center.y - radiusY,
        maxX: center.x + radiusX,
        maxY: center.y + radiusY,
      };
    }
  }
};

const intersectsSelectionBox = (
  primitiveBox: { minX: number; minY: number; maxX: number; maxY: number },
  selectionBox: ScreenBox,
): boolean => {
  const minX = Math.min(selectionBox.anchorX, selectionBox.currentX);
  const maxX = Math.max(selectionBox.anchorX, selectionBox.currentX);
  const minY = Math.min(selectionBox.anchorY, selectionBox.currentY);
  const maxY = Math.max(selectionBox.anchorY, selectionBox.currentY);
  const windowMode = selectionBox.currentX >= selectionBox.anchorX;
  if (windowMode) {
    return (
      primitiveBox.minX >= minX &&
      primitiveBox.maxX <= maxX &&
      primitiveBox.minY >= minY &&
      primitiveBox.maxY <= maxY
    );
  }
  return !(
    primitiveBox.maxX < minX ||
    primitiveBox.minX > maxX ||
    primitiveBox.maxY < minY ||
    primitiveBox.minY > maxY
  );
};

const normalizeSweepAngles = (
  startAngleDeg: number,
  endAngleDeg: number,
): {
  startAngleDeg: number;
  endAngleDeg: number;
  sweepDeg: number;
  largeArcFlag: 0 | 1;
  sweepFlag: 0 | 1;
} => {
  const normalizedStart = ((startAngleDeg % 360) + 360) % 360;
  const signedSweepDeg = cadSignedSweepDeg(startAngleDeg, endAngleDeg);
  const normalizedEnd = normalizedStart + signedSweepDeg;
  const sweepDeg = Math.max(0.0001, Math.abs(signedSweepDeg));
  return {
    startAngleDeg: normalizedStart,
    endAngleDeg: normalizedEnd,
    sweepDeg,
    largeArcFlag: sweepDeg > 180 ? 1 : 0,
    // World Y points up, SVG Y points down. Invert sweep so visible path matches world-space snap geometry.
    sweepFlag: signedSweepDeg >= 0 ? 0 : 1,
  };
};

const arcPathFromPrimitive = (
  primitive: Extract<CadDisplayPrimitive, { kind: 'arc' }>,
  project: (_x: number, _y: number) => { x: number; y: number },
  scale: number,
): string => {
  const signedSweepDeg = cadSignedSweepDeg(primitive.startAngleDeg, primitive.endAngleDeg);
  if (Math.abs(Math.abs(signedSweepDeg) - 360) <= 1e-6) {
    const center = project(primitive.center.x, primitive.center.y);
    const radius = Math.max(primitive.radius * scale, 0.001);
    const startPoint = project(primitive.center.x + primitive.radius, primitive.center.y);
    const sweepFlag = signedSweepDeg >= 0 ? 0 : 1;
    return [
      `M ${startPoint.x} ${startPoint.y}`,
      `A ${radius} ${radius} 0 1 ${sweepFlag} ${center.x - radius} ${center.y}`,
      `A ${radius} ${radius} 0 1 ${sweepFlag} ${startPoint.x} ${startPoint.y}`,
    ].join(' ');
  }
  const { startAngleDeg, endAngleDeg, largeArcFlag, sweepFlag } = normalizeSweepAngles(
    primitive.startAngleDeg,
    primitive.endAngleDeg,
  );
  const startRadians = (startAngleDeg * Math.PI) / 180;
  const endRadians = (endAngleDeg * Math.PI) / 180;
  const startPoint = project(
    primitive.center.x + Math.cos(startRadians) * primitive.radius,
    primitive.center.y + Math.sin(startRadians) * primitive.radius,
  );
  const endPoint = project(
    primitive.center.x + Math.cos(endRadians) * primitive.radius,
    primitive.center.y + Math.sin(endRadians) * primitive.radius,
  );
  const radius = Math.max(primitive.radius * scale, 0.001);
  return `M ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${endPoint.x} ${endPoint.y}`;
};

const renderPrimitive = (
  primitive: CadDisplayPrimitive,
  selectedEntityIds: readonly string[],
  project: (_x: number, _y: number) => { x: number; y: number },
  scale: number,
  onEntityClick: (
    _event: React.MouseEvent<SVGElement>,
    _entityId: string,
    _sourceSegmentId?: string,
    _appendToSelection?: boolean,
  ) => void,
) => {
  const isSelected = selectedEntityIds.includes(primitive.sourceEntityId);
  const commonProps = {
    onClick: (event: React.MouseEvent<SVGElement>) =>
      onEntityClick(event, primitive.sourceEntityId, primitive.sourceSegmentId, event.shiftKey),
    className: 'cursor-pointer',
  };

  switch (primitive.kind) {
    case 'line': {
      const start = project(primitive.points[0].x, primitive.points[0].y);
      const end = project(primitive.points[1].x, primitive.points[1].y);
      return (
        <g key={primitive.id}>
          <line
            {...commonProps}
            data-survey-cad-hit-target="true"
            data-survey-cad-entity-id={primitive.sourceEntityId}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke="transparent"
            strokeWidth={Math.max(16, primitive.strokeWidth + 14)}
            strokeOpacity={0.001}
            pointerEvents="stroke"
          />
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            {...commonProps}
            stroke={isSelected ? '#fbbf24' : primitive.stroke}
            strokeWidth={isSelected ? primitive.strokeWidth + 1.1 : primitive.strokeWidth}
            opacity={primitive.opacity ?? 0.92}
            strokeDasharray={primitive.strokeDasharray}
            pointerEvents="stroke"
          />
        </g>
      );
    }
    case 'arc': {
      const path = arcPathFromPrimitive(primitive, project, scale);
      return (
        <g key={primitive.id}>
          <path
            {...commonProps}
            data-survey-cad-hit-target="true"
            data-survey-cad-entity-id={primitive.sourceEntityId}
            d={path}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(16, primitive.strokeWidth + 14)}
            strokeOpacity={0.001}
            pointerEvents="stroke"
          />
          <path
            d={path}
            fill="none"
            {...commonProps}
            stroke={isSelected ? '#fbbf24' : primitive.stroke}
            strokeWidth={isSelected ? primitive.strokeWidth + 1.1 : primitive.strokeWidth}
            opacity={primitive.opacity ?? 0.92}
            strokeDasharray={primitive.strokeDasharray}
            pointerEvents="stroke"
          />
        </g>
      );
    }
    case 'point': {
      const point = project(primitive.point.x, primitive.point.y);
      return (
        <g key={primitive.id}>
          <circle
            {...commonProps}
            data-survey-cad-hit-target="true"
            data-survey-cad-entity-id={primitive.sourceEntityId}
            cx={point.x}
            cy={point.y}
            r={Math.max(10, primitive.radius + 7)}
            fill="transparent"
            fillOpacity={0.001}
            pointerEvents="fill"
          />
          <circle
            cx={point.x}
            cy={point.y}
            r={isSelected ? primitive.radius + 1.8 : primitive.radius}
            {...commonProps}
            fill={isSelected ? '#fbbf24' : primitive.fill ?? primitive.stroke}
            stroke={isSelected ? '#fef3c7' : '#0f172a'}
            strokeWidth={1.2}
            opacity={primitive.opacity ?? 1}
            pointerEvents="all"
          />
        </g>
      );
    }
    case 'text': {
      const point = project(primitive.point.x, primitive.point.y);
      const displayX = primitive.textAnchor === 'start' || primitive.textAnchor == null ? point.x + 6 : point.x;
      const displayY = primitive.textAnchor === 'start' || primitive.textAnchor == null ? point.y - 6 : point.y;
      return (
        <text
          key={primitive.id}
          {...commonProps}
          x={displayX}
          y={displayY}
          fill={isSelected ? '#fbbf24' : primitive.stroke}
          fontSize={primitive.fontSize}
          opacity={primitive.opacity ?? 1}
          textAnchor={primitive.textAnchor ?? 'start'}
          transform={
            primitive.rotationDeg != null
              ? `rotate(${primitive.rotationDeg} ${displayX} ${displayY})`
              : undefined
          }
        >
          {primitive.text.split('\n').map((line, index) => (
            <tspan
              key={`${primitive.id}:${index + 1}`}
              x={displayX}
              dy={index === 0 ? 0 : primitive.fontSize * 1.15}
            >
              {line}
            </tspan>
          ))}
        </text>
      );
    }
    case 'ellipse': {
      const center = project(primitive.center.x, primitive.center.y);
      return (
        <g key={primitive.id}>
          <ellipse
            {...commonProps}
            cx={center.x}
            cy={center.y}
            rx={Math.max(primitive.semiMajor * scale, 1.2)}
            ry={Math.max(primitive.semiMinor * scale, 0.9)}
            transform={`rotate(${-primitive.thetaDeg} ${center.x} ${center.y})`}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(16, primitive.strokeWidth + 14)}
            opacity={0}
          />
          <ellipse
            cx={center.x}
            cy={center.y}
            rx={Math.max(primitive.semiMajor * scale, 1.2)}
            ry={Math.max(primitive.semiMinor * scale, 0.9)}
            transform={`rotate(${-primitive.thetaDeg} ${center.x} ${center.y})`}
            fill="none"
            {...commonProps}
            stroke={isSelected ? '#fbbf24' : primitive.stroke}
            strokeWidth={isSelected ? primitive.strokeWidth + 0.8 : primitive.strokeWidth}
            opacity={primitive.opacity ?? 0.88}
            strokeDasharray={primitive.strokeDasharray}
            pointerEvents="stroke"
          />
        </g>
      );
    }
  }
};

const SurveyCadPreview: React.FC<SurveyCadPreviewProps> = ({
  scene,
  viewBounds,
  selectedEntityIds,
  selectedParcelReport,
  activeSnap,
  commandPreviewPrimitives,
  gripHandles = [],
  gripPreviewPrimitives = [],
  activeGripHandleId = null,
  commandStatusText,
  commandHelpText,
  commandModifierHint,
  constructionHint,
  snapPreferences,
  commandInputValue,
  commandInputPlaceholder,
  commandInputEnabled,
  viewport,
  commandActive,
  commandPointInputActive,
  onViewportChange,
  onSelectEntity,
  onSelectEntities,
  onStartGripEdit = () => undefined,
  onUpdateGripEdit = () => undefined,
  onFinishGripEdit = () => undefined,
  onCancelGripEdit = () => undefined,
  onConsumeInteractionPoint,
  onPointerWorldPointChange,
  onSnapPreferenceChange,
  onCommandInputChange,
  onCommandInputEnter,
  onCommandInputEscape,
  onZoomExtents,
}) => {
  const { baseScale, normalized, project, scale, unproject } = useProjector(viewBounds, viewport);
  const visibleWorldBounds = useMemo(() => visibleWorldBoundsFromViewport(unproject), [unproject]);
  const snapToleranceScreenUnits = useMemo(
    () =>
      Math.max(
        SNAP_TOLERANCE_SCREEN_MIN_UNITS,
        SNAP_TOLERANCE_SCREEN_UNITS - Math.max(0, Math.log2(Math.max(viewport.zoom, 1))) * 2.2,
      ),
    [viewport.zoom],
  );
  const [dragState, setDragState] = useState<DragState>({ kind: 'none' });
  const [didDrag, setDidDrag] = useState(false);
  const [snapMenuOpen, setSnapMenuOpen] = useState(false);
  const selectionBox = dragState.kind === 'box' ? dragState.box : null;
  const middleMouseDownAtRef = useRef<number>(0);
  const activeGripDragIdRef = useRef<string | null>(null);
  const [armedSnap, setArmedSnap] = useState<CadSnapCandidate | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const activeSnapRef = useRef<CadSnapCandidate | null>(activeSnap);
  const activeSnapAccent = activeSnap ? SNAP_ACCENT_BY_KIND[activeSnap.kind] : null;
  const transientPreviewPrimitives = useMemo(
    () => [...commandPreviewPrimitives, ...gripPreviewPrimitives],
    [commandPreviewPrimitives, gripPreviewPrimitives],
  );

  React.useEffect(() => {
    if (!commandInputEnabled) return;
    commandInputRef.current?.focus();
  }, [commandInputEnabled, commandActive]);

  useEffect(() => {
    activeSnapRef.current = activeSnap;
  }, [activeSnap]);

  const screenPointFromClientPoint = (
    rect: DOMRect,
    clientX: number,
    clientY: number,
  ): { rect: DOMRect; viewX: number; viewY: number } | null => {
    if (rect.width <= 0 || rect.height <= 0) return null;
    const scaleFactor = Math.min(rect.width / WIDTH, rect.height / HEIGHT);
    const contentWidth = WIDTH * scaleFactor;
    const contentHeight = HEIGHT * scaleFactor;
    const offsetX = (rect.width - contentWidth) / 2;
    const offsetY = (rect.height - contentHeight) / 2;
    return {
      rect,
      viewX: (clientX - rect.left - offsetX) / scaleFactor,
      viewY: (clientY - rect.top - offsetY) / scaleFactor,
    };
  };

  const resolveGripCommitPoint = useCallback((rawWorldPoint: { x: number; y: number }) => {
    const currentSnap = activeSnapRef.current;
    const snapToleranceWorld = snapToleranceScreenUnits / scale;
    if (
      currentSnap &&
      Math.hypot(currentSnap.x - rawWorldPoint.x, currentSnap.y - rawWorldPoint.y) <=
        snapToleranceWorld + GRIP_SNAP_COMMIT_EPSILON
    ) {
      return { x: currentSnap.x, y: currentSnap.y };
    }
    return rawWorldPoint;
  }, [scale, snapToleranceScreenUnits]);

  const updateGripDragInteraction = useCallback(
    (rawWorldPoint: { x: number; y: number }, shiftKey: boolean) => {
      onPointerWorldPointChange(rawWorldPoint, snapToleranceScreenUnits / scale, {
        lockConstruction: shiftKey,
        visibleBounds: visibleWorldBounds,
        restrictedGripHandles: [],
      });
      onUpdateGripEdit(rawWorldPoint);
    },
    [onPointerWorldPointChange, onUpdateGripEdit, scale, snapToleranceScreenUnits, visibleWorldBounds],
  );

  useEffect(() => {
    if (dragState.kind !== 'grip') return;
    const handleWindowMouseMove = (event: MouseEvent) => {
      const svg = document.querySelector('[data-survey-cad-preview]') as SVGElement | null;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const screenPoint = screenPointFromClientPoint(rect, event.clientX, event.clientY);
      if (!screenPoint) return;
      updateGripDragInteraction(unproject(screenPoint.viewX, screenPoint.viewY), event.shiftKey);
    };
    const handleWindowMouseUp = (event: MouseEvent) => {
      if (activeGripDragIdRef.current == null) return;
      const svg = document.querySelector('[data-survey-cad-preview]') as SVGElement | null;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const screenPoint = screenPointFromClientPoint(rect, event.clientX, event.clientY);
      if (!screenPoint) return;
      const rawWorldPoint = unproject(screenPoint.viewX, screenPoint.viewY);
      updateGripDragInteraction(rawWorldPoint, event.shiftKey);
      activeGripDragIdRef.current = null;
      onFinishGripEdit(resolveGripCommitPoint(rawWorldPoint));
      setDidDrag(false);
      setDragState({ kind: 'none' });
    };
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [dragState.kind, onFinishGripEdit, resolveGripCommitPoint, unproject, updateGripDragInteraction]);

  const screenPointFromMouseEvent = (
    event: React.MouseEvent<SVGElement>,
  ): { rect: DOMRect; viewX: number; viewY: number } | null => {
    const svgElement =
      event.currentTarget instanceof SVGSVGElement
        ? event.currentTarget
        : event.currentTarget.ownerSVGElement ?? event.currentTarget;
    return screenPointFromClientPoint(svgElement.getBoundingClientRect(), event.clientX, event.clientY);
  };

  const consumeSnapCandidate = (snapCandidate: CadSnapCandidate) => {
    onConsumeInteractionPoint(
      { x: snapCandidate.x, y: snapCandidate.y },
      snapCandidate.label,
      {
        snapSourceSegmentId: snapCandidate.sourceSegmentId,
        snapSourceEntityId: snapCandidate.sourceEntityId,
        snapKind: snapCandidate.kind,
      },
    );
  };

  const consumeLatchedOrActiveSnap = (): boolean => {
    const latchedSnap = armedSnap ?? activeSnap;
    setArmedSnap(null);
    if (!latchedSnap) return false;
    consumeSnapCandidate(latchedSnap);
    return true;
  };

  const handlePrimitiveCommandClick = (
    event: React.MouseEvent<SVGElement>,
    primitive: CadDisplayPrimitive,
    sourceSegmentId?: string,
  ) => {
    if (didDrag) return;
    if (consumeLatchedOrActiveSnap()) {
      return;
    }
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const scaleFactor = Math.min(rect.width / WIDTH, rect.height / HEIGHT);
    const contentWidth = WIDTH * scaleFactor;
    const contentHeight = HEIGHT * scaleFactor;
    const offsetX = (rect.width - contentWidth) / 2;
    const offsetY = (rect.height - contentHeight) / 2;
    const viewX = (event.clientX - rect.left - offsetX) / scaleFactor;
    const viewY = (event.clientY - rect.top - offsetY) / scaleFactor;
    const rawWorldPoint = unproject(viewX, viewY);
    if (primitive.kind === 'arc') {
      onConsumeInteractionPoint(
        cadClosestPointOnArc(
          rawWorldPoint,
          primitive.center,
          primitive.radius,
          primitive.startAngleDeg,
          primitive.endAngleDeg,
        ),
        undefined,
        {
          snapSourceSegmentId: sourceSegmentId,
          snapSourceEntityId: primitive.sourceEntityId,
          snapKind: 'nearest',
        },
      );
      return;
    }
    onConsumeInteractionPoint(rawWorldPoint, undefined, {
      snapSourceSegmentId: sourceSegmentId,
      snapSourceEntityId: primitive.sourceEntityId,
    });
  };

  return (
    <div className="relative h-full w-full bg-slate-950" data-survey-cad-preview-shell>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-full w-full bg-slate-950 select-none"
        data-survey-cad-preview
        onClick={(event) => {
          if (!commandPointInputActive || didDrag || event.target !== event.currentTarget) return;
          if (consumeLatchedOrActiveSnap()) {
            return;
          }
          const screenPoint = screenPointFromMouseEvent(event);
          if (!screenPoint) return;
          onConsumeInteractionPoint(unproject(screenPoint.viewX, screenPoint.viewY));
        }}
        onMouseLeave={() => {
          if (activeGripDragIdRef.current != null) {
            activeGripDragIdRef.current = null;
            onCancelGripEdit();
            setDidDrag(false);
            setDragState({ kind: 'none' });
          }
          if (dragState.kind === 'none') onPointerWorldPointChange(null);
        }}
        onMouseDown={(event) => {
          const screenPoint = screenPointFromMouseEvent(event);
          if (!screenPoint) return;
          if (event.button === 1) {
            event.preventDefault();
            const now = event.timeStamp;
            if (now - middleMouseDownAtRef.current <= 280) {
              middleMouseDownAtRef.current = 0;
              setDragState({ kind: 'none' });
              onZoomExtents();
              return;
            }
            middleMouseDownAtRef.current = now;
            setDidDrag(false);
            setDragState({
              kind: 'pan',
              startClientX: event.clientX,
              startClientY: event.clientY,
              startPanX: viewport.panX,
              startPanY: viewport.panY,
            });
            return;
          }
          if (event.button === 0 && commandPointInputActive && activeSnap) {
            setArmedSnap(activeSnap);
          } else if (event.button === 0) {
            setArmedSnap(null);
          }
          const target = event.target as Element | null;
          if (
            event.button === 0 &&
            target?.getAttribute('data-survey-cad-background') === 'true' &&
            !commandActive
          ) {
            setDidDrag(false);
            setDragState({
              kind: 'box',
              box: {
                anchorX: screenPoint.viewX,
                anchorY: screenPoint.viewY,
                currentX: screenPoint.viewX,
                currentY: screenPoint.viewY,
              },
              appendToSelection: event.shiftKey,
            });
          }
        }}
        onMouseMove={(event) => {
          const screenPoint = screenPointFromMouseEvent(event);
          if (!screenPoint) return;
          const { rect, viewX, viewY } = screenPoint;
          if (dragState.kind === 'pan') {
            if (
              Math.abs(event.clientX - dragState.startClientX) > 2 ||
              Math.abs(event.clientY - dragState.startClientY) > 2
            ) {
              setDidDrag(true);
            }
            onViewportChange({
              ...viewport,
              panX: dragState.startPanX + ((event.clientX - dragState.startClientX) / rect.width) * WIDTH,
              panY: dragState.startPanY + ((event.clientY - dragState.startClientY) / rect.height) * HEIGHT,
            });
          } else if (dragState.kind === 'box') {
            if (
              Math.abs(viewX - dragState.box.anchorX) > 2 ||
              Math.abs(viewY - dragState.box.anchorY) > 2
            ) {
              setDidDrag(true);
            }
            setDragState({
              ...dragState,
              box: {
                ...dragState.box,
                currentX: viewX,
                currentY: viewY,
              },
            });
          } else if (activeGripDragIdRef.current != null) {
            if (
              (dragState.kind === 'grip' &&
                (Math.abs(event.clientX - dragState.startClientX) > 2 ||
                  Math.abs(event.clientY - dragState.startClientY) > 2)) ||
              dragState.kind !== 'grip'
            ) {
              setDidDrag(true);
            }
          }
          const rawWorldPoint = unproject(viewX, viewY);
          onPointerWorldPointChange(
            rawWorldPoint,
            snapToleranceScreenUnits / scale,
            {
              lockConstruction: event.shiftKey,
              visibleBounds: visibleWorldBounds,
              restrictedGripHandles:
                !commandPointInputActive && activeGripDragIdRef.current == null ? gripHandles : [],
            },
          );
          if (activeGripDragIdRef.current != null) {
            updateGripDragInteraction(rawWorldPoint, event.shiftKey);
          }
        }}
        onMouseUp={(event) => {
          if (dragState.kind === 'box') {
            const minX = Math.min(dragState.box.anchorX, dragState.box.currentX);
            const maxX = Math.max(dragState.box.anchorX, dragState.box.currentX);
            const minY = Math.min(dragState.box.anchorY, dragState.box.currentY);
            const maxY = Math.max(dragState.box.anchorY, dragState.box.currentY);
            if (maxX - minX >= 4 || maxY - minY >= 4) {
              const ids = scene.primitives
                .filter((primitive) =>
                  intersectsSelectionBox(primitiveBounds(primitive, project, scale), dragState.box),
                )
                .map((primitive) => primitive.sourceEntityId)
                .filter((entityId, index, ids) => ids.indexOf(entityId) === index);
              onSelectEntities(ids, dragState.appendToSelection);
            }
          }
          if (activeGripDragIdRef.current != null) {
            const screenPoint = screenPointFromMouseEvent(event);
            activeGripDragIdRef.current = null;
            onFinishGripEdit(
              screenPoint ? resolveGripCommitPoint(unproject(screenPoint.viewX, screenPoint.viewY)) : undefined,
            );
          }
          if (dragState.kind === 'pan') {
            middleMouseDownAtRef.current = 0;
          }
          if (didDrag) {
            setArmedSnap(null);
          }
          if (!commandPointInputActive) {
            setArmedSnap(null);
          }
          setDidDrag(false);
          setDragState({ kind: 'none' });
        }}
        onWheel={(event) => {
          event.preventDefault();
          const screenPoint = screenPointFromMouseEvent(event);
          if (!screenPoint) return;
          const { viewX, viewY } = screenPoint;
          const worldPoint = unproject(viewX, viewY);
          const nextZoom = Math.max(
            MIN_ZOOM,
            Math.min(MAX_ZOOM, viewport.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)),
          );
          if (Math.abs(nextZoom - viewport.zoom) <= 1e-9) return;
          onViewportChange({
            zoom: nextZoom,
            panX: viewX - (PADDING + (worldPoint.x - normalized.minX) * baseScale * nextZoom),
            panY:
              viewY - (HEIGHT - PADDING - (worldPoint.y - normalized.minY) * baseScale * nextZoom),
          });
        }}
      >
      <rect
        x={0}
        y={0}
        width={WIDTH}
        height={HEIGHT}
        fill="#020617"
        data-survey-cad-background="true"
        onClick={(event) => {
          if (!commandPointInputActive || didDrag) return;
          if (consumeLatchedOrActiveSnap()) {
            return;
          }
          const screenPoint = screenPointFromMouseEvent(event);
          if (!screenPoint) return;
          onConsumeInteractionPoint(unproject(screenPoint.viewX, screenPoint.viewY));
        }}
      />
        <g>
          {scene.primitives.map((primitive) =>
            renderPrimitive(primitive, selectedEntityIds, project, scale, (event, entityId, sourceSegmentId, appendToSelection) => {
            if (commandPointInputActive) {
              handlePrimitiveCommandClick(event, primitive, sourceSegmentId);
              return;
            }
            flushSync(() => {
              onSelectEntity(entityId, appendToSelection);
            });
          }),
        )}
        {transientPreviewPrimitives.length > 0 ? (
          <g data-survey-cad-command-preview>
            {transientPreviewPrimitives.map((primitive) =>
              primitive.kind === 'line' ? (
                <line
                  key={primitive.id}
                  data-survey-cad-command-preview-line
                  x1={project(primitive.points[0].x, primitive.points[0].y).x}
                  y1={project(primitive.points[0].x, primitive.points[0].y).y}
                  x2={project(primitive.points[1].x, primitive.points[1].y).x}
                  y2={project(primitive.points[1].x, primitive.points[1].y).y}
                  stroke={primitive.stroke}
                  strokeWidth={primitive.strokeWidth}
                  opacity={primitive.opacity ?? 0.85}
                  strokeDasharray={primitive.strokeDasharray ?? '8 6'}
                  pointerEvents="none"
                />
              ) : primitive.kind === 'point' ? (
                <circle
                  key={primitive.id}
                  data-survey-cad-command-preview-point
                  cx={project(primitive.point.x, primitive.point.y).x}
                  cy={project(primitive.point.x, primitive.point.y).y}
                  r={primitive.radius}
                  fill={primitive.fill ?? primitive.stroke}
                  opacity={primitive.opacity ?? 0.85}
                  pointerEvents="none"
                />
              ) : primitive.kind === 'text' ? (
                <text
                  key={primitive.id}
                  x={project(primitive.point.x, primitive.point.y).x + 6}
                  y={project(primitive.point.x, primitive.point.y).y - 6}
                  fill={primitive.stroke}
                  fontSize={primitive.fontSize}
                  opacity={primitive.opacity ?? 0.85}
                  pointerEvents="none"
                >
                  {primitive.text}
                </text>
              ) : primitive.kind === 'arc' ? (
                <path
                  key={primitive.id}
                  data-survey-cad-command-preview-arc
                  d={arcPathFromPrimitive(primitive, project, scale)}
                  fill="none"
                  stroke={primitive.stroke}
                  strokeWidth={primitive.strokeWidth}
                  opacity={primitive.opacity ?? 0.85}
                  strokeDasharray={primitive.strokeDasharray ?? '8 6'}
                  pointerEvents="none"
                />
              ) : (
                <ellipse
                  key={primitive.id}
                  cx={project(primitive.center.x, primitive.center.y).x}
                  cy={project(primitive.center.x, primitive.center.y).y}
                  rx={Math.max(primitive.semiMajor * scale, 1.2)}
                  ry={Math.max(primitive.semiMinor * scale, 0.9)}
                  transform={`rotate(${-primitive.thetaDeg} ${project(primitive.center.x, primitive.center.y).x} ${project(primitive.center.x, primitive.center.y).y})`}
                  fill="none"
                  stroke={primitive.stroke}
                  strokeWidth={primitive.strokeWidth}
                  opacity={primitive.opacity ?? 0.85}
                  strokeDasharray={primitive.strokeDasharray ?? '8 6'}
                  pointerEvents="none"
                />
              ),
            )}
          </g>
        ) : null}
        {gripHandles.length > 0 ? (
          <g data-survey-cad-grip-handles>
            {gripHandles.map((handle) => {
              const point = project(handle.x, handle.y);
              const isActive = activeGripHandleId === handle.id;
              return (
                <circle
                  key={handle.id}
                  data-survey-cad-grip-handle={handle.kind}
                  data-survey-cad-grip-handle-id={handle.id}
                  data-survey-cad-grip-entity-id={handle.entityId}
                  cx={point.x}
                  cy={point.y}
                  r={isActive ? 7.2 : 5.8}
                  fill={isActive ? '#22d3ee' : '#f8fafc'}
                  stroke={isActive ? '#67e8f9' : '#0f172a'}
                  strokeWidth={1.4}
                  className="cursor-move"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setDidDrag(false);
                    setArmedSnap(null);
                    activeGripDragIdRef.current = handle.id;
                    onStartGripEdit(handle.id);
                    setDragState({
                      kind: 'grip',
                      handleId: handle.id,
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                    });
                  }}
                />
              );
            })}
          </g>
        ) : null}
        {activeSnap?.guideSegments?.length ? (
          <g data-survey-cad-snap-guides>
            {activeSnap.guideSegments.map((segment, index) => (
              <line
                key={`${activeSnap.id}:guide:${index + 1}`}
                data-survey-cad-snap-guide
                x1={project(segment[0].x, segment[0].y).x}
                y1={project(segment[0].x, segment[0].y).y}
                x2={project(segment[1].x, segment[1].y).x}
                y2={project(segment[1].x, segment[1].y).y}
                stroke={activeSnapAccent?.stroke ?? '#fbbf24'}
                strokeWidth={1.2}
                opacity={0.8}
                strokeDasharray="7 5"
                pointerEvents="none"
              />
            ))}
          </g>
        ) : null}
        {activeSnap ? (
          <g data-survey-cad-snap-glyph pointerEvents="none">
            <circle
              cx={project(activeSnap.x, activeSnap.y).x}
              cy={project(activeSnap.x, activeSnap.y).y}
              r={6}
              fill="none"
              stroke={activeSnapAccent?.stroke ?? '#fbbf24'}
              strokeWidth={1.2}
            />
            <line
              x1={project(activeSnap.x, activeSnap.y).x - 8}
              y1={project(activeSnap.x, activeSnap.y).y}
              x2={project(activeSnap.x, activeSnap.y).x + 8}
              y2={project(activeSnap.x, activeSnap.y).y}
              stroke={activeSnapAccent?.text ?? '#fef3c7'}
              strokeWidth={1}
            />
            <line
              x1={project(activeSnap.x, activeSnap.y).x}
              y1={project(activeSnap.x, activeSnap.y).y - 8}
              x2={project(activeSnap.x, activeSnap.y).x}
              y2={project(activeSnap.x, activeSnap.y).y + 8}
              stroke={activeSnapAccent?.text ?? '#fef3c7'}
              strokeWidth={1}
            />
          </g>
        ) : null}
        {selectionBox ? (
          <rect
            data-survey-cad-selection-box
            x={Math.min(selectionBox.anchorX, selectionBox.currentX)}
            y={Math.min(selectionBox.anchorY, selectionBox.currentY)}
            width={Math.abs(selectionBox.currentX - selectionBox.anchorX)}
            height={Math.abs(selectionBox.currentY - selectionBox.anchorY)}
            fill={selectionBox.currentX >= selectionBox.anchorX ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.12)'}
            stroke={selectionBox.currentX >= selectionBox.anchorX ? '#22c55e' : '#fbbf24'}
            strokeDasharray="6 4"
            strokeWidth={1.2}
          />
        ) : null}
      </g>
      </svg>
      <div
        className="pointer-events-none absolute bottom-3 left-3 max-w-[32rem] text-[11px] leading-4 text-slate-300"
        data-survey-cad-command-help
      >
        {commandStatusText ? (
          <>
            <div className="pb-1 text-cyan-200" data-survey-cad-command-status>
              {commandStatusText}
            </div>
            {commandInputEnabled ? <div>{commandHelpText}</div> : null}
          </>
        ) : null}
      </div>
      {commandModifierHint ? (
        <div
          className="pointer-events-none absolute bottom-3 right-16 rounded border border-amber-500/30 bg-slate-950/88 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200"
          data-survey-cad-command-modifier-hint
        >
          {commandModifierHint}
        </div>
      ) : null}
      {constructionHint ? (
        <div
          className="pointer-events-none absolute right-16 top-16 rounded border border-cyan-500/25 bg-slate-950/88 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-100"
          data-survey-cad-construction-hint
        >
          {constructionHint}
        </div>
      ) : null}
      {activeSnap ? (
        <div
          className="pointer-events-none absolute left-3 top-16 rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
          style={{
            borderColor: activeSnapAccent?.stroke ?? '#fbbf24',
            backgroundColor: activeSnapAccent?.fill ?? '#0f172a',
            color: activeSnapAccent?.text ?? '#fef3c7',
          }}
          data-survey-cad-snap-badge
        >
          {SNAP_BADGE_LABELS[activeSnap.kind]}: {activeSnap.label}
        </div>
      ) : null}
      <div className="absolute bottom-3 right-3" data-survey-cad-snap-menu>
        {snapMenuOpen ? (
          <div className="absolute bottom-9 right-0 mb-1 w-44 rounded border border-slate-700 bg-slate-950/95 p-2 shadow-xl">
            <div className="pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Object Snaps
            </div>
            {Object.entries(SNAP_MENU_LABELS).map(([kind, label]) => {
              const snapKind = kind as CadSnapKind;
              return (
                <label
                  key={snapKind}
                  className="flex cursor-pointer items-center justify-between gap-3 py-1 text-xs text-slate-200"
                >
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={snapPreferences[snapKind]}
                    onChange={(event) => onSnapPreferenceChange(snapKind, event.target.checked)}
                    data-survey-cad-snap-toggle={snapKind}
                  />
                </label>
              );
            })}
          </div>
        ) : null}
        <button
          type="button"
          className="rounded border border-slate-700/90 bg-slate-950/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200 transition-colors hover:border-cyan-500/80"
          onClick={() => setSnapMenuOpen((current) => !current)}
          data-survey-cad-snap-menu-button
        >
          Snaps
        </button>
      </div>
      <div className="absolute bottom-3 left-1/2 w-[min(32rem,calc(100%-12rem))] -translate-x-1/2">
        <input
          ref={commandInputRef}
          type="text"
          value={commandInputValue}
          onChange={(event) => onCommandInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommandInputEnter();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCommandInputEscape();
            }
          }}
          placeholder={commandInputPlaceholder}
          className="w-full rounded border border-slate-700/90 bg-slate-950/90 px-3 py-2 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-500/80"
          disabled={!commandInputEnabled}
          data-survey-cad-command-input
        />
      </div>
      {selectedParcelReport ? (
        <div
          className="pointer-events-none absolute right-3 top-16 z-10 max-h-[calc(100%-8rem)] w-[19rem] overflow-hidden rounded border border-slate-800/80 bg-slate-950/88 p-3 text-[11px] text-slate-200 shadow-xl backdrop-blur-[1px]"
          data-survey-cad-parcel-report
        >
          <div className="pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
            {selectedParcelReport.parcelName}
          </div>
          <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11px] leading-4">
            <span className="text-slate-400">Area</span>
            <span>{selectedParcelReport.areaSquareMeters.toFixed(3)} m²</span>
            <span className="text-slate-400">Perimeter</span>
            <span>{selectedParcelReport.perimeterMeters.toFixed(3)} m</span>
            <span className="text-slate-400">Closure dN</span>
            <span>{selectedParcelReport.closureDeltaY.toFixed(3)} m</span>
            <span className="text-slate-400">Closure dE</span>
            <span>{selectedParcelReport.closureDeltaX.toFixed(3)} m</span>
            <span className="text-slate-400">Closure</span>
            <span>{selectedParcelReport.closureDistanceMeters.toFixed(3)} m</span>
          </div>
          <div className="pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Courses
          </div>
          <div className="pt-1">
            {selectedParcelReport.courses.map((course, index) => (
              <div
                key={`${course.fromLabel}-${course.toLabel}-${index + 1}`}
                className="grid grid-cols-[4.75rem_1fr_auto] gap-x-2 py-0.5 text-[11px] leading-4"
                data-survey-cad-parcel-course
              >
                <span className="text-slate-400">{course.fromLabel}-{course.toLabel}</span>
                <span>{course.azimuthText}</span>
                <span>{course.distanceMeters.toFixed(3)} m</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SurveyCadPreview;
