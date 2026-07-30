import type { DescriptionTraceEntry, ParseOptions } from '../types';
import type { DescriptionReferenceRow, ResultTraceabilityModel } from './resultDerivedModels.types';

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim().toUpperCase();

export const buildDescriptionRefsByStation = (
  descriptionTrace: DescriptionTraceEntry[],
): Map<string, DescriptionReferenceRow[]> =>
  descriptionTrace.reduce<Map<string, DescriptionReferenceRow[]>>((acc, entry) => {
    const rows = acc.get(entry.stationId) ?? [];
    const key = normalizeText(entry.description);
    const existing = rows.find((row) => row.key === key);
    if (existing) {
      if (!existing.lines.includes(entry.sourceLine)) existing.lines.push(entry.sourceLine);
      existing.lines.sort((a, b) => a - b);
    } else {
      rows.push({
        key,
        description: entry.description,
        lines: [entry.sourceLine],
      });
      rows.sort((a, b) => a.description.localeCompare(b.description, undefined, { numeric: true }));
    }
    acc.set(entry.stationId, rows);
    return acc;
  }, new Map());

export const buildResultTraceabilityModel = (
  parseState?: ParseOptions,
): ResultTraceabilityModel => {
  const aliasTrace = [...(parseState?.aliasTrace ?? [])].sort((a, b) => {
    const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
    const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) return la - lb;
    const ca = a.context ?? '';
    const cb = b.context ?? '';
    if (ca !== cb) return ca.localeCompare(cb);
    return a.sourceId.localeCompare(b.sourceId);
  });
  const descriptionTrace = [...(parseState?.descriptionTrace ?? [])].sort((a, b) => {
    if (a.sourceLine !== b.sourceLine) return a.sourceLine - b.sourceLine;
    return a.stationId.localeCompare(b.stationId, undefined, { numeric: true });
  });
  const descriptionScanSummary = [...(parseState?.descriptionScanSummary ?? [])].sort((a, b) =>
    a.stationId.localeCompare(b.stationId, undefined, { numeric: true }),
  );
  const descriptionConflicts = descriptionScanSummary.filter((row) => row.conflict);

  return {
    aliasTrace,
    descriptionTrace,
    descriptionScanSummary,
    descriptionConflicts,
    descriptionRefsByStation: buildDescriptionRefsByStation(descriptionTrace),
    lostStationIds: [...(parseState?.lostStationIds ?? [])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    ),
    descriptionReconcileMode: parseState?.descriptionReconcileMode ?? 'first',
    descriptionAppendDelimiter: parseState?.descriptionAppendDelimiter ?? ' | ',
    descriptionRepeatedStationCount: parseState?.descriptionRepeatedStationCount ?? 0,
    descriptionConflictCount: parseState?.descriptionConflictCount ?? 0,
    reconciledDescriptions: parseState?.reconciledDescriptions ?? {},
  };
};
