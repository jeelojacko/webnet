/** @vitest-environment jsdom */
/**
 * STRUCT-194.9 — `useSurveyCadAnalysisPresentation`.
 *
 * Real production hook + REAL engine builders/analysis control plane; the
 * three builder modules are wrapped (never reimplemented) with deterministic
 * invocation counters so the memo-dependency contract is measured directly.
 * Pins:
 *   - unrelated rerenders never recompute any of the four memos (no PERF-184
 *     churn) and preserve every reference identity,
 *   - the in-place analysis-cache mutation only becomes visible on a version
 *     bump (the epoch contract),
 *   - a `surfaceMeshSessions` identity change refreshes the epoch,
 *   - an appearance-only edit repaints without changing the `arev1:` revision,
 *   - the export input tracks CURRENT results + the caller-supplied units and
 *     consumes the exact `analysisSnapshot` reference,
 *   - `exportCivilSources` is stable until a cache identity actually changes.
 *
 * Fast + deterministic; agent tier.
 */
import React, { StrictMode, act, useEffect, useImperativeHandle, useState, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const builderSpy = vi.hoisted(() => ({
  snapshot: 0,
  exportInput: 0,
  scene: 0,
  lastExportUnits: null as string | null,
  lastExportSnapshot: null as unknown,
}));

vi.mock('../src/cad-app/shell/cadAnalysisSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadAnalysisSnapshot')>();
  return {
    ...actual,
    buildCadAnalysisSnapshot: (...args: Parameters<typeof actual.buildCadAnalysisSnapshot>) => {
      builderSpy.snapshot += 1;
      return actual.buildCadAnalysisSnapshot(...args);
    },
  };
});

vi.mock('../src/cad-app/shell/cadAnalysisExportInput', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cad-app/shell/cadAnalysisExportInput')>();
  return {
    ...actual,
    buildAnalysisExportInput: (...args: Parameters<typeof actual.buildAnalysisExportInput>) => {
      builderSpy.exportInput += 1;
      builderSpy.lastExportUnits = args[4];
      builderSpy.lastExportSnapshot = args[1];
      return actual.buildAnalysisExportInput(...args);
    },
  };
});

vi.mock('../src/engine/cad/cadAnalysisDisplayView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadAnalysisDisplayView')>();
  return {
    ...actual,
    buildAnalysisSceneLayers: (...args: Parameters<typeof actual.buildAnalysisSceneLayers>) => {
      builderSpy.scene += 1;
      return actual.buildAnalysisSceneLayers(...args);
    },
  };
});

import type { UnitsMode } from '../src/types';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createCadSurfaceCache, type CadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { createCadSurfaceVolumeCache, type CadSurfaceVolumeCache } from '../src/engine/cad/surfaceVolumeCache';
import { createCadProfileCache, type CadProfileCache } from '../src/engine/cad/profileCache';
import { createCadSectionCache, type CadSectionCache } from '../src/engine/cad/sectionCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import type { CadCommand, CadWorkspaceSnapshot } from '../src/engine/cad/cadTransactions.types';
import { generateAnalysisBands } from '../src/engine/cad/cadAnalysisMaps';
import { resolveCurrentAnalysisRevision } from '../src/engine/cad/cadAnalysisView.service';
import {
  createCadAnalysisControlPlane,
  type CadAnalysisControlPlane,
} from '../src/cad-app/shell/cadAnalysisAdapters';
import {
  useSurveyCadAnalysisPresentation,
  type SurveyCadAnalysisPresentation,
} from '../src/hooks/surveyCad/useSurveyCadAnalysisPresentation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seq = 0;

const pt = (stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id: `pt-${(seq += 1)}`,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'unknown',
  source: 'parsed-input',
});

const baseProject = (entities: CadProject['entities']): CadProject => ({
  version: 2,
  id: 'analysis-1949-project',
  name: 'analysis-1949',
  metadata: {
    source: 'parsed-input',
    runMode: 'unknown',
    units: 'm',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: [],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities,
  cogoComputations: [],
  bounds: null,
});

const cacheMeshes = (project: CadProject, tinCache: CadSurfaceCache): void => {
  for (const surface of project.surfaces ?? []) {
    const built = buildCadSurface(project, surface);
    if (built.outcome !== 'ok') throw new Error('fixture mesh failed');
    tinCache.set(surface.id, built.revision, {
      revision: built.revision,
      points: built.points,
      triangles: built.triangles,
      stats: built.stats,
      grid: built.grid,
      adjacency: built.adjacency,
      edgeKinds: built.edgeKinds,
    });
  }
};

const fixture = () => {
  seq = 0;
  const a = pt('A', 0, 0, 0);
  const b = pt('B', 10, 0, 4);
  const c = pt('C', 10, 10, 8);
  const d = pt('D', 0, 10, 12);
  const project = baseProject([a, b, c, d]);
  project.surfaces = [{
    id: 'srf-1',
    name: 'Pond',
    definition: { pointSource: { kind: 'points', pointEntityIds: [a.id, b.id, c.id, d.id] } },
    cachedRevision: null,
  }];
  const tinCache = createCadSurfaceCache('1949');
  cacheMeshes(project, tinCache);
  return { project, tinCache };
};

const workspace = (project: CadProject): CadWorkspaceSnapshot => ({
  project,
  selection: createCadSelectionState(project, []),
});

const run = (project: CadProject, command: CadCommand): CadProject | null => {
  const result = executeCadCommand(workspace(project), command);
  return result ? result.nextSnapshot.project : null;
};

const elevationBands = () => {
  const generated = generateAnalysisBands(3, 0, 12);
  if ('error' in generated) throw new Error(generated.error);
  return generated.bands;
};

const createdMap = (project: CadProject): CadProject => {
  const next = run(project, {
    key: 'ANALYSIS_MAP_CREATE',
    name: 'Elevation Map',
    source: { kind: 'surface', surfaceId: 'srf-1', metric: 'elevation' },
    bands: elevationBands(),
  } as CadCommand);
  if (!next) throw new Error('analysis map create failed');
  return next;
};

const planeOf = (getProject: () => CadProject, tinCache: CadSurfaceCache): CadAnalysisControlPlane =>
  createCadAnalysisControlPlane({
    drawingId: 'd1',
    getProject,
    getDrawingId: () => 'd1',
    tinCache,
    notify: () => undefined,
    onStateChange: () => undefined,
  });

interface AnalysisControls {
  setProject: (_project: CadProject) => void;
  setUnits: (_units: UnitsMode) => void;
  bumpVersion: () => void;
  bumpMesh: () => void;
  bumpUnrelated: () => void;
  setProfileCache: (_cache: CadProfileCache) => void;
  setSectionCache: (_cache: CadSectionCache) => void;
}

const Harness: React.FC<{
  controls: RefObject<AnalysisControls | null>;
  initialProject: CadProject;
  holder: { value: CadProject };
  surfaceCache: CadSurfaceCache;
  volumeCache: CadSurfaceVolumeCache;
  initialProfileCache: CadProfileCache;
  initialSectionCache: CadSectionCache;
  analysisPlane: CadAnalysisControlPlane;
  selectedAnalysisId: string | null;
  onApi: (_api: SurveyCadAnalysisPresentation) => void;
}> = ({
  controls,
  initialProject,
  holder,
  surfaceCache,
  volumeCache,
  initialProfileCache,
  initialSectionCache,
  analysisPlane,
  selectedAnalysisId,
  onApi,
}) => {
  const [project, setProjectState] = useState(initialProject);
  const [units, setUnits] = useState<UnitsMode>('m');
  const [analysisVersion, setAnalysisVersion] = useState(0);
  const [surfaceMeshSessions, setSurfaceMeshSessions] = useState<Record<string, string[]>>({});
  const [profileCache, setProfileCache] = useState(initialProfileCache);
  const [sectionCache, setSectionCache] = useState(initialSectionCache);
  const [, setEpoch] = useState(0);
  const api = useSurveyCadAnalysisPresentation({
    activeProject: project,
    surfaceCache,
    volumeCache,
    profileCache,
    sectionCache,
    analysisPlane,
    analysisVersion,
    surfaceMeshSessions,
    selectedAnalysisId,
    selectedAnalysisLegendId: null,
    units,
  });
  useEffect(() => {
    onApi(api);
  });
  useImperativeHandle(controls, () => ({
    setProject: (next) => {
      holder.value = next;
      setProjectState(next);
    },
    setUnits,
    bumpVersion: () => setAnalysisVersion((value) => value + 1),
    bumpMesh: () => setSurfaceMeshSessions((current) => ({ ...current })),
    bumpUnrelated: () => setEpoch((value) => value + 1),
    setProfileCache,
    setSectionCache,
  }));
  return null;
};

interface Mounted {
  root: Root;
  container: HTMLElement;
  controls: RefObject<AnalysisControls | null>;
  api: () => SurveyCadAnalysisPresentation;
  holder: { value: CadProject };
}

const mounted: Mounted[] = [];

const mountAnalysis = async (
  project: CadProject,
  tinCache: CadSurfaceCache,
  analysisPlane: CadAnalysisControlPlane,
  selectedAnalysisId: string | null,
  strict = false,
): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const controls: RefObject<AnalysisControls | null> = { current: null };
  const holder = { value: project };
  let api: SurveyCadAnalysisPresentation | null = null;
  const element = (
    <Harness
      controls={controls}
      initialProject={project}
      holder={holder}
      surfaceCache={tinCache}
      volumeCache={createCadSurfaceVolumeCache('1949')}
      initialProfileCache={createCadProfileCache('1949')}
      initialSectionCache={createCadSectionCache('1949')}
      analysisPlane={analysisPlane}
      selectedAnalysisId={selectedAnalysisId}
      onApi={(value) => {
        api = value;
      }}
    />
  );
  await act(async () => {
    root.render(strict ? <StrictMode>{element}</StrictMode> : element);
  });
  const view: Mounted = {
    root,
    container,
    controls,
    holder,
    api: () => {
      if (!api) throw new Error('hook not mounted');
      return api;
    },
  };
  mounted.push(view);
  return view;
};

afterEach(async () => {
  for (const view of mounted.splice(0)) {
    await act(async () => {
      view.root.unmount();
    });
    view.container.remove();
  }
  builderSpy.snapshot = 0;
  builderSpy.exportInput = 0;
  builderSpy.scene = 0;
  builderSpy.lastExportUnits = null;
  builderSpy.lastExportSnapshot = null;
  vi.clearAllMocks();
});

/** Fixture with a CURRENT analysis already calculated on the control plane. */
const currentFixture = () => {
  const { project, tinCache } = fixture();
  const withMap = createdMap(project);
  const mapId = withMap.analysisMaps![0]!.id;
  const holder = { value: withMap };
  const plane = planeOf(() => holder.value, tinCache);
  const message = plane.requestCalculate(mapId);
  expect(message).not.toMatch(/error/i);
  return { withMap, mapId, plane, holder, tinCache };
};

describe('STRUCT-194.9 useSurveyCadAnalysisPresentation', () => {
  it('does not churn any memo on an unrelated rerender and preserves references', async () => {
    const { withMap, mapId, plane, tinCache } = currentFixture();
    const view = await mountAnalysis(withMap, tinCache, plane, mapId);
    const before = view.api();
    expect(before.analysisSnapshot.analyses[0]!.status).toBe('CURRENT');
    const counts = { ...builderSpy };

    await act(async () => {
      view.controls.current!.bumpUnrelated();
    });
    const after = view.api();
    expect(after.analysisSnapshot).toBe(before.analysisSnapshot);
    expect(after.analysisExportInput).toBe(before.analysisExportInput);
    expect(after.exportCivilSources).toBe(before.exportCivilSources);
    expect(after.analysisDisplay).toBe(before.analysisDisplay);
    expect(builderSpy.snapshot).toBe(counts.snapshot);
    expect(builderSpy.exportInput).toBe(counts.exportInput);
    expect(builderSpy.scene).toBe(counts.scene);
  });

  it('only surfaces an in-place cache mutation on a version bump, then refreshes the epoch', async () => {
    const { withMap, mapId, plane, tinCache, holder } = currentFixture();
    const view = await mountAnalysis(withMap, tinCache, plane, mapId);
    const before = view.api();
    expect(before.analysisSnapshot.analyses[0]!.status).toBe('CURRENT');

    // Mutate the live cache in place without bumping the version: the memo
    // keeps its previous (CURRENT) result because nothing observable changed.
    plane.cache.clear();
    await act(async () => {
      view.controls.current!.bumpUnrelated();
    });
    expect(view.api().analysisSnapshot).toBe(before.analysisSnapshot);
    expect(view.api().analysisSnapshot.analyses[0]!.status).toBe('CURRENT');

    // The version bump is the only reliable trigger: the cleared cache now
    // re-derives as UNBUILT.
    await act(async () => {
      view.controls.current!.bumpVersion();
    });
    expect(view.api().analysisSnapshot).not.toBe(before.analysisSnapshot);
    expect(view.api().analysisSnapshot.analyses[0]!.status).toBe('UNBUILT');

    // Recalculate + a fresh epoch restores CURRENT.
    holder.value = withMap;
    plane.requestCalculate(mapId);
    await act(async () => {
      view.controls.current!.bumpVersion();
    });
    expect(view.api().analysisSnapshot.analyses[0]!.status).toBe('CURRENT');
  });

  it('refreshes on a surfaceMeshSessions identity change', async () => {
    const { withMap, mapId, plane, tinCache } = currentFixture();
    const view = await mountAnalysis(withMap, tinCache, plane, mapId);
    const before = view.api().analysisSnapshot;
    const count = builderSpy.snapshot;
    await act(async () => {
      view.controls.current!.bumpMesh();
    });
    expect(builderSpy.snapshot).toBe(count + 1);
    expect(view.api().analysisSnapshot).not.toBe(before);
  });

  it('repaints on an appearance-only edit without changing the geometry revision', async () => {
    const { withMap, mapId, plane, tinCache, holder } = currentFixture();
    const view = await mountAnalysis(withMap, tinCache, plane, mapId);
    const map = withMap.analysisMaps![0]!;
    const revisionBefore = resolveCurrentAnalysisRevision(withMap, map);
    const displayBefore = view.api().analysisDisplay;

    const appearance = run(withMap, {
      key: 'ANALYSIS_MAP_UPDATE_APPEARANCE',
      analysisId: mapId,
      patch: { opacity: 0.35, bandColors: { [map.bands[0]!.id]: '#123456' } },
    });
    if (!appearance) throw new Error('appearance update failed');
    holder.value = appearance;
    await act(async () => {
      view.controls.current!.setProject(appearance);
    });
    const revisionAfter = resolveCurrentAnalysisRevision(appearance, appearance.analysisMaps![0]!);
    expect(revisionAfter).toBe(revisionBefore);
    expect(view.api().analysisDisplay).not.toBe(displayBefore);
    expect(view.api().analysisSnapshot.analyses[0]!.status).toBe('CURRENT');
  });

  it('derives the export input from the CURRENT snapshot and the caller units', async () => {
    const { withMap, mapId, plane, tinCache } = currentFixture();
    const view = await mountAnalysis(withMap, tinCache, plane, mapId);
    expect(view.api().analysisExportInput).toBeDefined();
    expect(builderSpy.lastExportUnits).toBe('m');
    expect(builderSpy.lastExportSnapshot).toBe(view.api().analysisSnapshot);

    const before = view.api().analysisExportInput;
    await act(async () => {
      view.controls.current!.setUnits('ft');
    });
    expect(builderSpy.lastExportUnits).toBe('ft');
    expect(view.api().analysisExportInput).not.toBe(before);
  });

  it('keeps exportCivilSources stable until a cache identity actually changes', async () => {
    const { withMap, mapId, plane, tinCache } = currentFixture();
    const view = await mountAnalysis(withMap, tinCache, plane, mapId);
    const before = view.api().exportCivilSources;
    await act(async () => {
      view.controls.current!.bumpUnrelated();
    });
    expect(view.api().exportCivilSources).toBe(before);
    expect(view.api().exportCivilSources.surfaceCache).toBe(tinCache);

    const nextProfile = createCadProfileCache('p2');
    await act(async () => {
      view.controls.current!.setProfileCache(nextProfile);
    });
    expect(view.api().exportCivilSources).not.toBe(before);
    expect(view.api().exportCivilSources.profileCache).toBe(nextProfile);

    const afterProfile = view.api().exportCivilSources;
    const nextSection = createCadSectionCache('s2');
    await act(async () => {
      view.controls.current!.setSectionCache(nextSection);
    });
    expect(view.api().exportCivilSources).not.toBe(afterProfile);
    expect(view.api().exportCivilSources.sectionCache).toBe(nextSection);
  });

  it('mounts cleanly under StrictMode', async () => {
    const { withMap, mapId, plane, tinCache } = currentFixture();
    const view = await mountAnalysis(withMap, tinCache, plane, mapId, true);
    expect(view.api().analysisSnapshot.analyses[0]!.status).toBe('CURRENT');
    expect(view.api().exportCivilSources.surfaceCache).toBe(tinCache);
  });
});
