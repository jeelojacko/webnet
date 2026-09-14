import type { ExportItem, ExportSheetScene } from './cadExportScene';

// Deterministic scene→SVG. No timestamps, no random ids: clip ids derive
// from viewport order, so identical input yields byte-identical output.
const fmt = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const anchorOf = (anchor: 'start' | 'middle' | 'end' | undefined): string => ` text-anchor="${anchor ?? 'start'}"`;

const serializeItem = (item: ExportItem): string => {
  switch (item.kind) {
    case 'line':
      return `<line x1="${fmt(item.x1)}" y1="${fmt(item.y1)}" x2="${fmt(item.x2)}" y2="${fmt(item.y2)}"${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    case 'polyline': {
      const points = item.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
      const tag = item.close ? 'polygon' : 'polyline';
      return `<${tag} points="${points}" fill="${item.close ? 'none' : 'none'}"${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    }
    case 'rect':
      return `<rect x="${fmt(item.x)}" y="${fmt(item.y)}" width="${fmt(item.width)}" height="${fmt(item.height)}" fill="${item.fill ?? 'none'}"${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    case 'circle':
      return `<circle cx="${fmt(item.cx)}" cy="${fmt(item.cy)}" r="${fmt(item.r)}"${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    case 'ellipse':
      return `<ellipse cx="${fmt(item.cx)}" cy="${fmt(item.cy)}" rx="${fmt(item.rx)}" ry="${fmt(item.ry)}" transform="rotate(${fmt(item.rotationDeg)} ${fmt(item.cx)} ${fmt(item.cy)})"${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    case 'arc':
      return `<path d="M ${fmt(item.cx + item.r * Math.cos((item.startDeg * Math.PI) / 180))} ${fmt(item.cy - item.r * Math.sin((item.startDeg * Math.PI) / 180))} A ${fmt(item.r)} ${fmt(item.r)} 0 0 0 ${fmt(item.cx + item.r * Math.cos((item.endDeg * Math.PI) / 180))} ${fmt(item.cy - item.r * Math.sin((item.endDeg * Math.PI) / 180))}" fill="none"${item.clipId ? ` clip-path="url(#${item.clipId})"` : ''}/>`;
    case 'text': {
      const rotation = item.rotationDeg ? ` transform="rotate(${fmt(item.rotationDeg)} ${fmt(item.x)} ${fmt(item.y)})"` : '';
      const clip = item.clipId ? ` clip-path="url(#${item.clipId})"` : '';
      return `<text x="${fmt(item.x)}" y="${fmt(item.y)}" font-size="${fmt(item.heightMm)}"${anchorOf(item.anchor)}${rotation}${clip}>${escapeXml(item.text)}</text>`;
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
