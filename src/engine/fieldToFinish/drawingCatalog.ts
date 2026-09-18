/**
 * Phase 18E — drawing-owned F2F catalog lifecycle.
 *
 * Ownership answer: the drawing's `fieldToFinishCatalog` is authoritative,
 * never workspace React state. Backfill runs on every load path:
 * - catalog present → untouched (roundtrip-exact);
 * - absent + no F2F-generated entities → seed a starter clone;
 * - absent + F2F-generated entities → MISSING_LEGACY: the field stays
 *   undefined (never claim SAMPLE authority for legacy content) and
 *   regeneration stays blocked until the operator resolves it.
 */
import type { CadProject } from '../cad/cadTypes';
import { cloneFieldToFinishSettings, type FieldToFinishSettings } from './catalogIo';
import { computeFeatureCatalogRevision } from './catalogRevision';
import { cloneFeatureCatalog, type FeatureCodeCatalog } from './featureCatalog';
import { STARTER_CATALOG } from './starterCatalog';

export type DrawingCatalogStatus = 'READY' | 'MISSING_LEGACY';

/** True when any entity carries FIELD_TO_FINISH generation provenance. */
export const hasFieldToFinishContent = (project: CadProject): boolean =>
  project.entities.some((entity) => {
    const metadata = entity.metadata as Record<string, unknown> | undefined;
    const provenance = metadata?.['provenance'] as Record<string, unknown> | undefined;
    return provenance?.['generatedBy'] === 'FIELD_TO_FINISH';
  });

/**
 * Sentinel read: READY when the drawing owns a catalog, MISSING_LEGACY when
 * F2F content exists with no catalog (regen blocked, surface provenance
 * catalogId/version/definitionId for manual resolution).
 */
export const getDrawingCatalogStatus = (project: CadProject): DrawingCatalogStatus =>
  project.fieldToFinishCatalog !== undefined ? 'READY' : 'MISSING_LEGACY';

/** Content revision of the drawing-owned catalog (undefined when missing). */
export const drawingCatalogRevision = (project: CadProject): string | undefined =>
  project.fieldToFinishCatalog ? computeFeatureCatalogRevision(project.fieldToFinishCatalog) : undefined;

export const cloneDrawingCatalog = (
  catalog: FeatureCodeCatalog | undefined,
): FeatureCodeCatalog | undefined => (catalog ? cloneFeatureCatalog(catalog) : undefined);

export const cloneDrawingSettings = (
  settings: FieldToFinishSettings | undefined,
): FieldToFinishSettings | undefined => cloneFieldToFinishSettings(settings);

/**
 * Load-time backfill (idempotent): seed starter when the drawing has no F2F
 * history, default empty settings, and leave MISSING_LEGACY drawings
 * catalog-less. Existing catalogs pass through by reference — callers clone
 * before mutating.
 */
export const backfillDrawingCatalog = (project: CadProject): CadProject => {
  const needsCatalog = project.fieldToFinishCatalog === undefined
    && !hasFieldToFinishContent(project);
  const needsSettings = project.fieldToFinishSettings === undefined;
  if (!needsCatalog && !needsSettings) return project;
  return {
    ...project,
    ...(needsCatalog ? { fieldToFinishCatalog: cloneFeatureCatalog(STARTER_CATALOG) } : {}),
    ...(needsSettings ? { fieldToFinishSettings: {} } : {}),
  };
};

/** Generation args sourced from the drawing (undefined catalog = blocked). */
export const drawingFieldToFinishSource = (
  project: CadProject,
): { catalog: FeatureCodeCatalog; controlTokenAliases: Record<string, string> } | undefined => {
  if (project.fieldToFinishCatalog === undefined) return undefined;
  return {
    catalog: project.fieldToFinishCatalog,
    controlTokenAliases: project.fieldToFinishSettings?.controlTokenAliases ?? {},
  };
};
