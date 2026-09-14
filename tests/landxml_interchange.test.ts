/**
 * Phase 13C §§31-48 — LandXML interchange tests.
 *
 * Repo-original fixtures (Civil3D/Carlson/Trimble-STYLE small samples —
 * hand-written, no vendor files): E-N order, units (m/ft/USft), parcel and
 * alignment subsets, malformed/security bounds, and WebNet→LandXML→WebNet
 * round-trips through the CAD adapter.
 */
import { describe, expect, it } from 'vitest';

import { buildLandXmlFromCadGeometry } from '../src/engine/landxmlCad';
import { buildLandXmlImportPreview, LandXmlImportError } from '../src/engine/landxmlImport';

const header = (units: string, version = '1.2'): string =>
  `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" date="2026-09-14" time="12:00:00" version="${version}" language="English">${units}`;

const METRIC = '<Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" /></Units>';
const IMPERIAL_FT =
  '<Units><Imperial areaUnit="squareFoot" linearUnit="foot" volumeUnit="cubicFeet" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" /></Units>';
const IMPERIAL_USFT =
  '<Units><Imperial areaUnit="squareFoot" linearUnit="USSurveyFoot" volumeUnit="cubicFeet" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" /></Units>';

// Civil3D-style: CgPoints + PlanFeatures line + Parcel ring.
const CIVIL3D_STYLE = `${header(METRIC)}
${METRIC}
<CgPoints><CgPoint name="1" oID="1" desc="IP">100.000000 200.000000 10.000000</CgPoint><CgPoint name="2" oID="2" desc="IP">100.000000 300.000000 10.500000</CgPoint><CgPoint name="3" oID="3" desc="IP">200.000000 300.000000 11.000000</CgPoint></CgPoints>
<PlanFeatures name="Base"><PlanFeature name="L1" desc="1-2"><CoordGeom><Line><Start pntRef="1">100.000000 200.000000 10.000000</Start><End pntRef="2">100.000000 300.000000 10.500000</End></Line></CoordGeom></PlanFeature></PlanFeatures>
<Parcels><Parcel name="LOT-7"><CoordGeom><Line><Start pntRef="1">100.000000 200.000000 10.000000</Start><End pntRef="2">100.000000 300.000000 10.500000</End></Line><Line><Start pntRef="2">100.000000 300.000000 10.500000</Start><End pntRef="3">200.000000 300.000000 11.000000</End></Line><Line><Start pntRef="3">200.000000 300.000000 11.000000</Start><End pntRef="1">100.000000 200.000000 10.000000</End></Line></CoordGeom></Parcel></Parcels>
</LandXML>`;

// Carlson-style: imperial feet + alignment with spiral (warn+skip) + curve.
const CARLSON_STYLE = `${header(IMPERIAL_FT)}
${IMPERIAL_FT}
<CoordinateSystem desc="NAD83 / Test" />
<CgPoints><CgPoint name="10" oID="10">1000.000000 2000.000000 100.000000</CgPoint><CgPoint name="11" oID="11">1000.000000 2328.083990 100.000000</CgPoint></CgPoints>
<Alignments><Alignment name="CL-1"><CoordGeom><Line><Start pntRef="10">1000.000000 2000.000000 100.000000</Start><End pntRef="11">1000.000000 2328.083990 100.000000</End></Line><Spiral length="50" radiusStart="INF" radiusEnd="500" /><Curve rot="cw" radius="500"><Start pntRef="10">1000.000000 2000.000000 100.000000</Start><End pntRef="11">1000.000000 2328.083990 100.000000</End></Curve></CoordGeom></Alignment></Alignments>
</LandXML>`;

// Trimble-style: US survey feet, distinct N/E to pin axis order.
const TRIMBLE_STYLE = `${header(IMPERIAL_USFT)}
${IMPERIAL_USFT}
<CgPoints><CgPoint name="T1" oID="T1" desc="ctl" code="CTL">100.000000 1000.000000 0.000000</CgPoint></CgPoints>
</LandXML>`;

describe('LandXML interchange', () => {
  it('pins N-E order: first value is northing (y), second is easting (x)', () => {
    const preview = buildLandXmlImportPreview(TRIMBLE_STYLE, { fileName: 'trimble.xml' });
    const point = preview.points[0];
    expect(point).toBeDefined();
    // N=100 ft US → y; E=1000 ft US → x. x must be 10× y.
    expect(point?.x ?? 0).toBeCloseTo((1000 * 1200) / 3937, 9);
    expect(point?.y ?? 0).toBeCloseTo((100 * 1200) / 3937, 9);
    expect((point?.x ?? 0) / (point?.y ?? 1)).toBeCloseTo(10, 9);
    expect(point?.provenance).toMatchObject({ source: 'LANDXML', file: 'trimble.xml', origId: 'T1' });
    expect(point?.desc).toBe('ctl');
    expect(point?.code).toBe('CTL');
  });

  it('scales ft (international) and USSurveyFoot with documented factors', () => {
    const ft = buildLandXmlImportPreview(CARLSON_STYLE, { fileName: 'carlson.xml' });
    expect(ft.units).toBe('ft');
    expect(ft.points[0]?.y ?? 0).toBeCloseTo(1000 * 0.3048, 9);
    const usft = buildLandXmlImportPreview(TRIMBLE_STYLE);
    expect(usft.units).toBe('usft');
    expect(usft.points[0]?.x ?? 0).toBeCloseTo((1000 * 1200) / 3937, 9);
    // ft and USft differ — never conflated.
    expect(1000 * 0.3048).not.toBeCloseTo((1000 * 1200) / 3937, 6);
  });

  it('imports Civil3D-style lines and parcel rings as geometric data only', () => {
    const preview = buildLandXmlImportPreview(CIVIL3D_STYLE);
    expect(preview.points).toHaveLength(3);
    expect(preview.lines).toEqual([{ from: '1', to: '2' }]);
    expect(preview.parcels).toHaveLength(1);
    expect(preview.parcels[0]?.name).toBe('LOT-7');
    expect(preview.parcels[0]?.ring).toEqual(['1', '2', '3', '1']);
    expect(preview.parcels[0]).not.toHaveProperty('area');
    expect(preview.crs).toBe('UNKNOWN');
  });

  it('imports alignment lines+curves, warns and skips spirals, retains CRS metadata', () => {
    const preview = buildLandXmlImportPreview(CARLSON_STYLE);
    expect(preview.alignments).toHaveLength(1);
    expect(preview.alignments[0]?.lines).toEqual([{ from: '10', to: '11' }]);
    expect(preview.alignments[0]?.curves).toHaveLength(1);
    expect(preview.alignments[0]?.curves[0]?.radiusM ?? 0).toBeCloseTo(500 * 0.3048, 9);
    expect(preview.unsupported.spirals).toBe(1);
    expect(preview.warnings.some((w) => w.includes('Spiral skipped'))).toBe(true);
    expect(preview.crs).toBe('NAD83 / Test');
  });

  it('applies the duplicate-ID policy explicitly (rename default, reject optional)', () => {
    const dup = `${header(METRIC)}${METRIC}<CgPoints><CgPoint name="A" oID="A">1.000000 2.000000 0.000000</CgPoint><CgPoint name="A" oID="A">3.000000 4.000000 0.000000</CgPoint></CgPoints></LandXML>`;
    const renamed = buildLandXmlImportPreview(dup);
    expect(renamed.points.map((p) => p.id)).toEqual(['A', 'A_2']);
    expect(renamed.duplicates).toEqual(['A']);
    expect(renamed.warnings.some((w) => w.includes('renamed'))).toBe(true);
    expect(() => buildLandXmlImportPreview(dup, { onDuplicate: 'reject' })).toThrow(LandXmlImportError);
  });

  it('fails safe on malformed, hostile, and out-of-subset input', () => {
    expect(() => buildLandXmlImportPreview('not xml')).toThrow(LandXmlImportError);
    expect(() => buildLandXmlImportPreview(`${header(METRIC, '2.0')}${METRIC}</LandXML>`)).toThrow(/version/);
    expect(() => buildLandXmlImportPreview(`${header('<Units><Metric linearUnit="furlong" /></Units>')}<Units><Metric linearUnit="furlong" /></Units></LandXML>`)).toThrow(/linearUnit/);
    expect(() => buildLandXmlImportPreview(`${header(METRIC)}${METRIC}<CgPoints><CgPoint name="A">1.0 NaN 0.0</CgPoint></CgPoints></LandXML>`)).toThrow(LandXmlImportError);
    expect(() => buildLandXmlImportPreview(`${header(METRIC)}${METRIC}<CgPoints><CgPoint name="A">1.0 2.0 0.0</CgPoint></CgPoints><PlanFeatures><PlanFeature name="B"><CoordGeom><Line><Start pntRef="A">1 2 0</Start><End pntRef="GHOST">1 2 0</End></Line></CoordGeom></PlanFeature></PlanFeatures></LandXML>`)).toThrow(/unknown point/);
    // XXE / DOCTYPE fails closed via the secure parser.
    expect(() => buildLandXmlImportPreview('<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY x "y">]><LandXML version="1.2"></LandXML>')).toThrow(LandXmlImportError);
  });

  it('round-trips WebNet CAD geometry → LandXML → WebNet within export precision', () => {
    const geom = {
      points: [
        { id: 'P1', x: 200.123456, y: 100.654321, z: 10.5, desc: 'IP' },
        { id: 'P2', x: 300.25, y: 100.75, z: 10.6 },
        { id: 'P3', x: 300.5, y: 200.125, z: 11.0 },
      ],
      lines: [{ from: 'P1', to: 'P2' }],
      curves: [{ start: 'P2', end: 'P3', radiusM: 50, rot: 'cw' as const }],
      parcels: [{ name: 'LOT-1', ring: ['P1', 'P2', 'P3', 'P1'] }],
    };
    const xml = buildLandXmlFromCadGeometry(geom, { units: 'm', projectName: 'rt' });
    const back = buildLandXmlImportPreview(xml, { fileName: 'rt.xml' });
    expect(back.units).toBe('m');
    back.points.forEach((point) => {
      const orig = geom.points.find((p) => p.id === point.id);
      expect(orig).toBeDefined();
      expect(point.x).toBeCloseTo(orig?.x ?? 0, 6);
      expect(point.y).toBeCloseTo(orig?.y ?? 0, 6);
    });
    expect(back.lines).toEqual(geom.lines);
    expect(back.curves[0]?.radiusM ?? 0).toBeCloseTo(50, 6);
    expect(back.parcels[0]?.ring).toEqual(['P1', 'P2', 'P3', 'P1']);
    // ft round-trip honors the international-foot factor.
    const xmlFt = buildLandXmlFromCadGeometry(geom, { units: 'ft' });
    expect(xmlFt).toContain('linearUnit="foot"');
    const backFt = buildLandXmlImportPreview(xmlFt);
    expect(backFt.units).toBe('ft');
    backFt.points.forEach((point) => {
      const orig = geom.points.find((p) => p.id === point.id);
      expect(point.x).toBeCloseTo(orig?.x ?? 0, 5);
      expect(point.y).toBeCloseTo(orig?.y ?? 0, 5);
    });
  });

  it('rejects CAD export with broken refs or invalid curves (no partial XML)', () => {
    const base = { points: [{ id: 'P1', x: 1, y: 2 }] };
    expect(() => buildLandXmlFromCadGeometry({ ...base, lines: [{ from: 'P1', to: 'GHOST' }] }, { units: 'm' })).toThrow(/unknown point/);
    expect(() => buildLandXmlFromCadGeometry({ ...base, curves: [{ start: 'P1', end: 'P1', radiusM: -5, rot: 'cw' }] }, { units: 'm' })).toThrow(/invalid radius/);
  });
});
