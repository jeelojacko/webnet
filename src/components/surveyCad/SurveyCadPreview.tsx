import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CadDisplayPrimitive, CadSnapCandidate } from '../../engine/cad/cadTypes';
import { cadClosestPointOnArc } from '../../engine/cad/cadGeometry';
import {
  GRIP_SNAP_COMMIT_EPSILON,
  SNAP_ACCENT_BY_KIND,
  SNAP_TOLERANCE_SCREEN_MIN_UNITS,
  SNAP_TOLERANCE_SCREEN_UNITS,
  SURVEY_CAD_MAX_ZOOM,
  SURVEY_CAD_MIN_ZOOM,
  SURVEY_CAD_PREVIEW_HEIGHT,
  SURVEY_CAD_PREVIEW_PADDING,
  SURVEY_CAD_PREVIEW_WIDTH,
} from './SurveyCadPreview.constants';
import {
  intersectsSelectionBox,
  primitiveBounds,
  screenPointFromClientPoint,
  useProjector,
  visibleWorldBoundsFromViewport,
} from './SurveyCadPreview.geometry';
import {
  GripHandleLayer,
  SelectionBoxLayer,
  SnapGuideLayer,
  TransientPreviewLayer,
} from './SurveyCadPreviewLayers';
import { SurveyCadParcelReportOverlay } from './SurveyCadParcelReportOverlay';
import {
  SurveyCadCommandHelpOverlay,
  SurveyCadCommandInputBar,
  SurveyCadSnapBadge,
  SurveyCadSnapControls,
} from './SurveyCadPreviewOverlays';
import { renderPrimitive } from './SurveyCadPreviewPrimitive';
import type { DragState, SurveyCadPreviewProps } from './SurveyCadPreview.types';

const SurveyCadPreview: React.FC<SurveyCadPreviewProps> = ({
  scene,
  viewBounds,
  selectedEntityIds,
  selectedParcelReport,
  showParcelLabels = true,
  hasTopRightOverlay = false,
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
  commandEntityOpacityOverrides = {},
  viewport,
  commandActive,
  commandPointInputActive,
  onViewportChange,
  onPrimitiveClickIntercept,
  onSelectEntity,
  onSelectEntities,
  onStartGripEdit = () => undefined,
  onUpdateGripEdit = () => undefined,
  onFinishGripEdit = () => undefined,
  onCancelGripEdit = () => undefined,
  onConsumeInteractionPoint,
  onPointerWorldPointChange,
  onToggleParcelLabels = () => undefined,
  onCommandHoverTargetChange = () => undefined,
  onSnapPreferenceChange,
  onCommandInputChange,
  onCommandInputEnter,
  onCommandInputEscape,
  onEmptyBackgroundDoubleClick,
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

  const consumeSnapCandidate = (snapCandidate: CadSnapCandidate, extendMode = false) => {
    onConsumeInteractionPoint(
      { x: snapCandidate.x, y: snapCandidate.y },
      snapCandidate.label,
      {
        snapSourceSegmentId: snapCandidate.sourceSegmentId,
        snapSourceEntityId: snapCandidate.sourceEntityId,
        snapKind: snapCandidate.kind,
        extendMode,
      },
    );
  };

  const consumeLatchedOrActiveSnap = (extendMode = false): boolean => {
    const latchedSnap = armedSnap ?? activeSnap;
    setArmedSnap(null);
    if (!latchedSnap) return false;
    consumeSnapCandidate(latchedSnap, extendMode);
    return true;
  };

  const handlePrimitiveCommandClick = (
    event: React.MouseEvent<SVGElement>,
    primitive: CadDisplayPrimitive,
    sourceSegmentId?: string,
  ) => {
    if (didDrag) return;
    if (consumeLatchedOrActiveSnap(event.shiftKey)) {
      return;
    }
    const screenPoint = screenPointFromMouseEvent(event);
    if (!screenPoint) return;
    const rawWorldPoint = unproject(screenPoint.viewX, screenPoint.viewY);
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
          extendMode: event.shiftKey,
        },
      );
      return;
    }
    onConsumeInteractionPoint(rawWorldPoint, undefined, {
      snapSourceSegmentId: sourceSegmentId,
      snapSourceEntityId: primitive.sourceEntityId,
      extendMode: event.shiftKey,
    });
  };

  const handlePrimitiveCommandHover = (
    event: React.MouseEvent<SVGElement>,
    primitive: CadDisplayPrimitive,
    sourceSegmentId?: string,
  ) => {
    if (!commandPointInputActive) {
      onCommandHoverTargetChange(null);
      return;
    }
    const screenPoint = screenPointFromMouseEvent(event);
    if (!screenPoint) return;
    const rawWorldPoint = unproject(screenPoint.viewX, screenPoint.viewY);
    const point =
      primitive.kind === 'arc'
        ? cadClosestPointOnArc(
            rawWorldPoint,
            primitive.center,
            primitive.radius,
            primitive.startAngleDeg,
            primitive.endAngleDeg,
          )
        : rawWorldPoint;
    onCommandHoverTargetChange({
      entityId: primitive.sourceEntityId,
      segmentId: sourceSegmentId,
      point,
      extendMode: event.shiftKey,
    });
  };

  return (
    <div className="relative h-full w-full bg-slate-950" data-survey-cad-preview-shell>
      <svg
        viewBox={`0 0 ${SURVEY_CAD_PREVIEW_WIDTH} ${SURVEY_CAD_PREVIEW_HEIGHT}`}
        className="h-full w-full bg-slate-950 select-none"
        data-survey-cad-preview
        onClick={(event) => {
          if (!commandPointInputActive || didDrag || event.target !== event.currentTarget) return;
          if (consumeLatchedOrActiveSnap(event.shiftKey)) {
            return;
          }
          const screenPoint = screenPointFromMouseEvent(event);
          if (!screenPoint) return;
          onConsumeInteractionPoint(unproject(screenPoint.viewX, screenPoint.viewY), undefined, {
            extendMode: event.shiftKey,
          });
        }}
        onMouseLeave={() => {
          onCommandHoverTargetChange(null);
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
              panX: dragState.startPanX + ((event.clientX - dragState.startClientX) / rect.width) * SURVEY_CAD_PREVIEW_WIDTH,
              panY: dragState.startPanY + ((event.clientY - dragState.startClientY) / rect.height) * SURVEY_CAD_PREVIEW_HEIGHT,
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
          const target = event.target as Element | null;
          if (
            commandPointInputActive &&
            (target == null || target.getAttribute('data-survey-cad-background') === 'true')
          ) {
            onCommandHoverTargetChange(null);
          }
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
            SURVEY_CAD_MIN_ZOOM,
            Math.min(SURVEY_CAD_MAX_ZOOM, viewport.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)),
          );
          if (Math.abs(nextZoom - viewport.zoom) <= 1e-9) return;
          onViewportChange({
            zoom: nextZoom,
            panX: viewX - (SURVEY_CAD_PREVIEW_PADDING + (worldPoint.x - normalized.minX) * baseScale * nextZoom),
            panY:
              viewY - (SURVEY_CAD_PREVIEW_HEIGHT - SURVEY_CAD_PREVIEW_PADDING - (worldPoint.y - normalized.minY) * baseScale * nextZoom),
          });
        }}
      >
      <rect
        x={0}
        y={0}
        width={SURVEY_CAD_PREVIEW_WIDTH}
        height={SURVEY_CAD_PREVIEW_HEIGHT}
        fill="#020617"
        data-survey-cad-background="true"
        onClick={(event) => {
          if (!commandPointInputActive || didDrag) return;
          if (consumeLatchedOrActiveSnap(event.shiftKey)) {
            return;
          }
          const screenPoint = screenPointFromMouseEvent(event);
          if (!screenPoint) return;
          onConsumeInteractionPoint(unproject(screenPoint.viewX, screenPoint.viewY), undefined, {
            extendMode: event.shiftKey,
          });
        }}
        onDoubleClick={(event) => {
          if (event.target !== event.currentTarget) return;
          onEmptyBackgroundDoubleClick?.();
        }}
      />
        <g>
          {scene.primitives.map((primitive) =>
            renderPrimitive({
              primitive,
              selectedEntityIds,
              entityOpacityOverrides: commandEntityOpacityOverrides,
              project,
              scale,
              onEntityClick: (event, entityId, sourceSegmentId, appendToSelection) => {
                if (commandPointInputActive) {
                  handlePrimitiveCommandClick(event, primitive, sourceSegmentId);
                  return;
                }
                flushSync(() => {
                  onSelectEntity(entityId, appendToSelection);
                });
              },
              onEntityHover: handlePrimitiveCommandHover,
              onEntityLeave: () => onCommandHoverTargetChange(null),
              onPrimitiveClickIntercept,
            }),
        )}
        <TransientPreviewLayer
          primitives={transientPreviewPrimitives}
          project={project}
          scale={scale}
        />
        <GripHandleLayer
          gripHandles={gripHandles}
          activeGripHandleId={activeGripHandleId}
          project={project}
          onStartGrip={(event, handle) => {
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
        <SnapGuideLayer
          activeSnap={activeSnap}
          activeSnapAccent={activeSnapAccent}
          project={project}
        />
        <SelectionBoxLayer selectionBox={selectionBox} />
      </g>
      </svg>
      <SurveyCadCommandHelpOverlay
        commandStatusText={commandStatusText}
        commandHelpText={commandHelpText}
        commandInputEnabled={commandInputEnabled}
        commandModifierHint={commandModifierHint}
        constructionHint={constructionHint}
      />
      <SurveyCadSnapBadge activeSnap={activeSnap} activeSnapAccent={activeSnapAccent} />
      <SurveyCadSnapControls
        snapMenuOpen={snapMenuOpen}
        setSnapMenuOpen={setSnapMenuOpen}
        showParcelLabels={showParcelLabels}
        snapPreferences={snapPreferences}
        onToggleParcelLabels={onToggleParcelLabels}
        onSnapPreferenceChange={onSnapPreferenceChange}
      />
      <SurveyCadCommandInputBar
        commandInputRef={commandInputRef}
        commandInputValue={commandInputValue}
        commandInputPlaceholder={commandInputPlaceholder}
        commandInputEnabled={commandInputEnabled}
        onCommandInputChange={onCommandInputChange}
        onCommandInputEnter={onCommandInputEnter}
        onCommandInputEscape={onCommandInputEscape}
      />
      <SurveyCadParcelReportOverlay
        selectedParcelReport={selectedParcelReport}
        hasTopRightOverlay={hasTopRightOverlay}
      />
    </div>
  );
};

export default SurveyCadPreview;
