import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { getExternalImporters } from '../src/engine/importers';
import { importExternalInput, parseOpusReport } from '../src/engine/opus';
import { parseInput } from '../src/engine/parse';

const fixture = readFileSync('tests/fixtures/opus_rs_sample.txt', 'utf-8');
const fixtureWithCorrelation = `${fixture}\nE/N CORRELATION: -0.2500\n`;
const opusFixture = readFileSync('tests/fixtures/opus_sample.txt', 'utf-8');

describe('OPUS import', () => {
  it('registers OPUS as a generic external importer', () => {
    expect(getExternalImporters().map((importer) => importer.id)).toContain('opus-report');
  });

  it('parses OPUS-RS report coordinates, sigmas, and metadata', () => {
    const parsed = parseOpusReport(fixture, 'opus_rs_sample.txt');
    expect(parsed).not.toBeNull();
    expect(parsed?.stationId).toBe('NOVA0010');
    expect(parsed?.metadata.solutionType).toBe('opus-rs');
    expect(parsed?.metadata.referenceFrame).toContain('NAD_83(2011)');
    expect(parsed?.metadata.referenceEpoch).toBe('2024.1234');
    expect(parsed?.metadata.geoidModel).toBe('GEOID18');
    expect(parsed?.latitudeDeg).toBeCloseTo(44.6534293528, 9);
    expect(parsed?.longitudeDeg).toBeCloseTo(-63.5824413917, 9);
    expect(parsed?.ellipsoidHeightM).toBeCloseTo(123.456, 6);
    expect(parsed?.orthometricHeightM).toBeCloseTo(98.765, 6);
    expect(parsed?.sigmaNorthM).toBeCloseTo(0.008, 6);
    expect(parsed?.sigmaEastM).toBeCloseTo(0.01, 6);
    expect(parsed?.sigmaEllipsoidHeightM).toBeCloseTo(0.015, 6);
    expect(parsed?.covariance.corrEN).toBe(0);
    expect(parsed?.covariance.source).toBe('report-diagonal');
  });

  it('converts OPUS reports into a WebNet PH record that the parser accepts', () => {
    const imported = importExternalInput(fixture, 'opus_rs_sample.txt');
    expect(imported.detected).toBe(true);
    expect(imported.format).toBe('external-import');
    expect(imported.importerId).toBe('opus-report');
    expect(imported.notice?.title).toBe('Imported OPUS-RS report');
    expect(imported.dataset?.controlStations).toHaveLength(1);
    expect(imported.text).toContain('# Imported from NGS OPUS-RS solution report');
    expect(imported.text).toContain(
      'PH NOVA0010 44.653429353 -63.582441392 123.4560 0.0080 0.0100 0.0150 0.0000',
    );

    const parsed = parseInput(imported.text);
    expect(parsed.stations.NOVA0010).toBeDefined();
    expect(parsed.stations.NOVA0010.heightType).toBe('ellipsoid');
    expect(parsed.stations.NOVA0010.latDeg).toBeCloseTo(44.653429353, 9);
    expect(parsed.stations.NOVA0010.lonDeg).toBeCloseTo(-63.582441392, 9);
    expect(parsed.stations.NOVA0010.h).toBeCloseTo(123.456, 6);
    expect(parsed.stations.NOVA0010.sy).toBeCloseTo(0.008, 6);
    expect(parsed.stations.NOVA0010.sx).toBeCloseTo(0.01, 6);
    expect(parsed.stations.NOVA0010.sh).toBeCloseTo(0.015, 6);
    expect(parsed.stations.NOVA0010.constraintCorrXY).toBeCloseTo(0, 8);
  });

  it('carries imported EN correlation into the generated control record', () => {
    const parsedReport = parseOpusReport(fixtureWithCorrelation, 'opus_rs_corr_sample.txt');
    expect(parsedReport?.covariance.corrEN).toBeCloseTo(-0.25, 8);
    expect(parsedReport?.covariance.source).toBe('report-correlation');

    const imported = importExternalInput(fixtureWithCorrelation, 'opus_rs_corr_sample.txt');
    expect(imported.text).toContain(
      'PH NOVA0010 44.653429353 -63.582441392 123.4560 0.0080 0.0100 0.0150 -0.2500',
    );

    const parsed = parseInput(imported.text);
    expect(parsed.stations.NOVA0010.constraintCorrXY).toBeCloseTo(-0.25, 8);
  });

  it('supports representative non-RS OPUS reports and converts orthometric-only control into P records', () => {
    const parsed = parseOpusReport(opusFixture, 'opus_sample.txt');
    expect(parsed).not.toBeNull();
    expect(parsed?.stationId).toBe('ALPHA123');
    expect(parsed?.metadata.solutionType).toBe('opus');
    expect(parsed?.metadata.referenceFrame).toContain('ITRF2020');
    expect(parsed?.latitudeDeg).toBeCloseTo(35.2096021917, 9);
    expect(parsed?.longitudeDeg).toBeCloseTo(-80.7534293528, 9);
    expect(parsed?.ellipsoidHeightM).toBeUndefined();
    expect(parsed?.orthometricHeightM).toBeCloseTo(250.123, 6);
    expect(parsed?.sigmaOrthometricHeightM).toBeCloseTo(0.021, 6);
    expect(parsed?.covariance.corrEN).toBeCloseTo(0.125, 8);

    const imported = importExternalInput(opusFixture, 'opus_sample.txt');
    expect(imported.summary).toContain('Imported OPUS report as ALPHA123');
    expect(imported.notice?.detailLines[0]).toContain(
      'Station ALPHA123 converted to P control input',
    );
    expect(imported.text).toContain(
      'P ALPHA123 35.209602192 -80.753429353 250.1230 0.0120 0.0140 0.0210 0.1250',
    );

    const parsedInput = parseInput(imported.text);
    expect(parsedInput.stations.ALPHA123.heightType).toBe('orthometric');
    expect(parsedInput.stations.ALPHA123.constraintCorrXY).toBeCloseTo(0.125, 8);
  });
});
