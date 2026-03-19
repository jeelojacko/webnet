/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import App from '../src/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MountedApp = {
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
};

const waitForCondition = async (
  predicate: () => boolean,
  timeoutMs: number,
  failureMessage: string,
): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw new Error(failureMessage);
};

const waitForProjectOptionsContent = async (container: HTMLElement): Promise<void> => {
  await waitForCondition(
    () =>
      container.textContent?.includes('Project Options') === true &&
      !container.textContent.includes('Loading project options...'),
    5000,
    'Project Options modal content did not finish loading within 5000ms.',
  );
};

const tabReadyText: Record<
  NonNullable<React.ComponentProps<typeof App>['initialOptionsTab']>,
  string
> = {
  adjustment: 'Solver Configuration',
  general: 'Local / Grid Reduction',
  instrument: 'Instrument Selection',
  'listing-file': 'Listing Output',
  'other-files': 'Other File Outputs',
  special: 'Special',
  gps: 'Coordinate System (Canada-First)',
  modeling: 'TS Correlation',
};

const waitForTabContent = async (
  container: HTMLElement,
  initialOptionsTab: NonNullable<React.ComponentProps<typeof App>['initialOptionsTab']>,
): Promise<void> => {
  const readyText = tabReadyText[initialOptionsTab];
  await waitForCondition(
    () => container.textContent?.includes(readyText) === true,
    5000,
    `Project Options tab "${initialOptionsTab}" did not render "${readyText}" within 5000ms.`,
  );
};

const mountApp = async (
  initialOptionsTab: NonNullable<React.ComponentProps<typeof App>['initialOptionsTab']>,
): Promise<MountedApp> => {
  document.documentElement.setAttribute('data-theme', 'gruvbox-dark');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<App initialSettingsModalOpen={true} initialOptionsTab={initialOptionsTab} />);
  });
  await waitForProjectOptionsContent(container);
  await waitForTabContent(container, initialOptionsTab);
  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('Project Options modal layout', () => {
  it('renders the condensed adjustment layout with level-loop preset controls', async () => {
    const app = await mountApp('adjustment');
    try {
      expect(app.container.textContent).toContain('Project Options');
      expect(app.container.textContent).toContain('Solver Configuration');
      expect(app.container.textContent).toContain('Geodetic Framework');
      expect(app.container.textContent).toContain('Leveling / Weighting');
      expect(app.container.textContent).toContain('Convergence Limit');
      expect(app.container.textContent).toContain('Level Loop Preset');
      expect(app.container.textContent).toContain('Saved Custom Presets');
      expect(app.container.textContent).toContain('Add Current');
    } finally {
      await app.cleanup();
    }
  });

  it('renders the condensed instrument layout with labels left and inputs right', async () => {
    const app = await mountApp('instrument');
    try {
      expect(app.container.textContent).toContain('Instrument Selection');
      expect(app.container.textContent).toContain('Horizontal Precision');
      expect(app.container.textContent).toContain('Vertical Precision');
      expect(app.container.textContent).toContain('Instrument Description');
      expect(app.container.textContent).toContain('Duplicate');
      expect(app.container.textContent).toContain('Distance Constant');
      expect(app.container.textContent).toContain('Centering Vertical');
    } finally {
      await app.cleanup();
    }
  });

  it('renders the condensed general layout with reduction controls grouped in cards', async () => {
    const app = await mountApp('general');
    try {
      expect(app.container.textContent).toContain('Local / Grid Reduction');
      expect(app.container.textContent).toContain('Map Mode');
      expect(app.container.textContent).toContain('Map Scale Factor');
      expect(app.container.textContent).toContain('UI Theme');
      expect(app.container.textContent).toContain('Gruvbox Dark');
      expect(app.container.textContent).toContain('Gruvbox Light');
      expect(app.container.textContent).toContain('Catppuccin Mocha');
      expect(app.container.textContent).toContain('Catppuccin Latte');
      expect(app.container.textContent).toContain('Face Normalization Mode');
      expect(app.container.textContent).toContain('Vertical Reduction');
      expect(app.container.textContent).toContain('Curvature / Refraction');
      expect(app.container.textContent).toContain('Vertical Reduction Mode');
    } finally {
      await app.cleanup();
    }
  });

  it('renders the gps layout without the removed condensed-pane helper sentence', async () => {
    const app = await mountApp('gps');
    try {
      expect(app.container.textContent).toContain('Coordinate System (Canada-First)');
      expect(app.container.textContent).toContain('Coord System Mode');
      expect(app.container.textContent).toContain('CRS Catalog Group');
      expect(app.container.textContent).toContain('CRS (Grid Mode)');
      expect(app.container.textContent).toContain('Average Geoid Height');
      expect(app.container.textContent).toContain('Show Params');
      expect(app.container.textContent).toContain('Observation Input Mode (.MEASURED / .GRID)');
      expect(app.container.textContent).toContain('Advanced CRS/GPS/Height');
      expect(app.container.textContent).toContain('GPS Loop Check');
      expect(app.container.textContent).toContain('Geoid/Grid Model');
      expect(app.container.textContent).not.toContain(
        'The GPS pane is intentionally condensed: labels stay on the left, controls stay on the right, and disable rules mirror the parser defaults already in the engine.',
      );
    } finally {
      await app.cleanup();
    }
  });

  it('renders real Other Files controls instead of the placeholder panel', async () => {
    const app = await mountApp('other-files');
    try {
      expect(app.container.textContent).toContain('Other File Outputs');
      expect(app.container.textContent).toContain('Project Files');
      expect(app.container.textContent).toContain('Open Project');
      expect(app.container.textContent).toContain('Save Project');
      expect(app.container.textContent).toContain('Adjusted Points Export');
      expect(app.container.textContent).toContain('Transform');
      expect(app.container.textContent).toContain('Reference Point');
      expect(app.container.textContent).toContain('Rotation');
      expect(app.container.textContent).toContain('Translation');
      expect(app.container.textContent).toContain('Scale');
      expect(app.container.textContent).not.toContain('Coming Soon');
      expect(app.container.textContent).toContain('Enable Rotation');
      expect(app.container.textContent).toContain('Enable Translation');
      expect(app.container.textContent).toContain('Enable Scale');
      expect(app.container.textContent).toContain('All Points');
      expect(app.container.textContent).toContain('Select Points');
      expect(app.container.textContent).toContain('Adjusted Points Preset');
      expect(app.container.textContent).toContain('Adjusted Points Delimiter');
      expect(app.container.textContent).toContain('Export Format');
      expect(app.container.textContent).toContain('Output Extension');
      expect(app.container.textContent).toContain('Output Visibility');
      expect(app.container.textContent).toContain('Show Lost Stations in Output');
      expect(app.container.textContent).not.toContain('Future Option A');
      expect(app.container.textContent).not.toContain('Not implemented');
    } finally {
      await app.cleanup();
    }
  });

  it('renders the condensed modeling layout with TS correlation and robust controls', async () => {
    const app = await mountApp('modeling');
    try {
      expect(app.container.textContent).toContain('TS Correlation');
      expect(app.container.textContent).toContain('Enable Correlation');
      expect(app.container.textContent).toContain('Correlation Scope');
      expect(app.container.textContent).toContain('Correlation ρ');
      expect(app.container.textContent).toContain('Robust Model');
      expect(app.container.textContent).toContain('Robust Mode');
      expect(app.container.textContent).toContain('Robust k');
    } finally {
      await app.cleanup();
    }
  });
});
