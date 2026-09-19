/**
 * Phase 18L — independent LandXML civil parser for export tests.
 *
 * Deliberately shares no code with the serializer or the importer: it
 * re-parses the emitted text with regexes so an export regression cannot be
 * masked by a matching parser bug. Only the elements 18L emits are covered.
 */

export interface ParsedSurfacePoint {
  id: number;
  n: number;
  e: number;
  z: number;
}

export interface ParsedSurface {
  name: string;
  points: ParsedSurfacePoint[];
  faces: number[][];
  elevMin?: number;
  elevMax?: number;
  area2D?: number;
  area3D?: number;
}

export interface ParsedStaEquation {
  staInternal: number;
  staAhead: number;
  staBack?: number;
}

export interface ParsedPntList {
  name: string;
  segments: number[][];
}

export interface ParsedProfile {
  name: string;
  surfaces: ParsedPntList[];
}

export interface ParsedCrossSection {
  name: string;
  sta: number;
  surfaces: ParsedPntList[];
}

export interface ParsedAlignmentLine {
  from?: string;
  to?: string;
  startText: string;
  endText: string;
}

export interface ParsedAlignmentCurve extends ParsedAlignmentLine {
  radius?: number;
  rot?: string;
}

export interface ParsedAlignment {
  name: string;
  staStart?: number;
  equations: ParsedStaEquation[];
  lines: ParsedAlignmentLine[];
  curves: ParsedAlignmentCurve[];
  profiles: ParsedProfile[];
  crossSections: ParsedCrossSection[];
}

const attrOf = (tag: string, name: string): string | undefined =>
  new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];

const numAttr = (tag: string, name: string): number | undefined => {
  const raw = attrOf(tag, name);
  return raw == null ? undefined : Number(raw);
};

export const parseSurfaces = (xml: string): ParsedSurface[] => {
  const out: ParsedSurface[] = [];
  for (const match of xml.matchAll(/<Surface\b([^>]*)>([\s\S]*?)<\/Surface>/g)) {
    const header = `<x ${match[1]}>`;
    const body = match[2] as string;
    const definition = /<Definition\b[^>]*>/.exec(body)?.[0] ?? '';
    const points: ParsedSurfacePoint[] = [];
    for (const point of body.matchAll(/<P id="(\d+)">([^<]+)<\/P>/g)) {
      const [n, e, z] = (point[2] as string).trim().split(/\s+/).map(Number) as [number, number, number];
      points.push({ id: Number(point[1]), n, e, z });
    }
    const faces: number[][] = [];
    for (const face of body.matchAll(/<F>([^<]+)<\/F>/g)) {
      faces.push((face[1] as string).trim().split(/\s+/).map(Number));
    }
    out.push({
      name: attrOf(header, 'name') as string,
      points,
      faces,
      elevMin: numAttr(definition, 'elevMin'),
      elevMax: numAttr(definition, 'elevMax'),
      area2D: numAttr(definition, 'area2DSurf'),
      area3D: numAttr(definition, 'area3DSurf'),
    });
  }
  return out;
};

const parseSurfBody = (body: string, tagName: 'ProfSurf' | 'CrossSectSurf'): ParsedPntList[] => {
  const out: ParsedPntList[] = [];
  const re = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  for (const match of body.matchAll(re)) {
    const segments: number[][] = [];
    for (const list of (match[2] as string).matchAll(/<PntList2D>([^<]*)<\/PntList2D>/g)) {
      const raw = (list[1] as string).trim();
      segments.push(raw === '' ? [] : raw.split(/\s+/).map(Number));
    }
    out.push({ name: attrOf(`<x ${match[1]}>`, 'name') as string, segments });
  }
  return out;
};

const parseCoordGeom = (body: string): { lines: ParsedAlignmentLine[]; curves: ParsedAlignmentCurve[] } => {
  const coordGeom = /<CoordGeom>([\s\S]*?)<\/CoordGeom>/.exec(body)?.[1] ?? '';
  const lines: ParsedAlignmentLine[] = [];
  for (const match of coordGeom.matchAll(/<Line>([\s\S]*?)<\/Line>/g)) {
    const inner = match[1] as string;
    const start = /<Start\b[^>]*>([^<]*)<\/Start>/.exec(inner);
    const end = /<End\b[^>]*>([^<]*)<\/End>/.exec(inner);
    lines.push({
      from: /pntRef="([^"]*)"/.exec(start?.[0] ?? '')?.[1],
      to: /pntRef="([^"]*)"/.exec(end?.[0] ?? '')?.[1],
      startText: (start?.[1] ?? '').trim(),
      endText: (end?.[1] ?? '').trim(),
    });
  }
  const curves: ParsedAlignmentCurve[] = [];
  for (const match of coordGeom.matchAll(/<Curve\b([^>]*)>([\s\S]*?)<\/Curve>/g)) {
    const inner = match[2] as string;
    const start = /<Start\b[^>]*>([^<]*)<\/Start>/.exec(inner);
    const end = /<End\b[^>]*>([^<]*)<\/End>/.exec(inner);
    const tag = `<x ${match[1]}>`;
    curves.push({
      radius: numAttr(tag, 'radius'),
      rot: attrOf(tag, 'rot'),
      from: /pntRef="([^"]*)"/.exec(start?.[0] ?? '')?.[1],
      to: /pntRef="([^"]*)"/.exec(end?.[0] ?? '')?.[1],
      startText: (start?.[1] ?? '').trim(),
      endText: (end?.[1] ?? '').trim(),
    });
  }
  return { lines, curves };
};

export const parseAlignments = (xml: string): ParsedAlignment[] => {
  const out: ParsedAlignment[] = [];
  for (const match of xml.matchAll(/<Alignment\b([^>]*)>([\s\S]*?)<\/Alignment>/g)) {
    const attrs = `<x ${match[1]}>`;
    const body = match[2] as string;
    const { lines, curves } = parseCoordGeom(body);
    const equations: ParsedStaEquation[] = [];
    for (const equation of body.matchAll(/<StaEquation\b([^>]*)\/>/g)) {
      const tag = `<x ${equation[1]}>`;
      equations.push({
        staInternal: numAttr(tag, 'staInternal') as number,
        staAhead: numAttr(tag, 'staAhead') as number,
        staBack: numAttr(tag, 'staBack'),
      });
    }
    const profiles: ParsedProfile[] = [];
    for (const profile of body.matchAll(/<Profile\b([^>]*)>([\s\S]*?)<\/Profile>/g)) {
      profiles.push({
        name: attrOf(`<x ${profile[1]}>`, 'name') as string,
        surfaces: parseSurfBody(profile[2] as string, 'ProfSurf'),
      });
    }
    const crossSections: ParsedCrossSection[] = [];
    for (const section of body.matchAll(/<CrossSect\b([^>]*)>([\s\S]*?)<\/CrossSect>/g)) {
      const tag = `<x ${section[1]}>`;
      crossSections.push({
        name: attrOf(tag, 'name') as string,
        sta: numAttr(tag, 'sta') as number,
        surfaces: parseSurfBody(section[2] as string, 'CrossSectSurf'),
      });
    }
    out.push({
      name: attrOf(attrs, 'name') as string,
      staStart: numAttr(attrs, 'staStart'),
      equations,
      lines,
      curves,
      profiles,
      crossSections,
    });
  }
  return out;
};

/** CgPoint coordinates keyed by name, for resolving pntRef endpoints. */
export const parseCgPoints = (xml: string): Map<string, [number, number, number]> => {
  const out = new Map<string, [number, number, number]>();
  for (const match of xml.matchAll(/<CgPoint name="([^"]*)"[^>]*>([^<]*)<\/CgPoint>/g)) {
    const [n, e, z] = (match[2] as string).trim().split(/\s+/).map(Number) as [number, number, number];
    out.set(match[1] as string, [n, e, z]);
  }
  return out;
};
