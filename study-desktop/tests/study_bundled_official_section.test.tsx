/** @vitest-environment jsdom */
// Bundled-library install affordance: first-import preview keeps an install
// button; matches-current shows none; differs renders Install Update.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudyBundledOfficialSection from '../src/components/StudyBundledOfficialSection';
import StudyGetStarted from '../src/components/StudyGetStarted';
import type { OfficialContentPreview } from '../src/studyOfficialContent';
const labels = (): string[] =>
  Array.from(document.querySelectorAll('button')).map((b) => b.textContent ?? '');
const preview = (o: Partial<OfficialContentPreview> = {}): OfficialContentPreview => ({
  valid: true, errors: [], newDocuments: [], updatedDocuments: [], unchangedDocuments: [],
  absentExistingDocuments: [], newComponents: [], changedComponents: [], removedComponents: [],
  unchangedComponents: [], referenceOnlyForms: [], unitsRequiringSourceReview: [], ...o,
});
const base = {
  bundledStatus: { available: true, byteLength: 1048576 },
  bundledFirstRunAvailable: true, bundledPreview: null, bundledPreviewError: null,
  bundledBusy: false, currentPackage: null, onLoadBundledPreview: () => {},
  onInstallBundledPackage: () => {}, onInstallBundledUpdate: () => {},
};
const mounted: { host: HTMLDivElement; root: Root }[] = [];
const renderSection = async (props: Record<string, unknown>) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(StudyBundledOfficialSection, { ...base, ...props } as never));
  });
  mounted.push({ host, root });
};
afterEach(async () => {
  await act(async () => {
    for (const m of mounted) { m.root.unmount(); m.host.remove(); }
  });
  mounted.length = 0;
  document.body.innerHTML = '';
});
const click = (label: string) =>
  act(async () => {
    document.querySelectorAll('button').forEach((b) => {
      if (b.textContent === label) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  });
describe('StudyBundledOfficialSection install affordance', () => {
  it('first-import preview renders Install Bundled Library', async () => {
    const onInstall = vi.fn();
    await renderSection({ bundledPreview: preview(), onInstallBundledPackage: onInstall });
    expect(labels()).toContain('Install Bundled Library');
    await click('Install Bundled Library');
    expect(onInstall).toHaveBeenCalledTimes(1);
  });
  it('matches-current renders no install/update button', async () => {
    const current = { packageIds: ['pkg-1'], documentCount: 1, componentCount: 0 };
    await renderSection({ bundledPreview: preview(), currentPackage: current });
    expect(labels()).not.toContain('Install Bundled Library');
    expect(labels()).not.toContain('Install Update');
  });
  it('differs-from-current renders Install Update wired to onInstallBundledUpdate', async () => {
    const onUpdate = vi.fn();
    const current = { packageIds: ['pkg-1'], documentCount: 1, componentCount: 0 };
    await renderSection({
      bundledPreview: preview({ newDocuments: ['doc-new'] }),
      currentPackage: current, onInstallBundledUpdate: onUpdate,
    });
    expect(labels()).toContain('Install Update');
    await click('Install Update');
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('shows official-library onboarding without falsely claiming seeded data is empty', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <StudyGetStarted
          libraryEmpty={false}
          officialLibraryEmpty
          nativeBackupAvailable={false}
          onOpenManage={() => {}}
          bundledFirstRunAvailable
          onInstallBundledPackage={() => {}}
        />,
      );
    });
    expect(host.textContent).toContain('Sample library loaded');
    expect(host.textContent).not.toContain('no documents or study units');
    root.unmount();
    host.remove();
  });
});
