/** @vitest-environment jsdom */
/**
 * STRUCT-194.8 — derived-scene presentation hooks.
 *
 * Real hooks mounted through a tiny harness (no worker, no native module):
 *   - `useSurveyCadPreGradingDerivedScene`: parcel-label toggle, stable memo
 *     references, cache-version epoch recompute, reported-computation filter;
 *   - `useSurveyCadGradingEditOverlayScene`: zero-preview base-reference
 *     preservation and the exact edit -> point -> bulkSelection -> bulkEdit
 *     preview append order.
 *
 * Fast + deterministic; agent tier.
 */
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  useSurveyCadPreGradingDerivedScene,
  type SurveyCadPreGradingDerivedScene,
  type SurveyCadPreGradingDerivedSceneArgs,
} from '../src/hooks/surveyCad/useSurveyCadPreGradingDerivedScene';
import {
  useSurveyCadGradingEditOverlayScene,
  type SurveyCadGradingEditOverlaySceneArgs,
} from '../src/hooks/surveyCad/useSurveyCadGradingEditOverlayScene';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import type { CadCogoComputation } from '../src/engine/cad/cadCogoTypes';
import type {
  CadDisplayPrimitive,
  CadDisplayScene,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import type {
  SurveyCadSurfaceProfileInputs,
  SurveyCadSurfaceSectionInputs,
} from '../src/hooks/surveyCad/useSurveyCadProfileSectionLifecycle';
import type { SurfaceGradingService } from '../src/workers/surfaceGradingService';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const point = (id: string, x: number, y: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z: 0,
  pointClass: 'free',
  source: 'parsed-input',
});

const projectWith = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Derived 1948', units: 'm' });
  return appendCadProjectEntities(drawing.project, [
    point('sp:e1', 0, 0),
    point('sp:e2', 10, 0),
  ]);
};

const textPrimitive = (id: string, sourceEntityId: string): CadDisplayPrimitive => ({
  id,
  layerId: 'labels',
  sourceEntityId,
  kind: 'text',
  point: { x: 1, y: 2 },
  text: 'x',
  fontSize: 2,
  stroke: '#111111',
});

const linePrimitive = (id: string): CadDisplayPrimitive => ({
  id,
  layerId: '0',
  sourceEntityId: 'sp:e1',
  kind: 'line',
  points: [{ x: 0, y: 0 }, { x: 5, y: 0 }],
  strokeWidth: 1,
  stroke: '#111111',
});

const sceneWith = (primitives: CadDisplayPrimitive[]): CadDisplayScene => ({
  bounds: null,
  primitives,
});

const profileInputs = (version: number): SurveyCadSurfaceProfileInputs =>
  ({ version } as unknown as SurveyCadSurfaceProfileInputs);

const sectionInputs = (version: number): SurveyCadSurfaceSectionInputs =>
  ({ version } as unknown as SurveyCadSurfaceSectionInputs);

const emptyAnalysis = { layers: [], legendLayers: [] };

interface Mounted {
  root: Root;
  container: HTMLElement;
  set: (_element: React.ReactElement) => Promise<void>;
}

const mounted: Mounted[] = [];

const mount = async (element: React.ReactElement): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  const view: Mounted = {
    root,
    container,
    set: async (next) => {
      await act(async () => {
        root.render(next);
      });
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
});

/** Plain mutable holder (not a ref) populated from the hook-observing harness. */
const holder = <T,>(): { value: T | null } => ({ value: null });

// ---------------------------------------------------------------------------
// useSurveyCadPreGradingDerivedScene
// ---------------------------------------------------------------------------

const PreGradingHarness: React.FC<{
  args: SurveyCadPreGradingDerivedSceneArgs;
  onResult: (_value: SurveyCadPreGradingDerivedScene) => void;
}> = ({ args, onResult }) => {
  const value = useSurveyCadPreGradingDerivedScene(args);
  useEffect(() => {
    onResult(value);
  }, [value, onResult]);
  return null;
};

const baseArgs = (overrides: Partial<SurveyCadPreGradingDerivedSceneArgs> = {}): SurveyCadPreGradingDerivedSceneArgs => ({
  displayScene: sceneWith([
    textPrimitive('sp:e1:parcel-label', 'sp:e1'),
    textPrimitive('sp:e2:note', 'sp:e2'),
    linePrimitive('sp:e1:line'),
  ]),
  showParcelLabels: true,
  activeProject: projectWith(),
  profileCache: null,
  surfaceProfileInputs: profileInputs(0),
  surfaceSectionInputs: sectionInputs(0),
  sectionCache: null,
  analysisDisplay: emptyAnalysis,
  reportedComputation: null,
  ...overrides,
});

describe('STRUCT-194.8 useSurveyCadPreGradingDerivedScene', () => {
  it('keeps the derived scene + reported-entity references stable when no dep changed', async () => {
    const args = baseArgs();
    const box = holder<SurveyCadPreGradingDerivedScene>();
    const onResult = (value: SurveyCadPreGradingDerivedScene): void => {
      box.value = value;
    };
    const view = await mount(<PreGradingHarness args={args} onResult={onResult} />);
    const first = box.value!;
    await view.set(<PreGradingHarness args={args} onResult={onResult} />);
    expect(box.value!.displaySceneWithSections).toBe(first.displaySceneWithSections);
    expect(box.value!.reportedComputationEntities).toBe(first.reportedComputationEntities);
  });

  it('removes only :parcel-label text primitives when labels are off', async () => {
    const box = holder<SurveyCadPreGradingDerivedScene>();
    const onResult = (value: SurveyCadPreGradingDerivedScene): void => {
      box.value = value;
    };
    const args = baseArgs();
    const view = await mount(<PreGradingHarness args={args} onResult={onResult} />);
    expect(box.value!.displaySceneWithSections.primitives.map((entry) => entry.id))
      .toEqual(['sp:e1:parcel-label', 'sp:e2:note', 'sp:e1:line']);

    await view.set(<PreGradingHarness args={{ ...args, showParcelLabels: false }} onResult={onResult} />);
    expect(box.value!.displaySceneWithSections.primitives.map((entry) => entry.id))
      .toEqual(['sp:e2:note', 'sp:e1:line']);
    expect(box.value!.displaySceneWithSections.primitives).not.toBe(args.displayScene.primitives);
  });

  it('recomputes when the profile/section cache version epoch changes', async () => {
    const box = holder<SurveyCadPreGradingDerivedScene>();
    const onResult = (value: SurveyCadPreGradingDerivedScene): void => {
      box.value = value;
    };
    const args = baseArgs();
    const view = await mount(<PreGradingHarness args={args} onResult={onResult} />);
    const before = box.value!.displaySceneWithSections;

    await view.set(
      <PreGradingHarness
        args={{ ...args, surfaceProfileInputs: profileInputs(1), surfaceSectionInputs: sectionInputs(1) }}
        onResult={onResult}
      />,
    );
    expect(box.value!.displaySceneWithSections).not.toBe(before);
  });

  it('preserves primitive source ids and reuses the filtered primitive list without a refilter', async () => {
    const box = holder<SurveyCadPreGradingDerivedScene>();
    const onResult = (value: SurveyCadPreGradingDerivedScene): void => {
      box.value = value;
    };
    const args = baseArgs();
    await mount(<PreGradingHarness args={args} onResult={onResult} />);
    const primitives = box.value!.displaySceneWithSections.primitives;
    expect(primitives.map((entry) => entry.sourceEntityId)).toEqual(['sp:e1', 'sp:e2', 'sp:e1']);
  });

  it('filters reported-computation entities by createdEntityIds', async () => {
    const box = holder<SurveyCadPreGradingDerivedScene>();
    const onResult = (value: SurveyCadPreGradingDerivedScene): void => {
      box.value = value;
    };
    const args = baseArgs({
      reportedComputation: { createdEntityIds: ['sp:e2'] } as unknown as CadCogoComputation,
    });
    await mount(<PreGradingHarness args={args} onResult={onResult} />);
    expect(box.value!.reportedComputationEntities.map((entry) => entry.id)).toEqual(['sp:e2']);
  });
});

// ---------------------------------------------------------------------------
// useSurveyCadGradingEditOverlayScene
// ---------------------------------------------------------------------------

const OverlayHarness: React.FC<{
  args: SurveyCadGradingEditOverlaySceneArgs;
  onResult: (_value: CadDisplayScene) => void;
}> = ({ args, onResult }) => {
  const value = useSurveyCadGradingEditOverlayScene(args);
  useEffect(() => {
    onResult(value);
  }, [value, onResult]);
  return null;
};

const previewPrimitive = (id: string): CadDisplayPrimitive => ({
  id,
  layerId: 'preview',
  sourceEntityId: id,
  kind: 'point',
  point: { x: 0, y: 0 },
  radius: 1,
  stroke: '#ff0000',
});

const overlayArgs = (previews: Partial<SurveyCadGradingEditOverlaySceneArgs> = {}): SurveyCadGradingEditOverlaySceneArgs => ({
  activeProject: projectWith(),
  displaySceneWithSections: sceneWith([linePrimitive('base')]),
  shellSnapshot: null,
  gradingService: { groupGradingDiagnostics: () => new Map() } as unknown as SurfaceGradingService,
  surfaceEditPreviewPrimitives: [],
  surfacePointEditPreviewPrimitives: [],
  surfaceBulkSelectionPreviewPrimitives: [],
  surfaceBulkEditPreviewPrimitives: [],
  ...previews,
});

describe('STRUCT-194.8 useSurveyCadGradingEditOverlayScene', () => {
  it('preserves the grading-stage reference when there are zero previews', async () => {
    const args = overlayArgs();
    const box = holder<CadDisplayScene>();
    const onResult = (value: CadDisplayScene): void => {
      box.value = value;
    };
    const view = await mount(<OverlayHarness args={args} onResult={onResult} />);
    const first = box.value!;
    expect(first.primitives.map((entry) => entry.id)).toEqual(['base']);
    await view.set(<OverlayHarness args={args} onResult={onResult} />);
    expect(box.value).toBe(first);
  });

  it('appends previews in edit -> point -> bulkSelection -> bulkEdit order', async () => {
    const args = overlayArgs({
      surfaceEditPreviewPrimitives: [previewPrimitive('edit1'), previewPrimitive('edit2')],
      surfacePointEditPreviewPrimitives: [previewPrimitive('point1')],
      surfaceBulkSelectionPreviewPrimitives: [previewPrimitive('sel1')],
      surfaceBulkEditPreviewPrimitives: [previewPrimitive('bulk1')],
    });
    const box = holder<CadDisplayScene>();
    const onResult = (value: CadDisplayScene): void => {
      box.value = value;
    };
    await mount(<OverlayHarness args={args} onResult={onResult} />);
    expect(box.value!.primitives.map((entry) => entry.id))
      .toEqual(['base', 'edit1', 'edit2', 'point1', 'sel1', 'bulk1']);
  });
});
