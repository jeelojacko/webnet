/** @vitest-environment jsdom */
/**
 * PERF-184 — CAD shell-snapshot memo dependency proof.
 *
 * Root cause under test: the workspace `shellSnapshot` useMemo listed the
 * whole `cadWorkspace` result object as a dependency. That object is rebuilt
 * with a fresh identity on every root render, so every unrelated render
 * re-ran all twelve snapshot builders and re-invoked `shellLink.publish`,
 * even though the closure only reads seven stable fields from it.
 *
 * The counters below are deterministic call counts (never wall-clock). Every
 * builder module is wrapped so the production snapshot path is what is
 * measured; `shellLink.publish` is wrapped on a real link.
 */
import React, { useImperativeHandle, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Deterministic builder-invocation counters. Hoisted so the vi.mock factories
// (also hoisted above imports) can record into the same object.
// ---------------------------------------------------------------------------
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
    total(): number {
      return calls.length;
    },
    counts(): Record<string, number> {
      const map: Record<string, number> = {};
      for (const name of calls) map[name] = (map[name] ?? 0) + 1;
      return map;
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
  const actual =
    await importOriginal<typeof import('../src/cad-app/shell/cadSurveyTableSnapshot')>();
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
  const actual =
    await importOriginal<typeof import('../src/cad-app/shell/cadFeatureLineSnapshot')>();
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
  const actual =
    await importOriginal<typeof import('../src/cad-app/shell/cadGradingGroupSnapshot')>();
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
  const actual =
    await importOriginal<typeof import('../src/components/surveyCad/f2fGeneratedSummary')>();
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

import type {
  CadProject,
  CadSurveyPointEntity,
  SurveyCadPersistedState,
} from '../src/engine/cad/cadTypes';
import type { ParseOptions } from '../src/types';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import {
  appendCadProjectEntities,
  buildCadProjectSignature,
} from '../src/engine/cad/cadProjectState';
import { createCadShellLink, type CadShellLink } from '../src/cad-app/shell/cadShellLink';
import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
].join('\n');

const PARSE_OPTIONS: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

const INSTRUMENT_LIBRARY = {};
const NOOP_PERSIST: React.Dispatch<React.SetStateAction<SurveyCadPersistedState | null>> = () => {};

const POINT_COUNT = 1200;

const surveyPoint = (index: number, layerId: string): CadSurveyPointEntity => ({
  id: `sp:dense:${index}`,
  type: 'survey-point',
  layerId,
  visible: true,
  locked: false,
  stationId: `P${index}`,
  x: index * 0.5,
  y: Math.sin(index / 7) * 20,
  z: (index % 5) * 0.25,
  pointClass: index % 10 === 0 ? 'control' : 'free',
  source: 'parsed-input',
});

/**
 * Dense survey + one point-source surface so every snapshot builder receives
 * real derived data (not empty structures).
 */
const buildDensePersistedState = (pointCount: number): SurveyCadPersistedState => {
  const base = buildSurveyCadSpikeProject({
    input: INPUT,
    instrumentLibrary: {},
    parseOptions: PARSE_OPTIONS,
    units: 'm',
    result: null,
  });
  const layerId = base.layers[0]?.id ?? 'points';
  const points: CadSurveyPointEntity[] = [];
  for (let index = 0; index < pointCount; index += 1) points.push(surveyPoint(index, layerId));
  const project: CadProject = {
    ...appendCadProjectEntities(base, points),
    surfaces: [
      {
        id: 'surf:dense',
        name: 'Dense Site',
        definition: {
          pointSource: { kind: 'points', pointEntityIds: ['sp:dense:0', 'sp:dense:1', 'sp:dense:2'] },
        },
        cachedRevision: null,
      },
    ],
  };
  return {
    version: 1,
    sourceSignature: buildCadProjectSignature(base),
    project,
  };
};

const buildSwapPersistedState = (): SurveyCadPersistedState => {
  // A genuinely different drawing: different source input, project id, and name
  // so both the migrated drawing id and the entity set differ from the dense one.
  const base = buildSurveyCadSpikeProject({
    input: 'C A 0 0 0 ! !',
    instrumentLibrary: {},
    parseOptions: PARSE_OPTIONS,
    units: 'm',
    result: null,
  });
  const project: CadProject = { ...base, id: `${base.id}:swapped`, name: 'Swapped Drawing' };
  return {
    version: 1,
    sourceSignature: buildCadProjectSignature(project),
    project,
  };
};

interface HarnessApi {
  bump: () => void;
  setPersisted: (_next: SurveyCadPersistedState) => void;
  tick: () => number;
}

const Harness: React.FC<{
  link: CadShellLink;
  initial: SurveyCadPersistedState;
  apiRef: { current: HarnessApi | null };
}> = ({ link, initial, apiRef }) => {
  const [persisted, setPersisted] = useState(initial);
  const [tick, setTick] = useState(0);
  // Stable-per-render callbacks exposed through a ref handle instead of
  // mutating a prop/hook-arg object during render.
  const api: HarnessApi = {
    bump: () => setTick((value) => value + 1),
    setPersisted: (next) => setPersisted(next),
    tick: () => tick,
  };
  useImperativeHandle(apiRef, () => api);
  return (
    <div>
      <span data-tick>{tick}</span>
      <SurveyCadWorkspace
        input={INPUT}
        instrumentLibrary={INSTRUMENT_LIBRARY}
        parseOptions={PARSE_OPTIONS}
        units="m"
        result={null}
        persistedState={persisted}
        onPersistedStateChange={NOOP_PERSIST}
        shellLink={link}
        shellChrome
      />
    </div>
  );
};

interface Mounted {
  container: HTMLElement;
  root: Root;
  link: CadShellLink;
  publishSpy: ReturnType<typeof vi.fn>;
  api: HarnessApi;
  snapshot: () => ReturnType<CadShellLink['getSnapshot']>;
}

const mount = async (
  initial: SurveyCadPersistedState,
): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const link = createCadShellLink();
  const publishSpy = vi.fn(link.publish);
  link.publish = publishSpy;
  const apiRef: { current: HarnessApi | null } = { current: null };
  await act(async () => {
    root.render(<Harness link={link} initial={initial} apiRef={apiRef} />);
  });
  // Flush microtask-only effects (worker/transport is unavailable in jsdom).
  await act(async () => {
    await Promise.resolve();
  });
  return {
    container,
    root,
    link,
    publishSpy,
    // Delegating wrapper keeps a stable api identity while dispatching to the
    // latest handle installed by Harness each render.
    api: {
      bump: () => apiRef.current!.bump(),
      setPersisted: (next) => apiRef.current!.setPersisted(next),
      tick: () => apiRef.current!.tick(),
    },
    snapshot: () => link.getSnapshot(),
  };
};

const builderDelta = (before: number): number => builderSpy.total() - before;

beforeEach(() => {
  builderSpy.reset();
});

describe('PERF-184 shell snapshot memo dependency contract', () => {
  it('runs each of the twelve builders exactly once per genuine snapshot publish', async () => {
    const view = await mount(buildDensePersistedState(POINT_COUNT));
    expect(builderSpy.total()).toBe(12);
    expect(Object.keys(builderSpy.counts()).sort()).toEqual([
      'blocks',
      'f2f',
      'featureLine',
      'grading',
      'gradingGroups',
      'parcel',
      'profile',
      'section',
      'surface',
      'survey',
      'surveyTable',
      'volume',
    ]);
    for (const count of Object.values(builderSpy.counts())) expect(count).toBe(1);
    expect(view.publishSpy).toHaveBeenCalledTimes(1);
    expect(view.snapshot()?.survey?.pointCount).toBeGreaterThanOrEqual(POINT_COUNT);
    view.root.unmount();
  });

  it('does zero builder work and zero publishes on unrelated root re-renders', async () => {
    const view = await mount(buildDensePersistedState(POINT_COUNT));
    const mountBuilders = builderSpy.total();
    const mountPublishes = view.publishSpy.mock.calls.length;
    const snapshotBefore = view.snapshot();
    expect(mountBuilders).toBe(12);
    expect(mountPublishes).toBe(1);

    // (a) An unrelated parent render (fresh root render, identical props).
    await act(async () => {
      view.api.bump();
    });
    expect(view.api.tick()).toBe(1);
    expect(builderDelta(mountBuilders)).toBe(0);
    expect(view.publishSpy.mock.calls.length).toBe(mountPublishes);

    // (b) An unrelated internal root state change (drafting panel open).
    await act(async () => {
      view.link.actions!.toggleDraftingPanel();
    });
    expect(builderDelta(mountBuilders)).toBe(0);
    expect(view.publishSpy.mock.calls.length).toBe(mountPublishes);

    // (c) A further unrelated parent render.
    await act(async () => {
      view.api.bump();
    });
    expect(builderDelta(mountBuilders)).toBe(0);
    expect(view.publishSpy.mock.calls.length).toBe(mountPublishes);

    // Snapshot identity is stable end-to-end: the memo never recomputed.
    expect(view.snapshot()).toBe(snapshotBefore);
    view.root.unmount();
  });

  it.each([
    ['selection', (link: CadShellLink) => link.actions!.selectEntities(['sp:dense:5'])],
    ['snap toggle', (link: CadShellLink) => link.actions!.setSnapPreference('endpoint', false)],
    ['command start', (link: CadShellLink) => link.actions!.startCommand('LINE')],
  ])('regenerates the twelve builders and publishes on a genuine %s change', async (_name, change) => {
    const view = await mount(buildDensePersistedState(POINT_COUNT));
    const before = builderSpy.total();
    const publishes = view.publishSpy.mock.calls.length;
    await act(async () => {
      change(view.link);
    });
    // Every builder reruns (all twelve distinct names) and at least one publish fires.
    expect(builderDelta(before)).toBeGreaterThanOrEqual(12);
    expect(new Set(builderSpy.calls.slice(before)).size).toBe(12);
    expect(view.publishSpy.mock.calls.length).toBeGreaterThanOrEqual(publishes + 1);
    view.root.unmount();
  });

  it('publishes accurate stale-free values for each genuine snapshot field', async () => {
    const view = await mount(buildDensePersistedState(POINT_COUNT));
    const seen = () => view.publishSpy.mock.calls.at(-1)?.[0];

    // Selection: ids + count + preview.
    await act(async () => {
      view.link.actions!.selectEntities(['sp:dense:5']);
    });
    expect(view.snapshot()?.selectedEntityIds).toEqual(['sp:dense:5']);
    expect(view.snapshot()?.selectionCount).toBe(1);
    expect(seen()?.selectedEntityIds).toEqual(['sp:dense:5']);

    // Snap toggle: status text reflects the disabled endpoint preference.
    const snapBefore = view.snapshot()?.snapStatusText;
    await act(async () => {
      view.link.actions!.setSnapPreference('endpoint', false);
    });
    expect(view.snapshot()?.snapStatusText).not.toBe(snapBefore);
    expect(view.snapshot()?.snapPreferences.endpoint).toBe(false);
    expect(seen()?.snapStatusText).toBe(view.snapshot()?.snapStatusText);

    // Command text: active key + live input value.
    await act(async () => {
      view.link.actions!.startCommand('LINE');
    });
    await act(async () => {
      view.link.actions!.setSessionInputValue?.('@10,20');
    });
    expect(view.snapshot()?.activeCommandKey).toBe('LINE');
    expect(view.snapshot()?.commandInputValue).toBe('@10,20');
    expect(seen()?.commandInputValue).toBe('@10,20');
    expect(seen()?.activeCommandKey).toBe('LINE');
  });

  it('publishes undo/redo depth transitions and swaps drawings accurately', async () => {
    const view = await mount(buildDensePersistedState(POINT_COUNT));
    const layerId = view.snapshot()?.layers[0]?.id;
    expect(layerId).toBeTruthy();

    // A real history transaction (layer set-current) makes undo available.
    const publishesBeforeCommand = view.publishSpy.mock.calls.length;
    await act(async () => {
      expect(view.link.actions!.runLayerCommand({ key: 'LAYER_SET_CURRENT', layerId: layerId! })).toBe(true);
    });
    expect(builderSpy.total()).toBeGreaterThan(0);
    expect(view.publishSpy.mock.calls.length).toBe(publishesBeforeCommand + 1);
    expect(view.snapshot()?.canUndo).toBe(true);
    expect(view.snapshot()?.historyDepth).toBe(1);

    await act(async () => {
      view.link.actions!.undo();
    });
    expect(view.snapshot()?.canUndo).toBe(false);
    expect(view.snapshot()?.historyDepth).toBe(0);

    await act(async () => {
      view.link.actions!.redo();
    });
    expect(view.snapshot()?.canUndo).toBe(true);
    expect(view.snapshot()?.historyDepth).toBe(1);

    // Drawing switch: a new persisted document must be published.
    const drawingIdBefore = view.snapshot()?.drawingId;
    await act(async () => {
      view.api.setPersisted(buildSwapPersistedState());
    });
    expect(view.snapshot()?.drawingId).not.toBe(drawingIdBefore);
    expect(view.snapshot()?.entityCount).not.toBe(POINT_COUNT);
    view.root.unmount();
  });

  it('regenerates and republishes when a surface build changes derived status (CURRENT)', async () => {
    const view = await mount(buildDensePersistedState(6));
    const before = builderSpy.total();
    const publishes = view.publishSpy.mock.calls.length;
    // jsdom has no Worker, so the service takes its synchronous fallback and
    // commits the built revision, bumping the snapshot input version.
    await act(async () => {
      view.link.actions!.rebuildSurface('surf:dense');
    });
    expect(builderDelta(before)).toBeGreaterThan(0);
    expect(new Set(builderSpy.calls.slice(before)).size).toBe(12);
    expect(view.publishSpy.mock.calls.length).toBeGreaterThan(publishes);
    const row = view.snapshot()?.surface?.surfaces.find((entry) => entry.id === 'surf:dense');
    expect(row?.status).toBe('CURRENT');
    expect(row?.diagnostic).toBeNull();
    view.root.unmount();
  });

  it('publishes FAILED surface evidence when the sync fallback refuses an oversized surface', async () => {
    const view = await mount(buildDensePersistedState(POINT_COUNT));
    const before = builderSpy.total();
    const publishes = view.publishSpy.mock.calls.length;
    await act(async () => {
      view.link.actions!.rebuildSurface('surf:dense');
    });
    // The generated status change still flows through the memo + publish path.
    expect(builderDelta(before)).toBeGreaterThan(0);
    expect(view.publishSpy.mock.calls.length).toBeGreaterThan(publishes);
    const row = view.snapshot()?.surface?.surfaces.find((entry) => entry.id === 'surf:dense');
    expect(row?.status).toBe('FAILED');
    expect(row?.diagnostic).toEqual(expect.stringContaining('sync fallback limit'));
    view.root.unmount();
  });
});
