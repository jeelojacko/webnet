/** @vitest-environment jsdom */

// Manage perf: raw JSON/package text stays out of the DOM until expanded,
// while browser paste/import and native backup keep working.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudyManagePage from '../src/components/StudyManagePage';
import { createSeedStudyData } from '../src/studySeed';
import { exportStudyData } from '../src/studyExportImport';
import type { StudyDataSnapshot } from '../src/studyTypes';

const renderIntoRoot = async (node: React.ReactNode, root: Root | null) => {
  await act(async () => {
    root?.render(node);
  });
};

const click = (button: Element): Promise<void> =>
  act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

const manageProps = (data: StudyDataSnapshot, exportText: string) => ({
  data,
  exportText,
  importText: '',
  onImportTextChange: vi.fn(),
  onImport: vi.fn(),
  onDeleteAllData: vi.fn(),
  officialPackageText: '',
  onOfficialPackageTextChange: vi.fn(),
  officialPackagePreview: null,
  onPreviewOfficialPackage: vi.fn(),
  onImportOfficialPackage: vi.fn(),
  statusMessage: '',
});

describe('StudyManagePage lazy raw JSON', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
  });

  it('keeps raw text out of the DOM by default with a byte-size summary', async () => {
    const data = createSeedStudyData('2026-08-05T10:00:00.000Z');
    const exportText = exportStudyData(data);
    await renderIntoRoot(<StudyManagePage {...manageProps(data, exportText)} />, root);

    expect(document.querySelectorAll('textarea')).toHaveLength(0);
    expect(document.body.textContent).toContain(
      `Show export text (${new TextEncoder().encode(exportText).length} bytes)`,
    );
  });

  it('expands export text on demand with the deterministic export intact', async () => {
    const data = createSeedStudyData('2026-08-05T10:00:00.000Z');
    const exportText = exportStudyData(data);
    await renderIntoRoot(<StudyManagePage {...manageProps(data, exportText)} />, root);

    const show = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.startsWith('Show export text'),
    );
    await click(show!);
    const exportArea = document.querySelector('textarea[readonly]');
    expect(exportArea?.textContent ?? (exportArea as HTMLTextAreaElement)?.value).toBeTruthy();
    expect((exportArea as HTMLTextAreaElement).value).toBe(exportText);
  });

  it('preserves browser paste/import after expanding', async () => {
    const data = createSeedStudyData('2026-08-05T10:00:00.000Z');
    const onImport = vi.fn();
    const onImportTextChange = vi.fn();
    await renderIntoRoot(
      <StudyManagePage
        {...manageProps(data, '{}')}
        importText="{}"
        onImportTextChange={onImportTextChange}
        onImport={onImport}
      />,
      root,
    );

    const show = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show import text'),
    );
    await click(show!);
    const importArea = document.querySelectorAll('textarea')[0] as HTMLTextAreaElement;
    await act(async () => {
      importArea.focus();
      importArea.value = '{}';
      importArea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const importButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Import Data',
    );
    expect(importButton).toBeTruthy();
    expect(importButton?.hasAttribute('disabled')).toBe(false);
    await click(importButton!);
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('keeps native backup primary, ahead of the raw JSON sections', async () => {
    const data = createSeedStudyData('2026-08-05T10:00:00.000Z');
    await renderIntoRoot(
      <StudyManagePage
        {...manageProps(data, '{}')}
        nativeBackupAvailable
        onImportBackupFromFile={vi.fn()}
        onExportBackupToFile={vi.fn()}
      />,
      root,
    );

    const body = document.body.textContent ?? '';
    expect(body).toContain('Open Backup File…');
    expect(body.indexOf('Backup File')).toBeLessThan(body.indexOf('Export JSON'));
    expect(body.indexOf('Backup File')).toBeLessThan(body.indexOf('Import JSON'));
  });
});
