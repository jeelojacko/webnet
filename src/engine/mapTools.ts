export type XYPoint = { x: number; y: number };

export type MapInverse2D = {
  azimuthFromToRad: number;
  azimuthToFromRad: number;
  distance2d: number;
};

export type MapPivotAngles = {
  insideAngleRad: number;
  outsideAngleRad: number;
};

export const normalizeAzimuthRad = (azimuth: number): number => {
  const wrapped = azimuth % (2 * Math.PI);
  return wrapped < 0 ? wrapped + 2 * Math.PI : wrapped;
};

export const computeInverse2D = (from: XYPoint, to: XYPoint): MapInverse2D | null => {
  const dE = to.x - from.x;
  const dN = to.y - from.y;
  const distance2d = Math.hypot(dE, dN);
  if (!(distance2d > 0)) return null;
  const azimuthFromToRad = normalizeAzimuthRad(Math.atan2(dE, dN));
  const azimuthToFromRad = normalizeAzimuthRad(azimuthFromToRad + Math.PI);
  return { azimuthFromToRad, azimuthToFromRad, distance2d };
};

export const computePivotAngles = (at: XYPoint, from: XYPoint, to: XYPoint): MapPivotAngles | null => {
  const invA = computeInverse2D(at, from);
  const invB = computeInverse2D(at, to);
  if (!invA || !invB) return null;
  const raw = Math.abs(invB.azimuthFromToRad - invA.azimuthFromToRad);
  const wrapped = raw > Math.PI * 2 ? raw % (Math.PI * 2) : raw;
  const insideAngleRad = wrapped > Math.PI ? Math.PI * 2 - wrapped : wrapped;
  const outsideAngleRad = Math.PI * 2 - insideAngleRad;
  return { insideAngleRad, outsideAngleRad };
};
