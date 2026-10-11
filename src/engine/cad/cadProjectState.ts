import { cadIsAngleOnArcSweep } from './cadGeometry';
import { parcelArcBoundsPoints } from './cadParcelArcGeometry';
import { cadPolylineWidthEnvelopePoints } from './cadPolylineCourses';
import { cadParabolaEntityBounds } from './cadParabola';
import { getFeatureLineCourseCount } from './cadFeatureLines';
import type { CadFeatureLineEntity, CadParcelEntity } from './cadTypes';
import { blockReferenceBounds, findBlockDefinition } from './cadBlocks';
import type { CadCogoComputation } from './cadCogoTypes';
import type { CadBlockDefinition, CadBounds, CadEntity, CadProject } from './cadTypes';

const arcEndPoints = ({
  centerX,
  centerY,
  radius,
  startAngleDeg,
  endAngleDeg,
}: {
  centerX: number;
  centerY: number;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}): Array<{ x: number; y: number }> => {
  const sampleAngles = [startAngleDeg, endAngleDeg];
  [0, 90, 180, 270].forEach((candidate) => {
    if (cadIsAngleOnArcSweep(candidate, startAngleDeg, endAngleDeg)) {
      sampleAngles.push(candidate);
    }
  });
  return sampleAngles.map((angleDeg) => {
    const radians = (angleDeg * Math.PI) / 180;
    return {
      x: centerX + Math.cos(radians) * radius,
      y: centerY + Math.sin(radians) * radius,
    };
  });
};

/**
 * Phase 19C: parcel arc extrema (quadrant points inside each arc course
 * sweep). Straight parcels (absent/invalid geometry) keep the
 * vertices-only path bit-identically; invalid arc entries contribute
 * nothing here (resolver/closure fail safe separately).
 */
const includeParcelArcExtrema = (
  parcel: CadParcelEntity,
  includePoint: (_x: number, _y: number) => void,
): void => {
  const geometry = parcel.courseGeometry;
  if (geometry == null || geometry.length !== parcel.vertices.length) return;
  parcel.vertices.forEach((from, index) => {
    const entry = geometry[index];
    if (entry?.kind !== 'arc' || !Number.isFinite(entry.bulge)) return;
    const to = parcel.vertices[(index + 1) % parcel.vertices.length]!;
    parcelArcBoundsPoints(from, to, entry.bulge).forEach((point) =>
      includePoint(point.x, point.y),
    );
  });
};

/** Phase 20A: exact XY bounds of a feature line incl arc-course extrema. */
const includeFeatureLineArcExtrema = (
  entity: CadFeatureLineEntity,
  includePoint: (_x: number, _y: number) => void,
): void => {
  const geometry = entity.segmentGeometry;
  const courseCount = getFeatureLineCourseCount(entity);
  if (geometry == null || geometry.length !== courseCount) return;
  for (let index = 0; index < courseCount; index += 1) {
    const entry = geometry[index];
    if (entry?.kind !== 'arc' || !Number.isFinite(entry.bulge)) continue;
    const from = entity.vertices[index]!;
    const to = entity.vertices[(index + 1) % entity.vertices.length]!;
    parcelArcBoundsPoints(from, to, entry.bulge).forEach((point) =>
      includePoint(point.x, point.y),
    );
  }
};

export const buildCadBounds = (
  entities: CadEntity[],
  blockDefinitions?: readonly CadBlockDefinition[],
): CadBounds | null => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const includePoint = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  entities.forEach((entity) => {
    switch (entity.type) {
      case 'survey-point':
      case 'text':
        includePoint(entity.x, entity.y);
        break;
      case 'line':
        includePoint(entity.fromX, entity.fromY);
        includePoint(entity.toX, entity.toY);
        break;
      case 'polyline':
      case 'polygon':
      case 'parcel':
        entity.vertices.forEach((vertex) => includePoint(vertex.x, vertex.y));
        if (entity.type === 'parcel') includeParcelArcExtrema(entity, includePoint);
        if (entity.type === 'polyline' && (entity.segmentGeometry != null || entity.segmentWidths != null)) {
          // Phase C2: true arc extrema + half-width band envelope join the
          // drawing bounds (malformed metadata stays vertex-only, fail safe).
          cadPolylineWidthEnvelopePoints(entity).forEach((point) => includePoint(point.x, point.y));
        }
        break;
      case 'feature-line':
        entity.vertices.forEach((vertex) => includePoint(vertex.x, vertex.y));
        includeFeatureLineArcExtrema(entity, includePoint);
        break;
      case 'arc':
        arcEndPoints(entity).forEach((point) => includePoint(point.x, point.y));
        break;
      case 'circle':
        includePoint(entity.centerX - entity.radius, entity.centerY - entity.radius);
        includePoint(entity.centerX + entity.radius, entity.centerY + entity.radius);
        break;
      case 'alignment':
        entity.elements.forEach((element) => {
          if (element.kind === 'line') {
            includePoint(element.start.x, element.start.y);
            includePoint(element.end.x, element.end.y);
            return;
          }
          arcEndPoints({
            centerX: element.center.x,
            centerY: element.center.y,
            radius: element.radius,
            startAngleDeg: element.startAngleDeg,
            endAngleDeg: element.endAngleDeg,
          }).forEach((point) => includePoint(point.x, point.y));
        });
        break;
      case 'error-ellipse':
        includePoint(entity.centerX - entity.semiMajor, entity.centerY - entity.semiMajor);
        includePoint(entity.centerX + entity.semiMajor, entity.centerY + entity.semiMajor);
        break;
      case 'parabola': {
        // Analytic AABB (finite ends + in-range axis extrema), never the
        // chord hull; invalid geometry contributes nothing.
        const box = cadParabolaEntityBounds(entity);
        if (box) {
          includePoint(box.minX, box.minY);
          includePoint(box.maxX, box.maxY);
        }
        break;
      }
      case 'block-reference': {
        // Single source: world-space expansion bounds; unknown definitions
        // (or bad scales) fall back to the insertion point, never crash.
        const definition = blockDefinitions
          ? findBlockDefinition(blockDefinitions, entity.blockDefinitionId)
          : undefined;
        let world: CadBounds | null = null;
        if (definition) {
          try {
            world = blockReferenceBounds(definition, entity);
          } catch {
            world = null;
          }
        }
        if (world) {
          includePoint(world.minX, world.minY);
          includePoint(world.maxX, world.maxY);
        } else {
          includePoint(entity.x, entity.y);
        }
        break;
      }
      default:
        break;
    }
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
};

export const replaceCadProjectEntities = (
  project: CadProject,
  entities: CadEntity[],
): CadProject => ({
  ...project,
  entities,
  bounds: buildCadBounds(entities, project.blockDefinitions),
});

export const appendCadProjectEntities = (
  project: CadProject,
  entitiesToAppend: CadEntity[],
): CadProject => replaceCadProjectEntities(project, [...project.entities, ...entitiesToAppend]);

export const appendCadProjectCogoComputation = (
  project: CadProject,
  computation: CadCogoComputation,
): CadProject => ({
  ...project,
  cogoComputations: [...(project.cogoComputations ?? []), computation],
});

export const buildCadProjectSignature = (project: CadProject): string =>
  JSON.stringify(project);

/**
 * Key-order-insensitive project signature for history-adoption checks.
 *
 * Clone helpers (e.g. `cloneCadSurfaceDefinition`) rebuild objects with a
 * fixed key order, so a drawing synced through `cloneCadDrawingDocument`
 * is semantically identical but `JSON.stringify`-different from the
 * history-side project. Comparing canonical signatures keeps the
 * external-adopt effect from mistaking that normalization for an external
 * update and wiping the undo stack. Value changes still differ.
 */
const canonicalizeSignatureValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeSignatureValue);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const canonical: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      canonical[key] = canonicalizeSignatureValue(source[key]);
    }
    return canonical;
  }
  return value;
};

export const buildStableCadProjectSignature = (project: CadProject): string =>
  JSON.stringify(canonicalizeSignatureValue(project));

/**
 * PERF-187 P1: raw-JSON fast path for history-adoption canonical equality.
 *
 * Contract (inert JSON / engine-clone-producible data): identical top-level
 * references return `true`; every other accepted value returns exactly
 * `buildStableCadProjectSignature(first) ===
 * buildStableCadProjectSignature(second)`, and it throws wherever that
 * canonical oracle throws. The non-inert exclusions documented below are the
 * only known divergences.
 *
 * Why raw equality implies canonical equality (inert data): two distinct
 * references with identical `JSON.stringify` output denote the same observable
 * JSON structure, key order included. `canonicalizeSignatureValue` is
 * deterministic over that structure (arrays map in index order; object keys
 * are read from `Object.keys` and sorted), so canonicalizing two raw-equal
 * values yields equal canonical output.
 *
 * SAFETY DIRECTION: for inert JSON / engine-clone-producible data,
 * false-direction parity is total — the raw fast path can only ever err toward
 * `true` (identical observable JSON -> keep the current history, never wipe
 * it), while `false` is produced exclusively by the exact canonical oracle
 * fallback. The hook adopts only when this returns `false`, so for that data
 * no input can cause a spurious history wipe beyond what the oracle itself
 * orders.
 *
 * Documented exclusions (production-impossible inputs):
 *  - `Array`-subclass family: `JSON.stringify` serializes any `Array.isArray`
 *    value by index, while the canonicalizer maps through
 *    `Array.prototype.map`, which honors `Symbol.species` and an overridden
 *    `map`. The raw pair can therefore return `true` where the oracle returns
 *    `false` (K1): an intentional SAFE-DIRECTION divergence (`true` = keep
 *    history), not a faithful route to the oracle. `JSON.parse`, structured
 *    clone, and every engine clone yield only plain `Array.prototype` arrays
 *    (verified zero non-plain arrays on a real 10k-entity project), so this
 *    hole is unreachable.
 *  - Stateful accessors: the raw pass reads each getter once and, when the raw
 *    strings differ (e.g. key order), the canonical fallback reads them again,
 *    so the helper may observe a different value than the oracle, which
 *    canonicalizes each side exactly once. Example: side A
 *    `{ x: <counter getter: 1 then 2>, y }` vs side B `{ y, x: 1 }` — the
 *    oracle reads the getter once and reports `true`, while the helper's raw
 *    pass consumes read 1 and its fallback re-reads 2, so the helper reports
 *    `false`. Inert data has data descriptors only (`JSON.parse`/engine clones
 *    never produce getters), so this is production-impossible; the test file
 *    pins the divergence as a documented exclusion.
 *  - An identity-sensitive `toJSON` (reading mutable identity) is likewise a
 *    documented exclusion, the same accepted family as proxies.
 *
 * Cost model (honest): same reference = 0 work. The common order-preserved
 * clone (the production drawing-sync path) pays two native `JSON.stringify`
 * calls and skips the canonical traversal entirely: measured ~2-4x faster than
 * the old two-canonical-tree path on equal objects. A reordered clone or a
 * genuine change (rare) wastes the raw pair and still runs the full canonical
 * oracle, ~1.4-2x slower than the old path on that branch. This is NOT a
 * zero-allocation fast path: it avoids building canonical full deep-copy
 * objects, but on the common branch the only large allocations are the two raw
 * JSON strings themselves (the old path allocated two canonical trees, two
 * strings, and the string compare). Exact measurements live in the PERF-187
 * evidence docs.
 *
 * Cycles and proxies are outside the raw domain; the raw pair is wrapped in
 * `try`/`catch` and otherwise routes to the canonical oracle, whose evaluation
 * order (first, then second) and throw behavior are preserved. The
 * `Array`-subclass family additionally diverges in the safe direction per the
 * K1 exclusion above.
 */
export const areCadProjectsCanonicallyEqual = (first: CadProject, second: CadProject): boolean => {
  if (first === second) return true;
  if (first === null || second === null || typeof first !== 'object' || typeof second !== 'object') {
    return buildStableCadProjectSignature(first) === buildStableCadProjectSignature(second);
  }
  let rawFirst: string | undefined;
  let rawSecond: string | undefined;
  try {
    rawFirst = JSON.stringify(first);
    rawSecond = JSON.stringify(second);
  } catch {
    return buildStableCadProjectSignature(first) === buildStableCadProjectSignature(second);
  }
  if (rawFirst === undefined || rawSecond === undefined) {
    return buildStableCadProjectSignature(first) === buildStableCadProjectSignature(second);
  }
  if (rawFirst === rawSecond) return true;
  return buildStableCadProjectSignature(first) === buildStableCadProjectSignature(second);
};
