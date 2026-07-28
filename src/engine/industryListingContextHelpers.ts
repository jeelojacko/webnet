import {
  isConcretePathToken,
  pathTokenParent,
  pathTokenStem,
} from './industryListingFormatters';
import type { ReductionUsageSummary } from '../types';

type AliasTraceEntry = {
  canonicalId: string;
  context: string;
  sourceId: string;
  sourceLine?: number;
};

export const formatReductionUsage = (summary?: ReductionUsageSummary): string => {
  if (!summary) return 'unavailable';
  return [
    `bearing[g=${summary.bearing.grid},m=${summary.bearing.measured}]`,
    `angle[g=${summary.angle.grid},m=${summary.angle.measured}]`,
    `direction[g=${summary.direction.grid},m=${summary.direction.measured}]`,
    `distance[ground=${summary.distance.ground},grid=${summary.distance.grid},ellip=${summary.distance.ellipsoidal}]`,
    `total=${summary.total}`,
  ].join('; ');
};

export const parseStochasticDefaultsRows = (
  summary: string,
): Array<{ label: string; value: string }> => {
  const clean = summary.trim();
  if (!clean) return [];
  const keyMatches = Array.from(clean.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9]*)=/g));
  if (keyMatches.length === 0) return [{ label: 'Defaults Summary', value: clean }];
  const keyToLabel: Record<string, string> = {
    inst: 'Instrument',
    dist: 'Distance (const+ppm)',
    hz: 'Horizontal Angle Precision',
    va: 'Vertical Angle Precision',
    centering: 'Centering (inst/tgt)',
    edm: 'EDM Mode',
    centerInflation: 'Centering Inflation',
  };
  const rows: Array<{ label: string; value: string }> = [];
  keyMatches.forEach((match, idx) => {
    const key = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const end =
      idx + 1 < keyMatches.length ? (keyMatches[idx + 1].index ?? clean.length) : clean.length;
    const value = clean.slice(start, end).trim();
    if (!value) return;
    rows.push({ label: keyToLabel[key] ?? `Setting ${key}`, value });
  });
  return rows.length > 0 ? rows : [{ label: 'Defaults Summary', value: clean }];
};

export const buildIndustryListingRenderHelpers = (
  lines: string[],
  aliasTrace: AliasTraceEntry[],
) => {
  const aliasObsRefsByLine = new Map<number, string[]>();
  aliasTrace.forEach((entry) => {
    if (entry.context !== 'observation') return;
    if (entry.sourceLine == null) return;
    const ref = `${entry.sourceId}->${entry.canonicalId}`;
    const list = aliasObsRefsByLine.get(entry.sourceLine) ?? [];
    if (!list.includes(ref)) list.push(ref);
    aliasObsRefsByLine.set(entry.sourceLine, list);
  });
  const aliasRefsForLine = (line?: number): string =>
    line != null && aliasObsRefsByLine.has(line)
      ? ` [alias ${aliasObsRefsByLine.get(line)?.join(', ')}]`
      : '';
  const settingLabelWidth = 37;
  const pushSettingRow = (label: string, value: string): void => {
    lines.push(`${label.padEnd(settingLabelWidth)} : ${value}`);
  };
  const pushTable = (
    headers: string[],
    rows: string[][],
    rightAligned: number[] = [],
    indent = '',
  ): void => {
    if (rows.length === 0) return;
    const right = new Set(rightAligned);
    const widths = headers.map((h, col) =>
      Math.max(
        h.length,
        ...rows.map((row) => {
          const v = row[col] ?? '';
          return v.length;
        }),
      ),
    );
    const formatCell = (value: string, width: number, alignRight: boolean) =>
      alignRight ? value.padStart(width) : value.padEnd(width);
    lines.push(
      `${indent}${headers.map((h, col) => formatCell(h, widths[col], right.has(col))).join('  ')}`,
    );
    rows.forEach((row) => {
      lines.push(
        `${indent}${headers.map((_, col) => formatCell(row[col] ?? '', widths[col], right.has(col))).join('  ')}`,
      );
    });
  };
  return { aliasRefsForLine, pushSettingRow, pushTable };
};

export const resolveIndustryListingProjectSourceContext = ({
  observationSourceFiles,
  projectFolder,
  projectName,
  projectSourceFiles,
  sourceFile,
}: {
  observationSourceFiles: Array<string | undefined>;
  projectFolder?: string;
  projectName?: string;
  projectSourceFiles?: string[];
  sourceFile?: string;
}) => {
  const parsedProjectSourceFiles = Array.from(
    new Set(
      [sourceFile, ...observationSourceFiles].filter((token): token is string =>
        isConcretePathToken(token),
      ),
    ),
  );
  const resolvedProjectSourceFiles =
    projectSourceFiles && projectSourceFiles.length > 0
      ? Array.from(
          new Set(projectSourceFiles.filter((token): token is string => isConcretePathToken(token))),
        )
      : parsedProjectSourceFiles;
  return {
    projectFolder:
      projectFolder?.trim() ||
      (resolvedProjectSourceFiles.length > 0 ? pathTokenParent(resolvedProjectSourceFiles[0]) : ''),
    projectName:
      projectName?.trim() ||
      (resolvedProjectSourceFiles.length > 0 ? pathTokenStem(resolvedProjectSourceFiles[0]) : ''),
    projectSourceFiles: resolvedProjectSourceFiles,
  };
};

export const formatGpsVectorFactorSummary = (
  hasInlineGpsFactorOverride: boolean,
  horizontalFactor: number,
  verticalFactor: number,
): string =>
  hasInlineGpsFactorOverride ||
  (Math.abs(horizontalFactor - 1) <= 1e-12 && Math.abs(verticalFactor - 1) <= 1e-12)
    ? 'None'
    : Math.abs(horizontalFactor - verticalFactor) <= 1e-12
      ? horizontalFactor.toFixed(4)
      : `H=${horizontalFactor.toFixed(4)} V=${verticalFactor.toFixed(4)}`;
