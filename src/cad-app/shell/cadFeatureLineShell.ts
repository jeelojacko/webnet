/**
 * Phase 20A — feature-line shell command adapter.
 *
 * Kept out of the (already large) cadCommandRegistry switch: the registry
 * delegates to these two functions by key. Every command is an undoable
 * engine command dispatched through `actions.runFeatureLineCommand`; the
 * numeric input a ribbon button cannot collect inline comes from a prompt
 * (cancel / NaN fails closed). "Set Vertices from Surface" is vertex-only.
 */
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

/** Shell keys this adapter owns (rendered by the bounded ribbon group). */
export const FEATURE_LINE_SHELL_KEYS: ReadonlySet<string> = new Set([
  'FEATURELINECREATE',
  'FLSETZ',
  'FLGRADE',
  'FLRAISELOWER',
  'FLINTERPOLATE',
  'FLSURFACEELEV',
  'FLINQUIRY',
  'FLINSERTVERTEX',
  'FLDELETEVERTEX',
  'SURFACE_ADDFEATURELINEBREAKLINE',
]);

const SELECTION_REQUIRED_KEYS: ReadonlySet<string> = new Set([
  'FLSETZ',
  'FLGRADE',
  'FLRAISELOWER',
  'FLINTERPOLATE',
  'FLSURFACEELEV',
  'FLINQUIRY',
  'FLINSERTVERTEX',
  'FLDELETEVERTEX',
  'SURFACE_ADDFEATURELINEBREAKLINE',
]);

/** Phase 20A — first selected feature line (selection order preserved). */
const selectedFeatureLineId = (snapshot: CadWorkspaceSnapshot | null | undefined): string | null =>
  (snapshot?.selectionPreview ?? []).find((entry) => entry.type === 'feature-line')?.id ?? null;

/** Selected surface, else the only surface (feature-line surface commands). */
const resolveFeatureLineSurfaceId = (snapshot: CadWorkspaceSnapshot | null | undefined): string | null => {
  const surfaces = snapshot?.surface?.surfaces ?? [];
  const selected = snapshot?.surface?.selectedSurfaceId ?? null;
  if (selected && surfaces.some((row) => row.id === selected)) return selected;
  return surfaces.length === 1 ? surfaces[0]!.id : null;
};

const promptNumber = (message: string, fallback: string): number | null => {
  const raw = window.prompt(message, fallback);
  if (raw == null) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
};

export const featureLineShellAvailable = (
  key: string,
  snapshot: CadWorkspaceSnapshot | null | undefined,
): boolean => {
  if (snapshot == null) return false;
  if (key === 'FEATURELINECREATE') return snapshot.selectionCount > 0;
  if (SELECTION_REQUIRED_KEYS.has(key)) return selectedFeatureLineId(snapshot) != null;
  return true;
};

export const executeFeatureLineShellCommand = (
  key: string,
  actions: CadShellActions | null,
  snapshot: CadWorkspaceSnapshot | null | undefined,
): boolean => {
  if (!actions) return false;
  const runner = actions.runFeatureLineCommand;
  if (key === 'FEATURELINECREATE') {
    const preview = snapshot?.selectionPreview ?? [];
    if (!runner || preview.length === 0) return false;
    const allPoints = preview.every((entry) => entry.type === 'survey-point');
    const allChain = preview.every(
      (entry) => entry.type === 'line' || entry.type === 'polyline' || entry.type === 'arc',
    );
    if (!allPoints && !allChain) return false;
    const z = promptNumber('Constant elevation (m):', '0');
    if (z == null) return false;
    return runner({
      key: 'FEATURELINE',
      sourceEntityIds: preview.map((entry) => entry.id),
      sourceKind: allPoints ? 'survey-points' : 'chain',
      elevation: { method: 'constant', z },
    });
  }
  if (!runner) return false;
  const entityId = selectedFeatureLineId(snapshot);
  if (!entityId) return false;
  switch (key) {
    case 'FLSETZ': {
      const z = promptNumber('Set all vertex elevations (m):', '0');
      return z == null ? false : runner({ key: 'FLSETZ', entityId, z });
    }
    case 'FLRAISELOWER': {
      const deltaZ = promptNumber('Raise (+m) / lower (-m):', '0');
      return deltaZ == null ? false : runner({ key: 'FLRAISELOWER', entityId, deltaZ });
    }
    case 'FLGRADE': {
      const gradePercent = promptNumber('Grade percent over the full span (negative falls):', '0');
      return gradePercent == null ? false : runner({ key: 'FLGRADE', entityId, gradePercent });
    }
    case 'FLINTERPOLATE':
      return runner({ key: 'FLINTERPOLATE', entityId });
    case 'FLSURFACEELEV': {
      const surfaceId = resolveFeatureLineSurfaceId(snapshot);
      return surfaceId == null ? false : runner({ key: 'FLSURFACEELEV', entityId, surfaceId });
    }
    case 'FLINQUIRY':
      return runner({ key: 'FLINQUIRY', entityId });
    case 'FLINSERTVERTEX': {
      const courseIndex = promptNumber('Course index (0-based):', '0');
      if (courseIndex == null || !Number.isInteger(courseIndex) || courseIndex < 0) return false;
      const station = promptNumber('Station along the feature line (m):', '0');
      if (station == null) return false;
      return runner({ key: 'FLINSERTVERTEX', entityId, courseIndex, station });
    }
    case 'FLDELETEVERTEX': {
      const vertexNumber = promptNumber('Vertex number to delete (1-based):', '2');
      if (vertexNumber == null || !Number.isInteger(vertexNumber) || vertexNumber < 1) return false;
      return runner({ key: 'FLDELETEVERTEX', entityId, vertexIndex: vertexNumber - 1 });
    }
    case 'SURFACE_ADDFEATURELINEBREAKLINE': {
      const surfaceId = resolveFeatureLineSurfaceId(snapshot);
      return surfaceId == null
        ? false
        : runner({ key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE', surfaceId, entityId });
    }
    default:
      return false;
  }
};
