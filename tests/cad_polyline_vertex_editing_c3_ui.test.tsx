/** @vitest-environment jsdom */

/**
 * Phase C3 — UI-level tests: the Properties panel renders the polyline
 * vertex/course actions (with disabled reason) and routes clicks. The typed
 * command sessions and engine transactions are covered by the pure tests;
 * the end-to-end browser flow lives in tests-browser/cad-draw-polyline-c3.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadEntity, CadPolylineEntity, CadProject } from '../src/engine/cad/cadTypes';
import SurveyCadPropertiesPanel from '../src/components/surveyCad/SurveyCadPropertiesPanel';

const P = (x: number, y: number) => ({ x, y });

const polyline = (overrides: Partial<CadPolylineEntity> = {}): CadPolylineEntity => {
  const vertices = overrides.vertices ?? [P(0, 0), P(10, 0), P(10, 10)];
  const base: CadPolylineEntity = {
    id: 'poly-c3',
    type: 'polyline',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices,
    vertexLabels: vertices.map(() => ''),
    closed: false,
  };
  return { ...base, ...overrides };
};

const projectWith = (entities: CadEntity[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Phase C3 ui', units: 'm' });
  return { ...drawing.project, entities: [...drawing.project.entities, ...entities] };
};

const renderPanel = async (entity: CadEntity) => {
  const panelState = buildCadPropertiesPanelState(projectWith([entity]), [entity]);
  if (!panelState) throw new Error('properties missing');
  const onParcelRowAction = vi.fn(() => ({ applied: true }));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <SurveyCadPropertiesPanel
        panelState={panelState}
        dock="right"
        dockOffsetPx={0}
        floatingLeftPx={0}
        floatingTopPx={0}
        collapsed={false}
        onSetDock={() => {}}
        onToggleCollapsed={() => {}}
        onClose={() => {}}
        onSelectEntity={() => {}}
        onEditField={() => ({ applied: true })}
        onParcelRowAction={onParcelRowAction}
      />,
    );
  });
  return { container, root, onParcelRowAction };
};

describe('C3 Properties panel: vertex/course action buttons', () => {
  it('renders Delete Vertex per vertex and Insert Vertex per course, routing clicks', async () => {
    const entity = polyline({
      vertices: [P(0, 0), P(10, 0), P(20, 0)],
      segmentGeometry: [{ kind: 'line' }, { kind: 'arc', bulge: 1 }],
    });
    const { container, root, onParcelRowAction } = await renderPanel(entity);
    const deletes = container.querySelectorAll(
      '[data-survey-cad-properties-action^="polyline-delete-vertex:"]',
    );
    const inserts = container.querySelectorAll(
      '[data-survey-cad-properties-action^="polyline-insert-vertex:"]',
    );
    expect(deletes).toHaveLength(3);
    expect(inserts).toHaveLength(2);

    await act(async () => {
      (inserts[1] as HTMLButtonElement).click();
    });
    expect(onParcelRowAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'polyline-insert-vertex', courseIndex: 1 }),
    );
    await act(async () => {
      (deletes[2] as HTMLButtonElement).click();
    });
    expect(onParcelRowAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'polyline-delete-vertex', vertexIndex: 2 }),
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('disables Delete Vertex on a 2-vertex polyline with the reason as the title', async () => {
    const { container, root } = await renderPanel(polyline({ vertices: [P(0, 0), P(10, 0)] }));
    const disabled = container.querySelectorAll<HTMLButtonElement>(
      '[data-survey-cad-properties-action^="polyline-delete-vertex:"]',
    );
    expect(disabled).toHaveLength(2);
    for (const button of disabled) {
      expect(button.disabled).toBe(true);
      expect(button.title).toMatch(/retained vertices/i);
    }
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
