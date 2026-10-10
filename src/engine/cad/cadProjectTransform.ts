// Phase 195.11 facade: low-level kernel lives in ./cadProjectTransformCore;
// request-level API (solve + delegate) lives in ./cadProjectTransformRequest.
// Command/panel/report seams keep importing from this one path.
export * from './cadProjectTransformCore';
export type {
  ApplyCadProjectTransformResult,
  ProjectTransformGridGroundDirection,
  ProjectTransformOutcome,
  ProjectTransformRequest,
} from './cadProjectTransformRequest';
export { applyCadProjectTransform, projectTransformAffectedCounts } from './cadProjectTransformRequest';
