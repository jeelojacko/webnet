/** @vitest-environment jsdom */
/**
 * PERF-187 — canonical project comparison for CAD history adoption.
 *
 * Regression + perf contract for `areCadProjectsCanonicallyEqual` and its use
 * in `useSurveyCadWorkspaceHistory`:
 *
 * - The external-adopt effect must keep the key-order-insensitive
 *   equivalence of `buildStableCadProjectSignature` on INERT plain-JSON
 *   project data (Phase 18M: the drawing
 *   sync clones the project, normalizing imported-TIN key order, and must not
 *   wipe the just-committed undo transaction). Intentional documented
 *   divergences on production-impossible inputs: K1 (species array),
 *   L1 (stateful accessor), G2 (same-ref cyclic).
 * - The effect must stop paying two full canonical traversals + JSON
 *   serialization per run. The comparator has a same-reference fast path and,
 *   for distinct references, a plain raw-JSON pair.
 *   Plain order-preserved clones take that branch with exactly TWO stringify
 *   calls (first args = the original refs). Reordered or genuinely different
 *   INERT values fall back to the canonical serializer oracle (two raw +
 *   two canonical calls); same-ref is zero. Exotic inputs are budgeted by
 *   shape: raw-equal exotics (K1 species) cost the raw pair; throwing or
 *   aborted serializations cost the raw attempt (possibly partial) plus the
 *   oracle pair; K1/L1/G2 document the intentional divergences.
 *
 * The module is mocked so `buildStableCadProjectSignature` is counted while
 * still delegating to the real implementation. `areCadProjectsCanonicallyEqual`
 * is the real export (the mock keeps every other export intact).
 *
 * That export spy only observes the DIRECT export binding. The helper's
 * INTERNAL fallback calls `buildStableCadProjectSignature` through the
 * module-local binding, which `vi.mock` cannot replace, so
 * `signatureCalls() === 0` alone never proves the helper skipped the oracle.
 * Both the plain raw pair and the fallback route through the global
 * `JSON.stringify`, so the spy below (`measureStringifyCalls`) is the real
 * branch discriminator; it also captures each call's first argument so a test
 * can prove the raw branch passed the ORIGINAL refs with no canonical rebuild.
 * `signatureCalls()` is reserved for direct/hook call-budget checks.
 */
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cloneCadDrawingDocument,
  createBlankCadDrawingDocument,
  createBlankCadProject,
} from '../src/engine/cad/cadDrawingFile';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import {
  areCadProjectsCanonicallyEqual,
  buildCadProjectSignature,
  buildStableCadProjectSignature,
  replaceCadProjectEntities,
} from '../src/engine/cad/cadProjectState';
import type { CadDrawingDocument, CadEntity, CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import {
  buildLandXmlImportCommitPayload,
  createLandXmlImportReviewSelection,
} from '../src/components/landXmlImportReview/landXmlImportReview.selection';
import { useSurveyCadWorkspace } from '../src/hooks/surveyCad/useSurveyCadWorkspace';
import type { UseSurveyCadWorkspaceResult } from '../src/hooks/surveyCad/useSurveyCadWorkspace.types';

const signatureSpy = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../src/engine/cad/cadProjectState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadProjectState')>();
  return {
    ...actual,
    buildStableCadProjectSignature: (project: CadProject): string => {
      signatureSpy.calls += 1;
      return actual.buildStableCadProjectSignature(project);
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const XML = readFileSync('tests/fixtures/landxml-18m-production.xml', 'utf8');

type StableSignatureFn = (_project: CadProject) => string;

/**
 * Uncounted reference implementation for the oracle. `vi.importActual`
 * bypasses the mock, so oracle/parity checks never perturb the call counter.
 */
let realStable: StableSignatureFn;

beforeAll(async () => {
  const actual = await vi.importActual<typeof import('../src/engine/cad/cadProjectState')>(
    '../src/engine/cad/cadProjectState',
  );
  realStable = actual.buildStableCadProjectSignature;
});

beforeEach(() => {
  signatureSpy.calls = 0;
});

const signatureCalls = (): number => signatureSpy.calls;
const resetSignatureCalls = (): void => {
  signatureSpy.calls = 0;
};

/**
 * Observe the helper's `JSON.stringify` traffic by branch.
 *
 * `areCadProjectsCanonicallyEqual` reaches `buildStableCadProjectSignature`
 * through the MODULE-LOCAL binding, which the `vi.mock` above cannot replace,
 * so `signatureCalls()` can NEVER see the oracle fallback. Both the plain raw
 * pair and the fallback go through the global `JSON.stringify`, so this spy
 * counts the raw branch (exactly 2 calls whose first args are the ORIGINAL
 * inputs) versus the fallback (exactly 4: the completed raw pair plus the two
 * canonical oracle calls). `firstArgs`
 * captures each call's first argument, so raw-branch tests prove no canonical
 * rebuild happened. Keep the window tight: exactly one synchronous helper
 * call, no React rendering. Clear immediately before the call, read
 * immediately after, restore in `finally`.
 */
function measureStringifyCalls<T>(run: () => T): {
  result: T;
  calls: number;
  firstArgs: unknown[];
} {
  const spy = vi.spyOn(JSON, 'stringify');
  spy.mockClear();
  try {
    const result = run();
    return {
      result,
      calls: spy.mock.calls.length,
      firstArgs: spy.mock.calls.map((call) => call[0]),
    };
  } finally {
    spy.mockRestore();
  }
}

const surveyPoint = (id: string, x: number, y: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  pointClass: 'free',
  source: 'parsed-input',
});

const pointDrawing = (): CadDrawingDocument => {
  const blank = createBlankCadDrawingDocument({ units: 'm' });
  return {
    ...blank,
    project: replaceCadProjectEntities(blank.project, [
      surveyPoint('pt:A', 1, 2),
      surveyPoint('pt:B', 3, 4),
    ]),
  };
};

const buildSyntheticProject = (entityCount: number): CadProject => {
  const base = createBlankCadProject({ name: `perf-${entityCount}`, units: 'm' });
  const entities: CadSurveyPointEntity[] = [];
  for (let index = 0; index < entityCount; index += 1) {
    entities.push(surveyPoint(`pt:${index}`, index, index * 2));
  }
  return replaceCadProjectEntities(base, entities);
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

type ExternalEdit = (_drawing: CadDrawingDocument) => CadDrawingDocument;
type ProjectEdit = (_project: CadProject) => CadProject;

interface Harness {
  ws: () => UseSurveyCadWorkspaceResult;
  currentDrawing: () => CadDrawingDocument;
  renderCount: () => number;
  bump: () => Promise<void>;
  external: (_edit: ExternalEdit) => Promise<void>;
  externalProject: (_edit: ProjectEdit) => Promise<void>;
  externalProjectBatch: (_edits: readonly ProjectEdit[]) => Promise<void>;
  setResetKey: (_key: string) => Promise<void>;
  commitLandXml: () => Promise<void>;
  settle: () => Promise<void>;
  unmount: () => Promise<void>;
}

/**
 * Minimal parent-drawing harness mirroring the /cad shell wiring used by the
 * 18M history test: the workspace owns history, the parent owns the drawing
 * document and receives sync writes through `onProjectChange`.
 */
const createHarness = async (initial: CadDrawingDocument): Promise<Harness> => {
  // Mutable harness controls are populated from effects (never during render)
  // so React's purity rules stay satisfied.
  const controls: {
    api: UseSurveyCadWorkspaceResult | null;
    drawing: CadDrawingDocument;
    renders: number;
    setDrawing: React.Dispatch<React.SetStateAction<CadDrawingDocument | null>> | null;
    setResetKey: React.Dispatch<React.SetStateAction<string>> | null;
    setBump: React.Dispatch<React.SetStateAction<number>> | null;
  } = {
    api: null,
    drawing: initial,
    renders: 0,
    setDrawing: null,
    setResetKey: null,
    setBump: null,
  };

  const Inner: React.FC<{
    drawing: CadDrawingDocument;
    resetKey: string;
    onProjectChange: React.Dispatch<React.SetStateAction<CadDrawingDocument | null>>;
  }> = ({ drawing, resetKey, onProjectChange }) => {
    const cache = React.useMemo(() => createCadSurfaceCache(drawing.drawingId), [drawing.drawingId]);
    const ws = useSurveyCadWorkspace(
      drawing.project,
      resetKey,
      onProjectChange,
      drawing,
      undefined,
      true,
      false,
      'thin',
      cache,
    );
    React.useEffect(() => {
      controls.api = ws;
      controls.renders += 1;
    });
    return null;
  };

  const Probe: React.FC = () => {
    const [drawing, setDrawing] = React.useState<CadDrawingDocument | null>(initial);
    const [resetKey, setResetKey] = React.useState(initial.drawingId);
    const [bump, setBump] = React.useState(0);
    void bump;
    React.useEffect(() => {
      controls.setDrawing = setDrawing;
      controls.setResetKey = setResetKey;
      controls.setBump = setBump;
      controls.drawing = drawing ?? initial;
    }, [drawing, setDrawing, setResetKey, setBump]);
    if (!drawing) return null;
    return <Inner drawing={drawing} resetKey={resetKey} onProjectChange={setDrawing} />;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<Probe />);
  });

  return {
    ws: () => controls.api!,
    currentDrawing: () => controls.drawing,
    renderCount: () => controls.renders,
    bump: async () => {
      await act(async () => {
        controls.setBump!((value) => value + 1);
      });
    },
    external: async (edit) => {
      await act(async () => {
        controls.setDrawing!((previous) => (previous ? edit(previous) : previous));
      });
    },
    externalProject: async (edit) => {
      await act(async () => {
        controls.setDrawing!((previous) =>
          previous ? { ...previous, project: edit(previous.project) } : previous,
        );
      });
    },
    externalProjectBatch: async (edits) => {
      await act(async () => {
        controls.setDrawing!((previous) => {
          if (!previous) return previous;
          let project = previous.project;
          for (const edit of edits) project = edit(project);
          return { ...previous, project };
        });
      });
    },
    setResetKey: async (key) => {
      await act(async () => {
        controls.setResetKey!(key);
      });
    },
    commitLandXml: async () => {
      await act(async () => {
        const payload = commitPayload();
        controls.api!.runLandXmlImport(payload.preview, payload.fileName, payload.commitSelection);
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

/** Perturb the first entity's geometry (all supported kinds carry an X). */
const perturbEntity = (entity: CadEntity): CadEntity => {
  switch (entity.type) {
    case 'survey-point':
    case 'text':
      return { ...entity, x: entity.x + 7 };
    case 'line':
      return { ...entity, fromX: entity.fromX + 7 };
    default:
      return entity;
  }
};

/**
 * A genuine external edit: move geometry AND reverse entity order (so the
 * reset selection is observably the new first entity). Entity array order is
 * authoritative, so either change alone is a real difference.
 */
const externalDeepEdit = (project: CadProject): CadProject => {
  const [first, ...rest] = project.entities;
  if (!first) return project;
  return replaceCadProjectEntities(project, [perturbEntity(first), ...rest].reverse());
};

// ---------------------------------------------------------------------------
// Hook behavior: the adopt effect must not take the helper's serializer path
// on equal/clone syncs. `signatureCalls()` here checks the hook's direct call
// budget; the actual helper-internal zero-serialization claim is proven by the
// `JSON.stringify` spy in the sampled-cost suite below.
// ---------------------------------------------------------------------------

describe('PERF-187 CAD history adoption', () => {
  it('A: same-identity mount and repeated renders never call the stable signature', async () => {
    const initial = createBlankCadDrawingDocument({ units: 'm' });
    const harness = await createHarness(initial);

    expect(harness.ws().historyDepth).toBe(0);
    expect(harness.ws().canUndo).toBe(false);
    expect(harness.ws().cadProject).toBe(initial.project);

    await harness.bump();
    await harness.bump();
    await harness.settle();

    expect(signatureCalls()).toBe(0);
    expect(harness.ws().cadProject).toBe(initial.project);
    expect(harness.ws().historyDepth).toBe(0);
    await harness.unmount();
  });

  it('B: committed LandXML transaction survives the drawing-sync clone with 0 stable calls', async () => {
    const harness = await createHarness(createBlankCadDrawingDocument({ units: 'm' }));
    expect(signatureCalls()).toBe(0);

    await harness.commitLandXml();
    expect(signatureCalls()).toBe(0);
    expect(harness.ws().historyDepth).toBe(1);
    expect(harness.ws().canUndo).toBe(true);
    expect(harness.ws().cadProject.entities).toHaveLength(6);
    expect(harness.ws().cadProject.surfaces ?? []).toHaveLength(1);
    // The parent drawing holds the normalized sync clone (different object).
    expect(harness.currentDrawing().project).not.toBe(harness.ws().cadProject);

    await act(async () => {
      harness.ws().undo();
    });
    expect(harness.ws().historyDepth).toBe(0);
    expect(harness.ws().canRedo).toBe(true);
    expect(harness.ws().cadProject.entities).toHaveLength(0);
    expect(harness.ws().cadProject.surfaces ?? []).toHaveLength(0);

    await act(async () => {
      harness.ws().redo();
    });
    expect(harness.ws().historyDepth).toBe(1);
    expect(harness.ws().cadProject.entities).toHaveLength(6);
    expect(harness.ws().cadProject.surfaces ?? []).toHaveLength(1);
    expect(signatureCalls()).toBe(0);
    await harness.unmount();
  });

  it('C: repeated semantically-equal external clone identities never adopt or wipe undo', async () => {
    const harness = await createHarness(createBlankCadDrawingDocument({ units: 'm' }));
    await harness.commitLandXml();
    expect(harness.ws().historyDepth).toBe(1);
    const historyProject = harness.ws().cadProject;
    resetSignatureCalls();

    for (let index = 0; index < 3; index += 1) {
      await harness.external((drawing) => cloneCadDrawingDocument(drawing));
    }
    await harness.settle();

    // New clone identities each run the adopt effect. This export-spy budget
    // only covers the hook's direct import path; helper-internal serialization
    // is proven by the JSON.stringify spy in the sampled-cost suite below.
    expect(signatureCalls()).toBe(0);
    expect(harness.ws().historyDepth).toBe(1);
    expect(harness.ws().canUndo).toBe(true);
    expect(harness.ws().cadProject).toBe(historyProject);

    // Control: the OLD two-unconditional-calls path would record 2 here, so
    // the 0 budget above is genuinely sensitive to the fix.
    const baseProject = harness.currentDrawing().project;
    buildStableCadProjectSignature(historyProject);
    buildStableCadProjectSignature(baseProject);
    expect(signatureCalls()).toBe(2);
    expect(realStable(historyProject)).toBe(realStable(baseProject));
    await harness.unmount();
  });

  it('D: a genuine external deep change adopts with fresh history and new selection', async () => {
    const harness = await createHarness(createBlankCadDrawingDocument({ units: 'm' }));
    await harness.commitLandXml();
    expect(harness.ws().historyDepth).toBe(1);

    const historyProject = harness.ws().cadProject;
    const externalProject = externalDeepEdit(historyProject);
    expect(realStable(historyProject)).not.toBe(realStable(externalProject));
    expect(areCadProjectsCanonicallyEqual(historyProject, externalProject)).toBe(false);

    await harness.externalProject(() => externalProject);
    await harness.settle();

    expect(harness.ws().cadProject).toBe(externalProject);
    expect(harness.ws().historyDepth).toBe(0);
    expect(harness.ws().canUndo).toBe(false);
    expect(harness.ws().selectedEntityIds).toEqual([externalProject.entities[0]!.id]);
    await harness.unmount();
  });

  it('D2: surface style, F2F settings and metadata deep changes also adopt', async () => {
    const harness = await createHarness(createBlankCadDrawingDocument({ units: 'm' }));
    await harness.commitLandXml();

    const edits: Array<{ label: string; edit: ProjectEdit }> = [
      {
        label: 'surface style',
        edit: (project) => ({
          ...project,
          surfaceStyles: (project.surfaceStyles ?? []).map((style, index) =>
            index === 0
              ? { ...style, color: style.color === '#123456' ? '#654321' : '#123456' }
              : style,
          ),
        }),
      },
      {
        label: 'F2F settings',
        edit: (project) => ({
          ...project,
          fieldToFinishSettings:
            project.fieldToFinishSettings?.controlTokenAliases === undefined
              ? { controlTokenAliases: {} }
              : {},
        }),
      },
      {
        label: 'metadata',
        edit: (project) => ({
          ...project,
          metadata: { ...project.metadata, stationCount: project.metadata.stationCount + 1 },
        }),
      },
    ];

    for (const { label, edit } of edits) {
      const before = harness.ws().cadProject;
      const next = edit(before);
      expect(realStable(before), label).not.toBe(realStable(next));
      expect(areCadProjectsCanonicallyEqual(before, next), label).toBe(false);
      await harness.externalProject(() => next);
      await harness.settle();
      expect(harness.ws().cadProject, label).toBe(next);
      expect(harness.ws().historyDepth, label).toBe(0);
      expect(harness.ws().selectedEntityIds, label).toEqual([next.entities[0]!.id]);
    }

    await harness.unmount();
  });

  it('E: resetKey switch, undo/redo, rapid updates and selection-only updates stay coherent', async () => {
    const harness = await createHarness(pointDrawing());
    resetSignatureCalls();

    // Selection-only updates touch present.selection, never the project.
    await act(async () => {
      harness.ws().selectEntity('pt:B');
    });
    await harness.settle();
    expect(harness.ws().selectedEntityIds).toEqual(['pt:B']);
    expect(harness.ws().historyDepth).toBe(0);
    expect(signatureCalls()).toBe(0);

    // Undo/redo ordering.
    await harness.commitLandXml();
    expect(harness.ws().historyDepth).toBe(1);
    await act(async () => {
      harness.ws().undo();
    });
    expect(harness.ws().historyDepth).toBe(0);
    expect(harness.ws().canRedo).toBe(true);
    await act(async () => {
      harness.ws().redo();
    });
    expect(harness.ws().historyDepth).toBe(1);

    // resetKey change adopts atomically to the current base project.
    const baseBeforeReset = harness.currentDrawing().project;
    await harness.setResetKey('reset-key-2');
    await harness.settle();
    expect(harness.ws().cadProject).toBe(baseBeforeReset);
    expect(harness.ws().historyDepth).toBe(0);
    expect(harness.ws().canRedo).toBe(false);
    expect(signatureCalls()).toBe(0);

    // Rapid external deep edits batch to the final project with no mixing.
    const projectAfterReset = harness.ws().cadProject;
    const expectedFinal = externalDeepEdit(externalDeepEdit(projectAfterReset));
    await harness.externalProjectBatch([externalDeepEdit, externalDeepEdit]);
    await harness.settle();
    expect(harness.ws().historyDepth).toBe(0);
    expect(realStable(harness.ws().cadProject)).toBe(realStable(expectedFinal));
    expect(harness.ws().selectedEntityIds).toEqual([expectedFinal.entities[0]!.id]);
    expect(harness.renderCount()).toBeGreaterThan(0);

    // Out of scope (documented, not tested): an in-place mutation that keeps
    // `baseProject` reference identity does not re-run the adopt effect because
    // its dependencies are [baseProject, resetKey]. External updates must supply
    // a new project reference, which every production path does.
    await harness.unmount();
  });
});

// ---------------------------------------------------------------------------
// Negative controls: these fail if the old behavior is reintroduced.
// ---------------------------------------------------------------------------

describe('PERF-187 negative controls', () => {
  it('F1: the old two-unconditional-call path exceeds the 0-call budget', () => {
    const project = buildSyntheticProject(8);
    resetSignatureCalls();
    expect(signatureCalls()).toBe(0);
    buildStableCadProjectSignature(project);
    buildStableCadProjectSignature(project);
    expect(signatureCalls()).toBeGreaterThan(0);
  });

  it('F2: a naive reference/raw-stringify comparison would differ on the TIN clone', async () => {
    const harness = await createHarness(createBlankCadDrawingDocument({ units: 'm' }));
    await harness.commitLandXml();
    const historyProject = harness.ws().cadProject;
    const cloned = cloneCadProject(historyProject);
    await harness.unmount();

    // Naive reference-inequality: always different for a fresh clone.
    expect(cloned).not.toBe(historyProject);
    // Naive raw JSON comparison: diverges on normalized imported-TIN key order.
    expect(buildCadProjectSignature(historyProject)).not.toBe(buildCadProjectSignature(cloned));
    // Oracle + helper both report equal, so undo must survive.
    expect(realStable(historyProject)).toBe(realStable(cloned));
    expect(areCadProjectsCanonicallyEqual(historyProject, cloned)).toBe(true);
  });

  it('F3: raw JSON.stringify is order-sensitive while the helper is not', () => {
    const first = {
      kind: 'tin',
      importedTin: { vertices: [1], faces: [2], provenance: { a: 1, b: 2 } },
    };
    const second = {
      importedTin: { provenance: { b: 2, a: 1 }, faces: [2], vertices: [1] },
      kind: 'tin',
    };
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
    expect(realStable(first as unknown as CadProject)).toBe(realStable(second as unknown as CadProject));
    expect(areCadProjectsCanonicallyEqual(first as unknown as CadProject, second as unknown as CadProject)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Oracle parity: helper result must equal `buildStable(a) === buildStable(b)`.
// ---------------------------------------------------------------------------

type Outcome = boolean | 'throw';

const helperOutcome = (first: unknown, second: unknown): Outcome => {
  try {
    return areCadProjectsCanonicallyEqual(first as CadProject, second as CadProject);
  } catch {
    return 'throw';
  }
};

const oracleOutcome = (first: unknown, second: unknown): Outcome => {
  try {
    return realStable(first as CadProject) === realStable(second as CadProject);
  } catch {
    return 'throw';
  }
};

class FallbackHolder {
  value: number;

  constructor(value: number) {
    this.value = value;
  }

  describe(): string {
    return `holder:${this.value}`;
  }
}

const cyclicValue = (): Record<string, unknown> => {
  const record: Record<string, unknown> = {};
  record.self = record;
  return record;
};

interface ParityCase {
  label: string;
  first: unknown;
  second: unknown;
  expected: Outcome;
}

const PARITY_CASES: ParityCase[] = [
  {
    label: 'nested key-order change',
    first: { outer: { x: 1, nested: { p: 1, q: 2 } } },
    second: { outer: { nested: { q: 2, p: 1 }, x: 1 } },
    expected: true,
  },
  {
    label: 'optional undefined vs missing',
    first: { a: 1, optional: undefined },
    second: { a: 1 },
    expected: true,
  },
  {
    label: 'undefined/function/symbol object values are dropped',
    first: { a: { x: undefined, y: () => 1, z: Symbol('s') } },
    second: { a: {} },
    expected: true,
  },
  {
    label: 'undefined/function/symbol array values become null',
    first: { a: [undefined, () => 1, Symbol('s')] },
    second: { a: [null, null, null] },
    expected: true,
  },
  {
    label: 'array order is significant',
    first: { a: [1, 2, 3] },
    second: { a: [3, 2, 1] },
    expected: false,
  },
  {
    label: 'null equals NaN (both serialize null)',
    first: { a: null },
    second: { a: Number.NaN },
    expected: true,
  },
  {
    label: 'null equals Infinity (both serialize null)',
    first: { a: null },
    second: { a: Number.POSITIVE_INFINITY },
    expected: true,
  },
  {
    label: 'negative zero equals zero',
    first: { a: -0 },
    second: { a: 0 },
    expected: true,
  },
  {
    label: 'old LandXML TIN payload key order',
    first: {
      identity: 'tin',
      importedTin: {
        provenance: { source: 'landxml', revision: 1 },
        faces: [1, 2, 3],
        vertices: [{ x: 0, y: 0, z: 0 }],
      },
    },
    second: {
      identity: 'tin',
      importedTin: {
        vertices: [{ z: 0, y: 0, x: 0 }],
        faces: [1, 2, 3],
        provenance: { revision: 1, source: 'landxml' },
      },
    },
    expected: true,
  },
  {
    label: 'TIN payload value difference',
    first: { identity: 'tin', importedTin: { faces: [1, 2, 3] } },
    second: { identity: 'tin', importedTin: { faces: [1, 2, 4] } },
    expected: false,
  },
  {
    label: 'block definitions key order',
    first: {
      blockDefinitions: [
        {
          id: 'blk:1',
          name: 'marker',
          basePoint: { x: 0, y: 0 },
          entities: [{ id: 'blk:1:line', type: 'line', fromX: 0, fromY: 0, toX: 1, toY: 1 }],
        },
      ],
    },
    second: {
      blockDefinitions: [
        {
          entities: [{ toY: 1, toX: 1, fromY: 0, fromX: 0, type: 'line', id: 'blk:1:line' }],
          basePoint: { y: 0, x: 0 },
          name: 'marker',
          id: 'blk:1',
        },
      ],
    },
    expected: true,
  },
  {
    label: 'F2F catalog/settings key order',
    first: {
      fieldToFinishCatalog: { id: 'cat:1', codes: [{ code: 'TOP', description: 'top of bank' }] },
      fieldToFinishSettings: { controlAliases: { TOP: 'TB' } },
    },
    second: {
      fieldToFinishSettings: { controlAliases: { TOP: 'TB' } },
      fieldToFinishCatalog: { codes: [{ description: 'top of bank', code: 'TOP' }], id: 'cat:1' },
    },
    expected: true,
  },
  {
    label: 'surface + ordered edit stack key order',
    first: {
      surfaces: [
        {
          id: 'surf:1',
          definition: {
            pointSource: { kind: 'points', pointEntityIds: ['pt:A', 'pt:B'] },
            edits: [{ kind: 'swap-edge', edge: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } } }],
          },
        },
      ],
    },
    second: {
      surfaces: [
        {
          definition: {
            edits: [{ edge: { b: { y: 1, x: 1 }, a: { y: 0, x: 0 } }, kind: 'swap-edge' }],
            pointSource: { pointEntityIds: ['pt:A', 'pt:B'], kind: 'points' },
          },
          id: 'surf:1',
        },
      ],
    },
    expected: true,
  },
  {
    label: 'surface edit-stack order is significant',
    first: { surfaces: [{ id: 's', definition: { edits: [{ kind: 'a' }, { kind: 'b' }] } }] },
    second: { surfaces: [{ id: 's', definition: { edits: [{ kind: 'b' }, { kind: 'a' }] } }] },
    expected: false,
  },
  {
    // If the helper compared `value` directly it would report a difference;
    // the toJSON fallback keeps the exact `buildStable` answer (which honors
    // the nested `toJSON`).
    label: 'exotic toJSON object falls back to canonical serializer (agree, no throw)',
    first: { a: { toJSON: () => 1, value: 5 } },
    second: { a: { toJSON: () => 1, value: 6 } },
    expected: true,
  },
  {
    label: 'exotic class instance falls back to canonical serializer (agree, no throw)',
    first: { a: new FallbackHolder(1) },
    second: { a: { value: 1 } },
    expected: true,
  },
  {
    label: 'exotic bigint-bearing object falls back (JSON cannot serialize: both throw)',
    first: { a: { value: BigInt(1) } },
    second: { a: { value: BigInt(2) } },
    expected: 'throw',
  },
  {
    label: 'exotic cyclic object falls back (JSON cannot serialize: both throw)',
    first: { a: cyclicValue() },
    second: { a: cyclicValue() },
    expected: 'throw',
  },
];

describe('PERF-187 oracle parity (helper vs both buildStable outputs)', () => {
  it.each(PARITY_CASES)('$label', ({ first, second, expected }) => {
    expect(oracleOutcome(first, second)).toBe(expected);
    expect(helperOutcome(first, second)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Shared-reference parity: a shared nested REFERENCE must not let the raw fast
// path claim equality for a cyclic graph. The raw stringify throws on a
// cycle, so the helper routes to the canonical oracle and preserves its
// throw-parity; only an identical TOP-LEVEL reference returns `true` directly.
// ---------------------------------------------------------------------------

describe('PERF-187 shared-reference parity (narrowed identity shortcut)', () => {
  it('G1: distinct projects sharing one CYCLIC nested reference throw on helper AND oracle', () => {
    const sharedCycle: Record<string, unknown> = {};
    sharedCycle.self = sharedCycle;
    const first = { nested: sharedCycle } as unknown as CadProject;
    const second = { nested: sharedCycle } as unknown as CadProject;

    // Distinct top-level identities, so the mount fast path does not apply and
    // the shared cyclic nested object must fall through to the serializer
    // fallback on BOTH sides.
    expect(first).not.toBe(second);
    expect(() => realStable(first)).toThrow();
    expect(() => realStable(second)).toThrow();
    expect(() => areCadProjectsCanonicallyEqual(first, second)).toThrow();
  });

  it('G2: same-reference CYCLIC project returns helper true by contract, oracle throws', () => {
    const cyclicProject: Record<string, unknown> = {};
    cyclicProject.self = cyclicProject;
    const project = cyclicProject as unknown as CadProject;

    // Narrowed guarantee: identical top-level references return `true` by
    // contract without consulting the serializer (safe mount behavior: no
    // adopt, no undo loss, no render crash). Cyclic graphs are outside the
    // domain, so the oracle still throws.
    expect(areCadProjectsCanonicallyEqual(project, project)).toBe(true);
    expect(() => realStable(project)).toThrow();
  });

  it('G3: distinct projects sharing a NON-cyclic plain reference take the raw path', () => {
    const shared = { p: 1, q: { r: 'x' } };
    const first = { nested: shared } as unknown as CadProject;
    const second = { nested: shared } as unknown as CadProject;

    // Plain data, so the raw pair runs and its strings match. The export
    // spy cannot observe the module-local fallback; prove the raw branch with
    // the global JSON.stringify spy: exactly two calls whose first args are the
    // ORIGINAL input refs (a canonical rebuild would pass fresh objects).
    const measured = measureStringifyCalls(() => areCadProjectsCanonicallyEqual(first, second));
    expect(measured.result).toBe(true);
    expect(measured.calls).toBe(2);
    expect(measured.firstArgs[0]).toBe(first);
    expect(measured.firstArgs[1]).toBe(second);
    expect(realStable(first)).toBe(realStable(second));
  });
});

// ---------------------------------------------------------------------------
// Perf sample: counts and serialized bytes, never wall-clock thresholds.
// ---------------------------------------------------------------------------

describe('PERF-187 sampled comparison cost (counts, not time gates)', () => {
  it('uses exactly two raw stringify calls on equal order-preserved clones', () => {
    const samples = [
      { label: '1k', entityCount: 1_000, iterations: 5 },
      { label: '10k', entityCount: 10_000, iterations: 3 },
    ];

    for (const sample of samples) {
      const base = buildSyntheticProject(sample.entityCount);

      let newStableCalls = 0;
      let newStringifyCalls = 0;
      const equalChecks: boolean[] = [];
      const newStart = performance.now();
      for (let index = 0; index < sample.iterations; index += 1) {
        const clone = cloneCadProject(base);
        resetSignatureCalls();
        // Tight synchronous window: exactly the helper call. `cloneCadProject`
        // above stays OUTSIDE it (it is not the measured path). The
        // order-preserved raw branch must issue exactly two stringify calls
        // with the ORIGINAL refs; the global spy proves both.
        const measured = measureStringifyCalls(() => areCadProjectsCanonicallyEqual(base, clone));
        equalChecks.push(measured.result);
        expect(measured.calls).toBe(2);
        expect(measured.firstArgs[0]).toBe(base);
        expect(measured.firstArgs[1]).toBe(clone);
        newStringifyCalls += measured.calls;
        newStableCalls += signatureCalls();
      }
      const newElapsedMs = performance.now() - newStart;

      let oldStableCalls = 0;
      let oldBytes = 0;
      const oldStart = performance.now();
      for (let index = 0; index < sample.iterations; index += 1) {
        const clone = cloneCadProject(base);
        resetSignatureCalls();
        // The old path compared two stable signatures. Count those calls
        // through the mocked export, and derive the byte cost from the REAL
        // oracle strings: `realStable` bypasses the mock, so measuring it does
        // not perturb the count or the measured path.
        buildStableCadProjectSignature(base);
        buildStableCadProjectSignature(clone);
        oldStableCalls += signatureCalls();
        oldBytes += realStable(base).length + realStable(clone).length;
      }
      const oldElapsedMs = performance.now() - oldStart;

      expect(equalChecks).toHaveLength(sample.iterations);
      expect(equalChecks.every((value) => value === true)).toBe(true);
      expect(newStableCalls).toBe(0);
      expect(newStringifyCalls).toBe(sample.iterations * 2);
      expect(oldStableCalls).toBe(sample.iterations * 2);
      expect(oldBytes).toBeGreaterThan(0);

      console.log(
        `[PERF-187] entities=${sample.entityCount} iterations=${sample.iterations} ` +
          `equalChecks=${equalChecks.length} newStableCalls=${newStableCalls} ` +
          `newStringifyCalls=${newStringifyCalls} ` +
          `oldStableCalls=${oldStableCalls} oldBytes=${oldBytes} ` +
          `newElapsedMs=${newElapsedMs.toFixed(2)} oldElapsedMs=${oldElapsedMs.toFixed(2)}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// PERF-187 P1 redesign: branch-discriminating raw-path battery.
//
// The raw branch issues exactly TWO `JSON.stringify` calls whose first args are
// the ORIGINAL refs (no canonical rebuild — the airtight observable). The
// fallback issues FOUR (the completed raw pair plus the two canonical oracle
// calls).
// ---------------------------------------------------------------------------

describe('PERF-187 raw-path branch battery', () => {
  it('R1: an order-preserved 1k-entity clone takes the raw branch', () => {
    const base = buildSyntheticProject(1_000);
    const clone = cloneCadProject(base);
    expect(clone).not.toBe(base);

    const measured = measureStringifyCalls(() => areCadProjectsCanonicallyEqual(base, clone));
    expect(measured.result).toBe(true);
    expect(measured.calls).toBe(2);
    expect(measured.firstArgs[0]).toBe(base);
    expect(measured.firstArgs[1]).toBe(clone);
    expect(realStable(base)).toBe(realStable(clone));
  });

  it('R2: a toJSON-constant pair with equal raw output stays on the raw branch and agrees', () => {
    const first = { a: { toJSON: () => 1, value: 5 } } as unknown as CadProject;
    const second = { a: { toJSON: () => 1, value: 6 } } as unknown as CadProject;
    // Raw output is equal (both toJSON constants serialize identically), which
    // is exactly the identity-sensitive family the raw contract accepts.
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const measured = measureStringifyCalls(() => areCadProjectsCanonicallyEqual(first, second));
    expect(measured.result).toBe(true);
    expect(measured.calls).toBe(2);
    expect(measured.firstArgs[0]).toBe(first);
    expect(measured.firstArgs[1]).toBe(second);
    expect(realStable(first)).toBe(realStable(second));
  });

  it('R3: a key-reordered clone takes the fallback branch (4 calls) yet returns true', () => {
    const first = {
      kind: 'tin',
      importedTin: { vertices: [1], faces: [2], provenance: { a: 1, b: 2 } },
    } as unknown as CadProject;
    const second = {
      importedTin: { provenance: { b: 2, a: 1 }, faces: [2], vertices: [1] },
      kind: 'tin',
    } as unknown as CadProject;
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));

    const measured = measureStringifyCalls(() => areCadProjectsCanonicallyEqual(first, second));
    expect(measured.result).toBe(true);
    expect(measured.calls).toBe(4);
    expect(realStable(first)).toBe(realStable(second));
  });
});

// ---------------------------------------------------------------------------
// PERF-187 correction round 2 (raw-path abort): exotic parity must not
// depend on where a plain difference appears. The raw pair aborts for the WHOLE
// side on the first cycle/bigint/toJSON throw, so an early plain difference can
// never mask a later exotic: the helper routes to the canonical oracle and
// preserves its throw behavior.
// ---------------------------------------------------------------------------

describe('PERF-187 correction round 2 (domain pre-scan ordering)', () => {
  it('H1: an earlier plain difference must not mask a later shared cycle (helper AND oracle throw)', () => {
    const sharedCycle: Record<string, unknown> = {};
    sharedCycle.self = sharedCycle;
    const first = { a: 0, b: sharedCycle } as unknown as CadProject;
    const second = { a: 1, b: sharedCycle } as unknown as CadProject;

    expect(first).not.toBe(second);
    // The difference at `a` is encountered first, but the cycle at `b` makes
    // the whole document non-serializable on both sides, so the oracle throws
    // and the helper must too instead of short-circuiting to false.
    expect(oracleOutcome(first, second)).toBe('throw');
    expect(helperOutcome(first, second)).toBe('throw');
  });

  it('H2: a null short-circuit must not mask a later bigint (helper AND oracle throw)', () => {
    // Direct bigint value: the raw stringify throws on it directly.
    const directFirst = { a: null } as unknown as CadProject;
    const directSecond = { a: BigInt(1) } as unknown as CadProject;
    expect(() => realStable(directFirst)).not.toThrow();
    expect(() => realStable(directSecond)).toThrow();
    expect(oracleOutcome(directFirst, directSecond)).toBe('throw');
    expect(helperOutcome(directFirst, directSecond)).toBe('throw');

    // Bigint hidden behind an array: `realStable(directFirst)` serializes fine
    // and `realStable(nestedSecond)` throws, so the oracle throws; the raw pair
    // must abort into the fallback instead of comparing a raw `null` against a
    // partially serialized array.
    const nestedFirst = { a: null } as unknown as CadProject;
    const nestedSecond = { a: [BigInt(1)] } as unknown as CadProject;
    expect(() => realStable(nestedFirst)).not.toThrow();
    expect(() => realStable(nestedSecond)).toThrow();
    expect(oracleOutcome(nestedFirst, nestedSecond)).toBe('throw');
    expect(helperOutcome(nestedFirst, nestedSecond)).toBe('throw');
  });

  it('H3: a nested toJSON after an earlier plain difference falls back and agrees on false', () => {
    const first = { a: 0, b: { toJSON: () => 1, value: 5 } } as unknown as CadProject;
    const second = { a: 1, b: { toJSON: () => 1, value: 5 } } as unknown as CadProject;

    expect(oracleOutcome(first, second)).toBe(false);
    // The raw pair differs at `a` before the nested `toJSON` matters, so the
    // helper falls back to the canonical oracle. That fallback is module-local,
    // so the export spy cannot see it; the global JSON.stringify spy proves it
    // ran (4 calls: 2 raw + 2 canonical). This is the spy-sensitivity control
    // for the perf sample's raw-branch budget above.
    const measured = measureStringifyCalls(() => helperOutcome(first, second));
    expect(measured.result).toBe(false);
    expect(measured.calls).toBe(4);

    // A throwing `toJSON` is the order-dependent variant: the raw pair throws,
    // so the helper falls back to the oracle, which throws too.
    const throwingFirst = {
      a: 0,
      b: {
        toJSON: () => {
          throw new Error('H3 toJSON');
        },
      },
    } as unknown as CadProject;
    const throwingSecond = {
      a: 1,
      b: {
        toJSON: () => {
          throw new Error('H3 toJSON');
        },
      },
    } as unknown as CadProject;
    expect(oracleOutcome(throwingFirst, throwingSecond)).toBe('throw');
    expect(helperOutcome(throwingFirst, throwingSecond)).toBe('throw');
  });
});

// ---------------------------------------------------------------------------
// PERF-187 correction round 3: accessor + array-map guards.
//
// Accessors are read through the raw stringify (which invokes a getter exactly
// like the oracle does), and an `Array` whose virtual `map` was overridden is
// an `Array` subclass. Each case asserts helper/oracle agreement on a fresh
// input pair, since a stateful getter advances on every read.
// ---------------------------------------------------------------------------

interface AccessorReadState {
  reads: number;
}

const incrementingGetterProject = (
  state: AccessorReadState,
): { first: CadProject; second: CadProject } => {
  const withGetter: Record<string, unknown> = {};
  Object.defineProperty(withGetter, 'count', {
    enumerable: true,
    configurable: true,
    get(): number {
      state.reads += 1;
      return state.reads;
    },
  });
  return {
    first: { a: withGetter } as unknown as CadProject,
    second: { a: { count: 1 } } as unknown as CadProject,
  };
};

const indexGetterProject = (
  state: AccessorReadState,
): { first: CadProject; second: CadProject } => {
  const array: unknown[] = [0, 2];
  Object.defineProperty(array, '0', {
    enumerable: true,
    configurable: true,
    get(): number {
      state.reads += 1;
      return state.reads;
    },
  });
  return {
    first: { a: array } as unknown as CadProject,
    second: { a: [1, 2] } as unknown as CadProject,
  };
};

class MapOverridingArray extends Array<number> {}

Object.defineProperty(MapOverridingArray.prototype, 'map', {
  value: (): number[] => [0],
  writable: true,
  configurable: true,
});

const mapOverridingArrayProject = (): { first: CadProject; second: CadProject } => {
  const wild = new MapOverridingArray();
  wild.push(1);
  return {
    first: { a: wild } as unknown as CadProject,
    second: { a: [0] } as unknown as CadProject,
  };
};

describe('PERF-187 correction round 3 (accessor + array-map cases)', () => {
  it('J1: object accessor is read consistently and agrees with the oracle', () => {
    const oracleState: AccessorReadState = { reads: 0 };
    const oraclePair = incrementingGetterProject(oracleState);
    const oracle = oracleOutcome(oraclePair.first, oraclePair.second);

    const helperState: AccessorReadState = { reads: 0 };
    const helperPair = incrementingGetterProject(helperState);
    const helper = helperOutcome(helperPair.first, helperPair.second);

    expect(helper).toBe(oracle);
    // Agreeing without a specific boolean: both paths evaluated the getter, so
    // the raw path did not silently drop it.
    expect(oracleState.reads).toBeGreaterThan(0);
    expect(helperState.reads).toBeGreaterThan(0);
  });

  it('J2: array-index accessor is read consistently and agrees with the oracle', () => {
    const oracleState: AccessorReadState = { reads: 0 };
    const oraclePair = indexGetterProject(oracleState);
    const oracle = oracleOutcome(oraclePair.first, oraclePair.second);

    const helperState: AccessorReadState = { reads: 0 };
    const helperPair = indexGetterProject(helperState);
    const helper = helperOutcome(helperPair.first, helperPair.second);

    expect(helper).toBe(oracle);
    expect(oracleState.reads).toBeGreaterThan(0);
    expect(helperState.reads).toBeGreaterThan(0);
  });

  it('J3: Array subclass overriding map routes to the fallback and agrees with the oracle', () => {
    const oraclePair = mapOverridingArrayProject();
    const oracle = oracleOutcome(oraclePair.first, oraclePair.second);

    const helperPair = mapOverridingArrayProject();
    const helper = helperOutcome(helperPair.first, helperPair.second);

    expect(helper).toBe(oracle);
  });
});

// ---------------------------------------------------------------------------
// PERF-187 correction round 4: Array-subclass / species exclusion.
//
// `Array.prototype.map` consults `constructor[Symbol.species]`; a subclass
// whose species yields a non-array makes the NATIVE map return a plain object,
// so the canonicalizer produces an object while raw `JSON.stringify` still
// serializes the subclass by index. The raw fast path therefore returns `true`
// where the oracle returns `false`. Array-subclass instances are
// production-impossible (`JSON.parse` and clone boundaries yield plain
// `Array.prototype` arrays), so K1 pins this as a documented SAFE-DIRECTION
// exclusion (`true` = keep history). K2 pins a non-overriding subclass as an
// ordinary raw-path equal case.
// ---------------------------------------------------------------------------

class SpeciesObjectArray extends Array<number> {}

Object.defineProperty(SpeciesObjectArray, Symbol.species, {
  get: () => Object,
  configurable: true,
});

const speciesObjectArrayProject = (): { first: CadProject; second: CadProject } => {
  const wild = new SpeciesObjectArray();
  wild.push(1);
  return {
    first: { a: wild } as unknown as CadProject,
    second: { a: [1] } as unknown as CadProject,
  };
};

class PlainBehaviorArray extends Array<number> {}

const plainBehaviorArrayProject = (): { first: CadProject; second: CadProject } => {
  const value = new PlainBehaviorArray();
  value.push(1);
  return {
    first: { a: value } as unknown as CadProject,
    second: { a: [1] } as unknown as CadProject,
  };
};

describe('PERF-187 correction round 4 (Array-subclass / species exclusion)', () => {
  it('K1: an Array subclass whose species yields a non-array is a documented safe-direction exclusion', () => {
    const oraclePair = speciesObjectArrayProject();
    const oracle = oracleOutcome(oraclePair.first, oraclePair.second);

    const helperPair = speciesObjectArrayProject();
    const helper = helperOutcome(helperPair.first, helperPair.second);

    // Documented exclusion, same precedent as G2's same-reference cyclic case:
    // the raw JSON of a species-overriding Array subclass equals plain `[1]`,
    // so the raw fast path returns `true` while the canonical oracle returns
    // `false`. (i) Array-subclass instances are production-impossible:
    // `JSON.parse`, structured clone, and every engine clone yield plain
    // `Array.prototype` arrays (ODD_ARRAYS=0 on a real 10k-entity project).
    // (ii) Review declared species shapes non-blocking/unreachable.
    // (iii) SAFETY DIRECTION: for inert JSON / engine-clone-producible data
    // the raw path can only err toward `true` (= keep history, never wipe),
    // while `false` comes only from the exact oracle fallback, so no such input
    // can cause a spurious history wipe beyond what the oracle itself orders.
    // (The stateful-accessor exclusion in round 5 is likewise
    // production-impossible.)
    expect(oracle).toBe(false);
    expect(helper).toBe(true);
    expect(realStable(oraclePair.first)).not.toBe(realStable(oraclePair.second));
  });

  it('K2: an Array subclass with plain behavior takes the raw path and agrees with the oracle', () => {
    const oraclePair = plainBehaviorArrayProject();
    expect(oraclePair.first).not.toBe(oraclePair.second);

    // A non-overriding subclass serializes to the same plain `[1]` string, so
    // the raw pair runs (2 calls, first args = the ORIGINAL refs) with no
    // fallback. The export spy stays 0 because the raw path never reaches the
    // module-local oracle.
    resetSignatureCalls();
    const measured = measureStringifyCalls(() => helperOutcome(oraclePair.first, oraclePair.second));
    expect(measured.result).toBe(true);
    expect(measured.calls).toBe(2);
    expect(measured.firstArgs[0]).toBe(oraclePair.first);
    expect(measured.firstArgs[1]).toBe(oraclePair.second);

    expect(oracleOutcome(oraclePair.first, oraclePair.second)).toBe(true);
    expect(signatureCalls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PERF-187 correction round 5: stateful-accessor exclusion (P2-1).
//
// The false-direction guarantee is limited to INERT data. A stateful getter is
// read by the helper's raw pass AND again by its fallback canonicalization,
// while the oracle canonicalizes each side exactly once, so the helper can
// report `false` where the oracle reports `true`. Inert data has data
// descriptors only (`JSON.parse`/engine clones never produce getters), so this
// is production-impossible; the case below pins the divergence as documented.
// ---------------------------------------------------------------------------

interface StatefulAccessorState {
  reads: number;
}

/**
 * Side A carries a top-level counter getter at `x`; side B is the equivalent
 * plain object with the key order reversed. The oracle reads the getter once
 * (1) and compares equal; the helper reads it in the raw pass (1), then
 * re-reads it in the fallback canonicalization (2), so the sides differ.
 */
const statefulAccessorDivergenceProject = (
  state: StatefulAccessorState,
): { first: CadProject; second: CadProject } => {
  const first: Record<string, unknown> = {};
  Object.defineProperty(first, 'x', {
    enumerable: true,
    configurable: true,
    get(): number {
      state.reads += 1;
      return state.reads;
    },
  });
  first.y = 7;
  return {
    first: first as unknown as CadProject,
    second: { y: 7, x: 1 } as unknown as CadProject,
  };
};

describe('PERF-187 correction round 5 (stateful accessor exclusion)', () => {
  it('L1: stateful accessor divergence is documented (inert-data guarantee only)', () => {
    const oracleState: StatefulAccessorState = { reads: 0 };
    const oraclePair = statefulAccessorDivergenceProject(oracleState);
    // The oracle canonicalizes each side exactly once: the getter yields 1,
    // which matches side B, so the oracle reports `true`.
    expect(oracleOutcome(oraclePair.first, oraclePair.second)).toBe(true);
    expect(oracleState.reads).toBe(1);

    const helperState: StatefulAccessorState = { reads: 0 };
    const helperPair = statefulAccessorDivergenceProject(helperState);
    // The helper's raw pass reads the getter once, the raw strings differ by
    // key order, and the fallback canonicalization re-reads it, so the helper
    // observes 2 against side B's 1 and reports `false`.
    expect(helperOutcome(helperPair.first, helperPair.second)).toBe(false);
    expect(helperState.reads).toBe(2);

    // Documented exclusion (same precedent as G2/K1):
    // (i) stateful accessors are production-impossible: `JSON.parse`,
    // structured clone, and every engine clone yield data descriptors only.
    // (ii) The divergence is bounded: it requires the helper to read a getter
    // more times than the oracle's single canonicalization read, so it cannot
    // arise on inert data.
    // (iii) SAFETY DIRECTION: for inert data the raw path can still only err
    // toward `true` (keep history), while `false` comes only from the exact
    // oracle fallback, so no production input can cause a spurious history
    // wipe.
    const controlState: StatefulAccessorState = { reads: 0 };
    const controlPair = statefulAccessorDivergenceProject(controlState);
    expect(JSON.stringify(controlPair.first)).not.toBe(JSON.stringify(controlPair.second));
    expect(controlState.reads).toBe(1);
  });
});
