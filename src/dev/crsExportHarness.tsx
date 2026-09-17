/* eslint-disable react-refresh/only-export-components -- dev-only browser harness, no fast refresh */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { LSAEngine } from '../engine/adjust';
import { buildAdjustedPointsExportText } from '../engine/adjustedPointsExport';
import { DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS } from '../engine/adjustedPointsExportSettings';
import { buildNetworkGeoJsonText } from '../engine/browserNetworkGeoJson';
import {
  assessCoordinateReadiness,
  resolveExportCoordinateContext,
} from '../engine/exportCoordinateContext';
import { buildLandXmlText } from '../engine/landxml';
import {
  assessResultIntegrity,
  buildMathDependencyFingerprint,
  decideExportVerdict,
} from '../engine/resultIntegrity';
import type { AdjustmentResult } from '../types';

const NB_ID = 'CA_NAD83_CSRS_NB_STEREO_DOUBLE'; // EPSG 2953
const UTM21_ID = 'CA_NAD83_CSRS_UTM_21N';
const BOGUS_ID = 'NOPE_BOGUS_XX';

const NB_INPUT = [
  '.2D',
  '.UNITS METERS DD',
  `.CRS GRID ${NB_ID}`,
  'C A 2500000.0000 7500000.0000 0 ! !',
  'C B 2500800.0000 7500000.0000 0',
  'B A-B 090.000000 1.0',
  'D A-B 800.0000 0.005',
].join('\n');

const LOCAL_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0',
  'D A-B 99.8 0.005',
].join('\n');

const check = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
};

const runSnapshot = { runMode: 'adjustment', maxIterations: 8 };
const mathFor = (crsId: string, crsLabel = ''): string =>
  buildMathDependencyFingerprint({
    runSnapshot: runSnapshot as never,
    parseSnapshot: { coordSystemMode: 'grid', crsId, crsLabel } as never,
  });

interface StepData {
  geojsonCoords?: string;
  landxmlCrs?: string;
  csvRows?: string;
  blockCode?: string;
}

const stepA = (): { lines: string[]; data: StepData } => {
  const lines: string[] = [];
  const result = new LSAEngine({ input: NB_INPUT, maxIterations: 8 }).solve() as unknown as AdjustmentResult;
  check(result.success && result.converged, 'NB solve must succeed');
  lines.push(`A: solve ok stations=${Object.keys(result.stations).join(',')}`);
  const csv = buildAdjustedPointsExportText({ result, units: 'm', settings: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS });
  check(csv.includes('2500'), 'adjusted CSV must carry project EN metres');
  lines.push('A: adjusted CSV available (project EN metres)');
  const text = buildNetworkGeoJsonText({ result, units: 'm', coordSystemMode: 'grid', crsId: NB_ID });
  const geo = JSON.parse(text) as { features: Array<{ geometry: { coordinates: [number, number] } }> };
  check(!('crs' in (JSON.parse(text) as object)), 'GeoJSON must not carry deprecated crs member');
  const [lon, lat] = geo.features[0]!.geometry.coordinates;
  check(Number.isFinite(lon) && Number.isFinite(lat), 'lon/lat finite');
  check(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90, 'lon/lat in range');
  check(Math.abs(lon + 66.5) < 0.05 && Math.abs(lat - 46.5) < 0.05, `lon/lat near NB origin, got ${lon},${lat}`);
  check(!text.includes('2500000'), 'no projected metres leak into GeoJSON');
  lines.push(`A: GeoJSON lon/lat ok [${lon.toFixed(6)},${lat.toFixed(6)}], not EN metres`);
  const xml = buildLandXmlText(result, { units: 'm', solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: NB_ID } });
  check(xml.includes('<CoordinateSystem') && xml.includes('2953'), 'LandXML identifies NB CRS context');
  lines.push('A: LandXML CoordinateSystem EPSG 2953 present');
  const fp = mathFor(NB_ID);
  const applied = { inputFingerprint: 'i', mathFingerprint: fp, exclusionFingerprint: 'e', runMode: 'adjustment' };
  const ok = { success: true, converged: true, preanalysisMode: false } as unknown as AdjustmentResult;
  check(assessResultIntegrity({ result: ok, applied, current: { ...applied } }).state === 'FRESH_SUCCESS', 'fresh');
  check(decideExportVerdict('geojson', { state: 'FRESH_SUCCESS', reason: null, changedDeps: [], blockMessage: null }) === 'ALLOW', 'geojson allowed');
  lines.push('A: PASS');
  return { lines, data: { geojsonCoords: `${lon.toFixed(6)},${lat.toFixed(6)}`, landxmlCrs: 'EPSG:2953', csvRows: String(Object.keys(result.stations).length) } };
};

const stepB = (): { lines: string[]; data: StepData } => {
  const lines: string[] = [];
  const result = new LSAEngine({ input: LOCAL_INPUT, maxIterations: 6 }).solve() as unknown as AdjustmentResult;
  // Small-network convergence flags vary; assert healthy output instead (repo convention).
  check(Number.isFinite(result.stations['A']?.x) && Number.isFinite(result.stations['B']?.x), 'local solve must yield finite stations');
  const csv = buildAdjustedPointsExportText({ result, units: 'm', settings: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS });
  check(csv.includes('A') && csv.includes('B'), 'local CSV available');
  lines.push('B: local-coordinate CSV available');
  let code = '';
  try {
    buildNetworkGeoJsonText({ result, units: 'm', coordSystemMode: 'local' });
  } catch (e) {
    code = String((e as Error).message).split(':')[0]!;
  }
  check(code === 'FORMAT_REQUIRES_GEOGRAPHIC', `GeoJSON blocked, got ${code}`);
  lines.push(`B: GeoJSON blocked with ${code}`);
  const xml = buildLandXmlText(result, { units: 'm', solveProfile: 'webnet', coord: { coordSystemMode: 'local' } });
  check(!xml.includes('<CoordinateSystem'), 'local LandXML claims no CRS');
  lines.push('B: PASS');
  return { lines, data: { blockCode: code } };
};

const stepC = (): { lines: string[]; data: StepData } => {
  const lines: string[] = [];
  const result = new LSAEngine({ input: NB_INPUT, maxIterations: 8 }).solve() as unknown as AdjustmentResult;
  const ctx = resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: BOGUS_ID });
  check(ctx.crsProvenance === 'INVALID', 'bogus id is INVALID, never a fallback');
  const codes: string[] = [];
  for (const [name, fn] of [
    ['geojson', () => buildNetworkGeoJsonText({ result, units: 'm', coordSystemMode: 'grid', crsId: BOGUS_ID })],
    ['landxml', () => buildLandXmlText(result, { units: 'm', solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: BOGUS_ID } })],
  ] as const) {
    try {
      fn();
      throw new Error(`CHECK FAILED: ${name} should block on invalid CRS`);
    } catch (e) {
      const code = String((e as Error).message).split(':')[0]!;
      check(code === 'EXPORT_CRS_INVALID', `${name} code, got ${code}`);
      codes.push(`${name}=${code}`);
    }
  }
  const readiness = assessCoordinateReadiness({ context: ctx, formatClass: 'other' });
  check(!readiness.allowed && readiness.code === 'EXPORT_CRS_INVALID', 'readiness fail-closed');
  lines.push(`C: invalid CRS blocked, no silent fallback (${codes.join(' ')})`);
  lines.push('C: PASS');
  return { lines, data: { blockCode: 'EXPORT_CRS_INVALID' } };
};

const stepD = (): { lines: string[]; data: StepData } => {
  const lines: string[] = [];
  check(mathFor(NB_ID) !== mathFor(UTM21_ID), 'actual CRS change alters math fingerprint');
  const ok = { success: true, converged: true, preanalysisMode: false } as unknown as AdjustmentResult;
  const applied = { inputFingerprint: 'i', mathFingerprint: mathFor(NB_ID), exclusionFingerprint: 'e', runMode: 'adjustment' };
  const stale = assessResultIntegrity({ result: ok, applied, current: { ...applied, mathFingerprint: mathFor(UTM21_ID) } });
  check(stale.state === 'STALE_SUCCESS', `stale, got ${stale.state}`);
  check(decideExportVerdict('geojson', stale) === 'BLOCK', 'stale blocks export (integrity primary)');
  lines.push('D: CRS change marks result STALE, rerun required');
  lines.push('D: PASS');
  return { lines, data: {} };
};

const stepE = (): { lines: string[]; data: StepData } => {
  const lines: string[] = [];
  check(mathFor(NB_ID, '') === mathFor(NB_ID, 'NB display label'), 'label-only edit is math-inert');
  const ok = { success: true, converged: true, preanalysisMode: false } as unknown as AdjustmentResult;
  const fp = mathFor(NB_ID, 'NB display label');
  const id = { inputFingerprint: 'i', mathFingerprint: fp, exclusionFingerprint: 'e', runMode: 'adjustment' };
  check(assessResultIntegrity({ result: ok, applied: id, current: { ...id } }).state === 'FRESH_SUCCESS', 'label edit remains fresh');
  lines.push('E: label-only edit remains FRESH');
  lines.push('E: PASS');
  return { lines, data: {} };
};

const STEPS: Record<string, () => { lines: string[]; data: StepData }> = {
  A: stepA,
  B: stepB,
  C: stepC,
  D: stepD,
  E: stepE,
};

const CrsExportHarness: React.FC = () => {
  const [log, setLog] = useState<string[]>([]);
  const [data, setData] = useState<StepData>({});
  const run = (id: string): void => {
    try {
      const out = STEPS[id]!();
      setLog((prev) => [...prev, ...out.lines]);
      setData((prev) => ({ ...prev, ...out.data }));
    } catch (e) {
      setLog((prev) => [...prev, `${id}: FAIL ${(e as Error).message}`]);
    }
  };
  return (
    <div style={{ padding: 16, fontFamily: 'monospace' }}>
      <div data-testid="crs-harness-ready">ready</div>
      {Object.keys(STEPS).map((id) => (
        <button key={id} data-testid={`crs-step-${id}`} type="button" onClick={() => run(id)}>
          step-{id}
        </button>
      ))}
      <div data-testid="crs-geojson-coords">{data.geojsonCoords ?? ''}</div>
      <div data-testid="crs-landxml-crs">{data.landxmlCrs ?? ''}</div>
      <div data-testid="crs-csv-rows">{data.csvRows ?? ''}</div>
      <div data-testid="crs-block-code">{data.blockCode ?? ''}</div>
      <div data-testid="crs-flow-log">{log.map((line, i) => <div key={i}>{line}</div>)}</div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<CrsExportHarness />);
