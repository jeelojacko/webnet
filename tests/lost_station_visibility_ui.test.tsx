import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import MapView from '../src/components/MapView';
import { LSAEngine } from '../src/engine/adjust';

describe('lost-station visibility UI controls', () => {
  it('hides lost stations from map rendering when toggle is OFF', () => {
    const input = [
      '.2D',
      '.LOSTSTATIONS B',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    expect(result.success).toBe(true);
    expect(result.stations.B?.lost).toBe(true);

    const withLost = renderToStaticMarkup(
      <MapView result={result} units="m" showLostStations={true} />,
    );
    const withoutLost = renderToStaticMarkup(
      <MapView result={result} units="m" showLostStations={false} />,
    );

    expect(withLost).toContain('>A<');
    expect(withLost).toContain('>B<');
    expect(withoutLost).toContain('>A<');
    expect(withoutLost).not.toContain('>B<');
  });
});
