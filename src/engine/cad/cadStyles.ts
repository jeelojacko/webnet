import type {
  CadLineType,
  CadPointSymbol,
  CadStyle,
  CadStyleLibrary,
  CadTextStyle,
} from './cadTypes';

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
