/** @vitest-environment jsdom */
// PERF-186.1 — real production root path: one full viewport filter per
// project/transaction, derived-layer-only filtering afterwards, and no heavy
// filter work on unrelated renders/selection/#189 retirement.
//
// The viewport filter functions are wrapped with deterministic invocation
// counters (never wall-clock) around the actual module implementations, so the
// real root hook + staged pipeline is what is measured.
import React, { useImperativeHandle, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const filterSpy = vi.hoisted(() => ({ full: 0, derived: 0, hidden: 0 }));

vi.mock('../src/engine/cad/cadViewportAppearance', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/engine/cad/cadViewportAppearance')>();
  return {
    ...actual,
    filterCadDisplaySceneForViewport: (
      ...args: Parameters<typeof actual.filterCadDisplaySceneForViewport>
    ) => {
      filterSpy.full += 1;
      return actual.filterCadDisplaySceneForViewport(...args);
    },
    filterCadDerivedLayersForViewport: (
      ...args: Parameters<typeof actual.filterCadDerivedLayersForViewport>
    ) => {
      filterSpy.derived += 1;
      return actual.filterCadDerivedLayersForViewport(...args);
    },
    viewportHiddenEntityIds: (
      ...args: Parameters<typeof actual.viewportHiddenEntityIds>
    ) => {
      filterSpy.hidden += 1;
      return actual.viewportHiddenEntityIds(...args);
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
import { appendCadProjectEntities, buildCadProjectSignature } from '../src/engine/cad/cadProjectState';
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
  observationMode: { bearing: 'grid', distance: 'measured', angle: 'measured', direction: 'measured' },
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

const NOOP_PERSIST: React.Dispatch<React.SetStateAction<SurveyCadPersistedState | null>> = () => {};
const INSTRUMENT_LIBRARY = {};

const POINT_COUNT = 600;

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

interface Fixture {
  state: SurveyCadPersistedState;
  layerId: string;
}

const buildDense = (pointCount: number): Fixture => {
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
  const project: CadProject = appendCadProjectEntities(base, points);
  return {
    state: { version: 1, sourceSignature: buildCadProjectSignature(base), project },
    layerId,
  };
};

interface HarnessApi {
  bump: () => void;
}

const Harness: React.FC<{
  link: CadShellLink;
  initial: SurveyCadPersistedState;
  apiRef: { current: HarnessApi | null };
}> = ({ link, initial, apiRef }) => {
  const [persisted] = useState(initial);
  const [, setTick] = useState(0);
  useImperativeHandle(apiRef, () => ({ bump: () => setTick((value) => value + 1) }));
  return (
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
  );
};

interface Mounted {
  container: HTMLElement;
  root: Root;
  link: CadShellLink;
  api: HarnessApi;
}

const mount = async (fixture: Fixture, strict = false): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const link = createCadShellLink();
  const apiRef: { current: HarnessApi | null } = { current: null };
  const tree = <Harness link={link} initial={fixture.state} apiRef={apiRef} />;
  await act(async () => {
    root.render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
  });
  await act(async () => {
    await Promise.resolve();
  });
  // Flush the post-mount viewport/bounds commit so steady-state counts are
  // measured after the initial mount settles.
  await act(async () => {
    await Promise.resolve();
  });
  return {
    container,
    root,
    link,
    api: { bump: () => apiRef.current!.bump() },
  };
};

beforeEach(() => {
  filterSpy.full = 0;
  filterSpy.derived = 0;
  filterSpy.hidden = 0;
});

describe('PERF-186.1 root pipeline scan contract', () => {
  it('runs exactly one full primitive filter and three derived-layer filters on mount', async () => {
    const view = await mount(buildDense(POINT_COUNT));
    expect(filterSpy.full).toBe(1);
    expect(filterSpy.derived).toBe(3);
    view.root.unmount();
  });

  it('does zero full scans on unrelated renders and idle pointer moves (steady state)', async () => {
    const view = await mount(buildDense(POINT_COUNT));
    // Settle any one-time post-mount effect (viewport/bounds commit) first.
    await act(async () => {
      view.api.bump();
    });
    const full = filterSpy.full;
    const derived = filterSpy.derived;

    // Unrelated parent re-render: no full primitive scan.
    await act(async () => {
      view.api.bump();
    });
    expect(filterSpy.full).toBe(full);

    // Unrelated internal shell state change (drafting panel): no full scan.
    await act(async () => {
      view.link.actions!.toggleDraftingPanel();
    });
    expect(filterSpy.full).toBe(full);

    // Idle pointer moves over the viewport: no full scan, no render storm.
    const svg = view.container.querySelector('[data-survey-cad-preview]') as SVGSVGElement | null;
    if (svg) {
      Object.defineProperty(svg, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ x: 0, y: 0, left: 0, top: 0, width: 900, height: 520, right: 900, bottom: 520, toJSON: () => ({}) }),
      });
      await act(async () => {
        for (const clientX of [400, 420, 440, 460]) {
          svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY: 260 }));
        }
      });
    }
    expect(filterSpy.full).toBe(full);
    // A snapshot republish may re-run the cheap grading derived stage only.
    expect(filterSpy.derived - derived).toBeLessThanOrEqual(2);
    view.root.unmount();
  });

  it('runs one new full filter per genuine layer transaction, and none on a selection change', async () => {
    const fixture = buildDense(POINT_COUNT);
    const view = await mount(fixture);
    const full = filterSpy.full;

    // Selection-only: project unchanged → no full primitive scan.
    await act(async () => {
      view.link.actions!.selectEntities(['sp:dense:5']);
    });
    expect(filterSpy.full).toBe(full);

    // Genuine layer transaction: exactly one full scan for the new project
    // version, plus one derived-layer pass per staged memo.
    const derivedBeforeTransaction = filterSpy.derived;
    await act(async () => {
      expect(
        view.link.actions!.runLayerCommand({ key: 'LAYER_VISIBILITY', layerId: fixture.layerId, visible: false }),
      ).toBe(true);
    });
    expect(filterSpy.full).toBe(full + 1);
    expect(filterSpy.derived).toBeGreaterThanOrEqual(derivedBeforeTransaction + 3);

    // Undo restores: one more full scan (new project version), never a cached stale scene.
    await act(async () => {
      view.link.actions!.undo();
    });
    expect(filterSpy.full).toBe(full + 2);
    view.root.unmount();
  });

  it('#189 retirement reuses the render-scoped hidden set for the committed project', async () => {
    const fixture = buildDense(POINT_COUNT);
    const view = await mount(fixture);
    await act(async () => {
      view.link.actions!.selectEntities(['sp:dense:5']);
    });
    const hiddenBefore = filterSpy.hidden;
    await act(async () => {
      view.link.actions!.runLayerCommand({ key: 'LAYER_VISIBILITY', layerId: fixture.layerId, visible: false });
    });
    // Selected entity is retired (grips never float on hidden geometry).
    expect(view.link.getSnapshot()?.selectedEntityIds).toEqual([]);
    // At most two derivations: the render-scoped capture + the post-retirement
    // effect pass. The history updater itself does NOT recompute (baseline: 3).
    expect(filterSpy.hidden - hiddenBefore).toBeLessThanOrEqual(2);
    view.root.unmount();
  });

  it('mount under StrictMode dev double-invokes the memo but stays bounded and stable', async () => {
    const view = await mount(buildDense(POINT_COUNT), true);
    // StrictMode double-invokes the component render (and its memos) in dev;
    // this is React's development double-render, never a production scan loop.
    expect(filterSpy.full).toBe(2);
    const afterMount = filterSpy.full;
    await act(async () => {
      view.api.bump();
    });
    // StrictMode only doubles the mount render; a later re-render with stable
    // deps bails out of the memo (0 additional scans), not a scan loop.
    expect(filterSpy.full).toBe(afterMount);
    view.root.unmount();
  });
});
