/**
 * Phase 18M — LandXML commit production seams (agent-tier, fast).
 *
 * Covers: importedSurfaceIds reporting, deferred synchronous mesh build
 * (atomic commit, no meshes), full-circle Curve BLOCK, and
 * Roadway/PipeNetwork/Volume unsupported counts.
 */
import { describe, expect, it } from 'vitest';

import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import { commitLandXmlImport } from '../src/engine/cad/cadLandxmlCommit';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';

const METRIC =
  '<Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" /></Units>';

const doc = (body: string): string =>
  `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" date="2026-09-19" time="12:00:00" version="1.2">${METRIC}${body}</LandXML>`;

const squareSurfaceDoc = doc(
  `<Surfaces><Surface name="EG"><Definition surfType="TIN"><Pnts>` +
  `<P id="1">0 0 10</P><P id="2">0 10 10</P><P id="3">10 10 10</P><P id="4">10 0 10</P>` +
  `</Pnts><Faces><F>1 2 3</F><F>1 3 4</F></Faces></Definition></Surface></Surfaces>`,
);

const blank = () => createBlankCadProject({ name: 't', units: 'm' });

describe('LandXML 18M commit seams', () => {
  it('reports importedSurfaceIds on the default sync path', () => {
    const preview = buildLandXmlImportPreview(squareSurfaceDoc, { fileName: 'eg.xml' });
    const { state, report } = commitLandXmlImport(
      createCadHistoryState(blank()), createCadSurfaceCache('ids'), preview, 'eg.xml',
    );
    expect(report.committed).toBe(true);
    expect(report.surfacesAdded).toBe(1);
    expect(report.meshesBuilt).toBe(1);
    expect(report.importedSurfaceIds).toHaveLength(1);
    expect(state.present.project.surfaces![0]!.id).toBe(report.importedSurfaceIds[0]);
  });

  it('defers mesh materialization: atomic commit, ids reported, zero meshes', () => {
    const preview = buildLandXmlImportPreview(squareSurfaceDoc, { fileName: 'eg.xml' });
    const { state, report } = commitLandXmlImport(
      createCadHistoryState(blank()), createCadSurfaceCache('defer'), preview, 'eg.xml',
      {}, { deferMeshBuild: true },
    );
    expect(report.committed).toBe(true);
    expect(report.surfacesAdded).toBe(1);
    expect(report.importedSurfaceIds).toHaveLength(1);
    expect(report.meshesBuilt).toBe(0);
    expect(report.meshErrors).toHaveLength(0);
    // Surface is in the drawing (pending async build), mesh never materialized.
    const surface = state.present.project.surfaces![0]!;
    expect(surface.id).toBe(report.importedSurfaceIds[0]);
    expect(surface.cachedRevision).toBeNull();
  });

  it('blocks a full-circle Curve with a stable reason and review-visible message', () => {
    const xml = doc(
      `<Alignments><Alignment name="LOOP" staStart="0"><CoordGeom>` +
      `<Curve rot="ccw" radius="100"><Start>0 100</Start><Center>0 0</Center><End>0 100</End></Curve>` +
      `</CoordGeom></Alignment></Alignments>`,
    );
    const preview = buildLandXmlImportPreview(xml, { fileName: 'loop.xml' });
    expect(preview.alignments[0]?.disposition).toBe('BLOCKED');
    expect(preview.alignments[0]?.reasonCode).toBe('LANDXML_ALIGNMENT_GEOMETRY_BLOCKED');
    expect(preview.alignments[0]?.warnings.join(' ')).toMatch(/full circle/i);
    const { state, report } = commitLandXmlImport(
      createCadHistoryState(blank()), createCadSurfaceCache('loop'), preview, 'loop.xml',
    );
    expect(report.committed).toBe(false);
    expect(state.present.project.entities).toHaveLength(0);
  });

  it('counts Roadway/PipeNetwork/Volume elements as unsupported without importing', () => {
    const xml = doc(
      `<Roadways><Roadway name="R1"/></Roadways>` +
      `<PipeNetworks><PipeNetwork name="P1"/></PipeNetworks>`,
    );
    const preview = buildLandXmlImportPreview(xml, { fileName: 'civ.xml' });
    expect(preview.unsupported.roadwaysUnsupported).toBe(1);
    expect(preview.unsupported.pipeNetworksUnsupported).toBe(1);
    expect(preview.unsupported.volumesUnsupported).toBe(0);
    expect(preview.warnings.join(' ')).toMatch(/Roadway.*not imported/);
  });
});
