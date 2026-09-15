/**
 * FXL_SUPPORTED_SUBSET
 *
 * Trimble FXL (.fxl XML, SchemaVersion up to 9) -> FeatureCodeCatalog adapter.
 * Vendor-to-neutral ONLY: the core never consumes FXL directly; this module
 * converts supported FXL definitions into the neutral catalog model.
 *
 * Supported subset: PointFeatureDefinition -> point definition,
 * LineFeatureDefinition -> linework-enabled definition, Attributes
 * (String/Integer/Double/List with EntryMethod/DefaultValue) ->
 * defaultAttributes, Name -> description (Description element/attribute when
 * present, else the Name itself). Anything else is ignored with a warning and
 * never fails the import. SchemaVersion > 9 is rejected (FXL_UNSUPPORTED).
 */
import type { FeatureCodeCatalog, FeatureDefinition } from './featureCatalog';
import { canonicalizeCode } from './codeMatching';

export const FXL_MAX_SCHEMA_VERSION = 9;
/** ponytail: flat caps, raise only with evidence of larger real-world libraries. */
export const FXL_MAX_FILE_CHARS = 2_000_000;
export const FXL_MAX_DEFINITIONS = 2000;
export const FXL_MAX_NAME_LEN = 64;
export const FXL_MAX_DESCRIPTION_LEN = 255;
export const FXL_MAX_ATTR_NAME_LEN = 64;
export const FXL_MAX_ATTR_VALUE_LEN = 255;
export const FXL_MAX_LIST_ENTRIES = 100;

export type FxlVerdict = 'FXL_SUPPORTED_SUBSET' | 'FXL_UNSUPPORTED';

export interface FxlAdapterIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface FxlAdapterResult {
  catalog: FeatureCodeCatalog | null;
  issues: FxlAdapterIssue[];
  verdict: FxlVerdict;
}

const trunc = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max) : value;

const parseAttrs = (tag: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag)) !== null) {
    attrs[match[1] ?? ''] = match[3] ?? match[4] ?? '';
  }
  return attrs;
};

const attrName = (attrs: Record<string, string>): string =>
  attrs['Name'] ?? attrs['name'] ?? '';

interface FxlAttribute {
  name: string;
  defaultValue?: string;
}

/** Collect supported attributes from a definition's inner XML. */
const collectAttributes = (
  innerXml: string,
  defName: string,
  issues: FxlAdapterIssue[],
): Record<string, string> | undefined => {
  const out: Record<string, string> = {};
  const attrRe = /<(\w*Attribute)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(innerXml)) !== null) {
    const parsed = parseFxlAttribute(match[1] ?? '', match[2] ?? '', match[4] ?? '', defName, issues);
    if (parsed && !(parsed.name in out)) out[parsed.name] = parsed.defaultValue ?? '';
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const parseFxlAttribute = (
  tag: string,
  attrText: string,
  innerXml: string,
  defName: string,
  issues: FxlAdapterIssue[],
): FxlAttribute | null => {
  const attrs = parseAttrs(attrText);
  const rawName = attrName(attrs) || attrs['ID'] || '';
  if (!rawName.trim()) {
    issues.push({ severity: 'warning', message: `Definition "${defName}" has an unnamed attribute; skipped.` });
    return null;
  }
  const name = trunc(rawName.trim(), FXL_MAX_ATTR_NAME_LEN);
  const kind = tag.toLowerCase();
  if (kind.startsWith('list')) {
    const entries: string[] = [];
    const entryRe = /<(ListEntry|Entry|Value)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
    let entry: RegExpExecArray | null;
    while ((entry = entryRe.exec(innerXml)) !== null && entries.length < FXL_MAX_LIST_ENTRIES) {
      const ea = parseAttrs(entry[2] ?? '');
      entries.push(ea['Value'] ?? ea['value'] ?? (entry[4] ?? '').trim());
    }
    const def = attrs['DefaultValue'] ?? attrs['defaultValue'] ?? entries[0] ?? '';
    return { name, defaultValue: trunc(def, FXL_MAX_ATTR_VALUE_LEN) };
  }
  const def = attrs['DefaultValue'] ?? attrs['defaultValue'] ?? attrs['Default'] ?? attrs['Value'] ?? '';
  return { name, defaultValue: trunc(def, FXL_MAX_ATTR_VALUE_LEN) };
}

const buildDefinition = (
  kind: 'point' | 'line',
  name: string,
  innerXml: string,
  issues: FxlAdapterIssue[],
): FeatureDefinition => {
  const code = trunc(name.trim(), FXL_MAX_NAME_LEN);
  const descMatch = /<(Description|Desc)\b[^>]*>([\s\S]*?)<\/\1>/.exec(innerXml);
  const attrText = /<(Description|Desc)\b([^>]*?)\/>/.exec(innerXml);
  const rawDesc = (descMatch?.[2] ?? (attrText ? parseAttrs(attrText[2] ?? '')['Value'] ?? '' : '')).trim();
  const description = trunc(rawDesc || code, FXL_MAX_DESCRIPTION_LEN);
  const def: FeatureDefinition = {
    id: `fxl-${canonicalizeCode(code).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    code,
    description,
    layer: `F2F-${canonicalizeCode(code)}`,
    pointBehavior: kind === 'point' ? 'point' : 'none',
    lineworkBehavior: { enabled: kind === 'line', implicitContinuation: false },
  };
  const defaultAttributes = collectAttributes(innerXml, code, issues);
  if (defaultAttributes) def.defaultAttributes = defaultAttributes;
  return def;
};

/** Convert an FXL library document to a neutral feature-code catalog. */
export const parseFxlLibrary = (xml: string, sourceName = 'library.fxl'): FxlAdapterResult => {
  const issues: FxlAdapterIssue[] = [];
  if (xml.length > FXL_MAX_FILE_CHARS) {
    return {
      catalog: null,
      issues: [{ severity: 'error', message: `${sourceName} exceeds ${FXL_MAX_FILE_CHARS} characters.` }],
      verdict: 'FXL_UNSUPPORTED',
    };
  }
  const rootMatch = /<FeatureCodeLibrary\b([^>]*)>/.exec(xml);
  if (!rootMatch) {
    return {
      catalog: null,
      issues: [{ severity: 'error', message: `${sourceName} is not an FXL FeatureCodeLibrary document.` }],
      verdict: 'FXL_UNSUPPORTED',
    };
  }
  const rootAttrs = parseAttrs(rootMatch[1] ?? '');
  const schemaVersion = Number(rootAttrs['SchemaVersion'] ?? rootAttrs['schemaVersion'] ?? NaN);
  if (!Number.isFinite(schemaVersion)) {
    return {
      catalog: null,
      issues: [{ severity: 'error', message: `${sourceName} has no readable SchemaVersion.` }],
      verdict: 'FXL_UNSUPPORTED',
    };
  }
  if (schemaVersion > FXL_MAX_SCHEMA_VERSION) {
    return {
      catalog: null,
      issues: [{ severity: 'error', message: `${sourceName} SchemaVersion ${schemaVersion} exceeds supported ${FXL_MAX_SCHEMA_VERSION}.` }],
      verdict: 'FXL_UNSUPPORTED',
    };
  }
  const defRe = /<(PointFeatureDefinition|LineFeatureDefinition)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  const definitions: FeatureDefinition[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = defRe.exec(xml)) !== null) {
    const attrs = parseAttrs(match[2] ?? '');
    const name = attrName(attrs);
    if (!name.trim()) {
      issues.push({ severity: 'warning', message: 'Unnamed feature definition skipped.' });
      continue;
    }
    if (definitions.length >= FXL_MAX_DEFINITIONS) {
      issues.push({ severity: 'error', message: `Definition cap ${FXL_MAX_DEFINITIONS} reached; remaining definitions dropped.` });
      break;
    }
    const key = canonicalizeCode(name);
    if (seen.has(key)) {
      issues.push({ severity: 'warning', message: `Duplicate definition "${name}"; first wins.` });
      continue;
    }
    seen.add(key);
    definitions.push(
      buildDefinition(match[1] === 'LineFeatureDefinition' ? 'line' : 'point', name, match[4] ?? '', issues),
    );
  }
  if (definitions.length === 0) {
    return {
      catalog: null,
      issues: [...issues, { severity: 'error', message: `${sourceName} contains no usable feature definitions.` }],
      verdict: 'FXL_UNSUPPORTED',
    };
  }
  const libName = rootAttrs['Name'] ?? rootAttrs['name'] ?? 'fxl-import';
  return {
    catalog: {
      id: 'fxl-import',
      name: trunc(libName, FXL_MAX_DESCRIPTION_LEN),
      version: String(schemaVersion),
      definitions,
      aliases: [],
    },
    issues,
    verdict: 'FXL_SUPPORTED_SUBSET',
  };
};
