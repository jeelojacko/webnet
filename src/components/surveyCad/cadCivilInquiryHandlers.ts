/**
 * STRUCT-194.6 — pure CAD civil inquiry helpers (analysis / volume / section /
 * profile).
 *
 * Extracted verbatim from the four `SurveyCadWorkspace` closures with no
 * behavior change. Every helper reads ONLY the explicit project / cache /
 * snapshot passed to the factory; there is no memo, no singleton, no module
 * state, and no invented CURRENT gate. The root calls the factory once per
 * render (a plain function call, never a hook) so the returned closures always
 * read the live project, TIN cache, section cache, and analysis snapshot.
 *
 * Preserved exactly:
 *   - `queryAnalysisAt` first-match `.find` on the map + snapshot row, the
 *     outside-domain message, the `UNCLASSIFIED (no band covers this value)`
 *     band text, and the elevation / signed-depth / slope formatting;
 *   - `queryVolumeDifference` + `formatVolumeDifferenceAnswer` with the
 *     `volume?.name ?? volumeId` fallback;
 *   - section group / line / surface / alignment gate, displayed-station
 *     conversion, signed offset, and the honest gap/outside wording;
 *   - profile CURRENT-TIN gate, station-equation ambiguity, snapped raw
 *     chainage, and name/coords answer.
 */
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { CadSectionCache } from '../../engine/cad/sectionCache';
import type { CadAnalysisSnapshot } from '../../cad-app/shell/cadAnalysisSnapshot';
import { queryAnalysisAt } from '../../cad-app/shell/cadAnalysisAdapters';
import {
  formatVolumeDifferenceAnswer,
  queryVolumeDifference,
} from '../../cad-app/shell/cadVolumeSnapshot';
import {
  formatSectionElevationAnswer,
  querySectionElevationAtOffset,
} from '../../cad-app/shell/cadSectionSnapshot';
import { formatProfileElevationAnswer } from '../../cad-app/shell/cadProfileSnapshot';
import { resolveProfileStationInput, queryProfileElevationAt } from '../../engine/cad/profiles/profileInquiry';
import { cadAlignmentRawStationToDisplayStation, formatCadStation } from '../../engine/cad/cadAlignmentStationing';
import { surfaceContentRevision } from '../../engine/cad/cadSurfaceView';

export interface CadCivilInquiryContext {
  /** Live history project (never a derived value). */
  project: CadProject;
  /** Session TIN cache (both inquiry sources must be CURRENT). */
  surfaceCache: CadSurfaceCache;
  /** Session section cache; null = no section result available. */
  sectionCache: CadSectionCache | null;
  /** Current analysis snapshot (rows carry name / typeLabel / metricUnit). */
  analysisSnapshot: CadAnalysisSnapshot;
}

export interface CadCivilInquiryHandlers {
  describeAnalysisAt: (_analysisId: string, _x: number, _y: number) => string | null;
  describeVolumeDifference: (_volumeId: string, _x: number, _y: number) => string | null;
  describeSectionElevation: (
    _groupId: string,
    _lineId: string,
    _surfaceId: string,
    _offset: number,
  ) => string;
  describeProfileElevation: (_profileId: string, _displayStation: number) => string;
}

/** Build the four inquiry closures over the explicit render context. */
export const createCadCivilInquiryHandlers = (
  context: CadCivilInquiryContext,
): CadCivilInquiryHandlers => {
  const { project, surfaceCache, sectionCache, analysisSnapshot } = context;

  // Phase 18U — analysis inquiry text (direct source geometry; pure read).
  const describeAnalysisAt = (analysisId: string, x: number, y: number): string | null => {
    const map = (project.analysisMaps ?? []).find((entry) => entry.id === analysisId);
    const row = analysisSnapshot.analyses.find((entry) => entry.id === analysisId) ?? null;
    if (!map || !row) return null;
    const inquiry = queryAnalysisAt(project, surfaceCache, map, x, y);
    if (inquiry == null) {
      return `“${row.name}” has no ${row.typeLabel} at (${x.toFixed(3)}, ${y.toFixed(3)}) — outside the source domain.`;
    }
    const bandText = inquiry.band ? inquiry.band.label : 'UNCLASSIFIED (no band covers this value)';
    const valueText =
      inquiry.metric === 'elevation'
        ? `elevation ${inquiry.elevation.toFixed(3)} ${row.metricUnit}`
        : inquiry.metric === 'signed-depth'
          ? `Δ ${inquiry.delta.toFixed(3)} ${row.metricUnit} ${inquiry.side}`
          : `slope ${inquiry.percent.toFixed(2)}% (${inquiry.degrees.toFixed(2)}°)`;
    return `“${row.name}” E ${x.toFixed(3)} N ${y.toFixed(3)} ${valueText} — band ${bandText}.`;
  };

  // Phase 18I — difference inquiry text (live source inquiry; pure read).
  const describeVolumeDifference = (volumeId: string, x: number, y: number): string | null => {
    const volume = project.volumeSurfaces?.find((entry) => entry.id === volumeId);
    const name = volume?.name ?? volumeId;
    const result = queryVolumeDifference(project, surfaceCache, volumeId, x, y);
    return formatVolumeDifferenceAnswer(result, name, x, y);
  };

  // Phase 18K — Section Elevation at Offset (live interpolation inquiry).
  // Signed offset (+left/−right) resolves to the displayed station +
  // E/N + interpolated elevation; gaps and outside-coverage answer
  // honestly (never guessed). Null group/line/surface/result = block.
  const describeSectionElevation = (
    groupId: string,
    lineId: string,
    surfaceId: string,
    offset: number,
  ): string => {
    const group = (project.sampleLineGroups ?? []).find((entry) => entry.id === groupId);
    const line = group?.sampleLines.find((entry) => entry.id === lineId) ?? null;
    const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
    const alignment = project.entities.find((entry) => entry.id === group?.alignmentEntityId);
    const viewName = line?.manualName ?? group?.name ?? lineId;
    if (!group || !line || !surface || !alignment || alignment.type !== 'alignment') {
      return formatSectionElevationAnswer(viewName, '—', offset, null, false);
    }
    const displayed = formatCadStation(
      cadAlignmentRawStationToDisplayStation(alignment, line.rawStation) ?? line.rawStation,
    );
    const hit = querySectionElevationAtOffset(
      project,
      sectionCache,
      groupId,
      lineId,
      surfaceId,
      offset,
    );
    if (!hit) {
      return formatSectionElevationAnswer(viewName, displayed, offset, null, true);
    }
    return formatSectionElevationAnswer(viewName, displayed, offset, hit, true);
  };

  // Phase 18J — Profile Elevation at Station (live interpolation inquiry).
  // Display station resolves to raw chainage through the shared stationing
  // semantics; an ambiguous equation gap or unstationed input is surfaced
  // honestly (never guessed). Null alignment/surface/mesh = honest block.
  const describeProfileElevation = (profileId: string, displayStation: number): string => {
    const profile = (project.surfaceProfiles ?? []).find((entry) => entry.id === profileId);
    if (!profile) return 'Profile not found.';
    const alignment = project.entities.find((entry) => entry.id === profile.alignmentEntityId);
    const surface = (project.surfaces ?? []).find((entry) => entry.id === profile.surfaceId);
    if (!alignment || alignment.type !== 'alignment' || !surface) {
      return formatProfileElevationAnswer(profile.name, profile.alignmentEntityId, '—', NaN, null, false);
    }
    const displayed = formatCadStation(displayStation);
    const mesh = surfaceCache.get(surface.id, surfaceContentRevision(project, surface));
    if (!mesh) {
      return formatProfileElevationAnswer(profile.name, alignment.name, displayed, NaN, null, false);
    }
    const raw = resolveProfileStationInput(
      { elements: alignment.elements, startStation: alignment.startStation, stationEquations: alignment.stationEquations },
      displayStation,
    );
    if (raw == null) {
      return `Station ${displayed} is ambiguous inside a station equation (or unstationed) on “${profile.name}” — no guess.`;
    }
    const answer = queryProfileElevationAt(
      {
        alignmentElements: alignment.elements,
        startStation: alignment.startStation,
        stationEquations: alignment.stationEquations,
        mesh: { points: mesh.points, triangles: mesh.triangles, grid: mesh.grid, adjacency: mesh.adjacency, edgeKinds: mesh.edgeKinds },
      },
      raw,
    );
    if ('gap' in answer) {
      return `No surface profile elevation at station ${displayed} on “${profile.name}”.`;
    }
    return formatProfileElevationAnswer(profile.name, alignment.name, displayed, raw, answer, true);
  };

  return {
    describeAnalysisAt,
    describeVolumeDifference,
    describeSectionElevation,
    describeProfileElevation,
  };
};
