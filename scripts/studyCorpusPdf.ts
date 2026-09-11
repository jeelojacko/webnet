/**
 * Phase 4C PDF/content normalization helpers.
 *
 * Pure string/geometry transforms for the official-PDF branch of the SIT
 * corpus pipeline (scripts/studyCorpus.ts). No pdfjs dependency here: callers
 * map pdfjs text items to PdfItemGeometry (x/width/y in viewport units at
 * scale 1, plus raw text) and these helpers do the rest.
 *
 * Three fixes, all conservative:
 *
 * 1. Geometry-aware row reconstruction. pdfjs emits one item per typeset run
 *    plus explicit " " space items, so joining every item with a space fakes
 *    intra-word spaces ("Ann ual", "p erson", "registra tion"). Items whose
 *    gap is at most INTRA_WORD_MAX_GAP points are joined directly; genuine
 *    word pitch in these documents is ~7pt, far above the threshold.
 * 2. Alphabetic hyphen normalization. Hyphen compounds already arrive without
 *    spaces at geometry level ("by"+"-"+"laws"), but a residual pass folds
 *    conservative letter-hyphen-letter cases ("by - law" -> "by-law") and
 *    line-wrapped compounds ("By -\nlaws" -> "By-laws", hyphen kept because
 *    every observed wrap breaks at a genuine compound hyphen).
 * 3. Structural subsection detection. Only a line-initial "(N)" followed by
 *    same-line substantive text (capital/digit/quote) counts, with its own
 *    span. A section's own head marker is inline ("15(1) ..."), never
 *    line-initial, so "15(1)" gains no "15(1)(1)" child; mid-line prose
 *    references ("paragraph (1)(b)") and wrapped continuations
 *    ("sub section\n(1), he may") never create children.
 */

/** Minimal pdfjs text-item geometry (viewport units at scale 1). */
export type PdfItemGeometry = {
  str: string;
  x: number;
  width: number;
  y: number;
};

/**
 * Max gap (points) between adjacent items in one row that still counts as
 * the same word. Same-run splits measure 0-0.2pt here; genuine word pitch
 * is ~7pt, so 1.0pt separates the two regimes with wide margin.
 */
export const INTRA_WORD_MAX_GAP = 1.0;

const rowKeyFor = (y: number): number => Math.round(y * 2) / 2;

/** Group items into rows (top to bottom), each row sorted left to right. */
export const groupPdfItemsByRow = (items: PdfItemGeometry[]): PdfItemGeometry[][] => {
  const rows = new Map<number, PdfItemGeometry[]>();
  for (const item of items) {
    const key = rowKeyFor(item.y);
    rows.set(key, [...(rows.get(key) ?? []), item]);
  }
  return [...rows.entries()]
    .sort(([leftY], [rightY]) => rightY - leftY)
    .map(([, rowItems]) => [...rowItems].sort((left, right) => left.x - right.x));
};

/**
 * Reconstruct one row without fake intra-word spaces. Explicit whitespace
 * items become a single space; word items join directly when they abut the
 * previous word (gap <= INTRA_WORD_MAX_GAP) and are space-separated
 * otherwise.
 */
export const renderPdfItemRow = (rowItems: PdfItemGeometry[]): string => {
  const sorted = [...rowItems].sort((left, right) => left.x - right.x);
  let out = '';
  let lastWordEnd: number | undefined;
  for (const item of sorted) {
    if (!item.str) continue;
    if (/^\s+$/.test(item.str)) {
      if (out && !out.endsWith(' ')) out += ' ';
      lastWordEnd = undefined;
      continue;
    }
    const word = item.str.trim();
    if (!word) continue;
    const width = Number.isFinite(item.width) ? item.width : 0;
    if (!out || out.endsWith(' ')) {
      out += word;
    } else if (lastWordEnd !== undefined && item.x - lastWordEnd <= INTRA_WORD_MAX_GAP) {
      out += word;
    } else {
      out += ` ${word}`;
    }
    lastWordEnd = item.x + width;
  }
  return out.trim();
};

/** Reconstruct full side/page text: one line per row, top to bottom. */
export const renderPdfItemsAsText = (items: PdfItemGeometry[]): string =>
  groupPdfItemsByRow(items)
    .map(renderPdfItemRow)
    .join('\n');

/**
 * Conservative hyphen normalization over whitespace-normalized text:
 * line-wrapped compounds keep their hyphen ("By -\nlaws" -> "By-laws"),
 * then spaced alphabetic hyphens fold ("Surveyor - in - training" ->
 * "Surveyor-in-training"). Digits never match, so ranges, dates, and
 * revision stamps ("1986-06") are untouched.
 */
export const normalizePdfHyphenation = (text: string): string =>
  text
    .replace(/([A-Za-z])\s*-\s*\n\s*([A-Za-z])/g, '$1-$2')
    .replace(/([A-Za-z]) - (?=[A-Za-z])/g, '$1-');

export type PdfSubsectionSpan = {
  /** Numeric part, e.g. "1". */
  number: string;
  /** Full label, e.g. "15(1)". */
  label: string;
  /** Own span: from this marker to the next marker or section end. */
  text: string;
};

// Line-initial "(N)" with same-line substantive text. The follow-lookahead
// rejects wrapped prose continuations such as "(1), he may ...".
const SUBSECTION_MARKER = /(?:^|\n)[ \t]*\((\d+(?:\.\d+)?)\)[ \t]+(?=[A-Z0-9"“])/g;

/**
 * Detect structural numeric subsections of a PDF section. Returns own-span
 * slices (never the whole parent text); first-line markers (the section's
 * own head) and repeated numbers are skipped so parents never duplicate and
 * prose references never become children.
 */
export const detectPdfSubsectionSpans = (
  parentLabel: string,
  sectionText: string,
): PdfSubsectionSpan[] => {
  const firstLineEnd = sectionText.indexOf('\n');
  const markers = [...sectionText.matchAll(SUBSECTION_MARKER)]
    .map((match) => {
      const matchIndex = match.index ?? 0;
      return {
        parenIndex: matchIndex + match[0].indexOf('('),
        number: match[1],
      };
    })
    .filter((marker) => marker.parenIndex > 0)
    .filter((marker) => firstLineEnd < 0 || marker.parenIndex > firstLineEnd);
  const seen = new Set<string>();
  const starts = markers.filter((marker) => {
    if (seen.has(marker.number)) return false;
    seen.add(marker.number);
    return true;
  });
  return starts
    .map((marker, index) => {
      const end = starts[index + 1]?.parenIndex ?? sectionText.length;
      const text = sectionText.slice(marker.parenIndex, end).trim();
      if (!text) return undefined;
      return {
        number: marker.number,
        label: `${parentLabel}(${marker.number})`,
        text,
      };
    })
    .filter((span): span is PdfSubsectionSpan => span !== undefined);
};
