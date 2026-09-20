import { findBlockDefinition } from '../cadBlocks';
import { surveyPointMarker } from '../cadRendererStyle';
import type { CadEntity, CadProject } from '../cadTypes';
import type { DxfPoint } from './dxfExportModel';

export interface DxfBlockChildLine {
  layer: string;
  from: DxfPoint;
  to: DxfPoint;
}

export interface DxfBlockChildPolyline {
  layer: string;
  vertices: DxfPoint[];
  closed: boolean;
}

export interface DxfBlockChildArc {
  layer: string;
  center: DxfPoint;
  radius: number;
  startDeg: number;
  endDeg: number;
}

export interface DxfBlockChildText {
  layer: string;
  at: DxfPoint;
  height: number;
  text: string;
}

export interface DxfBlockEntry {
  name: string;
  definitionId: string;
  lines: DxfBlockChildLine[];
  polylines: DxfBlockChildPolyline[];
  arcs: DxfBlockChildArc[];
  texts: DxfBlockChildText[];
}

export interface DxfInsert {
  layer: string;
  blockName: string;
  definitionId: string;
  at: DxfPoint;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
  /** Phase 18Q: mirrored INSERT (group 41 carries -scaleX; TEXT children ride world-space). */
  mirrored?: boolean;
}

export interface DxfBlockWarning {
  code: 'SKIPPED_ENTITY';
  message: string;
}

/**
 * Phase 18N native DXF block table (split from dxfExportModel.ts).
 * Referenced definitions only: live block-reference entities plus whatever
 * block marker the display resolver picks for live survey points (manual >
 * group > base > default — the same resolver as the screen, so markers
 * never silently fall back to POINT).
 *
 * Children ride base-shifted (stored minus definition.basePoint) with BLOCK
 * base (0,0), so INSERT world = insert + R·S·local matches the engine
 * transform exactly. Children are BYLAYER (layer only): the instance-level
 * INSERT carries the reference's explicit style.
 */
export interface DxfBlockTable {
  blocks: DxfBlockEntry[];
  names: Map<string, string>;
}

export const toDxfSafeBlockName = (name: string, taken: Set<string>): string => {
  let base = name.replace(/[<>/\\":;?*|=`,\s]/g, '_').replace(/[\p{Cc}\p{Cf}]/gu, '_').trim().slice(0, 255);
  if (base === '') base = 'BLOCK';
  let out = base;
  let index = 2;
  while (taken.has(out.toLowerCase())) {
    out = `${base}_${index}`;
    index += 1;
  }
  taken.add(out.toLowerCase());
  return out;
};

/** Native-safe iff the (already sanitized) name needs no further mapping. */
export const isDxfNativeBlockName = (name: string): boolean =>
  name.length > 0 && /^[A-Za-z0-9_$-]+$/.test(name);

export const collectReferencedBlockIds = (
  project: CadProject,
  entities: readonly CadEntity[],
): Set<string> => {
  const referenced = new Set<string>();
  entities.forEach((entity) => {
    if (entity.type === 'block-reference') referenced.add(entity.blockDefinitionId);
    if (entity.type === 'survey-point') {
      const markerBlock = surveyPointMarker(project, entity).blockDefinitionId;
      if (markerBlock != null) referenced.add(markerBlock);
    }
  });
  return referenced;
};

const finitePair = (x: number, y: number): boolean => Number.isFinite(x) && Number.isFinite(y);

const finiteAngle = (deg: number): boolean => Number.isFinite(deg);

const finiteVertices = (vertices: ReadonlyArray<{ x: number; y: number }>): boolean =>
  vertices.every((vertex) => finitePair(vertex.x, vertex.y));

export const buildDxfBlockTable = (args: {
  project: CadProject;
  referencedIds: ReadonlySet<string>;
  registerLayer: (_layerId: string) => string;
  warn: (_warning: DxfBlockWarning) => void;
}): DxfBlockTable => {
  const taken = new Set<string>();
  const names = new Map<string, string>();
  const blocks: DxfBlockEntry[] = [];
  [...args.referencedIds].sort().forEach((definitionId) => {
    const definition = findBlockDefinition(args.project.blockDefinitions, definitionId);
    if (!definition) return;
    const name = toDxfSafeBlockName(definition.name, taken);
    names.set(definitionId, name);
    const base = definition.basePoint;
    const shift = (point: { x: number; y: number }): DxfPoint => ({ x: point.x - base.x, y: point.y - base.y });
    const entry: DxfBlockEntry = { name, definitionId, lines: [], polylines: [], arcs: [], texts: [] };
    definition.entities.forEach((child) => {
      switch (child.type) {
        case 'line':
          if (!finitePair(child.fromX, child.fromY) || !finitePair(child.toX, child.toY)) {
            args.warn({ code: 'SKIPPED_ENTITY', message: `block ${name} line child ${child.id} has non-finite coordinates` });
            break;
          }
          entry.lines.push({ layer: args.registerLayer(child.layerId), from: shift({ x: child.fromX, y: child.fromY }), to: shift({ x: child.toX, y: child.toY }) });
          break;
        case 'polyline':
        case 'polygon': {
          const ring = child.type === 'polyline' ? child.vertices : [...child.vertices, child.vertices[0]].filter((vertex): vertex is { x: number; y: number } => vertex != null);
          if (ring.length < 2 || !finiteVertices(ring)) {
            args.warn({ code: 'SKIPPED_ENTITY', message: `block ${name} ${child.type} child ${child.id} has fewer than 2 finite vertices` });
            break;
          }
          entry.polylines.push({ layer: args.registerLayer(child.layerId), vertices: ring.map(shift), closed: child.type === 'polygon' ? true : child.closed });
          break;
        }
        case 'arc':
          if (!finitePair(child.centerX, child.centerY) || !Number.isFinite(child.radius) || child.radius <= 0 || !finiteAngle(child.startAngleDeg) || !finiteAngle(child.endAngleDeg)) {
            args.warn({ code: 'SKIPPED_ENTITY', message: `block ${name} arc child ${child.id} has invalid geometry` });
            break;
          }
          entry.arcs.push({ layer: args.registerLayer(child.layerId), center: shift({ x: child.centerX, y: child.centerY }), radius: child.radius, startDeg: child.startAngleDeg, endDeg: child.endAngleDeg });
          break;
        case 'text':
          if (!finitePair(child.x, child.y)) {
            args.warn({ code: 'SKIPPED_ENTITY', message: `block ${name} text child ${child.id} has non-finite coordinates` });
            break;
          }
          entry.texts.push({ layer: args.registerLayer(child.layerId), at: shift({ x: child.x, y: child.y }), height: 2.5, text: child.text });
          break;
      }
    });
    blocks.push(entry);
  });
  return { blocks, names };
};

/** Style-free INSERT facts; the caller spreads entryStyle over these. */
export const blockReferenceInsert = (
  layer: string,
  blockName: string,
  definitionId: string,
  at: DxfPoint,
  rotationDeg: number,
  scaleX: number,
  scaleY: number,
  mirrored?: boolean,
): DxfInsert => ({
  layer,
  blockName,
  definitionId,
  at,
  rotationDeg,
  scaleX,
  scaleY,
  ...(mirrored === true ? { mirrored: true as const } : {}),
});
