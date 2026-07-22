import {
  formatClassicCoordinateSystemLabel,
  formatClassicRunModeLabel,
  formatClassicSettingRow,
} from './industryListingFormatters';
import type { AdjustmentResult, Observation } from '../types';
import type { IndustryListingParseSettings, IndustryListingSettings } from './industryListingTypes';

type AppendClassicTopProjectOptionSettingsArgs = {
  lines: string[];
  crsId: string;
  crsLabel: string;
  runMode: string;
  coordMode: string;
  linearUnit: string;
  parseState: AdjustmentResult['parseState'];
  parseSettings: IndustryListingParseSettings;
  averageGeoidHeight: number;
  unitScale: number;
  displayVerticalDeflectionNorthSec: number;
  displayVerticalDeflectionEastSec: number;
  convergenceLimit: number;
  settings: IndustryListingSettings;
  gpsObservationRows: Observation[];
  gpsVectorFactorSummary: string;
};

export const appendClassicTopProjectOptionSettings = ({
  lines,
  crsId,
  crsLabel,
  runMode,
  coordMode,
  linearUnit,
  parseState,
  parseSettings,
  averageGeoidHeight,
  unitScale,
  displayVerticalDeflectionNorthSec,
  displayVerticalDeflectionEastSec,
  convergenceLimit,
  settings,
  gpsObservationRows,
  gpsVectorFactorSummary,
}: AppendClassicTopProjectOptionSettingsArgs): void => {

    const coordSystemLabel = formatClassicCoordinateSystemLabel(crsId, crsLabel);
    lines.push(formatClassicSettingRow('STAR*NET Run Mode', formatClassicRunModeLabel(runMode as never)));
    lines.push(formatClassicSettingRow('Type of Adjustment', coordMode));
    lines.push(
      formatClassicSettingRow(
        'Project Units',
        `${linearUnit}; ${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}`,
      ),
    );
    lines.push(formatClassicSettingRow('Coordinate System', coordSystemLabel));
    lines.push(
      formatClassicSettingRow(
        'Geoid Height',
        `${(averageGeoidHeight * unitScale).toFixed(4)} (Default, ${linearUnit})`,
      ),
    );
    if (
      Math.abs(displayVerticalDeflectionNorthSec) > 1e-12 ||
      Math.abs(displayVerticalDeflectionEastSec) > 1e-12
    ) {
      lines.push(
        formatClassicSettingRow(
          'Vertical Deflection',
          `N=${displayVerticalDeflectionNorthSec.toFixed(3)} E=${displayVerticalDeflectionEastSec.toFixed(3)} (Seconds)`,
        ),
      );
    }
    lines.push(
      formatClassicSettingRow(
        'Longitude Sign Convention',
        (parseState?.lonSign ?? 'west-negative') === 'west-positive'
          ? 'Positive West'
          : 'Negative West',
      ),
    );
    lines.push(
      formatClassicSettingRow(
        'Input/Output Coordinate Order',
        (parseState?.order ?? parseSettings.order) === 'NE' ? 'North-East' : 'East-North',
      ),
    );
    lines.push(
      formatClassicSettingRow(
        'Angle Data Station Order',
        (parseState?.angleStationOrder ?? parseSettings.angleStationOrder) === 'atfromto'
          ? 'At-From-To'
          : 'From-At-To',
      ),
    );
    lines.push(
      formatClassicSettingRow(
        'Distance/Vertical Data Type',
        (parseState?.deltaMode ?? parseSettings.deltaMode) === 'horiz'
          ? 'Horizontal/DE'
          : 'Slope/Zenith',
      ),
    );
    lines.push(
      formatClassicSettingRow(
        'Convergence Limit; Max Iterations',
        `${convergenceLimit.toFixed(6)}; ${settings.maxIterations}`,
      ),
    );
    lines.push(
      formatClassicSettingRow(
        'Default Coefficient of Refraction',
        (parseState?.refractionCoefficient ?? parseSettings.refractionCoefficient).toFixed(6),
      ),
    );
    lines.push(formatClassicSettingRow('Create Coordinate File', 'Yes'));
    lines.push(formatClassicSettingRow('Create Geodetic Position File', 'No'));
    lines.push(formatClassicSettingRow('Create Ground Scale Coordinate File', 'No'));
    lines.push(formatClassicSettingRow('Create Dump File', 'No'));
    if (gpsObservationRows.length > 0) {
      lines.push(
        formatClassicSettingRow('GPS Vector Standard Error Factors', gpsVectorFactorSummary),
      );
      lines.push(formatClassicSettingRow('GPS Vector Centering (Meters)', 'None'));
      lines.push(formatClassicSettingRow('GPS Vector Transformations', 'None'));
    }
};
