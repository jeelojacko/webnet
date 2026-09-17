/* eslint-disable react-refresh/only-export-components -- dev-only browser harness, no fast refresh */
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { LSAEngine } from '../engine/adjust';
import { importAdjustedPointsIntoCadDrawing, importAdjustedPointsIntoCadProject } from '../engine/cad/cadAdjustedPointsImport';
import {
  dependencyOf,
  evaluateCadEntityDependency,
  summarizeDrawingDependency,
} from '../engine/cad/cadAdjustmentDependency';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../engine/cad/cadDrawingFile';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../engine/cad/cadSheets';
import type { CadDrawingDocument, CadEntity } from '../engine/cad/cadTypes';
import { buildExportCenterPreview } from '../engine/cad/exportCenter';
import {
  assessResultIntegrity,
  buildAppliedRunIdentity,
  type AppliedRunIdentity,
} from '../engine/resultIntegrity';
import { buildFieldToFinishProject, type FieldToFinishCadPoint } from '../engine/fieldToFinish/cadGeneration';
import { adjustedStationsToFieldToFinishPoints } from '../engine/fieldToFinish/regeneration';
import { applyAdjustmentRerunToLinkedF2f } from '../engine/fieldToFinish/linkedRerunSync';
import { SAMPLE_CATALOG } from '../engine/fieldToFinish/sampleCatalog';
import type { AdjustmentResult, ParseOptions } from '../types';

const BASE_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
].join('\n');

const ALTERED_INPUT = BASE_INPUT.replace('D A-C 72.1110255 0.005', 'D A-C 72.6110255 0.005');

const PARSE_OPTIONS: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: { bearing: 'grid', distance: 'measured', angle: 'measured', direction: 'measured' },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

const RUN_SNAPSHOT = { runMode: 'adjustment', maxIterations: 8 };
const SETTINGS_FINGERPRINT = JSON.stringify(PARSE_OPTIONS);

const check = (cond: unknown, msg: string): void => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
};

const solve = (input: string): AdjustmentResult => {
  const result = new LSAEngine({ input, parseOptions: PARSE_OPTIONS, maxIterations: 8 }).solve() as AdjustmentResult;
  check(result.success && result.converged, 'solve must succeed and converge');
  return result;
};

const identityOf = (input: string): AppliedRunIdentity =>
  buildAppliedRunIdentity({
    input,
    runSnapshot: RUN_SNAPSHOT as never,
    parseSnapshot: PARSE_OPTIONS as never,
  });

const stationIdsOf = (result: AdjustmentResult): Set<string> => new Set(Object.keys(result.stations));

const basePoints = (): FieldToFinishCadPoint[] => ([
  { stationId: 'A', x: 0, y: 0, sourceOrder: 1, rawCodeText: 'EDGE BEGIN', codes: [{ code: 'EDGE BEGIN', rawCode: 'EDGE BEGIN' }], sourceImportId: 'e17-1' },
  { stationId: 'B', x: 100, y: 0, sourceOrder: 2, rawCodeText: 'EDGE END', codes: [{ code: 'EDGE END', rawCode: 'EDGE END' }], sourceImportId: 'e17-1' },
  { stationId: 'C', x: 60, y: 40, sourceOrder: 3, rawCodeText: 'TREE', codes: [{ code: 'TREE', rawCode: 'TREE' }], description: 'Oak', sourceImportId: 'e17-1' },
]);

const adjustedOf = (result: AdjustmentResult): Map<string, { x: number; y: number }> =>
  new Map(Object.entries(result.stations).map(([id, station]) => [id, { x: station.x, y: station.y }]));

const parcelOf = (id: string, vertices: Array<{ x: number; y: number }>, vertexLabels: string[]): CadEntity => ({
  id,
  type: 'parcel',
  layerId: 'parcels',
  visible: true,
  locked: false,
  vertices,
  vertexLabels,
  parcelName: id,
}) as CadEntity;

const withSheet = (doc: CadDrawingDocument): CadDrawingDocument => {
  let draft = doc.draft!;
  if (draft.sheets.length === 0) {
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'E17 - Plan', sizeId: 'ISO A4', orientation: 'landscape' }));
  }
  const sheetId = draft.sheets[0]!.id;
  if ((draft.sheets[0]!.viewports.length ?? 0) === 0) {
    draft = addViewportToSheet(draft, sheetId, {
      name: 'E17 viewport', modelCenterX: 50, modelCenterY: 20, scaleDenominator: 500,
      paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130,
    });
  }
  return { ...doc, draft };
};

interface Store {
  result1: AdjustmentResult | null;
  result2: AdjustmentResult | null;
  id1: AppliedRunIdentity | null;
  id2: AppliedRunIdentity | null;
  doc: CadDrawingDocument | null;
  f2fDoc: CadDrawingDocument | null;
  staleDoc: CadDrawingDocument | null;
  chip: string;
  resultState: string;
  exportDxf: string;
  exportLandxml: string;
  exportWncad: string;
  parcelInfo: string;
  f2fInfo: string;
  importInfo: string;
}

const freshStore = (): Store => ({
  result1: null, result2: null, id1: null, id2: null,
  doc: null, f2fDoc: null, staleDoc: null,
  chip: 'CAD status: none', resultState: '', exportDxf: '', exportLandxml: '',
  exportWncad: '', parcelInfo: '', f2fInfo: '', importInfo: '',
});

type HarnessStep = (_s: Store) => { lines: string[] };

const stepA: HarnessStep = (s) => {
  const result1 = solve(BASE_INPUT);
  const id1 = identityOf(BASE_INPUT);
  const blank = createBlankCadDrawingDocument({ name: 'E17 CAD Plan', units: 'm' });
  const doc = importAdjustedPointsIntoCadDrawing({ document: blank, identity: id1, result: result1 });
  check(doc.project.entities.length > 0, 'import must create entities');
  const summary = summarizeDrawingDependency(doc.project, id1, { stationIds: stationIdsOf(result1) });
  check(summary.status === 'CURRENT', `imported drawing must be CURRENT, got ${summary.status}`);
  const integrity = assessResultIntegrity({ result: result1, applied: id1, current: id1 });
  check(integrity.state === 'FRESH_SUCCESS', `result must be FRESH, got ${integrity.state}`);
  s.result1 = result1; s.id1 = id1; s.doc = doc;
  s.chip = 'CAD status: CURRENT';
  s.resultState = integrity.state;
  return { lines: [`A: solve ok stations=${Object.keys(result1.stations).join(',')}`, 'A: CAD status CURRENT', 'A: PASS'] };
};

const stepB: HarnessStep = (s) => {
  check(s.result1 && s.id1 && s.doc, 'A must run first');
  const id2 = identityOf(ALTERED_INPUT);
  check(id2.inputFingerprint !== s.id1!.inputFingerprint, 'edited observation must flip the input fingerprint');
  const integrity = assessResultIntegrity({ result: s.result1, applied: s.id1, current: id2 });
  check(integrity.state === 'STALE_SUCCESS', `edited result must be STALE, got ${integrity.state}`);
  const summary = summarizeDrawingDependency(s.doc!.project, id2, { stationIds: stationIdsOf(s.result1!) });
  check(summary.status === 'STALE', `CAD chip must warn STALE, got ${summary.status}`);
  s.id2 = id2;
  s.chip = 'CAD status: STALE — Refresh adjusted points from the current result before delivery.';
  s.resultState = integrity.state;
  return { lines: [`B: result ${integrity.state}`, `B: CAD status ${summary.status}`, 'B: PASS'] };
};

const stepC: HarnessStep = (s) => {
  check(s.result1 && s.id1 && s.id2 && s.doc, 'B must run first');
  const result2 = solve(ALTERED_INPUT);
  const integrity = assessResultIntegrity({ result: result2, applied: s.id2, current: s.id2 });
  check(integrity.state === 'FRESH_SUCCESS', `rerun must be FRESH, got ${integrity.state}`);
  const summary = summarizeDrawingDependency(s.doc!.project, s.id2, { stationIds: stationIdsOf(result2) });
  check(summary.status === 'STALE', `non-refreshed CAD stays STALE, got ${summary.status}`);
  s.result2 = result2;
  s.resultState = integrity.state;
  s.chip = 'CAD status: STALE — Refresh adjusted points from the current result before delivery.';
  return { lines: [`C: rerun FRESH stations=${Object.keys(result2.stations).join(',')}`, `C: CAD still ${summary.status}`, 'C: PASS'] };
};

const stepD: HarnessStep = (s) => {
  check(s.doc && s.result2 && s.id2, 'C must run first');
  const doc = importAdjustedPointsIntoCadDrawing({ document: s.doc!, identity: s.id2!, result: s.result2! });
  const summary = summarizeDrawingDependency(doc.project, s.id2, { stationIds: stationIdsOf(s.result2!) });
  check(summary.status === 'CURRENT', `refreshed drawing must be CURRENT, got ${summary.status}`);
  s.doc = doc;
  s.chip = 'CAD status: CURRENT';
  return { lines: ['D: refresh adjusted points ok', `D: CAD status ${summary.status}`, 'D: PASS'] };
};

const stepE: HarnessStep = (s) => {
  check(s.result1 && s.result2 && s.id2, 'C must run first');
  const blank = createBlankCadDrawingDocument({ name: 'E17 Linked F2F Plan', units: 'm' });
  const built = buildFieldToFinishProject(blank.project, {
    points: adjustedStationsToFieldToFinishPoints(basePoints(), adjustedOf(s.result1!)),
    catalog: SAMPLE_CATALOG,
    generationRunId: 'e17-1',
    source: { sourceKind: 'adjustment', inputFingerprint: 'e17-run-1', settingsFingerprint: SETTINGS_FINGERPRINT },
  }).project;
  const lineworkBefore = built.entities.filter((e) => e.type === 'line' || e.type === 'polyline').length;
  const outcome = applyAdjustmentRerunToLinkedF2f(built, {
    result: s.result2,
    inputFingerprint: 'e17-run-2',
    settingsFingerprint: SETTINGS_FINGERPRINT,
    resultDependencyIdentity: s.id2,
  });
  check(outcome.status === 'CURRENT', `linked sync status must be CURRENT, got ${outcome.status}`);
  const summary = summarizeDrawingDependency(outcome.project, s.id2, {
    stationIds: stationIdsOf(s.result2!),
    f2fLinkStatus: outcome.project.metadata.fieldToFinishLink?.status,
  });
  check(summary.status === 'CURRENT', `synced F2F drawing must be CURRENT, got ${summary.status}`);
  const lineworkAfter = outcome.project.entities.filter((e) => e.type === 'line' || e.type === 'polyline').length;
  check(lineworkAfter === lineworkBefore, 'sync must preserve linework count');
  s.f2fDoc = { ...blank, project: outcome.project };
  s.f2fInfo = `sync:${outcome.status}:entities:${outcome.project.entities.length}:linework:${lineworkAfter}:CAD:${summary.status}`;
  return { lines: [`E: linked rerun sync ${outcome.status} updated=${outcome.updated.join(',') || 'none'}`, `E: associative CAD ${summary.status} linework ${lineworkBefore}→${lineworkAfter}`, 'E: PASS'] };
};

const stepF: HarnessStep = (s) => {
  check(s.f2fDoc && s.result2 && s.id2, 'E must run first');
  const before = new Map(s.f2fDoc!.project.entities.map((e) => [e.id, JSON.stringify(e)]));
  const { project, record } = importAdjustedPointsIntoCadProject({
    identity: s.id2!,
    project: s.f2fDoc!.project,
    result: s.result2!,
  });
  const skipped = record.skippedF2fStationIds ?? [];
  check(skipped.length > 0, 'import on linked-F2F drawing must skip F2F-owned stations');
  const f2fIds = s.f2fDoc!.project.entities.filter((e) => (e.metadata as Record<string, unknown> | undefined)?.['provenance'] !== undefined).map((e) => e.id);
  check(f2fIds.length > 0, 'drawing must carry F2F entities');
  const preserved = f2fIds.filter((id) => before.get(id) === JSON.stringify(project.entities.find((e) => e.id === id)));
  check(preserved.length === f2fIds.length, `all ${f2fIds.length} F2F entities byte-preserved, got ${preserved.length}`);
  s.f2fDoc = { ...s.f2fDoc!, project };
  s.importInfo = `skippedF2f:${skipped.join(',')}:preserved:${preserved.length}/${f2fIds.length}`;
  return { lines: [`F: skippedF2fStationIds=${skipped.join(',')}`, `F: F2F entities preserved ${preserved.length}/${f2fIds.length}`, 'F: PASS'] };
};

const stepG: HarnessStep = (s) => {
  check(s.result1 && s.result2 && s.id2, 'C must run first');
  const at = (r: AdjustmentResult, id: string): { x: number; y: number } => ({ x: r.stations[id]!.x, y: r.stations[id]!.y });
  const base = createBlankCadDrawingDocument({ name: 'E17 Parcel Plan', units: 'm' }).project;
  const parcel = parcelOf('parcel:1', [at(s.result1!, 'A'), at(s.result1!, 'B'), at(s.result1!, 'C')], ['A', 'B', 'C']);
  const { project } = importAdjustedPointsIntoCadProject({
    identity: s.id2!,
    project: { ...base, entities: [parcel] },
    result: s.result2!,
  });
  const moved = project.entities.find((e) => e.id === 'parcel:1');
  check(moved?.type === 'parcel', 'parcel must survive refresh');
  const live = (moved as unknown as { vertices: Array<{ x: number; y: number }>; areaSquareMeters: number; perimeterMeters: number }).vertices;
  const wantC = at(s.result2!, 'C');
  const drift = Math.hypot(live[2]!.x - wantC.x, live[2]!.y - wantC.y);
  check(drift < 1e-6, `parcel C vertex must follow moved station, drift=${drift}`);
  const metrics = moved as unknown as { areaSquareMeters: number; perimeterMeters: number; closureDistanceMeters: number };
  check(Number.isFinite(metrics.areaSquareMeters) && Number.isFinite(metrics.perimeterMeters), 'parcel metrics recomputed');
  check(dependencyOf(moved!) !== null, 'refreshed parcel must carry the result stamp');
  const verdict = evaluateCadEntityDependency(moved!, s.id2, { stationIds: stationIdsOf(s.result2!) });
  check(verdict.status === 'CURRENT', `parcel must evaluate CURRENT, got ${verdict.status}`);
  s.parcelInfo = `drift:${drift.toExponential(1)}:area:${metrics.areaSquareMeters.toFixed(4)}:perim:${metrics.perimeterMeters.toFixed(4)}:${verdict.status}`;
  return { lines: [`G: parcel C-vertex drift ${drift.toExponential(1)}`, `G: area=${metrics.areaSquareMeters.toFixed(4)} perim=${metrics.perimeterMeters.toFixed(4)} ${verdict.status}`, 'G: PASS'] };
};

const stepH: HarnessStep = (s) => {
  check(s.result1 && s.result2 && s.id1 && s.id2, 'C must run first');
  const blank = createBlankCadDrawingDocument({ name: 'E17 Stale Plan', units: 'm' });
  const stale = withSheet(importAdjustedPointsIntoCadDrawing({ document: blank, identity: s.id1!, result: s.result1! }));
  const summary = summarizeDrawingDependency(stale.project, s.id2, { stationIds: stationIdsOf(s.result2!) });
  check(summary.status === 'STALE', 'H fixture must be stale');
  const depOpts = { resultIdentity: s.id2, stationIds: stationIdsOf(s.result2!) };
  const dxf = buildExportCenterPreview(stale, { format: 'dxf-r12' }, depOpts);
  const landxml = buildExportCenterPreview(stale, { format: 'landxml' }, depOpts);
  const wncad = buildExportCenterPreview(stale, { format: 'wncad' }, depOpts);
  check(!dxf.ok, 'stale DXF must be blocked');
  check(!landxml.ok, 'stale LandXML must be blocked');
  check(/^\[[A-Z_]+\]/.test(!dxf.ok ? dxf.message : ''), `DXF block carries reason, got: ${!dxf.ok ? dxf.message : 'ok'}`);
  check(/^\[[A-Z_]+\]/.test(!landxml.ok ? landxml.message : ''), 'LandXML block carries reason');
  check(wncad.ok, 'WNCAD save must still work on stale drawings');
  s.staleDoc = stale;
  s.exportDxf = !dxf.ok ? dxf.message : 'allowed';
  s.exportLandxml = !landxml.ok ? landxml.message : 'allowed';
  s.exportWncad = wncad.ok ? 'allowed' : 'blocked';
  return { lines: [`H: dxf blocked ${s.exportDxf}`, `H: landxml blocked ${s.exportLandxml}`, 'H: wncad allowed', 'H: PASS'] };
};

const stepI: HarnessStep = (s) => {
  check(s.staleDoc && s.id2 && s.result2, 'H must run first');
  const text = serializeCadDrawingFile(s.staleDoc!);
  check(text.length > 0, 'serialized WNCAD must be non-empty');
  const parsed = parseCadDrawingFile(text);
  check(parsed.ok, `WNCAD must reopen, got ${parsed.ok ? 'ok' : parsed.errors.join(';')}`);
  const summary = summarizeDrawingDependency(parsed.ok ? parsed.drawing.project : s.staleDoc!.project, s.id2, {
    stationIds: stationIdsOf(s.result2!),
  });
  check(summary.status === 'STALE', `reopened drawing preserves staleness, got ${summary.status}`);
  return { lines: [`I: reopen ok bytes=${text.length}`, `I: staleness preserved ${summary.status}`, 'I: PASS'] };
};

const STEPS: Record<string, HarnessStep> = { A: stepA, B: stepB, C: stepC, D: stepD, E: stepE, F: stepF, G: stepG, H: stepH, I: stepI };

const CadDependencyHarness: React.FC = () => {
  const store = useRef<Store>(freshStore());
  const [log, setLog] = useState<string[]>([]);
  const [snap, setSnap] = useState<Store>(store.current);
  const run = (id: string): void => {
    try {
      const fn = STEPS[id];
      check(fn, `unknown step ${id}`);
      const out = (fn as HarnessStep)(store.current);
      setLog((prev) => [...prev, ...out.lines]);
      setSnap({ ...store.current });
    } catch (e) {
      setLog((prev) => [...prev, `${id}: FAIL ${(e as Error).message}`]);
    }
  };
  return (
    <div style={{ padding: 16, fontFamily: 'monospace' }}>
      <div data-testid="cad-harness-ready">ready</div>
      {Object.keys(STEPS).map((id) => (
        <button key={id} data-testid={`cad-step-${id}`} type="button" onClick={() => run(id)}>
          {`step-${id}`}
        </button>
      ))}
      <div data-survey-cad-dependency-status data-testid="cad-dep-status">{snap.chip}</div>
      <div data-testid="cad-result-state">{snap.resultState}</div>
      <div data-testid="cad-export-dxf">{snap.exportDxf}</div>
      <div data-testid="cad-export-landxml">{snap.exportLandxml}</div>
      <div data-testid="cad-export-wncad">{snap.exportWncad}</div>
      <div data-testid="cad-parcel-info">{snap.parcelInfo}</div>
      <div data-testid="cad-f2f-info">{snap.f2fInfo}</div>
      <div data-testid="cad-import-info">{snap.importInfo}</div>
      <div data-testid="cad-flow-log">{log.map((line, i) => <div key={i}>{line}</div>)}</div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<CadDependencyHarness />);
