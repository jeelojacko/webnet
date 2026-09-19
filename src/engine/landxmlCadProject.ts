/**
 * Phase 18L — CadProject → LandXML 1.2 project adapter.
 *
 * Converts drawing entities to the geometry model and, when civil sources are
 * supplied, appends CURRENT TIN surfaces plus alignment-attached profiles and
 * cross sections. Every project entity lands in exported XOR omitted;
 * approximated is a subset flag of exported. Civil objects carry their own
 * ids and a per-class disposition list for the Export Center summary.
 *
 * Moved out of landxmlCad.ts (which now re-exports the public API) so no
 * single file grows past the repo size guideline.
 */
import {
  buildLandXmlFromCadGeometryWithResult,
} from './landxmlCadSerialize';
import {
  buildCadLandXmlCivilGeometry,
  type CadLandXmlCivilEntry,
  type CadLandXmlCivilSources,
} from './landxmlCivilSource';
import { finalizeExportResult, type ExportResult, type ExportWarning } from './cad/exportResult';
import type {
  CadLandXmlAlignment,
  CadLandXmlCurve,
  CadLandXmlLine,
  CadLandXmlPoint,
  CadLandXmlSettings,
  CadLandXmlStaEquation,
  CadLandXmlSurface,
} from './landxmlCadTypes';
import type { CadAlignmentEntity, CadProject } from './cad/cadTypes';

export interface CadLandXmlProjectExportResult extends ExportResult<string> {
  /** Per-object civil dispositions (surfaces/profiles/sections). */
  readonly civilEntries: readonly CadLandXmlCivilEntry[];
}

interface ProjectLandXmlAccum {
  points: CadLandXmlPoint[];
  /** Registered CgPoint coordinates by id (first registration wins). */
  coords: Map<string, { x: number; y: number }>;
  lines: CadLandXmlLine[];
  parcels: { name: string; ring: string[] }[];
  alignments: CadLandXmlAlignment[];
  surfaces: CadLandXmlSurface[];
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
  surfaces: [],
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
 * Mirror cadAlignmentStationing's resolution: an equation with no explicit
 * rawStation sits at backStation − accumulated delta. Invalid sets are
 * dropped whole so stationing is never exported partially corrupted.
 */
const resolveStaEquations = (
  entity: CadAlignmentEntity,
): { equations: CadLandXmlStaEquation[]; invalid: boolean } => {
  let deltaBefore = 0;
  const equations: CadLandXmlStaEquation[] = [];
  for (const equation of entity.stationEquations ?? []) {
    if (!Number.isFinite(equation.backStation) || !Number.isFinite(equation.aheadStation)) {
      return { equations: [], invalid: true };
    }
    const rawStation = equation.rawStation ?? equation.backStation - deltaBefore;
    if (!Number.isFinite(rawStation)) return { equations: [], invalid: true };
    equations.push({ staInternal: rawStation, staAhead: equation.aheadStation, staBack: equation.backStation });
    deltaBefore += equation.aheadStation - equation.backStation;
  }
  return { equations, invalid: false };
};

const convertEntities = (project: CadProject, acc: ProjectLandXmlAccum): void => {
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
          const resolved = resolveStaEquations(entity);
          if (resolved.invalid) {
            acc.warnings.push({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} station equations are invalid; exported without equations`, entityId: entity.id });
          }
          acc.alignments.push({
            name: entity.name,
            lines,
            curves,
            startStation: entity.startStation,
            sourceEntityId: entity.id,
            ...(resolved.equations.length > 0 ? { stationEquations: resolved.equations } : {}),
          });
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
};

/**
 * Project → LandXML 1.2 with per-entity ExportResult disposition (production
 * CAD→LandXML adapter for the Export Center — not a test helper).
 *
 * Behaviour of the pre-18L entity pass is unchanged. When `civilSources` is
 * supplied, CURRENT surfaces, profiles, and cross sections are appended;
 * stale/unavailable civil objects are blocked with a reason and an omitted
 * id. Absent `civilSources` keeps the legacy entity-only output byte-identical.
 */
export const buildLandXmlProjectExportWithResult = (
  project: CadProject,
  settings: CadLandXmlSettings,
  civilSources?: CadLandXmlCivilSources,
): CadLandXmlProjectExportResult => {
  const acc = newProjectAccum();
  convertEntities(project, acc);

  const exportedAlignmentIds = new Set(
    acc.alignments.map((alignment) => alignment.sourceEntityId).filter((id): id is string => id != null),
  );
  const civil = buildCadLandXmlCivilGeometry(project, civilSources, exportedAlignmentIds);
  acc.alignments.forEach((alignment) => {
    if (!alignment.sourceEntityId) return;
    const attachment = civil.alignmentCivil.get(alignment.sourceEntityId);
    if (!attachment) return;
    if (attachment.profiles.length > 0) alignment.profiles = attachment.profiles;
    if (attachment.crossSections.length > 0) alignment.crossSections = attachment.crossSections;
  });

  const result = buildLandXmlFromCadGeometryWithResult(
    {
      points: acc.points,
      lines: acc.lines,
      parcels: acc.parcels,
      alignments: acc.alignments,
      surfaces: civil.surfaces,
      errorEllipseIds: acc.ellipseIds,
    },
    settings,
  );
  const finalized = finalizeExportResult({
    output: result.output,
    warnings: [...acc.warnings, ...result.warnings, ...civil.warnings],
    errors: [],
    exportedEntityIds: [...acc.exported, ...civil.exportedIds],
    omittedEntityIds: [...acc.omitted, ...result.omittedEntityIds, ...civil.omittedIds],
    approximatedEntityIds: [...acc.approximated],
  });
  return { ...finalized, civilEntries: civil.entries };
};
