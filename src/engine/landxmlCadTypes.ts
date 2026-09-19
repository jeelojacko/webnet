/**
 * Phase 18L — shared CAD → LandXML 1.2 geometry types.
 *
 * Split out of landxmlCad.ts so the serializer, the project adapter, and the
 * civil-source adapter stay small and single-purpose. Public API is
 * re-exported from landxmlCad.ts (no import path changes for callers).
 *
 * Coordinate order everywhere is LandXML's: NORTHING EASTING [ELEVATION].
 * Internal geometry is metres; the serializer scales to the file unit.
 */

export interface CadLandXmlPoint {
  /** Point ID (CgPoint name/oID). */
  readonly id: string;
  /** Easting, metres. */
  readonly x: number;
  /** Northing, metres. */
  readonly y: number;
  readonly z?: number;
  readonly desc?: string;
  readonly code?: string;
}

export interface CadLandXmlLine {
  readonly from: string;
  readonly to: string;
}

export interface CadLandXmlCurve {
  readonly start: string;
  readonly end: string;
  /** Radius, metres, must be finite and positive. */
  readonly radiusM: number;
  readonly rot: 'cw' | 'ccw';
}

export interface CadLandXmlParcel {
  readonly name: string;
  /** Geometric ring (point IDs) only. */
  readonly ring: readonly string[];
}

/**
 * LandXML `StaEquation`. `staInternal` is the raw/internal equation location
 * (staStart + distance, no equations applied); `staAhead` is the new station
 * value; `staBack` is the previous value (schema-optional). WebNet's
 * `CadStationEquation` maps backStation→staBack, aheadStation→staAhead, and
 * rawStation (resolved when absent) → staInternal.
 */
export interface CadLandXmlStaEquation {
  /** Raw/internal equation location, metres. */
  readonly staInternal: number;
  /** New station value at the equation, metres. */
  readonly staAhead: number;
  /** Previous station value, metres (informational). */
  readonly staBack?: number;
}

/**
 * One sampled surface within a `ProfSurf`. `segments` are ordered contiguous
 * runs of [rawChainage, elevation] pairs (metres); a gap is encoded losslessly
 * as multiple segments (one `PntList2D` each). Station equations are NEVER
 * baked into these numbers — they live on the owning Alignment.
 */
export interface CadLandXmlProfileSurface {
  readonly name: string;
  readonly segments: readonly (readonly (readonly [number, number])[])[];
}

export interface CadLandXmlProfile {
  readonly name: string;
  readonly surfaces: readonly CadLandXmlProfileSurface[];
}

/**
 * One sampled surface within a `CrossSectSurf`. `segments` are ordered
 * contiguous runs of [offset, elevation] pairs in LandXML sign convention
 * (RIGHT positive, metres). WebNet offsets are LEFT positive, so the adapter
 * negates at the boundary.
 */
export interface CadLandXmlCrossSectionSurface {
  readonly name: string;
  readonly segments: readonly (readonly (readonly [number, number])[])[];
}

export interface CadLandXmlCrossSection {
  readonly name: string;
  /** Raw station along the owning alignment, metres. */
  readonly sta: number;
  readonly surfaces: readonly CadLandXmlCrossSectionSurface[];
}

/**
 * A retained TIN mesh. `points` are in the mesh's canonical vertex order;
 * `faces` are 0-based index triples into `points`. Areas are m².
 */
export interface CadLandXmlSurface {
  readonly name: string;
  readonly points: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  readonly faces: readonly (readonly [number, number, number])[];
  readonly elevMin?: number;
  readonly elevMax?: number;
  readonly area2D?: number;
  readonly area3D?: number;
}

export interface CadLandXmlAlignment {
  readonly name: string;
  readonly lines: readonly CadLandXmlLine[];
  readonly curves: readonly CadLandXmlCurve[];
  /** Raw alignment start station, metres. Absent = attribute omitted. */
  startStation?: number;
  stationEquations?: readonly CadLandXmlStaEquation[];
  /** Nested sampled surface profiles (CURRENT only). */
  profiles?: readonly CadLandXmlProfile[];
  /** Nested sampled cross sections (CURRENT only). */
  crossSections?: readonly CadLandXmlCrossSection[];
  /**
   * Source CadAlignmentEntity id, used to attach civil profiles/sections
   * after entity conversion. Never serialized.
   */
  sourceEntityId?: string;
}

export interface CadLandXmlGeometry {
  readonly points: readonly CadLandXmlPoint[];
  readonly lines?: readonly CadLandXmlLine[];
  readonly curves?: readonly CadLandXmlCurve[];
  readonly parcels?: readonly CadLandXmlParcel[];
  readonly alignments?: readonly CadLandXmlAlignment[];
  /** Retained TIN surfaces (CURRENT only, provided by the civil adapter). */
  readonly surfaces?: readonly CadLandXmlSurface[];
  /**
   * Error-ellipse station ids explicitly requested for export. LandXML has
   * no ellipse representation (NOT_APPLICABLE): each id yields a warning
   * and no geometry. Absent = nothing requested, no warnings.
   */
  readonly errorEllipseIds?: readonly string[];
  /** Opaque CRS metadata string (retained, never transformed). */
  readonly crs?: string;
}

export interface CadLandXmlSettings {
  readonly units: 'm' | 'ft' | 'usft';
  readonly projectName?: string;
  readonly generatedAt?: Date;
  readonly applicationVersion?: string;
}

export const UNIT_SCALE: Record<CadLandXmlSettings['units'], number> = {
  m: 1,
  // International foot, 0.3048 m exactly. US survey foot differs.
  ft: 3.280839895,
  usft: 3937 / 1200,
};

export const UNIT_ELEMENT: Record<CadLandXmlSettings['units'], string> = {
  m: '<Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" />',
  ft: '<Imperial areaUnit="squareFoot" linearUnit="foot" volumeUnit="cubicFeet" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" />',
  usft: '<Imperial areaUnit="squareFoot" linearUnit="USSurveyFoot" volumeUnit="cubicFeet" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" />',
};
