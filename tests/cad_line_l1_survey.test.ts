import { describe, expect, it } from 'vitest';
import {
  resolveCadLinePointByStationId,
  resolveCadLinePointChain,
  resolveCadLineSideShots,
  resolveCadLineStationOffsetPoint,
} from '../src/engine/cad/cadLineSurveyResolvers';
import type { CadAlignmentElement } from '../src/engine/cad/cadTypes';
import { buildCadLineL1Project, buildCadLineL1SurveyPoint } from './cadLineL1TestSupport';

const okValue = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
};

const projectWithPoints = (stationIds: string[]) =>
  buildCadLineL1Project({
    entities: stationIds.map((stationId) => buildCadLineL1SurveyPoint(stationId, Number(stationId), Number(stationId))),
  });

describe('L1 station point chains', () => {
  it('resolves every id of a mixed range atomically', () => {
    const chain = okValue(resolveCadLinePointChain(projectWithPoints(['1', '2', '3', '7', '8', '9', '10']), '1-3,7,10-8'));
    expect(chain.map((point) => point.label)).toEqual(['1', '2', '3', '7', '10', '9', '8']);
  });

  it('fails the whole request when any station is missing', () => {
    expect(resolveCadLinePointChain(projectWithPoints(['1', '2', '3']), '1-3,7')).toMatchObject({
      ok: false,
      error: { code: 'POINT_NOT_FOUND' },
    });
  });

  it('stays exact-only (no case-insensitive fallback) and fails on duplicates', () => {
    const upper = buildCadLineL1Project({ entities: [buildCadLineL1SurveyPoint('A', 1, 1)] });
    expect(resolveCadLinePointByStationId(upper, 'a')).toMatchObject({ ok: false, error: { code: 'POINT_NOT_FOUND' } });
    const duplicated = buildCadLineL1Project({
      entities: [buildCadLineL1SurveyPoint('1', 0, 0), buildCadLineL1SurveyPoint('1', 5, 5)],
    });
    expect(resolveCadLinePointByStationId(duplicated, '1')).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS_POINT' },
    });
  });
});

describe('L1 station/offset oracle', () => {
  const line: CadAlignmentElement[] = [{ kind: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }];

  it('maps signed offset using the left-positive convention', () => {
    expect(okValue(resolveCadLineStationOffsetPoint(line, { station: 50, offset: 5 }))).toEqual({ x: 50, y: 5 });
    expect(okValue(resolveCadLineStationOffsetPoint(line, { station: 50, offset: -5 }))).toEqual({ x: 50, y: -5 });
  });

  it('honours station equations via the display/raw mapping', () => {
    const alignment = {
      elements: line,
      startStation: 0,
      stationEquations: [{ backStation: 50, aheadStation: 100, rawStation: 50 }],
    };
    expect(okValue(resolveCadLineStationOffsetPoint(alignment, { station: 120, offset: 0 }))).toEqual({ x: 70, y: 0 });
    expect(resolveCadLineStationOffsetPoint(alignment, { station: 60, offset: 0 })).toMatchObject({
      ok: false,
      error: { code: 'OUT_OF_RANGE' },
    });
  });

  it('rejects stations outside the alignment range', () => {
    expect(resolveCadLineStationOffsetPoint(line, { station: 200, offset: 0 })).toMatchObject({
      ok: false,
      error: { code: 'OUT_OF_RANGE' },
    });
  });
});

describe('L1 fixed-origin side shots', () => {
  it('fires every shot from the fixed occupy, never chained', () => {
    const points = okValue(
      resolveCadLineSideShots(
        { occupy: { x: 0, y: 0 }, referencePoint: { x: 0, y: 10 } },
        [
          { mode: 'bearing', bearing: 'N90E', distance: 10 },
          { mode: 'azimuth', azimuthDeg: 180, distance: 5 },
          { mode: 'turn', side: 'right', angleDeg: 90, distance: 10 },
          { mode: 'deflection', side: 'right', angleDeg: 90, distance: 10 },
        ],
      ),
    );
    expect(points[0].x).toBeCloseTo(10, 9);
    expect(points[0].y).toBeCloseTo(0, 9);
    expect(points[1].x).toBeCloseTo(0, 9);
    expect(points[1].y).toBeCloseTo(-5, 9);
    expect(points[2].x).toBeCloseTo(10, 9);
    expect(points[2].y).toBeCloseTo(0, 9);
    expect(points[3].x).toBeCloseTo(-10, 9);
    expect(points[3].y).toBeCloseTo(0, 9);
  });

  it('requires a reference direction for turn/deflection', () => {
    expect(
      resolveCadLineSideShots({ occupy: { x: 0, y: 0 } }, [{ mode: 'turn', side: 'left', angleDeg: 30, distance: 5 }]),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});
