import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { RAD_TO_DEG, dmsToRad } from '../src/engine/angles';
import { importExternalInput } from '../src/engine/importers';
import { buildImportReviewModel, buildImportReviewText } from '../src/engine/importReview';

const trimmedJobXmlFixture = readFileSync(
  'tests/fixtures/jobxml_industry_style_trimmed_260215.jxl',
  'utf-8',
);
const trimmedReferenceBlocks = readFileSync(
  'tests/fixtures/jobxml_industry_style_trimmed_260215_expected_blocks.txt',
  'utf-8',
);

type ParsedDmLine = {
  targetId: string;
  hzDeg: number;
  distanceM: number;
  zenithDeg: number;
  hiM: number;
  htM: number;
};

const parseDmsDeg = (value: string): number => dmsToRad(value) * RAD_TO_DEG;

const parseDirectionBlocks = (text: string): ParsedDmLine[][] => {
  const blocks: ParsedDmLine[][] = [];
  let current: ParsedDmLine[] | null = null;

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith('DB ')) {
      current = [];
      blocks.push(current);
      return;
    }
    if (line === 'DE') {
      current = null;
      return;
    }
    if (!line.startsWith('DM ') || !current) return;

    const tokens = line.split(/\s+/);
    const hiHtToken = tokens[5] ?? '0/0';
    const [hiM, htM] = hiHtToken.split('/').map((value) => Number.parseFloat(value));
    current.push({
      targetId: tokens[1] ?? '',
      hzDeg: parseDmsDeg(tokens[2] ?? '000-00-00.0'),
      distanceM: Number.parseFloat(tokens[3] ?? '0'),
      zenithDeg: parseDmsDeg(tokens[4] ?? '000-00-00.0'),
      hiM,
      htM,
    });
  });

  return blocks;
};

const expectDirectionBlockValuesClose = (
  actual: ParsedDmLine[][],
  expected: ParsedDmLine[][],
): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((actualBlock, blockIndex) => {
    const expectedBlock = expected[blockIndex] ?? [];
    expect(actualBlock).toHaveLength(expectedBlock.length);
    actualBlock.forEach((actualLine, lineIndex) => {
      const expectedLine = expectedBlock[lineIndex]!;
      expect(actualLine.distanceM).toBeCloseTo(expectedLine.distanceM, 4);
      expect(actualLine.zenithDeg).toBeCloseTo(expectedLine.zenithDeg, 4);
      expect(actualLine.hiM).toBeCloseTo(expectedLine.hiM, 3);
      expect(actualLine.htM).toBeCloseTo(expectedLine.htM, 3);
      expect(Math.abs(actualLine.hzDeg - expectedLine.hzDeg)).toBeLessThanOrEqual(0.05 / 3600);
    });
  });
};

describe('JobXML industry-style import fidelity', () => {
  it('preserves JobXML raw fieldbook metadata and corrected slope distances on imported observations', () => {
    const imported = importExternalInput(trimmedJobXmlFixture, '260215 TRAVERSE.jxl', {
      angleMode: 'reduced',
    });
    const observations = imported.dataset?.observations ?? [];
    const firstRoundTarget = observations.find(
      (observation) =>
        observation.kind === 'measurement' &&
        observation.toId === '102' &&
        observation.jobXml?.round === 1 &&
        observation.jobXml?.isDirectReading === true &&
        observation.jobXml?.rawHorizontalCircleDeg === 260.6505192,
    );
    const preRoundMta = observations.find(
      (observation) =>
        observation.kind === 'measurement' && observation.jobXml?.isMta === true,
    );

    expect(imported.dataset?.controlStations).toHaveLength(4);
    expect(observations).toHaveLength(21);
    expect(firstRoundTarget?.kind).toBe('measurement');
    if (!firstRoundTarget || firstRoundTarget.kind !== 'measurement') {
      throw new Error('expected measurement observation for round 1 target 102');
    }
    expect(firstRoundTarget.distanceM).toBeCloseTo(154.7935, 4);
    expect(firstRoundTarget.angleDeg).toBeCloseTo(260.6505192, 6);
    expect(firstRoundTarget.jobXml?.stationRecordRef).toBe('00000030');
    expect(firstRoundTarget.jobXml?.backBearingRecordRef).toBe('00000043');
    expect(firstRoundTarget.jobXml?.targetRecordRef).toBe('0000004e');
    expect(firstRoundTarget.jobXml?.atmosphereRecordRef).toBe('0000002f');
    expect(firstRoundTarget.jobXml?.round).toBe(1);
    expect(firstRoundTarget.jobXml?.observationOrder).toBe(4);
    expect(firstRoundTarget.jobXml?.directionSetId).toBe('00000030::00000043::1');
    expect(firstRoundTarget.jobXml?.isDirectReading).toBe(true);
    expect(firstRoundTarget.jobXml?.isMta).toBe(false);
    expect(firstRoundTarget.jobXml?.isBacksight).toBe(false);
    expect(firstRoundTarget.jobXml?.rawHorizontalCircleDeg).toBeCloseTo(260.6505192, 8);
    expect(firstRoundTarget.jobXml?.reducedAngleDeg).toBeCloseTo(260.6505192, 8);
    expect(firstRoundTarget.jobXml?.backsightCircleDeg).toBe(0);
    expect(firstRoundTarget.jobXml?.backsightFace1CircleDeg).toBe(0);
    expect(firstRoundTarget.jobXml?.backsightFace2CircleDeg).toBeCloseTo(180.0025965, 8);
    expect(firstRoundTarget.jobXml?.rawVerticalCircleDeg).toBeCloseTo(90.9680796, 8);
    expect(firstRoundTarget.jobXml?.rawEdmDistanceM).toBeCloseTo(154.81087, 8);
    expect(firstRoundTarget.jobXml?.correctedSlopeDistanceM).toBeCloseTo(154.7935210148134, 10);
    expect(firstRoundTarget.jobXml?.prismConstantM).toBeCloseTo(-0.0169, 8);
    expect(firstRoundTarget.jobXml?.ppm).toBeCloseTo(-2.9002174499703, 12);
    expect(firstRoundTarget.description).toBe('TH CN');
    expect(firstRoundTarget.jobXml?.pointCode).toBe('TH CN');
    expect(firstRoundTarget.jobXml?.targetCode).toBe('TH CN');
    expect(firstRoundTarget.jobXml?.observationHiM).toBeUndefined();
    expect(firstRoundTarget.jobXml?.setupHiM).toBeCloseTo(1.7023212101114, 10);
    expect(firstRoundTarget.jobXml?.effectiveHiM).toBeCloseTo(1.7023212101114, 10);
    expect(firstRoundTarget.jobXml?.hiSource).toBe('setup');
    expect(firstRoundTarget.jobXml?.observationHtM).toBeUndefined();
    expect(firstRoundTarget.jobXml?.targetHtM).toBeCloseTo(0.178, 8);
    expect(firstRoundTarget.jobXml?.effectiveHtM).toBeCloseTo(0.178, 8);
    expect(firstRoundTarget.jobXml?.htSource).toBe('target');
    expect(preRoundMta?.jobXml?.isMta).toBe(true);
    expect(preRoundMta?.jobXml?.round).toBeUndefined();
  });

  it('emits opt-in industry-style DB/DM/DE blocks with raw HZ, corrected slope distance, raw zenith, and round grouping', () => {
    const imported = importExternalInput(trimmedJobXmlFixture, '260215 TRAVERSE.jxl', {
      angleMode: 'reduced',
    });
    const reviewModel = buildImportReviewModel(imported.dataset!);
    const text = buildImportReviewText(imported.dataset!, reviewModel, {
      includedItemIds: new Set(reviewModel.items.map((item) => item.id)),
      groupComments: Object.fromEntries(reviewModel.groups.map((group) => [group.key, group.defaultComment])),
      preset: 'industry-style',
    });
    const actualBlocks = parseDirectionBlocks(text);
    const expectedBlocks = parseDirectionBlocks(trimmedReferenceBlocks);

    expect(text).toContain('.ORDER NE');
    expect(text).toContain("'RS1");
    expect(text).toContain("'TH CN");
    expect(text).toContain("'BP LP");
    expect(text).toContain('DM 101 000-00-00.0 42.1940 081-18-56.7 1.702/0.120');
    expect(text).toContain('DM 102 260-39-01.9 154.7935 090-58-05.1 1.702/0.178');
    expect(text).toContain('DM 200 071-55-41.9 63.0662 269-02-54.8 1.702/0.000');
    expect(text).not.toContain('# FACE 1');
    expect(text).not.toContain('# FACE 2');
    expect(text).not.toContain("'BackSight");
    expect(text).not.toContain("'Normal");
    expect(text).not.toContain('42.2285');
    expect(actualBlocks.map((block) => block.map((line) => line.targetId))).toEqual([
      ['101', '101', '102', '102', '200', '200'],
      ['200', '200', '102', '102', '101', '101'],
      ['101', '101', '102', '102', '200', '200'],
    ]);
    expectDirectionBlockValuesClose(actualBlocks, expectedBlocks);
  });

  it('keeps existing generic direction-set behavior when industry-style mode is not selected', () => {
    const imported = importExternalInput(trimmedJobXmlFixture, '260215 TRAVERSE.jxl', {
      angleMode: 'reduced',
    });
    const reviewModel = buildImportReviewModel(imported.dataset!);
    const text = buildImportReviewText(imported.dataset!, reviewModel, {
      includedItemIds: new Set(reviewModel.items.map((item) => item.id)),
      groupComments: Object.fromEntries(reviewModel.groups.map((group) => [group.key, group.defaultComment])),
      preset: 'ts-direction-set',
      faceNormalizationMode: 'off',
    });

    expect(text).toContain('.2D');
    expect(text).toContain('.ORDER EN');
    expect(text).toContain('# FACE 1');
    expect(text).toContain('# FACE 2');
    expect(text).toContain('DM 102 260-38-54.1 154.7927');
    expect(text).toContain('DM 102 260-39-01.9 154.7935');
  });
});
