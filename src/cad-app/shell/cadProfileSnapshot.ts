import type { CadProfileCache } from '../../engine/cad/profileCache';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import { computeCadSurfaceSourceRevision } from '../../engine/cad/cadSurfaces';
import { surfaceContentRevision } from '../../engine/cad/cadSurfaceView';
import { backfillCadProfileStyles, resolveProfileLayerId } from '../../engine/cad/cadProfileTypes';
import { computeSurfaceProfileRevision } from '../../engine/cad/cadProfileRevision';
import { formatCadStation } from '../../engine/cad/cadAlignmentStationing';
import { resolveProfileViewDatum } from '../../engine/cad/cadProfileView';
import { profileStats, type ProfileStats } from '../../engine/cad/profiles/profileStats';
import type {
  CadProfileView,
  CadProject,
  CadStationEquation,
  CadSurfaceProfile,
  SurfaceProfileStatus,
} from '../../engine/cad/cadTypes';

/**
 * Phase 18J UI — profile snapshot for Toolspace/manager/Properties.
 *
 * Pure derivation over the drawing + session caches once per publish.
 * Samples/revisions/statuses never persist; every mutation travels a real
 * undoable PROFILE_* CadCommand through the existing runSurveyCommand path.
 */

/**
 * UI-owned command keys. Both sides share one literal so drift is caught
 * by a compile/test, never by memory. Every key exists in the CadCommand
 * union; Apply dispatches a real undoable transaction.
 */
export const CAD_PROFILE_COMMANDS = {
  create: 'PROFILE_CREATE',
  delete: 'PROFILE_DELETE',
  viewCreate: 'PROFILE_VIEW_CREATE',
  viewDelete: 'PROFILE_VIEW_DELETE',
  viewUpdate: 'PROFILE_VIEW_UPDATE',
  styleCreate: 'PROFILE_STYLE_CREATE',
  styleRename: 'PROFILE_STYLE_RENAME',
  styleDuplicate: 'PROFILE_STYLE_DUPLICATE',
  styleDelete: 'PROFILE_STYLE_DELETE',
  styleUpdate: 'PROFILE_STYLE_UPDATE',
} as const;

export type ProfileStatusText =
  | 'Current'
  | 'Needs Rebuild'
  | 'Building'
  | 'Failed'
  | 'Broken Reference'
  | 'Source Not Current'
  | 'Unbuilt'
  | 'No Overlap';

export const profileStatusText = (status: SurfaceProfileStatus): ProfileStatusText => {
  switch (status) {
    case 'CURRENT': return 'Current';
    case 'NEEDS_REBUILD': return 'Needs Rebuild';
    case 'BUILDING': return 'Building';
    case 'FAILED': return 'Failed';
    case 'BROKEN_REFERENCE': return 'Broken Reference';
    case 'SOURCE_NOT_CURRENT': return 'Source Not Current';
    case 'UNBUILT': return 'Unbuilt';
    case 'NO_OVERLAP': return 'No Overlap';
  }
};

export interface CadProfileStatsSummary extends ProfileStats {
  stale: boolean;
}

export interface CadProfileRow {
  id: string;
  name: string;
  alignmentEntityId: string;
  alignmentName: string;
  surfaceId: string;
  surfaceName: string;
  layerId: string;
  layerName: string;
  status: SurfaceProfileStatus;
  statusText: ProfileStatusText;
  stale: boolean;
  revision: string;
  diagnostic: string | null;
  stats: CadProfileStatsSummary | null;
  /** True when the bound alignment + surface both resolve. */
  resolvable: boolean;
  /** True when the source surface mesh is CURRENT (rebuild gate). */
  rebuildable: boolean;
}

export interface CadProfileViewRow {
  id: string;
  name: string;
  alignmentEntityId: string;
  alignmentName: string;
  profileIds: string[];
  profileNames: string[];
  /** Null when the view is valid; otherwise the honest rejection reason. */
  validationError: string | null;
  horizontalScale: number;
  verticalExaggeration: number;
  datumMode: 'auto' | 'explicit';
  datumElevation: number | null;
  datumStep: number;
  majorStationInterval: number;
  minorStationInterval: number;
  elevationGridInterval: number;
  styleId: string | null;
  styleName: string;
  layerId: string;
}

export interface CadProfileStyleSummary {
  id: string;
  name: string;
  color: string;
  lineweight: number;
  opacity: number;
  showVertices: boolean;
}

export interface CadProfileSnapshot {
  profiles: CadProfileRow[];
  views: CadProfileViewRow[];
  /** All drawing alignments (create-form options; never derived in the shell). */
  alignments: Array<{ id: string; name: string }>;
  selectedProfileId: string | null;
  selectedViewId: string | null;
  styles: CadProfileStyleSummary[];
}

// ---------------------------------------------------------------------------
// Pure display helpers (tested directly)
// ---------------------------------------------------------------------------

/**
 * Scale/exaggeration math: drawing-space placement of one raw chainage +
 * one elevation. Non-positive scales clamp to 1 (never NaN/degenerate).
 */
export const profileViewPlacement = (
  view: Pick<
    CadProfileView,
    'insertionX' | 'insertionY' | 'horizontalScale' | 'verticalExaggeration'
  >,
  startStation: number,
  datum: number,
): { scaleX: number; scaleY: number; placeX: (_raw: number) => number; placeY: (_elev: number) => number } => {
  const scaleX = view.horizontalScale > 0 ? view.horizontalScale : 1;
  const scaleY = view.verticalExaggeration > 0 ? view.verticalExaggeration : 1;
  return {
    scaleX,
    scaleY,
    placeX: (raw) => view.insertionX + (raw - startStation) * scaleX,
    placeY: (elevation) => view.insertionY + (elevation - datum) * scaleY,
  };
};

/** Datum: auto floors to datumStep, explicit uses the override verbatim. */
export const resolveProfileDatum = (
  view: Pick<CadProfileView, 'datumMode' | 'datumElevation' | 'datumStep'>,
  minElevation: number,
): number => resolveProfileViewDatum(view, minElevation);

/** Equation marker labels through the ONE station formatter. */
export const formatProfileEquationMarker = (
  equation: CadStationEquation,
): { backLabel: string; aheadLabel: string } => ({
  backLabel: `BK ${formatCadStation(equation.backStation)}`,
  aheadLabel: `AH ${formatCadStation(equation.aheadStation)}`,
});

/**
 * View-model validation. Rejects a view whose member profiles do not all
 * belong to its own alignment (mixed-alignment views break the shared
 * station axis). Returns null when valid.
 */
export const validateProfileView = (
  project: CadProject,
  view: CadProfileView,
): string | null => {
  const alignment = project.entities.find((entity) => entity.id === view.alignmentEntityId);
  if (!alignment || alignment.type !== 'alignment') return 'alignment missing';
  if (view.profileIds.length === 0) return 'no profiles attached';
  const profiles = new Map((project.surfaceProfiles ?? []).map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  for (const profileId of view.profileIds) {
    if (seen.has(profileId)) return `duplicate profile ${profileId}`;
    seen.add(profileId);
    const profile = profiles.get(profileId);
    if (!profile) return `profile ${profileId} missing`;
    if (profile.alignmentEntityId !== view.alignmentEntityId) {
      return `profile “${profile.name}” is on a different alignment`;
    }
  }
  if (!(view.horizontalScale > 0)) return 'horizontal scale must be > 0';
  if (!(view.verticalExaggeration > 0)) return 'vertical exaggeration must be > 0';
  if (view.datumMode === 'explicit' && view.datumElevation == null) {
    return 'explicit datum requires an elevation';
  }
  return null;
};

const alignmentNameOf = (project: CadProject, alignmentEntityId: string): string => {
  const alignment = project.entities.find((entity) => entity.id === alignmentEntityId);
  return alignment && alignment.type === 'alignment' ? alignment.name : alignmentEntityId;
};

const surfaceNameOf = (project: CadProject, surfaceId: string): string =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId)?.name ?? surfaceId;

const deriveProfileRow = (
  project: CadProject,
  surfaceCache: CadSurfaceCache | null,
  profileCache: CadProfileCache | null,
  profile: CadSurfaceProfile,
  layers: Map<string, { id: string; name: string }>,
): CadProfileRow => {
  const alignment = project.entities.find((entity) => entity.id === profile.alignmentEntityId);
  const surface = (project.surfaces ?? []).find((entry) => entry.id === profile.surfaceId);
  const layerId = resolveProfileLayerId(project);
  const layer = layers.get(layerId);
  const base: CadProfileRow = {
    id: profile.id,
    name: profile.name,
    alignmentEntityId: profile.alignmentEntityId,
    alignmentName: alignmentNameOf(project, profile.alignmentEntityId),
    surfaceId: profile.surfaceId,
    surfaceName: surfaceNameOf(project, profile.surfaceId),
    layerId,
    layerName: layer?.name ?? layerId,
    status: 'BROKEN_REFERENCE',
    statusText: 'Broken Reference',
    stale: false,
    revision: '',
    diagnostic: null,
    stats: null,
    resolvable: false,
    rebuildable: false,
  };
  if (!alignment || alignment.type !== 'alignment' || !surface) return base;
  const surfaceRevision = computeCadSurfaceSourceRevision(project, surface);
  const surfaceCurrent = surfaceCache?.get(surface.id, surfaceContentRevision(project, surface)) != null;
  const revision = computeSurfaceProfileRevision(profile, alignment, surfaceRevision);
  const fresh = profileCache?.get(profile.id, revision) ?? null;
  base.resolvable = true;
  base.revision = revision;
  base.rebuildable = surfaceCurrent;
  if (!surfaceCurrent) {
    base.status = 'SOURCE_NOT_CURRENT';
    const retained = profileCache?.retained(profile.id) ?? [];
    base.stale = retained.length > 0;
    if (retained.length > 0) base.stats = { ...profileStats(retained[retained.length - 1]!), stale: true };
  } else if (fresh) {
    base.status = fresh.coveredLength > 0 ? 'CURRENT' : 'NO_OVERLAP';
    base.stats = { ...profileStats(fresh), stale: false };
  } else {
    base.status = 'UNBUILT';
  }
  base.statusText = profileStatusText(base.status);
  return base;
};

export const buildCadProfileSnapshot = (
  project: CadProject,
  surfaceCache: CadSurfaceCache | null,
  profileCache: CadProfileCache | null,
  selectedProfileId: string | null,
  selectedViewId: string | null,
  options?: {
    buildingProfileIds?: ReadonlySet<string>;
    /** Session failure diagnostics by profile id (revision-matched only). */
    sessionDiagnostics?: ReadonlyMap<string, { revision: string; error: string }>;
  },
): CadProfileSnapshot => {
  const layers = new Map(project.layers.map((layer) => [layer.id, { id: layer.id, name: layer.name }]));
  const styles = backfillCadProfileStyles(project.profileStyles);
  const styleNames = new Map(styles.map((style) => [style.id, style.name]));
  const profiles: CadProfileRow[] = (project.surfaceProfiles ?? []).map((profile) => {
    const row = deriveProfileRow(
      project,
      surfaceCache,
      profileCache,
      profile,
      layers,
    );
    if (options?.buildingProfileIds?.has(profile.id)) {
      row.status = 'BUILDING';
      row.statusText = 'Building';
    } else {
      const failure = options?.sessionDiagnostics?.get(profile.id);
      if (failure && failure.revision === row.revision) {
        row.status = 'FAILED';
        row.statusText = 'Failed';
        row.diagnostic = failure.error;
      }
    }
    return row;
  });
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const views: CadProfileViewRow[] = (project.profileViews ?? []).map((view) => {
    const validationError = validateProfileView(project, view);
    return {
      id: view.id,
      name: view.name,
      alignmentEntityId: view.alignmentEntityId,
      alignmentName: alignmentNameOf(project, view.alignmentEntityId),
      profileIds: [...view.profileIds],
      profileNames: view.profileIds.map((id) => profileById.get(id)?.name ?? id),
      validationError,
      horizontalScale: view.horizontalScale > 0 ? view.horizontalScale : 1,
      verticalExaggeration: view.verticalExaggeration > 0 ? view.verticalExaggeration : 1,
      datumMode: view.datumMode,
      datumElevation: view.datumElevation ?? null,
      datumStep: view.datumStep ?? 1,
      majorStationInterval: view.majorStationInterval ?? 100,
      minorStationInterval: view.minorStationInterval ?? 20,
      elevationGridInterval: view.elevationGridInterval ?? view.datumStep ?? 1,
      styleId: view.styleId ?? null,
      styleName: (view.styleId != null ? styleNames.get(view.styleId) : undefined) ?? 'Standard',
      layerId: resolveProfileLayerId(project),
    };
  });
  return {
    profiles,
    views,
    alignments: project.entities
      .filter((entity) => entity.type === 'alignment')
      .map((entity) => ({ id: entity.id, name: entity.name })),
    selectedProfileId:
      selectedProfileId != null && profileById.has(selectedProfileId) ? selectedProfileId : null,
    selectedViewId:
      selectedViewId != null && views.some((entry) => entry.id === selectedViewId)
        ? selectedViewId
        : null,
    styles: styles.map((style) => ({
      id: style.id,
      name: style.name,
      color: style.color,
      lineweight: style.lineweight,
      opacity: style.opacity,
      showVertices: style.showVertices === true,
    })),
  };
};

// ---------------------------------------------------------------------------
// Inquiry answer formatting (raw chainage in, display station + elevation out)
// ---------------------------------------------------------------------------

export const formatProfileElevationAnswer = (
  profileName: string,
  alignmentName: string,
  displayedStation: string,
  rawChainage: number,
  point: { x: number; y: number; elevation: number } | null,
  aligned: boolean,
): string => {
  if (!aligned) {
    return `“${profileName}” has no current extraction — rebuild it before querying elevation.`;
  }
  if (point == null) {
    return `No surface profile elevation at station ${displayedStation} on “${profileName}”.`;
  }
  return (
    `“${profileName}” (${alignmentName}) station ${displayedStation} (raw ${rawChainage.toFixed(3)}) ` +
    `E ${point.x.toFixed(3)} N ${point.y.toFixed(3)} elevation ${point.elevation.toFixed(3)}.`
  );
};
