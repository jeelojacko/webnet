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
 *
 * Error ellipses (§37) are NOT_APPLICABLE in LandXML: confidence-ellipse
 * semantics have no LandXML 1.2 representation, so requesting them emits a
 * warning per id and no geometry — never a silent drop, never faked as a
 * parcel ring or alignment.
 */

import { formatNumber, xmlEscape } from './landxml';
import { emptyExportResult, finalizeExportResult, type ExportResult, type ExportWarning } from './cad/exportResult';
import type { CadProject } from './cad/cadTypes';

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
  /**
   * Error-ellipse station ids explicitly requested for export. LandXML has
   * no ellipse representation (NOT_APPLICABLE): each id yields a warning
   * and no geometry. Absent = nothing requested, no warnings.
   */
  readonly errorEllipseIds?: readonly string[];
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
 * Serialize CAD geometry to LandXML 1.2 with an ExportResult warning channel.
 * Throws on unknown point refs, non-finite coordinates, or invalid curve
 * radii (fail-safe, no partial XML). Requested error ellipses warn per id
 * (NOT_APPLICABLE) and contribute no geometry.
 */
export const buildLandXmlFromCadGeometryWithResult = (
  geom: CadLandXmlGeometry,
  settings: CadLandXmlSettings,
): ExportResult<string> => {
  const result = emptyExportResult('');
  (geom.errorEllipseIds ?? []).forEach((id) => {
    // No NOT_APPLICABLE code in the frozen union — SKIPPED_ENTITY carries
    // the message; the id list records the disposition.
    result.warnings.push({
      code: 'SKIPPED_ENTITY',
      message: `error-ellipse ${id} has no LandXML representation (NOT_APPLICABLE)`,
      entityId: id,
    });
    result.omittedEntityIds.push(id);
  });
  result.output = buildLandXmlFromCadGeometry(geom, settings);
  return finalizeExportResult(result);
}

interface ProjectLandXmlAccum {
  points: CadLandXmlPoint[];
  /** Registered CgPoint coordinates by id (first registration wins). */
  coords: Map<string, { x: number; y: number }>;
  lines: CadLandXmlLine[];
  parcels: CadLandXmlParcel[];
  alignments: CadLandXmlAlignment[];
  ellipseIds: string[];
  warnings: ExportWarning[];
  exported: string[];
  omitted: string[];
  approximated: string[];
}

const newProjectAccum = (): ProjectLandXmlAccum => ({
  points: [],
  coords: new Map(),
  lines: [],
  parcels: [],
  alignments: [],
  ellipseIds: [],
  warnings: [],
  exported: [],
  omitted: [],
  approximated: [],
});

const registerPoint = (
  acc: ProjectLandXmlAccum,
  id: string,
  x: number,
  y: number,
  extra?: { z?: number; desc?: string; code?: string },
): void => {
  acc.coords.set(id, { x, y });
  const z = extra?.z ?? 0;
  acc.points.push({ id, x, y, ...(z !== 0 ? { z } : {}), ...(extra?.desc ? { desc: extra.desc } : {}), ...(extra?.code ? { code: extra.code } : {}) });
};

/** Claim a point id for exact coordinates. Returns the id to reference, or
 *  null for non-finite coordinates. The first registration wins; a
 *  different-coordinates claim on a taken id gets a deterministic `~n`
 *  suffix so no entity ever silently substitutes another entity's
 *  coordinates. (Survey points never use the suffix path — a conflicting
 *  duplicate station is omitted + warned instead, since the CgPoint name
 *  carries station identity.) */
const claimRef = (acc: ProjectLandXmlAccum, baseId: string, x: number, y: number): string | null => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const known = acc.coords.get(baseId);
  if (!known) {
    registerPoint(acc, baseId, x, y);
    return baseId;
  }
  if (known.x === x && known.y === y) return baseId;
  let n = 2;
  while (true) {
    const id = `${baseId}~${n}`;
    const other = acc.coords.get(id);
    if (!other) {
      registerPoint(acc, id, x, y);
      return id;
    }
    if (other.x === x && other.y === y) return id;
    n += 1;
  }
};

const accumSkipped = (acc: ProjectLandXmlAccum, entityId: string, message: string): void => {
  acc.warnings.push({ code: 'SKIPPED_ENTITY', message, entityId });
  acc.omitted.push(entityId);
};

const accumApproximated = (acc: ProjectLandXmlAccum, entityId: string, message: string): void => {
  acc.warnings.push({ code: 'SKIPPED_ENTITY', message, entityId });
  acc.exported.push(entityId);
  acc.approximated.push(entityId);
};

/** Arc endpoints from center/radius/angles (model E-N plane, y-up). */
const arcEndpoints = (
  centerX: number,
  centerY: number,
  radius: number,
  startDeg: number,
  endDeg: number,
): { ax: number; ay: number; bx: number; by: number } | null => {
  if (![centerX, centerY, radius, startDeg, endDeg].every(Number.isFinite) || radius <= 0) return null;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const ax = centerX + radius * Math.cos(toRad(startDeg));
  const ay = centerY + radius * Math.sin(toRad(startDeg));
  const bx = centerX + radius * Math.cos(toRad(endDeg));
  const by = centerY + radius * Math.sin(toRad(endDeg));
  return [ax, ay, bx, by].every(Number.isFinite) ? { ax, ay, bx, by } : null;
};

/**
 * Project → LandXML 1.2 with per-entity ExportResult disposition (production
 * CAD→LandXML adapter for the Export Center — not a test helper). Every
 * project entity lands in exported XOR omitted; approximated is a subset
 * flag of exported. Documented policy per entity (geometric data only —
 * parcels carry no legal meaning):
 * - survey-point → CgPoint (FULL); a duplicate station id with different
 *   coordinates is omitted + warned (never another point's coordinates);
 *   line → PlanFeature line (FULL), keeping actual endpoints via
 *   collision-safe synthetic refs + warning when an endpoint station id
 *   collides at different coordinates;
 * - open polyline → PlanFeature segments (FULL); closed polyline, polygon,
 *   parcel → Parcel ring (APPROXIMATED, warned);
 * - arc → chord line (APPROXIMATED, radius dropped, warned);
 * - alignment → Alignment lines + curves, arc sweep mapped to rot
 *   (endAngle ≥ startAngle ⇒ ccw in the y-up E-N plane, else cw); FULL
 *   when every element maps, APPROXIMATED + entity-attributed warning when
 *   elements were skipped but some exported;
 * - text → omitted + NOT_APPLICABLE warning; error-ellipse → omitted +
 *   NOT_APPLICABLE warning (no LandXML representation, never faked);
 * - non-finite/degenerate geometry → omitted + SKIPPED_ENTITY warning
 *   (fail-closed per entity; the serializer never sees it).
 */
export const buildLandXmlProjectExportWithResult = (
  project: CadProject,
  settings: CadLandXmlSettings,
): ExportResult<string> => {
  const acc = newProjectAccum();
  const sorted = [...project.entities].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  sorted.forEach((entity) => {
    if (entity.visible === false) return;
    switch (entity.type) {
      case 'survey-point': {
        const z = entity.z ?? 0;
        if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y) || !Number.isFinite(z)) {
          accumSkipped(acc, entity.id, `survey-point ${entity.id} has non-finite coordinates`);
          break;
        }
        const known = acc.coords.get(entity.stationId);
        if (known && (known.x !== entity.x || known.y !== entity.y)) {
          // Never claim FULL while substituting another entity's
          // coordinates: the conflicting duplicate is omitted + warned.
          accumSkipped(acc, entity.id, `survey-point ${entity.id} station ${entity.stationId} conflicts with another point's coordinates`);
          break;
        }
        if (!known) {
          registerPoint(acc, entity.stationId, entity.x, entity.y, {
            ...(entity.z != null ? { z: entity.z } : {}),
            ...(entity.description ? { desc: entity.description } : {}),
            ...(entity.featureCode ? { code: entity.featureCode } : {}),
          });
        }
        acc.exported.push(entity.id);
        break;
      }
      case 'line': {
        if (!Number.isFinite(entity.fromX) || !Number.isFinite(entity.fromY) || !Number.isFinite(entity.toX) || !Number.isFinite(entity.toY)) {
          accumSkipped(acc, entity.id, `line ${entity.id} has non-finite coordinates`);
          break;
        }
        // Endpoint station ids stay put when coordinates agree; on
        // collision the line keeps its ACTUAL endpoints via synthetic
        // refs (exact geometry, renamed reference) + a warning — never
        // another entity's coordinates.
        const from = claimRef(acc, entity.fromStationId, entity.fromX, entity.fromY);
        const to = claimRef(acc, entity.toStationId, entity.toX, entity.toY);
        if (!from || !to) {
          accumSkipped(acc, entity.id, `line ${entity.id} has unresolvable endpoints`);
          break;
        }
        if (from !== entity.fromStationId || to !== entity.toStationId) {
          acc.warnings.push({ code: 'SKIPPED_ENTITY', message: `line ${entity.id} endpoint station collides at different coordinates; synthetic refs preserve actual endpoints`, entityId: entity.id });
        }
        acc.lines.push({ from, to });
        acc.exported.push(entity.id);
        break;
      }
      case 'polyline': {
        if (entity.vertices.length < 2 || !entity.vertices.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))) {
          accumSkipped(acc, entity.id, `polyline ${entity.id} has fewer than 2 finite vertices`);
          break;
        }
        const refs = entity.vertices.map((vertex, index) => claimRef(acc, `${entity.id}:v${index}`, vertex.x, vertex.y));
        if (!refs.every((ref): ref is string => ref != null)) {
          accumSkipped(acc, entity.id, `polyline ${entity.id} has unresolvable vertices`);
          break;
        }
        if (entity.closed) {
          acc.parcels.push({ name: entity.id, ring: [...refs, refs[0] as string] });
          accumApproximated(acc, entity.id, `closed polyline ${entity.id} approximated as Parcel ring (geometric only)`);
        } else {
          for (let index = 0; index + 1 < refs.length; index += 1) {
            acc.lines.push({ from: refs[index] as string, to: refs[index + 1] as string });
          }
          acc.exported.push(entity.id);
        }
        break;
      }
      case 'polygon':
      case 'parcel': {
        if (entity.vertices.length < 3 || !entity.vertices.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))) {
          accumSkipped(acc, entity.id, `${entity.type} ${entity.id} has fewer than 3 finite vertices`);
          break;
        }
        const refs = entity.vertices.map((vertex, index) => claimRef(acc, `${entity.id}:v${index}`, vertex.x, vertex.y));
        if (!refs.every((ref): ref is string => ref != null)) {
          accumSkipped(acc, entity.id, `${entity.type} ${entity.id} has unresolvable vertices`);
          break;
        }
        acc.parcels.push({ name: entity.type === 'parcel' ? entity.parcelName : entity.id, ring: [...refs, refs[0] as string] });
        accumApproximated(acc, entity.id, `${entity.type} ${entity.id} approximated as Parcel ring (geometric only, no legal parcel meaning)`);
        break;
      }
      case 'arc': {
        const ends = arcEndpoints(entity.centerX, entity.centerY, entity.radius, entity.startAngleDeg, entity.endAngleDeg);
        if (!ends) {
          accumSkipped(acc, entity.id, `arc ${entity.id} has invalid geometry`);
          break;
        }
        const a = claimRef(acc, `${entity.id}:a`, ends.ax, ends.ay);
        const b = claimRef(acc, `${entity.id}:b`, ends.bx, ends.by);
        if (!a || !b) {
          accumSkipped(acc, entity.id, `arc ${entity.id} has unresolvable endpoints`);
          break;
        }
        acc.lines.push({ from: a, to: b });
        accumApproximated(acc, entity.id, `arc ${entity.id} approximated as chord (radius dropped)`);
        break;
      }
      case 'alignment': {
        const lines: CadLandXmlLine[] = [];
        const curves: CadLandXmlCurve[] = [];
        let skipped = 0;
        entity.elements.forEach((element, index) => {
          if (element.kind === 'line') {
            if (![element.start.x, element.start.y, element.end.x, element.end.y].every(Number.isFinite)) {
              acc.warnings.push({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} element ${index} (line) has non-finite coordinates`, entityId: entity.id });
              skipped += 1;
              return;
            }
            const s = claimRef(acc, `${entity.id}:s${index}`, element.start.x, element.start.y);
            const e = claimRef(acc, `${entity.id}:e${index}`, element.end.x, element.end.y);
            if (!s || !e) {
              acc.warnings.push({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} element ${index} (line) has unresolvable endpoints`, entityId: entity.id });
              skipped += 1;
              return;
            }
            lines.push({ from: s, to: e });
          } else if (element.kind === 'arc') {
            const ends = arcEndpoints(element.center.x, element.center.y, element.radius, element.startAngleDeg, element.endAngleDeg);
            if (!ends) {
              acc.warnings.push({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} element ${index} (arc) has invalid geometry`, entityId: entity.id });
              skipped += 1;
              return;
            }
            const cs = claimRef(acc, `${entity.id}:cs${index}`, ends.ax, ends.ay);
            const ce = claimRef(acc, `${entity.id}:ce${index}`, ends.bx, ends.by);
            if (!cs || !ce) {
              acc.warnings.push({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} element ${index} (arc) has unresolvable endpoints`, entityId: entity.id });
              skipped += 1;
              return;
            }
            curves.push({
              start: cs,
              end: ce,
              radiusM: element.radius,
              rot: element.endAngleDeg >= element.startAngleDeg ? 'ccw' : 'cw',
            });
          } else {
            acc.warnings.push({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} element ${index} has unknown kind`, entityId: entity.id });
            skipped += 1;
          }
        });
        if (lines.length + curves.length > 0) {
          acc.alignments.push({ name: entity.name, lines, curves });
          if (skipped > 0) {
            accumApproximated(acc, entity.id, `alignment ${entity.id} exported with ${skipped} skipped elements`);
          } else {
            acc.exported.push(entity.id);
          }
        } else {
          accumSkipped(acc, entity.id, `alignment ${entity.id} exported no representable elements`);
        }
        break;
      }
      case 'text':
        accumSkipped(acc, entity.id, `text ${entity.id} has no LandXML representation (NOT_APPLICABLE)`);
        break;
      case 'error-ellipse':
        acc.ellipseIds.push(entity.id);
        break;
      default:
        accumSkipped(acc, (entity as { id: string }).id, `entity ${(entity as { id: string }).id} has unsupported type ${(entity as { type: string }).type}`);
        break;
    }
  });
  const result = buildLandXmlFromCadGeometryWithResult(
    { points: acc.points, lines: acc.lines, parcels: acc.parcels, alignments: acc.alignments, errorEllipseIds: acc.ellipseIds },
    settings,
  );
  return finalizeExportResult({
    output: result.output,
    warnings: [...acc.warnings, ...result.warnings],
    errors: [],
    exportedEntityIds: [...acc.exported],
    omittedEntityIds: [...acc.omitted, ...result.omittedEntityIds],
    approximatedEntityIds: [...acc.approximated],
  });
}

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
