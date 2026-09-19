import { fnv1a } from './cadRevisionHash';
import { canonicalNum } from './cadSurfaceRevision';
import type {
  CadAlignmentElement,
  CadProfileView,
  CadStationEquation,
  CadSurfaceProfile,
} from './cadTypes';

/**
 * Phase 18J profile revision (geometry-only identity).
 *
 * `prev1:` FNV-1a over the canonical alignment geometry (ordered element
 * digests + startStation + equation list) plus the source surface `srev1`.
 * Display intent (colors, layers, view sizes, style bindings, names) is
 * excluded by construction — recoloring NEVER recalculates.
 */

type ProfileAlignment = Pick<
  { id: string; elements: readonly CadAlignmentElement[]; startStation: number; stationEquations?: CadStationEquation[] },
  'id' | 'elements' | 'startStation' | 'stationEquations'
>;

const elementDigest = (element: CadAlignmentElement): string => {
  if (element.kind === 'line') {
    return [
      'line',
      canonicalNum(element.start.x),
      canonicalNum(element.start.y),
      canonicalNum(element.end.x),
      canonicalNum(element.end.y),
    ].join(',');
  }
  return [
    'arc',
    canonicalNum(element.center.x),
    canonicalNum(element.center.y),
    canonicalNum(element.radius),
    canonicalNum(element.startAngleDeg),
    canonicalNum(element.endAngleDeg),
  ].join(',');
};

const equationDigest = (equation: CadStationEquation): string =>
  [
    canonicalNum(equation.backStation),
    canonicalNum(equation.aheadStation),
    equation.rawStation != null ? canonicalNum(equation.rawStation) : 'auto',
  ].join(',');

/** Geometry revision a profile result was built for (null alignment = unresolvable). */
export const computeSurfaceProfileRevision = (
  profile: Pick<CadSurfaceProfile, 'id' | 'alignmentEntityId' | 'surfaceId'>,
  alignment: ProfileAlignment | null,
  surfaceRevision: string | null,
): string => {
  const parts: string[] = [
    `profile:${profile.id}`,
    `alignment:${alignment?.id ?? profile.alignmentEntityId}`,
    `elements:${alignment ? alignment.elements.map(elementDigest).join(';') : 'missing'}`,
    `start:${alignment ? canonicalNum(alignment.startStation) : 'missing'}`,
    `equations:${alignment?.stationEquations?.map(equationDigest).join('|') ?? ''}`,
    `surface:${profile.surfaceId}@${surfaceRevision ?? 'none'}`,
  ];
  return `prev1:${fnv1a(parts.join('#'))}`;
};

/** Display-only view settings digest (grid/datum/scale/membership — never geometry). */
export const computeProfileViewRevision = (
  view: Pick<
    CadProfileView,
    | 'id'
    | 'alignmentEntityId'
    | 'profileIds'
    | 'insertionX'
    | 'insertionY'
    | 'width'
    | 'height'
    | 'horizontalScale'
    | 'verticalExaggeration'
    | 'datumElevation'
    | 'datumMode'
    | 'datumStep'
    | 'majorStationInterval'
    | 'minorStationInterval'
    | 'elevationGridInterval'
    | 'styleId'
  >,
): string => {
  const num = (value: number | undefined): string => (value == null ? '' : canonicalNum(value));
  const parts: string[] = [
    `view:${view.id}`,
    `alignment:${view.alignmentEntityId}`,
    `profiles:${[...view.profileIds].join(',')}`,
    `insert:${canonicalNum(view.insertionX)},${canonicalNum(view.insertionY)}`,
    `size:${num(view.width)},${num(view.height)}`,
    `scale:${canonicalNum(view.horizontalScale)}x${canonicalNum(view.verticalExaggeration)}`,
    `datum:${view.datumMode}:${num(view.datumElevation)}:${num(view.datumStep)}`,
    `grid:${num(view.majorStationInterval)}:${num(view.minorStationInterval)}:${num(view.elevationGridInterval)}`,
    `style:${view.styleId ?? ''}`,
  ];
  return `pview1:${fnv1a(parts.join('#'))}`;
};
