/**
 * Phase 13F B1 — production-wiring guard + persistence + single-source parity.
 *
 * Fails if the multifile engine loses its production callers, if the
 * gnssMultifile settings bag stops surviving a project reload, or if a
 * single-source project diverges from the single-file result.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { ProjectManifestFileEntry } from '../../src/engine/projectWorkspaceTypes';
import { normalizeProjectFileKind } from '../../src/engine/projectWorkspace';
import { parseGnssBaselineText } from '../../src/engine/gnssBaselineNetworkImport';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import {
  isGnssMultifileEnabled,
  setGnssMultifileEnabled,
} from '../../src/engine/gnssMultifileFlag';
import { runGnssMultifileProjectSolve } from '../../src/engine/gnssMultifileProject';
import { attachGnssMultifileSettings } from '../../src/engine/projectFileSanitizers';
import { parseProjectFile } from '../../src/engine/projectFile';
import { defaults } from '../projectFile/projectFileTestSupport';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const FRAME = 'ITRF2020@2020.0';
const EPOCH = '2020.0';
const ELLIPSOID = 'GRS80';
const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';

const NATIVE_TEXT = [
  `FRAME ECEF ${FRAME} EPOCH ${EPOCH} ELLIPSOID ${ELLIPSOID}`,
  'UNITS M',
  'GX A 4000000 1000000 4800000 FIXED',
  'GX B 4000100 1000050 4800020 FREE',
  'GX C 4000200 999950 4800100 FREE',
  'BL A B 100 50 20 ID B1 SESSION S1',
  COV,
  'BL B C 100 -100 80 ID B2 SESSION S1',
  COV,
  '',
].join('\n');

const entry = (id: string, name: string, order: number): ProjectManifestFileEntry => ({
  id,
  name,
  kind: 'gnss',
  path: `data/${id}-${name}`,
  enabled: true,
  order,
});

describe('gnss multifile production wiring guard', () => {
  it('reaches the multifile engine from production src/ (hook + panel + modal)', () => {
    const hook = readSource('../../src/hooks/useGnssMultifileProject.ts');
    expect(hook).toMatch(/buildGnssMultifileAdjustInput|runGnssMultifileProjectSolve/);
    const panel = readSource('../../src/components/gnss/GnssMultifileProjectPanel.tsx');
    expect(panel).toContain('useGnssMultifileProject');
    expect(panel).toContain('GnssResultsPanel');
    const modal = readSource('../../src/components/gnss/GnssWorkspaceModal.tsx');
    expect(modal).toContain('GnssMultifileProjectPanel');
  });

  it('keeps the gnss file kind through the manifest sanitizer', () => {
    expect(normalizeProjectFileKind('gnss')).toBe('gnss');
  });

  it('attaches a carried gnssMultifile record and leaves others untouched', () => {
    const settings: Record<string, unknown> = { maxIterations: 10 };
    attachGnssMultifileSettings(settings, {
      maxIterations: 10,
      gnssMultifile: {
        version: 1,
        formatOverrides: {},
        controlOverrides: {},
        datumMode: 'constrained',
        setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0 },
        displayNames: {},
      },
    });
    expect(settings.gnssMultifile).toMatchObject({ version: 1, datumMode: 'constrained' });
    const bare: Record<string, unknown> = { maxIterations: 10 };
    attachGnssMultifileSettings(bare, { maxIterations: 10 });
    expect('gnssMultifile' in bare).toBe(false);
  });

  it('survives a project file reload through parseProjectFile', () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        kind: 'webnet-project',
        schemaVersion: 1,
        input: '.3D',
        ui: {
          settings: {
            maxIterations: 10,
            gnssMultifile: {
              version: 1,
              formatOverrides: {},
              controlOverrides: { A: true },
              datumMode: 'constrained',
              setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0 },
              displayNames: {},
            },
          },
          parseSettings: { solveProfile: 'industry-parity' },
          adjustedPointsExport: {},
        },
        project: { projectInstruments: {}, selectedInstrument: 'missing' },
      }),
      defaults,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.ui.settings.gnssMultifile).toMatchObject({
      version: 1,
      controlOverrides: { A: true },
    });
  });
});

describe('single-source project parity with single-file solve', () => {
  let flagBefore = true;
  beforeEach(() => {
    flagBefore = isGnssMultifileEnabled();
    setGnssMultifileEnabled(true);
  });
  afterEach(() => {
    setGnssMultifileEnabled(flagBefore);
  });

  it('matches coords, residuals, variance factor, dof, and route', () => {
    const files = [entry('f1', 'single.bl', 0)];
    const texts = { f1: NATIVE_TEXT };
    const project = runGnssMultifileProjectSolve(files, texts, { datumMode: 'constrained' });

    const single = parseGnssBaselineText(NATIVE_TEXT, 'single.bl');
    expect(single.network).not.toBeNull();
    if (!single.network) return;
    const direct = runGnssBaselineAdjustment({
      stations: single.network.stations,
      baselines: single.network.baselines,
      referenceFrame: single.network.frame.referenceFrame,
      epoch: single.network.frame.epoch,
      ellipsoid: single.network.frame.ellipsoid,
      datumMode: 'constrained',
    });

    expect(project.result.varianceFactor).toBeCloseTo(direct.varianceFactor, 12);
    expect(project.result.weightedResidualSum).toBeCloseTo(direct.weightedResidualSum, 9);
    expect(project.result.dof).toBe(direct.dof);
    expect(project.result.routeProvenance).toEqual(direct.routeProvenance);
    expect(project.result.stations).toEqual(direct.stations);
    expect(project.result.residuals).toEqual(direct.residuals);
    expect(project.input).toEqual({
      stations: single.network.stations,
      baselines: single.network.baselines,
      referenceFrame: FRAME,
      epoch: EPOCH,
      ellipsoid: ELLIPSOID,
      setupUncertainty: project.input.setupUncertainty,
      datumMode: 'constrained',
      nativeRuntime: undefined,
    });
  });
});
