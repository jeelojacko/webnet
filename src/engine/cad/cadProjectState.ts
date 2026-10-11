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
 * PERF-187: allocation-light canonical-equality check for history adoption.
 *
 * The history-adopt effect must preserve the EXACT equivalence of
 * `buildStableCadProjectSignature` equality (key-order-insensitive JSON):
 * the drawing sync clones the project (key order normalizes, e.g.
 * imported-TIN surface definitions), which is not an external update — a
 * plain reference or raw-stringify comparison would wipe the just-committed
 * transaction and disable undo/redo (Phase 18M precedent). The previous
 * implementation paid TWO complete canonical traversals + allocations +
 * JSON.stringify per effect run (including the same-reference mount).
 *
 * Two-phase comparison (PERF-187 P1 correction round 2):
 *   Phase 1 — a cheap full domain walk (`isPlainJsonDomainValue`) on BOTH
 *   distinct references establishes that neither input leaves the plain-JSON
 *   domain BEFORE any mismatch may be reported. This is required for
 *   traversal-order independence: an early structural difference (e.g.
 *   `{a:0,b:cycle}` vs `{a:1,b:cycle}`, or `{a:null}` vs `{a:1n}`) must not
 *   mask an exotic value later in the document, because the stable-signature
 *   oracle walks the whole document and throws on that exotic.
 *   Phase 2 — once both sides are known plain JSON, `canonicalValuesEqual`
 *   compares them with early exit.
 * Every DISTINCT-reference comparison therefore pays one cheap domain walk
 * per side plus one comparison walk. The plain-JSON production path (the
 * only path real project data takes) pays zero canonical-object allocation
 * and zero `JSON.stringify`. This is NOT a sublinear traversal for differing
 * documents: the domain walk always visits the whole tree, and only the
 * Phase 2 comparison exits early.
 *
 * Reference semantics (narrowed, PERF-187 P1 correction): inside
 * `canonicalValuesEqual` only NON-OBJECT (primitive/null) identity is
 * short-circuited; shared OBJECT references are compared structurally. This
 * keeps shared cyclic nested references on the ancestor-stack `fallback`
 * path, so the ORIGINAL serializer runs on both sides and exotic
 * throw-parity is preserved. `areCadProjectsCanonicallyEqual` additionally
 * returns `true` immediately for identical top-level references by contract,
 * WITHOUT consulting the serializer: that is the safe hook behavior (an
 * identical reference is never an external update, so no adopt and no undo
 * loss), whereas throwing would crash render. Cyclic graphs are therefore
 * outside this function's domain (no production path can deliver one —
 * every producer is JSON-serializable/deep-cloned, and persistence would
 * throw first). For DISTINCT references the comparator returns exactly
 * signature-equality, with serializer fallback on exotics (`toJSON`,
 * non-plain prototypes, bigint, `__proto__`, and cycles including shared
 * nested references).
 *
 * Fail-closed: anything outside the plain-JSON value domain falls back to
 * the ORIGINAL canonical-serializer comparison rather than risking a wrong
 * adopt/reset and user undo loss.
 *
 * Proxies whose traps lie consistently (data descriptors with shifting values,
 * invisible map/species swaps) are indistinguishable from plain data without
 * serializing and are outside this domain; no production path delivers proxies
 * (structured JSON/clone boundaries do not preserve them).
 */
const isJsonNullSerialized = (value: unknown): boolean =>
  value === null || (typeof value === 'number' && !Number.isFinite(value));

const isJsonSkippedObjectValue = (value: unknown): boolean =>
  value === undefined || typeof value === 'function' || typeof value === 'symbol';

const hasJsonToJSON = (value: object): boolean => {
  try {
    return typeof (value as { toJSON?: unknown }).toJSON === 'function';
  } catch {
    return true;
  }
};

type OwnPropertyProbe = 'data' | 'exotic' | 'absent';

/**
 * PERF-187 correction round 3: classify an OWN property WITHOUT invoking it.
 * Accessor descriptors (get/set) and thrown descriptor traps are exotic; a
 * missing descriptor is `absent` (a legitimate array hole, but exotic for
 * object keys drawn from `Object.keys`). Only `data` may be read: a stateful
 * getter read once by the domain scan and again by the comparison would
 * diverge from the serializer, which freezes each value once during
 * canonicalization.
 */
const probeOwnProperty = (target: object, key: string): OwnPropertyProbe => {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(target, key);
  } catch {
    return 'exotic';
  }
  if (descriptor === undefined || descriptor === null) return 'absent';
  if (descriptor.get !== undefined || descriptor.set !== undefined) return 'exotic';
  return 'data';
};

/**
 * PERF-187 Phase 1: cheap full walk deciding whether `value` stays inside the
 * plain-JSON domain that `canonicalValuesEqual` can compare structurally.
 * Returns `false` on any exotic the canonical serializer would treat
 * specially (accessor properties, bigint, non-plain prototype, own
 * `__proto__`, function-valued `toJSON`, an overridden `Array.prototype.map`,
 * or a reference cycle).
 *
 * `ancestors` is a stack, so a shared (non-cyclic) reference is fine while a
 * cycle is detected as an ancestor repeat. `undefined`/function/symbol
 * values are skipped exactly as JSON does, and a function object is never
 * recursed into (its properties are invisible to JSON).
 */
const isPlainJsonDomainValue = (value: unknown, ancestors: object[]): boolean => {
  if (value === null) return true;
  const type = typeof value;
  if (
    type === 'string' ||
    type === 'boolean' ||
    type === 'number' ||
    type === 'undefined' ||
    type === 'function' ||
    type === 'symbol'
  ) {
    return true;
  }
  if (type === 'bigint') return false;
  const objectValue = value as object;
  if (Array.isArray(objectValue)) return isPlainJsonArrayDomainValue(objectValue, ancestors);
  return isPlainJsonObjectDomainValue(objectValue, ancestors);
};

/**
 * Array half of the domain walk. Arrays are rebuilt through the virtual
 * `value.map`, so an own/inherited `toJSON` (honored because the species
 * result keeps an Array subclass prototype) or an overridden `map` leaves the
 * plain-JSON domain and routes to the serializer fallback. Only plain arrays
 * with `Array.prototype` keep the fast path: an underlying `map` of
 * `Array.prototype.map` plus JSON's index-only array serialization means extra
 * props are ignored identically on both sides.
 */
const isPlainJsonArrayDomainValue = (array: unknown[], ancestors: object[]): boolean => {
  if (ancestors.includes(array)) return false;
  // Strict plain-array prototype check. Any Array subclass (including one
  // whose `static get [Symbol.species]() { return Object; }` makes the native
  // `map` return a non-array) leaves the plain-JSON domain; the retained
  // `map`-identity check below cannot see species, so this single prototype
  // condition subsumes Symbol.species and every other subclass quirk. Plain
  // production arrays (JSON.parse/clone output) keep the fast path. A trap
  // that throws is exotic too.
  try {
    if (Object.getPrototypeOf(array) !== Array.prototype) return false;
  } catch {
    return false;
  }
  // Probe the own `toJSON` slot before reading it so a getter is never
  // invoked; an inherited `toJSON` is unreachable now that subclasses are
  // rejected, but the own-slot probe is still required for a plain array.
  if (probeOwnProperty(array, 'toJSON') === 'exotic') return false;
  if (hasJsonToJSON(array)) return false;
  // Retained deliberately: an own `map` data property on a plain-prototype
  // array would otherwise slip through the prototype check above.
  try {
    if (array.map !== Array.prototype.map) return false;
  } catch {
    return false;
  }
  ancestors.push(array);
  try {
    for (let index = 0; index < array.length; index += 1) {
      const probe = probeOwnProperty(array, String(index));
      if (probe === 'exotic') return false;
      if (probe === 'absent') continue; // hole → JSON serializes null, plain
      const item = index in array ? array[index] : undefined;
      if (isJsonSkippedObjectValue(item)) continue;
      if (!isPlainJsonDomainValue(item, ancestors)) return false;
    }
    return true;
  } finally {
    ancestors.pop();
  }
};

/**
 * Plain-object half of the domain walk. Each own enumerable key is probed for
 * an accessor before its value is read, and `toJSON` is checked only after
 * every descriptor is confirmed pure data.
 */
const isPlainJsonObjectDomainValue = (record: object, ancestors: object[]): boolean => {
  const proto = Object.getPrototypeOf(record);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Object.keys(record);
  if (keys.includes('__proto__')) return false;
  if (ancestors.includes(record)) return false;
  ancestors.push(record);
  try {
    const values = record as Record<string, unknown>;
    for (const key of keys) {
      if (probeOwnProperty(record, key) !== 'data') return false;
      const item = values[key];
      if (isJsonSkippedObjectValue(item)) continue;
      if (!isPlainJsonDomainValue(item, ancestors)) return false;
    }
    // Only reaches here once every own enumerable value is a pure data
    // property, so this cannot invoke a getter-defined `toJSON`.
    if (probeOwnProperty(record, 'toJSON') === 'exotic') return false;
    if (hasJsonToJSON(record)) return false;
    return true;
  } finally {
    ancestors.pop();
  }
};

type CanonicalEquality = boolean | 'fallback';

const canonicalValuesEqual = (
  first: unknown,
  second: unknown,
  firstAncestors: readonly object[] | object[],
  secondAncestors: readonly object[] | object[],
): CanonicalEquality => {
  // Only primitives/null may short-circuit on identity. Object identity (a
  // shared nested reference in particular) must fall through to structural
  // comparison so cycles reach the ancestor-stack `fallback` path and keep
  // serializer throw-parity.
  if (first === second && (typeof first !== 'object' || first === null)) return true;
  const firstNull = isJsonNullSerialized(first);
  const secondNull = isJsonNullSerialized(second);
  if (firstNull || secondNull) return firstNull && secondNull;
  if (typeof first === 'number' || typeof second === 'number') return false;
  if (typeof first !== 'object' || typeof second !== 'object' || first === null || second === null) {
    if (typeof first === 'bigint' || typeof second === 'bigint') return 'fallback';
    return false;
  }
  if (hasJsonToJSON(first) || hasJsonToJSON(second)) return 'fallback';
  const firstIsArray = Array.isArray(first);
  const secondIsArray = Array.isArray(second);
  if (firstIsArray || secondIsArray) {
    if (!firstIsArray || !secondIsArray) return false;
    if ((firstAncestors as object[]).includes(first) || (secondAncestors as object[]).includes(second)) {
      return 'fallback';
    }
    if (first.length !== second.length) return false;
    (firstAncestors as object[]).push(first);
    (secondAncestors as object[]).push(second);
    try {
      for (let index = 0; index < first.length; index += 1) {
        const firstItem = index in first ? first[index] : undefined;
        const secondItem = index in second ? second[index] : undefined;
        // JSON.stringify maps undefined/functions/symbols (and holes) to null in arrays.
        const firstElement = isJsonSkippedObjectValue(firstItem) ? null : firstItem;
        const secondElement = isJsonSkippedObjectValue(secondItem) ? null : secondItem;
        if (typeof firstElement === 'bigint' || typeof secondElement === 'bigint') return 'fallback';
        const nested = canonicalValuesEqual(firstElement, secondElement, firstAncestors, secondAncestors);
        if (nested !== true) return nested;
      }
      return true;
    } finally {
      (firstAncestors as object[]).pop();
      (secondAncestors as object[]).pop();
    }
  }
  const firstProto = Object.getPrototypeOf(first);
  const secondProto = Object.getPrototypeOf(second);
  if (
    (firstProto !== Object.prototype && firstProto !== null) ||
    (secondProto !== Object.prototype && secondProto !== null)
  ) {
    return 'fallback';
  }
  if ((firstAncestors as object[]).includes(first) || (secondAncestors as object[]).includes(second)) {
    return 'fallback';
  }
  // JSON.stringify drops undefined/function/symbol-valued keys; the
  // canonicalizer preserves then drops them identically, so skip here.
  // `__proto__` is excluded: plain assignment would mutate the prototype
  // instead of creating an own property, diverging from key comparison.
  const firstKeys: string[] = [];
  for (const key of Object.keys(first)) {
    if (key === '__proto__') return 'fallback';
    const value = (first as Record<string, unknown>)[key];
    if (typeof value === 'bigint') return 'fallback';
    if (!isJsonSkippedObjectValue(value)) firstKeys.push(key);
  }
  const secondKeys: string[] = [];
  for (const key of Object.keys(second)) {
    if (key === '__proto__') return 'fallback';
    const value = (second as Record<string, unknown>)[key];
    if (typeof value === 'bigint') return 'fallback';
    if (!isJsonSkippedObjectValue(value)) secondKeys.push(key);
  }
  firstKeys.sort();
  secondKeys.sort();
  if (firstKeys.length !== secondKeys.length) return false;
  for (let index = 0; index < firstKeys.length; index += 1) {
    if (firstKeys[index] !== secondKeys[index]) return false;
  }
  (firstAncestors as object[]).push(first);
  (secondAncestors as object[]).push(second);
  try {
    for (const key of firstKeys) {
      const nested = canonicalValuesEqual(
        (first as Record<string, unknown>)[key],
        (second as Record<string, unknown>)[key],
        firstAncestors,
        secondAncestors,
      );
      if (nested !== true) return nested;
    }
    return true;
  } finally {
    (firstAncestors as object[]).pop();
    (secondAncestors as object[]).pop();
  }
};

/**
 * Canonical project equality for history adoption.
 *
 * Identical references return `true` by contract WITHOUT consulting the
 * serializer (see the module doc above): an identical reference is never an
 * external update, so adopting/resetting would wrongly wipe the
 * just-committed transaction, whereas throwing would crash render. Cyclic
 * graphs are outside this function's domain (no production path can deliver
 * one). For DISTINCT references this returns exactly
 * `buildStableCadProjectSignature(first) === buildStableCadProjectSignature(second)`.
 *
 * Phase 1 (`isPlainJsonDomainValue`) walks BOTH inputs fully with fresh
 * ancestor stacks before Phase 2 may report any mismatch; if either side
 * leaves the plain-JSON domain, both serializations run (first-then-second,
 * matching the oracle's evaluation order and throw parity) for exotics
 * (`toJSON`, non-plain prototypes, bigint, `__proto__`, and cycles including
 * shared nested references). Phase 2 then reuses the early-exit
 * `canonicalValuesEqual` walk; its own exotic fallbacks remain as
 * unreachable defense-in-depth.
 *
 * Proxies whose traps lie consistently (data descriptors with shifting values,
 * invisible map/species swaps) are indistinguishable from plain data without
 * serializing and are outside this domain; no production path delivers proxies
 * (structured JSON/clone boundaries do not preserve them).
 */
export const areCadProjectsCanonicallyEqual = (first: CadProject, second: CadProject): boolean => {
  if (first === second) return true;
  if (first === null || second === null || typeof first !== 'object' || typeof second !== 'object') {
    return buildStableCadProjectSignature(first) === buildStableCadProjectSignature(second);
  }
  if (!isPlainJsonDomainValue(first, []) || !isPlainJsonDomainValue(second, [])) {
    return buildStableCadProjectSignature(first) === buildStableCadProjectSignature(second);
  }
  const result = canonicalValuesEqual(first, second, [], []);
  if (result === 'fallback') {
    return buildStableCadProjectSignature(first) === buildStableCadProjectSignature(second);
  }
  return result;
};
