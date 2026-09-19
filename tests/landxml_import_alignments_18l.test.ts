/**
 * Phase 18L — LandXML horizontal-alignment import (agent-tier, fast).
 *
 * Hand-authored external-style fixtures (NOT exporter output): line,
 * cw/ccw arcs, line-curve-line, nonzero start, station equations,
 * large translations, radius-from-center, spiral/profile/cross-sect
 * dispositions, unit scaling, and commit oracles (length, point-at-station,
 * STA/STA PT reflecting equations).
 */
import { describe, expect, it } from 'vitest';

import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import {
  cadAlignmentLength,
  cadPointAtAlignmentStation,
  cadAlignmentRawStationToDisplayStation,
  cadAlignmentDisplayStationToRawStation,
  cadAlignmentEndStation,
  formatCadStation,
} from '../src/engine/cad/cadAlignment';
import { commitLandXmlImport } from '../src/engine/cad/cadLandxmlCommit';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type { CadProject } from '../src/engine/cad/cadTypes';

const METRIC =
  '<Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" /></Units>';
const USFT =
  '<Units><Imperial areaUnit="squareFoot" linearUnit="USSurveyFoot" volumeUnit="cubicFeet" temperatureUnit="celsius" pressureUnit="HPA" /></Units>';

const doc = (body: string, units = METRIC): string =>
  `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" date="2026-09-19" time="12:00:00" version="1.2">${units}${body}</LandXML>`;

const alignDoc = (inner: string, attrs = 'name="CL" staStart="0"', units = METRIC): string =>
  doc(`<Alignments><Alignment ${attrs}><CoordGeom>${inner}</CoordGeom></Alignment></Alignments>`, units);

const blank = (): CadProject => createBlankCadProject({ name: 't', units: 'm' });

const committedAlignmentOf = (xml: string, fileName: string) => {
  const preview = buildLandXmlImportPreview(xml, { fileName });
  const { state, report } = commitLandXmlImport(createCadHistoryState(blank()), createCadSurfaceCache(fileName), preview, fileName);
  expect(report.committed).toBe(true);
  const alignment = state.present.project.entities.find((e) => e.type === 'alignment');
  expect(alignment?.type).toBe('alignment');
  return alignment as Extract<typeof alignment, { type: 'alignment' }>;
};

describe('LandXML alignment import', () => {
  it('imports a line with exact length and point-at-station', () => {
    const alignment = committedAlignmentOf(
      alignDoc('<Line><Start>0 0</Start><End>0 100</End></Line>'), 'line.xml');
    expect(alignment.startStation).toBe(0);
    expect(cadAlignmentLength(alignment)).toBeCloseTo(100, 9);
    expect(cadPointAtAlignmentStation(alignment, 40)).toMatchObject({ x: 40, y: 0 });
    expect(cadAlignmentEndStation(alignment)).toBeCloseTo(100, 9);
    expect(formatCadStation(40)).toBe('0+40.000');
  });

  it('builds cw and ccw quarter arcs with identical geometry, mirrored travel', () => {
    // Center origin, radius 100: S=(E100,N0) E=(E0,N100) is CCW travel.
    const ccw = committedAlignmentOf(
      alignDoc('<Curve rot="ccw" radius="100"><Start>0 100</Start><Center>0 0</Center><End>100 0</End></Curve>'),
      'ccw.xml');
    const cw = committedAlignmentOf(
      alignDoc('<Curve rot="cw" radius="100"><Start>100 0</Start><Center>0 0</Center><End>0 100</End></Curve>'),
      'cw.xml');
    const quarter = (100 * Math.PI) / 2;
    expect(cadAlignmentLength(ccw)).toBeCloseTo(quarter, 9);
    expect(cadAlignmentLength(cw)).toBeCloseTo(quarter, 9);
    // Midpoint of both arcs is the 45° point (independent known coordinates).
    const mid = quarter / 2;
    const pCcw = cadPointAtAlignmentStation(ccw, mid)!;
    const pCw = cadPointAtAlignmentStation(cw, mid)!;
    expect(pCcw.x).toBeCloseTo(100 / Math.SQRT2, 6);
    expect(pCcw.y).toBeCloseTo(100 / Math.SQRT2, 6);
    expect(pCw.x).toBeCloseTo(100 / Math.SQRT2, 6);
    expect(pCw.y).toBeCloseTo(100 / Math.SQRT2, 6);
    // Endpoints land on the file coordinates (trig epsilon tolerated).
    const endCcw = cadPointAtAlignmentStation(ccw, quarter)!;
    expect(endCcw.x).toBeCloseTo(0, 9);
    expect(endCcw.y).toBeCloseTo(100, 9);
  });

  it('derives radius from Start-to-Center when the radius attribute is absent', () => {
    const alignment = committedAlignmentOf(
      alignDoc('<Curve rot="ccw"><Start>0 250</Start><Center>0 0</Center><End>250 0</End></Curve>'),
      'noradius.xml');
    expect(cadAlignmentLength(alignment)).toBeCloseTo((250 * Math.PI) / 2, 6);
  });

  it('chains line-curve-line with exact total length and mid-curve position', () => {
    const xml = alignDoc(
      '<Line><Start>0 0</Start><End>0 100</End></Line>' +
      '<Curve rot="ccw" radius="50"><Start>0 100</Start><Center>50 100</Center><End>50 150</End></Curve>' +
      '<Line><Start>50 150</Start><End>50 250</End></Line>',
    );
    const alignment = committedAlignmentOf(xml, 'lcl.xml');
    const total = 100 + (50 * Math.PI) / 2 + 100;
    expect(cadAlignmentLength(alignment)).toBeCloseTo(total, 6);
    // 100m line + half the arc lands at the arc midpoint: start angle 270°, CCW
    // through 315° → center + r*(cos315°, sin315°).
    const probe = cadPointAtAlignmentStation(alignment, 100 + (50 * Math.PI) / 4)!;
    expect(probe.x).toBeCloseTo(100 + (50 / Math.SQRT2), 6);
    expect(probe.y).toBeCloseTo(50 - (50 / Math.SQRT2), 6);
    expect(cadPointAtAlignmentStation(alignment, total)).toMatchObject({ x: 250, y: 50 });
  });

  it('honors nonzero staStart for stationing', () => {
    const alignment = committedAlignmentOf(
      alignDoc('<Line><Start>0 0</Start><End>0 100</End></Line>', 'name="CL" staStart="1000"'),
      'sta.xml');
    expect(alignment.startStation).toBe(1000);
    expect(cadAlignmentEndStation(alignment)).toBeCloseTo(1100, 9);
    expect(cadPointAtAlignmentStation(alignment, 1010)).toMatchObject({ x: 10, y: 0 });
    expect(cadPointAtAlignmentStation(alignment, 999)).toBeNull();
  });

  it('maps StaEquation to raw/ahead/back and STA/STA PT consume it identically', () => {
    const xml = doc(
      `<Alignments><Alignment name="EQ" staStart="0"><CoordGeom><Line><Start>0 0</Start><End>0 200</End></Line></CoordGeom>` +
      `<StaEquation staInternal="100" staAhead="110" staBack="100"/></Alignment></Alignments>`,
    );
    const alignment = committedAlignmentOf(xml, 'eq.xml');
    expect(alignment.stationEquations).toHaveLength(1);
    expect(alignment.stationEquations![0]).toMatchObject({ rawStation: 100, aheadStation: 110, backStation: 100 });
    // Raw 150 displays as 160 past the +10 equation gap.
    expect(cadAlignmentRawStationToDisplayStation(alignment, 150)).toBeCloseTo(160, 9);
    expect(cadAlignmentDisplayStationToRawStation(alignment, 160)).toBeCloseTo(150, 9);
    // Equation point itself displays ahead.
    expect(cadAlignmentRawStationToDisplayStation(alignment, 100)).toBeCloseTo(110, 9);
    // STA PT: display 160 resolves to the raw-150 ground point (E150).
    expect(cadPointAtAlignmentStation(alignment, 160)).toMatchObject({ x: 150, y: 0 });
    expect(cadAlignmentEndStation(alignment)).toBeCloseTo(210, 9);
  });

  it('keeps identical geometry under large translations (2e6/7e6)', () => {
    const near = committedAlignmentOf(
      alignDoc('<Line><Start>0 0</Start><End>0 100</End></Line><Curve rot="ccw" radius="100"><Start>0 100</Start><Center>100 100</Center><End>100 200</End></Curve>'),
      'near.xml');
    const far = committedAlignmentOf(
      alignDoc('<Line><Start>7000000 2000000</Start><End>7000000 2000100</End></Line><Curve rot="ccw" radius="100"><Start>7000000 2000100</Start><Center>7000100 2000100</Center><End>7000100 2000200</End></Curve>'),
      'far.xml');
    expect(cadAlignmentLength(far)).toBeCloseTo(cadAlignmentLength(near), 6);
    const pn = cadPointAtAlignmentStation(near, 120)!;
    const pf = cadPointAtAlignmentStation(far, 120)!;
    expect(pf.x - pn.x).toBeCloseTo(2000000, 6);
    expect(pf.y - pn.y).toBeCloseTo(7000000, 6);
  });

  it('marks sampled/design profiles and cross-sections UNSUPPORTED without blocking geometry', () => {
    const xml = doc(
      `<Alignments><Alignment name="P" staStart="0"><CoordGeom><Line><Start>0 0</Start><End>0 100</End></Line></CoordGeom>` +
      `<Profile name="FG"><ProfSurf name="surf"><PntList2D>0 10 50 11 100 10</PntList2D></ProfSurf></Profile>` +
      `<Profile name="DES"><ProfAlign name="des"><PntList2D>0 10 100 12</PntList2D></ProfAlign></Profile>` +
      `<CrossSects><CrossSect sta="50" name="XS1"><CrossSectSurf name="s"><PntList2D>-10 9 0 10 10 9</PntList2D></CrossSectSurf></CrossSect></CrossSects>` +
      `</Alignment></Alignments>`,
    );
    const preview = buildLandXmlImportPreview(xml);
    expect(preview.alignments[0]?.disposition).toBe('WARNING');
    const codes = preview.alignments[0]!.profiles.map((p) => p.reasonCode).sort();
    expect(codes).toEqual([
      'LANDXML_CROSS_SECT_IMPORT_UNSUPPORTED',
      'LANDXML_DESIGN_PROFILE_UNSUPPORTED',
      'LANDXML_PROFILE_IMPORT_UNSUPPORTED',
    ]);
    expect(preview.unsupported.profilesUnsupported).toBe(2);
    expect(preview.unsupported.crossSectsUnsupported).toBe(1);
    // Geometry still commits exactly.
    const alignment = committedAlignmentOf(xml, 'prof.xml');
    expect(cadAlignmentLength(alignment)).toBeCloseTo(100, 9);
  });

  it('scales alignment geometry and stations by USSurveyFoot', () => {
    const alignment = committedAlignmentOf(
      alignDoc('<Line><Start>0 0</Start><End>0 1000</End></Line>', 'name="U" staStart="100"', USFT),
      'usft.xml');
    const f = 1200 / 3937;
    expect(alignment.startStation).toBeCloseTo(100 * f, 9);
    expect(cadAlignmentLength(alignment)).toBeCloseTo(1000 * f, 9);
  });

  it('commits points and rejects a BLOCKED-alignment selection atomically', () => {
    const xml = doc(
      `<CgPoints><CgPoint name="A">10 20 5</CgPoint><CgPoint name="B">10 30 6</CgPoint></CgPoints>` +
      `<Alignments><Alignment name="OK" staStart="0"><CoordGeom><Line><Start pntRef="A">10 20 5</Start><End pntRef="B">10 30 6</End></Line></CoordGeom></Alignment>` +
      `<Alignment name="BAD" staStart="0"><CoordGeom><Spiral length="50" radiusStart="INF" radiusEnd="500"/></CoordGeom></Alignment></Alignments>`,
    );
    const preview = buildLandXmlImportPreview(xml, { fileName: 'mix.xml' });
    expect(preview.alignments.find((a) => a.name === 'OK')?.disposition).toBe('IMPORTABLE');
    expect(preview.alignments.find((a) => a.name === 'BAD')?.disposition).toBe('UNSUPPORTED');
    const state = createCadHistoryState(blank());
    // Explicitly selecting the spiral alignment fails closed, drawing unchanged.
    const refused = commitLandXmlImport(state, createCadSurfaceCache('mix'), preview, 'mix.xml', {
      alignmentNames: ['BAD'],
    });
    expect(refused.report.committed).toBe(false);
    expect(refused.state).toBe(state);
    // Default selection commits points + the good alignment only.
    const { state: next, report } = commitLandXmlImport(state, createCadSurfaceCache('mix2'), preview, 'mix.xml');
    expect(report.committed).toBe(true);
    expect(report.pointsAdded).toBe(2);
    expect(report.alignmentsAdded).toBe(1);
    expect(report.excludedUnsupported).toBe(1);
    const alignment = next.present.project.entities.find((e) => e.type === 'alignment');
    expect(alignment?.type).toBe('alignment');
    if (alignment?.type === 'alignment') {
      expect(cadAlignmentLength(alignment)).toBeCloseTo(10, 9);
    }
  });
});
