import { describe, expect, it } from 'vitest';
import { inverseGrid, projectGrid } from '../src/engine/geodesyProjection';
import {
  CAD_LINE_NO_GRID_CONTEXT_MESSAGE,
  resolveCadLineCoordinateContext,
  resolveCadLineGridNePoint,
  resolveCadLineLatLongPoint,
} from '../src/engine/cad/cadLineCoordinateContext';
import { buildCadLineL1Project } from './cadLineL1TestSupport';

const CRS_ID = 'CA_NAD83_CSRS_UTM_20N';

describe('L1 coordinate context seam', () => {
  it('fails closed without an authoritative drawing grid context', () => {
    const project = buildCadLineL1Project();
    expect(resolveCadLineCoordinateContext(project)).toBeNull();
    const grid = resolveCadLineGridNePoint(project, { east: 500000, north: 5000000 });
    expect(grid).toMatchObject({ ok: false, error: { code: 'NO_DRAWING_GRID_CONTEXT' } });
    if (!grid.ok) expect(grid.error.message).toContain(CAD_LINE_NO_GRID_CONTEXT_MESSAGE);
    expect(resolveCadLineLatLongPoint(project, { latitudeDeg: 45, longitudeDeg: -75 })).toMatchObject({
      ok: false,
      error: { code: 'NO_DRAWING_GRID_CONTEXT' },
    });
  });

  it('resolves GRID_NE directly and LATLONG through the drawing CRS', () => {
    const project = buildCadLineL1Project({ coordinateContext: { crsId: CRS_ID } });
    expect(resolveCadLineCoordinateContext(project)).toEqual({ crsId: CRS_ID, crsLabel: null });

    const grid = resolveCadLineGridNePoint(project, { east: -445748.66307161, north: 5053500.026238931 });
    expect(grid.ok).toBe(true);
    if (grid.ok) expect(grid.value).toEqual({ x: -445748.66307161, y: 5053500.026238931 });

    const latLong = resolveCadLineLatLongPoint(project, { latitudeDeg: 45, longitudeDeg: -75 });
    const expected = projectGrid(45, -75, CRS_ID)!;
    expect(latLong.ok).toBe(true);
    if (latLong.ok) {
      expect(latLong.value.x).toBeCloseTo(expected.east, 6);
      expect(latLong.value.y).toBeCloseTo(expected.north, 6);
      const inverse = inverseGrid(latLong.value.x, latLong.value.y, CRS_ID);
      if (!('failureReason' in inverse)) {
        expect(inverse.latDeg).toBeCloseTo(45, 6);
        expect(inverse.lonDeg).toBeCloseTo(-75, 6);
      } else {
        throw new Error('round-trip inverse failed');
      }
    }
  });

  it('rejects unusable CRS ids and out-of-range latitude', () => {
    const bogus = buildCadLineL1Project({ coordinateContext: { crsId: 'EPSG:999999' } });
    expect(resolveCadLineGridNePoint(bogus, { east: 1, north: 2 })).toMatchObject({
      ok: false,
      error: { code: 'GRID_NE_OUT_OF_CRS' },
    });
    expect(resolveCadLineLatLongPoint(bogus, { latitudeDeg: 45, longitudeDeg: -75 })).toMatchObject({
      ok: false,
      error: { code: 'CRS_TRANSFORM_FAILED' },
    });
    const valid = buildCadLineL1Project({ coordinateContext: { crsId: CRS_ID } });
    expect(resolveCadLineLatLongPoint(valid, { latitudeDeg: 91, longitudeDeg: 0 })).toMatchObject({
      ok: false,
      error: { code: 'LATLONG_OUT_OF_RANGE' },
    });
  });

  it('never mutates the drawing coordinate context as a side effect', () => {
    const project = buildCadLineL1Project({ coordinateContext: { crsId: CRS_ID, crsLabel: 'UTM 20N' } });
    const before = JSON.stringify(project);
    resolveCadLineGridNePoint(project, { east: 500000, north: 5000000 });
    resolveCadLineLatLongPoint(project, { latitudeDeg: 45, longitudeDeg: -75 });
    expect(JSON.stringify(project)).toBe(before);
  });
});
