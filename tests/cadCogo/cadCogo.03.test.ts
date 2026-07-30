import { describe, expect, it } from 'vitest';
import {
  cadBuildParcelLineworkDiagnostics,
  cadBuildParcelSplitByBearingDraft,
  cadBuildParcelSplitByLineDraft,
  cadBuildParcelClosureSummary,
  cadBuildParcelReportSummary,
  cadArcPointByArcDistance,
  cadArcPointByChordDistance,
  cadArcSubdivisionPoints,
  cadOffsetArc,
  cadRadialBearingAtArcAngle,
  cadBuildArcFromStartCenterEnd,
  cadBuildArcFromStartEndAngle,
  cadBuildContinuedArc,
} from './cadCogoTestSupport';

describe('Survey CAD COGO helpers', () => {
  it('computes radial bearing, point-on-curve, subdivision, and offset-curve helpers', () => {
    const arc = {
      centerX: 0,
      centerY: 0,
      radius: 10,
      startAngleDeg: 0,
      endAngleDeg: 90,
    };

    expect(cadRadialBearingAtArcAngle({ arc, angleDeg: 0 })).toBe('N90-00-00.00E');

    const byArc = cadArcPointByArcDistance(arc, (Math.PI * 10) / 4);
    expect(byArc?.x ?? Number.NaN).toBeCloseTo(Math.sqrt(50), 6);
    expect(byArc?.y ?? Number.NaN).toBeCloseTo(Math.sqrt(50), 6);

    const byChord = cadArcPointByChordDistance(arc, 10);
    expect(byChord?.x ?? Number.NaN).toBeCloseTo(5, 6);
    expect(byChord?.y ?? Number.NaN).toBeCloseTo(8.660254, 6);

    const equalPoints = cadArcSubdivisionPoints({ arc, mode: 'equal', value: 4 });
    expect(equalPoints).toHaveLength(3);

    const offset = cadOffsetArc({ arc, offsetDistance: 2, side: 'right' });
    expect(offset?.radius ?? Number.NaN).toBeCloseTo(12, 6);
  });

  it('keeps the picked center and projects start-center-end endpoint direction onto the arc radius', () => {
    const projected = cadBuildArcFromStartCenterEnd(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 8 },
    );

    expect(projected).not.toBeNull();
    expect(projected?.center.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(projected?.center.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(projected?.radius ?? Number.NaN).toBeCloseTo(10, 6);
    expect(projected?.endPoint.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(projected?.endPoint.y ?? Number.NaN).toBeCloseTo(10, 6);
  });

  it('keeps picked start/end points for clockwise and reverse center-driven arcs', () => {
    const clockwise = cadBuildArcFromStartCenterEnd(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -10 },
    );

    expect(clockwise).not.toBeNull();
    expect(clockwise?.startPoint.x ?? Number.NaN).toBeCloseTo(10, 6);
    expect(clockwise?.startPoint.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(clockwise?.endPoint.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(clockwise?.endPoint.y ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(clockwise?.deltaDeg ?? Number.NaN).toBeCloseTo(90, 6);

    const reverse = cadBuildArcFromStartCenterEnd(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -10 },
      true,
    );

    expect(reverse).not.toBeNull();
    expect(reverse?.startPoint.x ?? Number.NaN).toBeCloseTo(10, 6);
    expect(reverse?.startPoint.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(reverse?.endPoint.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(reverse?.endPoint.y ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(reverse?.deltaDeg ?? Number.NaN).toBeCloseTo(270, 6);
  });

  it('keeps start/end order and tangency for clockwise continue-curve and start-end-angle arcs', () => {
    const sourceArc = cadBuildArcFromStartCenterEnd(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -10 },
    );
    expect(sourceArc).not.toBeNull();
    if (!sourceArc) throw new Error('Source arc not created');

    const continuedArc = cadBuildContinuedArc(
      {
        centerX: sourceArc.center.x,
        centerY: sourceArc.center.y,
        radius: sourceArc.radius,
        startAngleDeg: sourceArc.startAngleDeg,
        endAngleDeg: sourceArc.endAngleDeg,
      },
      { x: -10, y: 0 },
    );
    expect(continuedArc).not.toBeNull();
    expect(continuedArc?.startPoint.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(continuedArc?.startPoint.y ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(continuedArc?.endPoint.x ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(continuedArc?.endPoint.y ?? Number.NaN).toBeCloseTo(0, 6);

    const startEndAngle = cadBuildArcFromStartEndAngle(
      { x: 10, y: 0 },
      { x: 0, y: -10 },
      90,
    );
    expect(startEndAngle).not.toBeNull();
    expect(startEndAngle?.startPoint.x ?? Number.NaN).toBeCloseTo(10, 6);
    expect(startEndAngle?.startPoint.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(startEndAngle?.endPoint.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(startEndAngle?.endPoint.y ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(startEndAngle?.deltaDeg ?? Number.NaN).toBeCloseTo(90, 6);
  });

  it('computes parcel closure metrics from traverse-style vertices', () => {
    const summary = cadBuildParcelClosureSummary([
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 25, y: 15 },
      { x: 0, y: 0 },
    ]);

    expect(summary).not.toBeNull();
    expect(summary?.areaSquareMeters ?? Number.NaN).toBeCloseTo(187.5, 6);
    expect(summary?.perimeterMeters ?? Number.NaN).toBeCloseTo(69.154759, 6);
    expect(summary?.closureDistanceMeters ?? Number.NaN).toBeCloseTo(0, 6);
    expect(summary?.centroid.x ?? Number.NaN).toBeCloseTo(16.6666667, 6);
    expect(summary?.centroid.y ?? Number.NaN).toBeCloseTo(5, 6);
  });

  it('builds a parcel closure report with ordered course azimuths and distances', () => {
    const report = cadBuildParcelReportSummary({
      parcelName: 'Parcel 1',
      vertices: [
        { x: 0, y: 0 },
        { x: 25, y: 0 },
        { x: 25, y: 15 },
        { x: 0, y: 0 },
      ],
      vertexLabels: ['A', 'B', 'C', 'A'],
    });

    expect(report).not.toBeNull();
    expect(report?.parcelName).toBe('Parcel 1');
    expect(report?.courseCount).toBe(3);
    expect(report?.courses.map((course) => `${course.fromLabel}-${course.toLabel}`)).toEqual([
      'A-B',
      'B-C',
      'C-A',
    ]);
    expect(report?.courses[0]?.azimuthText).toBe('90°00\'00"');
    expect(report?.courses[0]?.distanceMeters ?? Number.NaN).toBeCloseTo(25, 6);
    expect(report?.courses[1]?.azimuthText).toBe('0°00\'00"');
    expect(report?.courses[1]?.distanceMeters ?? Number.NaN).toBeCloseTo(15, 6);
    expect(report?.closureDistanceMeters ?? Number.NaN).toBeCloseTo(0, 6);
  });

  it('builds an implied-closure parcel report from an open point sequence', () => {
    const report = cadBuildParcelReportSummary({
      parcelName: 'Area Sequence',
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ],
      vertexLabels: ['A', 'B', 'C'],
    });

    expect(report).not.toBeNull();
    expect(report?.courseCount).toBe(3);
    expect(report?.areaSquareMeters ?? Number.NaN).toBeCloseTo(50, 6);
    expect(report?.perimeterMeters ?? Number.NaN).toBeCloseTo(34.142136, 6);
    expect(report?.closureDeltaX ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(report?.closureDeltaY ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(report?.closureDistanceMeters ?? Number.NaN).toBeCloseTo(14.142136, 6);
    expect(report?.courses.map((course) => `${course.fromLabel}-${course.toLabel}`)).toEqual([
      'A-B',
      'B-C',
      'C-A',
    ]);
  });

  it('diagnoses open ends and overlaps in parcel linework', () => {
    const diagnostics = cadBuildParcelLineworkDiagnostics([
      {
        id: 'line:A|B:1',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'A',
        toStationId: 'B',
        fromX: 0,
        fromY: 0,
        toX: 10,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'line:B|C',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'B',
        toStationId: 'C',
        fromX: 10,
        fromY: 0,
        toX: 20,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'line:A|B:2',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'A',
        toStationId: 'B',
        fromX: 0,
        fromY: 0,
        toX: 10,
        toY: 0,
        sourceObservationIds: [],
      },
    ]);

    expect(diagnostics.lineCount).toBe(3);
    expect(diagnostics.nodeCount).toBe(3);
    expect(diagnostics.componentCount).toBe(1);
    expect(diagnostics.isClosedLoopCandidate).toBe(false);
    expect(diagnostics.danglingNodes.map((node) => node.label)).toEqual(['C']);
    expect(diagnostics.branchNodes.map((node) => node.label)).toEqual(['B']);
    expect(diagnostics.overlapSegments).toEqual([
      {
        firstLabel: 'A',
        secondLabel: 'B',
        segmentCount: 2,
        lengthMeters: 10,
      },
    ]);
  });

  it('splits a parcel by a crossing line into two child loops', () => {
    const split = cadBuildParcelSplitByLineDraft(
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
        id: 'line:split',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'S1',
        toStationId: 'S2',
        fromX: 20,
        fromY: -5,
        toX: 20,
        toY: 20,
        sourceObservationIds: [],
      },
    );

    expect(split).not.toBeNull();
    const childAreas = [split?.firstVertices ?? [], split?.secondVertices ?? []]
      .map((vertices) => cadBuildParcelClosureSummary(vertices)?.areaSquareMeters ?? Number.NaN)
      .sort((left, right) => left - right);
    expect(split?.splitStart.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(split?.splitStart.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(split?.splitEnd.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(split?.splitEnd.y ?? Number.NaN).toBeCloseTo(12, 6);
    expect(childAreas[0]).toBeCloseTo(67.5, 6);
    expect(childAreas[1]).toBeCloseTo(120, 6);
  });

  it('splits a parcel by a through-point bearing into two child loops', () => {
    const split = cadBuildParcelSplitByBearingDraft(
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
      'N00-00-00E',
    );

    expect(split).not.toBeNull();
    const childAreas = [split?.firstVertices ?? [], split?.secondVertices ?? []]
      .map((vertices) => cadBuildParcelClosureSummary(vertices)?.areaSquareMeters ?? Number.NaN)
      .sort((left, right) => left - right);
    expect(split?.splitStart.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(split?.splitStart.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(split?.splitEnd.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(split?.splitEnd.y ?? Number.NaN).toBeCloseTo(12, 6);
    expect(childAreas[0]).toBeCloseTo(67.5, 6);
    expect(childAreas[1]).toBeCloseTo(120, 6);
  });

});
