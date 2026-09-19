import { LandXmlImportError } from './landxmlCoords';
import type { GvxXmlNode } from './gnssGvxXml';

/**
 * Phase 13C §§31-48 — LandXML plan-feature/parcel CoordGeom subset.
 *
 * pntRef-only lines + circular curves (radius verbatim in file units) and
 * geometric parcel rings (no legal/area inference). Spirals and unknown
 * elements warn + count, never silently drop. Alignment-grade geometry
 * (inline coords, stationing, equations) lives in landxmlAlignmentImport.
 */

export interface LandXmlImportLine {
  readonly from: string;
  readonly to: string;
}

export interface LandXmlImportCurve {
  readonly start: string;
  readonly end: string;
  /** Radius in FILE linear units (caller scales); always positive. */
  readonly radiusM: number;
  readonly rot: 'cw' | 'ccw';
}

export interface MutablePlanParcelUnsupported {
  spirals: number;
  parcelsSkipped: number;
  alignmentsSkipped: number;
  curveDefsSkipped: number;
}

export interface PlanParcelCoordGeomResult {
  lines: LandXmlImportLine[];
  curves: LandXmlImportCurve[];
  unsupported: MutablePlanParcelUnsupported;
  warnings: string[];
}

const fail = (message: string): never => {
  throw new LandXmlImportError(message);
};

/** Strip an XML namespace prefix: "landxml:Line" → "Line". */
const localName = (name: string): string => {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
};

const directChildren = (node: GvxXmlNode, name: string): GvxXmlNode[] =>
  node.children.filter((child) => localName(child.name) === name);

const firstChild = (node: GvxXmlNode, name: string): GvxXmlNode | undefined =>
  directChildren(node, name)[0];

/** Resolve a CoordGeom endpoint: pntRef only (inline geometry is out of this subset). */
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

export const parsePlanParcelCoordGeom = (
  geom: GvxXmlNode,
  pointIds: Set<string>,
  what: string,
): PlanParcelCoordGeomResult => {
  const lines: LandXmlImportLine[] = [];
  const curves: LandXmlImportCurve[] = [];
  const warnings: string[] = [];
  const unsupported: MutablePlanParcelUnsupported = {
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
