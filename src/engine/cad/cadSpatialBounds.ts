import type { CadBounds, CadProject } from './cadTypes';
import type { CadWorldPoint } from './cadGeometry';
import type { CadArcRef } from './cadSpatialIndexTypes';
import { arcRefFromEntity } from './cadSpatialEntityRefs';
import { blockReferenceBounds, findBlockDefinition } from './cadBlocks';
import { buildCadProjectLookup, type CadProjectLookup } from './cadProjectLookup';
import { resolveCadAnnotationAnchor } from './annotation/cadAnnotationAnchors';
import {
  resolveAnnotationScaleDenominator,
} from './annotation/cadAnnotationSettings';
import { resolveCadAnnotationTextMetrics } from './annotation/cadAnnotationTextMetrics';
import {
  bearingLabelPlacement,
  deriveBearingDistanceLabel,
  deriveCurveLabel,
} from './annotation/cadSurveyLabels';
import {
  attachmentTextAnchor,
  attachmentVertical,
  curveLabelPlacement,
  leaderTextReferencePoint,
  normalizeTextAttachment,
  sumOffsets,
} from './annotation/cadAnnotationPlacement';
import { resolveDimensionDerivation } from './cadRenderer';
import { cadSurveyTableWorldBounds } from './cadSurveyTableDerive';

export const expandBounds = (bounds: CadBounds, padding: number): CadBounds => ({
  minX: bounds.minX - padding,
  minY: bounds.minY - padding,
  maxX: bounds.maxX + padding,
  maxY: bounds.maxY + padding,
});

export const pointInsideBounds = (point: CadWorldPoint, bounds: CadBounds): boolean =>
  point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;

export const segmentIntersectsBounds = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  bounds: CadBounds,
): boolean => {
  if (pointInsideBounds(start, bounds) || pointInsideBounds(end, bounds)) return true;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return !(maxX < bounds.minX || minX > bounds.maxX || maxY < bounds.minY || minY > bounds.maxY);
};

export const arcIntersectsBounds = (arc: CadArcRef, bounds: CadBounds): boolean => {
  const minX = arc.center.x - arc.radius;
  const maxX = arc.center.x + arc.radius;
  const minY = arc.center.y - arc.radius;
  const maxY = arc.center.y + arc.radius;
  return !(maxX < bounds.minX || minX > bounds.maxX || maxY < bounds.minY || minY > bounds.maxY);
};

// ---------------------------------------------------------------------------
// Phase 18O annotation bounds (derived unions; cheap deterministic text
// estimates only — no Canvas.measureText). Broken references fall back to
// the insertion/text point.
// ---------------------------------------------------------------------------

/** Style-resolved model text height (meters); legacy fallback when unknown. */
const annotationBoundTextHeight = (
  project: CadProject,
  textStyleId: string | undefined,
  lookup?: CadProjectLookup,
): number => {
  const fallback = 2.5;
  const textStyle =
    textStyleId != null
      ? lookup
        ? lookup.textStyleById.get(textStyleId)
        : project.styleLibrary.textStyles.find((entry) => entry.id === textStyleId)
      : undefined;
  if (!textStyle) return fallback;
  const height = resolveCadAnnotationTextMetrics({
    fontFamily: textStyle.fontFamily,
    fontSize: textStyle.fontSize,
    heightMode: textStyle.heightMode,
    modelHeight: textStyle.modelHeight,
    paperHeightMm: textStyle.paperHeightMm,
    widthFactor: textStyle.widthFactor,
    lineSpacingFactor: textStyle.lineSpacingFactor,
    fontWeight: textStyle.fontWeight === 'bold' ? 700 : 400,
    fontStyle: textStyle.fontStyle,
    annotationScaleDenominator: resolveAnnotationScaleDenominator(project.annotationSettings),
    unitsMode: project.metadata.units,
  }).modelHeight;
  return height > 0 ? height : fallback;
};

/** Block corners of a multiline text estimate (chars * 0.6 * height). */
const multilineBlockCorners = (
  insertion: CadWorldPoint,
  text: string,
  height: number,
  rotationDeg: number,
  horizontal: 'start' | 'middle' | 'end',
  vertical: 'top' | 'middle' | 'bottom',
): CadWorldPoint[] => {
  const lines = text.split('\n');
  const width = lines.reduce((longest, line) => Math.max(longest, line.length), 0) * 0.6 * height;
  const totalHeight = lines.length * height * 1.2;
  const radians = (rotationDeg * Math.PI) / 180;
  const dir = { x: Math.cos(radians), y: Math.sin(radians) };
  const up = { x: -Math.sin(radians), y: Math.cos(radians) };
  const u0 = horizontal === 'middle' ? -width / 2 : horizontal === 'end' ? -width : 0;
  const v0 = vertical === 'middle' ? -totalHeight / 2 : vertical === 'bottom' ? -totalHeight : 0;
  return [
    { u: u0, v: v0 + totalHeight },
    { u: u0 + width, v: v0 + totalHeight },
    { u: u0, v: v0 },
    { u: u0 + width, v: v0 },
  ].map((corner) => ({
    x: insertion.x + dir.x * corner.u + up.x * corner.v,
    y: insertion.y + dir.y * corner.u + up.y * corner.v,
  }));
};

const pointsIntersectBounds = (points: CadWorldPoint[], bounds: CadBounds): boolean => {
  if (points.length === 0) return false;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return !(maxX < bounds.minX || minX > bounds.maxX || maxY < bounds.minY || minY > bounds.maxY);
};

export const entityIntersectsBounds = (
  project: CadProject,
  entity: CadProject['entities'][number],
  bounds: CadBounds,
  lookup?: CadProjectLookup,
): boolean => {
  // One lookup per top-level call when the caller did not hoist one. Callers
  // that scan many entities (spatial index, export) pass a shared lookup so
  // source/style resolution stays O(1) instead of O(entities) per entity.
  const lk = lookup ?? buildCadProjectLookup(project);
  switch (entity.type) {
    case 'survey-point':
      return pointInsideBounds({ x: entity.x, y: entity.y }, bounds);
    case 'line':
      return segmentIntersectsBounds(
        { x: entity.fromX, y: entity.fromY },
        { x: entity.toX, y: entity.toY },
        bounds,
      );
    case 'polyline':
    case 'polygon':
    case 'parcel': {
      const points =
        entity.type === 'polyline'
          ? entity.vertices
          : [...entity.vertices, entity.vertices[0]].filter(
              (point): point is CadWorldPoint => point != null,
            );
      return points.slice(0, -1).some((point, index) =>
        segmentIntersectsBounds(point, points[index + 1]!, bounds),
      );
    }
    case 'arc':
      return arcIntersectsBounds(arcRefFromEntity(project, entity), bounds);
    case 'text':
      return pointInsideBounds({ x: entity.x, y: entity.y }, bounds);
    case 'error-ellipse':
      return !(
        entity.centerX + entity.semiMajor < bounds.minX ||
        entity.centerX - entity.semiMajor > bounds.maxX ||
        entity.centerY + entity.semiMajor < bounds.minY ||
        entity.centerY - entity.semiMajor > bounds.maxY
      );
    case 'block-reference': {
      // Single source: world-space bounds of the expanded instance.
      // Unknown definitions fall back to the insertion point (world
      // coords only — block-local geometry never leaks into queries).
      const definition =
        lk.blockDefinitionById.get(entity.blockDefinitionId) ??
        (lookup ? undefined : findBlockDefinition(project.blockDefinitions, entity.blockDefinitionId));
      if (!definition) return pointInsideBounds({ x: entity.x, y: entity.y }, bounds);
      let world: CadBounds | null;
      try {
        world = blockReferenceBounds(definition, entity);
      } catch {
        return pointInsideBounds({ x: entity.x, y: entity.y }, bounds);
      }
      if (!world) return pointInsideBounds({ x: entity.x, y: entity.y }, bounds);
      return !(world.maxX < bounds.minX || world.minX > bounds.maxX || world.maxY < bounds.minY || world.minY > bounds.maxY);
    }
    case 'mtext': {
      const height = annotationBoundTextHeight(project, entity.textStyleId, lk);
      const horizontal = entity.attachment.endsWith('right')
        ? 'end' as const
        : entity.attachment.endsWith('center')
          ? 'middle' as const
          : 'start' as const;
      const vertical = entity.attachment.startsWith('middle')
        ? 'middle' as const
        : entity.attachment.startsWith('bottom')
          ? 'bottom' as const
          : 'top' as const;
      return pointsIntersectBounds(
        multilineBlockCorners(
          { x: entity.x, y: entity.y },
          entity.text,
          height,
          entity.rotationDeg,
          horizontal,
          vertical,
        ),
        bounds,
      );
    }
    case 'leader': {
      const resolution = resolveCadAnnotationAnchor(entity.arrowAnchor, project, lk);
      if (!resolution.ok) {
        return pointInsideBounds({ x: resolution.fallbackX, y: resolution.fallbackY }, bounds);
      }
      const leaderStyle = lk.leaderStyleById.get(entity.leaderStyleId);
      const height = annotationBoundTextHeight(
        project,
        entity.textStyleId ?? leaderStyle?.textStyleId,
        lk,
      );
      const arrowPoint = { x: resolution.x, y: resolution.y };
      const through = [arrowPoint, ...entity.vertices];
      const last = through.at(-1) ?? arrowPoint;
      const before = through.length >= 2 ? through[through.length - 2]! : { x: last.x - 1, y: last.y };
      const dx = last.x - before.x;
      const dy = last.y - before.y;
      const length = Math.hypot(dx, dy);
      const dir = length > 1e-12 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
      const landingLength = leaderStyle?.landingLength ?? 0;
      const landingEnd = {
        x: last.x + dir.x * landingLength,
        y: last.y + dir.y * landingLength,
      };
      const reference = leaderTextReferencePoint(landingEnd, dir, leaderStyle?.textGap ?? 0);
      const attachment = normalizeTextAttachment(entity.textAttachment);
      // Arrowhead body extends by its size from the tip; pad conservatively.
      const arrowSize = Math.max(0, leaderStyle?.arrowSize ?? 2.5);
      return pointsIntersectBounds(
        [
          ...through,
          landingEnd,
          { x: arrowPoint.x - arrowSize, y: arrowPoint.y - arrowSize },
          { x: arrowPoint.x + arrowSize, y: arrowPoint.y + arrowSize },
          ...multilineBlockCorners(
            reference,
            entity.text,
            height,
            0,
            attachmentTextAnchor(attachment),
            attachmentVertical(attachment),
          ),
        ],
        bounds,
      );
    }
    case 'dimension': {
      const derived = resolveDimensionDerivation(project, entity, lk);
      if (!derived) {
        const fallback = entity.textPoint ?? entity.dimLinePoint;
        return pointInsideBounds(fallback, bounds);
      }
      const geometry = derived.geometry.bounds;
      return !(
        geometry.maxX < bounds.minX ||
        geometry.minX > bounds.maxX ||
        geometry.maxY < bounds.minY ||
        geometry.minY > bounds.maxY
      );
    }
    case 'bearing-label': {
      const source = lk.entityById.get(entity.sourceEntityId);
      if (source?.type !== 'line') return pointInsideBounds(entity.offset, bounds);
      const labelStyle = lk.bearingLabelStyleById.get(entity.labelStyleId);
      const from = { x: source.fromX, y: source.fromY };
      const to = { x: source.toX, y: source.toY };
      const label = deriveBearingDistanceLabel({
        from,
        to,
        content: labelStyle?.content ?? 'bearing-distance',
        separator: labelStyle?.separator === 'space' ? ' ' : labelStyle?.separator === 'slash' ? '/' : '\n',
        distancePrecision: labelStyle?.decimalPrecision ?? 3,
      });
      const offsetMagnitude = labelStyle ? Math.hypot(labelStyle.offset.x, labelStyle.offset.y) : 0;
      const placement = bearingLabelPlacement(
        from,
        to,
        offsetMagnitude,
        entity.side === 'right' ? 'right' : 'left',
      );
      return pointsIntersectBounds(
        multilineBlockCorners(
          { x: placement.x + entity.offset.x, y: placement.y + entity.offset.y },
          entity.manualTextOverride ?? label.text,
          annotationBoundTextHeight(project, labelStyle?.textStyleId, lk),
          placement.rotationDeg,
          'middle',
          'middle',
        ),
        bounds,
      );
    }
    case 'curve-label': {
      const source = lk.entityById.get(entity.sourceEntityId);
      const labelStyle = lk.curveLabelStyleById.get(entity.labelStyleId);      if (source?.type !== 'arc') return pointInsideBounds(entity.offset, bounds);
      const label = deriveCurveLabel({
        center: { x: source.centerX, y: source.centerY },
        radius: source.radius,
        startAngleDeg: source.startAngleDeg,
        endAngleDeg: source.endAngleDeg,
        fields: labelStyle?.fields ?? ['radius', 'delta', 'length'],
        decimalPrecision: labelStyle?.decimalPrecision ?? 3,
      });
      if (!label) return pointInsideBounds(entity.offset, bounds);
      const placement = curveLabelPlacement({
        center: { x: source.centerX, y: source.centerY },
        radius: source.radius,
        startAngleDeg: source.startAngleDeg,
        endAngleDeg: source.endAngleDeg,
        offset: sumOffsets(labelStyle?.offset, entity.offset),
      });
      if (!placement) return pointInsideBounds(entity.offset, bounds);
      return pointsIntersectBounds(
        multilineBlockCorners(
          { x: placement.x, y: placement.y },
          entity.manualTextOverride ?? label.text,
          annotationBoundTextHeight(project, labelStyle?.textStyleId, lk),
          placement.rotationDeg,
          'middle',
          'middle',
        ),
        bounds,
      );
    }
    case 'survey-table': {
      const world = cadSurveyTableWorldBounds(entity, project);
      if (!world) return false;
      return !(
        world.maxX < bounds.minX ||
        world.minX > bounds.maxX ||
        world.maxY < bounds.minY ||
        world.minY > bounds.maxY
      );
    }
    default:
      return true;
  }
};
