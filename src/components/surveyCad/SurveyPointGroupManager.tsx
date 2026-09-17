import React, { useMemo, useState } from 'react';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import {
  backfillCadPointGroups,
  evaluatePointGroupMembership,
  validatePointGroupQuery,
} from '../../engine/cad/cadPointGroups';
import { backfillCadPointLabelStyles } from '../../engine/cad/cadPointLabelStyles';
import { backfillCadPointStyles } from '../../engine/cad/cadPointStyles';
import { nextSurveyTableId } from '../../engine/cad/cadSurveyDisplayRefs';
import type {
  CadPointGroup,
  CadPointGroupQuery,
  CadProject,
  CadSurveyPointEntity,
} from '../../engine/cad/cadTypes';
import { Field, ManagerShell } from './surveyManagerShared.tsx';
import { buttonClass, inputClass, nextCopyName } from './surveyManagerShared';

interface SurveyPointGroupManagerProps {
  project: CadProject;
  onSurveyCommand: (_command: CadCommand) => boolean;
  initialSelectedId?: string;
  onClose: () => void;
}

interface GroupDraft {
  name: string;
  description: string;
  includeIds: string;
  excludeIds: string;
  descriptionPattern: string;
  featureCodePattern: string;
  pointClass: string;
  layerId: string;
  source: string;
  elevationMin: string;
  elevationMax: string;
  pointStyleOverrideId: string;
  pointLabelStyleOverrideId: string;
}

const toDraft = (group: CadPointGroup): GroupDraft => ({
  name: group.name,
  description: group.description ?? '',
  includeIds: (group.query.includePointIds ?? []).join(', '),
  excludeIds: (group.query.excludePointIds ?? []).join(', '),
  descriptionPattern: group.query.descriptionPattern ?? '',
  featureCodePattern: group.query.featureCodePattern ?? '',
  pointClass: group.query.pointClass ?? '',
  layerId: group.query.layerId ?? '',
  source: group.query.source ?? '',
  elevationMin: group.query.elevationMin?.toString() ?? '',
  elevationMax: group.query.elevationMax?.toString() ?? '',
  pointStyleOverrideId: group.pointStyleOverrideId ?? '',
  pointLabelStyleOverrideId: group.pointLabelStyleOverrideId ?? '',
});

const splitIds = (value: string): string[] =>
  value.split(/[\s,]+/).map((part) => part.trim()).filter((part) => part.length > 0);

const parseBound = (value: string): number | undefined => {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const draftQuery = (draft: GroupDraft): CadPointGroupQuery => {
  const query: CadPointGroupQuery = {};
  const include = splitIds(draft.includeIds);
  const exclude = splitIds(draft.excludeIds);
  if (include.length > 0) query.includePointIds = include;
  if (exclude.length > 0) query.excludePointIds = exclude;
  if (draft.descriptionPattern.trim() !== '') query.descriptionPattern = draft.descriptionPattern;
  if (draft.featureCodePattern.trim() !== '') query.featureCodePattern = draft.featureCodePattern;
  if (draft.pointClass !== '') query.pointClass = draft.pointClass as CadPointGroupQuery['pointClass'];
  if (draft.layerId !== '') query.layerId = draft.layerId;
  if (draft.source !== '') query.source = draft.source as CadPointGroupQuery['source'];
  const min = parseBound(draft.elevationMin);
  const max = parseBound(draft.elevationMax);
  if (min !== undefined) query.elevationMin = min;
  if (max !== undefined) query.elevationMax = max;
  return query;
};

/**
 * Phase 18D point-group manager. Query validation errors surface live from
 * the shared validator (same fail-closed rules as the membership engine);
 * Apply is rejected while errors remain. Priority moves are buttons only.
 */
export const SurveyPointGroupManager: React.FC<SurveyPointGroupManagerProps> = ({
  project,
  onSurveyCommand,
  initialSelectedId,
  onClose,
}) => {
  const groups = useMemo(() => backfillCadPointGroups(project.pointGroups), [project.pointGroups]);
  const pointStyles = useMemo(() => backfillCadPointStyles(project.pointStyles), [project.pointStyles]);
  const labelStyles = useMemo(() => backfillCadPointLabelStyles(project.labelStyles), [project.labelStyles]);
  const points = useMemo(
    () => project.entities.filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point'),
    [project.entities],
  );
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? groups[0]?.id ?? '');
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const selected = groups.find((group) => group.id === selectedId) ?? groups[0] ?? null;
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const active = draft ?? (selected ? toDraft(selected) : null);
  const query = active ? draftQuery(active) : null;
  const errors = query ? validatePointGroupQuery(query) : [];
  const matchCount = useMemo(() => {
    if (!selected || !query) return 0;
    const probe: CadPointGroup = { ...selected, query };
    return points.filter((point) => evaluatePointGroupMembership(point, probe)).length;
  }, [selected, query, points]);

  // Display follows precedence order (priority asc, list order tiebreak),
  // matching the Toolspace tree and the membership engine.
  const visible = groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => a.group.priority - b.group.priority || a.index - b.index)
    .map(({ group }) => group)
    .filter((group) => group.name.toLowerCase().includes(filter.trim().toLowerCase()));

  const create = (): void => {
    const id = nextSurveyTableId('point-group-custom', groups.map((group) => group.id));
    const maxPriority = groups.reduce((max, entry) => Math.max(max, entry.priority), -1);
    const ok = onSurveyCommand({
      key: 'SURVEY_GROUP_TABLE',
      op: 'create',
      group: {
        id,
        name: nextCopyName('New Point Group', groups.map((group) => group.name)).replace('Copy of ', ''),
        query: {},
        priority: maxPriority + 1,
      },
    });
    if (ok) {
      setSelectedId(id);
      setDraft(null);
      setMessage(null);
    } else setMessage('Create rejected.');
  };

  const apply = (): void => {
    if (!selected || !active || !query) return;
    if (errors.length > 0) {
      setMessage(`Cannot apply: ${errors.join(' ')}`);
      return;
    }
    if (active.name.trim() === '') {
      setMessage('Cannot apply: name must not be empty.');
      return;
    }
    const renameOk =
      active.name.trim() === selected.name ||
      onSurveyCommand({ key: 'SURVEY_GROUP_TABLE', op: 'rename', groupId: selected.id, name: active.name.trim() });
    if (!renameOk) {
      setMessage('Cannot apply: name is already taken.');
      return;
    }
    const ok = onSurveyCommand({
      key: 'SURVEY_GROUP_TABLE',
      op: 'update',
      groupId: selected.id,
      query,
      description: active.description.trim() === '' ? null : active.description.trim(),
      pointStyleOverrideId: active.pointStyleOverrideId === '' ? null : active.pointStyleOverrideId,
      pointLabelStyleOverrideId: active.pointLabelStyleOverrideId === '' ? null : active.pointLabelStyleOverrideId,
    });
    if (ok) {
      setDraft(null);
      setMessage(null);
    } else setMessage('Apply rejected: check style references.');
  };

  const remove = (): void => {
    if (!selected) return;
    const ok = onSurveyCommand({ key: 'SURVEY_GROUP_TABLE', op: 'delete', groupId: selected.id });
    if (ok) {
      setDraft(null);
      setMessage(`Deleted "${selected.name}".`);
    } else setMessage('Delete rejected.');
  };

  const move = (direction: 'up' | 'down'): void => {
    if (!selected) return;
    const ok = onSurveyCommand({ key: 'SURVEY_GROUP_TABLE', op: 'move', groupId: selected.id, direction });
    if (!ok) setMessage(`Cannot move ${direction}: already at the ${direction === 'up' ? 'top' : 'bottom'}.`);
    else setMessage(null);
  };

  const set = (patch: Partial<GroupDraft>): void =>
    setDraft((current) => ({ ...(current ?? toDraft(selected!)), ...patch }));

  return (
    <ManagerShell label="Point group manager" title="Point Groups" onClose={onClose}>
      <div className="grid gap-2">
        <input
          aria-label="Filter groups"
          className={inputClass}
          placeholder="Filter groups…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          <button type="button" className={buttonClass} onClick={create}>New Point Group</button>
          <button type="button" className={buttonClass} disabled={!selected || !draft} onClick={apply}>Apply</button>
          <button type="button" className={buttonClass} disabled={!selected} onClick={() => move('up')}>Move Up</button>
          <button type="button" className={buttonClass} disabled={!selected} onClick={() => move('down')}>Move Down</button>
          <button type="button" className={buttonClass} disabled={!selected} onClick={remove}>Delete</button>
          {draft ? (
            <button type="button" className={buttonClass} onClick={() => setDraft(null)}>Revert</button>
          ) : null}
        </div>
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <div className="grid max-h-64 content-start gap-0.5 overflow-auto" role="listbox" aria-label="Point groups">
            {visible.map((group) => (
              <button
                key={group.id}
                type="button"
                role="option"
                aria-selected={group.id === selected?.id}
                className={`rounded px-1.5 py-1 text-left text-[11px] hover:bg-slate-800 ${group.id === selected?.id ? 'bg-slate-800' : ''}`}
                onClick={() => {
                  setSelectedId(group.id);
                  setDraft(null);
                  setMessage(null);
                }}
              >
                {group.name}
              </button>
            ))}
            {visible.length === 0 ? <span className="text-[11px] text-slate-500">No groups match.</span> : null}
          </div>
          {active && selected ? (
            <div className="grid content-start gap-1.5">
              <span className="text-[11px] text-slate-400">
                Matches {matchCount} of {points.length} points
              </span>
              <Field label="Name">
                <input className={inputClass} value={active.name} onChange={(event) => set({ name: event.target.value })} />
              </Field>
              <Field label="Description">
                <input className={inputClass} value={active.description} onChange={(event) => set({ description: event.target.value })} />
              </Field>
              <Field label="Include point ids (comma separated)">
                <input className={inputClass} value={active.includeIds} onChange={(event) => set({ includeIds: event.target.value })} />
              </Field>
              <Field label="Exclude point ids (comma separated)">
                <input className={inputClass} value={active.excludeIds} onChange={(event) => set({ excludeIds: event.target.value })} />
              </Field>
              <Field label="Description pattern (* and ? only)">
                <input className={inputClass} value={active.descriptionPattern} onChange={(event) => set({ descriptionPattern: event.target.value })} />
              </Field>
              <Field label="Feature code pattern (* and ? only)">
                <input className={inputClass} value={active.featureCodePattern} onChange={(event) => set({ featureCodePattern: event.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-1.5">
                <Field label="Class">
                  <select className={inputClass} value={active.pointClass} onChange={(event) => set({ pointClass: event.target.value })}>
                    <option value="">Any</option>
                    <option value="control">control</option>
                    <option value="free">free</option>
                    <option value="unknown">unknown</option>
                  </select>
                </Field>
                <Field label="Source">
                  <select className={inputClass} value={active.source} onChange={(event) => set({ source: event.target.value })}>
                    <option value="">Any</option>
                    <option value="adjustment-result">adjustment-result</option>
                    <option value="parsed-input">parsed-input</option>
                  </select>
                </Field>
              </div>
              <Field label="Layer">
                <select className={inputClass} value={active.layerId} onChange={(event) => set({ layerId: event.target.value })}>
                  <option value="">Any</option>
                  {project.layers.map((layer) => (
                    <option key={layer.id} value={layer.id}>{layer.name}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-1.5">
                <Field label="Elevation min">
                  <input className={inputClass} value={active.elevationMin} onChange={(event) => set({ elevationMin: event.target.value })} />
                </Field>
                <Field label="Elevation max">
                  <input className={inputClass} value={active.elevationMax} onChange={(event) => set({ elevationMax: event.target.value })} />
                </Field>
              </div>
              <Field label="Point style override">
                <select className={inputClass} value={active.pointStyleOverrideId} onChange={(event) => set({ pointStyleOverrideId: event.target.value })}>
                  <option value="">None</option>
                  {pointStyles.map((style) => (
                    <option key={style.id} value={style.id}>{style.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Label style override">
                <select className={inputClass} value={active.pointLabelStyleOverrideId} onChange={(event) => set({ pointLabelStyleOverrideId: event.target.value })}>
                  <option value="">None</option>
                  {labelStyles.map((style) => (
                    <option key={style.id} value={style.id}>{style.name}</option>
                  ))}
                </select>
              </Field>
              {errors.length > 0 ? (
                <ul className="grid gap-0.5 text-[11px] text-amber-200">
                  {errors.map((error) => (
                    <li key={error} role="alert">{error}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        {message ? <p role="status" className="text-[11px] text-amber-200">{message}</p> : null}
      </div>
    </ManagerShell>
  );
};
