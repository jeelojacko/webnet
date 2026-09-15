/**
 * Phase 13C §§31-48 — CAD geometry → LandXML 1.2 adapter.
 *
 * Separate input model (NOT AdjustmentResult): CAD/COGO geometry in metres
 * goes in, LandXML text comes out. Reuses the adjustment exporter's
 * serializer helpers (xmlEscape, formatNumber: N-E order, toFixed(6)) so
 * both writers stay byte-consistent.
 *
 * Units: 'm' → Metric/meter; 'ft' → Imperial/foot (INTERNATIONAL foot,
 * 0.3048 m exactly); 'usft' → Imperial/USSurveyFoot (1200/3937 m).
 * Parcels are geometric data only — no legal inference is encoded.
 */

import { formatNumber, xmlEscape } from './landxml';

export interface CadLandXmlPoint {
  /** Point ID (CgPoint name/oID). */
  readonly id: string;
  /** Easting, metres. */
  readonly x: number;
  /** Northing, metres. */
  readonly y: number;
  readonly z?: number;
  readonly desc?: string;
  readonly code?: string;
}

export interface CadLandXmlLine {
  readonly from: string;
  readonly to: string;
}

export interface CadLandXmlCurve {
  readonly start: string;
  readonly end: string;
  /** Radius, metres, must be finite and positive. */
  readonly radiusM: number;
  readonly rot: 'cw' | 'ccw';
}

export interface CadLandXmlParcel {
  readonly name: string;
  /** Geometric ring (point IDs) only. */
  readonly ring: readonly string[];
}

export interface CadLandXmlAlignment {
  readonly name: string;
  readonly lines: readonly CadLandXmlLine[];
  readonly curves: readonly CadLandXmlCurve[];
}

export interface CadLandXmlGeometry {
  readonly points: readonly CadLandXmlPoint[];
  readonly lines?: readonly CadLandXmlLine[];
  readonly curves?: readonly CadLandXmlCurve[];
  readonly parcels?: readonly CadLandXmlParcel[];
  readonly alignments?: readonly CadLandXmlAlignment[];
  /** Opaque CRS metadata string (retained, never transformed). */
  readonly crs?: string;
}

export interface CadLandXmlSettings {
  readonly units: 'm' | 'ft' | 'usft';
  readonly projectName?: string;
  readonly generatedAt?: Date;
  readonly applicationVersion?: string;
}

const UNIT_SCALE: Record<CadLandXmlSettings['units'], number> = {
  m: 1,
  // International foot, 0.3048 m exactly. US survey foot differs.
  ft: 3.280839895,
  usft: 3937 / 1200,
};

const UNIT_ELEMENT: Record<CadLandXmlSettings['units'], string> = {
  m: '<Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" />',
  ft: '<Imperial areaUnit="squareFoot" linearUnit="foot" volumeUnit="cubicFeet" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" />',
  usft: '<Imperial areaUnit="squareFoot" linearUnit="USSurveyFoot" volumeUnit="cubicFeet" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" />',
};

/** LandXML point order is NORTHING EASTING elevation. */
const coordText = (northing: number, easting: number, elevation: number): string =>
  `${formatNumber(northing)} ${formatNumber(easting)} ${formatNumber(elevation)}`;

/**
 * Serialize CAD geometry to LandXML 1.2. Throws on unknown point refs,
 * non-finite coordinates, or invalid curve radii (fail-safe, no partial XML).
 */
export const buildLandXmlFromCadGeometry = (
  geom: CadLandXmlGeometry,
  settings: CadLandXmlSettings,
): string => {
  const scale = UNIT_SCALE[settings.units];
  const generatedAt = settings.generatedAt ?? new Date();
  const projectName = settings.projectName ?? 'WebNet CAD Export';
  const version = settings.applicationVersion ?? '0.0.0';
  const seenIds = new Set<string>();
  geom.points.forEach((point) => {
    if (!point.id || point.id.trim() === '') {
      throw new Error('LandXML CAD export: point with empty ID.');
    }
    if (seenIds.has(point.id)) {
      throw new Error(`LandXML CAD export: duplicate point ID ${JSON.stringify(point.id)}.`);
    }
    seenIds.add(point.id);
  });
  const ids = seenIds;
  const requireRef = (ref: string, what: string): void => {
    if (!ids.has(ref)) {
      throw new Error(`LandXML CAD export: ${what} references unknown point ${JSON.stringify(ref)}.`);
    }
  };
  const scaled = new Map(
    geom.points.map((point) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new Error(`LandXML CAD export: point ${JSON.stringify(point.id)} has non-finite coordinates.`);
      }
      const z = point.z ?? 0;
      if (!Number.isFinite(z)) {
        throw new Error(`LandXML CAD export: point ${JSON.stringify(point.id)} has non-finite elevation.`);
      }
      return [point.id, { n: point.y * scale, e: point.x * scale, z: z * scale }] as const;
    }),
  );

  const date = generatedAt.toISOString().slice(0, 10);
  const time = generatedAt.toISOString().slice(11, 19);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"',
    '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '         xsi:schemaLocation="http://www.landxml.org/schema/LandXML-1.2 http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd"',
    `         date="${date}" time="${time}" version="1.2" language="English">`,
    `  <Units>${UNIT_ELEMENT[settings.units]}</Units>`,
    `  <Application name="WebNet" version="${xmlEscape(version)}" manufacturer="WebNet" desc="CAD geometry export" />`,
    `  <Project name="${xmlEscape(projectName)}" desc="source=CAD" />`,
  ];
  if (geom.crs && geom.crs !== 'UNKNOWN') {
    lines.push(`  <CoordinateSystem desc="${xmlEscape(geom.crs)}" />`);
  }

  const coordGeomBlock = (
    geomLines: readonly CadLandXmlLine[],
    geomCurves: readonly CadLandXmlCurve[],
    indent: string,
  ): void => {
    lines.push(`${indent}<CoordGeom>`);
    geomLines.forEach((line) => {
      requireRef(line.from, 'Line Start');
      requireRef(line.to, 'Line End');
      const from = scaled.get(line.from);
      const to = scaled.get(line.to);
      if (!from || !to) throw new Error(`LandXML CAD export: missing scaled point for ${line.from}-${line.to}.`);
      lines.push(`${indent}  <Line>`);
      lines.push(`${indent}    <Start pntRef="${xmlEscape(line.from)}">${coordText(from.n, from.e, from.z)}</Start>`);
      lines.push(`${indent}    <End pntRef="${xmlEscape(line.to)}">${coordText(to.n, to.e, to.z)}</End>`);
      lines.push(`${indent}  </Line>`);
    });
    geomCurves.forEach((curve) => {
      requireRef(curve.start, 'Curve Start');
      requireRef(curve.end, 'Curve End');
      if (!Number.isFinite(curve.radiusM) || curve.radiusM <= 0) {
        throw new Error(`LandXML CAD export: curve ${curve.start}-${curve.end} has invalid radius.`);
      }
      const from = scaled.get(curve.start);
      const to = scaled.get(curve.end);
      if (!from || !to) throw new Error(`LandXML CAD export: missing scaled point for curve ${curve.start}-${curve.end}.`);
      lines.push(`${indent}  <Curve rot="${curve.rot}" radius="${formatNumber(curve.radiusM * scale)}">`);
      lines.push(`${indent}    <Start pntRef="${xmlEscape(curve.start)}">${coordText(from.n, from.e, from.z)}</Start>`);
      lines.push(`${indent}    <End pntRef="${xmlEscape(curve.end)}">${coordText(to.n, to.e, to.z)}</End>`);
      lines.push(`${indent}  </Curve>`);
    });
    lines.push(`${indent}</CoordGeom>`);
  };

  const sortedPoints = [...geom.points].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  if (sortedPoints.length > 0) {
    lines.push('  <CgPoints>');
    sortedPoints.forEach((point) => {
      const scaledPoint = scaled.get(point.id);
      if (!scaledPoint) throw new Error(`LandXML CAD export: missing scaled point ${point.id}.`);
      lines.push(
        `    <CgPoint name="${xmlEscape(point.id)}" oID="${xmlEscape(point.id)}" desc="${xmlEscape(
          point.desc ?? 'cad',
        )}"${point.code ? ` code="${xmlEscape(point.code)}"` : ''}>${coordText(scaledPoint.n, scaledPoint.e, scaledPoint.z)}</CgPoint>`,
      );
    });
    lines.push('  </CgPoints>');
  }

  const planLines = geom.lines ?? [];
  const planCurves = geom.curves ?? [];
  if (planLines.length > 0 || planCurves.length > 0) {
    lines.push('  <PlanFeatures name="WebNet CAD">');
    lines.push('    <PlanFeature name="CAD-GEOM" desc="cad-geometry">');
    coordGeomBlock(planLines, planCurves, '      ');
    lines.push('    </PlanFeature>');
    lines.push('  </PlanFeatures>');
  }

  const parcels = geom.parcels ?? [];
  if (parcels.length > 0) {
    lines.push('  <Parcels>');
    parcels.forEach((parcel) => {
      if (parcel.ring.length < 4 || parcel.ring[0] !== parcel.ring[parcel.ring.length - 1]) {
        throw new Error(
          `LandXML CAD export: parcel ${JSON.stringify(parcel.name)} ring must be closed with at least 4 refs and first===last.`,
        );
      }
      parcel.ring.forEach((ref) => requireRef(ref, `Parcel ${parcel.name}`));
      lines.push(`    <Parcel name="${xmlEscape(parcel.name)}">`);
      const ringLines: CadLandXmlLine[] = [];
      for (let i = 0; i + 1 < parcel.ring.length; i += 1) {
        ringLines.push({ from: parcel.ring[i] as string, to: parcel.ring[i + 1] as string });
      }
      coordGeomBlock(ringLines, [], '      ');
      lines.push('    </Parcel>');
    });
    lines.push('  </Parcels>');
  }

  const alignments = geom.alignments ?? [];
  if (alignments.length > 0) {
    lines.push('  <Alignments>');
    alignments.forEach((alignment) => {
      lines.push(`    <Alignment name="${xmlEscape(alignment.name)}">`);
      coordGeomBlock(alignment.lines, alignment.curves, '      ');
      lines.push('    </Alignment>');
    });
    lines.push('  </Alignments>');
  }

  lines.push('</LandXML>');
  return lines.join('\n');
};
