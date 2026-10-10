/**
 * STRUCT-241.8 extracted surface-edit type declarations (leaf module).
 *
 * Declarations moved byte-verbatim out of `cadTypes.ts`; that hub re-exports
 * these types so legacy import paths keep resolving. Type-only, no imports.
 */

/**
 * Phase 18S TIN edit stack (ENGINE ONLY — no UI/manager/toolspace).
 *
 * Vertex refs address STABLE identities only: native `source:<entityId>`
 * (survey-point entity id), imported `imported:<surfaceId>:<vertexIndex>`
 * (positional index i/3 into ImportedTinPayload.vertices), and edit-created
 * `edit:<surfaceId>:<editId>` (from the creating add-point edit id).
 * Boundary (`boundary:…`) and Steiner (`steiner:…`) vertices are NOT
 * addressable. Edge endpoints are canonicalized (sorted key order) for
 * identity.
 */
export interface CadSurfaceVertexRef {
  key: string;
}

export interface CadSurfaceEdgeRef {
  a: CadSurfaceVertexRef;
  b: CadSurfaceVertexRef;
}

export interface CadSurfaceSwapEdgeEdit {
  id: string;
  kind: 'swap-edge';
  /** Absent = TRUE. */
  enabled?: boolean;
  edge: CadSurfaceEdgeRef;
}

export interface CadSurfaceAddLineEdit {
  id: string;
  kind: 'add-line';
  /** Absent = TRUE. */
  enabled?: boolean;
  from: CadSurfaceVertexRef;
  to: CadSurfaceVertexRef;
}

export interface CadSurfaceDeleteLineEdit {
  id: string;
  kind: 'delete-line';
  /** Absent = TRUE. */
  enabled?: boolean;
  edge: CadSurfaceEdgeRef;
}

/**
 * Phase 18T surface-local point/elevation edits (ENGINE ONLY — no UI).
 *
 * Edit-created points get the stable key `edit:<surfaceId>:<editId>` derived
 * from the EDIT id (never index/XY), so later edits address them via the
 * same resolver and save/reopen shuffles keep refs stable. Topology edits
 * (swap/add-line/delete-line) are untouched.
 */
export interface CadSurfaceAddPointEdit {
  id: string;
  kind: 'add-point';
  /** Absent = TRUE. */
  enabled?: boolean;
  x: number;
  y: number;
  z: number;
}

export interface CadSurfaceDeletePointEdit {
  id: string;
  kind: 'delete-point';
  /** Absent = TRUE. */
  enabled?: boolean;
  vertex: CadSurfaceVertexRef;
}

export interface CadSurfaceMovePointEdit {
  id: string;
  kind: 'move-point';
  /** Absent = TRUE. */
  enabled?: boolean;
  vertex: CadSurfaceVertexRef;
  /** XY-only target (Z unchanged). */
  x: number;
  y: number;
}

export interface CadSurfaceSetElevationEdit {
  id: string;
  kind: 'set-elevation';
  /** Absent = TRUE. */
  enabled?: boolean;
  vertex: CadSurfaceVertexRef;
  z: number;
}

export interface CadSurfaceRaiseLowerEdit {
  id: string;
  kind: 'raise-lower-surface';
  /** Absent = TRUE. */
  enabled?: boolean;
  /** Added to EVERY ACTIVE vertex at this replay position (incl. synthetic). */
  deltaZ: number;
}

/**
 * Phase 18V bulk/region surface edits (ENGINE ONLY — no UI).
 *
 * One operator commit = one row: the persisted edit stores the canonical
 * (lexicographic, deduped) stable ref array only — never a selection
 * polygon. Bulk raise/lower-selected is distinct from whole-surface
 * `raise-lower-surface` (which keeps affecting synthetic). Refs resolve via
 * the same resolveEditVertex; a missing ref fails the whole build closed.
 */
export interface CadSurfaceSetElevationsEdit {
  id: string;
  kind: 'set-elevation-many';
  /** Absent = TRUE. */
  enabled?: boolean;
  /** Canonical lexicographic order, deduped. Empty = no edit. */
  vertices: CadSurfaceVertexRef[];
  z: number;
}

export interface CadSurfaceRaiseLowerVerticesEdit {
  id: string;
  kind: 'raise-lower-points';
  /** Absent = TRUE. */
  enabled?: boolean;
  /** Canonical lexicographic order, deduped. Empty = no edit. */
  vertices: CadSurfaceVertexRef[];
  deltaZ: number;
}

export interface CadSurfaceMoveVerticesEdit {
  id: string;
  kind: 'move-points';
  /** Absent = TRUE. */
  enabled?: boolean;
  /** Canonical lexicographic order, deduped. Empty = no edit. */
  vertices: CadSurfaceVertexRef[];
  /** Displacement vector applied simultaneously from each ref's replay-position XY. */
  deltaX: number;
  deltaY: number;
}

export type CadSurfaceEdit =
  | CadSurfaceSwapEdgeEdit
  | CadSurfaceAddLineEdit
  | CadSurfaceDeleteLineEdit
  | CadSurfaceAddPointEdit
  | CadSurfaceDeletePointEdit
  | CadSurfaceMovePointEdit
  | CadSurfaceSetElevationEdit
  | CadSurfaceRaiseLowerEdit
  | CadSurfaceSetElevationsEdit
  | CadSurfaceRaiseLowerVerticesEdit
  | CadSurfaceMoveVerticesEdit;
