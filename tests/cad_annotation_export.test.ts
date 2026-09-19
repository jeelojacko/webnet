// Phase 18O annotation EXPORT disposition matrix.
//
// Every annotation entity kind (mtext, leader, the 5 dimension kinds, bearing
// label, curve label) is exercised across all five deliverables:
//   SVG, PDF, DXF R12, DXF R2000, LandXML
// and each cell asserts an EXPLICIT disposition: exported, approximated, or
// unsupported-with-warning. Zero silent drops is the contract under test.
import { describe, expect, it } from 'vitest';
import { buildDxfModelSpaceTextWithResult, buildDxfLayoutTextWithResult } from '../src/engine/cad/dxf/dxfLayoutExport';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvgWithResult } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCadProject';
import {
  seedBearingLabelStyles,
  seedCurveLabelStyles,
  seedDimensionStyles,
  seedLeaderStyles,
  seedProfessionalTextStyles,
} from '../src/engine/cad/annotation/cadAnnotationSeeds';
import type { CadAnnotationAnchor } from '../src/engine/cad/annotation/cadAnnotationAnchors';
import type { CadBlockDefinition, CadEntity, CadProject } from '../src/engine/cad/cadTypes';
import { buildSmallParcelFixture } from './fixtures/draftSmallParcel';

const fixed = (x: number, y: number): CadAnnotationAnchor => ({ kind: 'fixed', x, y });

const ANNOTATION_IDS = [
  'ann-mtext',
  'ann-leader',
  'ann-dim-linear',
  'ann-dim-aligned',
  'ann-dim-angular',
  'ann-dim-radius',
  'ann-dim-diameter',
  'ann-bearing',
  'ann-curve',
] as const;

const arrowBlock = (): CadBlockDefinition => ({
  id: 'arrow-closed',
  name: 'Closed Arrow',
  basePoint: { x: 0, y: 0 },
  description: 'tip at origin, body along -X',
  entities: [
    {
      id: 'arrow-closed-body',
      type: 'polygon',
      layerId: '0',
      visible: true,
      locked: false,
      vertices: [{ x: 0, y: 0 }, { x: -1, y: 0.25 }, { x: -1, y: -0.25 }],
      vertexLabels: ['', '', ''],
    },
  ],
});

const buildProject = (): CadProject => {
  const fixture = buildSmallParcelFixture();
  const project = fixture.project;
  const textStyles = seedProfessionalTextStyles();
  project.styleLibrary.textStyles.push(...textStyles);
  project.dimensionStyles = seedDimensionStyles();
  project.leaderStyles = seedLeaderStyles();
  project.bearingLabelStyles = seedBearingLabelStyles();
  project.curveLabelStyles = seedCurveLabelStyles();
  project.annotationSettings = { scaleDenominator: 500 };
  project.blockDefinitions = [arrowBlock()];

  const layerId = 'parcels';
  const entities: CadEntity[] = [
    {
      type: 'line', id: 'ann-src-line', layerId, visible: true, locked: false,
      fromStationId: 'A1', toStationId: 'A2', fromX: 0, fromY: 0, toX: 30, toY: 40,
      sourceObservationIds: [],
    },
    {
      type: 'arc', id: 'ann-src-arc', layerId, visible: true, locked: false,
      centerX: 10, centerY: 10, radius: 5, startAngleDeg: 0, endAngleDeg: 90,
    },
    {
      type: 'mtext', id: 'ann-mtext', layerId, visible: true, locked: false,
      x: 5, y: 5, text: 'LINE ONE\nLINE TWO',
      textStyleId: textStyles[0]!.id, rotationDeg: 0, attachment: 'top-left',
    },
    {
      type: 'leader', id: 'ann-leader', layerId, visible: true, locked: false,
      arrowAnchor: fixed(0, 0), vertices: [{ x: 0, y: 0 }, { x: 8, y: 6 }],
      text: 'LEADER TEXT', leaderStyleId: 'std-leader',
    },
    {
      type: 'dimension', id: 'ann-dim-linear', layerId, visible: true, locked: false,
      dimensionKind: 'linear', anchors: [fixed(0, 0), fixed(40, 0)],
      defPoint1: fixed(0, 0), defPoint2: fixed(40, 0), orientation: 'horizontal',
      dimLinePoint: { x: 0, y: -10 }, dimensionStyleId: 'std-500',
    },
    {
      type: 'dimension', id: 'ann-dim-aligned', layerId, visible: true, locked: false,
      dimensionKind: 'aligned', anchors: [fixed(0, 0), fixed(30, 40)],
      defPoint1: fixed(0, 0), defPoint2: fixed(30, 40), dimLinePoint: { x: -5, y: 5 },
      dimensionStyleId: 'std-500',
    },
    {
      type: 'dimension', id: 'ann-dim-angular', layerId, visible: true, locked: false,
      dimensionKind: 'angular',
      anchors: [fixed(0, 0), fixed(10, 0), fixed(10, 10)],
      defPoint1: fixed(0, 0), defPoint2: fixed(10, 0), dimLinePoint: { x: 5, y: 5 },
      dimensionStyleId: 'std-500',
    },
    {
      type: 'dimension', id: 'ann-dim-radius', layerId, visible: true, locked: false,
      dimensionKind: 'radius', anchors: [fixed(0, 0), fixed(5, 0)],
      defPoint1: fixed(0, 0), defPoint2: fixed(5, 0), dimLinePoint: { x: 3, y: 3 },
      dimensionStyleId: 'std-500',
    },
    {
      type: 'dimension', id: 'ann-dim-diameter', layerId, visible: true, locked: false,
      dimensionKind: 'diameter', anchors: [fixed(0, 0), fixed(5, 0)],
      defPoint1: fixed(0, 0), defPoint2: fixed(5, 0), dimLinePoint: { x: 3, y: 3 },
      dimensionStyleId: 'std-500',
    },
    {
      type: 'bearing-label', id: 'ann-bearing', layerId, visible: true, locked: false,
      sourceEntityId: 'ann-src-line', labelStyleId: 'bearing-default', offset: { x: 0, y: 2 },
    },
    {
      type: 'curve-label', id: 'ann-curve', layerId, visible: true, locked: false,
      sourceEntityId: 'ann-src-arc', labelStyleId: 'curve-default', offset: { x: 0, y: 0 },
    },
  ];
  project.entities.push(...entities);
  return project;
};

const warningsFor = (
  warnings: Array<{ message: string; entityId?: string }>,
  id: string,
): string[] => warnings.filter((warning) => warning.entityId === id).map((warning) => warning.message);

describe('Phase 18O annotation export disposition matrix', () => {
  const fixture = buildSmallParcelFixture();
  const project = buildProject();

  it('SVG: every annotation kind exports (explicit exported disposition)', () => {
    const scene = buildExportSheetSceneWithResult({
      draft: fixture.draft, sheetId: fixture.sheetId, project, modelLabels: fixture.modelLabels,
    });
    const svg = serializeExportSceneToSvgWithResult(scene.output);
    ANNOTATION_IDS.forEach((id) => {
      expect(scene.exportedEntityIds, `${id} exported`).toContain(id);
      expect(scene.omittedEntityIds, `${id} not omitted`).not.toContain(id);
      expect(svg.exportedEntityIds, `${id} svg exported`).toContain(id);
    });
    expect(svg.output).toContain('<svg');
    // Multiline mtext rides as separate <text> rows, never one collapsed node.
    expect(svg.output).toContain('LINE ONE');
    expect(svg.output).toContain('LINE TWO');
    expect(svg.output).not.toContain('LINE ONE\nLINE TWO');
    // Page size tracks the sheet (plan scale), not any viewport zoom.
    expect(svg.output).toContain(`width="${scene.output.widthMm}mm"`);
  });

  it('PDF: every annotation kind exports (explicit exported disposition)', () => {
    const scene = buildExportSheetSceneWithResult({
      draft: fixture.draft, sheetId: fixture.sheetId, project, modelLabels: fixture.modelLabels,
    });
    const pdf = exportScenesToPdfWithResult([scene.output]);
    ANNOTATION_IDS.forEach((id) => {
      expect(pdf.exportedEntityIds, `${id} pdf exported`).toContain(id);
      expect(pdf.omittedEntityIds, `${id} not omitted`).not.toContain(id);
    });
    expect(pdf.output.length).toBeGreaterThan(0);
    // Multiline mtext rides as separate PDF text ops.
    const pdfText = new TextDecoder().decode(pdf.output);
    expect(pdfText).toContain('(LINE ONE)');
    expect(pdfText).toContain('(LINE TWO)');
  });

  it('DXF R12: annotations are derived primitives with APPROXIMATED disposition and no silent drops', () => {
    const result = buildDxfModelSpaceTextWithResult({ project });
    ANNOTATION_IDS.forEach((id) => {
      expect(result.exportedEntityIds, `${id} exported`).toContain(id);
      expect(result.approximatedEntityIds, `${id} approximated`).toContain(id);
      expect(result.omittedEntityIds, `${id} not omitted`).not.toContain(id);
      expect(warningsFor(result.warnings, id).join(' '), `${id} warned`).toMatch(/approximated/);
    });
    // Multiline mtext => multiple TEXT rows, never one space-joined row.
    expect(result.output).toContain('LINE ONE');
    expect(result.output).toContain('LINE TWO');
    expect(result.output).toContain('LEADER TEXT');
    // Derived dimension measurements prove the geometry resolver feeds DXF.
    expect(result.output).toContain('40.000');
    expect(result.output).toContain('50.000');
    expect(result.output).toContain('45.000');
    expect(result.output).toContain('10.000'); // diameter
    // Survey labels ride as TEXT rows (bearing/distance + curve fields).
    expect(result.output).toContain('R 5.000');
    expect(result.output).toContain('L 7.854');
  });

  it('DXF R2000: annotations are derived primitives with APPROXIMATED disposition and no silent drops', () => {
    const result = buildDxfLayoutTextWithResult({
      project, draft: fixture.draft, modelLabels: fixture.modelLabels, paperExtras: fixture.paperExtras,
    });
    ANNOTATION_IDS.forEach((id) => {
      expect(result.exportedEntityIds, `${id} exported`).toContain(id);
      expect(result.approximatedEntityIds, `${id} approximated`).toContain(id);
      expect(result.omittedEntityIds, `${id} not omitted`).not.toContain(id);
    });
    expect(result.output.dxf).toContain('AC1015');
    expect(result.output.dxf).toContain('LINE ONE');
  });

  it('LandXML: every annotation kind is NOT_APPLICABLE with an explicit warning', () => {
    const result = buildLandXmlProjectExportWithResult(project, { units: 'm' });
    ANNOTATION_IDS.forEach((id) => {
      expect(result.omittedEntityIds, `${id} omitted`).toContain(id);
      expect(result.exportedEntityIds, `${id} not exported`).not.toContain(id);
      expect(warningsFor(result.warnings, id).join(' '), `${id} warned`).toMatch(/NOT_APPLICABLE/);
    });
  });

  it('zero silent drops: every annotation id is classified by every format', () => {
    const r12 = buildDxfModelSpaceTextWithResult({ project });
    const r2000 = buildDxfLayoutTextWithResult({
      project, draft: fixture.draft, modelLabels: fixture.modelLabels, paperExtras: fixture.paperExtras,
    });
    const landxml = buildLandXmlProjectExportWithResult(project, { units: 'm' });
    const scene = buildExportSheetSceneWithResult({
      draft: fixture.draft, sheetId: fixture.sheetId, project, modelLabels: fixture.modelLabels,
    });
    const formats = [r12, r2000, landxml, scene];
    ANNOTATION_IDS.forEach((id) => {
      formats.forEach((result) => {
        const classified =
          result.exportedEntityIds.includes(id) ||
          result.omittedEntityIds.includes(id) ||
          result.approximatedEntityIds.includes(id);
        expect(classified, `${id} classified`).toBe(true);
        expect(
          result.exportedEntityIds.includes(id) && result.omittedEntityIds.includes(id),
          `${id} not exported+omitted`,
        ).toBe(false);
      });
    });
  });
});
