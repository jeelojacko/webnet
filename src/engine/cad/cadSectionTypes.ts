import type {
  CadAlignmentElement,
  CadAlignmentEntity,
  CadLayerId,
  CadProject,
  CadSampleLine,
  CadSampleLineGroup,
  CadSectionStyle,
  CadSectionSurfaceSource,
  CadSectionView,
  CadStationEquation,
} from './cadTypes';
import type { CadSurfaceGrid } from './cadSurfaces';
import {
  cadAlignmentDisplayStationToRawStation,
  cadAlignmentRawStationToDisplayStation,
  formatCadStation,
} from './cadAlignmentStationing';

/**
 * Phase 18K sample-line / cross-section persistence contract (the schema
 * interfaces live in cadTypes.ts, mirroring the 18J profile split).
 *
 * Definitions persist in .wncad and are undoable. Extracted sections NEVER
 * persist — they live only in a scoped section cache. Revision is
 * content-derived (cadSectionRevision); status is derived (cadSectionStatus).
 *
 * Engine seam: the section geometry extractor is owned by the engine slice
 * (src/engine/cad/sections/, not this file). Until it lands, the result
 * shape it must produce is declared here (CadSurfaceSectionResult) and the
 * worker handler consumes it through an injected extractor.
 */

export const SECTION_STYLE_EXISTING_ID = 'section-style-existing';
export const SECTION_STYLE_PROPOSED_ID = 'section-style-proposed';
export const SECTION_STYLE_SECONDARY_ID = 'section-style-secondary';
export const SECTION_STYLE_NONE_ID = 'section-style-none';

export const cloneCadSampleLine = (line: CadSampleLine): CadSampleLine => ({ ...line });

const cloneCadSectionSource = (source: CadSectionSurfaceSource): CadSectionSurfaceSource => ({
  ...source,
});

export const cloneCadSampleLineGroup = (group: CadSampleLineGroup): CadSampleLineGroup => ({
  ...group,
  surfaceSources: group.surfaceSources.map(cloneCadSectionSource),
  sampleLines: group.sampleLines.map(cloneCadSampleLine),
  ...(group.areaComparison != null ? { areaComparison: { ...group.areaComparison } } : {}),
});

export const cloneCadSampleLineGroups = (
  groups: CadSampleLineGroup[] | undefined,
): CadSampleLineGroup[] => (groups ?? []).map(cloneCadSampleLineGroup);

export const cloneCadSectionStyles = (styles: CadSectionStyle[]): CadSectionStyle[] =>
  styles.map((style) => ({ ...style }));

const cloneCadSectionView = (view: CadSectionView): CadSectionView => ({
  ...view,
  sourceSurfaceIds: [...view.sourceSurfaceIds],
});

export const cloneCadSectionViews = (views: CadSectionView[] | undefined): CadSectionView[] =>
  (views ?? []).map(cloneCadSectionView);

/** Load-time backfill: legacy drawings (fields absent) open with no groups. */
export const backfillCadSampleLineGroups = (
  groups: CadSampleLineGroup[] | undefined,
): CadSampleLineGroup[] => cloneCadSampleLineGroups(groups);

export const backfillCadSectionViews = (views: CadSectionView[] | undefined): CadSectionView[] =>
  cloneCadSectionViews(views);

/** Deterministic seed styles (names are display-only; ids are identity). */
export const seedCadSectionStyles = (): CadSectionStyle[] => [
  { id: SECTION_STYLE_EXISTING_ID, name: 'Existing Ground', color: '#8a8f98', lineweight: 0.5, opacity: 0 },
  { id: SECTION_STYLE_PROPOSED_ID, name: 'Proposed', color: '#1f6feb', lineweight: 0.6, opacity: 0 },
  { id: SECTION_STYLE_SECONDARY_ID, name: 'Secondary', color: '#d29922', lineweight: 0.4, opacity: 0 },
  { id: SECTION_STYLE_NONE_ID, name: 'No Display', color: '#8a8f98', lineweight: 0.25, opacity: 0 },
];

/** Load-time backfill: legacy drawings get the deterministic seed styles. */
export const backfillCadSectionStyles = (
  styles: CadSectionStyle[] | undefined,
): CadSectionStyle[] =>
  styles == null ? seedCadSectionStyles() : cloneCadSectionStyles(styles);

/**
 * Reopen normalization: extracted sections never persist, so a group reloads
 * with no cached revision (derived UNBUILT, never false CURRENT). The group
 * definition carries no build fields — this is a no-op clone kept so load
 * paths mirror clearProfileCacheOnLoad.
 */
export const clearSectionCacheOnLoad = (group: CadSampleLineGroup): CadSampleLineGroup =>
  cloneCadSampleLineGroup(group);

// ---------------------------------------------------------------------------
// Display / lock contract
// ---------------------------------------------------------------------------

/** Section views honour OFF/FROZEN without a rebuild (explicit layerId). */
export const isSectionDisplayVisible = (
  project: { layers: Array<{ id: string; visible: boolean; frozen?: boolean }> },
  view: { layerId?: CadLayerId },
): boolean => {
  if (view.layerId == null) return true;
  const layer = project.layers.find((entry) => entry.id === view.layerId);
  if (!layer) return true;
  return layer.visible && layer.frozen !== true;
};

/** Destructive section edits are blocked when the bound layer is locked. */
export const isSectionLayerLocked = (
  project: { layers: Array<{ id: string; locked: boolean }> },
  target: { layerId?: CadLayerId },
): boolean => {
  if (target.layerId == null) return false;
  return project.layers.find((entry) => entry.id === target.layerId)?.locked === true;
};

/** Resolve the display/lock layer for a new or moved section binding. */
export const resolveSectionLayerId = (
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
// Station label helpers (display text is never identity)
// ---------------------------------------------------------------------------

/** Accepts `major+minor` (`1+234.500`) or plain decimal; null when invalid. */
export const parseCadStationText = (text: string): number | null => {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const match = /^([+-]?\d+)\+(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (match) {
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
    const value = major * 100 + minor;
    return major < 0 ? -value : value;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

/** Display station text/input -> raw chainage (null when inside an equation gap). */
export const resolveSectionRawStation = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | null
    | undefined,
  displayStation: number,
): number | null =>
  alignment == null ? null : cadAlignmentDisplayStationToRawStation(alignment, displayStation);

/** Display label for a raw station (labels only; never identity). */
export const formatSectionStationLabel = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | null
    | undefined,
  rawStation: number,
): string => {
  const display =
    alignment == null ? null : cadAlignmentRawStationToDisplayStation(alignment, rawStation);
  return formatCadStation(display ?? rawStation);
};

// ---------------------------------------------------------------------------
// Group CRUD
// ---------------------------------------------------------------------------

export const isCadSampleLineGroupNameTaken = (
  groups: CadSampleLineGroup[],
  name: string,
  exceptId?: string,
): boolean =>
  groups.some(
    (group) => group.id !== exceptId && group.name.toLowerCase() === name.trim().toLowerCase(),
  );

export const createCadSampleLineGroup = (
  groups: CadSampleLineGroup[],
  group: CadSampleLineGroup,
): CadSampleLineGroup[] | null => {
  if (typeof group.id !== 'string' || group.id.trim() === '') return null;
  if (typeof group.name !== 'string' || group.name.trim() === '') return null;
  if (groups.some((entry) => entry.id === group.id)) return null;
  if (isCadSampleLineGroupNameTaken(groups, group.name)) return null;
  return [...groups, cloneCadSampleLineGroup({ ...group, name: group.name.trim() })];
};

export const renameCadSampleLineGroup = (
  groups: CadSampleLineGroup[],
  groupId: string,
  name: string,
): CadSampleLineGroup[] | null => {
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (!groups.some((entry) => entry.id === groupId)) return null;
  if (isCadSampleLineGroupNameTaken(groups, name, groupId)) return null;
  return groups.map((entry) =>
    entry.id === groupId ? { ...entry, name: name.trim() } : entry,
  );
};

/**
 * Delete a group. Alignment + surfaces are untouched and section views keep
 * their binding (reference-safe: status derives BROKEN_REFERENCE).
 */
export const deleteCadSampleLineGroup = (
  groups: CadSampleLineGroup[],
  groupId: string,
): CadSampleLineGroup[] | null => {
  if (!groups.some((entry) => entry.id === groupId)) return null;
  return groups.filter((entry) => entry.id !== groupId);
};

export const bindCadSampleLineGroupLayer = (
  group: CadSampleLineGroup,
  layerId: CadLayerId,
): CadSampleLineGroup => ({ ...group, layerId });

// ---------------------------------------------------------------------------
// Sample-line CRUD
// ---------------------------------------------------------------------------

export interface CadSampleLinePatch {
  manualName?: string | null;
  rawStation?: number;
  leftWidth?: number;
  rightWidth?: number;
  skewDeg?: number;
}

const isValidWidth = (value: number): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const sanitizeSampleLine = (line: CadSampleLine): CadSampleLine | null => {
  if (typeof line.id !== 'string' || line.id.trim() === '') return null;
  if (!Number.isFinite(line.rawStation)) return null;
  if (!isValidWidth(line.leftWidth) || !isValidWidth(line.rightWidth)) return null;
  if (!Number.isFinite(line.skewDeg)) return null;
  if (line.manualName !== undefined && typeof line.manualName !== 'string') return null;
  return { ...line };
};

/** Equivalent geometry+parameters (identity id excluded) — the dedupe key. */
export const isEquivalentSampleLine = (
  a: Pick<CadSampleLine, 'rawStation' | 'leftWidth' | 'rightWidth' | 'skewDeg'>,
  b: Pick<CadSampleLine, 'rawStation' | 'leftWidth' | 'rightWidth' | 'skewDeg'>,
): boolean =>
  Math.abs(a.rawStation - b.rawStation) <= 1e-9 &&
  a.leftWidth === b.leftWidth &&
  a.rightWidth === b.rightWidth &&
  a.skewDeg === b.skewDeg;

const withLines = (
  group: CadSampleLineGroup,
  sampleLines: CadSampleLine[],
): CadSampleLineGroup => ({ ...group, sampleLines });

/** Add one line; duplicate equivalent raw station+params is rejected (null). */
export const addCadSampleLine = (
  group: CadSampleLineGroup,
  line: CadSampleLine,
): CadSampleLineGroup | null => {
  const next = sanitizeSampleLine(line);
  if (!next || group.sampleLines.some((entry) => entry.id === next.id)) return null;
  if (group.sampleLines.some((entry) => isEquivalentSampleLine(entry, next))) return null;
  return withLines(group, [...group.sampleLines, next]);
};

export interface SampleLineIntervalSpec {
  rawStart: number;
  rawEnd: number;
  interval: number;
  leftWidth: number;
  rightWidth: number;
  skewDeg?: number;
  makeId: () => string;
  /** Safety bound (default 5000); exceeding returns null. */
  maxLines?: number;
}

export interface SampleLineIntervalResult {
  group: CadSampleLineGroup;
  added: CadSampleLine[];
  skipped: number;
}

const INTERVAL_MAX_DEFAULT = 5000;

/** Interval placement in RAW chainage; equivalent raw+params are deduped. */
export const addCadSampleLinesByInterval = (
  group: CadSampleLineGroup,
  spec: SampleLineIntervalSpec,
): SampleLineIntervalResult | null => {
  if (!Number.isFinite(spec.interval) || spec.interval <= 0) return null;
  if (!Number.isFinite(spec.rawStart) || !Number.isFinite(spec.rawEnd)) return null;
  if (spec.rawEnd < spec.rawStart - 1e-9) return null;
  if (!isValidWidth(spec.leftWidth) || !isValidWidth(spec.rightWidth)) return null;
  const skewDeg = spec.skewDeg ?? 0;
  if (!Number.isFinite(skewDeg)) return null;
  const maxLines = spec.maxLines ?? INTERVAL_MAX_DEFAULT;
  const steps = Math.floor((spec.rawEnd - spec.rawStart) / spec.interval + 1e-9);
  if (steps + 1 > maxLines) return null;
  const nextLines = [...group.sampleLines];
  const added: CadSampleLine[] = [];
  let skipped = 0;
  for (let index = 0; index <= steps; index += 1) {
    const rawStation = spec.rawStart + index * spec.interval;
    const candidate: CadSampleLine = {
      id: spec.makeId(),
      rawStation,
      leftWidth: spec.leftWidth,
      rightWidth: spec.rightWidth,
      skewDeg,
    };
    if (nextLines.some((entry) => isEquivalentSampleLine(entry, candidate))) {
      skipped += 1;
      continue;
    }
    nextLines.push(candidate);
    added.push(candidate);
  }
  return { group: withLines(group, nextLines), added, skipped };
};

export const updateCadSampleLine = (
  group: CadSampleLineGroup,
  lineId: string,
  patch: CadSampleLinePatch,
): CadSampleLineGroup | null => {
  const line = group.sampleLines.find((entry) => entry.id === lineId);
  if (!line) return null;
  const next: CadSampleLine = { ...line };
  let changed = false;
  if (patch.manualName !== undefined) {
    if (patch.manualName == null || patch.manualName.trim() === '') {
      if (next.manualName != null) {
        delete next.manualName;
        changed = true;
      }
    } else if (next.manualName !== patch.manualName.trim()) {
      next.manualName = patch.manualName.trim();
      changed = true;
    }
  }
  if (patch.rawStation !== undefined) {
    if (!Number.isFinite(patch.rawStation)) return null;
    if (patch.rawStation !== next.rawStation) {
      next.rawStation = patch.rawStation;
      changed = true;
    }
  }
  for (const field of ['leftWidth', 'rightWidth'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (!isValidWidth(value)) return null;
    if (value !== next[field]) {
      next[field] = value;
      changed = true;
    }
  }
  if (patch.skewDeg !== undefined) {
    if (!Number.isFinite(patch.skewDeg)) return null;
    if (patch.skewDeg !== next.skewDeg) {
      next.skewDeg = patch.skewDeg;
      changed = true;
    }
  }
  if (!changed) return null;
  // Reject a dedup collision created by the edit (other than itself).
  if (group.sampleLines.some((entry) => entry.id !== lineId && isEquivalentSampleLine(entry, next))) {
    return null;
  }
  return withLines(
    group,
    group.sampleLines.map((entry) => (entry.id === lineId ? next : entry)),
  );
};

export const deleteCadSampleLine = (
  group: CadSampleLineGroup,
  lineId: string,
): CadSampleLineGroup | null => {
  if (!group.sampleLines.some((entry) => entry.id === lineId)) return null;
  return withLines(
    group,
    group.sampleLines.filter((entry) => entry.id !== lineId),
  );
};

/** Stable display name for a line (manual override wins; else formatted). */
export const sampleLineDisplayName = (
  line: CadSampleLine,
  alignment?: Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'> | null,
): string => {
  if (line.manualName != null && line.manualName !== '') return line.manualName;
  return formatSectionStationLabel(alignment ?? null, line.rawStation);
};

// ---------------------------------------------------------------------------
// Source CRUD (one entry per surface; style is display-only)
// ---------------------------------------------------------------------------

export const addCadSectionSource = (
  group: CadSampleLineGroup,
  source: CadSectionSurfaceSource,
): CadSampleLineGroup | null => {
  if (typeof source.surfaceId !== 'string' || source.surfaceId.trim() === '') return null;
  if (group.surfaceSources.some((entry) => entry.surfaceId === source.surfaceId)) return null;
  return { ...group, surfaceSources: [...group.surfaceSources, cloneCadSectionSource(source)] };
};

export const removeCadSectionSource = (
  group: CadSampleLineGroup,
  surfaceId: string,
): CadSampleLineGroup | null => {
  if (!group.surfaceSources.some((entry) => entry.surfaceId === surfaceId)) return null;
  const next: CadSampleLineGroup = {
    ...group,
    surfaceSources: group.surfaceSources.filter((entry) => entry.surfaceId !== surfaceId),
  };
  if (
    next.areaComparison != null &&
    (next.areaComparison.baseSurfaceId === surfaceId ||
      next.areaComparison.comparisonSurfaceId === surfaceId)
  ) {
    delete next.areaComparison;
  }
  return next;
};

export const setCadSectionSourceStyle = (
  group: CadSampleLineGroup,
  surfaceId: string,
  sectionStyleId: string | null,
): CadSampleLineGroup | null => {
  const source = group.surfaceSources.find((entry) => entry.surfaceId === surfaceId);
  if (!source) return null;
  const current = source.sectionStyleId ?? null;
  if (current === (sectionStyleId ?? null)) return null;
  return {
    ...group,
    surfaceSources: group.surfaceSources.map((entry) => {
      if (entry.surfaceId !== surfaceId) return entry;
      if (sectionStyleId == null) {
        const { sectionStyleId: _drop, ...rest } = entry;
        return rest;
      }
      return { ...entry, sectionStyleId };
    }),
  };
};

export const setCadSampleLineGroupAreaComparison = (
  group: CadSampleLineGroup,
  areaComparison: { baseSurfaceId: string; comparisonSurfaceId: string } | null,
): CadSampleLineGroup | null => {
  if (areaComparison == null) {
    if (group.areaComparison == null) return null;
    const next = cloneCadSampleLineGroup(group);
    delete next.areaComparison;
    return next;
  }
  const hasSource = (surfaceId: string): boolean =>
    group.surfaceSources.some((entry) => entry.surfaceId === surfaceId);
  if (!hasSource(areaComparison.baseSurfaceId) || !hasSource(areaComparison.comparisonSurfaceId)) {
    return null;
  }
  if (
    group.areaComparison != null &&
    group.areaComparison.baseSurfaceId === areaComparison.baseSurfaceId &&
    group.areaComparison.comparisonSurfaceId === areaComparison.comparisonSurfaceId
  ) {
    return null;
  }
  return { ...group, areaComparison: { ...areaComparison } };
};

// ---------------------------------------------------------------------------
// Section style CRUD (mirrors cadProfileTypes style CRUD)
// ---------------------------------------------------------------------------

export const isCadSectionStyleNameTaken = (
  styles: CadSectionStyle[],
  name: string,
  exceptId?: string,
): boolean =>
  styles.some(
    (style) => style.id !== exceptId && style.name.toLowerCase() === name.trim().toLowerCase(),
  );

const sanitizeSectionStyle = (style: CadSectionStyle): CadSectionStyle | null => {
  if (typeof style.id !== 'string' || style.id.trim() === '') return null;
  if (typeof style.name !== 'string' || style.name.trim() === '') return null;
  if (typeof style.color !== 'string' || style.color.trim() === '') return null;
  if (typeof style.lineweight !== 'number' || !Number.isFinite(style.lineweight)) return null;
  if (style.lineweight < 0) return null;
  if (typeof style.opacity !== 'number' || !Number.isFinite(style.opacity)) return null;
  if (style.opacity < 0 || style.opacity > 1) return null;
  if (style.showVertices !== undefined && typeof style.showVertices !== 'boolean') return null;
  return { ...style, name: style.name.trim() };
};

export const createCadSectionStyle = (
  styles: CadSectionStyle[],
  style: CadSectionStyle,
): CadSectionStyle[] | null => {
  const next = sanitizeSectionStyle(style);
  if (!next || styles.some((entry) => entry.id === next.id)) return null;
  if (isCadSectionStyleNameTaken(styles, next.name)) return null;
  return [...styles, next];
};

export const renameCadSectionStyle = (
  styles: CadSectionStyle[],
  styleId: string,
  name: string,
): CadSectionStyle[] | null => {
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (!styles.some((entry) => entry.id === styleId)) return null;
  if (isCadSectionStyleNameTaken(styles, name, styleId)) return null;
  return styles.map((entry) => (entry.id === styleId ? { ...entry, name: name.trim() } : entry));
};

export type CadSectionStylePatch = Partial<
  Pick<CadSectionStyle, 'color' | 'lineweight' | 'opacity' | 'showVertices'>
>;

export const updateCadSectionStyle = (
  styles: CadSectionStyle[],
  styleId: string,
  patch: CadSectionStylePatch,
): CadSectionStyle[] | null => {
  if (!styles.some((entry) => entry.id === styleId)) return null;
  if (
    patch.lineweight !== undefined &&
    (!Number.isFinite(patch.lineweight) || patch.lineweight < 0)
  ) {
    return null;
  }
  if (
    patch.opacity !== undefined &&
    (!Number.isFinite(patch.opacity) || patch.opacity < 0 || patch.opacity > 1)
  ) {
    return null;
  }
  if (patch.color !== undefined && (typeof patch.color !== 'string' || patch.color.trim() === '')) {
    return null;
  }
  if (patch.showVertices !== undefined && typeof patch.showVertices !== 'boolean') return null;
  return styles.map((entry) => {
    if (entry.id !== styleId) return entry;
    const next: CadSectionStyle = { ...entry };
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
 * Delete with refcount guard: blocked while a group source or a view
 * references the style unless a valid replacementId rewires those refs.
 * Never deletes the last remaining style.
 */
export const deleteCadSectionStyle = (
  styles: CadSectionStyle[],
  groups: CadSampleLineGroup[],
  views: CadSectionView[],
  styleId: string,
  replacementId?: string,
): {
  styles: CadSectionStyle[];
  groups: CadSampleLineGroup[];
  views: CadSectionView[];
} | null => {
  if (!styles.some((entry) => entry.id === styleId) || styles.length <= 1) return null;
  const referenced =
    groups.some((group) =>
      group.surfaceSources.some((source) => source.sectionStyleId === styleId),
    ) || views.some((view) => view.styleId === styleId);
  if (referenced && replacementId == null) return null;
  if (replacementId !== undefined) {
    if (replacementId === styleId || !styles.some((entry) => entry.id === replacementId)) {
      return null;
    }
  }
  return {
    styles: styles.filter((entry) => entry.id !== styleId),
    groups:
      replacementId != null
        ? groups.map((group) => ({
            ...group,
            surfaceSources: group.surfaceSources.map((source) =>
              source.sectionStyleId === styleId
                ? { ...source, sectionStyleId: replacementId }
                : source,
            ),
          }))
        : groups,
    views:
      replacementId != null
        ? views.map((view) =>
            view.styleId === styleId ? { ...view, styleId: replacementId } : view,
          )
        : views,
  };
};

// ---------------------------------------------------------------------------
// Section view CRUD
// ---------------------------------------------------------------------------

export type CadSectionViewPatch = Partial<
  Pick<
    CadSectionView,
    | 'name'
    | 'horizontalScale'
    | 'verticalExaggeration'
    | 'datumMode'
    | 'datumElevation'
    | 'offsetGridInterval'
    | 'elevationGridInterval'
    | 'showCutFill'
    | 'styleId'
    | 'layerId'
    | 'insertionX'
    | 'insertionY'
    | 'sourceSurfaceIds'
  >
>;

export const createCadSectionView = (
  views: CadSectionView[],
  view: CadSectionView,
): CadSectionView[] | null => {
  if (typeof view.id !== 'string' || view.id.trim() === '') return null;
  if (typeof view.name !== 'string' || view.name.trim() === '') return null;
  if (views.some((entry) => entry.id === view.id)) return null;
  if (views.some((entry) => entry.name.toLowerCase() === view.name.trim().toLowerCase())) return null;
  if (!(view.horizontalScale > 0) || !(view.verticalExaggeration > 0)) return null;
  if (view.datumMode === 'explicit' && view.datumElevation == null) return null;
  return [...views, cloneCadSectionView({ ...view, name: view.name.trim() })];
};

export const updateCadSectionView = (
  views: CadSectionView[],
  viewId: string,
  patch: CadSectionViewPatch,
): CadSectionView[] | null => {
  const view = views.find((entry) => entry.id === viewId);
  if (!view) return null;
  const next = cloneCadSectionView(view);
  let changed = false;
  if (patch.horizontalScale !== undefined) {
    if (!(patch.horizontalScale > 0)) return null;
    if (patch.horizontalScale !== view.horizontalScale) {
      next.horizontalScale = patch.horizontalScale;
      changed = true;
    }
  }
  if (patch.verticalExaggeration !== undefined) {
    if (!(patch.verticalExaggeration > 0)) return null;
    if (patch.verticalExaggeration !== view.verticalExaggeration) {
      next.verticalExaggeration = patch.verticalExaggeration;
      changed = true;
    }
  }
  if (patch.datumMode !== undefined && patch.datumMode !== view.datumMode) {
    next.datumMode = patch.datumMode;
    changed = true;
  }
  if (patch.datumElevation !== undefined) {
    if (patch.datumElevation == null) {
      if (next.datumElevation != null) {
        delete next.datumElevation;
        changed = true;
      }
    } else if (patch.datumElevation !== next.datumElevation) {
      next.datumElevation = patch.datumElevation;
      changed = true;
    }
  }
  if (next.datumMode === 'explicit' && next.datumElevation == null) return null;
  for (const field of ['offsetGridInterval', 'elevationGridInterval'] as const) {
    const value = patch[field];
    if (value !== undefined && value !== view[field]) {
      next[field] = value;
      changed = true;
    }
  }
  if (patch.showCutFill !== undefined && patch.showCutFill !== view.showCutFill) {
    next.showCutFill = patch.showCutFill;
    changed = true;
  }
  if (patch.insertionX !== undefined && patch.insertionX !== view.insertionX) {
    next.insertionX = patch.insertionX;
    changed = true;
  }
  if (patch.insertionY !== undefined && patch.insertionY !== view.insertionY) {
    next.insertionY = patch.insertionY;
    changed = true;
  }
  if (patch.sourceSurfaceIds !== undefined) {
    const ids = [...patch.sourceSurfaceIds];
    if (ids.join('\u0000') !== view.sourceSurfaceIds.join('\u0000')) {
      next.sourceSurfaceIds = ids;
      changed = true;
    }
  }
  if (patch.styleId !== undefined) {
    const styleId = patch.styleId ?? undefined;
    if (styleId !== view.styleId) {
      if (styleId == null) delete next.styleId;
      else next.styleId = styleId;
      changed = true;
    }
  }
  if (patch.layerId !== undefined) {
    const layerId = patch.layerId ?? undefined;
    if (layerId !== view.layerId) {
      if (layerId == null) delete next.layerId;
      else next.layerId = layerId;
      changed = true;
    }
  }
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name === '') return null;
    if (views.some((entry) => entry.id !== viewId && entry.name === name)) return null;
    if (name !== view.name) {
      next.name = name;
      changed = true;
    }
  }
  if (!changed) return null;
  return views.map((entry) => (entry.id === viewId ? next : entry));
};

export const deleteCadSectionView = (
  views: CadSectionView[],
  viewId: string,
): CadSectionView[] | null => {
  if (!views.some((entry) => entry.id === viewId)) return null;
  return views.filter((entry) => entry.id !== viewId);
};

// ---------------------------------------------------------------------------
// Engine seam — the shape the engine section extractor must produce.
// (Owned by the engine slice once src/engine/cad/sections/ lands.)
// ---------------------------------------------------------------------------

export interface CadSectionSample {
  /** Signed offset from the alignment centreline (LEFT positive). */
  offset: number;
  elevation: number;
  x?: number;
  y?: number;
  eventKind?: string;
}

export interface CadSectionSegment {
  samples: CadSectionSample[];
}

/** One sample-line x source extraction result (line + source segments + coverage). */
export interface CadSurfaceSectionResult {
  groupId: string;
  lineId: string;
  surfaceId: string;
  /** Per-line content revision this result was built for. */
  revision: string;
  /** Source surface `srev1` the mesh was built from. */
  surfaceRevision: string;
  rawStation: number;
  segments: CadSectionSegment[];
  minElevation: number | null;
  maxElevation: number | null;
  /** Covered length along the sample line (0 = gap/void only). */
  coveredWidth: number;
  gapWidth: number;
  diagnostics: string[];
}

/** Materialised source mesh (worker-local; flat arrays are parsed once per source). */
export interface SectionExtractionMesh {
  points: Array<{ x: number; y: number; z: number }>;
  triangles: Array<[number, number, number]>;
  grid: CadSurfaceGrid;
}

/** Input the engine section extractor consumes (one line x one source). */
export interface ExtractSurfaceSectionInput {
  groupId: string;
  groupRevision: string;
  lineId: string;
  revision: string;
  surfaceId: string;
  surfaceRevision: string;
  alignmentElements: readonly CadAlignmentElement[];
  startStation: number;
  /** Display labels only; NEVER part of the section revision. */
  stationEquations?: CadStationEquation[];
  rawStation: number;
  leftWidth: number;
  rightWidth: number;
  skewDeg: number;
  mesh: SectionExtractionMesh;
}

export type SurfaceSectionExtractorFn = (
  _input: ExtractSurfaceSectionInput,
) => CadSurfaceSectionResult | Promise<CadSurfaceSectionResult>;
