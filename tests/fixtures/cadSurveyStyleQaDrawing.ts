// Phase 18D visual-QA + export-QA fixture (deterministic).
//
// One drawing exercising point styles + label styles + point groups +
// group precedence + manual override + F2F base + No Display + No Label:
// control/monument, iron pins (boundary), topo, trees, utility, building,
// edge/toe, and one unmapped code. Export/browser goldens build from here.
import { createBlankCadDrawingDocument } from '../../src/engine/cad/cadDrawingFile';
import type {
  CadPointLabelStyleId,
  CadProject,
  CadSurveyPointEntity,
  CadTextEntity,
} from '../../src/engine/cad/cadTypes';
import type { FeatureCodeCatalog } from '../../src/engine/fieldToFinish/featureCatalog';

const pt = (
  id: string,
  stationId: string,
  x: number,
  y: number,
  z: number,
  pointClass: CadSurveyPointEntity['pointClass'],
  description: string,
  featureCode: string,
  extra: Partial<CadSurveyPointEntity> = {},
): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass,
  source: 'parsed-input',
  description,
  featureCode,
  ...extra,
});

const label = (
  stationId: string,
  x: number,
  y: number,
  text: string,
  labelStyleId: CadPointLabelStyleId,
): CadTextEntity => ({
  id: `label:${stationId}`,
  type: 'text',
  layerId: 'labels',
  visible: true,
  locked: false,
  x,
  y,
  text,
  anchorEntityId: `pt:${stationId}`,
  pointLabel: { pointEntityId: `pt:${stationId}`, labelStyleId, content: { mode: 'derived' } },
  metadata: { stationId, provenance: 'qa-18d' },
});

export const buildSurveyStyleQaProject = (): CadProject => {
  const doc = createBlankCadDrawingDocument({ name: 'Survey Style QA', units: 'm' });
  const project = doc.project;
  project.pointGroups = [
    ...(project.pointGroups ?? []),
    {
      id: 'point-group-trees',
      name: 'Trees',
      query: { featureCodePattern: 'TREE*' },
      priority: 10,
      description: 'QA: all tree shots.',
      pointStyleOverrideId: 'point-style-tree',
      pointLabelStyleOverrideId: 'point-label-point-number-description',
    },
    {
      id: 'point-group-boundary',
      name: 'Boundary',
      query: { featureCodePattern: 'IP*' },
      priority: 20,
      description: 'QA: iron pins and boundary corners.',
      pointStyleOverrideId: 'point-style-boundary',
    },
    {
      id: 'point-group-utilities',
      name: 'Utilities',
      query: { featureCodePattern: 'UP*' },
      priority: 30,
      description: 'QA: utility shots.',
      pointStyleOverrideId: 'point-style-utility',
    },
  ];
  project.entities = [
    pt('pt:C1', 'C1', 0, 0, 100, 'control', 'Control station', 'MON', {
      pointStyleId: 'point-style-monument',
      pointLabelStyleId: 'point-label-f2f-full',
    }),
    pt('pt:IP1', 'IP1', 10, 0, 99.5, 'free', 'Iron pin found', 'IP', {
      pointStyleId: 'point-style-standard',
    }),
    pt('pt:IP2', 'IP2', 20, 5, 99.4, 'free', 'Iron pin set', 'IP', {
      // Manual override beats the Boundary group.
      pointStyleOverrideId: 'point-style-monument',
    }),
    pt('pt:T1', 'T1', 30, 10, 98.9, 'free', 'Oak 24in', 'TREE-OAK', {
      pointStyleId: 'point-style-standard',
    }),
    pt('pt:T2', 'T2', 35, 12, 98.7, 'free', 'Pine 18in', 'TREE-PINE', {
      pointStyleId: 'point-style-standard',
    }),
    pt('pt:UP1', 'UP1', 40, 0, 99.1, 'free', 'Power pole', 'UP', {
      pointStyleId: 'point-style-standard',
    }),
    pt('pt:B1', 'B1', 50, 20, 99.8, 'free', 'Building corner', 'BLDG', {
      pointStyleId: 'point-style-survey',
    }),
    pt('pt:E1', 'E1', 60, 0, 99.2, 'free', 'Edge of pavement', 'EP', {
      pointStyleId: 'point-style-topo',
    }),
    pt('pt:TOE1', 'TOE1', 65, -5, 98.5, 'free', 'Toe of slope', 'TOE', {
      pointStyleId: 'point-style-topo',
    }),
    pt('pt:U1', 'U1', 70, 10, 99, 'free', 'Unmapped shot', 'ZZZ', {
      pointStyleId: 'point-style-standard',
    }),
    pt('pt:ND1', 'ND1', 80, 0, 99, 'free', 'Hidden marker', 'TOP', {
      pointStyleId: 'point-style-standard',
      pointStyleOverrideId: 'point-style-no-display',
    }),
    pt('pt:NL1', 'NL1', 90, 0, 99, 'free', 'Unlabeled shot', 'TOP', {
      pointStyleId: 'point-style-topo',
      pointLabelStyleOverrideId: 'point-label-none',
    }),
  ];
  project.metadata = { ...project.metadata, stationCount: project.entities.length };
  // Derived labels for the labeled legs (NL1 intentionally has none: No Label).
  project.entities.push(
    label('C1', 0, 0, 'C1 Control station MON EL 100.000', 'point-label-f2f-full'),
    label('IP1', 10, 0, 'IP1', 'point-label-point-number'),
    label('T1', 30, 10, 'T1 Oak 24in', 'point-label-point-number-description'),
    label('UP1', 40, 0, 'UP1 Power pole', 'point-label-point-number-description'),
    label('E1', 60, 0, 'E1 Edge of pavement EP EL 99.200', 'point-label-f2f-full'),
    label('U1', 70, 10, 'U1 Unmapped shot', 'point-label-point-number-description'),
  );
  return project;
};

/** Small realistic F2F QA catalog: code -> layer + base style mapping. */
export const buildSurveyStyleQaCatalog = (): FeatureCodeCatalog => {
  const def = (
    code: string,
    description: string,
    layer: string,
    pointStyleId: string,
  ): FeatureCodeCatalog['definitions'][number] => ({
    id: code.toLowerCase(),
    code,
    description,
    layer,
    pointBehavior: 'point',
    lineworkBehavior: { enabled: false, implicitContinuation: false },
    pointStyleId,
    labelStyleId: 'point-label-f2f-full',
  });
  return {
    id: 'qa-18d',
    name: 'QA 18D',
    version: '1',
    definitions: [
      def('IP', 'Iron pin', 'F2F-BOUNDARY', 'point-style-boundary'),
      def('MON', 'Monument', 'F2F-CONTROL', 'point-style-monument'),
      def('TREE', 'Tree', 'F2F-VEG', 'point-style-tree'),
      def('UP', 'Utility', 'F2F-UTIL', 'point-style-utility'),
      def('BLDG', 'Building', 'F2F-BLDG', 'point-style-survey'),
      def('EP', 'Edge', 'F2F-EDGE', 'point-style-topo'),
      def('TOP', 'Topo', 'F2F-TOPO', 'point-style-topo'),
      def('TOE', 'Toe', 'F2F-TOPO', 'point-style-topo'),
    ],
    aliases: [{ alias: 'TREE-OAK', targetCode: 'TREE' }, { alias: 'TREE-PINE', targetCode: 'TREE' }],
  };
};
