/** @vitest-environment jsdom */

import { describe, expect, vi } from 'vitest';
import {
  clickButtonByExactText,
  clickOpenProjectOptions,
  clickProjectOptionsTab,
  clickToggleForSettingsRow,
  findInputForSettingsRow,
  findSelectForSettingsRow,
  getToggleForSettingsRow,
  modalIt,
  mountApp,
  setInputValue,
} from './projectOptionsModalInteractionTestSupport';

describe('Project Options modal instrument and transform interactions', () => {
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
});
