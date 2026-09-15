import { resolveControlToken } from '../../engine/fieldToFinish/catalogIo';
import { buildCodeIndex, matchCodeToken } from '../../engine/fieldToFinish/codeMatching';
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';
import type { FieldLineworkControl } from '../../engine/fieldToFinish/featureMetadata';
import type { FieldToFinishCadPoint } from '../../engine/fieldToFinish/cadGeneration';
import { generateLinework } from '../../engine/fieldToFinish/linework';

export interface F2FReviewRow {
  pointId: string;
  x: number;
  y: number;
  rawCode: string;
  codes: string[];
  description: string;
  lineworkControls: string;
  mappingStatus: 'Mapped' | 'Unmapped' | 'No code';
  warnings: string[];
}

export interface F2FReviewSummary {
  total: number;
  mapped: number;
  unmapped: number;
  noCode: number;
  invalidControls: number;
  chains: number;
  lineworkWarnings: number;
  lineworkFailures: number;
}

const splitRawTokens = (raw: string | undefined): string[] =>
  (raw ?? '').trim().split(/\s+/).filter((part) => part.length > 0);

/** Tokens that are neither a catalog code nor a resolvable control token. */
export const findInvalidControlTokens = (
  rawCodeText: string | undefined,
  catalog: FeatureCodeCatalog,
): string[] => {
  const index = buildCodeIndex(catalog.definitions, catalog.aliases);
  return splitRawTokens(rawCodeText).filter((token) => {
    if (matchCodeToken(token, index) !== undefined) return false;
    if (/^[^\d\s]+\d+$/.test(token)) {
      const base = token.replace(/\d+$/, '');
      if (matchCodeToken(base, index) !== undefined) return false;
    }
    if (resolveControlToken(token, {}) !== undefined) return false;
    return true;
  });
};

interface NormalizedReviewCode {
  code: string;
  instance?: string;
  controls: FieldLineworkControl[];
}

/**
 * Split one combined importer entry ("EDGE BEGIN") into code + controls,
 * mirroring the commit path so preview agrees with what commit will do: a
 * segment matching the catalog starts a code, a resolvable control token
 * attaches to the current code, anything else stays an unmatched token.
 * Entries that already carry controls/instance pass through untouched.
 */
const normalizeReviewEntry = (
  entryCode: string,
  givenInstance: string | undefined,
  givenControls: readonly FieldLineworkControl[] | undefined,
  index: ReadonlyMap<string, string>,
): NormalizedReviewCode[] => {
  if (givenControls !== undefined || givenInstance !== undefined) {
    return [{
      code: entryCode,
      ...(givenInstance !== undefined ? { instance: givenInstance } : {}),
      controls: [...(givenControls ?? [])],
    }];
  }
  const parsed: NormalizedReviewCode[] = [];
  for (const segment of splitRawTokens(entryCode)) {
    if (matchCodeToken(segment, index) !== undefined) {
      parsed.push({ code: segment, controls: [] });
      continue;
    }
    const split = /^([^\d\s]+)(\d+)$/.exec(segment);
    if (split?.[1] && matchCodeToken(split[1], index) !== undefined) {
      parsed.push({ code: split[1], ...(split[2] ? { instance: split[2] } : {}), controls: [] });
      continue;
    }
    const control = resolveControlToken(segment, {});
    const current = parsed[parsed.length - 1];
    if (control !== undefined && current !== undefined) {
      current.controls.push(control);
      continue;
    }
    parsed.push({ code: segment, controls: [] });
  }
  return parsed;
};

const normalizedCodesOf = (
  point: FieldToFinishCadPoint,
  index: ReadonlyMap<string, string>,
): NormalizedReviewCode[] =>
  point.codes.flatMap((entry) => normalizeReviewEntry(entry.code, entry.instance, entry.controls, index));

export const buildF2FReviewRows = (
  points: readonly FieldToFinishCadPoint[],
  catalog: FeatureCodeCatalog,
): F2FReviewRow[] => {
  const index = buildCodeIndex(catalog.definitions, catalog.aliases);
  return points.map((point) => {
    const normalized = normalizedCodesOf(point, index);
    const codes = normalized.map((entry) => entry.code);
    const matched = codes.some(
      (code) =>
        matchCodeToken(code, index) !== undefined ||
        (/^[^\d\s]+\d+$/.test(code) && matchCodeToken(code.replace(/\d+$/, ''), index) !== undefined),
    );
    const invalid = findInvalidControlTokens(point.rawCodeText, catalog);
    const warnings: string[] = [];
    if (codes.length > 0 && !matched) warnings.push('Unmapped Code');
    if (invalid.length > 0) warnings.push(`Invalid control: ${invalid.join(', ')}`);
    return {
      pointId: point.stationId,
      x: point.x,
      y: point.y,
      rawCode: point.rawCodeText ?? codes.join(' '),
      codes,
      description: point.description ?? '',
      lineworkControls: normalized.flatMap((entry) => entry.controls).join(', '),
      mappingStatus: codes.length === 0 ? 'No code' : matched ? 'Mapped' : 'Unmapped',
      warnings,
    };
  });
};

export const summarizeF2FReview = (
  points: readonly FieldToFinishCadPoint[],
  catalog: FeatureCodeCatalog,
): F2FReviewSummary => {
  const rows = buildF2FReviewRows(points, catalog);
  const index = buildCodeIndex(catalog.definitions, catalog.aliases);
  const linework = generateLinework(
    points.map((point) => ({
      pointId: point.stationId,
      sourceOrder: point.sourceOrder,
      ...(point.sourceLine !== undefined ? { sourceLine: point.sourceLine } : {}),
      feature: {
        rawCodeText: point.rawCodeText,
        codes: normalizedCodesOf(point, index).map((code) => ({
          code: code.code,
          rawCode: code.code,
          role: 'both' as const,
          ...(code.instance !== undefined ? { instance: code.instance } : {}),
          controls: code.controls,
        })),
        description: point.description,
        sourceOrder: point.sourceOrder,
      },
    })),
    catalog,
  );
  return {
    total: points.length,
    mapped: rows.filter((row) => row.mappingStatus === 'Mapped').length,
    unmapped: rows.filter((row) => row.mappingStatus === 'Unmapped').length,
    noCode: rows.filter((row) => row.mappingStatus === 'No code').length,
    invalidControls: rows.filter((row) =>
      row.warnings.some((warning) => warning.startsWith('Invalid control')),
    ).length,
    chains: linework.chains.length,
    lineworkWarnings: linework.diagnostics.filter((entry) => entry.severity === 'warn').length,
    lineworkFailures: linework.diagnostics.filter((entry) => entry.severity === 'fail').length,
  };
};
