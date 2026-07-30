import { describe, expect, it } from 'vitest';
import {
  cadBuildParcelSplitByAreaDraft,
  cadBuildParcelSplitBySlideDraft,
  cadBuildParcelSplitBySwingDraft,
  cadBuildParcelLayoutPreviewCandidate,
  cadBuildParcelAutoLayoutDraft,
  cadEvaluateParcelLayoutConstraints,
  cadBuildParcelClosureSummary,
  parcelLayoutTestParcel,
  parcelLayoutFrontage,
  parcelLayoutSettings,
  parcelLayoutOffsetTestParcel,
  parcelLayoutScoreTestParcel,
  parcelLayoutScoreFrontage,
  parcelLayoutAutoTestParcel,
  parcelLayoutAutoFrontage,
  parcelLayoutOffsetFrontage,
} from './cadCogoTestSupport';

describe('Survey CAD COGO helpers', () => {
  it('splits a parcel by a through-point target area into two child loops', () => {
    const split = cadBuildParcelSplitByAreaDraft(
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
          { x: 25, y: 0 },
          { x: 25, y: 15 },
        ],
        vertexLabels: ['A', 'P1', 'P2'],
      },
      { x: 20, y: 6 },
      67.5,
    );

    expect(split).not.toBeNull();
    const childAreas = [split?.firstVertices ?? [], split?.secondVertices ?? []]
      .map((vertices) => cadBuildParcelClosureSummary(vertices)?.areaSquareMeters ?? Number.NaN)
      .sort((left, right) => left - right);
    expect(childAreas[0]).toBeCloseTo(67.5, 2);
    expect(childAreas[1]).toBeCloseTo(120, 2);
  });

  it('builds a parcel slide draft from a matched frontage edge', () => {
    const layoutDraft = cadBuildParcelSplitBySlideDraft(
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
          { x: 25, y: 0 },
          { x: 25, y: 15 },
        ],
        vertexLabels: ['A', 'P1', 'P2'],
      },
      {
        id: 'line:A|P1',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'A',
        toStationId: 'P1',
        fromX: 0,
        fromY: 0,
        toX: 25,
        toY: 0,
        sourceObservationIds: [],
      },
      67.5,
      10,
      'start',
    );

    expect(layoutDraft).not.toBeNull();
    expect(layoutDraft?.alternative).toBe('start');
    expect(layoutDraft?.frontageLengthMeters ?? Number.NaN).toBeCloseTo(15, 2);
    expect(layoutDraft?.childAreaSquareMeters ?? Number.NaN).toBeCloseTo(67.5, 2);
  });

  it('builds a parcel swing draft from a matched frontage edge', () => {
    const layoutDraft = cadBuildParcelSplitBySwingDraft(
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
          { x: 25, y: 0 },
          { x: 25, y: 15 },
        ],
        vertexLabels: ['A', 'P1', 'P2'],
      },
      {
        id: 'line:A|P1',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'A',
        toStationId: 'P1',
        fromX: 0,
        fromY: 0,
        toX: 25,
        toY: 0,
        sourceObservationIds: [],
      },
      67.5,
      10,
      'start',
    );

    expect(layoutDraft).not.toBeNull();
    expect(layoutDraft?.alternative).toBe('start');
    expect(layoutDraft?.frontageLengthMeters ?? Number.NaN).toBeCloseTo(25, 6);
    expect(layoutDraft?.childAreaSquareMeters ?? Number.NaN).toBeCloseTo(67.5, 2);
  });

  it('evaluates a valid slide preview candidate with width and depth metrics', () => {
    const candidate = cadBuildParcelLayoutPreviewCandidate(
      parcelLayoutTestParcel,
      parcelLayoutFrontage,
      parcelLayoutSettings(),
      'slide',
      'start',
    );

    expect(candidate.draft).not.toBeNull();
    expect(candidate.evaluation).not.toBeNull();
    expect(candidate.isValid).toBe(true);
    expect(candidate.evaluation?.minimumSampledWidthMeters ?? Number.NaN).toBeCloseTo(
      candidate.draft?.frontageLengthMeters ?? Number.NaN,
      6,
    );
    expect(candidate.evaluation?.depthMeters ?? Number.NaN).toBeCloseTo(60, 6);
  });

  it('rejects a slide preview when frontage-at-offset width fails', () => {
    const candidate = cadBuildParcelLayoutPreviewCandidate(
      parcelLayoutOffsetTestParcel,
      parcelLayoutOffsetFrontage,
      parcelLayoutSettings({
        useFrontageAtOffset: true,
        frontageOffsetMeters: 10,
        minAreaSquareMeters: 600,
        minFrontageMeters: 24,
      }),
      'slide',
      'start',
    );

    expect(candidate.isValid).toBe(false);
    expect(candidate.evaluation?.failedRuleCodes).toContain('frontage_at_offset');
  });

  it('rejects a swing preview when minimum depth fails', () => {
    const draft = cadBuildParcelSplitBySwingDraft(
      parcelLayoutTestParcel,
      parcelLayoutFrontage,
      1200,
      20,
      'start',
    );
    expect(draft).not.toBeNull();
    if (!draft) throw new Error('Expected swing draft');

    const evaluation = cadEvaluateParcelLayoutConstraints(
      draft,
      parcelLayoutFrontage,
      parcelLayoutSettings({ minDepthMeters: 70 }),
    );

    expect(evaluation.failedRuleCodes).toContain('min_depth');
  });

  it('scores start and end slide alternatives by solution preference', () => {
    const startCandidate = cadBuildParcelLayoutPreviewCandidate(
      parcelLayoutScoreTestParcel,
      parcelLayoutScoreFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 600,
        solutionPreference: 'shortest_frontage',
      }),
      'slide',
      'start',
    );
    const endCandidate = cadBuildParcelLayoutPreviewCandidate(
      parcelLayoutScoreTestParcel,
      parcelLayoutScoreFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 600,
        solutionPreference: 'shortest_frontage',
      }),
      'slide',
      'end',
    );

    expect(startCandidate.isValid).toBe(true);
    expect(endCandidate.isValid).toBe(true);
    expect(startCandidate.draft?.frontageLengthMeters ?? Number.NaN).toBeLessThan(
      endCandidate.draft?.frontageLengthMeters ?? Number.NaN,
    );
    expect(startCandidate.evaluation?.score ?? Number.NaN).toBeLessThan(
      endCandidate.evaluation?.score ?? Number.NaN,
    );
  });

  it('builds auto layout lots and keeps remainder in the last parcel', () => {
    const autoLayout = cadBuildParcelAutoLayoutDraft(
      parcelLayoutAutoTestParcel,
      parcelLayoutAutoFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 1200,
        minFrontageMeters: 20,
        remainderDistribution: 'place_remainder_in_last_parcel',
      }),
      'slide',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.generatedParcels).toHaveLength(4);
    expect(
      autoLayout.generatedParcels.map(
        (generatedParcel) =>
          cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? Number.NaN,
      ),
    ).toEqual([
      expect.closeTo(1200, 3),
      expect.closeTo(1200, 3),
      expect.closeTo(1200, 3),
      expect.closeTo(1800, 3),
    ]);
  });

  it('uses frontage and depth constraints to size first automatic lot when minimum area is smaller', () => {
    const autoLayout = cadBuildParcelAutoLayoutDraft(
      {
        ...parcelLayoutAutoTestParcel,
        vertices: [
          { x: 0, y: 0 },
          { x: 1200, y: 0 },
          { x: 1200, y: 500 },
          { x: 0, y: 500 },
        ],
        vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4'],
      },
      {
        ...parcelLayoutAutoFrontage,
        fromStationId: 'CAD1',
        toStationId: 'CAD2',
        toX: 1200,
      },
      parcelLayoutSettings({
        minAreaSquareMeters: 100,
        minFrontageMeters: 30,
        minWidthMeters: 20,
        minDepthMeters: 20,
        remainderDistribution: 'create_parcel_from_remainder',
      }),
      'slide',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates.length).toBeGreaterThan(30);
    expect(autoLayout.acceptedCandidates[0]?.evaluation?.failedRuleCodes).toEqual([]);
    expect(autoLayout.acceptedCandidates[0]?.draft?.frontageLengthMeters ?? Number.NaN).toBeCloseTo(30, 3);
    expect(autoLayout.acceptedCandidates[0]?.draft?.childAreaSquareMeters ?? Number.NaN).toBeCloseTo(15000, 3);
  });

  it('builds auto layout lots and creates a separate remainder parcel', () => {
    const autoLayout = cadBuildParcelAutoLayoutDraft(
      parcelLayoutAutoTestParcel,
      parcelLayoutAutoFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 1200,
        minFrontageMeters: 20,
        remainderDistribution: 'create_parcel_from_remainder',
      }),
      'slide',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.generatedParcels).toHaveLength(5);
    expect(autoLayout.generatedParcels.at(-1)?.role).toBe('remainder');
    expect(
      cadBuildParcelClosureSummary(autoLayout.generatedParcels.at(-1)?.vertices ?? [])?.areaSquareMeters ?? Number.NaN,
    ).toBeCloseTo(600, 3);
  });

  it('redistributes auto layout remainder across same lot count', () => {
    const autoLayout = cadBuildParcelAutoLayoutDraft(
      parcelLayoutAutoTestParcel,
      parcelLayoutAutoFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 1200,
        minFrontageMeters: 20,
        remainderDistribution: 'redistribute_remainder',
      }),
      'slide',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates).toHaveLength(3);
    expect(autoLayout.generatedParcels).toHaveLength(4);
    expect(autoLayout.generatedParcels.every((generatedParcel) => generatedParcel.role === 'lot')).toBe(true);
    expect(autoLayout.statusMessage).toContain('redistributed remainder across 4 lots');
    expect(
      autoLayout.generatedParcels.map(
        (generatedParcel) =>
          cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? Number.NaN,
      ),
    ).toEqual([
      expect.closeTo(1350, 3),
      expect.closeTo(1350, 3),
      expect.closeTo(1350, 3),
      expect.closeTo(1350, 3),
    ]);
  });

  it('builds a swing auto layout draft from the selected frontage', () => {
    const autoLayout = cadBuildParcelAutoLayoutDraft(
      parcelLayoutAutoTestParcel,
      parcelLayoutAutoFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 300,
        minFrontageMeters: 20,
        minWidthMeters: 5,
        minDepthMeters: 5,
        remainderDistribution: 'create_parcel_from_remainder',
      }),
      'swing',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates).toHaveLength(1);
    expect(autoLayout.acceptedCandidates[0]?.tool).toBe('swing');
    expect(autoLayout.generatedParcels).toHaveLength(2);
    expect(autoLayout.generatedParcels[0]?.role).toBe('lot');
    expect(autoLayout.generatedParcels[1]?.role).toBe('remainder');
  });

});
