import { DEFAULT_CAD_STYLE_LIBRARY } from './cadStyles';
import type { CadLayer, CadLayerId, CadLineTypeId, CadProject } from './cadTypes';

const DEFAULT_STYLE_IDS = Object.fromEntries(
  DEFAULT_CAD_STYLE_LIBRARY.styles.map((style) => [style.name, style.id]),
) as Record<string, string>;

/** Protected default layer: new generic entities belong here (ByLayer). */
export const GENERAL_CAD_LAYER_ID: CadLayerId = 'general';

/** Deprecated linetype alias; remapped to `dashed` on load, never deleted. */
export const DEPRECATED_DASH_SHORT_LINETYPE_ID: CadLineTypeId = 'dash-short';

export const DEFAULT_DASH_LINETYPE_ID: CadLineTypeId = 'dashed';

export const createGeneralCadLayer = (): CadLayer => ({
  id: GENERAL_CAD_LAYER_ID,
  name: 'General',
  color: '#e2e8f0',
  visible: true,
  locked: false,
  frozen: false,
  transparency: 0,
  description: '',
  printable: true,
  lineTypeId: 'continuous',
  role: 'planning',
});

export const DEFAULT_CAD_LAYERS: CadLayer[] = [
  {
    id: 'control-points',
    name: 'Control Points',
    color: '#f59e0b',
    defaultStyleId: DEFAULT_STYLE_IDS['Control Point'],
    visible: true,
    locked: false,
    printable: true,
    lineweightMm: 0.25,
    role: 'control-points',
  },
  {
    id: 'points',
    name: 'Survey Points',
    color: '#38bdf8',
    defaultStyleId: DEFAULT_STYLE_IDS['Survey Point'],
    visible: true,
    locked: false,
    printable: true,
    lineweightMm: 0.25,
    role: 'points',
  },
  {
    id: 'observation-lines',
    name: 'Observation Lines',
    color: '#22c55e',
    defaultStyleId: DEFAULT_STYLE_IDS['Observation Line'],
    visible: true,
    locked: false,
    printable: true,
    lineweightMm: 0.25,
    role: 'observation-lines',
  },
  {
    id: 'error-ellipses',
    name: 'Error Ellipses',
    color: '#f472b6',
    lineTypeId: DEFAULT_DASH_LINETYPE_ID,
    defaultStyleId: DEFAULT_STYLE_IDS['Error Ellipse'],
    visible: true,
    locked: false,
    printable: true,
    lineweightMm: 0.25,
    role: 'error-ellipses',
  },
  {
    id: 'labels',
    name: 'Labels',
    color: '#e2e8f0',
    defaultStyleId: DEFAULT_STYLE_IDS['Label'],
    visible: true,
    locked: false,
    printable: true,
    lineweightMm: 0.25,
    role: 'labels',
  },
  {
    id: 'parcels',
    name: 'Parcels',
    color: '#f59e0b',
    defaultStyleId: DEFAULT_STYLE_IDS['Parcel'],
    visible: true,
    locked: false,
    printable: true,
    lineweightMm: 0.25,
    role: 'parcels',
  },
  createGeneralCadLayer(),
];

const remapLegacyLineTypeId = (id: CadLineTypeId): CadLineTypeId =>
  id === DEPRECATED_DASH_SHORT_LINETYPE_ID ? DEFAULT_DASH_LINETYPE_ID : id;

/** Load-time normalization: remap deprecated linetypes, backfill `general`. */
export const backfillCadLayerList = (layers: CadLayer[]): CadLayer[] => {
  const remapped = layers.map((layer) =>
    layer.lineTypeId != null && layer.lineTypeId !== remapLegacyLineTypeId(layer.lineTypeId)
      ? { ...layer, lineTypeId: remapLegacyLineTypeId(layer.lineTypeId) }
      : layer,
  );
  return remapped.some((layer) => layer.id === GENERAL_CAD_LAYER_ID)
    ? remapped
    : [...remapped, createGeneralCadLayer()];
};

/** Missing/unusable current layer falls back to `general` (never throws). */
export const resolveCurrentCadLayerId = (
  project: Pick<CadProject, 'layers' | 'currentLayerId'>,
): CadLayerId =>
  project.currentLayerId != null &&
  project.layers.some((layer) => layer.id === project.currentLayerId)
    ? project.currentLayerId
    : GENERAL_CAD_LAYER_ID;

/** Load-time project normalization: layers + current layer + linetype refs. */
export const backfillCadProjectStandards = (project: CadProject): CadProject => {
  const layers = backfillCadLayerList(project.layers);
  const remapStyle = (lineTypeId: CadLineTypeId | undefined): CadLineTypeId | undefined =>
    lineTypeId != null ? remapLegacyLineTypeId(lineTypeId) : lineTypeId;
  const styles = project.styleLibrary.styles.map((style) => {
    const lineTypeId = remapStyle(style.lineTypeId);
    return lineTypeId !== style.lineTypeId ? { ...style, lineTypeId } : style;
  });
  const entities = project.entities.map((entity) => {
    const lineTypeId = remapStyle(entity.appearance?.lineTypeId);
    return lineTypeId !== entity.appearance?.lineTypeId && entity.appearance != null
      ? { ...entity, appearance: { ...entity.appearance, lineTypeId } }
      : entity;
  });
  return {
    ...project,
    layers,
    styleLibrary: { ...project.styleLibrary, styles },
    entities: entities as CadProject['entities'],
    currentLayerId: resolveCurrentCadLayerId({ layers, currentLayerId: project.currentLayerId }),
  };
};
