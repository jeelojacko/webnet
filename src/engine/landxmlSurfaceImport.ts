import { LandXmlImportError, parseLandXmlNE } from './landxmlCoords';
import type { GvxXmlNode } from './gnssGvxXml';

/**
 * Phase 18L — LandXML TIN surface parsing + fail-closed face validation.
 *
 * Reads Surfaces/Surface/Definition/Pnts/P/Faces/F and produces compact
 * metre-space topology (vertices [x,y,z …], faces [a,b,c …], CCW). Faces
 * resolve through a LandXML-P-id→index map — ids are arbitrary
 * positiveIntegers (the official sample starts at id="2"), never assumed
 * contiguous or zero-based. No Delaunay anywhere on this path: the file's
 * explicit topology IS the surface.
 */

export type LandXmlSurfaceDisposition = 'IMPORTABLE' | 'WARNING' | 'UNSUPPORTED' | 'BLOCKED';

export type LandXmlSurfaceReasonCode =
  | 'LANDXML_SURFACE_GRID_UNSUPPORTED'
  | 'LANDXML_SURFACE_MISSING_DEFINITION'
  | 'LANDXML_SURFACE_TOO_FEW_POINTS'
  | 'LANDXML_SURFACE_BAD_POINT'
  | 'LANDXML_SURFACE_FACE_REF_COUNT'
  | 'LANDXML_SURFACE_FACE_UNKNOWN_REF'
  | 'LANDXML_SURFACE_FACE_DEGENERATE'
  | 'LANDXML_SURFACE_FACE_ZERO_AREA'
  | 'LANDXML_SURFACE_DUPLICATE_FACE'
  | 'LANDXML_SURFACE_DUPLICATE_XY_CONFLICT'
  | 'LANDXML_SURFACE_NON_MANIFOLD'
  | 'LANDXML_SURFACE_NO_FACES';

export interface LandXmlImportedSurface {
  readonly name: string;
  readonly desc?: string;
  readonly disposition: LandXmlSurfaceDisposition;
  readonly reasonCode?: LandXmlSurfaceReasonCode;
  /** Compact metres E/N/Z. Empty unless IMPORTABLE/WARNING. */
  readonly vertices: readonly number[];
  /** Compact CCW index triples. Empty unless IMPORTABLE/WARNING. */
  readonly faces: readonly number[];
  readonly warnings: readonly string[];
}

const localName = (name: string): string => {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
};

const directChildren = (node: GvxXmlNode, name: string): GvxXmlNode[] =>
  node.children.filter((child) => localName(child.name) === name);

const firstChild = (node: GvxXmlNode, name: string): GvxXmlNode | undefined =>
  directChildren(node, name)[0];

const fail = (message: string): never => {
  throw new LandXmlImportError(message);
};

/** Math-CCW signed double area over plan (internal mesh convention: CCW positive). */
const signedArea2 = (
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): number => (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);

interface ParsedPoint { x: number; y: number; z: number }

const blocked = (
  name: string, desc: string | undefined, reasonCode: LandXmlSurfaceReasonCode, warnings: string[],
): LandXmlImportedSurface => ({
  name, ...(desc != null ? { desc } : {}),
  disposition: 'BLOCKED', reasonCode, vertices: [], faces: [], warnings,
});

const unsupported = (
  name: string, desc: string | undefined, reasonCode: LandXmlSurfaceReasonCode, warnings: string[],
): LandXmlImportedSurface => ({
  name, ...(desc != null ? { desc } : {}),
  disposition: 'UNSUPPORTED', reasonCode, vertices: [], faces: [], warnings,
});

/**
 * Parse every <Surface> under the document. Fail-closed PER SURFACE: one bad
 * face blocks its surface (BLOCKED + stable code), never the whole file and
 * never a silent truncation. GRID surfaces are UNSUPPORTED, never triangulated.
 */
export const parseLandXmlSurfaces = (
  root: GvxXmlNode,
  toMetres: number,
  fileName: string,
): LandXmlImportedSurface[] => {
  const out: LandXmlImportedSurface[] = [];
  const visit = (node: GvxXmlNode): void => {
    if (localName(node.name) === 'Surface') out.push(parseSurface(node, toMetres, fileName));
    node.children.forEach(visit);
  };
  visit(root);
  return out;
};

const parseSurface = (el: GvxXmlNode, toMetres: number, _fileName: string): LandXmlImportedSurface => {
  const name = (el.attrs.name ?? '').trim() || 'SURFACE-1';
  const desc = el.attrs.desc?.trim() ? el.attrs.desc.trim() : undefined;
  const what = `Surface ${JSON.stringify(name)}`;
  const definition = firstChild(el, 'Definition');
  if (!definition) {
    return blocked(name, desc, 'LANDXML_SURFACE_MISSING_DEFINITION',
      [`${what} has no Definition — surface blocked.`]);
  }
  const surfType = (definition.attrs.surfType ?? '').trim().toLowerCase();
  if (surfType !== 'tin') {
    if (surfType === 'grid') {
      return unsupported(name, desc, 'LANDXML_SURFACE_GRID_UNSUPPORTED',
        [`${what} is a GRID surface — no native grid model, not triangulated.`]);
    }
    return blocked(name, desc, 'LANDXML_SURFACE_MISSING_DEFINITION',
      [`${what} has surfType ${JSON.stringify(definition.attrs.surfType ?? '')} (need "TIN").`]);
  }

  const pnts = firstChild(definition, 'Pnts');
  const pEls = pnts ? directChildren(pnts, 'P') : [];
  if (pEls.length < 3) {
    return blocked(name, desc, 'LANDXML_SURFACE_TOO_FEW_POINTS',
      [`${what} has ${pEls.length} points (need ≥3).`]);
  }
  // Arbitrary positiveInteger ids → compact index map (never contiguous/zero-based).
  const idToIndex = new Map<string, number>();
  const points: ParsedPoint[] = [];
  for (const p of pEls) {
    const id = (p.attrs.id ?? '').trim();
    if (!id || idToIndex.has(id)) {
      return blocked(name, desc, 'LANDXML_SURFACE_BAD_POINT',
        [`${what} has a P with missing/duplicate id ${JSON.stringify(id || '?')}.`]);
    }
    let northing = 0;
    let easting = 0;
    let elev = 0;
    try {
      [northing, easting, elev] = parseLandXmlNE(p.text, `${what} P id=${JSON.stringify(id)}`);
    } catch {
      return blocked(name, desc, 'LANDXML_SURFACE_BAD_POINT',
        [`${what} P id=${JSON.stringify(id)} has non-finite coordinates.`]);
    }
    idToIndex.set(id, points.length);
    points.push({ x: easting * toMetres, y: northing * toMetres, z: elev * toMetres });
  }

  const facesEl = firstChild(definition, 'Faces');
  const fEls = facesEl ? directChildren(facesEl, 'F') : [];
  if (fEls.length === 0) {
    return blocked(name, desc, 'LANDXML_SURFACE_NO_FACES',
      [`${what} has no Faces — surface blocked.`]);
  }

  // Duplicate-XY policy mirrors the native TIN: exact-equal Z dedupes
  // silently, materially-different Z blocks (no epsilon snap, never average).
  const xyToIndex = new Map<string, number>();
  const remap: number[] = new Array<number>(points.length);
  const vertices: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const key = `${p.x},${p.y}`;
    const prior = xyToIndex.get(key);
    if (prior == null) {
      xyToIndex.set(key, vertices.length / 3);
      remap[i] = vertices.length / 3;
      vertices.push(p.x, p.y, p.z);
      continue;
    }
    const priorZ = vertices[prior * 3 + 2]!;
    if (priorZ !== p.z) {
      return blocked(name, desc, 'LANDXML_SURFACE_DUPLICATE_XY_CONFLICT',
        [`${what} has duplicate XY with conflicting Z (${priorZ} vs ${p.z}) — blocked.`]);
    }
    remap[i] = prior; // same-Z safe dedupe
  }

  const faces: number[] = [];
  const seenFaces = new Set<string>();
  const edgeUse = new Map<string, number>();
  const warnings: string[] = [];
  const vertexAt = (index: number): ParsedPoint => ({
    x: vertices[index * 3] as number,
    y: vertices[index * 3 + 1] as number,
    z: vertices[index * 3 + 2] as number,
  });

  for (let fi = 0; fi < fEls.length; fi += 1) {
    const fWhat = `${what} F #${fi + 1}`;
    const refs = fEls[fi]!.text.trim().split(/\s+/).filter((t) => t.length > 0);
    if (refs.length !== 3) {
      return blocked(name, desc, 'LANDXML_SURFACE_FACE_REF_COUNT',
        [`${fWhat} has ${refs.length} refs (TIN needs exactly 3).`]);
    }
    const mapped: number[] = [];
    for (const ref of refs) {
      const at = idToIndex.get(ref);
      if (at == null) {
        return blocked(name, desc, 'LANDXML_SURFACE_FACE_UNKNOWN_REF',
          [`${fWhat} references unknown P id=${JSON.stringify(ref)}.`]);
      }
      mapped.push(remap[at] as number);
    }
    if (new Set(mapped).size !== 3) {
      return blocked(name, desc, 'LANDXML_SURFACE_FACE_DEGENERATE',
        [`${fWhat} references ${new Set(mapped).size} distinct vertices (need 3).`]);
    }
    const [a, b, c] = mapped as [number, number, number];
    const pa = vertexAt(a);
    const pb = vertexAt(b);
    const pc = vertexAt(c);
    const area2 = signedArea2(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y);
    if (!(Math.abs(area2) > 0)) {
      return blocked(name, desc, 'LANDXML_SURFACE_FACE_ZERO_AREA',
        [`${fWhat} has zero XY area — blocked.`]);
    }
    // Canonicalize to internal CCW convention (positive math area).
    const tri: [number, number, number] = area2 > 0 ? [a, b, c] : [a, c, b];
    const canonical = [...tri].sort((x, y) => x - y).join('>');
    if (seenFaces.has(canonical)) {
      return blocked(name, desc, 'LANDXML_SURFACE_DUPLICATE_FACE',
        [`${fWhat} duplicates an earlier face — blocked.`]);
    }
    seenFaces.add(canonical);
    const edges = [
      `${Math.min(tri[0], tri[1])}>${Math.max(tri[0], tri[1])}`,
      `${Math.min(tri[1], tri[2])}>${Math.max(tri[1], tri[2])}`,
      `${Math.min(tri[2], tri[0])}>${Math.max(tri[2], tri[0])}`,
    ];
    for (const key of edges) {
      const count = (edgeUse.get(key) ?? 0) + 1;
      edgeUse.set(key, count);
      if (count > 2) {
        return blocked(name, desc, 'LANDXML_SURFACE_NON_MANIFOLD',
          [`${fWhat} shares edge ${key} with >2 triangles (non-manifold) — blocked.`]);
      }
    }
    faces.push(tri[0], tri[1], tri[2]);
  }

  if (faces.length === 0) {
    return blocked(name, desc, 'LANDXML_SURFACE_NO_FACES',
      [`${what} retained no faces — surface blocked.`]);
  }
  if (xyToIndex.size < points.length) {
    warnings.push(`${what}: ${points.length - xyToIndex.size} duplicate-XY same-Z point(s) deduped.`);
  }
  return {
    name, ...(desc != null ? { desc } : {}),
    disposition: warnings.length > 0 ? 'WARNING' : 'IMPORTABLE',
    vertices, faces, warnings,
  };
};

/** Guard for tests/callers: compact arrays must be finite and index-valid. */
export const validateImportedTinArrays = (
  vertices: readonly number[],
  faces: readonly number[],
): string | null => {
  if (vertices.length % 3 !== 0 || vertices.some((v) => !Number.isFinite(v))) {
    return 'vertices must be finite [x,y,z …] triples.';
  }
  if (faces.length % 3 !== 0) return 'faces must be [a,b,c …] triples.';
  const count = vertices.length / 3;
  if (count < 3) return 'need ≥3 vertices.';
  for (const index of faces) {
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      return `face index ${index} out of range (0..${count - 1}).`;
    }
  }
  return null;
};

export const assertValidImportedTinArrays = (
  vertices: readonly number[],
  faces: readonly number[],
): void => {
  const problem = validateImportedTinArrays(vertices, faces);
  if (problem) fail(problem);
}
