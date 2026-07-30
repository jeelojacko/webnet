import { describe, expect, it } from 'vitest';
import {
  cadBuildParcelOverlapDiagnostics,
  cadBuildParcelAutoLayoutDraftFromFrontageReference,
  parcelLayoutSettings,
} from './cadCogoTestSupport';
import type {
  CadParcelEntity,
} from './cadCogoTestSupport';

describe('Survey CAD COGO helpers', () => {
  it('keeps chained max-depth corner lots from overlapping adjacent strip lots', { timeout: 25000 }, () => {
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
      displayLabel: 'CAD1-CAD2, CAD2-CAD3, CAD3-CAD4',
      sourcePointIds: ['CAD1', 'CAD2', 'CAD3', 'CAD4'],
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
      parcelSegmentIds: ['parcel:fixture#0', 'parcel:fixture#1', 'parcel:fixture#2'],
      parcelSegmentLabelPairs: [
        ['CAD1', 'CAD2'],
        ['CAD2', 'CAD3'],
        ['CAD3', 'CAD4'],
      ] as Array<readonly [string, string]>,
      sourceGeometry: {
        kind: 'polyline' as const,
        vertices: [
          { x: 685672.814, y: 5091312.877 },
          { x: 686879.074, y: 5091312.877 },
          { x: 686694.912, y: 5090134.241 },
          { x: 685522.415, y: 5090336.819 },
        ],
        vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4'],
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

    const diagnostics = cadBuildParcelOverlapDiagnostics(
      autoLayout.generatedParcels
        .filter((generatedParcel) => generatedParcel.role === 'lot')
        .map((generatedParcel, index) => ({
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

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates.length).toBeGreaterThanOrEqual(90);
    expect(
      diagnostics.overlapPairs.filter((pair) => pair.overlapAreaSquareMeters > 1).length,
    ).toBeLessThanOrEqual(2);
  });

  it('removes duplicated corridor lots when chained frontage order revisits the same remainder space', { timeout: 25000 }, () => {
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
      displayLabel: 'CAD3-CAD4, CAD4-CAD5, CAD5-CAD1',
      sourcePointIds: ['CAD3', 'CAD4', 'CAD5', 'CAD1'],
      frontageLine: {
        id: `${parcel.id}:frontage-segment:2`,
        type: 'line' as const,
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        fromStationId: 'CAD3',
        toStationId: 'CAD4',
        fromX: 686694.912,
        fromY: 5090134.241,
        toX: 685522.415,
        toY: 5090336.819,
        sourceObservationIds: [],
      },
      parcelSegmentIds: ['parcel:fixture#2', 'parcel:fixture#3', 'parcel:fixture#4'],
      parcelSegmentLabelPairs: [
        ['CAD3', 'CAD4'],
        ['CAD4', 'CAD5'],
        ['CAD5', 'CAD1'],
      ] as Array<readonly [string, string]>,
      sourceGeometry: {
        kind: 'polyline' as const,
        vertices: [
          { x: 686694.912, y: 5090134.241 },
          { x: 685522.415, y: 5090336.819 },
          { x: 685624.955, y: 5091167.336 },
          { x: 685672.814, y: 5091312.877 },
        ],
        vertexLabels: ['CAD3', 'CAD4', 'CAD5', 'CAD1'],
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

    const diagnostics = cadBuildParcelOverlapDiagnostics(
      autoLayout.generatedParcels
        .filter((generatedParcel) => generatedParcel.role === 'lot')
        .map((generatedParcel, index) => ({
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

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates.length).toBeGreaterThan(60);
    expect(
      diagnostics.overlapPairs.filter((pair) => pair.overlapAreaSquareMeters > 1).length,
    ).toBe(0);
    expect(
      autoLayout.generatedParcels
        .filter((generatedParcel) => generatedParcel.role === 'lot')
        .every((generatedParcel) =>
          generatedParcel.sourceKind === 'segment' ||
          generatedParcel.sourceKind === 'corner_prepass' ||
          generatedParcel.sourceKind === 'corner_remainder',
        ),
    ).toBe(true);
    expect(
      autoLayout.generatedParcels.some(
        (generatedParcel) => generatedParcel.role === 'lot' && generatedParcel.sourceKind == null,
      ),
    ).toBe(false);
    expect(autoLayout.statusMessage).not.toContain('Filled 1 remainder parcel');
  });

  it('keeps bottom-side angled frontage from collapsing to one lot in max-depth chains', { timeout: 25000 }, () => {
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
      displayLabel: 'CAD1-CAD5, CAD5-CAD4, CAD4-CAD3',
      sourcePointIds: ['CAD1', 'CAD5', 'CAD4', 'CAD3'],
      frontageLine: {
        id: `${parcel.id}:frontage-segment:4`,
        type: 'line' as const,
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        fromStationId: 'CAD1',
        toStationId: 'CAD5',
        fromX: 685672.814,
        fromY: 5091312.877,
        toX: 685624.955,
        toY: 5091167.336,
        sourceObservationIds: [],
      },
      parcelSegmentIds: ['parcel:fixture#4', 'parcel:fixture#3', 'parcel:fixture#2'],
      parcelSegmentLabelPairs: [
        ['CAD1', 'CAD5'],
        ['CAD5', 'CAD4'],
        ['CAD4', 'CAD3'],
      ] as Array<readonly [string, string]>,
      sourceGeometry: {
        kind: 'polyline' as const,
        vertices: [
          { x: 685672.814, y: 5091312.877 },
          { x: 685624.955, y: 5091167.336 },
          { x: 685522.415, y: 5090336.819 },
          { x: 686694.912, y: 5090134.241 },
        ],
        vertexLabels: ['CAD1', 'CAD5', 'CAD4', 'CAD3'],
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
    const middleAngledLotCount = lotDrafts.filter(
      (generatedParcel) => generatedParcel.sourceSegmentIndex === 1,
    ).length;
    const bottomFrontageLotCount = lotDrafts.filter(
      (generatedParcel) => generatedParcel.sourceSegmentIndex === 2,
    ).length;
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
    expect(autoLayout.isValid).toBe(true);
    expect(middleAngledLotCount).toBeGreaterThan(20);
    expect(bottomFrontageLotCount).toBeGreaterThan(25);
    expect(
      diagnostics.overlapPairs.filter((pair) => pair.overlapAreaSquareMeters > 1).length,
    ).toBeLessThanOrEqual(2);
    expect(autoLayout.statusMessage).not.toContain('Filled 1 remainder parcel');
  });

});
