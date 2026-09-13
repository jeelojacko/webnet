/**
 * Phase 12J.0 — zero-dependency parser for a Trimble TBC per-session
 * baseline processing report (e.g. 292d3b4c.7.html). Evidence tooling only:
 * string/regex scans, no DOM. Provenance only — never reproduces
 * carrier-phase processing.
 *
 * Tolerant by design: absent fields yield null, never throws (boolean
 * `ok` reports whether the session/observation identity was found).
 */

export interface TbcSessionCovariance {
  readonly xx: number;
  readonly xy: number;
  readonly xz: number;
  readonly yy: number;
  readonly yz: number;
  readonly zz: number;
}

export interface TbcBaselineSession {
  readonly ok: boolean;
  readonly sessionLabel: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly solutionId: string | null;
  readonly solutionType: string | null;
  readonly startGps: string | null;
  readonly stopGps: string | null;
  readonly durationSec: number | null;
  readonly intervalSec: number | null;
  readonly dX: number | null;
  readonly dY: number | null;
  readonly dZ: number | null;
  readonly horizPrecision: number | null;
  readonly vertPrecision: number | null;
  readonly rms: number | null;
  readonly ephemeris: string | null;
  readonly antennaModel: string | null;
  readonly covariance: TbcSessionCovariance | null;
}

const textLines = (html: string): string[] =>
  html
    // TBC renders the delta symbol as <font face="Symbol">D</font>X;
    // without the space the vector labels would split across lines.
    .replace(/<font[^>]*>D<\/font>/gi, 'D ')
    .replace(/<[^>]*>/g, '\n')
    .replace(/&nbsp;|\xa0/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);

const fieldAfter = (lines: string[], label: string): string | null => {
  const index = lines.indexOf(label);
  return index === -1 ? null : (lines[index + 1] ?? null);
};

const parseMetres = (text: string | null): number | null => {
  if (!text) return null;
  const value = Number.parseFloat(text.replace(/m.*$/, '').trim());
  return Number.isFinite(value) ? value : null;
};

const parseDurationSec = (text: string | null): number | null => {
  const match = /^(\d+):(\d{2}):(\d{2})$/.exec((text ?? '').trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
};

const parseIntervalSec = (text: string | null): number | null => {
  const match = /^([\d.]+)\s*seconds?$/.exec((text ?? '').trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

/**
 * Aposteriori covariance block layout (lower triangle, Meter^2):
 *   X / Y / Z / X <xx> / Y <xy> <yy> / Z <xz> <yz> <zz>
 */
const parseCovariance = (lines: string[]): TbcSessionCovariance | null => {
  const anchor = lines.indexOf('Aposteriori Covariance Matrix');
  if (anchor === -1) return null;
  // Row-wise lower triangle: X <xx> / Y <xy> <yy> / Z <xz> <yz> <zz>.
  // The stray '2' from "(Meter^2)" never matches a row header, so it
  // cannot pollute the values.
  const values: number[] = [];
  const expected: Record<string, number> = { X: 1, Y: 2, Z: 3 };
  const window = lines.slice(anchor + 1, anchor + 20);
  for (let i = 0; i < window.length && values.length < 6; i += 1) {
    const header = window[i] ?? '';
    const count = expected[header];
    if (count === undefined) continue;
    // Column-header X/Y/Z is followed by non-numerics; only a true
    // row header is followed by exactly `count` numeric cells.
    const raws = window.slice(i + 1, i + 1 + count);
    if (raws.length < count || !raws.every((raw) => Number.isFinite(Number.parseFloat(raw)))) continue;
    values.push(...raws.map(Number.parseFloat));
    i += count;
  }
  if (values.length !== 6) return null;
  const [xx, xy, yy, xz, yz, zz] = values as [number, number, number, number, number, number];
  return { xx, xy, xz, yy, yz, zz };
};

/** Parse one TBC per-session baseline processing report. */
export const parseTbcBaselineProcessingReport = (html: string): TbcBaselineSession => {
  const lines = textLines(html);
  const sessionIndex = lines.indexOf('Session Details');
  const sessionLabel = sessionIndex === -1 ? null : (lines[sessionIndex + 1] ?? null);
  const observation = lines.find((line) => /.+---.+\(B\d+\)/.test(line)) ?? null;
  const obsMatch = /(.+?)\s*---\s*(.+?)\s*\((B\d+)\)/.exec(observation ?? '');
  return {
    ok: sessionLabel !== null && obsMatch !== null,
    sessionLabel,
    from: obsMatch?.[1]?.trim() ?? null,
    to: obsMatch?.[2]?.trim() ?? null,
    solutionId: obsMatch?.[3] ?? null,
    solutionType: fieldAfter(lines, 'Solution Type:'),
    startGps: fieldAfter(lines, 'Processing Start Time:'),
    stopGps: fieldAfter(lines, 'Processing Stop Time:'),
    durationSec: parseDurationSec(fieldAfter(lines, 'Processing Duration:')),
    intervalSec: parseIntervalSec(fieldAfter(lines, 'Processing interval:')),
    dX: parseMetres(fieldAfter(lines, 'D X')),
    dY: parseMetres(fieldAfter(lines, 'D Y')),
    dZ: parseMetres(fieldAfter(lines, 'D Z')),
    horizPrecision: parseMetres(fieldAfter(lines, 'Horizontal Precision:')),
    vertPrecision: parseMetres(fieldAfter(lines, 'Vertical Precision:')),
    rms: parseMetres(fieldAfter(lines, 'RMS:')),
    ephemeris: fieldAfter(lines, 'Ephemeris used:'),
    antennaModel: fieldAfter(lines, 'Antenna Model:'),
    covariance: parseCovariance(lines),
  };
};
