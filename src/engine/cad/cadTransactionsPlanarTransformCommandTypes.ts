/**
 * STRUCT-241.15: CAD planar-transform command payload type leaf.
 *
 * Type-only module. It owns the six inline planar 2D transform command payload
 * variants, kept as a single publicly named union that mirrors its contiguous
 * position in the `CadCommand` union of `cadTransactions.types.ts`:
 *
 * `CadPlanarTransformCommandPayload` sits immediately after the
 * SURVEYTABLE_EDIT member and immediately before the HELMERT2D member, in this
 * order: MOVE (1), COPY (2), ROTATE (3), SCALE (4), MIRROR (5), and ALIGN2D (6).
 *
 * The group is extracted verbatim (key literals, field names, optionality,
 * property order, inline anonymous point shapes, and whitespace unchanged) from
 * the `CadCommand` union in `cadTransactions.types.ts`. This shrinks the hub
 * without changing the command contract; these inline members were not a
 * separate dependency cycle, so no SCC reduction is claimed.
 *
 * The SURVEYTABLE_EDIT and HELMERT2D members, the surrounding table
 * intersections, and the MOVE / COPY / ROTATE / SCALE / MIRROR / ALIGN2D key
 * literals in the separate `CadCommandKey` union all stay in the hub.
 *
 * Contract: no imports. It must never import a value, `cadTransactions.ts`,
 * `cadTransactions.types.ts`, or any barrel that cycles back, and it declares
 * no runtime exports.
 */

export type CadPlanarTransformCommandPayload =
  | {
      key: 'MOVE';
      deltaX: number;
      deltaY: number;
    }
  | {
      key: 'COPY';
      deltaX: number;
      deltaY: number;
    }
  | {
      key: 'ROTATE';
      baseX: number;
      baseY: number;
      angleDeg: number;
    }
  | {
      key: 'SCALE';
      baseX: number;
      baseY: number;
      factor: number;
    }
  | {
      key: 'MIRROR';
      p1: { x: number; y: number };
      p2: { x: number; y: number };
      eraseSource: boolean;
    }
  | {
      key: 'ALIGN2D';
      source1: { x: number; y: number };
      source2: { x: number; y: number };
      target1: { x: number; y: number };
      target2: { x: number; y: number };
      scaleToFit: boolean;
    };
