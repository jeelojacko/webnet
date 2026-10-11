/** @vitest-environment jsdom */
/**
 * PERF-CAD-SCENE.1 — base display-scene reuse for proven metadata-only edits.
 *
 * `useSurveyCadWorkspace` re-derives the viewport display scene from the
 * committed project. `buildCadDisplayScene` (the expensive entity flatMap +
 * lookup tables) provably never reads a layer NAME, so a `LAYER_RENAME` — a
 * shallow project spread with a new `layers` array and every other top-level
 * slice reference-identical — can reuse the previous BASE scene while the
 * viewport filter still runs on the CURRENT project.
 *
 * These tests count REAL `buildCadDisplayScene` / `filterCadDisplaySceneForViewport`
 * production calls through `vi.mock` wrappers delegating to the actual
 * implementations, drive the REAL `useSurveyCadWorkspace` hook through a
 * `react-dom/client` probe, and compare the fast-path scene against an
 * uncached baseline. Negative controls pin every scene-relevant invalidation;
 * the guard unit suite proves each control is falsifiable (a loosened guard
 * would pass it).
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sceneSpy = vi.hoisted(() => ({
  build: 0,
  buildWithLineweight: 0,
  filter: 0,
  filterProjects: [] as unknown[],
}));

vi.mock('../src/engine/cad/cadRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadRenderer')>();
  return {
    ...actual,
    buildCadDisplayScene: (
      ...args: Parameters<typeof actual.buildCadDisplayScene>
    ) => {
      sceneSpy.build += 1;
      const options = args[1] as { lineweightDisplay?: unknown } | undefined;
      if (options !== undefined && options.lineweightDisplay !== undefined) {
        sceneSpy.buildWithLineweight += 1;
      }
      return actual.buildCadDisplayScene(...args);
    },
  };
});

vi.mock('../src/engine/cad/cadViewportAppearance', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/engine/cad/cadViewportAppearance')>();
  return {
    ...actual,
    filterCadDisplaySceneForViewport: (
      ...args: Parameters<typeof actual.filterCadDisplaySceneForViewport>
    ) => {
      sceneSpy.filter += 1;
      sceneSpy.filterProjects.push(args[0]);
      return actual.filterCadDisplaySceneForViewport(...args);
    },
  };
});

import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import {
  canReuseCadDisplaySceneBase,
  filterCadDisplaySceneForViewport,
  type CadDisplaySceneBaseCacheEntry,
  type CadDisplaySceneBuildInputs,
} from '../src/engine/cad/cadViewportAppearance';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
} from '../src/engine/cad/cadDrawingFile';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { replaceCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { createCadShellLink } from '../src/cad-app/shell/cadShellLink';
import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
import { useSurveyCadWorkspace } from '../src/hooks/surveyCad/useSurveyCadWorkspace';
import type { UseSurveyCadWorkspaceResult } from '../src/hooks/surveyCad/useSurveyCadWorkspace.types';
import type { ParseOptions } from '../src/types';
import type {
  CadBlockDefinition,
  CadDisplayScene,
  CadDrawingDocument,
  CadEntity,
  CadProject,
  SurveyCadPersistedState,
} from '../src/engine/cad/cadTypes';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LAYER = 'layer-a';
const BASE_ENTITY = { layerId: LAYER, visible: true, locked: false } as const;

const lineEntity = (index: number): CadEntity => ({
  ...BASE_ENTITY,
  id: `line:${index}`,
  type: 'line',
  fromStationId: `A${index}`,
  toStationId: `B${index}`,
  fromX: index,
  fromY: 0,
  toX: index,
  toY: 1,
  sourceObservationIds: [index],
});

const lineProject = (entityCount: number): CadProject => {
  const base = createBlankCadProject({ name: `scene-${entityCount}`, units: 'm' });
  const entities: CadEntity[] = [];
  for (let index = 0; index < entityCount; index += 1) entities.push(lineEntity(index));
  return replaceCadProjectEntities(base, entities);
};

const blockDefinition = (): CadBlockDefinition => ({
  id: 'blk-l',
  name: 'L',
  basePoint: { x: 0, y: 0 },
  entities: [
    {
      ...BASE_ENTITY,
      id: 'blk-line',
      type: 'line',
      fromStationId: 'BA',
      toStationId: 'BB',
      fromX: 0,
      fromY: 0,
      toX: 2,
      toY: 1,
      sourceObservationIds: [],
    },
    {
      ...BASE_ENTITY,
      id: 'blk-arc',
      type: 'arc',
      centerX: 0,
      centerY: 0,
      radius: 2,
      startAngleDeg: 0,
      endAngleDeg: 90,
    },
    { ...BASE_ENTITY, id: 'blk-text', type: 'text', x: 1, y: 1, text: 'b' },
  ],
});

/** Rich enough to exercise lines, arcs, circles, polylines, parcels, points,
 *  text, block expansion, and vertex-order/bounds parity. */
const mixedProject = (): CadProject => {
  const base = createBlankCadProject({ name: 'mixed', units: 'm' });
  base.layers = [
    { id: LAYER, name: 'A', color: '#00ff00', visible: true, locked: false, role: 'planning' },
    { id: 'layer-b', name: 'B', color: '#ff0000', visible: true, locked: false, role: 'planning' },
  ];
  base.blockDefinitions = [blockDefinition()];
  const entities: CadEntity[] = [
    lineEntity(0),
    {
      ...BASE_ENTITY,
      id: 'arc:1',
      type: 'arc',
      centerX: 5,
      centerY: 5,
      radius: 3,
      startAngleDeg: 0,
      endAngleDeg: 90,
    },
    { ...BASE_ENTITY, id: 'circle:1', type: 'circle', centerX: -4, centerY: 2, radius: 1.5 },
    {
      ...BASE_ENTITY,
      id: 'polyline:1',
      type: 'polyline',
      vertices: [
        { x: 0, y: 10 },
        { x: 4, y: 12 },
        { x: 8, y: 9 },
      ],
      vertexLabels: ['P1', 'P2', 'P3'],
      closed: false,
      segmentGeometry: [{ kind: 'line' }, { kind: 'arc', bulge: 0.5 }],
    },
    {
      ...BASE_ENTITY,
      id: 'parcel:1',
      type: 'parcel',
      vertices: [
        { x: 20, y: 20 },
        { x: 30, y: 20 },
        { x: 30, y: 30 },
        { x: 20, y: 30 },
      ],
      vertexLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
      parcelName: 'Parcel 1',
      courseIds: ['c0', 'c1', 'c2', 'c3'],
      courseGeometry: [
        { kind: 'line' },
        { kind: 'arc', bulge: 0.25 },
        { kind: 'line' },
        { kind: 'line' },
      ],
    },
    {
      ...BASE_ENTITY,
      id: 'sp:1',
      type: 'survey-point',
      stationId: 'S1',
      x: 12,
      y: -3,
      z: 1.25,
      pointClass: 'control',
      source: 'parsed-input',
    },
    { ...BASE_ENTITY, id: 'text:1', type: 'text', x: 2, y: 2, text: 'hello' },
    {
      ...BASE_ENTITY,
      id: 'blockref:1',
      type: 'block-reference',
      blockDefinitionId: 'blk-l',
      x: 40,
      y: 40,
      rotationDeg: 15,
      scaleX: 1.5,
      scaleY: 1.5,
    },
  ];
  return replaceCadProjectEntities(base, entities);
};

// ---------------------------------------------------------------------------
// Controlled harness (real hook, real commits)
// ---------------------------------------------------------------------------

interface Harness {
  api: () => UseSurveyCadWorkspaceResult;
  drawing: () => CadDrawingDocument;
  commit: (_command: CadCommand) => Promise<boolean>;
  replaceProject: (_project: CadProject) => Promise<void>;
  patchProject: (_edit: (_project: CadProject) => CadProject) => Promise<void>;
  setDrawing: (_document: CadDrawingDocument) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  settle: () => Promise<void>;
  unmount: () => Promise<void>;
}

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

const createHarness = async (
  initialProject: CadProject,
  options: { strict?: boolean; drawingId?: string } = {},
): Promise<Harness> => {
  const controls: {
    api: UseSurveyCadWorkspaceResult | null;
    drawing: CadDrawingDocument;
    setDrawing: React.Dispatch<React.SetStateAction<CadDrawingDocument | null>> | null;
  } = {
    api: null,
    drawing: {
      ...createBlankCadDrawingDocument({ units: 'm' }),
      drawingId: options.drawingId ?? 'scene-drawing',
      project: initialProject,
    },
    setDrawing: null,
  };

  const Inner: React.FC<{
    drawing: CadDrawingDocument;
    onProjectChange: React.Dispatch<React.SetStateAction<CadDrawingDocument | null>>;
  }> = ({ drawing, onProjectChange }) => {
    const ws = useSurveyCadWorkspace(
      drawing.project,
      drawing.drawingId,
      onProjectChange,
      drawing,
      undefined,
      true,
      false,
      'thin',
    );
    React.useEffect(() => {
      controls.api = ws;
    });
    return null;
  };

  const Probe: React.FC = () => {
    const [drawing, setDrawing] = React.useState<CadDrawingDocument | null>(controls.drawing);
    React.useEffect(() => {
      controls.setDrawing = setDrawing;
      if (drawing) controls.drawing = drawing;
    }, [drawing]);
    if (!drawing) return null;
    return <Inner drawing={drawing} onProjectChange={setDrawing} />;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      options.strict ? (
        <React.StrictMode>
          <Probe />
        </React.StrictMode>
      ) : (
        <Probe />
      ),
    );
  });
  await act(async () => {});

  const settle = async (): Promise<void> => {
    await act(async () => {});
  };

  return {
    api: () => controls.api!,
    drawing: () => controls.drawing,
    commit: async (command) => {
      let applied = false;
      await act(async () => {
        applied = controls.api!.runLayerCommand(command);
      });
      await settle();
      return applied;
    },
    replaceProject: async (project) => {
      await act(async () => {
        controls.api!.replaceCadProject(project);
      });
      await settle();
    },
    patchProject: async (edit) => {
      await act(async () => {
        controls.setDrawing!((previous) =>
          previous ? { ...previous, project: edit(previous.project) } : previous,
        );
      });
      await settle();
    },
    setDrawing: async (document) => {
      await act(async () => {
        controls.setDrawing!(document);
      });
      await settle();
    },
    undo: async () => {
      await act(async () => {
        controls.api!.undo();
      });
      await settle();
    },
    redo: async () => {
      await act(async () => {
        controls.api!.redo();
      });
      await settle();
    },
    settle,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const resetSpies = (): void => {
  sceneSpy.build = 0;
  sceneSpy.buildWithLineweight = 0;
  sceneSpy.filter = 0;
  sceneSpy.filterProjects.length = 0;
};

const baseBuilds = (): number => sceneSpy.buildWithLineweight;

const uncachedScene = (project: CadProject): CadDisplayScene =>
  filterCadDisplaySceneForViewport(
    project,
    buildCadDisplayScene(project, { lineweightDisplay: 'thin' }),
  );

/** Fast-path scene must be byte-identical to the uncached pipeline. */
const expectSceneParity = (api: UseSurveyCadWorkspaceResult): void => {
  const live = api.displayScene;
  const baseline = uncachedScene(api.cadProject);
  expect(JSON.stringify(live)).toBe(JSON.stringify(baseline));
  expect(live.bounds).toEqual(baseline.bounds);
  expect(live.primitives.map((primitive) => primitive.id)).toEqual(
    baseline.primitives.map((primitive) => primitive.id),
  );
};

const renameCommand = (layerId: string, name: string): CadCommand => ({
  key: 'LAYER_RENAME',
  layerId,
  name,
});

beforeEach(() => {
  resetSpies();
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  vi.restoreAllMocks();
  resetSpies();
});

// ---------------------------------------------------------------------------
// A. PROOF: LAYER_RENAME reuses the base scene
// ---------------------------------------------------------------------------

describe('PERF-CAD-SCENE.1 LAYER_RENAME reuses the base scene', () => {
  it('rebuilds once on mount, then zero base rebuilds for repeated renames', async () => {
    const project = lineProject(1_000);
    const harness = await createHarness(project);
    const layerId = project.layers[0]!.id;
    expect(baseBuilds()).toBe(1);
    expect(sceneSpy.filter).toBe(1);

    for (let round = 0; round < 5; round += 1) {
      resetSpies();
      expect(await harness.commit(renameCommand(layerId, `renamed-${round}`))).toBe(true);
      expect(baseBuilds()).toBe(0);
      expect(sceneSpy.filter).toBe(1);
    }
    // Scene still matches the uncached pipeline for the CURRENT project.
    expectSceneParity(harness.api());
  });

  it('keeps byte-identical scenes across a long rename chain (mixed entities)', async () => {
    const harness = await createHarness(mixedProject());
    const layerId = 'layer-a';
    expectSceneParity(harness.api());
    for (let round = 0; round < 4; round += 1) {
      expect(await harness.commit(renameCommand(layerId, `mixed-${round}`))).toBe(true);
      expectSceneParity(harness.api());
    }
    expect(await harness.commit(renameCommand('layer-b', 'B-renamed'))).toBe(true);
    expectSceneParity(harness.api());
  });

  it('always filters the CURRENT project object after a rename', async () => {
    const project = lineProject(50);
    const harness = await createHarness(project);
    expect(await harness.commit(renameCommand(project.layers[0]!.id, 'current-check'))).toBe(true);
    const currentProject = harness.api().cadProject;
    expect(sceneSpy.filterProjects[sceneSpy.filterProjects.length - 1]).toBe(currentProject);
  });

  it('reuses across undo of a rename (names are the only difference)', async () => {
    const project = lineProject(200);
    const harness = await createHarness(project);
    const layerId = project.layers[0]!.id;
    expect(await harness.commit(renameCommand(layerId, 'to-undo'))).toBe(true);
    resetSpies();
    await harness.undo();
    expect(baseBuilds()).toBe(0);
    expectSceneParity(harness.api());
  });

  it('StrictMode mount stays bounded and reuses on rename', async () => {
    const project = lineProject(100);
    const harness = await createHarness(project, { strict: true });
    // StrictMode double-invokes the mount render; the hook-local ref reuses
    // the first base scene on the second invocation (one build, never two).
    expect(baseBuilds()).toBe(1);
    resetSpies();
    expect(await harness.commit(renameCommand(project.layers[0]!.id, 'strict-rename'))).toBe(true);
    expect(baseBuilds()).toBe(0);
    expectSceneParity(harness.api());
  });

  it('does not share a base scene between two live workspace instances', async () => {
    const project = lineProject(100);
    resetSpies();
    const first = await createHarness(project, { drawingId: 'drawing-1' });
    const second = await createHarness(project, { drawingId: 'drawing-2' });
    // Each instance owns its own hook-local cache: two mounts, two builds.
    expect(baseBuilds()).toBe(2);
    expect(first.api().displayScene).not.toBe(second.api().displayScene);
  });
});

// ---------------------------------------------------------------------------
// A2. PRODUCTION SHELL: the real SurveyCadWorkspace always passes
// `surfaceContourInputs` (a fresh closure per project commit); the
// version-stable input contract must still allow reuse on a rename.
// ---------------------------------------------------------------------------

const SHELL_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
].join('\n');

const SHELL_PARSE_OPTIONS: ParseOptions = {
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

const mountProductionShell = async (project: CadProject) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const link = createCadShellLink();
  const initial: CadDrawingDocument = {
    ...createBlankCadDrawingDocument({ units: 'm' }),
    drawingId: 'production-shell-drawing',
    project,
  };
  const Harness: React.FC = () => {
    const [drawing, setDrawing] = React.useState<CadDrawingDocument | null>(initial);
    if (!drawing) return null;
    return (
      <SurveyCadWorkspace
        input={SHELL_INPUT}
        instrumentLibrary={{}}
        parseOptions={SHELL_PARSE_OPTIONS}
        units="m"
        result={null}
        persistedState={null}
        onPersistedStateChange={NOOP_PERSIST}
        drawing={drawing}
        onDrawingChange={setDrawing}
        shellLink={link}
        shellChrome
      />
    );
  };
  mounted.push({ root, container });
  await act(async () => {
    root.render(<Harness />);
  });
  await act(async () => {});
  await act(async () => {});
  return link;
};

describe('PERF-CAD-SCENE.1 production SurveyCadWorkspace shell', () => {
  it('reuses the base scene on LAYER_RENAME with contour inputs present', async () => {
    const base = buildSurveyCadSpikeProject({
      input: SHELL_INPUT,
      instrumentLibrary: {},
      parseOptions: SHELL_PARSE_OPTIONS,
      units: 'm',
      result: null,
    });
    const project = replaceCadProjectEntities(base, base.entities);
    const layerId = project.layers[0]!.id;
    const link = await mountProductionShell(project);
    resetSpies();
    await act(async () => {
      expect(link.actions!.runLayerCommand({ key: 'LAYER_RENAME', layerId, name: 'shell-renamed' })).toBe(true);
    });
    expect(baseBuilds()).toBe(0);
    await act(async () => {
      expect(link.actions!.runLayerCommand({ key: 'LAYER_RENAME', layerId, name: 'shell-renamed-2' })).toBe(true);
    });
    expect(baseBuilds()).toBe(0);
    // A scene-relevant edit still rebuilds in the full shell.
    resetSpies();
    await act(async () => {
      expect(
        link.actions!.runLayerCommand({ key: 'LAYER_VISIBILITY', layerId, visible: false }),
      ).toBe(true);
    });
    expect(baseBuilds()).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// B. Negative controls: scene-relevant edits MUST rebuild
// ---------------------------------------------------------------------------

describe('PERF-CAD-SCENE.1 negative controls rebuild the base scene', () => {
  it('rebuilds for an entity geometry edit', async () => {
    const harness = await createHarness(lineProject(100));
    resetSpies();
    await harness.patchProject((current) =>
      replaceCadProjectEntities(
        current,
        current.entities.map((entity) =>
          entity.type === 'line' ? { ...entity, toX: entity.toX + 5 } : entity,
        ),
      ),
    );
    expect(baseBuilds()).toBeGreaterThanOrEqual(1);
    expectSceneParity(harness.api());
  });

  it('rebuilds for an entity visibility toggle', async () => {
    const harness = await createHarness(lineProject(100));
    resetSpies();
    await harness.patchProject((current) =>
      replaceCadProjectEntities(
        current,
        current.entities.map((entity, index) =>
          index === 0 ? { ...entity, visible: false } : entity,
        ),
      ),
    );
    expect(baseBuilds()).toBeGreaterThanOrEqual(1);
    expectSceneParity(harness.api());
  });

  it('rebuilds for layer OFF and FROZEN', async () => {
    const project = lineProject(50);
    const harness = await createHarness(project);
    const layerId = project.layers[0]!.id;
    for (const command of [
      { key: 'LAYER_VISIBILITY', layerId, visible: false } as const,
      { key: 'LAYER_FROZEN', layerId, frozen: true } as const,
    ]) {
      resetSpies();
      expect(await harness.commit(command)).toBe(true);
      expect(baseBuilds()).toBeGreaterThanOrEqual(1);
    }
    expectSceneParity(harness.api());
  });

  it('rebuilds for layer color / linetype / lineweight / transparency', async () => {
    const project = lineProject(50);
    const harness = await createHarness(project);
    const layerId = project.layers[0]!.id;
    const commands: CadCommand[] = [
      { key: 'LAYER_COLOR', layerId, color: '#123456' },
      { key: 'LAYER_LINETYPE', layerId, lineTypeId: 'dashed' },
      { key: 'LAYER_LINEWEIGHT', layerId, lineweightMm: 0.5 },
      { key: 'LAYER_TRANSPARENCY', layerId, transparency: 0.5 },
    ];
    for (const command of commands) {
      resetSpies();
      expect(await harness.commit(command)).toBe(true);
      expect(baseBuilds()).toBeGreaterThanOrEqual(1);
    }
  });

  it('rebuilds for conservatively out-of-scope layer fields (rename-only default)', async () => {
    const project = lineProject(50);
    const harness = await createHarness(project);
    const layerId = project.layers[0]!.id;
    const commands: CadCommand[] = [
      { key: 'LAYER_LOCKED', layerId, locked: true },
      { key: 'LAYER_PRINTABLE', layerId, printable: false },
      { key: 'LAYER_DESCRIPTION', layerId, description: 'note' },
      { key: 'LAYER_SET_CURRENT', layerId },
    ];
    for (const command of commands) {
      resetSpies();
      expect(await harness.commit(command)).toBe(true);
      expect(baseBuilds()).toBeGreaterThanOrEqual(1);
    }
  });

  it('rebuilds on undo/redo of a scene-relevant layer op', async () => {
    const project = lineProject(50);
    const harness = await createHarness(project);
    const layerId = project.layers[0]!.id;
    expect(await harness.commit({ key: 'LAYER_COLOR', layerId, color: '#abcdef' })).toBe(true);
    resetSpies();
    await harness.undo();
    expect(baseBuilds()).toBeGreaterThanOrEqual(1);
    resetSpies();
    await harness.redo();
    expect(baseBuilds()).toBeGreaterThanOrEqual(1);
  });

  it('rebuilds when every scene-relevant project slice gets a new reference', async () => {
    const project = mixedProject();
    const harness = await createHarness(project);
    const sliceMutations: Array<[_label: string, _edit: (_project: CadProject) => CadProject]> = [
      ['entities', (current) => ({ ...current, entities: [...current.entities] })],
      ['bounds', (current) => ({ ...current, bounds: current.bounds && { ...current.bounds } })],
      ['metadata', (current) => ({ ...current, metadata: { ...current.metadata } })],
      ['styleLibrary', (current) => ({ ...current, styleLibrary: { ...current.styleLibrary } })],
      ['pointStyles', (current) => ({ ...current, pointStyles: [...(current.pointStyles ?? [])] })],
      ['labelStyles', (current) => ({ ...current, labelStyles: [...(current.labelStyles ?? [])] })],
      ['pointGroups', (current) => ({ ...current, pointGroups: [...(current.pointGroups ?? [])] })],
      ['blockDefinitions', (current) => ({ ...current, blockDefinitions: [...(current.blockDefinitions ?? [])] })],
      ['dimensionStyles', (current) => ({ ...current, dimensionStyles: [...(current.dimensionStyles ?? [])] })],
      ['leaderStyles', (current) => ({ ...current, leaderStyles: [...(current.leaderStyles ?? [])] })],
      ['bearingLabelStyles', (current) => ({ ...current, bearingLabelStyles: [...(current.bearingLabelStyles ?? [])] })],
      ['curveLabelStyles', (current) => ({ ...current, curveLabelStyles: [...(current.curveLabelStyles ?? [])] })],
      ['annotationSettings', (current) => ({ ...current, annotationSettings: { scaleDenominator: 123 } })],
      ['linetypeScale', (current) => ({ ...current, linetypeScale: (current.linetypeScale ?? 1) + 1 })],
      ['surfaces', (current) => ({ ...current, surfaces: [...(current.surfaces ?? [])] })],
      ['surfaceStyles', (current) => ({ ...current, surfaceStyles: [...(current.surfaceStyles ?? [])] })],
      ['volumeSurfaces', (current) => ({ ...current, volumeSurfaces: [...(current.volumeSurfaces ?? [])] })],
      ['volumeSurfaceStyles', (current) => ({ ...current, volumeSurfaceStyles: [...(current.volumeSurfaceStyles ?? [])] })],
      ['analysisMaps', (current) => ({ ...current, analysisMaps: [...(current.analysisMaps ?? [])] })],
      ['analysisLegends', (current) => ({ ...current, analysisLegends: [...(current.analysisLegends ?? [])] })],
      ['surveyTableStyles', (current) => ({ ...current, surveyTableStyles: [...(current.surveyTableStyles ?? [])] })],
      ['cogoComputations', (current) => ({ ...current, cogoComputations: [...(current.cogoComputations ?? [])] })],
    ];
    for (const [label, edit] of sliceMutations) {
      resetSpies();
      await harness.replaceProject(edit(harness.api().cadProject));
      expect(baseBuilds(), label).toBeGreaterThanOrEqual(1);
    }
  });

  it('rebuilds on drawing switch even when the base scene shape matches', async () => {
    const project = lineProject(60);
    const harness = await createHarness(project, { drawingId: 'drawing-a' });
    resetSpies();
    const next = {
      ...createBlankCadDrawingDocument({ units: 'm' }),
      drawingId: 'drawing-b',
      project,
    };
    await harness.setDrawing(next);
    expect(baseBuilds()).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// C. Guard unit contract
// ---------------------------------------------------------------------------

describe('PERF-CAD-SCENE.1 guard unit contract', () => {
  const inputs: CadDisplaySceneBuildInputs = { lineweightDisplay: 'thin' };
  const emptyScene = (): CadDisplayScene => ({ bounds: null, primitives: [] });
  const entryFor = (
    project: CadProject,
    overrides: Partial<CadDisplaySceneBuildInputs> = {},
  ): CadDisplaySceneBaseCacheEntry => ({
    project,
    scene: emptyScene(),
    inputs: { ...inputs, ...overrides },
  });

  it('accepts a same-reference project and a layer-name-only rename', () => {
    const project = lineProject(10);
    expect(canReuseCadDisplaySceneBase(entryFor(project), project, inputs)).toBe(true);
    const renamed: CadProject = {
      ...project,
      layers: project.layers.map((layer, index) =>
        index === 0 ? { ...layer, name: 'renamed' } : layer,
      ),
    };
    expect(canReuseCadDisplaySceneBase(entryFor(project), renamed, inputs)).toBe(true);
  });

  it('rejects null/undefined entries', () => {
    expect(canReuseCadDisplaySceneBase(null, lineProject(1), inputs)).toBe(false);
    expect(canReuseCadDisplaySceneBase(undefined, lineProject(1), inputs)).toBe(false);
  });

  it('rejects any non-layer project slice changing reference', () => {
    const project = mixedProject();
    const mutations: Array<(_p: CadProject) => CadProject> = [
      (p) => ({ ...p, entities: [...p.entities] }),
      (p) => ({ ...p, bounds: p.bounds && { ...p.bounds } }),
      (p) => ({ ...p, metadata: { ...p.metadata } }),
      (p) => ({ ...p, styleLibrary: { ...p.styleLibrary } }),
      (p) => ({ ...p, surfaces: [...(p.surfaces ?? [])] }),
      (p) => ({ ...p, linetypeScale: 3 }),
    ];
    for (const mutate of mutations) {
      expect(canReuseCadDisplaySceneBase(entryFor(project), mutate(project), inputs)).toBe(false);
    }
  });

  it('rejects layer length, order, id, and non-name field changes', () => {
    const project = lineProject(5);
    const layerId = project.layers[0]!.id;
    const nonNameMutations: Array<(_p: CadProject) => CadProject> = [
      (p) => ({ ...p, layers: p.layers.map((l) => (l.id === layerId ? { ...l, color: '#010203' } : l)) }),
      (p) => ({ ...p, layers: p.layers.map((l) => (l.id === layerId ? { ...l, visible: false } : l)) }),
      (p) => ({ ...p, layers: p.layers.map((l) => (l.id === layerId ? { ...l, locked: true } : l)) }),
      (p) => ({ ...p, layers: p.layers.map((l) => (l.id === layerId ? { ...l, printable: false } : l)) }),
      (p) => ({ ...p, layers: p.layers.map((l) => (l.id === layerId ? { ...l, description: 'd' } : l)) }),
      (p) => ({ ...p, layers: [...p.layers, { ...p.layers[0]!, id: 'layer-extra', name: 'extra' }] }),
      (p) => ({ ...p, layers: [...p.layers].reverse() }),
      (p) => ({ ...p, layers: p.layers.map((l) => (l.id === layerId ? { ...l, id: 'layer-renamed-id' } : l)) }),
    ];
    for (const mutate of nonNameMutations) {
      expect(canReuseCadDisplaySceneBase(entryFor(project), mutate(project), inputs)).toBe(false);
    }
  });

  it('rejects a gain or loss of a top-level project key', () => {
    const project = lineProject(2);
    const gained = { ...project, extraSlice: [] } as unknown as CadProject;
    expect(canReuseCadDisplaySceneBase(entryFor(project), gained, inputs)).toBe(false);
    const { bounds: _dropped, ...withoutBounds } = project;
    expect(canReuseCadDisplaySceneBase(entryFor(project), withoutBounds as CadProject, inputs)).toBe(false);
  });

  it('rejects build-input reference changes (cache, revision index, lineweight)', () => {
    const project = lineProject(2);
    const withCache = entryFor(project, { surfaceCache: { cache: 1 } });
    expect(
      canReuseCadDisplaySceneBase(withCache, project, { ...inputs, surfaceCache: { cache: 2 } }),
    ).toBe(false);
    const withRevision = entryFor(project, { surfaceRevisionIndex: new Map([['s', ['r1']]]) });
    expect(
      canReuseCadDisplaySceneBase(withRevision, project, {
        ...inputs,
        surfaceRevisionIndex: new Map([['s', ['r2']]]),
      }),
    ).toBe(false);
    expect(
      canReuseCadDisplaySceneBase(entryFor(project), project, { lineweightDisplay: 'scaled' }),
    ).toBe(false);
  });

  it('accepts a version-stable contour/volume input but rejects a version bump or presence change', () => {
    const project = lineProject(2);
    const contour = { version: 7, getContours: () => null };
    const volume = { version: 2, tinCache: {}, volumeCache: {} };
    const entry = entryFor(project, { surfaceContourInputs: contour, surfaceVolumeInputs: volume });
    // Same version, new identity (the shell rebuilds the closure on a rename).
    expect(
      canReuseCadDisplaySceneBase(entry, project, {
        ...inputs,
        surfaceContourInputs: { version: 7, getContours: () => null },
        surfaceVolumeInputs: { version: 2, tinCache: {}, volumeCache: {} },
      }),
    ).toBe(true);
    // Version bump: contour/volume results may have changed.
    expect(
      canReuseCadDisplaySceneBase(entry, project, {
        ...inputs,
        surfaceContourInputs: { version: 8, getContours: () => null },
      }),
    ).toBe(false);
    // Presence change changes the scene shape (contour layers appear/vanish).
    expect(canReuseCadDisplaySceneBase(entry, project, inputs)).toBe(false);
    expect(
      canReuseCadDisplaySceneBase(entry, project, { ...inputs, surfaceContourInputs: contour }),
    ).toBe(false);
  });

  it('falsifiability: a loosened guard that ignores entities would pass an entity edit', () => {
    const project = lineProject(4);
    const moved = replaceCadProjectEntities(
      project,
      project.entities.map((entity) =>
        entity.type === 'line' ? { ...entity, toX: entity.toX + 1 } : entity,
      ),
    );
    // The real guard fails closed on the entity array reference.
    expect(canReuseCadDisplaySceneBase(entryFor(project), moved, inputs)).toBe(false);
    // A deliberately loosened guard (layer identity only, no slice check)
    // would return true — proving the negative control is falsifiable.
    const looseGuard = (previous: CadProject, next: CadProject): boolean =>
      previous.layers.length === next.layers.length &&
      previous.layers.every(
        (layer, index) =>
          layer.id === next.layers[index]!.id && layer.name === next.layers[index]!.name,
      );
    expect(looseGuard(project, moved)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. Benchmark (logged)
// ---------------------------------------------------------------------------

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
};

describe('PERF-CAD-SCENE.1 benchmark (logged)', () => {
  it('measures the saved base-build cost vs the guard overhead at 1k/10k', async () => {
    const ROUNDS = 5;
    for (const entityCount of [1_000, 10_000]) {
      const project = lineProject(entityCount);
      const layerId = project.layers[0]!.id;

      // BEFORE model: the uncached base build (the work the reuse skips) and
      // the filter (which BOTH paths still run).
      const buildMs: number[] = [];
      const filterMs: number[] = [];
      for (let round = 0; round < ROUNDS; round += 1) {
        const renamed: CadProject = {
          ...project,
          layers: project.layers.map((layer) =>
            layer.id === layerId ? { ...layer, name: `bench-before-${round}` } : layer,
          ),
        };
        const buildStart = performance.now();
        const scene = buildCadDisplayScene(renamed, { lineweightDisplay: 'thin' });
        buildMs.push(performance.now() - buildStart);
        const filterStart = performance.now();
        filterCadDisplaySceneForViewport(renamed, scene);
        filterMs.push(performance.now() - filterStart);
      }

      // Guard overhead model: same layer-name-only project pair.
      const renamed: CadProject = {
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId ? { ...layer, name: 'bench-guard' } : layer,
        ),
      };
      const guardEntry: CadDisplaySceneBaseCacheEntry = {
        project,
        scene: { bounds: null, primitives: [] },
        inputs: { lineweightDisplay: 'thin' },
      };
      const guardMs: number[] = [];
      for (let round = 0; round < 200; round += 1) {
        const start = performance.now();
        canReuseCadDisplaySceneBase(guardEntry, renamed, { lineweightDisplay: 'thin' });
        guardMs.push(performance.now() - start);
      }

      // AFTER: real hook rename commit through the workspace.
      const harness = await createHarness(project);
      for (let warmup = 0; warmup < 2; warmup += 1) {
        await harness.commit(renameCommand(layerId, `warmup-${warmup}`));
        await harness.undo();
      }
      const hookMs: number[] = [];
      let buildCalls = 0;
      for (let round = 0; round < ROUNDS; round += 1) {
        resetSpies();
        const start = performance.now();
        await harness.commit(renameCommand(layerId, `bench-${entityCount}-${round}`));
        hookMs.push(performance.now() - start);
        buildCalls += baseBuilds();
      }

      // Geometry-invalidation regression check at the same size.
      resetSpies();
      const geometryStart = performance.now();
      await harness.patchProject((current) =>
        replaceCadProjectEntities(
          current,
          current.entities.map((entity) =>
            entity.type === 'line' ? { ...entity, toY: entity.toY + 1 } : entity,
          ),
        ),
      );
      const geometryMs = performance.now() - geometryStart;
      const geometryBuilds = baseBuilds();

      console.log(
        `[PERF-CAD-SCENE.1] entities=${entityCount} rounds=${ROUNDS} ` +
          `BEFORE build=${median(buildMs).toFixed(2)}ms filter=${median(filterMs).toFixed(2)}ms ` +
          `AFTER hookRename=${median(hookMs).toFixed(2)}ms (variability ${(
            Math.max(...hookMs) - Math.min(...hookMs)
          ).toFixed(2)}ms) ` +
          `guard=${median(guardMs).toFixed(4)}ms/check ` +
          `netSavingPerRename~${(median(buildMs) - median(guardMs)).toFixed(2)}ms ` +
          `renameBuilds=${buildCalls} ` +
          `geometryRebuild=${geometryMs.toFixed(2)}ms builds=${geometryBuilds}`,
      );

      // Renames never rebuild the base scene.
      expect(buildCalls).toBe(0);
      // The skipped build is materially more expensive than the guard.
      expect(median(buildMs)).toBeGreaterThan(median(guardMs));
      // Geometry invalidation still rebuilds (unregressed correctness).
      expect(geometryBuilds).toBeGreaterThanOrEqual(1);
    }
  }, 60_000);
});
