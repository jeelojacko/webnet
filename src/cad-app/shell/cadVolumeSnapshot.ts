import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { CadSurfaceVolumeCache } from '../../engine/cad/surfaceVolumeCache';
import {
  backfillVolumeSurfaceStyles,
  computeVolumeSurfaceRevision,
} from '../../engine/cad/cadVolumeSurfaces';
import {
  queryMeshElevation,
  surfaceContentRevision,
} from '../../engine/cad/cadSurfaceView';
import type {
  CadProject,
  CadVolumeResult,
  VolumeSurfaceStatus,
} from '../../engine/cad/cadTypes';

/**
 * Phase 18I UI — volume snapshot for Toolspace/manager/report.
 *
 * Dumb-renderer support: every row is derived from the drawing once per
 * publish (definition names, derived status, cached quantities). Mutations
 * travel as real VOLUME_* CadCommands through the existing
 * `runSurveyCommand` undo path. Quantities shown stale ONLY with an
 * explicit STALE label; style edits never recalculate (revision excludes
 * styles/layers/names).
 */

/** Sign convention, displayed verbatim in every volume UI entry point. */
export const VOLUME_SIGN_CONVENTION =
  'Δ = Comparison − Base; Δ>0 FILL, Δ<0 CUT; Net = Fill − Cut';

export type VolumeSurfaceStatusText =
  | 'Current'
  | 'Needs Recalc'
  | 'Building'
  | 'Failed'
  | 'Broken Reference'
  | 'Source Not Current'
  | 'Unbuilt'
  | 'No Overlap';

export const volumeSurfaceStatusText = (
  status: VolumeSurfaceStatus,
): VolumeSurfaceStatusText => {
  switch (status) {
    case 'CURRENT': return 'Current';
    case 'NEEDS_RECALC': return 'Needs Recalc';
    case 'BUILDING': return 'Building';
    case 'FAILED': return 'Failed';
    case 'BROKEN_REFERENCE': return 'Broken Reference';
    case 'SOURCE_NOT_CURRENT': return 'Source Not Current';
    case 'UNBUILT': return 'Unbuilt';
    case 'NO_OVERLAP': return 'No Overlap';
  }
};

export interface CadVolumeRow {
  id: string;
  name: string;
  baseSurfaceId: string;
  baseName: string;
  comparisonSurfaceId: string;
  comparisonName: string;
  layerId: string;
  layerName: string;
  layerLocked: boolean;
  styleId: string | null;
  styleName: string;
  status: VolumeSurfaceStatus;
  statusText: VolumeSurfaceStatusText;
  /** True when showing retained (stale) quantities or a stale mesh state. */
  stale: boolean;
  revision: string;
  diagnostic: string | null;
  /** Current-revision quantities; null unless CURRENT or NO_OVERLAP. */
  quantities: CadVolumeResult | null;
  /** Newest retained stale result (shown ONLY with an explicit STALE label). */
  staleQuantities: CadVolumeResult | null;
  baseStatus: string;
  comparisonStatus: string;
  /** True when both source TINs are CURRENT (Calculate enabled). */
  calculable: boolean;
  /** True when quantities may be exported (CURRENT only). */
  exportable: boolean;
}

export interface CadVolumeStyleSummary {
  id: string;
  name: string;
  showCut: boolean;
  showFill: boolean;
  showZeroBoundary: boolean;
  cutColor: string;
  fillColor: string;
  opacity: number;
}

export interface CadVolumeSnapshot {
  volumes: CadVolumeRow[];
  selectedVolumeId: string | null;
  styles: CadVolumeStyleSummary[];
}

/** Drawing units → area/volume unit labels (m²/m³ or ft²/ft³, never yd³). */
export const volumeAreaUnit = (units: string): string =>
  units === 'ft' ? 'ft²' : 'm²';

export const volumeUnit = (units: string): string =>
  units === 'ft' ? 'ft³' : 'm³';

const surfaceDisplayStatus = (
  project: CadProject,
  tinCache: CadSurfaceCache | null,
  surfaceId: string,
): { name: string; text: string; current: boolean } => {
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return { name: surfaceId, text: 'missing', current: false };
  const revision = surfaceContentRevision(project, surface);
  const current = tinCache?.get(surfaceId, revision) != null;
  return { name: surface.name, text: current ? 'Current' : 'not current', current };
};

export const buildCadVolumeSnapshot = (
  project: CadProject,
  tinCache: CadSurfaceCache | null,
  volumeCache: CadSurfaceVolumeCache | null,
  selectedVolumeId: string | null,
  options?: {
    buildingVolumeIds?: ReadonlySet<string>;
    sessionDiagnostics?: ReadonlyMap<string, { revision: string; error: string }>;
  },
): CadVolumeSnapshot => {
  const layers = new Map(project.layers.map((layer) => [layer.id, layer]));
  const styles = backfillVolumeSurfaceStyles(project.volumeSurfaceStyles);
  const styleNames = new Map(styles.map((style) => [style.id, style.name]));
  const layerOf = (layerId: string | undefined): { id: string; name: string; locked: boolean } => {
    const layer = layerId != null ? layers.get(layerId) : undefined;
    return {
      id: layerId ?? 'general',
      name: layer?.name ?? layerId ?? 'ByLayer',
      locked: layer?.locked === true,
    };
  };
  const volumes: CadVolumeRow[] = (project.volumeSurfaces ?? []).map((volume) => {
    const base = (project.surfaces ?? []).find((entry) => entry.id === volume.baseSurfaceId);
    const comparison = (project.surfaces ?? []).find(
      (entry) => entry.id === volume.comparisonSurfaceId,
    );
    const baseState = surfaceDisplayStatus(project, tinCache, volume.baseSurfaceId);
    const comparisonState = surfaceDisplayStatus(project, tinCache, volume.comparisonSurfaceId);
    const layer = layerOf(volume.layerId);
    const styleId = volume.styleId ?? null;
    let status: VolumeSurfaceStatus;
    let diagnostic: string | null = null;
    let revision = '';
    let quantities: CadVolumeResult | null = null;
    let staleQuantities: CadVolumeResult | null = null;
    let stale = false;
    if (options?.buildingVolumeIds?.has(volume.id)) {
      status = 'BUILDING';
    } else if (!base || !comparison || base.id === comparison.id) {
      status = 'BROKEN_REFERENCE';
    } else {
      const baseRev = surfaceContentRevision(project, base);
      const cmpRev = surfaceContentRevision(project, comparison);
      revision = computeVolumeSurfaceRevision({
        baseId: base.id,
        baseRev,
        cmpId: comparison.id,
        cmpRev,
      });
      const fresh = volumeCache?.get(volume.id, revision) ?? null;
      const retained = volumeCache?.retained(volume.id) ?? [];
      if (!baseState.current || !comparisonState.current) {
        status = 'SOURCE_NOT_CURRENT';
        stale = retained.length > 0;
        staleQuantities = retained.length > 0 ? (retained[retained.length - 1] ?? null) : null;
      } else if (fresh) {
        status = fresh.overlapArea > 0 ? 'CURRENT' : 'NO_OVERLAP';
        quantities = fresh;
      } else if (retained.length > 0) {
        status = 'NEEDS_RECALC';
        stale = true;
        staleQuantities = retained[retained.length - 1] ?? null;
      } else {
        const failure = options?.sessionDiagnostics?.get(volume.id);
        if (failure && failure.revision === revision) {
          status = 'FAILED';
          diagnostic = failure.error;
        } else {
          status = 'UNBUILT';
        }
      }
    }
    return {
      id: volume.id,
      name: volume.name,
      baseSurfaceId: volume.baseSurfaceId,
      baseName: base?.name ?? baseState.name,
      comparisonSurfaceId: volume.comparisonSurfaceId,
      comparisonName: comparison?.name ?? comparisonState.name,
      layerId: layer.id,
      layerName: layer.name,
      layerLocked: layer.locked,
      styleId,
      styleName: (styleId != null ? styleNames.get(styleId) : undefined) ?? 'Cut/Fill',
      status,
      statusText: volumeSurfaceStatusText(status),
      stale,
      revision,
      diagnostic,
      quantities,
      staleQuantities,
      baseStatus: baseState.text,
      comparisonStatus: comparisonState.text,
      calculable:
        status !== 'BUILDING' &&
        status !== 'BROKEN_REFERENCE' &&
        baseState.current &&
        comparisonState.current,
      exportable: status === 'CURRENT',
    };
  });
  // Deterministic ordering: definition order is already drawing order.
  return {
    volumes,
    selectedVolumeId:
      selectedVolumeId != null && volumes.some((entry) => entry.id === selectedVolumeId)
        ? selectedVolumeId
        : null,
    styles: styles.map((style) => ({
      id: style.id,
      name: style.name,
      showCut: style.showCut,
      showFill: style.showFill,
      showZeroBoundary: style.showZeroBoundary === true,
      cutColor: style.cutColor,
      fillColor: style.fillColor,
      opacity: style.opacity,
    })),
  };
};

// ---------------------------------------------------------------------------
// Difference inquiry (live source inquiry — aggregate recalc NOT required)
// ---------------------------------------------------------------------------

export interface VolumeDifferenceResult {
  volumeName: string;
  x: number;
  y: number;
  baseElevation: number;
  comparisonElevation: number;
  delta: number;
}

/**
 * Live source inquiry: both source TINs must be CURRENT for their present
 * revision; the aggregate volume result need NOT be current (the answer is
 * labeled "live source inquiry" honestly). Null = blocked (caller reports
 * which source is stale/missing); NaN-free by construction.
 */
export const queryVolumeDifference = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  volumeId: string,
  x: number,
  y: number,
): VolumeDifferenceResult | null => {
  const volume = (project.volumeSurfaces ?? []).find((entry) => entry.id === volumeId);
  if (!volume || volume.baseSurfaceId === volume.comparisonSurfaceId) return null;
  const base = (project.surfaces ?? []).find((entry) => entry.id === volume.baseSurfaceId);
  const comparison = (project.surfaces ?? []).find(
    (entry) => entry.id === volume.comparisonSurfaceId,
  );
  if (!base || !comparison) return null;
  const baseMesh = tinCache.get(base.id, surfaceContentRevision(project, base));
  const comparisonMesh = tinCache.get(
    comparison.id,
    surfaceContentRevision(project, comparison),
  );
  if (!baseMesh || !comparisonMesh) return null;
  const baseElevation = queryMeshElevation(baseMesh, x, y);
  const comparisonElevation = queryMeshElevation(comparisonMesh, x, y);
  if (baseElevation == null || comparisonElevation == null) return null;
  return {
    volumeName: volume.name,
    x,
    y,
    baseElevation,
    comparisonElevation,
    delta: comparisonElevation - baseElevation,
  };
};

/**
 * Answer formatting. Sign display contract: negative delta shows
 * "CUT 0.350", positive "FILL 0.350", zero "BALANCED 0.000" — never a bare
 * signed number without the word.
 */
export const formatVolumeDifferenceAnswer = (
  result: VolumeDifferenceResult | null,
  volumeName: string,
  x: number,
  y: number,
): string => {
  if (!result) {
    return `“${volumeName}” has no live source inquiry at point (${x.toFixed(3)}, ${y.toFixed(3)}) — rebuild both source TINs, then query inside both meshes.`;
  }
  const magnitude = Math.abs(result.delta).toFixed(3);
  const verdict =
    result.delta > 0 ? `FILL ${magnitude}` : result.delta < 0 ? `CUT ${magnitude}` : 'BALANCED 0.000';
  return (
    `“${result.volumeName}” E ${x.toFixed(3)} N ${y.toFixed(3)} ` +
    `base ${result.baseElevation.toFixed(3)} comparison ${result.comparisonElevation.toFixed(3)} ` +
    `Δ ${result.delta.toFixed(3)} — ${verdict} (live source inquiry).`
  );
};

// ---------------------------------------------------------------------------
// Volume Summary CSV (mirrors cadCogoReports: format/escape/filename)
// ---------------------------------------------------------------------------

const escapeVolumeCsv = (value: string): string => {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const buildVolumeSummaryFilename = (volumeName: string): string => {
  const slug = volumeName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'volume';
  return `volume-summary-${slug}.csv`;
};

/**
 * Export-only summary (never persisted as a cogoComputation). Enabled ONLY
 * when CURRENT — callers gate on `row.exportable`; this builder throws on
 * any other status so a stale export can never slip through silently.
 */
export const buildVolumeSummaryCsv = (
  row: CadVolumeRow,
  units: string,
): string => {
  if (!row.exportable || !row.quantities) {
    throw new Error(`Volume Summary export blocked: “${row.name}” is ${row.statusText}, not Current.`);
  }
  const quantities = row.quantities;
  const areaUnit = volumeAreaUnit(units);
  const volUnit = volumeUnit(units);
  const lines: string[][] = [
    ['section', 'label', 'value', 'unit'],
    ['meta', 'title', `Volume Summary — ${row.name}`, ''],
    ['meta', 'volume-surface', row.name, ''],
    ['meta', 'base', row.baseName, ''],
    ['meta', 'comparison', row.comparisonName, ''],
    ['meta', 'revision', row.revision, ''],
    ['meta', 'convention', VOLUME_SIGN_CONVENTION, ''],
    ['row', 'Overlap area', quantities.overlapArea.toFixed(3), areaUnit],
    ['row', 'Cut area', quantities.cutArea.toFixed(3), areaUnit],
    ['row', 'Fill area', quantities.fillArea.toFixed(3), areaUnit],
    ['row', 'Cut volume', quantities.cutVolume.toFixed(3), volUnit],
    ['row', 'Fill volume', quantities.fillVolume.toFixed(3), volUnit],
    ['row', 'Net volume (Fill − Cut)', quantities.netVolume.toFixed(3), volUnit],
    ['row', 'Average cut depth', quantities.averageCutDepth.toFixed(3), units === 'ft' ? 'ft' : 'm'],
    ['row', 'Average fill depth', quantities.averageFillDepth.toFixed(3), units === 'ft' ? 'ft' : 'm'],
    ['row', 'Max cut depth', quantities.maxCutDepth.toFixed(3), units === 'ft' ? 'ft' : 'm'],
    ['row', 'Max fill depth', quantities.maxFillDepth.toFixed(3), units === 'ft' ? 'ft' : 'm'],
    ['row', 'Base area', quantities.baseArea.toFixed(3), areaUnit],
    ['row', 'Comparison area', quantities.comparisonArea.toFixed(3), areaUnit],
  ];
  return lines.map((line) => line.map(escapeVolumeCsv).join(',')).join('\n');
};
