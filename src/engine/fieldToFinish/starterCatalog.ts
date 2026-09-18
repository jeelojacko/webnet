/**
 * Phase 18E — drawing-owned starter survey catalog.
 *
 * Seeded into every new drawing (and legacy drawings with no F2F content).
 * These codes are STARTER-ONLY conveniences, not universal survey standards:
 * each drawing owns its copy and the operator edits it per job. The
 * SAMPLE_CATALOG fixture stays untouched for tests.
 */
import type { FeatureCodeCatalog } from './featureCatalog';

export const STARTER_CATALOG_ID = 'starter-survey';

export const STARTER_CATALOG: FeatureCodeCatalog = {
  id: STARTER_CATALOG_ID,
  name: 'WebNet Starter Survey Catalog',
  version: '1',
  definitions: [
    {
      id: 'control', code: 'CONTROL', description: 'Control station', layer: 'F2F-CONTROL',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
    {
      id: 'mon', code: 'MON', description: 'Survey monument', layer: 'F2F-MONUMENT',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
    {
      id: 'ip', code: 'IP', description: 'Iron pin', layer: 'F2F-MONUMENT',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
    {
      id: 'ep', code: 'EP', description: 'Edge of pavement', layer: 'F2F-EDGE',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: false },
      defaultAttributes: { surface: 'asphalt' },
    },
    {
      id: 'cl', code: 'CL', description: 'Centerline', layer: 'F2F-CENTERLINE',
      pointBehavior: 'none', lineworkBehavior: { enabled: true, implicitContinuation: true },
    },
    {
      id: 'top', code: 'TOP', description: 'Topographic shot', layer: 'F2F-TOPO',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
    {
      id: 'toe', code: 'TOE', description: 'Toe of slope', layer: 'F2F-TOPO',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: false },
    },
    {
      id: 'bldg', code: 'BLDG', description: 'Building footprint', layer: 'F2F-BUILDING',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: false },
    },
    {
      id: 'tree', code: 'TREE', description: 'Tree', layer: 'F2F-TREE',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
      defaultAttributes: { species: 'unknown' },
    },
    {
      id: 'up', code: 'UP', description: 'Utility pole', layer: 'F2F-UTILITY',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
    {
      id: 'mh', code: 'MH', description: 'Manhole', layer: 'F2F-UTILITY',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
  ],
  aliases: [{ alias: 'EOP', targetCode: 'EP' }],
};
