/**
 * STRUCT-241.4 CAD primitive/geometry entity type leaf.
 *
 * Type-only module. It owns the eight primitive and geometry entity contracts
 * extracted verbatim (names, JSDoc, field names, optionality, discriminants,
 * property order, literal unions, and union member order unchanged) from
 * `cadTypes.ts`, in original source order:
 *
 * - `CadLineEntity` — station-to-station line with source observation ids.
 * - `CadPolylineSegmentGeometry` — per-course line/arc geometry with the signed
 *   CAD-standard bulge convention.
 * - `CadPolylineSegmentWidth` — per-course full centred band width.
 * - `CadPolylineEntity` — ordered vertices with optional per-course geometry
 *   and widths.
 * - `CadArcEntity` — center + radius + start/end angles arc.
 * - `CadCircleEntity` — first-class center + radius circle (Phase B1).
 * - `CadPolygonEntity` — ordered vertices with labels.
 * - `CadParabolaEntity` — first-class finite analytic parabola (best-fit E1).
 *
 * Bodies and comments are copied verbatim, preserving the geometry contracts
 * (signed CAD-standard bulge convention, segment-width semantics, radius,
 * and finite parabola extent). The only change is that the base entity,
 * display-point, and station-id dependencies now come from their owning
 * leaves instead of `cadTypes`.
 *
 * Contract: type-only imports only, and only from
 * `./cadEntityFoundationTypes` (CadBaseEntity), `./cadDisplayTypes`
 * (CadDisplayPoint), and `../../types` (StationId). It must never import
 * `cadTypes`, any barrel, an engine runtime module, or `cadTransactions`, and
 * it declares no runtime exports.
 */

import type { CadBaseEntity } from './cadEntityFoundationTypes';
import type { CadDisplayPoint } from './cadDisplayTypes';
import type { StationId } from '../../types';

export interface CadLineEntity extends CadBaseEntity {
  type: 'line';
  fromStationId: StationId;
  toStationId: StationId;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  sourceObservationIds: number[];
}

/**
 * Phase C2 polyline segment geometry: endpoint-owned, same signed
 * CAD-standard bulge convention as CadParcelCourseGeometry /
 * CadFeatureLineSegmentGeometry (b = tan(sweepRad/4); positive = CCW =
 * center-left; |b| > 1 = major arc). Entry [index] describes the course
 * starting at vertices[index]; for a closed ring the final entry is the
 * last->first course. Absent array = legacy all-line (no migration).
 */
export type CadPolylineSegmentGeometry = { kind: 'line' } | { kind: 'arc'; bulge: number };

/**
 * Phase C2 polyline segment width: full band width in model units (metres),
 * centred on the course centreline — NOT a lineweight and never a resolved
 * display value. startWidth applies at the course start vertex, endWidth at
 * the course end vertex; the band tapers linearly between them. Entry [index]
 * describes the course starting at vertices[index]. Absent array = legacy
 * zero-width (hairline) polyline.
 */
export interface CadPolylineSegmentWidth {
  startWidth: number;
  endWidth: number;
}

export interface CadPolylineEntity extends CadBaseEntity {
  type: 'polyline';
  vertices: CadDisplayPoint[];
  vertexLabels: string[];
  closed: boolean;
  /**
   * Contract: when present, segmentGeometry.length === course count
   * (vertices.length - 1 open, vertices.length closed), entry [index]
   * describes the course starting at vertices[index]. Absent = all-line.
   * Trailing optional field (no version bump): legacy files omit it.
   */
  segmentGeometry?: CadPolylineSegmentGeometry[];
  /**
   * Contract: when present, segmentWidths.length === course count, entry
   * [index] carries the full centred band width (metres) for the course
   * starting at vertices[index]. Absent = zero-width legacy polyline.
   * Trailing optional field (no version bump): legacy files omit it.
   */
  segmentWidths?: CadPolylineSegmentWidth[];
}

export interface CadArcEntity extends CadBaseEntity {
  type: 'arc';
  centerX: number;
  centerY: number;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}

/** Phase B1: first-class circle. Center + radius only: no start/end angles,
 * no sweep, no fullCircle flag, no arc encoding. Creation enforces a finite
 * center and radius above the CAD geometric floor; load follows the same
 * verbatim-clone convention as arcs (no load-time revalidation). */
export interface CadCircleEntity extends CadBaseEntity {
  type: 'circle';
  centerX: number;
  centerY: number;
  radius: number;
}

export interface CadPolygonEntity extends CadBaseEntity {
  type: 'polygon';
  vertices: CadDisplayPoint[];
  vertexLabels: string[];
}

/**
 * First-class finite parabola (best-fit E1). Canonical schema pinned in
 * docs/evidence/cad-best-fit-e1/architecture.md §3:
 *   P(t) = V + b * (2 f t) + a * (f t^2)
 * where V is the world vertex, `a` is the unit opening axis from
 * axisAngleDeg (degrees CCW from +X), `b` is the left perpendicular of `a`,
 * f = focalLength > 0 (metres), and [tStart, tEnd] is the finite, non-zero
 * extent. The model is analytic everywhere: tessellation is display/export
 * only and never replaces these stored fields. Trailing optional kind in the
 * WNCAD v2 schema (kinds are not enumerated by the version table, so legacy
 * files stay byte-compatible and there is NO schema version bump).
 *
 * NOTE: parabolas are NOT a CadBlockChild. A block instance may carry a
 * non-uniform scale, which cannot map a parabola to the canonical family,
 * so block creation rejects them explicitly (see cadBlockSources
 * SEMANTIC_TYPES) rather than silently distorting them.
 */
export interface CadParabolaEntity extends CadBaseEntity {
  type: 'parabola';
  vertexX: number;
  vertexY: number;
  /** Opening-axis direction, degrees CCW from +X. */
  axisAngleDeg: number;
  /** Focal length f > 0 (metres); opening is toward +axis. */
  focalLength: number;
  /** Finite curve extent; must satisfy tStart < tEnd. */
  tStart: number;
  tEnd: number;
}
