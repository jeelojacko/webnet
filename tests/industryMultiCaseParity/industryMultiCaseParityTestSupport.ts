export { existsSync, readFileSync } from 'node:fs';
export { buildIndustryStyleListingText } from '../../src/engine/industryListing';
export { normalizeIndustryParityCaseText } from '../../src/engine/industryParityText';
export { ACTIVE_INDUSTRY_PARITY_CASE, INDUSTRY_PARITY_CASES } from '../../src/industryParityCases';
export * from './industryMultiCaseParityTextSupport';
export * from './industryMultiCaseParityListingSupport';
