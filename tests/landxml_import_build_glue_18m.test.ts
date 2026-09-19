/**
 * Phase 18M — LandXML import build glue (agent-tier, fast).
 *
 * Covers the workspace-owned sequencing seam: staged payload → deferred
 * commit report → schedule imported surfaces → concise notice. The engine
 * commit and the worker service are stubbed so this proves the wiring,
 * ownership, and "nothing new" behavior only.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  commitAndScheduleLandXmlImport,
  formatLandXmlImportNotice,
  type LandXmlImportBuildDeps,
} from '../src/hooks/surveyCad/surveyCadLandxmlImportBuild';
import type { LandXmlCommitReport } from '../src/engine/cad/cadLandxmlCommit';
import type { LandXmlImportCommitPayload } from '../src/components/landXmlImportReview/landXmlImportReview.types';

const report = (overrides: Partial<LandXmlCommitReport> = {}): LandXmlCommitReport => ({
  committed: true,
  pointsAdded: 0,
  alignmentsAdded: 0,
  surfacesAdded: 0,
  duplicatesSkipped: 0,
  renamed: [],
  importedSurfaceIds: [],
  meshesBuilt: 0,
  meshErrors: [],
  excludedUnsupported: 0,
  excludedBlocked: 0,
  ...overrides,
});

const payload = (drawingId = 'drawing-a'): LandXmlImportCommitPayload =>
  ({
    drawingId,
    fileName: 'eg.xml',
    version: '1.2',
    preview: {} as LandXmlImportCommitPayload['preview'],
    selection: { includePoints: true, alignmentNames: [], surfaceNames: [] },
    commitSelection: { pointIds: [], alignmentNames: [], surfaceNames: [] },
  });

const deps = (overrides: Partial<LandXmlImportBuildDeps> = {}): LandXmlImportBuildDeps => ({
  getDrawingId: () => 'drawing-a',
  runDeferredCommit: vi.fn(() => report()),
  scheduleSurfaces: vi.fn(),
  notify: vi.fn(),
  ...overrides,
});

describe('commitAndScheduleLandXmlImport', () => {
  it('commits, schedules every imported surface, and notifies a concise summary', () => {
    const d = deps({
      runDeferredCommit: vi.fn(() =>
        report({ surfacesAdded: 2, importedSurfaceIds: ['s-a', 's-b'], meshesBuilt: 0 }),
      ),
    });
    const outcome = commitAndScheduleLandXmlImport(d, payload());
    expect(outcome.committed).toBe(true);
    expect(d.scheduleSurfaces).toHaveBeenCalledWith(['s-a', 's-b']);
    expect(outcome.scheduledSurfaceIds).toEqual(['s-a', 's-b']);
    expect(d.notify).toHaveBeenCalledWith('Imported 2 surfaces. 2 surfaces building…');
  });

  it('reports "Nothing new to import." for an all-duplicate payload without scheduling or dirtying', () => {
    const d = deps({
      runDeferredCommit: vi.fn(() =>
        report({
          committed: false,
          error: 'import rejected — nothing importable (all duplicates or empty selection).',
          duplicatesSkipped: 3,
        }),
      ),
    });
    const outcome = commitAndScheduleLandXmlImport(d, payload());
    expect(outcome.committed).toBe(false);
    expect(d.scheduleSurfaces).not.toHaveBeenCalled();
    expect(outcome.notice).toBe('Nothing new to import.');
    expect(d.notify).toHaveBeenCalledWith('Nothing new to import.');
  });

  it('rejects a payload staged against a different (switched) drawing before committing', () => {
    const d = deps({ getDrawingId: () => 'drawing-b' });
    const outcome = commitAndScheduleLandXmlImport(d, payload('drawing-a'));
    expect(d.runDeferredCommit).not.toHaveBeenCalled();
    expect(d.scheduleSurfaces).not.toHaveBeenCalled();
    expect(outcome.committed).toBe(false);
    expect(outcome.notice).toContain('different drawing');
  });

  it('does not leak raw surface/entity ids into the user notice', () => {
    const notice = formatLandXmlImportNotice(
      report({ surfacesAdded: 1, importedSurfaceIds: ['landxml-surf-fnv1a1234-0'] }),
    );
    expect(notice).not.toContain('landxml-surf');
    expect(notice).toContain('1 surface');
  });

  it('reports import unavailable when the history seam is absent', () => {
    const d = deps({ runDeferredCommit: () => null });
    const outcome = commitAndScheduleLandXmlImport(d, payload());
    expect(outcome.committed).toBe(false);
    expect(outcome.notice).toBe('Import unavailable.');
    expect(d.scheduleSurfaces).not.toHaveBeenCalled();
  });
});
