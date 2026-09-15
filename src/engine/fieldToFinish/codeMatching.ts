/**
 * Exact-token code matching. Canonical form is trimmed text; comparison is
 * case-insensitive by default. No prefix matching: `EP` never matches `EP2`.
 * Catalogs are indexed once by canonical code/alias (O(1) lookup, no O(n*m)
 * scan per point).
 */

export interface CodeAlias {
  alias: string;
  targetCode: string;
}

export interface IndexableDefinition {
  id: string;
  code: string;
}

export const canonicalizeCode = (raw: string, caseSensitive = false): string => {
  const trimmed = raw.trim();
  return caseSensitive ? trimmed : trimmed.toUpperCase();
};

/** Index canonical code/alias -> definition id. First entry wins on collision. */
export const buildCodeIndex = (
  definitions: IndexableDefinition[],
  aliases: CodeAlias[],
  caseSensitive = false,
): Map<string, string> => {
  const index = new Map<string, string>();
  for (const def of definitions) {
    const key = canonicalizeCode(def.code, caseSensitive);
    if (!index.has(key)) index.set(key, def.id);
  }
  for (const alias of aliases) {
    const key = canonicalizeCode(alias.alias, caseSensitive);
    if (index.has(key)) continue;
    const target = definitions.find(
      (def) => canonicalizeCode(def.code, caseSensitive) === canonicalizeCode(alias.targetCode, caseSensitive),
    );
    if (target) index.set(key, target.id);
  }
  return index;
};

/** Exact token match against a prebuilt index. Returns the definition id. */
export const matchCodeToken = (
  token: string,
  index: ReadonlyMap<string, string>,
  caseSensitive = false,
): string | undefined => index.get(canonicalizeCode(token, caseSensitive));
