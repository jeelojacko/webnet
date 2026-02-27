import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import MapView from '../src/components/MapView';
import { LSAEngine } from '../src/engine/adjust';

const buildBaseResult = () => {
  const input = [
    '.2D',
    'C A 0 0 0 ! !',
    'C B 100 0 0',
    'C C 100 100 0',
    'D A-B 100.0000 0.002',
    'D B-C 100.0000 0.002',
  ].join('\n');
  return new LSAEngine({ input, maxIterations: 10 }).solve();
};

describe('MapView 3D mode UI', () => {
  it('renders 3D view-cube controls on desktop-sized layouts', () => {
    const result = buildBaseResult();
    const html = renderToStaticMarkup(
      <MapView result={result} units="m" showLostStations mode="3d" />,
    );
    expect(html).toContain('ISO');
    expect(html).toContain('TOP');
    expect(html).toContain('FRONT');
    expect(html).toContain('RIGHT');
    expect(html).not.toContain('3D rendering fallback:');
  });

  it('falls back to 2D on dense mobile layouts', () => {
    const result = buildBaseResult();
    for (let i = 0; i < 180; i += 1) {
      result.stations[`M${i}`] = {
        x: i * 2,
        y: i * 1.5,
        h: 0,
        fixed: false,
      };
    }
    const html = renderToStaticMarkup(
      <MapView
        result={result}
        units="m"
        showLostStations
        mode="3d"
        viewportWidthOverride={640}
      />,
    );
    expect(html).toContain('3D rendering fallback:');
    expect(html).not.toContain('>ISO<');
  });
});
