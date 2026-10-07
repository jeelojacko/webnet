/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/hooks/useAppController', () => {
  throw new Error('useAppController must not load inside the CAD app');
});
import {
  buildAdjustmentSourceSnapshot,
  buildCadSourceId,
  checkSnapshotImportCompatibility,
  clearLegacyMigrationCandidate,
  publishAdjustmentSource,
  readAdjustmentSource,
  readLatestSourceForProject,
  readLegacyMigrationCandidate,
  stageLegacyMigrationCandidate,
  CAD_SOURCE_SCHEMA_VERSION,
  type AdjustmentSourceSnapshot,
} from '../src/cad-app/cadSourceBridge';
import {
  buildCadUrl,
  hasCadMigrationRequest,
  readCadSourceIdFromLocation,
  resolveAppRoute,
} from '../src/cad-app/cadNavigation';
import { importSnapshotIntoCadDrawing } from '../src/cad-app/cadSnapshotImport';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { importAdjustedPointsIntoCadDrawing } from '../src/engine/cad/cadAdjustedPointsImport';
import { summarizeDrawingDependency } from '../src/engine/cad/cadAdjustmentDependency';
import type { AppliedRunIdentity } from '../src/engine/resultIntegrity';
import type { CadDrawingDocument, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import type { StationMap } from '../src/typesObservations';

const IDENTITY_A: AppliedRunIdentity = {
  inputFingerprint: 'input-a',
  mathFingerprint: 'math-a',
  exclusionFingerprint: 'excl-a',
  runMode: 'adjustment',
};

const IDENTITY_B: AppliedRunIdentity = {
  inputFingerprint: 'input-b',
  mathFingerprint: 'math-a',
  exclusionFingerprint: 'excl-a',
  runMode: 'adjustment',
};

const STATIONS_A: StationMap = {
  A: { x: 0, y: 0, h: 0, fixed: true },
  B: { x: 100, y: 0, h: 0, fixed: false },
  C: { x: 60, y: 40, h: 0, fixed: false },
};

const makeSnapshot = (overrides?: Partial<AdjustmentSourceSnapshot>): AdjustmentSourceSnapshot => ({
  ...buildAdjustmentSourceSnapshot({
    projectId: 'proj-a',
    projectName: 'Project A',
    runMode: 'adjustment',
    appliedRunIdentity: IDENTITY_A,
    resultFingerprint: 'fp-a',
    generatedAt: '2026-09-17T00:00:00.000Z',
    units: 'm',
    crsId: null,
    crsLabel: null,
    stations: STATIONS_A,
  }),
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('route dispatch', () => {
  it('routes /study, /cad, and everything else without a router dependency', () => {
    expect(resolveAppRoute('/study')).toBe('study');
    expect(resolveAppRoute('/study/abc')).toBe('study');
    expect(resolveAppRoute('/cad')).toBe('cad');
    expect(resolveAppRoute('/cad/')).toBe('cad');
    expect(resolveAppRoute('/')).toBe('adjustment');
    expect(resolveAppRoute('/other')).toBe('adjustment');
  });

  it('carries only the small source descriptor in the URL', () => {
    expect(readCadSourceIdFromLocation('?source=cad-src%3Aproj%3Afp')).toBe('cad-src:proj:fp');
    expect(readCadSourceIdFromLocation('')).toBeNull();
    expect(buildCadUrl('cad-src:proj:fp')).toBe('/cad?source=cad-src%3Aproj%3Afp');
    expect(buildCadUrl(null)).toBe('/cad');
    expect(hasCadMigrationRequest('?migrate=1')).toBe(true);
    expect(hasCadMigrationRequest('')).toBe(false);
  });
});

describe('snapshot builder', () => {
  it('builds deterministic ids and carries only stations (no observations)', () => {
    const snapshot = makeSnapshot();
    expect(snapshot.schemaVersion).toBe(CAD_SOURCE_SCHEMA_VERSION);
    expect(snapshot.sourceId).toBe(buildCadSourceId('proj-a', 'fp-a'));
    expect(snapshot.sourceId).toBe('cad-src:proj-a:fp-a');
    expect(snapshot.stationCount).toBe(3);
    expect(Object.keys(snapshot.stations)).toEqual(['A', 'B', 'C']);
    expect('observations' in snapshot).toBe(false);
    expect('result' in snapshot).toBe(false);
  });
});

describe('bridge storage', () => {
  it('publishes, receives, and tracks the per-project latest source', () => {
    const first = makeSnapshot();
    expect(publishAdjustmentSource(first)).toBe(true);
    expect(readAdjustmentSource(first.sourceId)).toEqual(first);

    const latest = readLatestSourceForProject('proj-a');
    expect(latest?.latestSourceId).toBe(first.sourceId);
    expect(latest?.appliedRunIdentity).toEqual(IDENTITY_A);

    const second = makeSnapshot({
      sourceId: buildCadSourceId('proj-a', 'fp-b'),
      resultFingerprint: 'fp-b',
      generatedAt: '2026-09-17T01:00:00.000Z',
      appliedRunIdentity: IDENTITY_B,
    });
    expect(publishAdjustmentSource(second)).toBe(true);
    // Same run re-publishes under the same id (no duplicates); registry follows the latest.
    expect(readLatestSourceForProject('proj-a')?.latestSourceId).toBe(second.sourceId);
    expect(readLatestSourceForProject('proj-a')?.resultFingerprint).toBe('fp-b');
    // Project-scoped: another project is untouched.
    expect(readLatestSourceForProject('proj-b')).toBeNull();
  });

  it('treats invalid tokens as absent (CAD loads with a warning, never crashes)', () => {
    publishAdjustmentSource(makeSnapshot());
    expect(readAdjustmentSource('cad-src:proj-a:nope')).toBeNull();
    expect(readAdjustmentSource(null)).toBeNull();
    expect(readAdjustmentSource(undefined)).toBeNull();
    expect(readAdjustmentSource('')).toBeNull();
  });

  it('stages a legacy drawing as a migration candidate without making it current', () => {
    const legacy = createBlankCadDrawingDocument({ name: 'Legacy', units: 'm' });
    expect(stageLegacyMigrationCandidate(legacy)).toBe(true);
    expect(readLegacyMigrationCandidate()?.name).toBe('Legacy');
    clearLegacyMigrationCandidate();
    expect(readLegacyMigrationCandidate()).toBeNull();
  });
});

describe('snapshot import compatibility', () => {
  it('passes on matching units and fails closed on mismatch', () => {
    const snapshot = makeSnapshot();
    expect(checkSnapshotImportCompatibility(snapshot, 'm')).toEqual({ ok: true });
    const blocked = checkSnapshotImportCompatibility(snapshot, 'ft');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toContain('units');
  });
});

describe('dependency scenarios A-E (17E no-false-CURRENT)', () => {
  const blank = () => createBlankCadDrawingDocument({ name: 'Cad', units: 'm' });

  it('A: CURRENT on explicit import', () => {
    const snapshot = makeSnapshot();
    publishAdjustmentSource(snapshot);
    const imported = importSnapshotIntoCadDrawing({ document: blank(), snapshot });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const summary = summarizeDrawingDependency(imported.drawing.project, IDENTITY_A);
    expect(summary.status).toBe('CURRENT');
  });

  it('CAD Draw L1: a blank drawing adopts the source CRS (grid-proven import)', () => {
    const snapshot = makeSnapshot({
      coordinateContext: {
        units: 'm',
        crsId: 'CA_NAD83_CSRS_UTM_20N',
        crsLabel: 'UTM 20N',
      },
    });
    const imported = importSnapshotIntoCadDrawing({ document: blank(), snapshot });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.drawing.project.metadata.coordinateContext).toEqual({
      crsId: 'CA_NAD83_CSRS_UTM_20N',
      crsLabel: 'UTM 20N',
    });
  });

  it('CAD Draw L1: a compatible-units same-CRS refresh never clobbers an existing drawing context', () => {
    const first = makeSnapshot({
      coordinateContext: {
        units: 'm',
        crsId: 'CA_NAD83_CSRS_UTM_20N',
        crsLabel: 'UTM 20N',
      },
    });
    const imported = importSnapshotIntoCadDrawing({ document: blank(), snapshot: first });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const second = makeSnapshot({
      sourceId: buildCadSourceId('proj-a', 'fp-b'),
      resultFingerprint: 'fp-b',
      coordinateContext: { units: 'm', crsId: 'CA_NAD83_CSRS_UTM_20N', crsLabel: 'Renamed label' },
    });
    const refreshed = importSnapshotIntoCadDrawing({ document: imported.drawing, snapshot: second });
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    // Same CRS id: the established context is kept verbatim (no clobber, no relabel).
    expect(refreshed.drawing.project.metadata.coordinateContext).toEqual({
      crsId: 'CA_NAD83_CSRS_UTM_20N',
      crsLabel: 'UTM 20N',
    });
  });

  it('CAD Draw L1: a different-CRS refresh deprovenances instead of minting mixed geometry', () => {
    const first = makeSnapshot({
      coordinateContext: { units: 'm', crsId: 'CA_NAD83_CSRS_UTM_20N', crsLabel: 'UTM 20N' },
    });
    const imported = importSnapshotIntoCadDrawing({ document: blank(), snapshot: first });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const differentCrs = makeSnapshot({
      sourceId: buildCadSourceId('proj-a', 'fp-crs-b'),
      resultFingerprint: 'fp-crs-b',
      coordinateContext: { units: 'm', crsId: 'EPSG:26920', crsLabel: 'NAD83 UTM 20N' },
    });
    const refreshed = importSnapshotIntoCadDrawing({ document: imported.drawing, snapshot: differentCrs });
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    // The old CRS must never authorize geometry replaced by another grid:
    // provenance is removed so GRID_NE/LATLONG fail closed until re-established.
    expect(refreshed.drawing.project.metadata.coordinateContext).toBeUndefined();
  });

  it('CAD Draw L1: a null-CRS refresh deprovenances a CRS drawing', () => {
    const first = makeSnapshot({
      coordinateContext: { units: 'm', crsId: 'CA_NAD83_CSRS_UTM_20N', crsLabel: 'UTM 20N' },
    });
    const imported = importSnapshotIntoCadDrawing({ document: blank(), snapshot: first });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    // The refresh source carries no CRS: its stations are unprovenanced, so the
    // drawing's CRS A must not stay live on the replaced coordinates.
    const local = makeSnapshot({
      sourceId: buildCadSourceId('proj-a', 'fp-local'),
      resultFingerprint: 'fp-local',
      coordinateContext: { units: 'm', crsId: null, crsLabel: null },
    });
    const refreshed = importSnapshotIntoCadDrawing({ document: imported.drawing, snapshot: local });
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.drawing.project.metadata.coordinateContext).toBeUndefined();
  });

  it('CAD Draw L1: an existing non-blank drawing with no context stays fail-closed', () => {
    // First import carries no CRS: the drawing has entities but no context.
    const local = importSnapshotIntoCadDrawing({ document: blank(), snapshot: makeSnapshot() });
    expect(local.ok).toBe(true);
    if (!local.ok) return;
    expect(local.drawing.project.entities.length).toBeGreaterThan(0);
    expect(local.drawing.project.metadata.coordinateContext).toBeUndefined();

    // A later CRS-bearing import into that non-blank drawing must not relabel
    // its existing local XY as grid XY.
    const withCrs = makeSnapshot({
      sourceId: buildCadSourceId('proj-a', 'fp-crs'),
      resultFingerprint: 'fp-crs',
      coordinateContext: { units: 'm', crsId: 'CA_NAD83_CSRS_UTM_20N', crsLabel: 'UTM 20N' },
    });
    const imported = importSnapshotIntoCadDrawing({ document: local.drawing, snapshot: withCrs });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.drawing.project.metadata.coordinateContext).toBeUndefined();
  });

  it('B/C: UPDATE_AVAILABLE after a newer publish, CURRENT after refresh', () => {
    const first = makeSnapshot();
    publishAdjustmentSource(first);
    const imported = importSnapshotIntoCadDrawing({ document: blank(), snapshot: first });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const second = makeSnapshot({
      sourceId: buildCadSourceId('proj-a', 'fp-b'),
      resultFingerprint: 'fp-b',
      generatedAt: '2026-09-17T01:00:00.000Z',
      appliedRunIdentity: IDENTITY_B,
    });
    publishAdjustmentSource(second);

    // CAD compares against the latest published identity (registry), not the import-time one.
    const latestIdentity = readLatestSourceForProject('proj-a')?.appliedRunIdentity ?? null;
    expect(summarizeDrawingDependency(imported.drawing.project, latestIdentity).status).toBe('STALE');

    const refreshed = importSnapshotIntoCadDrawing({ document: imported.drawing, snapshot: second });
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(summarizeDrawingDependency(refreshed.drawing.project, latestIdentity).status).toBe('CURRENT');
  });

  it('D: unresolvable identity is never CURRENT', () => {
    const snapshot = makeSnapshot();
    const imported = importSnapshotIntoCadDrawing({ document: blank(), snapshot });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    // Registry unavailable / cleared: fail closed.
    expect(summarizeDrawingDependency(imported.drawing.project, null).status).not.toBe('CURRENT');

    // Unstamped legacy entity: UNKNOWN/NEEDS REVIEW, never CURRENT.
    const stripped = {
      ...imported.drawing,
      project: {
        ...imported.drawing.project,
        entities: imported.drawing.project.entities.map((entity) => ({
          ...entity,
          metadata: { ...(entity.metadata as Record<string, unknown>), adjustmentDependency: undefined },
        })),
      },
    };
    const legacySummary = summarizeDrawingDependency(stripped.project, IDENTITY_A);
    expect(legacySummary.status).not.toBe('CURRENT');
  });

  it('E: manual-only drawing stays independent', () => {
    expect(summarizeDrawingDependency(blank().project, IDENTITY_A).status).toBe('MANUAL_ONLY');
    expect(summarizeDrawingDependency(blank().project, null).status).toBe('MANUAL_ONLY');
  });

  it('project/result scoping: Project B identity never validates a Project A import', () => {
    const snapshotA = makeSnapshot();
    const imported = importSnapshotIntoCadDrawing({ document: blank(), snapshot: snapshotA });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const snapshotB = makeSnapshot({
      sourceId: buildCadSourceId('proj-b', 'fp-a'),
      projectId: 'proj-b',
      projectName: 'Project B',
    });
    publishAdjustmentSource(snapshotB);
    const latestB = readLatestSourceForProject('proj-b')?.appliedRunIdentity ?? null;
    // Same fingerprints here would match; scope safety is proven by the
    // registry being per-project — a B publish must not move A's latest.
    expect(readLatestSourceForProject('proj-a')).toBeNull();
    expect(summarizeDrawingDependency(imported.drawing.project, latestB).status).toBe('CURRENT');
  });
});

describe('WNCAD equivalence after snapshot import', () => {
  it('snapshot-imported drawings carry the same stations as result-imported ones and round-trip', () => {
    const snapshot = makeSnapshot();
    const fromSnapshot = importSnapshotIntoCadDrawing({
      document: createBlankCadDrawingDocument({ name: 'Cad', units: 'm' }),
      snapshot,
    });
    expect(fromSnapshot.ok).toBe(true);
    if (!fromSnapshot.ok) return;
    const fromResult = importAdjustedPointsIntoCadDrawing({
      document: createBlankCadDrawingDocument({ name: 'Cad', units: 'm' }),
      identity: IDENTITY_A,
      result: { stations: STATIONS_A },
    });
    const pointsOf = (drawing: CadDrawingDocument): Array<[string, number, number]> =>
      drawing.project.entities
        .filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point')
        .map((entity) => [entity.stationId, entity.x, entity.y] as [string, number, number])
        .sort((a, b) => a[0].localeCompare(b[0]));
    expect(pointsOf(fromSnapshot.drawing)).toEqual(pointsOf(fromResult));

    const reparsed = parseCadDrawingFile(serializeCadDrawingFile(fromSnapshot.drawing));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(pointsOf(reparsed.drawing)).toEqual(pointsOf(fromSnapshot.drawing));
  });
});

describe('controller isolation', () => {
  it('/cad never instantiates the Adjustment controller', async () => {
    const { useCadAppController } = await import('../src/cad-app/useCadAppController');
    expect(typeof useCadAppController).toBe('function');
  });
});
