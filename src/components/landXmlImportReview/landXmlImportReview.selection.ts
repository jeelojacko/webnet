import type { LandXmlImportPreview } from '../../engine/landxmlImport';
import type {
  LandXmlImportCommitPayload,
  LandXmlImportDisposition,
  LandXmlImportReviewSelection,
  LandXmlImportStagedState,
} from './landXmlImportReview.types';

/**
 * Phase 18M — pure selection algebra for the LandXML Import Review.
 * No drawing mutation, no engine call: given a preview it produces the
 * selection, the count, and the exact `LandXmlCommitSelection` worker 3
 * feeds to `commitLandXmlImport`.
 */

/** Only IMPORTABLE/WARNING rows may ever be selected (spec: UNSUPPORTED/BLOCKED never selectable). */
export const isLandXmlImportable = (disposition: LandXmlImportDisposition): boolean =>
  disposition === 'IMPORTABLE' || disposition === 'WARNING';

/** Default selection: every importable object checked (professional batch default). */
export const createLandXmlImportReviewSelection = (
  preview: LandXmlImportPreview,
): LandXmlImportReviewSelection => ({
  includePoints: preview.points.length > 0,
  alignmentNames: preview.alignments.filter((a) => isLandXmlImportable(a.disposition)).map((a) => a.name),
  surfaceNames: preview.surfaces.filter((s) => isLandXmlImportable(s.disposition)).map((s) => s.name),
});

export const toggleLandXmlImportPoints = (
  selection: LandXmlImportReviewSelection,
): LandXmlImportReviewSelection => ({ ...selection, includePoints: !selection.includePoints });

const toggleName = (names: readonly string[], name: string): string[] =>
  names.includes(name) ? names.filter((entry) => entry !== name) : [...names, name];

/** Add/remove one alignment — non-importable names are refused (never selectable). */
export const toggleLandXmlImportAlignment = (
  selection: LandXmlImportReviewSelection,
  preview: LandXmlImportPreview,
  name: string,
): LandXmlImportReviewSelection => {
  const alignment = preview.alignments.find((entry) => entry.name === name);
  if (!alignment || !isLandXmlImportable(alignment.disposition)) return selection;
  return { ...selection, alignmentNames: toggleName(selection.alignmentNames, name) };
};

/** Add/remove one TIN surface — non-importable names are refused (never selectable). */
export const toggleLandXmlImportSurface = (
  selection: LandXmlImportReviewSelection,
  preview: LandXmlImportPreview,
  name: string,
): LandXmlImportReviewSelection => {
  const surface = preview.surfaces.find((entry) => entry.name === name);
  if (!surface || !isLandXmlImportable(surface.disposition)) return selection;
  return { ...selection, surfaceNames: toggleName(selection.surfaceNames, name) };
};

/** Selected object count: points count as parsed, alignments/surfaces per row. */
export const countLandXmlImportSelection = (
  preview: LandXmlImportPreview,
  selection: LandXmlImportReviewSelection,
): number =>
  (selection.includePoints ? preview.points.length : 0) +
  selection.alignmentNames.length +
  selection.surfaceNames.length;

/**
 * Map the UI selection onto the engine commit contract. Points are explicit
 * (empty array imports none); alignments/surfaces are name lists.
 */
export const buildLandXmlImportCommitPayload = (
  staged: LandXmlImportStagedState,
): LandXmlImportCommitPayload => ({
  drawingId: staged.drawingId,
  fileName: staged.fileName,
  version: staged.version,
  preview: staged.preview,
  selection: staged.selection,
  commitSelection: {
    pointIds: staged.selection.includePoints ? staged.preview.points.map((p) => p.id) : [],
    alignmentNames: [...staged.selection.alignmentNames],
    surfaceNames: [...staged.selection.surfaceNames],
  },
});
