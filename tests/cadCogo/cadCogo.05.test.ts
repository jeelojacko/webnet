import { describe, expect, it } from 'vitest';
import {
  cadBuildParcelAutoLayoutDraftFromFrontageReference,
  cadBuildParcelFrontageStripAutoLayoutDraft,
  cadBuildParcelLayoutFrontageReference,
  parcelLayoutSettings,
  parcelLayoutAutoTestParcel,
} from './cadCogoTestSupport';
import type {
  CadParcelEntity,
} from './cadCogoTestSupport';

describe('Survey CAD COGO helpers', () => {
  it('builds auto layout across multiple frontage segments from one frontage polyline', () => {
    const frontageReference = cadBuildParcelLayoutFrontageReference({
      id: 'frontage:multi',
      type: 'polyline',
      layerId: 'planning',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      vertices: [
        { x: 0, y: 0 },
        { x: 90, y: 0 },
        { x: 90, y: 60 },
      ],
      vertexLabels: ['A', 'B', 'C'],
      closed: false,
    });
    expect(frontageReference).not.toBeNull();

    const autoLayout = cadBuildParcelAutoLayoutDraftFromFrontageReference(
      parcelLayoutAutoTestParcel,
      frontageReference!,
      parcelLayoutSettings({
        minAreaSquareMeters: 600,
        minFrontageMeters: 20,
        minWidthMeters: 10,
        minDepthMeters: 20,
        remainderDistribution: 'create_parcel_from_remainder',
      }),
      'slide',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates.length).toBeGreaterThan(2);
    expect(autoLayout.generatedParcels.length).toBeGreaterThan(3);
    expect(autoLayout.statusMessage).toContain('selected frontage edges');
  });

  it('builds frontage-strip auto lots for the screenshot parcel fixture', () => {
    const parcel = {
      id: 'parcel:fixture',
      type: 'parcel' as const,
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
      displayLabel: 'CAD1-CAD2',
      sourcePointIds: ['CAD1', 'CAD2'],
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
      parcelSegmentIds: ['parcel:fixture#0'],
      parcelSegmentLabelPairs: [['CAD1', 'CAD2']] as Array<readonly [string, string]>,
    };

    const autoLayout = cadBuildParcelFrontageStripAutoLayoutDraft(
      parcel,
      frontageReference.frontageLine,
      parcelLayoutSettings({
        minAreaSquareMeters: 100,
        minFrontageMeters: 30,
        minWidthMeters: 20,
        minDepthMeters: 20,
        useMaxDepth: true,
        maxDepthMeters: 150,
        remainderDistribution: 'place_remainder_in_last_parcel',
      }),
      'slide',
    );

    expect(autoLayout).not.toBeNull();
    expect(autoLayout?.isValid).toBe(true);
    expect(autoLayout?.generatedParcels).toHaveLength(40);
    expect(autoLayout?.acceptedCandidates).toHaveLength(39);
    expect(autoLayout?.generatedParcels.at(-1)?.role).toBe('remainder');
    expect(
      autoLayout?.acceptedCandidates.every(
        (candidate) => (candidate.evaluation?.depthMeters ?? Number.POSITIVE_INFINITY) <= 150.000001,
      ),
    ).toBe(true);
  });

  it('builds max-depth auto lots across chained parcel frontage edges without material overlap', { timeout: 15000 }, () => {
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

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates.length).toBeGreaterThanOrEqual(90);
    expect(autoLayout.generatedParcels.length).toBeGreaterThan(autoLayout.acceptedCandidates.length);
    expect(autoLayout.statusMessage).toContain('selected frontage edges');
    expect(
      autoLayout.acceptedCandidates.every(
        (candidate) => (candidate.evaluation?.depthMeters ?? Number.POSITIVE_INFINITY) <= 150.000001,
      ),
    ).toBe(true);
  });

  it('adds corner frontage-path lots on chained max-depth frontage with wider-frontage settings', { timeout: 15000 }, () => {
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
        minFrontageMeters: 40,
        minWidthMeters: 30,
        minDepthMeters: 20,
        useMaxDepth: true,
        maxDepthMeters: 150,
        remainderDistribution: 'place_remainder_in_last_parcel',
      }),
      'slide',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates.length).toBeGreaterThanOrEqual(68);
    expect(
      autoLayout.acceptedCandidates.every(
        (candidate) => (candidate.evaluation?.depthMeters ?? Number.POSITIVE_INFINITY) <= 150.000001,
      ),
    ).toBe(true);
  });

});
