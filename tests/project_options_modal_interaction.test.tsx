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

const mountApp = async (
  initialOptionsTab: React.ComponentProps<typeof App>['initialOptionsTab'],
): Promise<MountedApp> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<App initialSettingsModalOpen={true} initialOptionsTab={initialOptionsTab} />);
  });
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

const findButtonByExactText = (container: HTMLElement, label: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (entry) => entry.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Button "${label}" not found.`);
  return button as HTMLButtonElement;
};

const clickButtonByExactText = async (container: HTMLElement, label: string): Promise<void> => {
  const button = findButtonByExactText(container, label);
  await act(async () => {
    button.click();
  });
};

const clickButtonByTitle = async (container: HTMLElement, title: string): Promise<void> => {
  const button = container.querySelector(`button[title="${title}"]`) as HTMLButtonElement | null;
  if (!button) throw new Error(`Button with title "${title}" not found.`);
  await act(async () => {
    button.click();
  });
};

const clickOpenProjectOptions = async (container: HTMLElement): Promise<void> => {
  const openButton = container.querySelector(
    'button[title="Open industry-style project options"]',
  ) as HTMLButtonElement | null;
  if (!openButton) throw new Error('Project Options launcher button not found.');
  await act(async () => {
    openButton.click();
  });
};

const findSelectForSettingsRow = (container: HTMLElement, rowLabel: string): HTMLSelectElement => {
  const row = Array.from(container.querySelectorAll('label')).find((entry) =>
    entry.textContent?.includes(rowLabel),
  );
  if (!row) throw new Error(`Settings row "${rowLabel}" not found.`);
  const select = row.querySelector('select');
  if (!select) throw new Error(`No select control found in "${rowLabel}".`);
  return select;
};

const findInputForSettingsRow = (container: HTMLElement, rowLabel: string): HTMLInputElement => {
  const row = Array.from(container.querySelectorAll('label')).find((entry) =>
    entry.textContent?.includes(rowLabel),
  );
  if (!row) throw new Error(`Settings row "${rowLabel}" not found.`);
  const input = row.querySelector('input');
  if (!input) throw new Error(`No input control found in "${rowLabel}".`);
  return input as HTMLInputElement;
};

const setSelectValue = async (select: HTMLSelectElement, value: string): Promise<void> => {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const setInputValue = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('Project Options modal interactions', () => {
  it('switches between tab panels when tab buttons are clicked', async () => {
    const app = await mountApp('adjustment');
    try {
      expect(app.container.textContent).toContain('Solver Configuration');
      expect(app.container.textContent).not.toContain('TS Correlation');

      await clickButtonByExactText(app.container, 'Modeling');
      expect(app.container.textContent).toContain('TS Correlation');
      expect(app.container.textContent).toContain('Robust Model');
      expect(app.container.textContent).not.toContain('Solver Configuration');

      await clickButtonByExactText(app.container, 'General');
      expect(app.container.textContent).toContain('Local / Grid Reduction');
      expect(app.container.textContent).toContain('Map Mode');
      expect(app.container.textContent).not.toContain('TS Correlation');
    } finally {
      await app.cleanup();
    }
  });

  it('persists draft edits after Apply and restores them when modal reopens', async () => {
    const app = await mountApp('general');
    try {
      const firstMapMode = findSelectForSettingsRow(app.container, 'Map Mode');
      expect(firstMapMode.value).toBe('off');
      await setSelectValue(firstMapMode, 'anglecalc');

      await clickButtonByExactText(app.container, 'Apply');
      expect(app.container.textContent).not.toContain('Local / Grid Reduction');

      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'General');

      const reopenedMapMode = findSelectForSettingsRow(app.container, 'Map Mode');
      expect(reopenedMapMode.value).toBe('anglecalc');
    } finally {
      await app.cleanup();
    }
  });

  it('discards unsaved edits when Cancel is clicked', async () => {
    const app = await mountApp('modeling');
    try {
      const firstRobustMode = findSelectForSettingsRow(app.container, 'Robust Mode');
      expect(firstRobustMode.value).toBe('none');
      await setSelectValue(firstRobustMode, 'huber');

      await clickButtonByExactText(app.container, 'Cancel');
      expect(app.container.textContent).not.toContain('Robust Model');

      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'Modeling');

      const reopenedRobustMode = findSelectForSettingsRow(app.container, 'Robust Mode');
      expect(reopenedRobustMode.value).toBe('none');
    } finally {
      await app.cleanup();
    }
  });

  it('persists convergence-limit draft edits after Apply', async () => {
    const app = await mountApp('adjustment');
    try {
      const firstLimit = findInputForSettingsRow(app.container, 'Convergence Limit');
      expect(firstLimit.value).toBe('0.01');
      await setInputValue(firstLimit, '0.1');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'Adjustment');

      const reopenedLimit = findInputForSettingsRow(app.container, 'Convergence Limit');
      expect(reopenedLimit.value).toBe('0.1');
    } finally {
      await app.cleanup();
    }
  });

  it('discards unsaved convergence-limit edits when Cancel is clicked', async () => {
    const app = await mountApp('adjustment');
    try {
      const firstLimit = findInputForSettingsRow(app.container, 'Convergence Limit');
      expect(firstLimit.value).toBe('0.01');
      await setInputValue(firstLimit, '0.2');

      await clickButtonByExactText(app.container, 'Cancel');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'Adjustment');

      const reopenedLimit = findInputForSettingsRow(app.container, 'Convergence Limit');
      expect(reopenedLimit.value).toBe('0.01');
    } finally {
      await app.cleanup();
    }
  });

  it('persists adjusted-points export preset and custom column ordering after Apply', async () => {
    const app = await mountApp('other-files');
    try {
      const presetSelect = findSelectForSettingsRow(app.container, 'Adjusted Points Preset');
      expect(presetSelect.value).toBe('PNEZD');
      await setSelectValue(presetSelect, 'PEN');
      await setSelectValue(presetSelect, 'PNEZD');
      await clickButtonByTitle(app.container, 'Move D left');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'Other Files');

      const reopenedPreset = findSelectForSettingsRow(app.container, 'Adjusted Points Preset');
      expect(reopenedPreset.value).toBe('custom');
      expect(app.container.textContent).toContain('1. P');
      expect(app.container.textContent).toContain('4. D');
    } finally {
      await app.cleanup();
    }
  });

  it('discards unsaved adjusted-points export changes when Cancel is clicked', async () => {
    const app = await mountApp('other-files');
    try {
      const delimiter = findSelectForSettingsRow(app.container, 'Adjusted Points Delimiter');
      expect(delimiter.value).toBe('comma');
      await setSelectValue(delimiter, 'tab');

      await clickButtonByExactText(app.container, 'Cancel');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'Other Files');

      const reopenedDelimiter = findSelectForSettingsRow(
        app.container,
        'Adjusted Points Delimiter',
      );
      expect(reopenedDelimiter.value).toBe('comma');
    } finally {
      await app.cleanup();
    }
  });

  it('persists coordinate-system settings after Apply in GPS tab', async () => {
    const app = await mountApp('gps');
    try {
      const mode = findSelectForSettingsRow(app.container, 'Coord System Mode');
      expect(mode.value).toBe('local');
      await setSelectValue(mode, 'grid');

      const crs = findSelectForSettingsRow(app.container, 'CRS (Grid Mode)');
      await setSelectValue(crs, 'CA_NAD83_CSRS_UTM_19N');

      const distanceMode = findSelectForSettingsRow(app.container, 'Distance Mode');
      await setSelectValue(distanceMode, 'ellipsoidal');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'GPS');

      const reopenedMode = findSelectForSettingsRow(app.container, 'Coord System Mode');
      const reopenedCrs = findSelectForSettingsRow(app.container, 'CRS (Grid Mode)');
      const reopenedDistanceMode = findSelectForSettingsRow(app.container, 'Distance Mode');
      expect(reopenedMode.value).toBe('grid');
      expect(reopenedCrs.value).toBe('CA_NAD83_CSRS_UTM_19N');
      expect(reopenedDistanceMode.value).toBe('ellipsoidal');
    } finally {
      await app.cleanup();
    }
  });

  it('filters CRS choices by catalog group in GPS tab', async () => {
    const app = await mountApp('gps');
    try {
      const mode = findSelectForSettingsRow(app.container, 'Coord System Mode');
      await setSelectValue(mode, 'grid');

      const group = findSelectForSettingsRow(app.container, 'CRS Catalog Group');
      await setSelectValue(group, 'canada-provincial');

      const crs = findSelectForSettingsRow(app.container, 'CRS (Grid Mode)');
      const optionValues = Array.from(crs.options).map((entry) => entry.value);
      expect(optionValues).toContain('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
      expect(optionValues.some((value) => value.includes('_UTM_'))).toBe(false);
      expect(optionValues.some((value) => value.includes('_MTM_'))).toBe(false);
    } finally {
      await app.cleanup();
    }
  });

  it('toggles the CRS projection-parameter detail popup', async () => {
    const app = await mountApp('gps');
    try {
      expect(app.container.textContent).toContain('Show Params');
      expect(app.container.textContent).not.toContain('Projection Parameters');

      await clickButtonByExactText(app.container, 'Show Params');
      expect(app.container.textContent).toContain('Projection Parameters');
      expect(app.container.textContent).toContain('+proj=utm');

      await clickButtonByExactText(app.container, 'Hide Params');
      expect(app.container.textContent).not.toContain('Projection Parameters');
    } finally {
      await app.cleanup();
    }
  });

  it('discards unsaved coordinate-system edits when Cancel is clicked', async () => {
    const app = await mountApp('gps');
    try {
      const avgGeoid = findInputForSettingsRow(app.container, 'Average Geoid Height');
      expect(avgGeoid.value).toBe('0');
      await setInputValue(avgGeoid, '31.25');

      await clickButtonByExactText(app.container, 'Cancel');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'GPS');

      const reopenedAvgGeoid = findInputForSettingsRow(app.container, 'Average Geoid Height');
      expect(reopenedAvgGeoid.value).toBe('0');
    } finally {
      await app.cleanup();
    }
  });
});
