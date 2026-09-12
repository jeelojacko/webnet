/**
 * Phase 12E.2 — zero-dependency parser for a Trimble TBC network-adjustment
 * report (cafa0ac3.html). Evidence tooling only: string/regex scans, no DOM.
 *
 * Tolerant by design: every field is extracted when present and null when
 * absent. Never throws on report problems; `parseTbcReport` always returns.
 */
import { readFileSync } from 'node:fs';

export interface TbcEcefRow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TbcConstrainedStation {
  readonly id: string;
  readonly type: string;
  /** Raw per-axis cells (e.g. "Fixed") for North/East/Height. */
  readonly axes: readonly string[];
}

export interface TbcReport {
  readonly title: string | null;
  readonly projectFile: string | null;
  readonly coordSystem: string | null;
  readonly coordZone: string | null;
  readonly datum: string | null;
  readonly globalDatum: string | null;
  readonly globalEpoch: string | null;
  readonly geoid: string | null;
  readonly units: string | null;
  readonly centeringErr: number | null;
  readonly antennaErr: number | null;
  readonly aprioriScalar: number | null;
  readonly confidenceMode: string | null;
  readonly iterations: number | null;
  readonly refFactor: number | null;
  readonly chiSquareText: string | null;
  readonly dof: number | null;
  readonly gnssRedundancy: number | null;
  readonly constrainedStations: TbcConstrainedStation[];
  readonly constrainedStation: string | null;
  readonly p041Ecef: TbcEcefRow | null;
  readonly ecefRows: TbcEcefRow[];
  /** PVxxx solution IDs from the Adjusted GNSS Observations table, in order. */
  readonly activeObsIds: string[];
}

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|\xa0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Label cell `<...>LABEL[:]</...> <...>(value)` — value raw text or null. */
const labelValue = (html: string, label: string): string | null => {
  const pattern = new RegExp(
    `<[^>]*>\\s*${escapeRegExp(label)}\\s*:?\\s*<\\/[^>]+>\\s*<[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    'i',
  );
  const match = pattern.exec(html);
  if (!match) return null;
  const text = stripTags(match[1] ?? '');
  return text === '' ? null : text;
};

const labelNumber = (html: string, label: string): number | null => {
  const raw = labelValue(html, label);
  if (raw == null) return null;
  const match = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.replace(/,/g, ''));
  return match ? Number(match[0]) : null;
};

/** Section HTML between an <h2> heading and the next <h2> (or EOF). */
const sectionHtml = (html: string, heading: string): string => {
  const start = html.search(new RegExp(`<h2[^>]*>\\s*${heading}`, 'i'));
  if (start === -1) return '';
  const next = html.slice(start + 100).search(/<h2[^>]*>/i);
  return next === -1 ? html.slice(start) : html.slice(start, start + 100 + next);
};

const anchorIds = (rowHtml: string): string[] => {
  const ids: string[] = [];
  const pattern = /<a[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rowHtml)) !== null) ids.push(stripTags(match[1] ?? ''));
  return ids;
};

const rightTexts = (rowHtml: string): string[] => {
  const values: string[] = [];
  const pattern = /align\s*=\s*["']?right["']?[^>]*>([\s\S]*?)<\/t[dh][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rowHtml)) !== null) values.push(stripTags(match[1] ?? ''));
  return values;
};

const tableRows = (section: string): string[] => {
  const rows: string[] = [];
  const pattern = /<tr[\s>][\s\S]*?<\/tr\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section)) !== null) rows.push(match[0]);
  return rows;
};

const parseEcefRows = (html: string): TbcEcefRow[] => {
  const rows: TbcEcefRow[] = [];
  tableRows(sectionHtml(html, 'Adjusted ECEF Coordinates')).forEach((row) => {
    const ids = anchorIds(row);
    if (ids.length === 0) return;
    // Cells alternate value/error: X, Xerr, Y, Yerr, Z, Zerr, 3Derr.
    // Error cells may hold "?" (fixed stations), so parse by position.
    const cells = rightTexts(row);
    if (cells.length < 5) return;
    const num = (text: string | undefined): number | null => {
      const m = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec((text ?? '').replace(/,/g, ''));
      return m ? Number(m[0]) : null;
    };
    const x = num(cells[0]);
    const y = num(cells[2]);
    const z = num(cells[4]);
    if (x == null || y == null || z == null) return;
    rows.push({ id: ids[0] ?? '', x, y, z });
  });
  return rows;
};

const parseConstrained = (html: string): TbcConstrainedStation[] => {
  const stations: TbcConstrainedStation[] = [];
  tableRows(sectionHtml(html, 'Control Point Constraints')).forEach((row) => {
    const ids = anchorIds(row);
    if (ids.length === 0) return;
    const cells = rightTexts(row);
    const left = stripTags(
      (/align\s*=\s*["']?center["']?[^>]*>([\s\S]*?)<\/t[dh][^>]*>/i.exec(row)?.[1] ?? '').toString(),
    );
    stations.push({ id: ids[0] ?? '', type: left, axes: cells.slice(0, 3) });
  });
  return stations;
};

const parseActiveObsIds = (html: string): string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();
  tableRows(sectionHtml(html, 'Adjusted GNSS Observations')).forEach((row) => {
    anchorIds(row).forEach((text) => {
      const match = /\((PV\d+)\)/.exec(text);
      if (match && !seen.has(match[1] ?? '')) {
        seen.add(match[1] ?? '');
        ids.push(match[1] ?? '');
      }
    });
  });
  return ids;
};

export const parseTbcReport = (html: string): TbcReport => {
  const ecefRows = parseEcefRows(html);
  const constrainedStations = parseConstrained(html);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const projectFile = labelValue(html, 'Name');
  // The first "Name:" row is the project file path; the coordinate system
  // block repeats "Name:" later, so scope system/zone lookups past it.
  const coordScopeIndex = html.search(/Coordinate System<\/B>/i);
  const coordScope = coordScopeIndex === -1 ? html : html.slice(coordScopeIndex);
  return {
    title: titleMatch ? stripTags(titleMatch[1] ?? '') : null,
    projectFile,
    coordSystem: labelValue(coordScope, 'Name'),
    coordZone: labelValue(coordScope, 'Zone'),
    datum: labelValue(html, 'Datum'),
    globalDatum: labelValue(html, 'Global reference datum'),
    globalEpoch: labelValue(html, 'Global reference epoch'),
    geoid: labelValue(html, 'Geoid'),
    units: labelValue(html, 'Units'),
    centeringErr: labelNumber(html, 'Centering Error'),
    antennaErr: labelNumber(html, 'Error in Height of Antenna'),
    aprioriScalar: labelNumber(html, 'A Priori Scalar'),
    confidenceMode: labelValue(html, 'Precision Confidence Level'),
    iterations: labelNumber(html, 'Number of Iterations for Successful Adjustment'),
    refFactor: labelNumber(html, 'Network Reference Factor') ?? labelNumber(html, 'Reference Factor'),
    chiSquareText: labelValue(html, 'Chi Square Test (95%)'),
    dof: labelNumber(html, 'Degrees of Freedom'),
    gnssRedundancy: labelNumber(html, 'Redundancy Number'),
    constrainedStations,
    constrainedStation: constrainedStations.length > 0 ? (constrainedStations[0]?.id ?? null) : null,
    p041Ecef: ecefRows.find((row) => row.id === 'P041') ?? null,
    ecefRows,
    activeObsIds: parseActiveObsIds(html),
  };
};

const main = (): void => {
  const path = process.argv[2];
  if (!path) {
    console.log('tbcAdjustmentReport: pass a TBC report .html path; prints parsed summary JSON.');
    process.exit(0);
  }
  const report = parseTbcReport(readFileSync(path, 'utf8'));
  console.log(
    JSON.stringify({
      title: report.title,
      projectFile: report.projectFile,
      coordSystem: report.coordSystem,
      datum: report.datum,
      globalDatum: report.globalDatum,
      geoid: report.geoid,
      iterations: report.iterations,
      refFactor: report.refFactor,
      chiSquareText: report.chiSquareText,
      dof: report.dof,
      gnssRedundancy: report.gnssRedundancy,
      aprioriScalar: report.aprioriScalar,
      confidenceMode: report.confidenceMode,
      constrainedStation: report.constrainedStation,
      p041Ecef: report.p041Ecef,
      ecefRowCount: report.ecefRows.length,
      activeObsCount: report.activeObsIds.length,
    }),
  );
};

if (process.argv[1] != null && process.argv[1].endsWith('tbcAdjustmentReport.ts')) main();
