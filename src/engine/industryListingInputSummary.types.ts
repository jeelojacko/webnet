import type { AdjustmentResult, GpsObservation, InputStationSnapshot, Observation } from '../types';
import type { IndustryListingParseSettings } from './industryListingTypes';

export type GpsCovarianceDisplay = {
  sigmaX: number;
  sigmaY: number;
  sigmaZ: number;
  corrXY: number;
  corrXZ: number;
  corrYZ: number;
};

export type AppendIndustryListingInputSummaryOptions = {
  angleUnitToken: string;
  classicTraverseLegacyFactorByStation: Map<
    string,
    { combinedFactor: number }
  >;
  compareObsByInput: (_a: Observation, _b: Observation) => number;
  coordSystemMode: 'local' | 'grid';
  enteredInputStationSnapshots: InputStationSnapshot[];
  fixedStations: number;
  fixedUsedEnteredStationSnapshots: InputStationSnapshot[];
  freeStations: number;
  freeUsedEnteredStationSnapshots: InputStationSnapshot[];
  gpsInputCovarianceDisplay: (_obs: GpsObservation) => GpsCovarianceDisplay;
  gpsObservationRows: GpsObservation[];
  hasStationDescriptions: boolean;
  hasTraverseStyleAngularFamilies: boolean;
  linearUnit: string;
  lines: string[];
  observationsForListing: Observation[];
  parseSettings: IndustryListingParseSettings;
  parseState: AdjustmentResult['parseState'];
  partiallyFixedUsedEnteredStationSnapshots: InputStationSnapshot[];
  pushSettingRow: (_label: string, _value: string) => void;
  res: AdjustmentResult;
  stationDescription: (_stationId: string) => string;
  stationEntriesInputOrder: Array<[string, unknown]>;
  unitScale: number;
  unusedEnteredStationSnapshots: InputStationSnapshot[];
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
};

export type IndustryListingInputSummaryModel = {
  angleUnitToken: string;
  bearingCount: number;
  countByType: (_type: Observation['type']) => number;
  hasStationDescriptions: boolean;
  hasTraverseStyleAngularFamilies: boolean;
  measuredDirectionCount: number;
};
