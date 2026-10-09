/**
 * STRUCT-195.3 CAD surface/bake/compose command payload leaf.
 *
 * Type-only module. It owns the 34 surface, bake, and compose command payload
 * variants extracted verbatim (bodies, comments, optionality, and field order
 * unchanged) from the `CadCommand` union in `cadTransactions.types.ts`, so the
 * transaction hub can depend on this leaf WITHOUT the command-family cycle
 * that previously tied the surface payloads into the transaction SCC.
 *
 * Contract: type-only imports only. It imports the primitive identity aliases
 * from the zero-import core leaf and the surface structure types from
 * `cadTypes`; it must never import a value, a command definition, a runtime
 * service, `cadTransactions.ts`, or `cadTransactions.types.ts`, and it
 * declares no runtime exports.
 */

import type { CadEntityId, CadLayerId } from './cadCorePrimitiveTypes';
import type {
  CadSurfaceDefinition,
  CadSurfaceBoundary,
  CadSurfaceEdit,
  CadSurfaceStyle,
} from './cadTypes';

export type CadSurfaceCommandPayload =
  | {
      key: 'SURFACE_CREATE';
      name?: string;
      layerId?: CadLayerId;
      styleId?: string;
      pointSource?: CadSurfaceDefinition['pointSource'];
      buildOptions?: CadSurfaceDefinition['buildOptions'];
    }
  | {
      key: 'SURFACE_DELETE';
      surfaceId: string;
    }
  | {
      key: 'SURFACE_RENAME';
      surfaceId: string;
      name: string;
    }
  | {
      key: 'SURFACE_SET_LAYER_STYLE';
      surfaceId: string;
      layerId?: CadLayerId;
      /** Undefined = leave, null = clear, id = set (must exist). */
      styleId?: string | null;
    }
  | {
      key: 'SURFACE_ADD_POINT_GROUP';
      surfaceId: string;
      pointGroupId: string;
    }
  | {
      key: 'SURFACE_REMOVE_POINT_GROUP';
      surfaceId: string;
      pointGroupId: string;
    }
  | {
      key: 'SURFACE_ADD_POINTS';
      surfaceId: string;
      pointIds: string[];
    }
  | {
      key: 'SURFACE_REMOVE_SOURCE';
      surfaceId: string;
    }
  | {
      key: 'SURFACE_ADD_BREAKLINE';
      surfaceId: string;
      pointIds: string[];
      name?: string;
    }
  | {
      key: 'SURFACE_REMOVE_BREAKLINE';
      surfaceId: string;
      breaklineId: string;
    }
  | {
      key: 'SURFACE_RENAME_BREAKLINE';
      surfaceId: string;
      breaklineId: string;
      name: string;
    }
  | {
      key: 'SURFACE_BREAKLINE_INSERT_POINT';
      surfaceId: string;
      breaklineId: string;
      pointEntityId: CadEntityId;
      insertIndex: number;
    }
  | {
      key: 'SURFACE_BREAKLINE_REMOVE_POINT';
      surfaceId: string;
      breaklineId: string;
      pointEntityId?: CadEntityId;
      index?: number;
    }
  | {
      key: 'SURFACE_BREAKLINE_REVERSE';
      surfaceId: string;
      breaklineId: string;
    }
  | {
      key: 'SURFACE_BREAKLINE_REPLACE_CHAIN';
      surfaceId: string;
      breaklineId: string;
      pointEntityIds: CadEntityId[];
    }
  | {
      key: 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN';
      surfaceId: string;
      breaklineId: string;
    }
  | {
      key: 'SURFACE_ADD_BOUNDARY';
      surfaceId: string;
      kind: CadSurfaceBoundary['type'];
      sourceEntityId: CadEntityId;
    }
  | {
      key: 'SURFACE_REMOVE_BOUNDARY';
      surfaceId: string;
      kind: CadSurfaceBoundary['type'];
      sourceEntityId?: CadEntityId;
    }
  | {
      key: 'SURFACE_CREATE_BOUNDARY_SOURCE';
      surfaceId: string;
      kind: CadSurfaceBoundary['type'];
      /** Candidate ring XY (Z is never accepted for a boundary). */
      vertices: Array<{ x: number; y: number }>;
      sourceLabel?: string;
      /**
       * Void-only: swap this void source for the created polygon in the
       * SAME transaction (one history entry). Outer replacement needs no
       * field — a new outer replaces by kind.
       */
      replaceVoidSourceEntityId?: CadEntityId;
    }
  | {
      key: 'SURFACE_REPLACE_BOUNDARY_SOURCE';
      surfaceId: string;
      kind: CadSurfaceBoundary['type'];
      /** New source; the old source entity stays in the drawing. */
      sourceEntityId: CadEntityId;
    }
  | {
      key: 'SURFACE_MAKE_BOUNDARY_INDEPENDENT';
      surfaceId: string;
      kind: CadSurfaceBoundary['type'];
      /** Omit when the surface has exactly one boundary of `kind`. */
      sourceEntityId?: CadEntityId;
    }
  | {
      key: 'SURFACE_ADD_EDIT';
      surfaceId: string;
      /** Edit body without id (a stable drawing-owned id is generated). */
      edit: Omit<Extract<CadSurfaceEdit, { kind: 'swap-edge' }>, 'id'>
        | Omit<Extract<CadSurfaceEdit, { kind: 'add-line' }>, 'id'>
        | Omit<Extract<CadSurfaceEdit, { kind: 'delete-line' }>, 'id'>
        | Omit<Extract<CadSurfaceEdit, { kind: 'add-point' }>, 'id'>
        | Omit<Extract<CadSurfaceEdit, { kind: 'delete-point' }>, 'id'>
        | Omit<Extract<CadSurfaceEdit, { kind: 'move-point' }>, 'id'>
        | Omit<Extract<CadSurfaceEdit, { kind: 'set-elevation' }>, 'id'>
        | Omit<Extract<CadSurfaceEdit, { kind: 'raise-lower-surface' }>, 'id'>
        | Omit<Extract<CadSurfaceEdit, { kind: 'set-elevation-many' }>, 'id'>
        | Omit<Extract<CadSurfaceEdit, { kind: 'raise-lower-points' }>, 'id'>
        | Omit<Extract<CadSurfaceEdit, { kind: 'move-points' }>, 'id'>;
      /** Current source revision; stale picks reject (never apply blindly). */
      expectedRevision: string;
    }
  | {
      key: 'SURFACE_DELETE_EDIT';
      surfaceId: string;
      editId: string;
      expectedRevision: string;
    }
  | {
      key: 'SURFACE_MOVE_EDIT';
      surfaceId: string;
      editId: string;
      direction: 'up' | 'down';
      expectedRevision: string;
    }
  | {
      key: 'SURFACE_SET_EDIT_ENABLED';
      surfaceId: string;
      editId: string;
      enabled: boolean;
      expectedRevision: string;
    }
  | {
      key: 'SURFACE_STYLE_CREATE';
      style: CadSurfaceStyle;
    }
  | {
      key: 'SURFACE_STYLE_DUPLICATE';
      styleId: string;
      newId: string;
      name: string;
    }
  | {
      key: 'SURFACE_STYLE_RENAME';
      styleId: string;
      name: string;
    }
  | {
      key: 'SURFACE_STYLE_UPDATE';
      styleId: string;
      patch: Pick<
        CadSurfaceStyle,
        | 'color'
        | 'opacity'
        | 'showTriangles'
        | 'showContours'
        | 'showPoints'
        | 'showBoundary'
        | 'minorContourInterval'
        | 'majorContourEvery'
        | 'contourBaseElevation'
        | 'minorContour'
        | 'majorContour'
        | 'showContourLabels'
        | 'labelMajorOnly'
        | 'contourLabelSpacing'
        | 'contourLabelPrecision'
      > & { description?: string | null };
    }
  | {
      key: 'SURFACE_STYLE_DELETE';
      styleId: string;
      /** Required when surfaces reference the style; refs rewire to it. */
      replacementId?: string;
    }
  | {
      key: 'SURFBAKE';
      surfaceId: string;
      /** Current source revision; a stale value rejects the bake. */
      expectedRevision: string;
      /**
       * Session-owned CURRENT assertion. The project never persists
       * `cachedRevision` (rebuilds stay out of history), so the engine's
       * persisted-revision derivation reads UNBUILT even when the session
       * cache holds a fresh mesh. The UI sets this true only after
       * `surfaceBakeCapability` derives session CURRENT; absent = fail-closed
       * on the persisted-revision derivation.
       */
      sessionCurrent?: boolean;
    }
  | {
      key: 'SURFBAKECOPY';
      surfaceId: string;
      /** Current source revision; a stale value rejects the bake. */
      expectedRevision: string;
      /** Session-owned CURRENT assertion (see SURFBAKE). */
      sessionCurrent?: boolean;
    }
  | {
      key: 'SURFCOMPOSE';
      /** Base (identity donor) surface id. */
      baseSurfaceId: string;
      /** Current base revision; a stale value rejects the compose. */
      baseExpectedRevision: string;
      /** Overlay surface id. Must differ from the base id. */
      overlaySurfaceId: string;
      /** Current overlay revision; a stale value rejects the compose. */
      overlayExpectedRevision: string;
      /** Composed topology from the worker: flat x,y,z + CCW index triples. */
      vertices: number[];
      faces: number[];
      /** Ownership policy id recorded in provenance. */
      policy: string;
      /** Session-owned CURRENT assertion (see SURFBAKE). */
      sessionCurrent?: boolean;
    }
  | {
      key: 'SURFCOMPOSEPASTE';
      /** Target surface (keeps identity, definition replaced). */
      targetSurfaceId: string;
      /** Current target revision; a stale value rejects the paste. */
      targetExpectedRevision: string;
      /** Source surface (contributes topology only). Must differ from the target id. */
      sourceSurfaceId: string;
      /** Current source revision; a stale value rejects the paste. */
      sourceExpectedRevision: string;
      /** Composed topology from the worker: flat x,y,z + CCW index triples. */
      vertices: number[];
      faces: number[];
      /** Ownership policy id recorded in provenance. */
      policy: string;
      /** Session-owned CURRENT assertion (see SURFBAKE). */
      sessionCurrent?: boolean;
    }
