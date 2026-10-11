/**
 * STRUCT-241.16 CAD polyline vertex-topology command payload type leaf.
 *
 * Type-only module. It owns the two inline polyline vertex-topology command
 * payload variants, kept as a single publicly named union that mirrors its
 * contiguous position in the `CadCommand` union of `cadTransactions.types.ts`:
 *
 * `CadPolylineTopologyCommandPayload` sits immediately after the
 * `CadDesignSurfaceCommandPayload` member and immediately before the CAD
 * Curves F1 alias members, in this order: POLYLINE_INSERT_VERTEX (1) and
 * POLYLINE_DELETE_VERTEX (2).
 *
 * The group is extracted verbatim (key literals, field names, ordering, and
 * whitespace unchanged) from the `CadCommand` union in
 * `cadTransactions.types.ts`, together with its immediately preceding
 * `// Phase C3 — polyline vertex topology (count-changing, one undo entry).`
 * section header, which moves with the members. The following
 * `// CAD Curves F1 — ...` header and the Curve F1 aliases stay in the hub.
 * This shrinks the hub without changing the command contract; these inline
 * members are not a separate dependency cycle, so no SCC reduction is claimed.
 *
 * Contract: type-only imports only. It imports the shared CAD entity id alias
 * from the core primitive type leaf. It must never import a value,
 * `cadTypes`, `cadTransactions.ts`, `cadTransactions.types.ts`, or the
 * sibling sheet/viewport leaf, and it declares no runtime exports.
 */

import type { CadEntityId } from './cadCorePrimitiveTypes';

export type CadPolylineTopologyCommandPayload =
  // Phase C3 — polyline vertex topology (count-changing, one undo entry).
  | {
      key: 'POLYLINE_INSERT_VERTEX';
      entityId: CadEntityId;
      courseIndex: number;
      x: number;
      y: number;
    }
  | {
      key: 'POLYLINE_DELETE_VERTEX';
      entityId: CadEntityId;
      vertexIndex: number;
    };
