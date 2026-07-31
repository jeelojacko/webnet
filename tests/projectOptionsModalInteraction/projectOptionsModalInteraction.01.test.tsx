/** @vitest-environment jsdom */

import { describe, expect } from 'vitest';

import {
  act,
  App,
  clickButtonByExactText,
  clickOpenProjectOptions,
  clickOpenProjectWorkspace,
  clickOpenSurveyCad,
  clickProjectOptionsTab,
  clickToggleForSettingsRow,
  findSelectForSettingsRow,
  getToggleForSettingsRow,
  modalIt,
  mountApp,
  createRoot,
  setSelectValue,
  waitForProjectOptionsContent,
  waitForTabContent,
  type Root,
} from './projectOptionsModalInteractionTestSupport';

describe('Project Options modal workspace and general interactions', () => {
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
      await waitForTabContent(container, 'project-files');

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

  modalIt('opens the survey CAD workspace tab from the toolbar launcher', async () => {
    document.documentElement.setAttribute('data-theme', 'gruvbox-dark');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      await act(async () => {
        root.render(<App initialSettingsModalOpen={false} />);
      });

      expect(container.querySelector('[data-survey-cad-preview]')).toBeNull();

      await clickOpenSurveyCad(container);

      expect(container.querySelector('[data-survey-cad-preview]')).not.toBeNull();
      expect(container.textContent).toContain('LINE');
      expect(container.textContent).not.toContain('Zoom Extents');
      expect(container.textContent).not.toContain('Zoom Window');
      expect(container.querySelector('textarea')).toBeNull();
      expect(container.textContent).not.toContain('Map & Ellipses');
      expect(container.textContent).not.toContain('Adjustment Report');
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

      await clickProjectOptionsTab(app.container, 'special');
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
    const app = await mountApp('special');
    try {
      const firstRobustMode = findSelectForSettingsRow(app.container, 'Robust Mode');
      expect(firstRobustMode.value).toBe('none');
      await setSelectValue(firstRobustMode, 'huber');

      await clickButtonByExactText(app.container, 'Cancel');
      expect(app.container.textContent).not.toContain('Robust Model');

      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'special');

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

  modalIt('keeps Run Comparison and Review Queue hidden by default and persists toggle changes', async () => {
    const app = await mountApp('general');
    try {
      const runComparisonToggle = getToggleForSettingsRow(app.container, 'Run Comparison Panel');
      const reviewQueueToggle = getToggleForSettingsRow(app.container, 'Review Queue Panel');
      expect(runComparisonToggle.checked).toBe(false);
      expect(reviewQueueToggle.checked).toBe(false);

      await clickToggleForSettingsRow(app.container, 'Run Comparison Panel');
      await clickToggleForSettingsRow(app.container, 'Review Queue Panel');
      expect(runComparisonToggle.checked).toBe(true);
      expect(reviewQueueToggle.checked).toBe(true);

      await clickButtonByExactText(app.container, 'Apply');
      await clickOpenProjectOptions(app.container);
      await clickProjectOptionsTab(app.container, 'general');

      expect(getToggleForSettingsRow(app.container, 'Run Comparison Panel').checked).toBe(true);
      expect(getToggleForSettingsRow(app.container, 'Review Queue Panel').checked).toBe(true);
    } finally {
      await app.cleanup();
    }
  });
});
