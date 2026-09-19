import { cadAlignmentLength } from './cadAlignment';
import { getAlignmentStartStation, formatCadStation } from './cadAlignmentStationing';
import { computeCadSurfaceSourceRevision } from './cadSurfaces';
import { backfillCadProfileStyles, resolveProfileLayerId } from './cadProfileTypes';
import { computeSurfaceProfileRevision } from './cadProfileRevision';
import type { CadProfileCache } from './profileCache';
import type { CadProfileView, CadProject } from './cadTypes';

/**
 * Phase 18J UI — profile-view display adapter (UI-owned, pure).
 *
 * Aggregated SVG paths per view (grid + one path per profile segment set +
 * equation markers + bounded labels), placed in model space via insertion +
 * horizontalScale + verticalExaggeration + datum. CURRENT-only display:
 * profiles whose cached result revision is stale never render.
 */

export interface CadProfileViewEquationMarker {
  rawChainage: number;
  x: number;
  backLabel: string;
  aheadLabel: string;
}

export interface CadProfileViewLabel {
  x: number;
  y: number;
  text: string;
}

export interface CadProfileViewDisplayLayer {
  viewId: string;
  viewName: string;
  layerId: string;
  stale: boolean;
  statusText: string;
  datumElevation: number;
  gridD: string;
  profilePaths: Array<{ profileId: string; d: string }>;
  equationMarkers: CadProfileViewEquationMarker[];
  labels: CadProfileViewLabel[];
  labelsTruncated: boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export interface ProfileViewDisplayOptions {
  maxLabels?: number;
}

const MAX_LABELS_DEFAULT = 200;

export const resolveProfileViewDatum = (
  view: Pick<CadProfileView, 'datumMode' | 'datumElevation' | 'datumStep'>,
  minElevation: number,
): number => {
  if (view.datumMode === 'explicit' && view.datumElevation != null) return view.datumElevation;
  const step = view.datumStep ?? 1;
  const safe = step > 0 ? step : 1;
  return Math.floor(minElevation / safe) * safe;
};

export const buildProfileViewDisplayLayers = (
  project: CadProject,
  profileCache: CadProfileCache | null,
  options?: ProfileViewDisplayOptions,
): CadProfileViewDisplayLayer[] => {
  // Restriction (deliberate): CadProfileView carries no layerId — every
  // view resolves via resolveProfileLayerId (current layer) at build time.
  // Per-view layer binding is deferred; see resolveProfileLayerId.
  if (!profileCache) return [];
  const maxLabels = options?.maxLabels ?? MAX_LABELS_DEFAULT;
  const styles = backfillCadProfileStyles(project.profileStyles);
  void styles;
  const alignments = new Map(
    project.entities.filter((entity) => entity.type === 'alignment').map((entity) => [entity.id, entity]),
  );
  const surfaces = new Map((project.surfaces ?? []).map((entry) => [entry.id, entry]));
  const profiles = new Map((project.surfaceProfiles ?? []).map((entry) => [entry.id, entry]));
  const layers: CadProfileViewDisplayLayer[] = [];
  for (const view of project.profileViews ?? []) {
    const alignment = alignments.get(view.alignmentEntityId);
    if (!alignment || alignment.type !== 'alignment') continue;
    const startStation = getAlignmentStartStation(alignment);
    const totalLength = cadAlignmentLength(alignment);
    const rawEnd = startStation + totalLength;
    const horizontalScale = view.horizontalScale > 0 ? view.horizontalScale : 1;
    const verticalExaggeration = view.verticalExaggeration > 0 ? view.verticalExaggeration : 1;
    // Collect CURRENT cached results for member profiles.
    const memberResults: Array<{ profileId: string; result: NonNullable<ReturnType<CadProfileCache['get']>> }> = [];
    for (const profileId of view.profileIds) {
      const profile = profiles.get(profileId);
      const surface = profile ? surfaces.get(profile.surfaceId) : undefined;
      if (!profile || !surface) continue;
      const surfaceRev = computeCadSurfaceSourceRevision(project, surface);
      const revision = computeSurfaceProfileRevision(profile, alignment, surfaceRev);
      const result = profileCache.get(profile.id, revision);
      if (result) memberResults.push({ profileId: profile.id, result });
    }
    if (memberResults.length === 0) continue;
    let minElevation = Infinity;
    let maxElevation = -Infinity;
    for (const member of memberResults) {
      if (member.result.minElevation != null) minElevation = Math.min(minElevation, member.result.minElevation);
      if (member.result.maxElevation != null) maxElevation = Math.max(maxElevation, member.result.maxElevation);
    }
    if (!Number.isFinite(minElevation) || !Number.isFinite(maxElevation)) continue;
    const datum = resolveProfileViewDatum(view, minElevation);
    const placeX = (raw: number): number => view.insertionX + (raw - startStation) * horizontalScale;
    const placeY = (elevation: number): number =>
      view.insertionY + (elevation - datum) * verticalExaggeration;
    const profilePaths = memberResults.map((member) => {
      let d = '';
      for (const segment of member.result.segments) {
        segment.samples.forEach((sample, index) => {
          d += `${index === 0 ? 'M' : 'L'}${placeX(sample.rawChainage)} ${placeY(sample.elevation)}`;
        });
      }
      return { profileId: member.profileId, d };
    });
    // Grid: verticals at station intervals, horizontals at elevation steps.
    const majorInterval = view.majorStationInterval ?? 100;
    const minorInterval = view.minorStationInterval ?? 20;
    const elevInterval = view.elevationGridInterval ?? view.datumStep ?? 1;
    let gridD = '';
    if (minorInterval > 0) {
      const first = Math.ceil(startStation / minorInterval) * minorInterval;
      for (let raw = first; raw <= rawEnd + 1e-9; raw += minorInterval) {
        gridD += `M${placeX(raw)} ${placeY(datum)}L${placeX(raw)} ${placeY(maxElevation)}`;
      }
    }
    if (elevInterval > 0) {
      const first = Math.ceil(datum / elevInterval) * elevInterval;
      for (let elevation = first; elevation <= maxElevation + 1e-9; elevation += elevInterval) {
        gridD += `M${placeX(startStation)} ${placeY(elevation)}L${placeX(rawEnd)} ${placeY(elevation)}`;
      }
    }
    const equationMarkers: CadProfileViewEquationMarker[] = [];
    for (const equation of alignment.stationEquations ?? []) {
      const raw = equation.rawStation ?? equation.backStation;
      if (raw < startStation - 1e-9 || raw > rawEnd + 1e-9) continue;
      equationMarkers.push({
        rawChainage: raw,
        x: placeX(raw),
        backLabel: `BK ${formatCadStation(equation.backStation)}`,
        aheadLabel: `AH ${formatCadStation(equation.aheadStation)}`,
      });
    }
    const labels: CadProfileViewLabel[] = [];
    if (majorInterval > 0) {
      const first = Math.ceil(startStation / majorInterval) * majorInterval;
      for (let raw = first; raw <= rawEnd + 1e-9; raw += majorInterval) {
        labels.push({ x: placeX(raw), y: placeY(datum), text: formatCadStation(raw) });
      }
    }
    for (const marker of equationMarkers) {
      labels.push({ x: marker.x, y: placeY(datum), text: marker.backLabel });
      labels.push({ x: marker.x, y: placeY(datum), text: marker.aheadLabel });
    }
    const labelsTruncated = labels.length > maxLabels;
    const boundedLabels = labels.slice(0, maxLabels);
    const minX = placeX(startStation);
    const maxX = placeX(rawEnd);
    layers.push({
      viewId: view.id,
      viewName: view.name,
      layerId: resolveProfileLayerId(project),
      stale: false,
      statusText: 'Current',
      datumElevation: datum,
      gridD,
      profilePaths,
      equationMarkers,
      labels: boundedLabels,
      labelsTruncated,
      bounds: {
        minX: Math.min(minX, maxX),
        minY: placeY(datum),
        maxY: placeY(maxElevation),
        maxX: Math.max(minX, maxX),
      },
    });
  }
  return layers;
};
