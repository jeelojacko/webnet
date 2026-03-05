import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildMap3DScene } from '../src/engine/map3d';

describe('map3d scene', () => {
  it('includes GS coordinate shots as map points and avoids standalone self-edges', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C C 20 10 0',
      'B A-C 063-26-06.0 5.0',
      'D A-C 22.3606798 0.010',
      'GS RTK1 30.000 40.000 1.500 0.020 0.030 0.040 FROM=C',
      'GS RTK2 32.000 42.000 0.030 0.040',
    ].join('\n');

    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const scene = buildMap3DScene(result, true);

    expect(scene.stations.some((node) => node.id === 'RTK1')).toBe(true);
    expect(scene.stations.some((node) => node.id === 'RTK2')).toBe(true);
    expect(scene.edges.some((edge) => edge.from === 'C' && edge.to === 'RTK1')).toBe(true);
    expect(scene.edges.some((edge) => edge.from === 'RTK2' && edge.to === 'RTK2')).toBe(false);
  });
});
