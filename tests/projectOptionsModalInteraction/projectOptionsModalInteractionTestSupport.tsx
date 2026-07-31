/* eslint-disable react-refresh/only-export-components */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { it } from 'vitest';

import App from '../../src/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export { act, App, createRoot, type Root };

export type MountedApp = {
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
};

export const PROJECT_OPTIONS_INTERACTION_TIMEOUT_MS = 20000;

export const waitForCondition = async (
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

export const waitForProjectOptionsContent = async (container: HTMLElement): Promise<void> => {
  await waitForCondition(
    () =>
      container.textContent?.includes('Project Options') === true &&
      !container.textContent.includes('Loading project options...'),
    10000,
    'Project Options modal content did not finish loading within 10000ms.',
  );
};

export const tabReadyText: Record<
  NonNullable<React.ComponentProps<typeof App>['initialOptionsTab']>,
  string
> = {
  'project-files': 'Project Files',
  adjustment: 'Solver Configuration',
  general: 'Local / Grid Reduction',
  instrument: 'Instrument Selection',
  'listing-file': 'Industry-Style Listing Sort/Scope',
  'other-files': 'Other File Outputs',
  special: 'Special',
  gps: 'Advanced CRS/GPS/Height',
};

export const waitForTabContent = async (
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

export const modalIt = (
  name: string,
  testFn: () => Promise<void> | void,
  timeout = PROJECT_OPTIONS_INTERACTION_TIMEOUT_MS,
) => it(name, testFn, timeout);

export const mountApp = async (
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

export const findButtonByExactText = (container: HTMLElement, label: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (entry) => entry.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Button "${label}" not found.`);
  return button as HTMLButtonElement;
};

export const clickButtonByExactText = async (container: HTMLElement, label: string): Promise<void> => {
  const button = findButtonByExactText(container, label);
  await act(async () => {
    button.click();
  });
};

export const clickProjectOptionsTab = async (
  container: HTMLElement,
  tab: NonNullable<React.ComponentProps<typeof App>['initialOptionsTab']>,
): Promise<void> => {
  const labelByTab: Record<
    NonNullable<React.ComponentProps<typeof App>['initialOptionsTab']>,
    string
  > = {
    'project-files': 'Project Files',
    adjustment: 'Adjustment',
    general: 'General',
    instrument: 'Instrument',
    'listing-file': 'Listing File',
    'other-files': 'Other Files',
    special: 'Special',
    gps: 'GPS',
  };
  await clickButtonByExactText(container, labelByTab[tab]);
  await waitForTabContent(container, tab);
};

export const clickButtonByTitle = async (container: HTMLElement, title: string): Promise<void> => {
  const button = container.querySelector(`button[title="${title}"]`) as HTMLButtonElement | null;
  if (!button) throw new Error(`Button with title "${title}" not found.`);
  await act(async () => {
    button.click();
  });
};

export const clickOpenProjectOptions = async (container: HTMLElement): Promise<void> => {
  const openButton = container.querySelector(
    'button[title="Open industry-style project options"]',
  ) as HTMLButtonElement | null;
  if (!openButton) throw new Error('Project Options launcher button not found.');
  await act(async () => {
    openButton.click();
  });
};

export const clickOpenProjectWorkspace = async (container: HTMLElement): Promise<void> => {
  const openButton = container.querySelector(
    'button[title="Open local project workspace or portable project import"]',
  ) as HTMLButtonElement | null;
  if (!openButton) throw new Error('Project workspace launcher button not found.');
  await act(async () => {
    openButton.click();
  });
};

export const clickOpenSurveyCad = async (container: HTMLElement): Promise<void> => {
  const openButton = container.querySelector(
    'button[title="Open Survey CAD workspace"]',
  ) as HTMLButtonElement | null;
  if (!openButton) throw new Error('Survey CAD launcher button not found.');
  await act(async () => {
    openButton.click();
  });
};

export const findSelectForSettingsRow = (container: HTMLElement, rowLabel: string): HTMLSelectElement => {
  const row = Array.from(container.querySelectorAll('label')).find((entry) =>
    entry.textContent?.includes(rowLabel),
  );
  if (!row) throw new Error(`Settings row "${rowLabel}" not found.`);
  const select = row.querySelector('select');
  if (!select) throw new Error(`No select control found in "${rowLabel}".`);
  return select;
};

export const findInputForSettingsRow = (container: HTMLElement, rowLabel: string): HTMLInputElement => {
  const row = Array.from(container.querySelectorAll('label')).find((entry) =>
    entry.textContent?.includes(rowLabel),
  );
  if (!row) throw new Error(`Settings row "${rowLabel}" not found.`);
  const input = row.querySelector('input');
  if (!input) throw new Error(`No input control found in "${rowLabel}".`);
  return input as HTMLInputElement;
};

export const clickToggleForSettingsRow = async (
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

export const getToggleForSettingsRow = (container: HTMLElement, rowLabel: string): HTMLInputElement => {
  const row = Array.from(container.querySelectorAll('label')).find((entry) =>
    entry.textContent?.includes(rowLabel),
  );
  if (!row) throw new Error(`Settings row "${rowLabel}" not found.`);
  const input = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  if (!input) throw new Error(`No toggle input found in "${rowLabel}".`);
  return input;
};

export const setSelectValue = async (select: HTMLSelectElement, value: string): Promise<void> => {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

export const setInputValue = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
