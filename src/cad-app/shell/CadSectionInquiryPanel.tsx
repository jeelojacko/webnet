import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18K — Section Elevation at Offset. Signed offset input (+left,
 * −right, matching the 20L/10L/0/10R/20R view ticks); resolves to the
 * displayed station + E/N + interpolated elevation. Gaps and
 * outside-coverage answer honestly (never guessed). No geometry is created.
 * View-click inquiry is deferred: clicking a view selects it; query here.
 */
export const CadSectionInquiryPanel: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  groupId: string;
  lineId: string;
}> = ({ snapshot, actions, groupId, lineId }) => {
  const section = snapshot.section;
  const group = section?.groups.find((entry) => entry.id === groupId) ?? null;
  const line = group?.lines.find((entry) => entry.id === lineId) ?? null;
  const [surfaceId, setSurfaceId] = React.useState('');
  const [offset, setOffset] = React.useState('0');
  const [answer, setAnswer] = React.useState<string | null>(null);
  const activeSurfaceId = surfaceId !== '' ? surfaceId : (group?.sources[0]?.surfaceId ?? '');
  if (!group || !line) return null;

  const query = (): void => {
    const value = Number(offset);
    if (offset.trim() === '' || !Number.isFinite(value)) {
      setAnswer('Enter a numeric offset first (signed: +left / −right, e.g. 10 or -5).');
      return;
    }
    if (!activeSurfaceId) {
      setAnswer('No source surface — add one before querying elevation.');
      return;
    }
    setAnswer(actions.querySectionElevation(groupId, lineId, activeSurfaceId, value));
  };

  return (
    <div className="grid gap-2 rounded border border-slate-700 p-2" data-cad-section-inquiry={line.id}>
      <h3 className="text-[11px] font-semibold text-slate-200">Section Elevation — {line.name}</h3>
      <p className="text-[11px] text-slate-400">
        {group.alignmentName} · {line.displayedStation} · L {line.leftWidth} R {line.rightWidth}
      </p>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <Field label="Surface">
          <select aria-label="Section inquiry surface" className={inputClass} value={activeSurfaceId} onChange={(event) => setSurfaceId(event.target.value)}>
            {group.sources.map((source) => (
              <option key={source.surfaceId} value={source.surfaceId}>{source.surfaceName}</option>
            ))}
          </select>
        </Field>
        <Field label="Offset (+L/−R)">
          <input
            aria-label="Section inquiry offset"
            className={inputClass}
            value={offset}
            inputMode="decimal"
            placeholder="0"
            onChange={(event) => setOffset(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') query(); }}
          />
        </Field>
        <button type="button" className={buttonClass} onClick={query}>Query</button>
      </div>
      <p role="status" className="text-[11px] text-slate-200">
        {answer ?? 'No query yet — offset resolves to station, E/N, and interpolated elevation.'}
      </p>
    </div>
  );
};
