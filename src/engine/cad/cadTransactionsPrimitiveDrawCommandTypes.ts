/**
 * STRUCT-241.14 CAD primitive-draw command payload type leaf.
 *
 * Type-only module. It owns the thirteen primitive-draw command payload
 * variants, kept as a single publicly named union that mirrors its contiguous
 * position in the `CadCommand` union of `cadTransactions.types.ts`:
 *
 * `CadPrimitiveDrawCommandPayload` sits immediately after the ERASE member and
 * immediately before the TRAVERSE member, in this order: POINT (1), COGO_POINT
 * (2), LINE (3), LINE_CREATE_BATCH (4), RECTANGLE (5), POLYGON (6), CIRCLE (7),
 * CIRCLECD (8), CIRCLE2P (9), CIRCLE3P (10), CIRCLETTR (11), CIRCLETTT (12),
 * and PLINE (13).
 *
 * The group is extracted verbatim (key literals, field names, optionality, and
 * property order unchanged) from the `CadCommand` union in
 * `cadTransactions.types.ts`, including all attached inline JSDoc. This shrinks
 * the hub without changing the command contract; TRAVERSE and BATCH_COGO stay
 * inline in the hub and are not moved. These inline members were not a separate
 * dependency cycle, so no SCC reduction is claimed.
 *
 * Contract: type-only imports only. It imports the tangency-source alias from
 * the circle-tangent geometry leaf and the polyline course geometry/width
 * aliases from the primitive geometry entity leaf. It must never import a
 * value, a command definition, a runtime service, `cadTransactions.ts`,
 * `cadTransactions.types.ts`, the basic-curve leaf, or any barrel that cycles
 * back, and it declares no runtime exports.
 */

import type { CadTangentSource } from './cadGeometryCircleTangentSolvers';
import type {
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
} from './cadPrimitiveGeometryEntityTypes';

export type CadPrimitiveDrawCommandPayload =
  | {
      key: 'POINT';
      x: number;
      y: number;
      label?: string;
    }
  | {
      key: 'COGO_POINT';
      x: number;
      y: number;
      label?: string;
      basisLabel: string;
      directionLabel: string;
    }
  | {
      key: 'LINE';
      start: { x: number; y: number; label: string };
      end: { x: number; y: number; label: string };
    }
  | {
      key: 'LINE_CREATE_BATCH';
      segments: Array<{
        start: { x: number; y: number; label: string };
        end: { x: number; y: number; label: string };
      }>;
      /** User-facing creation mode recorded as metadata.createdBy. */
      createdBy: string;
    }
  | {
      key: 'RECTANGLE';
      firstCorner: { x: number; y: number; label: string };
      oppositeCorner: { x: number; y: number; label: string };
    }
  | {
      key: 'POLYGON';
      center: { x: number; y: number; label: string };
      through: { x: number; y: number; label: string };
      sides: number;
      mode: 'inscribed' | 'circumscribed';
    }
  | {
      key: 'CIRCLE';
      center: { x: number; y: number; label: string };
      radius: number;
    }
  | {
      key: 'CIRCLECD';
      center: { x: number; y: number; label: string };
      diameter: number;
    }
  | {
      key: 'CIRCLE2P';
      first: { x: number; y: number; label: string };
      second: { x: number; y: number; label: string };
    }
  | {
      key: 'CIRCLE3P';
      first: { x: number; y: number; label: string };
      second: { x: number; y: number; label: string };
      third: { x: number; y: number; label: string };
    }
  | {
      key: 'CIRCLETTR';
      first: CadTangentSource;
      second: CadTangentSource;
      radius: number;
    }
  | {
      key: 'CIRCLETTT';
      first: CadTangentSource;
      second: CadTangentSource;
      third: CadTangentSource;
    }
  | {
      key: 'PLINE';
      vertices: { x: number; y: number; label: string }[];
      /** Absent/false = open polyline. True = closed ring stored without a
       *  duplicate closure vertex (the renderer/segment law wraps to first). */
      closed?: boolean;
      /** Phase C2 optional per-course bulge metadata; absent = all-line.
       *  Trailing optional (no version bump). */
      segmentGeometry?: CadPolylineSegmentGeometry[];
      /** Phase C2 optional per-course full centred band widths (metres);
       *  absent = zero-width. Trailing optional (no version bump). */
      segmentWidths?: CadPolylineSegmentWidth[];
    };
