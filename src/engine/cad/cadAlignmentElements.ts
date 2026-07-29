import {
  cadDistance,
  cadPointOnCircle,
  cadSignedSweepDeg,
} from './cadGeometry';
import type { CadAlignmentElement, CadAlignmentEntity, CadDisplayPoint } from './cadTypes';

export const ALIGNMENT_POINT_TOLERANCE = 1e-6;

export const isAlignmentElementArray = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements'>
    | Pick<CadAlignmentEntity, 'elements' | 'startStation'>
    | readonly CadAlignmentElement[],
): alignment is readonly CadAlignmentElement[] => Array.isArray(alignment);

export const getAlignmentElements = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements'>
    | Pick<CadAlignmentEntity, 'elements' | 'startStation'>
    | readonly CadAlignmentElement[],
): readonly CadAlignmentElement[] =>
  isAlignmentElementArray(alignment) ? alignment : alignment.elements;

export const alignmentElementLength = (element: CadAlignmentElement): number =>
  element.kind === 'line'
    ? cadDistance(element.start, element.end)
    : (Math.abs(cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg)) *
        Math.PI *
        element.radius) /
      180;

export const alignmentElementStartPoint = (element: CadAlignmentElement): CadDisplayPoint =>
  element.kind === 'line'
    ? element.start
    : cadPointOnCircle(element.center, element.radius, element.startAngleDeg);

export const alignmentElementEndPoint = (element: CadAlignmentElement): CadDisplayPoint =>
  element.kind === 'line'
    ? element.end
    : cadPointOnCircle(element.center, element.radius, element.endAngleDeg);
