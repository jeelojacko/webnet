/**
 * Phase 18L — Export Center LandXML per-class summary + stale civil blocking.
 *
 * Verifies the preview reports Points/Parcels/Alignments/TIN Surfaces/
 * Surface Profiles/Cross Sections (nothing silently absent) and that stale
 * civil objects are blocked with a reason.
 */
import { describe, expect, it } from 'vitest';

import { buildExportCenterPreview } from '../../src/engine/cad/exportCenter';
import { createCadSurfaceCache } from '../../src/engine/cad/cadSurfaceCache';
import type { CadDrawingDocument } from '../../src/engine/cad/cadTypes';
import { buildCorridorSurfaceProject, makeCurrentSurface } from '../landxmlCivilFixtures';

const drawingOf = (project: CadDrawingDocument['project']): CadDrawingDocument => ({
  kind: 'webnet-cad-drawing',
  schemaVersion: 2,
  drawingId: 'drawing-18l',
  name: 'Civil 18L',
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
  units: 'm',
  project,
});

describe('Export Center LandXML civil summary (18L)', () => {
  it('reports every civil class and exports a CURRENT surface', () => {
    const { project, surfaceId } = buildCorridorSurfaceProject();
    const current = makeCurrentSurface(project, surfaceId);
    const outcome = buildExportCenterPreview(
      drawingOf(current.project),
      { format: 'landxml' },
      undefined,
      { surfaceCache: current.cache },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const summary = outcome.preview.classSummary ?? [];
    expect(summary.map((entry) => entry.label)).toEqual([
      'Points',
      'Parcels',
      'Alignments',
      'TIN Surfaces',
      'Surface Profiles',
      'Cross Sections',
    ]);
    const surfaces = summary.find((entry) => entry.id === 'surfaces')!;
    expect(surfaces.exported).toBe(1);
    expect(surfaces.blocked).toBe(0);
    expect(outcome.preview.payload as string).toContain('<Surface name="Corridor TIN"');
  });

  it('blocks a stale surface with a reason and no stale triangles', () => {
    const { project, surfaceId } = buildCorridorSurfaceProject();
    const current = makeCurrentSurface(project, surfaceId);
    const staleProject = {
      ...current.project,
      surfaces: (current.project.surfaces ?? []).map((surface) =>
        surface.id === surfaceId ? { ...surface, cachedRevision: 'srev1:stale' } : surface,
      ),
    };
    const outcome = buildExportCenterPreview(drawingOf(staleProject), { format: 'landxml' }, undefined, {
      surfaceCache: createCadSurfaceCache('empty'),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const surfaces = (outcome.preview.classSummary ?? []).find((entry) => entry.id === 'surfaces')!;
    expect(surfaces.blocked).toBe(1);
    expect(surfaces.exported).toBe(0);
    expect(outcome.preview.warnings.some((warning) => warning.message.includes('LANDXML_SURFACE_NOT_CURRENT'))).toBe(true);
    expect(outcome.preview.payload as string).not.toContain('<Surface ');
  });

  it('leaves a civil-free drawing without new civil warnings', () => {
    const { project } = buildCorridorSurfaceProject();
    const pointsOnly = { ...project, surfaces: [] };
    const outcome = buildExportCenterPreview(drawingOf(pointsOnly), { format: 'landxml' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.preview.warnings).toEqual([]);
    const surfaces = (outcome.preview.classSummary ?? []).find((entry) => entry.id === 'surfaces')!;
    expect(surfaces).toMatchObject({ exported: 0, blocked: 0, omitted: 0, unsupported: 0 });
  });
});
