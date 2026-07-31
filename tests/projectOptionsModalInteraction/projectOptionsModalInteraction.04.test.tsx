/** @vitest-environment jsdom */

import { describe, expect } from 'vitest';
import {
  clickButtonByExactText,
  clickOpenProjectOptions,
  clickProjectOptionsTab,
  clickToggleForSettingsRow,
  findInputForSettingsRow,
  findSelectForSettingsRow,
  modalIt,
  mountApp,
  setInputValue,
  setSelectValue,
} from './projectOptionsModalInteractionTestSupport';

describe('Project Options modal CRS and GPS interactions', () => {
  modalIt('persists coordinate-system settings after Apply in Adjustment tab', async () => {
    const app = await mountApp('adjustment');
    try {
      const mode = findSelectForSettingsRow(app.container, 'Coord System Mode');
      expect(mode.value).toBe('grid');
      await setSelectValue(mode, 'local');

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'adjustment');

      const reopenedMode = findSelectForSettingsRow(app.container, 'Coord System Mode');
      expect(reopenedMode.value).toBe('local');
    } finally {
      await app.cleanup();
    }
  });

  modalIt('discards unsaved coordinate-system edits when Cancel is clicked', async () => {
    const app = await mountApp('adjustment');
    try {
      const avgGeoid = findInputForSettingsRow(app.container, 'Average Geoid Height');
      expect(avgGeoid.value).toBe('0');
      await setInputValue(avgGeoid, '31.25');

      await clickButtonByExactText(app.container, 'Cancel');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'adjustment');

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
