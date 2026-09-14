# Draft glyph repertoire (Phase 13C §§2-3)

How the hand-rolled Helvetica PDF path encodes survey text, what each
deliverable format can represent, and the substitution policy. No-mojibake
rule: **no exporter may emit bytes the target reader cannot decode, and no
substitution may happen without an explicit warning.**

## PDF audit: `src/engine/cad/cadPdfExport.ts`

- Font object is bare standard-14 Helvetica:
  `<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>` — no `/Encoding`, no
  `/ToUnicode`, no embedding.
- Before this phase, any non-ASCII text (e.g. the ² in `m²`) was emitted as
  a UTF-16BE hex string (`<FEFF…>`). Bare Helvetica has no ToUnicode CMap,
  so readers fall back to WinAnsi-or-nothing: the glyphs render wrong
  or not at all (mojibake / `.notdef`). **That path is removed
  for all sanitized text**; a UTF-16BE fallback remains only for text that
  bypasses sanitization, so raw non-ASCII bytes never hit the file.
- Current encoding (`encodePdfText`): ASCII passes through as a PDF literal
  with `\`, `(`, `)` escaped; every WinAnsi byte (U+00A0–U+00FF) is a
  3-digit octal escape (`°` → `\260`, `±` → `\261`, `²` → `\262`). Output
  bytes are pure ASCII; Helvetica renders them directly.
- Non-WinAnsi glyphs never reach the encoder: `emitText` runs
  `sanitizePdfText` first and pushes one `GLYPH_SUBSTITUTION` warning per
  replaced glyph (see `exportScenesToPdfWithWarnings`). The byte-preserving
  `exportScenesToPdf` wrapper is unchanged for callers that ignore warnings.

## Per-format repertoire

| Glyph | Example | Browser/SVG | PDF (Helvetica) | DXF R12 (`TEXT` group 1) |
|---|---|---|---|---|
| ASCII letters/digits/punct `()'"-:,;.` | title block | exact (UTF-8, XML-escaped) | exact (literal) | exact (passthrough) |
| `°` U+00B0 degree | `45°12'34"` | exact | exact (`\260`) | passthrough (UTF-8 bytes; strict 1252 readers may show mojibake, see below) |
| `±` U+00B1 plus-minus | `±0.005` | exact | exact (`\261`) | passthrough (same caveat) |
| `²` U+00B2 superscript two | `m²` | exact | exact (`\262`) | passthrough (same caveat) |
| `′` U+2032 prime | `45°12′34″` | exact | `'` + warning | passthrough (reader-dependent) |
| `″` U+2033 double prime | `45°12′34″` | exact | `"` + warning | passthrough (reader-dependent) |
| `Δ` U+0394 capital delta | `Δ=32°15′20″` | exact | `Delta` + warning | passthrough (reader-dependent) |
| `–` U+2013 / `—` U+2014 dashes | title block | exact | `-` + warning | passthrough (reader-dependent) |
| any other non-WinAnsi | — | exact | `?` + warning | passthrough (reader-dependent) |

DXF policy: the R12 serializer (`dxfSerializer.ts`) writes `TEXT` group-1
values byte-identical — it never substitutes, so it never lies. Code points
above U+007F leave as UTF-8 bytes; a strict `$DWGCODEPAGE`-1252 importer
may misrender multibyte sequences (`²` as `Â²`). That is a documented
reader-side caveat, not a silent replacement: the source bytes are intact.
Pinning a codepage or downgrading glyphs for DXF is out of scope until an
importer in the parity set requires it.

## Substitution policy (PDF only)

1. WinAnsi-representable text is encoded, never substituted.
2. `′` → `'`, `″` → `"`, `Δ` → `Delta`, en/em dash → `-`; anything else
   non-WinAnsi → `?`. Table lives in `cadDraftGlyphs.ts` (`PDF_SUBSTITUTIONS`).
3. Every applied substitution emits a `GLYPH_SUBSTITUTION` warning naming
   the source glyph, its replacement, and the source string.
4. Gate test `tests/cad_draft_glyphs.test.ts` renders
   `DRAFT_GLYPH_FIXTURE` through all three serializers and fails on any
   unwarned deviation.
