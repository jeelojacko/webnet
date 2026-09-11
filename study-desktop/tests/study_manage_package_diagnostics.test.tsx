/** @vitest-environment jsdom */

// Manage package diagnostics polish: the giant corpus hash is no longer
// inlined — a compact "Corpus fingerprint" alias shows with the full exact
// value behind a disclosure + copy, and per-document hashes sit collapsed
// by default. Metadata/import behavior is unchanged (utils shape intact).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudyManagePage from '../src/components/StudyManagePage';
import { compactCorpusFingerprint } from '../src/components/StudyManagePage.utils';
import { createSeedStudyData } from '../src/studySeed';
import type {
  ImportedLegalDocument,
  StudyOfficialImportHistory,
} from '../src/studyTypes';

const legalDocument: ImportedLegalDocument = {
  id: 'doc-surveys-act',
  packageId: 'nb-sit',
  manifestId: 'nb-sit-statute-corpus',
  officialTitle: 'Surveys Act',
  officialCitationDisplay: 'S.N.B. 1976, c. S-17',
  officialCitationNormalized: 'snb-1976-c-s-17',
  documentType: 'act',
  sourceUrl: 'https://example.test',
  fetchDate: '2026-08-01',
  consolidatedTo: '2026-08-01',
  contentHash: `doc-hash-1-${'0123456789abcdef'.repeat(8)}`,
  importedAt: '2026-08-11T10:00:00.000Z',
  packageCreatedAt: '2026-08-11T09:00:00.000Z',
};

const history: StudyOfficialImportHistory = {
  id: 'official-import-2026-08-11T10:00:00.000Z',
  packageId: 'nb-sit',
  manifestId: 'nb-sit-statute-corpus',
  packageCreatedAt: '2026-08-11T09:00:00.000Z',
  importedAt: '2026-08-11T10:00:00.000Z',
  addedDocuments: 1,
  changedDocuments: 0,
  addedComponents: 83,
  changedComponents: 0,
  removedComponents: 0,
  componentCount: 83,
  referenceOnlyForms: 0,
  unitsFlaggedForReview: 0,
  result: 'success',
  message: 'Imported nb-sit.',
};

const manageProps = () => ({
  data: {
    ...createSeedStudyData('2026-08-01T10:00:00.000Z'),
    legalDocuments: [legalDocument],
    importHistory: [history],
  },
  exportText: '',
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

describe('compactCorpusFingerprint', () => {
  it('passes short values through unchanged', () => {
    expect(compactCorpusFingerprint('abc')).toBe('abc');
    expect(compactCorpusFingerprint('a'.repeat(25))).toBe('a'.repeat(25));
  });

  it('truncates long fingerprints to leading/trailing edges', () => {
    const full = `doc-surveys-act:${legalDocument.contentHash}`;
    const compact = compactCorpusFingerprint(full);
    expect(compact.length).toBeLessThan(full.length);
    expect(compact.startsWith(full.slice(0, 12))).toBe(true);
    expect(compact.endsWith(full.slice(-12))).toBe(true);
  });
});

describe('StudyManagePage package diagnostics polish', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it('labels the corpus fingerprint with a compact alias and the full value behind disclosure/copy', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    try {
      await act(async () => {
        root?.render(<StudyManagePage {...manageProps()} />);
      });

      const body = document.body.textContent ?? '';
      expect(body).toContain('Corpus fingerprint');
      expect(body).not.toContain('Package hash');

      const full = `doc-surveys-act:${legalDocument.contentHash}`;
      const compact = compactCorpusFingerprint(full);
      expect(compact.length).toBeLessThan(full.length);
      expect(body).toContain(compact);

      const fingerprintDetails = Array.from(document.querySelectorAll('details')).find(
        (details) => details.querySelector('summary')?.textContent === 'Show full fingerprint',
      );
      expect(fingerprintDetails).toBeTruthy();
      expect(fingerprintDetails?.textContent).toContain(full);
      expect(fingerprintDetails?.hasAttribute('open')).toBe(false);

      const copyButton = document.querySelector(
        'button[aria-label="Copy full corpus fingerprint"]',
      ) as HTMLButtonElement | null;
      expect(copyButton).toBeTruthy();
      await act(async () => {
        copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(writeText).toHaveBeenCalledWith(full);
    } finally {
      // jsdom has no clipboard by default; remove the stub to avoid leakage.
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: undefined,
      });
    }
  });

  it('collapses the per-document hash list by default', async () => {
    await act(async () => {
      root?.render(<StudyManagePage {...manageProps()} />);
    });

    const perDocument = Array.from(document.querySelectorAll('details')).find((details) =>
      details.querySelector('summary')?.textContent?.startsWith('Per-document hashes'),
    );
    expect(perDocument).toBeTruthy();
    expect(perDocument?.querySelector('summary')?.textContent).toContain('(1)');
    expect(perDocument?.hasAttribute('open')).toBe(false);
    expect(perDocument?.textContent).toContain(`doc-surveys-act · ${legalDocument.contentHash}`);
  });
});
