/**
 * STRUCT-241.16: CAD sheet/viewport command payload type leaf.
 *
 * Type-only module. It owns the six inline sheet/viewport command payload
 * variants, kept as a single publicly named union that mirrors its contiguous
 * position in the `CadCommand` union of `cadTransactions.types.ts`:
 *
 * `CadSheetViewportCommandPayload` sits immediately after the
 * `CadGeometryEditCommandPayload` splice and immediately before the
 * `CadBlockPreludeCommandPayload` splice, in this order: SHEET_ADD (1),
 * SHEET_DELETE (2), VIEWPORT_MOVE (3), VIEWPORT_SCALE (4), VIEWPORT_ROTATE (5),
 * and TITLE_BLOCK_EDIT (6).
 *
 * The group is extracted verbatim (key literals, field names, optionality,
 * property order, and whitespace unchanged) from the `CadCommand` union in
 * `cadTransactions.types.ts`. This shrinks the hub without changing the command
 * contract; these inline members were not a separate dependency cycle, so no
 * SCC reduction is claimed.
 *
 * Contract: no imports. Every field here uses native TypeScript types only. It
 * must never import a value, `cadTransactions.ts`, `cadTransactions.types.ts`,
 * or any barrel that cycles back, and it declares no runtime exports.
 */

export type CadSheetViewportCommandPayload =
  | {
      key: 'SHEET_ADD';
      sheetId: string;
      sheetName: string;
    }
  | {
      key: 'SHEET_DELETE';
      sheetId: string;
    }
  | {
      key: 'VIEWPORT_MOVE';
      sheetId: string;
      viewportId: string;
      x: number;
      y: number;
    }
  | {
      key: 'VIEWPORT_SCALE';
      sheetId: string;
      viewportId: string;
      scaleDenominator: number;
    }
  | {
      key: 'VIEWPORT_ROTATE';
      sheetId: string;
      viewportId: string;
      rotationDeg: number;
    }
  | {
      key: 'TITLE_BLOCK_EDIT';
      sheetId: string;
      definitionId: string;
      values: Record<string, string>;
    };
