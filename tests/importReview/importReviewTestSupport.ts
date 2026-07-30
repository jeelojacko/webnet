import { readFileSync } from 'node:fs';

export { readFileSync };
export { enrichImportedDatasetDirectionFaces, importExternalInput } from '../../src/engine/importers';
export {
  buildImportReviewComparisonSummary,
  buildImportReviewComparisonKeyForItem,
  buildImportReviewDisplayTextMap,
  buildImportReviewModel,
  buildImportReviewText,
  convertImportedDatasetSlopeZenithToHd2D,
  createEmptyImportReviewGroup,
  createImportReviewGroupFromItem,
  duplicateImportReviewItem,
  insertImportReviewCommentRow,
  isImportReviewMtaItem,
  isImportReviewRawMeasurementItem,
  moveImportReviewItem,
  reorderImportReviewItemWithinGroup,
} from '../../src/engine/importReview';
export type { ImportedDataset } from '../../src/engine/importers';

export const jobXmlTrimbleFixture = readFileSync(
  'tests/fixtures/jobxml_trimble_station_setup_sample.jxl',
  'utf-8',
);
export const jobXmlTrimbleResectionFixture = readFileSync(
  'tests/fixtures/jobxml_trimble_resection_sample.jxl',
  'utf-8',
);
export const jobXmlMeasurementFixture = readFileSync(
  'tests/fixtures/jobxml_measurement_sample.jxl',
  'utf-8',
);

