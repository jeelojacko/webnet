import { fnv1a } from './cadRevisionHash';
import { canonicalNum } from './cadSurfaceRevision';
import type {
  CadAlignmentElement,
  CadSampleLine,
  CadSampleLineGroup,
} from './cadTypes';

/**
 * Phase 18K sample-line revision (geometry-only identity).
 *
 * `secl1:` per line x source and `secg1:` per group. Covers alignment XY
 * geometry + startStation (raw -> world mapping), each line's RAW station,
 * widths and skew, and the source surface `srev1`.
 *
 * Station-equation DISPLAY mapping is EXCLUDED by construction: equations
 * only relabel stations, they never move raw geometry, so an equation-only
 * edit must not invalidate an extracted section. Display intent (names,
 * colors, layers, view scales, manual label overrides) is excluded too.
 */

type SectionAlignment = {
  id: string;
  elements: readonly CadAlignmentElement[];
  startStation: number;
};

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

const alignmentDigest = (alignment: SectionAlignment | null, fallbackId: string): string =>
  alignment
    ? `alignment:${alignment.id}:${alignment.elements.map(elementDigest).join(';')}:${canonicalNum(alignment.startStation)}`
    : `alignment:${fallbackId}:missing`;

const lineDigest = (line: CadSampleLine): string =>
  [
    line.id,
    canonicalNum(line.rawStation),
    canonicalNum(line.leftWidth),
    canonicalNum(line.rightWidth),
    canonicalNum(line.skewDeg),
  ].join(',');

/**
 * Per-line geometry revision (excludes the source surface revision; the
 * group revision carries source `srev1` so a source rebuild invalidates the
 * whole batch, and the service tracks surfaceRevisionAtBuild separately for
 * the NEEDS_REBUILD transition).
 */
export const computeCadSampleLineRevision = (
  line: Pick<CadSampleLine, 'id' | 'rawStation' | 'leftWidth' | 'rightWidth' | 'skewDeg'>,
  alignment: SectionAlignment | null,
  alignmentFallbackId: string,
): string => {
  const parts: string[] = [
    `line:${line.id}`,
    alignmentDigest(alignment, alignmentFallbackId),
    `station:${canonicalNum(line.rawStation)}`,
    `widths:${canonicalNum(line.leftWidth)},${canonicalNum(line.rightWidth)}`,
    `skew:${canonicalNum(line.skewDeg)}`,
  ];
  return `secl1:${fnv1a(parts.join('#'))}`;
};

/** Whole-group revision for a batched worker request (all lines + sources). */
export const computeCadSampleLineGroupRevision = (
  group: Pick<CadSampleLineGroup, 'id' | 'alignmentEntityId' | 'surfaceSources' | 'sampleLines'>,
  alignment: SectionAlignment | null,
  surfaceRevisions: Readonly<Record<string, string | null>>,
): string => {
  const sources = group.surfaceSources
    .map((source) => `${source.surfaceId}@${surfaceRevisions[source.surfaceId] ?? 'none'}`)
    .join('|');
  const lines = group.sampleLines.map(lineDigest).join(';');
  const parts: string[] = [
    `group:${group.id}`,
    alignmentDigest(alignment, group.alignmentEntityId),
    `sources:${sources}`,
    `lines:${lines}`,
  ];
  return `secg1:${fnv1a(parts.join('#'))}`;
};

/** Display-only view settings digest (grid/datum/scale — never geometry). */
export const computeCadSectionViewRevision = (view: {
  id: string;
  sampleLineGroupId: string;
  sampleLineId: string;
  sourceSurfaceIds: readonly string[];
  insertionX: number;
  insertionY: number;
  horizontalScale: number;
  verticalExaggeration: number;
  datumMode: 'auto' | 'explicit';
  datumElevation?: number;
  offsetGridInterval?: number;
  elevationGridInterval?: number;
  showCutFill?: boolean;
  styleId?: string;
  layerId?: string;
}): string => {
  const num = (value: number | undefined): string => (value == null ? '' : canonicalNum(value));
  const parts: string[] = [
    `view:${view.id}`,
    `group:${view.sampleLineGroupId}`,
    `line:${view.sampleLineId}`,
    `sources:${[...view.sourceSurfaceIds].join(',')}`,
    `insert:${canonicalNum(view.insertionX)},${canonicalNum(view.insertionY)}`,
    `scale:${canonicalNum(view.horizontalScale)}x${canonicalNum(view.verticalExaggeration)}`,
    `datum:${view.datumMode}:${num(view.datumElevation)}`,
    `grid:${num(view.offsetGridInterval)}:${num(view.elevationGridInterval)}`,
    `cutfill:${view.showCutFill === true ? '1' : '0'}`,
    `style:${view.styleId ?? ''}`,
    `layer:${view.layerId ?? ''}`,
  ];
  return `sview1:${fnv1a(parts.join('#'))}`;
};
