import type { CadProject } from '../../engine/cad/cadTypes';
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';
import { computeFeatureCatalogRevision } from '../../engine/fieldToFinish/catalogRevision';
import type { CadF2FSnapshot } from '../../cad-app/shell/cadShellTypes';

/** Phase 18E — generated-features summary counts from entity provenance. */
export interface F2FGeneratedSummary {
  points: number;
  labels: number;
  linework: number;
  overrides: number;
  detached: number;
  unmapped: number;
}

export const summarizeGeneratedFeatures = (project: CadProject): F2FGeneratedSummary => {
  const summary: F2FGeneratedSummary = {
    points: 0,
    labels: 0,
    linework: 0,
    overrides: 0,
    detached: 0,
    unmapped: 0,
  };
  for (const entity of project.entities) {
    const provenance = (entity.metadata as Record<string, unknown> | undefined)?.['provenance'] as
      | Record<string, unknown>
      | undefined;
    if (provenance?.['generatedBy'] !== 'FIELD_TO_FINISH') continue;
    const state = provenance?.['state'];
    if (state === 'MANUAL_OVERRIDE') summary.overrides += 1;
    else if (state === 'DETACHED') summary.detached += 1;
    if (entity.type === 'survey-point') {
      summary.points += 1;
      if (!provenance?.['featureDefinitionId']) summary.unmapped += 1;
    } else if (entity.type === 'text') summary.labels += 1;
    else if (entity.type === 'line' || entity.type === 'polyline') summary.linework += 1;
  }
  return summary;
};

/** Distinct provenance catalog traces for MISSING_LEGACY explanation. */
export interface LegacyProvenanceTrace {
  catalogIds: string[];
  catalogVersions: string[];
  definitionIds: string[];
}

export const surfaceLegacyProvenance = (project: CadProject): LegacyProvenanceTrace => {
  const catalogIds = new Set<string>();
  const catalogVersions = new Set<string>();
  const definitionIds = new Set<string>();
  for (const entity of project.entities) {
    const provenance = (entity.metadata as Record<string, unknown> | undefined)?.['provenance'] as
      | Record<string, unknown>
      | undefined;
    if (provenance?.['generatedBy'] !== 'FIELD_TO_FINISH') continue;
    if (typeof provenance?.['catalogId'] === 'string' && provenance?.['catalogId']) {
      catalogIds.add(provenance?.['catalogId'] as string);
    }
    if (typeof provenance?.['catalogVersion'] === 'string' && provenance?.['catalogVersion']) {
      catalogVersions.add(provenance?.['catalogVersion'] as string);
    }
    if (typeof provenance?.['featureDefinitionId'] === 'string' && provenance?.['featureDefinitionId']) {
      definitionIds.add(provenance?.['featureDefinitionId'] as string);
    }
  }
  return {
    catalogIds: [...catalogIds].sort(),
    catalogVersions: [...catalogVersions].sort(),
    definitionIds: [...definitionIds].sort(),
  };
};

/**
 * Phase 18E — shell snapshot builder. Pure derivation from the
 * drawing-owned catalog + provenance; the shell keeps no F2F state.
 */
export const buildCadF2FSnapshot = (
  project: CadProject,
  catalog: FeatureCodeCatalog,
  catalogState: 'READY' | 'MISSING_LEGACY',
): CadF2FSnapshot => {
  const generated = summarizeGeneratedFeatures(project);
  return {
    catalogName: catalog.name,
    catalogVersion: catalog.version,
    catalogRevision: computeFeatureCatalogRevision(catalog).slice(0, 8),
    definitionCount: catalog.definitions.length,
    aliasCount: catalog.aliases.length,
    catalogState,
    generatedPoints: generated.points,
    generatedLabels: generated.labels,
    generatedLinework: generated.linework,
    overrides: generated.overrides,
    detached: generated.detached,
    unmapped: generated.unmapped,
    linkStatus: project.metadata.fieldToFinishLink?.status ?? 'UNLINKED',
  };
};
