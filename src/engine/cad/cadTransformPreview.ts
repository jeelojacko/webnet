// Phase 18Q transform preview: pure display-primitive derivation for the
// `transform-selection` preview state (ROTATE / SCALE / MIRROR / ALIGN2D and
// the MOVE ghost-dim fix). Transforms primitive coordinates only — no
// project mutation, no full-scene rebuild, no store writes — so preview
// counts never leak into authoritative entity/definition counts.
//
// Arc/ellipse/text orientation under reflection: a reflection across a line
// of direction φ maps absolute angle θ to (2φ − θ); classifyTransform
// reports rotationDeg = atan2(b, a) = 2φ for the reflection family, so the
// ghost maps start/end (swapped to keep the sweep readable) and glyph
// rotation through that angle. Ghost-grade approximation, documented here.

import {
  applyPoint,
  classifyTransform,
  type CadTransform2D,
} from './cadTransform2D';
import type { CadDisplayPrimitive } from './cadDisplayTypes';
import type { CadEntityId } from './cadTypes';

export interface TransformPreviewStyle {
  stroke?: string;
  opacity?: number;
  idPrefix?: string;
  /** Bounds the ghost for whole-drawing previews (never a 100k-primitive SVG). */
  maxPrimitives?: number;
}

export const buildTransformedPreviewPrimitives = (
  displayPrimitives: readonly CadDisplayPrimitive[],
  sourceEntityIds: readonly CadEntityId[],
  transform: CadTransform2D,
  style: TransformPreviewStyle = {},
): CadDisplayPrimitive[] => {
  const wanted = new Set(sourceEntityIds);
  const stroke = style.stroke ?? '#22d3ee';
  const opacity = style.opacity ?? 0.6;
  const idPrefix = style.idPrefix ?? 'preview:transform';
  const classification = classifyTransform(transform);
  const scale = classification?.scale ?? 1;
  const rotationDeg = classification?.rotationDeg ?? 0;
  const reflected = (classification?.determinantSign ?? 1) < 0;
  const primitives = displayPrimitives
    .filter((primitive) => wanted.has(primitive.sourceEntityId))
    .slice(0, style.maxPrimitives ?? Number.POSITIVE_INFINITY);
  return primitives.map((primitive, index) => {
    const id = `${idPrefix}:${index + 1}`;
    switch (primitive.kind) {
      case 'point':
        return {
          ...primitive,
          id,
          sourceEntityId: id,
          stroke,
          fill: stroke,
          point: applyPoint(transform, primitive.point),
          opacity,
        };
      case 'line':
        return {
          ...primitive,
          id,
          sourceEntityId: id,
          stroke,
          points: [
            applyPoint(transform, primitive.points[0]),
            applyPoint(transform, primitive.points[1]),
          ] as [{ x: number; y: number }, { x: number; y: number }],
          opacity,
          strokeDasharray: '8 6',
        };
      case 'arc': {
        const startAngleDeg = reflected
          ? rotationDeg - primitive.endAngleDeg
          : primitive.startAngleDeg + rotationDeg;
        const endAngleDeg = reflected
          ? rotationDeg - primitive.startAngleDeg
          : primitive.endAngleDeg + rotationDeg;
        return {
          ...primitive,
          id,
          sourceEntityId: id,
          stroke,
          center: applyPoint(transform, primitive.center),
          radius: primitive.radius * scale,
          startAngleDeg,
          endAngleDeg,
          opacity,
          strokeDasharray: '8 6',
        };
      }
      case 'text': {
        const baseRotation = primitive.rotationDeg ?? 0;
        return {
          ...primitive,
          id,
          sourceEntityId: id,
          stroke,
          point: applyPoint(transform, primitive.point),
          rotationDeg: reflected ? rotationDeg - baseRotation : baseRotation + rotationDeg,
          opacity,
        };
      }
      case 'ellipse': {
        return {
          ...primitive,
          id,
          sourceEntityId: id,
          stroke,
          center: applyPoint(transform, primitive.center),
          semiMajor: primitive.semiMajor * scale,
          semiMinor: primitive.semiMinor * scale,
          thetaDeg: reflected ? rotationDeg - primitive.thetaDeg : primitive.thetaDeg + rotationDeg,
          opacity,
          strokeDasharray: '8 6',
        };
      }
    }
  });
}

export interface PreviewDimmingInput {
  kind: string;
  sourceEntityIds?: readonly CadEntityId[];
  copyMode?: boolean;
}

/**
 * Which source entities the preview dims (ghost) at 0.25. In-place previews
 * (MOVE translate, ROTATE/SCALE/MIRROR-yes/ALIGN2D transform) dim their
 * sources; copy previews (COPY/PASTE translate, MIRROR-no transform) leave
 * originals at full opacity.
 */
export const transformPreviewDimmedEntityIds = (
  preview: PreviewDimmingInput | null,
  activeCommandKey: string | null,
  selectedEntityIds: readonly CadEntityId[],
): readonly CadEntityId[] => {
  if (!preview) return [];
  if (preview.kind === 'translate-selection') {
    return activeCommandKey === 'MOVE' ? (preview.sourceEntityIds ?? selectedEntityIds) : [];
  }
  if (preview.kind === 'transform-selection') {
    return preview.copyMode ? [] : (preview.sourceEntityIds ?? selectedEntityIds);
  }
  return [];
};
