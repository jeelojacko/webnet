import { parseLandXmlNE } from './landxmlCoords';
import type { GvxXmlNode } from './gnssGvxXml';
import type { CadAlignmentElement, CadStationEquation } from './cad/cadTypes';

/**
 * Phase 18L — LandXML horizontal-alignment import upgrade.
 *
 * Line + circular Curve (rot cw/ccw Start→End, radius attr or Start→Center
 * distance) become native CadAlignmentElements directly — no segment
 * flattening, no intermediate entities. staStart → startStation; StaEquation
 * → CadStationEquation[] (staInternal→rawStation, staAhead→aheadStation,
 * staBack→backStation). One unsupported element (Spiral or unknown) blocks
 * its whole alignment (UNSUPPORTED, no truncation). Design profiles,
 * sampled Profiles and CrossSects are UNSUPPORTED with stable codes.
 */

export type LandXmlAlignmentDisposition = 'IMPORTABLE' | 'WARNING' | 'UNSUPPORTED' | 'BLOCKED';

export type LandXmlAlignmentReasonCode =
  | 'LANDXML_ALIGNMENT_SPIRAL_UNSUPPORTED'
  | 'LANDXML_ALIGNMENT_ELEMENT_UNSUPPORTED'
  | 'LANDXML_ALIGNMENT_GEOMETRY_BLOCKED'
  | 'LANDXML_ALIGNMENT_EQUATION_INVALID'
  | 'LANDXML_ALIGNMENT_NO_GEOMETRY';

export type LandXmlProfileReasonCode =
  | 'LANDXML_PROFILE_IMPORT_UNSUPPORTED'
  | 'LANDXML_DESIGN_PROFILE_UNSUPPORTED'
  | 'LANDXML_CROSS_SECT_IMPORT_UNSUPPORTED';

export interface LandXmlImportedProfile {
  readonly kind: 'profile' | 'cross-sects';
  readonly name: string;
  readonly reasonCode: LandXmlProfileReasonCode;
}

export interface LandXmlImportedAlignment {
  readonly name: string;
  readonly disposition: LandXmlAlignmentDisposition;
  readonly reasonCode?: LandXmlAlignmentReasonCode;
  /** Native elements (metres). Empty unless IMPORTABLE/WARNING. */
  readonly elements: readonly CadAlignmentElement[];
  readonly startStation: number;
  readonly stationEquations: readonly CadStationEquation[];
  readonly profiles: readonly LandXmlImportedProfile[];
  readonly warnings: readonly string[];
}

export interface AlignmentRefResolver {
  (_ref: string): { x: number; y: number } | undefined;
}

const localName = (name: string): string => {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
};

const directChildren = (node: GvxXmlNode, name: string): GvxXmlNode[] =>
  node.children.filter((child) => localName(child.name) === name);

const firstChild = (node: GvxXmlNode, name: string): GvxXmlNode | undefined =>
  directChildren(node, name)[0];

const DEG = 180 / Math.PI;

const norm360 = (angle: number): number => {
  const n = angle % 360;
  return n < 0 ? n + 360 : n;
};

interface Xy { x: number; y: number }

/** Endpoint: pntRef wins, else inline "N E [Z]" via the shared N/E parser. */
const resolvePoint = (
  el: GvxXmlNode | undefined,
  resolveRef: AlignmentRefResolver,
  toMetres: number,
  what: string,
): Xy | null => {
  if (!el) return null;
  const ref = (el.attrs.pntRef ?? '').trim();
  if (ref) return resolveRef(ref) ?? null;
  const text = el.text.trim();
  if (!text) return null;
  try {
    const [n, e] = parseLandXmlNE(text, what);
    return { x: e * toMetres, y: n * toMetres };
  } catch {
    return null;
  }
};

const blocked = (
  name: string, reasonCode: LandXmlAlignmentReasonCode, warnings: string[],
): LandXmlImportedAlignment => ({
  name, disposition: 'BLOCKED', reasonCode, elements: [],
  startStation: 0, stationEquations: [], profiles: [], warnings,
});

const unsupported = (
  name: string, reasonCode: LandXmlAlignmentReasonCode, warnings: string[],
): LandXmlImportedAlignment => ({
  name, disposition: 'UNSUPPORTED', reasonCode, elements: [],
  startStation: 0, stationEquations: [], profiles: [], warnings,
});

const parseProfiles = (el: GvxXmlNode): LandXmlImportedProfile[] => {
  const out: LandXmlImportedProfile[] = [];
  directChildren(el, 'Profile').forEach((profile, index) => {
    const name = (profile.attrs.name ?? `PROFILE-${index + 1}`).trim();
    const isDesign = firstChild(profile, 'ProfAlign') != null;
    out.push({
      kind: 'profile',
      name,
      reasonCode: isDesign ? 'LANDXML_DESIGN_PROFILE_UNSUPPORTED' : 'LANDXML_PROFILE_IMPORT_UNSUPPORTED',
    });
  });
  const crossSects = firstChild(el, 'CrossSects');
  if (crossSects) {
    directChildren(crossSects, 'CrossSect').forEach((section, index) => {
      out.push({
        kind: 'cross-sects',
        name: (section.attrs.name ?? `XSECT-${index + 1}`).trim(),
        reasonCode: 'LANDXML_CROSS_SECT_IMPORT_UNSUPPORTED',
      });
    });
    if (directChildren(crossSects, 'CrossSect').length === 0) {
      out.push({ kind: 'cross-sects', name: 'CROSS-SECTS', reasonCode: 'LANDXML_CROSS_SECT_IMPORT_UNSUPPORTED' });
    }
  }
  return out;
};

const parseEquations = (
  el: GvxXmlNode, toMetres: number, what: string,
): { equations: CadStationEquation[]; error?: string } => {
  const equations: CadStationEquation[] = [];
  for (const eq of directChildren(el, 'StaEquation')) {
    const rawInternal = Number(eq.attrs.staInternal ?? Number.NaN);
    const rawAhead = Number(eq.attrs.staAhead ?? Number.NaN);
    const rawBack = eq.attrs.staBack != null ? Number(eq.attrs.staBack) : Number.NaN;
    if (!Number.isFinite(rawInternal) || !Number.isFinite(rawAhead)) {
      return { equations, error: `${what} StaEquation needs finite staInternal + staAhead.` };
    }
    const back = Number.isFinite(rawBack) ? rawBack : rawAhead;
    equations.push({
      backStation: back * toMetres,
      aheadStation: rawAhead * toMetres,
      rawStation: rawInternal * toMetres,
    });
  }
  equations.sort((a, b) => (a.rawStation as number) - (b.rawStation as number));
  for (let i = 1; i < equations.length; i += 1) {
    if ((equations[i]!.rawStation as number) < (equations[i - 1]!.rawStation as number) - 1e-9) {
      return { equations, error: `${what} StaEquations out of order.` };
    }
  }
  return { equations };
};

/**
 * Parse every <Alignment> under the document. Coordinates resolve via
 * resolveRef (CgPoint metres) or inline N/E text; every number scales by
 * toMetres at this boundary — metres/radians internally beyond it.
 */
export const parseLandXmlAlignments = (
  root: GvxXmlNode,
  resolveRef: AlignmentRefResolver,
  toMetres: number,
): LandXmlImportedAlignment[] => {
  const els: GvxXmlNode[] = [];
  const visit = (node: GvxXmlNode): void => {
    if (localName(node.name) === 'Alignment') els.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return els.map((el, index) => parseAlignment(el, index, resolveRef, toMetres));
};

const parseAlignment = (
  el: GvxXmlNode, index: number, resolveRef: AlignmentRefResolver, toMetres: number,
): LandXmlImportedAlignment => {
  const name = (el.attrs.name ?? `ALIGN-${index + 1}`).trim();
  const what = `Alignment ${JSON.stringify(name)}`;
  const warnings: string[] = [];
  const staStartRaw = el.attrs.staStart != null ? Number(el.attrs.staStart) : 0;
  if (el.attrs.staStart != null && !Number.isFinite(staStartRaw)) {
    return blocked(name, 'LANDXML_ALIGNMENT_GEOMETRY_BLOCKED', [`${what} has non-finite staStart.`]);
  }
  const startStation = staStartRaw * toMetres;
  const profiles = parseProfiles(el);
  for (const profile of profiles) {
    warnings.push(`${what} ${profile.kind} ${JSON.stringify(profile.name)} not imported (${profile.reasonCode}).`);
  }

  const geom = firstChild(el, 'CoordGeom');
  if (!geom) {
    return blocked(name, 'LANDXML_ALIGNMENT_NO_GEOMETRY', [`${what} has no CoordGeom.`]);
  }
  const elements: CadAlignmentElement[] = [];
  for (const child of geom.children) {
    const kind = localName(child.name);
    if (kind === 'Line') {
      const start = resolvePoint(firstChild(child, 'Start'), resolveRef, toMetres, `${what} Line Start`);
      const end = resolvePoint(firstChild(child, 'End'), resolveRef, toMetres, `${what} Line End`);
      if (!start || !end) {
        return blocked(name, 'LANDXML_ALIGNMENT_GEOMETRY_BLOCKED',
          [`${what} Line has unresolvable Start/End (need pntRef or inline N/E).`]);
      }
      if (Math.hypot(end.x - start.x, end.y - start.y) <= 1e-12) {
        return blocked(name, 'LANDXML_ALIGNMENT_GEOMETRY_BLOCKED', [`${what} Line is zero-length.`]);
      }
      elements.push({ kind: 'line', start, end });
    } else if (kind === 'Curve') {
      const start = resolvePoint(firstChild(child, 'Start'), resolveRef, toMetres, `${what} Curve Start`);
      const center = resolvePoint(firstChild(child, 'Center'), resolveRef, toMetres, `${what} Curve Center`);
      const end = resolvePoint(firstChild(child, 'End'), resolveRef, toMetres, `${what} Curve End`);
      if (!start || !center || !end) {
        return blocked(name, 'LANDXML_ALIGNMENT_GEOMETRY_BLOCKED',
          [`${what} Curve needs Start/Center/End (pntRef or inline N/E).`]);
      }
      const rotRaw = (child.attrs.rot ?? '').trim().toLowerCase();
      if (rotRaw !== 'cw' && rotRaw !== 'ccw') {
        return blocked(name, 'LANDXML_ALIGNMENT_GEOMETRY_BLOCKED',
          [`${what} Curve needs rot="cw"|"ccw" (travel Start→End).`]);
      }
      const radiusAttr = child.attrs.radius != null ? Number(child.attrs.radius) : Number.NaN;
      const centerDist = Math.hypot(start.x - center.x, start.y - center.y);
      const radius = Number.isFinite(radiusAttr) ? radiusAttr * toMetres : centerDist;
      if (!(radius > 0) || !Number.isFinite(radius)) {
        return blocked(name, 'LANDXML_ALIGNMENT_GEOMETRY_BLOCKED',
          [`${what} Curve has invalid radius ${JSON.stringify(child.attrs.radius ?? '')}.`]);
      }
      if (centerDist <= 1e-12) {
        return blocked(name, 'LANDXML_ALIGNMENT_GEOMETRY_BLOCKED', [`${what} Curve Start == Center.`]);
      }
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x) * DEG;
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x) * DEG;
      // Deflection measured in the travel direction (rot): ccw takes
      // norm(end-start), cw takes norm(start-end) — the short way, not 360 minus it.
      let delta = rotRaw === 'ccw' ? norm360(endAngle - startAngle) : norm360(startAngle - endAngle);
      if (delta <= 1e-12) {
        // Same radial direction: a closed Start==End loop is a full circle,
        // anything else is a zero-deflection degenerate.
        if (Math.hypot(end.x - start.x, end.y - start.y) > 1e-9) {
          return blocked(name, 'LANDXML_ALIGNMENT_GEOMETRY_BLOCKED', [`${what} Curve has zero deflection.`]);
        }
        delta = 360;
      }
      const startDeg = norm360(startAngle);
      // Sweep sign carries rot: cadSignedSweepDeg supports ±360 (arcs >180° exact).
      const endDeg = rotRaw === 'ccw' ? startDeg + delta : startDeg - delta;
      elements.push({ kind: 'arc', center, radius, startAngleDeg: startDeg, endAngleDeg: endDeg });
    } else if (kind === 'Spiral') {
      return unsupported(name, 'LANDXML_ALIGNMENT_SPIRAL_UNSUPPORTED',
        [...warnings, `${what} contains a Spiral — no native spiral element, alignment not imported (no truncation).`]);
    } else {
      return unsupported(name, 'LANDXML_ALIGNMENT_ELEMENT_UNSUPPORTED',
        [...warnings, `${what} contains unsupported <${kind}> — alignment not imported (no truncation).`]);
    }
  }
  if (elements.length === 0) {
    return blocked(name, 'LANDXML_ALIGNMENT_NO_GEOMETRY', [`${what} CoordGeom holds no Line/Curve.`]);
  }

  const { equations, error } = parseEquations(el, toMetres, what);
  if (error) return blocked(name, 'LANDXML_ALIGNMENT_EQUATION_INVALID', [error]);
  let totalLength = 0;
  for (const element of elements) {
    totalLength += element.kind === 'line'
      ? Math.hypot(element.end.x - element.start.x, element.end.y - element.start.y)
      : (Math.abs(element.endAngleDeg - element.startAngleDeg) * Math.PI * element.radius) / 180;
  }
  for (const equation of equations) {
    const raw = equation.rawStation as number;
    if (raw < startStation - 1e-9 || raw > startStation + totalLength + 1e-9) {
      return blocked(name, 'LANDXML_ALIGNMENT_EQUATION_INVALID',
        [`${what} StaEquation at ${raw} is outside the alignment range.`]);
    }
  }
  return {
    name, disposition: warnings.length > 0 ? 'WARNING' : 'IMPORTABLE',
    elements, startStation, stationEquations: equations, profiles, warnings,
  };
};
