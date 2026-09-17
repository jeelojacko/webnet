/**
 * Phase 17D — export coordinate context (derived model, post-solve only).
 *
 * No parallel CRS truth lives here: CRS definitions come from the catalog
 * (`getCrsDefinition`), project mode/id from ParseSettings, units from the
 * reporting settings. There is no persisted runtime CRS provenance (a
 * label-only CRS edit stays 17B-fresh by design), so provenance below is a
 * documented heuristic over current project state:
 * - coordSystemMode == 'local' -> LOCAL (no CRS claim possible).
 * - grid + empty/unset id -> UNKNOWN_LEGACY (legacy data without an id).
 * - grid + id that `getCrsDefinition` cannot resolve -> INVALID (BLOCK, never
 *   substitute; `resolveCrsDefinition`'s silent default is NOT used here).
 * - grid + id == DEFAULT_CANADA_CRS_ID -> PROJECT_DEFAULT (honest: the id may
 *   be an untouched default, not an explicit operator commitment).
 * - grid + other resolvable id -> EXPLICIT.
 *
 * Engine truth this model rests on: result.stations {x=E, y=N, h} are
 * solve-frame metres (grid EN when coordSystemMode=grid, local otherwise);
 * ground-measured distances are REDUCED to grid, so exported grid coords are
 * GRID, never ground. Exported Z stays solve-frame h with honest labels.
 */
import {
  DEFAULT_CANADA_CRS_ID,
  getCrsDefinition,
} from './crsCatalog';

export type ExportCrsProvenance =
  | 'EXPLICIT'
  | 'PROJECT_DEFAULT'
  | 'LOCAL'
  | 'UNKNOWN_LEGACY'
  | 'INVALID';

export interface ExportCoordinateContext {
  sourceSpace: 'grid' | 'local';
  crsId: string | null;
  crsName: string;
  crsProvenance: ExportCrsProvenance;
  horizontalUnit: 'm' | 'ft';
  verticalUnit: 'm' | 'ft';
  axisOrder: 'E,N';
  coordinateKind: 'grid' | 'local';
  /** Human truth about grid vs ground (no math, wording only). */
  gridGroundNote: string;
  verticalReference: 'solve-frame h';
}

/** Stable machine codes for the coordinate-validity gate (tests key on these). */
export type ExportCrsCode =
  | 'EXPORT_CRS_INVALID'
  | 'CRS_UNKNOWN'
  | 'CRS_TRANSFORM_UNAVAILABLE'
  | 'FORMAT_REQUIRES_GEOGRAPHIC'
  | 'AXIS_ORDER_UNRESOLVED';

export const GRID_COORD_NOTE =
  'Project grid coordinates (ground observations reduced to grid; NOT ground coordinates).';
export const LOCAL_COORD_NOTE = 'Local project coordinates (no CRS, no grid).';

export const resolveExportCoordinateContext = (params: {
  coordSystemMode?: string;
  crsId?: string;
  units?: 'm' | 'ft';
}): ExportCoordinateContext => {
  const units: 'm' | 'ft' = params.units === 'ft' ? 'ft' : 'm';
  const base = {
    horizontalUnit: units,
    verticalUnit: units,
    axisOrder: 'E,N' as const,
    verticalReference: 'solve-frame h' as const,
  };
  if ((params.coordSystemMode ?? 'local') !== 'grid') {
    return {
      ...base,
      sourceSpace: 'local',
      crsId: null,
      crsName: 'Local coordinates',
      crsProvenance: 'LOCAL',
      coordinateKind: 'local',
      gridGroundNote: LOCAL_COORD_NOTE,
    };
  }
  const rawId = (params.crsId ?? '').trim();
  if (!rawId) {
    return {
      ...base,
      sourceSpace: 'grid',
      crsId: null,
      crsName: 'Grid coordinates (CRS unknown — legacy data without an id)',
      crsProvenance: 'UNKNOWN_LEGACY',
      coordinateKind: 'grid',
      gridGroundNote: GRID_COORD_NOTE,
    };
  }
  const def = getCrsDefinition(rawId);
  if (!def) {
    return {
      ...base,
      sourceSpace: 'grid',
      crsId: rawId.toUpperCase(),
      crsName: `Unresolvable CRS id '${rawId}'`,
      crsProvenance: 'INVALID',
      coordinateKind: 'grid',
      gridGroundNote: GRID_COORD_NOTE,
    };
  }
  if (def.id === DEFAULT_CANADA_CRS_ID) {
    return {
      ...base,
      sourceSpace: 'grid',
      crsId: def.id,
      crsName: def.label,
      crsProvenance: 'PROJECT_DEFAULT',
      coordinateKind: 'grid',
      gridGroundNote: GRID_COORD_NOTE,
    };
  }
  return {
    ...base,
    sourceSpace: 'grid',
    crsId: def.id,
    crsName: def.label,
    crsProvenance: 'EXPLICIT',
    coordinateKind: 'grid',
    gridGroundNote: GRID_COORD_NOTE,
  };
};

export type ExportCoordFormatClass = 'geographic' | 'landxml' | 'other';

export const classifyExportFormatForCoordGate = (format: string): ExportCoordFormatClass => {
  if (format === 'geojson') return 'geographic';
  if (format === 'landxml') return 'landxml';
  return 'other';
};

export interface CoordinateReadiness {
  allowed: boolean;
  code: ExportCrsCode | null;
  message: string | null;
}

/**
 * Policy order in the export path is: 1) 17B integrity first (STALE primary
 * over CRS), 2) this coordinate-context validity, 3) format requirements,
 * 4) serialize. INVALID blocks everything except the diagnostic text review
 * path (`webnet`, which stays honest via its header block instead).
 */
export const assessCoordinateReadiness = (params: {
  context: ExportCoordinateContext;
  formatClass: ExportCoordFormatClass;
}): CoordinateReadiness => {
  const { context, formatClass } = params;
  if (context.crsProvenance === 'INVALID') {
    return {
      allowed: false,
      code: 'EXPORT_CRS_INVALID',
      message: `CRS id '${context.crsId}' is not in the CRS catalog. Select a valid project CRS before exporting.`,
    };
  }
  if (formatClass === 'geographic') {
    if (context.crsProvenance === 'LOCAL') {
      return {
        allowed: false,
        code: 'FORMAT_REQUIRES_GEOGRAPHIC',
        message:
          'GeoJSON needs geographic coordinates but the project uses a local coordinate system with no CRS. Switch to a grid CRS or use a projected export.',
      };
    }
    if (context.crsProvenance === 'UNKNOWN_LEGACY') {
      return {
        allowed: false,
        code: 'CRS_UNKNOWN',
        message:
          'GeoJSON needs a project CRS but none is recorded (legacy data). Set an explicit project CRS before exporting.',
      };
    }
    return { allowed: true, code: null, message: null };
  }
  return { allowed: true, code: null, message: null };
};

/** Compact informational lines for export UI summaries and report headers. */
export const describeExportCoordinateContext = (
  context: ExportCoordinateContext,
): string[] => [
  `Coordinate system: ${context.crsName} (${context.crsProvenance.toLowerCase().replace('_', ' ')})`,
  `Coordinate space: ${context.coordinateKind === 'grid' ? 'project grid coordinates' : 'local project coordinates'}`,
  `Units: ${context.horizontalUnit === 'ft' ? 'feet' : 'metres'}`,
  context.gridGroundNote,
];

/**
 * Wires the derived provenance into ExportIntegrityMetadata without
 * duplicating truth: PROJECT_DEFAULT maps to legacy INFERRED, LOCAL and
 * UNKNOWN_LEGACY map to UNKNOWN, INVALID stays explicit.
 */
export const integrityProvenanceForContext = (
  context: ExportCoordinateContext,
): 'EXPLICIT' | 'INFERRED' | 'UNKNOWN' | 'INVALID' => {
  if (context.crsProvenance === 'EXPLICIT') return 'EXPLICIT';
  if (context.crsProvenance === 'PROJECT_DEFAULT') return 'INFERRED';
  if (context.crsProvenance === 'INVALID') return 'INVALID';
  return 'UNKNOWN';
};
