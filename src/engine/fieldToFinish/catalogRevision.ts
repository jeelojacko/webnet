/**
 * Phase 18E — deterministic feature-catalog revision + catalog diff.
 *
 * REVISION POLICY (binding): `version` is descriptive display metadata and
 * is EXCLUDED from the revision. The revision covers semantic content only:
 * per definition {code, description, layer, pointStyleId, labelStyleId,
 * pointSymbolId, styleId, pointBehavior, lineworkBehavior,
 * defaultAttributes with sorted keys}, plus aliases sorted. Definitions are
 * sorted by stable id, so reorder-only edits do not dirty the link; a
 * version-only edit does not change the revision (no staleness).
 *
 * The hash is FNV-1a (32-bit, hex) over the canonical JSON — a content
 * fingerprint for staleness comparison, not cryptographic integrity.
 */
import { canonicalizeCode } from './codeMatching';
import type { FeatureCodeCatalog, FeatureDefinition } from './featureCatalog';

const fnv1aHex = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const sortedAttributes = (
  attrs: Record<string, string> | undefined,
): Record<string, string> => {
  const clean: Record<string, string> = {};
  for (const key of Object.keys(attrs ?? {}).sort()) {
    const value = (attrs as Record<string, string>)[key];
    if (typeof value === 'string') clean[key] = value;
  }
  return clean;
};

const canonicalDefinition = (def: FeatureDefinition): Record<string, unknown> => ({
  id: def.id,
  code: def.code,
  description: def.description,
  layer: def.layer,
  pointStyleId: def.pointStyleId ?? '',
  labelStyleId: def.labelStyleId ?? '',
  pointSymbolId: def.pointSymbolId ?? '',
  styleId: def.styleId ?? '',
  pointBehavior: def.pointBehavior,
  lineworkBehavior: {
    enabled: def.lineworkBehavior.enabled,
    implicitContinuation: def.lineworkBehavior.implicitContinuation,
  },
  defaultAttributes: sortedAttributes(def.defaultAttributes),
});

/** Canonical semantic serialization (stable key order, sorted entries). */
export const canonicalFeatureCatalogJson = (catalog: FeatureCodeCatalog): string =>
  JSON.stringify({
    definitions: [...catalog.definitions]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(canonicalDefinition),
    aliases: catalog.aliases
      .map((alias) => `${canonicalizeCode(alias.alias)}->${canonicalizeCode(alias.targetCode)}`)
      .sort(),
  });

/** Deterministic content revision for link stamping + staleness compare. */
export const computeFeatureCatalogRevision = (catalog: FeatureCodeCatalog): string =>
  fnv1aHex(canonicalFeatureCatalogJson(catalog));

export interface CatalogDefinitionChange {
  /** Stable definition id (falls back to canonical code when id is blank). */
  id: string;
  /** Changed semantic fields: code/layer/pointStyle/labelStyle/point/linework/attributes (+description/styleId/symbol). */
  fields: string[];
}

export interface FeatureCatalogDiff {
  added: string[];
  removed: string[];
  changed: CatalogDefinitionChange[];
  unchanged: string[];
}

const keyOf = (def: FeatureDefinition): string => def.id.trim() || canonicalizeCode(def.code);

const changedFieldsOf = (before: FeatureDefinition, after: FeatureDefinition): string[] => {
  const fields: string[] = [];
  if (canonicalizeCode(before.code) !== canonicalizeCode(after.code)) fields.push('code');
  if (before.description !== after.description) fields.push('description');
  if (before.layer !== after.layer) fields.push('layer');
  if ((before.pointStyleId ?? '') !== (after.pointStyleId ?? '')) fields.push('pointStyle');
  if ((before.labelStyleId ?? '') !== (after.labelStyleId ?? '')) fields.push('labelStyle');
  if ((before.pointSymbolId ?? '') !== (after.pointSymbolId ?? '')) fields.push('pointSymbol');
  if ((before.styleId ?? '') !== (after.styleId ?? '')) fields.push('style');
  if (before.pointBehavior !== after.pointBehavior) fields.push('point');
  if (
    before.lineworkBehavior.enabled !== after.lineworkBehavior.enabled ||
    before.lineworkBehavior.implicitContinuation !== after.lineworkBehavior.implicitContinuation
  ) {
    fields.push('linework');
  }
  if (JSON.stringify(sortedAttributes(before.defaultAttributes)) !== JSON.stringify(sortedAttributes(after.defaultAttributes))) {
    fields.push('attributes');
  }
  return fields;
};

/**
 * Pure diff by stable definition id (fallback: canonical code). Aliases are
 * compared as a set — any alias add/remove counts as a single pseudo-change
 * entry with id '(aliases)'. All lists are sorted for determinism.
 */
export const diffFeatureCatalogs = (
  current: FeatureCodeCatalog,
  incoming: FeatureCodeCatalog,
): FeatureCatalogDiff => {
  const before = new Map(current.definitions.map((def) => [keyOf(def), def]));
  const after = new Map(incoming.definitions.map((def) => [keyOf(def), def]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: CatalogDefinitionChange[] = [];
  const unchanged: string[] = [];
  for (const [key, next] of after) {
    const prev = before.get(key);
    if (!prev) {
      added.push(key);
      continue;
    }
    const fields = changedFieldsOf(prev, next);
    if (fields.length > 0) changed.push({ id: key, fields });
    else unchanged.push(key);
  }
  for (const key of before.keys()) {
    if (!after.has(key)) removed.push(key);
  }
  const normAliases = (catalog: FeatureCodeCatalog): string =>
    JSON.stringify(
      catalog.aliases
        .map((alias) => `${canonicalizeCode(alias.alias)}->${canonicalizeCode(alias.targetCode)}`)
        .sort(),
    );
  const aliasChanged = normAliases(current) !== normAliases(incoming);
  added.sort();
  removed.sort();
  unchanged.sort();
  changed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (aliasChanged) changed.push({ id: '(aliases)', fields: ['aliases'] });
  return { added, removed, changed, unchanged };
};
