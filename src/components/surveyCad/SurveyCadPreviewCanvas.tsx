import React, { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
  SURVEY_CAD_MAX_ZOOM,
  SURVEY_CAD_MIN_ZOOM,
  SURVEY_CAD_PREVIEW_HEIGHT,
  SURVEY_CAD_PREVIEW_PADDING,
  SURVEY_CAD_PREVIEW_WIDTH,
} from './SurveyCadPreview.constants';
import {
  intersectsSelectionBox,
  primitiveBounds,
} from './SurveyCadPreview.geometry';
import type { SurveyCadPreviewCanvasProps } from './SurveyCadPreviewCanvas.types';
import {
  GripHandleLayer,
  SelectionBoxLayer,
  SnapGuideLayer,
  TransientPreviewLayer,
} from './SurveyCadPreviewLayers';
import { renderPrimitive } from './SurveyCadPreviewPrimitive';
import { renderSurfaceLayers } from './SurveyCadPreviewSurface';

const SurveyCadPreviewCanvas: React.FC<SurveyCadPreviewCanvasProps> = ({
  activeGripDragIdRef,
  activeGripHandleId,
  activeSnap,
  activeSnapAccent,
  baseScale,
  commandActive,
  commandEntityOpacityOverrides,
  commandPointInputActive,
  consumeLatchedOrActiveSnap,
  didDrag,
  dragState,
  gripHandles,
  handlePrimitiveCommandClick,
  handlePrimitiveCommandHover,
  middleMouseDownAtRef,
  normalized,
  onCancelGripEdit,
  onCommandHoverTargetChange,
  onConsumeInteractionPoint,
  onEmptyBackgroundDoubleClick,
  onFinishGripEdit,
  onPointerWorldPointChange,
  onPrimitiveClickIntercept,
  onSelectEntities,
  onSelectEntity,
  onSurfaceClick,
  onSurfacePickPoint,
  onStartGripEdit,
  onViewportChange,
  onZoomExtents,
  project,
  resolveGripCommitPoint,
  scale,
  scene,
  screenPointFromMouseEvent,
  selectedEntityIds,
  selectedSurfaceId = null,
  selectionBox,
  surfacePickActive = false,
  setArmedSnap,
  setDidDrag,
  setDragState,
  snapToleranceScreenUnits,
  transientPreviewPrimitives,
  unproject,
  updateGripDragInteraction,
  viewport,
  visibleWorldBounds,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Latest-props ref: the native wheel listener below is attached once
  // (React delivers wheel/touch listeners as passive, so preventDefault
  // inside onWheel logs "Unable to preventDefault inside passive event
  // listener"), while the zoom math must always see fresh viewport data.
  const wheelProps = {
    screenPointFromMouseEvent,
    unproject,
    viewport,
    onViewportChange,
    normalized,
    baseScale,
  };
  const wheelPropsRef = useRef(wheelProps);
  useEffect(() => {
    wheelPropsRef.current = wheelProps;
  });
  useEffect(() => {
    const node = svgRef.current;
    if (!node) return;
    const handleWheelNative = (event: WheelEvent): void => {
      event.preventDefault();
      const props = wheelPropsRef.current;
      const screenPoint = props.screenPointFromMouseEvent({
        clientX: event.clientX,
        clientY: event.clientY,
        currentTarget: node,
      } as React.MouseEvent<SVGSVGElement>);
      if (!screenPoint) return;
      const { viewX, viewY } = screenPoint;
      const worldPoint = props.unproject(viewX, viewY);
      const nextZoom = Math.max(
        SURVEY_CAD_MIN_ZOOM,
        Math.min(SURVEY_CAD_MAX_ZOOM, props.viewport.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)),
      );
      if (Math.abs(nextZoom - props.viewport.zoom) <= 1e-9) return;
      props.onViewportChange({
        zoom: nextZoom,
        panX:
          viewX -
          (SURVEY_CAD_PREVIEW_PADDING + (worldPoint.x - props.normalized.minX) * props.baseScale * nextZoom),
        panY:
          viewY -
          (SURVEY_CAD_PREVIEW_HEIGHT -
            SURVEY_CAD_PREVIEW_PADDING -
            (worldPoint.y - props.normalized.minY) * props.baseScale * nextZoom),
      });
    };
    node.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => {
      node.removeEventListener('wheel', handleWheelNative);
    };
  }, []);
  return (
  <svg
    ref={svgRef}
    viewBox={`0 0 ${SURVEY_CAD_PREVIEW_WIDTH} ${SURVEY_CAD_PREVIEW_HEIGHT}`}
    className="h-full w-full bg-slate-950 select-none"
    data-survey-cad-preview
    onClick={(event) => {
      if (surfacePickActive) {
        if (didDrag || event.target !== event.currentTarget) return;
        const screenPoint = screenPointFromMouseEvent(event);
        if (!screenPoint) return;
        onSurfacePickPoint?.(unproject(screenPoint.viewX, screenPoint.viewY));
        return;
      }
      if (!commandPointInputActive || didDrag || event.target !== event.currentTarget) return;
      if (consumeLatchedOrActiveSnap(event.shiftKey)) return;
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
          panX:
            dragState.startPanX +
            ((event.clientX - dragState.startClientX) / rect.width) *
              SURVEY_CAD_PREVIEW_WIDTH,
          panY:
            dragState.startPanY +
            ((event.clientY - dragState.startClientY) / rect.height) *
              SURVEY_CAD_PREVIEW_HEIGHT,
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
      onPointerWorldPointChange(rawWorldPoint, snapToleranceScreenUnits / scale, {
        lockConstruction: event.shiftKey,
        visibleBounds: visibleWorldBounds,
        restrictedGripHandles:
          !commandPointInputActive && activeGripDragIdRef.current == null ? gripHandles : [],
      });
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
  >
    <rect
      x={0}
      y={0}
      width={SURVEY_CAD_PREVIEW_WIDTH}
      height={SURVEY_CAD_PREVIEW_HEIGHT}
      fill="#020617"
      data-survey-cad-background="true"
      onClick={(event) => {
        if (surfacePickActive) {
          if (didDrag) return;
          const screenPoint = screenPointFromMouseEvent(event);
          if (!screenPoint) return;
          onSurfacePickPoint?.(unproject(screenPoint.viewX, screenPoint.viewY));
          return;
        }
        if (!commandPointInputActive || didDrag) return;
        if (consumeLatchedOrActiveSnap(event.shiftKey)) return;
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
      {scene.surfaceLayers && scene.surfaceLayers.length > 0
        ? renderSurfaceLayers({
          layers: scene.surfaceLayers,
          selectedSurfaceId,
          project,
          scale,
          pickActive: surfacePickActive,
          onSurfaceClick: (surfaceId) => onSurfaceClick?.(surfaceId),
        })
        : null}
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
      <SnapGuideLayer activeSnap={activeSnap} activeSnapAccent={activeSnapAccent} project={project} />
      <SelectionBoxLayer selectionBox={selectionBox} />
    </g>
  </svg>
  );
};

export default SurveyCadPreviewCanvas;
