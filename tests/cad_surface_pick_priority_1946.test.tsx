/**
 * STRUCT-194.6 — pure surface-pick dispatcher coverage
 * (`createCadSurfacePickDispatch`).
 *
 * The dispatcher is a plain factory (no React), so these tests drive it
 * directly. They pin the EXACT eight-stage short-circuit precedence, the block
 * INSERT one-shot / repeat / rejected arming, the ALWAYS-clear behaviour for
 * the analysis / volume / surface inquiries, and the elevation-vs-slope source
 * routing with real production inquiry text.
 */
import { describe, expect, it, vi } from 'vitest';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { surfaceContentRevision } from '../src/engine/cad/cadSurfaceView';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import {
  createCadSurfacePickDispatch,
  type CadSurfacePickBlockInsertState,
  type CadSurfacePickContext,
} from '../src/components/surveyCad/cadSurfacePickDispatch';

const SURFACE_ID = 's-flat';
const SURFACE_NAME = 'Flat Site';

const point = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

const makeProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Pick', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('p-1', 0, 0, 100),
      point('p-2', 20, 0, 100),
      point('p-3', 20, 20, 100),
      point('p-4', 0, 20, 100),
    ],
    surfaces: [
      {
        id: SURFACE_ID,
        name: SURFACE_NAME,
        definition: { pointSource: { kind: 'points', pointEntityIds: ['p-1', 'p-2', 'p-3', 'p-4'] } },
        cachedRevision: null,
      },
    ],
  };
};

const makeCache = (project: CadProject): ReturnType<typeof createCadSurfaceCache> => {
  const cache = createCadSurfaceCache('pick');
  const surface = project.surfaces![0]!;
  const built = buildCadSurface(project, surface);
  for (const revision of [computeCadSurfaceSourceRevision(project, surface), surfaceContentRevision(project, surface)]) {
    cache.set(SURFACE_ID, revision, {
      revision,
      points: built.points,
      triangles: built.triangles,
      stats: built.stats,
      grid: built.grid,
      adjacency: built.adjacency,
      edgeKinds: built.edgeKinds,
    });
  }
  return cache;
};

interface Stubs {
  context: CadSurfacePickContext;
  picks: Record<'pointEdit' | 'bulkSelection' | 'bulkEdit' | 'edit', ReturnType<typeof vi.fn>>;
  setters: {
    setBlockInsertPick: ReturnType<typeof vi.fn>;
    setAnalysisPickAnswer: ReturnType<typeof vi.fn>;
    setAnalysisPick: ReturnType<typeof vi.fn>;
    setVolumePickAnswer: ReturnType<typeof vi.fn>;
    setVolumePick: ReturnType<typeof vi.fn>;
    setLastSurfaceInquiry: ReturnType<typeof vi.fn>;
    setSurfacePick: ReturnType<typeof vi.fn>;
  };
  runBlockOp: ReturnType<typeof vi.fn>;
  describeAnalysisAt: ReturnType<typeof vi.fn>;
  describeVolumeDifference: ReturnType<typeof vi.fn>;
}

const blockState = (
  overrides: Partial<CadSurfacePickBlockInsertState> = {},
): CadSurfacePickBlockInsertState => ({
  definitionId: 'def-1',
  scale: 1,
  rotationDeg: 0,
  repeat: false,
  ...overrides,
});

const makeStubs = (project = makeProject(), cache = makeCache(project)): Stubs => {
  const picks = {
    pointEdit: vi.fn(),
    bulkSelection: vi.fn(),
    bulkEdit: vi.fn(),
    edit: vi.fn(),
  };
  const setters = {
    setBlockInsertPick: vi.fn(),
    setAnalysisPickAnswer: vi.fn(),
    setAnalysisPick: vi.fn(),
    setVolumePickAnswer: vi.fn(),
    setVolumePick: vi.fn(),
    setLastSurfaceInquiry: vi.fn(),
    setSurfacePick: vi.fn(),
  };
  const runBlockOp = vi.fn(() => ({ applied: true }));
  const describeAnalysisAt = vi.fn(() => 'ANALYSIS');
  const describeVolumeDifference = vi.fn(() => 'VOLUME');
  return {
    picks,
    setters,
    runBlockOp,
    describeAnalysisAt,
    describeVolumeDifference,
    context: {
      editSessions: {
        pointEdit: { session: null, handlePick: picks.pointEdit },
        bulkSelection: { session: null, handlePick: picks.bulkSelection },
        bulkEdit: { session: null, handlePick: picks.bulkEdit },
        edit: { session: null, handlePick: picks.edit },
      },
      picks: { blockInsertPick: null, analysisPick: null, volumePick: null, surfacePick: null },
      project,
      surfaceCache: cache,
      inquiries: { describeAnalysisAt, describeVolumeDifference },
      runBlockOp,
      setters,
    },
  };
};

const noSettersCalled = (stubs: Stubs): void => {
  for (const spy of Object.values(stubs.setters)) expect(spy).not.toHaveBeenCalled();
};

describe('STRUCT-194.6 pick precedence', () => {
  it('consumes the pick in each earlier session before any later stage', () => {
    const stubs = makeStubs();
    stubs.context.editSessions.pointEdit.session = { id: 'point-edit' };
    stubs.context.editSessions.bulkSelection.session = { id: 'bulk-selection' };
    stubs.context.editSessions.bulkEdit.session = { id: 'bulk-edit' };
    stubs.context.editSessions.edit.session = { id: 'edit' };
    stubs.context.picks.blockInsertPick = blockState();
    stubs.context.picks.analysisPick = { analysisId: 'a-1' };
    stubs.context.picks.volumePick = { volumeId: 'v-1' };
    stubs.context.picks.surfacePick = { surfaceId: SURFACE_ID, mode: 'elevation' };

    createCadSurfacePickDispatch(stubs.context)({ x: 1, y: 2 });

    expect(stubs.picks.pointEdit).toHaveBeenCalledWith({ x: 1, y: 2 });
    expect(stubs.picks.bulkSelection).not.toHaveBeenCalled();
    expect(stubs.picks.bulkEdit).not.toHaveBeenCalled();
    expect(stubs.picks.edit).not.toHaveBeenCalled();
    expect(stubs.runBlockOp).not.toHaveBeenCalled();
    expect(stubs.describeAnalysisAt).not.toHaveBeenCalled();
    expect(stubs.describeVolumeDifference).not.toHaveBeenCalled();
    noSettersCalled(stubs);
  });

  it('falls through the four sessions in order without calling an inactive one', () => {
    const stubs = makeStubs();
    stubs.context.picks.blockInsertPick = blockState();
    stubs.context.editSessions.bulkSelection.session = { id: 'bulk-selection' };
    createCadSurfacePickDispatch(stubs.context)({ x: 3, y: 4 });
    expect(stubs.picks.bulkSelection).toHaveBeenCalledWith({ x: 3, y: 4 });
    expect(stubs.picks.bulkEdit).not.toHaveBeenCalled();
    expect(stubs.runBlockOp).not.toHaveBeenCalled();
  });

  it('gives a block insert pick priority over every inquiry mode', () => {
    const stubs = makeStubs();
    stubs.context.picks.blockInsertPick = blockState();
    stubs.context.picks.analysisPick = { analysisId: 'a-1' };
    stubs.context.picks.volumePick = { volumeId: 'v-1' };
    stubs.context.picks.surfacePick = { surfaceId: SURFACE_ID, mode: 'elevation' };
    createCadSurfacePickDispatch(stubs.context)({ x: 1, y: 2 });
    expect(stubs.runBlockOp).toHaveBeenCalledTimes(1);
    expect(stubs.describeAnalysisAt).not.toHaveBeenCalled();
    expect(stubs.describeVolumeDifference).not.toHaveBeenCalled();
    expect(stubs.setters.setSurfacePick).not.toHaveBeenCalled();
  });

  it('gives analysis priority over volume and surface, leaving later picks armed', () => {
    const stubs = makeStubs();
    stubs.context.picks.analysisPick = { analysisId: 'a-1' };
    stubs.context.picks.volumePick = { volumeId: 'v-1' };
    stubs.context.picks.surfacePick = { surfaceId: SURFACE_ID, mode: 'elevation' };
    createCadSurfacePickDispatch(stubs.context)({ x: 5, y: 5 });
    expect(stubs.describeAnalysisAt).toHaveBeenCalledWith('a-1', 5, 5);
    expect(stubs.setters.setAnalysisPickAnswer).toHaveBeenCalledWith({ analysisId: 'a-1', text: 'ANALYSIS' });
    expect(stubs.setters.setAnalysisPick).toHaveBeenCalledWith(null);
    expect(stubs.describeVolumeDifference).not.toHaveBeenCalled();
    expect(stubs.setters.setVolumePick).not.toHaveBeenCalled();
    expect(stubs.setters.setSurfacePick).not.toHaveBeenCalled();
  });
});

describe('STRUCT-194.6 block insert pick', () => {
  it('disarms after a single applied non-repeat insert', () => {
    const stubs = makeStubs();
    stubs.context.picks.blockInsertPick = blockState({ repeat: false });
    createCadSurfacePickDispatch(stubs.context)({ x: 1, y: 2 });
    expect(stubs.runBlockOp).toHaveBeenCalledWith({
      kind: 'insert',
      definitionId: 'def-1',
      x: 1,
      y: 2,
      rotationDeg: 0,
      scale: 1,
    });
    expect(stubs.setters.setBlockInsertPick).toHaveBeenCalledWith(null);
  });

  it('stays armed when the insert is a repeat', () => {
    const stubs = makeStubs();
    stubs.context.picks.blockInsertPick = blockState({ repeat: true });
    createCadSurfacePickDispatch(stubs.context)({ x: 1, y: 2 });
    expect(stubs.runBlockOp).toHaveBeenCalledTimes(1);
    expect(stubs.setters.setBlockInsertPick).not.toHaveBeenCalled();
  });

  it('stays armed when the insert is rejected', () => {
    const stubs = makeStubs();
    stubs.runBlockOp.mockReturnValue({ applied: false, reason: 'locked' });
    stubs.context.picks.blockInsertPick = blockState({ repeat: false });
    createCadSurfacePickDispatch(stubs.context)({ x: 1, y: 2 });
    expect(stubs.setters.setBlockInsertPick).not.toHaveBeenCalled();
  });
});

describe('STRUCT-194.6 inquiry pick clearing', () => {
  it('clears the analysis pick even when the answer is null', () => {
    const stubs = makeStubs();
    stubs.describeAnalysisAt.mockReturnValue(null);
    stubs.context.picks.analysisPick = { analysisId: 'a-1' };
    createCadSurfacePickDispatch(stubs.context)({ x: 1, y: 2 });
    expect(stubs.setters.setAnalysisPickAnswer).not.toHaveBeenCalled();
    expect(stubs.setters.setAnalysisPick).toHaveBeenCalledWith(null);
  });

  it('clears the volume pick and stores the answer when non-null', () => {
    const stubs = makeStubs();
    stubs.context.picks.volumePick = { volumeId: 'v-1' };
    createCadSurfacePickDispatch(stubs.context)({ x: 6, y: 7 });
    expect(stubs.describeVolumeDifference).toHaveBeenCalledWith('v-1', 6, 7);
    expect(stubs.setters.setVolumePickAnswer).toHaveBeenCalledWith({ volumeId: 'v-1', text: 'VOLUME' });
    expect(stubs.setters.setVolumePick).toHaveBeenCalledWith(null);
  });

  it('clears the volume pick without an answer when null', () => {
    const stubs = makeStubs();
    stubs.describeVolumeDifference.mockReturnValue(null);
    stubs.context.picks.volumePick = { volumeId: 'v-1' };
    createCadSurfacePickDispatch(stubs.context)({ x: 6, y: 7 });
    expect(stubs.setters.setVolumePickAnswer).not.toHaveBeenCalled();
    expect(stubs.setters.setVolumePick).toHaveBeenCalledWith(null);
  });

  it('is a no-op with an idle pointer and no armed mode', () => {
    const stubs = makeStubs();
    createCadSurfacePickDispatch(stubs.context)({ x: 9, y: 9 });
    expect(stubs.runBlockOp).not.toHaveBeenCalled();
    expect(stubs.describeAnalysisAt).not.toHaveBeenCalled();
    expect(stubs.describeVolumeDifference).not.toHaveBeenCalled();
    noSettersCalled(stubs);
  });
});

describe('STRUCT-194.6 surface elevation vs slope pick', () => {
  it('queries elevation and stores the labelled inquiry with E/N', () => {
    const stubs = makeStubs();
    stubs.context.picks.surfacePick = { surfaceId: SURFACE_ID, mode: 'elevation' };
    createCadSurfacePickDispatch(stubs.context)({ x: 5, y: 5 });
    const inquiry = stubs.setters.setLastSurfaceInquiry.mock.calls[0]![0] as {
      surfaceId: string;
      surfaceName: string;
      x: number;
      y: number;
      text: string;
    };
    expect(inquiry.surfaceId).toBe(SURFACE_ID);
    expect(inquiry.surfaceName).toBe(SURFACE_NAME);
    expect(inquiry.x).toBe(5);
    expect(inquiry.y).toBe(5);
    expect(inquiry.text).toContain('elevation 100.000');
    expect(stubs.setters.setSurfacePick).toHaveBeenCalledWith(null);
  });

  it('queries slope when the mode is slope', () => {
    const stubs = makeStubs();
    stubs.context.picks.surfacePick = { surfaceId: SURFACE_ID, mode: 'slope' };
    createCadSurfacePickDispatch(stubs.context)({ x: 5, y: 5 });
    const inquiry = stubs.setters.setLastSurfaceInquiry.mock.calls[0]![0] as { text: string };
    expect(inquiry.text).toContain('slope 0.0%');
    expect(stubs.setters.setSurfacePick).toHaveBeenCalledWith(null);
  });

  it('does not store an inquiry when the surface does not resolve, but clears the pick', () => {
    const stubs = makeStubs();
    stubs.context.picks.surfacePick = { surfaceId: 'missing', mode: 'elevation' };
    createCadSurfacePickDispatch(stubs.context)({ x: 5, y: 5 });
    expect(stubs.setters.setLastSurfaceInquiry).not.toHaveBeenCalled();
    expect(stubs.setters.setSurfacePick).toHaveBeenCalledWith(null);
  });
});
