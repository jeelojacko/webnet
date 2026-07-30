import { describe, expect, it } from 'vitest';
import {
  cadBuildParcelOverlapDiagnostics,
  cadBuildParcelAutoLayoutDraftFromFrontageReference,
  cadBuildParcelClosureSummary,
  parcelLayoutSettings,
  closedBoundaryRingTestParcel,
  closedBoundaryRingFrontageReference,
} from './cadCogoTestSupport';
import type {
  CadParcelEntity,
} from './cadCogoTestSupport';

describe('Survey CAD COGO helpers', () => {
  it('fills all selected parent boundary frontage as a continuous ring', { timeout: 25000 }, () => {
    const parcel: CadParcelEntity = {
      id: 'parcel:fixture',
      type: 'parcel',
      layerId: 'parcels',
      styleId: 'style-parcel',
      visible: true,
      locked: false,
      parcelName: 'Parcel 1',
      vertices: [
        { x: 685672.814, y: 5091312.877 },
        { x: 686879.074, y: 5091312.877 },
        { x: 686694.912, y: 5090134.241 },
        { x: 685522.415, y: 5090336.819 },
        { x: 685624.955, y: 5091167.336 },
      ],
      vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4', 'CAD5'],
    };
    const frontageReference = {
      sourceEntityId: parcel.id,
      displayLabel: 'CAD1-CAD2, CAD2-CAD3, CAD3-CAD4, CAD4-CAD5, CAD5-CAD1',
      sourcePointIds: ['CAD1', 'CAD2', 'CAD3', 'CAD4', 'CAD5', 'CAD1'],
      frontageLine: {
        id: `${parcel.id}:frontage-segment:0`,
        type: 'line' as const,
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        fromStationId: 'CAD1',
        toStationId: 'CAD2',
        fromX: 685672.814,
        fromY: 5091312.877,
        toX: 686879.074,
        toY: 5091312.877,
        sourceObservationIds: [],
      },
      parcelSegmentIds: [
        'parcel:fixture#0',
        'parcel:fixture#1',
        'parcel:fixture#2',
        'parcel:fixture#3',
        'parcel:fixture#4',
      ],
      parcelSegmentLabelPairs: [
        ['CAD1', 'CAD2'],
        ['CAD2', 'CAD3'],
        ['CAD3', 'CAD4'],
        ['CAD4', 'CAD5'],
        ['CAD5', 'CAD1'],
      ] as Array<readonly [string, string]>,
      sourceGeometry: {
        kind: 'polyline' as const,
        vertices: [
          { x: 685672.814, y: 5091312.877 },
          { x: 686879.074, y: 5091312.877 },
          { x: 686694.912, y: 5090134.241 },
          { x: 685522.415, y: 5090336.819 },
          { x: 685624.955, y: 5091167.336 },
          { x: 685672.814, y: 5091312.877 },
        ],
        vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4', 'CAD5', 'CAD1'],
      },
    };

    const autoLayout = cadBuildParcelAutoLayoutDraftFromFrontageReference(
      parcel,
      frontageReference,
      parcelLayoutSettings({
        minAreaSquareMeters: 1000,
        minFrontageMeters: 30,
        minWidthMeters: 20,
        minDepthMeters: 20,
        useMaxDepth: true,
        maxDepthMeters: 150,
        remainderDistribution: 'place_remainder_in_last_parcel',
      }),
      'slide',
    );

    const lotDrafts = autoLayout.generatedParcels.filter(
      (generatedParcel) => generatedParcel.role === 'lot',
    );
    const lotCountsBySegment = [0, 1, 2, 3, 4].map(
      (segmentIndex) =>
        lotDrafts.filter((generatedParcel) => generatedParcel.sourceSegmentIndex === segmentIndex)
          .length,
    );
    const centerRemainders = autoLayout.generatedParcels.filter(
      (generatedParcel) => generatedParcel.role === 'remainder',
    );
    const straightRunLots = lotDrafts.filter(
      (generatedParcel) => generatedParcel.sourceKind === 'segment',
    );
    const cornerLots = lotDrafts.filter(
      (generatedParcel) => generatedParcel.sourceKind === 'corner_remainder',
    );
    const isPerpendicularStraightRunLot = (generatedParcel: (typeof straightRunLots)[number]): boolean => {
      const vertices = generatedParcel.vertices;
      if (vertices.length !== 4) return false;
      const frontageVector = {
        x: vertices[1]!.x - vertices[0]!.x,
        y: vertices[1]!.y - vertices[0]!.y,
      };
      const firstSideVector = {
        x: vertices[3]!.x - vertices[0]!.x,
        y: vertices[3]!.y - vertices[0]!.y,
      };
      const secondSideVector = {
        x: vertices[2]!.x - vertices[1]!.x,
        y: vertices[2]!.y - vertices[1]!.y,
      };
      const dotFirst = Math.abs(frontageVector.x * firstSideVector.x + frontageVector.y * firstSideVector.y);
      const dotSecond = Math.abs(frontageVector.x * secondSideVector.x + frontageVector.y * secondSideVector.y);
      return dotFirst <= 1e-6 && dotSecond <= 1e-6;
    };
    const diagnostics = cadBuildParcelOverlapDiagnostics(
      lotDrafts.map((generatedParcel, index) => ({
        id: `${parcel.id}:generated:${index + 1}`,
        type: 'parcel' as const,
        layerId: parcel.layerId,
        styleId: parcel.styleId,
        visible: true,
        locked: false,
        parcelName: `Generated lot ${index + 1}`,
        vertices: generatedParcel.vertices,
        vertexLabels: generatedParcel.vertexLabels,
      })),
    );
    const maximumSolvedDepthMeters = autoLayout.acceptedCandidates.reduce(
      (maximumDepthMeters, candidate) =>
        Math.max(maximumDepthMeters, candidate.evaluation?.depthMeters ?? 0),
      0,
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.statusMessage).toContain('closed-boundary ring');
    expect(lotDrafts.length).toBeGreaterThan(140);
    expect(lotCountsBySegment.every((count) => count > 0)).toBe(true);
    expect(lotDrafts.every((generatedParcel) => generatedParcel.vertices.length >= 4)).toBe(true);
    expect(straightRunLots.every(isPerpendicularStraightRunLot)).toBe(true);
    expect(cornerLots).toHaveLength(10);
    expect(
      cornerLots.every(
        (generatedParcel) =>
          (cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0) >= 1000,
      ),
    ).toBe(true);
    expect(
      autoLayout.acceptedCandidates.every(
        (candidate) => (candidate.evaluation?.depthMeters ?? Number.POSITIVE_INFINITY) < 40,
      ),
    ).toBe(true);
    expect(maximumSolvedDepthMeters).toBeLessThan(33.2);
    expect(
      diagnostics.overlapPairs.filter((pair) => pair.overlapAreaSquareMeters > 1).length,
    ).toBe(0);
    expect(centerRemainders).toHaveLength(1);
    expect(centerRemainders[0]!.vertices.length).toBe(10);
    expect(cadBuildParcelClosureSummary(centerRemainders[0]!.vertices)?.areaSquareMeters).toBeGreaterThan(1000);
  });

  it('absorbs closed-boundary corner lots that cannot satisfy large layout minimums', { timeout: 25000 }, () => {
    const autoLayout = cadBuildParcelAutoLayoutDraftFromFrontageReference(
      closedBoundaryRingTestParcel,
      closedBoundaryRingFrontageReference,
      parcelLayoutSettings({
        minAreaSquareMeters: 5500,
        minFrontageMeters: 100,
        minWidthMeters: 20,
        minDepthMeters: 75,
        useMaxDepth: true,
        maxDepthMeters: 150,
        remainderDistribution: 'place_remainder_in_last_parcel',
      }),
      'slide',
    );

    const lotDrafts = autoLayout.generatedParcels.filter(
      (generatedParcel) => generatedParcel.role === 'lot',
    );
    const cornerLots = lotDrafts.filter(
      (generatedParcel) => generatedParcel.sourceKind === 'corner_remainder',
    );
    const materialOverlaps = cadBuildParcelOverlapDiagnostics(
      lotDrafts.map((generatedParcel, index) => ({
        id: `${closedBoundaryRingTestParcel.id}:generated:${index + 1}`,
        type: 'parcel' as const,
        layerId: closedBoundaryRingTestParcel.layerId,
        styleId: closedBoundaryRingTestParcel.styleId,
        visible: true,
        locked: false,
        parcelName: `Generated lot ${index + 1}`,
        vertices: generatedParcel.vertices,
        vertexLabels: generatedParcel.vertexLabels,
      })),
    ).overlapPairs.filter((pair) => pair.overlapAreaSquareMeters > 1);

    expect(autoLayout.isValid).toBe(true);
    expect(lotDrafts.length).toBeGreaterThan(25);
    expect(cornerLots.length).toBeLessThan(10);
    expect(
      lotDrafts.every(
        (generatedParcel) =>
          (cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0) >= 5500,
      ),
    ).toBe(true);
    expect(materialOverlaps).toHaveLength(0);
  });

  it('aligns closed-boundary remainders to final generated lot backs', { timeout: 25000 }, () => {
    const autoLayout = cadBuildParcelAutoLayoutDraftFromFrontageReference(
      closedBoundaryRingTestParcel,
      closedBoundaryRingFrontageReference,
      parcelLayoutSettings({
        minAreaSquareMeters: 5000,
        minFrontageMeters: 100,
        minWidthMeters: 20,
        minDepthMeters: 20,
        useMaxDepth: true,
        maxDepthMeters: 150,
        remainderDistribution: 'place_remainder_in_last_parcel',
      }),
      'slide',
    );

    const lotDrafts = autoLayout.generatedParcels.filter(
      (generatedParcel) => generatedParcel.role === 'lot',
    );
    const centerRemainders = autoLayout.generatedParcels.filter(
      (generatedParcel) => generatedParcel.role === 'remainder',
    );
    const lotBackPointKeys = new Set(
      lotDrafts.flatMap((generatedParcel) =>
        generatedParcel.vertices
          .slice(2)
          .map((vertex) => `${vertex.x.toFixed(6)},${vertex.y.toFixed(6)}`),
      ),
    );

    expect(autoLayout.isValid).toBe(true);
    expect(centerRemainders).toHaveLength(1);
    expect(centerRemainders[0]!.vertices.length).toBe(10);
    expect(
      centerRemainders[0]!.vertices.every((vertex) =>
        lotBackPointKeys.has(`${vertex.x.toFixed(6)},${vertex.y.toFixed(6)}`),
      ),
    ).toBe(true);
  });

});
