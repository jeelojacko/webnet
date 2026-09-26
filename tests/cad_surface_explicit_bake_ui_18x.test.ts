import { describe, expect, it } from 'vitest';
import type { CadProject, CadSurface, CadSurfaceDefinition } from '../src/engine/cad/cadTypes';
import {
  buildCadSurfaceSnapshot,
  isBakedTinProvenance,
  shortSurfaceRevision,
  summarizeExplicitTinSource,
  surfaceBakeCapability,
  type CadExplicitTinProvenanceView,
} from '../src/cad-app/shell/cadSurfaceSnapshot';
import { deriveCadSurfaceEditSummaries } from '../src/cad-app/shell/cadSurfaceEditSummaries';
import { bakeCopyFraming, bakeInPlaceWarning } from '../src/cad-app/shell/cadSurfaceBakePrompt';
import { bakedSurfaceDefinition } from '../src/engine/cad/cadExplicitBake';
import { makeWebnetBakeProvenance } from '../src/engine/cad/cadImportedTin';

/**
 * Phase 18X presentation contracts (UI slice): baked variant text (never a
 * fileName fiction), per-kind capability enablement, V-labels for baked refs,
 * and the bake warning/copy framing. Distinct from the engine bake pins.
 */

const baseProject = (): CadProject => ({
  version: 2,
  id: 'test-project',
  name: 'test',
  metadata: {
    source: 'parsed-input',
    runMode: 'unknown',
    units: 'm',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: [],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities: [],
  cogoComputations: [],
  bounds: null,
});

const surfaceWith = (definition: CadSurfaceDefinition, name = 'S'): CadSurface => ({
  id: 'surf-1',
  name,
  definition,
  cachedRevision: null,
});

const explicitSurface = (
  provenance: CadExplicitTinProvenanceView,
  edits: CadSurfaceDefinition['edits'] = [],
): CadSurface => surfaceWith({
  pointSource: { kind: 'points', pointEntityIds: [] },
  sourceKind: 'explicit-tin',
  importedTin: {
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    faces: [0, 1, 2],
    provenance,
  },
  edits,
} as unknown as CadSurfaceDefinition, 'Baked 1');

const importedSurface = (): CadSurface => surfaceWith({
  pointSource: { kind: 'points', pointEntityIds: [] },
  sourceKind: 'imported-tin',
  importedTin: {
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    faces: [0, 1, 2],
    provenance: { format: 'LandXML', fileName: 'edits.xml', surfaceName: 'Imported TIN', sourceId: 'sid' },
  },
});

const snapshotRow = (surface: CadSurface) => {
  const project = baseProject();
  project.surfaces = [surface];
  return buildCadSurfaceSnapshot(project, null, surface.id, {}).surfaces[0]!;
};

describe('explicit-TIN source text (Phase 18X UI)', () => {
  it('renders the baked variant for kind:webnet-bake, never a fileName', () => {
    const summary = summarizeExplicitTinSource(9, 3, {
      kind: 'webnet-bake',
      sourceSurfaceId: 'src-1',
      sourceSurfaceName: 'Design Surface',
      sourceRevision: 'srev1:abcdef0123456789',
    });
    expect(summary.text).toBe(
      'Baked Explicit TIN — 3 vertices, 1 faces (baked from Design Surface, rev srev1:abcdef)',
    );
    expect(summary.bakedFrom).toBe('Design Surface');
    expect(summary.sourceRevision).toBe('srev1:abcdef0123456789');
    expect(summary.text).not.toContain('fileName');
  });

  it('treats format:explicit as baked (forward compatibility)', () => {
    expect(isBakedTinProvenance({ format: 'explicit', surfaceName: 'Legacy Bake' })).toBe(true);
    const summary = summarizeExplicitTinSource(9, 3, { format: 'explicit', surfaceName: 'Legacy Bake' });
    expect(summary.text).toContain('Baked Explicit TIN');
    expect(summary.bakedFrom).toBe('Legacy Bake');
  });

  it('keeps legacy LandXML provenance on the imported wording byte-for-byte', () => {
    const provenance = { format: 'LandXML', fileName: 'x.xml', surfaceName: 'Imported TIN' };
    expect(isBakedTinProvenance(provenance)).toBe(false);
    expect(summarizeExplicitTinSource(9, 3, provenance).text).toBe(
      'Imported LandXML TIN — 3 vertices, 1 faces (file: x.xml, surface: Imported TIN)',
    );
  });

  it('short revision display is the first 12 chars', () => {
    expect(shortSurfaceRevision('srev1:abcdef0123456789')).toBe('srev1:abcdef');
  });
});

describe('snapshot definition summary (Phase 18X UI)', () => {
  it('classifies a baked surface as explicit-tin with origin fields', () => {
    const row = snapshotRow(explicitSurface({
      kind: 'webnet-bake',
      sourceSurfaceId: 'src-1',
      sourceSurfaceName: 'Design Surface',
      sourceRevision: 'srev1:abcdef0123456789',
    }));
    expect(row.definition.sourceKind).toBe('explicit-tin');
    expect(row.definition.importedSourceText).toBe(
      'Baked Explicit TIN — 3 vertices, 1 faces (baked from Design Surface, rev srev1:abcdef)',
    );
    expect(row.definition.bakedFrom).toBe('Design Surface');
    expect(row.definition.sourceRevision).toBe('srev1:abcdef0123456789');
  });

  it('normalizes an explicit-tin payload with LandXML provenance back to imported', () => {
    const row = snapshotRow(explicitSurface({
      format: 'LandXML', fileName: 'legacy.xml', surfaceName: 'Imported TIN',
    }));
    expect(row.definition.sourceKind).toBe('imported-tin');
    expect(row.definition.importedSourceText).toBe(
      'Imported LandXML TIN — 3 vertices, 1 faces (file: legacy.xml, surface: Imported TIN)',
    );
    expect(row.definition.bakedFrom).toBeNull();
  });

  it('keeps the imported-tin string byte-identical', () => {
    const row = snapshotRow(importedSurface());
    expect(row.definition.sourceKind).toBe('imported-tin');
    expect(row.definition.importedSourceText).toBe(
      'Imported LandXML TIN — 3 vertices, 1 faces (file: edits.xml, surface: Imported TIN)',
    );
  });

  it('reads the engine-written bake provenance (kind:webnet-bake) faithfully', () => {
    const payload = {
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      faces: [0, 1, 2],
      provenance: makeWebnetBakeProvenance({
        sourceSurfaceId: 'surf-1',
        sourceSurfaceName: 'Design Surface',
        sourceRevision: 'srev1:abcdef0123456789',
      }),
    };
    const row = snapshotRow(surfaceWith(bakedSurfaceDefinition(payload), 'Baked 1'));
    expect(row.definition.sourceKind).toBe('explicit-tin');
    expect(row.definition.bakedFrom).toBe('Design Surface');
    expect(row.definition.sourceRevision).toBe('srev1:abcdef0123456789');
    expect(row.definition.importedSourceText).toBe(
      'Baked Explicit TIN — 3 vertices, 1 faces (baked from Design Surface, rev srev1:abcdef)',
    );
  });
});

describe('bake capability (Phase 18X UI)', () => {
  const row = (sourceKind: 'native' | 'imported-tin' | 'explicit-tin', status: string, editCount: number) => ({
    status: status as never,
    editCount,
    definition: { sourceKind },
  }) as unknown as Parameters<typeof surfaceBakeCapability>[0];

  it('native and imported CURRENT allow copy + in-place', () => {
    expect(surfaceBakeCapability(row('native', 'CURRENT', 0))).toEqual({ copy: true, inPlace: true });
    expect(surfaceBakeCapability(row('imported-tin', 'CURRENT', 0))).toEqual({ copy: true, inPlace: true });
  });

  it('baked CURRENT allows copy, in-place only with post-bake edits', () => {
    expect(surfaceBakeCapability(row('explicit-tin', 'CURRENT', 0))).toEqual({ copy: true, inPlace: false });
    expect(surfaceBakeCapability(row('explicit-tin', 'CURRENT', 2))).toEqual({ copy: true, inPlace: true });
  });

  it('never bakes a non-CURRENT surface', () => {
    expect(surfaceBakeCapability(row('native', 'UNBUILT', 3))).toEqual({ copy: false, inPlace: false });
    expect(surfaceBakeCapability(row('explicit-tin', 'NEEDS_REBUILD', 3))).toEqual({ copy: false, inPlace: false });
  });
});

describe('baked ref labels + dialog framing (Phase 18X UI)', () => {
  it('labels explicit: positional refs as V<i>, never "Imported"', () => {
    const surface = surfaceWith({
      pointSource: { kind: 'points', pointEntityIds: [] },
      sourceKind: 'imported-tin',
      importedTin: {
        vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        faces: [0, 1, 2],
        provenance: { format: 'LandXML', fileName: 'x.xml', surfaceName: 'S' },
      },
      edits: [
        { id: 'e1', kind: 'delete-point', enabled: true, vertex: { key: 'explicit:surf-1:1' } },
        { id: 'e2', kind: 'delete-point', enabled: true, vertex: { key: 'imported:surf-1:2' } },
      ],
    } as unknown as CadSurfaceDefinition);
    const edits = deriveCadSurfaceEditSummaries(surface, new Map(), false);
    expect(edits[0]!.targetLabel).toBe('V1');
    expect(edits[0]!.description).toBe('Delete Point V1');
    expect(edits[0]!.status).toBe('not-applicable');
    expect(edits[1]!.targetLabel).toBe('V2');
  });

  it('warns about the destructive in-place bake and frames copy as non-destructive', () => {
    const row = snapshotRow(explicitSurface(
      { kind: 'webnet-bake', sourceSurfaceId: 's', sourceSurfaceName: 'Design', sourceRevision: 'r' },
      [{ id: 'e1', kind: 'delete-point', enabled: true, vertex: { key: 'imported:surf-1:1' } }],
    ));
    const warning = bakeInPlaceWarning(row);
    expect(warning).toContain('Bake In Place');
    expect(warning).toContain('Clears 1 TIN edit from the stack');
    expect(warning).toContain('Survey data is unchanged');
    expect(bakeCopyFraming(row)).toContain('The original surface is left untouched');
  });
});
