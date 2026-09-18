import React, { useMemo, useState } from 'react';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import {
  countLabelStyleRefs, describeStyleDeleteGuard, isSurveyNameTaken, nextSurveyTableId,
} from '../../engine/cad/cadSurveyDisplayRefs';
import { backfillCadPointLabelStyles } from '../../engine/cad/cadPointLabelStyles';
import type {
  CadPointLabelComponent,
  CadPointLabelStyle,
  CadProject,
} from '../../engine/cad/cadTypes';
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';
import { Field, LabelStylePreview, ManagerShell } from './surveyManagerShared.tsx';
import { buttonClass, inputClass, nextCopyName } from './surveyManagerShared';

interface SurveyPointLabelStyleManagerProps {
  project: CadProject;
  catalog: FeatureCodeCatalog;
  onSurveyCommand: (_command: CadCommand) => boolean;
  onCatalogRewire: (_table: 'point' | 'label', _fromId: string, _toId: string) => void;
  initialSelectedId?: string;
  onClose: () => void;
}

const COMPONENTS: Array<{ id: CadPointLabelComponent; label: string }> = [
  { id: 'pointNumber', label: 'Point number' },
  { id: 'description', label: 'Description' },
  { id: 'featureCode', label: 'Feature code' },
  { id: 'elevation', label: 'Elevation' },
];

/**
 * Phase 18D label-style table manager. Same CRUD + delete-guard shape as
 * the point-style manager, plus component order and a live text preview.
 */
export const SurveyPointLabelStyleManager: React.FC<SurveyPointLabelStyleManagerProps> = ({
  project,
  catalog,
  onSurveyCommand,
  onCatalogRewire,
  initialSelectedId,
  onClose,
}) => {
  const styles = useMemo(() => backfillCadPointLabelStyles(project.labelStyles), [project.labelStyles]);
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? styles[0]?.id ?? '');
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const selected = styles.find((style) => style.id === selectedId) ?? styles[0] ?? null;
  const [draft, setDraft] = useState<Partial<CadPointLabelStyle> | null>(null);
  const active: CadPointLabelStyle | null = selected
    ? {
        ...selected,
        ...(draft ?? {}),
        components: { ...selected.components, ...(draft?.components ?? {}) },
        componentOrder: draft?.componentOrder ?? selected.componentOrder,
      }
    : null;

  const visible = styles.filter((style) =>
    style.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const refs = selected ? countLabelStyleRefs(project, catalog, selected.id) : null;
  const guard = selected
    ? describeStyleDeleteGuard('label', selected.name, refs!, styles.length, replacementId || undefined)
    : null;

  const create = (): void => {
    const fallbackText = project.styleLibrary.textStyles[0];
    if (!fallbackText) {
      setMessage('Cannot create: the drawing has no text styles.');
      return;
    }
    const id = nextSurveyTableId('point-label-custom', styles.map((style) => style.id));
    const name = nextCopyName('New Label Style', styles.map((style) => style.name)).replace('Copy of ', '');
    const ok = onSurveyCommand({
      key: 'SURVEY_STYLE_TABLE',
      table: 'label',
      op: 'create',
      style: {
        id,
        name,
        components: { pointNumber: true },
        componentOrder: ['pointNumber'],
        separator: ' ',
        elevationDecimals: 3,
        textStyleId: fallbackText.id,
        offsetX: 0,
        offsetY: 0,
        visible: true,
      },
    });
    if (ok) {
      setSelectedId(id);
      setDraft(null);
      setMessage(null);
    } else setMessage('Create rejected.');
  };

  const duplicate = (): void => {
    if (!selected) return;
    const id = nextSurveyTableId('point-label-custom', styles.map((style) => style.id));
    const ok = onSurveyCommand({
      key: 'SURVEY_STYLE_TABLE',
      table: 'label',
      op: 'duplicate',
      styleId: selected.id,
      newId: id,
      name: nextCopyName(selected.name, styles.map((style) => style.name)),
    });
    if (ok) {
      setSelectedId(id);
      setDraft(null);
      setMessage(null);
    } else setMessage('Duplicate rejected.');
  };

  const apply = (): void => {
    if (!selected || !draft || !active) return;
    const ok = onSurveyCommand({
      key: 'SURVEY_STYLE_TABLE',
      table: 'label',
      op: 'update',
      styleId: selected.id,
      patch: {
        name: active.name,
        components: active.components,
        componentOrder: active.componentOrder,
        separator: active.separator,
        elevationDecimals: active.elevationDecimals,
        textStyleId: active.textStyleId,
        offsetX: active.offsetX,
        offsetY: active.offsetY,
        rotationDeg: active.rotationDeg,
        visible: active.visible,
        description: active.description,
      },
    });
    if (ok) {
      setDraft(null);
      setMessage(null);
    } else setMessage('Apply rejected: check the name, text style, and decimals (0-4).');
  };

  const rename = (): void => {
    if (!selected || typeof draft?.name !== 'string') {
      setMessage('Rename: edit the name field first.');
      return;
    }
    const name = draft.name.trim();
    if (!name || isSurveyNameTaken(styles, name, selected.id)) {
      setMessage('Rename rejected: name is empty or already taken.');
      return;
    }
    const ok = onSurveyCommand({
      key: 'SURVEY_STYLE_TABLE',
      table: 'label',
      op: 'rename',
      styleId: selected.id,
      name,
    });
    if (ok) {
      setDraft(null);
      setMessage(null);
    } else setMessage('Rename rejected.');
  };

  const remove = (): void => {
    if (!selected || !refs) return;
    const replacement = replacementId || undefined;
    if (refs.points + refs.groups > 0 && !replacement) {
      setMessage(guard?.message ?? 'Delete blocked: style is referenced.');
      return;
    }
    const ok = onSurveyCommand({
      key: 'SURVEY_STYLE_TABLE',
      table: 'label',
      op: 'delete',
      styleId: selected.id,
      replacementId: replacement,
    });
    if (ok) {
      if (replacement && refs.catalogDefinitions > 0) onCatalogRewire('label', selected.id, replacement);
      setDraft(null);
      setReplacementId('');
      setMessage(replacement ? `Deleted; ${refs.points + refs.groups} reference(s) rewired.` : 'Deleted.');
    } else setMessage('Delete rejected.');
  };

  const set = (patch: Partial<CadPointLabelStyle>): void =>
    setDraft((current) => ({ ...(current ?? {}), ...patch }));

  const toggleComponent = (component: CadPointLabelComponent, enabled: boolean): void => {
    if (!active) return;
    const components = { ...active.components, [component]: enabled || undefined };
    if (!enabled) delete components[component];
    let order = active.componentOrder.filter((entry) => entry !== component);
    if (enabled && !order.includes(component)) order = [...order, component];
    // Dropping a component removes it from the order; enabling appends last.
    order = order.filter((entry) => components[entry] === true);
    set({ components, componentOrder: order });
  };

  const moveComponent = (component: CadPointLabelComponent, direction: -1 | 1): void => {
    if (!active) return;
    const order = [...active.componentOrder];
    const index = order.indexOf(component);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= order.length) return;
    [order[index], order[swapWith]] = [order[swapWith]!, order[index]!];
    set({ componentOrder: order });
  };

  return (
    <ManagerShell label="Point label style manager" title="Point Label Styles" onClose={onClose}>
      <div className="grid gap-2">
        <input
          aria-label="Filter label styles"
          className={inputClass}
          placeholder="Filter label styles…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="flex gap-1">
          <button type="button" className={buttonClass} onClick={create}>New</button>
          <button type="button" className={buttonClass} disabled={!selected} onClick={duplicate}>Duplicate</button>
          <button type="button" className={buttonClass} disabled={!selected || !draft} onClick={apply}>Apply</button>
          <button type="button" className={buttonClass} disabled={!selected} onClick={rename}>Rename</button>
          <button type="button" className={buttonClass} disabled={!selected} onClick={remove}>Delete</button>
          {draft ? (
            <button type="button" className={buttonClass} onClick={() => setDraft(null)}>Revert</button>
          ) : null}
        </div>
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <div className="grid max-h-64 content-start gap-0.5 overflow-auto" role="listbox" aria-label="Label styles">
            {visible.map((style) => (
              <button
                key={style.id}
                type="button"
                role="option"
                aria-selected={style.id === selected?.id}
                className={`rounded px-1.5 py-1 text-left text-[11px] hover:bg-slate-800 ${style.id === selected?.id ? 'bg-slate-800' : ''}`}
                onClick={() => {
                  setSelectedId(style.id);
                  setDraft(null);
                  setReplacementId('');
                  setMessage(null);
                }}
              >
                {style.name}
              </button>
            ))}
            {visible.length === 0 ? <span className="text-[11px] text-slate-500">No styles match.</span> : null}
          </div>
          {active ? (
            <div className="grid content-start gap-1.5">
              <div className="flex items-center gap-2 rounded border border-slate-700 bg-slate-950 px-1.5 py-1">
                <LabelStylePreview style={active} />
                <span className="ml-auto text-[10px] text-slate-500">ex. 1001 / IP / 123.456</span>
              </div>
              <Field label="Name">
                <input className={inputClass} value={active.name} onChange={(event) => set({ name: event.target.value })} />
              </Field>
              <div className="grid gap-0.5">
                <span className="text-[11px] text-slate-400">Components (order matters)</span>
                {COMPONENTS.map(({ id, label }) => {
                  const enabled = active.components[id] === true;
                  return (
                    <div key={id} className="flex items-center gap-1 text-[11px]">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => toggleComponent(id, event.target.checked)}
                      />
                      <span className="flex-1">{label}</span>
                      <button type="button" className={buttonClass} disabled={!enabled} onClick={() => moveComponent(id, -1)} title="Move up">↑</button>
                      <button type="button" className={buttonClass} disabled={!enabled} onClick={() => moveComponent(id, 1)} title="Move down">↓</button>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Field label="Separator">
                  <input className={inputClass} value={active.separator} onChange={(event) => set({ separator: event.target.value })} />
                </Field>
                <Field label="Elevation decimals (0-4)">
                  <input
                    className={inputClass}
                    value={active.elevationDecimals}
                    onChange={(event) => set({ elevationDecimals: Number(event.target.value) })}
                  />
                </Field>
              </div>
              <Field label="Text style">
                <select
                  className={inputClass}
                  value={active.textStyleId}
                  onChange={(event) => set({ textStyleId: event.target.value })}
                >
                  {project.styleLibrary.textStyles.map((style) => (
                    <option key={style.id} value={style.id}>{style.name}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-1.5">
                <Field label="Offset X">
                  <input className={inputClass} value={active.offsetX} onChange={(event) => set({ offsetX: Number(event.target.value) })} />
                </Field>
                <Field label="Offset Y">
                  <input className={inputClass} value={active.offsetY} onChange={(event) => set({ offsetY: Number(event.target.value) })} />
                </Field>
                <Field label="Rotation">
                  <input
                    className={inputClass}
                    value={active.rotationDeg ?? 0}
                    onChange={(event) => set({ rotationDeg: Number(event.target.value) })}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                <input type="checkbox" checked={active.visible} onChange={(event) => set({ visible: event.target.checked })} />
                Visible
              </label>
              <span className="text-[11px] text-slate-400">
                {refs!.points + refs!.groups > 0
                  ? `Used by ${refs!.points} point(s), ${refs!.groups} group(s)${refs!.catalogDefinitions > 0 ? `, ${refs!.catalogDefinitions} catalog def(s)` : ''}`
                  : 'Unused'}
              </span>
              {guard?.blocked ? (
                <div className="grid gap-1 rounded border border-amber-700 bg-amber-950/40 p-1.5">
                  <span className="text-[11px] text-amber-200">{guard.message}</span>
                  <Field label="Replacement style">
                    <select className={inputClass} value={replacementId} onChange={(event) => setReplacementId(event.target.value)}>
                      <option value="">Pick a replacement…</option>
                      {styles.filter((style) => style.id !== selected!.id).map((style) => (
                        <option key={style.id} value={style.id}>{style.name}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {message ? <p role="status" className="text-[11px] text-amber-200">{message}</p> : null}
      </div>
    </ManagerShell>
  );
};
