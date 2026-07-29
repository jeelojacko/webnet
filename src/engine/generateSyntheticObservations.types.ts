export type SyntheticObservationNoiseMode = 'noise-free' | 'noisy';
export type SyntheticObservationPrecisionMode = 'standard' | 'perfect';

export interface SyntheticObservationGenerationOptions {
  includeBearings?: boolean;
  includeAngles?: boolean;
  includeDirections?: boolean;
  precisionMode?: SyntheticObservationPrecisionMode;
}

export interface SyntheticObservationInputRenderOptions {
  observationOrder?: 'default' | 'reverse';
  directionSetupOrder?: 'default' | 'reverse';
}

export interface SyntheticObservationJob {
  input: string;
  headerLines: string[];
  stationLines: string[];
  plainObservationLines: string[];
  directionSetBlocks: string[][];
  approximateStations: Array<{
    id: string;
    easting: number;
    northing: number;
    elevation: number;
  }>;
}
