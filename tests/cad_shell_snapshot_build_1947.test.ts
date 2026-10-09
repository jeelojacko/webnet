/**
 * STRUCT-194.7 — pure contract for the extracted shell-snapshot builder.
 *
 * The deterministic body of the Phase 18B `shellSnapshot` memo now lives in
 * `buildSurveyCadShellSnapshot(context)`. This suite pins the twelve
 * sub-builder CALL ORDER (the former object-literal property order), the
 * pass-through of source/revision inputs, and the `selectionPreview` cap.
 *
 * The builders are wrapped (record + delegate to the real implementation) so
 * the production builder path is what runs; only the call order is synthetic.
 * Fast + deterministic (no DOM), agent tier.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const builderSpy = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    record(name: string): void {
      calls.push(name);
    },
    reset(): void {
      calls.length = 0;
    },
  };
});

vi.mock('../src/cad-app/shell/cadSurveySnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadSurveySnapshot')>();
  return {
    ...actual,
    buildCadSurveySnapshot: (...args: Parameters<typeof actual.buildCadSurveySnapshot>) => {
      builderSpy.record('survey');
      return actual.buildCadSurveySnapshot(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadSurveyTableSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadSurveyTableSnapshot')>();
  return {
    ...actual,
    buildCadSurveyTableSnapshot: (...args: Parameters<typeof actual.buildCadSurveyTableSnapshot>) => {
      builderSpy.record('surveyTable');
      return actual.buildCadSurveyTableSnapshot(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadParcelSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadParcelSnapshot')>();
  return {
    ...actual,
    buildCadParcelSnapshot: (...args: Parameters<typeof actual.buildCadParcelSnapshot>) => {
      builderSpy.record('parcel');
      return actual.buildCadParcelSnapshot(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadFeatureLineSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadFeatureLineSnapshot')>();
  return {
    ...actual,
    buildCadFeatureLineSnapshot: (...args: Parameters<typeof actual.buildCadFeatureLineSnapshot>) => {
      builderSpy.record('featureLine');
      return actual.buildCadFeatureLineSnapshot(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadGradingSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadGradingSnapshot')>();
  return {
    ...actual,
    buildCadGradingSnapshot: (...args: Parameters<typeof actual.buildCadGradingSnapshot>) => {
      builderSpy.record('grading');
      return actual.buildCadGradingSnapshot(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadGradingGroupSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadGradingGroupSnapshot')>();
  return {
    ...actual,
    buildCadGradingGroupSnapshot: (...args: Parameters<typeof actual.buildCadGradingGroupSnapshot>) => {
      builderSpy.record('gradingGroups');
      return actual.buildCadGradingGroupSnapshot(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadBlockSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadBlockSnapshot')>();
  return {
    ...actual,
    buildCadBlockSnapshot: (...args: Parameters<typeof actual.buildCadBlockSnapshot>) => {
      builderSpy.record('blocks');
      return actual.buildCadBlockSnapshot(...args);
    },
  };
});

vi.mock('../src/components/surveyCad/f2fGeneratedSummary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/surveyCad/f2fGeneratedSummary')>();
  return {
    ...actual,
    buildCadF2FSnapshot: (...args: Parameters<typeof actual.buildCadF2FSnapshot>) => {
      builderSpy.record('f2f');
      return actual.buildCadF2FSnapshot(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadSurfaceSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadSurfaceSnapshot')>();
  return {
    ...actual,
    buildCadSurfaceSnapshot: (...args: Parameters<typeof actual.buildCadSurfaceSnapshot>) => {
      builderSpy.record('surface');
      return actual.buildCadSurfaceSnapshot(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadVolumeSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadVolumeSnapshot')>();
  return {
    ...actual,
    buildCadVolumeSnapshot: (...args: Parameters<typeof actual.buildCadVolumeSnapshot>) => {
      builderSpy.record('volume');
      return actual.buildCadVolumeSnapshot(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadProfileSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadProfileSnapshot')>();
  return {
    ...actual,
    buildCadProfileSnapshot: (...args: Parameters<typeof actual.buildCadProfileSnapshot>) => {
      builderSpy.record('profile');
      return actual.buildCadProfileSnapshot(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadSectionSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadSectionSnapshot')>();
  return {
    ...actual,
    buildCadSectionSnapshot: (...args: Parameters<typeof actual.buildCadSectionSnapshot>) => {
      builderSpy.record('section');
      return actual.buildCadSectionSnapshot(...args);
    },
  };
});

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { cloneFeatureCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import { STARTER_CATALOG } from '../src/engine/fieldToFinish/starterCatalog';
import type { CadSnapPreferences } from '../src/hooks/surveyCad/useSurveyCadSnapping';
import {
  buildSurveyCadShellSnapshot,
  type SurveyCadShellSnapshotContext,
} from '../src/components/surveyCad/cadWorkspaceShellSnapshot';

/** A complete snap-preference record with the requested kinds enabled. */
const snapPreferences = (enabled: Partial<CadSnapPreferences> = {}): CadSnapPreferences => ({
  'point-node': false,
  endpoint: false,
  midpoint: false,
  center: false,
  'arc-midpoint': false,
  quadrant: false,
  intersection: false,
  'apparent-intersection': false,
  extension: false,
  perpendicular: false,
  parallel: false,
  direction: false,
  tangent: false,
  nearest: false,
  ...enabled,
});

const buildContext = (overrides: Partial<SurveyCadShellSnapshotContext> = {}): SurveyCadShellSnapshotContext => {
  const drawing = createBlankCadDrawingDocument({ name: 'Snapshot 1947', units: 'm' });
  return {
    drawing: { id: 'd1', name: 'Snapshot 1947', sheets: [] },
    units: 'm',
    project: drawing.project,
    surfaceCache: null,
    catalog: { catalog: cloneFeatureCatalog(STARTER_CATALOG), status: 'READY' },
    selection: { count: 0, entityIds: [], entities: [] },
    properties: null,
    command: { activeKey: null, prompt: 'Idle', inputValue: '' },
    history: { canUndo: false, canRedo: false, historyDepth: 0, redoDepth: 0 },
    snap: { preferences: snapPreferences(), stationCount: 0 },
    dependencyStatus: 'MANUAL_ONLY',
    annotation: null,
    grading: { cache: null, selectedId: null, options: {} },
    gradingGroups: { cache: null, selectedId: null, options: {} },
    blocks: { insertPick: null },
    surface: { selectedId: null, options: {} },
    volume: { cache: null, selectedId: null, options: {} },
    analysis: null,
    profile: { cache: null, selectedId: null, viewId: null, options: {} },
    section: {
      deps: {
        sectionCache: null,
        statusOf: () => ({ status: 'UNBUILT', stale: false }),
        buildingGroupIds: new Set<string>(),
      },
      groupId: null,
      lineId: null,
      viewId: null,
    },
    availableCommands: ['LINE'],
    ...overrides,
  };
};

beforeEach(() => {
  builderSpy.reset();
});

describe('STRUCT-194.7 shell snapshot builder — call order', () => {
  it('invokes the twelve sub-builders in the exact former property order', () => {
    buildSurveyCadShellSnapshot(buildContext());
    expect(builderSpy.calls).toEqual([
      'survey',
      'surveyTable',
      'parcel',
      'featureLine',
      'grading',
      'gradingGroups',
      'blocks',
      'f2f',
      'surface',
      'volume',
      'profile',
      'section',
    ]);
  });
});

describe('STRUCT-194.7 shell snapshot builder — pass-through', () => {
  it('carries scalar + snapshot fields and the availableCommands reference', () => {
    const availableCommands = ['LINE', 'PASTE'];
    const snapshot = buildSurveyCadShellSnapshot(
      buildContext({
        command: { activeKey: 'LINE', prompt: 'Specify first point', inputValue: '@1,2' },
        history: { canUndo: true, canRedo: false, historyDepth: 3, redoDepth: 0 },
        snap: { preferences: snapPreferences({ endpoint: true }), stationCount: 7 },
        dependencyStatus: 'LINKED_CURRENT',
        availableCommands,
      }),
    );
    expect(snapshot.drawingId).toBe('d1');
    expect(snapshot.units).toBe('m');
    expect(snapshot.activeCommandKey).toBe('LINE');
    expect(snapshot.commandPrompt).toBe('Specify first point');
    expect(snapshot.commandInputValue).toBe('@1,2');
    expect(snapshot.canUndo).toBe(true);
    expect(snapshot.historyDepth).toBe(3);
    expect(snapshot.snapStatusText).toBe('SNAP: endpoint');
    expect(snapshot.stationCount).toBe(7);
    expect(snapshot.dependencyStatus).toBe('LINKED_CURRENT');
    expect(snapshot.availableCommands).toBe(availableCommands);
  });

  it('reports snap off and null analysis/annotation when absent', () => {
    const snapshot = buildSurveyCadShellSnapshot(buildContext());
    expect(snapshot.snapStatusText).toBe('OSNAP off');
    expect(snapshot.annotation).toBeNull();
    expect(snapshot.analysis).toBeNull();
    expect(snapshot.selectionPreview).toEqual([]);
  });
});
