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

export const findDefinition = (
  catalog: FeatureCodeCatalog,
  definitionId: string,
): FeatureDefinition | undefined =>
  catalog.definitions.find((def) => def.id === definitionId);
