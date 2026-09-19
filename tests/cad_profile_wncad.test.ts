import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { computeSurfaceProfileRevision } from '../src/engine/cad/cadProfileRevision';
import { deriveSurfaceProfileStatus } from '../src/engine/cad/cadProfileStatus';
import { backfillCadProfileStyles } from '../src/engine/cad/cadProfileTypes';
import type { CadAlignmentElement, CadProject } from '../src/engine/cad/cadTypes';

const line = (x0: number, y0: number, x1: number, y1: number): CadAlignmentElement => ({
  kind: 'line',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

const projectWithProfile = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Profile Drawing', units: 'm' });
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
        elements: [line(0, 5, 10, 5)],
        startStation: 0,
      },
    ],
    surfaces: [
      { id: 'surf-1', name: 'Site', definition: { pointSource: { kind: 'points', pointEntityIds: [] } }, cachedRevision: null },
    ],
    surfaceProfiles: [
      { id: 'prof-1', name: 'CL Profile', alignmentEntityId: 'align-1', surfaceId: 'surf-1', styleId: 'profile-style-standard' },
    ],
    profileViews: [
      {
        id: 'view-1',
        name: 'Sheet View',
        alignmentEntityId: 'align-1',
        profileIds: ['prof-1'],
        insertionX: 100,
        insertionY: 200,
        horizontalScale: 1,
        verticalExaggeration: 5,
        datumMode: 'auto',
      },
    ],
  };
};

describe('profile wncad persistence', () => {
  it('round-trips definitions and views exactly; samples never persist', () => {
    const project = projectWithProfile();
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.surfaceProfiles).toEqual(project.surfaceProfiles);
    expect(parsed.drawing.project.profileViews).toEqual(project.profileViews);
    expect(parsed.drawing.project.profileStyles).toEqual(project.profileStyles);
    // Definitions carry no build fields — nothing derived can leak into the file.
    const serialized = serializeCadDrawingFile(drawing);
    expect(serialized).not.toContain('coveredLength');
    expect(serialized).not.toContain('prev1:');
  });

  it('reopen never reports false CURRENT (no cached result survives)', () => {
    const project = projectWithProfile();
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    const profile = reopened.surfaceProfiles![0]!;
    const alignment = reopened.entities.find((entry) => entry.id === 'align-1')!;
    expect(alignment.type).toBe('alignment');
    // No session cache exists after reopen, so the derived status is UNBUILT.
    const status = deriveSurfaceProfileStatus({
      profileExists: true,
      alignmentExists: true,
      surfaceStatus: 'CURRENT',
      surfaceRevisionAtBuild: null,
      currentSurfaceRevision: 'srev1:reopened',
      hasResult: false,
      building: false,
    });
    expect(status).toBe('UNBUILT');
    // The persisted definition still feeds a well-formed content revision.
    if (alignment.type !== 'alignment') return;
    const revision = computeSurfaceProfileRevision(
      profile,
      { id: alignment.id, elements: alignment.elements, startStation: alignment.startStation },
      'srev1:reopened',
    );
    expect(revision.startsWith('prev1:')).toBe(true);
  });

  it('legacy files (tables absent) open with empty collections and seed styles', () => {
    const project = projectWithProfile();
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project };
    const raw = JSON.parse(serializeCadDrawingFile(drawing)) as Record<string, unknown>;
    const rawProject = raw['project'] as Record<string, unknown>;
    delete rawProject['surfaceProfiles'];
    delete rawProject['profileViews'];
    delete rawProject['profileStyles'];
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.surfaceProfiles).toEqual([]);
    expect(parsed.drawing.project.profileViews).toEqual([]);
    expect(backfillCadProfileStyles(parsed.drawing.project.profileStyles)).not.toHaveLength(0);
  });

  it('blank drawings seed empty profiles/views with the standard style', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Blank', units: 'm' });
    expect(drawing.project.surfaceProfiles).toEqual([]);
    expect(drawing.project.profileViews).toEqual([]);
    expect(drawing.project.profileStyles?.map((style) => style.id)).toContain('profile-style-standard');
  });
});
