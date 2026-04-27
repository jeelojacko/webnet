/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const buildIndustryListingTextSpy = vi.fn(() => 'MOCK INDUSTRY OUTPUT');

vi.mock('../src/engine/runOutputBuilders', async () => {
  const actual = await vi.importActual<typeof import('../src/engine/runOutputBuilders')>(
    '../src/engine/runOutputBuilders',
  );
  return {
    ...actual,
    createRunOutputBuilders: vi.fn(() => ({
      buildIndustryListingText: buildIndustryListingTextSpy,
      buildLandXmlExportText: vi.fn(() => ''),
    })),
  };
});

import App from '../src/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const waitForCondition = async (
  predicate: () => boolean,
  timeoutMs: number,
  failureMessage: string,
) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw new Error(failureMessage);
};

const clickByText = async (container: HTMLElement, text: string) => {
  const button = Array.from(container.querySelectorAll('button')).find((entry) =>
    entry.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`Button "${text}" not found.`);
  await act(async () => {
    button.click();
  });
};

const openIndustryOutputContextMenu = async (container: HTMLElement) => {
  const viewport = container.querySelector('[data-industry-output-viewport]') as HTMLDivElement | null;
  if (!viewport) throw new Error('Industry output viewport not found for context menu interaction.');
  await act(async () => {
    viewport.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 30,
        clientY: 30,
      }),
    );
  });
};

describe('App industry listing lazy build', () => {
  it(
    'does not build industry listing text until industry tab is active',
    async () => {
      buildIndustryListingTextSpy.mockClear();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root: Root = createRoot(container);

      await act(async () => {
        root.render(<App />);
      });

      await clickByText(container, 'Adjust');
      await waitForCondition(
        () => container.textContent?.includes('Observations & Residuals') === true,
        15000,
        'Expected report output after running adjustment.',
      );

      expect(buildIndustryListingTextSpy).not.toHaveBeenCalled();

      await clickByText(container, 'Map & Ellipses');
      await clickByText(container, 'Adjustment Report');

      expect(buildIndustryListingTextSpy).not.toHaveBeenCalled();

      await clickByText(container, 'Industry Standard Output');
      await waitForCondition(
        () => container.textContent?.includes('MOCK INDUSTRY OUTPUT') === true,
        10000,
        'Expected mocked industry output text after opening industry tab.',
      );
      expect(buildIndustryListingTextSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
    30000,
  );

  it(
    'rebuilds industry listing text when sort mode changes from the industry output context menu',
    async () => {
      buildIndustryListingTextSpy.mockClear();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root: Root = createRoot(container);

      await act(async () => {
        root.render(<App />);
      });

      await clickByText(container, 'Adjust');
      await waitForCondition(
        () => container.textContent?.includes('Observations & Residuals') === true,
        15000,
        'Expected report output after running adjustment.',
      );

      await clickByText(container, 'Industry Standard Output');
      await waitForCondition(
        () => container.textContent?.includes('MOCK INDUSTRY OUTPUT') === true,
        10000,
        'Expected mocked industry output text after opening industry tab.',
      );
      expect(buildIndustryListingTextSpy).toHaveBeenCalledTimes(1);

      await openIndustryOutputContextMenu(container);

      const sortButton = container.querySelector(
        '[data-industry-output-menu-sort-by]',
      ) as HTMLButtonElement | null;
      if (!sortButton) throw new Error('Sort-by context menu button missing.');
      await act(async () => {
        sortButton.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });

      const stdErrorButton = container.querySelector(
        '[data-industry-output-sort-option="stdError"]',
      ) as HTMLButtonElement | null;
      if (!stdErrorButton) throw new Error('Std Error option missing.');
      await act(async () => {
        stdErrorButton.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });

      await waitForCondition(
        () => buildIndustryListingTextSpy.mock.calls.length >= 2,
        10000,
        'Expected listing rebuild after sort-mode change.',
      );

      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
    30000,
  );
});
