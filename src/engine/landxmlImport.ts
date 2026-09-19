/**
 * Phase 13C §§31-48 — bounded LandXML 1.2 subset importer, Phase 18L civil upgrade.
 *
 * CAD/COGO geometry intake only (CgPoints, lines, circular curves, parcel
 * rings, TIN surfaces, horizontal alignments). NEVER observations: nothing
 * here enters the least-squares adjustment; the commit helper wires results
 * into CAD entities atomically.
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
 * units fail closed BEFORE any geometry commit. CRS is retained as an opaque
 * metadata string and NEVER auto-transformed; unknown CRS is "UNKNOWN".
 */

import { parseXmlDocument, type GvxXmlNode } from './gnssGvxXml';
import { LandXmlImportError, parseLandXmlNE } from './landxmlCoords';
import { parseLandXmlSurfaces, type LandXmlImportedSurface } from './landxmlSurfaceImport';
import { parseLandXmlAlignments, type LandXmlImportedAlignment } from './landxmlAlignmentImport';
import { parsePlanParcelCoordGeom } from './landxmlPlanFeatures';
import type { LandXmlImportCurve, LandXmlImportLine } from './landxmlPlanFeatures';

export { LandXmlImportError };
export type { LandXmlImportedSurface, LandXmlImportedAlignment, LandXmlImportCurve, LandXmlImportLine };

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

export interface LandXmlImportParcel {
  readonly name: string;
  /** Geometric ring only — no legal/area inference. */
  readonly ring: readonly string[];
}

export interface LandXmlUnsupportedCounts {
  readonly spirals: number;
  readonly parcelsSkipped: number;
  readonly alignmentsSkipped: number;
  readonly curveDefsSkipped: number;
  readonly surfacesUnsupported: number;
  readonly surfacesBlocked: number;
  readonly alignmentsUnsupported: number;
  readonly alignmentsBlocked: number;
  readonly profilesUnsupported: number;
  readonly crossSectsUnsupported: number;
  /** Top-level civil elements counted but never imported (no models). */
  readonly roadwaysUnsupported: number;
  readonly pipeNetworksUnsupported: number;
  readonly volumesUnsupported: number;
}

export interface LandXmlImportPreview {
  readonly points: readonly LandXmlImportPoint[];
  readonly lines: readonly LandXmlImportLine[];
  readonly curves: readonly LandXmlImportCurve[];
  readonly parcels: readonly LandXmlImportParcel[];
  /** Native-geometry alignments (Line + circular Curve; spirals block the whole alignment). */
  readonly alignments: readonly LandXmlImportedAlignment[];
  /** Explicit TIN topology (Pnts/Faces preserved, never re-triangulated). */
  readonly surfaces: readonly LandXmlImportedSurface[];
  readonly units: LandXmlImportUnits;
  readonly crs: string;
  /** FNV-1a hash of the source text — stable generated IDs derive from it. */
  readonly inputHash: string;
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

/**
 * Build a user-confirm preview of a LandXML 1.2 document. Throws
 * LandXmlImportError on malformed input. Out-of-subset geometry produces
 * WARNING/UNSUPPORTED/BLOCKED dispositions with stable reason codes —
 * never silent drops, never geometry mutation (commit is a separate step).
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

  // Units: explicit linearUnit only; unknown BLOCKS before any geometry commit.
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

  // CgPoints via the shared N/E parser: first value is NORTHING (y).
  const cgPointEls = findRoots(root, 'CgPoint');
  const points: LandXmlImportPoint[] = [];
  const pointIds = new Set<string>();
  const pointCoords = new Map<string, { x: number; y: number }>();
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
    const [northing, easting, elev] = parseLandXmlNE(el.text, `CgPoint ${JSON.stringify(origId)}`);
    const x = easting * toMetres;
    const y = northing * toMetres;
    points.push({
      id,
      x,
      y,
      z: elev * toMetres,
      desc: el.attrs.desc?.trim() ? el.attrs.desc : undefined,
      code: el.attrs.code?.trim() ? el.attrs.code : undefined,
      provenance: { source: 'LANDXML', file: fileName, inputHash, origId },
    });
    pointIds.add(id);
    pointCoords.set(id, { x, y });
  });

  let spirals = 0;
  let parcelsSkipped = 0;
  let curveDefsSkipped = 0;

  // PlanFeatures lines/curves (observation-free geometry, pntRef subset).
  const lines: LandXmlImportLine[] = [];
  const curves: LandXmlImportCurve[] = [];
  findRoots(root, 'PlanFeature').forEach((feature, idx) => {
    const geom = firstChild(feature, 'CoordGeom');
    if (!geom) return;
    const what = `PlanFeature ${JSON.stringify(feature.attrs.name ?? `#${idx + 1}`)}`;
    const parsed = parsePlanParcelCoordGeom(geom, pointIds, what);
    // Scale curve radii from document linear units to metres.
    parsed.curves.forEach((curve) => {
      curves.push({ ...curve, radiusM: curve.radiusM * toMetres });
    });
    parsed.lines.forEach((line) => lines.push(line));
    spirals += parsed.unsupported.spirals;
    curveDefsSkipped += parsed.unsupported.curveDefsSkipped;
    warnings.push(...parsed.warnings);
  });

  // Parcels: geometric rings only, no legal inference.
  const parcels: LandXmlImportParcel[] = [];
  findRoots(root, 'Parcel').forEach((parcelEl, idx) => {
    const name = (parcelEl.attrs.name ?? `PARCEL-${idx + 1}`).trim();
    const geom = firstChild(parcelEl, 'CoordGeom');
    if (!geom) {
      parcelsSkipped += 1;
      warnings.push(`Parcel ${JSON.stringify(name)} skipped: no CoordGeom (geometric data only).`);
      return;
    }
    const what = `Parcel ${JSON.stringify(name)}`;
    const parsed = parsePlanParcelCoordGeom(geom, pointIds, what);
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
    spirals += parsed.unsupported.spirals;
    curveDefsSkipped += parsed.unsupported.curveDefsSkipped;
    warnings.push(...parsed.warnings);
    parcels.push({ name, ring });
  });

  // Alignments: native Line + circular-Curve geometry (inline or pntRef),
  // staStart + StaEquations. A Spiral (or any other unsupported element)
  // blocks its whole alignment — UNSUPPORTED, no truncation.
  const alignments = parseLandXmlAlignments(root, (ref) => pointCoords.get(ref), toMetres);
  let alignmentsUnsupported = 0;
  let alignmentsBlocked = 0;
  alignments.forEach((alignment) => {
    warnings.push(...alignment.warnings);
    if (alignment.disposition === 'UNSUPPORTED') {
      alignmentsUnsupported += 1;
      if (alignment.reasonCode === 'LANDXML_ALIGNMENT_SPIRAL_UNSUPPORTED') spirals += 1;
    } else if (alignment.disposition === 'BLOCKED') {
      alignmentsBlocked += 1;
    }
  });

  // TIN surfaces: explicit Pnts/Faces topology preserved verbatim (metres).
  const surfaces = parseLandXmlSurfaces(root, toMetres, fileName);
  let surfacesUnsupported = 0;
  let surfacesBlocked = 0;
  surfaces.forEach((surface) => {
    warnings.push(...surface.warnings);
    if (surface.disposition === 'UNSUPPORTED') surfacesUnsupported += 1;
    else if (surface.disposition === 'BLOCKED') surfacesBlocked += 1;
  });

  // Sampled/design profiles + cross-sections: counted, never imported.
  let profilesUnsupported = 0;
  let crossSectsUnsupported = 0;
  alignments.forEach((alignment) => {
    alignment.profiles.forEach((profile) => {
      if (profile.kind === 'profile') profilesUnsupported += 1;
      else crossSectsUnsupported += 1;
    });
  });

  // Roadways / PipeNetworks / Volume elements: counted as UNSUPPORTED, never
  // imported (no roadway/pipe/volume models exist). Name-based top-level scan.
  const roadwaysUnsupported = findRoots(root, 'Roadway').length;
  const pipeNetworksUnsupported = findRoots(root, 'PipeNetwork').length;
  const volumesUnsupported = findRoots(root, 'Volume').length;
  if (roadwaysUnsupported > 0) {
    warnings.push(`${roadwaysUnsupported} Roadway element(s) not imported (LANDXML_ROADWAY_IMPORT_UNSUPPORTED).`);
  }
  if (pipeNetworksUnsupported > 0) {
    warnings.push(`${pipeNetworksUnsupported} PipeNetwork element(s) not imported (LANDXML_PIPE_NETWORK_IMPORT_UNSUPPORTED).`);
  }
  if (volumesUnsupported > 0) {
    warnings.push(`${volumesUnsupported} Volume element(s) not imported (LANDXML_VOLUME_IMPORT_UNSUPPORTED).`);
  }

  return {
    points,
    lines,
    curves,
    parcels,
    alignments,
    surfaces,
    units,
    crs,
    inputHash,
    unsupported: {
      spirals,
      parcelsSkipped,
      alignmentsSkipped: alignmentsUnsupported + alignmentsBlocked,
      curveDefsSkipped,
      surfacesUnsupported,
      surfacesBlocked,
      alignmentsUnsupported,
      alignmentsBlocked,
      profilesUnsupported,
      crossSectsUnsupported,
      roadwaysUnsupported,
      pipeNetworksUnsupported,
      volumesUnsupported,
    },
    warnings,
    duplicates,
  };
};
