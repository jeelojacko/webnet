/**
 * Phase 18L — one authoritative LandXML N/E coordinate parser, shared by
 * CgPoints, Surface P, and Alignment Start/End/Center. LandXML order is
 * always NORTHING EASTING [elevation]; the oracle pins that the same
 * coordinate text resolves to the same WebNet E/N everywhere.
 */

export class LandXmlImportError extends Error {
  constructor(message: string) {
    super(`LandXML import: ${message}`);
    this.name = 'LandXmlImportError';
  }
}

/** Parse "northing easting [elevation]" → [northing, easting, elev] (file units). */
export const parseLandXmlNE = (raw: string, what: string): [number, number, number] => {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new LandXmlImportError(
      `${what} needs at least N E values, got ${JSON.stringify(raw.slice(0, 60))}.`,
    );
  }
  const nums = parts.slice(0, 3).map((part) => Number(part));
  if (nums.some((value) => !Number.isFinite(value))) {
    throw new LandXmlImportError(
      `${what} has non-finite coordinates ${JSON.stringify(raw.slice(0, 60))}.`,
    );
  }
  return [nums[0] as number, nums[1] as number, (nums[2] ?? 0) as number];
};
