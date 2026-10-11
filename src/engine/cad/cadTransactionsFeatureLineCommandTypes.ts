/**
 * STRUCT-241.12 CAD feature-line command payload type leaf.
 *
 * Type-only module. It owns the eleven Phase 20A 3D feature-line command
 * payload variants, kept as a single publicly named union that mirrors its
 * contiguous position in the `CadCommand` union of `cadTransactions.types.ts`:
 *
 * `CadFeatureLineCommandPayload` sits immediately after
 * `CadAnalysisCommandPayload` and immediately before the Phase 20B
 * grading group, in this order: FEATURELINE/FEATURELINECREATE (1),
 * FEATURELINEELEV/FLSETZ (2), FLRAISELOWER (3), FLGRADE (4),
 * FLINTERPOLATE (5), FLSURFACEELEV (6), FLREVERSE (7), FLINQUIRY (8),
 * FLINSERTVERTEX (9), FLDELETEVERTEX (10), and
 * SURFACE_ADD_FEATURE_LINE_BREAKLINE (11).
 *
 * The group is extracted verbatim (key literals, field names, optionality,
 * property order, and the leading Phase 20A comment unchanged) from the
 * `CadCommand` union in `cadTransactions.types.ts`. This shrinks the hub
 * without changing the command contract; these inline members were not a
 * separate dependency cycle, so no SCC reduction is claimed.
 *
 * Contract: type-only imports only. It imports the primitive identity alias
 * from the zero-import core leaf and the elevation method union from the
 * feature-line creation module as a type-only edge (that module has runtime
 * exports, so this MUST stay `import type`). It must never import a value, a
 * command definition, a runtime service, `cadTransactions.ts`,
 * `cadTransactions.types.ts`, or any barrel that cycles back, and it declares
 * no runtime exports.
 */

import type { CadEntityId } from './cadCorePrimitiveTypes';
import type { FeatureLineElevationMethod } from './cadFeatureLineCreate';

export type CadFeatureLineCommandPayload =
  // Phase 20A — 3D feature lines (create + edit + report).
  | {
      key: 'FEATURELINE' | 'FEATURELINECREATE';
      sourceEntityIds: CadEntityId[];
      sourceKind: 'survey-points' | 'chain';
      elevation: FeatureLineElevationMethod;
      name?: string;
      description?: string;
      closed?: boolean;
    }
  | {
      key: 'FEATURELINEELEV' | 'FLSETZ';
      entityId: CadEntityId;
      z: number;
      vertexIds?: string[];
    }
  | {
      key: 'FLRAISELOWER';
      entityId: CadEntityId;
      deltaZ: number;
      vertexIds?: string[];
    }
  | {
      key: 'FLGRADE';
      entityId: CadEntityId;
      startVertexId?: string;
      endVertexId?: string;
      startStation?: number;
      endStation?: number;
      gradePercent: number;
      mode?: 'set-end-only' | 'grade-all-intermediates';
    }
  | {
      key: 'FLINTERPOLATE';
      entityId: CadEntityId;
      startVertexId?: string;
      endVertexId?: string;
      startStation?: number;
      endStation?: number;
    }
  | {
      key: 'FLSURFACEELEV';
      entityId: CadEntityId;
      surfaceId: string;
    }
  | {
      key: 'FLREVERSE';
      entityId: CadEntityId;
    }
  | {
      key: 'FLINQUIRY';
      entityId: CadEntityId;
      startStation?: number;
      endStation?: number;
    }
  | {
      key: 'FLINSERTVERTEX';
      entityId: CadEntityId;
      courseIndex: number;
      station: number;
    }
  | {
      key: 'FLDELETEVERTEX';
      entityId: CadEntityId;
      vertexIndex: number;
    }
  | {
      key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE';
      surfaceId: string;
      entityId: CadEntityId;
      name?: string;
    };
