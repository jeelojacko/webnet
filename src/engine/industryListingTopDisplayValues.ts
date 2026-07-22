import type { AdjustmentResult } from '../types';
import type { IndustryListingRunDiagnostics, IndustryListingSettings } from './industryListingTypes';

export const resolveTopDisplayValues = (
  settings: IndustryListingSettings,
  parseState: AdjustmentResult['parseState'],
  runDiag: IndustryListingRunDiagnostics,
): {
  convergenceLimit: number;
  displayVerticalDeflectionNorthSec: number;
  displayVerticalDeflectionEastSec: number;
} => ({
  convergenceLimit:
    typeof settings.convergenceLimit === 'number' &&
    Number.isFinite(settings.convergenceLimit) &&
    settings.convergenceLimit > 0
      ? settings.convergenceLimit
      : 0.01,
  displayVerticalDeflectionNorthSec:
    parseState?.verticalDeflectionNorthSec ?? runDiag.verticalDeflectionNorthSec ?? 0,
  displayVerticalDeflectionEastSec:
    parseState?.verticalDeflectionEastSec ?? runDiag.verticalDeflectionEastSec ?? 0,
});
