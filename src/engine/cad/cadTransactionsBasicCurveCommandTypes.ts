/**
 * STRUCT-241.14 CAD basic curve command payload type leaf.
 *
 * Type-only module. It owns the six inline basic curve-creation command
 * payload variants, kept as a single publicly named union that mirrors its
 * contiguous position in the `CadCommand` union of
 * `cadTransactions.types.ts`:
 *
 * `CadBasicCurveCommandPayload` sits immediately after the
 * `({ key: 'BATCH_COGO' })` member and immediately before the bare
 * `CadAlignmentCommandPayload` alias member, in this order: ARC_3PT (1),
 * ARC_CREATE (2), BEST_FIT_LINE (3), BEST_FIT_ARC (4), BEST_FIT_PARABOLA (5),
 * and TANGENT_CURVE (6).
 *
 * The group is extracted verbatim (key literals, field names, optionality,
 * property order, inline anonymous object/array shapes, and whitespace
 * unchanged) from the `CadCommand` union in `cadTransactions.types.ts`. This
 * shrinks the hub without changing the command contract; these inline members
 * were not a separate dependency cycle, so no SCC reduction is claimed.
 *
 * The TRAVERSE and BATCH_COGO members, the `CadAlignmentCommandPayload` and
 * `CadParcelConstructionCommandPayload` aliases, the seven CurveF1 aliases
 * re-exported from `./cadTransactionsCurveF1Types`, and the ARC_3PT /
 * ARC_CREATE / BEST_FIT_* / TANGENT_CURVE key literals in the separate
 * `CadCommandKey` union all stay in the hub.
 *
 * Contract: no imports. It must never import a value, `cadTransactions.ts`,
 * `cadTransactions.types.ts`, or any barrel that cycles back, and it declares
 * no runtime exports.
 */

export type CadBasicCurveCommandPayload =
  | {
      key: 'ARC_3PT';
      start: { x: number; y: number; label: string };
      through: { x: number; y: number; label: string };
      end: { x: number; y: number; label: string };
    }
  | {
      key: 'ARC_CREATE';
      modeLabel: string;
      definition: {
        center: { x: number; y: number };
        radius: number;
        startAngleDeg: number;
        endAngleDeg: number;
      };
      metadata?: Record<string, unknown>;
    }
  | {
      key: 'BEST_FIT_LINE';
      samples: { x: number; y: number; label: string; sourceEntityId?: string }[];
    }
  | {
      key: 'BEST_FIT_ARC';
      samples: { x: number; y: number; label: string; sourceEntityId?: string }[];
    }
  | {
      key: 'BEST_FIT_PARABOLA';
      samples: { x: number; y: number; label: string; sourceEntityId?: string }[];
    }
  | {
      key: 'TANGENT_CURVE';
      pi: { x: number; y: number; label: string };
      backTangentPoint: { x: number; y: number; label: string };
      aheadTangentPoint: { x: number; y: number; label: string };
      radius: number;
    };
