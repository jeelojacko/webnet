import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CLI_TEST_TIMEOUT_MS,
  GEOID_GTX_INPUT,
  PREANALYSIS_INPUT,
  runCli,
  STABLE_INPUT,
} from './cliPhase2OutputTestSupport';

describe('CLI phase 2 output modes', () => {
  it('emits machine-readable JSON payloads', () => {
    const res = runCli(['--input', STABLE_INPUT, '--output', 'json'], 120000);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(true);
    expect(payload.converged).toBe(true);
    expect(payload.stationCount).toBeGreaterThan(0);
    expect(payload.observationCount).toBeGreaterThan(0);
  }, 120000);

  it('writes industry-style listing output to file', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-'));
    const outPath = path.join(outDir, 'listing.txt');
    const res = runCli(['--input', STABLE_INPUT, '--output', 'listing', '--out', outPath], 60000);
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
    const cases = [
      { crsId: 'EPSG:2953', expected: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE' },
      { crsId: 'EPSG:3799', expected: 'CA_NAD83_CSRS_QC_LAMBERT' },
      { crsId: 'EPSG:6103', expected: 'CA_NAD83_CSRS_ARCTIC_LCC_3_29', runMode: 'data-check' },
      { crsId: 'EPSG:6419', expected: 'US_NAD83_2011_SPCS_CA_ZONE_3' },
      { crsId: 'EPSG:6537', expected: 'US_NAD83_2011_SPCS_NY_EAST_FTUS' },
      { crsId: 'US_NAD83_2011_SPCS_OR_NORTH', expected: 'US_NAD83_2011_SPCS_OR_NORTH' },
    ];

    cases.forEach(({ crsId, expected, runMode }) => {
      const args = [
        '--input',
        STABLE_INPUT,
        '--output',
        'json',
        '--coord-system-mode',
        'grid',
      ];
      if (runMode) {
        args.push('--run-mode', runMode);
      }
      args.push('--crs-id', crsId);
      const res = runCli(args, 120000);
      expect(res.status).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload.parseState?.coordSystemMode).toBe('grid');
      expect(payload.parseState?.crsId).toBe(expected);
    });
  }, 120000);

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
