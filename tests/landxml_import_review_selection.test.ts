/**
 * Phase 18M — LandXML Import Review selection algebra + display formatting
 * (agent-tier, fast, pure). Proves the review layer keeps UNSUPPORTED/BLOCKED
 * objects unselectable and maps the UI selection onto the engine commit
 * contract without mutating anything.
 */
import { describe, expect, it } from 'vitest';

import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import {
  buildLandXmlImportCommitPayload,
  countLandXmlImportSelection,
  createLandXmlImportReviewSelection,
  isLandXmlImportable,
  toggleLandXmlImportAlignment,
  toggleLandXmlImportPoints,
  toggleLandXmlImportSurface,
} from '../src/components/landXmlImportReview/landXmlImportReview.selection';
import {
  LANDXML_CRS_NOTICE,
  buildLandXmlUnsupportedRows,
  describeLandXmlDisposition,
  describeLandXmlUnits,
  readLandXmlDocumentVersion,
} from '../src/components/landXmlImportReview/landXmlImportReview.format';

const METRIC =
  '<Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" /></Units>';

const REVIEW_DOC =
  `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2">${METRIC}` +
  '<CgPoints><CgPoint name="1">0 0 0</CgPoint><CgPoint name="2">10 10 0</CgPoint></CgPoints>' +
  '<Alignments>' +
  '<Alignment name="GOOD" staStart="0"><CoordGeom><Line><Start>0 0</Start><End>0 100</End></Line></CoordGeom></Alignment>' +
  '<Alignment name="SPIRAL" staStart="0"><CoordGeom><Spiral length="50" radiusStart="INF" radiusEnd="500"/></CoordGeom></Alignment>' +
  '</Alignments>' +
  '<Surfaces>' +
  '<Surface name="TIN"><Definition surfType="TIN"><Pnts><P id="7">0 0 0</P><P id="12">10 0 0</P><P id="25">10 10 0</P><P id="31">0 10 0</P></Pnts>' +
  '<Faces><F>7 12 25</F><F>7 25 31</F></Faces></Definition></Surface>' +
  '<Surface name="GRID"><Definition surfType="GRID"><Pnts><P id="1">0 0 0</P></Pnts></Definition></Surface>' +
  '</Surfaces>' +
  '</LandXML>';

const preview = buildLandXmlImportPreview(REVIEW_DOC, { fileName: 'review.xml' });
const staged = {
  drawingId: 'd1',
  fileName: 'review.xml',
  version: readLandXmlDocumentVersion(REVIEW_DOC),
  preview,
  selection: createLandXmlImportReviewSelection(preview),
} as const;

describe('LandXML import review selection', () => {
  it('defaults to importable objects only (UNSUPPORTED/BLOCKED excluded)', () => {
    expect(staged.selection.includePoints).toBe(true);
    expect(staged.selection.alignmentNames).toEqual(['GOOD']);
    expect(staged.selection.surfaceNames).toEqual(['TIN']);
    expect(isLandXmlImportable(preview.alignments.find((a) => a.name === 'SPIRAL')!.disposition)).toBe(false);
    expect(isLandXmlImportable(preview.surfaces.find((s) => s.name === 'GRID')!.disposition)).toBe(false);
  });

  it('counts points + selected alignments + surfaces and toggles', () => {
    expect(countLandXmlImportSelection(preview, staged.selection)).toBe(4);
    const noPoints = toggleLandXmlImportPoints(staged.selection);
    expect(countLandXmlImportSelection(preview, noPoints)).toBe(2);
    const noAlignment = toggleLandXmlImportAlignment(noPoints, preview, 'GOOD');
    expect(countLandXmlImportSelection(preview, noAlignment)).toBe(1);
    const noSurface = toggleLandXmlImportSurface(noAlignment, preview, 'TIN');
    expect(countLandXmlImportSelection(preview, noSurface)).toBe(0);
  });

  it('never lets UNSUPPORTED/BLOCKED rows become selected', () => {
    const spiral = toggleLandXmlImportAlignment(staged.selection, preview, 'SPIRAL');
    const grid = toggleLandXmlImportSurface(staged.selection, preview, 'GRID');
    expect(spiral).toBe(staged.selection);
    expect(grid).toBe(staged.selection);
    expect(spiral.alignmentNames).not.toContain('SPIRAL');
    expect(grid.surfaceNames).not.toContain('GRID');
  });

  it('maps the review selection onto the engine commit contract', () => {
    const payload = buildLandXmlImportCommitPayload(staged);
    expect(payload.fileName).toBe('review.xml');
    expect(payload.commitSelection.pointIds).toEqual(['1', '2']);
    expect(payload.commitSelection.alignmentNames).toEqual(['GOOD']);
    expect(payload.commitSelection.surfaceNames).toEqual(['TIN']);
    const dropped = buildLandXmlImportCommitPayload({
      ...staged,
      selection: { includePoints: false, alignmentNames: [], surfaceNames: [] },
    });
    expect(dropped.commitSelection.pointIds).toEqual([]);
  });
});

describe('LandXML import review formatting', () => {
  it('uses exact unit wording and version extraction', () => {
    expect(describeLandXmlUnits('m')).toBe('metre (m)');
    expect(describeLandXmlUnits('ft')).toBe('international foot (intl-ft)');
    expect(describeLandXmlUnits('usft')).toBe('US survey foot (US-survey-ft)');
    expect(readLandXmlDocumentVersion(REVIEW_DOC)).toBe('1.2');
    expect(readLandXmlDocumentVersion('<LandXML>')).toBe('1.2');
    expect(LANDXML_CRS_NOTICE).toBe('No CRS transformation is performed');
  });

  it('reports the full unsupported breakdown (spiral/GRID/profile/section)', () => {
    const rows = buildLandXmlUnsupportedRows(preview);
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.count]));
    expect(byLabel['Spiral elements']).toBe(1);
    expect(byLabel['Surfaces unsupported (e.g. GRID)']).toBe(1);
    expect(byLabel['Profiles not imported']).toBe(0);
    expect(byLabel['Cross-sections not imported']).toBe(0);
  });

  it('keeps WARNING/UNSUPPORTED/BLOCKED textually distinct', () => {
    expect(describeLandXmlDisposition('WARNING')).not.toBe(describeLandXmlDisposition('UNSUPPORTED'));
    expect(describeLandXmlDisposition('UNSUPPORTED')).not.toBe(describeLandXmlDisposition('BLOCKED'));
  });
});
