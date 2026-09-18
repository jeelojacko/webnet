import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import {
  backfillVolumeSurfaceStyles,
  computeVolumeSurfaceRevision,
  VOLUME_STYLE_CUT_FILL_ID,
  VOLUME_STYLE_NONE_ID,
} from '../src/engine/cad/cadVolumeSurfaces';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
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

const projectWithSurfaces = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Volumes', units: 'm' });
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
    surfaces: [
      { id: 'base-1', name: 'Base', definition: { pointSource: { kind: 'points', pointEntityIds: ['b1', 'b2', 'b3'] } }, cachedRevision: null },
      { id: 'cmp-1', name: 'Comparison', definition: { pointSource: { kind: 'points', pointEntityIds: ['c1', 'c2', 'c3'] } }, cachedRevision: null },
    ],
  };
};

const withVolume = () => {
  let history = createCadHistoryState(projectWithSurfaces());
  history = runCadCommand(history, {
    key: 'VOLUME_SURFACE_CREATE',
    name: 'Earthwork',
    baseSurfaceId: 'base-1',
    comparisonSurfaceId: 'cmp-1',
    styleId: VOLUME_STYLE_CUT_FILL_ID,
  });
  return history;
};

describe('volume surface transactions', () => {
  it('creates a volume and validates base/comparison existence + difference', () => {
    const history = withVolume();
    expect(history.present.project.volumeSurfaces).toHaveLength(1);
    const base = createCadHistoryState(projectWithSurfaces());
    const same = runCadCommand(base, {
      key: 'VOLUME_SURFACE_CREATE',
      name: 'Bad',
      baseSurfaceId: 'base-1',
      comparisonSurfaceId: 'base-1',
    });
    expect(same).toBe(base);
    const missing = runCadCommand(base, {
      key: 'VOLUME_SURFACE_CREATE',
      name: 'Bad',
      baseSurfaceId: 'base-1',
      comparisonSurfaceId: 'nope',
    });
    expect(missing).toBe(base);
  });

  it('updates sources and rejects a self-referencing update', () => {
    let history = withVolume();
    const volumeId = history.present.project.volumeSurfaces![0]!.id;
    const bad = runCadCommand(history, {
      key: 'VOLUME_SURFACE_UPDATE_SOURCES',
      volumeSurfaceId: volumeId,
      baseSurfaceId: 'base-1',
      comparisonSurfaceId: 'base-1',
    });
    expect(bad).toBe(history);
    history = runCadCommand(history, {
      key: 'VOLUME_SURFACE_UPDATE_SOURCES',
      volumeSurfaceId: volumeId,
      baseSurfaceId: 'cmp-1',
      comparisonSurfaceId: 'base-1',
    });
    expect(history.present.project.volumeSurfaces![0]!.baseSurfaceId).toBe('cmp-1');
    expect(history.present.project.volumeSurfaces![0]!.comparisonSurfaceId).toBe('base-1');
  });

  it('undoes and redoes a source update', () => {
    let history = withVolume();
    const volumeId = history.present.project.volumeSurfaces![0]!.id;
    // Add a third surface to swap to.
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE',
      name: 'Third',
      pointSource: { kind: 'points', pointEntityIds: ['b1', 'b2', 'c3'] },
    });
    const thirdId = history.present.project.surfaces!.find((surface) => surface.name === 'Third')!.id;
    history = runCadCommand(history, {
      key: 'VOLUME_SURFACE_UPDATE_SOURCES',
      volumeSurfaceId: volumeId,
      baseSurfaceId: 'base-1',
      comparisonSurfaceId: thirdId,
    });
    expect(history.present.project.volumeSurfaces![0]!.comparisonSurfaceId).toBe(thirdId);
    history = undoCadHistory(history);
    expect(history.present.project.volumeSurfaces![0]!.comparisonSurfaceId).toBe('cmp-1');
    history = redoCadHistory(history);
    expect(history.present.project.volumeSurfaces![0]!.comparisonSurfaceId).toBe(thirdId);
  });

  it('blocks volume delete + source edits while the volume layer is locked', () => {
    let history = withVolume();
    const volumeId = history.present.project.volumeSurfaces![0]!.id;
    history = runCadCommand(history, { key: 'LAYER_LOCKED', layerId: 'general', locked: true });
    const locked = history;
    expect(
      runCadCommand(locked, { key: 'VOLUME_SURFACE_DELETE', volumeSurfaceId: volumeId }),
    ).toBe(locked);
    expect(
      runCadCommand(locked, {
        key: 'VOLUME_SURFACE_UPDATE_SOURCES',
        volumeSurfaceId: volumeId,
        baseSurfaceId: 'cmp-1',
        comparisonSurfaceId: 'base-1',
      }),
    ).toBe(locked);
  });

  it('gates style delete by refcount with a replacement rewire', () => {
    let history = withVolume();
    const volumeId = history.present.project.volumeSurfaces![0]!.id;
    const blocked = runCadCommand(history, { key: 'VOLUME_STYLE_DELETE', styleId: VOLUME_STYLE_CUT_FILL_ID });
    expect(blocked).toBe(history);
    history = runCadCommand(history, {
      key: 'VOLUME_STYLE_DELETE',
      styleId: VOLUME_STYLE_CUT_FILL_ID,
      replacementId: VOLUME_STYLE_NONE_ID,
    });
    expect(history.present.project.volumeSurfaceStyles!.some((style) => style.id === VOLUME_STYLE_CUT_FILL_ID)).toBe(false);
    expect(history.present.project.volumeSurfaces!.find((volume) => volume.id === volumeId)!.styleId).toBe(
      VOLUME_STYLE_NONE_ID,
    );
  });

  it('never deletes the last remaining volume style', () => {
    let history = createCadHistoryState(projectWithSurfaces());
    for (const styleId of [VOLUME_STYLE_CUT_FILL_ID, VOLUME_STYLE_NONE_ID]) {
      history = runCadCommand(history, { key: 'VOLUME_STYLE_DELETE', styleId });
    }
    const seeds = backfillVolumeSurfaceStyles(undefined).map((style) => style.id);
    for (const styleId of seeds.filter((id) => ![VOLUME_STYLE_CUT_FILL_ID, VOLUME_STYLE_NONE_ID].includes(id))) {
      history = runCadCommand(history, { key: 'VOLUME_STYLE_DELETE', styleId });
    }
    expect(history.present.project.volumeSurfaceStyles).toHaveLength(1);
    const lastId = history.present.project.volumeSurfaceStyles![0]!.id;
    const same = runCadCommand(history, { key: 'VOLUME_STYLE_DELETE', styleId: lastId });
    expect(same).toBe(history);
  });

  it('validates style patches and applies display-only updates', () => {
    let history = createCadHistoryState(projectWithSurfaces());
    const bad = runCadCommand(history, {
      key: 'VOLUME_STYLE_UPDATE',
      styleId: VOLUME_STYLE_CUT_FILL_ID,
      patch: { opacity: 2 },
    });
    expect(bad).toBe(history);
    history = runCadCommand(history, {
      key: 'VOLUME_STYLE_UPDATE',
      styleId: VOLUME_STYLE_CUT_FILL_ID,
      patch: { showFill: false, fillColor: '#000000' },
    });
    const style = history.present.project.volumeSurfaceStyles!.find((entry) => entry.id === VOLUME_STYLE_CUT_FILL_ID)!;
    expect(style.showFill).toBe(false);
    expect(style.fillColor).toBe('#000000');
  });

  it('style changes never move the volume revision', () => {
    let history = withVolume();
    const volume = history.present.project.volumeSurfaces![0]!;
    const before = computeVolumeSurfaceRevision({
      baseId: volume.baseSurfaceId,
      baseRev: computeCadSurfaceSourceRevision(history.present.project, history.present.project.surfaces![0]!),
      cmpId: volume.comparisonSurfaceId,
      cmpRev: computeCadSurfaceSourceRevision(history.present.project, history.present.project.surfaces![1]!),
    });
    history = runCadCommand(history, {
      key: 'VOLUME_STYLE_UPDATE',
      styleId: VOLUME_STYLE_CUT_FILL_ID,
      patch: { opacity: 0.9, cutColor: '#111111' },
    });
    const after = computeVolumeSurfaceRevision({
      baseId: volume.baseSurfaceId,
      baseRev: computeCadSurfaceSourceRevision(history.present.project, history.present.project.surfaces![0]!),
      cmpId: volume.comparisonSurfaceId,
      cmpRev: computeCadSurfaceSourceRevision(history.present.project, history.present.project.surfaces![1]!),
    });
    expect(after).toBe(before);
  });
});
