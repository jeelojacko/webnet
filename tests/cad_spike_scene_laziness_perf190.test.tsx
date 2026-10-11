/** @vitest-environment jsdom */
/**
 * PERF-190 — the mlightcad spike scene is built lazily, exactly once per
 * project identity, and only on the first read.
 *
 * The workspace shell has no production consumer that reads
 * `UseSurveyCadWorkspaceResult.mlightcadScene`, so eagerly rebuilding the
 * scene for each committed project was pure per-render cost. This suite wraps
 * the real adapter with a deterministic invocation counter (never wall-clock)
 * and drives the real `useSurveyCadWorkspace` hook through a minimal
 * `react-dom/client` probe, matching the established workspace harness.
 *
 * A negative-control eager probe at the bottom proves the "no call until
 * read" assertions are load-bearing (the counter does observe eager builds).
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const builderSpy = vi.hoisted(() => ({ count: 0 }));

vi.mock('../src/engine/cad/cadMlightcadAdapter', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/engine/cad/cadMlightcadAdapter')>();
  return {
    ...actual,
    buildMlightcadSpikeScene: (
      ...args: Parameters<typeof actual.buildMlightcadSpikeScene>
    ) => {
      builderSpy.count += 1;
      return actual.buildMlightcadSpikeScene(...args);
    },
  };
});

import { buildMlightcadSpikeScene } from '../src/engine/cad/cadMlightcadAdapter';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
} from '../src/engine/cad/cadDrawingFile';
import { replaceCadProjectEntities } from '../src/engine/cad/cadProjectState';
import type {
  CadDrawingDocument,
  CadEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';
import { useSurveyCadWorkspace } from '../src/hooks/surveyCad/useSurveyCadWorkspace';
import type { UseSurveyCadWorkspaceResult } from '../src/hooks/surveyCad/useSurveyCadWorkspace.types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal deterministic project: one line, one arc, one polyline + bounds. */
const buildProject = (): CadProject => {
  const base = createBlankCadProject({ name: 'perf190', units: 'm' });
  const layerId = base.layers[0]!.id;
  const entities: CadEntity[] = [
    {
      id: 'line:1',
      type: 'line',
      layerId,
      visible: true,
      locked: false,
      fromStationId: 'A',
      toStationId: 'B',
      fromX: 0,
      fromY: 0,
      toX: 10,
      toY: 0,
      sourceObservationIds: [1],
    },
    {
      id: 'arc:1',
      type: 'arc',
      layerId,
      visible: true,
      locked: false,
      centerX: 5,
      centerY: 5,
      radius: 3,
      startAngleDeg: 0,
      endAngleDeg: 90,
    },
    {
      id: 'polyline:1',
      type: 'polyline',
      layerId,
      visible: true,
      locked: false,
      vertices: [
        { x: 0, y: 10 },
        { x: 4, y: 12 },
        { x: 8, y: 9 },
      ],
      vertexLabels: ['P1', 'P2', 'P3'],
      closed: false,
    },
  ];
  return replaceCadProjectEntities(base, entities);
};

/** New immutable identity with different contents (fourth entity + bounds). */
const buildProjectVariant = (): CadProject => {
  const project = buildProject();
  const extra: CadEntity = {
    id: 'line:2',
    type: 'line',
    layerId: project.layers[0]!.id,
    visible: true,
    locked: false,
    fromStationId: 'C',
    toStationId: 'D',
    fromX: 20,
    fromY: 20,
    toX: 30,
    toY: 25,
    sourceObservationIds: [2],
  };
  return replaceCadProjectEntities(project, [...project.entities, extra]);
};

interface HarnessHandle {
  api: () => UseSurveyCadWorkspaceResult;
  setProject: (_project: CadProject) => void;
  select: (_entityId: string) => void;
}

const HarnessInner: React.FC<{
  drawing: CadDrawingDocument;
  setDrawing: React.Dispatch<React.SetStateAction<CadDrawingDocument | null>>;
  handleRef: { current: HarnessHandle | null };
}> = ({ drawing, setDrawing, handleRef }) => {
  const ws = useSurveyCadWorkspace(
    drawing.project,
    drawing.drawingId,
    setDrawing,
    drawing,
    undefined,
    true,
    false,
    'thin',
  );
  React.useEffect(() => {
    handleRef.current = {
      api: () => ws,
      setProject: (project) =>
        setDrawing((current) => (current ? { ...current, project } : current)),
      select: (entityId) => ws.selectEntity(entityId),
    };
  });
  return null;
};

const Harness: React.FC<{
  initial: CadProject;
  handleRef: { current: HarnessHandle | null };
}> = ({ initial, handleRef }) => {
  const [drawing, setDrawing] = React.useState<CadDrawingDocument | null>(() => ({
    ...createBlankCadDrawingDocument({ units: 'm' }),
    project: initial,
  }));
  if (!drawing) return null;
  return <HarnessInner drawing={drawing} setDrawing={setDrawing} handleRef={handleRef} />;
};

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

const mount = async (element: React.ReactElement): Promise<void> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(element);
  });
};

const newHandle = (): { current: HarnessHandle | null } => ({ current: null });

beforeEach(() => {
  builderSpy.count = 0;
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  vi.restoreAllMocks();
  builderSpy.count = 0;
});

describe('PERF-190 lazy mlightcad spike scene', () => {
  it('mounts with the property present but never calls the adapter until read', async () => {
    const handle = newHandle();
    await mount(<Harness initial={buildProject()} handleRef={handle} />);
    const ws = handle.current!.api();

    // Required read surface preserved (own getter, never optional/undefined).
    expect(Object.getOwnPropertyNames(ws)).toContain('mlightcadScene');

    // Mount alone: zero adapter invocations.
    expect(builderSpy.count).toBe(0);

    // Unrelated field reads do not trigger the build.
    expect(ws.cadProject.entities).toHaveLength(3);
    expect(ws.displayScene.primitives.length).toBeGreaterThan(0);
    expect(ws.selectedEntities).toHaveLength(1);
    expect(builderSpy.count).toBe(0);

    const scene = ws.mlightcadScene;
    expect(builderSpy.count).toBe(1);
    expect(scene.entities).toHaveLength(3);
  });

  it('first read calls the builder once and returns the exact adapter output', async () => {
    const project = buildProject();
    const handle = newHandle();
    await mount(<Harness initial={project} handleRef={handle} />);
    const ws = handle.current!.api();
    expect(builderSpy.count).toBe(0);

    const scene = ws.mlightcadScene;
    expect(builderSpy.count).toBe(1);

    const expected = buildMlightcadSpikeScene(project);
    expect(scene).toEqual(expected);
    expect(scene.layers.map((layer) => layer.id)).toEqual(
      project.layers.map((layer) => layer.id),
    );
    expect(scene.entities.map((entity) => entity.objectId)).toEqual(
      project.entities.map((entity) => entity.id),
    );
    expect(scene.extents).toEqual(project.bounds);
  });

  it('repeated reads for the same identity return the same reference (no rebuild)', async () => {
    const handle = newHandle();
    await mount(<Harness initial={buildProject()} handleRef={handle} />);
    const ws = handle.current!.api();

    const first = ws.mlightcadScene;
    const second = ws.mlightcadScene;
    expect(builderSpy.count).toBe(1);
    expect(second).toBe(first);
  });

  it('keeps the cache across selection re-renders and rebuilds once for a new identity', async () => {
    const handle = newHandle();
    await mount(<Harness initial={buildProject()} handleRef={handle} />);
    const ws = handle.current!.api();

    const before = ws.mlightcadScene;
    expect(builderSpy.count).toBe(1);

    // A selection-only state change re-renders without touching the project.
    await act(async () => {
      handle.current!.select('arc:1');
    });
    const afterSelection = handle.current!.api();
    expect(afterSelection.selectedEntityIds).toContain('arc:1');
    expect(afterSelection.mlightcadScene).toBe(before);
    expect(builderSpy.count).toBe(1);

    // A new immutable project identity invalidates the cache lazily.
    const variant = buildProjectVariant();
    await act(async () => {
      handle.current!.setProject(variant);
    });
    const afterProject = handle.current!.api();
    expect(afterProject.cadProject).toBe(variant);
    expect(builderSpy.count).toBe(1); // still lazy: not read yet

    const rebuilt = afterProject.mlightcadScene;
    expect(builderSpy.count).toBe(2); // exactly one build for the new identity
    expect(rebuilt).not.toBe(before);
    expect(rebuilt.entities).toHaveLength(4);
    // The direct reference build is itself an adapter call; account for it.
    expect(rebuilt).toEqual(buildMlightcadSpikeScene(variant));
    expect(builderSpy.count).toBe(3);

    expect(afterProject.mlightcadScene).toBe(rebuilt);
    expect(builderSpy.count).toBe(3);
  });

  it('StrictMode mount never builds without a read', async () => {
    const handle = newHandle();
    await mount(
      <React.StrictMode>
        <Harness initial={buildProject()} handleRef={handle} />
      </React.StrictMode>,
    );
    expect(builderSpy.count).toBe(0);

    const first = handle.current!.api().mlightcadScene;
    expect(builderSpy.count).toBe(1);
    expect(handle.current!.api().mlightcadScene).toBe(first);
    expect(builderSpy.count).toBe(1);
  });

  it('a fresh mount after unmount rebuilds only on read (no global cache)', async () => {
    const project = buildProject();
    const firstHandle = newHandle();
    await mount(<Harness initial={project} handleRef={firstHandle} />);
    firstHandle.current!.api().mlightcadScene;
    expect(builderSpy.count).toBe(1);

    await act(async () => {
      mounted[0]!.root.unmount();
    });
    mounted.shift();

    const secondHandle = newHandle();
    await mount(<Harness initial={project} handleRef={secondHandle} />);
    expect(builderSpy.count).toBe(1); // no eager build on remount
    secondHandle.current!.api().mlightcadScene;
    expect(builderSpy.count).toBe(2);
  });

  it('negative control: an eager build does run on mount without any read', async () => {
    const EagerProbe: React.FC<{ project: CadProject }> = ({ project }) => {
      const scene = React.useMemo(() => buildMlightcadSpikeScene(project), [project]);
      return <span>{scene.entities.length}</span>;
    };
    await mount(<EagerProbe project={buildProject()} />);
    expect(builderSpy.count).toBeGreaterThan(0);
    // The lazy suite's mount assertion (`count === 0`) fails for this variant.
    expect(() => expect(builderSpy.count).toBe(0)).toThrow();
  });
});
