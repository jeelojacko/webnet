import type { IndustryListingParseSettings, IndustryListingSettings } from './industryListingTypes';
import type { AdjustmentResult, Station } from '../types';
import type { StationDisplayFactors } from './industryListingStationContext';

export type HeadingAppender = (_title: string, _underline?: string) => void;
export type TableRenderer = (_headers: string[], _rows: string[][], _rightAligned?: number[]) => void;

export type AppendAdjustedCoordinateSectionsOptions = {
  addCenteredHeading: HeadingAppender;
  averageGeoidHeight: number;
  classicTraverseLegacyFactorByStation: Map<string, StationDisplayFactors>;
  classicTraverseStationOrder: string[];
  commonElevation: number;
  coordSystemMode: 'local' | 'grid';
  displayFactorsForStation: (_stationId: string, _station: Station) => StationDisplayFactors;
  hasStationDescriptions: boolean;
  isGnssOnlyListing: boolean;
  linearUnit: string;
  lines: string[];
  parseSettings: IndustryListingParseSettings;
  parseState: AdjustmentResult['parseState'];
  renderTextTable: TableRenderer;
  res: AdjustmentResult;
  settings: IndustryListingSettings;
  stationDescription: (_stationId: string) => string;
  stationEntriesForListing: Array<[string, Station]>;
  unitScale: number;
  useClassicPreanalysisListing: boolean;
  usesClassicParityLayout: boolean;
  usesLegacyNbDisplayFactors: boolean;
};
