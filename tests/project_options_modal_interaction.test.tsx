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

const clickToggleForSettingsRow = async (
  container: HTMLElement,
  rowLabel: string,
): Promise<void> => {
  const row = Array.from(container.querySelectorAll('label')).find((entry) =>
    entry.textContent?.includes(rowLabel),
  );
  if (!row) throw new Error(`Settings row "${rowLabel}" not found.`);
  const input = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  if (!input) throw new Error(`No toggle input found in "${rowLabel}".`);
  await act(async () => {
    input.click();
  });
};

const getToggleForSettingsRow = (container: HTMLElement, rowLabel: string): HTMLInputElement => {
  const row = Array.from(container.querySelectorAll('label')).find((entry) =>
    entry.textContent?.includes(rowLabel),
  );
  if (!row) throw new Error(`Settings row "${rowLabel}" not found.`);
  const input = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  if (!input) throw new Error(`No toggle input found in "${rowLabel}".`);
  return input;
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

  it('persists run-mode selection after Apply in Adjustment tab', async () => {
    const app = await mountApp('adjustment');
    try {
      const firstRunMode = findSelectForSettingsRow(app.container, 'Run Mode');
      expect(firstRunMode.value).toBe('adjustment');
      await setSelectValue(firstRunMode, 'data-check');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'Adjustment');

      const reopenedRunMode = findSelectForSettingsRow(app.container, 'Run Mode');
      expect(reopenedRunMode.value).toBe('data-check');
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

  it('persists rotation transform draft edits after Apply in Other Files tab', async () => {
    const app = await mountApp('other-files');
    try {
      const toggle = getToggleForSettingsRow(app.container, 'Enable Rotation');
      expect(toggle.checked).toBe(false);
      await clickToggleForSettingsRow(app.container, 'Enable Rotation');

      const angle = findInputForSettingsRow(app.container, 'Angle (deg)');
      await setInputValue(angle, '22.5');
      await clickButtonByExactText(app.container, 'Select Points');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'Other Files');

      const reopenedToggle = getToggleForSettingsRow(app.container, 'Enable Rotation');
      const reopenedAngle = findInputForSettingsRow(app.container, 'Angle (deg)');
      expect(reopenedToggle.checked).toBe(true);
      expect(reopenedAngle.value).toBe('22.5');
      expect(app.container.textContent).toContain('Selected points:');
    } finally {
      await app.cleanup();
    }
  });

  it('discards unsaved rotation transform edits when Cancel is clicked', async () => {
    const app = await mountApp('other-files');
    try {
      await clickToggleForSettingsRow(app.container, 'Enable Rotation');
      const angle = findInputForSettingsRow(app.container, 'Angle (deg)');
      await setInputValue(angle, '45');

      await clickButtonByExactText(app.container, 'Cancel');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'Other Files');

      const reopenedToggle = getToggleForSettingsRow(app.container, 'Enable Rotation');
      const reopenedAngle = findInputForSettingsRow(app.container, 'Angle (deg)');
      expect(reopenedToggle.checked).toBe(false);
      expect(reopenedAngle.value).toBe('0');
    } finally {
      await app.cleanup();
    }
  });

  it('supports select-points popup OK/Cancel semantics for rotation scope', async () => {
    const app = await mountApp('other-files');
    try {
      await clickButtonByExactText(app.container, 'Cancel');
      await clickButtonByExactText(app.container, 'Adjust');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'Other Files');

      await clickToggleForSettingsRow(app.container, 'Enable Rotation');
      await clickButtonByExactText(app.container, 'Select Points');
      expect(app.container.textContent).toContain('Rotation Scope');
      expect(app.container.textContent).toContain('Pivot station is auto-included');

      const modalRoot = app.container.querySelector(
        "div[class*='z-[60]']",
      ) as HTMLDivElement | null;
      if (!modalRoot) throw new Error('Rotation scope modal not found.');
      const stationToggles = Array.from(
        modalRoot.querySelectorAll('input[type="checkbox"]'),
      ) as HTMLInputElement[];
      expect(stationToggles.length).toBeGreaterThan(0);

      await act(async () => {
        stationToggles[0].click();
      });
      const modalCancel = Array.from(modalRoot.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === 'Cancel',
      ) as HTMLButtonElement | undefined;
      if (!modalCancel) throw new Error('Rotation scope modal cancel button not found.');
      await act(async () => {
        modalCancel.click();
      });
      expect(app.container.textContent).toContain('Selected points: 0');

      await clickButtonByExactText(app.container, 'Select Points');
      const modalRoot2 = app.container.querySelector(
        "div[class*='z-[60]']",
      ) as HTMLDivElement | null;
      if (!modalRoot2) throw new Error('Rotation scope modal not found.');
      const stationToggles2 = Array.from(
        modalRoot2.querySelectorAll('input[type="checkbox"]'),
      ) as HTMLInputElement[];
      await act(async () => {
        stationToggles2[0].click();
      });
      const modalOk = Array.from(modalRoot2.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === 'OK',
      ) as HTMLButtonElement | undefined;
      if (!modalOk) throw new Error('Rotation scope modal OK button not found.');
      await act(async () => {
        modalOk.click();
      });
      expect(app.container.textContent).not.toContain('Selected points: 0');
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

  it('filters CRS choices by search token in GPS tab', async () => {
    const app = await mountApp('gps');
    try {
      const mode = findSelectForSettingsRow(app.container, 'Coord System Mode');
      await setSelectValue(mode, 'grid');

      const group = findSelectForSettingsRow(app.container, 'CRS Catalog Group');
      await setSelectValue(group, 'canada-provincial');

      const search = findInputForSettingsRow(app.container, 'CRS Search');
      await setInputValue(search, 'new brunswick');

      const crs = findSelectForSettingsRow(app.container, 'CRS (Grid Mode)');
      const optionValues = Array.from(crs.options).map((entry) => entry.value);
      expect(optionValues).toContain('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
      expect(optionValues).not.toContain('CA_NAD83_CSRS_PEI_STEREOGRAPHIC');
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

  it('persists GNSS frame defaults and confirmation state after Apply in GPS tab', async () => {
    const app = await mountApp('gps');
    try {
      const frame = findSelectForSettingsRow(app.container, 'GNSS Vector Frame Default');
      expect(frame.value).toBe('gridNEU');
      await setSelectValue(frame, 'unknown');
      await clickToggleForSettingsRow(app.container, 'Confirm Unknown GNSS Frames');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'GPS');

      const reopenedFrame = findSelectForSettingsRow(app.container, 'GNSS Vector Frame Default');
      expect(reopenedFrame.value).toBe('unknown');
      const row = Array.from(app.container.querySelectorAll('label')).find((entry) =>
        entry.textContent?.includes('Confirm Unknown GNSS Frames'),
      );
      const toggle = row?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      expect(toggle?.checked).toBe(true);
    } finally {
      await app.cleanup();
    }
  });

  it('supports selecting NAD83(CSRS) geoid model presets in GPS tab', async () => {
    const app = await mountApp('gps');
    try {
      await clickToggleForSettingsRow(app.container, 'Geoid/Grid Model');
      const geoidModelId = findInputForSettingsRow(app.container, 'Geoid/Grid Model ID');
      await setInputValue(geoidModelId, 'NAD83-CSRS-DEMO');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickButtonByExactText(app.container, 'GPS');

      const reopenedGeoidModelId = findInputForSettingsRow(app.container, 'Geoid/Grid Model ID');
      expect(reopenedGeoidModelId.value).toBe('NAD83-CSRS-DEMO');
    } finally {
      await app.cleanup();
    }
  });
});
