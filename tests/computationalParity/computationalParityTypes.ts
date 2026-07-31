export type ParityFixtureSpec = {
  id: string;
  inputPath: string;
  profile: 'webnet' | 'industry-parity';
  summary: {
    converged: boolean;
    iterations: number;
    dof: number;
    seuw: number;
    seuwTolerance: number;
  };
  coordinates?: Record<string, { x: number; y: number; tol: number }>;
  residual?: { maxStdRes: number; tol: number };
  detailedReference?: {
    expectedPath: string;
    deviationBaselinePath: string;
  };
};

export type IndustryReferenceExpected = {
  summary: {
    iterations: number;
  };
  coordinates: Record<string, { northing: number; easting: number }>;
  angleStdErrsSec: Record<string, number>;
  distanceStdErrsM: Record<string, number>;
  stationSigmasM: Record<string, { northing: number; easting: number }>;
  stationEllipses95M: Record<
    string,
    { semiMajor: number; semiMinor: number; azimuthDeg: number }
  >;
  relativeConfidence95: Record<
    string,
    {
      from: string;
      to: string;
      azimuthDeg: number;
      distanceM: number;
      azimuth95Sec: number;
      distance95M: number;
      ppm95: number;
    }
  >;
  relativeEllipses95M: Record<
    string,
    { from: string; to: string; semiMajor: number; semiMinor: number; azimuthDeg: number }
  >;
};

export type IndustryReferenceSnapshot = IndustryReferenceExpected;

export type IndustryReferenceDeviation = {
  summary: {
    iterations: number;
  };
  coordinates: Record<string, { northing: number; easting: number }>;
  angleStdErrsSec: Record<string, number>;
  distanceStdErrsM: Record<string, number>;
  stationSigmasM: Record<string, { northing: number; easting: number }>;
  stationEllipses95M: Record<string, { semiMajor: number; semiMinor: number; azimuthDeg: number }>;
  relativeConfidence95: Record<
    string,
    { azimuthDeg: number; distanceM: number; azimuth95Sec: number; distance95M: number; ppm95: number }
  >;
  relativeEllipses95M: Record<string, { semiMajor: number; semiMinor: number; azimuthDeg: number }>;
  errorPropagationSummary: {
    stationSigmaNorthingMax: number;
    stationSigmaEastingMax: number;
    stationEllipseSemiMajorMax: number;
    stationEllipseSemiMinorMax: number;
    stationEllipseAzimuthDegMax: number;
    relativeConfidenceAzimuth95SecMax: number;
    relativeConfidenceDistance95MMax: number;
    relativeConfidencePpm95Max: number;
    relativeEllipseSemiMajorMax: number;
    relativeEllipseSemiMinorMax: number;
    relativeEllipseAzimuthDegMax: number;
  };
};