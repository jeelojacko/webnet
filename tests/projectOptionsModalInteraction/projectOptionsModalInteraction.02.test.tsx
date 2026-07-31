/** @vitest-environment jsdom */

import { describe, expect } from 'vitest';
import {
  clickButtonByExactText,
  clickButtonByTitle,
  clickOpenProjectOptions,
  clickProjectOptionsTab,
  findInputForSettingsRow,
  findSelectForSettingsRow,
  modalIt,
  mountApp,
  setInputValue,
  setSelectValue,
} from './projectOptionsModalInteractionTestSupport';

describe('Project Options modal adjustment and export interactions', () => {
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
      expect(firstRunMode.value).toBe('preanalysis');
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
});
