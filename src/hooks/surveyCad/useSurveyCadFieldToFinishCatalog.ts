/**
 * STRUCT-194.9 — drawing-owned Field-to-Finish catalog lifecycle.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change. Holds
 * the catalog truth derived from the HISTORY project (same source the F2F
 * panel renders), never workspace React state:
 *   - a stable starter clone used only as a panel-local fallback,
 *   - the missing-legacy status/flag pair (fail-closed warning, never a silent
 *     SAMPLE when the drawing carries F2F content but no catalog),
 *   - a ref that always points at the current catalog (updated by effect),
 *   - GENERATED-reference provenance counts for the manager delete warning,
 *   - the two project-mutation handlers (one undoable full-replace
 *     transaction; settings update preserving control-token aliases).
 *
 * Primitive order is the original `useMemo -> useRef -> useEffect -> useMemo`;
 * the handlers are fresh closures per render (never memoized), so they read the
 * live `activeProject` and the current workspace methods. Adopting a fallback
 * writes the clone into the project through history so the drawing owns it from
 * there on; the ref is advanced BEFORE the transaction so a rapid edit/undo/redo
 * or a drawing switch can never classify against a stale catalog.
 *
 * Called once, unconditionally, at the exact former F2F position (after the
 * analysis presentation, before `copiedEntityIdsRef` / the parcel hydration).
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import {
  cloneFeatureCatalog,
  type FeatureCodeCatalog,
} from '../../engine/fieldToFinish/featureCatalog';
import { STARTER_CATALOG } from '../../engine/fieldToFinish/starterCatalog';
import {
  getDrawingCatalogStatus,
  hasFieldToFinishContent,
  type DrawingCatalogStatus,
} from '../../engine/fieldToFinish/drawingCatalog';
import { classifyCatalogChange } from '../../engine/fieldToFinish/linkedSync';
import type { FieldToFinishSettings } from '../../engine/fieldToFinish/catalogIo';
import type { UseSurveyCadWorkspaceResult } from './useSurveyCadWorkspace.types';

/** The only workspace methods catalog/settings edits need. */
export type SurveyCadFieldToFinishCatalogWorkspace = Pick<
  UseSurveyCadWorkspaceResult,
  'replaceFieldToFinishCatalog' | 'updateFieldToFinishSettings'
>;

export interface SurveyCadFieldToFinishCatalogArgs {
  /** Live project (history-present) that owns the catalog. */
  activeProject: CadProject;
  /** Live workspace history methods (never a stale singleton). */
  workspace: SurveyCadFieldToFinishCatalogWorkspace;
}

export interface SurveyCadFieldToFinishCatalog {
  activeCatalog: FeatureCodeCatalog;
  catalogIsFallback: boolean;
  catalogStatus: DrawingCatalogStatus;
  catalogHasLegacyContent: boolean;
  featureCatalogRef: RefObject<FeatureCodeCatalog>;
  f2fReferenceCounts: Record<string, number>;
  handleFeatureCatalogChange: (_next: FeatureCodeCatalog) => void;
  handleFieldToFinishSettingsChange: (_settings: FieldToFinishSettings) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const useSurveyCadFieldToFinishCatalog = ({
  activeProject,
  workspace,
}: SurveyCadFieldToFinishCatalogArgs): SurveyCadFieldToFinishCatalog => {
  // Phase 18E — drawing-owned active feature catalog, derived from the
  // HISTORY project (same source the F2F panel renders), never workspace
  // React state. Absent catalog + no F2F content = starter clone as a
  // panel-local fallback (never written silently — edits adopt it into the
  // project). Absent catalog + F2F content = MISSING_LEGACY: surfaced,
  // never silent SAMPLE.
  const starterFallback = useMemo(() => cloneFeatureCatalog(STARTER_CATALOG), []);
  const activeCatalog: FeatureCodeCatalog = activeProject.fieldToFinishCatalog ?? starterFallback;
  const catalogIsFallback = activeProject.fieldToFinishCatalog === undefined;
  const catalogStatus = getDrawingCatalogStatus(activeProject);
  const catalogHasLegacyContent = catalogIsFallback && hasFieldToFinishContent(activeProject);
  const featureCatalogRef = useRef<FeatureCodeCatalog>(activeCatalog);
  useEffect(() => {
    featureCatalogRef.current = activeCatalog;
  }, [activeCatalog]);
  // Per-definition GENERATED reference counts (from project provenance) for
  // the manager's delete warning. Geometry is never deleted with a definition.
  const f2fReferenceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entity of activeProject.entities) {
      const provenance = entity.metadata?.['provenance'];
      if (!isRecord(provenance)) continue;
      if (provenance['generatedBy'] !== 'FIELD_TO_FINISH') continue;
      const defId = provenance['featureDefinitionId'];
      if (typeof defId === 'string' && defId) counts[defId] = (counts[defId] ?? 0) + 1;
    }
    return counts;
  }, [activeProject.entities]);
  // Catalog edits are PROJECT mutations through history (one
  // full-catalog-replace transaction, undoable, propagated to the parent
  // document), not workspace useState. Adopting a fallback writes the
  // starter clone into the project so the drawing owns it from here on.
  const handleFeatureCatalogChange = (next: FeatureCodeCatalog) => {
    const change = classifyCatalogChange(featureCatalogRef.current, next);
    featureCatalogRef.current = next;
    workspace.replaceFieldToFinishCatalog(next, change);
  };
  // Drawing-owned F2F control-token aliases (vendor-neutral Token→Canonical).
  const handleFieldToFinishSettingsChange = (settings: FieldToFinishSettings) => {
    workspace.updateFieldToFinishSettings({ ...settings });
  };
  return {
    activeCatalog,
    catalogIsFallback,
    catalogStatus,
    catalogHasLegacyContent,
    featureCatalogRef,
    f2fReferenceCounts,
    handleFeatureCatalogChange,
    handleFieldToFinishSettingsChange,
  };
};
