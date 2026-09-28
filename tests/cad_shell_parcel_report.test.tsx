/** @vitest-environment jsdom */

/**
 * Phase 21B — parcel report migration into the shell Properties palette.
 *
 * The legacy `SurveyCadParcelReportOverlay` (area ha/ac/ft² + headed course
 * table) is migrated as a palette section. These tests pin the report data on
 * the parcel snapshot, the palette render (units/rounding/course table), the
 * curved-course case (arc metrics stay visible via the engine rows), and that
 * no legacy floating overlay is reintroduced. Shared-boundary row actions stay
 * functional next to the report block.
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import {
  buildParcelCourseIds,
} from '../src/engine/cad/cadParcelCourses';
import { buildCadParcelSharedBoundaryId } from '../src/engine/cad/cadParcelSharedBoundary';
import type { CadParcelCourseGeometry, CadParcelEntity, CadProject, CadSnapKind } from '../src/engine/cad/cadTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import { buildCadParcelSnapshot } from '../src/cad-app/shell/cadParcelSnapshot';
import { CadPropertiesPalette } from '../src/cad-app/shell/CadPropertiesPalette';
import { buildBaseCadPropertiesProject } from './cadPropertiesTestSupport';

const rectangleParcel = (): CadParcelEntity => ({
  id: 'parcel:line',
  type: 'parcel',
  layerId: 'general',
  visible: true,
  locked: false,
  parcelName: 'Parcel Line',
  vertices: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 5 },
    { x: 0, y: 5 },
  ],
  vertexLabels: ['A', 'B', 'C', 'D'],
  courseIds: buildParcelCourseIds('parcel:line', 4),
});

const line: CadParcelCourseGeometry = { kind: 'line' };
const arc = (bulge: number): CadParcelCourseGeometry => ({ kind: 'arc', bulge });

/** Diameter line (0,0)->(20,0) + R10 northern semicircle: area 50π, perimeter 20+10π. */
const curvedParcel = (): CadParcelEntity => ({
  id: 'parcel:curved',
  type: 'parcel',
  layerId: 'general',
  visible: true,
  locked: false,
  parcelName: 'Parcel Curved',
  vertices: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
  ],
  vertexLabels: ['A', 'B', 'C'],
  courseIds: buildParcelCourseIds('parcel:curved', 3),
  courseGeometry: [line, line, arc(1)],
});

const SNAP_KINDS: CadSnapKind[] = [
  'point-node', 'endpoint', 'midpoint', 'center', 'arc-midpoint', 'quadrant',
  'intersection', 'apparent-intersection', 'extension', 'perpendicular',
  'parallel', 'direction', 'tangent', 'nearest',
];

const snapPrefs = (): CadWorkspaceSnapshot['snapPreferences'] =>
  Object.fromEntries(SNAP_KINDS.map((kind) => [kind, false])) as CadWorkspaceSnapshot['snapPreferences'];

const projectWith = (...entities: CadParcelEntity[]): CadProject =>
  appendCadProjectEntities(buildBaseCadPropertiesProject(), entities);

const stubActions = (overrides: Partial<CadShellActions> = {}): CadShellActions =>
  ({
    editField: vi.fn(() => ({ applied: true })),
    runLayerCommand: vi.fn(() => true),
    runParcelLinkAction: vi.fn(() => ({ applied: true })),
    ...overrides,
  }) as unknown as CadShellActions;

const snapshotOf = (
  project: CadProject,
  selectedEntityIds: string[],
): CadWorkspaceSnapshot => {
  const entities = project.entities.filter((entity) => selectedEntityIds.includes(entity.id));
  return {
    drawingId: 'd1',
    drawingName: 'Report-Test',
    units: 'm',
    entityCount: project.entities.length,
    selectionCount: selectedEntityIds.length,
    selectedEntityIds,
    selectionPreview: [],
    layers: project.layers,
    layerEntityCounts: {},
    currentLayerId: 'general',
    lineTypes: [],
    sheets: [],
    properties: buildCadPropertiesPanelState(project, entities),
    activeCommandKey: null,
    commandPrompt: 'Idle',
    commandInputValue: '',
    canUndo: false,
    canRedo: false,
    historyDepth: 0,
    redoDepth: 0,
    snapPreferences: snapPrefs(),
    snapStatusText: 'OSNAP off',
    stationCount: 0,
    dependencyStatus: 'MANUAL_ONLY',
    availableCommands: [],
    survey: null,
    surface: null,
    volume: null,
    profile: null,
    section: null,
    blocks: null,
    f2f: null,
    parcel: buildCadParcelSnapshot(project, selectedEntityIds),
  } as CadWorkspaceSnapshot;
};

const render = async (node: ReactNode): Promise<{ container: HTMLElement; root: Root }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return { container, root };
};

const cleanup = async (container: HTMLElement, root: Root): Promise<void> => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
};

describe('Phase 21B parcel report snapshot', () => {
  it('exposes the authoritative report with the straight course table', () => {
    const snapshot = buildCadParcelSnapshot(projectWith(rectangleParcel()), ['parcel:line']);
    const entry = snapshot.selectedParcel!;
    expect(entry.report).not.toBeNull();
    expect(entry.status).toBe('OK');
    expect(entry.report!.areaSquareMeters).toBeCloseTo(100, 6);
    expect(entry.report!.perimeterMeters).toBeCloseTo(50, 6);
    expect(entry.report!.courseCount).toBe(4);
    expect(entry.lineCount).toBe(4);
    expect(entry.arcCount).toBe(0);
    expect(entry.report!.courses.map((course) => course.bearing)).toEqual([
      'N90-00-00.00E',
      'N00-00-00.00E',
      'S90-00-00.00W',
      'S00-00-00.00E',
    ]);
    expect(entry.report!.courses.map((course) => course.distanceMeters)).toEqual([20, 5, 20, 5]);
  });

  it('carries line/arc counts and curve details for a curved parcel', () => {
    const snapshot = buildCadParcelSnapshot(projectWith(curvedParcel()), ['parcel:curved']);
    const entry = snapshot.selectedParcel!;
    expect(entry.report!.areaSquareMeters).toBeCloseTo((Math.PI * 100) / 2, 6);
    expect(entry.lineCount).toBe(2);
    expect(entry.arcCount).toBe(1);
    expect(entry.report!.curveDetails?.filter((detail) => detail.kind === 'arc')).toHaveLength(1);
    // Arc courses keep truthful chord values in the straight course table.
    expect(entry.report!.courses).toHaveLength(3);
    expect(entry.report!.courses[2]!.distanceMeters).toBeCloseTo(20, 6);
  });
});

describe('Phase 21B parcel report palette block', () => {
  it('renders heading, area units, closure and the course table', async () => {
    const project = projectWith(rectangleParcel());
    const { container, root } = await render(
      <CadPropertiesPalette snapshot={snapshotOf(project, ['parcel:line'])} actions={stubActions()} />,
    );
    const block = container.querySelector('[data-cad-parcel-report="Parcel Line"]');
    expect(block).not.toBeNull();
    const text = block!.textContent ?? '';
    expect(text).toContain('Parcel Report');
    expect(text).toContain('100.000 m²');
    expect(text).toContain('0.0100 ha');
    expect(text).toContain('0.0247 ac');
    expect(text).toContain('1076.391 ft²');
    expect(text).toContain('50.000 m');
    expect(text).toContain('Closure dN');
    const rows = container.querySelectorAll('[data-cad-parcel-report-course]');
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain('A-B');
    expect(rows[0]?.textContent).toContain('N90-00-00.00E');
    expect(rows[0]?.textContent).toContain('20.000 m');
    await cleanup(container, root);
  });

  it('keeps curved-course metrics visible for a mixed line/arc parcel', async () => {
    const project = projectWith(curvedParcel());
    const { container, root } = await render(
      <CadPropertiesPalette snapshot={snapshotOf(project, ['parcel:curved'])} actions={stubActions()} />,
    );
    expect(container.querySelectorAll('[data-cad-parcel-report-course]')).toHaveLength(3);
    const text = container.textContent ?? '';
    expect(text).toContain('Arc courses');
    // Engine curve row (R/Δ/L) stays interleaved below the report block.
    expect(text).toContain('C-A curve');
    expect(text).toContain('R 10.000');
    await cleanup(container, root);
  });

  it('does not render the report block for a non-parcel selection', async () => {
    const project = projectWith(rectangleParcel());
    const lineEntity = project.entities[0]!;
    const { container, root } = await render(
      <CadPropertiesPalette snapshot={snapshotOf(project, [lineEntity.id])} actions={stubActions()} />,
    );
    expect(container.querySelector('[data-cad-parcel-report]')).toBeNull();
    await cleanup(container, root);
  });

  it('never reintroduces the legacy floating parcel report overlay', async () => {
    const project = projectWith(rectangleParcel());
    const { container, root } = await render(
      <CadPropertiesPalette snapshot={snapshotOf(project, ['parcel:line'])} actions={stubActions()} />,
    );
    expect(container.querySelector('[data-survey-cad-parcel-report]')).toBeNull();
    await cleanup(container, root);
  });
});

describe('Phase 21B shared-boundary actions beside the report block', () => {
  const buildNetwork = (): { project: CadProject; parcelAId: string; boundaryId: string } => {
    const parcelA = rectangleParcel();
    const parcelB: CadParcelEntity = {
      ...rectangleParcel(),
      id: 'parcel:b',
      parcelName: 'Parcel B',
      vertices: [
        { x: 20, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 5 },
        { x: 20, y: 5 },
      ],
      vertexLabels: ['E', 'F', 'G', 'H'],
      courseIds: buildParcelCourseIds('parcel:b', 4),
    };
    const first = { parcelId: 'parcel:line', courseId: parcelA.courseIds![1]! };
    const second = { parcelId: 'parcel:b', courseId: parcelB.courseIds![3]! };
    const boundaryId = buildCadParcelSharedBoundaryId(first, second);
    const base = appendCadProjectEntities(buildBaseCadPropertiesProject(), [parcelA, parcelB]);
    const project: CadProject = {
      ...base,
      sharedParcelBoundaries: [{ id: boundaryId, first, second }],
    };
    return { project, parcelAId: 'parcel:line', boundaryId };
  };

  it('routes Unlink through runParcelLinkAction with the report block present', async () => {
    const { project, parcelAId, boundaryId } = buildNetwork();
    const runParcelLinkAction = vi.fn(() => ({ applied: true }));
    const { container, root } = await render(
      <CadPropertiesPalette
        snapshot={snapshotOf(project, [parcelAId])}
        actions={stubActions({ runParcelLinkAction })}
      />,
    );
    expect(container.querySelector('[data-cad-parcel-report]')).not.toBeNull();
    const unlink = container.querySelector(
      `[data-cad-properties-action="parcel-unlink:${boundaryId}"]`,
    ) as HTMLButtonElement | null;
    expect(unlink).not.toBeNull();
    await act(async () => {
      unlink!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(runParcelLinkAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'parcel-unlink', linkId: boundaryId }),
    );
    await cleanup(container, root);
  });
});
