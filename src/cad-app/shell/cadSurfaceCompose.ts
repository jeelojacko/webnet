import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import { composeSurfaceMeshes } from '../../engine/cad/surfaceCompose';
import type { CadSurfaceRow } from './cadSurfaceSnapshot';

/**
 * Phase 18Y — exact two-surface composition UI seam.
 *
 * The engine (`composeSurfaceMeshes`) computes deterministic geometry; the
 * `SURFCOMPOSE` (copy) / `SURFCOMPOSEPASTE` (in-place) transactions persist
 * the precomputed payload (undo/redo never recompute). This module is the
 * single mapping layer the shell uses: command construction, capability
 * gates, warning text, and normalization of a composition result into a
 * display summary. A command-field rename is a one-file fix here.
 */

export const COMPOSE_POLICY_ID = 'overlay-coverage-wins' as const;
export const COMPOSE_POLICY_LABEL = 'Overlay Coverage Wins';
/**
 * Pre-commit dry-run ceiling (base + overlay triangle count). Above it the
 * dialog skips the main-thread summary and shows the post-commit variant.
 */
export const COMPOSE_DRY_RUN_TRIANGLE_LIMIT = 25_000;

export type CadSurfaceComposeMode = 'copy' | 'paste';

export interface CadSurfaceComposeDiagnosticsView {
  baseOnlyArea: number;
  overlayArea: number;
  overlapArea: number;
  resultArea: number;
  seamLength: number;
  maxSeamMismatch: number;
  outputVertexCount: number;
  outputTriangleCount: number;
}

export interface CadSurfaceComposePreview {
  ok: boolean;
  reasonCode: string | null;
  message: string;
  diagnostics: CadSurfaceComposeDiagnosticsView | null;
  /** Canonical composed topology — the transaction persists this exactly. */
  vertices: number[];
  faces: number[];
}

/** Both modes need two CURRENT surfaces; the engine never reads stale meshes. */
export const surfaceComposeCapability = (
  rows: ReadonlyArray<Pick<CadSurfaceRow, 'status'>>,
): { canCompose: boolean } => ({
  canCompose: rows.filter((row) => row.status === 'CURRENT').length >= 2,
});

/** Minimal source identity a composition command needs (row or engine surface). */
export interface ComposeCommandSource {
  id: string;
  name: string;
  revision: string;
  current: boolean;
}

/** COMPOSE COPY command (new surface; neither source mutates). */
export const buildComposeCopyCommand = (
  base: ComposeCommandSource,
  overlay: ComposeCommandSource,
  composed: Pick<CadSurfaceComposePreview, 'vertices' | 'faces'>,
): CadCommand => ({
  key: 'SURFCOMPOSE',
  baseSurfaceId: base.id,
  baseExpectedRevision: base.revision,
  overlaySurfaceId: overlay.id,
  overlayExpectedRevision: overlay.revision,
  vertices: composed.vertices,
  faces: composed.faces,
  policy: COMPOSE_POLICY_ID,
  sessionCurrent: base.current && overlay.current,
});

/** PASTE IN PLACE command (target keeps identity; definition replaced). */
export const buildComposePasteCommand = (
  target: ComposeCommandSource,
  source: ComposeCommandSource,
  composed: Pick<CadSurfaceComposePreview, 'vertices' | 'faces'>,
): CadCommand => ({
  key: 'SURFCOMPOSEPASTE',
  targetSurfaceId: target.id,
  targetExpectedRevision: target.revision,
  sourceSurfaceId: source.id,
  sourceExpectedRevision: source.revision,
  vertices: composed.vertices,
  faces: composed.faces,
  policy: COMPOSE_POLICY_ID,
  sessionCurrent: target.current && source.current,
});

export const explainComposeFailure = (reasonCode: string): string => {
  if (reasonCode === 'SURFACE_COMPOSE_SEAM_Z_MISMATCH') return 'seam elevation mismatch';
  if (reasonCode === 'SURFACE_COMPOSE_SAME_SOURCE') return 'Base and Overlay are the same surface';
  return reasonCode;
};

/** Non-destructive copy framing for the dialog title/notice. */
export const composeCopyFraming = (base: CadSurfaceRow, overlay: CadSurfaceRow): string =>
  `Compose Copy — create a new explicit-TIN surface from “${base.name}” (Base) + ` +
  `“${overlay.name}” (Overlay). Neither source changes; one undoable step.`;

/** Paste warning (mission §10 wording): names, policy, flattening, source, undo. */
export const composePasteWarning = (target: CadSurfaceRow, source: CadSurfaceRow): string =>
  `Paste Into Target — compose “${source.name}” (Overlay/Source) into “${target.name}” (Base/Target)?\n\n` +
  `• Policy: ${COMPOSE_POLICY_LABEL} — wherever the Overlay has triangles it owns the surface; the Base covers the rest\n` +
  `• “${target.name}” keeps its id/name/layer/style, but its definition becomes one flattened explicit composite topology (sources/breaklines/boundaries/edits dropped)\n` +
  `• “${source.name}” is unchanged (byte-identical)\n` +
  `• Overlay and Base must agree exactly at the seam; any disagreement BLOCKS with SURFACE_COMPOSE_SEAM_Z_MISMATCH\n` +
  `• One undoable step — Undo restores the full pre-paste definition\n\nContinue?`;

/** Normalize the pure-engine result into the dialog's summary + commit payload. */
export const toComposePreview = (result: ReturnType<typeof composeSurfaceMeshes>): CadSurfaceComposePreview => {
  if (result.ok) {
    return {
      ok: true,
      reasonCode: null,
      message: 'Exact — Base and Overlay agree at every seam vertex (no invented Z).',
      diagnostics: {
        baseOnlyArea: result.diagnostics.baseOnlyArea,
        overlayArea: result.diagnostics.overlayArea,
        overlapArea: result.diagnostics.overlapArea,
        resultArea: result.diagnostics.resultArea,
        seamLength: result.diagnostics.seamLength,
        maxSeamMismatch: result.diagnostics.maxSeamMismatch,
        outputVertexCount: result.diagnostics.outputVertexCount,
        outputTriangleCount: result.diagnostics.outputTriangleCount,
      },
      vertices: result.vertices,
      faces: result.faces,
    };
  }
  const failure = result as {
    reason: string;
    maxMismatch?: number;
    x?: number;
    y?: number;
    baseZ?: number;
    overlayZ?: number;
  };
  const message =
    failure.reason === 'SURFACE_COMPOSE_SEAM_Z_MISMATCH'
      ? `Blocked — seam elevation mismatch up to ${(failure.maxMismatch ?? 0).toFixed(4)} m ` +
        `at E ${(failure.x ?? 0).toFixed(3)} N ${(failure.y ?? 0).toFixed(3)} ` +
        `(base ${(failure.baseZ ?? 0).toFixed(3)}, overlay ${(failure.overlayZ ?? 0).toFixed(3)}).`
      : `Blocked — ${explainComposeFailure(failure.reason)}.`;
  return { ok: false, reasonCode: failure.reason, message, diagnostics: null, vertices: [], faces: [] };
};
