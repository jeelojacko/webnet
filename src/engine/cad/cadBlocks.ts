// Phase 18N block definition / reference core (engine only).
//
// Transform order (normative): world = insert + R(rotationDeg CCW) * S(scaleX,scaleY) * (local - basePoint).
// rotationDeg follows the geometry convention (degrees CCW from +X, y-up).
// Arc rotation adds the reference delta to both sweep angles, normalized to [0,360).
//
// Appearance contract: child explicit > reference explicit > reference layer.
// Callers first resolve the reference (explicit-over-layer, e.g. via
// resolveCadEntityAppearance), then merge each expanded child over it with
// resolveBlockChildAppearance. The helper returns explicit fields only:
// a field is present only when the child or the reference defines it.
//
// Bounds contract: blockReferenceBounds transforms each child to world
// first, then unions per-child bounds (child AABB corners for linear
// shapes; arc endpoints + on-sweep cardinals). Arc radius under
// non-uniform scale uses the mean of scaleX/scaleY — an approximation
// documented here, not a geometric ellipse expansion.

import { cadIsAngleOnArcSweep, cadNormalizeAngleDeg } from './cadGeometry';
import type {
  CadBlockChild,
  CadBlockDefinition,
  CadBounds,
  CadEntityAppearance,
} from './cadTypes';

export const MAX_BLOCK_EXPANSION_DEPTH = 4;

/**
 * Minimal placement for expansion: anything with an insertion point,
 * rotation, and scales (a real CadBlockReferenceEntity or a synthesized
 * marker placement). Widened additively so renderers/exporters expand
 * without minting fake entities.
 */
export interface BlockPlacement {
  x: number;
  y: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
}

export type CadBlockDiagnosticCode =
  | 'CAD_BLOCK_EMPTY_NAME'
  | 'CAD_BLOCK_DUPLICATE_NAME'
  | 'CAD_BLOCK_EMPTY_ENTITIES'
  | 'CAD_BLOCK_NESTED_UNSUPPORTED'
  | 'CAD_BLOCK_POINT_LABEL_UNSUPPORTED'
  | 'CAD_BLOCK_DUPLICATE_CHILD_ID'
  | 'CAD_BLOCK_INVALID_SCALE'
  | 'CAD_BLOCK_REFERENCE_CYCLE';

export interface CadBlockDiagnostic {
  code: CadBlockDiagnosticCode;
  message: string;
}

const diagnostic = (code: CadBlockDiagnosticCode, message: string): CadBlockDiagnostic => ({
  code,
  message,
});

/** Null = valid; otherwise the CAD_BLOCK_INVALID_SCALE diagnostic. */
export const normalizeBlockScales = (
  scaleX: number,
  scaleY: number,
): CadBlockDiagnostic | null => {
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return diagnostic(
      'CAD_BLOCK_INVALID_SCALE',
      `Block scales must be finite and > 0 (got ${scaleX}, ${scaleY}).`,
    );
  }
  return null;
};

const SUPPORTED_CHILD_TYPES = new Set(['line', 'polyline', 'arc', 'polygon', 'text']);

/**
 * Validate a block definition. Sibling names are compared case-insensitively
 * (pass the other definitions' names, or the definition's own table context).
 */
export const validateBlockDefinition = (
  definition: CadBlockDefinition,
  siblingNames: string[] = [],
): CadBlockDiagnostic[] => {
  const issues: CadBlockDiagnostic[] = [];
  if (definition.name.trim().length === 0) {
    issues.push(diagnostic('CAD_BLOCK_EMPTY_NAME', 'Block name must not be empty.'));
  }
  const lowered = definition.name.trim().toLowerCase();
  if (lowered.length > 0 && siblingNames.some((name) => name.trim().toLowerCase() === lowered)) {
    issues.push(diagnostic('CAD_BLOCK_DUPLICATE_NAME', `Duplicate block name "${definition.name}".`));
  }
  if (definition.entities.length === 0) {
    issues.push(diagnostic('CAD_BLOCK_EMPTY_ENTITIES', 'Block must contain at least one entity.'));
  }
  const seenChildIds = new Set<string>();
  for (const child of definition.entities) {
    const childType = (child as { type?: string }).type ?? 'unknown';
    if (!SUPPORTED_CHILD_TYPES.has(childType)) {
      issues.push(
        diagnostic(
          'CAD_BLOCK_NESTED_UNSUPPORTED',
          `Child type "${childType}" cannot nest inside a block (id "${child.id}").`,
        ),
      );
      continue;
    }
    if (child.type === 'text' && child.pointLabel != null) {
      issues.push(
        diagnostic(
          'CAD_BLOCK_POINT_LABEL_UNSUPPORTED',
          `Text child "${child.id}" must not bind a point label inside a block.`,
        ),
      );
    }
    if (seenChildIds.has(child.id)) {
      issues.push(diagnostic('CAD_BLOCK_DUPLICATE_CHILD_ID', `Duplicate block-local child id "${child.id}".`));
    }
    seenChildIds.add(child.id);
  }
  return issues;
};

const requireValidScales = (reference: BlockPlacement): void => {
  const issue = normalizeBlockScales(reference.scaleX, reference.scaleY);
  if (issue) throw new Error(`${issue.code}: ${issue.message}`);
};

export interface CadWorldPoint {
  x: number;
  y: number;
}

/** Apply the normative transform order to one local point. */
export const transformBlockPointToWorld = (
  point: CadWorldPoint,
  definition: CadBlockDefinition,
  reference: BlockPlacement,
): CadWorldPoint => {
  const radians = (reference.rotationDeg * Math.PI) / 180;
  const scaledX = (point.x - definition.basePoint.x) * reference.scaleX;
  const scaledY = (point.y - definition.basePoint.y) * reference.scaleY;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: reference.x + scaledX * cos - scaledY * sin,
    y: reference.y + scaledX * sin + scaledY * cos,
  };
};

/** Pure: block-local child -> world-space child (same id, same styling intent). */
export const transformBlockChildToWorld = (
  child: CadBlockChild,
  definition: CadBlockDefinition,
  reference: BlockPlacement,
): CadBlockChild => {
  requireValidScales(reference);
  switch (child.type) {
    case 'line': {
      const from = transformBlockPointToWorld({ x: child.fromX, y: child.fromY }, definition, reference);
      const to = transformBlockPointToWorld({ x: child.toX, y: child.toY }, definition, reference);
      return { ...child, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y };
    }
    case 'polyline':
    case 'polygon':
      return {
        ...child,
        vertices: child.vertices.map((vertex) => transformBlockPointToWorld(vertex, definition, reference)),
      };
    case 'arc': {
      const center = transformBlockPointToWorld(
        { x: child.centerX, y: child.centerY },
        definition,
        reference,
      );
      const meanScale = (reference.scaleX + reference.scaleY) / 2;
      return {
        ...child,
        centerX: center.x,
        centerY: center.y,
        radius: child.radius * meanScale,
        startAngleDeg: cadNormalizeAngleDeg(child.startAngleDeg + reference.rotationDeg),
        endAngleDeg: cadNormalizeAngleDeg(child.endAngleDeg + reference.rotationDeg),
      };
    }
    case 'text': {
      const anchor = transformBlockPointToWorld({ x: child.x, y: child.y }, definition, reference);
      return { ...child, x: anchor.x, y: anchor.y };
    }
  }
};

/**
 * Cycle guard. Nesting is rejected in 18N so cycles are trivially absent,
 * but expansion still carries a visited-set + depth guard and reports
 * CAD_BLOCK_REFERENCE_CYCLE instead of recursing.
 */
export const detectBlockCycle = (
  definitionId: string,
  visited: ReadonlySet<string>,
  depth: number,
): CadBlockDiagnostic | null => {
  if (visited.has(definitionId) || depth > MAX_BLOCK_EXPANSION_DEPTH) {
    return diagnostic(
      'CAD_BLOCK_REFERENCE_CYCLE',
      `Block expansion cycle/depth guard hit at "${definitionId}".`,
    );
  }
  return null;
};

/** Pure: expand every child of a reference to world space. */
export const expandBlockReference = (
  definition: CadBlockDefinition,
  reference: BlockPlacement,
  visited: ReadonlySet<string> = new Set(),
  depth = 0,
): CadBlockChild[] => {
  const cycle = detectBlockCycle(definition.id, visited, depth);
  if (cycle) throw new Error(`${cycle.code}: ${cycle.message}`);
  requireValidScales(reference);
  return definition.entities.map((child) => transformBlockChildToWorld(child, definition, reference));
};

/** Shared expansion seam: visit each world-space child in definition order. */
export const visitCadBlockGeometry = (
  definition: CadBlockDefinition,
  reference: BlockPlacement,
  visitor: (_child: CadBlockChild, _index: number) => void,
): void => {
  expandBlockReference(definition, reference).forEach((child, index) => visitor(child, index));
};

const arcSamplePoints = (
  centerX: number,
  centerY: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadWorldPoint[] => {
  const angles = [startAngleDeg, endAngleDeg];
  for (const candidate of [0, 90, 180, 270]) {
    if (cadIsAngleOnArcSweep(candidate, startAngleDeg, endAngleDeg)) angles.push(candidate);
  }
  return angles.map((angleDeg) => {
    const radians = (angleDeg * Math.PI) / 180;
    return { x: centerX + Math.cos(radians) * radius, y: centerY + Math.sin(radians) * radius };
  });
};

const childPoints = (child: CadBlockChild): CadWorldPoint[] => {
  switch (child.type) {
    case 'line':
      return [
        { x: child.fromX, y: child.fromY },
        { x: child.toX, y: child.toY },
      ];
    case 'polyline':
    case 'polygon':
      return [...child.vertices];
    case 'arc':
      return arcSamplePoints(child.centerX, child.centerY, child.radius, child.startAngleDeg, child.endAngleDeg);
    case 'text':
      return [{ x: child.x, y: child.y }];
  }
};

const unionBounds = (points: CadWorldPoint[]): CadBounds | null => {
  if (points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
};

/** Pure: local-space bounds of a definition (no reference applied). */
export const blockDefinitionBounds = (definition: CadBlockDefinition): CadBounds | null =>
  unionBounds(definition.entities.flatMap(childPoints));

/**
 * Pure: world-space bounds of a reference. Tight: each child is
 * transformed first, then bounded (corner/cardinal sampling), so rotation
 * never inflates the box beyond the transformed geometry's own extents.
 */
export const blockReferenceBounds = (
  definition: CadBlockDefinition,
  reference: BlockPlacement,
): CadBounds | null => unionBounds(expandBlockReference(definition, reference).flatMap(childPoints));

export interface ResolvedBlockReferenceAppearance {
  color?: string;
  lineTypeId?: string;
  lineweightMm?: number;
  transparency?: number;
}

/**
 * Child explicit > reference (already explicit-over-layer) > absent.
 * Returns explicit fields only: fields neither side defines stay absent
 * (ByLayer), never filled with defaults.
 */
export const resolveBlockChildAppearance = (
  childAppearance: CadEntityAppearance | undefined,
  referenceAppearance: ResolvedBlockReferenceAppearance | undefined,
): CadEntityAppearance => {
  const resolved: CadEntityAppearance = {};
  const color = childAppearance?.color ?? referenceAppearance?.color;
  const lineTypeId = childAppearance?.lineTypeId ?? referenceAppearance?.lineTypeId;
  const lineweightMm = childAppearance?.lineweightMm ?? referenceAppearance?.lineweightMm;
  const transparency = childAppearance?.transparency ?? referenceAppearance?.transparency;
  if (color != null) resolved.color = color;
  if (lineTypeId != null) resolved.lineTypeId = lineTypeId;
  if (lineweightMm != null) resolved.lineweightMm = lineweightMm;
  if (transparency != null) resolved.transparency = transparency;
  return resolved;
};

/** Definition lookup by id (linear; tables are small). */
export const findBlockDefinition = (
  definitions: readonly CadBlockDefinition[] | undefined,
  definitionId: string,
): CadBlockDefinition | undefined =>
  definitions?.find((definition) => definition.id === definitionId);
