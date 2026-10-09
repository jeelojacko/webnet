/**
 * STRUCT-195.2 CAD core primitive type leaf.
 *
 * Zero-import, type-only module. It holds the shared primitive identity
 * aliases plus the two structural primitives (`CadBounds`, `CadLayer`) and
 * the point-symbol shape union so that lower-level display/draft modules can
 * depend on them WITHOUT pulling the full `cadTypes` surface (and its
 * transitive type cycle) into their graph.
 *
 * Contract: this file must stay import-free (no value or type imports) and
 * must export ONLY type aliases / interfaces. `cadTypes.ts` re-exports every
 * name here so existing `from './cadTypes'` consumers keep compiling.
 */

export type CadEntityId = string;
export type CadLayerId = string;
export type CadStyleId = string;
export type CadLineTypeId = string;
export type CadTextStyleId = string;
export type CadPointSymbolId = string;

export interface CadBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CadLayer {
  id: CadLayerId;
  name: string;
  color: string;
  lineTypeId?: CadLineTypeId;
  defaultStyleId?: CadStyleId;
  /** ON meaning (unchanged). OFF hides via view-layer filters, not the display scene. */
  visible: boolean;
  locked: boolean;
  /** Frozen layers hide like OFF via the same filter path. Default false. */
  frozen?: boolean;
  /** 0 (opaque) .. 1 (fully transparent). Default 0. */
  transparency?: number;
  /** Free-text note. Default ''. */
  description?: string;
  printable?: boolean;
  lineweightMm?: number;
  role:
    | 'points'
    | 'control-points'
    | 'observation-lines'
    | 'error-ellipses'
    | 'labels'
    | 'parcels'
    | 'surfaces'
    | 'planning';
}

export type CadPointSymbolShape = 'circle' | 'square' | 'triangle' | 'cross' | 'x' | 'dot';
