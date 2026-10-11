/** @vitest-environment jsdom */
/**
 * PERF-188.2 — certified-normalized persistence sync.
 *
 * The workspace wrapper clones the drawing at the ownership boundary and now
 * records a per-workspace provenance certificate (identity only). The
 * persistence sync skips its redundant normalization clone exactly when the
 * current parent document IS that wrapper clone for the same
 * (project identity, layout identity, labels) tuple. Anything else — external
 * updates, drawing switches, layout/label changes, the legacy
 * `onPersistedStateChange` fallback — fails one identity check and falls
 * through to the unmodified clone-first normalization path.
 *
 * These tests drive the REAL hooks through a `react-dom/client` probe and
 * `vi.mock` wrappers that intercept the hooks' own `cloneCadDrawingDocument` /
 * `cloneCadProject` calls, so clone counts are real production calls.
 *
 * Coverage: (A) commit/undo/redo 2 -> 1, (B) rapid/batched/StrictMode,
 * (C) legacy-shape normalization still owed on mount, (D) external/adopted
 * updates fail the certificate closed, (E) legacy fallback honest residual +
 * imported-TIN undo/redo, (F) draft/plotFrame/layout/labels + reopen parity,
 * (G) negative controls and a 1k/10k real-project benchmark (logged only).
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
    cloneCadDrawingDocument: (...args: Parameters<typeof actual.cloneCadDrawingDocument>) => {
      cloneSpy.drawing += 1;
      return actual.cloneCadDrawingDocument(...args);
    },
  };
});

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
  cloneCadDrawingDocument,
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument, createDraftSheet } from '../src/engine/cad/cadDraftTypes';
import { buildCadProjectSignature, replaceCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import {
  buildLandXmlImportCommitPayload,
  createLandXmlImportReviewSelection,
} from '../src/components/landXmlImportReview/landXmlImportReview.selection';
import {
  DEFAULT_PARCEL_LAYOUT_SETTINGS,
  DEFAULT_PARCEL_LAYOUT_UI_STATE,
} from '../src/components/surveyCadWorkspaceParcelLayout';
import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import { tinProvenanceKind } from '../src/engine/cad/cadImportedTin';
import { useSurveyCadDrawingSource } from '../src/hooks/surveyCad/useSurveyCadDrawingSource';
import { useSurveyCadWorkspace } from '../src/hooks/surveyCad/useSurveyCadWorkspace';
import { useCadNormalizedSyncCertificate } from '../src/hooks/surveyCad/useSurveyCadWorkspacePersistence';
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

const resetClones = (): void => {
  cloneSpy.drawing = 0;
  cloneSpy.project = 0;
};
const clones = (): { drawing: number; project: number } => ({
  drawing: cloneSpy.drawing,
  project: cloneSpy.project,
});
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
  const base = createBlankCadProject({ name: `perf1882-${entityCount}`, units: 'm' });
  const layerId = base.layers[0]!.id;
  const entities: CadEntity[] = [];
  for (let index = 0; index < entityCount; index += 1) entities.push(lineEntity(index, layerId));
  return replaceCadProjectEntities(base, entities);
};

const buildDrawing = (
  project?: CadProject,
  overrides: Partial<CadDrawingDocument> = {},
): CadDrawingDocument => ({
  ...createBlankCadDrawingDocument({ units: 'm' }),
  ...(project ? { project } : {}),
  ...overrides,
});

const parcelLayoutSnapshot = (
  overrides: Partial<CadParcelLayoutUiState> = {},
): CadParcelLayoutUiState => ({
  ...DEFAULT_PARCEL_LAYOUT_UI_STATE,
  settings: { ...DEFAULT_PARCEL_LAYOUT_SETTINGS },
  ...overrides,
});

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
            id: 'draft-viewport:perf1882',
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

/** Supported legacy point source: `cloneCadSurfaceDefinition` migrates it. */
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
 * Imported-TIN surface with non-canonical nested key order AND an unknown
 * surface purpose (sanitized on clone). Raw equality with the input project is
 * exact, so a raw-signature/global bypass would leak this shape.
 */
const nonCanonicalImportedTinSurfaceProject = (): CadProject => {
  const base = buildProjectWithEntities(2);
  const surface = {
    id: 'surface:reordered-tin',
    name: 'Reordered Imported TIN',
    purpose: 'not-a-real-purpose',
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

const renameLayer = (api: UseSurveyCadWorkspaceResult, layerId: string, name: string): boolean =>
  api.runLayerCommand({ key: 'LAYER_RENAME', layerId, name });

// ---------------------------------------------------------------------------
// Controlled harness (parent owns the drawing; optional StrictMode)
// ---------------------------------------------------------------------------

interface ControlledHarness {
  api: () => UseSurveyCadWorkspaceResult;
  drawing: () => CadDrawingDocument;
  setDrawing: (_doc: CadDrawingDocument) => Promise<void>;
  patchDrawing: (_edit: (_doc: CadDrawingDocument) => CadDrawingDocument) => Promise<void>;
  patchProject: (_edit: (_project: CadProject) => CadProject) => Promise<void>;
  setParcelLayout: (_state: CadParcelLayoutUiState | undefined) => Promise<void>;
  setShowLabels: (_value: boolean) => Promise<void>;
  /** Change the history reset key while keeping the drawing reference. */
  setResetKey: (_key: string) => Promise<void>;
  settle: () => Promise<void>;
  unmount: () => Promise<void>;
}

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

const createControlledHarness = async (
  initial: CadDrawingDocument,
  options: {
    parcelLayout?: CadParcelLayoutUiState;
    showLabels?: boolean;
    strict?: boolean;
    withSurfaceCache?: boolean;
  } = {},
): Promise<ControlledHarness> => {
  const controls: {
    api: UseSurveyCadWorkspaceResult | null;
    drawing: CadDrawingDocument;
    setDrawing: React.Dispatch<React.SetStateAction<CadDrawingDocument | null>> | null;
    setParcelLayout: React.Dispatch<React.SetStateAction<CadParcelLayoutUiState | undefined>> | null;
    setShowLabels: React.Dispatch<React.SetStateAction<boolean>> | null;
    setResetKey: React.Dispatch<React.SetStateAction<string>> | null;
  } = {
    api: null,
    drawing: initial,
    setDrawing: null,
    setParcelLayout: null,
    setShowLabels: null,
    setResetKey: null,
  };

  const Inner: React.FC<{
    drawing: CadDrawingDocument;
    resetKey: string;
    parcelLayout: CadParcelLayoutUiState | undefined;
    showLabels: boolean;
    onProjectChange: React.Dispatch<React.SetStateAction<CadDrawingDocument | null>>;
  }> = ({ drawing, resetKey, parcelLayout, showLabels, onProjectChange }) => {
    const surfaceCache = React.useMemo(
      () => (options.withSurfaceCache ? createCadSurfaceCache(drawing.drawingId) : undefined),
      [drawing.drawingId],
    );
    const ws = useSurveyCadWorkspace(
      drawing.project,
      resetKey,
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
    });
    return null;
  };

  const Probe: React.FC = () => {
    const [drawing, setDrawing] = React.useState<CadDrawingDocument | null>(initial);
    const [resetKey, setResetKey] = React.useState<string>(initial.drawingId);
    const [parcelLayout, setParcelLayout] = React.useState<CadParcelLayoutUiState | undefined>(
      options.parcelLayout,
    );
    const [showLabels, setShowLabels] = React.useState(options.showLabels ?? true);
    React.useEffect(() => {
      controls.setDrawing = setDrawing;
      controls.setResetKey = setResetKey;
      controls.setParcelLayout = setParcelLayout;
      controls.setShowLabels = setShowLabels;
      controls.drawing = drawing ?? initial;
    }, [drawing]);
    if (!drawing) return null;
    return (
      <Inner
        drawing={drawing}
        resetKey={resetKey}
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

  return {
    api: () => controls.api!,
    drawing: () => controls.drawing,
    setDrawing: async (doc) => {
      await act(async () => {
        controls.setDrawing!(doc);
      });
    },
    patchDrawing: async (edit) => {
      await act(async () => {
        controls.setDrawing!((previous) => (previous ? edit(previous) : previous));
      });
    },
    patchProject: async (edit) => {
      await act(async () => {
        controls.setDrawing!((previous) =>
          previous
            ? { ...previous, updatedAt: new Date().toISOString(), project: edit(previous.project) }
            : previous,
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
    setResetKey: async (key) => {
      await act(async () => {
        controls.setResetKey!(key);
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
// Legacy harness (`persistedState` + `onPersistedStateChange` fallback)
// ---------------------------------------------------------------------------

interface LegacyHarness {
  api: () => UseSurveyCadWorkspaceResult;
  persisted: () => SurveyCadPersistedState | null;
  settle: () => Promise<void>;
  unmount: () => Promise<void>;
}

const createLegacyHarness = async (
  initial: SurveyCadPersistedState | null,
): Promise<LegacyHarness> => {
  const controls: {
    api: UseSurveyCadWorkspaceResult | null;
    persisted: SurveyCadPersistedState | null;
  } = { api: null, persisted: initial };

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
// A. Certified 2 -> 1 on genuine commits, identity-safe snapshots
// ---------------------------------------------------------------------------

describe('PERF-188.2 A — certified commit/undo/redo', () => {
  it('a successful commit clones once and publishes an independent, value-equal document', async () => {
    const project = buildProjectWithEntities(6);
    const originalSnapshot = deepValue(project);
    const harness = await createControlledHarness(buildDrawing(project));
    const layerId = project.layers[0]!.id;
    await harness.settle();
    resetClones();

    await act(async () => {
      expect(renameLayer(harness.api(), layerId, 'certified-once')).toBe(true);
    });

    expect(clones()).toEqual({ drawing: 1, project: 1 });
    expect(harness.api().historyDepth).toBe(1);
    // The published document is an independent clone (ownership boundary kept):
    // its project is a distinct reference from the history project, yet equal.
    expect(harness.drawing().project).not.toBe(harness.api().cadProject);
    expect(buildCadProjectSignature(harness.drawing().project)).toBe(
      buildCadProjectSignature(harness.api().cadProject),
    );
    // The pre-commit snapshot is untouched.
    expect(deepValue(project)).toEqual(originalSnapshot);
    expect(harness.drawing().project.layers[0]!.name).toBe('certified-once');
  });

  it('undo and redo each clone once and keep every snapshot deeply isolated', async () => {
    const project = buildProjectWithEntities(6);
    const harness = await createControlledHarness(buildDrawing(project));
    const layerId = project.layers[0]!.id;
    await act(async () => {
      renameLayer(harness.api(), layerId, 'certified-undo');
    });
    const committed = deepValue(harness.api().cadProject);

    resetClones();
    await act(async () => {
      harness.api().undo();
    });
    expect(clones()).toEqual({ drawing: 1, project: 1 });
    expect(harness.api().historyDepth).toBe(0);
    expect(deepValue(harness.api().cadProject)).toEqual(deepValue(project));
    expect(deepValue(harness.drawing().project)).toEqual(deepValue(project));

    resetClones();
    await act(async () => {
      harness.api().redo();
    });
    expect(clones()).toEqual({ drawing: 1, project: 1 });
    expect(harness.api().historyDepth).toBe(1);
    expect(deepValue(harness.api().cadProject)).toEqual(committed);
    expect(deepValue(harness.drawing().project)).toEqual(committed);
  });
});

// ---------------------------------------------------------------------------
// B. Rapid edits, batching, StrictMode, no stale publish / dup undo
// ---------------------------------------------------------------------------

describe('PERF-188.2 B — rapid edits, batching, StrictMode', () => {
  it('rapid sequential commits each clone once with exactly one undo entry', async () => {
    const project = buildProjectWithEntities(5);
    const harness = await createControlledHarness(buildDrawing(project));
    const layerId = project.layers[0]!.id;
    await harness.settle();
    resetClones();

    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        expect(renameLayer(harness.api(), layerId, `rapid-${index}`)).toBe(true);
      });
      expect(clones().drawing).toBe(index + 1);
    }
    expect(harness.api().historyDepth).toBe(4);

    // One clone and one history entry per undo — no duplicate undo entries.
    resetClones();
    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        harness.api().undo();
      });
      expect(clones().drawing).toBe(index + 1);
      expect(harness.api().historyDepth).toBe(3 - index);
    }
    expect(harness.api().canRedo).toBe(true);
    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        harness.api().redo();
      });
    }
    expect(harness.api().historyDepth).toBe(4);
    expect(harness.drawing().project.layers[0]!.name).toBe('rapid-3');
  });

  it('rapid edits under StrictMode publish newest state with no stale overwrite or dup undo', async () => {
    const project = buildProjectWithEntities(5);
    const harness = await createControlledHarness(buildDrawing(project), { strict: true });
    const layerId = project.layers[0]!.id;
    await harness.settle();
    resetClones();

    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        expect(renameLayer(harness.api(), layerId, `strict-${index}`)).toBe(true);
      });
      // StrictMode replays render-phase updaters (dev-only): at most 4 clones
      // per commit (2 wrapper invocations x 2 render passes) and never a
      // persistence clone (which would push this to 5+ per commit).
      expect(clones().drawing).toBeLessThanOrEqual(4 * (index + 1));
      expect(harness.api().historyDepth).toBe(index + 1);
    }
    expect(harness.drawing().project.layers[0]!.name).toBe('strict-3');
    expect(buildCadProjectSignature(harness.drawing().project)).toBe(
      buildCadProjectSignature(harness.api().cadProject),
    );

    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        harness.api().undo();
      });
      expect(harness.api().historyDepth).toBe(3 - index);
    }
    expect(deepValue(harness.drawing().project)).toEqual(deepValue(project));
    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        harness.api().redo();
      });
    }
    expect(harness.api().historyDepth).toBe(4);
    expect(harness.drawing().project.layers[0]!.name).toBe('strict-3');
  });

  it('two commits batched in one act publish the newest project with no stale overwrite', async () => {
    const project = buildProjectWithEntities(4);
    const harness = await createControlledHarness(buildDrawing(project));
    const layerId = project.layers[0]!.id;
    await harness.settle();
    resetClones();

    await act(async () => {
      expect(renameLayer(harness.api(), layerId, 'batch-first')).toBe(true);
      expect(renameLayer(harness.api(), layerId, 'batch-second')).toBe(true);
    });

    // Two ownership-boundary clones (one per commit); the single persistence
    // run is certified against the newest project and skips.
    expect(clones().drawing).toBe(2);
    expect(harness.api().historyDepth).toBe(2);
    expect(harness.drawing().project.layers[0]!.name).toBe('batch-second');
    expect(buildCadProjectSignature(harness.drawing().project)).toBe(
      buildCadProjectSignature(harness.api().cadProject),
    );

    await act(async () => {
      harness.api().undo();
    });
    expect(harness.drawing().project.layers[0]!.name).toBe('batch-first');
    await act(async () => {
      harness.api().undo();
    });
    expect(deepValue(harness.drawing().project)).toEqual(deepValue(project));
  });

  it('failed and selection-only updates stay at zero clones under StrictMode', async () => {
    const project = buildProjectWithEntities(3);
    const harness = await createControlledHarness(buildDrawing(project), { strict: true });
    const [firstEntity, secondEntity] = project.entities;
    await harness.settle();
    resetClones();

    await act(async () => {
      harness.api().selectEntity(secondEntity!.id);
    });
    expect(harness.api().selectedEntityIds).toEqual([secondEntity!.id]);
    expect(clones()).toEqual({ drawing: 0, project: 0 });

    await act(async () => {
      expect(renameLayer(harness.api(), 'layer:missing', 'nope')).toBe(false);
    });
    expect(clones()).toEqual({ drawing: 0, project: 0 });
    expect(firstEntity).toBe(project.entities[0]);
  });
});

// ---------------------------------------------------------------------------
// C. Mount normalization is still owed for non-canonical / legacy shapes
// ---------------------------------------------------------------------------

describe('PERF-188.2 C — non-canonical mount normalization (no certificate)', () => {
  it('a controlled legacy pointGroupId surface still normalizes on mount, with real commit/undo', async () => {
    const project = legacyPointGroupSurfaceProject();
    const harness = await createControlledHarness(buildDrawing(project));
    await harness.settle();

    // The legacy shape adopts through history (the normalized source differs
    // from the raw history project), so mount pays the normalization publish
    // plus one post-adoption re-sync: 2. A raw-signature/global bypass would
    // instead skip normalization entirely.
    expect(clones().drawing).toBe(2);
    const source = harness.drawing().project.surfaces![0]!.definition.pointSource;
    expect(source).toEqual({ kind: 'point-group', pointGroupIds: ['g1'] });
    expect('pointGroupId' in source).toBe(false);

    // Idempotent normalization: no further publish without a real change.
    const settled = harness.drawing();
    await harness.settle();
    expect(harness.drawing()).toBe(settled);

    // A subsequent genuine commit is certified and keeps exactly one undo entry.
    resetClones();
    await act(async () => {
      expect(renameLayer(harness.api(), project.layers[0]!.id, 'legacy-certified')).toBe(true);
    });
    expect(clones()).toEqual({ drawing: 1, project: 1 });
    expect(harness.api().historyDepth).toBe(1);
    expect(harness.drawing().project.surfaces![0]!.definition.pointSource).toEqual({
      kind: 'point-group',
      pointGroupIds: ['g1'],
    });
  });

  it('key-reordered imported TIN + unknown purpose normalize on mount (raw bypass would leak them)', async () => {
    const project = nonCanonicalImportedTinSurfaceProject();
    expect(Object.keys(project.surfaces![0]!.definition)).toEqual(['pointSource', 'importedTin']);

    const harness = await createControlledHarness(buildDrawing(project));
    await harness.settle();

    // Non-canonical key order + sanitized purpose: the normalized source no
    // longer canonically matches the raw history project, so adoption re-syncs
    // once more (2). A raw-signature bypass would leak the input shape.
    expect(clones().drawing).toBe(2);
    const published = harness.drawing().project.surfaces![0]!;
    expect(Object.keys(published.definition)).toEqual(['importedTin', 'pointSource']);
    expect(Object.keys(published.definition.importedTin!)).toEqual(['vertices', 'faces', 'provenance']);
    expect(published.purpose).not.toBe('not-a-real-purpose');
  });

  it('a controlled draft with plotFrame:false normalizes without dropping the explicit false', async () => {
    const project = buildProjectWithEntities(2);
    const harness = await createControlledHarness(
      buildDrawing(project, { draft: buildDraftWithPlotFrame(project, false) }),
    );
    await harness.settle();
    expect(harness.drawing().draft?.sheets[0]?.viewports[0]?.plotFrame).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. External / adopted updates fail the certificate closed
// ---------------------------------------------------------------------------

describe('PERF-188.2 D — external updates fail closed', () => {
  it('an external project update (changed nested revision) is adopted and normalized, never certified', async () => {
    const project = buildProjectWithEntities(4);
    const harness = await createControlledHarness(buildDrawing(project));
    const layerId = project.layers[0]!.id;
    await act(async () => {
      renameLayer(harness.api(), layerId, 'before-external');
    });
    await harness.settle();
    resetClones();

    // Genuine external change: a different nested revision on top of a
    // key-reordered definition, published by the parent (the exact shape the
    // certificate must not mistake for its own normalized output).
    const external = nonCanonicalImportedTinSurfaceProject();
    await harness.patchProject(() => external);
    await harness.settle();

    // Sanitized source no longer matches the raw adopted project, so the
    // history adoption re-syncs once more: normalization + post-adoption = 2.
    expect(clones().drawing).toBe(2);
    expect(harness.api().cadProject.surfaces![0]!.id).toBe('surface:reordered-tin');
    expect(buildCadProjectSignature(harness.drawing().project)).toBe(
      buildCadProjectSignature(harness.api().cadProject),
    );
    // No history entry was fabricated from an external update.
    expect(harness.api().historyDepth).toBe(0);
  });

  it('a stale wrapper callback after a drawing switch cannot write or carry a certificate', async () => {
    const baseA = buildProjectWithEntities(3);
    const staleLayerId = 'layer:perf1882-stale-only';
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

    // The stale closure carries drawing A's id (and a layer that only exists in
    // A); the command is rejected and no certificate survives the switch.
    await act(async () => {
      expect(
        staleApi.runLayerCommand({ key: 'LAYER_RENAME', layerId: staleLayerId, name: 'stale' }),
      ).toBe(false);
    });
    await harness.settle();

    expect(harness.drawing()).toBe(before);
    expect(deepValue(harness.drawing().project)).toEqual(deepValue(projectB));
    expect(clones().drawing).toBe(0);
  });

  it('a layout change after a drawing switch normalizes the new drawing (no carried certificate)', async () => {
    const projectA = buildProjectWithEntities(3);
    const harness = await createControlledHarness(buildDrawing(projectA), {
      parcelLayout: parcelLayoutSnapshot(),
    });
    await act(async () => {
      renameLayer(harness.api(), projectA.layers[0]!.id, 'cert-a');
    });

    const projectB = buildProjectWithEntities(3);
    const drawingB = buildDrawing(projectB);
    await harness.setDrawing(drawingB);
    await harness.settle();
    resetClones();

    await harness.setParcelLayout(parcelLayoutSnapshot({ open: true }));
    await harness.settle();

    expect(clones().drawing).toBe(1);
    expect(harness.drawing().drawingId).toBe(drawingB.drawingId);
    expect(harness.drawing().parcelLayout?.open).toBe(true);
    expect(deepValue(harness.drawing().project)).toEqual(deepValue(projectB));
  });
});

// ---------------------------------------------------------------------------
// E. Legacy fallback residual + imported-TIN transaction
// ---------------------------------------------------------------------------

describe('PERF-188.2 E — legacy fallback residual and imported-TIN transaction', () => {
  it('the legacy onPersistedStateChange fallback records the honest residual of 3 clones', async () => {
    const harness = await createLegacyHarness(null);
    const layerId = harness.api().cadProject.layers[0]!.id;
    await harness.settle();
    resetClones();

    await act(async () => {
      expect(renameLayer(harness.api(), layerId, 'legacy-residual')).toBe(true);
    });

    // The legacy path rebuilds an equivalent document on every persisted write,
    // so the certificate identity never matches: the first commit pays the
    // wrapper clone + migration + normalization clone (3); steady-state
    // round-trips are already canonical and pay 2. It must never short-circuit
    // on raw equality.
    expect(clones().drawing).toBe(3);
    expect(harness.persisted()?.project.layers[0]!.name).toBe('legacy-residual');
    expect(harness.api().cadProject.layers[0]!.name).toBe('legacy-residual');
  });

  it('LandXML imported-TIN commit/undo/redo is certified and preserves provenance', async () => {
    const initial = createBlankCadDrawingDocument({ units: 'm' });
    const harness = await createControlledHarness(initial, { withSurfaceCache: true });
    await harness.settle();
    resetClones();

    await act(async () => {
      const payload = commitPayload();
      harness.api().runLandXmlImport(payload.preview, payload.fileName, payload.commitSelection);
    });
    expect(clones()).toEqual({ drawing: 1, project: 1 });
    expect(harness.api().historyDepth).toBe(1);
    expect(harness.api().cadProject.entities).toHaveLength(6);
    expect(harness.api().cadProject.surfaces).toHaveLength(1);
    const provenance = harness.drawing().project.surfaces![0]!.definition.importedTin?.provenance;
    expect(provenance && tinProvenanceKind(provenance)).toBe('landxml-import');

    resetClones();
    await act(async () => {
      harness.api().undo();
    });
    expect(clones().drawing).toBe(1);
    expect(harness.api().historyDepth).toBe(0);
    expect(harness.api().cadProject.entities).toHaveLength(0);

    resetClones();
    await act(async () => {
      harness.api().redo();
    });
    expect(clones().drawing).toBe(1);
    expect(harness.api().historyDepth).toBe(1);
    expect(harness.api().cadProject.entities).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// F. Draft/layout/labels propagation, snapshot isolation, save/reopen parity
// ---------------------------------------------------------------------------

describe('PERF-188.2 F — draft/layout/labels and reopen parity', () => {
  it('plotFrame:false survives a commit and the drawing is save/reopen clean', async () => {
    const project = buildProjectWithEntities(3);
    const draft = buildDraftWithPlotFrame(project, false);
    const harness = await createControlledHarness(buildDrawing(project, { draft }), {
      parcelLayout: parcelLayoutSnapshot({ open: false }),
      showLabels: true,
    });
    await harness.settle();

    await act(async () => {
      expect(renameLayer(harness.api(), project.layers[0]!.id, 'draft-certified')).toBe(true);
    });
    expect(harness.drawing().draft?.sheets[0]?.viewports[0]?.plotFrame).toBe(false);

    const serialized = serializeCadDrawingFile(harness.drawing());
    const reopened = parseCadDrawingFile(serialized);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.drawing.draft?.sheets[0]?.viewports[0]?.plotFrame).toBe(false);
    expect(buildCadProjectSignature(reopened.drawing.project)).toBe(
      buildCadProjectSignature(harness.drawing().project),
    );
  });

  it('parcel layout and label changes each normalize once when the certificate no longer matches', async () => {
    const project = buildProjectWithEntities(3);
    const harness = await createControlledHarness(buildDrawing(project), {
      parcelLayout: parcelLayoutSnapshot(),
      showLabels: true,
    });
    await act(async () => {
      renameLayer(harness.api(), project.layers[0]!.id, 'layout-certified');
    });
    const committed = harness.drawing();
    resetClones();

    await harness.setParcelLayout(parcelLayoutSnapshot({ open: true }));
    await harness.settle();
    // The wrapper certificate described the old layout reference, so the sync
    // runs its clone-first normalization once.
    expect(clones().drawing).toBe(1);
    expect(harness.drawing()).not.toBe(committed);
    expect(harness.drawing().parcelLayout?.open).toBe(true);

    resetClones();
    await harness.setShowLabels(false);
    await harness.settle();
    expect(clones().drawing).toBe(1);
    expect(harness.drawing().showParcelLabels).toBe(false);
    expect(buildCadProjectSignature(harness.drawing().project)).toBe(
      buildCadProjectSignature(harness.api().cadProject),
    );
  });

  it('a same-project new draft reference publishes without aliasing the history snapshot', async () => {
    const project = buildProjectWithEntities(2);
    const originalDraft = buildDraftWithPlotFrame(project, false);
    const harness = await createControlledHarness(buildDrawing(project, { draft: originalDraft }));
    await harness.settle();

    const nextDraft = buildDraftWithPlotFrame(project, true);
    await harness.patchDrawing((previous) => ({ ...previous, draft: nextDraft }));
    await harness.settle();

    // Same project + new draft reference: the persistence effect is not keyed
    // on `cadProject` change here, so the parent draft is retained verbatim and
    // the history project snapshot is untouched (projects never carry a draft).
    expect(harness.drawing().draft).toBe(nextDraft);
    expect(deepValue(harness.api().cadProject)).toEqual(deepValue(project));
  });

  it('a cleared draft publishes a blank draft (wrapper maps null history draft to draft:undefined)', () => {
    const project = buildProjectWithEntities(2);
    const drawing = buildDrawing(project, { draft: buildDraftWithPlotFrame(project, false) });
    expect(drawing.draft?.sheets.length).toBe(1);
    // The wrapper publishes a changed-but-cleared history draft (`null`) as
    // `draft: undefined`; `cloneCadDrawingDocument` rebuilds a blank draft for
    // null/undefined, so the sticky previous draft is not retained.
    const cleared = cloneCadDrawingDocument({ ...drawing, draft: undefined });
    expect(cleared.draft?.sheets.length ?? 0).toBe(0);
  });

  it('P2-1: a draft-clearing project replace after a real transform publishes blank (not sticky) via the wrapper', async () => {
    const project = buildProjectWithEntities(3);
    const draft = buildDraftWithPlotFrame(project, false);
    const harness = await createControlledHarness(buildDrawing(project, { draft }));
    await harness.settle();

    // Real PROJECTTRANSFORM commit: two identity Helmert pairs. This seeds the
    // live drawing draft into the history snapshot and commits it atomically
    // (one undo entry), so history now carries a defined draft.
    await act(async () => {
      harness.api().startProjectTransformCommand();
    });
    await act(async () => {
      harness.api().submitTransformPanelText('0,0,0,0');
    });
    await act(async () => {
      harness.api().submitTransformPanelText('1,0,1,0');
    });
    resetClones();
    await act(async () => {
      harness.api().submitTransformPanelText('APPLY');
    });
    expect(harness.api().historyDepth).toBe(1);
    expect(harness.drawing().draft?.sheets.length).toBe(1);
    expect(clones().drawing).toBe(1); // certified wrapper publish; persistence skipped

    // ReplaceCadProject publishes a snapshot with no draft (undefined), so the
    // wrapper's changed-draft path must publish a BLANK draft. The pre-fix
    // sticky path would instead retain the previous sheet.
    const stickyDraft = harness.drawing().draft;
    resetClones();
    await act(async () => {
      harness.api().replaceCadProject(buildProjectWithEntities(2));
    });
    await harness.settle();

    expect(clones().drawing).toBe(1); // certified wrapper publish; persistence skipped
    expect(harness.drawing().draft).not.toBe(stickyDraft);
    expect(harness.drawing().draft?.sheets.length ?? 0).toBe(0);
  });

  it('P2-2: the certificate hook clears on a resetKey change even with the same drawing reference', async () => {
    const drawing = buildDrawing(buildProjectWithEntities(2));
    type CertHook = ReturnType<typeof useCadNormalizedSyncCertificate>;
    const controls: {
      state: CertHook | null;
      setResetKey: React.Dispatch<React.SetStateAction<string>> | null;
    } = { state: null, setResetKey: null };

    const Probe: React.FC = () => {
      const [resetKey, set] = React.useState('reset-a');
      const state = useCadNormalizedSyncCertificate(drawing, resetKey);
      React.useEffect(() => {
        controls.state = state;
        controls.setResetKey = set;
      }, [state, set]);
      return null;
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => {
      root.render(<Probe />);
    });

    // Certify exactly as the wrapper does, with the drawing as the owned ref.
    await act(async () => {
      const id = controls.state!.beginPublish();
      controls.state!.record(id, drawing, drawing.project, undefined, true);
    });
    expect(controls.state!.cert.current).not.toBeNull();

    // Same drawing reference, new reset key: the certificate must be dropped
    // (identity-only hygiene would wrongly keep it, since owned === drawing).
    await act(async () => {
      controls.setResetKey!('reset-b');
    });
    expect(controls.state!.cert.current).toBeNull();
  });

  it('P2-2: a resetKey change after a certified commit does not carry the stale certificate', async () => {
    const project = buildProjectWithEntities(3);
    const harness = await createControlledHarness(buildDrawing(project));
    await act(async () => {
      expect(renameLayer(harness.api(), project.layers[0]!.id, 'before-reset')).toBe(true);
    });
    expect(harness.api().historyDepth).toBe(1);
    resetClones();

    await harness.setResetKey('reset-key-2');
    await harness.settle();
    // The history baseline is rebuilt under the new reset key; the persistence
    // sync pays a real normalization pass rather than skipping on a stale cert.
    expect(clones().drawing).toBeGreaterThanOrEqual(1);
    expect(harness.api().historyDepth).toBe(0);

    // A following commit is certified fresh with exactly one undo entry.
    resetClones();
    await act(async () => {
      expect(renameLayer(harness.api(), project.layers[0]!.id, 'after-reset')).toBe(true);
    });
    expect(clones().drawing).toBe(1);
    expect(harness.api().historyDepth).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// G. Negative controls
// ---------------------------------------------------------------------------

describe('PERF-188.2 G — negative controls', () => {
  it('the ownership-boundary clone is never omitted (published project is an independent ref)', async () => {
    const project = buildProjectWithEntities(4);
    const harness = await createControlledHarness(buildDrawing(project));
    await act(async () => {
      renameLayer(harness.api(), project.layers[0]!.id, 'first-clone');
    });
    expect(harness.drawing().project).not.toBe(harness.api().cadProject);
    expect(harness.drawing()).not.toBe(harness.api().cadProject);
    expect(() => expect(clones().drawing).toBe(0)).toThrow();
  });

  it('a source-project mismatch cannot skip (external change always normalizes)', async () => {
    const project = buildProjectWithEntities(4);
    const harness = await createControlledHarness(buildDrawing(project));
    await act(async () => {
      renameLayer(harness.api(), project.layers[0]!.id, 'cert-source');
    });
    await harness.settle();
    resetClones();

    const different = replaceCadProjectEntities(project, [
      ...project.entities,
      lineEntity(99, project.layers[0]!.id),
    ]);
    await harness.patchProject(() => different);
    await harness.settle();

    // The certificate belonged to the old source project; the new one pays the
    // normalization clone.
    expect(clones().drawing).toBe(1);
    expect(harness.api().cadProject.entities).toHaveLength(5);
  });

  it('a raw-signature bypass cannot leak a legacy shape (mount normalizes without a certificate)', async () => {
    const project = legacyPointGroupSurfaceProject();
    const harness = await createControlledHarness(buildDrawing(project));
    await harness.settle();
    const source = harness.drawing().project.surfaces![0]!.definition.pointSource;
    expect(source).toEqual({ kind: 'point-group', pointGroupIds: ['g1'] });
    expect(clones().drawing).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Benchmark (logged only; no CI thresholds)
// ---------------------------------------------------------------------------

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

describe('PERF-188.2 benchmark (logged)', () => {
  it('measures 1k/10k real projects: certified commit/undo/redo vs the skipped clone', async () => {
    const ROUNDS = 10;
    for (const entityCount of [1_000, 10_000]) {
      // Fixture built OUTSIDE every timed window.
      const project = buildProjectWithEntities(entityCount);
      const harness = await createControlledHarness(buildDrawing(project));
      const layerId = project.layers[0]!.id;
      // Warmup (JIT + memo caches), excluded from the medians.
      for (let warmup = 0; warmup < 2; warmup += 1) {
        await act(async () => {
          renameLayer(harness.api(), layerId, `warmup-${warmup}`);
        });
        await act(async () => {
          harness.api().undo();
        });
      }
      await harness.settle();

      const commitMs: number[] = [];
      const undoMs: number[] = [];
      const redoMs: number[] = [];
      const skippedCloneMs: number[] = [];
      let commitClones = 0;
      let undoClones = 0;
      let redoClones = 0;

      for (let round = 0; round < ROUNDS; round += 1) {
        resetClones();
        const commitStart = performance.now();
        await act(async () => {
          renameLayer(harness.api(), layerId, `bench-${entityCount}-${round}`);
        });
        commitMs.push(performance.now() - commitStart);
        commitClones += clones().drawing;

        // BEFORE model: the exact normalization clone the certificate skips.
        const drawing = harness.drawing();
        const skippedStart = performance.now();
        const skipped = cloneCadDrawingDocument({ ...drawing, project: harness.api().cadProject });
        skippedCloneMs.push(performance.now() - skippedStart);
        expect(skipped).not.toBe(drawing);

        resetClones();
        const undoStart = performance.now();
        await act(async () => {
          harness.api().undo();
        });
        undoMs.push(performance.now() - undoStart);
        undoClones += clones().drawing;

        resetClones();
        const redoStart = performance.now();
        await act(async () => {
          harness.api().redo();
        });
        redoMs.push(performance.now() - redoStart);
        redoClones += clones().drawing;

        await act(async () => {
          harness.api().undo();
        });
      }

      resetClones();
      await act(async () => {
        renameLayer(harness.api(), 'layer:missing', 'noop');
      });
      const noOpClones = clones().drawing;

      console.log(
        `[PERF-188.2] entities=${entityCount} rounds=${ROUNDS} ` +
          `AFTER commit=${commitClones}clones/${median(commitMs).toFixed(2)}ms ` +
          `undo=${undoClones}clones/${median(undoMs).toFixed(2)}ms ` +
          `redo=${redoClones}clones/${median(redoMs).toFixed(2)}ms ` +
          `noOp=${noOpClones}clones ` +
          `BEFORE +skippedClone=${median(skippedCloneMs).toFixed(2)}ms/clone ` +
          `(skipped-clone-only estimate, NOT a paired BEFORE measurement; see ` +
          `docs/evidence/perf1882-certified-normalized-sync/validation.md for paired results)`,
      );

      expect(commitClones).toBe(ROUNDS);
      expect(undoClones).toBe(ROUNDS);
      expect(redoClones).toBe(ROUNDS);
      expect(noOpClones).toBe(0);
    }
  });

  it('reports legacy / TIN-normalization / normalization-only / no-op path counts (1k)', async () => {
    const ROUNDS = 10;
    const entityCount = 1_000;

    // Legacy `onPersistedStateChange` fallback: honest residual of 3/commit.
    const legacy = await createLegacyHarness(null);
    const legacyLayer = legacy.api().cadProject.layers[0]!.id;
    await legacy.settle();
    const legacyMs: number[] = [];
    const legacyCounts: number[] = [];
    let legacyClones = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      resetClones();
      const start = performance.now();
      await act(async () => {
        renameLayer(legacy.api(), legacyLayer, `legacy-bench-${round}`);
      });
      legacyMs.push(performance.now() - start);
      const count = clones().drawing;
      legacyCounts.push(count);
      legacyClones += count;
    }

    // TIN normalization on mount (non-canonical shape, no certificate).
    resetClones();
    const tin = await createControlledHarness(buildDrawing(nonCanonicalImportedTinSurfaceProject()));
    await tin.settle();
    const tinMountClones = clones().drawing;

    // Normalization-only controlled legacy mount.
    resetClones();
    const normalization = await createControlledHarness(buildDrawing(legacyPointGroupSurfaceProject()));
    await normalization.settle();
    const normalizationMountClones = clones().drawing;

    // No-op on the certified 1k harness.
    const project = buildProjectWithEntities(entityCount);
    const harness = await createControlledHarness(buildDrawing(project));
    await harness.settle();
    resetClones();
    await act(async () => {
      renameLayer(harness.api(), project.layers[0]!.id, 'noop-1k');
    });
    const certifiedClones = clones().drawing;
    resetClones();
    await act(async () => {
      renameLayer(harness.api(), 'layer:missing', 'noop');
    });
    const noOpClones = clones().drawing;

    console.log(
      `[PERF-188.2 paths] legacyCommit=${legacyClones}clones/${ROUNDS}rounds ` +
        `perRound=[${legacyCounts.join(',')}] median=${median(legacyMs).toFixed(2)}ms ` +
        `TINmount=${tinMountClones}clones normalizationOnlyMount=${normalizationMountClones}clones ` +
        `certifiedCommit=${certifiedClones}clones noOp=${noOpClones}clones`,
    );

    // First legacy commit is the full residual (3); later ones are 2 because the
    // round-tripped persisted project is already canonical. Never fewer than 2.
    expect(legacyCounts[0]).toBe(3);
    expect(legacyCounts.every((count) => count >= 2)).toBe(true);
    expect(tinMountClones).toBeGreaterThanOrEqual(1);
    expect(normalizationMountClones).toBeGreaterThanOrEqual(1);
    expect(certifiedClones).toBe(1);
    expect(noOpClones).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H. Load-bearing second-normalization-discard proof
// ---------------------------------------------------------------------------
//
// The certificate short-circuits the persistence sync before the clone-first
// fall-through at useSurveyCadWorkspacePersistence.ts:183-196. That fall-through
// clones `{ ...current, updatedAt: fresh ISO, project: cadProject,
// parcelLayout, showParcelLabels }` through `cloneCadDrawingDocument`, then
// discards the clone when the cloned signature/layout/labels equal `current`'s.
// The certificate is only sound if re-running that exact logic on the
// just-published certified document would ALSO discard the clone. These tests
// replay the fall-through verbatim on the published certified document and
// assert the discard. Each scenario carries a non-canonical control proving the
// same assertion is falsifiable (not tautological).

interface PersistenceRerun {
  next: CadDrawingDocument;
  sigSame: boolean;
  layoutSame: boolean;
  labelsSame: boolean;
  discarded: boolean;
}

/**
 * Exact reproduction of the persistence fall-through the certificate skips
 * (useSurveyCadWorkspacePersistence.ts:183-196). `current` is the published
 * certified document; `cadProject` is the current history project.
 */
const rerunPersistenceNormalization = (
  current: CadDrawingDocument,
  cadProject: CadProject,
  parcelLayout: CadParcelLayoutUiState | undefined,
  showParcelLabels: boolean,
): PersistenceRerun => {
  const currentSignature = buildCadProjectSignature(current.project);
  const next = cloneCadDrawingDocument({
    ...current,
    updatedAt: new Date().toISOString(),
    project: cadProject,
    parcelLayout,
    showParcelLabels,
  });
  const sigSame = currentSignature === buildCadProjectSignature(next.project);
  const layoutSame =
    JSON.stringify(current.parcelLayout ?? null) === JSON.stringify(next.parcelLayout ?? null);
  const labelsSame = (current.showParcelLabels ?? true) === next.showParcelLabels;
  return { next, sigSame, layoutSame, labelsSame, discarded: sigSame && layoutSame && labelsSame };
};

/**
 * The load-bearing proof assertion: re-cloning the certified document is a
 * discarded no-op, and the published drawing is value-identical to the clone.
 * Any meaningful normalization divergence (key order, purpose, legacy point
 * source, layout, labels) flips `sigSame`/`discarded` and fails here.
 */
const expectCertifiedRerunDiscards = (
  published: CadDrawingDocument,
  cadProject: CadProject,
): void => {
  const rerun = rerunPersistenceNormalization(
    published,
    cadProject,
    published.parcelLayout,
    published.showParcelLabels ?? true,
  );
  expect(rerun.sigSame).toBe(true);
  expect(rerun.layoutSame).toBe(true);
  expect(rerun.labelsSame).toBe(true);
  expect(rerun.discarded).toBe(true);
  // The published drawing behaves identically to the re-cloned output.
  expect(deepValue(rerun.next.project)).toEqual(deepValue(published.project));
  expect(deepValue(rerun.next.parcelLayout ?? null)).toEqual(
    deepValue(published.parcelLayout ?? null),
  );
  expect(rerun.next.showParcelLabels).toBe(published.showParcelLabels ?? true);
};

/**
 * Control: the SAME assertion must fail on a non-canonical input. The clone
 * migrates/sanitizes/reorders, so the clone is NOT discarded and the certified
 * no-op assertion throws. Proves `expectCertifiedRerunDiscards` is falsifiable.
 */
const expectNonCanonicalRerunDiverges = (
  current: CadDrawingDocument,
  cadProject: CadProject,
): void => {
  const rerun = rerunPersistenceNormalization(
    current,
    cadProject,
    current.parcelLayout,
    current.showParcelLabels ?? true,
  );
  expect(rerun.sigSame).toBe(false);
  expect(rerun.discarded).toBe(false);
  expect(deepValue(rerun.next.project)).not.toEqual(deepValue(current.project));
  expect(() => expectCertifiedRerunDiscards(current, cadProject)).toThrow();
};

describe('PERF-188.2 certified no-op equivalence proof', () => {
  it('ordinary controlled commit: re-running the skipped persistence clone is a discarded no-op', async () => {
    const project = buildProjectWithEntities(6);
    const harness = await createControlledHarness(buildDrawing(project));
    await harness.settle();
    await act(async () => {
      expect(renameLayer(harness.api(), project.layers[0]!.id, 'noop-commit')).toBe(true);
    });
    await harness.settle();

    // Mutation covered: if the certified publish were not canonical (e.g. the
    // wrapper stopped cloning/normalizing), the second clone would change the
    // signature and `discarded` would be false here.
    expectCertifiedRerunDiscards(harness.drawing(), harness.api().cadProject);
  });

  it('undo: re-running the skipped persistence clone is a discarded no-op', async () => {
    const project = buildProjectWithEntities(6);
    const harness = await createControlledHarness(buildDrawing(project));
    await act(async () => {
      renameLayer(harness.api(), project.layers[0]!.id, 'noop-undo');
    });
    await act(async () => {
      harness.api().undo();
    });
    await harness.settle();

    // Mutation covered: undo publishes a fresh baseline clone; if that clone or
    // the history baseline diverged from canonical, the discard flips false.
    expectCertifiedRerunDiscards(harness.drawing(), harness.api().cadProject);
  });

  it('redo: re-running the skipped persistence clone is a discarded no-op', async () => {
    const project = buildProjectWithEntities(6);
    const harness = await createControlledHarness(buildDrawing(project));
    await act(async () => {
      renameLayer(harness.api(), project.layers[0]!.id, 'noop-redo');
    });
    await act(async () => {
      harness.api().undo();
    });
    await act(async () => {
      harness.api().redo();
    });
    await harness.settle();

    // Mutation covered: redo republishes a history snapshot clone; a
    // normalization gap in that republish would make the discard false.
    expectCertifiedRerunDiscards(harness.drawing(), harness.api().cadProject);
  });

  it('LandXML imported-TIN commit: re-running the skipped persistence clone is a discarded no-op', async () => {
    const initial = createBlankCadDrawingDocument({ units: 'm' });
    const harness = await createControlledHarness(initial, { withSurfaceCache: true });
    await harness.settle();
    await act(async () => {
      const payload = commitPayload();
      harness.api().runLandXmlImport(payload.preview, payload.fileName, payload.commitSelection);
    });
    await harness.settle();
    expect(harness.drawing().project.surfaces).toHaveLength(1);

    // Mutation covered: imported TIN surfaces carry nested provenance/faces;
    // if the publish skipped surface normalization the second clone would
    // reorder/sanitize and the discard would be false.
    expectCertifiedRerunDiscards(harness.drawing(), harness.api().cadProject);
  });

  it('draft plotFrame:false commit: re-running the skipped persistence clone is a discarded no-op', async () => {
    const project = buildProjectWithEntities(3);
    const draft = buildDraftWithPlotFrame(project, false);
    const harness = await createControlledHarness(buildDrawing(project, { draft }));
    await harness.settle();
    await act(async () => {
      expect(renameLayer(harness.api(), project.layers[0]!.id, 'noop-draft')).toBe(true);
    });
    await harness.settle();
    expect(harness.drawing().draft?.sheets[0]?.viewports[0]?.plotFrame).toBe(false);

    // Mutation covered: the explicit plotFrame:false is restored by the drawing
    // clone; if it were dropped, the re-clone would not reproduce the published
    // layout payload. The discard guard still runs on project/layout/labels.
    expectCertifiedRerunDiscards(harness.drawing(), harness.api().cadProject);
  });

  it('legacy pointGroupId input: normalized publish re-clones to a discarded no-op; raw input diverges', async () => {
    const rawProject = legacyPointGroupSurfaceProject();
    const harness = await createControlledHarness(buildDrawing(rawProject));
    await harness.settle();

    // Mount normalization published the canonical surface; the certified doc
    // re-clones to a no-op against the normalized history project.
    const source = harness.drawing().project.surfaces![0]!.definition.pointSource;
    expect(source).toEqual({ kind: 'point-group', pointGroupIds: ['g1'] });
    expectCertifiedRerunDiscards(harness.drawing(), harness.api().cadProject);

    // Control: the PRE-normalization legacy document must not be treated as a
    // no-op. `cloneCadProject` migrates `pointGroupId` -> `pointGroupIds`, so
    // the same assertion fails here — the proof is not tautological.
    const rawDrawing = buildDrawing(legacyPointGroupSurfaceProject());
    expectNonCanonicalRerunDiverges(rawDrawing, rawDrawing.project);
  });

  it('key-reordered imported-TIN input: normalized publish re-clones to a discarded no-op; raw input diverges', async () => {
    const rawProject = nonCanonicalImportedTinSurfaceProject();
    const harness = await createControlledHarness(buildDrawing(rawProject));
    await harness.settle();

    const published = harness.drawing().project.surfaces![0]!;
    expect(Object.keys(published.definition)).toEqual(['importedTin', 'pointSource']);
    expect(published.purpose).not.toBe('not-a-real-purpose');
    expectCertifiedRerunDiscards(harness.drawing(), harness.api().cadProject);

    // Control: the raw key order + unknown purpose are both normalized by the
    // clone, so the pre-normalization document fails the same discard assertion.
    const rawDrawing = buildDrawing(nonCanonicalImportedTinSurfaceProject());
    expectNonCanonicalRerunDiverges(rawDrawing, rawDrawing.project);
  });
});
