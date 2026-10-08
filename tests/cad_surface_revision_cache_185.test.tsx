/** @vitest-environment jsdom */
/**
 * PERF-185.1 — surface source-revision reuse + contour auto-derive effect.
 *
 * Root cause under test:
 *  1. the contour auto-derive `useEffect` in `SurveyCadWorkspace` had NO
 *     dependency array, so every root render re-ran the whole sweep, calling
 *     `computeCadSurfaceSourceRevision` + `backfillCadSurfaceStyles` once per
 *     surface (and re-requesting contour derivation whenever the TIN was
 *     CURRENT and no set was cached);
 *  2. each UI read path — auto effect, `getContours`, the display layer and
 *     the shell snapshot — recomputed the surface source revision
 *     independently, even though the project object is immutable per history
 *     transaction.
 *
 * The counters below are deterministic call counts (never wall-clock). Every
 * seam is wrapped so the production path is measured:
 *  - `computeCadSurfaceSourceRevision` (canonical engine truth),
 *  - `backfillCadSurfaceStyles` (per-surface style clone),
 *  - `SurfaceContourService.requestContours` (auto-derive requests),
 *  - `buildCadDisplayScene` / `buildSurfaceDisplayLayers`,
 *  - `buildCadSurfaceSnapshot`.
 */
import React, { useImperativeHandle, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface CounterSnapshot {
  compute: number;
  backfill: number;
  request: number;
  displayScene: number;
  displayLayers: number;
  snapshot: number;
  revisions: string[];
}

const counters = vi.hoisted(() => {
  const state = {
    compute: 0,
    backfill: 0,
    request: 0,
    displayScene: 0,
    displayLayers: 0,
    snapshot: 0,
    revisions: [] as string[],
  };
  return {
    state,
    reset(): void {
      state.compute = 0;
      state.backfill = 0;
      state.request = 0;
      state.displayScene = 0;
      state.displayLayers = 0;
      state.snapshot = 0;
      state.revisions.length = 0;
    },
    snap(): CounterSnapshot {
      return { ...state, revisions: [...state.revisions] };
    },
  };
});

vi.mock('../src/engine/cad/cadSurfaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadSurfaces')>();
  return {
    ...actual,
    computeCadSurfaceSourceRevision: (
      ...args: Parameters<typeof actual.computeCadSurfaceSourceRevision>
    ): string => {
      counters.state.compute += 1;
      const revision = actual.computeCadSurfaceSourceRevision(...args);
      counters.state.revisions.push(revision);
      return revision;
    },
  };
});

vi.mock('../src/engine/cad/cadSurfaceStyles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadSurfaceStyles')>();
  return {
    ...actual,
    backfillCadSurfaceStyles: (
      ...args: Parameters<typeof actual.backfillCadSurfaceStyles>
    ): ReturnType<typeof actual.backfillCadSurfaceStyles> => {
      counters.state.backfill += 1;
      return actual.backfillCadSurfaceStyles(...args);
    },
  };
});

vi.mock('../src/engine/cad/cadRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadRenderer')>();
  return {
    ...actual,
    buildCadDisplayScene: (...args: Parameters<typeof actual.buildCadDisplayScene>) => {
      counters.state.displayScene += 1;
      return actual.buildCadDisplayScene(...args);
    },
  };
});

vi.mock('../src/engine/cad/cadSurfaceView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadSurfaceView')>();
  return {
    ...actual,
    buildSurfaceDisplayLayers: (...args: Parameters<typeof actual.buildSurfaceDisplayLayers>) => {
      counters.state.displayLayers += 1;
      return actual.buildSurfaceDisplayLayers(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadSurfaceSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadSurfaceSnapshot')>();
  return {
    ...actual,
    buildCadSurfaceSnapshot: (...args: Parameters<typeof actual.buildCadSurfaceSnapshot>) => {
      counters.state.snapshot += 1;
      return actual.buildCadSurfaceSnapshot(...args);
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
import { SurfaceContourService } from '../src/workers/surfaceContourService';
import { SURFACE_STYLE_CONTOURS_ID } from '../src/engine/cad/cadSurfaceStyles';
import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Test-only request counter: stub the derivation request so the jsdom (no
// `Worker`) service never enters its real transport/diagnostic path. The
// count is what the auto-derive contract cares about; the real service gate
// is covered by tests/cad_surface_contour_worker.test.ts.
vi.spyOn(SurfaceContourService.prototype, 'requestContours').mockImplementation(() => {
  counters.state.request += 1;
  return 'stub';
});

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

const SURFACE_ID = 'surf:contours';

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

const buildFixture = (totalPoints: number, surfacePoints: number): SurveyCadPersistedState => {
  const base = buildSurveyCadSpikeProject({
    input: INPUT,
    instrumentLibrary: {},
    parseOptions: PARSE_OPTIONS,
    units: 'm',
    result: null,
  });
  const layerId = base.layers[0]?.id ?? 'points';
  // The spike project already carries a few survey points; keep the *total*
  // at the requested count so the sync-fallback point budget is respected.
  const baseSurveyCount = base.entities.filter((entity) => entity.type === 'survey-point').length;
  const generated = Math.max(0, totalPoints - baseSurveyCount);
  const points: CadSurveyPointEntity[] = [];
  for (let index = 0; index < generated; index += 1) points.push(surveyPoint(index, layerId));
  const entityIds = Array.from(
    { length: Math.min(surfacePoints, generated) },
    (_, index) => `sp:dense:${index}`,
  );
  const project: CadProject = {
    ...appendCadProjectEntities(base, points),
    surfaces: [
      {
        id: SURFACE_ID,
        name: 'Contour Site',
        styleId: SURFACE_STYLE_CONTOURS_ID,
        definition: { pointSource: { kind: 'points', pointEntityIds: entityIds } },
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

interface HarnessApi {
  bump: () => void;
  tick: () => number;
}

const Harness: React.FC<{
  link: CadShellLink;
  initial: SurveyCadPersistedState;
  apiRef: { current: HarnessApi | null };
  strict?: boolean;
}> = ({ link, initial, apiRef, strict }) => {
  const [persisted] = useState(initial);
  const [tick, setTick] = useState(0);
  const api: HarnessApi = { bump: () => setTick((value) => value + 1), tick: () => tick };
  useImperativeHandle(apiRef, () => api);
  const inner = (
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
  return strict ? <React.StrictMode>{inner}</React.StrictMode> : inner;
};

interface Mounted {
  container: HTMLElement;
  root: Root;
  link: CadShellLink;
  api: HarnessApi;
  snapshot: () => ReturnType<CadShellLink['getSnapshot']>;
}

const mount = async (persisted: SurveyCadPersistedState, strict = false): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const link = createCadShellLink();
  const apiRef: { current: HarnessApi | null } = { current: null };
  await act(async () => {
    root.render(<Harness link={link} initial={persisted} apiRef={apiRef} strict={strict} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return {
    container,
    root,
    link,
    api: {
      bump: () => apiRef.current!.bump(),
      tick: () => apiRef.current!.tick(),
    },
    snapshot: () => link.getSnapshot(),
  };
};

const bumpUnrelated = async (view: Mounted, times: number): Promise<void> => {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      view.api.bump();
    });
  }
};

beforeEach(() => {
  counters.reset();
});

describe('PERF-185 surface revision reuse + contour auto-derive', () => {
  it('reuses one source revision across the four UI paths and does no work on unrelated renders', async () => {
    const view = await mount(buildFixture(1200, 300));
    const mountCounts = counters.snap();

    // Mount reaches all four consumers (snapshot + display + auto effect +
    // getContours) but the immutable project/surface identity yields exactly
    // ONE canonical computation (weak-ref memo keyed on project + surface).
    expect(mountCounts.compute).toBe(1);
    expect(new Set(mountCounts.revisions).size).toBe(1);
    expect(mountCounts.displayScene).toBeGreaterThanOrEqual(1);
    expect(mountCounts.displayLayers).toBeGreaterThanOrEqual(1);
    expect(mountCounts.snapshot).toBeGreaterThanOrEqual(1);

    // Ten unrelated parent root re-renders: no revision work, no style
    // clones, no contour requests, no scene/snapshot rebuilds.
    const before = counters.snap();
    await bumpUnrelated(view, 10);
    const after = counters.snap();
    // Baseline (no-dep effect): +10 compute, +10 style backfills across the
    // ten unrelated renders. After: all zero (see docs/evidence/perf-185/).
    expect(after.compute - before.compute).toBe(0);
    expect(after.backfill - before.backfill).toBe(0);
    expect(after.request - before.request).toBe(0);
    expect(after.displayScene - before.displayScene).toBe(0);
    expect(after.snapshot - before.snapshot).toBe(0);

    // The snapshot row carries the canonical revision, and the display layer
    // agrees with it (shared hash).
    const row = view.snapshot()?.surface?.surfaces.find((entry) => entry.id === SURFACE_ID);
    expect(row?.revision).toBeTruthy();
    expect(after.revisions.every((revision) => revision === row?.revision)).toBe(true);
    view.root.unmount();
  });

  it('derives contours exactly once per missing eligible set and never re-requests on unrelated renders', async () => {
    const view = await mount(buildFixture(1000, 1000));
    const mountCounts = counters.snap();
    expect(mountCounts.request).toBe(0);

    const beforeBuild = counters.snap();
    await act(async () => {
      view.link.actions!.rebuildSurface(SURFACE_ID);
    });
    const afterBuild = counters.snap();
    expect(afterBuild.request - beforeBuild.request).toBe(1);
    expect(view.snapshot()?.surface?.surfaces.find((entry) => entry.id === SURFACE_ID)?.status).toBe('CURRENT');

    const beforeIdle = counters.snap();
    await bumpUnrelated(view, 10);
    const afterIdle = counters.snap();
    expect(afterIdle.request - beforeIdle.request).toBe(0);
    expect(afterIdle.compute - beforeIdle.compute).toBe(0);
    expect(afterIdle.backfill - beforeIdle.backfill).toBe(0);
    view.root.unmount();
  });

  it('is stable under a StrictMode dev double-effect mount (no loop, no duplicate requests)', async () => {
    const view = await mount(buildFixture(1000, 1000), true);
    const counts = counters.snap();
    // StrictMode double-invokes effects; the shared memo still yields a single
    // canonical revision and there is no mesh yet, so no derivation request.
    expect(new Set(counts.revisions).size).toBe(1);
    expect(counts.request).toBe(0);
    view.root.unmount();
  });
});
