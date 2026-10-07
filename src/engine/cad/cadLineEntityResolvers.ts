/**
 * CAD Draw Phase L1 — resolvers that operate on existing drawing entities:
 * from-end extension (line/arc/open-polyline) and the line extension edit.
 *
 * These are pure: they return a new value/entity and never mutate the source.
 * Extension is an EDIT — the returned line keeps its id, layer, metadata and
 * station labels; the session applies it with one undo entry.
 */
import { checkCadEntityEditable } from './cadAppearance';
import {
  cadDistance,
  cadSignedSweepDeg,
  type CadWorldPoint,
} from './cadGeometry';
import { parseCadLineExtensionTarget } from './cadLineParsers';
import {
  CAD_LINE_DEGENERATE_FLOOR,
  cadLineFail,
  cadLineOk,
  type CadLineExtensionResult,
  type CadLineResult,
} from './cadLineTypes';
import type { CadEntity, CadEntityId, CadLineEntity, CadProject } from './cadTypes';

export type CadLineFromEndEndpoint = 'start' | 'end';

const unitVector = (from: CadWorldPoint, to: CadWorldPoint): CadWorldPoint | null => {
  const length = cadDistance(from, to);
  if (length <= CAD_LINE_DEGENERATE_FLOOR) return null;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

/** True tangent direction (travel direction) at an arc angle. */
const arcTravelDirection = (angleDeg: number, sweepSign: number): CadWorldPoint => {
  const radians = (angleDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return sweepSign >= 0 ? { x: -sine, y: cosine } : { x: sine, y: -cosine };
};

const outwardFromEndpoint = (
  entity: CadEntity,
  endpoint: CadLineFromEndEndpoint,
): CadLineResult<{ point: CadWorldPoint; direction: CadWorldPoint }> => {
  if (entity.type === 'line') {
    const from = { x: entity.fromX, y: entity.fromY };
    const to = { x: entity.toX, y: entity.toY };
    return endpoint === 'end'
      ? directionResult(to, unitVector(from, to))
      : directionResult(from, unitVector(to, from));
  }
  if (entity.type === 'arc') {
    if (!Number.isFinite(entity.radius) || entity.radius <= CAD_LINE_DEGENERATE_FLOOR) {
      return cadLineFail('DEGENERATE', 'Arc radius is not usable.');
    }
    const center = { x: entity.centerX, y: entity.centerY };
    const sweepSign = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg);
    const angleDeg = endpoint === 'end' ? entity.endAngleDeg : entity.startAngleDeg;
    const radians = (angleDeg * Math.PI) / 180;
    const point = {
      x: center.x + Math.cos(radians) * entity.radius,
      y: center.y + Math.sin(radians) * entity.radius,
    };
    const travel = arcTravelDirection(angleDeg, sweepSign);
    return endpoint === 'end'
      ? cadLineOk({ point, direction: travel })
      : cadLineOk({ point, direction: { x: -travel.x, y: -travel.y } });
  }
  if (entity.type === 'polyline') {
    if (entity.closed) return cadLineFail('CLOSED_SOURCE_UNSUPPORTED', 'Closed polylines have no extendable end.');
    const vertices = entity.vertices;
    if (vertices.length < 2) return cadLineFail('DEGENERATE', 'Polyline has no terminal segment.');
    const terminal = endpoint === 'end' ? vertices.length - 1 : 0;
    const neighbor = endpoint === 'end' ? vertices.length - 2 : 1;
    return directionResult(vertices[terminal], unitVector(vertices[neighbor], vertices[terminal]));
  }
  if (entity.type === 'circle') {
    return cadLineFail('CLOSED_SOURCE_UNSUPPORTED', 'A circle has no extendable endpoint.');
  }
  return cadLineFail('ENTITY_TYPE_UNSUPPORTED', `Cannot extend a ${entity.type} entity from an end.`);
};

const directionResult = (
  point: CadWorldPoint,
  direction: CadWorldPoint | null,
): CadLineResult<{ point: CadWorldPoint; direction: CadWorldPoint }> =>
  direction ? cadLineOk({ point, direction }) : cadLineFail('DEGENERATE', 'Source has zero length.');

/**
 * From-end resolver: line extends collinear outward, arc extends along the
 * true tangent at the selected endpoint, and an open polyline extends along
 * its terminal segment only. Closed polylines and circles reject.
 */
export const resolveCadLineFromEnd = (
  entity: CadEntity,
  input: { endpoint: CadLineFromEndEndpoint; distance: number },
): CadLineResult<CadWorldPoint> => {
  if (!Number.isFinite(input.distance) || input.distance <= 0) {
    return cadLineFail('DISTANCE_OUT_OF_RANGE', `Extension distance ${input.distance} is not positive.`);
  }
  const base = outwardFromEndpoint(entity, input.endpoint);
  if (!base.ok) return base;
  return cadLineOk({
    x: base.value.point.x + base.value.direction.x * input.distance,
    y: base.value.point.y + base.value.direction.y * input.distance,
  });
};

/**
 * Extension edit resolver. Proximity selects which line end moves; a midpoint
 * tie fails closed (repick). Supports a signed delta and an explicit total
 * length. The opposite end is fixed and station labels are preserved.
 */
export const resolveCadLineExtension = (
  project: Pick<CadProject, 'entities' | 'layers' | 'styleLibrary'>,
  input: {
    entityId: CadEntityId;
    pickPoint: CadWorldPoint;
    target: { kind: 'delta'; delta: number } | { kind: 'total'; total: number };
  },
): CadLineResult<CadLineExtensionResult> => {
  const entity = project.entities.find((candidate) => candidate.id === input.entityId);
  if (!entity) return cadLineFail('ENTITY_NOT_FOUND', `No entity "${input.entityId}".`);
  if (entity.type !== 'line') {
    return cadLineFail('ENTITY_TYPE_UNSUPPORTED', 'Line extension requires a line entity.');
  }
  if (!checkCadEntityEditable(project, entity).editable) {
    return cadLineFail('ENTITY_NOT_EDITABLE', 'The line is locked or hidden.');
  }
  const from = { x: entity.fromX, y: entity.fromY };
  const to = { x: entity.toX, y: entity.toY };
  const length = cadDistance(from, to);
  if (length <= CAD_LINE_DEGENERATE_FLOOR) return cadLineFail('DEGENERATE', 'Line has zero length.');

  const toStart = cadDistance(input.pickPoint, from);
  const toEnd = cadDistance(input.pickPoint, to);
  if (Math.abs(toStart - toEnd) <= CAD_LINE_DEGENERATE_FLOOR) {
    return cadLineFail('AMBIGUOUS_ENDPOINT', 'Pick is equidistant from both line ends; repick nearer an end.');
  }
  const movesTo = toEnd < toStart;
  const newLength =
    input.target.kind === 'delta' ? length + input.target.delta : input.target.total;
  if (!Number.isFinite(newLength) || newLength <= CAD_LINE_DEGENERATE_FLOOR) {
    return cadLineFail('DEGENERATE', `Resulting line length ${newLength} is not above the floor.`);
  }
  const fixed = movesTo ? from : to;
  const moved = movesTo ? to : from;
  const direction = unitVector(fixed, moved);
  if (!direction) return cadLineFail('DEGENERATE', 'Line direction is not usable.');
  const newPoint = {
    x: fixed.x + direction.x * newLength,
    y: fixed.y + direction.y * newLength,
  };
  const updated: CadLineEntity = movesTo
    ? { ...entity, toX: newPoint.x, toY: newPoint.y }
    : { ...entity, fromX: newPoint.x, fromY: newPoint.y };
  return cadLineOk({
    entity: updated,
    endpoint: movesTo ? 'to' : 'from',
    entityId: entity.id,
  });
};

/** Text convenience: parse `+5` / `T10` then resolve the extension. */
export const resolveCadLineExtensionFromText = (
  project: Pick<CadProject, 'entities' | 'layers' | 'styleLibrary'>,
  input: { entityId: CadEntityId; pickPoint: CadWorldPoint; text: string },
): CadLineResult<CadLineExtensionResult> => {
  const target = parseCadLineExtensionTarget(input.text);
  if (!target.ok) return target;
  return resolveCadLineExtension(project, { entityId: input.entityId, pickPoint: input.pickPoint, target: target.value });
};
