import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import {
  CAD_SECTION_COMMANDS,
  type CadSampleLineGroupRow,
  type CadSampleLineRow,
} from './cadSectionSnapshot';
import { trySurfaceCommand } from './cadSurfaceSnapshot';
import { CadSectionViewSettings } from './CadSectionViewSettings';
import { CadSectionInquiryPanel } from './CadSectionInquiryPanel';
import { Field, ManagerShell } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

interface CadSampleLineManagerProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  onClose: () => void;
}

/**
 * Phase 18K — dense sample-line manager. Group header (name/alignment/
 * sources) + line table (name/station/left/right/skew/status) + actions
 * (Add-at-Station / Generate-by-Interval / Edit / Delete / Rebuild /
 * Create Section View) + source manager (surface/style/status,
 * add/remove/style-assign, base/comparison pickers). No giant cards:
 * compact rows, details in the selected-line panel. Every mutation is an
 * undoable SAMPLE or SECTION command (Rebuild is a session service call).
 */
export const CadSampleLineManager: React.FC<CadSampleLineManagerProps> = ({ snapshot, actions, onClose }) => {
  return (
    <ManagerShell label="Sample line manager" title="Sample Lines & Section Views" onClose={onClose}>
      <SampleLineSection snapshot={snapshot} actions={actions} />
    </ManagerShell>
  );
};

export const SampleLineSection: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
}> = ({ snapshot, actions }) => {
  const section = snapshot.section;
  const surface = snapshot.surface;
  const [notice, setNotice] = React.useState<string | null>(null);
  const [createName, setCreateName] = React.useState('');
  const [createAlignment, setCreateAlignment] = React.useState('');
  if (!section || !surface) return null;
  const selected: CadSampleLineGroupRow | null =
    section.groups.find((entry) => entry.id === section.selectedGroupId) ?? section.groups[0] ?? null;
  React.useEffect(() => {
    if (selected && selected.id !== section.selectedGroupId) actions.selectSampleLineGroup(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const create = (): void => {
    if (!createAlignment) {
      setNotice('Create rejected — pick an alignment.');
      return;
    }
    const ok = trySurfaceCommand(actions.runSurveyCommand, ({
      key: CAD_SECTION_COMMANDS.groupCreate,
      ...(createName.trim() ? { name: createName.trim() } : {}),
      alignmentEntityId: createAlignment,
    }));
    if (ok) {
      setCreateName('');
      setNotice('Sample-line group created — add sources, then sample lines.');
    } else {
      setNotice('Create rejected — command or alignment invalid.');
    }
  };
  return (
    <>
      {notice ? <p role="status" data-section-notice className="mb-2 text-[11px] text-amber-200">{notice}</p> : null}
      <div className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
        <Field label="Name (blank = auto)">
          <input
            aria-label="New sample-line group name"
            className={inputClass}
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="Sample Line Group N (auto)"
          />
        </Field>
        <Field label="Alignment">
          <select aria-label="New group alignment" className={inputClass} value={createAlignment} onChange={(event) => setCreateAlignment(event.target.value)}>
            <option value="">— pick —</option>
            {section.alignments.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <button type="button" className={buttonClass} onClick={create}>Create Group</button>
        </div>
      </div>
      <ul className="mb-2 divide-y divide-slate-700 rounded border border-slate-700" data-sample-group-list>
        {section.groups.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={`grid w-full grid-cols-[1fr_auto] gap-x-2 px-2 py-1 text-left text-[11px] hover:bg-slate-800 ${row.id === selected?.id ? 'bg-slate-800' : ''}`}
              onClick={() => actions.selectSampleLineGroup(row.id)}
              title={`${row.name} — ${row.alignmentName}`}
              aria-label={`Sample-line group ${row.name}`}
              data-cad-sample-group={row.id}
            >
              <span className="truncate font-medium text-slate-100">{row.name} <span className="text-slate-500">[SAMPLEGROUP]</span></span>
              <span className="text-slate-400">{row.lines.length} lines · {row.sources.length} sources</span>
              <span className="truncate text-slate-400">{row.alignmentName} · layer {row.layerName}</span>
              <span className="text-slate-400">
                {row.baseSurfaceName || row.comparisonSurfaceName
                  ? `cut/fill ${row.baseSurfaceName ?? '—'} vs ${row.comparisonSurfaceName ?? '—'}`
                  : 'no cut/fill pair'}
              </span>
            </button>
          </li>
        ))}
        {section.groups.length === 0 ? (
          <li className="px-2 py-1 text-[11px] text-slate-400">No sample-line groups — create one above.</li>
        ) : null}
      </ul>
      {selected ? (
        <SelectedGroup snapshot={snapshot} actions={actions} row={selected} setNotice={setNotice} />
      ) : null}
      <SectionViewsSection snapshot={snapshot} actions={actions} setNotice={setNotice} />
      <SectionStyleSection snapshot={snapshot} actions={actions} setNotice={setNotice} />
    </>
  );
};

const SelectedGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  row: CadSampleLineGroupRow;
  setNotice: (_notice: string) => void;
}> = ({ snapshot, actions, row, setNotice }) => {
  const section = snapshot.section!;
  const surface = snapshot.surface!;
  const [station, setStation] = React.useState('');
  const [leftWidth, setLeftWidth] = React.useState('20');
  const [rightWidth, setRightWidth] = React.useState('20');
  const [intervalStart, setIntervalStart] = React.useState('');
  const [intervalEnd, setIntervalEnd] = React.useState('');
  const [interval, setInterval] = React.useState('25');
  const [sourcePick, setSourcePick] = React.useState('');
  const [basePick, setBasePick] = React.useState('');
  const [comparisonPick, setComparisonPick] = React.useState('');
  const selectedLine: CadSampleLineRow | null =
    row.lines.find((entry) => entry.id === section.selectedLineId) ?? null;
  React.useEffect(() => {
    if (selectedLine && selectedLine.id !== section.selectedLineId) {
      actions.selectSampleLine(row.id, selectedLine.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLine?.id]);

  const commit = (label: string, ok: boolean): void =>
    setNotice(ok ? `${label} done.` : `${label} rejected — command or source invalid.`);
  const num = (text: string): number | null => {
    const value = Number(text);
    return text.trim() !== '' && Number.isFinite(value) ? value : null;
  };
  const addAtStation = (): void => {
    if (station.trim() === '') {
      setNotice('Add rejected — enter a display station (e.g. 1+25.000).');
      return;
    }
    const left = num(leftWidth);
    const right = num(rightWidth);
    if (left == null || right == null) {
      setNotice('Add rejected — left/right widths must be numeric (≥ 0).');
      return;
    }
    commit('Add sample line', trySurfaceCommand(actions.runSurveyCommand, ({
      key: CAD_SECTION_COMMANDS.lineAdd,
      groupId: row.id,
      stationText: station.trim(),
      leftWidth: left,
      rightWidth: right,
    })));
  };
  const addByInterval = (): void => {
    const start = num(intervalStart);
    const end = num(intervalEnd);
    const step = num(interval);
    const left = num(leftWidth);
    const right = num(rightWidth);
    if (start == null || end == null || step == null || left == null || right == null) {
      setNotice('By-interval rejected — raw start/end/interval + widths must all be numeric.');
      return;
    }
    commit('Generate by interval', trySurfaceCommand(actions.runSurveyCommand, ({
      key: CAD_SECTION_COMMANDS.lineAddInterval,
      groupId: row.id,
      rawStart: start,
      rawEnd: end,
      interval: step,
      leftWidth: left,
      rightWidth: right,
    })));
  };
  const removeGroup = (): void => {
    if (!window.confirm(`Delete group “${row.name}”? Lines + views unbind; alignment/surfaces untouched.`)) return;
    commit('Delete group', trySurfaceCommand(actions.runSurveyCommand, ({
      key: CAD_SECTION_COMMANDS.groupDelete,
      groupId: row.id,
    })));
  };
  const addSource = (): void => {
    if (!sourcePick) {
      setNotice('Add source rejected — pick a surface.');
      return;
    }
    commit('Add source', trySurfaceCommand(actions.runSurveyCommand, ({
      key: CAD_SECTION_COMMANDS.sourceAdd,
      groupId: row.id,
      surfaceId: sourcePick,
    })));
  };
  const applyComparison = (): void => {
    if (!basePick || !comparisonPick) {
      setNotice('Cut/fill pair rejected — pick base + comparison surfaces.');
      return;
    }
    commit('Cut/fill pair', trySurfaceCommand(actions.runSurveyCommand, ({
      key: CAD_SECTION_COMMANDS.areaComparison,
      groupId: row.id,
      baseSurfaceId: basePick,
      comparisonSurfaceId: comparisonPick,
    })));
  };
  const clearComparison = (): void => {
    commit('Cut/fill pair cleared', trySurfaceCommand(actions.runSurveyCommand, ({
      key: CAD_SECTION_COMMANDS.areaComparison,
      groupId: row.id,
    })));
  };
  return (
    <div className="grid gap-2 rounded border border-slate-700 p-2" data-sample-group-detail={row.id}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
        <dt className="text-slate-400">Group</dt><dd>{row.name}</dd>
        <dt className="text-slate-400">Alignment</dt><dd>{row.alignmentName}</dd>
        <dt className="text-slate-400">Sources</dt>
        <dd>{row.sources.length > 0 ? row.sources.map((source) => `${source.surfaceName} (${source.styleName})`).join(', ') : '— none — rebuild needs ≥1 source surface'}</dd>
      </dl>
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
        <Field label="Station (display)">
          <input aria-label="Sample line station" className={inputClass} value={station} onChange={(event) => setStation(event.target.value)} placeholder="1+25.000" inputMode="decimal" />
        </Field>
        <Field label="Left width">
          <input aria-label="Sample line left width" className={inputClass} value={leftWidth} onChange={(event) => setLeftWidth(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Right width">
          <input aria-label="Sample line right width" className={inputClass} value={rightWidth} onChange={(event) => setRightWidth(event.target.value)} inputMode="decimal" />
        </Field>
        <button type="button" className={buttonClass} onClick={addAtStation}>Add Sample Line</button>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
        <Field label="Raw start">
          <input aria-label="Interval raw start" className={inputClass} value={intervalStart} onChange={(event) => setIntervalStart(event.target.value)} placeholder="0" inputMode="decimal" />
        </Field>
        <Field label="Raw end">
          <input aria-label="Interval raw end" className={inputClass} value={intervalEnd} onChange={(event) => setIntervalEnd(event.target.value)} placeholder="500" inputMode="decimal" />
        </Field>
        <Field label="Interval (raw spacing)">
          <input aria-label="Interval spacing" className={inputClass} value={interval} onChange={(event) => setInterval(event.target.value)} inputMode="decimal" />
        </Field>
        <button type="button" className={buttonClass} onClick={addByInterval}>By Interval</button>
      </div>
      <table className="w-full text-left text-[11px]" data-sample-line-table>
        <thead>
          <tr className="text-slate-400">
            <th className="px-1 py-0.5">Name</th>
            <th className="px-1 py-0.5">Station</th>
            <th className="px-1 py-0.5">L / R</th>
            <th className="px-1 py-0.5">Skew</th>
            <th className="px-1 py-0.5">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {row.lines.map((line) => (
            <tr
              key={line.id}
              className={line.id === selectedLine?.id ? 'bg-slate-800' : undefined}
              data-cad-sample-line={line.id}
              onClick={() => actions.selectSampleLine(row.id, line.id)}
            >
              <td className="px-1 py-0.5 text-slate-100">{line.name}</td>
              <td className="px-1 py-0.5 text-slate-400">
                {line.displayedStation}{line.stationAmbiguous ? ' (ambiguous)' : ''}
              </td>
              <td className="px-1 py-0.5 text-slate-400">{line.leftWidth} / {line.rightWidth}</td>
              <td className="px-1 py-0.5 text-slate-400">{line.skewDeg}°</td>
              <td className="px-1 py-0.5 text-slate-400">
                {line.sources.length > 0 ? line.sources.map((entry) => entry.statusText).join(' / ') : '—'}
              </td>
            </tr>
          ))}
          {row.lines.length === 0 ? (
            <tr><td colSpan={5} className="px-1 py-0.5 text-slate-400">No sample lines — add at a station or by interval.</td></tr>
          ) : null}
        </tbody>
      </table>
      {selectedLine ? (
        <SelectedLine
          snapshot={snapshot}
          actions={actions}
          groupId={row.id}
          row={selectedLine}
          setNotice={setNotice}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} onClick={() => setNotice(actions.rebuildSections(row.id))}>
          Rebuild Sections
        </button>
        <button type="button" className={buttonClass} onClick={() => actions.createSectionViews(row.id)}>
          Create Section Views
        </button>
        <button type="button" className={buttonClass} onClick={removeGroup}>Delete Group</button>
      </div>
      <div className="grid gap-2 rounded border border-slate-800 p-2" data-section-source-manager={row.id}>
        <h3 className="text-[11px] font-semibold text-slate-200">Sources</h3>
        <ul className="divide-y divide-slate-800">
          {row.sources.map((source) => (
            <li key={source.surfaceId} className="flex items-center gap-2 py-1 text-[11px]">
              <span className="flex-1 truncate text-slate-100">{source.surfaceName}</span>
              <select
                aria-label={`Style for ${source.surfaceName}`}
                className={inputClass}
                value={source.styleId ?? ''}
                onChange={(event) => commit('Style assign', trySurfaceCommand(actions.runSurveyCommand, ({
                  key: CAD_SECTION_COMMANDS.sourceSetStyle,
                  groupId: row.id,
                  surfaceId: source.surfaceId,
                  sectionStyleId: event.target.value === '' ? null : event.target.value,
                })))}
              >
                <option value="">Standard</option>
                {section.styles.map((style) => (
                  <option key={style.id} value={style.id}>{style.name}</option>
                ))}
              </select>
              <button
                type="button"
                className={buttonClass}
                onClick={() => commit('Remove source', trySurfaceCommand(actions.runSurveyCommand, ({
                  key: CAD_SECTION_COMMANDS.sourceRemove,
                  groupId: row.id,
                  surfaceId: source.surfaceId,
                })))}
              >
                Remove
              </button>
            </li>
          ))}
          {row.sources.length === 0 ? (
            <li className="py-1 text-[11px] text-slate-400">No sources — add a surface below.</li>
          ) : null}
        </ul>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field label="Surface">
            <select aria-label="Add source surface" className={inputClass} value={sourcePick} onChange={(event) => setSourcePick(event.target.value)}>
              <option value="">— pick —</option>
              {surface.surfaces
                .filter((entry) => !row.sources.some((source) => source.surfaceId === entry.id))
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
            </select>
          </Field>
          <button type="button" className={buttonClass} onClick={addSource}>Add Source</button>
        </div>
        <div className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2">
          <Field label="Base surface">
            <select aria-label="Cut/fill base surface" className={inputClass} value={basePick} onChange={(event) => setBasePick(event.target.value)}>
              <option value="">— pick —</option>
              {row.sources.map((source) => (
                <option key={source.surfaceId} value={source.surfaceId}>{source.surfaceName}</option>
              ))}
            </select>
          </Field>
          <Field label="Comparison surface">
            <select aria-label="Cut/fill comparison surface" className={inputClass} value={comparisonPick} onChange={(event) => setComparisonPick(event.target.value)}>
              <option value="">— pick —</option>
              {row.sources.map((source) => (
                <option key={source.surfaceId} value={source.surfaceId}>{source.surfaceName}</option>
              ))}
            </select>
          </Field>
          <button type="button" className={buttonClass} onClick={applyComparison}>Set Pair</button>
          <button type="button" className={buttonClass} onClick={clearComparison}>Clear</button>
        </div>
      </div>
    </div>
  );
};

const SelectedLine: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  groupId: string;
  row: CadSampleLineRow;
  setNotice: (_notice: string) => void;
}> = ({ snapshot, actions, groupId, row, setNotice }) => {
  const [leftWidth, setLeftWidth] = React.useState(row.leftWidth.toString());
  const [rightWidth, setRightWidth] = React.useState(row.rightWidth.toString());
  const [skew, setSkew] = React.useState(row.skewDeg.toString());
  const [name, setName] = React.useState('');
  React.useEffect(() => {
    setLeftWidth(row.leftWidth.toString());
    setRightWidth(row.rightWidth.toString());
    setSkew(row.skewDeg.toString());
    setName('');
  }, [row]);
  const commit = (label: string, ok: boolean): void =>
    setNotice(ok ? `${label} done.` : `${label} rejected — command or values invalid.`);
  const apply = (): void => {
    const patch: { leftWidth?: number; rightWidth?: number; skewDeg?: number; manualName?: string } = {};
    if (leftWidth.trim() !== '') {
      const value = Number(leftWidth);
      if (!Number.isFinite(value)) {
        setNotice('Edit rejected — left width must be numeric.');
        return;
      }
      patch.leftWidth = value;
    }
    if (rightWidth.trim() !== '') {
      const value = Number(rightWidth);
      if (!Number.isFinite(value)) {
        setNotice('Edit rejected — right width must be numeric.');
        return;
      }
      patch.rightWidth = value;
    }
    if (skew.trim() !== '') {
      const value = Number(skew);
      if (!Number.isFinite(value)) {
        setNotice('Edit rejected — skew must be numeric.');
        return;
      }
      patch.skewDeg = value;
    }
    if (name.trim() !== '') patch.manualName = name.trim();
    commit('Edit', trySurfaceCommand(actions.runSurveyCommand, ({
      key: CAD_SECTION_COMMANDS.lineUpdate,
      groupId,
      lineId: row.id,
      patch,
    })));
  };
  return (
    <div className="grid gap-2 rounded border border-slate-800 p-2" data-sample-line-detail={row.id}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
        <dt className="text-slate-400">Station</dt><dd>{row.name}</dd>
        <dt className="text-slate-400">Raw station</dt><dd className="text-slate-400">{row.rawStation.toFixed(3)} (diagnostic — persisted identity)</dd>
        {row.stationAmbiguous ? (<><dt className="text-slate-400">Diagnostic</dt><dd className="text-amber-200">Raw sits inside a station-equation gap — label falls back to raw.</dd></>) : null}
        {row.sources.map((entry) => (
          <React.Fragment key={entry.surfaceId}>
            <dt className="text-slate-400">{entry.surfaceName}</dt>
            <dd>{entry.statusText}{entry.stale ? ' (stale)' : ''}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2">
        <Field label="Left">
          <input aria-label="Edit left width" className={inputClass} value={leftWidth} onChange={(event) => setLeftWidth(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Right">
          <input aria-label="Edit right width" className={inputClass} value={rightWidth} onChange={(event) => setRightWidth(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Skew°">
          <input aria-label="Edit skew" className={inputClass} value={skew} onChange={(event) => setSkew(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Name override">
          <input aria-label="Edit line name" className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="(auto)" />
        </Field>
        <button type="button" className={buttonClass} onClick={apply}>Apply</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => setNotice(actions.rebuildSectionLine(groupId, row.id))}
        >
          Rebuild Line
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            if (!window.confirm(`Delete sample line “${row.name}”? Definition only.`)) return;
            commit('Delete', trySurfaceCommand(actions.runSurveyCommand, ({
              key: CAD_SECTION_COMMANDS.lineDelete,
              groupId,
              lineId: row.id,
            })));
          }}
        >
          Delete
        </button>
      </div>
      <CadSectionInquiryPanel snapshot={snapshot} actions={actions} groupId={groupId} lineId={row.id} />
    </div>
  );
};

const SectionViewsSection: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  setNotice: (_notice: string) => void;
}> = ({ snapshot, actions, setNotice }) => {
  const section = snapshot.section!;
  const selectedView = section.views.find((entry) => entry.id === section.selectedViewId) ?? null;
  return (
    <section aria-label="Section views" className="mt-2 grid gap-2 rounded border border-slate-700 p-2" data-cad-section-views-section>
      <h3 className="text-[11px] font-semibold text-slate-200">Section Views</h3>
      <ul className="divide-y divide-slate-700">
        {section.views.map((view) => (
          <li key={view.id} className="flex items-center gap-2 py-1 text-[11px]">
            <button
              type="button"
              className="flex-1 truncate text-left text-slate-100 hover:text-sky-200"
              onClick={() => actions.selectSectionView(view.id)}
              data-cad-section-view={view.id}
            >
              {view.name} <span className="text-slate-500">[SECTIONVIEW]</span>
            </button>
            <span className={view.validationError ? 'text-amber-200' : 'text-slate-500'}>
              {view.validationError ?? `${view.lineName} · 1:${view.horizontalScale} V.E. ${view.verticalExaggeration}`}
            </span>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setNotice(trySurfaceCommand(actions.runSurveyCommand, ({
                key: CAD_SECTION_COMMANDS.viewDelete,
                viewId: view.id,
              })) ? 'Section view deleted.' : 'Delete rejected — command unavailable.')}
            >
              Delete
            </button>
          </li>
        ))}
        {section.views.length === 0 ? (
          <li className="py-1 text-[11px] text-slate-400">No section views — select a group and Create Section Views.</li>
        ) : null}
      </ul>
      {selectedView ? (
        <CadSectionViewSettings snapshot={snapshot} actions={actions} view={selectedView} setNotice={setNotice} />
      ) : null}
    </section>
  );
};

const SectionStyleSection: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  setNotice: (_notice: string) => void;
}> = ({ snapshot, actions, setNotice }) => {
  const section = snapshot.section!;
  const [newName, setNewName] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const editing = editingId != null ? section.styles.find((entry) => entry.id === editingId) ?? null : null;
  const commit = (label: string, ok: boolean): void =>
    setNotice(ok ? `${label} done.` : `${label} rejected — name taken, style in use, or command unavailable.`);
  const stamp = (): string => `section-style-${Date.now().toString(36)}`;
  return (
    <section aria-label="Section style settings" className="mt-2 grid gap-2 rounded border border-slate-700 p-2">
      <h3 className="text-[11px] font-semibold text-slate-200">Section Style Settings</h3>
      <ul className="divide-y divide-slate-700">
        {section.styles.map((style) => (
          <li key={style.id} className="flex items-center gap-2 py-1 text-[11px]">
            <span className="flex-1 truncate text-slate-100">{style.name}</span>
            <span className="text-slate-500">{style.color} · {style.lineweight}mm</span>
            <button type="button" className={buttonClass} onClick={() => { setEditingId(style.id); setRenameDraft(style.name); }}>Edit</button>
          </li>
        ))}
      </ul>
      {editing ? (
        <div className="grid gap-2">
          <Field label="Rename style">
            <div className="flex gap-2">
              <input aria-label="Section style name" className={inputClass} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} />
              <button type="button" className={buttonClass} onClick={() => commit('Rename', trySurfaceCommand(actions.runSurveyCommand, ({ key: CAD_SECTION_COMMANDS.styleRename, styleId: editing.id, name: renameDraft })))}>Rename</button>
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  if (!window.confirm(`Delete section style “${editing.name}”? Blocked while a source or view uses it (pick a replacement first).`)) return;
                  commit('Delete', trySurfaceCommand(actions.runSurveyCommand, ({ key: CAD_SECTION_COMMANDS.styleDelete, styleId: editing.id })));
                  setEditingId(null);
                }}
              >
                Delete
              </button>
            </div>
          </Field>
        </div>
      ) : null}
      <Field label="New style name">
        <div className="flex gap-2">
          <input aria-label="New section style name" className={inputClass} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="My section" />
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              if (newName.trim() === '') { setNotice('Style name required.'); return; }
              commit('Style create', trySurfaceCommand(actions.runSurveyCommand, ({
                key: CAD_SECTION_COMMANDS.styleCreate,
                style: { id: stamp(), name: newName.trim(), color: '#1f6feb', lineweight: 0.5, opacity: 0 },
              })));
              setNewName('');
            }}
          >
            New Style
          </button>
        </div>
      </Field>
    </section>
  );
};
