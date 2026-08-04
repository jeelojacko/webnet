import { describe, expect, it } from 'vitest';

import {
  defaults,
  buildSurveyCadSidecarText,
  parseProjectFile,
  savedRunResult,
  sanitizeAdjustedPointsExportSettings,
  serializeProjectFile,
  surveyCadState,
  type RunSettingsSnapshot,
} from './projectFileTestSupport';

describe('project file serialization/parsing round trip', () => {
  it('round-trips project payload for input/settings/instruments/export config', () => {
    const text = serializeProjectFile({
      input: '.2D\nC A 0 0 0 ! !',
      includeFiles: {
        'sub/job1.dat': 'C X 1 1 0',
      },
      savedRuns: [
        {
          id: 'saved-run-1',
          sourceRunId: 'run-2',
          createdAt: '2026-03-20T10:00:00.000Z',
          savedAt: '2026-03-20T10:05:00.000Z',
          label: 'Saved Run 02',
          notes: 'checkpoint',
          inputFingerprint: 'fnv1a:input',
          settingsFingerprint: 'fnv1a:settings',
          summary: {
            converged: true,
            iterations: 2,
            seuw: 1.05,
            dof: 8,
            stationCount: 1,
            observationCount: 0,
            suspectObservationCount: 0,
            maxAbsStdRes: 0,
          },
          result: savedRunResult,
          runDiagnostics: null,
          settingsSnapshot: {
            maxIterations: 15,
            convergenceLimit: 0.1,
            precisionReportingMode: 'posterior-scaled',
          } as unknown as RunSettingsSnapshot,
          excludedIds: [4],
          overrideIds: [9],
          overrides: {
            9: { stdDev: 0.25 },
          },
          approvedClusterMerges: [{ aliasId: 'P1', canonicalId: 'A' }],
          reopenState: {
            activeTab: 'map',
            review: {
              reportView: {
                ellipseMode: '95',
                reportFilterQuery: 'p1',
                reportObservationTypeFilter: 'dist',
                reportExclusionFilter: 'included',
                tableRowLimits: { observations: 25 },
                pinnedDetailSections: [{ id: 'angles-ts', label: 'Angles (TS)' }],
                collapsedDetailSections: { 'angles-ts': true },
              },
              selection: {
                stationId: 'P1',
                observationId: 9,
                sourceLine: 12,
                origin: 'compare',
              },
              pinnedObservationIds: [9],
            },
            comparisonSelection: {
              baselineRunId: 'saved-run-0',
              pinnedBaselineRunId: null,
              stationMovementThreshold: 0.01,
              residualDeltaThreshold: 0.5,
            },
          },
        },
      ],
      ui: {
        settings: {
          maxIterations: 15,
          convergenceLimit: 0.1,
          precisionReportingMode: 'posterior-scaled',
          units: 'ft',
          uiTheme: 'gruvbox-light',
          listingShowLostStations: false,
        },
        parseSettings: {
          solveProfile: 'webnet',
          coordMode: '2D',
          order: 'NE',
          angleUnits: 'dd',
        },
        exportFormat: 'industry-style',
        adjustedPointsExport: sanitizeAdjustedPointsExportSettings({
          format: 'text',
          delimiter: 'tab',
          columns: ['P', 'E', 'N', 'Z'],
          includeLostStations: false,
          transform: {
            referenceStationId: 'A1',
            scope: 'selected',
            selectedStationIds: ['A2', 'A3'],
            rotation: {
              enabled: true,
              angleDeg: 12.5,
            },
            translation: {
              enabled: false,
              method: 'direction-distance',
              azimuthDeg: 0,
              distance: 0,
              targetE: 0,
              targetN: 0,
            },
            scale: { enabled: false, factor: 1 },
          },
        }),
        planningMap: {
          basemapMode: 'osm',
          showInputPoints: true,
          showObstacleLayer: true,
          showBlockedAreas: true,
          blockEditMode: false,
          blockedPolygons: [
            {
              id: 'block-1',
              source: 'user',
              kind: 'blocked-area',
              label: 'Blocked pad',
              vertices: [
                { x: 1, y: 1 },
                { x: 4, y: 1 },
                { x: 4, y: 5 },
              ],
            },
          ],
          obstaclePolygons: [
            {
              id: 'osm-1',
              source: 'osm',
              kind: 'building',
              label: 'OSM building',
              vertices: [
                { x: 10, y: 10 },
                { x: 12, y: 10 },
                { x: 12, y: 12 },
              ],
            },
          ],
          scenarioFamilies: {
            existingSet: true,
            bracePoint: true,
            syntheticSetup: true,
            promotedSetup: false,
            crossTie: true,
          },
        },
      },
      project: {
        projectInstruments: defaults.projectInstruments,
        selectedInstrument: 'S9',
        levelLoopCustomPresets: defaults.levelLoopCustomPresets,
        surveyCad: surveyCadState,
      },
    });

    const parsed = parseProjectFile(text, defaults);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.schemaVersion).toBe(5);
    expect(parsed.project.input).toContain('C A');
    expect(parsed.project.includeFiles['sub/job1.dat']).toContain('C X');
    expect(parsed.project.workspace?.focusedFileId).toBeTruthy();
    expect(parsed.project.workspace?.openFileIds.length).toBeGreaterThan(0);
    expect(parsed.project.savedRuns).toHaveLength(1);
    expect(parsed.project.savedRuns[0]?.label).toBe('Saved Run 02');
    expect(parsed.project.savedRuns[0]?.notes).toBe('checkpoint');
    expect(parsed.project.savedRuns[0]?.overrides).toEqual({ 9: { stdDev: 0.25 } });
    expect(parsed.project.savedRuns[0]?.approvedClusterMerges).toEqual([
      { aliasId: 'P1', canonicalId: 'A' },
    ]);
    expect(parsed.project.savedRuns[0]?.reopenState?.activeTab).toBe('map');
    expect(parsed.project.savedRuns[0]?.reopenState?.review.selection.stationId).toBe('P1');
    expect(parsed.project.savedRuns[0]?.settingsSnapshot.precisionReportingMode).toBe(
      'industry-standard',
    );
    expect(parsed.project.ui.exportFormat).toBe('industry-style');
    expect(parsed.project.ui.settings.convergenceLimit).toBe(0.1);
    expect(parsed.project.ui.settings.precisionReportingMode).toBe('industry-standard');
    expect(parsed.project.ui.settings.uiTheme).toBeUndefined();
    expect(parsed.project.ui.adjustedPointsExport.columns).toEqual(['P', 'E', 'N', 'Z']);
    expect(parsed.project.ui.adjustedPointsExport.transform.referenceStationId).toBe('A1');
    expect(parsed.project.ui.adjustedPointsExport.transform.scope).toBe('selected');
    expect(parsed.project.ui.adjustedPointsExport.transform.selectedStationIds).toEqual([
      'A2',
      'A3',
    ]);
    expect(parsed.project.ui.planningMap?.basemapMode).toBe('osm');
    expect(parsed.project.ui.planningMap?.blockedPolygons).toHaveLength(1);
    expect(parsed.project.ui.planningMap?.obstaclePolygons).toHaveLength(0);
    expect(parsed.project.ui.planningMap?.scenarioFamilies.promotedSetup).toBe(false);
    expect(parsed.project.ui.adjustedPointsExport.transform.rotation.enabled).toBe(true);
    expect(parsed.project.ui.adjustedPointsExport.transform.rotation.angleDeg).toBe(12.5);
    expect(parsed.project.project.selectedInstrument).toBe('S9');
    expect(parsed.project.project.levelLoopCustomPresets).toHaveLength(1);
    expect(parsed.project.project.surveyCad).toBeUndefined();
    expect(text).not.toContain('OSM building');
    expect(text).not.toContain('parcel-1');
    expect(text).not.toContain('"uiTheme"');

    const surveyCadSidecar = JSON.parse(buildSurveyCadSidecarText(surveyCadState));
    expect(surveyCadSidecar.kind).toBe('webnet-survey-cad');
    expect(surveyCadSidecar.surveyCad.project.entities[0]).toMatchObject({
      id: 'parcel-1',
      parcelName: 'Lot 1',
    });
  });

  it('preserves workspace file contents by file id when a non-main file is focused', () => {
    const text = serializeProjectFile({
      input: 'FOCUSED CHILD CONTENT',
      includeFiles: {
        'main.dat': 'MAIN CONTENT',
        'notes.txt': 'NOTES CONTENT',
      },
      workspaceFileContents: {
        'file-main': 'MAIN CONTENT',
        'file-child': 'FOCUSED CHILD CONTENT',
        'file-notes': 'NOTES CONTENT',
      },
      savedRuns: [],
      ui: {
        settings: defaults.settings,
        parseSettings: defaults.parseSettings,
        exportFormat: 'webnet',
        adjustedPointsExport: defaults.adjustedPointsExport,
      },
      project: {
        projectInstruments: defaults.projectInstruments,
        selectedInstrument: defaults.selectedInstrument,
        levelLoopCustomPresets: defaults.levelLoopCustomPresets,
      },
      workspace: {
        projectId: 'project-1',
        name: 'Workspace Roundtrip',
        createdAt: '2026-04-13T10:00:00.000Z',
        updatedAt: '2026-04-13T10:05:00.000Z',
        files: [
          {
            id: 'file-main',
            name: 'main.dat',
            kind: 'dat',
            path: 'data/file-main-main.dat',
            enabled: true,
            order: 0,
          },
          {
            id: 'file-child',
            name: 'child.dat',
            kind: 'dat',
            path: 'data/file-child-child.dat',
            enabled: true,
            order: 1,
          },
          {
            id: 'file-notes',
            name: 'notes.txt',
            kind: 'notes',
            path: 'data/file-notes-notes.txt',
            enabled: false,
            order: 2,
          },
        ],
        openFileIds: ['file-main', 'file-child'],
        focusedFileId: 'file-child',
        mainFileId: 'file-main',
      },
    });

    const parsed = parseProjectFile(text, defaults);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.project.input).toBe('FOCUSED CHILD CONTENT');
    expect(parsed.project.includeFiles).toEqual({
      'main.dat': 'MAIN CONTENT',
      'notes.txt': 'NOTES CONTENT',
    });
    expect(parsed.project.workspace?.openFileIds).toEqual(['file-main', 'file-child']);
    expect(parsed.project.workspace?.focusedFileId).toBe('file-child');
    expect(parsed.project.workspace?.mainFileId).toBe('file-main');
    expect(parsed.project.workspaceFileContents).toEqual({
      'file-main': 'MAIN CONTENT',
      'file-child': 'FOCUSED CHILD CONTENT',
      'file-notes': 'NOTES CONTENT',
    });
  });
});
