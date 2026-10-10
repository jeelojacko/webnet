/**
 * STRUCT-241.6 CAD linear-design type leaf.
 *
 * Type-only module. It owns the six linear-design contracts extracted
 * verbatim from `cadTypes.ts`:
 *
 * - `CadAlignmentElement` — line/arc alignment-element union.
 * - `CadStationEquation` — station equation.
 * - `CadAlignmentEntity` — alignment entity.
 * - `CadFeatureLineVertex` — Phase 20A first-class 3D feature-line vertex.
 * - `CadFeatureLineSegmentGeometry` — Phase 20A feature-line segment geometry.
 * - `CadFeatureLineEntity` — Phase 20A first-class 3D feature line.
 *
 * Bodies, comments, discriminants, unions, property order, optionality,
 * semicolons, and whitespace are copied verbatim from `cadTypes.ts`.
 *
 * Contract: type-only imports only, and only from
 * `./cadEntityFoundationTypes` (`CadBaseEntity`), `./cadDisplayTypes`
 * (`CadDisplayPoint`), and `./cadCorePrimitiveTypes` (`CadEntityId`). It must
 * never import `cadTypes`, the parcel leaf, any barrel, an engine runtime
 * module, or `cadTransactions`, and it declares no runtime exports.
 */

import type { CadBaseEntity } from './cadEntityFoundationTypes';
import type { CadDisplayPoint } from './cadDisplayTypes';
import type { CadEntityId } from './cadCorePrimitiveTypes';

export type CadAlignmentElement =
  | {
      kind: 'line';
      start: CadDisplayPoint;
      end: CadDisplayPoint;
      sourceEntityId?: CadEntityId;
    }
  | {
      kind: 'arc';
      center: CadDisplayPoint;
      radius: number;
      startAngleDeg: number;
      endAngleDeg: number;
      sourceEntityId?: CadEntityId;
    };

export interface CadStationEquation {
  backStation: number;
  aheadStation: number;
  rawStation?: number;
}

export interface CadAlignmentEntity extends CadBaseEntity {
  type: 'alignment';
  name: string;
  elements: CadAlignmentElement[];
  startStation: number;
  stationEquations?: CadStationEquation[];
}

/**
 * Phase 20A first-class 3D feature-line vertex: plan position (metres) +
 * owned elevation (metres, never defaulted — absent Z fails closed
 * downstream, never 0). Ids follow
 * `feature-vertex:<featureLineId>:<stableId>` (see cadFeatureLines).
 */
export interface CadFeatureLineVertex {
  id: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Phase 20A feature-line segment geometry: endpoint-owned, same signed
 * CAD-standard bulge convention as CadParcelCourseGeometry
 * (b = tan(sweepRad/4); positive = CCW = center-left; |b| > 1 = major
 * arc). Entry [index] describes the course starting at vertices[index].
 * Absent array = all-line (straight grade legs).
 */
export type CadFeatureLineSegmentGeometry = { kind: 'line' } | { kind: 'arc'; bulge: number };

/**
 * Phase 20A first-class 3D feature line: ordered XYZ vertices with
 * optional per-course plan line/arc geometry. Stations derive at read
 * time from cumulative horizontal (plan) length, station 0 at the first
 * vertex; grades derive from dZ over plan length. ADDITIVE ONLY — no
 * other entity changes, no migration of old entities.
 */
export interface CadFeatureLineEntity extends CadBaseEntity {
  type: 'feature-line';
  vertices: CadFeatureLineVertex[];
  /**
   * Contract: when present, segmentGeometry.length === course count
   * (vertices.length - 1 open, vertices.length closed). Absent = all-line.
   */
  segmentGeometry?: CadFeatureLineSegmentGeometry[];
  closed?: boolean;
  name?: string;
  description?: string;
}
