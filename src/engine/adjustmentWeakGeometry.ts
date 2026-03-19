import type {
  RelativeCovarianceBlock,
  StationCovarianceBlock,
  WeakGeometryDiagnostics,
  WeakGeometryRelativeCue,
  WeakGeometrySeverity,
  WeakGeometryStationCue,
} from '../types';

const SEVERITY_ORDER: Record<WeakGeometrySeverity, number> = {
  weak: 2,
  watch: 1,
  ok: 0,
};

const medianOfPositiveFinite = (values: number[]): number | undefined => {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return 0.5 * (sorted[mid - 1] + sorted[mid]);
};

const cueSortWeight = (
  severity: WeakGeometrySeverity,
  relativeToMedian?: number,
  ellipseRatio?: number,
  metric?: number,
): [number, number, number, number] => [
  SEVERITY_ORDER[severity],
  relativeToMedian ?? 0,
  ellipseRatio ?? 0,
  metric ?? 0,
];

const compareCueWeights = (
  a: [number, number, number, number],
  b: [number, number, number, number],
): number => {
  for (let idx = 0; idx < a.length; idx += 1) {
    if (b[idx] !== a[idx]) return b[idx] - a[idx];
  }
  return 0;
};

const stationHorizontalMetric = (block: StationCovarianceBlock): number =>
  block.ellipse?.semiMajor ?? Math.max(block.sigmaE, block.sigmaN);

const relativeDistanceMetric = (block: RelativeCovarianceBlock): number =>
  block.sigmaDist ?? block.ellipse?.semiMajor ?? Math.max(block.sigmaE, block.sigmaN);

export const classifyWeakGeometrySeverity = (
  relativeToMedian: number,
  ellipseRatio?: number,
): WeakGeometrySeverity => {
  if (relativeToMedian >= 2.5 || (ellipseRatio != null && ellipseRatio >= 10)) return 'weak';
  if (relativeToMedian >= 1.6 || (ellipseRatio != null && ellipseRatio >= 5)) return 'watch';
  return 'ok';
};

const buildStationCue = (
  block: StationCovarianceBlock,
  stationMedian?: number,
): WeakGeometryStationCue => {
  const horizontalMetric = stationHorizontalMetric(block);
  const relativeToMedian =
    stationMedian && stationMedian > 0 ? horizontalMetric / stationMedian : 1;
  const ellipseRatio =
    block.ellipse != null ? block.ellipse.semiMajor / Math.max(block.ellipse.semiMinor, 1e-12) : undefined;
  const severity = classifyWeakGeometrySeverity(relativeToMedian, ellipseRatio);
  return {
    stationId: block.stationId,
    severity,
    horizontalMetric,
    verticalMetric: block.sigmaH,
    relativeToMedian,
    ellipseRatio,
    note: `major=${horizontalMetric.toFixed(4)}m, medianRatio=${relativeToMedian.toFixed(2)}x${ellipseRatio != null ? `, shape=${ellipseRatio.toFixed(2)}x` : ''}`,
  };
};

const buildRelativeCue = (
  block: RelativeCovarianceBlock,
  relativeMedian?: number,
): WeakGeometryRelativeCue => {
  const distanceMetric = relativeDistanceMetric(block);
  const relativeToMedian =
    relativeMedian && relativeMedian > 0 ? distanceMetric / relativeMedian : 1;
  const ellipseRatio =
    block.ellipse != null ? block.ellipse.semiMajor / Math.max(block.ellipse.semiMinor, 1e-12) : undefined;
  const severity = classifyWeakGeometrySeverity(relativeToMedian, ellipseRatio);
  return {
    from: block.from,
    to: block.to,
    severity,
    distanceMetric,
    relativeToMedian,
    ellipseRatio,
    note: `sigmaDist=${distanceMetric.toFixed(4)}m, medianRatio=${relativeToMedian.toFixed(2)}x${ellipseRatio != null ? `, shape=${ellipseRatio.toFixed(2)}x` : ''}`,
  };
};

const compareStationCues = (a: WeakGeometryStationCue, b: WeakGeometryStationCue): number => {
  const cmp = compareCueWeights(
    cueSortWeight(a.severity, a.relativeToMedian, a.ellipseRatio, a.horizontalMetric),
    cueSortWeight(b.severity, b.relativeToMedian, b.ellipseRatio, b.horizontalMetric),
  );
  if (cmp !== 0) return cmp;
  return a.stationId.localeCompare(b.stationId, undefined, { numeric: true });
};

const compareRelativeCues = (a: WeakGeometryRelativeCue, b: WeakGeometryRelativeCue): number => {
  const cmp = compareCueWeights(
    cueSortWeight(a.severity, a.relativeToMedian, a.ellipseRatio, a.distanceMetric),
    cueSortWeight(b.severity, b.relativeToMedian, b.ellipseRatio, b.distanceMetric),
  );
  if (cmp !== 0) return cmp;
  const fromCmp = a.from.localeCompare(b.from, undefined, { numeric: true });
  if (fromCmp !== 0) return fromCmp;
  return a.to.localeCompare(b.to, undefined, { numeric: true });
};

export const buildWeakGeometryDiagnostics = (
  stationCovariances: StationCovarianceBlock[],
  relativeCovariances: RelativeCovarianceBlock[],
): WeakGeometryDiagnostics => {
  const stationMedian = medianOfPositiveFinite(stationCovariances.map(stationHorizontalMetric));
  const relativeMedian = medianOfPositiveFinite(relativeCovariances.map(relativeDistanceMetric));
  const stationCues = stationCovariances
    .map((block) => buildStationCue(block, stationMedian))
    .sort(compareStationCues);
  const relativeCues = relativeCovariances
    .map((block) => buildRelativeCue(block, relativeMedian))
    .sort(compareRelativeCues);
  return {
    enabled: true,
    stationMedianHorizontal: stationMedian ?? 0,
    relativeMedianDistance: relativeMedian,
    stationCues,
    relativeCues,
  };
};
