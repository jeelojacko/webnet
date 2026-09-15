import type {
  CadLineType,
  CadPointSymbol,
  CadStyle,
  CadStyleLibrary,
  CadTextStyle,
} from './cadTypes';
import type { DraftPrecisionProfile } from './cadDraftTypes';

const DEFAULT_LINE_TYPES: CadLineType[] = [
  { id: 'continuous', name: 'Continuous', dashPattern: [] },
  { id: 'dash-short', name: 'Dash Short', dashPattern: [6, 4] },
];

const DEFAULT_TEXT_STYLES: CadTextStyle[] = [
  {
    id: 'label-default',
    name: 'Label Default',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 11,
  },
];

const DEFAULT_POINT_SYMBOLS: CadPointSymbol[] = [
  { id: 'point-free', name: 'Free Point', radius: 1.8 },
  { id: 'point-control', name: 'Control Point', radius: 2.4 },
  // Bounded field-to-finish symbol set (additive; existing ids/colors untouched).
  { id: 'point-f2f-circle', name: 'F2F Circle', radius: 1.8, shape: 'circle' },
  { id: 'point-f2f-square', name: 'F2F Square', radius: 1.8, shape: 'square' },
  { id: 'point-f2f-triangle', name: 'F2F Triangle', radius: 2.0, shape: 'triangle' },
  { id: 'point-f2f-cross', name: 'F2F Cross', radius: 2.0, shape: 'cross' },
  { id: 'point-f2f-x', name: 'F2F X', radius: 2.0, shape: 'x' },
  { id: 'point-f2f-dot', name: 'F2F Dot', radius: 1.2, shape: 'dot' },
];

const DEFAULT_STYLES: CadStyle[] = [
  {
    id: 'style-control-point',
    name: 'Control Point',
    color: '#f59e0b',
    strokeWidth: 1.2,
    pointSymbolId: 'point-control',
  },
  {
    id: 'style-point',
    name: 'Survey Point',
    color: '#38bdf8',
    strokeWidth: 1.2,
    pointSymbolId: 'point-free',
  },
  {
    id: 'style-observation-line',
    name: 'Observation Line',
    color: '#22c55e',
    strokeWidth: 1.25,
    lineTypeId: 'continuous',
  },
  {
    id: 'style-error-ellipse',
    name: 'Error Ellipse',
    color: '#f472b6',
    strokeWidth: 1.1,
    lineTypeId: 'dash-short',
  },
  {
    id: 'style-label',
    name: 'Label',
    color: '#e2e8f0',
    textStyleId: 'label-default',
  },
  {
    id: 'style-parcel',
    name: 'Parcel',
    color: '#f59e0b',
    strokeWidth: 1.5,
    lineTypeId: 'continuous',
  },
];

export const DEFAULT_CAD_STYLE_LIBRARY: CadStyleLibrary = {
  lineTypes: DEFAULT_LINE_TYPES,
  textStyles: DEFAULT_TEXT_STYLES,
  pointSymbols: DEFAULT_POINT_SYMBOLS,
  styles: DEFAULT_STYLES,
};

// Drafting (paper-space) defaults. Paper units are millimetres internally.
// Display-only formatting profile; never feeds adjustment or listing output.
export const DEFAULT_DRAFT_PAPER_TEXT_HEIGHTS_MM = {
  small: 2.5,
  normal: 3.5,
  large: 5.0,
} as const;

export const DEFAULT_DRAFT_TEXT_ALIGNMENT = 'left' as const;

export const DEFAULT_DRAFT_PRECISION_PROFILE: DraftPrecisionProfile = {
  bearingDecimals: 0,
  distanceDecimals: 3,
  areaDecimals: 1,
  coordinateDecimals: 3,
  unitsMode: 'm',
};
