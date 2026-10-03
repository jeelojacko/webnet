/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildBlankProjectWorkspace } from '../src/app/blankProjectDefaults';
import { cloneInstrumentLibrary } from '../src/app/appHelpers';
import { INDUSTRY_PARITY_CASES } from '../src/industryParityCases';
import { PERMANENT_EXAMPLE_PROJECTS } from '../src/engine/permanentExampleProjects';
import { createFlatProjectManifestSeed } from '../src/hooks/projectFilePayloadBuilders';
import {
  buildProjectIndexRow,
  createProjectStorage,
  type ProjectStorage,
} from '../src/engine/projectStorage';
import { createProjectId } from '../src/engine/projectWorkspace';
import { installIndexedDbMock, type FakeIdbStores } from './projectStorage/projectStorageTestSupport';

const blankStores = (): FakeIdbStores => ({
  projectIndex: new Map(),
  projectManifest: new Map(),
  projectFile: new Map(),
});

const createdAt = '2026-06-01T10:00:00.000Z';

const saveBlankProject = async (
  storage: ProjectStorage,
  name: string,
): Promise<{ projectId: string; text: string }> => {
  const seed = createFlatProjectManifestSeed({
    projectId: createProjectId(),
    name,
    createdAt,
    updatedAt: createdAt,
    workspace: buildBlankProjectWorkspace(),
    cloneInstrumentLibrary,
  });
  await storage.createProject({
    indexRow: buildProjectIndexRow({
      id: seed.manifest.projectId,
      name,
      backend: 'indexeddb',
      createdAt,
      updatedAt: createdAt,
    }),
    manifest: seed.manifest,
    sourceTexts: seed.sourceTexts,
  });
  return { projectId: seed.manifest.projectId, text: seed.sourceTexts[seed.manifest.files[0].id] };
};

describe('blank project persistence roundtrip', () => {
  it('saves, reopens, and stays blank with Adjustment + unset CRS/instruments/GPS', async () => {
    installIndexedDbMock(blankStores());
    const storage = createProjectStorage();
    const { projectId } = await saveBlankProject(storage, 'Blank Roundtrip');

    const reopened = await storage.openProject(projectId);
    expect(reopened).not.toBeNull();
    if (!reopened) throw new Error('expected reopened project');
    expect(reopened.manifest.name).toBe('Blank Roundtrip');
    const focusedId = reopened.manifest.workspace?.focusedFileId ?? reopened.manifest.files[0].id;
    expect(reopened.sourceTexts[focusedId]).toBe('');

    const parseSettings = reopened.manifest.ui.parseSettings as Record<string, unknown>;
    expect(parseSettings.runMode).toBe('adjustment');
    expect(parseSettings.preanalysisMode).toBe(false);
    expect(parseSettings.coordSystemMode).toBe('local');
    expect(parseSettings.crsId).toBe('');
    expect(parseSettings.crsTransformEnabled).toBe(false);
    expect(parseSettings.crsGridScaleEnabled).toBe(false);
    expect(parseSettings.crsConvergenceEnabled).toBe(false);
    expect(parseSettings.geoidModelEnabled).toBe(false);
    expect(parseSettings.geoidModelId).toBe('');
    expect(parseSettings.geoidHeightConversionEnabled).toBe(false);
    expect(parseSettings.gpsLoopCheckEnabled).toBe(false);
    expect(parseSettings.gpsAddHiHtEnabled).toBe(false);
    expect(parseSettings.verticalDeflectionNorthSec).toBe(0);
    expect(parseSettings.verticalDeflectionEastSec).toBe(0);
    expect(parseSettings.averageGeoidHeight).toBe(0);

    expect(reopened.manifest.project.projectInstruments).toEqual({});
    expect(reopened.manifest.project.selectedInstrument).toBe('');
  });

  it('allows mutate + save after the blank roundtrip without re-seeding defaults', async () => {
    installIndexedDbMock(blankStores());
    const storage = createProjectStorage();
    const { projectId } = await saveBlankProject(storage, 'Blank Mutate');
    const reopened = await storage.openProject(projectId);
    if (!reopened) throw new Error('expected reopened project');
    const focusedId = reopened.manifest.workspace?.focusedFileId ?? reopened.manifest.files[0].id;
    const mutatedText = 'STN A 100 200\nSTN B 300 400\n';
    const mutatedAt = '2026-06-02T10:00:00.000Z';
    const mutatedManifest = {
      ...reopened.manifest,
      updatedAt: mutatedAt,
      files: reopened.manifest.files.map((file) =>
        file.id === focusedId ? { ...file, size: mutatedText.length, updatedAt: mutatedAt } : file,
      ),
    };

    await storage.saveProject({
      indexRow: { ...reopened.indexRow, updatedAt: mutatedAt },
      manifest: mutatedManifest,
      sourceTexts: { ...reopened.sourceTexts, [focusedId]: mutatedText },
      dirtyFileIds: [focusedId],
    });

    const second = await storage.openProject(projectId);
    if (!second) throw new Error('expected second reopen');
    expect(second.sourceTexts[focusedId]).toBe(mutatedText);
    // Mutating content must not resurrect startup defaults.
    expect((second.manifest.ui.parseSettings as Record<string, unknown>).crsId).toBe('');
    expect((second.manifest.ui.parseSettings as Record<string, unknown>).runMode).toBe('adjustment');
  });

  it('generates unique ids for repeated blank projects with the same name', async () => {
    installIndexedDbMock(blankStores());
    const storage = createProjectStorage();
    const first = await saveBlankProject(storage, 'Untitled');
    const second = await saveBlankProject(storage, 'Untitled');
    expect(first.projectId).not.toBe(second.projectId);

    const listed = await storage.listProjects();
    expect(listed.map((row) => row.id).sort()).toEqual([first.projectId, second.projectId].sort());
  });

  it('leaves the permanent example projects untouched', async () => {
    const examplePath = 'public/examples/combined/project.wnproj';
    const before = readFileSync(examplePath, 'utf-8');

    installIndexedDbMock(blankStores());
    const storage = createProjectStorage();
    const { projectId } = await saveBlankProject(storage, 'Examples Untouched');
    await storage.openProject(projectId);

    expect(readFileSync(examplePath, 'utf-8')).toBe(before);
    expect(PERMANENT_EXAMPLE_PROJECTS).toHaveLength(3);
    expect(PERMANENT_EXAMPLE_PROJECTS.some((project) => project.projectUrl === examplePath)).toBe(
      false,
    );
    expect(PERMANENT_EXAMPLE_PROJECTS.map((project) => project.projectUrl)).not.toContain(projectId);
  });
});

describe('settings-contract matrix: blank vs combined vs camp', () => {
  const blank = buildBlankProjectWorkspace();
  const combined = INDUSTRY_PARITY_CASES.combined.startupDefaults!;
  const camp = INDUSTRY_PARITY_CASES.campDesignPreanalysis.startupDefaults!;
  const blankParse = blank.parseSettings;

  // Provenance: blank is built from the app base (createInitialSettingsState /
  // createInitialParseSettings) with explicit neutral overrides in
  // buildBlankProjectWorkspace. It never clones the workspace or the startup example.
  const contract: Array<{ field: string; blank: unknown; provenance: string }> = [
    { field: 'input', blank: blank.input, provenance: 'explicit empty string' },
    { field: 'runMode', blank: blankParse.runMode, provenance: 'explicit adjustment override' },
    {
      field: 'preanalysisMode',
      blank: blankParse.preanalysisMode,
      provenance: 'explicit false override',
    },
    {
      field: 'coordSystemMode',
      blank: blankParse.coordSystemMode,
      provenance: 'explicit local override',
    },
    { field: 'crsId', blank: blankParse.crsId, provenance: 'explicit empty override (no CRS)' },
    {
      field: 'projectInstruments',
      blank: blank.projectInstruments,
      provenance: 'explicit empty library',
    },
    {
      field: 'selectedInstrument',
      blank: blank.selectedInstrument,
      provenance: 'explicit empty selection',
    },
    { field: 'GPS crsTransformEnabled', blank: blankParse.crsTransformEnabled, provenance: 'off' },
    {
      field: 'GPS geoidModelEnabled',
      blank: blankParse.geoidModelEnabled,
      provenance: 'off + empty geoid id/path',
    },
    {
      field: 'GPS gpsLoopCheckEnabled',
      blank: blankParse.gpsLoopCheckEnabled,
      provenance: 'off',
    },
    {
      field: 'GPS gpsAddHiHtEnabled',
      blank: blankParse.gpsAddHiHtEnabled,
      provenance: 'off + zeroed hi/ht',
    },
    {
      field: 'GPS verticalDeflection',
      blank: `${blankParse.verticalDeflectionNorthSec}/${blankParse.verticalDeflectionEastSec}`,
      provenance: 'zeroed',
    },
    { field: 'averageGeoidHeight', blank: blankParse.averageGeoidHeight, provenance: 'zeroed' },
    {
      field: 'General mapMode',
      blank: blankParse.mapMode,
      provenance: 'base seed off (from createInitialParseSettings)',
    },
    {
      field: 'General faceNormalizationMode',
      blank: blankParse.faceNormalizationMode,
      provenance: 'base seed on',
    },
    {
      field: 'Special robustMode',
      blank: blankParse.robustMode,
      provenance: 'base seed none',
    },
    {
      field: 'Special tsCorrelationEnabled',
      blank: blankParse.tsCorrelationEnabled,
      provenance: 'base seed off',
    },
    {
      field: 'Listing listingObservationLimit',
      blank: blank.settings.listingObservationLimit,
      provenance: 'base seed 60',
    },
    {
      field: 'Listing listingShowCoordinates',
      blank: blank.settings.listingShowCoordinates,
      provenance: 'base seed true',
    },
    {
      field: 'Other settings.convergenceLimit',
      blank: blank.settings.convergenceLimit,
      provenance: 'base seed 0.01',
    },
  ];

  const expectedBlank: Record<string, unknown> = {
    input: '',
    runMode: 'adjustment',
    preanalysisMode: false,
    coordSystemMode: 'local',
    crsId: '',
    projectInstruments: {},
    selectedInstrument: '',
    'GPS crsTransformEnabled': false,
    'GPS geoidModelEnabled': false,
    'GPS gpsLoopCheckEnabled': false,
    'GPS gpsAddHiHtEnabled': false,
    'GPS verticalDeflection': '0/0',
    averageGeoidHeight: 0,
    'General mapMode': 'off',
    'General faceNormalizationMode': 'on',
    'Special robustMode': 'none',
    'Special tsCorrelationEnabled': false,
    'Listing listingObservationLimit': 60,
    'Listing listingShowCoordinates': true,
    'Other settings.convergenceLimit': 0.01,
  };

  it('documents each blank field value and its provenance', () => {
    expect(contract.map((row) => row.field)).toEqual(Object.keys(expectedBlank));
    for (const row of contract) {
      expect(row.blank, `${row.field} (${row.provenance})`).toEqual(expectedBlank[row.field]);
    }
  });

  it('keeps blank distinct from the combined and camp startup examples', () => {
    expect(blank.input).not.toBe(combined.input);
    expect(blank.input).not.toBe(camp.input);
    expect(blankParse.runMode).not.toBe(camp.parseSettingsPatch.runMode);
    expect(blankParse.coordSystemMode).not.toBe(combined.parseSettingsPatch.coordSystemMode);
    expect(blankParse.crsId).not.toBe(combined.parseSettingsPatch.crsId);
    expect(blankParse.crsId).not.toBe(camp.parseSettingsPatch.crsId);
    expect(blank.projectInstruments).not.toEqual(combined.projectInstruments);
    expect(blank.projectInstruments).not.toEqual(camp.projectInstruments);
    expect(blank.selectedInstrument).not.toBe(combined.selectedInstrument);
    expect(blank.selectedInstrument).not.toBe(camp.selectedInstrument);
  });
});
