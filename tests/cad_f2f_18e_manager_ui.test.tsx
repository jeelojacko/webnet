/** @vitest-environment jsdom */

/**
 * Phase 18E manager UI contracts (agent-tier fast, jsdom render only).
 * Duplicate-code blocked messaging, missing-style warning retention,
 * unmapped create-definition handoff prefill.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { cloneFeatureCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import { STARTER_CATALOG } from '../src/engine/fieldToFinish/starterCatalog';
import { SurveyCadFeatureCatalogEditor } from '../src/components/surveyCad/SurveyCadFeatureCatalogEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderEditor = async (ui: React.ReactElement): Promise<{ element: HTMLElement; cleanup: () => void }> => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const root = createRoot(element);
  await act(async () => {
    root.render(ui);
  });
  return {
    element,
    cleanup: () => {
      act(() => root.unmount());
      element.remove();
    },
  };
};

describe('18e manager UI', () => {
  it('shows header, duplicate-code block, and keeps missing style refs', async () => {
    const catalog = cloneFeatureCatalog(STARTER_CATALOG);
    catalog.definitions.find((entry) => entry.id === 'ep')!.pointStyleId = 'ghost-style';
    catalog.definitions.push({
      id: 'ep-dup',
      code: 'ep',
      description: 'dup',
      layer: 'F2F-EDGE',
      pointBehavior: 'point',
      lineworkBehavior: { enabled: false, implicitContinuation: false },
    });
    const project = createBlankCadProject({ name: 'D', units: 'm' });
    const { element, cleanup } = await renderEditor(
      <SurveyCadFeatureCatalogEditor
        catalog={catalog}
        onCatalogChange={() => {}}
        drawing={{
          layers: project.layers,
          pointSymbols: project.styleLibrary.pointSymbols,
          pointStyles: project.pointStyles ?? [],
          labelStyles: project.labelStyles ?? [],
        }}
        linkStatus="CATALOG_CHANGED"
      />,
    );
    try {
      const header = element.querySelector('[data-f2f-catalog-header]');
      const nameInput = header?.querySelector('input[aria-label="Catalog name"]') as HTMLInputElement | null;
      expect(nameInput?.value).toBe('WebNet Starter Survey Catalog');
      expect(header?.textContent ?? '').toContain('12 definitions');
      expect(header?.textContent ?? '').toContain('CATALOG_CHANGED');
      const issues = element.querySelector('[data-f2f-catalog-issues]')?.textContent ?? '';
      expect(issues).toContain('Duplicate code');
      // Missing style ref: warning shown, stored ref kept in the dropdown.
      await act(async () => {
        (element.querySelector('[data-f2f-catalog-row="ep"]') as HTMLElement)?.dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        );
      });
      const warnings = [...element.querySelectorAll('[data-f2f-style-warning]')].map((node) => node.textContent);
      expect(warnings.some((text) => text?.includes('ghost-style'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('create-definition prefill adds the code and selects it', async () => {
    const catalog = cloneFeatureCatalog(STARTER_CATALOG);
    let latest = catalog;
    const project = createBlankCadProject({ name: 'D', units: 'm' });
    const { element, cleanup } = await renderEditor(
      <SurveyCadFeatureCatalogEditor
        catalog={latest}
        onCatalogChange={(next) => {
          latest = next;
        }}
        drawing={{
          layers: project.layers,
          pointSymbols: project.styleLibrary.pointSymbols,
          pointStyles: project.pointStyles ?? [],
          labelStyles: project.labelStyles ?? [],
        }}
        createPrefill={{ code: 'ROCK', description: 'Rock', layer: 'F2F-TOPO' }}
        onCreateConsumed={() => {}}
      />,
    );
    try {
      expect(latest.definitions.some((entry) => entry.code === 'ROCK')).toBe(true);
      const notice = element.querySelector('[data-f2f-catalog-notice]')?.textContent ?? '';
      expect(notice).toContain('ROCK');
    } finally {
      cleanup();
    }
  });
});
