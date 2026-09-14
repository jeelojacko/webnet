// Glyph gate for drafting deliverables (Phase 13C §§2-3).
//
// Survey text routinely carries characters outside ASCII — degree, primes,
// plus-minus, delta, superscript-2 — and each export format encodes text
// differently. This module is the single adapter between raw survey text and
// the hand-rolled Helvetica PDF path: it decides what WinAnsi can represent
// directly, applies deterministic substitutions for the rest, and reports
// every substitution so no replacement is ever silent.
//
// SVG (UTF-8 XML) and the browser canvas need no substitution; DXF passes
// text through unchanged (see tests/fixtures/draftGlyphRepertoire.md).
// Only the PDF path sanitizes, via exportScenesToPdfWithWarnings.

// Canonical survey-text fixture. Every string here must round-trip through
// the SVG serializer, the PDF exporter, and the DXF serializer with either
// byte fidelity or an explicit substitution warning — never a silent swap.
export const DRAFT_GLYPH_FIXTURE: readonly string[] = [
  '45°12\'34"',
  '45°12′34″',
  '±0.005',
  'Δ=32°15′20″',
  'N 45°12′34″ E',
  '105.25 m²',
  'Parcel A-1: Area 105.25 m² (±0.005) — record',
];

export interface GlyphSubstitution {
  from: string;
  to: string;
}

export interface SanitizedPdfText {
  text: string;
  substitutions: GlyphSubstitution[];
}

export interface GlyphSubstitutionWarning {
  code: 'GLYPH_SUBSTITUTION';
  sourceText: string;
  from: string;
  to: string;
  message: string;
}

// Deterministic WinAnsi-safe substitutions. ASCII apostrophe/quote for the
// prime marks, the spelled-out name for capital delta, '?' as the last
// resort for anything unmapped. Every application is reported — never silent.
const PDF_SUBSTITUTIONS: ReadonlyMap<string, string> = new Map([
  ['\u2032', "'"], // PRIME → apostrophe
  ['\u2033', '"'], // DOUBLE PRIME → quotation mark
  ['\u0394', 'Delta'], // GREEK CAPITAL DELTA → spelled-out name
  ['\u2013', '-'], // EN DASH → hyphen
  ['\u2014', '-'], // EM DASH → hyphen
]);

// WinAnsi code points with no assigned glyph (plus C0/C1 controls).
const isWinAnsiEncodableChar = (char: string): boolean => {
  const code = char.codePointAt(0) as number;
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code < 0xa0 || code > 0xff) return false;
  return code !== 0x81 && code !== 0x8d && code !== 0x8f && code !== 0x90 && code !== 0x9d;
};

export const isWinAnsiEncodable = (text: string): boolean => {
  for (const char of text) {
    if (!isWinAnsiEncodableChar(char)) return false;
  }
  return true;
};

export const sanitizePdfText = (text: string): SanitizedPdfText => {
  let out = '';
  const substitutions: GlyphSubstitution[] = [];
  for (const char of text) {
    if (isWinAnsiEncodableChar(char)) {
      out += char;
      continue;
    }
    const to = PDF_SUBSTITUTIONS.get(char) ?? '?';
    substitutions.push({ from: char, to });
    out += to;
  }
  return { text: out, substitutions };
};

export const substitutionWarnings = (sourceText: string, substitutions: GlyphSubstitution[]): GlyphSubstitutionWarning[] =>
  substitutions.map((sub) => ({
    code: 'GLYPH_SUBSTITUTION',
    sourceText,
    from: sub.from,
    to: sub.to,
    message: `glyph ${JSON.stringify(sub.from)} substituted with ${JSON.stringify(sub.to)} in ${JSON.stringify(sourceText)}`,
  }));
