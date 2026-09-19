import { cadAlignmentRawStationToDisplayStation, formatCadStation } from '../../engine/cad/cadAlignmentStationing';
import { backfillCadSectionStyles } from '../../engine/cad/cadSectionTypes';
import {
  currentSectionResult,
  interpolateSectionElevation,
  resolveSectionViewDatum,
  sectionPlanPoint,
} from '../../engine/cad/cadSectionView';
import type { CadSectionCache } from '../../engine/cad/sectionCache';
import { computeCutFillArea } from '../../engine/cad/sections/sectionArea';
import type { SectionResult } from '../../engine/cad/sections/sectionTypes';
import type { CadSurfaceSectionResult } from '../../engine/cad/cadSectionTypes';
import type {
  CadProject,
  CadSampleLine,
  CadSampleLineGroup,
  CadSectionStatus,
  CadSectionView,
} from '../../engine/cad/cadTypes';

/**
 * Phase 18K UI — section snapshot for Toolspace/manager/Properties.
 *
 * Pure derivation over the drawing + session section cache once per
 * publish. Results/revisions/statuses never persist; every mutation
 * travels a real undoable SAMPLE or SECTION CadCommand through the
 * existing runSurveyCommand path.
 */

/** UI-owned command keys (one literal shared by both sides). */
export const CAD_SECTION_COMMANDS = {
  groupCreate: 'SAMPLE_GROUP_CREATE',
  groupRename: 'SAMPLE_GROUP_RENAME',
  groupDelete: 'SAMPLE_GROUP_DELETE',
  lineAdd: 'SAMPLE_LINE_ADD',
  lineAddInterval: 'SAMPLE_LINE_ADD_INTERVAL',
  lineUpdate: 'SAMPLE_LINE_UPDATE',
  lineDelete: 'SAMPLE_LINE_DELETE',
  sourceAdd: 'SECTION_SOURCE_ADD',
  sourceRemove: 'SECTION_SOURCE_REMOVE',
  sourceSetStyle: 'SECTION_SOURCE_SET_STYLE',
  areaComparison: 'SECTION_AREA_COMPARISON',
  styleCreate: 'SECTION_STYLE_CREATE',
  styleRename: 'SECTION_STYLE_RENAME',
  styleUpdate: 'SECTION_STYLE_UPDATE',
  styleDelete: 'SECTION_STYLE_DELETE',
  viewCreate: 'SECTION_VIEW_CREATE',
  viewUpdate: 'SECTION_VIEW_UPDATE',
  viewDelete: 'SECTION_VIEW_DELETE',
} as const;

export type SectionStatusText =
  | 'Current'
  | 'Needs Rebuild'
  | 'Building'
  | 'Failed'
  | 'Broken Reference'
  | 'Source Not Current'
  | 'Out Of Range'
  | 'No Coverage'
  | 'Unbuilt';

export const sectionStatusText = (status: CadSectionStatus): SectionStatusText => {
  switch (status) {
    case 'CURRENT': return 'Current';
    case 'NEEDS_REBUILD': return 'Needs Rebuild';
    case 'BUILDING': return 'Building';
    case 'FAILED': return 'Failed';
    case 'BROKEN_REFERENCE': return 'Broken Reference';
    case 'SOURCE_NOT_CURRENT': return 'Source Not Current';
    case 'OUT_OF_RANGE': return 'Out Of Range';
    case 'NO_COVERAGE': return 'No Coverage';
    case 'UNBUILT': return 'Unbuilt';
  }
};

export interface CadSampleLineSourceStatus {
  surfaceId: string;
  surfaceName: string;
  status: CadSectionStatus;
  statusText: SectionStatusText;
  stale: boolean;
}

export interface CadSampleLineRow {
  id: string;
  /** Manual override wins; else the shared formatted display station. */
  name: string;
  rawStation: number;
  displayedStation: string;
  /** False when raw sits inside an equation gap (label falls back to raw). */
  stationAmbiguous: boolean;
  leftWidth: number;
  rightWidth: number;
  skewDeg: number;
  outOfRange: boolean;
  sources: CadSampleLineSourceStatus[];
}

export interface CadSectionSourceRow {
  surfaceId: string;
  surfaceName: string;
  styleId: string | null;
  styleName: string;
}

export interface CadSampleLineGroupRow {
  id: string;
  name: string;
  alignmentEntityId: string;
  alignmentName: string;
  layerId: string;
  layerName: string;
  lines: CadSampleLineRow[];
  sources: CadSectionSourceRow[];
  baseSurfaceName: string | null;
  comparisonSurfaceName: string | null;
}

export interface CadSectionViewRow {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  lineId: string;
  /** Line label (manual or formatted station) + alignment context. */
  lineName: string;
  alignmentName: string;
  displayedStation: string;
  sourceNames: string[];
  horizontalScale: number;
  verticalExaggeration: number;
  datumText: string;
  offsetGridInterval: number;
  elevationGridInterval: number;
  showCutFill: boolean;
  baseSurfaceName: string | null;
  comparisonSurfaceName: string | null;
  area: { cut: number; fill: number; net: number } | null;
  /** Null when valid; otherwise the honest rejection reason. */
  validationError: string | null;
}

export interface CadSectionStyleSummary {
  id: string;
  name: string;
  color: string;
  lineweight: number;
  opacity: number;
}

export interface CadSectionSnapshot {
  groups: CadSampleLineGroupRow[];
  views: CadSectionViewRow[];
  alignments: Array<{ id: string; name: string }>;
  selectedGroupId: string | null;
  selectedLineId: string | null;
  selectedViewId: string | null;
  styles: CadSectionStyleSummary[];
}

export interface SectionSnapshotDeps {
  sectionCache: CadSectionCache | null;
  statusOf: (
    _groupId: string,
    _lineId: string,
    _surfaceId: string,
  ) => { status: CadSectionStatus; stale: boolean };
  buildingGroupIds?: ReadonlySet<string>;
}

const alignmentOf = (project: CadProject, alignmentEntityId: string) => {
  const entity = project.entities.find((entry) => entry.id === alignmentEntityId);
  return entity != null && entity.type === 'alignment' ? entity : null;
};

const surfaceNameOf = (project: CadProject, surfaceId: string): string =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId)?.name ?? surfaceId;

const lineLabel = (
  project: CadProject,
  group: CadSampleLineGroup,
  line: CadSampleLine,
): { name: string; displayedStation: string; ambiguous: boolean } => {
  if (line.manualName != null && line.manualName !== '') {
    return { name: line.manualName, displayedStation: line.manualName, ambiguous: false };
  }
  const alignment = alignmentOf(project, group.alignmentEntityId);
  const display = alignment
    ? cadAlignmentRawStationToDisplayStation(alignment, line.rawStation)
    : null;
  if (display == null) {
    return {
      name: `STA ${formatCadStation(line.rawStation)}?`,
      displayedStation: formatCadStation(line.rawStation),
      ambiguous: true,
    };
  }
  return { name: `STA ${formatCadStation(display)}`, displayedStation: formatCadStation(display), ambiguous: false };
};

const deriveLineRow = (
  project: CadProject,
  group: CadSampleLineGroup,
  line: CadSampleLine,
  deps: SectionSnapshotDeps,
): CadSampleLineRow => {
  const labeled = lineLabel(project, group, line);
  const alignment = alignmentOf(project, group.alignmentEntityId);
  const outOfRange = alignment == null;
  return {
    id: line.id,
    name: labeled.name,
    rawStation: line.rawStation,
    displayedStation: labeled.displayedStation,
    stationAmbiguous: labeled.ambiguous,
    leftWidth: line.leftWidth,
    rightWidth: line.rightWidth,
    skewDeg: line.skewDeg,
    outOfRange,
    sources: group.surfaceSources.map((source) => {
      if (deps.buildingGroupIds?.has(group.id)) {
        return {
          surfaceId: source.surfaceId,
          surfaceName: surfaceNameOf(project, source.surfaceId),
          status: 'BUILDING' as CadSectionStatus,
          statusText: 'Building' as SectionStatusText,
          stale: false,
        };
      }
      const state = deps.statusOf(group.id, line.id, source.surfaceId);
      return {
        surfaceId: source.surfaceId,
        surfaceName: surfaceNameOf(project, source.surfaceId),
        status: state.status,
        statusText: sectionStatusText(state.status),
        stale: state.stale,
      };
    }),
  };
};

/** View-model validation: line + sources must belong to the bound group. */
export const validateSectionView = (project: CadProject, view: CadSectionView): string | null => {
  const group = (project.sampleLineGroups ?? []).find((entry) => entry.id === view.sampleLineGroupId);
  if (!group) return 'sample-line group missing';
  if (!group.sampleLines.some((entry) => entry.id === view.sampleLineId)) {
    return 'sample line missing from its group';
  }
  const sourceSet = new Set(group.surfaceSources.map((entry) => entry.surfaceId));
  for (const surfaceId of view.sourceSurfaceIds) {
    if (!sourceSet.has(surfaceId)) return `source surface ${surfaceId} is not in the group`;
  }
  if (!(view.horizontalScale > 0)) return 'horizontal scale must be > 0';
  if (!(view.verticalExaggeration > 0)) return 'vertical exaggeration must be > 0';
  if (view.datumMode === 'explicit' && view.datumElevation == null) {
    return 'explicit datum requires an elevation';
  }
  return null;
};

export const buildCadSectionSnapshot = (
  project: CadProject,
  deps: SectionSnapshotDeps,
  selectedGroupId: string | null,
  selectedLineId: string | null,
  selectedViewId: string | null,
): CadSectionSnapshot => {
  const layers = new Map(project.layers.map((layer) => [layer.id, layer.name]));
  const styles = backfillCadSectionStyles(project.sectionStyles);
  const styleNames = new Map(styles.map((style) => [style.id, style.name]));
  const groups: CadSampleLineGroupRow[] = (project.sampleLineGroups ?? []).map((group) => {
    const alignment = alignmentOf(project, group.alignmentEntityId);
    return {
      id: group.id,
      name: group.name,
      alignmentEntityId: group.alignmentEntityId,
      alignmentName: alignment?.name ?? group.alignmentEntityId,
      layerId: group.layerId ?? 'general',
      layerName: layers.get(group.layerId ?? 'general') ?? (group.layerId ?? 'general'),
      lines: group.sampleLines.map((line) => deriveLineRow(project, group, line, deps)),
      sources: group.surfaceSources.map((source) => ({
        surfaceId: source.surfaceId,
        surfaceName: surfaceNameOf(project, source.surfaceId),
        styleId: source.sectionStyleId ?? null,
        styleName:
          (source.sectionStyleId != null ? styleNames.get(source.sectionStyleId) : undefined) ??
          'Standard',
      })),
      baseSurfaceName:
        group.areaComparison != null ? surfaceNameOf(project, group.areaComparison.baseSurfaceId) : null,
      comparisonSurfaceName:
        group.areaComparison != null
          ? surfaceNameOf(project, group.areaComparison.comparisonSurfaceId)
          : null,
    };
  });
  const groupById = new Map(groups.map((row) => [row.id, row]));
  const views: CadSectionViewRow[] = (project.sectionViews ?? []).map((view) => {
    const validationError = validateSectionView(project, view);
    const group = (project.sampleLineGroups ?? []).find((entry) => entry.id === view.sampleLineGroupId) ?? null;
    const line = group?.sampleLines.find((entry) => entry.id === view.sampleLineId) ?? null;
    const alignment = group ? alignmentOf(project, group.alignmentEntityId) : null;
    const labeled = group && line ? lineLabel(project, group, line) : null;
    let area: { cut: number; fill: number; net: number } | null = null;
    if (group && line && group.areaComparison != null && view.showCutFill === true) {
      const base = currentSectionResult(project, deps.sectionCache, group, line, group.areaComparison.baseSurfaceId);
      const comparison = currentSectionResult(
        project,
        deps.sectionCache,
        group,
        line,
        group.areaComparison.comparisonSurfaceId,
      );
      if (base && comparison) {
        // Exact pairwise overlay lives in the engine; the snapshot only
        // surfaces the numbers (properties + manager), never geometry.
        area = overlayArea(base, comparison);
      }
    }
    return {
      id: view.id,
      name: view.name,
      groupId: view.sampleLineGroupId,
      groupName: groupById.get(view.sampleLineGroupId)?.name ?? view.sampleLineGroupId,
      lineId: view.sampleLineId,
      lineName: labeled?.name ?? view.sampleLineId,
      alignmentName: alignment?.name ?? (group?.alignmentEntityId ?? '—'),
      displayedStation: labeled?.displayedStation ?? '—',
      sourceNames: view.sourceSurfaceIds.map((id) => surfaceNameOf(project, id)),
      horizontalScale: view.horizontalScale > 0 ? view.horizontalScale : 1,
      verticalExaggeration: view.verticalExaggeration > 0 ? view.verticalExaggeration : 1,
      datumText:
        view.datumMode === 'explicit'
          ? (view.datumElevation?.toFixed(3) ?? '—')
          : `Auto (grid ${view.elevationGridInterval ?? 1})`,
      offsetGridInterval: view.offsetGridInterval ?? 10,
      elevationGridInterval: view.elevationGridInterval ?? 1,
      showCutFill: view.showCutFill === true,
      baseSurfaceName:
        group?.areaComparison != null ? surfaceNameOf(project, group.areaComparison.baseSurfaceId) : null,
      comparisonSurfaceName:
        group?.areaComparison != null
          ? surfaceNameOf(project, group.areaComparison.comparisonSurfaceId)
          : null,
      area,
      validationError,
    };
  });
  return {
    groups,
    views,
    alignments: project.entities
      .filter((entity) => entity.type === 'alignment')
      .map((entity) => ({ id: entity.id, name: entity.type === 'alignment' ? entity.name : entity.id })),
    selectedGroupId: selectedGroupId != null && groupById.has(selectedGroupId) ? selectedGroupId : null,
    selectedLineId:
      selectedLineId != null &&
      groups.some((row) => row.lines.some((line) => line.id === selectedLineId))
        ? selectedLineId
        : null,
    selectedViewId:
      selectedViewId != null && views.some((entry) => entry.id === selectedViewId) ? selectedViewId : null,
    styles: styles.map((style) => ({
      id: style.id,
      name: style.name,
      color: style.color,
      lineweight: style.lineweight,
      opacity: style.opacity,
    })),
  };
};

// ---------------------------------------------------------------------------
// Exact pairwise overlay area (engine curve; no new math here)
// ---------------------------------------------------------------------------

const asEngineTrace = (result: CadSurfaceSectionResult): SectionResult => ({
  rawStation: result.rawStation,
  center: { x: 0, y: 0 },
  direction: { x: 1, y: 0 },
  leftWidth: 0,
  rightWidth: 0,
  segments: result.segments.map((segment) => ({
    samples: segment.samples.map((sample) => ({
      offset: sample.offset,
      x: sample.x ?? 0,
      y: sample.y ?? 0,
      elevation: sample.elevation,
    })),
  })),
  minElevation: result.minElevation,
  maxElevation: result.maxElevation,
  coveredWidth: result.coveredWidth,
  gapWidth: result.gapWidth,
  diagnostics: [...result.diagnostics],
});

const overlayArea = (
  base: CadSurfaceSectionResult,
  comparison: CadSurfaceSectionResult,
): { cut: number; fill: number; net: number } => {
  const area = computeCutFillArea(asEngineTrace(base), asEngineTrace(comparison));
  return { cut: area.cut, fill: area.fill, net: area.net };
};

// ---------------------------------------------------------------------------
// Inquiry answer formatting (offset in, station/offset/E/N/elevation out)
// ---------------------------------------------------------------------------

export const formatSectionElevationAnswer = (
  viewName: string,
  displayedStation: string,
  offset: number,
  point: { x: number | null; y: number | null; elevation: number } | null,
  aligned: boolean,
): string => {
  const offsetText = `${Math.abs(offset).toFixed(3)}${Math.abs(offset) < 1e-9 ? '' : offset > 0 ? 'L' : 'R'}`;
  if (!aligned) {
    return `“${viewName}” has no current section — rebuild its sample-line group first.`;
  }
  if (point == null) {
    return `No section elevation at offset ${offsetText} (station ${displayedStation}) on “${viewName}” — gap or outside coverage.`;
  }
  const en = point.x != null && point.y != null
    ? ` E ${point.x.toFixed(3)} N ${point.y.toFixed(3)}`
    : '';
  return (
    `“${viewName}” station ${displayedStation} offset ${offsetText}${en} ` +
    `elevation ${point.elevation.toFixed(3)}.`
  );
};

/**
 * Section Elevation at Offset: line + surface + offset resolve to the
 * displayed station + interpolated elevation. Gap/outside answers null
 * (the caller formats the honest no-elevation text). E/N come from the
 * extractor's stored world XY when present, else the plan frame.
 */
export const querySectionElevationAtOffset = (
  project: CadProject,
  sectionCache: CadSectionCache | null,
  groupId: string,
  lineId: string,
  surfaceId: string,
  offset: number,
): { elevation: number; x: number | null; y: number | null } | null => {
  const group = (project.sampleLineGroups ?? []).find((entry) => entry.id === groupId) ?? null;
  const line = group?.sampleLines.find((entry) => entry.id === lineId) ?? null;
  if (!group || !line) return null;
  const result = currentSectionResult(project, sectionCache, group, line, surfaceId);
  if (!result) return null;
  const hit = interpolateSectionElevation(result, offset);
  if (!hit) return null;
  if (hit.x != null && hit.y != null) return hit;
  const alignment = alignmentOf(project, group.alignmentEntityId);
  if (alignment) {
    const placed = sectionPlanPoint(alignment, line);
    if (placed) {
      return {
        elevation: hit.elevation,
        x: placed.center.x + placed.direction.x * offset,
        y: placed.center.y + placed.direction.y * offset,
      };
    }
  }
  return { elevation: hit.elevation, x: null, y: null };
};

// ---------------------------------------------------------------------------
// Batch Create Section Views: deterministic single vertical stack.
// ---------------------------------------------------------------------------

/**
 * Layout choice (documented): ONE vertical stack below a single insertion
 * origin — no columns. Frames never overlap by construction (each origin
 * steps down by frame height + gap); horizontal alignment is trivially
 * uniform. Columns would need overlap guards for varying widths; the
 * stack needs none.
 */
export interface SectionViewFrameSize {
  lineId: string;
  width: number;
  height: number;
}

export const layoutSectionViewStack = (
  originX: number,
  originY: number,
  frames: SectionViewFrameSize[],
  gap: number,
): Array<{ lineId: string; insertionX: number; insertionY: number }> => {
  const safeGap = Number.isFinite(gap) && gap >= 0 ? gap : 0;
  let cursorY = originY;
  return frames.map((frame) => {
    const height = frame.height > 0 ? frame.height : 0;
    const placement = { lineId: frame.lineId, insertionX: originX, insertionY: cursorY };
    cursorY -= height + safeGap;
    return placement;
  });
};

/**
 * Frame estimate for one line: full width span at 1:1 horizontally, cached
 * elevation span (x VE) vertically, fallback height when UNBUILT. The
 * caller persists placements via SECTION_VIEW_CREATE (undoable); moving a
 * view later is display-only (SECTION_VIEW_UPDATE, no re-extract).
 */
export const estimateSectionViewFrame = (
  project: CadProject,
  sectionCache: CadSectionCache | null,
  group: CadSampleLineGroup,
  lineId: string,
  verticalExaggeration: number,
  fallbackHeight: number,
): SectionViewFrameSize => {
  const line = group.sampleLines.find((entry) => entry.id === lineId) ?? null;
  const width = line != null ? line.leftWidth + line.rightWidth : 0;
  let height = fallbackHeight;
  if (line) {
    let min = Infinity;
    let max = -Infinity;
    for (const source of group.surfaceSources) {
      const result = currentSectionResult(project, sectionCache, group, line, source.surfaceId);
      if (result?.minElevation != null) min = Math.min(min, result.minElevation);
      if (result?.maxElevation != null) max = Math.max(max, result.maxElevation);
    }
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      height = (max - min) * (verticalExaggeration > 0 ? verticalExaggeration : 1);
    }
  }
  return { lineId, width, height };
};

export const resolveSectionDatumPreview = (
  view: Pick<CadSectionView, 'datumMode' | 'datumElevation'>,
  minElevation: number | null,
  step: number,
): string => {
  if (view.datumMode === 'explicit') return view.datumElevation?.toFixed(3) ?? '—';
  if (minElevation == null) return '—';
  return resolveSectionViewDatum(view, minElevation, step).toFixed(3);
};
