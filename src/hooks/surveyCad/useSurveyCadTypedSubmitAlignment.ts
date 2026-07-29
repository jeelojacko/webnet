import {
  cadBuildAlignmentStationPoints,
  cadBuildOffsetAlignmentDraft,
  cadPointAtAlignmentStationOffset,
} from '../../engine/cad/cadAlignment';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import {
  parseAlignmentIntervalInput,
  parseAlignmentOffsetCreateInput,
  parseAlignmentStationEquationInput,
  parseAlignmentStationOffsetInput,
} from './useSurveyCadCommandParsing';
import type { HandleSurveyCadTypedSubmitOptions } from './useSurveyCadTypedSubmit.types';

export const handleSurveyCadAlignmentSubmit = ({
  applyHistoryUpdate,
  replaceSession,
  session,
}: Omit<HandleSurveyCadTypedSubmitOptions, 'consumePoint' | 'publishReport'>): boolean => {
  if (session.key === 'ALIGNMENT_OFFSET_POINT') {
    const parsed = parseAlignmentStationOffsetInput(session.inputValue);
    const point = parsed
      ? cadPointAtAlignmentStationOffset(session.alignment, parsed.station, parsed.offset)
      : null;
    if (!parsed || !point) {
      replaceSession({
        ...session,
        resultText:
          'STA PT input invalid. Use `station,offset` or `LABEL=station,offset` within the selected alignment range.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'ALIGNMENT_OFFSET_POINT',
        alignmentEntityId: session.alignment.id,
        station: parsed.station,
        offset: parsed.offset,
        label: parsed.label,
      }),
    );
    replaceSession(null);
    return true;
  }

  if (session.key === 'ALIGNMENT_OFFSET_CREATE') {
    const parsed = parseAlignmentOffsetCreateInput(session.inputValue);
    const draft = parsed ? cadBuildOffsetAlignmentDraft(session.alignment, parsed.offset) : null;
    if (!parsed || !draft) {
      replaceSession({
        ...session,
        resultText:
          'ALIGN OFF input invalid. Use `offset` or `NAME=offset` for a buildable selected alignment.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'ALIGNMENT_OFFSET_CREATE',
        alignmentEntityId: session.alignment.id,
        offset: parsed.offset,
        name: parsed.name,
      }),
    );
    replaceSession(null);
    return true;
  }

  if (session.key === 'ALIGNMENT_STATION_EQUATION') {
    const parsed = parseAlignmentStationEquationInput(session.inputValue);
    if (!parsed) {
      replaceSession({
        ...session,
        resultText: 'STA EQ input invalid. Use `backStation,aheadStation`, with ahead at or above back.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'ALIGNMENT_STATION_EQUATION',
        alignmentEntityId: session.alignment.id,
        backStation: parsed.backStation,
        aheadStation: parsed.aheadStation,
      }),
    );
    replaceSession(null);
    return true;
  }

  if (session.key !== 'ALIGNMENT_INTERVAL_POINTS') return false;
  const parsed = parseAlignmentIntervalInput(session.inputValue);
  const points = parsed
    ? cadBuildAlignmentStationPoints(session.alignment, {
        startStation: parsed.startStation,
        endStation: parsed.endStation,
        interval: parsed.interval,
        includeStart: true,
        includeEnd: true,
      })
    : [];
  if (!parsed || points.length === 0) {
    replaceSession({
      ...session,
      resultText:
        'STA INT input invalid. Use `interval` or `start,end,interval` within the selected alignment range.',
    });
    return true;
  }
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, {
      key: 'ALIGNMENT_INTERVAL_POINTS',
      alignmentEntityId: session.alignment.id,
      interval: parsed.interval,
      startStation: parsed.startStation,
      endStation: parsed.endStation,
      labelPrefix: parsed.labelPrefix,
    }),
  );
  replaceSession(null);
  return true;
};
