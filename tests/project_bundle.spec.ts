import { describe, expect, it } from 'vitest';

import {
  buildProjectBundleBytes,
  parseProjectBundleBytes,
} from '../src/engine/projectBundle';
import {
  buildProjectSolveIncludeFiles,
  buildProjectSolveInput,
  createManifestFromFlatProject,
} from '../src/engine/projectWorkspace';

describe('project bundle serialization', () => {
  it('round-trips a manifest plus source files through zip bundle bytes', () => {
    const seed = createManifestFromFlatProject({
      projectId: 'project-1',
      name: 'Bundle Test',
      createdAt: '2026-04-10T10:00:00.000Z',
      updatedAt: '2026-04-10T10:00:00.000Z',
      input: '.2D\nC A 0 0 0',
      includeFiles: {
        'obs/job-1.dat': 'C B 10 20 0',
        'obs/job-2.dat': '.INCLUDE obs/job-1.dat',
      },
      ui: {
        settings: { units: 'm' },
        parseSettings: { solveProfile: 'industry-parity' },
        exportFormat: 'points',
        adjustedPointsExport: {
          presetId: 'PNEZ',
          format: 'csv',
          delimiter: 'comma',
          includeLostStations: true,
          columns: ['P', 'N', 'E', 'Z'],
          transform: {
            referenceStationId: '',
            scope: 'all',
            selectedStationIds: [],
            rotation: { enabled: false, angleDeg: 0 },
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
        },
        migration: {
          parseModeMigrated: true,
          migratedAt: '2026-04-10T10:00:00.000Z',
        },
      },
      project: {
        projectInstruments: {},
        selectedInstrument: '',
        levelLoopCustomPresets: [],
      },
    });

    const bytes = buildProjectBundleBytes(seed);
    const parsed = parseProjectBundleBytes(bytes);

    expect(parsed.manifest.storageLayout).toBe('manifest');
    expect(parsed.manifest.projectId).toBe('project-1');
    expect(parsed.manifest.files).toHaveLength(3);
    expect(buildProjectSolveInput(parsed.manifest, parsed.sourceTexts)).toContain('C A');
    expect(buildProjectSolveIncludeFiles(parsed.manifest, parsed.sourceTexts)).toEqual({
      'obs/job-1.dat': 'C B 10 20 0',
      'obs/job-2.dat': '.INCLUDE obs/job-1.dat',
    });
  });
});
