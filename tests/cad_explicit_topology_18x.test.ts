/** Phase 18X engine core: explicit-topology predicate + provenance contract. */
import { describe, expect, it } from 'vitest';
import {
  explicitTinTopologyDigest,
  importedTinRevision,
  makeWebnetBakeProvenance,
  normalizeTinProvenance,
  tinProvenanceKind,
  tinProvenanceRevisionPart,
  validateExplicitTinPayload,
  validateImportedTinPayload,
} from '../src/engine/cad/cadImportedTin';
import {
  isExplicitTopologyDefinition,
  isImportedTinDefinition,
  isNativeSurfaceDefinition,
  type CadSurfaceDefinition,
  type ImportedTinPayload,
} from '../src/engine/cad/cadTypes';

const landxmlPayload = (): ImportedTinPayload => ({
  vertices: [0, 0, 1, 10, 0, 2, 0, 10, 3],
  faces: [0, 1, 2],
  provenance: { format: 'LandXML', fileName: 'a.xml', surfaceName: 'S' },
});

const def = (partial: Partial<CadSurfaceDefinition>): CadSurfaceDefinition => ({
  pointSource: { kind: 'points', pointEntityIds: [] },
  ...partial,
});

describe('18X explicit-topology predicate', () => {
  it('routes imported-tin and explicit-tin through the explicit leg', () => {
    const payload = landxmlPayload();
    expect(isExplicitTopologyDefinition(def({ sourceKind: 'imported-tin', importedTin: payload }))).toBe(true);
    expect(
      isExplicitTopologyDefinition(
        def({ sourceKind: 'explicit-tin', importedTin: { ...payload, provenance: makeWebnetBakeProvenance({ sourceSurfaceId: 's1', sourceSurfaceName: 'S1', sourceRevision: 'r1' }) } }),
      ),
    ).toBe(true);
  });

  it('is fail-closed: unknown kind + payload routes explicit, never native', () => {
    const payload = landxmlPayload();
    const unknown = def({ sourceKind: 'future-kind' as 'native', importedTin: payload });
    expect(isExplicitTopologyDefinition(unknown)).toBe(true);
    expect(isNativeSurfaceDefinition(unknown)).toBe(false);
  });

  it('treats absent/native definitions as native', () => {
    expect(isNativeSurfaceDefinition(undefined)).toBe(true);
    expect(isNativeSurfaceDefinition(def({}))).toBe(true);
    expect(isNativeSurfaceDefinition(def({ sourceKind: 'native' }))).toBe(true);
    expect(isExplicitTopologyDefinition(def({}))).toBe(false);
    expect(isExplicitTopologyDefinition(undefined)).toBe(false);
  });

  it('keeps isImportedTinDefinition as a behavior-identical alias', () => {
    const payload = landxmlPayload();
    for (const d of [
      def({}),
      def({ sourceKind: 'native' }),
      def({ sourceKind: 'imported-tin', importedTin: payload }),
      def({ sourceKind: 'explicit-tin', importedTin: payload }),
      def({ sourceKind: 'imported-tin' }),
    ]) {
      expect(isImportedTinDefinition(d)).toBe(isExplicitTopologyDefinition(d));
    }
  });
});

describe('18X explicit validator seam', () => {
  it('accepts the same payloads as the 18L validator, byte-for-byte', () => {
    const payload = landxmlPayload();
    expect(validateExplicitTinPayload(payload)).toBeNull();
    expect(validateImportedTinPayload(payload)).toBeNull();
    const bad = { ...payload, faces: [0, 0, 1] };
    expect(validateExplicitTinPayload(bad)).toBe(validateImportedTinPayload(bad));
    expect(validateExplicitTinPayload(bad)).not.toBeNull();
  });
});

describe('18X provenance contract', () => {
  it('reads legacy (kind omitted) as landxml-import with byte-identical revision part', () => {
    const payload = landxmlPayload();
    expect(tinProvenanceKind(payload.provenance)).toBe('landxml-import');
    expect(normalizeTinProvenance(payload.provenance)).toEqual({
      kind: 'landxml-import',
      format: 'LandXML',
      fileName: 'a.xml',
      surfaceName: 'S',
    });
    expect(tinProvenanceRevisionPart(payload.provenance)).toBe('LandXML|a.xml|S|');
  });

  it('freezes the srev1:imported: prefix for both kinds', () => {
    const baked = makeWebnetBakeProvenance({ sourceSurfaceId: 's1', sourceSurfaceName: 'S1', sourceRevision: 'r1' });
    expect(baked).toEqual({ kind: 'webnet-bake', sourceSurfaceId: 's1', sourceSurfaceName: 'S1', sourceRevision: 'r1' });
    for (const provenance of [landxmlPayload().provenance, baked]) {
      expect(importedTinRevision('surf', { ...landxmlPayload(), provenance }).startsWith('srev1:imported:')).toBe(true);
    }
  });

  it('reads format:explicit as a baked alias', () => {
    expect(tinProvenanceKind({ format: 'explicit', fileName: 'x', surfaceName: 'Y' })).toBe('webnet-bake');
  });
});

describe('18X topology digest', () => {
  it('is deterministic and content-sensitive', () => {
    const payload = landxmlPayload();
    expect(explicitTinTopologyDigest(payload)).toBe(explicitTinTopologyDigest(landxmlPayload()));
    expect(explicitTinTopologyDigest(payload).startsWith('etin1:')).toBe(true);
    expect(explicitTinTopologyDigest({ ...payload, faces: [0, 2, 1] })).not.toBe(explicitTinTopologyDigest(payload));
  });
});
