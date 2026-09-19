import type {
  CadLayerId,
  CadProfileStyle,
  CadProfileView,
  CadProject,
  CadSurfaceProfile,
} from './cadTypes';

/**
 * Phase 18J persistence helpers (engine-owned profile model in cadTypes.ts;
 * this file owns only the persistence/transaction contract).
 *
 * Definitions persist in .wncad and are undoable. Extracted samples NEVER
 * persist — they live only in a scoped profile cache. Revision is
 * content-derived (cadProfileRevision); status is derived (cadProfileStatus).
 */

export const cloneCadSurfaceProfile = (profile: CadSurfaceProfile): CadSurfaceProfile => ({
  ...profile,
});

export const cloneCadSurfaceProfiles = (
  profiles: CadSurfaceProfile[] | undefined,
): CadSurfaceProfile[] => (profiles ?? []).map(cloneCadSurfaceProfile);

export const cloneCadProfileView = (view: CadProfileView): CadProfileView => ({
  ...view,
  profileIds: [...view.profileIds],
});

export const cloneCadProfileViews = (views: CadProfileView[] | undefined): CadProfileView[] =>
  (views ?? []).map(cloneCadProfileView);

export const cloneCadProfileStyles = (styles: CadProfileStyle[]): CadProfileStyle[] =>
  styles.map((style) => ({ ...style }));

/** Load-time backfill: legacy drawings (fields absent) open with no profiles/views. */
export const backfillSurfaceProfiles = (
  profiles: CadSurfaceProfile[] | undefined,
): CadSurfaceProfile[] => cloneCadSurfaceProfiles(profiles);

export const backfillProfileViews = (views: CadProfileView[] | undefined): CadProfileView[] =>
  cloneCadProfileViews(views);

const PROFILE_STYLE_DEFAULT_ID = 'profile-style-standard';

const seedCadProfileStyles = (): CadProfileStyle[] => [
  {
    id: PROFILE_STYLE_DEFAULT_ID,
    name: 'Standard',
    color: '#1f6feb',
    lineweight: 0.5,
    opacity: 0,
    showVertices: false,
  },
];

/** Load-time backfill: legacy drawings get the deterministic seed style. */
export const backfillCadProfileStyles = (
  styles: CadProfileStyle[] | undefined,
): CadProfileStyle[] => (styles == null ? seedCadProfileStyles() : cloneCadProfileStyles(styles));

/**
 * Reopen normalization: samples never persist, so a profile reloads with no
 * cached revision (derived UNBUILT, never false CURRENT) and no diagnostic.
 * The profile definition itself carries no build fields — this is a no-op
 * clone kept so load paths mirror clearSurfaceBuildCacheOnLoad.
 */
export const clearProfileCacheOnLoad = (profile: CadSurfaceProfile): CadSurfaceProfile =>
  cloneCadSurfaceProfile(profile);

/** 18J visibility contract: layer OFF/FROZEN hides display without a rebuild. */
export const isProfileDisplayVisible = (
  project: { layers: Array<{ id: string; visible: boolean; frozen?: boolean }> },
  profile: Pick<CadSurfaceProfile, 'alignmentEntityId'> & { layerId?: CadLayerId },
): boolean => {
  if (profile.layerId == null) return true;
  const layer = project.layers.find((entry) => entry.id === profile.layerId);
  if (!layer) return true;
  return layer.visible && layer.frozen !== true;
};

/** Destructive profile edits are blocked when the bound layer is locked. */
export const isProfileLayerLocked = (
  project: { layers: Array<{ id: string; locked: boolean }> },
  profile: { layerId?: CadLayerId },
): boolean => {
  if (profile.layerId == null) return false;
  return project.layers.find((entry) => entry.id === profile.layerId)?.locked === true;
};

/** Resolve the display/lock layer for a new or moved profile binding. */
export const resolveProfileLayerId = (
  project: Pick<CadProject, 'layers' | 'currentLayerId'>,
  layerId?: CadLayerId,
): CadLayerId => {
  if (layerId != null && project.layers.some((entry) => entry.id === layerId)) return layerId;
  if (
    project.currentLayerId != null &&
    project.layers.some((entry) => entry.id === project.currentLayerId)
  ) {
    return project.currentLayerId;
  }
  return 'general';
};

// ---------------------------------------------------------------------------
// Style CRUD (mirrors cadVolumeSurfaces.ts; never touches geometry)
// ---------------------------------------------------------------------------

export const isCadProfileStyleNameTaken = (
  styles: CadProfileStyle[],
  name: string,
  exceptId?: string,
): boolean =>
  styles.some(
    (style) => style.id !== exceptId && style.name.toLowerCase() === name.trim().toLowerCase(),
  );

const sanitizeProfileStyle = (style: CadProfileStyle): CadProfileStyle | null => {
  if (typeof style.id !== 'string' || style.id.trim() === '') return null;
  if (typeof style.name !== 'string' || style.name.trim() === '') return null;
  if (typeof style.color !== 'string' || style.color.trim() === '') return null;
  if (typeof style.lineweight !== 'number' || !Number.isFinite(style.lineweight)) return null;
  if (style.lineweight < 0) return null;
  if (typeof style.opacity !== 'number' || !Number.isFinite(style.opacity)) return null;
  if (style.opacity < 0 || style.opacity > 1) return null;
  if (style.showVertices !== undefined && typeof style.showVertices !== 'boolean') return null;
  return { ...style, id: style.id, name: style.name.trim() };
};

export const createCadProfileStyle = (
  styles: CadProfileStyle[],
  style: CadProfileStyle,
): CadProfileStyle[] | null => {
  const next = sanitizeProfileStyle(style);
  if (!next || styles.some((entry) => entry.id === next.id)) return null;
  if (isCadProfileStyleNameTaken(styles, next.name)) return null;
  return [...styles, next];
};

export const duplicateCadProfileStyle = (
  styles: CadProfileStyle[],
  styleId: string,
  newId: string,
  name: string,
): CadProfileStyle[] | null => {
  const source = styles.find((entry) => entry.id === styleId);
  if (!source || typeof newId !== 'string' || newId.trim() === '') return null;
  if (styles.some((entry) => entry.id === newId)) return null;
  return createCadProfileStyle(styles, { ...source, id: newId, name });
};

export const renameCadProfileStyle = (
  styles: CadProfileStyle[],
  styleId: string,
  name: string,
): CadProfileStyle[] | null => {
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (!styles.some((entry) => entry.id === styleId)) return null;
  if (isCadProfileStyleNameTaken(styles, name, styleId)) return null;
  return styles.map((entry) => (entry.id === styleId ? { ...entry, name: name.trim() } : entry));
};

export type CadProfileStylePatch = Partial<
  Pick<CadProfileStyle, 'color' | 'lineweight' | 'opacity' | 'showVertices'>
>;

export const updateCadProfileStyle = (
  styles: CadProfileStyle[],
  styleId: string,
  patch: CadProfileStylePatch,
): CadProfileStyle[] | null => {
  if (!styles.some((entry) => entry.id === styleId)) return null;
  if (
    patch.lineweight !== undefined &&
    (typeof patch.lineweight !== 'number' ||
      !Number.isFinite(patch.lineweight) ||
      patch.lineweight < 0)
  ) {
    return null;
  }
  if (
    patch.opacity !== undefined &&
    (typeof patch.opacity !== 'number' || patch.opacity < 0 || patch.opacity > 1)
  ) {
    return null;
  }
  if (patch.color !== undefined && (typeof patch.color !== 'string' || patch.color.trim() === '')) {
    return null;
  }
  if (patch.showVertices !== undefined && typeof patch.showVertices !== 'boolean') return null;
  return styles.map((entry) => {
    if (entry.id !== styleId) return entry;
    const next: CadProfileStyle = { ...entry };
    if (patch.color !== undefined) next.color = patch.color;
    if (patch.lineweight !== undefined) next.lineweight = patch.lineweight;
    if (patch.opacity !== undefined) next.opacity = patch.opacity;
    if (patch.showVertices !== undefined) {
      if (patch.showVertices) next.showVertices = true;
      else delete next.showVertices;
    }
    return next;
  });
};

/**
 * Delete with refcount guard: blocked while a profile or view references the
 * style unless a valid replacementId rewires those refs. Never deletes the
 * last remaining style. Returns the next tables or null.
 */
export const deleteCadProfileStyle = (
  styles: CadProfileStyle[],
  profiles: CadSurfaceProfile[],
  views: CadProfileView[],
  styleId: string,
  replacementId?: string,
): { styles: CadProfileStyle[]; profiles: CadSurfaceProfile[]; views: CadProfileView[] } | null => {
  if (!styles.some((entry) => entry.id === styleId) || styles.length <= 1) return null;
  const referenced =
    profiles.some((profile) => profile.styleId === styleId) ||
    views.some((view) => view.styleId === styleId);
  if (referenced && replacementId == null) return null;
  if (replacementId !== undefined) {
    if (replacementId === styleId || !styles.some((entry) => entry.id === replacementId)) {
      return null;
    }
  }
  return {
    styles: styles.filter((entry) => entry.id !== styleId),
    profiles:
      replacementId != null
        ? profiles.map((profile) =>
            profile.styleId === styleId ? { ...profile, styleId: replacementId } : profile,
          )
        : profiles,
    views:
      replacementId != null
        ? views.map((view) =>
            view.styleId === styleId ? { ...view, styleId: replacementId } : view,
          )
        : views,
  };
};
