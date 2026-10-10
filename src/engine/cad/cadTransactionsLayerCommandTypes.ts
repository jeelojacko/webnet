/**
 * STRUCT-241.1 CAD layer command payload type leaf.
 *
 * Type-only module. It owns the fourteen layer command payload variants
 * (LAYER_CREATE, LAYER_RENAME, LAYER_VISIBILITY, LAYER_LOCKED,
 * LAYER_PRINTABLE, LAYER_COLOR, LAYER_LINETYPE, LAYER_LINEWEIGHT,
 * LAYER_TRANSPARENCY, LAYER_FROZEN, LAYER_DESCRIPTION, LAYER_SET_CURRENT,
 * LAYER_MOVE_OBJECTS, LAYER_DELETE) extracted verbatim (key literals, field
 * names, optionality, ordering, and comments unchanged) from the `CadCommand`
 * union in `cadTransactions.types.ts`. This shrinks the hub without changing
 * the command contract; these inline members were not a separate dependency
 * cycle, so no SCC reduction is claimed.
 *
 * Contract: type-only imports only. The layer payloads use only primitive
 * string/number/boolean fields, optionality, and a role literal union, so this
 * leaf needs no imports; it must never import a value, a command definition, a
 * runtime service, `cadTransactions.ts`, `cadTransactions.types.ts`, or any
 * barrel that cycles back, and it declares no runtime exports.
 */

export type CadLayerCommandPayload =
  | {
      key: 'LAYER_CREATE';
      name: string;
      color?: string;
      role?:
        | 'points'
        | 'control-points'
        | 'observation-lines'
        | 'error-ellipses'
        | 'labels'
        | 'parcels'
        | 'surfaces'
        | 'planning';
    }
  | {
      key: 'LAYER_RENAME';
      layerId: string;
      name: string;
    }
  | {
      key: 'LAYER_VISIBILITY';
      layerId: string;
      visible: boolean;
    }
  | {
      key: 'LAYER_LOCKED';
      layerId: string;
      locked: boolean;
    }
  | {
      key: 'LAYER_PRINTABLE';
      layerId: string;
      printable: boolean;
    }
  | {
      key: 'LAYER_COLOR';
      layerId: string;
      color: string;
    }
  | {
      key: 'LAYER_LINETYPE';
      layerId: string;
      lineTypeId: string;
    }
  | {
      key: 'LAYER_LINEWEIGHT';
      layerId: string;
      /** Undefined = Default. */
      lineweightMm?: number;
    }
  | {
      key: 'LAYER_TRANSPARENCY';
      layerId: string;
      transparency: number;
    }
  | {
      key: 'LAYER_FROZEN';
      layerId: string;
      frozen: boolean;
    }
  | {
      key: 'LAYER_DESCRIPTION';
      layerId: string;
      description: string;
    }
  | {
      key: 'LAYER_SET_CURRENT';
      layerId: string;
    }
  | {
      key: 'LAYER_MOVE_OBJECTS';
      fromLayerId: string;
      toLayerId: string;
    }
  | {
      key: 'LAYER_DELETE';
      layerId: string;
    };
