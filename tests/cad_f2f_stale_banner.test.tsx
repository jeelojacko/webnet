/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import type { CadProject } from '../src/engine/cad/cadTypes';
import {
  buildFieldToFinishProject,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import type { FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import { stampFieldToFinishLink } from '../src/engine/fieldToFinish/linkedSync';
import { SurveyCadFieldToFinishPanel } from '../src/components/surveyCad/SurveyCadFieldToFinishPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const catalog: FeatureCodeCatalog = {
  id: 'test-catalog',
  name: 'Test',
  version: '3',
  definitions: [
    {
      id: 'tree', code: 'TREE', description: 'Tree', layer: 'VG-TREE',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
  ],
  aliases: [],
};

const projectWithStatus = (status: 'CURRENT' | 'SOURCE_TOPOLOGY_CHANGED'): CadProject => {
  const points: FieldToFinishCadPoint[] = [{
    stationId: 'T1', x: 0, y: 0, sourceOrder: 1, sourceLine: 1,
    codes: [{ code: 'TREE' }], rawCodeText: 'TREE', sourceImportId: 'import-1',
  }];
  const built = buildFieldToFinishProject(
    createBlankCadProject({ name: 'F2F', units: 'm' }),
    {
      points, catalog, generationRunId: 'run-1',
      source: { sourceKind: 'adjustment', inputFingerprint: 'in-1', settingsFingerprint: 'set-1' },
    },
  ).project;
  if (status === 'CURRENT') return built;
  return stampFieldToFinishLink(built, { status });
};

const renderPanel = async (project: CadProject, onCommit: () => void): Promise<{ element: HTMLElement; cleanup: () => void }> => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const root = createRoot(element);
  await act(async () => {
    root.render(<SurveyCadFieldToFinishPanel project={project} onCommitPayload={onCommit} />);
  });
  return {
    element,
    cleanup: () => {
      root.unmount();
      element.remove();
    },
  };
};

describe('f2f stale link banner', () => {
  it('surfaces stale status with a preview-required action and commits nothing', async () => {
    const onCommit = vi.fn();
    const project = projectWithStatus('SOURCE_TOPOLOGY_CHANGED');
    const before = JSON.stringify(project.entities);
    const { element, cleanup } = await renderPanel(project, onCommit);
    try {
      const banner = element.querySelector('[data-f2f-link-status]');
      expect(banner).not.toBeNull();
      expect(banner?.getAttribute('data-f2f-link-status')).toBe('SOURCE_TOPOLOGY_CHANGED');
      expect(banner?.textContent).toContain('SOURCE_TOPOLOGY_CHANGED');
      expect(banner?.textContent).toContain('nothing is applied automatically');
      // Explicit preview-required action jumps to the Preview step (no regen).
      const review = element.querySelector('button[data-f2f-link-review]');
      expect(review).not.toBeNull();
      await act(async () => {
        review?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(element.querySelector('[data-f2f-regen]')).not.toBeNull();
      expect(onCommit).not.toHaveBeenCalled();
      expect(JSON.stringify(project.entities)).toBe(before);
    } finally {
      cleanup();
    }
  });

  it('renders no banner for a CURRENT link', async () => {
    const { element, cleanup } = await renderPanel(projectWithStatus('CURRENT'), vi.fn());
    try {
      expect(element.querySelector('[data-f2f-link-status]')).toBeNull();
    } finally {
      cleanup();
    }
  });
});
