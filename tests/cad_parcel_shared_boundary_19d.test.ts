// Phase 19D Worker B — Shared Boundary relationship oracles.
//
// §79 line oracle (0,0)->(100,0) vs reverse => CURRENT, shared length 100.
// §80 arc oracle (+b/-b minor and major variants => CURRENT, same radius/length).
// §81 wrong-arc oracle (minor vs major / different circle => BLOCK).
// Duplicate + non-manifold guards BLOCK; load sanitizer drops malformed refs
// with diagnostics; WNCAD save/reopen round-trips refs exactly (nothing
// derived persisted).
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument, parseCadDrawingFile, serializeCadDrawingFile } from '../src/engine/cad/cadDrawingFile';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import { buildParcelCourseIds } from '../src/engine/cad/cadParcelCourses';
import {
  buildCadParcelSharedBoundaryId,
  deriveCadParcelSharedBoundaryStatus,
  resolveCadParcelSharedBoundaryGeometry,
  sanitizeCadParcelSharedBoundaries,
  validateSharedBoundary,
} from '../src/engine/cad/cadParcelSharedBoundary';
import type {
  CadParcelSharedBoundary,
  CadParcelSharedBoundaryEnd,
} from '../src/engine/cad/cadParcelSharedBoundary';
import {
  parcelLinkCommand,
  parcelUnlinkCommand,
} from '../src/engine/cad/cadTransactionsParcelLinkCommands';
import type { CadParcelCourseGeometry, CadParcelEntity, CadProject } from '../src/engine/cad/cadTypes';

const makeParcel = (
  id: string,
  vertices: Array<{ x: number; y: number }>,
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
  ...(courseGeometry != null ? { courseGeometry } : {}),
});

const square = (id: string): CadParcelEntity =>
  makeParcel(id, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]);

const reverseSquare = (id: string): CadParcelEntity =>
  makeParcel(id, [
    { x: 100, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: -100 },
    { x: 100, y: -100 },
  ]);

const triangle = (id: string): CadParcelEntity =>
  makeParcel(id, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ]);

const arcParcel = (id: string, bulge: number, forward: boolean): CadParcelEntity =>
  makeParcel(
    id,
    forward
      ? [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 0, y: 100 },
        ]
      : [
          { x: 100, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: -100 },
        ],
    [{ kind: 'arc', bulge }, { kind: 'line' }, { kind: 'line' }],
  );

const projectWith = (entities: CadParcelEntity[]): CadProject => ({
  ...createBlankCadDrawingDocument({ name: 'Shared Boundary', units: 'm' }).project,
  entities,
});

const endOf = (parcelId: string, courseId: string): CadParcelSharedBoundaryEnd => ({ parcelId, courseId });

const snapshot = (project: CadProject) => createCadHistoryState(project).present;

const link = (project: CadProject, first: CadParcelSharedBoundaryEnd, second: CadParcelSharedBoundaryEnd) => {
  const result = parcelLinkCommand.execute(snapshot(project), { key: 'PARCELLINK', first, second });
  return result?.nextSnapshot.project ?? null;
};

describe('Phase 19D shared boundary — line oracle (§79)', () => {
  it('accepts an exact reversed line as CURRENT with shared length 100', () => {
    const project = projectWith([square('A'), reverseSquare('B')]);
    const first = endOf('A', 'parcel-course:A:0');
    const second = endOf('B', 'parcel-course:B:0');
    expect(validateSharedBoundary(project, first, second).ok).toBe(true);
    const boundary: CadParcelSharedBoundary = {
      id: buildCadParcelSharedBoundaryId(first, second),
      first,
      second,
    };
    expect(deriveCadParcelSharedBoundaryStatus(project, boundary)).toBe('CURRENT');
    expect(resolveCadParcelSharedBoundaryGeometry(project, boundary)).toEqual({
      kind: 'line',
      lengthMeters: 100,
      radiusMeters: null,
    });
  });

  it('mints the same id for either orientation (deterministic, no randomness)', () => {
    const a = endOf('A', 'parcel-course:A:0');
    const b = endOf('B', 'parcel-course:B:0');
    expect(buildCadParcelSharedBoundaryId(a, b)).toBe(buildCadParcelSharedBoundaryId(b, a));
    expect(buildCadParcelSharedBoundaryId(a, b)).toBe(buildCadParcelSharedBoundaryId(a, b));
  });

  it('blocks a same-direction line (not an opposite traversal)', () => {
    const project = projectWith([square('A'), triangle('C')]);
    const validation = validateSharedBoundary(
      project,
      endOf('A', 'parcel-course:A:0'),
      endOf('C', 'parcel-course:C:0'),
    );
    expect(validation.ok).toBe(false);
    expect(validation.issues.map((entry) => entry.code)).toContain('ENDPOINT_MISMATCH');
  });
});

describe('Phase 19D shared boundary — arc oracle (§80)', () => {
  it.each([
    ['minor', 0.5],
    ['major', 2],
  ])('accepts reversed %s arc traversals with equal radius/length', (_label, bulge) => {
    const project = projectWith([arcParcel('A', bulge, true), arcParcel('B', -bulge, false)]);
    const first = endOf('A', 'parcel-course:A:0');
    const second = endOf('B', 'parcel-course:B:0');
    expect(validateSharedBoundary(project, first, second).ok).toBe(true);
    const boundary: CadParcelSharedBoundary = {
      id: buildCadParcelSharedBoundaryId(first, second),
      first,
      second,
    };
    expect(deriveCadParcelSharedBoundaryStatus(project, boundary)).toBe('CURRENT');
    const geometry = resolveCadParcelSharedBoundaryGeometry(project, boundary);
    expect(geometry?.kind).toBe('arc');
    expect(geometry?.radiusMeters).toBeGreaterThan(0);
    expect(geometry?.lengthMeters).toBeGreaterThan(0);
    // The two independently-derived courses agree exactly on radius + length.
    const reverseGeometry = resolveCadParcelSharedBoundaryGeometry(project, {
      id: 'x',
      first: second,
      second: first,
    });
    expect(reverseGeometry?.radiusMeters).toBe(geometry?.radiusMeters);
    expect(reverseGeometry?.lengthMeters).toBe(geometry?.lengthMeters);
  });
});

describe('Phase 19D shared boundary — wrong-arc oracle (§81)', () => {
  it('blocks minor-vs-major on the same endpoints', () => {
    const project = projectWith([arcParcel('A', 0.5, true), arcParcel('M', 2, false)]);
    const validation = validateSharedBoundary(
      project,
      endOf('A', 'parcel-course:A:0'),
      endOf('M', 'parcel-course:M:0'),
    );
    expect(validation.ok).toBe(false);
    // Same circle (the b / 1/b dual) but opposite sweep magnitude: the
    // major/minor distinction must fail closed.
    expect(
      validation.issues.map((entry) => entry.code).some((code) =>
        ['CIRCLE_MISMATCH', 'SWEEP_MISMATCH'].includes(code),
      ),
    ).toBe(true);
  });

  it('blocks a different-radius arc (different sweep magnitude)', () => {
    const project = projectWith([arcParcel('A', 0.5, true), arcParcel('B', -0.9, false)]);
    const validation = validateSharedBoundary(
      project,
      endOf('A', 'parcel-course:A:0'),
      endOf('B', 'parcel-course:B:0'),
    );
    expect(validation.ok).toBe(false);
    expect(validation.issues.length).toBeGreaterThan(0);
  });

  it('blocks a line-vs-arc pair on the same endpoints', () => {
    const project = projectWith([arcParcel('A', 0.5, true), reverseSquare('B')]);
    const validation = validateSharedBoundary(
      project,
      endOf('A', 'parcel-course:A:0'),
      endOf('B', 'parcel-course:B:0'),
    );
    expect(validation.ok).toBe(false);
    expect(validation.issues.map((entry) => entry.code)).toContain('KIND_MISMATCH');
  });

  it('reports GEOMETRY_MISMATCH when a linked course is re-shaped', () => {
    const project = projectWith([square('A'), triangle('C')]);
    const boundary: CadParcelSharedBoundary = {
      id: 'manual',
      first: endOf('A', 'parcel-course:A:0'),
      second: endOf('C', 'parcel-course:C:0'),
    };
    expect(deriveCadParcelSharedBoundaryStatus(project, boundary)).toBe('GEOMETRY_MISMATCH');
  });

  it('reports BROKEN_REFERENCE for a missing parcel or course', () => {
    const project = projectWith([square('A')]);
    expect(
      deriveCadParcelSharedBoundaryStatus(project, {
        id: 'manual',
        first: endOf('A', 'parcel-course:A:0'),
        second: endOf('GONE', 'parcel-course:GONE:0'),
      }),
    ).toBe('BROKEN_REFERENCE');
    expect(
      deriveCadParcelSharedBoundaryStatus(project, {
        id: 'manual',
        first: endOf('A', 'parcel-course:A:0'),
        second: endOf('A', 'parcel-course:A:1'),
      }),
    ).toBe('BROKEN_REFERENCE');
  });
});

describe('Phase 19D shared boundary — duplicate + non-manifold guards', () => {
  it('blocks a duplicate link and a second link touching a claimed course', () => {
    const project = projectWith([square('A'), reverseSquare('B'), triangle('C')]);
    const first = endOf('A', 'parcel-course:A:0');
    const second = endOf('B', 'parcel-course:B:0');
    const linked = link(project, first, second);
    expect(linked).not.toBeNull();
    expect(linked?.sharedParcelBoundaries).toHaveLength(1);

    const duplicate = validateSharedBoundary(linked!, first, second);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.issues.map((entry) => entry.code)).toContain('DUPLICATE_LINK');

    // B.c0 already owns a boundary; a 3-parcel chain must block.
    const nonManifold = validateSharedBoundary(
      linked!,
      second,
      endOf('C', 'parcel-course:C:0'),
    );
    expect(nonManifold.ok).toBe(false);
    expect(nonManifold.issues.map((entry) => entry.code)).toContain('COURSE_ALREADY_LINKED');
  });

  it('rejects a same-parcel / identical-side boundary', () => {
    const project = projectWith([square('A')]);
    expect(
      validateSharedBoundary(
        project,
        endOf('A', 'parcel-course:A:0'),
        endOf('A', 'parcel-course:A:0'),
      ).ok,
    ).toBe(false);
    expect(
      validateSharedBoundary(
        project,
        endOf('A', 'parcel-course:A:0'),
        endOf('A', 'parcel-course:A:2'),
      ).ok,
    ).toBe(false);
  });
});

describe('Phase 19D shared boundary — link/unlink commands', () => {
  it('PARCELLINK changes only the relationship collection (one transaction)', () => {
    const project = projectWith([square('A'), reverseSquare('B')]);
    const result = parcelLinkCommand.execute(snapshot(project), {
      key: 'PARCELLINK',
      first: endOf('A', 'parcel-course:A:0'),
      second: endOf('B', 'parcel-course:B:0'),
    });
    expect(result).not.toBeNull();
    expect(result!.nextSnapshot.project.entities).toEqual(project.entities);
    expect(result!.nextSnapshot.project.sharedParcelBoundaries).toHaveLength(1);
    expect(result!.addedEntityIds).toEqual([]);
    expect(result!.removedEntityIds).toEqual([]);
    expect(result!.transactionLabel).toContain('PARCELLINK');
  });

  it('PARCELUNLINK removes only the relationship, geometries unchanged', () => {
    const project = projectWith([square('A'), reverseSquare('B')]);
    const linked = link(project, endOf('A', 'parcel-course:A:0'), endOf('B', 'parcel-course:B:0'))!;
    const boundaryId = linked.sharedParcelBoundaries![0]!.id;
    const result = parcelUnlinkCommand.execute(snapshot(linked), { key: 'PARCELUNLINK', boundaryId });
    expect(result).not.toBeNull();
    expect(result!.nextSnapshot.project.sharedParcelBoundaries).toEqual([]);
    expect(result!.nextSnapshot.project.entities).toEqual(project.entities);
    // Unknown id blocks (fail closed).
    expect(parcelUnlinkCommand.execute(snapshot(linked), { key: 'PARCELUNLINK', boundaryId: 'nope' })).toBeNull();
  });

  it('rejects a non-opposite-traversal link', () => {
    const project = projectWith([square('A'), triangle('C')]);
    expect(
      parcelLinkCommand.execute(snapshot(project), {
        key: 'PARCELLINK',
        first: endOf('A', 'parcel-course:A:0'),
        second: endOf('C', 'parcel-course:C:0'),
      }),
    ).toBeNull();
  });
});

describe('Phase 19D shared boundary — load sanitizer', () => {
  it('drops malformed, unknown, same-parcel and non-manifold entries with diagnostics', () => {
    const project = projectWith([square('A'), reverseSquare('B'), triangle('C')]);
    project.sharedParcelBoundaries = [
      { id: 'ok', first: endOf('A', 'parcel-course:A:0'), second: endOf('B', 'parcel-course:B:0') },
      { id: 'unknown', first: endOf('A', 'parcel-course:A:0'), second: endOf('Z', 'parcel-course:Z:0') },
      { id: 'self', first: endOf('A', 'parcel-course:A:1'), second: endOf('A', 'parcel-course:A:2') },
      { id: 'dup-side', first: endOf('C', 'parcel-course:C:0'), second: endOf('C', 'parcel-course:C:0') },
      // C.c0 is otherwise free, but the next entry reuses B.c0 (claimed by 'ok').
      { id: 'non-manifold', first: endOf('B', 'parcel-course:B:0'), second: endOf('C', 'parcel-course:C:0') },
      { notABoundary: true },
    ] as unknown as CadParcelSharedBoundary[];

    const result = sanitizeCadParcelSharedBoundaries(project);
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0]!.id).toBe('ok');
    const reasons = result.diagnostics.map((entry) => entry.reason);
    expect(reasons).toEqual(
      expect.arrayContaining(['MALFORMED', 'UNKNOWN_REFERENCE', 'SAME_PARCEL', 'DUPLICATE_SIDE', 'NON_MANIFOLD']),
    );
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.code).toBe('CAD_PARCEL_SHARED_BOUNDARY_DROPPED');
    }
  });

  it('backfills [] for legacy projects and mints a missing id deterministically', () => {
    const project = projectWith([square('A'), reverseSquare('B')]);
    expect(sanitizeCadParcelSharedBoundaries(project).boundaries).toEqual([]);

    project.sharedParcelBoundaries = [
      { id: '', first: endOf('A', 'parcel-course:A:0'), second: endOf('B', 'parcel-course:B:0') },
    ] as unknown as CadParcelSharedBoundary[];
    const result = sanitizeCadParcelSharedBoundaries(project);
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0]!.id).toBe(
      buildCadParcelSharedBoundaryId(
        endOf('A', 'parcel-course:A:0'),
        endOf('B', 'parcel-course:B:0'),
      ),
    );
  });
});

describe('Phase 19D shared boundary — WNCAD persistence', () => {
  it('round-trips refs exactly and persists nothing derived', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Shared Boundary', units: 'm' });
    const project = link(
      projectWith([arcParcel('A', 0.5, true), arcParcel('B', -0.5, false)]),
      endOf('A', 'parcel-course:A:0'),
      endOf('B', 'parcel-course:B:0'),
    )!;
    expect(project.sharedParcelBoundaries).toHaveLength(1);
    const boundary = project.sharedParcelBoundaries![0]!;
    expect(Object.keys(boundary).sort()).toEqual(['first', 'id', 'second']);

    const text = serializeCadDrawingFile({ ...drawing, project });
    expect(text.includes('lengthMeters')).toBe(false);
    expect(text.includes('radiusMeters')).toBe(false);

    const parsed = parseCadDrawingFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.sharedParcelBoundaries).toEqual(project.sharedParcelBoundaries);
    expect(deriveCadParcelSharedBoundaryStatus(parsed.drawing.project, boundary)).toBe('CURRENT');
  });

  it('opens legacy files (no collection) with [] and settled clone key order', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Legacy', units: 'm' });
    const raw = JSON.parse(serializeCadDrawingFile(drawing)) as Record<string, unknown>;
    delete (raw['project'] as Record<string, unknown>)['sharedParcelBoundaries'];
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    expect(reopened.sharedParcelBoundaries).toEqual([]);
    expect(Object.keys(cloneCadProject(reopened))).toEqual(Object.keys(reopened));
  });

  it('does not copy a relationship onto an unrelated clone (Save As isolation)', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Shared Boundary', units: 'm' });
    const text = serializeCadDrawingFile({
      ...drawing,
      project: link(
        projectWith([square('A'), reverseSquare('B')]),
        endOf('A', 'parcel-course:A:0'),
        endOf('B', 'parcel-course:B:0'),
      )!,
    });
    const first = parseCadDrawingFile(text);
    const second = parseCadDrawingFile(text);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    first.drawing.project.sharedParcelBoundaries![0]!.first.parcelId = 'MUTATED';
    expect(second.drawing.project.sharedParcelBoundaries![0]!.first.parcelId).toBe('A');
  });
});
