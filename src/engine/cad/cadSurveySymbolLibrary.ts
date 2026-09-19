// Phase 18N — professional survey symbol seed library (UI slice).
//
// SEEDING POLICY (deterministic, never bloats legacy drawings):
// symbols are NOT written at new/open/import time. `ensureSurveySymbolsSeeded`
// clones the seed definitions into a project ONLY when the user explicitly
// opens the Block Manager Symbols view (or picks a block-backed point marker,
// which opens the same gate). Legacy drawings that never touch symbols keep
// `blockDefinitions` exactly as loaded. Seed identity = id prefix
// `webnet-survey-symbol-`; re-running the gate never duplicates (existing
// seed ids are skipped, user definitions untouched).
//
// Symbol design: original monochrome linework, ByLayer-friendly (no explicit
// color/lineweight/linetype on any child), basePoint (0,0), ~1 m nominal
// size, ≤8 entities each. No text children (labels stay associative point
// labels, never baked into symbols). Circles are full-sweep arcs (the only
// curve primitive blocks support).

import type { CadBlockChild, CadBlockDefinition, CadProject } from './cadTypes';

export type SurveySymbolCategory = 'control' | 'boundary' | 'topo' | 'utilities' | 'site';

export interface SurveySymbolSeed {
  id: string;
  name: string;
  category: SurveySymbolCategory;
  tags: string[];
  description: string;
  entities: CadBlockChild[];
}

export const SURVEY_SYMBOL_SEED_PREFIX = 'webnet-survey-symbol-';

let lineSeq = 0;
const layer = '0';

const line = (fromX: number, fromY: number, toX: number, toY: number): CadBlockChild => {
  lineSeq += 1;
  return {
    id: `seed-line-${lineSeq}`,
    type: 'line',
    layerId: layer,
    visible: true,
    locked: false,
    fromStationId: '',
    toStationId: '',
    fromX,
    fromY,
    toX,
    toY,
    sourceObservationIds: [],
  };
};

const ring = (id: string, cx: number, cy: number, r: number): CadBlockChild => ({
  id,
  type: 'arc',
  layerId: layer,
  visible: true,
  locked: false,
  centerX: cx,
  centerY: cy,
  radius: r,
  startAngleDeg: 0,
  endAngleDeg: 360,
});

const poly = (id: string, points: Array<[number, number]>): CadBlockChild => ({
  id,
  type: 'polygon',
  layerId: layer,
  visible: true,
  locked: false,
  vertices: points.map(([x, y]) => ({ x, y })),
  vertexLabels: points.map(() => ''),
});

const cross = (cx: number, cy: number, half: number): CadBlockChild[] => [
  line(cx - half, cy, cx + half, cy),
  line(cx, cy - half, cx, cy + half),
];

const square = (id: string, cx: number, cy: number, half: number): CadBlockChild =>
  poly(id, [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ]);

const triangle = (id: string, cx: number, cy: number, r: number): CadBlockChild =>
  poly(id, [
    [cx, cy + r],
    [cx - r * 0.866, cy - r * 0.5],
    [cx + r * 0.866, cy - r * 0.5],
  ]);

const seed = (
  id: string,
  name: string,
  category: SurveySymbolCategory,
  tags: string[],
  description: string,
  entities: CadBlockChild[],
): SurveySymbolSeed => ({
  id: `${SURVEY_SYMBOL_SEED_PREFIX}${id}`,
  name,
  category,
  tags,
  description,
  entities,
});

/** The 26-seed professional set. Geometry reads at plan zoom (distinct silhouette per seed). */
export const SURVEY_SYMBOL_SEEDS: SurveySymbolSeed[] = [
  seed('control-point', 'Control Point', 'control', ['control', 'traverse', 'network'],
    'Primary control station: triangle with center mark.', [
      triangle('ctrl-tri', 0, 0.06, 0.42),
      ...cross(0, 0.06, 0.1),
    ]),
  seed('benchmark', 'Benchmark', 'control', ['control', 'level', 'elevation', 'bm'],
    'Vertical benchmark: circle with center cross.', [
      ring('bm-ring', 0, 0, 0.32),
      ...cross(0, 0, 0.12),
    ]),
  seed('horizontal-control', 'Horizontal Control', 'control', ['control', 'horizontal', 'gps', 'gnss'],
    'Horizontal control: triangle with horizontal bar.', [
      triangle('hc-tri', 0, 0.06, 0.42),
      line(-0.3, 0.06, 0.3, 0.06),
    ]),
  seed('vertical-control', 'Vertical Control', 'control', ['control', 'vertical', 'level'],
    'Vertical control: square with vertical bar.', [
      square('vc-sq', 0, 0, 0.3),
      line(0, -0.3, 0, 0.3),
    ]),
  seed('iron-pin', 'Iron Pin', 'boundary', ['boundary', 'monument', 'pin', 'found', 'set'],
    'Iron pin: small square with center mark.', [
      square('ip-sq', 0, 0, 0.09),
      ...cross(0, 0, 0.05),
    ]),
  seed('iron-pipe', 'Iron Pipe', 'boundary', ['boundary', 'monument', 'pipe'],
    'Iron pipe: double circle (pipe wall).', [
      ring('ipp-outer', 0, 0, 0.16),
      ring('ipp-inner', 0, 0, 0.09),
    ]),
  seed('rebar', 'Rebar', 'boundary', ['boundary', 'monument', 'rebar', 'bar'],
    'Rebar: square with diagonal.', [
      square('rb-sq', 0, 0, 0.11),
      line(-0.11, -0.11, 0.11, 0.11),
    ]),
  seed('concrete-monument', 'Concrete Monument', 'boundary', ['boundary', 'monument', 'concrete'],
    'Concrete monument: large square with center cross.', [
      square('cm-sq', 0, 0, 0.28),
      ...cross(0, 0, 0.1),
    ]),
  seed('survey-monument', 'Survey Monument', 'boundary', ['boundary', 'monument', 'brass', 'cap'],
    'Survey monument: hexagon with center dot ring.', [
      poly('sm-hex', [
        [0.3, 0], [0.15, 0.26], [-0.15, 0.26], [-0.3, 0], [-0.15, -0.26], [0.15, -0.26],
      ]),
      ring('sm-dot', 0, 0, 0.05),
    ]),
  seed('monument-found', 'Monument Found', 'boundary', ['boundary', 'monument', 'found', 'existing'],
    'Found monument: circle with inner cross (existing).', [
      ring('mf-ring', 0, 0, 0.22),
      ...cross(0, 0, 0.14),
    ]),
  seed('monument-set', 'Monument Set', 'boundary', ['boundary', 'monument', 'set', 'new'],
    'Set monument: double square (new work emphasis).', [
      square('ms-outer', 0, 0, 0.26),
      square('ms-inner', 0, 0, 0.14),
      ...cross(0, 0, 0.06),
    ]),
  seed('spot-elevation', 'Spot Elevation', 'topo', ['topo', 'elevation', 'spot'],
    'Spot elevation: X with center ring (label stays associative).', [
      line(-0.18, -0.18, 0.18, 0.18),
      line(-0.18, 0.18, 0.18, -0.18),
      ring('se-ring', 0, 0, 0.06),
    ]),
  seed('tree-deciduous', 'Deciduous Tree', 'topo', ['topo', 'tree', 'vegetation', 'deciduous'],
    'Deciduous tree: canopy circle with trunk cross.', [
      ring('td-canopy', 0, 0.25, 0.5),
      ...cross(0, 0.25, 0.12),
      line(0, -0.25, 0, -0.45),
    ]),
  seed('tree-coniferous', 'Coniferous Tree', 'topo', ['topo', 'tree', 'vegetation', 'conifer', 'pine'],
    'Coniferous tree: canopy triangle with trunk.', [
      triangle('tc-canopy', 0, 0.3, 0.55),
      line(0, -0.25, 0, -0.5),
    ]),
  seed('stump', 'Stump', 'topo', ['topo', 'stump', 'vegetation', 'clearing'],
    'Stump: double ring (cut face).', [
      ring('st-outer', 0, 0, 0.2),
      ring('st-inner', 0, 0, 0.1),
    ]),
  seed('utility-pole', 'Utility Pole', 'utilities', ['utilities', 'pole', 'power', 'overhead'],
    'Utility pole: circle with center dot ring.', [
      ring('up-ring', 0, 0, 0.18),
      ring('up-dot', 0, 0, 0.05),
    ]),
  seed('guy-anchor', 'Guy Anchor', 'utilities', ['utilities', 'guy', 'anchor', 'pole'],
    'Guy anchor: lead line with anchor triangle.', [
      line(-0.5, -0.5, 0.1, 0.1),
      triangle('ga-tri', 0.25, 0.25, 0.18),
    ]),
  seed('hydrant', 'Fire Hydrant', 'utilities', ['utilities', 'hydrant', 'water', 'fire'],
    'Fire hydrant: body with dome and side nubs.', [
      square('hy-body', 0, -0.05, 0.18),
      { id: 'hy-dome', type: 'arc', layerId: layer, visible: true, locked: false, centerX: 0, centerY: 0.13, radius: 0.18, startAngleDeg: 0, endAngleDeg: 180 },
      line(-0.3, -0.05, -0.18, -0.05),
      line(0.18, -0.05, 0.3, -0.05),
    ]),
  seed('valve', 'Valve', 'utilities', ['utilities', 'valve', 'water', 'gas'],
    'Valve: bowtie (two opposed triangles).', [
      poly('vv-left', [[-0.32, 0.17], [-0.32, -0.17], [0, 0]]),
      poly('vv-right', [[0, 0.17], [0, -0.17], [0.32, 0]]),
    ]),
  seed('manhole', 'Manhole', 'utilities', ['utilities', 'manhole', 'sewer', 'drain', 'mh'],
    'Manhole: double circle (rim + cover).', [
      ring('mh-rim', 0, 0, 0.3),
      ring('mh-cover', 0, 0, 0.18),
    ]),
  seed('catch-basin', 'Catch Basin', 'utilities', ['utilities', 'catch', 'basin', 'drain', 'inlet', 'cb'],
    'Catch basin: double square (grate).', [
      square('cb-outer', 0, 0, 0.28),
      square('cb-inner', 0, 0, 0.15),
    ]),
  seed('transformer', 'Transformer', 'utilities', ['utilities', 'transformer', 'power', 'electric'],
    'Transformer: square with diagonal cross (padmount).', [
      square('tr-sq', 0, 0, 0.25),
      line(-0.25, -0.25, 0.25, 0.25),
      line(-0.25, 0.25, 0.25, -0.25),
    ]),
  seed('pedestal', 'Pedestal', 'utilities', ['utilities', 'pedestal', 'telco', 'fiber', 'ped'],
    'Pedestal: cabinet rect on base line.', [
      square('pd-box', 0, 0.15, 0.16),
      line(-0.3, -0.05, 0.3, -0.05),
    ]),
  seed('sign', 'Sign', 'site', ['site', 'sign', 'traffic'],
    'Sign: post with face rect.', [
      line(0, -0.5, 0, 0.1),
      square('sg-face', 0, 0.32, 0.2),
    ]),
  seed('bollard', 'Bollard', 'site', ['site', 'bollard', 'protection'],
    'Bollard: post rect with cap line.', [
      square('bo-post', 0, 0, 0.12),
      line(-0.16, 0.16, 0.16, 0.16),
    ]),
  seed('light-pole', 'Light Pole', 'site', ['site', 'light', 'pole', 'luminaire'],
    'Light pole: base ring with mast arm.', [
      ring('lp-base', 0, 0, 0.14),
      line(0, 0.14, 0, 0.6),
      line(0, 0.6, 0.35, 0.6),
    ]),
];

export const SURVEY_SYMBOL_CATEGORIES: Array<{ id: SurveySymbolCategory; label: string }> = [
  { id: 'control', label: 'Control' },
  { id: 'boundary', label: 'Boundary' },
  { id: 'topo', label: 'Topo' },
  { id: 'utilities', label: 'Utilities' },
  { id: 'site', label: 'Site' },
];

const toDefinition = (seedDef: SurveySymbolSeed): CadBlockDefinition => ({
  id: seedDef.id,
  name: seedDef.name,
  basePoint: { x: 0, y: 0 },
  entities: seedDef.entities.map((child) => ({ ...child })),
  description: seedDef.description,
});

/** True for library seeds (never user definitions). */
export const isSurveySymbolSeedId = (definitionId: string): boolean =>
  definitionId.startsWith(SURVEY_SYMBOL_SEED_PREFIX);

/**
 * Lazy-seed gate (see header policy). Pure: returns the patched project +
 * the number of definitions added. Never touches existing definitions;
 * missing table is treated as empty (legacy opens unchanged).
 */
export const ensureSurveySymbolsSeeded = (project: CadProject): { project: CadProject; added: number } => {
  const existing = new Set((project.blockDefinitions ?? []).map((definition) => definition.id));
  const missing = SURVEY_SYMBOL_SEEDS.filter((seedDef) => !existing.has(seedDef.id));
  if (missing.length === 0) return { project, added: 0 };
  return {
    project: {
      ...project,
      blockDefinitions: [...(project.blockDefinitions ?? []), ...missing.map(toDefinition)],
    },
    added: missing.length,
  };
};

/** Definitions of this project that came from the seed library (stable order). */
export const projectSurveySymbols = (project: CadProject): CadBlockDefinition[] =>
  (project.blockDefinitions ?? []).filter((definition) => isSurveySymbolSeedId(definition.id));
