/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  applyPersistedProjectSession,
  createManifestEntry,
  createProjectManifest,
} from './projectFileWorkflowStateTestSupport';
import type {
  ProjectIndexRow,
  ProjectSessionState,
  ParseSettings,
} from './projectFileWorkflowStateTestSupport';

describe('useProjectFileWorkflow', () => {
  it('keeps newer project-file state when an older autosave finishes late', () => {
    const createdAt = '2026-04-13T13:00:00.000Z';
    const olderUpdatedAt = '2026-04-13T13:01:00.000Z';
    const newerUpdatedAt = '2026-04-13T13:02:00.000Z';
    const completedAt = '2026-04-13T13:03:00.000Z';
    const baseFile = createManifestEntry({
      id: 'file-1',
      name: 'main.dat',
      kind: 'dat',
      order: 0,
      enabled: true,
      text: 'MAIN',
      createdAt,
      updatedAt: createdAt,
    });
    const staleManifest = createProjectManifest({
      projectId: 'project-1',
      name: 'Autosave Project',
      createdAt,
      updatedAt: olderUpdatedAt,
      files: [{ ...baseFile, updatedAt: olderUpdatedAt, modifiedAt: olderUpdatedAt }],
      ui: {
        settings: {},
        parseSettings: {},
        exportFormat: 'points',
        adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      },
      project: {
        projectInstruments: {},
        selectedInstrument: '',
        levelLoopCustomPresets: [],
      },
    });
    const currentManifest = createProjectManifest({
      projectId: 'project-1',
      name: 'Autosave Project',
      createdAt,
      updatedAt: newerUpdatedAt,
      files: [{ ...baseFile, enabled: false, updatedAt: newerUpdatedAt, modifiedAt: newerUpdatedAt }],
      ui: staleManifest.ui,
      project: staleManifest.project,
    });
    const staleIndexRow: ProjectIndexRow = {
      id: 'project-1',
      name: 'Autosave Project',
      backend: 'indexeddb',
      rootKey: 'project-1',
      schemaVersion: 5,
      createdAt,
      updatedAt: olderUpdatedAt,
      lastOpenedAt: olderUpdatedAt,
    };
    const currentSession: ProjectSessionState = {
      indexRow: {
        ...staleIndexRow,
        updatedAt: newerUpdatedAt,
        lastOpenedAt: newerUpdatedAt,
      },
      manifest: currentManifest,
      sourceTexts: { 'file-1': 'MAIN' },
      dirtyFileIds: [],
      manifestDirty: true,
      autosaveState: 'saving',
      lastAutosavedAt: null,
      lastAutosaveError: null,
    };
    const savedSession: ProjectSessionState = {
      indexRow: staleIndexRow,
      manifest: staleManifest,
      sourceTexts: { 'file-1': 'MAIN' },
      dirtyFileIds: [],
      manifestDirty: false,
      autosaveState: 'idle',
      lastAutosavedAt: null,
      lastAutosaveError: null,
    };

    const merged = applyPersistedProjectSession({
      current: currentSession,
      saved: savedSession,
      requestedManifestUpdatedAt: olderUpdatedAt,
      completedAt,
    });

    expect(merged).not.toBeNull();
    expect(merged?.manifest.updatedAt).toBe(newerUpdatedAt);
    expect(merged?.manifest.files[0]?.enabled).toBe(false);
    expect(merged?.manifestDirty).toBe(true);
    expect(merged?.indexRow.updatedAt).toBe(olderUpdatedAt);
    expect(merged?.lastAutosavedAt).toBe(completedAt);
  });

});
