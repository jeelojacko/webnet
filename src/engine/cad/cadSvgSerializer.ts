import type { ExportItem, ExportSheetScene } from './cadExportScene';
import { BROKEN_REFERENCE_TEXT } from './cadLabelEngine';
import { emptyExportResult, finalizeExportResult, type ExportResult } from './exportResult';

// Deterministic scene→SVG. No timestamps, no random ids: clip ids derive
// from stable viewport ids, so identical input yields byte-identical output.
const fmt = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const anchorOf = (anchor: 'start' | 'middle' | 'end' | undefined): string => ` text-anchor="${anchor ?? 'start'}"`;

/** Embedded-newline vertical step (fraction of text height). */
const TEXT_LINE_SPACING = 1.2;

// Color attrs emit only when the item carries a resolved color, so
// hand-built scenes without color serialize exactly as before.
// Opacity (from entity/layer transparency) emits only when translucent.
const opacityAttr = (item: ExportItem): string =>
  item.opacity != null && item.opacity < 1 ? ` opacity="${fmt(Math.max(0, item.opacity))}"` : '';

const strokeAttrs = (item: ExportItem): string => {
  let out = '';
  if (item.stroke != null) out += ` stroke="${escapeXml(item.stroke)}"`;
  if (item.kind === 'line' || item.kind === 'polyline' || item.kind === 'circle' || item.kind === 'ellipse') {
    if (item.widthMm != null) out += ` stroke-width="${fmt(item.widthMm)}"`;
    if (item.dash != null) out += ` stroke-dasharray="${escapeXml(item.dash)}"`;
  }
  return out;
};

const serializeItem = (item: ExportItem): string => {
  switch (item.kind) {
    case 'line':
      return `<line x1="${fmt(item.x1)}" y1="${fmt(item.y1)}" x2="${fmt(item.x2)}" y2="${fmt(item.y2)}"${strokeAttrs(item)}${opacityAttr(item)}${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    case 'polyline': {
      const points = item.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
      const tag = item.close ? 'polygon' : 'polyline';
      return `<${tag} points="${points}" fill="${item.fill ?? 'none'}"${strokeAttrs(item)}${opacityAttr(item)}${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    }
    case 'rect':
      return `<rect x="${fmt(item.x)}" y="${fmt(item.y)}" width="${fmt(item.width)}" height="${fmt(item.height)}" fill="${item.fill ?? 'none'}"${strokeAttrs(item)}${opacityAttr(item)}${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    case 'circle':
      return `<circle cx="${fmt(item.cx)}" cy="${fmt(item.cy)}" r="${fmt(item.r)}" fill="${item.fill ?? 'none'}"${strokeAttrs(item)}${opacityAttr(item)}${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    case 'ellipse':
      return `<ellipse cx="${fmt(item.cx)}" cy="${fmt(item.cy)}" rx="${fmt(item.rx)}" ry="${fmt(item.ry)}" transform="rotate(${fmt(item.rotationDeg)} ${fmt(item.cx)} ${fmt(item.cy)})" fill="none"${strokeAttrs(item)}${opacityAttr(item)}${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    case 'arc':
      return `<path d="M ${fmt(item.cx + item.r * Math.cos((item.startDeg * Math.PI) / 180))} ${fmt(item.cy - item.r * Math.sin((item.startDeg * Math.PI) / 180))} A ${fmt(item.r)} ${fmt(item.r)} 0 0 0 ${fmt(item.cx + item.r * Math.cos((item.endDeg * Math.PI) / 180))} ${fmt(item.cy - item.r * Math.sin((item.endDeg * Math.PI) / 180))}" fill="none"${strokeAttrs(item)}${opacityAttr(item)}${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    case 'text': {
      const clip = item.clipId ? ` clip-path="url(#${item.clipId})"` : '';
      const fill = item.stroke != null ? ` fill="${escapeXml(item.stroke)}"` : '';
      // One <text> per line; single-line items stay byte-identical. Annotation
      // mtext/survey-label rows arrive as embedded newlines when the scene
      // hands them over whole; vertical step follows the text height.
      const row = (line: string, y: number): string => {
        const rotation = item.rotationDeg
          ? ` transform="rotate(${fmt(item.rotationDeg)} ${fmt(item.x)} ${fmt(y)})"`
          : '';
        return `<text x="${fmt(item.x)}" y="${fmt(y)}" font-size="${fmt(item.heightMm)}"${anchorOf(item.anchor)}${fill}${opacityAttr(item)}${rotation}${clip}>${escapeXml(line)}</text>`;
      };
      const rows = item.text.split(/\r\n|\r|\n/);
      if (rows.length <= 1) return row(item.text, item.y);
      return rows.map((line, index) => row(line, item.y + index * TEXT_LINE_SPACING * item.heightMm)).join('\n');
    }
  }
};

export const serializeExportSceneToSvg = (scene: ExportSheetScene): string => {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(scene.widthMm)}mm" height="${fmt(scene.heightMm)}mm" viewBox="0 0 ${fmt(scene.widthMm)} ${fmt(scene.heightMm)}">`,
  ];
  if (scene.clips.length > 0) {
    lines.push('<defs>');
    scene.clips.forEach((clip) => {
      lines.push(
        `<clipPath id="${clip.id}"><rect x="${fmt(clip.xMm)}" y="${fmt(clip.yMm)}" width="${fmt(clip.widthMm)}" height="${fmt(clip.heightMm)}"/></clipPath>`,
      );
    });
    lines.push('</defs>');
  }
  let currentLayer: string | undefined;
  scene.items.forEach((item) => {
    if (item.layer !== currentLayer) {
      if (currentLayer !== undefined) lines.push('</g>');
      lines.push(`<g id="layer-${escapeXml(item.layer)}">`);
      currentLayer = item.layer;
    }
    lines.push(serializeItem(item));
  });
  if (currentLayer !== undefined) lines.push('</g>');
  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
};

// Same bytes as serializeExportSceneToSvg, plus BROKEN_REFERENCE warnings
// for placeholder text items so the warning survives the scene→SVG hop.
// Entity attribution lives in buildExportSheetSceneWithResult; the
// serializer only knows items, so it reports source ids when present.
export const serializeExportSceneToSvgWithResult = (scene: ExportSheetScene): ExportResult<string> => {
  const result = emptyExportResult(serializeExportSceneToSvg(scene));
  const exportedEntityIds: string[] = [];
  scene.items.forEach((item) => {
    if (item.sourceEntityId != null) exportedEntityIds.push(item.sourceEntityId);
    if (item.kind === 'text' && item.text === BROKEN_REFERENCE_TEXT) {
      result.warnings.push({ code: 'BROKEN_REFERENCE', message: 'scene contains a broken-reference placeholder', ...(item.sourceEntityId ? { entityId: item.sourceEntityId } : {}) });
    }
  });
  return finalizeExportResult({ ...result, exportedEntityIds });
};
