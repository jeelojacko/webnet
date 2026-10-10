/**
 * STRUCT-241.2 CAD block command payload type leaf.
 *
 * Type-only module. It owns the nine block command payload variants, kept as
 * two publicly named unions that mirror their two disjoint positions in the
 * `CadCommand` union of `cadTransactions.types.ts`:
 *
 * - `CadBlockPreludeCommandPayload` is the early two-member prelude that sits
 *   immediately after `TITLE_BLOCK_EDIT` and immediately before
 *   `CadLayerCommandPayload`: BLOCK_SEED (1) and BLOCK_EDIT (2).
 * - `CadBlockDefinitionCommandPayload` is the later seven-member definition
 *   group that sits immediately after `CadSectionViewDeleteCommand` and
 *   immediately before `CREATE_MTEXT`: BLOCK_CREATE (1), BLOCK_INSERT (2),
 *   BLOCK_EXPLODE (3), BLOCK_REDEFINE (4), BLOCK_RENAME (5),
 *   BLOCK_DUPLICATE (6), and BLOCK_DELETE (7).
 *
 * Both groups are extracted verbatim (key literals, field names, optionality,
 * property order, and comments unchanged) from the `CadCommand` union in
 * `cadTransactions.types.ts`. This shrinks the hub without changing the
 * command contract; these inline members were not a separate dependency
 * cycle, so no SCC reduction is claimed.
 *
 * The 2+7 split is deliberate: the groups occupy disjoint source positions,
 * so keeping them separate preserves the original ordering when the members
 * are spliced back into the hub. It also keeps BLOCK_SEED/BLOCK_EDIT (which
 * carry no definition id) distinct from the definition-scoped variants.
 *
 * Contract: type-only imports only. It imports the primitive identity aliases
 * from the zero-import core leaf; it must never import a value, a command
 * definition, a runtime service, `cadTransactions.ts`,
 * `cadTransactions.types.ts`, or any barrel that cycles back, and it declares
 * no runtime exports.
 */

import type { CadEntityId, CadLayerId } from './cadCorePrimitiveTypes';

export type CadBlockPreludeCommandPayload =
  | {
      key: 'BLOCK_SEED';
    }
  | {
      key: 'BLOCK_EDIT';
      referenceId: CadEntityId;
      x?: number;
      y?: number;
      rotationDeg?: number;
      scaleX?: number;
      scaleY?: number;
      mirrored?: boolean;
    };

export type CadBlockDefinitionCommandPayload =
  | {
      key: 'BLOCK_CREATE';
      name: string;
      sourceEntityIds: CadEntityId[];
      basePoint?: { x: number; y: number };
      description?: string;
    }
  | {
      key: 'BLOCK_INSERT';
      definitionId: string;
      x: number;
      y: number;
      rotationDeg?: number;
      scaleX?: number;
      scaleY?: number;
      mirrored?: boolean;
      layerId?: CadLayerId;
    }
  | {
      key: 'BLOCK_EXPLODE';
      referenceId: CadEntityId;
    }
  | {
      key: 'BLOCK_REDEFINE';
      definitionId: string;
      sourceEntityIds: CadEntityId[];
    }
  | {
      key: 'BLOCK_RENAME';
      definitionId: string;
      name: string;
    }
  | {
      key: 'BLOCK_DUPLICATE';
      definitionId: string;
      name: string;
    }
  | {
      key: 'BLOCK_DELETE';
      definitionId: string;
      force?: boolean;
      deleteRefs?: boolean;
    };

export type CadBlockCommandPayload =
  | CadBlockPreludeCommandPayload
  | CadBlockDefinitionCommandPayload;
