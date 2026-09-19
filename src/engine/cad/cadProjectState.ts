import { cadIsAngleOnArcSweep } from './cadGeometry';
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
        break;
      case 'arc':
        arcEndPoints(entity).forEach((point) => includePoint(point.x, point.y));
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
