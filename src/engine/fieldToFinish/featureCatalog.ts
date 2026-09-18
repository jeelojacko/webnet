/**
 * Vendor-neutral feature code catalog. Scope is layer/style/symbol/label/
 * linework only — no legal or ownership fields. Unknown field codes resolve
 * to UNMAPPED and are preserved, never discarded.
 */
import type { CodeAlias } from './codeMatching';

export const UNMAPPED_LAYER = 'UNMAPPED';

export type FeaturePointBehavior = 'point' | 'none';

export interface LineworkBehavior {
  enabled: boolean;
  /** When true, bare code tokens continue the open chain without CONTINUE. */
  implicitContinuation: boolean;
}

export interface FeatureDefinition {
  id: string;
  code: string;
  description: string;
  layer: string;
  pointSymbolId?: string;
  styleId?: string;
  /** Phase 18D BASE point-style ref (marker presentation). Undefined = drawing default. */
  pointStyleId?: string;
  labelStyleId?: string;
  pointBehavior: FeaturePointBehavior;
  lineworkBehavior: LineworkBehavior;
  defaultAttributes?: Record<string, string>;
}

export interface FeatureCodeCatalog {
  id: string;
  name: string;
  version: string;
  definitions: FeatureDefinition[];
  aliases: CodeAlias[];
}

/**
 * Phase 18E attribute-merge audit: generation does NOT merge catalog
 * defaultAttributes onto entities today. The only attributes stamped at
 * generation time are source-record facts (featureCodes, provenance). A
 * future merge must define catalog-defaults-vs-record precedence
 * explicitly — no precedence is invented here.
 */

export const findDefinition = (
  catalog: FeatureCodeCatalog,
  definitionId: string,
): FeatureDefinition | undefined =>
  catalog.definitions.find((def) => def.id === definitionId);

/** Deep clone: catalogs are drawing-owned mutable state, never shared. */
export const cloneFeatureCatalog = (catalog: FeatureCodeCatalog): FeatureCodeCatalog => ({
  ...catalog,
  definitions: catalog.definitions.map((def) => ({
    ...def,
    lineworkBehavior: { ...def.lineworkBehavior },
    ...(def.defaultAttributes ? { defaultAttributes: { ...def.defaultAttributes } } : {}),
  })),
  aliases: catalog.aliases.map((alias) => ({ ...alias })),
});
