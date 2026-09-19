/** Phase 18O — professional annotation seed styles (pure). */
import type {
  CadBearingLabelStyle,
  CadCurveLabelStyle,
  CadDimensionStyle,
  CadLeaderStyle,
  CadTextStyle,
} from '../cadTypes';

export const seedProfessionalTextStyles = (): CadTextStyle[] => [
  { id: 'std-model-2_5', name: 'Standard-Model-2.5', fontFamily: 'Arial', fontSize: 2.5, heightMode: 'model', modelHeight: 2.5, widthFactor: 1, lineSpacingFactor: 1 },
  { id: 'paper-2_5mm', name: 'Paper-2.5mm', fontFamily: 'Arial', fontSize: 2.5, heightMode: 'paper', paperHeightMm: 2.5, widthFactor: 1, lineSpacingFactor: 1 },
];

export const seedDimensionStyles = (): CadDimensionStyle[] => [
  { id: 'std-500', name: 'Standard-500', textStyleId: 'std-model-2_5', arrowBlockDefinitionId: 'webnet-annotation-arrowhead-closed-arrow', arrowSize: 2.5, arrowSizeMode: 'model', textGap: 1, extensionOffset: 1, extensionOvershoot: 1, decimalPrecision: 3 },
];

export const seedLeaderStyles = (): CadLeaderStyle[] => [
  { id: 'std-leader', name: 'Standard-Leader', textStyleId: 'std-model-2_5', arrowBlockDefinitionId: 'webnet-annotation-arrowhead-closed-arrow', arrowSize: 2.5, arrowSizeMode: 'model', landingLength: 5, textGap: 1 },
];

export const seedBearingLabelStyles = (): CadBearingLabelStyle[] => [
  { id: 'bearing-default', name: 'Bearing-Distance-Default', textStyleId: 'std-model-2_5', content: 'bearing-distance', separator: 'newline', offset: { x: 0, y: 0 }, decimalPrecision: 3 },
];

export const seedCurveLabelStyles = (): CadCurveLabelStyle[] => [
  { id: 'curve-default', name: 'Curve-Default', textStyleId: 'std-model-2_5', fields: ['radius', 'delta', 'length'], offset: { x: 0, y: 0 }, decimalPrecision: 3 },
];
