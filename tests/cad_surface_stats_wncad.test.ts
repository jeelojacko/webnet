import { describe, expect, it } from 'vitest';

import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { resolveContourDisplay } from '../src/engine/cad/cadSurfaceContourView';
import { backfillCadSurfaceStyles } from '../src/engine/cad/cadSurfaceStyles';
import { deriveSurfaceStatus } from '../src/engine/cad/cadSurfaces';
import {
  applySurfaceBuildSuccess,
  createCadSurfaceCache,
} from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurfaceSnapshot } from '../src/cad-app/shell/cadSurfaceSnapshot';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildExportSheetScene } from '../src/engine/cad/cadExportScene';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import type {
  CadProject,
  CadSurfaceStyle,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import { buildCadQaDraft, buildCadQaProject } from './fixtures/cadQaDrawing';

const point = (
  id: string,
  stationId: string,
  x: number,
  y: number,
  z: number,
): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

/** Single tilted triangle: plan 50, 3D 50√2, mean z 10/3, unit slope. */
const tiltedProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Stats', units: 'm' });
  return {
    ...drawing.project,
    entities: [point('pt-1', 'A', 0, 0, 0), point('pt-2', 'B', 10, 0, 0), point('pt-3', 'C', 0, 10, 10)],
    surfaces: [
      {
        id: 'surf-1',
        name: 'Site',
        definition: { pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3'] } },
        cachedRevision: null,
      },
    ],
  };
};

describe('surface enhanced stats', () => {
  it('reports 3D area, weighted mean elevation, and face-slope stats', () => {
    const project = tiltedProject();
    const result = buildCadSurface(project, project.surfaces![0]!);
    expect(result.outcome).toBe('ok');
    expect(result.stats.planimetricArea).toBeCloseTo(50, 9);
    expect(result.stats.surface3DArea).toBeCloseTo(50 * Math.SQRT2, 9);
    expect(result.stats.surface3DArea).toBeGreaterThan(result.stats.planimetricArea);
    expect(result.stats.meanElevation).toBeCloseTo(10 / 3, 9);
    expect(result.stats.minFaceSlopeRatio).toBeCloseTo(1, 9);
    expect(result.stats.maxFaceSlopeRatio).toBeCloseTo(1, 9);
    expect(result.stats.meanFaceSlopeRatio).toBeCloseTo(1, 9);
  });

  it('snapshot surfaces Planimetric vs 3D distinctly with slope percents', () => {
    const project = tiltedProject();
    const cache = createCadSurfaceCache('stats');
    const surface = project.surfaces![0]!;
    const result = buildCadSurface(project, surface);
    expect(result.outcome).toBe('ok');
    const current = applySurfaceBuildSuccess(project, cache, surface.id, result.revision, result);
    const snapshot = buildCadSurfaceSnapshot(current, cache, null);
    const stats = snapshot.surfaces[0]!.stats!;
    expect(stats.area).toBeCloseTo(50, 9);
    expect(stats.area3D).toBeCloseTo(50 * Math.SQRT2, 9);
    expect(stats.meanElevation).toBeCloseTo(10 / 3, 9);
    expect(stats.minSlopePercent).toBeCloseTo(100, 9);
    expect(stats.meanSlopePercent).toBeCloseTo(100, 9);
    expect(stats.maxSlopePercent).toBeCloseTo(100, 9);
    expect(stats.meanSlopeAngleDeg).toBeCloseTo(45, 9);
  });
});

describe('surface style WNCAD persistence', () => {
  const contourStyle = (): CadSurfaceStyle => ({
    id: 'style-contours',
    name: 'Contours',
    showTriangles: false,
    showContours: true,
    minorContourInterval: 0.5,
    majorContourEvery: 4,
    contourBaseElevation: 100,
    minorContour: { color: '#aaaaaa', lineweight: 1 },
    majorContour: { color: '#ffffff', lineweight: 2 },
    showContourLabels: true,
    labelMajorOnly: false,
    contourLabelSpacing: 25,
    contourLabelPrecision: 2,
  });

  it('round-trips new contour style settings identically', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Styles', units: 'm' });
    const project: CadProject = {
      ...tiltedProject(),
      surfaceStyles: [...backfillCadSurfaceStyles(undefined), contourStyle()],
    };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.surfaceStyles).toEqual(project.surfaceStyles);
    const revived = parsed.drawing.project.surfaceStyles!.find((s) => s.id === 'style-contours')!;
    expect(resolveContourDisplay(revived, '#38bdf8')).not.toBeNull();
    expect(resolveContourDisplay(revived, '#38bdf8')).toMatchObject({
      minorInterval: 0.5,
      majorEvery: 4,
      baseElevation: 100,
    });
  });

  it('legacy styles without contour fields show no contours (safe backfill)', () => {
    const legacy: CadSurfaceStyle = { id: 'legacy', name: 'Legacy' };
    expect(resolveContourDisplay(legacy, '#38bdf8')).toBeNull();
    expect(resolveContourDisplay({ ...legacy, showContours: true }, '#38bdf8')).not.toBeNull();
  });

  it('reopen drops mesh cache (UNBUILT) and rebuilds deterministically', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Reopen', units: 'm' });
    const project = tiltedProject();
    const surface = project.surfaces![0]!;
    const before = buildCadSurface(project, surface);
    expect(before.outcome).toBe('ok');
    const cache = createCadSurfaceCache('reopen');
    const current = applySurfaceBuildSuccess(project, cache, surface.id, before.revision, before);
    expect(deriveSurfaceStatus(current, current.surfaces![0]!)).toBe('CURRENT');
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project: current }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    expect(reopened.surfaces![0]!.cachedRevision).toBeNull();
    expect(deriveSurfaceStatus(reopened, reopened.surfaces![0]!)).toBe('UNBUILT');
    const after = buildCadSurface(reopened, reopened.surfaces![0]!);
    expect(after.outcome).toBe('ok');
    expect(after.triangles).toEqual(before.triangles);
    expect(after.points).toEqual(before.points);
    expect(after.stats).toEqual(before.stats);
  });
});

describe('surface export exclusion', () => {
  it('DXF/SVG scene/LandXML ignore surfaces and contour caches byte-identically', () => {
    const project = buildCadQaProject();
    const { draft, sheetId } = buildCadQaDraft(project);
    const withSurface: CadProject = {
      ...project,
      surfaces: [
        {
          id: 'surf-export',
          name: 'Export Site',
          definition: { pointSource: { kind: 'points', pointEntityIds: [] } },
          cachedRevision: null,
        },
      ],
    };
    const plain = buildExportSheetScene({ draft, sheetId, project }).scene;
    const surfaced = buildExportSheetScene({ draft, sheetId, project: withSurface }).scene;
    expect(surfaced).toEqual(plain);
    expect(
      surfaced.items.some(
        (item) => 'sourceEntityId' in item && item.sourceEntityId === 'surf-export',
      ),
    ).toBe(false);
    expect(buildDxfExportModelWithResult({ project: withSurface }).output).toEqual(
      buildDxfExportModelWithResult({ project }).output,
    );
    expect(buildLandXmlProjectExportWithResult(withSurface, { units: 'm' }).output).toEqual(
      buildLandXmlProjectExportWithResult(project, { units: 'm' }).output,
    );
  });
});
