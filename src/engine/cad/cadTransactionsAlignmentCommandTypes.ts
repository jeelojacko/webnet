/**
 * STRUCT-241.13 CAD alignment command payload type leaf.
 *
 * Type-only module. It owns the six alignment command payload variants, kept
 * as a single publicly named union that mirrors its contiguous position in the
 * `CadCommand` union of `cadTransactions.types.ts`:
 *
 * `CadAlignmentCommandPayload` sits immediately after the TANGENT_CURVE member
 * and immediately before the parcel group, in this order: ALIGNMENT_CREATE (1),
 * ALIGNMENT_OFFSET_CREATE (2), ALIGNMENT_STATION_REPORT (3),
 * ALIGNMENT_STATION_EQUATION (4), ALIGNMENT_OFFSET_POINT (5), and
 * ALIGNMENT_INTERVAL_POINTS (6).
 *
 * The group is extracted verbatim (key literals, field names, optionality, and
 * property order unchanged) from the `CadCommand` union in
 * `cadTransactions.types.ts`. This shrinks the hub without changing the command
 * contract; these inline members were not a separate dependency cycle, so no
 * SCC reduction is claimed.
 *
 * Contract: type-only imports only. It imports the primitive identity alias
 * from the zero-import core leaf. It must never import a value, a command
 * definition, a runtime service, `cadTransactions.ts`,
 * `cadTransactions.types.ts`, the parcel leaf, or any barrel that cycles back,
 * and it declares no runtime exports.
 */

import type { CadEntityId } from './cadCorePrimitiveTypes';

export type CadAlignmentCommandPayload =
  | {
      key: 'ALIGNMENT_CREATE';
      sourceEntityIds: CadEntityId[];
      name?: string;
      startStation?: number;
    }
  | {
      key: 'ALIGNMENT_OFFSET_CREATE';
      alignmentEntityId: CadEntityId;
      offset: number;
      name?: string;
    }
  | {
      key: 'ALIGNMENT_STATION_REPORT';
      alignmentEntityId: CadEntityId;
      pointEntityId: CadEntityId;
    }
  | {
      key: 'ALIGNMENT_STATION_EQUATION';
      alignmentEntityId: CadEntityId;
      backStation: number;
      aheadStation: number;
    }
  | {
      key: 'ALIGNMENT_OFFSET_POINT';
      alignmentEntityId: CadEntityId;
      station: number;
      offset: number;
      label?: string;
    }
  | {
      key: 'ALIGNMENT_INTERVAL_POINTS';
      alignmentEntityId: CadEntityId;
      interval: number;
      startStation?: number;
      endStation?: number;
      labelPrefix?: string;
    };
