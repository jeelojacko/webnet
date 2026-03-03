import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildLandXmlText } from '../src/engine/landxml';

describe('LandXML export', () => {
  it('serializes adjusted points and network connections into LandXML 1.2 output', () => {
    const input = readFileSync('tests/fixtures/cli_smoke.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const xml = buildLandXmlText(result, {
      units: 'm',
      solveProfile: 'webnet',
      generatedAt: new Date('2026-03-03T12:00:00Z'),
      projectName: 'cli_smoke',
      applicationName: 'WebNet',
      applicationVersion: '0.0.0',
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"');
    expect(xml).toContain('<Metric');
    expect(xml).toContain('<Project name="cli_smoke"');
    expect(xml).toContain('<CgPoint name="A" oID="A"');
    expect(xml).toContain('<CgPoint name="P" oID="P"');
    expect(xml).toContain('<PlanFeatures name="WebNet Connections">');
    expect(xml).toContain('<Start pntRef="A">');
    expect(xml).toContain('<End pntRef="P">');
    expect(xml).toContain('<Property label="observationTypes" value="bearing,dist" />');
  });

  it('includes virtual sideshot targets as exported points and sideshot connections', () => {
    const input = [
      '.GPS SIDESHOT',
      '.2D',
      'C OCC 1000 2000 0 ! !',
      'G GPS1 OCC RTK1 12.3456 -4.3210 0.020 0.030',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 5 }).solve();
    const xml = buildLandXmlText(result, {
      units: 'm',
      solveProfile: 'webnet',
      generatedAt: new Date('2026-03-03T12:00:00Z'),
    });

    expect(xml).toContain('<CgPoint name="RTK1" oID="RTK1"');
    expect(xml).toContain('<Property label="kind" value="sideshot" />');
    expect(xml).toContain('<Property label="azimuthSource" value="vector" />');
    expect(xml).toContain('<Property label="kind" value="sideshot" />');
    expect(xml).toContain('<Property label="observationTypes" value="sideshot-gps" />');
  });
});
