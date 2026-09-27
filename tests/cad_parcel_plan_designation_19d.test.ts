// Phase 19D Worker A — plan designation + bulk numbering oracles (§§90-91).
import { describe, expect, it } from 'vitest';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  checkPlanDesignationDuplicates,
  previewParcelNumbering,
  setParcelPlanInfo,
} from '../src/engine/cad/cadParcelPlanDesignation';
import { buildCopiedEntities } from '../src/engine/cad/cadTransactionsClipboardCommands';
import {
  parcelDesignateCommand,
  parcelNumberCommand,
} from '../src/engine/cad/cadTransactionsParcelPlanCommands';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { buildParcelCourseIds } from '../src/engine/cad/cadParcelCourses';
import {
  createCadHistoryState,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import type { CadCommandExecutionResult } from '../src/engine/cad/cadTransactions.types';
import type { CadParcelEntity } from '../src/engine/cad/cadTypes';

const makeParcel = (id: string, name: string, x0: number): CadParcelEntity => ({
  id,
  type: 'parcel',
  layerId: 'general',
  visible: true,
  locked: false,
  vertices: [
    { x: x0, y: 0 },
    { x: x0 + 10, y: 0 },
    { x: x0 + 10, y: 10 },
    { x: x0, y: 10 },
  ],
  vertexLabels: ['A', 'B', 'C', 'D'],
  parcelName: name,
  courseIds: buildParcelCourseIds(id, 4),
});

const projectWith = (parcels: CadParcelEntity[]) => {
  let project = createBlankCadProject({ name: 'plan-19d', units: 'm' });
  project = appendCadProjectEntities(project, parcels);
  return project;
};

const parcelsById = (state: { present: { project: { entities: unknown[] } } }) =>
  new Map(
    (state.present.project.entities as CadParcelEntity[])
      .filter((entity) => entity.type === 'parcel')
      .map((entity) => [entity.id, entity] as const),
  );

// Minimal one-entry commit around a raw execute() result (mirrors
// runCadCommand; the PARCEL* keys register in the integration wave).
const commitResult = (
  state: ReturnType<typeof createCadHistoryState>,
  commandKey: string,
  result: CadCommandExecutionResult,
): ReturnType<typeof createCadHistoryState> => ({
  present: result.nextSnapshot,
  undoStack: [
    ...state.undoStack,
    {
      transaction: {
        id: 'cad-tx-test',
        sequence: state.nextSequence,
        commandKey: commandKey as never,
        label: result.transactionLabel,
        beforeSelectionIds: state.present.selection.selectedEntityIds,
        afterSelectionIds: result.nextSnapshot.selection.selectedEntityIds,
        addedEntityIds: result.addedEntityIds,
        removedEntityIds: result.removedEntityIds,
      },
      before: state.present,
      after: result.nextSnapshot,
    },
  ],
  redoStack: [],
  nextSequence: state.nextSequence + 1,
  commandState: result.commandState,
});

describe('19D bulk numbering preview determinism (§90)', () => {
  it('5-parcel Lot-prefix preview is stable and sequential in selection order', () => {
    const parcels = [
      makeParcel('p1', 'Parcel 1', 0),
      makeParcel('p2', 'Parcel 2', 20),
      makeParcel('p3', 'Parcel 3', 40),
      makeParcel('p4', 'Parcel 4', 60),
      makeParcel('p5', 'Parcel 5', 80),
    ];
    const first = previewParcelNumbering(parcels, { prefix: 'Lot', start: 1, separator: ' ' });
    const second = previewParcelNumbering(parcels, { prefix: 'Lot', start: 1, separator: ' ' });
    expect(first).toEqual(second);
    expect(first.map((entry) => entry.proposed)).toEqual([
      'Lot 1',
      'Lot 2',
      'Lot 3',
      'Lot 4',
      'Lot 5',
    ]);
    expect(first.map((entry) => entry.parcelId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('spatial order runs west→east then north→south regardless of input order', () => {
    const east = makeParcel('east', 'Parcel E', 100);
    const west = makeParcel('west', 'Parcel W', 0);
    const mid = makeParcel('mid', 'Parcel M', 50);
    const first = previewParcelNumbering([east, mid, west], { prefix: 'Lot', order: 'spatial' });
    const second = previewParcelNumbering([west, east, mid], { prefix: 'Lot', order: 'spatial' });
    expect(first.map((entry) => entry.parcelId)).toEqual(['west', 'mid', 'east']);
    expect(first.map((entry) => entry.proposed)).toEqual(['Lot 1', 'Lot 2', 'Lot 3']);
    expect(second.map((entry) => entry.parcelId)).toEqual(['west', 'mid', 'east']);
  });

  it('name order sorts by parcelName', () => {
    const parcels = [
      makeParcel('b', 'Parcel B', 20),
      makeParcel('c', 'Parcel C', 40),
      makeParcel('a', 'Parcel A', 0),
    ];
    const preview = previewParcelNumbering(parcels, { prefix: 'Lot', order: 'name' });
    expect(preview.map((entry) => entry.parcelId)).toEqual(['a', 'b', 'c']);
    expect(preview.map((entry) => entry.proposed)).toEqual(['Lot 1', 'Lot 2', 'Lot 3']);
  });
});

describe('19D numbering commit + undo (§90)', () => {
  it('PARCELNUMBER commits designations without touching geometry, then undoes', () => {
    const parcels = [
      makeParcel('p1', 'Parcel 1', 0),
      makeParcel('p2', 'Parcel 2', 20),
      makeParcel('p3', 'Parcel 3', 40),
      makeParcel('p4', 'Parcel 4', 60),
      makeParcel('p5', 'Parcel 5', 80),
    ];
    const project = projectWith(parcels);
    const before = parcels.map((parcel) => ({
      vertices: parcel.vertices.map((vertex) => ({ ...vertex })),
      courseIds: [...parcel.courseIds!],
    }));
    const state = createCadHistoryState(project);
    const result = parcelNumberCommand.execute(
      state.present,
      {
        key: 'PARCELNUMBER',
        parcelEntityIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
        numbering: { prefix: 'Lot', start: 1, separator: ' ' },
        role: 'lot',
      },
    );
    expect(result).not.toBeNull();
    const committed = commitResult(state, 'PARCELNUMBER', result!);
    expect(committed.undoStack).toHaveLength(1);
    const after = parcelsById(committed);
    ['p1', 'p2', 'p3', 'p4', 'p5'].forEach((id, index) => {
      const parcel = after.get(id)!;
      expect(parcel.planInfo?.designation).toBe(`Lot ${index + 1}`);
      expect(parcel.planInfo?.role).toBe('lot');
      // Geometry, course identity, and names are untouched.
      expect(parcel.vertices).toEqual(before[index]!.vertices);
      expect(parcel.courseIds).toEqual(before[index]!.courseIds);
      expect(parcel.parcelName).toBe(`Parcel ${index + 1}`);
    });
    const undone = undoCadHistory(committed);
    const restored = parcelsById(undone);
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      expect(restored.get(id)!.planInfo).toBeUndefined();
    }
  });
});

describe('19D rename keeps ids/tables/links stable (§91)', () => {
  it('Lot 24→24A changes only the designation', () => {
    const parcel = setParcelPlanInfo(makeParcel('p24', 'Parcel 24', 0), {
      designation: 'Lot 24',
      role: 'lot',
    });
    const project = projectWith([parcel]);
    const state = createCadHistoryState(project);
    const result = parcelDesignateCommand.execute(state.present, {
      key: 'PARCELDESIGNATE',
      parcelEntityIds: ['p24'],
      designation: 'Lot 24A',
    });
    expect(result).not.toBeNull();
    const next = (result!.nextSnapshot.project.entities as CadParcelEntity[]).find(
      (entity) => entity.type === 'parcel',
    )!;
    expect(next.id).toBe('p24');
    expect(next.parcelName).toBe('Parcel 24');
    expect(next.courseIds).toEqual(parcel.courseIds);
    expect(next.vertices).toEqual(parcel.vertices);
    expect(next.planInfo?.designation).toBe('Lot 24A');
    expect(next.planInfo?.role).toBe('lot');
  });
});

describe('19D duplicate policy', () => {
  it('exact duplicates warn; lot duplicates block without the confirm flag', () => {
    const warned = checkPlanDesignationDuplicates([
      { parcelId: 'a', designation: 'Lot 1', role: 'road' },
      { parcelId: 'b', designation: 'Lot 1', role: 'road' },
    ]);
    expect(warned.warnings).toHaveLength(1);
    expect(warned.blocked).toHaveLength(0);
    const blocked = checkPlanDesignationDuplicates([
      { parcelId: 'a', designation: 'Lot 1', role: 'lot' },
      { parcelId: 'b', designation: 'Lot 1', role: 'lot' },
    ]);
    expect(blocked.warnings).toHaveLength(1);
    expect(blocked.blocked).toHaveLength(1);
    const confirmed = checkPlanDesignationDuplicates(
      [
        { parcelId: 'a', designation: 'Lot 1', role: 'lot' },
        { parcelId: 'b', designation: 'Lot 1', role: 'lot' },
      ],
      { allowLotDuplicates: true },
    );
    expect(confirmed.blocked).toHaveLength(0);
  });

  it('PARCELDESIGNATE returns null on lot duplicates unless confirmed', () => {
    const parcels = [
      setParcelPlanInfo(makeParcel('a', 'Parcel A', 0), { designation: 'Lot 1', role: 'lot' }),
      makeParcel('b', 'Parcel B', 20),
    ];
    const project = projectWith(parcels);
    const state = createCadHistoryState(project);
    const blocked = parcelDesignateCommand.execute(state.present, {
      key: 'PARCELDESIGNATE',
      parcelEntityIds: ['b'],
      designation: 'Lot 1',
      role: 'lot',
    });
    expect(blocked).toBeNull();
    const confirmed = parcelDesignateCommand.execute(state.present, {
      key: 'PARCELDESIGNATE',
      parcelEntityIds: ['b'],
      designation: 'Lot 1',
      role: 'lot',
      allowLotDuplicates: true,
    });
    expect(confirmed).not.toBeNull();
  });
});

describe('19D COPY policy (matrix row 7)', () => {
  it('copy carries role/description, clears designation, mints fresh course ids', () => {
    const source = setParcelPlanInfo(makeParcel('src', 'Parcel S', 0), {
      designation: 'Lot 7',
      role: 'lot',
      description: 'Corner lot',
    });
    const project = projectWith([source]);
    const copied = buildCopiedEntities(project, [source], 100, 0);
    expect(copied).toHaveLength(1);
    const copy = copied[0]! as CadParcelEntity;
    expect(copy.id).not.toBe('src');
    expect(copy.planInfo?.designation).toBeUndefined();
    expect(copy.planInfo?.role).toBe('lot');
    expect(copy.planInfo?.description).toBe('Corner lot');
    expect(copy.courseIds).toHaveLength(4);
    expect(copy.courseIds).not.toEqual(source.courseIds);
    // Source is untouched.
    expect(source.planInfo?.designation).toBe('Lot 7');
  });
});
