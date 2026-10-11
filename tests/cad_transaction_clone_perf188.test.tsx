/** @vitest-environment jsdom */
/**
 * PERF-188 (#188) — redundant CAD drawing-document clone elimination.
 *
 * Corrections (P1/P2 review of PR #262):
 *
 *  - The persistence path keeps its original clone-then-compare shape. The
 *    pre-clone raw `buildCadProjectSignature` early return was removed because
 *    the drawing clone is NOT a key-order-only normalization: `cloneCadProject`
 *    sets `version: 2`, defaults `cogoComputations`, migrates legacy surface
 *    point sources (`pointGroupId` -> `pointGroupIds`), sanitizes surface
 *    purpose, and rebuilds nested key order; the drawing clone also
 *    re-sanitizes the draft. A controlled/legacy drawing can be raw-equal to
 *    `cadProject` yet still need that normalization on publish.
 *  - The `useSurveyCadWorkspace` wrapper's reference-based no-op guard is
 *    retained: selection-only and rejected-command updates publish nothing.
 *    PERF-188.2 adds a per-workspace provenance certificate: the wrapper's
 *    ownership-boundary clone is recorded (identity only) and the persistence
 *    sync skips its second normalization clone when it certifies the current
 *    document. Real commit/undo/redo therefore clone once, not twice; every
 *    no-op path still drops to zero.
 *
 * This suite drives the REAL hooks through a `react-dom/client` probe (the
 * established workspace harness) with a module-level `vi.mock` that actually
 * intercepts the hook's own imports of `cloneCadDrawingDocument` /
 * `cloneCadProject`. The zero-clone assertions are negative controls: the
 * pre-#262 code produced at least one clone on each such path, and the
 * unsafe early return produced zero normalization clones where one is owed.
 *
 * Covered: (a) mount, (b) successful commit, (c) undo, (d) redo,
 * (e) no-op / selection-only, (f) persistence rerender no-change,
 * (g) genuine external project update, (h) drawing-switch stale callback,
 * (i) legacy `onPersistedStateChange` fallback, (j) controlled mode,
 * (k) LandXML imported-TIN clone + undo, (l) draft/plotFrame:false +
 * parcelLayout/showParcelLabels propagation, (m) controlled legacy surface
 * `pointGroupId` normalization, (n) key-reordered imported-TIN normalization,
 * plus deep-value snapshot invariants and a clone-count / elapsed perf sample
 * (logged, never gated).
 */
import { readFileSync } from 'node:fs';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cloneSpy = vi.hoisted(() => ({ drawing: 0, project: 0 }));

vi.mock('../src/engine/cad/cadDrawingFile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadDrawingFile')>();
  return {
    ...actual,
    cloneCadDrawingDocument: (
      ...args: Parameters<typeof actual.cloneCadDrawingDocument>
    ) => {
      cloneSpy.drawing += 1;
      return actual.cloneCadDrawingDocument(...args);
    },
  };
});

// `cloneCadDrawingDocument` reaches `cloneCadProject` through the real
// module-local import, so mocking the owning module intercepts every nested
// full-project clone as well.
vi.mock('../src/engine/cad/cadPersistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadPersistence')>();
  return {
    ...actual,
    cloneCadProject: (...args: Parameters<typeof actual.cloneCadProject>) => {
      cloneSpy.project += 1;
      return actual.cloneCadProject(...args);
    },
  };
});

import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
} from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument, createDraftSheet } from '../src/engine/cad/cadDraftTypes';
import {
  buildCadProjectSignature,
  replaceCadProjectEntities,
} from '../src/engine/cad/cadProjectState';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import {
  buildLandXmlImportCommitPayload,
  createLandXmlImportReviewSelection,
} from '../src/components/landXmlImportReview/landXmlImportReview.selection';
import {
  DEFAULT_PARCEL_LAYOUT_SETTINGS,
  DEFAULT_PARCEL_LAYOUT_UI_STATE,
} from '../src/components/surveyCadWorkspaceParcelLayout';
import { useSurveyCadDrawingSource } from '../src/hooks/surveyCad/useSurveyCadDrawingSource';
import { useSurveyCadWorkspace } from '../src/hooks/surveyCad/useSurveyCadWorkspace';
import type { UseSurveyCadWorkspaceResult } from '../src/hooks/surveyCad/useSurveyCadWorkspace.types';
import type {
  CadDrawingDocument,
  CadEntity,
  CadParcelLayoutUiState,
  CadProject,
  CadSurface,
  SurveyCadPersistedState,
} from '../src/engine/cad/cadTypes';
import type { DraftDocument } from '../src/engine/cad/cadDraftTypes';
import type { InstrumentLibrary } from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPTY_INSTRUMENT_LIBRARY: InstrumentLibrary = {};
const XML = readFileSync('tests/fixtures/landxml-18m-production.xml', 'utf8');

interface CloneCounts {
  drawing: number;
  project: number;
}

const resetClones = (): void => {
  cloneSpy.drawing = 0;
  cloneSpy.project = 0;
};

const clones = (): CloneCounts => ({ drawing: cloneSpy.drawing, project: cloneSpy.project });

const deepValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const lineEntity = (index: number, layerId: string): CadEntity => ({
  id: `line:${index}`,
  type: 'line',
  layerId,
  visible: true,
  locked: false,
  fromStationId: `A${index}`,
  toStationId: `B${index}`,
  fromX: index,
  fromY: 0,
  toX: index,
  toY: 1,
  sourceObservationIds: [index],
});

const buildProjectWithEntities = (entityCount: number): CadProject => {
  const base = createBlankCadProject({ name: `perf188-${entityCount}`, units: 'm' });
  const layerId = base.layers[0]!.id;
  const entities: CadEntity[] = [];
  for (let index = 0; index < entityCount; index += 1) {
    entities.push(lineEntity(index, layerId));
  }
  return replaceCadProjectEntities(base, entities);
};

const buildDraftWithPlotFrame = (project: CadProject, plotFrame: boolean): DraftDocument => {
  const blank = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  const sheet = createDraftSheet({ name: 'Sheet 1' });
  return {
    ...blank,
    sheets: [
      {
        ...sheet,
        viewports: [
          {
            id: 'draft-viewport:test',
            name: 'Viewport',
            modelCenterX: 0,
            modelCenterY: 0,
            scaleDenominator: 1000,
            paperXmm: 10,
            paperYmm: 10,
            paperWidthMm: 100,
            paperHeightMm: 100,
            rotationDeg: 0,
            plotFrame,
          },
        ],
      },
    ],
  };
};

const buildDrawing = (
  project?: CadProject,
  overrides: Partial<CadDrawingDocument> = {},
): CadDrawingDocument => ({
  ...createBlankCadDrawingDocument({ units: 'm' }),
  ...(project ? { project } : {}),
  ...overrides,
});

/**
 * A supported legacy point source (`pointGroupId`) as permitted by
 * `CadSurfacePointSource`. `cloneCadSurfaceDefinition` migrates it to the
 * canonical one-element `pointGroupIds` list, so a raw project signature is
 * NOT normalization-stable.
 */
const legacyPointGroupSurfaceProject = (): CadProject => {
  const base = buildProjectWithEntities(2);
  const surface: CadSurface = {
    id: 'surface:legacy-point-group',
    name: 'Legacy Point Group Surface',
    definition: { pointSource: { kind: 'point-group', pointGroupId: 'g1' } },
  };
  return { ...base, surfaces: [surface] };
};

/**
 * An imported-TIN surface with deliberately non-canonical key order
 * (`pointSource` before `importedTin`; the TIN payload keys reversed).
 * `cloneCadSurfaceDefinition` rebuilds both, so raw equality does not imply
 * normalization stability.
 */
const reorderedImportedTinSurfaceProject = (): CadProject => {
  const base = buildProjectWithEntities(2);
  const surface = {
    id: 'surface:reordered-tin',
    name: 'Reordered Imported TIN',
    definition: {
      pointSource: { kind: 'points', pointEntityIds: [] },
      importedTin: {
        provenance: {
          kind: 'webnet-bake',
          sourceSurfaceId: 'seed',
          sourceSurfaceName: 'seed',
          sourceRevision: 'srev1:seed',
        },
        faces: [0, 1, 2],
        vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      },
    },
  } as unknown as CadSurface;
  return { ...base, surfaces: [surface] };
};

const parcelLayoutSnapshot = (
  overrides: Partial<CadParcelLayoutUiState> = {},
): CadParcelLayoutUiState => ({
  ...DEFAULT_PARCEL_LAYOUT_UI_STATE,
  settings: { ...DEFAULT_PARCEL_LAYOUT_SETTINGS },
  ...overrides,
});

const commitPayload = () => {
  const preview = buildLandXmlImportPreview(XML, { fileName: 'landxml-18m-production.xml' });
  return buildLandXmlImportCommitPayload({
    drawingId: 'test-drawing',
    fileName: 'landxml-18m-production.xml',
    version: '1.2',
    preview,
    selection: createLandXmlImportReviewSelection(preview),
  });
};

const renameLayer = (api: UseSurveyCadWorkspaceResult, layerId: string, name: string): boolean =>
  api.runLayerCommand({ key: 'LAYER_RENAME', layerId, name });

// ---------------------------------------------------------------------------
// Controlled-mode harness mirroring the /cad shell wiring (parent owns the
// drawing document; the workspace owns history and writes through
// `onProjectChange`).
// ---------------------------------------------------------------------------

interface ControlledHarness {
  api: () => UseSurveyCadWorkspaceResult;
  drawing: () => CadDrawingDocument;
  renders: () => number;
  setDrawing: (_doc: CadDrawingDocument) => Promise<void>;
  patchProject: (_edit: (_project: CadProject) => CadProject) => Promise<void>;
  setParcelLayout: (_state: CadParcelLayoutUiState | undefined) => Promise<void>;
  setShowLabels: (_value: boolean) => Promise<void>;
  bump: () => Promise<void>;
  settle: () => Promise<void>;
  unmount: () => Promise<void>;
}

const createControlledHarness = async (
  initial: CadDrawingDocument,
  options: {
    parcelLayout?: CadParcelLayoutUiState;
    showLabels?: boolean;
    withSurfaceCache?: boolean;
  } = {},
): Promise<ControlledHarness> => {
  const controls: {
    api: UseSurveyCadWorkspaceResult | null;
    drawing: CadDrawingDocument;
    renders: number;
    setDrawing: React.Dispatch<React.SetStateAction<CadDrawingDocument | null>> | null;
    setParcelLayout: React.Dispatch<React.SetStateAction<CadParcelLayoutUiState | undefined>> | null;
    setShowLabels: React.Dispatch<React.SetStateAction<boolean>> | null;
    setBump: React.Dispatch<React.SetStateAction<number>> | null;
  } = {
    api: null,
    drawing: initial,
    renders: 0,
    setDrawing: null,
    setParcelLayout: null,
    setShowLabels: null,
    setBump: null,
  };

  const Inner: React.FC<{
    drawing: CadDrawingDocument;
    parcelLayout: CadParcelLayoutUiState | undefined;
    showLabels: boolean;
    onProjectChange: React.Dispatch<React.SetStateAction<CadDrawingDocument | null>>;
  }> = ({ drawing, parcelLayout, showLabels, onProjectChange }) => {
    const surfaceCache = React.useMemo(
      () => (options.withSurfaceCache ? createCadSurfaceCache(drawing.drawingId) : undefined),
      [drawing.drawingId],
    );
    const ws = useSurveyCadWorkspace(
      drawing.project,
      drawing.drawingId,
      onProjectChange,
      drawing,
      parcelLayout,
      showLabels,
      false,
      'thin',
      surfaceCache,
    );
    React.useEffect(() => {
      controls.api = ws;
      controls.renders += 1;
    });
    return null;
  };

  const Probe: React.FC = () => {
    const [drawing, setDrawing] = React.useState<CadDrawingDocument | null>(initial);
    const [parcelLayout, setParcelLayout] = React.useState<CadParcelLayoutUiState | undefined>(
      options.parcelLayout,
    );
    const [showLabels, setShowLabels] = React.useState(options.showLabels ?? true);
    const [bump, setBump] = React.useState(0);
    void bump;
    React.useEffect(() => {
      controls.setDrawing = setDrawing;
      controls.setParcelLayout = setParcelLayout;
      controls.setShowLabels = setShowLabels;
      controls.setBump = setBump;
      controls.drawing = drawing ?? initial;
    }, [drawing]);
    if (!drawing) return null;
    return (
      <Inner
        drawing={drawing}
        parcelLayout={parcelLayout}
        showLabels={showLabels}
        onProjectChange={setDrawing}
      />
    );
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(<Probe />);
  });

  return {
    api: () => controls.api!,
    drawing: () => controls.drawing,
    renders: () => controls.renders,
    setDrawing: async (doc) => {
      await act(async () => {
        controls.setDrawing!(doc);
      });
    },
    patchProject: async (edit) => {
      await act(async () => {
        controls.setDrawing!((previous) =>
          previous ? { ...previous, updatedAt: new Date().toISOString(), project: edit(previous.project) } : previous,
        );
      });
    },
    setParcelLayout: async (state) => {
      await act(async () => {
        controls.setParcelLayout!(state);
      });
    },
    setShowLabels: async (value) => {
      await act(async () => {
        controls.setShowLabels!(value);
      });
    },
    bump: async () => {
      await act(async () => {
        controls.setBump!((value) => value + 1);
      });
    },
    settle: async () => {
      await act(async () => {});
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

// ---------------------------------------------------------------------------
// Legacy-mode harness: `persistedState` + `onPersistedStateChange` fallback
// (no controlled drawing prop), exactly like the embedded shell fallback.
// ---------------------------------------------------------------------------

interface LegacyHarness {
  api: () => UseSurveyCadWorkspaceResult;
  persisted: () => SurveyCadPersistedState | null;
  setPersisted: (_state: SurveyCadPersistedState | null) => Promise<void>;
  settle: () => Promise<void>;
  unmount: () => Promise<void>;
}

const createLegacyHarness = async (
  initial: SurveyCadPersistedState | null,
): Promise<LegacyHarness> => {
  const controls: {
    api: UseSurveyCadWorkspaceResult | null;
    persisted: SurveyCadPersistedState | null;
    setPersisted: React.Dispatch<React.SetStateAction<SurveyCadPersistedState | null>> | null;
  } = { api: null, persisted: initial, setPersisted: null };

  const Inner: React.FC<{
    persistedState: SurveyCadPersistedState | null;
    onPersistedStateChange: React.Dispatch<React.SetStateAction<SurveyCadPersistedState | null>>;
  }> = ({ persistedState, onPersistedStateChange }) => {
    const { activeDrawing, emitDrawingChange } = useSurveyCadDrawingSource({
      persistedState,
      onPersistedStateChange,
      input: '',
      instrumentLibrary: EMPTY_INSTRUMENT_LIBRARY,
      units: 'm',
      canFeedDraftingFromResult: false,
    });
    const ws = useSurveyCadWorkspace(
      activeDrawing.project,
      activeDrawing.drawingId,
      emitDrawingChange,
      activeDrawing,
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
    const [persisted, setPersisted] = React.useState<SurveyCadPersistedState | null>(initial);
    React.useEffect(() => {
      controls.setPersisted = setPersisted;
      controls.persisted = persisted;
    }, [persisted]);
    return <Inner persistedState={persisted} onPersistedStateChange={setPersisted} />;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(<Probe />);
  });

  return {
    api: () => controls.api!,
    persisted: () => controls.persisted,
    setPersisted: async (state) => {
      await act(async () => {
        controls.setPersisted!(state);
      });
    },
    settle: async () => {
      await act(async () => {});
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

beforeEach(() => {
  resetClones();
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  vi.restoreAllMocks();
  resetClones();
});

// ---------------------------------------------------------------------------
// Behaviour + clone budget
// ---------------------------------------------------------------------------

describe('PERF-188 clone budget', () => {
  it('(a) mount normalizes once through the persistence sync (spy armed before mount)', async () => {
    const project = buildProjectWithEntities(3);
    // The spy is intentionally NOT reset after mount: this observes the real
    // mount cost. The wrapper's no-op guard never runs on mount; the
    // persistence sync normalizes the drawing once (one drawing clone + its
    // nested project clone). The pre-#262 path cloned here too, so the
    // corrected code matches that baseline.
    const harness = await createControlledHarness(buildDrawing(project));

    expect(harness.api().cadProject).toBe(project);
    expect(clones().drawing).toBe(1);
    expect(clones().project).toBe(1);
  });

  it('(b) a successful commit clones once (wrapper publish; certified sync skips)', async () => {
    const project = buildProjectWithEntities(5);
    const harness = await createControlledHarness(buildDrawing(project));
    const layerId = project.layers[0]!.id;
    resetClones();

    await act(async () => {
      expect(renameLayer(harness.api(), layerId, 'renamed-once')).toBe(true);
    });

    // PERF-188.2: the wrapper publishes the committed project and records the
    // provenance certificate; the persistence sync recognizes the published
    // document as its own normalized output and skips the redundant clone.
    const counts = clones();
    expect(counts.drawing).toBe(1);
    expect(counts.project).toBe(1);
    expect(harness.api().historyDepth).toBe(1);
    expect(harness.drawing().project.layers[0]!.name).toBe('renamed-once');
  });

  it('(c) undo clones once and restores the pre-commit project deeply', async () => {
    const project = buildProjectWithEntities(5);
    const harness = await createControlledHarness(buildDrawing(project));
    const layerId = project.layers[0]!.id;
    await act(async () => {
      renameLayer(harness.api(), layerId, 'renamed-undo');
    });
    resetClones();

    await act(async () => {
      harness.api().undo();
    });

    expect(clones().drawing).toBe(1);
    expect(harness.api().historyDepth).toBe(0);
    expect(harness.api().canRedo).toBe(true);
    expect(deepValue(harness.api().cadProject)).toEqual(deepValue(project));
    expect(deepValue(harness.drawing().project)).toEqual(deepValue(project));
  });

  it('(d) redo clones once and restores the committed project deeply', async () => {
    const project = buildProjectWithEntities(5);
    const harness = await createControlledHarness(buildDrawing(project));
    const layerId = project.layers[0]!.id;
    await act(async () => {
      renameLayer(harness.api(), layerId, 'renamed-redo');
    });
    const committed = deepValue(harness.api().cadProject);
    await act(async () => {
      harness.api().undo();
    });
    resetClones();

    await act(async () => {
      harness.api().redo();
    });

    expect(clones().drawing).toBe(1);
    expect(harness.api().historyDepth).toBe(1);
    expect(deepValue(harness.api().cadProject)).toEqual(committed);
    expect(deepValue(harness.drawing().project)).toEqual(committed);
  });

  it('(e) selection-only and rejected-command updates clone zero times', async () => {
    const project = buildProjectWithEntities(3);
    const harness = await createControlledHarness(buildDrawing(project));
    const [firstEntity, secondEntity] = project.entities;
    await harness.settle();
    resetClones();

    // Selection-only history update: the project identity is untouched, so
    // there is nothing for the drawing document to publish.
    await act(async () => {
      harness.api().selectEntity(secondEntity!.id);
    });
    expect(harness.api().selectedEntityIds).toEqual([secondEntity!.id]);
    expect(clones().drawing).toBe(0);
    expect(clones().project).toBe(0);

    // Rejected command: `runCadCommand` returns `current`, so the wrapper's
    // updater is a true identity no-op. A missing layer id makes the command
    // engine reject deterministically.
    resetClones();
    await act(async () => {
      expect(renameLayer(harness.api(), 'layer:missing', 'nope')).toBe(false);
    });
    expect(clones().drawing).toBe(0);
    expect(clones().project).toBe(0);

    // Sanity: a real commit still clones (proves the counter is live).
    resetClones();
    await act(async () => {
      expect(renameLayer(harness.api(), project.layers[0]!.id, 'renamed-live')).toBe(true);
    });
    expect(clones().drawing).toBe(1);
    expect(harness.api().selectedEntityIds).toEqual([secondEntity!.id]);
    expect(firstEntity).toBe(project.entities[0]);
  });

  it('(f) a persistence effect re-run with canonical equal content clones once (normalization sync)', async () => {
    const project = buildProjectWithEntities(4);
    const initialLayout = parcelLayoutSnapshot();
    const harness = await createControlledHarness(buildDrawing(project), {
      parcelLayout: initialLayout,
    });
    await harness.settle();
    resetClones();

    // New object identity, identical content: the effect re-runs and the
    // persistence normalization clone runs even though the result is
    // discarded (raw equality cannot prove the target is already canonical).
    await harness.setParcelLayout(parcelLayoutSnapshot());
    await harness.settle();

    expect(clones().drawing).toBe(1);
    expect(clones().project).toBe(1);
    expect(harness.drawing().parcelLayout).toEqual(initialLayout);
  });

  it('(g) a genuine external project update adopts and normalizes through the sync', async () => {
    const project = buildProjectWithEntities(4);
    const harness = await createControlledHarness(buildDrawing(project));
    await harness.settle();
    resetClones();

    const external = replaceCadProjectEntities(project, [
      ...project.entities,
      lineEntity(99, project.layers[0]!.id),
    ]);
    await harness.patchProject(() => external);
    await harness.settle();

    expect(harness.api().cadProject).toBe(external);
    expect(clones().drawing).toBe(1);
    expect(harness.api().historyDepth).toBe(0);
  });

  it('(h) a stale callback after a drawing switch cannot leak the old drawing', async () => {
    const baseA = buildProjectWithEntities(3);
    const staleLayerId = 'layer:perf188-stale-only';
    const projectA: CadProject = {
      ...baseA,
      layers: [
        ...baseA.layers,
        {
          id: staleLayerId,
          name: 'Stale Only',
          color: '#ffffff',
          visible: true,
          locked: false,
          printable: true,
          role: 'planning',
        },
      ],
    };
    const harness = await createControlledHarness(buildDrawing(projectA));
    const staleApi = harness.api();

    const projectB = buildProjectWithEntities(3);
    const drawingB = buildDrawing(projectB);
    await harness.setDrawing(drawingB);
    await harness.settle();
    const before = harness.drawing();
    resetClones();

    // The stale closure carries drawing A's id (and a layer that only exists
    // in A). Invoking it after the switch is rejected, so neither the
    // drawingId guard nor the persistence sync writes anything.
    await act(async () => {
      staleApi.runLayerCommand({ key: 'LAYER_RENAME', layerId: staleLayerId, name: 'stale-write' });
    });
    await harness.settle();

    expect(harness.drawing()).toBe(before);
    expect(harness.drawing().drawingId).toBe(drawingB.drawingId);
    expect(deepValue(harness.drawing().project)).toEqual(deepValue(projectB));
    expect(deepValue(harness.drawing().project)).not.toEqual(deepValue(projectA));
    expect(clones().drawing).toBe(0);
  });

  it('(i) the legacy persisted-state fallback stays coherent (key-order normalization clone quantified)', async () => {
    const harness = await createLegacyHarness(null);
    const layerId = harness.api().cadProject.layers[0]!.id;
    await harness.settle();
    resetClones();

    await act(async () => {
      expect(renameLayer(harness.api(), layerId, 'legacy-renamed')).toBe(true);
    });

    // Legacy round-trip: the migrated drawing project is key-order-different
    // from the raw history project, so the persistence sync clones once to
    // normalize (and discards the equal result) on addition to the wrapper
    // publish: 3 total, the pre-#262 baseline. The persisted state must still
    // reflect the committed project exactly. (Legacy round-trips also reset
    // the workspace history baseline; that is pre-existing behavior,
    // independent of this optimization.)
    const counts = clones();
    expect(counts.drawing).toBe(3);
    expect(harness.persisted()?.project.layers[0]!.name).toBe('legacy-renamed');
    expect(harness.api().cadProject.layers[0]!.name).toBe('legacy-renamed');
  });

  it('(j) controlled mode: the hook never mutates the parent document in place', async () => {
    const project = buildProjectWithEntities(3);
    const parentDrawing = buildDrawing(project);
    const harness = await createControlledHarness(parentDrawing);
    const layerId = project.layers[0]!.id;
    resetClones();

    await act(async () => {
      renameLayer(harness.api(), layerId, 'controlled-renamed');
    });

    // The parent object is untouched; a fresh document was published.
    expect(parentDrawing.project.layers[0]!.name).not.toBe('controlled-renamed');
    expect(harness.drawing()).not.toBe(parentDrawing);
    expect(harness.drawing().project).not.toBe(parentDrawing.project);
  });

  it('(k) LandXML import + undo keeps the transaction (imported-TIN key-order clone quantified)', async () => {
    const initial = createBlankCadDrawingDocument({ units: 'm' });
    const harness = await createControlledHarness(initial, { withSurfaceCache: true });
    await harness.settle();
    resetClones();

    await act(async () => {
      const payload = commitPayload();
      harness.api().runLandXmlImport(payload.preview, payload.fileName, payload.commitSelection);
    });

    // The imported-TIN definition normalizes its key order on the wrapper
    // clone, which is certified, so the persistence sync skips: 1 clone. Undo
    // returns to the canonical blank project and likewise pays only the wrapper
    // clone; redo re-imports and pays it once.
    const afterCommit = clones();
    expect(afterCommit.drawing).toBe(1);
    expect(harness.api().historyDepth).toBe(1);
    expect(harness.api().canUndo).toBe(true);
    expect(harness.api().cadProject.entities).toHaveLength(6);
    expect(harness.api().cadProject.surfaces).toHaveLength(1);

    resetClones();
    await act(async () => {
      harness.api().undo();
    });
    expect(clones().drawing).toBe(1);
    expect(harness.api().historyDepth).toBe(0);
    expect(harness.api().canRedo).toBe(true);
    expect(harness.api().cadProject.entities).toHaveLength(0);

    resetClones();
    await act(async () => {
      harness.api().redo();
    });
    expect(clones().drawing).toBe(1);
    expect(harness.api().historyDepth).toBe(1);
    expect(harness.api().cadProject.entities).toHaveLength(6);
  });

  it('(l) draft plotFrame:false survives a commit; layout/labels propagate', async () => {
    const project = buildProjectWithEntities(3);
    const draft = buildDraftWithPlotFrame(project, false);
    const harness = await createControlledHarness(buildDrawing(project, { draft }), {
      parcelLayout: parcelLayoutSnapshot({ open: false }),
      showLabels: true,
    });
    await harness.settle();

    await act(async () => {
      renameLayer(harness.api(), project.layers[0]!.id, 'draft-commit');
    });
    const committedViewport = harness.drawing().draft?.sheets[0]?.viewports[0];
    expect(committedViewport?.plotFrame).toBe(false);

    // parcelLayout propagation (new value -> one real write).
    resetClones();
    await harness.setParcelLayout(parcelLayoutSnapshot({ open: true }));
    await harness.settle();
    expect(clones().drawing).toBe(1);
    expect(harness.drawing().parcelLayout?.open).toBe(true);

    // showParcelLabels propagation (new value -> one real write).
    resetClones();
    await harness.setShowLabels(false);
    await harness.settle();
    expect(clones().drawing).toBe(1);
    expect(harness.drawing().showParcelLabels).toBe(false);
  });

  it('(m) a controlled legacy pointGroupId surface normalizes on the persistence boundary (idempotent, no history wipe)', async () => {
    const project = legacyPointGroupSurfaceProject();
    const harness = await createControlledHarness(buildDrawing(project));
    await harness.settle();

    // The raw project was NOT normalization-stable: the published drawing
    // must carry the canonical one-element list, not the legacy single id.
    const source = harness.drawing().project.surfaces![0]!.definition.pointSource;
    expect(source).toEqual({ kind: 'point-group', pointGroupIds: ['g1'] });
    expect('pointGroupId' in source).toBe(false);

    // Idempotent: once normalized, rerenders do not re-publish the document.
    const settled = harness.drawing();
    await harness.settle();
    await harness.bump();
    await harness.settle();
    expect(harness.drawing()).toBe(settled);

    // No history wipe: a real commit keeps exactly one undo entry and the
    // normalized shape survives it.
    await act(async () => {
      expect(renameLayer(harness.api(), project.layers[0]!.id, 'legacy-commit')).toBe(true);
    });
    expect(harness.api().historyDepth).toBe(1);
    expect(harness.api().canUndo).toBe(true);
    expect(harness.drawing().project.surfaces![0]!.definition.pointSource).toEqual({
      kind: 'point-group',
      pointGroupIds: ['g1'],
    });
  });

  it('(n) a controlled key-reordered imported-TIN normalizes on the persistence boundary', async () => {
    const project = reorderedImportedTinSurfaceProject();
    // Sanity: the input really is non-canonically ordered.
    expect(Object.keys(project.surfaces![0]!.definition)).toEqual(['pointSource', 'importedTin']);

    const harness = await createControlledHarness(buildDrawing(project));
    await harness.settle();

    // Pre-#262 baseline: the persistence clone rebuilds nested key order.
    const publishedDefinition = harness.drawing().project.surfaces![0]!.definition;
    expect(Object.keys(publishedDefinition)).toEqual(['importedTin', 'pointSource']);
    expect(Object.keys(publishedDefinition.importedTin!)).toEqual([
      'vertices',
      'faces',
      'provenance',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Deep-value invariants: no history-snapshot alias corruption.
// ---------------------------------------------------------------------------

describe('PERF-188 snapshot isolation', () => {
  it('repeated edits + undo/redo preserve every historical snapshot deeply', async () => {
    const project0 = buildProjectWithEntities(6);
    const harness = await createControlledHarness(buildDrawing(project0));
    const layerId = project0.layers[0]!.id;

    await act(async () => {
      renameLayer(harness.api(), layerId, 'snap-one');
    });
    const project1 = deepValue(harness.api().cadProject);

    await act(async () => {
      renameLayer(harness.api(), layerId, 'snap-two');
    });
    const project2 = deepValue(harness.api().cadProject);
    expect(project2).not.toEqual(project1);

    await act(async () => {
      harness.api().undo();
    });
    expect(deepValue(harness.api().cadProject)).toEqual(project1);
    expect(deepValue(harness.drawing().project)).toEqual(project1);

    await act(async () => {
      harness.api().undo();
    });
    expect(deepValue(harness.api().cadProject)).toEqual(deepValue(project0));
    expect(deepValue(harness.drawing().project)).toEqual(deepValue(project0));

    await act(async () => {
      harness.api().redo();
    });
    expect(deepValue(harness.api().cadProject)).toEqual(project1);

    await act(async () => {
      harness.api().redo();
    });
    expect(deepValue(harness.api().cadProject)).toEqual(project2);
  });

  it('the drawing document and history project stay value-equal after every commit', async () => {
    const project = buildProjectWithEntities(4);
    const harness = await createControlledHarness(buildDrawing(project));
    const layerId = project.layers[0]!.id;

    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        renameLayer(harness.api(), layerId, `equal-${index}`);
      });
      await harness.settle();
      expect(buildCadProjectSignature(harness.drawing().project)).toBe(
        buildCadProjectSignature(harness.api().cadProject),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Negative controls: the pre-fix behavior is observable and over-budget.
// ---------------------------------------------------------------------------

describe('PERF-188 negative controls', () => {
  it('the unoptimized pattern (clone before compare) records a clone on a no-op keep', async () => {
    const project = buildProjectWithEntities(4);
    const harness = await createControlledHarness(buildDrawing(project));

    // Model the original persistence path: clone first, compare after. The
    // spy records it even though the clone would be discarded.
    resetClones();
    const drawing = harness.drawing();
    const { cloneCadDrawingDocument: cloneDrawing } =
      await import('../src/engine/cad/cadDrawingFile');
    const discarded = cloneDrawing({ ...drawing, project });
    expect(discarded).not.toBe(drawing);
    expect(clones().drawing).toBeGreaterThan(0);

    // The optimized hook path for the same no-op keeps the clone at zero.
    resetClones();
    await act(async () => {
      renameLayer(harness.api(), 'layer:missing', 'nope');
    });
    expect(clones().drawing).toBe(0);
  });

  it('(a)-(d) budget sensitivity: a genuine commit does clone, so 0-budgets are meaningful', async () => {
    const project = buildProjectWithEntities(4);
    const harness = await createControlledHarness(buildDrawing(project));
    resetClones();
    await act(async () => {
      renameLayer(harness.api(), project.layers[0]!.id, 'budget-liveness');
    });
    expect(clones().drawing).toBe(1);
    expect(() => expect(clones().drawing).toBe(0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Perf sample: clone counts + median elapsed per path (log only, no gates).
// ---------------------------------------------------------------------------

interface TimingSample {
  label: string;
  entityCount: number;
  iterations: number;
}

const summarize = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

describe('PERF-188 clone/time sample (logged)', () => {
  it('measures commit/undo/redo/no-op across 1k/10k entity fixtures', async () => {
    const samples: TimingSample[] = [
      { label: '1k', entityCount: 1_000, iterations: 5 },
      { label: '10k', entityCount: 10_000, iterations: 2 },
    ];

    for (const sample of samples) {
      // Fixtures are prebuilt OUTSIDE every timed window.
      const project = buildProjectWithEntities(sample.entityCount);
      const harness = await createControlledHarness(buildDrawing(project));
      const layerId = project.layers[0]!.id;

      const commitTimes: number[] = [];
      const undoTimes: number[] = [];
      const redoTimes: number[] = [];
      let commitClones = 0;
      let undoClones = 0;
      let redoClones = 0;

      for (let index = 0; index < sample.iterations; index += 1) {
        resetClones();
        const commitStart = performance.now();
        await act(async () => {
          renameLayer(harness.api(), layerId, `sample-${sample.label}-${index}`);
        });
        commitTimes.push(performance.now() - commitStart);
        commitClones += clones().drawing;

        resetClones();
        const undoStart = performance.now();
        await act(async () => {
          harness.api().undo();
        });
        undoTimes.push(performance.now() - undoStart);
        undoClones += clones().drawing;

        resetClones();
        const redoStart = performance.now();
        await act(async () => {
          harness.api().redo();
        });
        redoTimes.push(performance.now() - redoStart);
        redoClones += clones().drawing;

        await act(async () => {
          harness.api().undo();
        });
      }

      resetClones();
      const noOpStart = performance.now();
      await act(async () => {
        renameLayer(harness.api(), 'layer:missing', 'nope');
      });
      const noOpElapsed = performance.now() - noOpStart;
      const noOpClones = clones().drawing;

      console.log(
        `[PERF-188] entities=${sample.entityCount} iterations=${sample.iterations} ` +
          `commitClones=${commitClones} commitMedianMs=${summarize(commitTimes).toFixed(2)} ` +
          `undoClones=${undoClones} undoMedianMs=${summarize(undoTimes).toFixed(2)} ` +
          `redoClones=${redoClones} redoMedianMs=${summarize(redoTimes).toFixed(2)} ` +
          `noOpClones=${noOpClones} noOpMs=${noOpElapsed.toFixed(2)}`,
      );

      expect(commitClones).toBe(1 * sample.iterations);
      expect(undoClones).toBe(1 * sample.iterations);
      expect(redoClones).toBe(1 * sample.iterations);
      expect(noOpClones).toBe(0);
    }
  });
});
