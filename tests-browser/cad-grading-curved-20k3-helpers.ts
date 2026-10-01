/**
 * Phase 20K.3 Wave E3 browser-QA fixtures.
 *
 * Every world is built through the REAL persisted path: `runCadCommand`
 * (`GRADING_CREATE` / `GROUP_CREATE`) then `serializeCadDrawingFile`. The
 * browser opens the file and the production worker recomputes from the
 * persisted definition, so the flows exercise the shipped engine, not a
 * hand-assembled result. Reuses the 20K.2 opener/error harness.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createBlankCadDrawingDocument, serializeCadDrawingFile } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import { roundedSquareMembers } from '../scripts/phase20kHybridArcPairGroups';
import {
  CUT_FILL,
  RIDGE,
  gridSurface,
  nextId,
} from './cad-grading-curved-20k2-helpers';

export const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

const FIXED: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };
const DIST20: GradingCriterion = { kind: 'distance', gradeRatio: -0.5, distance: 20 };
const COURSES_TOL = 0.1;

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

const flatGrid = (id: string, name = 'Flat'): CadSurface =>
  gridSurface(id, name, () => 0, range(-100, 200, 10), range(-60, 160, 10));

/** The exact bottom rounded-square arc (`roundedSquareMembers`). */
const TIED_ARC = roundedSquareMembers(10)[0]!.source;

/** Single outward arc chord of the rounded square, z 10. */
const arcLine = (id: string): CadFeatureLineEntity => {
  const arc = TIED_ARC.arc!;
  const sweep = Math.abs(arc.endAngle - arc.startAngle);
  const signed = arc.sweepCCW ? sweep : -sweep;
  return {
    id,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: `FL ${id}`,
    vertices: [
      { id: `${id}:v0`, x: TIED_ARC.startX, y: TIED_ARC.startY, z: TIED_ARC.startZ },
      { id: `${id}:v1`, x: TIED_ARC.endX, y: TIED_ARC.endY, z: TIED_ARC.endZ },
    ],
    segmentGeometry: [{ kind: 'arc' as const, bulge: Math.tan(signed / 4) }],
  };
};

const roundedSquare = (id: string, bulge: number): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [[0, 0], [100, 0], [100, 100], [0, 100]].map(([x, y], i) => ({
    id: `${id}:v${i}`,
    x: x!,
    y: y!,
    z: 10,
  })),
  segmentGeometry: [0, 1, 2, 3].map(() => ({ kind: 'arc' as const, bulge })),
  closed: true,
});

const squareCourses = (id: string): Array<{ vertexAId: string; vertexBId: string }> =>
  [0, 1, 2, 3].map((i) => ({ vertexAId: `${id}:v${i}`, vertexBId: `${id}:v${(i + 1) % 4}` }));

const writeCad = (project: CadProject, tag: string): string => {
  const file = path.join(os.tmpdir(), `wn-20k3-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(
    file,
    serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: '20K.3 QA', units: 'm' }), project }),
    'utf8',
  );
  return file;
};

const createGroup = (
  entities: CadFeatureLineEntity[],
  surfaces: CadSurface[],
  command: Record<string, unknown>,
): { project: CadProject; file: string } => {
  const doc = createBlankCadDrawingDocument({ name: '20K.3 QA', units: 'm' });
  const project: CadProject = { ...doc.project, entities, surfaces };
  const history = runCadCommand(createCadHistoryState(project), command as never);
  return { project: history.present.project, file: writeCad(history.present.project, 'g') };
};

export interface GroupWorld {
  file: string;
  groupId: string;
  groupName: string;
  targetId: string | null;
  targetName: string | null;
}

const groupWorld = (
  entity: CadFeatureLineEntity,
  surfaces: CadSurface[],
  options: {
    criterion: GradingCriterion;
    closed: boolean;
    targetId: string | null;
    search: number;
    tolerance: number;
    name: string;
    courseCriteria?: Array<{ sourceCourse: { vertexAId: string; vertexBId: string }; criterion: GradingCriterion }>;
  },
): GroupWorld => {
  const courses = options.closed ? squareCourses(entity.id) : [{ vertexAId: `${entity.id}:v0`, vertexBId: `${entity.id}:v1` }];
  const { project, file } = createGroup([entity], surfaces, {
    key: 'GROUP_CREATE',
    name: options.name,
    sourceFeatureLineId: entity.id,
    sourceCourses: courses,
    ...(options.courseCriteria ? { courseCriteria: options.courseCriteria } : {}),
    ...(options.targetId ? { targetSurfaceId: options.targetId } : {}),
    side: 'right',
    criterion: options.criterion,
    maxSearchDistance: options.search,
    curveChordTolerance: options.tolerance,
    closed: options.closed,
  });
  const group = project.gradingGroups![0]!;
  const surface = surfaces[0] ?? null;
  return { file, groupId: group.id, groupName: group.name, targetId: surface?.id ?? null, targetName: surface?.name ?? null };
};

/**
 * A tilted plane through the middle linearized chord of the bottom arc: the
 * genuine tied split the Wave D agreement authority admits (2/2 topology).
 */
const tiedPlaneSurface = (): CadSurface => {
  const arc = TIED_ARC.arc!;
  const lin = linearizeGradingArc(
    arc.centerX, arc.centerY, arc.radius, arc.startAngle, arc.endAngle, arc.sweepCCW,
    TIED_ARC.startZ, TIED_ARC.endZ, 0.1,
  )!;
  const k = Math.floor(lin.points.length / 2);
  const p0 = lin.points[k]!;
  const p1 = lin.points[k + 1]!;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  const gx = -dy / len;
  const gy = dx / len;
  const far = lin.points[0]!;
  const sign = gx * (far.x - p0.x) + gy * (far.y - p0.y) > 0 ? -1 : 1;
  const a = sign * 0.2 * gx;
  const b = sign * 0.2 * gy;
  return gridSurface(
    'tgt-tied',
    'Tied',
    (x, y) => TIED_ARC.startZ + a * (x - p0.x) + b * (y - p0.y),
    range(-200, 300, 25),
    range(-200, 300, 25),
  );
};

/** Flow A — open arc group on the tied-split Surface (CURRENT 2/2). */
export const writeTiedGroupWorld = (): GroupWorld =>
  groupWorld(arcLine(nextId('fl')), [tiedPlaneSurface()], {
    criterion: FIXED, closed: false, targetId: 'tgt-tied', search: 200, tolerance: COURSES_TOL, name: 'TiedArc',
  });

/** Flow C — closed outward rounded-square group, all-Surface (Fixed + target). */
export const writeAllSurfaceWorld = (): GroupWorld =>
  groupWorld(roundedSquare(nextId('fl'), 0.1), [flatGrid('tgt-flat')], {
    criterion: FIXED, closed: true, targetId: 'tgt-flat', search: 100, tolerance: COURSES_TOL, name: 'AllSurfacePad',
  });

/** Flow D — closed inward-arc group whose arcs cross (chords stay simple). */
export const writeExtraCycleWorld = (): GroupWorld =>
  groupWorld(roundedSquare(nextId('fl'), -0.4), [], {
    criterion: DIST20, closed: true, targetId: null, search: 1500, tolerance: 0.5, name: 'InwardPinch',
  });

/** Flow E — open arc group over the non-planar ridge, Cut/Fill. */
export const writeRidgeWorld = (): GroupWorld =>
  groupWorld(
    arcLine(nextId('fl')),
    [gridSurface('tgt-ridge', 'Ridge', RIDGE, range(-100, 200, 5), range(-60, 60, 5))],
    { criterion: CUT_FILL, closed: false, targetId: 'tgt-ridge', search: 1500, tolerance: 0.5, name: 'RidgeArc' },
  );

/** Flow F — closed rounded square with a Surface override on course 0 (arc×arc). */
export const writeArcPairWorld = (): GroupWorld => {
  const entity = roundedSquare(nextId('fl'), 0.1);
  return groupWorld(entity, [flatGrid('tgt-flat')], {
    criterion: DIST20,
    closed: true,
    targetId: 'tgt-flat',
    search: 100,
    tolerance: COURSES_TOL,
    name: 'ArcPairPad',
    courseCriteria: [{ sourceCourse: squareCourses(entity.id)[0]!, criterion: FIXED }],
  });
};

/** Flow B — standalone arc grading on a flat Surface (CURRENT 1/1). */
export const writeStandaloneArcWorld = (): { file: string; gradingId: string; targetId: string; targetName: string } => {
  const doc = createBlankCadDrawingDocument({ name: '20K.3 QA', units: 'm' });
  const entity = arcLine(nextId('fl'));
  const surface = flatGrid('tgt-flat');
  const project: CadProject = { ...doc.project, entities: [entity], surfaces: [surface] };
  const history = runCadCommand(createCadHistoryState(project), {
    key: 'GRADING_CREATE',
    name: 'CurvedStandalone',
    sourceFeatureLineId: entity.id,
    vertexAId: `${entity.id}:v0`,
    vertexBId: `${entity.id}:v1`,
    targetSurfaceId: surface.id,
    side: 'right',
    criterion: FIXED,
    maxSearchDistance: 200,
    curveChordTolerance: COURSES_TOL,
  });
  const grading = history.present.project.gradings![0]!;
  return {
    file: writeCad(history.present.project, 's'),
    gradingId: grading.id,
    targetId: surface.id,
    targetName: surface.name,
  };
};
