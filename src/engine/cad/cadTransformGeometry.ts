// Phase 18Q core: per-entity transform geometry (pure, engine only).
//
// `transformCadEntityGeometry` applies an already-classified CadTransform2D to
// ONE entity and returns a NEW entity object (never mutates input). It reuses
// the kernel (`applyPoint`/`applyVector`, no new trig) and existing model
// helpers (parcel closure summary, arc angle helpers). Callers own selection
// expansion, editability gates, and commit (see cadTransformApply.ts).

import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometrySummaries';
import {
  cadAngleDegFromCenter,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadSignedSweepDeg,
} from './cadGeometry';
import {
  applyPoint,
  applyVector,
  type CadTransform2D,
  type CadTransformClassification,
} from './cadTransform2D';
import type { CadAnnotationAnchor } from './annotation/cadAnnotationAnchors';
import type { CadAlignmentElement, CadEntity } from './cadTypes';

export type TransformCadEntityGeometryResult =
  | { ok: true; entity: CadEntity }
  | { ok: false; reason: string };

const ALIGNMENT_TOLERANCE = 1e-9;

const isReflection = (classification: CadTransformClassification): boolean =>
  classification.determinantSign === -1;

interface TransformedArcAngles {
  centerX: number;
  centerY: number;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}

// Shared arc-angle rule for `arc` entities and `alignment` arc elements:
// transform the center + the ACTUAL start/end points, recompute both angles
// from the transformed points, then carry the signed sweep (flipped under
// reflection). Full-circle (±360°) is preserved by construction and can never
// collapse to 0, because the end angle is start + signed sweep, not a bare
// recomputed angle.
const transformArcAngles = (
  centerX: number,
  centerY: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  transform: CadTransform2D,
  classification: CadTransformClassification,
): TransformedArcAngles => {
  const center = { x: centerX, y: centerY };
  const newCenter = applyPoint(transform, center);
  const newRadius = radius * Math.abs(classification.scale);
  const startPoint = applyPoint(transform, cadPointOnCircle(center, radius, startAngleDeg));
  const newStartAngleDeg = cadAngleDegFromCenter(newCenter, startPoint);
  const sweep = cadSignedSweepDeg(startAngleDeg, endAngleDeg);
  const carriedSweep = isReflection(classification) ? -sweep : sweep;
  return {
    centerX: newCenter.x,
    centerY: newCenter.y,
    radius: newRadius,
    startAngleDeg: newStartAngleDeg,
    endAngleDeg: newStartAngleDeg + carriedSweep,
  };
};

const transformAnchorPoint = (
  anchor: CadAnnotationAnchor,
  transform: CadTransform2D,
): CadAnnotationAnchor => {
  // FIXED anchors are frozen coordinates: transform them. Associative anchors
  // are live references into source geometry: keep them verbatim here (they
  // re-resolve against the transformed source, so touching them would
  // double-apply the transform).
  if (anchor.kind !== 'fixed') return anchor;
  const next = applyPoint(transform, anchor);
  return { kind: 'fixed', x: next.x, y: next.y };
};

const normalizeRotationDeg = (rotationDeg: number): number =>
  cadNormalizeAngleDeg(rotationDeg);

export interface TransformCadEntityGeometryOptions {
  /**
   * Phase 18R project scope: allow scaled similarity on alignments.
   * Geometry scales normally; the caller owns station propagation
   * (startStation carried, raw chainage scaled about start, jumps kept).
   * Default false preserves the 18Q BLOCKED contract.
   */
  allowAlignmentScale?: boolean;
}

export const transformCadEntityGeometry = (
  entity: CadEntity,
  transform: CadTransform2D,
  classification: CadTransformClassification,
  options?: TransformCadEntityGeometryOptions,
): TransformCadEntityGeometryResult => {
  switch (entity.type) {
    case 'survey-point': {
      const next = applyPoint(transform, { x: entity.x, y: entity.y });
      return { ok: true, entity: { ...entity, x: next.x, y: next.y } };
    }
    case 'line': {
      const from = applyPoint(transform, { x: entity.fromX, y: entity.fromY });
      const to = applyPoint(transform, { x: entity.toX, y: entity.toY });
      return {
        ok: true,
        entity: { ...entity, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y },
      };
    }
    case 'polyline':
    case 'polygon': {
      // Every vertex transforms; order is NEVER reversed under reflection.
      return {
        ok: true,
        entity: { ...entity, vertices: entity.vertices.map((vertex) => applyPoint(transform, vertex)) },
      };
    }
    case 'parcel': {
      const vertices = entity.vertices.map((vertex) => applyPoint(transform, vertex));
      const summary = cadBuildParcelClosureSummary(vertices);
      if (!summary) {
        return {
          ok: true,
          entity: {
            ...entity,
            vertices,
            areaSquareMeters: undefined,
            perimeterMeters: undefined,
            closureDeltaX: undefined,
            closureDeltaY: undefined,
            closureDistanceMeters: undefined,
          },
        };
      }
      // Metrics are RECOMPUTED from transformed vertices, never carried.
      // The summary reports positive area magnitude, so reflection keeps it.
      return {
        ok: true,
        entity: {
          ...entity,
          vertices,
          areaSquareMeters: summary.areaSquareMeters,
          perimeterMeters: summary.perimeterMeters,
          closureDeltaX: summary.closureDeltaX,
          closureDeltaY: summary.closureDeltaY,
          closureDistanceMeters: summary.closureDistanceMeters,
        },
      };
    }
    case 'arc': {
      if (classification.kind === 'GENERAL_AFFINE') {
        return { ok: false, reason: 'CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED' };
      }
      const next = transformArcAngles(
        entity.centerX,
        entity.centerY,
        entity.radius,
        entity.startAngleDeg,
        entity.endAngleDeg,
        transform,
        classification,
      );
      return { ok: true, entity: { ...entity, ...next } };
    }
    case 'alignment': {
      // Stationing (startStation, equations, raw chainage) is a dependency of
      // the alignment, not geometry: rigid motion preserves every element
      // length, so it is carried unchanged. Any scale dependency is BLOCKED
      // unless the caller propagates stationing (18R project scope).
      if (
        classification.kind === 'GENERAL_AFFINE' ||
        (!options?.allowAlignmentScale &&
          Math.abs(classification.scale - 1) > ALIGNMENT_TOLERANCE)
      ) {
        return { ok: false, reason: 'CAD_TRANSFORM_ALIGNMENT_SCALE_DEPENDENCY' };
      }
      const elements: CadAlignmentElement[] = entity.elements.map((element) => {
        if (element.kind === 'line') {
          return {
            ...element,
            start: applyPoint(transform, element.start),
            end: applyPoint(transform, element.end),
          };
        }
        const next = transformArcAngles(
          element.center.x,
          element.center.y,
          element.radius,
          element.startAngleDeg,
          element.endAngleDeg,
          transform,
          classification,
        );
        return {
          ...element,
          center: { x: next.centerX, y: next.centerY },
          radius: next.radius,
          startAngleDeg: next.startAngleDeg,
          endAngleDeg: next.endAngleDeg,
        };
      });
      return { ok: true, entity: { ...entity, elements } };
    }
    case 'text': {
      const next = applyPoint(transform, { x: entity.x, y: entity.y });
      // Position only: legacy baked text has no live glyph transform, so
      // glyph rotation/height are deliberately untouched.
      return { ok: true, entity: { ...entity, x: next.x, y: next.y } };
    }
    case 'error-ellipse': {
      const center = applyPoint(transform, { x: entity.centerX, y: entity.centerY });
      const magnitude = Math.abs(classification.scale);
      // Major-axis direction via the transformed unit vector: correct for
      // rotation AND reflection (mirror the axis angle) with one rule.
      const radians = (entity.thetaDeg * Math.PI) / 180;
      const axis = applyVector(transform, { x: Math.cos(radians), y: Math.sin(radians) });
      return {
        ok: true,
        entity: {
          ...entity,
          centerX: center.x,
          centerY: center.y,
          semiMajor: entity.semiMajor * magnitude,
          semiMinor: entity.semiMinor * magnitude,
          thetaDeg: cadNormalizeAngleDeg((Math.atan2(axis.y, axis.x) * 180) / Math.PI),
        },
      };
    }
    case 'block-reference': {
      const insertion = applyPoint(transform, { x: entity.x, y: entity.y });
      const magnitude = Math.abs(classification.scale);
      // Reflection lives ONLY in the `mirrored` flag: toggle it, never touch
      // scale signs (nonpositive scales stay rejected by normalizeBlockScales).
      // Never explode: the definition id is carried unchanged.
      return {
        ok: true,
        entity: {
          ...entity,
          x: insertion.x,
          y: insertion.y,
          rotationDeg: normalizeRotationDeg(entity.rotationDeg + classification.rotationDeg),
          scaleX: entity.scaleX * magnitude,
          scaleY: entity.scaleY * magnitude,
          mirrored: isReflection(classification) ? entity.mirrored !== true : entity.mirrored,
        },
      };
    }
    case 'survey-table': {
      // Phase 19A: ordinary entity under PROJECTTRANSFORM — insertion point
      // transforms, rotation composes; refs/ids/options are never rewritten.
      const insertion = applyPoint(transform, { x: entity.x, y: entity.y });
      return {
        ok: true,
        entity: {
          ...entity,
          x: insertion.x,
          y: insertion.y,
          rotationDeg: normalizeRotationDeg(entity.rotationDeg + classification.rotationDeg),
        },
      };
    }
    case 'mtext': {
      const next = applyPoint(transform, { x: entity.x, y: entity.y });
      // Insertion + rotation compose; Text Style height is never touched.
      return {
        ok: true,
        entity: {
          ...entity,
          x: next.x,
          y: next.y,
          rotationDeg: normalizeRotationDeg(entity.rotationDeg + classification.rotationDeg),
        },
      };
    }
    case 'leader': {
      return {
        ok: true,
        entity: {
          ...entity,
          vertices: entity.vertices.map((vertex) => applyPoint(transform, vertex)),
          arrowAnchor: transformAnchorPoint(entity.arrowAnchor, transform),
        },
      };
    }
    case 'dimension': {
      return {
        ok: true,
        entity: {
          ...entity,
          dimLinePoint: applyPoint(transform, entity.dimLinePoint),
          ...(entity.textPoint != null
            ? { textPoint: applyPoint(transform, entity.textPoint) }
            : {}),
          anchors: entity.anchors.map((anchor) => transformAnchorPoint(anchor, transform)),
          ...(entity.defPoint1 != null
            ? { defPoint1: transformAnchorPoint(entity.defPoint1, transform) }
            : {}),
          ...(entity.defPoint2 != null
            ? { defPoint2: transformAnchorPoint(entity.defPoint2, transform) }
            : {}),
        },
      };
    }
    case 'bearing-label':
    case 'curve-label': {
      // Placement-offset only: the offset vector rotates/scales/reflects
      // (applyVector, no translation); source association never changes.
      return {
        ok: true,
        entity: { ...entity, offset: applyVector(transform, entity.offset) },
      };
    }
  }
};
