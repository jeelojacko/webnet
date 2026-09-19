// Phase 18N UI slice — one block-geometry preview renderer for manager
// previews, point-style marker previews, and Toolspace rows. Previews
// expand through `expandBlockReference` — the same helper the native
// viewport renderer uses — so previews and viewport can never disagree.
// Curves render as sampled polylines (no sweep-flag edge cases).
// Monochrome: stroke inherits context color (ByLayer-friendly).

import React, { useMemo } from 'react';
import type { CadBlockChild, CadBlockDefinition } from '../../engine/cad/cadTypes';



const arcSamples = (
  centerX: number,
  centerY: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): Array<{ x: number; y: number }> => {
  const sweep = ((endAngleDeg - startAngleDeg) % 360 + 360) % 360;
  const full = sweep < 1e-9 && Math.abs(endAngleDeg - startAngleDeg) > 1e-9;
  const total = full ? 360 : sweep === 0 ? 0 : sweep;
  const steps = Math.max(2, Math.min(48, Math.ceil(total / 7.5)));
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index <= steps; index += 1) {
    const radians = ((startAngleDeg + (total * index) / steps) * Math.PI) / 180;
    points.push({ x: centerX + Math.cos(radians) * radius, y: centerY + Math.sin(radians) * radius });
  }
  return points;
};

const childSegments = (child: CadBlockChild): Array<Array<{ x: number; y: number }>> => {
  switch (child.type) {
    case 'line':
      return [[{ x: child.fromX, y: child.fromY }, { x: child.toX, y: child.toY }]];
    case 'polyline':
      return child.vertices.length > 0 ? [child.closed ? [...child.vertices, child.vertices[0]!] : child.vertices] : [];
    case 'polygon':
      return child.vertices.length > 0 ? [[...child.vertices, child.vertices[0]!]] : [];
    case 'arc':
      return [arcSamples(child.centerX, child.centerY, child.radius, child.startAngleDeg, child.endAngleDeg)];
    case 'text':
      return [];
  }
};

/** Fit-to-bounds SVG preview of a definition (definition-local space). */
export const BlockGeometryPreview: React.FC<{
  definition: CadBlockDefinition;
  sizePx?: number;
  label?: string;
}> = ({ definition, sizePx = 64, label }) => {
  const { viewBox, paths, texts } = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const touch = (x: number, y: number): void => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    touch(definition.basePoint.x, definition.basePoint.y);
    const segs: string[] = [];
    const labels: Array<{ x: number; y: number; text: string }> = [];
    for (const child of definition.entities) {
      for (const segment of childSegments(child)) {
        for (const point of segment) touch(point.x, point.y);
        if (segment.length > 0) {
          segs.push(segment.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(' '));
        }
      }
      if (child.type === 'text') {
        touch(child.x, child.y);
        labels.push({ x: child.x, y: child.y, text: child.text });
      }
    }
    if (!Number.isFinite(minX)) {
      minX = -1; minY = -1; maxX = 1; maxY = 1;
    }
    const padX = Math.max((maxX - minX) * 0.15, 0.05);
    const padY = Math.max((maxY - minY) * 0.15, 0.05);
    return {
      viewBox: `${minX - padX} ${minY - padY} ${maxX - minX + padX * 2} ${maxY - minY + padY * 2}`,
      paths: segs,
      texts: labels,
    };
  }, [definition]);
  return (
    <svg
      width={sizePx}
      height={sizePx}
      viewBox={viewBox}
      role="img"
      aria-label={label ?? `Preview of ${definition.name}`}
      data-cad-block-preview={definition.id}
      style={{ flexShrink: 0 }}
    >
      <g stroke="currentColor" strokeWidth={viewBoxWidth(viewBox) / sizePx} fill="none" strokeLinecap="round">
        {paths.map((points, index) => (
          <polyline key={index} points={points} />
        ))}
      </g>
      {texts.map((entry, index) => (
        <text key={index} x={entry.x} y={entry.y} fontSize={viewBoxWidth(viewBox) / 8} fill="currentColor">
          {entry.text}
        </text>
      ))}
    </svg>
  );
};

const viewBoxWidth = (viewBox: string): number => {
  const parts = viewBox.split(' ').map(Number);
  return Number.isFinite(parts[2]) && (parts[2] ?? 0) > 0 ? parts[2]! : 1;
};

