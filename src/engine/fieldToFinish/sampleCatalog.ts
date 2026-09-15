/**
 * ORIGINAL generic sample feature-code catalog for field-to-finish tests.
 *
 * Seven generic features: CONTROL, MONUMENT, EDGE, CENTERLINE, BUILDING,
 * TREE, UTILITY. Includes one alias (EP -> EDGE) and one implicit-continuation
 * code (CENTERLINE). The code ROCK is deliberately absent so fixtures can
 * exercise the unmapped path.
 */
import type { FeatureCodeCatalog } from './featureCatalog';

export const SAMPLE_CATALOG: FeatureCodeCatalog = {
  id: 'sample-generic',
  name: 'Sample generic catalog',
  version: '1',
  definitions: [
    {
      id: 'control', code: 'CONTROL', description: 'Control station', layer: 'F2F-CONTROL',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
    {
      id: 'monument', code: 'MONUMENT', description: 'Survey monument', layer: 'F2F-MONUMENT',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
    {
      id: 'edge', code: 'EDGE', description: 'Edge of pavement', layer: 'F2F-EDGE',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: false },
      defaultAttributes: { surface: 'asphalt' },
    },
    {
      id: 'centerline', code: 'CENTERLINE', description: 'Road centerline', layer: 'F2F-CENTERLINE',
      pointBehavior: 'none', lineworkBehavior: { enabled: true, implicitContinuation: true },
    },
    {
      id: 'building', code: 'BUILDING', description: 'Building footprint', layer: 'F2F-BUILDING',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: false },
    },
    {
      id: 'tree', code: 'TREE', description: 'Tree', layer: 'F2F-TREE',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
      defaultAttributes: { species: 'unknown' },
    },
    {
      id: 'utility', code: 'UTILITY', description: 'Utility locate', layer: 'F2F-UTILITY',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
  ],
  aliases: [{ alias: 'EP', targetCode: 'EDGE' }],
};
