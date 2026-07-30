import { describe, expect, it } from 'vitest';
import {
  appendCadProjectEntities,
  buildSurveyCadSpikeProject,
  buildCadSpatialIndex,
  input,
  parseOptions,
} from './cadSpatialIndexTestSupport';

describe('Survey CAD spatial index', () => {
  it('resolves arc-arc apparent intersections when the visible sweeps do not meet at the full-circle crossings', () => {
    const project = appendCadProjectEntities(
      buildSurveyCadSpikeProject({
        input,
        instrumentLibrary: {},
        parseOptions,
        units: 'm',
        result: null,
      }),
      [
        {
          id: 'arc:left-upper',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 0,
          centerY: 0,
          radius: 5,
          startAngleDeg: 170,
          endAngleDeg: 250,
        },
        {
          id: 'arc:right-upper',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 6,
          centerY: 0,
          radius: 5,
          startAngleDeg: -70,
          endAngleDeg: 10,
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const apparentArcArc = index.queryNearestSnap(
      { x: 3, y: 4.1 },
      0.5,
      ['apparent-intersection'],
      { active: true, basePoint: { x: 0, y: 0 } },
    );
    expect(apparentArcArc?.kind).toBe('apparent-intersection');
    expect(apparentArcArc?.label).toBe('Arc x Arc apparent');
    expect(apparentArcArc?.x).toBeCloseTo(3, 6);
    expect(apparentArcArc?.y).toBeCloseTo(4, 6);
  });
});
