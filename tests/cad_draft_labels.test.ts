import { describe, expect, it } from 'vitest';
import { buildCadInverseSummary, formatCadBearing } from '../src/engine/cad/cadCogoSummaries';
import { cadBuildCurveMetricsSummaryFromRadiusDelta } from '../src/engine/cad/cadCogoCurveMetrics';
import {
  cadBuildParcelClosureSummary,
  cadBuildParcelReportSummary,
} from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import {
  applyLabelOverride,
  BROKEN_REFERENCE_TEXT,
  classifyLabelReference,
  clearLabelOverride,
  createDraftLabel,
  deriveCurveAutoText,
  deriveInverseAutoText,
  deriveParcelAreaAutoText,
  deriveParcelCourseAutoText,
  derivePointAutoText,
  moveDraftLabel,
  resolveDraftLabel,
  resolveLabelPaperHeightMm,
} from '../src/engine/cad/cadLabelEngine';

const from = { x: 0, y: 0 };
const to = { x: 100, y: 100 };
const parcel = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
  { x: 0, y: 50 },
];

describe('cad label engine derivations agree with authoritative helpers', () => {
  it('bearing/distance match buildCadInverseSummary + formatCadBearing', () => {
    const summary = buildCadInverseSummary(from, to);
    expect(deriveInverseAutoText(from, to, 'bearing')).toBe(formatCadBearing(summary.azimuthDeg));
    expect(deriveInverseAutoText(from, to, 'distance')).toBe(
      `${summary.distance.toFixed(3)} m`,
    );
    expect(deriveInverseAutoText(from, to, 'bearing-distance')).toBe(
      `${formatCadBearing(summary.azimuthDeg)} ${summary.distance.toFixed(3)} m`,
    );
  });

  it('point text uses coordinate decimals only (presentation rounding)', () => {
    expect(derivePointAutoText({ x: 1.23456, y: 2.34567 })).toBe('N 2.346, E 1.235');
  });

  it('curve text agrees with radius-delta summary', () => {
    const summary = cadBuildCurveMetricsSummaryFromRadiusDelta(100, 90);
    const text = deriveCurveAutoText(100, 90);
    expect(summary).not.toBeNull();
    expect(text).toContain(`R ${summary!.radius.toFixed(3)} m`);
    expect(text).toContain(`Arc ${summary!.arcLength.toFixed(3)} m`);
    expect(text).toContain(`Ch ${summary!.chordLength.toFixed(3)} m`);
  });

  it('area text agrees with parcel closure summary', () => {
    const closure = cadBuildParcelClosureSummary(parcel);
    expect(closure).not.toBeNull();
    expect(deriveParcelAreaAutoText(parcel)).toBe(`${closure!.areaSquareMeters.toFixed(1)} m²`);
  });

  it('parcel course text agrees with parcel report summary', () => {
    const report = cadBuildParcelReportSummary({
      parcelName: 'P1',
      vertices: parcel,
      vertexLabels: ['A', 'B', 'C', 'D'],
    });
    expect(report).not.toBeNull();
    expect(deriveParcelCourseAutoText(parcel, ['A', 'B', 'C', 'D'], 'P1', 0)).toBe(
      `${report!.courses[0]!.bearing} ${report!.courses[0]!.distanceMeters.toFixed(3)} m`,
    );
  });
});

describe('provenance, override state, broken refs', () => {
  it('tags provenance and starts at AUTO_VALUE', () => {
    const label = createDraftLabel({
      id: 'l1',
      labelType: 'distance',
      provenance: 'COGO',
      source: { kind: 'inverse', from, to },
      sourceEntityId: 'e1',
    });
    expect(label.provenance).toBe('COGO');
    expect(label.state).toBe('AUTO_VALUE');
    expect(label.displayText).toBe(label.autoValue);
  });

  it('override stores USER_OVERRIDE while keeping AUTO_VALUE', () => {
    const label = createDraftLabel({
      id: 'l2',
      labelType: 'free-text',
      provenance: 'USER_TEXT',
      source: { kind: 'text', text: 'Note' },
    });
    const overridden = applyLabelOverride(label, 'Custom');
    expect(overridden.state).toBe('USER_OVERRIDE');
    expect(overridden.displayText).toBe('Custom');
    expect(overridden.autoValue).toBe('Note');
    const cleared = clearLabelOverride(overridden);
    expect(cleared.state).toBe('AUTO_VALUE');
    expect(cleared.displayText).toBe('Note');
    expect(cleared.overrideText).toBeUndefined();
  });

  it('missing source never throws; returns BROKEN_REFERENCE without rebinding', () => {
    const label = createDraftLabel({ id: 'l3', labelType: 'area', provenance: 'ADJUSTED' });
    expect(label.autoValue).toBe(BROKEN_REFERENCE_TEXT);
    expect(label.state).toBe('BROKEN_REFERENCE');
    const refreshed = resolveDraftLabel(label, undefined);
    expect(refreshed.displayText).toBe(BROKEN_REFERENCE_TEXT);
    expect(refreshed.sourceEntityId).toBeUndefined();
    expect(classifyLabelReference(label, new Set(['e1']))).toBe('BROKEN_REFERENCE');
    expect(classifyLabelReference(label, [])).toBe('BROKEN_REFERENCE');
  });

  it('editing a label never mutates geometry: move preserves source entity id', () => {
    const label = createDraftLabel({
      id: 'l4',
      labelType: 'point',
      provenance: 'IMPORTED',
      source: { kind: 'point', point: from },
      sourceEntityId: 'pt-1',
      offsetMm: { dxMm: 1, dyMm: 2 },
    });
    const moved = moveDraftLabel(label, { dxMm: 5 });
    expect(moved.offsetMm).toEqual({ dxMm: 5, dyMm: 2 });
    expect(label.offsetMm).toEqual({ dxMm: 1, dyMm: 2 });
    expect(moved.sourceEntityId).toBe('pt-1');
  });

  it('paper text height defaults to mm normal height', () => {
    expect(resolveLabelPaperHeightMm()).toBe(3.5);
    expect(resolveLabelPaperHeightMm(5)).toBe(5);
  });
});
