import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import { buildCadProjectSignature } from '../src/engine/cad/cadProjectState';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import {
  backfillVolumeSurfaceStyles,
  deriveVolumeSurfaceStatus,
} from '../src/engine/cad/cadVolumeSurfaces';
import { createCadSurfaceVolumeCache } from '../src/engine/cad/surfaceVolumeCache';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';

const point = (id: string, stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
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

const baseProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Volume Drawing', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('b1', 'B1', 0, 0, 0),
      point('b2', 'B2', 10, 0, 0),
      point('b3', 'B3', 10, 10, 0),
      point('c1', 'C1', 0, 0, 2),
      point('c2', 'C2', 10, 0, 2),
      point('c3', 'C3', 10, 10, 2),
    ],
  };
};

const projectWithVolume = (): CadProject => {
  let history = createCadHistoryState(baseProject());
  history = runCadCommand(history, {
    key: 'SURFACE_CREATE',
    name: 'Base',
    pointSource: { kind: 'points', pointEntityIds: ['b1', 'b2', 'b3'] },
  });
  history = runCadCommand(history, {
    key: 'SURFACE_CREATE',
    name: 'Comparison',
    pointSource: { kind: 'points', pointEntityIds: ['c1', 'c2', 'c3'] },
  });
  const ids = history.present.project.surfaces!.map((surface) => surface.id);
  history = runCadCommand(history, {
    key: 'VOLUME_SURFACE_CREATE',
    name: 'Earthwork',
    baseSurfaceId: ids[0]!,
    comparisonSurfaceId: ids[1]!,
  });
  return history.present.project;
};

describe('CAD volume surface WNCAD persistence', () => {
  it('round-trips volume relationships + styles identically', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Volume Drawing', units: 'm' });
    const project = projectWithVolume();
    expect(project.volumeSurfaces).toHaveLength(1);
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.volumeSurfaces).toEqual(project.volumeSurfaces);
    expect(parsed.drawing.project.volumeSurfaceStyles).toEqual(project.volumeSurfaceStyles);
  });

  it('opens legacy drawings (no volume tables) with empty volumes + seed styles', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Legacy', units: 'm' });
    const raw = JSON.parse(serializeCadDrawingFile(drawing)) as Record<string, unknown>;
    const project = raw['project'] as Record<string, unknown>;
    delete project['volumeSurfaces'];
    delete project['volumeSurfaceStyles'];
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.volumeSurfaces).toEqual([]);
    const seeds = backfillVolumeSurfaceStyles(parsed.drawing.project.volumeSurfaceStyles);
    expect(seeds.map((style) => style.name)).toEqual(['Cut/Fill', 'Cut Only', 'Fill Only', 'No Display']);
  });

  it('never persists derived results: reopen derives non-CURRENT volume status', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Volume Drawing', units: 'm' });
    const project = projectWithVolume();
    const volume = project.volumeSurfaces![0]!;
    const cache = createCadSurfaceVolumeCache('test');
    cache.set(volume.id, {
      baseSurfaceId: volume.baseSurfaceId,
      comparisonSurfaceId: volume.comparisonSurfaceId,
      revision: 'vrev1:deadbeef',
      overlapArea: 100,
      cutArea: 100,
      fillArea: 0,
      cutVolume: 100,
      fillVolume: 0,
      netVolume: -100,
      averageCutDepth: 1,
      averageFillDepth: 0,
      maxCutDepth: 1,
      maxFillDepth: 0,
      minDelta: -1,
      maxDelta: 0,
      baseArea: 50,
      comparisonArea: 50,
      stats: {},
    });
    const text = serializeCadDrawingFile({ ...drawing, project });
    expect(text.includes('vrev1')).toBe(false);
    expect(text.includes('volumeResult')).toBe(false);
    const parsed = parseCadDrawingFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    const reopenedVolume = reopened.volumeSurfaces![0]!;
    expect(reopenedVolume).not.toHaveProperty('revision');
    expect(reopened.surfaces!.every((surface) => surface.cachedRevision == null)).toBe(true);
    expect(
      deriveVolumeSurfaceStatus(reopened, reopenedVolume, { building: false, result: null }),
    ).toBe('SOURCE_NOT_CURRENT');
  });

  it('keeps persistence signatures settled across clone (key order)', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Volume Drawing', units: 'm' });
    const project = projectWithVolume();
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    expect(buildCadProjectSignature(cloneCadProject(reopened))).toBe(buildCadProjectSignature(reopened));
    expect(Object.keys(cloneCadProject(reopened))).toEqual(Object.keys(reopened));
  });

  it('Save As copies share no aliases with the original drawing', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Volume Drawing', units: 'm' });
    const text = serializeCadDrawingFile({ ...drawing, project: projectWithVolume() });
    const first = parseCadDrawingFile(text);
    const second = parseCadDrawingFile(text);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    first.drawing.project.volumeSurfaces![0]!.name = 'Mutated';
    first.drawing.project.volumeSurfaceStyles![0]!.name = 'Mutated Style';
    expect(second.drawing.project.volumeSurfaces![0]!.name).toBe('Earthwork');
    expect(second.drawing.project.volumeSurfaceStyles![0]!.name).toBe('Cut/Fill');
  });
});
