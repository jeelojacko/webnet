import type { ExportItem, ExportSheetScene } from './cadExportScene';
import { sanitizePdfText, substitutionWarnings, type GlyphSubstitutionWarning } from './cadDraftGlyphs';

// Vector-first PDF adapter hand-rolled on purpose: the deliverable needs
// only lines, filled rects, segmented curves, and Helvetica text, so a
// dependency would buy nothing. Standard-14 Helvetica only — no embedding,
// no system-font dependence. Page size always equals the sheet definition.
// Multi-page order is the explicit input array order.
const PT_PER_MM = 72 / 25.4;

const fmt = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

// WinAnsi literal: ASCII passes through with delimiter escapes, WinAnsi
// bytes (° \260, ± \261, ² \262, …) use 3-digit octal escapes so the
// output stays pure ASCII and standard-14 Helvetica renders it directly.
// The font dictionary declares /Encoding /WinAnsiEncoding, so viewers map
// those bytes deterministically; anything outside WinAnsi must still be
// substituted upstream (sanitizePdfText) — never emitted as UTF-16BE hex,
// which bare Helvetica cannot decode (mojibake).
const encodePdfText = (text: string): string => {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (char === '\\') out += '\\\\';
    else if (char === '(') out += '\\(';
    else if (char === ')') out += '\\)';
    else if (code < 128) out += char;
    else out += `\\${code.toString(8).padStart(3, '0')}`;
  }
  return `(${out})`;
};



interface Ctx {
  ops: string[];
  pageHpt: number;
  warnings: GlyphSubstitutionWarning[];
}

const toPt = (mm: number): number => mm * PT_PER_MM;
const flipY = (yMm: number, ctx: Ctx): number => ctx.pageHpt - toPt(yMm);

const strokeWidth = (widthMm: number | undefined): string => `${fmt(toPt(widthMm ?? 0.25))} w`;

const emitLine = (ctx: Ctx, x1: number, y1: number, x2: number, y2: number, widthMm?: number): void => {
  ctx.ops.push(
    `${strokeWidth(widthMm)} ${fmt(toPt(x1))} ${fmt(flipY(y1, ctx))} m ${fmt(toPt(x2))} ${fmt(flipY(y2, ctx))} l S`,
  );
};

const emitSegments = (ctx: Ctx, points: Array<{ x: number; y: number }>, close: boolean, widthMm?: number): void => {
  if (points.length < 2) return;
  const path = points.map((p, i) => `${fmt(toPt(p.x))} ${fmt(flipY(p.y, ctx))} ${i === 0 ? 'm' : 'l'}`).join(' ');
  ctx.ops.push(`${strokeWidth(widthMm)} ${path}${close ? ' h' : ''} S`);
};

const emitRect = (ctx: Ctx, x: number, y: number, width: number, height: number, fill?: string): void => {
  // y-flip: rect origin is its top-left in paper space.
  const box = `${fmt(toPt(x))} ${fmt(flipY(y + height, ctx))} ${fmt(toPt(width))} ${fmt(toPt(height))} re`;
  if (fill === '#000000') ctx.ops.push(`0 g ${box} f`);
  else if (fill === '#ffffff') ctx.ops.push(`1 g ${box} f`);
  else ctx.ops.push(`${box} S`);
};

const emitEllipse = (ctx: Ctx, cx: number, cy: number, rx: number, ry: number, rotationDeg: number, widthMm?: number): void => {
  const rot = (rotationDeg * Math.PI) / 180;
  const points = Array.from({ length: 25 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const ex = rx * Math.cos(a);
    const ey = ry * Math.sin(a);
    return { x: cx + ex * Math.cos(rot) - ey * Math.sin(rot), y: cy + ex * Math.sin(rot) + ey * Math.cos(rot) };
  });
  emitSegments(ctx, points, true, widthMm);
};

const emitArc = (ctx: Ctx, cx: number, cy: number, r: number, startDeg: number, endDeg: number, widthMm?: number): void => {
  let sweep = endDeg - startDeg;
  while (sweep <= 0) sweep += 360;
  const steps = Math.max(8, Math.ceil((sweep / 360) * 48));
  // Paper y grows downward, so model-CCW arcs flip sign in paper space.
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((startDeg + (sweep * i) / steps) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  });
  emitSegments(ctx, points, false, widthMm);
};

const emitText = (ctx: Ctx, item: Extract<ExportItem, { kind: 'text' }>): void => {
  const sizePt = Math.max(1, toPt(item.heightMm));
  // Anchor offset uses an average Helvetica advance (~0.55em/char); exact
  // centering is a viewer-side concern, presence and position are exact.
  // The offset is applied in the text-local rotated frame — SVG
  // rotate(θ)-about-point semantics — so middle/end anchors stay centered
  // on (x, y) along the rotated baseline instead of drifting in page axes.
  const rotationDeg = item.rotationDeg ?? 0;
  const a = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const approxWidthMm = item.text.length * item.heightMm * 0.5;
  const along = item.anchor === 'middle' ? approxWidthMm / 2 : item.anchor === 'end' ? approxWidthMm : 0;
  const e = fmt(toPt(item.x - along * cos));
  const f = fmt(flipY(item.y - along * sin, ctx));
  // Survey glyphs outside WinAnsi (primes, Δ, …) get deterministic
  // substitutions; each one is collected as a GLYPH_SUBSTITUTION warning
  // so the replacement is explicit, never silent.
  const { text: safeText, substitutions } = sanitizePdfText(item.text);
  ctx.warnings.push(...substitutionWarnings(item.text, substitutions));
  // safeText is WinAnsi by construction, so encodePdfText's octal escapes
  // cover every non-ASCII byte it can contain.
  const encoded = encodePdfText(safeText);
  if (rotationDeg === 0) {
    ctx.ops.push(`BT /F1 ${fmt(sizePt)} Tf ${e} ${f} Td ${encoded} Tj ET`);
    return;
  }
  // SVG rotate(θ) is visually clockwise on the sheet; in y-up PDF user
  // space that is [cosθ -sinθ / sinθ cosθ], same semantics as the SVG.
  ctx.ops.push(
    `BT /F1 ${fmt(sizePt)} Tf ${fmt(cos)} ${fmt(-sin)} ${fmt(sin)} ${fmt(cos)} ${e} ${f} Tm ${encoded} Tj ET`,
  );
};

const emitItem = (ctx: Ctx, item: ExportItem): void => {
  switch (item.kind) {
    case 'line':
      emitLine(ctx, item.x1, item.y1, item.x2, item.y2, item.widthMm);
      return;
    case 'polyline':
      emitSegments(ctx, item.points, item.close, item.widthMm);
      return;
    case 'rect':
      emitRect(ctx, item.x, item.y, item.width, item.height, item.fill);
      return;
    case 'circle':
      emitEllipse(ctx, item.cx, item.cy, item.r, item.r, 0);
      return;
    case 'ellipse':
      emitEllipse(ctx, item.cx, item.cy, item.rx, item.ry, item.rotationDeg);
      return;
    case 'arc':
      emitArc(ctx, item.cx, item.cy, item.r, item.startDeg, item.endDeg);
      return;
    case 'text':
      emitText(ctx, item);
  }
};

const clipRectOp = (ctx: Ctx, clip: { xMm: number; yMm: number; widthMm: number; heightMm: number }): string =>
  `${fmt(toPt(clip.xMm))} ${fmt(flipY(clip.yMm + clip.heightMm, ctx))} ${fmt(toPt(clip.widthMm))} ${fmt(toPt(clip.heightMm))} re W n`;

const buildPageContent = (scene: ExportSheetScene): { content: string; warnings: GlyphSubstitutionWarning[] } => {
  const ctx: Ctx = { ops: [], pageHpt: toPt(scene.heightMm), warnings: [] };
  // Clipped items are wrapped in a PDF clipping path (q … re W n … Q) so
  // the PDF honors the same clip rects the SVG enforces via clipPath.
  // Unclipped items (frames, title block, paper extras) emit directly.
  const byClip = new Map<string | undefined, ExportItem[]>();
  scene.items.forEach((item) => {
    const key = item.kind === 'rect' && item.layer === 'paper-frame' ? undefined : item.clipId;
    const list = byClip.get(key) ?? [];
    list.push(item);
    byClip.set(key, list);
  });
  const clips = new Map(scene.clips.map((clip) => [clip.id, clip]));
  byClip.forEach((group, clipId) => {
    const clip = clipId != null ? clips.get(clipId) : undefined;
    if (clip) ctx.ops.push(`q ${clipRectOp(ctx, clip)}`);
    group.forEach((item) => emitItem(ctx, item));
    if (clip) ctx.ops.push('Q');
  });
  return { content: `${ctx.ops.join('\n')}\n`, warnings: ctx.warnings };
};

// Same bytes as exportScenesToPdf, plus one GLYPH_SUBSTITUTION warning
// per non-WinAnsi glyph replaced in text items. Callers that surface
// survey text must use this variant so substitutions stay explicit.
export const exportScenesToPdfWithWarnings = (
  scenes: ExportSheetScene[],
): { bytes: Uint8Array; warnings: GlyphSubstitutionWarning[] } => {
  if (scenes.length === 0) throw new Error('export: at least one sheet is required');
  const objects: string[] = [];
  const pageIds: number[] = [];
  // Object numbering: 1 catalog, 2 pages, then per scene (page, content),
  // then one shared Helvetica font object.
  let nextId = 3;
  const contents: string[] = [];
  const warnings: GlyphSubstitutionWarning[] = [];
  const pageSizes: Array<{ w: number; h: number }> = [];
  scenes.forEach((scene) => {
    pageIds.push(nextId);
    const page = buildPageContent(scene);
    contents.push(page.content);
    warnings.push(...page.warnings);
    pageSizes.push({ w: toPt(scene.widthMm), h: toPt(scene.heightMm) });
    nextId += 2;
  });
  const fontId = nextId;
  pageIds.forEach((pageId, index) => {
    const size = pageSizes[index] as { w: number; h: number };
    objects.push(
      `${pageId} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${fmt(size.w)} ${fmt(size.h)}]/Resources<</Font<</F1 ${fontId} 0 R>>>>/Contents ${pageId + 1} 0 R>>endobj`,
    );
    const stream = contents[index] as string;
    objects.push(`${pageId + 1} 0 obj<</Length ${stream.length}>>stream\n${stream}endstream\nendobj`);
  });
  objects.push(`${fontId} 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>endobj`);

  const header = '%PDF-1.4\n';
  const catalog = '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj';
  const pages = `2 0 obj<</Type/Pages/Kids[${pageIds.map((id) => `${id} 0 R`).join(' ')}]/Count ${pageIds.length}>>endobj`;
  const all = [catalog, pages, ...objects];
  let body = header;
  const offsets: number[] = [];
  all.forEach((object) => {
    offsets.push(body.length);
    body += `${object}\n`;
  });
  const xrefAt = body.length;
  const total = all.length + 1;
  body += `xref\n0 ${total}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  body += `trailer\n<</Size ${total}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF`;
  return { bytes: new TextEncoder().encode(body), warnings };
};

export const exportScenesToPdf = (scenes: ExportSheetScene[]): Uint8Array =>
  exportScenesToPdfWithWarnings(scenes).bytes;
