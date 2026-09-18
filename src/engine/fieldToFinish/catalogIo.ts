/**
 * WebNet catalog JSON export/import with schema versioning, stable ids,
 * validation, and duplicate-code handling. Round-trip preserves semantic
 * identity (same canonical codes, aliases, and behaviors).
 *
 * Control-token alias adapter: vendor profiles map short tokens (e.g.
 * `B` -> BEGIN, `E` -> END, `CLS` -> CLOSE) to canonical controls. The core
 * stores canonical `FieldLineworkControl` values only.
 */
import { FieldLineworkControl } from './featureMetadata';
import { canonicalizeCode, type CodeAlias } from './codeMatching';
import type { FeatureCodeCatalog, FeatureDefinition } from './featureCatalog';

export const CATALOG_SCHEMA_VERSION = 1;

/**
 * Phase 18E drawing-owned F2F settings. Home is CadProject
 * (`fieldToFinishSettings`), cloned/backfilled like the catalog. Kept OUT
 * of the catalog JSON (no catalog schema bump) — control-token aliases are
 * drawing preferences, not catalog semantic content, and never enter the
 * catalog revision hash.
 */
export interface FieldToFinishSettings {
  controlTokenAliases?: ControlTokenAliasProfile;
}

export const cloneFieldToFinishSettings = (
  settings: FieldToFinishSettings | undefined,
): FieldToFinishSettings | undefined =>
  settings === undefined
    ? undefined
    : settings.controlTokenAliases === undefined
      ? { ...settings }
      : { ...settings, controlTokenAliases: { ...settings.controlTokenAliases } };

export type ControlTokenAliasProfile = Record<string, string>;

const CANONICAL_CONTROLS = new Set<string>(Object.values(FieldLineworkControl));

export interface CatalogValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCatalogPayload = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && value['schema'] === 'webnet.feature-catalog';

/** Map a vendor control token to its canonical control via an alias profile. */
export const resolveControlToken = (
  token: string,
  aliasProfile: ControlTokenAliasProfile = {},
): FieldLineworkControl | undefined => {
  const trimmed = token.trim();
  if (CANONICAL_CONTROLS.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase() as FieldLineworkControl;
  }
  const mapped = aliasProfile[trimmed] ?? aliasProfile[trimmed.toUpperCase()];
  if (mapped && CANONICAL_CONTROLS.has(mapped.toUpperCase())) {
    return mapped.toUpperCase() as FieldLineworkControl;
  }
  return undefined;
};

const validateDefinition = (def: FeatureDefinition, issues: CatalogValidationIssue[]): void => {
  if (!def.id.trim() || !def.code.trim()) {
    issues.push({ severity: 'error', message: `Definition missing id/code: ${JSON.stringify(def.id ?? '')}` });
  }
  if (!def.layer.trim()) {
    issues.push({ severity: 'error', message: `Definition ${def.id} missing layer.` });
  }
};

/**
 * Validate catalog. Errors: missing id/code/layer, duplicate definition
 * ids, duplicate canonical codes (first wins), alias missing
 * alias/targetCode, duplicate canonical aliases, aliases shadowing a
 * definition code, aliases targeting an unknown definition code.
 * Unresolved drawing style refs are NOT checked here — they stay WARNINGS
 * via validateCatalogStyleReferences, never import-blocking errors.
 */
export const validateCatalog = (catalog: FeatureCodeCatalog): CatalogValidationIssue[] => {
  const issues: CatalogValidationIssue[] = [];
  const seenIds = new Set<string>();
  const seen = new Map<string, string>();
  for (const def of catalog.definitions) {
    validateDefinition(def, issues);
    if (def.id.trim()) {
      if (seenIds.has(def.id)) {
        issues.push({ severity: 'error', message: `Duplicate definition id "${def.id}".` });
      } else {
        seenIds.add(def.id);
      }
    }
    const key = canonicalizeCode(def.code);
    const prior = seen.get(key);
    if (prior !== undefined) {
      issues.push({ severity: 'error', message: `Duplicate code "${def.code}" (ids ${prior}, ${def.id}); first wins.` });
    } else {
      seen.set(key, def.id);
    }
  }
  const definitionCodes = new Set(seen.keys());
  const seenAliases = new Set<string>();
  for (const alias of catalog.aliases) {
    if (!alias.alias.trim() || !alias.targetCode.trim()) {
      issues.push({ severity: 'error', message: 'Alias missing alias/targetCode.' });
      continue;
    }
    const key = canonicalizeCode(alias.alias);
    if (seenAliases.has(key)) {
      issues.push({ severity: 'error', message: `Duplicate alias "${alias.alias}".` });
    } else {
      seenAliases.add(key);
    }
    if (definitionCodes.has(key)) {
      issues.push({ severity: 'error', message: `Alias "${alias.alias}" shadows a definition code; definitions win.` });
    }
    if (!definitionCodes.has(canonicalizeCode(alias.targetCode))) {
      issues.push({ severity: 'error', message: `Alias "${alias.alias}" targets unknown code "${alias.targetCode}".` });
    }
  }
  return issues;
};

const parseDefinition = (raw: unknown): FeatureDefinition | null => {
  if (!isRecord(raw)) return null;
  if (typeof raw['id'] !== 'string' || typeof raw['code'] !== 'string') return null;
  const linework = isRecord(raw['lineworkBehavior'])
    ? raw['lineworkBehavior']
    : {};
  const attrs = isRecord(raw['defaultAttributes']) ? raw['defaultAttributes'] : undefined;
  const cleanAttrs: Record<string, string> | undefined = attrs
    ? Object.fromEntries(
        Object.entries(attrs).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    : undefined;
  return {
    id: raw['id'],
    code: raw['code'],
    description: typeof raw['description'] === 'string' ? raw['description'] : '',
    layer: typeof raw['layer'] === 'string' ? raw['layer'] : '',
    pointSymbolId: typeof raw['pointSymbolId'] === 'string' ? raw['pointSymbolId'] : undefined,
    styleId: typeof raw['styleId'] === 'string' ? raw['styleId'] : undefined,
    pointStyleId: typeof raw['pointStyleId'] === 'string' ? raw['pointStyleId'] : undefined,
    labelStyleId: typeof raw['labelStyleId'] === 'string' ? raw['labelStyleId'] : undefined,
    pointBehavior: raw['pointBehavior'] === 'none' ? 'none' : 'point',
    lineworkBehavior: {
      enabled: linework['enabled'] === true,
      implicitContinuation: linework['implicitContinuation'] === true,
    },
    ...(cleanAttrs ? { defaultAttributes: cleanAttrs } : {}),
  };
};

export interface ImportCatalogResult {
  catalog: FeatureCodeCatalog | null;
  issues: CatalogValidationIssue[];
}

export const exportCatalog = (catalog: FeatureCodeCatalog): string =>
  JSON.stringify(
    {
      schema: 'webnet.feature-catalog',
      schemaVersion: CATALOG_SCHEMA_VERSION,
      id: catalog.id,
      name: catalog.name,
      version: catalog.version,
      definitions: catalog.definitions,
      aliases: catalog.aliases,
    },
    null,
    2,
  );

export const importCatalog = (json: string): ImportCatalogResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return { catalog: null, issues: [{ severity: 'error', message: 'Invalid JSON.' }] };
  }
  if (!isCatalogPayload(parsed)) {
    return { catalog: null, issues: [{ severity: 'error', message: 'Not a webnet.feature-catalog document.' }] };
  }
  if (parsed['schemaVersion'] !== CATALOG_SCHEMA_VERSION) {
    return {
      catalog: null,
      issues: [{ severity: 'error', message: `Unsupported schemaVersion ${String(parsed['schemaVersion'])}.` }],
    };
  }
  const definitions = Array.isArray(parsed['definitions'])
    ? parsed['definitions'].map(parseDefinition).filter((d): d is FeatureDefinition => d !== null)
    : [];
  const aliases: CodeAlias[] = Array.isArray(parsed['aliases'])
    ? parsed['aliases']
        .filter(isRecord)
        .filter((a) => typeof a['alias'] === 'string' && typeof a['targetCode'] === 'string')
        .map((a) => ({ alias: a['alias'] as string, targetCode: a['targetCode'] as string }))
    : [];
  const catalog: FeatureCodeCatalog = {
    id: typeof parsed['id'] === 'string' ? parsed['id'] : '',
    name: typeof parsed['name'] === 'string' ? parsed['name'] : '',
    version: typeof parsed['version'] === 'string' ? parsed['version'] : '',
    definitions,
    aliases,
  };
  const issues = validateCatalog(catalog);
  if (issues.some((issue) => issue.severity === 'error')) return { catalog: null, issues };
  return { catalog, issues };
};

/**
 * Phase 18D: unresolved style refs against a drawing's tables. Import
 * itself always succeeds (refs pass through); the caller surfaces these
 * warnings and generation falls back deterministically (never crashes).
 * Tables absent = unknown drawing, no warnings (cannot validate).
 */
export interface CatalogStyleTables {
  pointStyles?: ReadonlyArray<{ id: string }>;
  labelStyles?: ReadonlyArray<{ id: string }>;
  pointSymbols?: ReadonlyArray<{ id: string }>;
}

export const validateCatalogStyleReferences = (
  catalog: FeatureCodeCatalog,
  tables: CatalogStyleTables,
): CatalogValidationIssue[] => {
  const issues: CatalogValidationIssue[] = [];
  const has = (list: ReadonlyArray<{ id: string }> | undefined, id: string): boolean | undefined =>
    list == null ? undefined : list.some((entry) => entry.id === id);
  for (const def of catalog.definitions) {
    if (def.pointStyleId && has(tables.pointStyles, def.pointStyleId) === false) {
      issues.push({ severity: 'warning', message: `Definition ${def.id} references unknown point style "${def.pointStyleId}"; drawing default applies.` });
    }
    if (def.labelStyleId && has(tables.labelStyles, def.labelStyleId) === false) {
      issues.push({ severity: 'warning', message: `Definition ${def.id} references unknown label style "${def.labelStyleId}"; F2F Full compat applies.` });
    }
    if (def.pointSymbolId && has(tables.pointSymbols, def.pointSymbolId) === false) {
      issues.push({ severity: 'warning', message: `Definition ${def.id} references unknown point symbol "${def.pointSymbolId}"; point-free fallback applies.` });
    }
  }
  return issues;
};

/** Semantic identity: same canonical codes, aliases, layers, and behaviors. */
export const catalogsSemanticallyEqual = (a: FeatureCodeCatalog, b: FeatureCodeCatalog): boolean => {
  const normDefs = (catalog: FeatureCodeCatalog): string[] =>
    catalog.definitions
      .map((def) =>
        [
          canonicalizeCode(def.code),
          def.layer,
          def.pointSymbolId ?? '',
          def.styleId ?? '',
          def.pointStyleId ?? '',
          def.labelStyleId ?? '',
          def.pointBehavior,
          String(def.lineworkBehavior.enabled),
          String(def.lineworkBehavior.implicitContinuation),
          JSON.stringify(def.defaultAttributes ?? {}),
        ].join('|'),
      )
      .sort();
  const normAliases = (catalog: FeatureCodeCatalog): string[] =>
    catalog.aliases
      .map((alias) => `${canonicalizeCode(alias.alias)}->${canonicalizeCode(alias.targetCode)}`)
      .sort();
  return (
    JSON.stringify(normDefs(a)) === JSON.stringify(normDefs(b)) &&
    JSON.stringify(normAliases(a)) === JSON.stringify(normAliases(b))
  );
};
