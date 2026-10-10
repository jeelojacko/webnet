import type { CadCurveMetricMode } from '../../engine/cad/cadCurveMetricsSolver';

/** Extent metric modes (radius excluded: the radius is carried separately). */
export type CadCurveF1ExtentMode = Exclude<CadCurveMetricMode, 'radius'>;
