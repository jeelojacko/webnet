/**
 * Phase 13C §§31-48 — bounded LandXML 1.2 subset importer.
 *
 * CAD/COGO geometry intake only (CgPoints, lines, circular curves, parcel
 * rings, alignment tangents+curves). NEVER observations: nothing here enters
 * the least-squares adjustment; caller wires results into CAD entities.
 *
 * Security: parses via parseXmlDocument (bounds, no DTD/DOCTYPE/ENTITY, no
 * XXE, 5 predefined entities only). All failures are bounded
 * LandXmlImportError throws — never partial trees.
 *
 * Text policy: names/descriptions are preserved verbatim. Glyph handling
 * follows cadDraftGlyphs — substitution happens only on the PDF export path
 * with explicit warnings, never silently at import.
 *
 * Units: LandXML linearUnit "foot" is the INTERNATIONAL foot (0.3048 m
 * exactly); "USSurveyFoot" (1200/3937 m) is accepted explicitly. Unknown
 * units fail closed. CRS is retained as an opaque metadata string and NEVER
 * auto-transformed; unknown CRS is "UNKNOWN".
 */

import { parseXmlDocument, type GvxXmlNode } from './gnssGvxXml';

export class LandXmlImportError extends Error {
  constructor(message: string) {
    super(`LandXML import: ${message}`);
    this.name = 'LandXmlImportError';
  }
}

/** Linear-unit factors to metres. "foot" = international foot by document. */
const UNIT_TO_METRES: Record<string, { factor: number; canonical: string }> = {
  meter: { factor: 1, canonical: 'm' },
  metre: { factor: 1, canonical: 'm' },
  foot: { factor: 0.3048, canonical: 'ft' },
  internationalfoot: { factor: 0.3048, canonical: 'ft' },
  ussurveyfoot: { factor: 1200 / 3937, canonical: 'usft' },
};

export type LandXmlImportUnits = 'm' | 'ft' | 'usft';

export interface LandXmlProvenance {
  readonly source: 'LANDXML';
  readonly file: string;
  readonly inputHash: string;
  readonly origId: string;
}

export interface LandXmlImportPoint {
  readonly id: string;
  /** Easting, metres. */
  readonly x: number;
  /** Northing, metres. */
  readonly y: number;
  readonly z: number;
  readonly desc?: string;
  readonly code?: string;
  readonly provenance: LandXmlProvenance;
}

export interface LandXmlImportLine {
  readonly from: string;
  readonly to: string;
}

export interface LandXmlImportCurve {
  readonly start: string;
  readonly end: string;
  /** Radius, metres, always positive. */
  readonly radiusM: number;
  readonly rot: 'cw' | 'ccw';
}

export interface LandXmlImportParcel {
  readonly name: string;
  /** Geometric ring only — no legal/area inference. */
  readonly ring: readonly string[];
}

export interface LandXmlImportAlignment {
  readonly name: string;
  readonly lines: readonly LandXmlImportLine[];
  readonly curves: readonly LandXmlImportCurve[];
}

export interface LandXmlUnsupportedCounts {
  readonly spirals: number;
  readonly parcelsSkipped: number;
  readonly alignmentsSkipped: number;
  readonly curveDefsSkipped: number;
}

export interface LandXmlImportPreview {
  readonly points: readonly LandXmlImportPoint[];
  readonly lines: readonly LandXmlImportLine[];
  readonly curves: readonly LandXmlImportCurve[];
  readonly parcels: readonly LandXmlImportParcel[];
  readonly alignments: readonly LandXmlImportAlignment[];
  readonly units: LandXmlImportUnits;
  readonly crs: string;
  readonly unsupported: LandXmlUnsupportedCounts;
  readonly warnings: readonly string[];
  readonly duplicates: readonly string[];
}

export interface LandXmlImportOptions {
  readonly fileName?: string;
  /** 'reject' throws on duplicate IDs; 'rename' appends _2/_3… (default). */
  readonly onDuplicate?: 'reject' | 'rename';
}

const fail = (message: string): never => {
  throw new LandXmlImportError(message);
};

/** Strip an XML namespace prefix: "landxml:CgPoint" → "CgPoint". */
const localName = (name: string): string => {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
};

const directChildren = (node: GvxXmlNode, name: string): GvxXmlNode[] =>
  node.children.filter((child) => localName(child.name) === name);

const firstChild = (node: GvxXmlNode, name: string): GvxXmlNode | undefined =>
  directChildren(node, name)[0];

const findRoots = (root: GvxXmlNode, name: string): GvxXmlNode[] => {
  const out: GvxXmlNode[] = [];
  const visit = (node: GvxXmlNode): void => {
    if (localName(node.name) === name) out.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return out;
};

/** FNV-1a 32-bit hex — provenance hash, not cryptographic. */
const hashText = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i) as number;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const parseFiniteTriple = (raw: string, what: string): [number, number, number] => {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) fail(`${what} needs at least N E values, got ${JSON.stringify(raw.slice(0, 60))}.`);
  const nums = parts.slice(0, 3).map((part) => Number(part));
  if (nums.some((v) => !Number.isFinite(v))) {
    fail(`${what} has non-finite coordinates ${JSON.stringify(raw.slice(0, 60))}.`);
  }
  return [nums[0] as number, nums[1] as number, (nums[2] ?? 0) as number];
};

/** Resolve a CoordGeom endpoint: pntRef only (inline geometry is out of subset). */
const resolveEndPoint = (
  el: GvxXmlNode | undefined,
  pointIds: Set<string>,
  what: string,
): string => {
  if (!el) fail(`${what} is missing Start/End.`);
  const ref = (el as GvxXmlNode).attrs.pntRef;
  if (!ref) fail(`${what} endpoints must use pntRef (inline geometry is not in the subset).`);
  if (!pointIds.has(ref)) fail(`${what} references unknown point ${JSON.stringify(ref)}.`);
  return ref;
};

interface MutableUnsupported {
  spirals: number;
  parcelsSkipped: number;
  alignmentsSkipped: number;
  curveDefsSkipped: number;
}

interface CoordGeomResult {
  lines: LandXmlImportLine[];
  curves: LandXmlImportCurve[];
  unsupported: MutableUnsupported;
  warnings: string[];
}

const parseCoordGeom = (
  geom: GvxXmlNode,
  pointIds: Set<string>,
  what: string,
): CoordGeomResult => {
  const lines: LandXmlImportLine[] = [];
  const curves: LandXmlImportCurve[] = [];
  const warnings: string[] = [];
  const unsupported: MutableUnsupported = {
    spirals: 0,
    parcelsSkipped: 0,
    alignmentsSkipped: 0,
    curveDefsSkipped: 0,
  };
  geom.children.forEach((child) => {
    const kind = localName(child.name);
    if (kind === 'Line') {
      const from = resolveEndPoint(firstChild(child, 'Start'), pointIds, `${what} Line Start`);
      const to = resolveEndPoint(firstChild(child, 'End'), pointIds, `${what} Line End`);
      lines.push({ from, to });
    } else if (kind === 'Curve') {
      const radius = Number(child.attrs.radius ?? Number.NaN);
      // No new curve math: reuse the stored radius verbatim (linear units).
      if (!Number.isFinite(radius) || radius <= 0) {
        unsupported.curveDefsSkipped += 1;
        warnings.push(`${what} Curve skipped: invalid radius ${JSON.stringify(child.attrs.radius ?? '')}.`);
        return;
      }
      const rotRaw = (child.attrs.rot ?? 'ccw').toLowerCase();
      if (rotRaw !== 'cw' && rotRaw !== 'ccw') {
        unsupported.curveDefsSkipped += 1;
        warnings.push(`${what} Curve skipped: invalid rot ${JSON.stringify(child.attrs.rot ?? '')}.`);
        return;
      }
      const from = resolveEndPoint(firstChild(child, 'Start'), pointIds, `${what} Curve Start`);
      const to = resolveEndPoint(firstChild(child, 'End'), pointIds, `${what} Curve End`);
      curves.push({ start: from, end: to, radiusM: radius, rot: rotRaw });
    } else if (kind === 'Spiral') {
      unsupported.spirals += 1;
      warnings.push(`${what} Spiral skipped: spirals are outside the subset (lines + circular curves only).`);
    } else {
      warnings.push(`${what} skipped unsupported element <${kind}>.`);
    }
  });
  return { lines, curves, unsupported, warnings };
};

/**
 * Build a user-confirm preview of a LandXML 1.2 document. Throws
 * LandXmlImportError on malformed input; spirals and other out-of-subset
 * geometry produce warnings + unsupported counts, never silent drops.
 */
export const buildLandXmlImportPreview = (
  text: string,
  options: LandXmlImportOptions = {},
): LandXmlImportPreview => {
  const fileName = options.fileName ?? '<import>';
  const onDuplicate = options.onDuplicate ?? 'rename';
  let root: GvxXmlNode;
  try {
    root = parseXmlDocument(text);
  } catch (error) {
    throw new LandXmlImportError(
      error instanceof Error ? error.message : 'unparseable XML.',
    );
  }
  if (localName(root.name) !== 'LandXML') fail(`root element is <${root.name}>, expected <LandXML>.`);
  const version = (root.attrs.version ?? '').trim();
  if (!version.startsWith('1.2')) fail(`unsupported version ${JSON.stringify(version)} (subset requires LandXML 1.2).`);

  // Units: explicit linearUnit only; unknown fails closed.
  const unitsEl = firstChild(root, 'Units');
  const metricEl = unitsEl ? firstChild(unitsEl, 'Metric') : undefined;
  const imperialEl = unitsEl ? firstChild(unitsEl, 'Imperial') : undefined;
  const unitEl = metricEl ?? imperialEl;
  if (!unitEl) fail('missing <Units>/<Metric|Imperial> with an explicit linearUnit.');
  const linearUnit = ((unitEl as GvxXmlNode).attrs.linearUnit ?? '').replaceAll(/\s+/g, '').toLowerCase();
  const unitDef = UNIT_TO_METRES[linearUnit];
  if (!unitDef) fail(`unknown linearUnit ${JSON.stringify((unitEl as GvxXmlNode).attrs.linearUnit ?? '')} (accept m, ft/international-foot, USSurveyFoot).`);
  const toMetres = unitDef.factor;
  const units = unitDef.canonical as LandXmlImportUnits;

  // CRS: opaque metadata only, never a transform trigger.
  const crsEl = firstChild(root, 'CoordinateSystem');
  const crs = (crsEl?.attrs.desc ?? crsEl?.attrs.name ?? crsEl?.attrs.ogcWktName ?? '').trim() || 'UNKNOWN';

  const warnings: string[] = [];
  const duplicates: string[] = [];
  const inputHash = hashText(text);

  // CgPoints: LandXML order is NORTHING EASTING [elevation].
  const cgPointEls = findRoots(root, 'CgPoint');
  const points: LandXmlImportPoint[] = [];
  const pointIds = new Set<string>();
  const seen = new Map<string, number>();
  cgPointEls.forEach((el) => {
    const origId = (el.attrs.name ?? el.attrs.oID ?? el.attrs.id ?? '').trim();
    if (!origId) fail('CgPoint is missing name/oID.');
    let id = origId;
    const prior = seen.get(origId) ?? 0;
    if (prior > 0) {
      duplicates.push(origId);
      if (onDuplicate === 'reject') fail(`duplicate point ID ${JSON.stringify(origId)} (reject policy).`);
      id = `${origId}_${prior + 1}`;
      warnings.push(`duplicate point ID ${JSON.stringify(origId)} renamed to ${JSON.stringify(id)}.`);
    }
    seen.set(origId, prior + 1);
    const [northing, easting, elev] = parseFiniteTriple(el.text, `CgPoint ${JSON.stringify(origId)}`);
    points.push({
      id,
      x: easting * toMetres,
      y: northing * toMetres,
      z: elev * toMetres,
      desc: el.attrs.desc?.trim() ? el.attrs.desc : undefined,
      code: el.attrs.code?.trim() ? el.attrs.code : undefined,
      provenance: { source: 'LANDXML', file: fileName, inputHash, origId },
    });
    pointIds.add(id);
  });

  const mergeUnsupported = (
    target: MutableUnsupported,
    extra: MutableUnsupported,
  ): MutableUnsupported => ({
    spirals: target.spirals + extra.spirals,
    parcelsSkipped: target.parcelsSkipped + extra.parcelsSkipped,
    alignmentsSkipped: target.alignmentsSkipped + extra.alignmentsSkipped,
    curveDefsSkipped: target.curveDefsSkipped + extra.curveDefsSkipped,
  });
  let unsupported: MutableUnsupported = {
    spirals: 0,
    parcelsSkipped: 0,
    alignmentsSkipped: 0,
    curveDefsSkipped: 0,
  };

  // PlanFeatures lines/curves (observation-free geometry).
  const lines: LandXmlImportLine[] = [];
  const curves: LandXmlImportCurve[] = [];
  findRoots(root, 'PlanFeature').forEach((feature, idx) => {
    const geom = firstChild(feature, 'CoordGeom');
    if (!geom) return;
    const what = `PlanFeature ${JSON.stringify(feature.attrs.name ?? `#${idx + 1}`)}`;
    const parsed = parseCoordGeom(geom, pointIds, what);
    // Scale curve radii from document linear units to metres.
    parsed.curves.forEach((curve) => {
      curves.push({ ...curve, radiusM: curve.radiusM * toMetres });
    });
    parsed.lines.forEach((line) => lines.push(line));
    unsupported = mergeUnsupported(unsupported, parsed.unsupported);
    warnings.push(...parsed.warnings);
  });

  // Parcels: geometric rings only, no legal inference.
  const parcels: LandXmlImportParcel[] = [];
  findRoots(root, 'Parcel').forEach((parcelEl, idx) => {
    const name = (parcelEl.attrs.name ?? `PARCEL-${idx + 1}`).trim();
    const geom = firstChild(parcelEl, 'CoordGeom');
    if (!geom) {
      unsupported = { ...unsupported, parcelsSkipped: unsupported.parcelsSkipped + 1 };
      warnings.push(`Parcel ${JSON.stringify(name)} skipped: no CoordGeom (geometric data only).`);
      return;
    }
    const what = `Parcel ${JSON.stringify(name)}`;
    const parsed = parseCoordGeom(geom, pointIds, what);
    const ring: string[] = [];
    parsed.lines.forEach((line) => {
      if (ring.length === 0) ring.push(line.from);
      ring.push(line.to);
    });
    if (parsed.curves.length > 0) {
      warnings.push(`${what}: ${parsed.curves.length} curve(s) stored as chord endpoints in the ring.`);
      parsed.curves.forEach((curve) => {
        if (ring.length === 0) ring.push(curve.start);
        ring.push(curve.end);
      });
    }
    unsupported = mergeUnsupported(unsupported, parsed.unsupported);
    warnings.push(...parsed.warnings);
    parcels.push({ name, ring });
  });

  // Alignments: horizontal lines + circular curves only; spirals warn+skip.
  const alignments: LandXmlImportAlignment[] = [];
  findRoots(root, 'Alignment').forEach((alEl, idx) => {
    const name = (alEl.attrs.name ?? `ALIGN-${idx + 1}`).trim();
    const geom = firstChild(alEl, 'CoordGeom');
    if (!geom) {
      unsupported = { ...unsupported, alignmentsSkipped: unsupported.alignmentsSkipped + 1 };
      warnings.push(`Alignment ${JSON.stringify(name)} skipped: no CoordGeom.`);
      return;
    }
    const parsed = parseCoordGeom(geom, pointIds, `Alignment ${JSON.stringify(name)}`);
    unsupported = mergeUnsupported(unsupported, parsed.unsupported);
    warnings.push(...parsed.warnings);
    alignments.push({
      name,
      lines: parsed.lines,
      curves: parsed.curves.map((curve) => ({ ...curve, radiusM: curve.radiusM * toMetres })),
    });
  });

  return { points, lines, curves, parcels, alignments, units, crs, unsupported, warnings, duplicates };
};
