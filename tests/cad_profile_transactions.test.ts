import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadAlignmentElement, CadProject } from '../src/engine/cad/cadTypes';

const line = (x0: number, y0: number, x1: number, y1: number): CadAlignmentElement => ({
  kind: 'line',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

const baseProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Profile Tx', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      {
        id: 'align-1',
        type: 'alignment',
        layerId: 'general',
        visible: true,
        locked: false,
        name: 'CL',
        elements: [line(0, 0, 10, 0)],
        startStation: 0,
      },
    ],
    surfaces: [
      { id: 'surf-1', name: 'Existing', definition: { pointSource: { kind: 'points', pointEntityIds: [] } }, cachedRevision: null },
      { id: 'surf-2', name: 'Proposed', definition: { pointSource: { kind: 'points', pointEntityIds: [] } }, cachedRevision: null },
    ],
  };
};

const profileIdOf = (project: CadProject): string => {
  expect(project.surfaceProfiles).toHaveLength(1);
  return project.surfaceProfiles![0]!.id;
};

describe('profile transactions', () => {
  it('PROFILE_CREATE lifecycle is undoable', () => {
    let history = createCadHistoryState(baseProject());
    history = runCadCommand(history, {
      key: 'PROFILE_CREATE',
      name: 'CL Profile',
      alignmentEntityId: 'align-1',
      surfaceId: 'surf-1',
    });
    const profileId = profileIdOf(history.present.project);
    expect(history.present.project.surfaceProfiles![0]).toMatchObject({
      alignmentEntityId: 'align-1',
      surfaceId: 'surf-1',
    });
    history = undoCadHistory(history);
    expect(history.present.project.surfaceProfiles ?? []).toHaveLength(0);
    history = redoCadHistory(history);
    expect(history.present.project.surfaceProfiles![0]!.id).toBe(profileId);
  });

  it('PROFILE_CREATE rejects broken refs and duplicate names', () => {
    let history = createCadHistoryState(baseProject());
    const before = history;
    history = runCadCommand(history, {
      key: 'PROFILE_CREATE',
      alignmentEntityId: 'missing-align',
      surfaceId: 'surf-1',
    });
    expect(history.present.project.surfaceProfiles ?? []).toHaveLength(0);
    history = runCadCommand(history, {
      key: 'PROFILE_CREATE',
      alignmentEntityId: 'align-1',
      surfaceId: 'missing-surf',
    });
    expect(history.present.project.surfaceProfiles ?? []).toHaveLength(0);
    expect(history).toBe(before);
    history = runCadCommand(history, { key: 'PROFILE_CREATE', name: 'P', alignmentEntityId: 'align-1', surfaceId: 'surf-1' });
    const again = history;
    history = runCadCommand(history, { key: 'PROFILE_CREATE', name: 'P', alignmentEntityId: 'align-1', surfaceId: 'surf-1' });
    expect(history.present.project.surfaceProfiles).toHaveLength(1);
    expect(history).toBe(again);
  });

  it('PROFILE_REBUILD rebinds the surface; broken refs are rejected', () => {
    let history = createCadHistoryState(baseProject());
    history = runCadCommand(history, {
      key: 'PROFILE_CREATE',
      alignmentEntityId: 'align-1',
      surfaceId: 'surf-1',
    });
    const profileId = profileIdOf(history.present.project);
    history = runCadCommand(history, { key: 'PROFILE_REBUILD', profileId, surfaceId: 'surf-2' });
    expect(history.present.project.surfaceProfiles![0]!.surfaceId).toBe('surf-2');
    const before = history;
    history = runCadCommand(history, { key: 'PROFILE_REBUILD', profileId, surfaceId: 'missing-surf' });
    expect(history.present.project.surfaceProfiles![0]!.surfaceId).toBe('surf-2');
    expect(history).toBe(before);
    history = undoCadHistory(history);
    expect(history.present.project.surfaceProfiles![0]!.surfaceId).toBe('surf-1');
  });

  it('PROFILE_DELETE prunes view membership; views survive', () => {
    let history = createCadHistoryState(baseProject());
    history = runCadCommand(history, {
      key: 'PROFILE_CREATE',
      alignmentEntityId: 'align-1',
      surfaceId: 'surf-1',
    });
    const profileId = profileIdOf(history.present.project);
    history = runCadCommand(history, {
      key: 'PROFILE_VIEW_CREATE',
      name: 'Sheet',
      alignmentEntityId: 'align-1',
      profileIds: [profileId],
      insertionX: 0,
      insertionY: 0,
    });
    expect(history.present.project.profileViews![0]!.profileIds).toEqual([profileId]);
    history = runCadCommand(history, { key: 'PROFILE_DELETE', profileId });
    expect(history.present.project.surfaceProfiles ?? []).toHaveLength(0);
    expect(history.present.project.profileViews).toHaveLength(1);
    expect(history.present.project.profileViews![0]!.profileIds).toEqual([]);
    history = undoCadHistory(history);
    expect(history.present.project.surfaceProfiles).toHaveLength(1);
    expect(history.present.project.profileViews![0]!.profileIds).toEqual([profileId]);
  });

  it('PROFILE_VIEW_CREATE rejects broken member refs; delete is undoable', () => {
    let history = createCadHistoryState(baseProject());
    history = runCadCommand(history, {
      key: 'PROFILE_CREATE',
      alignmentEntityId: 'align-1',
      surfaceId: 'surf-1',
    });
    const before = history;
    history = runCadCommand(history, {
      key: 'PROFILE_VIEW_CREATE',
      alignmentEntityId: 'align-1',
      profileIds: ['missing-profile'],
    });
    expect(history.present.project.profileViews ?? []).toHaveLength(0);
    expect(history).toBe(before);
    history = runCadCommand(history, {
      key: 'PROFILE_VIEW_CREATE',
      name: 'Sheet',
      alignmentEntityId: 'align-1',
      profileIds: [profileIdOf(history.present.project)],
      horizontalScale: 2,
      verticalExaggeration: 5,
      datumMode: 'explicit',
      datumElevation: 100,
    });
    const viewId = history.present.project.profileViews![0]!.id;
    expect(history.present.project.profileViews![0]).toMatchObject({
      horizontalScale: 2,
      verticalExaggeration: 5,
      datumElevation: 100,
    });
    history = runCadCommand(history, { key: 'PROFILE_VIEW_DELETE', viewId });
    expect(history.present.project.profileViews ?? []).toHaveLength(0);
    history = undoCadHistory(history);
    expect(history.present.project.profileViews![0]!.id).toBe(viewId);
  });

  it('PROFILE_VIEW_UPDATE is display-only, undoable, and LOCK-gated', () => {
    let history = createCadHistoryState(baseProject());
    history = runCadCommand(history, {
      key: 'PROFILE_CREATE',
      alignmentEntityId: 'align-1',
      surfaceId: 'surf-1',
    });
    history = runCadCommand(history, {
      key: 'PROFILE_VIEW_CREATE',
      name: 'Sheet',
      alignmentEntityId: 'align-1',
      profileIds: [profileIdOf(history.present.project)],
    });
    const viewId = history.present.project.profileViews![0]!.id;
    history = runCadCommand(history, {
      key: 'PROFILE_VIEW_UPDATE',
      viewId,
      patch: { horizontalScale: 2, verticalExaggeration: 5, datumMode: 'auto', datumStep: 2 },
    });
    expect(history.present.project.profileViews![0]).toMatchObject({
      horizontalScale: 2,
      verticalExaggeration: 5,
      datumStep: 2,
    });
    // Definition untouched: members/alignment identical (no revision impact).
    expect(history.present.project.profileViews![0]!.profileIds).toHaveLength(1);
    history = undoCadHistory(history);
    expect(history.present.project.profileViews![0]).toMatchObject({
      horizontalScale: 1,
      verticalExaggeration: 1,
    });
    const before = history;
    history = runCadCommand(history, {
      key: 'PROFILE_VIEW_UPDATE',
      viewId,
      patch: { horizontalScale: 0 },
    });
    expect(history).toBe(before);
    history = runCadCommand(history, {
      key: 'PROFILE_VIEW_UPDATE',
      viewId,
      patch: { datumMode: 'explicit' },
    });
    expect(history).toBe(before);
  });

  it('PROFILE_STYLE CRUD is refcount-guarded', () => {
    let history = createCadHistoryState(baseProject());
    history = runCadCommand(history, {
      key: 'PROFILE_STYLE_CREATE',
      style: { id: 'style-a', name: 'A', color: '#ff0000', lineweight: 0.5, opacity: 0 },
    });
    expect(history.present.project.profileStyles!.map((style) => style.id)).toContain('style-a');
    history = runCadCommand(history, {
      key: 'PROFILE_STYLE_DUPLICATE',
      styleId: 'style-a',
      newId: 'style-b',
      name: 'B',
    });
    history = runCadCommand(history, { key: 'PROFILE_STYLE_RENAME', styleId: 'style-b', name: 'B2' });
    expect(history.present.project.profileStyles!.find((style) => style.id === 'style-b')!.name).toBe('B2');
    history = runCadCommand(history, {
      key: 'PROFILE_STYLE_UPDATE',
      styleId: 'style-b',
      patch: { color: '#00ff00' },
    });
    expect(history.present.project.profileStyles!.find((style) => style.id === 'style-b')!.color).toBe('#00ff00');

    // Reference style-b from a profile, then delete without replacement: blocked.
    history = runCadCommand(history, {
      key: 'PROFILE_CREATE',
      name: 'Styled',
      alignmentEntityId: 'align-1',
      surfaceId: 'surf-1',
      styleId: 'style-b',
    });
    const before = history;
    history = runCadCommand(history, { key: 'PROFILE_STYLE_DELETE', styleId: 'style-b' });
    expect(history.present.project.profileStyles!.map((style) => style.id)).toContain('style-b');
    expect(history).toBe(before);
    // Delete with replacement rewires the profile ref.
    history = runCadCommand(history, {
      key: 'PROFILE_STYLE_DELETE',
      styleId: 'style-b',
      replacementId: 'style-a',
    });
    expect(history.present.project.profileStyles!.map((style) => style.id)).not.toContain('style-b');
    expect(history.present.project.surfaceProfiles![0]!.styleId).toBe('style-a');
  });
});
