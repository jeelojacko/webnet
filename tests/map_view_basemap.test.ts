import { describe, expect, it } from 'vitest';

import { chooseOsmTileMeshDivisions } from '../src/components/mapView/mapViewBasemap';

describe('chooseOsmTileMeshDivisions', () => {
  it('keeps distant tiles light and increases density as on-screen tile size grows', () => {
    expect(chooseOsmTileMeshDivisions(120, 140)).toBe(2);
    expect(chooseOsmTileMeshDivisions(220, 260)).toBe(3);
    expect(chooseOsmTileMeshDivisions(360, 420)).toBe(4);
    expect(chooseOsmTileMeshDivisions(520, 540)).toBe(6);
    expect(chooseOsmTileMeshDivisions(760, 760)).toBe(8);
  });

  it('drops to a lighter mesh while interacting so pan and zoom stay responsive', () => {
    expect(chooseOsmTileMeshDivisions(120, 140, true)).toBe(1);
    expect(chooseOsmTileMeshDivisions(220, 260, true)).toBe(2);
    expect(chooseOsmTileMeshDivisions(520, 540, true)).toBe(3);
    expect(chooseOsmTileMeshDivisions(760, 760, true)).toBe(4);
  });
});
