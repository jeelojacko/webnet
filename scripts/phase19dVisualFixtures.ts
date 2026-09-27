/**
 * Phase 19D visual-QA fixtures (§116) — deterministic realistic subdivision
 * plan built through the production document seams (`createBlankCadDrawingDocument`
 * + `serializeCadDrawingFile`), never hand-written JSON.
 *
 * The plan: parent Remainder + 5 numbered Lots (one shared line boundary and
 * one shared curved/arc boundary between lots), a Road (R/W) sharing a line
 * with the Remainder, and an Easement overlay inside Lot 1. It carries a
 * Parcel Course Table, a Parcel Summary (schedule) Table and a Point Table,
 * plus an ISO A2 landscape sheet with a viewport, North Arrow, Scale Bar and
 * a title block.
 *
 * `buildFindingsProject` deliberately corrupts the plan for the validation
 * view: Lot 4 overlaps Lot 3 (PRIMARY_OVERLAP) and the linked arc bulge no
 * longer matches (LINK_GEOMETRY_MISMATCH). No `src/` change; this is a
 * fixture for capture only.
 */
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildParcelCourseIds } from '../src/engine/cad/cadParcelCourses';
import { buildCadParcelSharedBoundaryId } from '../src/engine/cad/cadParcelSharedBoundary';
import {
  addSheetToDraft,
  addViewportToSheet,
  assignTitleBlockToSheet,
  createPlanSheet,
  createTitleBlockTemplate,
} from '../src/engine/cad/cadSheets';
import {
  addSheetObject,
  defaultNorthArrowObject,
  defaultScaleBarObject,
} from '../src/engine/cad/cadSheetObjects';
import { createCadSurveyTableRow } from '../src/engine/cad/cadSurveyTables';
import type {
  CadDisplayPoint,
  CadEntity,
  CadParcelCourseGeometry,
  CadParcelEntity,
  CadParcelPlanRole,
  CadProject,
  CadSurveyPointEntity,
  CadSurveyTableEntity,
  CadSurveyTableRow,
} from '../src/engine/cad/cadTypes';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const line: CadParcelCourseGeometry = { kind: 'line' };
const arc = (bulge: number): CadParcelCourseGeometry => ({ kind: 'arc', bulge });

interface ParcelSpec {
  id: string;
  designation: string;
  role: CadParcelPlanRole;
  description?: string;
  vertices: Array<[number, number]>;
  courseGeometry?: CadParcelCourseGeometry[];
  /** Operator-assigned entity appearance (layer/style owns role colour; this
   *  fixture just demonstrates the supported per-entity presentation seam). */
  appearance?: CadParcelEntity['appearance'];
}

const parcel = (spec: ParcelSpec): CadParcelEntity => {
  const vertices: CadDisplayPoint[] = spec.vertices.map(([x, y]) => ({ x, y }));
  const courseGeometry = spec.courseGeometry?.map((entry) => ({ ...entry }));
  const entity: CadParcelEntity = {
    id: spec.id,
    type: 'parcel',
    layerId: 'parcels',
    visible: true,
    locked: false,
    parcelName: spec.designation,
    planInfo: {
      designation: spec.designation,
      role: spec.role,
      ...(spec.description != null ? { description: spec.description } : {}),
    },
    vertices,
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    courseIds: buildParcelCourseIds(spec.id, vertices.length),
    // Fixture parcels are authored, not adjustment-derived: mark them manual
    // so the Phase 17E deliverable gate treats the plan as MANUAL_ONLY (the
    // same owner a hand-drawn / PARCEL_CREATE parcel carries for delivery).
    metadata: { manual: true },
    ...(spec.appearance != null ? { appearance: { ...spec.appearance } } : {}),
    ...(courseGeometry != null ? { courseGeometry } : {}),
  };
  const closure = cadBuildParcelClosureSummary(vertices, { courseGeometry });
  if (closure) {
    entity.areaSquareMeters = closure.areaSquareMeters;
    entity.perimeterMeters = closure.perimeterMeters;
    entity.closureDeltaX = closure.closureDeltaX;
    entity.closureDeltaY = closure.closureDeltaY;
    entity.closureDistanceMeters = closure.closureDistanceMeters;
  }
  return entity;
};

const surveyPoint = (
  id: string,
  stationId: string,
  x: number,
  y: number,
  description: string,
): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'survey-points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z: 12.5,
  pointClass: 'free',
  source: 'parsed-input',
  description,
});

const surveyTable = (
  id: string,
  tableKind: CadSurveyTableEntity['tableKind'],
  x: number,
  y: number,
  rows: CadSurveyTableRow[],
  title: string,
): CadSurveyTableEntity => ({
  id,
  type: 'survey-table',
  layerId: 'annotation',
  visible: true,
  locked: false,
  tableKind,
  x,
  y,
  rotationDeg: 0,
  tableStyleId: 'survey-table-style-standard',
  rows,
  title,
  showTitle: true,
});

/** Arc sagitta relation: bulge = 2·sagitta/chord for the minor arc. */
const CURVED_BOUNDARY_BULGE = 2 * 5 / 36;

const BASE_LOT4_X = 72;

export interface PlanBuildOptions {
  /** Shift Lot 4 west so it overlaps Lot 3 (positive-area overlap). */
  overlapLots?: boolean;
  /** Mismatch the shared arc bulge so the linked pair reads GEOMETRY_MISMATCH. */
  breakArcLink?: boolean;
}

export interface PlanFixture {
  project: CadProject;
  parcelIds: string[];
  lotIds: string[];
  roadId: string;
  remainderId: string;
  easementId: string;
}

export const buildPlanProject = (options: PlanBuildOptions = {}): PlanFixture => {
  const document = createBlankCadDrawingDocument({ name: 'Subdivision Plan 19D', units: 'm' });
  const arcBulge = options.breakArcLink ? 0.16 : CURVED_BOUNDARY_BULGE;
  const lot4X = options.overlapLots ? BASE_LOT4_X - 6 : BASE_LOT4_X;

  const lot1 = parcel({
    id: 'parcel:lot1',
    designation: 'Lot 1',
    role: 'lot',
    description: 'Corner lot with drainage easement',
    vertices: [[0, 0], [24, 0], [24, 36], [0, 36]],
  });
  const lot2 = parcel({
    id: 'parcel:lot2',
    designation: 'Lot 2',
    role: 'lot',
    vertices: [[24, 0], [48, 0], [48, 36], [24, 36]],
    courseGeometry: [line, arc(arcBulge), line, line],
  });
  const lot3 = parcel({
    id: 'parcel:lot3',
    designation: 'Lot 3',
    role: 'lot',
    vertices: [[48, 0], [72, 0], [72, 36], [48, 36]],
    courseGeometry: [line, line, line, arc(-CURVED_BOUNDARY_BULGE)],
  });
  const lot4 = parcel({
    id: 'parcel:lot4',
    designation: 'Lot 4',
    role: 'lot',
    vertices: [[lot4X, 0], [lot4X + 24, 0], [lot4X + 24, 36], [lot4X, 36]],
  });
  const lot5 = parcel({
    id: 'parcel:lot5',
    designation: 'Lot 5',
    role: 'lot',
    vertices: [[96, 0], [120, 0], [120, 36], [96, 36]],
  });
  const road = parcel({
    id: 'parcel:road',
    designation: 'R/W 1',
    role: 'road',
    description: 'Street right-of-way (display area only)',
    vertices: [[120, 0], [134, 0], [134, 80], [120, 80]],
    appearance: { color: '#94a3b8', lineTypeId: 'dashed', transparency: 0.2 },
  });
  const remainder = parcel({
    id: 'parcel:remainder',
    designation: 'Remainder',
    role: 'remainder',
    description: 'Parent parcel remainder',
    vertices: [[134, 0], [180, 0], [180, 80], [134, 80]],
    appearance: { color: '#a78bfa' },
  });
  const easement = parcel({
    id: 'parcel:easement',
    designation: 'Easement E-1',
    role: 'easement',
    description: 'Drainage easement overlay',
    vertices: [[6, 6], [18, 6], [18, 20], [6, 20]],
    appearance: { color: '#22d3ee', lineTypeId: 'dashed', transparency: 0.3 },
  });

  const lots = [lot1, lot2, lot3, lot4, lot5];
  const allParcels = [...lots, road, remainder, easement];

  const link = (a: CadParcelEntity, aIndex: number, b: CadParcelEntity, bIndex: number) => {
    const first = { parcelId: a.id, courseId: a.courseIds![aIndex]! };
    const second = { parcelId: b.id, courseId: b.courseIds![bIndex]! };
    return { id: buildCadParcelSharedBoundaryId(first, second), first, second };
  };
  const sharedParcelBoundaries = [
    link(lot1, 1, lot2, 3),
    link(lot2, 1, lot3, 3),
    link(lot3, 1, lot4, 3),
    link(lot4, 1, lot5, 3),
    link(road, 1, remainder, 3),
  ];

  const points: CadSurveyPointEntity[] = [
    surveyPoint('pt:MON1', 'MON1', 0, 0, 'IP'),
    surveyPoint('pt:MON2', 'MON2', 120, 0, 'IP'),
    surveyPoint('pt:MON3', 'MON3', 134, 80, 'IP'),
    surveyPoint('pt:MON4', 'MON4', 180, 80, 'IP'),
    surveyPoint('pt:IP1', 'IP1', 43, 18, 'IP'),
  ];

  const courseRows = lot1.courseIds!.map((courseId) =>
    createCadSurveyTableRow({ kind: 'parcel-course', parcelId: lot1.id, courseId }),
  );
  const scheduleRows = allParcels.map((entry) =>
    createCadSurveyTableRow({ kind: 'parcel', parcelId: entry.id }),
  );
  const pointRows = points.map((point) =>
    createCadSurveyTableRow({ kind: 'survey-point', entityId: point.id }),
  );

  const tables = [
    surveyTable('tbl:course', 'parcel-course', 0, -52, courseRows, 'LOT 1 — COURSE TABLE'),
    surveyTable('tbl:schedule', 'parcel-summary', 100, -52, scheduleRows, 'PARCEL SCHEDULE'),
    surveyTable('tbl:point', 'point', 0, -104, pointRows, 'POINT TABLE'),
  ];

  const project: CadProject = {
    ...document.project,
    name: 'Subdivision Plan 19D',
    entities: [...allParcels, ...points, ...tables] as CadEntity[],
    sharedParcelBoundaries,
  };

  return {
    project,
    parcelIds: allParcels.map((entry) => entry.id),
    lotIds: lots.map((entry) => entry.id),
    roadId: road.id,
    remainderId: remainder.id,
    easementId: easement.id,
  };
};

export const buildFindingsProject = (): PlanFixture =>
  buildPlanProject({ overlapLots: true, breakArcLink: true });

const writeDocument = (project: CadProject, name: string, sheet: boolean): string => {
  const document = createBlankCadDrawingDocument({ name, units: 'm' });
  let draft = document.draft;
  if (sheet) {
    if (!draft) throw new Error('blank drawing has no draft');
    let next = addSheetToDraft(
      draft,
      createPlanSheet({ name: 'C-101', sizeId: 'ISO A2', orientation: 'landscape' }),
    );
    const sheetEntry = next.sheets[next.sheets.length - 1];
    if (!sheetEntry) throw new Error('sheet not created');
    next = addViewportToSheet(next, sheetEntry.id, {
      name: 'PLAN',
      modelCenterX: 15,
      modelCenterY: -12,
      scaleDenominator: 750,
      paperXmm: 25,
      paperYmm: 22,
      paperWidthMm: 540,
      paperHeightMm: 330,
      rotationDeg: 0,
    });
    const viewport = next.sheets.find((entry) => entry.id === sheetEntry.id)?.viewports.at(-1);
    if (!viewport) throw new Error('viewport not created');
    next = addSheetObject(next, sheetEntry.id, defaultNorthArrowObject(viewport));
    next = addSheetObject(next, sheetEntry.id, defaultScaleBarObject(viewport));
    const template = createTitleBlockTemplate('TB-19D');
    next = { ...next, titleBlockDefinitions: [...next.titleBlockDefinitions, template] };
    next = assignTitleBlockToSheet(next, sheetEntry.id, template.id);
    draft = next;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-19d-vis-'));
  const filePath = path.join(dir, `${name.replace(/\s+/g, '_')}.wncad`);
  fs.writeFileSync(
    filePath,
    serializeCadDrawingFile({
      ...document,
      project: { ...project },
      ...(draft != null ? { draft } : {}),
    }),
    'utf8',
  );
  return filePath;
};

export const writePlanDrawing = (project: CadProject, name: string): string =>
  writeDocument(project, name, false);

export const writeSheetDrawing = (project: CadProject, name: string): string =>
  writeDocument(project, name, true);
