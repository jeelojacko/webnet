import { describe, expect, it } from 'vitest';
import {
  DRAFT_GLYPH_FIXTURE,
  isWinAnsiEncodable,
  sanitizePdfText,
} from '../src/engine/cad/cadDraftGlyphs';
import type { ExportSheetScene } from '../src/engine/cad/cadExportScene';
import { exportScenesToPdfWithWarnings } from '../src/engine/cad/cadPdfExport';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';

// Gate: no export format may silently replace survey glyphs. Either the
// glyph survives byte-identical (modulo the format's documented escaping)
// or the exporter emits an explicit warning naming the substitution.
const buildGlyphScene = (): ExportSheetScene => ({
  sheetId: 'glyph-gate',
  sheetName: 'Glyph Gate',
  widthMm: 210,
  heightMm: 297,
  clips: [],
  items: DRAFT_GLYPH_FIXTURE.map((text, index) => ({
    kind: 'text' as const,
    layer: 'labels',
    x: 20,
    y: 20 + index * 10,
    text,
    heightMm: 3,
  })),
});

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Mirrors the format's escaping, not its internals: literals with octal
// escapes for WinAnsi bytes, UTF-16BE hex as the last-resort fallback.
const pdfVisibleText = (pdf: string): string => {
  const parts: string[] = [];
  const literals = /\((?:\\[\\()]|\\\d{3}|[^\\()])*\)/g;
  for (const match of pdf.matchAll(literals)) {
    parts.push(
      match[0]
        .slice(1, -1)
        .replace(/\\(\d{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
        .replace(/\\([\\()])/g, '$1'),
    );
  }
  for (const match of pdf.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = match[1] as string;
    if (!hex.startsWith('FEFF')) continue;
    let text = '';
    for (let i = 4; i + 4 <= hex.length; i += 4) text += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    parts.push(text);
  }
  return parts.join('\n');
};

describe('draft survey glyph gate', () => {
  it('keeps every canonical glyph byte-identical in SVG (XML-escaped only)', () => {
    const svg = serializeExportSceneToSvg(buildGlyphScene());
    for (const text of DRAFT_GLYPH_FIXTURE) {
      expect(svg).toContain(escapeXml(text));
    }
  });

  it('passes every canonical glyph through DXF unchanged (no silent replacement)', () => {
    const dxf = serializeDxfModel({
      layers: ['labels'],
      points: [],
      lines: [],
      polylines: [],
      arcs: [],
      texts: DRAFT_GLYPH_FIXTURE.map((text, index) => ({
        layer: 'labels',
        at: { x: index * 10, y: 0 },
        height: 1,
        text,
      })),
    });
    for (const text of DRAFT_GLYPH_FIXTURE) {
      expect(dxf).toContain(text);
    }
  });

  it('emits pure-ASCII PDF bytes with WinAnsi glyphs intact (° ± ²)', () => {
    const { bytes } = exportScenesToPdfWithWarnings([buildGlyphScene()]);
    const pdf = new TextDecoder().decode(bytes);
    expect([...pdf].every((char) => (char.codePointAt(0) as number) < 128)).toBe(true);
    const visible = pdfVisibleText(pdf);
    expect(visible).toContain('45°12');
    expect(visible).toContain('±0.005');
    expect(visible).toContain('m²');
    // WinAnsi bytes travel as octal escapes inside literals, never raw.
    expect(pdf).toContain('\\260'); // °
    expect(pdf).toContain('\\261'); // ±
    expect(pdf).toContain('\\262'); // ²
  });

  it('substitutes primes/delta/dashes deterministically AND warns for each', () => {
    const { bytes, warnings } = exportScenesToPdfWithWarnings([buildGlyphScene()]);
    const visible = pdfVisibleText(new TextDecoder().decode(bytes));
    expect(visible).toContain('Delta=32°15\'20"');
    expect(visible).toContain('N 45°12\'34" E');
    const warned = new Set(warnings.map((warning) => warning.from));
    for (const text of DRAFT_GLYPH_FIXTURE) {
      for (const char of text) {
        if (!isWinAnsiEncodable(char)) expect(warned.has(char)).toBe(true);
      }
    }
    expect(warnings.every((warning) => warning.code === 'GLYPH_SUBSTITUTION')).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('is deterministic: same scene yields identical PDF bytes and warnings', () => {
    const first = exportScenesToPdfWithWarnings([buildGlyphScene()]);
    const second = exportScenesToPdfWithWarnings([buildGlyphScene()]);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect(second.warnings).toEqual(first.warnings);
  });

  it('sanitizes the documented substitution table without silence', () => {
    expect(sanitizePdfText('′')).toEqual({ text: "'", substitutions: [{ from: '′', to: "'" }] });
    expect(sanitizePdfText('″')).toEqual({ text: '"', substitutions: [{ from: '″', to: '"' }] });
    expect(sanitizePdfText('Δ')).toEqual({ text: 'Delta', substitutions: [{ from: 'Δ', to: 'Delta' }] });
    expect(sanitizePdfText('°±²').substitutions).toEqual([]);
    expect(sanitizePdfText('°±²').text).toBe('°±²');
  });
});
