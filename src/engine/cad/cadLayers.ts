import { DEFAULT_CAD_STYLE_LIBRARY } from './cadStyles';
import type { CadLayer } from './cadTypes';

const DEFAULT_STYLE_IDS = Object.fromEntries(
  DEFAULT_CAD_STYLE_LIBRARY.styles.map((style) => [style.name, style.id]),
) as Record<string, string>;

export const DEFAULT_CAD_LAYERS: CadLayer[] = [
  {
    id: 'control-points',
    name: 'Control Points',
    color: '#f59e0b',
    defaultStyleId: DEFAULT_STYLE_IDS['Control Point'],
    visible: true,
    locked: false,
    role: 'control-points',
  },
  {
    id: 'points',
    name: 'Survey Points',
    color: '#38bdf8',
    defaultStyleId: DEFAULT_STYLE_IDS['Survey Point'],
    visible: true,
    locked: false,
    role: 'points',
  },
  {
    id: 'observation-lines',
    name: 'Observation Lines',
    color: '#22c55e',
    defaultStyleId: DEFAULT_STYLE_IDS['Observation Line'],
    visible: true,
    locked: false,
    role: 'observation-lines',
  },
  {
    id: 'error-ellipses',
    name: 'Error Ellipses',
    color: '#f472b6',
    lineTypeId: 'dash-short',
    defaultStyleId: DEFAULT_STYLE_IDS['Error Ellipse'],
    visible: true,
    locked: false,
    role: 'error-ellipses',
  },
  {
    id: 'labels',
    name: 'Labels',
    color: '#e2e8f0',
    defaultStyleId: DEFAULT_STYLE_IDS['Label'],
    visible: true,
    locked: false,
    role: 'labels',
  },
];
