// Phase 19D integration (§75) — save/reopen round-trip over the full plan
// fabric: 5 lots + remainder + easement + ROW, one linked line pair and one
// linked arc pair. Serialize/deserialize (WNCAD) preserves designations,
// roles, and relationships exactly; every link stays CURRENT and the derived
// schedule is byte-equal after reopen.

import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildParcelCourseIds } from '../src/engine/cad/cadParcelCourses';
import {
  deriveCadParcelSharedBoundaryStatus,
  resolveCadParcelSharedBoundaryGeometry,
} from '../src/engine/cad/cadParcelSharedBoundary';
import { buildCadParcelSchedule } from '../src/engine/cad/cadParcelSchedule';
import { parcelLinkCommand } from '../src/engine/cad/cadTransactionsParcelLinkCommands';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type {
  CadParcelCourseGeometry,
  CadParcelEntity,
  CadParcelPlanRole,
  CadProject,
} from '../src/engine/cad/cadTypes';

const LINE: CadParcelCourseGeometry = { kind: 'line' };
const arc = (bulge: number): CadParcelCourseGeometry => ({ kind: 'arc', bulge });

const makeParcel = (
  id: string,
  vertices: Array<{ x: number; y: number }>,
  designation: string,
  role: CadParcelPlanRole,
  courseGeometry?: CadParcelCourseGeometry[],
): CadParcelEntity => ({
  id,
  type: 'parcel',
  layerId: 'parcels',
  visible: true,
  locked: false,
  parcelName: `Parcel ${id}`,
  vertices: vertices.map((vertex) => ({ ...vertex })),
  vertexLabels: vertices.map((_, index) => `P${index + 1}`),
  courseIds: buildParcelCourseIds(id, vertices.length),
  ...(courseGeometry != null ? { courseGeometry: courseGeometry.map((entry) => ({ ...entry })) } : {}),
  planInfo: { designation, role },
});

const square = (
  id: string,
  x: number,
  y: number,
  designation: string,
  role: CadParcelPlanRole,
  courseGeometry?: CadParcelCourseGeometry[],
): CadParcelEntity =>
  makeParcel(
    id,
    [
      { x, y },
      { x: x + 10, y },
      { x: x + 10, y: y + 10 },
      { x, y: y + 10 },
    ],
    designation,
    role,
    courseGeometry,
  );

const link = (
  project: CadProject,
  first: { parcelId: string; courseId: string },
  second: { parcelId: string; courseId: string },
): CadProject => {
  const snapshot = createCadHistoryState(project).present;
  const result = parcelLinkCommand.execute(snapshot, { key: 'PARCELLINK', first, second });
  if (!result) throw new Error(`PARCELLINK failed: ${first.parcelId} ↔ ${second.parcelId}`);
  return result.nextSnapshot.project;
};

describe('19D §75 save/reopen over the full plan fabric', () => {
  it('round-trips designations, roles, links, and schedule values exactly', () => {
    const parcels = [
      square('lot-1', 0, 0, 'Lot 1', 'lot'),
      square('lot-2', 0, 10, 'Lot 2', 'lot'),
      // Arc pair: lot-3 course 2 (30,10)->(20,10) bulge +0.5 mirrors
      // lot-4 course 0 (20,10)->(30,10) bulge -0.5.
      square('lot-3', 20, 0, 'Lot 3', 'lot', [LINE, LINE, arc(0.5), LINE]),
      square('lot-4', 20, 10, 'Lot 4', 'lot', [arc(-0.5), LINE, LINE, LINE]),
      square('lot-5', 40, 0, 'Lot 5', 'lot'),
      square('remainder', 40, 10, 'Remainder A', 'remainder'),
      square('easement', 60, 0, 'Easement E1', 'easement'),
      square('row', 60, 10, 'ROW R1', 'right-of-way'),
    ];
    const drawing = createBlankCadDrawingDocument({ name: '19D save/reopen', units: 'm' });
    const base: CadProject = { ...drawing.project, entities: parcels };
    const project = link(
      link(
        base,
        { parcelId: 'lot-1', courseId: 'parcel-course:lot-1:2' },
        { parcelId: 'lot-2', courseId: 'parcel-course:lot-2:0' },
      ),
      { parcelId: 'lot-3', courseId: 'parcel-course:lot-3:2' },
      { parcelId: 'lot-4', courseId: 'parcel-course:lot-4:0' },
    );
    expect(project.sharedParcelBoundaries).toHaveLength(2);

    const ids = parcels.map((parcel) => parcel.id);
    const scheduleBefore = buildCadParcelSchedule(project, ids);
    expect(scheduleBefore.totals.parcelCount).toBe(8);

    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;

    // Designations + roles exact per parcel.
    const expected = new Map(parcels.map((parcel) => [parcel.id, parcel.planInfo]));
    for (const entity of reopened.entities) {
      if (entity.type !== 'parcel') continue;
      expect(entity.planInfo).toEqual(expected.get(entity.id));
    }
    expect(
      reopened.entities.filter((entity) => entity.type === 'parcel').length,
    ).toBe(8);

    // Relationships exact, all CURRENT, line + arc geometry kinds preserved.
    expect(reopened.sharedParcelBoundaries).toEqual(project.sharedParcelBoundaries);
    const kinds = new Set<string>();
    for (const boundary of reopened.sharedParcelBoundaries ?? []) {
      expect(deriveCadParcelSharedBoundaryStatus(reopened, boundary)).toBe('CURRENT');
      const geometry = resolveCadParcelSharedBoundaryGeometry(reopened, boundary);
      expect(geometry).not.toBeNull();
      kinds.add(geometry!.kind);
    }
    expect(kinds).toEqual(new Set(['line', 'arc']));

    // Schedule values equal after reopen.
    expect(buildCadParcelSchedule(reopened, ids)).toEqual(scheduleBefore);
  });
});
