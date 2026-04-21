import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const TSX_CLI = path.resolve(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const WEBNET_CLI = path.resolve(ROOT, 'src', 'cli.ts');
const STABLE_INPUT = path.resolve(ROOT, 'tests', 'fixtures', 'cli_smoke.dat');
const PREANALYSIS_INPUT = path.resolve(ROOT, 'tests', 'fixtures', 'preanalysis_cli.dat');
const GEOID_GTX_INPUT = path.resolve(ROOT, 'tests', 'fixtures', 'mock_geoid.gtx');
const CLI_TEST_TIMEOUT_MS = 15000;

const runCli = (args: string[]) =>
  spawnSync(process.execPath, [TSX_CLI, WEBNET_CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
  });

const normalizePath = (value: string): string => value.replace(/\\/g, '/');

describe('CLI phase 2 output modes', () => {
  it('emits machine-readable JSON payloads', () => {
    const res = runCli(['--input', STABLE_INPUT, '--output', 'json']);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(true);
    expect(payload.converged).toBe(true);
    expect(payload.stationCount).toBeGreaterThan(0);
    expect(payload.observationCount).toBeGreaterThan(0);
  }, 90000);

  it('writes industry-style listing output to file', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-'));
    const outPath = path.join(outDir, 'listing.txt');
    const res = runCli(['--input', STABLE_INPUT, '--output', 'listing', '--out', outPath]);
    expect(res.status).toBe(0);
    const text = readFileSync(outPath, 'utf-8');
    expect(text).toContain('INDUSTRY-STANDARD-STYLE Listing');
    expect(text).toContain('Adjusted Coordinates');
  }, 60000);

  it('writes LandXML output to file', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-'));
    const outPath = path.join(outDir, 'network.xml');
    const res = runCli(['--input', STABLE_INPUT, '--output', 'landxml', '--out', outPath]);
    expect(res.status).toBe(0);
    const text = readFileSync(outPath, 'utf-8');
    expect(text).toContain('<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"');
    expect(text).toContain('<CgPoints>');
    expect(text).toContain('<PlanFeatures name="WebNet Connections">');
  }, CLI_TEST_TIMEOUT_MS);

  it('returns deterministic usage error code for missing input files', () => {
    const res = runCli(['--input', 'tests/fixtures/does_not_exist.dat']);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Failed to read input file');
  }, CLI_TEST_TIMEOUT_MS);

  it('applies auto-adjust flags into parse-state output', () => {
    const res = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--autoadjust',
      'on',
      '--autoadjust-threshold',
      '3.5',
      '--autoadjust-cycles',
      '2',
      '--autoadjust-max-removals',
      '2',
    ]);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.parseState?.autoAdjustEnabled).toBe(true);
    expect(payload.parseState?.autoAdjustStdResThreshold).toBeCloseTo(3.5, 8);
    expect(payload.parseState?.autoAdjustMaxCycles).toBe(2);
    expect(payload.parseState?.autoAdjustMaxRemovalsPerCycle).toBe(2);
  }, CLI_TEST_TIMEOUT_MS);

  it('supports preanalysis mode from the CLI', () => {
    const res = runCli([
      '--input',
      PREANALYSIS_INPUT,
      '--output',
      'json',
      '--coord-mode',
      '2D',
      '--preanalysis',
      'on',
    ]);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(true);
    expect(payload.preanalysisMode).toBe(true);
    expect(payload.plannedObservationCount).toBeGreaterThan(0);
    expect(payload.parseState?.preanalysisMode).toBe(true);
    expect(payload.parseState?.plannedObservationCount).toBeGreaterThan(0);
  }, CLI_TEST_TIMEOUT_MS);

  it('supports explicit run-mode flags for data-check and blunder-detect', () => {
    const dataCheck = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--run-mode',
      'data-check',
    ]);
    expect(dataCheck.status).toBe(0);
    const dataPayload = JSON.parse(dataCheck.stdout);
    expect(dataPayload.success).toBe(true);
    expect(dataPayload.runMode).toBe('data-check');
    expect(dataPayload.parseState?.runMode).toBe('data-check');

    const blunder = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--run-mode',
      'blunder-detect',
    ]);
    expect(blunder.status).toBe(0);
    const blunderPayload = JSON.parse(blunder.stdout);
    expect(blunderPayload.success).toBe(true);
    expect(blunderPayload.runMode).toBe('blunder-detect');
    expect(blunderPayload.parseState?.runMode).toBe('blunder-detect');
  }, CLI_TEST_TIMEOUT_MS);

  it('hard-fails blunder-detect mode for leveling-only datasets with compatibility diagnostics', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-runmode-'));
    const inputPath = path.join(outDir, 'level_only.dat');
    writeFileSync(
      inputPath,
      ['C A 0 0 100.000 ! ! !', 'C B 0 0 100.900', 'L A-B 0.9000 0.25'].join('\n'),
      'utf-8',
    );

    const res = runCli(['--input', inputPath, '--output', 'json', '--run-mode', 'blunder-detect']);
    expect(res.status).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(false);
    expect(payload.runMode).toBe('blunder-detect');
    expect(payload.parseState?.runMode).toBe('blunder-detect');
    const diagCodes = new Set(
      (payload.parseState?.runModeCompatibilityDiagnostics ?? []).map(
        (diag: { code: string }) => diag.code,
      ),
    );
    expect(diagCodes.has('BLUNDER_LEVELING_ONLY')).toBe(true);
  }, CLI_TEST_TIMEOUT_MS);

  it('hard-fails runs when include files are missing', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-include-'));
    const inputPath = path.join(outDir, 'main.dat');
    writeFileSync(inputPath, ['.INCLUDE missing/child.dat', 'C A 0 0 0 ! !'].join('\n'), 'utf-8');

    const res = runCli(['--input', inputPath, '--output', 'json']);
    expect(res.status).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(false);
    expect(payload.parseState?.includeErrors?.length).toBeGreaterThan(0);
    expect(payload.parseState?.includeErrors?.[0]?.code).toBe('include-not-found');
  }, CLI_TEST_TIMEOUT_MS);

  it('resolves nested include relative paths and keeps deterministic include order in CLI mode', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-include-rel-'));
    const mainPath = path.join(outDir, 'main.dat');
    const sectionDir = path.join(outDir, 'section');
    const nestedDir = path.join(sectionDir, 'nested');
    const sharedDir = path.join(outDir, 'shared');

    mkdirSync(sectionDir, { recursive: true });
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(sharedDir, { recursive: true });

    writeFileSync(
      mainPath,
      ['.INCLUDE section/first.dat', '.INCLUDE section/second.dat', 'C ROOT 0 0 0 ! !'].join('\n'),
      'utf-8',
    );
    writeFileSync(
      path.join(sectionDir, 'first.dat'),
      ['C F1 0 10 0 ! !', '.INCLUDE ../shared/grand.dat', 'C F2 10 10 0', 'D F1-F2 10'].join('\n'),
      'utf-8',
    );
    writeFileSync(
      path.join(sharedDir, 'grand.dat'),
      ['C G1 0 20 0 ! !', 'C G2 10 20 0', 'D G1-G2 10'].join('\n'),
      'utf-8',
    );
    writeFileSync(
      path.join(sectionDir, 'second.dat'),
      ['C S1 0 30 0 ! !', 'C S2 10 30 0', 'D S1-S2 10'].join('\n'),
      'utf-8',
    );

    const res = runCli([
      '--input',
      mainPath,
      '--output',
      'json',
      '--run-mode',
      'data-check',
      '--coord-mode',
      '2D',
    ]);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(true);
    const trace = payload.parseState?.includeTrace as
      | Array<{ parentSourceFile?: string; sourceFile: string; line: number }>
      | undefined;
    expect(trace).toEqual([
      {
        parentSourceFile: normalizePath(mainPath),
        sourceFile: normalizePath(path.join(sectionDir, 'first.dat')),
        line: 1,
      },
      {
        parentSourceFile: normalizePath(path.join(sectionDir, 'first.dat')),
        sourceFile: normalizePath(path.join(sharedDir, 'grand.dat')),
        line: 2,
      },
      {
        parentSourceFile: normalizePath(mainPath),
        sourceFile: normalizePath(path.join(sectionDir, 'second.dat')),
        line: 2,
      },
    ]);
  }, CLI_TEST_TIMEOUT_MS);

  it('hard-fails runs when include cycles are detected', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-include-cycle-'));
    const mainPath = path.join(outDir, 'main.dat');
    const aPath = path.join(outDir, 'a.dat');
    const bPath = path.join(outDir, 'b.dat');

    writeFileSync(mainPath, '.INCLUDE a.dat\nC ROOT 0 0 0 ! !', 'utf-8');
    writeFileSync(aPath, '.INCLUDE b.dat\nC A 0 10 0 ! !', 'utf-8');
    writeFileSync(bPath, '.INCLUDE a.dat\nC B 10 10 0 ! !', 'utf-8');

    const res = runCli(['--input', mainPath, '--output', 'json']);
    expect(res.status).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(false);

    const cycleDiag = (payload.parseState?.includeErrors ?? []).find(
      (entry: { code?: string }) => entry.code === 'include-cycle',
    ) as
      | {
          code: string;
          sourceFile?: string;
          includePath?: string;
          line?: number;
          stack?: string[];
        }
      | undefined;
    expect(cycleDiag).toBeDefined();
    expect(cycleDiag?.sourceFile).toBe(normalizePath(bPath));
    expect(cycleDiag?.line).toBe(1);
    expect(cycleDiag?.includePath).toBe('a.dat');
    expect(cycleDiag?.stack).toEqual([
      normalizePath(mainPath),
      normalizePath(aPath),
      normalizePath(bPath),
      normalizePath(aPath),
    ]);
  }, CLI_TEST_TIMEOUT_MS);

  it('hard-fails runs when include depth is exceeded', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-include-depth-'));
    const mainPath = path.join(outDir, 'main.dat');
    writeFileSync(mainPath, '.INCLUDE f0.dat\nC ROOT 0 0 0 ! !', 'utf-8');

    for (let i = 0; i < 16; i += 1) {
      const filePath = path.join(outDir, `f${i}.dat`);
      if (i < 15) {
        writeFileSync(filePath, `.INCLUDE f${i + 1}.dat\nC P${i} ${i} ${i} 0 ! !`, 'utf-8');
      } else {
        writeFileSync(filePath, '.INCLUDE f16.dat\nC P15 15 15 0 ! !', 'utf-8');
      }
    }
    writeFileSync(path.join(outDir, 'f16.dat'), 'C P16 16 16 0 ! !', 'utf-8');

    const res = runCli(['--input', mainPath, '--output', 'json']);
    expect(res.status).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(false);

    const depthDiag = (payload.parseState?.includeErrors ?? []).find(
      (entry: { code?: string }) => entry.code === 'include-depth-exceeded',
    ) as
      | {
          code: string;
          sourceFile?: string;
          includePath?: string;
          line?: number;
          message?: string;
        }
      | undefined;
    expect(depthDiag).toBeDefined();
    expect(depthDiag?.sourceFile).toBe(normalizePath(path.join(outDir, 'f14.dat')));
    expect(depthDiag?.line).toBe(1);
    expect(depthDiag?.includePath).toBe('f15.dat');
    expect(depthDiag?.message).toContain('limit=16');
  }, CLI_TEST_TIMEOUT_MS);

  it('hard-fails runs when child-relative include paths cannot be resolved', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-include-rel-missing-'));
    const mainPath = path.join(outDir, 'main.dat');
    const sectionDir = path.join(outDir, 'section');
    mkdirSync(sectionDir, { recursive: true });

    writeFileSync(mainPath, '.INCLUDE section/first.dat\nC ROOT 0 0 0 ! !', 'utf-8');
    writeFileSync(
      path.join(sectionDir, 'first.dat'),
      ['C F1 0 10 0 ! !', '.INCLUDE ../shared/missing.dat', 'C F2 10 10 0', 'D F1-F2 10'].join(
        '\n',
      ),
      'utf-8',
    );

    const res = runCli(['--input', mainPath, '--output', 'json']);
    expect(res.status).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(false);

    const missingDiag = (payload.parseState?.includeErrors ?? []).find(
      (entry: { code?: string; includePath?: string }) =>
        entry.code === 'include-not-found' && entry.includePath === '../shared/missing.dat',
    ) as
      | {
          code: string;
          sourceFile?: string;
          includePath?: string;
          line?: number;
        }
      | undefined;
    expect(missingDiag).toBeDefined();
    expect(missingDiag?.sourceFile).toBe(normalizePath(path.join(sectionDir, 'first.dat')));
    expect(missingDiag?.line).toBe(2);
  }, CLI_TEST_TIMEOUT_MS);

  it('supports coordinate-system CLI flags for Canada-first workflows', () => {
    const res = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'CA_NAD83_CSRS_UTM_19N',
      '--grid-bearing-mode',
      'measured',
      '--grid-distance-mode',
      'ellipsoidal',
      '--grid-angle-mode',
      'grid',
      '--grid-direction-mode',
      'measured',
      '--gnss-vector-frame',
      'unknown',
      '--gnss-frame-confirm',
      'on',
      '--average-geoid-height',
      '28.5',
    ]);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.parseState?.coordSystemMode).toBe('grid');
    expect(payload.parseState?.crsId).toBe('CA_NAD83_CSRS_UTM_19N');
    expect(payload.parseState?.gridBearingMode).toBe('measured');
    expect(payload.parseState?.gridDistanceMode).toBe('ellipsoidal');
    expect(payload.parseState?.gridAngleMode).toBe('grid');
    expect(payload.parseState?.gridDirectionMode).toBe('measured');
    expect(payload.parseState?.gnssVectorFrameDefault).toBe('unknown');
    expect(payload.parseState?.gnssFrameConfirmed).toBe(true);
    expect(payload.parseState?.averageGeoidHeight).toBeCloseTo(28.5, 8);
  }, CLI_TEST_TIMEOUT_MS);

  it('accepts EPSG aliases for --crs-id and normalizes to catalog ids', () => {
    const res = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:2953',
    ]);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.parseState?.coordSystemMode).toBe('grid');
    expect(payload.parseState?.crsId).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');

    const priorityOne = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:3799',
    ]);
    expect(priorityOne.status).toBe(0);
    const priorityOnePayload = JSON.parse(priorityOne.stdout);
    expect(priorityOnePayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityOnePayload.parseState?.crsId).toBe('CA_NAD83_CSRS_QC_LAMBERT');

    const priorityTwoSk = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'CA_NAD83_CSRS_SK_ATS',
    ]);
    expect(priorityTwoSk.status).toBe(0);
    const priorityTwoSkPayload = JSON.parse(priorityTwoSk.stdout);
    expect(priorityTwoSkPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityTwoSkPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_SK_ATS');

    const priorityTwoMb = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'CA_NAD83_CSRS_MB_3TM',
    ]);
    expect(priorityTwoMb.status).toBe(0);
    const priorityTwoMbPayload = JSON.parse(priorityTwoMb.stdout);
    expect(priorityTwoMbPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityTwoMbPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_MB_3TM');

    const priorityThreeNu = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'CA_NAD83_CSRS_NU_STEREOGRAPHIC',
    ]);
    expect(priorityThreeNu.status).toBe(0);
    const priorityThreeNuPayload = JSON.parse(priorityThreeNu.stdout);
    expect(priorityThreeNuPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityThreeNuPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_NU_STEREOGRAPHIC');

    const priorityThreeYt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'CA_NAD83_CSRS_YT_TM',
    ]);
    expect(priorityThreeYt.status).toBe(0);
    const priorityThreeYtPayload = JSON.parse(priorityThreeYt.stdout);
    expect(priorityThreeYtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityThreeYtPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_YT_TM');

    const priorityThreeNt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'CA_NAD83_CSRS_NT_TM',
    ]);
    expect(priorityThreeNt.status).toBe(0);
    const priorityThreeNtPayload = JSON.parse(priorityThreeNt.stdout);
    expect(priorityThreeNtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityThreeNtPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_NT_TM');

    const priorityThreeQc = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6622',
    ]);
    expect(priorityThreeQc.status).toBe(0);
    const priorityThreeQcPayload = JSON.parse(priorityThreeQc.stdout);
    expect(priorityThreeQcPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityThreeQcPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_QC_MUNICIPAL_LCC');

    const priorityFourAbForest = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:3402',
    ]);
    expect(priorityFourAbForest.status).toBe(0);
    const priorityFourAbForestPayload = JSON.parse(priorityFourAbForest.stdout);
    expect(priorityFourAbForestPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityFourAbForestPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_AB_10TM_FOREST');

    const priorityFourYtAlbers = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:3579',
    ]);
    expect(priorityFourYtAlbers.status).toBe(0);
    const priorityFourYtAlbersPayload = JSON.parse(priorityFourYtAlbers.stdout);
    expect(priorityFourYtAlbersPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityFourYtAlbersPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_YT_ALBERS');

    const priorityFourNtLambert = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:3581',
    ]);
    expect(priorityFourNtLambert.status).toBe(0);
    const priorityFourNtLambertPayload = JSON.parse(priorityFourNtLambert.stdout);
    expect(priorityFourNtLambertPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityFourNtLambertPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_NT_LAMBERT');

    const priorityFourCaAtlas = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:3979',
    ]);
    expect(priorityFourCaAtlas.status).toBe(0);
    const priorityFourCaAtlasPayload = JSON.parse(priorityFourCaAtlas.stdout);
    expect(priorityFourCaAtlasPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityFourCaAtlasPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_CA_ATLAS_LAMBERT');

    const priorityFourOnTeranet = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:5321',
    ]);
    expect(priorityFourOnTeranet.status).toBe(0);
    const priorityFourOnTeranetPayload = JSON.parse(priorityFourOnTeranet.stdout);
    expect(priorityFourOnTeranetPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityFourOnTeranetPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_ON_TERANET_LAMBERT');

    const priorityFourArctic = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--run-mode',
      'data-check',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6103',
    ]);
    expect(priorityFourArctic.status).toBe(0);
    const priorityFourArcticPayload = JSON.parse(priorityFourArctic.stdout);
    expect(priorityFourArcticPayload.parseState?.coordSystemMode).toBe('grid');
    expect(priorityFourArcticPayload.parseState?.crsId).toBe('CA_NAD83_CSRS_ARCTIC_LCC_3_29');

    const usNyEast = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_NY_EAST',
    ]);
    expect(usNyEast.status).toBe(0);
    const usNyEastPayload = JSON.parse(usNyEast.stdout);
    expect(usNyEastPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usNyEastPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_NY_EAST');

    const usCa3 = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6419',
    ]);
    expect(usCa3.status).toBe(0);
    const usCa3Payload = JSON.parse(usCa3.stdout);
    expect(usCa3Payload.parseState?.coordSystemMode).toBe('grid');
    expect(usCa3Payload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_CA_ZONE_3');

    const usNyEastFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6537',
    ]);
    expect(usNyEastFt.status).toBe(0);
    const usNyEastFtPayload = JSON.parse(usNyEastFt.stdout);
    expect(usNyEastFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usNyEastFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_NY_EAST_FTUS');

    const usPaSouthFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6565',
    ]);
    expect(usPaSouthFt.status).toBe(0);
    const usPaSouthFtPayload = JSON.parse(usPaSouthFt.stdout);
    expect(usPaSouthFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usPaSouthFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_PA_SOUTH_FTUS');

    const usCa6 = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_CA_ZONE_6',
    ]);
    expect(usCa6.status).toBe(0);
    const usCa6Payload = JSON.parse(usCa6.stdout);
    expect(usCa6Payload.parseState?.coordSystemMode).toBe('grid');
    expect(usCa6Payload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_CA_ZONE_6');

    const usCa6Ft = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6426',
    ]);
    expect(usCa6Ft.status).toBe(0);
    const usCa6FtPayload = JSON.parse(usCa6Ft.stdout);
    expect(usCa6FtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usCa6FtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_CA_ZONE_6_FTUS');

    const usTxNorthCentral = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_TX_NORTH_CENTRAL',
    ]);
    expect(usTxNorthCentral.status).toBe(0);
    const usTxNorthCentralPayload = JSON.parse(usTxNorthCentral.stdout);
    expect(usTxNorthCentralPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usTxNorthCentralPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_TX_NORTH_CENTRAL');

    const usTxSouthCentralFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6588',
    ]);
    expect(usTxSouthCentralFt.status).toBe(0);
    const usTxSouthCentralFtPayload = JSON.parse(usTxSouthCentralFt.stdout);
    expect(usTxSouthCentralFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usTxSouthCentralFtPayload.parseState?.crsId).toBe(
      'US_NAD83_2011_SPCS_TX_SOUTH_CENTRAL_FTUS',
    );

    const usFlNorth = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_FL_NORTH',
    ]);
    expect(usFlNorth.status).toBe(0);
    const usFlNorthPayload = JSON.parse(usFlNorth.stdout);
    expect(usFlNorthPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usFlNorthPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_FL_NORTH');

    const usFlEastFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6438',
    ]);
    expect(usFlEastFt.status).toBe(0);
    const usFlEastFtPayload = JSON.parse(usFlEastFt.stdout);
    expect(usFlEastFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usFlEastFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_FL_EAST_FTUS');

    const usGaEast = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_GA_EAST',
    ]);
    expect(usGaEast.status).toBe(0);
    const usGaEastPayload = JSON.parse(usGaEast.stdout);
    expect(usGaEastPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usGaEastPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_GA_EAST');

    const usGaWestFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6447',
    ]);
    expect(usGaWestFt.status).toBe(0);
    const usGaWestFtPayload = JSON.parse(usGaWestFt.stdout);
    expect(usGaWestFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usGaWestFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_GA_WEST_FTUS');

    const usNc = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_NC',
    ]);
    expect(usNc.status).toBe(0);
    const usNcPayload = JSON.parse(usNc.stdout);
    expect(usNcPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usNcPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_NC');

    const usAlWestFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:9749',
    ]);
    expect(usAlWestFt.status).toBe(0);
    const usAlWestFtPayload = JSON.parse(usAlWestFt.stdout);
    expect(usAlWestFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usAlWestFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_AL_WEST_FTUS');

    const usTn = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_TN',
    ]);
    expect(usTn.status).toBe(0);
    const usTnPayload = JSON.parse(usTn.stdout);
    expect(usTnPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usTnPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_TN');

    const usKySouthFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6475',
    ]);
    expect(usKySouthFt.status).toBe(0);
    const usKySouthFtPayload = JSON.parse(usKySouthFt.stdout);
    expect(usKySouthFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usKySouthFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_KY_SOUTH_FTUS');

    const usRi = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_RI',
    ]);
    expect(usRi.status).toBe(0);
    const usRiPayload = JSON.parse(usRi.stdout);
    expect(usRiPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usRiPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_RI');

    const usSdSouthFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6574',
    ]);
    expect(usSdSouthFt.status).toBe(0);
    const usSdSouthFtPayload = JSON.parse(usSdSouthFt.stdout);
    expect(usSdSouthFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usSdSouthFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_SD_SOUTH_FTUS');

    const usVt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_VT',
    ]);
    expect(usVt.status).toBe(0);
    const usVtPayload = JSON.parse(usVt.stdout);
    expect(usVtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usVtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_VT');

    const usWaSouthFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6599',
    ]);
    expect(usWaSouthFt.status).toBe(0);
    const usWaSouthFtPayload = JSON.parse(usWaSouthFt.stdout);
    expect(usWaSouthFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usWaSouthFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_WA_SOUTH_FTUS');

    const usWvNorth = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_WV_NORTH',
    ]);
    expect(usWvNorth.status).toBe(0);
    const usWvNorthPayload = JSON.parse(usWvNorth.stdout);
    expect(usWvNorthPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usWvNorthPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_WV_NORTH');

    const usWyWestCentralFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6618',
    ]);
    expect(usWyWestCentralFt.status).toBe(0);
    const usWyWestCentralFtPayload = JSON.parse(usWyWestCentralFt.stdout);
    expect(usWyWestCentralFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usWyWestCentralFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_WY_WEST_CENTRAL_FTUS');

    const usUtNorth = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_UT_NORTH',
    ]);
    expect(usUtNorth.status).toBe(0);
    const usUtNorthPayload = JSON.parse(usUtNorth.stdout);
    expect(usUtNorthPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usUtNorthPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_UT_NORTH');

    const usUtSouthFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6627',
    ]);
    expect(usUtSouthFt.status).toBe(0);
    const usUtSouthFtPayload = JSON.parse(usUtSouthFt.stdout);
    expect(usUtSouthFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usUtSouthFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_UT_SOUTH_FTUS');

    const usCoNorth = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_CO_NORTH',
    ]);
    expect(usCoNorth.status).toBe(0);
    const usCoNorthPayload = JSON.parse(usCoNorth.stdout);
    expect(usCoNorthPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usCoNorthPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_CO_NORTH');

    const usCoSouthFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6432',
    ]);
    expect(usCoSouthFt.status).toBe(0);
    const usCoSouthFtPayload = JSON.parse(usCoSouthFt.stdout);
    expect(usCoSouthFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usCoSouthFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_CO_SOUTH_FTUS');

    const usCt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_CT',
    ]);
    expect(usCt.status).toBe(0);
    const usCtPayload = JSON.parse(usCt.stdout);
    expect(usCtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usCtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_CT');

    const usDeFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6436',
    ]);
    expect(usDeFt.status).toBe(0);
    const usDeFtPayload = JSON.parse(usDeFt.stdout);
    expect(usDeFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usDeFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_DE_FTUS');

    const usKsNorth = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_KS_NORTH',
    ]);
    expect(usKsNorth.status).toBe(0);
    const usKsNorthPayload = JSON.parse(usKsNorth.stdout);
    expect(usKsNorthPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usKsNorthPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_KS_NORTH');

    const usKsSouthFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6469',
    ]);
    expect(usKsSouthFt.status).toBe(0);
    const usKsSouthFtPayload = JSON.parse(usKsSouthFt.stdout);
    expect(usKsSouthFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usKsSouthFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_KS_SOUTH_FTUS');

    const usLaNorth = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_LA_NORTH',
    ]);
    expect(usLaNorth.status).toBe(0);
    const usLaNorthPayload = JSON.parse(usLaNorth.stdout);
    expect(usLaNorthPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usLaNorthPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_LA_NORTH');

    const usLaSouthFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6479',
    ]);
    expect(usLaSouthFt.status).toBe(0);
    const usLaSouthFtPayload = JSON.parse(usLaSouthFt.stdout);
    expect(usLaSouthFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usLaSouthFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_LA_SOUTH_FTUS');

    const usMeEast = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_ME_EAST',
    ]);
    expect(usMeEast.status).toBe(0);
    const usMeEastPayload = JSON.parse(usMeEast.stdout);
    expect(usMeEastPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usMeEastPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_ME_EAST');

    const usMeWestFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6486',
    ]);
    expect(usMeWestFt.status).toBe(0);
    const usMeWestFtPayload = JSON.parse(usMeWestFt.stdout);
    expect(usMeWestFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usMeWestFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_ME_WEST_FTUS');

    const usMd = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_MD',
    ]);
    expect(usMd.status).toBe(0);
    const usMdPayload = JSON.parse(usMd.stdout);
    expect(usMdPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usMdPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_MD');

    const usMaMainlandFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6492',
    ]);
    expect(usMaMainlandFt.status).toBe(0);
    const usMaMainlandFtPayload = JSON.parse(usMaMainlandFt.stdout);
    expect(usMaMainlandFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usMaMainlandFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_MA_MAINLAND_FTUS');

    const usMnCentral = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_MN_CENTRAL',
    ]);
    expect(usMnCentral.status).toBe(0);
    const usMnCentralPayload = JSON.parse(usMnCentral.stdout);
    expect(usMnCentralPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usMnCentralPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_MN_CENTRAL');

    const usMnSouthFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6505',
    ]);
    expect(usMnSouthFt.status).toBe(0);
    const usMnSouthFtPayload = JSON.parse(usMnSouthFt.stdout);
    expect(usMnSouthFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usMnSouthFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_MN_SOUTH_FTUS');

    const usIlEast = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_IL_EAST',
    ]);
    expect(usIlEast.status).toBe(0);
    const usIlEastPayload = JSON.parse(usIlEast.stdout);
    expect(usIlEastPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usIlEastPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_IL_EAST');

    const usInWestFt = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6461',
    ]);
    expect(usInWestFt.status).toBe(0);
    const usInWestFtPayload = JSON.parse(usInWestFt.stdout);
    expect(usInWestFtPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usInWestFtPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_IN_WEST_FTUS');

    const usMsTm = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'US_NAD83_2011_SPCS_MS_TM',
    ]);
    expect(usMsTm.status).toBe(0);
    const usMsTmPayload = JSON.parse(usMsTm.stdout);
    expect(usMsTmPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usMsTmPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_MS_TM');

    const usMoWest = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--coord-system-mode',
      'grid',
      '--crs-id',
      'EPSG:6513',
    ]);
    expect(usMoWest.status).toBe(0);
    const usMoWestPayload = JSON.parse(usMoWest.stdout);
    expect(usMoWestPayload.parseState?.coordSystemMode).toBe('grid');
    expect(usMoWestPayload.parseState?.crsId).toBe('US_NAD83_2011_SPCS_MO_WEST');
  }, 90000);

  it('supports parse mode and geoid source CLI options', () => {
    const res = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--parse-mode',
      'strict',
      '--geoid-model-id',
      'NGS-DEMO',
      '--geoid-interpolation',
      'nearest',
      '--geoid-source-format',
      'gtx',
      '--geoid-source-path',
      GEOID_GTX_INPUT,
    ]);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.parseState?.parseCompatibilityMode).toBe('strict');
    expect(payload.parseState?.parseModeMigrated).toBe(true);
    expect(payload.parseState?.geoidModelEnabled).toBe(true);
    expect(payload.parseState?.geoidModelId).toBe('NGS-DEMO');
    expect(payload.parseState?.geoidInterpolation).toBe('nearest');
    expect(payload.parseState?.geoidSourceFormat).toBe('gtx');
    expect(payload.parseState?.geoidSourcePath).toBe(GEOID_GTX_INPUT);
    expect(payload.parseState?.geoidSourceResolvedFormat).toBe('gtx');
    expect(payload.parseState?.geoidSourceFallbackUsed).toBe(false);
  }, CLI_TEST_TIMEOUT_MS);
});
