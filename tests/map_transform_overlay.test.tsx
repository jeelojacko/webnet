import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import MapView from '../src/components/MapView';
import { LSAEngine } from '../src/engine/adjust';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  sanitizeAdjustedPointsExportSettings,
} from '../src/engine/adjustedPointsExport';

describe('MapView transformed overlay metadata', () => {
  const buildResult = () => {
    const input = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0', 'D A-B 100.0000 0.002'].join('\n');
    return new LSAEngine({ input, maxIterations: 10 }).solve();
  };

  it('shows shared transform chain details when transforms are configured', () => {
    const result = buildResult();
    const settings = sanitizeAdjustedPointsExportSettings({
      ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      transform: {
        referenceStationId: 'A',
        scope: 'all',
        selectedStationIds: [],
        rotation: {
          enabled: true,
          angleDeg: 10,
        },
        translation: {
          enabled: true,
          method: 'direction-distance',
          azimuthDeg: 90,
          distance: 5,
          targetE: 0,
          targetN: 0,
        },
        scale: {
          enabled: true,
          factor: 1.1,
        },
      },
    });
    const html = renderToStaticMarkup(
      <MapView result={result} units="m" showLostStations adjustedPointsExportSettings={settings} />,
    );
    expect(html).toContain('Show transformed coordinates');
    expect(html).toContain('Ref A');
    expect(html).toContain('scale-&gt;rotate-&gt;translate');
    expect(html).toContain('k=1.100000');
    expect(html).toContain('rot=10.000000deg');
    expect(html).toContain('tr=direction-distance');
  });

  it('shows validation reason when transform configuration is invalid', () => {
    const result = buildResult();
    const settings = sanitizeAdjustedPointsExportSettings({
      ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      transform: {
        referenceStationId: '',
        scope: 'all',
        selectedStationIds: [],
        rotation: {
          enabled: true,
          angleDeg: 10,
        },
        translation: {
          enabled: false,
          method: 'direction-distance',
          azimuthDeg: 0,
          distance: 0,
          targetE: 0,
          targetN: 0,
        },
        scale: {
          enabled: false,
          factor: 1,
        },
      },
    });
    const html = renderToStaticMarkup(
      <MapView result={result} units="m" showLostStations adjustedPointsExportSettings={settings} />,
    );
    expect(html).toContain('Transform requires a reference station.');
  });
});
