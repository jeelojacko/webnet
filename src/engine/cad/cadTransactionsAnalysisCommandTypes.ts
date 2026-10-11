/**
 * STRUCT-241.11 CAD analysis command payload type leaf.
 *
 * Type-only module. It owns the eight analysis-map + analysis-legend command
 * payload variants (ANALYSIS_MAP_CREATE (1), ANALYSIS_MAP_UPDATE_BANDS (2),
 * ANALYSIS_MAP_UPDATE_APPEARANCE (3), ANALYSIS_MAP_DELETE (4),
 * ANALYSIS_LEGEND_CREATE (5), ANALYSIS_LEGEND_UPDATE (6), ANALYSIS_LEGEND_MOVE
 * (7), ANALYSIS_LEGEND_DELETE (8)) extracted verbatim (key literals, field
 * names, optionality, property order, and comments unchanged) from the
 * `CadCommand` union in `cadTransactions.types.ts`.
 *
 * Position: the group sits immediately after the annotation command group and
 * immediately before the Phase 20A FEATURELINE group, so the hub can splice
 * `CadAnalysisCommandPayload` back into that exact slot. This shrinks the hub
 * without changing the command contract; these inline members were not a
 * separate dependency cycle, so no SCC reduction is claimed.
 *
 * Contract: type-only imports only. It imports the primitive identity alias
 * from the zero-import core leaf, the analysis definition types from the
 * analysis types leaf, and the two appearance/legend patch shapes from their
 * runtime modules as type-only edges. It must never import a value, a command
 * definition, a runtime service, `cadTransactions.ts`, `cadTransactions.types.ts`,
 * or any barrel that cycles back, and it declares no runtime exports.
 */

import type { CadLayerId } from './cadCorePrimitiveTypes';
import type {
  CadAnalysisBand,
  CadAnalysisLegend,
  CadAnalysisSource,
} from './cadAnalysisTypes';
import type { CadAnalysisAppearancePatch } from './cadAnalysisMaps';
import type { CadAnalysisLegendPatch } from './cadAnalysisLegends';

export type CadAnalysisCommandPayload =
  // Phase 18U — analysis maps + legends (definitions only; derived band
  // quantities are session-only and never dirty the drawing).
  | {
      key: 'ANALYSIS_MAP_CREATE';
      name?: string;
      source: CadAnalysisSource;
      bands: CadAnalysisBand[];
      layerId?: CadLayerId;
      opacity?: number;
      description?: string;
    }
  | {
      key: 'ANALYSIS_MAP_UPDATE_BANDS';
      analysisId: string;
      bands?: CadAnalysisBand[];
      source?: CadAnalysisSource;
    }
  | {
      key: 'ANALYSIS_MAP_UPDATE_APPEARANCE';
      analysisId: string;
      patch: CadAnalysisAppearancePatch;
    }
  | {
      key: 'ANALYSIS_MAP_DELETE';
      analysisId: string;
      /** True removes the map + every referencing legend atomically. */
      deleteLegendsToo?: boolean;
    }
  | {
      key: 'ANALYSIS_LEGEND_CREATE';
      legend: CadAnalysisLegend;
    }
  | {
      key: 'ANALYSIS_LEGEND_UPDATE';
      legendId: string;
      patch: CadAnalysisLegendPatch;
    }
  | {
      key: 'ANALYSIS_LEGEND_MOVE';
      legendId: string;
      x: number;
      y: number;
    }
  | {
      key: 'ANALYSIS_LEGEND_DELETE';
      legendId: string;
    };
