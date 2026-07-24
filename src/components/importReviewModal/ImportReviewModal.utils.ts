import type { ImportedTraceEntry } from '../../engine/importers';
import type { ImportConflict, ImportResolution } from '../../engine/importConflictReview';
import type { ImportReviewItem, ImportReviewRowTypeOverride } from '../../engine/importReview';

export const traceLineLabel = (entry: ImportedTraceEntry): string => {
  const parts: string[] = [];
  if (entry.sourceLine != null) parts.push(`line ${entry.sourceLine}`);
  if (entry.sourceCode) parts.push(`[${entry.sourceCode}]`);
  return parts.join(' ');
};

export const rowSourceLabel = (item: ImportReviewItem): string =>
  item.sourceLine != null ? String(item.sourceLine) : '-';

export const getConflictResolutionOptions = (
  conflict: ImportConflict,
): Array<{ value: ImportResolution; label: string }> =>
  conflict.resolutionKey.startsWith('control:')
    ? [
        { value: 'keep-existing', label: 'Keep Existing' },
        { value: 'replace-with-incoming', label: 'Replace With Incoming' },
        { value: 'rename-incoming', label: 'Rename Incoming' },
        { value: 'keep-both', label: 'Keep Both' },
      ]
    : [
        { value: 'keep-existing', label: 'Keep Existing' },
        { value: 'replace-with-incoming', label: 'Replace With Incoming' },
        { value: 'keep-both', label: 'Keep Both' },
      ];

export const rowTypeOptionsForItem = (
  item: ImportReviewItem,
): Array<{ value: ImportReviewRowTypeOverride; label: string }> => {
  if (item.kind !== 'observation') return [];

  const options: Array<{ value: ImportReviewRowTypeOverride; label: string }> = [
    { value: 'auto', label: 'Auto' },
  ];

  switch (item.sourceObservationKind) {
    case 'measurement':
      options.push({ value: 'measurement', label: 'M' });
      options.push({ value: 'distance', label: 'D' });
      options.push({ value: 'distance-vertical', label: 'DV' });
      options.push({ value: 'angle', label: 'A' });
      options.push({ value: 'vertical', label: 'V' });
      if (item.setupId && item.backsightId) {
        options.push({ value: 'direction-angle', label: 'DN' });
        options.push({ value: 'direction-measurement', label: 'DM' });
      }
      return options;
    case 'angle':
      options.push({ value: 'angle', label: 'A' });
      if (item.setupId && item.backsightId) {
        options.push({ value: 'direction-angle', label: 'DN' });
      }
      return options;
    case 'distance-vertical':
      options.push({ value: 'distance', label: 'D' });
      options.push({ value: 'distance-vertical', label: 'DV' });
      options.push({ value: 'vertical', label: 'V' });
      return options;
    case 'distance':
      options.push({ value: 'distance', label: 'D' });
      return options;
    case 'vertical':
      options.push({ value: 'vertical', label: 'V' });
      return options;
    case 'bearing':
      options.push({ value: 'bearing', label: 'B' });
      return options;
    default:
      return options;
  }
};
