/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import App from '../src/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MountedApp = {
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
};

const PROJECT_OPTIONS_INTERACTION_TIMEOUT_MS = 20000;

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
    10000,
    'Project Options modal content did not finish loading within 10000ms.',
  );
};

const tabReadyText: Record<
  NonNullable<React.ComponentProps<typeof App>['initialOptionsTab']>,
  string
> = {
  adjustment: 'Solver Configuration',
  general: 'Local / Grid Reduction',
  instrument: 'Instrument Selection',
  'listing-file': 'Industry-Style Listing Sort/Scope',
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
    10000,
    `Project Options tab "${initialOptionsTab}" did not render "${readyText}" within 10000ms.`,
  );
};

const modalIt = (
  name: string,
  testFn: () => Promise<void> | void,
  timeout = PROJECT_OPTIONS_INTERACTION_TIMEOUT_MS,
) => it(name, testFn, timeout);

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

const clickProjectOptionsTab = async (
  container: HTMLElement,
  tab: NonNullable<React.ComponentProps<typeof App>['initialOptionsTab']>,
): Promise<void> => {
  const labelByTab: Record<
    NonNullable<React.ComponentProps<typeof App>['initialOptionsTab']>,
    string
  > = {
    adjustment: 'Adjustment',
    general: 'General',
    instrument: 'Instrument',
    'listing-file': 'Listing File',
    'other-files': 'Other Files',
    special: 'Special',
    gps: 'GPS',
    modeling: 'Modeling',
  };
  await clickButtonByExactText(container, labelByTab[tab]);
  await waitForTabContent(container, tab);
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

const clickOpenProjectWorkspace = async (container: HTMLElement): Promise<void> => {
  const openButton = container.querySelector(
    'button[title="Open local project workspace or portable project import"]',
  ) as HTMLButtonElement | null;
  if (!openButton) throw new Error('Project workspace launcher button not found.');
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
  modalIt('opens the project workspace tab from the toolbar folder button', async () => {
    document.documentElement.setAttribute('data-theme', 'gruvbox-dark');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      await act(async () => {
        root.render(<App initialSettingsModalOpen={false} />);
      });

      expect(container.textContent).not.toContain('Local Project Workspace');

      await clickOpenProjectWorkspace(container);
      await waitForProjectOptionsContent(container);
      await waitForTabContent(container, 'other-files');

      expect(container.textContent).toContain('Manifest schema');
      expect(container.textContent).toContain('Create Local Project');
      expect(container.textContent).toContain('Recent Local Projects');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  modalIt('switches between tab panels when tab buttons are clicked', async () => {
    const app = await mountApp('adjustment');
    try {
      expect(app.container.textContent).toContain('Solver Configuration');
      expect(app.container.textContent).not.toContain('TS Correlation');

      await clickProjectOptionsTab(app.container, 'modeling');
      expect(app.container.textContent).toContain('TS Correlation');
      expect(app.container.textContent).toContain('Robust Model');
      expect(app.container.textContent).not.toContain('Solver Configuration');

      await clickProjectOptionsTab(app.container, 'general');
      expect(app.container.textContent).toContain('Local / Grid Reduction');
      expect(app.container.textContent).toContain('Map Mode');
      expect(app.container.textContent).not.toContain('TS Correlation');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('persists draft edits after Apply and restores them when modal reopens', async () => {
    const app = await mountApp('general');
    try {
      const firstMapMode = findSelectForSettingsRow(app.container, 'Map Mode');
      expect(firstMapMode.value).toBe('off');
      await setSelectValue(firstMapMode, 'anglecalc');

      await clickButtonByExactText(app.container, 'Apply');
      expect(app.container.textContent).not.toContain('Local / Grid Reduction');

      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'general');

      const reopenedMapMode = findSelectForSettingsRow(app.container, 'Map Mode');
      expect(reopenedMapMode.value).toBe('anglecalc');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('discards unsaved edits when Cancel is clicked', async () => {
    const app = await mountApp('modeling');
    try {
      const firstRobustMode = findSelectForSettingsRow(app.container, 'Robust Mode');
      expect(firstRobustMode.value).toBe('none');
      await setSelectValue(firstRobustMode, 'huber');

      await clickButtonByExactText(app.container, 'Cancel');
      expect(app.container.textContent).not.toContain('Robust Model');

      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'modeling');

      const reopenedRobustMode = findSelectForSettingsRow(app.container, 'Robust Mode');
      expect(reopenedRobustMode.value).toBe('none');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('applies UI theme selection and persists after Apply in General tab', async () => {
    const app = await mountApp('general');
    try {
      const themeSelect = findSelectForSettingsRow(app.container, 'UI Theme');
      expect(themeSelect.value).toBe('gruvbox-dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('gruvbox-dark');

      await setSelectValue(themeSelect, 'gruvbox-light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('gruvbox-light');

      await clickButtonByExactText(app.container, 'Apply');
      expect(document.documentElement.getAttribute('data-theme')).toBe('gruvbox-light');

      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'general');
      const reopenedThemeSelect = findSelectForSettingsRow(app.container, 'UI Theme');
      expect(reopenedThemeSelect.value).toBe('gruvbox-light');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('reverts unsaved UI theme preview when Cancel is clicked', async () => {
    const app = await mountApp('general');
    try {
      expect(document.documentElement.getAttribute('data-theme')).toBe('gruvbox-dark');
      const themeSelect = findSelectForSettingsRow(app.container, 'UI Theme');
      await setSelectValue(themeSelect, 'gruvbox-light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('gruvbox-light');

      await clickButtonByExactText(app.container, 'Cancel');
      expect(document.documentElement.getAttribute('data-theme')).toBe('gruvbox-dark');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('persists convergence-limit draft edits after Apply', async () => {
    const app = await mountApp('adjustment');
    try {
      const firstLimit = findInputForSettingsRow(app.container, 'Convergence Limit');
      expect(firstLimit.value).toBe('0.01');
      await setInputValue(firstLimit, '0.1');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'adjustment');

      const reopenedLimit = findInputForSettingsRow(app.container, 'Convergence Limit');
      expect(reopenedLimit.value).toBe('0.1');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('persists run-mode selection after Apply in Adjustment tab', async () => {
    const app = await mountApp('adjustment');
    try {
      const firstRunMode = findSelectForSettingsRow(app.container, 'Run Mode');
      expect(firstRunMode.value).toBe('adjustment');
      await setSelectValue(firstRunMode, 'data-check');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'adjustment');

      const reopenedRunMode = findSelectForSettingsRow(app.container, 'Run Mode');
      expect(reopenedRunMode.value).toBe('data-check');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('persists suspect-impact mode after Apply in Adjustment tab', async () => {
    const app = await mountApp('adjustment');
    try {
      const firstMode = findSelectForSettingsRow(app.container, 'Suspect Impact');
      expect(firstMode.value).toBe('auto');
      await setSelectValue(firstMode, 'off');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'adjustment');

      const reopenedMode = findSelectForSettingsRow(app.container, 'Suspect Impact');
      expect(reopenedMode.value).toBe('off');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('discards unsaved convergence-limit edits when Cancel is clicked', async () => {
    const app = await mountApp('adjustment');
    try {
      const firstLimit = findInputForSettingsRow(app.container, 'Convergence Limit');
      expect(firstLimit.value).toBe('0.01');
      await setInputValue(firstLimit, '0.2');

      await clickButtonByExactText(app.container, 'Cancel');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'adjustment');

      const reopenedLimit = findInputForSettingsRow(app.container, 'Convergence Limit');
      expect(reopenedLimit.value).toBe('0.01');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('persists adjusted-points export preset and custom column ordering after Apply', async () => {
    const app = await mountApp('other-files');
    try {
      const presetSelect = findSelectForSettingsRow(app.container, 'Adjusted Points Preset');
      expect(presetSelect.value).toBe('PNEZD');
      await setSelectValue(presetSelect, 'PEN');
      await setSelectValue(presetSelect, 'PNEZD');
      await clickButtonByTitle(app.container, 'Move D left');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'other-files');

      const reopenedPreset = findSelectForSettingsRow(app.container, 'Adjusted Points Preset');
      expect(reopenedPreset.value).toBe('custom');
      expect(app.container.textContent).toContain('1. P');
      expect(app.container.textContent).toContain('4. D');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('discards unsaved adjusted-points export changes when Cancel is clicked', async () => {
    const app = await mountApp('other-files');
    try {
      const delimiter = findSelectForSettingsRow(app.container, 'Adjusted Points Delimiter');
      expect(delimiter.value).toBe('comma');
      await setSelectValue(delimiter, 'tab');

      await clickButtonByExactText(app.container, 'Cancel');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'other-files');

      const reopenedDelimiter = findSelectForSettingsRow(
        app.container,
        'Adjusted Points Delimiter',
      );
      expect(reopenedDelimiter.value).toBe('comma');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('duplicates selected instrument values into a new instrument code', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('S9_COPY');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const app = await mountApp('instrument');
    try {
      const originalDescription = findInputForSettingsRow(
        app.container,
        'Instrument Description',
      ).value;
      await clickButtonByExactText(app.container, 'Duplicate');

      const instrumentSelect = findSelectForSettingsRow(app.container, 'Instrument');
      const optionValues = Array.from(instrumentSelect.options).map((entry) => entry.value);
      expect(optionValues).toContain('S9_COPY');
      expect(instrumentSelect.value).toBe('S9_COPY');

      const description = findInputForSettingsRow(app.container, 'Instrument Description');
      expect(description.value).toBe(originalDescription);
      expect(alertSpy).not.toHaveBeenCalled();
    } finally {
      promptSpy.mockRestore();
      alertSpy.mockRestore();
      await app.cleanup();
    }
  });

  modalIt('persists instrument differential-level precision after Apply', async () => {
    const app = await mountApp('instrument');
    try {
      const firstDifferentialLevels = findInputForSettingsRow(
        app.container,
        'Differential Levels (mm/km)',
      );
      expect(Number.isFinite(Number.parseFloat(firstDifferentialLevels.value))).toBe(true);
      await setInputValue(firstDifferentialLevels, '2.25');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'instrument');

      const reopenedDifferentialLevels = findInputForSettingsRow(
        app.container,
        'Differential Levels (mm/km)',
      );
      expect(Number.parseFloat(reopenedDifferentialLevels.value)).toBeCloseTo(2.25, 6);
    } finally {
      await app.cleanup();
    }
  });

  modalIt('persists rotation transform draft edits after Apply in Other Files tab', async () => {
    const app = await mountApp('other-files');
    try {
      const toggle = getToggleForSettingsRow(app.container, 'Enable Rotation');
      expect(toggle.checked).toBe(false);
      await clickToggleForSettingsRow(app.container, 'Enable Rotation');

      const angle = findInputForSettingsRow(app.container, 'Angle (deg or dms)');
      await setInputValue(angle, '22.5');
      await clickButtonByExactText(app.container, 'Select Points');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'other-files');

      const reopenedToggle = getToggleForSettingsRow(app.container, 'Enable Rotation');
      const reopenedAngle = findInputForSettingsRow(app.container, 'Angle (deg or dms)');
      expect(reopenedToggle.checked).toBe(true);
      expect(Number.parseFloat(reopenedAngle.value)).toBeCloseTo(22.5, 6);
    } finally {
      await app.cleanup();
    }
  });

  modalIt('discards unsaved rotation transform edits when Cancel is clicked', async () => {
    const app = await mountApp('other-files');
    try {
      await clickToggleForSettingsRow(app.container, 'Enable Rotation');
      const angle = findInputForSettingsRow(app.container, 'Angle (deg or dms)');
      await setInputValue(angle, '45');

      await clickButtonByExactText(app.container, 'Cancel');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'other-files');

      const reopenedToggle = getToggleForSettingsRow(app.container, 'Enable Rotation');
      const reopenedAngle = findInputForSettingsRow(app.container, 'Angle (deg or dms)');
      expect(reopenedToggle.checked).toBe(false);
      expect(Number.parseFloat(reopenedAngle.value)).toBeCloseTo(0, 10);
    } finally {
      await app.cleanup();
    }
  });

  modalIt('accepts DMS input for rotation angle and translation azimuth fields', async () => {
    const app = await mountApp('other-files');
    try {
      await clickToggleForSettingsRow(app.container, 'Enable Rotation');
      const rotationAngle = findInputForSettingsRow(app.container, 'Angle (deg or dms)');
      await setInputValue(rotationAngle, '273-22-56.3');

      await clickToggleForSettingsRow(app.container, 'Enable Translation');
      const azimuth = findInputForSettingsRow(app.container, 'Azimuth (deg or dms)');
      await setInputValue(azimuth, '273-22-56.3');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'other-files');

      const reopenedRotation = findInputForSettingsRow(app.container, 'Angle (deg or dms)');
      const reopenedAzimuth = findInputForSettingsRow(app.container, 'Azimuth (deg or dms)');
      expect(Number.parseFloat(reopenedRotation.value)).toBeCloseTo(273.38230556, 6);
      expect(Number.parseFloat(reopenedAzimuth.value)).toBeCloseTo(273.38230556, 6);
    } finally {
      await app.cleanup();
    }
  });

  modalIt('shows inline rotation error and blocks apply when rotation angle is above 360', async () => {
    const app = await mountApp('other-files');
    try {
      await clickToggleForSettingsRow(app.container, 'Enable Rotation');
      const rotationAngle = findInputForSettingsRow(app.container, 'Angle (deg or dms)');
      await setInputValue(rotationAngle, '361');

      await clickButtonByExactText(app.container, 'Apply');
      expect(app.container.textContent).toContain('Error: direction cannot be above 360.');
      expect(app.container.textContent).toContain('Project Options');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('shows inline azimuth format error and blocks apply when azimuth syntax is invalid', async () => {
    const app = await mountApp('other-files');
    try {
      await clickToggleForSettingsRow(app.container, 'Enable Translation');
      const azimuth = findInputForSettingsRow(app.container, 'Azimuth (deg or dms)');
      await setInputValue(azimuth, 'd--m-s');

      await clickButtonByExactText(app.container, 'Apply');
      expect(app.container.textContent).toContain('Error: azimuth not in correct format.');
      expect(app.container.textContent).toContain('Project Options');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('shows transform-scope controls disabled until an adjustment populates station choices', async () => {
    const app = await mountApp('other-files');
    try {
      expect(app.container.textContent).toContain(
        'Run adjustment to populate station choices for transform reference and scope.',
      );

      const selectPointsButtons = Array.from(app.container.querySelectorAll('button')).filter(
        (entry) => entry.textContent?.trim() === 'Select Points',
      ) as HTMLButtonElement[];
      expect(selectPointsButtons.length).toBeGreaterThan(0);
      expect(selectPointsButtons.every((entry) => entry.disabled)).toBe(true);
    } finally {
      await app.cleanup();
    }
  });

  modalIt('persists coordinate-system settings after Apply in GPS tab', async () => {
    const app = await mountApp('gps');
    try {
      const mode = findSelectForSettingsRow(app.container, 'Coord System Mode');
      expect(mode.value).toBe('grid');

      const group = findSelectForSettingsRow(app.container, 'CRS Catalog Group');
      await setSelectValue(group, 'canada-utm');

      const crs = findSelectForSettingsRow(app.container, 'CRS (Grid Mode)');
      await waitForCondition(
        () => Array.from(crs.options).some((entry) => entry.value === 'CA_NAD83_CSRS_UTM_19N'),
        10000,
        'UTM CRS option did not appear within 10000ms.',
      );
      await setSelectValue(crs, 'CA_NAD83_CSRS_UTM_19N');

      const distanceMode = findSelectForSettingsRow(app.container, 'Distance Mode');
      await setSelectValue(distanceMode, 'ellipsoidal');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'gps');

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

  modalIt('filters CRS choices by catalog group in GPS tab', async () => {
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
      expect(optionValues.some((value) => value.startsWith('CA_NAD83_CSRS_MTM_'))).toBe(false);
    } finally {
      await app.cleanup();
    }
  });

  modalIt('shows USA State Plane rows when CRS catalog group is set to us-spcs', async () => {
    const app = await mountApp('gps');
    try {
      const mode = findSelectForSettingsRow(app.container, 'Coord System Mode');
      await setSelectValue(mode, 'grid');

      const group = findSelectForSettingsRow(app.container, 'CRS Catalog Group');
      await setSelectValue(group, 'us-spcs');

      const crs = findSelectForSettingsRow(app.container, 'CRS (Grid Mode)');
      const optionValues = Array.from(crs.options).map((entry) => entry.value);
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NY_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_PA_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_CA_ZONE_6');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_TX_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_TX_SOUTH_CENTRAL');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_FL_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_FL_WEST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_GA_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_GA_WEST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NC');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_AL_WEST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_TN');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_KY_SINGLE_ZONE');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_RI');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_SD_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_VT');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_WA_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_WV_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_WY_WEST_CENTRAL');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_UT_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_UT_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_CO_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_CO_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_CT');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_DE');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_KS_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_KS_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_LA_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_LA_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ME_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ME_WEST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MD');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MA_ISLAND');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MA_MAINLAND');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MN_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MN_CENTRAL');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MN_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IL_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IL_WEST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IN_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IN_WEST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MS_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MS_TM');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MS_WEST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MO_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MO_CENTRAL');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MO_WEST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NV_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NV_CENTRAL');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NV_WEST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NJ');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NM_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NM_CENTRAL');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NM_WEST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NE');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_OH_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_OH_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ID_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ID_CENTRAL');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ID_WEST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IA_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IA_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_AR_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_AR_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_OK_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_OK_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_AK_ZONE_1');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_AK_ZONE_10');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MI_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MI_CENTRAL');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MI_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ND_NORTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ND_SOUTH');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_AZ_EAST');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_AZ_CENTRAL');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_AZ_WEST');
      expect(optionValues.some((value) => value.endsWith('_FTUS'))).toBe(false);
      expect(optionValues.some((value) => value.startsWith('CA_NAD83_CSRS_'))).toBe(false);
    } finally {
      await app.cleanup();
    }
  });

  modalIt('shows only ftUS USA State Plane rows when project units are feet', async () => {
    const app = await mountApp('gps');
    try {
      await clickProjectOptionsTab(app.container, 'adjustment');
      const units = findSelectForSettingsRow(app.container, 'Units');
      await setSelectValue(units, 'ft');
      await clickProjectOptionsTab(app.container, 'gps');

      const mode = findSelectForSettingsRow(app.container, 'Coord System Mode');
      await setSelectValue(mode, 'grid');
      const group = findSelectForSettingsRow(app.container, 'CRS Catalog Group');
      await setSelectValue(group, 'us-spcs');

      const crs = findSelectForSettingsRow(app.container, 'CRS (Grid Mode)');
      const optionValues = Array.from(crs.options).map((entry) => entry.value);
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NY_EAST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_PA_SOUTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_UT_SOUTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_CO_SOUTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_CT_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_DE_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_KS_NORTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_KS_SOUTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_LA_NORTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_LA_SOUTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ME_EAST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ME_WEST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MD_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MA_ISLAND_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MA_MAINLAND_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MN_NORTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MN_CENTRAL_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MN_SOUTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IL_EAST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IL_WEST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IN_EAST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IN_WEST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MS_EAST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_MS_WEST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NV_EAST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NV_CENTRAL_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NV_WEST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NJ_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NM_EAST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NM_CENTRAL_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NM_WEST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NE_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_NH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_OH_NORTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_OH_SOUTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ID_EAST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ID_CENTRAL_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_ID_WEST_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IA_NORTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_IA_SOUTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_AR_NORTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_AR_SOUTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_OK_NORTH_FTUS');
      expect(optionValues).toContain('US_NAD83_2011_SPCS_OK_SOUTH_FTUS');
      expect(optionValues).not.toContain('US_NAD83_2011_SPCS_AK_ZONE_1');
      expect(optionValues).not.toContain('US_NAD83_2011_SPCS_AK_ZONE_10');
      expect(optionValues).not.toContain('US_NAD83_2011_SPCS_MI_NORTH');
      expect(optionValues).not.toContain('US_NAD83_2011_SPCS_MI_CENTRAL');
      expect(optionValues).not.toContain('US_NAD83_2011_SPCS_MI_SOUTH');
      expect(optionValues).not.toContain('US_NAD83_2011_SPCS_ND_NORTH');
      expect(optionValues).not.toContain('US_NAD83_2011_SPCS_ND_SOUTH');
      expect(optionValues).not.toContain('US_NAD83_2011_SPCS_AZ_EAST');
      expect(optionValues).not.toContain('US_NAD83_2011_SPCS_AZ_CENTRAL');
      expect(optionValues).not.toContain('US_NAD83_2011_SPCS_AZ_WEST');
      expect(optionValues.some((value) => value.endsWith('_FTUS'))).toBe(true);
      expect(optionValues.some((value) => /^US_NAD83_2011_SPCS_/.test(value) && !value.endsWith('_FTUS'))).toBe(false);
    } finally {
      await app.cleanup();
    }
  });

  modalIt('filters CRS choices by search token in GPS tab', async () => {
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

  modalIt('toggles the CRS projection-parameter detail popup', async () => {
    const app = await mountApp('gps');
    try {
      expect(app.container.textContent).toContain('Show Params');
      expect(app.container.textContent).not.toContain('Projection Parameters');

      await clickButtonByExactText(app.container, 'Show Params');
      expect(app.container.textContent).toContain('Projection Parameters');
      expect(app.container.textContent).toContain('+proj=sterea');

      await clickButtonByExactText(app.container, 'Hide Params');
      expect(app.container.textContent).not.toContain('Projection Parameters');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('discards unsaved coordinate-system edits when Cancel is clicked', async () => {
    const app = await mountApp('gps');
    try {
      const avgGeoid = findInputForSettingsRow(app.container, 'Average Geoid Height');
      expect(avgGeoid.value).toBe('0');
      await setInputValue(avgGeoid, '31.25');

      await clickButtonByExactText(app.container, 'Cancel');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'gps');

      const reopenedAvgGeoid = findInputForSettingsRow(app.container, 'Average Geoid Height');
      expect(reopenedAvgGeoid.value).toBe('0');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('persists GNSS frame defaults and confirmation state after Apply in GPS tab', async () => {
    const app = await mountApp('gps');
    try {
      const frame = findSelectForSettingsRow(app.container, 'GNSS Vector Frame Default');
      expect(frame.value).toBe('gridNEU');
      await setSelectValue(frame, 'unknown');
      await clickToggleForSettingsRow(app.container, 'Confirm Unknown GNSS Frames');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'gps');

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

  modalIt('supports selecting NAD83(CSRS) geoid model presets in GPS tab', async () => {
    const app = await mountApp('gps');
    try {
      await clickToggleForSettingsRow(app.container, 'Geoid/Grid Model');
      const geoidModelId = findInputForSettingsRow(app.container, 'Geoid/Grid Model ID');
      await setInputValue(geoidModelId, 'NAD83-CSRS-DEMO');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'gps');

      const reopenedGeoidModelId = findInputForSettingsRow(app.container, 'Geoid/Grid Model ID');
      expect(reopenedGeoidModelId.value).toBe('NAD83-CSRS-DEMO');
    } finally {
      await app.cleanup();
    }
  });
});
