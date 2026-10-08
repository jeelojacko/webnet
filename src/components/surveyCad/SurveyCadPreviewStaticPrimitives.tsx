import React, { memo } from 'react';
import type { CadDisplayPrimitive } from '../../engine/cad/cadTypes';
import { isPrimitiveOutsideViewport } from './SurveyCadPreview.geometry';
import { renderPrimitive } from './SurveyCadPreviewPrimitive';
import type { ProjectPoint } from './SurveyCadPreview.types';

/**
 * PERF-183.1 — the static drawing layer.
 *
 * The scene primitives only change when the drawing, viewport, selection, or
 * opacity overrides change — never on a pointer move. This memoized layer is
 * therefore the only place the full scene map runs, and it skips entirely when
 * those inputs are referentially unchanged.
 *
 * Event dispatch is kept out of the memo comparison via a latest-ref dispatch
 * object: the parent rewrites `dispatchRef.current` every render, while the
 * memoized element reads it at event time. That keeps selection/command click
 * semantics exact without invalidating the static subtree on every render.
 */
export interface SurveyCadPrimitiveDispatch {
  onEntityClick: (
    _event: React.MouseEvent<SVGElement>,
    _primitive: CadDisplayPrimitive,
    _sourceSegmentId?: string,
    _appendToSelection?: boolean,
  ) => void;
  onEntityHover?: (
    _event: React.MouseEvent<SVGElement>,
    _primitive: CadDisplayPrimitive,
    _sourceSegmentId?: string,
  ) => void;
  onEntityLeave?: () => void;
  onPrimitiveClickIntercept?: (
    _entityId: string,
    _sourceSegmentId?: string,
  ) => boolean;
}

export interface SurveyCadPreviewStaticPrimitivesProps {
  primitives: readonly CadDisplayPrimitive[];
  project: ProjectPoint;
  scale: number;
  selectedEntityIdSet: ReadonlySet<string>;
  entityOpacityOverrides: Readonly<Record<string, number>>;
  dispatchRef: { current: SurveyCadPrimitiveDispatch };
}

/**
 * Build the event handler bundle lazily: the ref is only read when an event
 * fires, never during render, so the memoized element never re-renders for a
 * callback-identity change. Kept as a plain module helper (not a component)
 * to satisfy the React Compiler ref rules.
 */
const buildEntityHandlers = (dispatchRef: { current: SurveyCadPrimitiveDispatch }) => ({
  onEntityClick: (
    event: React.MouseEvent<SVGElement>,
    primitive: CadDisplayPrimitive,
    segmentId?: string,
    append?: boolean,
  ): void => dispatchRef.current.onEntityClick(event, primitive, segmentId, append),
  onEntityHover: (
    event: React.MouseEvent<SVGElement>,
    primitive: CadDisplayPrimitive,
    segmentId?: string,
  ): void => dispatchRef.current.onEntityHover?.(event, primitive, segmentId),
  onEntityLeave: (): void => dispatchRef.current.onEntityLeave?.(),
  onPrimitiveClickIntercept: (entityId: string, segmentId?: string): boolean =>
    dispatchRef.current.onPrimitiveClickIntercept?.(entityId, segmentId) ?? false,
});

const SurveyCadPreviewStaticPrimitives = memo(function SurveyCadPreviewStaticPrimitives({
  primitives,
  project,
  scale,
  selectedEntityIdSet,
  entityOpacityOverrides,
  dispatchRef,
}: SurveyCadPreviewStaticPrimitivesProps) {
  const handlers = buildEntityHandlers(dispatchRef);
  return (
    <g data-survey-cad-static-primitives>
      {primitives.map((primitive) => {
        if (isPrimitiveOutsideViewport(primitive, project, scale)) return null;
        return renderPrimitive({
          primitive,
          selectedEntityIdSet,
          entityOpacityOverrides,
          project,
          scale,
          ...handlers,
        });
      })}
    </g>
  );
});

export default SurveyCadPreviewStaticPrimitives;
