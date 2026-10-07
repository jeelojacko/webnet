/**
 * CAD Draw Phase L1 — explicit drawing coordinate/grid seam.
 *
 * GRID_NE and LATLONG are the ONLY survey-coordinate entry modes that need an
 * authoritative drawing CRS/grid context. The context lives on
 * `CadProjectMetadata.coordinateContext` (see `CadCoordinateContext`); it is
 * threaded from the app/source coordinate context by the session, never
 * inferred and never rewritten here.
 *
 * Fail-closed law: with no usable `crsId` these resolvers return an explicit
 * error and never fabricate a local/equirectangular transform. When a CRS is
 * present the transform goes exclusively through the shared geodesy authority
 * (`projectGrid` / `inverseGrid`) — no second projection path.
 */
import { inverseGrid, projectGrid } from '../geodesyProjection';
import type { CadProject } from './cadTypes';
import { cadLineFail, cadLineOk, type CadLineResult } from './cadLineTypes';
import type { CadWorldPoint } from './cadGeometry';

export const CAD_LINE_NO_GRID_CONTEXT_MESSAGE =
  'requires an active drawing grid/ground coordinate context.';

/** Read the authoritative drawing context; a blank `crsId` is unusable. */
export const resolveCadLineCoordinateContext = (
  project: Pick<CadProject, 'metadata'>,
): { crsId: string; crsLabel: string | null } | null => {
  const context = project.metadata.coordinateContext;
  if (!context || typeof context.crsId !== 'string' || context.crsId.trim() === '') return null;
  return { crsId: context.crsId, crsLabel: context.crsLabel ?? null };
};

/** GRID_NE (`Northing,Easting` → x=east, y=north) validated against the CRS. */
export const resolveCadLineGridNePoint = (
  project: Pick<CadProject, 'metadata'>,
  input: { east: number; north: number },
): CadLineResult<CadWorldPoint> => {
  const context = resolveCadLineCoordinateContext(project);
  if (!context) return cadLineFail('NO_DRAWING_GRID_CONTEXT', `LINE_GRID_NE ${CAD_LINE_NO_GRID_CONTEXT_MESSAGE}`);
  if (!Number.isFinite(input.east) || !Number.isFinite(input.north)) {
    return cadLineFail('NON_FINITE', 'GRID_NE easting/northing must be finite.');
  }
  // Round-trip through the authoritative inverse so an out-of-CRS grid
  // coordinate fails closed instead of being stored as a fake point.
  const inverse = inverseGrid(input.east, input.north, context.crsId);
  if ('failureReason' in inverse) {
    return cadLineFail(
      'GRID_NE_OUT_OF_CRS',
      `LINE_GRID_NE could not be interpreted in drawing CRS "${context.crsId}" (${inverse.failureReason}).`,
    );
  }
  return cadLineOk({ x: input.east, y: input.north });
};

/** LATLONG → drawing XY through `projectGrid` using the drawing CRS. */
export const resolveCadLineLatLongPoint = (
  project: Pick<CadProject, 'metadata'>,
  input: { latitudeDeg: number; longitudeDeg: number },
): CadLineResult<CadWorldPoint> => {
  const context = resolveCadLineCoordinateContext(project);
  if (!context) return cadLineFail('NO_DRAWING_GRID_CONTEXT', `LINE_LATLONG ${CAD_LINE_NO_GRID_CONTEXT_MESSAGE}`);
  if (!Number.isFinite(input.latitudeDeg) || !Number.isFinite(input.longitudeDeg)) {
    return cadLineFail('NON_FINITE', 'Latitude/longitude must be finite.');
  }
  if (input.latitudeDeg < -90 || input.latitudeDeg > 90) {
    return cadLineFail('LATLONG_OUT_OF_RANGE', `Latitude ${input.latitudeDeg} is outside [-90, 90].`);
  }
  if (input.longitudeDeg < -180 || input.longitudeDeg > 180) {
    return cadLineFail('LATLONG_OUT_OF_RANGE', `Longitude ${input.longitudeDeg} is outside [-180, 180].`);
  }
  const projected = projectGrid(input.latitudeDeg, input.longitudeDeg, context.crsId);
  if (!projected) {
    return cadLineFail(
      'CRS_TRANSFORM_FAILED',
      `LINE_LATLONG could not be projected in drawing CRS "${context.crsId}".`,
    );
  }
  return cadLineOk({ x: projected.east, y: projected.north });
};
