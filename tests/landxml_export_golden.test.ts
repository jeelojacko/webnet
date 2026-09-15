/**
 * Phase 13C §§31-48 — LandXML adjustment-export golden pin.
 *
 * Freezes the existing adjustment export byte-identical: header, Units
 * elements, N-E point order, toFixed(6) formatting, CgPoint/PlanFeature
 * shape. The ft ambiguity is documented here: linearUnit="foot" means the
 * INTERNATIONAL foot (0.3048 m exactly, scale 3.280839895); USSurveyFoot is
 * an import/export-explicit separate unit and must never silently replace
 * this element. If any assertion here fails, export semantics changed — stop
 * and justify with fixture/test/doc updates.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildLandXmlText } from '../src/engine/landxml';

const FIXED_DATE = new Date('2026-03-03T12:00:00Z');

const buildGolden = (units: 'm' | 'ft'): string => {
  const input = readFileSync('tests/fixtures/cli_smoke.dat', 'utf-8');
  const result = new LSAEngine({ input, maxIterations: 10 }).solve();
  return buildLandXmlText(result, {
    units,
    solveProfile: 'webnet',
    generatedAt: FIXED_DATE,
    projectName: 'cli_smoke',
    applicationName: 'WebNet',
    applicationVersion: '0.0.0',
  });
};

describe('LandXML adjustment export golden', () => {
  it('pins the metric header + Units element byte-identical', () => {
    const xml = buildGolden('m');
    const header = xml.split('\n').slice(0, 7);
    expect(header[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(header[1]).toBe('<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"');
    expect(header[4]).toBe('         date="2026-03-03" time="12:00:00" version="1.2" language="English">');
    expect(header[5]).toContain('<Metric');
    expect(header[5]).toContain('linearUnit="meter"');
    expect(header[5]).toContain('areaUnit="squareMeter"');
    expect(xml).toContain('<Application name="WebNet" version="0.0.0"');
    expect(xml).toContain('<Project name="cli_smoke"');
  });

  it('pins imperial output to international-foot semantics (linearUnit="foot")', () => {
    const xml = buildGolden('ft');
    // DOCUMENTED: "foot" here is the international foot (0.3048 m exactly).
    // USSurveyFoot is a separate explicit unit — never substitute silently.
    expect(xml).toContain('<Imperial');
    expect(xml).toContain('linearUnit="foot"');
    expect(xml).not.toContain('USSurveyFoot');
    expect(xml).toContain('areaUnit="squareFoot"');
  });

  it('pins CgPoint shape: N-E order, 6 decimals, name+oID, Feature properties', () => {
    const xml = buildGolden('m');
    const pointBlock = xml.match(/<CgPoint name="A" oID="A" desc="[^"]*">([^<]+)/);
    expect(pointBlock).toBeDefined();
    // N-E order with exactly 6 decimals: "northing easting elevation".
    expect(pointBlock?.[1].trim()).toMatch(/^-?\d+\.\d{6} -?\d+\.\d{6} -?\d+\.\d{6}$/);
    expect(xml).toContain('<CgPoints>');
    expect(xml).toContain('<Property label="kind" value="adjusted" />');
    // Deterministic ordering: points sorted, connections carry refs.
    const names = [...xml.matchAll(/<CgPoint name="([^"]+)" oID/g)].map((m) => m[1]);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    expect(xml).toContain('<PlanFeatures name="WebNet Connections">');
    expect(xml).toContain('<Start pntRef="A">');
  });
});
