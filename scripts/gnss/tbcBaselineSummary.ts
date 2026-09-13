/**
 * Phase 12E.2 dataset B — zero-dependency parser for a Trimble TBC baseline
 * processing summary (e.g. 292d12a8.html). Evidence tooling only:
 * string/regex scans, no DOM. Provenance only — never reproduces
 * carrier-phase processing.
 *
 * Tolerant by design: every field is null/empty when absent, never throws.
 */

export interface TbcBaselineRow {
  /** Processing ID, e.g. "B16". */
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly solutionType: string;
}

export interface TbcBaselineSummary {
  readonly processed: number | null;
  readonly passed: number | null;
  readonly flagged: number | null;
  readonly failed: number | null;
  readonly rows: TbcBaselineRow[];
}

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|\xa0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const tableRows = (section: string): string[] => {
  const rows: string[] = [];
  const pattern = /<tr[\s>][\s\S]*?(?=<tr[\s>]|<\/table\s*>)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section)) !== null) rows.push(match[0]);
  return rows;
};

const anchorTexts = (rowHtml: string): string[] => {
  const texts: string[] = [];
  const pattern = /<a[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rowHtml)) !== null) texts.push(stripTags(match[1] ?? ''));
  return texts;
};

/** "Observation From To ..." table rows carry "(Bnn)" processing IDs. */
const parseRows = (html: string): TbcBaselineRow[] => {
  const rows: TbcBaselineRow[] = [];
  const start = html.search(/Processing Summary/i);
  const section = start === -1 ? html : html.slice(start);
  for (const row of tableRows(section)) {
    const anchors = anchorTexts(row);
    if (anchors.length < 3) continue;
    const obs = anchors[0] ?? '';
    const bid = /\((B\d+)\)/.exec(obs)?.[1];
    if (!bid) continue;
    const type =
      />\s*(Fixed|Float|Code|DGPS|Autonomous|No solution)\s*</i.exec(row)?.[1] ?? '';
    rows.push({ id: bid, from: anchors[1] ?? '', to: anchors[2] ?? '', solutionType: type });
  }
  return rows;
};

const acceptanceCounts = (html: string): [number | null, number | null, number | null, number | null] => {
  const start = html.search(/Acceptance Summary/i);
  if (start === -1) return [null, null, null, null];
  const section = html.slice(start, start + 2000);
  const nums: number[] = [];
  const pattern = /<t[dh][^>]*>\s*(?:<small>)?\s*(\d+)\s*(?:<\/small>)?\s*<\/t[dh]\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section)) !== null) nums.push(Number(match[1]));
  const [processed = null, passed = null, flagged = null, failed = null] = nums;
  return [processed, passed, flagged, failed];
};

export const parseTbcBaselineSummary = (html: string): TbcBaselineSummary => {
  const [processed, passed, flagged, failed] = acceptanceCounts(html);
  return { processed, passed, flagged, failed, rows: parseRows(html) };
};
