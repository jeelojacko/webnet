import { describe, expect, it } from 'vitest';
import {
  cadBuildParcelGapDiagnostics,
  cadBuildParcelOverlapDiagnostics,
  cadBuildParcelAutoLayoutDraftFromFrontageReference,
  cadConvertAreaSquareMeters,
  cadBuildParcelClosureSummary,
  parcelLayoutSettings,
} from './cadCogoTestSupport';
import type {
  CadParcelEntity,
} from './cadCogoTestSupport';

describe('Survey CAD COGO helpers', () => {
  it('fills two-edge angled frontage junctions without oversized corner lots', { timeout: 25000 }, () => {
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
      ],
      vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4'],
    };
    const frontageReference = {
      sourceEntityId: parcel.id,
      displayLabel: 'CAD3-CAD4, CAD4-CAD1',
      sourcePointIds: ['CAD3', 'CAD4', 'CAD1'],
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
      parcelSegmentIds: ['parcel:fixture#2', 'parcel:fixture#3'],
      parcelSegmentLabelPairs: [
        ['CAD3', 'CAD4'],
        ['CAD4', 'CAD1'],
      ] as Array<readonly [string, string]>,
      sourceGeometry: {
        kind: 'polyline' as const,
        vertices: [
          { x: 686694.912, y: 5090134.241 },
          { x: 685522.415, y: 5090336.819 },
          { x: 685672.814, y: 5091312.877 },
        ],
        vertexLabels: ['CAD3', 'CAD4', 'CAD1'],
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
    const maximumLotFrontageMeters = lotDrafts.reduce((maximumFrontage, generatedParcel) => {
      const frontageLengthMeters =
        'frontageLengthMeters' in generatedParcel
          ? (generatedParcel as { frontageLengthMeters?: number }).frontageLengthMeters ?? 0
          : 0;
      return Math.max(maximumFrontage, frontageLengthMeters);
    }, 0);

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates.length).toBeGreaterThan(55);
    expect(lotDrafts.some((generatedParcel) => generatedParcel.sourceKind === 'corner_prepass')).toBe(false);
    expect(lotDrafts.some((generatedParcel) => generatedParcel.sourceKind === 'corner_remainder')).toBe(true);
    expect(
      lotDrafts.some(
        (generatedParcel) =>
          generatedParcel.sourceKind === 'corner_remainder' &&
          generatedParcel.sourceSegmentIndex === 0 &&
          (cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0) > 1000,
      ),
    ).toBe(true);
    expect(
      autoLayout.generatedParcels.some(
        (generatedParcel) =>
          generatedParcel.role === 'remainder' &&
          generatedParcel.sourceSegmentIndex === 0 &&
          ((generatedParcel as { frontageLengthMeters?: number }).frontageLengthMeters ?? Number.POSITIVE_INFINITY) < 30,
      ),
    ).toBe(false);
    expect(maximumLotFrontageMeters).toBeLessThanOrEqual(30.000001);
    expect(
      autoLayout.acceptedCandidates.every(
        (candidate) => (candidate.evaluation?.depthMeters ?? Number.POSITIVE_INFINITY) <= 150.000001,
      ),
    ).toBe(true);
  });

  it('diagnoses overlapping parcel pairs with shared area', () => {
    const diagnostics = cadBuildParcelOverlapDiagnostics([
      {
        id: 'parcel:1',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 1',
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        vertexLabels: ['A', 'B', 'C', 'D'],
      },
      {
        id: 'parcel:2',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 2',
        vertices: [
          { x: 5, y: 0 },
          { x: 15, y: 0 },
          { x: 15, y: 10 },
          { x: 5, y: 10 },
        ],
        vertexLabels: ['E', 'F', 'G', 'H'],
      },
    ]);

    expect(diagnostics.parcelCount).toBe(2);
    expect(diagnostics.pairCount).toBe(1);
    expect(diagnostics.overlapPairs).toHaveLength(1);
    expect(diagnostics.overlapPairs[0]?.firstParcelName).toBe('Parcel 1');
    expect(diagnostics.overlapPairs[0]?.secondParcelName).toBe('Parcel 2');
    expect(diagnostics.overlapPairs[0]?.overlapAreaSquareMeters ?? Number.NaN).toBeCloseTo(50, 6);
    expect(diagnostics.totalOverlapAreaSquareMeters).toBeCloseTo(50, 6);
  });

  it('diagnoses enclosed parcel gaps from one connected parcel coverage', () => {
    const diagnostics = cadBuildParcelGapDiagnostics([
      {
        id: 'parcel:bl',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel BL',
        vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
        vertexLabels: ['A', 'B', 'C', 'D'],
      },
      {
        id: 'parcel:bm',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel BM',
        vertices: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }],
        vertexLabels: ['E', 'F', 'G', 'H'],
      },
      {
        id: 'parcel:br',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel BR',
        vertices: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }],
        vertexLabels: ['I', 'J', 'K', 'L'],
      },
      {
        id: 'parcel:lm',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel LM',
        vertices: [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }],
        vertexLabels: ['M', 'N', 'O', 'P'],
      },
      {
        id: 'parcel:rm',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel RM',
        vertices: [{ x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 20 }, { x: 20, y: 20 }],
        vertexLabels: ['Q', 'R', 'S', 'T'],
      },
      {
        id: 'parcel:tl',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel TL',
        vertices: [{ x: 0, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 30 }, { x: 0, y: 30 }],
        vertexLabels: ['U', 'V', 'W', 'X'],
      },
      {
        id: 'parcel:tm',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel TM',
        vertices: [{ x: 10, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 30 }, { x: 10, y: 30 }],
        vertexLabels: ['Y', 'Z', 'AA', 'AB'],
      },
      {
        id: 'parcel:tr',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel TR',
        vertices: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 20, y: 30 }],
        vertexLabels: ['AC', 'AD', 'AE', 'AF'],
      },
    ]);

    expect(diagnostics.isSupported).toBe(true);
    expect(diagnostics.componentCount).toBe(2);
    expect(diagnostics.exposedLoopCount).toBe(2);
    expect(diagnostics.gapLoops).toHaveLength(1);
    expect(diagnostics.gapLoops[0]?.areaSquareMeters ?? Number.NaN).toBeCloseTo(100, 6);
    expect(diagnostics.gapLoops[0]?.centroid.x ?? Number.NaN).toBeCloseTo(15, 6);
    expect(diagnostics.gapLoops[0]?.centroid.y ?? Number.NaN).toBeCloseTo(15, 6);
    expect(diagnostics.totalGapAreaSquareMeters).toBeCloseTo(100, 6);
  });

  it('converts parcel area square meters into shared display units', () => {
    const converted = cadConvertAreaSquareMeters(187.5);

    expect(converted.hectares).toBeCloseTo(0.01875, 8);
    expect(converted.acres).toBeCloseTo(0.046332259, 8);
    expect(converted.squareFeet).toBeCloseTo(2018.2332031, 6);
  });
});
