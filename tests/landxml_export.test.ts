import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildLandXmlText } from '../src/engine/landxml';

const FT_PER_M = 3.280839895;

type ParsedLandXmlPoint = {
  name: string;
  northing: number;
  easting: number;
  elevation: number;
  properties: Record<string, string>;
};

type ParsedLandXmlConnection = {
  name: string;
  code: string;
  startRef: string;
  endRef: string;
  startNorthing: number;
  startEasting: number;
  startElevation: number;
  endNorthing: number;
  endEasting: number;
  endElevation: number;
  properties: Record<string, string>;
};

const parseAttributes = (raw: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;
  for (const match of raw.matchAll(attrRegex)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
};

const parseCoordTriple = (raw: string): [number, number, number] => {
  const parts = raw
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
  if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid coordinate triple: ${raw}`);
  }
  return [parts[0], parts[1], parts[2]];
};

const parsePropertyMap = (body: string): Record<string, string> => {
  const properties: Record<string, string> = {};
  const propertyRegex = /<Property\s+label="([^"]+)"\s+value="([^"]*)"\s*\/>/g;
  for (const match of body.matchAll(propertyRegex)) {
    properties[match[1]] = match[2];
  }
  return properties;
};

const parseLandXml = (
  xml: string,
): {
  points: Map<string, ParsedLandXmlPoint>;
  connections: ParsedLandXmlConnection[];
} => {
  const points = new Map<string, ParsedLandXmlPoint>();
  const pointRegex = /<CgPoint\b([^>]*)>([\s\S]*?)<\/CgPoint>/g;
  for (const match of xml.matchAll(pointRegex)) {
    const attrs = parseAttributes(match[1]);
    const body = match[2];
    const coordMatch = body.match(
      /^\s*([+-]?\d+(?:\.\d+)?\s+[+-]?\d+(?:\.\d+)?\s+[+-]?\d+(?:\.\d+)?)/,
    );
    if (!attrs.name || !coordMatch) continue;
    const [northing, easting, elevation] = parseCoordTriple(coordMatch[1]);
    points.set(attrs.name, {
      name: attrs.name,
      northing,
      easting,
      elevation,
      properties: parsePropertyMap(body),
    });
  }

  const connections: ParsedLandXmlConnection[] = [];
  const planFeatureRegex = /<PlanFeature\b([^>]*)>([\s\S]*?)<\/PlanFeature>/g;
  for (const match of xml.matchAll(planFeatureRegex)) {
    const attrs = parseAttributes(match[1]);
    const body = match[2];
    const startMatch = body.match(/<Start\s+pntRef="([^"]+)">([^<]+)<\/Start>/);
    const endMatch = body.match(/<End\s+pntRef="([^"]+)">([^<]+)<\/End>/);
    if (!attrs.name || !startMatch || !endMatch) continue;
    const [startNorthing, startEasting, startElevation] = parseCoordTriple(startMatch[2]);
    const [endNorthing, endEasting, endElevation] = parseCoordTriple(endMatch[2]);
    connections.push({
      name: attrs.name,
      code: attrs.code ?? '',
      startRef: startMatch[1],
      endRef: endMatch[1],
      startNorthing,
      startEasting,
      startElevation,
      endNorthing,
      endEasting,
      endElevation,
      properties: parsePropertyMap(body),
    });
  }

  return { points, connections };
};

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

  it('round-trips LandXML points and connections through common consumer-style parsing checks', () => {
    const input = readFileSync('tests/fixtures/cli_smoke.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const xml = buildLandXmlText(result, {
      units: 'm',
      solveProfile: 'webnet',
      generatedAt: new Date('2026-03-03T12:00:00Z'),
      projectName: 'cli_smoke',
    });
    const parsed = parseLandXml(xml);

    expect(parsed.points.size).toBe(Object.keys(result.stations).length);
    expect(parsed.connections.length).toBeGreaterThan(0);

    Object.entries(result.stations).forEach(([id, station]) => {
      const point = parsed.points.get(id);
      expect(point, `missing point ${id}`).toBeDefined();
      expect(point?.northing ?? 0).toBeCloseTo(station.y, 6);
      expect(point?.easting ?? 0).toBeCloseTo(station.x, 6);
      expect(point?.elevation ?? 0).toBeCloseTo(station.h, 6);
    });

    parsed.connections.forEach((connection) => {
      const start = parsed.points.get(connection.startRef);
      const end = parsed.points.get(connection.endRef);
      expect(start, `missing start ref ${connection.startRef}`).toBeDefined();
      expect(end, `missing end ref ${connection.endRef}`).toBeDefined();
      expect(connection.startNorthing).toBeCloseTo(start?.northing ?? 0, 6);
      expect(connection.startEasting).toBeCloseTo(start?.easting ?? 0, 6);
      expect(connection.endNorthing).toBeCloseTo(end?.northing ?? 0, 6);
      expect(connection.endEasting).toBeCloseTo(end?.easting ?? 0, 6);
      expect(connection.code.length).toBeGreaterThan(0);
      expect(
        connection.properties.kind === 'network' || connection.properties.kind === 'sideshot',
      ).toBe(true);
    });
  });

  it('exports imperial units with converted coordinates for consumer interoperability', () => {
    const input = readFileSync('tests/fixtures/cli_smoke.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const xml = buildLandXmlText(result, {
      units: 'ft',
      solveProfile: 'webnet',
      generatedAt: new Date('2026-03-03T12:00:00Z'),
    });
    const parsed = parseLandXml(xml);
    const pointP = parsed.points.get('P');

    expect(xml).toContain('<Imperial');
    expect(xml).toContain('linearUnit="foot"');
    expect(pointP).toBeDefined();
    expect(pointP?.northing ?? 0).toBeCloseTo((result.stations.P?.y ?? 0) * FT_PER_M, 6);
    expect(pointP?.easting ?? 0).toBeCloseTo((result.stations.P?.x ?? 0) * FT_PER_M, 6);
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
