import { cadPointAtAlignmentStation } from '../cadAlignment';
import {
  cadAlignmentDisplayStationToRawStation,
  cadAlignmentRawStationToDisplayStation,
} from '../cadAlignmentStationing';
import type { CadAlignmentElement, CadStationEquation } from '../cadTypes';
import type { ProfileExtractionMesh } from './profileExtraction';
import { locateProfileElevation } from './profileExtraction';

/**
 * Phase 18J profile inquiry (engine only, pure).
 *
 * Direct XY + interpolation answers (never the display-approximation
 * polyline): elevation at a raw chainage, and honest display→raw station
 * resolution (null = ambiguous/unstationed, surfaced — never guessed).
 */

export interface ProfileMeshQuery {
  alignmentElements: readonly CadAlignmentElement[];
  startStation: number;
  stationEquations?: CadStationEquation[];
  mesh: ProfileExtractionMesh;
}

export type ProfileElevationAnswer =
  | { x: number; y: number; elevation: number }
  | { gap: true };

/** XY at a raw chainage + interpolated surface elevation, or a gap marker. */
export const queryProfileElevationAt = (
  query: ProfileMeshQuery,
  rawChainage: number,
): ProfileElevationAnswer => {
  if (!Number.isFinite(rawChainage)) return { gap: true };
  const alignmentView = {
    elements: [...query.alignmentElements],
    startStation: query.startStation,
    stationEquations: query.stationEquations,
  };
  // cadPointAtAlignmentStation takes a DISPLAY station: raw chainage maps
  // forward first (never inverted) so equation offsets resolve correctly.
  const display = cadAlignmentRawStationToDisplayStation(alignmentView, rawChainage);
  if (display == null) return { gap: true };
  const point = cadPointAtAlignmentStation(alignmentView, display);
  if (!point) return { gap: true };
  const located = locateProfileElevation(query.mesh, point.x, point.y);
  if (!located) return { gap: true };
  return { x: point.x, y: point.y, elevation: located.elevation };
};

export interface ProfileAlignmentStationInput {
  elements: readonly CadAlignmentElement[];
  startStation: number;
  stationEquations?: CadStationEquation[];
}

/**
 * Display-station text input → raw chainage. Null = ambiguous (inside an
 * equation gap) or unstationed — surfaced honestly, never guessed.
 */
export const resolveProfileStationInput = (
  alignment: ProfileAlignmentStationInput,
  displayStationInput: number,
): number | null =>
  cadAlignmentDisplayStationToRawStation(
    {
      elements: [...alignment.elements],
      startStation: alignment.startStation,
      stationEquations: alignment.stationEquations,
    },
    displayStationInput,
  );
