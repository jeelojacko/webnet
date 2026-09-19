import { cadPointAtAlignmentStation } from './cadAlignment';
import {
  cadAlignmentRawStationToDisplayStation,
  formatCadStation,
} from './cadAlignmentStationing';
import { computeCadSurfaceSourceRevision } from './cadSurfaces';
import { computeCadSampleLineRevision } from './cadSectionRevision';
import {
  backfillCadSectionStyles,
  resolveSectionLayerId,
  type CadSurfaceSectionResult,
} from './cadSectionTypes';
import type { CadSectionCache } from './sectionCache';
import { resolveSampleFrame, pointAtSampleOffset } from './sections/sectionDirection';
import { resolveTangentAtRawStation } from './sections/sectionTangent';
import type {
  CadAlignmentEntity,
  CadProject,
  CadSampleLine,
  CadSampleLineGroup,
  CadSectionView,
} from './cadTypes';

/**
 * Phase 18K UI — sample-line plan display + section-view display adapters
 * (UI-owned, pure). Mirrors cadProfileView.ts: aggregated SVG per group /
 * view, CURRENT-only traces, bounded labels. Derived only — never CAD
 * entities, never persisted.
 *
 * Conventions (documented, display-only; engine offset stays positive-left):
 * - Plan: endpoints from the exact engine tangent + skew frame; station
 *   label via the shared formatter (equation edits relabel, XY unchanged).
 * - Section view: horizontal axis = OFFSET with LEFT on visual left, i.e.
 *   displayX = insertionX - offset * horizontalScale. Ticks read like
 *   20L/10L/0/10R/20R. Vertical = elevation above datum, exaggerated.
 */

export interface CadSampleLinePlanLine {
  lineId: string;
  /** Manual override wins; else the shared formatted display station. */
  label: string;
  /** World-space centerline path (M/L only, model units). */
  d: string;
  /** World-space center tick path. */
  tickD: string;
  labelX: number;
  labelY: number;
  centerX: number;
  centerY: number;
  /** True when raw sits inside an equation gap: label honest, no geometry. */
  ambiguousLabel: boolean;
  outOfRange: boolean;
}

export interface CadSampleLineDisplayLayer {
  groupId: string;
  groupName: string;
  alignmentName: string;
  layerId: string;
  lines: CadSampleLinePlanLine[];
  labelsTruncated: boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export interface SectionViewDisplayOptions {
  maxLabels?: number;
}

const MAX_LABELS_DEFAULT = 200;

const findAlignment = (
  project: CadProject,
  alignmentEntityId: string,
): CadAlignmentEntity | null => {
  const entity = project.entities.find((entry) => entry.id === alignmentEntityId);
  return entity != null && entity.type === 'alignment' ? entity : null;
};

/**
 * Plan position of one sample line: exact engine tangent at the RAW station
 * plus the skew frame. Display station maps raw->display for the center
 * lookup; a gap raw (null display) is fail-closed: no geometry, honest flag.
 */
export const sectionPlanPoint = (
  alignment: Pick<CadAlignmentEntity, 'id' | 'elements' | 'startStation' | 'stationEquations'>,
  line: Pick<CadSampleLine, 'rawStation' | 'leftWidth' | 'rightWidth' | 'skewDeg'>,
): { center: { x: number; y: number }; direction: { x: number; y: number } } | null => {
  const display = cadAlignmentRawStationToDisplayStation(alignment, line.rawStation);
  if (display == null) return null;
  const center = cadPointAtAlignmentStation(alignment, display);
  if (!center) return null;
  const tangent = resolveTangentAtRawStation(alignment.elements, alignment.startStation, line.rawStation);
  if (!tangent.ok) return null;
  const frame = resolveSampleFrame(tangent.value.tangent, line.skewDeg);
  if (!frame.ok) return null;
  return { center, direction: frame.value.d };
};

export const buildSampleLineDisplayLayers = (
  project: CadProject,
  options?: SectionViewDisplayOptions,
): CadSampleLineDisplayLayer[] => {
  const maxLabels = options?.maxLabels ?? MAX_LABELS_DEFAULT;
  const layers: CadSampleLineDisplayLayer[] = [];
  let labelBudget = maxLabels;
  for (const group of project.sampleLineGroups ?? []) {
    const alignment = findAlignment(project, group.alignmentEntityId);
    const alignmentName = alignment?.name ?? group.alignmentEntityId;
    const lines: CadSampleLinePlanLine[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const track = (x: number, y: number): void => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    for (const line of group.sampleLines) {
      const display = alignment
        ? cadAlignmentRawStationToDisplayStation(alignment, line.rawStation)
        : null;
      const label = line.manualName ?? formatCadStation(display ?? line.rawStation);
      if (!alignment || display == null) {
        lines.push({
          lineId: line.id,
          label,
          d: '',
          tickD: '',
          labelX: 0,
          labelY: 0,
          centerX: 0,
          centerY: 0,
          ambiguousLabel: alignment != null && display == null,
          outOfRange: alignment == null,
        });
        continue;
      }
      const placed = sectionPlanPoint(alignment, line);
      if (!placed) {
        lines.push({
          lineId: line.id,
          label,
          d: '',
          tickD: '',
          labelX: 0,
          labelY: 0,
          centerX: 0,
          centerY: 0,
          ambiguousLabel: false,
          outOfRange: true,
        });
        continue;
      }
      const left = pointAtSampleOffset(placed.center, placed.direction, line.leftWidth);
      const right = pointAtSampleOffset(placed.center, placed.direction, -line.rightWidth);
      // Center tick: short cross along the alignment tangent.
      const tangent = resolveTangentAtRawStation(
        alignment.elements,
        alignment.startStation,
        line.rawStation,
      );
      const tickHalf = Math.max(1, (line.leftWidth + line.rightWidth) * 0.02);
      let tickD = '';
      if (tangent.ok) {
        const length = Math.hypot(tangent.value.tangent.x, tangent.value.tangent.y) || 1;
        const tx = (tangent.value.tangent.x / length) * tickHalf;
        const ty = (tangent.value.tangent.y / length) * tickHalf;
        tickD =
          `M${placed.center.x - tx} ${placed.center.y - ty}` +
          `L${placed.center.x + tx} ${placed.center.y + ty}`;
      }
      track(left.x, left.y);
      track(right.x, right.y);
      const showLabel = labelBudget > 0;
      if (showLabel) labelBudget -= 1;
      lines.push({
        lineId: line.id,
        label,
        d: `M${left.x} ${left.y}L${right.x} ${right.y}`,
        tickD,
        // Labels are budget-capped for hundreds of lines; geometry never is.
        labelX: showLabel ? placed.center.x : 0,
        labelY: showLabel ? placed.center.y : 0,
        centerX: placed.center.x,
        centerY: placed.center.y,
        ambiguousLabel: false,
        outOfRange: false,
      });
    }
    layers.push({
      groupId: group.id,
      groupName: group.name,
      alignmentName,
      layerId: resolveSectionLayerId(project, group.layerId),
      lines,
      labelsTruncated: labelBudget <= 0 && group.sampleLines.length > 0,
      bounds: Number.isFinite(minX)
        ? { minX, minY, maxX, maxY }
        : null,
    });
  }
  return layers;
};

// ---------------------------------------------------------------------------
// Section view display
// ---------------------------------------------------------------------------

export interface CadSectionTracePath {
  surfaceId: string;
  surfaceName: string;
  color: string;
  d: string;
}

export interface CadSectionViewDisplayLayer {
  viewId: string;
  viewName: string;
  layerId: string;
  stale: boolean;
  statusText: string;
  /** "Alignment — STA 1+234.500" (displayed station; equation-aware). */
  title: string;
  datumElevation: number;
  gridD: string;
  centerlineD: string;
  tracePaths: CadSectionTracePath[];
  /** Translucent cut/fill shading (derived paths; NO CadPolygonEntity). */
  cutD: string;
  fillD: string;
  offsetTicks: Array<{ x: number; y: number; text: string }>;
  elevationLabels: Array<{ x: number; y: number; text: string }>;
  legend: Array<{ surfaceName: string; color: string }>;
  area: { cut: number; fill: number; net: number } | null;
  labelsTruncated: boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/** CURRENT-only cached result for one line x source (null when stale/absent). */
export const currentSectionResult = (
  project: CadProject,
  sectionCache: CadSectionCache | null,
  group: CadSampleLineGroup,
  line: CadSampleLine,
  surfaceId: string,
): CadSurfaceSectionResult | null => {
  if (!sectionCache) return null;
  const alignment = findAlignment(project, group.alignmentEntityId);
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  const lineRevision = computeCadSampleLineRevision(
    line,
    alignment ? { id: alignment.id, elements: alignment.elements, startStation: alignment.startStation } : null,
    group.alignmentEntityId,
  );
  const surfaceRevision = computeCadSurfaceSourceRevision(project, surface);
  const result = sectionCache.get(line.id, surfaceId, lineRevision);
  if (!result || result.surfaceRevision !== surfaceRevision) return null;
  return result;
};

/** Auto datum floors to the step; explicit uses the override verbatim. */
export const resolveSectionViewDatum = (
  view: Pick<CadSectionView, 'datumMode' | 'datumElevation'>,
  minElevation: number,
  step = 1,
): number => {
  if (view.datumMode === 'explicit' && view.datumElevation != null) return view.datumElevation;
  const safe = step > 0 ? step : 1;
  return Math.floor(minElevation / safe) * safe;
};

const traceElevationAt = (
  result: CadSurfaceSectionResult,
  offset: number,
): number | null => {
  for (const segment of result.segments) {
    const samples = segment.samples;
    for (let index = 0; index + 1 < samples.length; index += 1) {
      const a = samples[index]!;
      const b = samples[index + 1]!;
      if (offset >= a.offset - 1e-9 && offset <= b.offset + 1e-9 && b.offset > a.offset + 1e-9) {
        const ratio = (offset - a.offset) / (b.offset - a.offset);
        return a.elevation + (b.elevation - a.elevation) * ratio;
      }
    }
  }
  return null;
};

/**
 * Derived cut/fill shading polygons over COMMON coverage only. Breaks at
 * every sample offset plus exact zero crossings; gaps stay empty (an
 * interval with either side uncovered emits nothing — shading stops).
 */
export const buildCutFillShading = (
  base: CadSurfaceSectionResult,
  comparison: CadSurfaceSectionResult,
  placeX: (_offset: number) => number,
  placeY: (_elevation: number) => number,
): { cutD: string; fillD: string; cut: number; fill: number; net: number } => {
  const breaks = new Set<number>();
  for (const result of [base, comparison]) {
    for (const segment of result.segments) {
      for (const sample of segment.samples) breaks.add(sample.offset);
    }
  }
  const ordered = [...breaks].sort((a, b) => a - b);
  let cutD = '';
  let fillD = '';
  let cut = 0;
  let fill = 0;
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const o0 = ordered[index]!;
    const o1 = ordered[index + 1]!;
    if (o1 - o0 <= 1e-9) continue;
    const b0 = traceElevationAt(base, o0);
    const b1 = traceElevationAt(base, o1);
    const c0 = traceElevationAt(comparison, o0);
    const c1 = traceElevationAt(comparison, o1);
    if (b0 == null || b1 == null || c0 == null || c1 == null) continue;
    const d0 = c0 - b0;
    const d1 = c1 - b1;
    // Exact zero-crossing split; each half keeps one sign (trapezoid area).
    const splits: Array<[number, number, number, number, number, number]> = [];
    if (d0 * d1 < 0) {
      const ratio = Math.abs(d0) / (Math.abs(d0) + Math.abs(d1));
      const om = o0 + (o1 - o0) * ratio;
      const zbm = b0 + (b1 - b0) * ratio;
      const zcm = c0 + (c1 - c0) * ratio;
      splits.push([o0, om, b0, zbm, c0, zcm]);
      splits.push([om, o1, zbm, b1, zcm, c1]);
    } else {
      splits.push([o0, o1, b0, b1, c0, c1]);
    }
    for (const [s0, s1, zb0, zb1, zc0, zc1] of splits) {
      const zbm = (zb0 + zb1) / 2;
      const zcm = (zc0 + zc1) / 2;
      const area = Math.abs(zcm - zbm) * (s1 - s0);
      const path =
        `M${placeX(s0)} ${placeY(zb0)}L${placeX(s1)} ${placeY(zb1)}` +
        `L${placeX(s1)} ${placeY(zc1)}L${placeX(s0)} ${placeY(zc0)}Z`;
      if (zcm >= zbm) {
        fillD += path;
        fill += area;
      } else {
        cutD += path;
        cut += area;
      }
    }
  }
  return { cutD, fillD, cut, fill, net: fill - cut };
};

export const buildSectionViewDisplayLayers = (
  project: CadProject,
  sectionCache: CadSectionCache | null,
  options?: SectionViewDisplayOptions,
): CadSectionViewDisplayLayer[] => {
  if (!sectionCache) return [];
  const maxLabels = options?.maxLabels ?? MAX_LABELS_DEFAULT;
  const styles = new Map(backfillCadSectionStyles(project.sectionStyles).map((style) => [style.id, style]));
  const surfaces = new Map((project.surfaces ?? []).map((entry) => [entry.id, entry]));
  const groups = new Map((project.sampleLineGroups ?? []).map((entry) => [entry.id, entry]));
  const layers: CadSectionViewDisplayLayer[] = [];
  const fallbackColors = ['#8a8f98', '#1f6feb', '#d29922', '#a371f7', '#39c5cf'];
  for (const view of project.sectionViews ?? []) {
    const group = groups.get(view.sampleLineGroupId);
    const line = group?.sampleLines.find((entry) => entry.id === view.sampleLineId) ?? null;
    const alignment = group ? findAlignment(project, group.alignmentEntityId) : null;
    if (!group || !line || !alignment) continue;
    const horizontalScale = view.horizontalScale > 0 ? view.horizontalScale : 1;
    const verticalExaggeration = view.verticalExaggeration > 0 ? view.verticalExaggeration : 1;
    // LEFT on visual left: positive (left) offsets decrease X.
    const placeX = (offset: number): number => view.insertionX - offset * horizontalScale;
    const memberResults: Array<{ surfaceId: string; result: CadSurfaceSectionResult }> = [];
    for (const surfaceId of view.sourceSurfaceIds) {
      const result = currentSectionResult(project, sectionCache, group, line, surfaceId);
      if (result) memberResults.push({ surfaceId, result });
    }
    if (memberResults.length === 0) continue;
    let minElevation = Infinity;
    let maxElevation = -Infinity;
    let minOffset = Infinity;
    let maxOffset = -Infinity;
    for (const member of memberResults) {
      if (member.result.minElevation != null) minElevation = Math.min(minElevation, member.result.minElevation);
      if (member.result.maxElevation != null) maxElevation = Math.max(maxElevation, member.result.maxElevation);
      for (const segment of member.result.segments) {
        for (const sample of segment.samples) {
          minOffset = Math.min(minOffset, sample.offset);
          maxOffset = Math.max(maxOffset, sample.offset);
        }
      }
    }
    if (!Number.isFinite(minElevation) || !Number.isFinite(maxElevation)) continue;
    if (!Number.isFinite(minOffset) || !Number.isFinite(maxOffset)) continue;
    const datum = resolveSectionViewDatum(view, minElevation, view.elevationGridInterval);
    const placeY = (elevation: number): number =>
      view.insertionY + (elevation - datum) * verticalExaggeration;
    const surfaceNameOf = (surfaceId: string): string =>
      surfaces.get(surfaceId)?.name ?? surfaceId;
    const colorOf = (surfaceId: string, index: number): string => {
      const source = group.surfaceSources.find((entry) => entry.surfaceId === surfaceId);
      const style = source?.sectionStyleId != null ? styles.get(source.sectionStyleId) : undefined;
      if (style && style.id !== 'section-style-none') return style.color;
      if (style?.id === 'section-style-none') return 'none';
      return fallbackColors[index % fallbackColors.length]!;
    };
    const tracePaths: CadSectionTracePath[] = [];
    const legend: Array<{ surfaceName: string; color: string }> = [];
    memberResults.forEach((member, index) => {
      const color = colorOf(member.surfaceId, index);
      if (color === 'none') return;
      let d = '';
      for (const segment of member.result.segments) {
        segment.samples.forEach((sample, sampleIndex) => {
          d += `${sampleIndex === 0 ? 'M' : 'L'}${placeX(sample.offset)} ${placeY(sample.elevation)}`;
        });
      }
      tracePaths.push({ surfaceId: member.surfaceId, surfaceName: surfaceNameOf(member.surfaceId), color, d });
      legend.push({ surfaceName: surfaceNameOf(member.surfaceId), color });
    });
    // Offset grid + elevation grid.
    const offsetInterval = view.offsetGridInterval ?? 10;
    const elevInterval = view.elevationGridInterval ?? 1;
    let gridD = '';
    if (offsetInterval > 0) {
      const first = Math.ceil(minOffset / offsetInterval) * offsetInterval;
      for (let offset = first; offset <= maxOffset + 1e-9; offset += offsetInterval) {
        gridD += `M${placeX(offset)} ${placeY(datum)}L${placeX(offset)} ${placeY(maxElevation)}`;
      }
    }
    if (elevInterval > 0) {
      const first = Math.ceil(datum / elevInterval) * elevInterval;
      for (let elevation = first; elevation <= maxElevation + 1e-9; elevation += elevInterval) {
        gridD += `M${placeX(maxOffset)} ${placeY(elevation)}L${placeX(minOffset)} ${placeY(elevation)}`;
      }
    }
    // OFFSET-0 centerline + CL label.
    const centerlineD =
      `M${placeX(0)} ${placeY(datum)}L${placeX(0)} ${placeY(maxElevation)}`;
    // Offset ticks like 20L/10L/0/10R/20R (positive offset = LEFT).
    const offsetTicks: Array<{ x: number; y: number; text: string }> = [];
    if (offsetInterval > 0) {
      const first = Math.ceil(minOffset / offsetInterval) * offsetInterval;
      for (let offset = first; offset <= maxOffset + 1e-9; offset += offsetInterval) {
        const abs = Math.abs(offset);
        const text = abs < 1e-9 ? '0' : `${Number(abs.toFixed(3))}${offset > 0 ? 'L' : 'R'}`;
        offsetTicks.push({ x: placeX(offset), y: placeY(datum), text });
      }
    }
    const elevationLabels: Array<{ x: number; y: number; text: string }> = [];
    if (elevInterval > 0) {
      const first = Math.ceil(datum / elevInterval) * elevInterval;
      for (let elevation = first; elevation <= maxElevation + 1e-9; elevation += elevInterval) {
        elevationLabels.push({ x: placeX(maxOffset), y: placeY(elevation), text: elevation.toFixed(3) });
      }
    }
    elevationLabels.push({ x: placeX(0), y: placeY(maxElevation), text: 'CL' });
    // Cut/fill shading over the comparison pair when both are CURRENT.
    let cutD = '';
    let fillD = '';
    let area: { cut: number; fill: number; net: number } | null = null;
    const comparison = group.areaComparison;
    if (view.showCutFill === true && comparison != null) {
      const baseResult = memberResults.find((member) => member.surfaceId === comparison.baseSurfaceId)?.result ?? null;
      const compResult = memberResults.find((member) => member.surfaceId === comparison.comparisonSurfaceId)?.result ?? null;
      if (baseResult && compResult) {
        const shading = buildCutFillShading(baseResult, compResult, placeX, placeY);
        cutD = shading.cutD;
        fillD = shading.fillD;
        area = { cut: shading.cut, fill: shading.fill, net: shading.net };
      }
    }
    const display = cadAlignmentRawStationToDisplayStation(alignment, line.rawStation);
    const title = `${alignment.name} — STA ${formatCadStation(display ?? line.rawStation)}`;
    const labels = [...offsetTicks, ...elevationLabels];
    const labelsTruncated = labels.length > maxLabels;
    const boundedTicks = offsetTicks.slice(0, maxLabels);
    const remaining = Math.max(0, maxLabels - boundedTicks.length);
    const boundedElev = elevationLabels.slice(0, remaining);
    const minX = Math.min(placeX(minOffset), placeX(maxOffset));
    const maxX = Math.max(placeX(minOffset), placeX(maxOffset));
    layers.push({
      viewId: view.id,
      viewName: view.name,
      layerId: view.layerId ?? resolveSectionLayerId(project, group.layerId),
      stale: false,
      statusText: 'Current',
      title,
      datumElevation: datum,
      gridD,
      centerlineD,
      tracePaths,
      cutD,
      fillD,
      offsetTicks: boundedTicks,
      elevationLabels: boundedElev,
      legend,
      area,
      labelsTruncated,
      bounds: {
        minX,
        minY: placeY(datum),
        maxX,
        maxY: placeY(maxElevation),
      },
    });
  }
  return layers;
};

// ---------------------------------------------------------------------------
// Inquiry interpolation (linear within one segment; gaps/outside = null)
// ---------------------------------------------------------------------------

export const interpolateSectionElevation = (
  result: CadSurfaceSectionResult,
  offset: number,
): { elevation: number; x: number | null; y: number | null } | null => {
  const point = traceElevationAt(result, offset);
  if (point == null) return null;
  // E/N accompany the interpolation when the extractor stored world XY.
  for (const segment of result.segments) {
    const samples = segment.samples;
    for (let index = 0; index + 1 < samples.length; index += 1) {
      const a = samples[index]!;
      const b = samples[index + 1]!;
      if (offset >= a.offset - 1e-9 && offset <= b.offset + 1e-9 && b.offset > a.offset + 1e-9) {
        const ratio = (offset - a.offset) / (b.offset - a.offset);
        const x = a.x != null && b.x != null ? a.x + (b.x - a.x) * ratio : null;
        const y = a.y != null && b.y != null ? a.y + (b.y - a.y) * ratio : null;
        return { elevation: point, x, y };
      }
    }
  }
  return { elevation: point, x: null, y: null };
};
