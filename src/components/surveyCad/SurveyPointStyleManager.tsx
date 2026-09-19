import React, { useMemo, useState } from 'react';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import {
  countPointStyleRefs, describeStyleDeleteGuard, isSurveyNameTaken, nextSurveyTableId,
} from '../../engine/cad/cadSurveyDisplayRefs';
import { backfillCadPointStyles } from '../../engine/cad/cadPointStyles';
import type { CadPointStyle, CadPointSymbolShape, CadProject } from '../../engine/cad/cadTypes';
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';
import { Field, ManagerShell, PointMarkerPreview } from './surveyManagerShared.tsx';
import { BlockGeometryPreview } from '../../cad-app/blocks/cadBlockPreview';
import { buttonClass, inputClass, nextCopyName } from './surveyManagerShared';

interface SurveyPointStyleManagerProps {
  project: CadProject;
  catalog: FeatureCodeCatalog;
  onSurveyCommand: (_command: CadCommand) => boolean;
  onCatalogRewire: (_table: 'point' | 'label', _fromId: string, _toId: string) => void;
  initialSelectedId?: string;
  onClose: () => void;
}

/**
 * Phase 18D point-style table manager. Explicit Apply per edit (no dirty on
 * search/filter); delete is blocked while referenced unless a replacement
 * is picked (points + groups rewire undoably; catalog defs rewire too).
 */
export const SurveyPointStyleManager: React.FC<SurveyPointStyleManagerProps> = ({
  project,
  catalog,
  onSurveyCommand,
  onCatalogRewire,
  initialSelectedId,
  onClose,
}) => {
  const styles = useMemo(() => backfillCadPointStyles(project.pointStyles), [project.pointStyles]);
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? styles[0]?.id ?? '');
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const selected = styles.find((style) => style.id === selectedId) ?? styles[0] ?? null;
  const [draft, setDraft] = useState<Partial<CadPointStyle> | null>(null);
  const active: CadPointStyle | null = selected
    ? { ...selected, ...(draft ?? {}) }
    : null;
  const symbolOf = (markerSymbolId: string): { shape: CadPointSymbolShape | undefined; radius: number } => {
    const symbol = project.styleLibrary.pointSymbols.find((entry) => entry.id === markerSymbolId);
    return { shape: symbol?.shape, radius: symbol?.radius ?? 1.8 };
  };

  const visible = styles.filter((style) =>
    style.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const refs = selected ? countPointStyleRefs(project, catalog, selected.id) : null;
  const guard = selected
    ? describeStyleDeleteGuard('point', selected.name, refs!, styles.length, replacementId || undefined)
    : null;

  const create = (): void => {
    const fallbackSymbol = project.styleLibrary.pointSymbols[0];
    if (!fallbackSymbol) {
      setMessage('Cannot create: the drawing has no point symbols.');
      return;
    }
    const id = nextSurveyTableId('point-style-custom', styles.map((style) => style.id));
    const base = 'New Point Style';
    const name = nextCopyName(base, styles.map((style) => style.name)).replace('Copy of ', '');
    const ok = onSurveyCommand({
      key: 'SURVEY_STYLE_TABLE',
      table: 'point',
      op: 'create',
      style: { id, name, markerSymbolId: fallbackSymbol.id, displayMarker: true },
    });
    if (ok) {
      setSelectedId(id);
      setDraft(null);
      setMessage(null);
    } else setMessage('Create rejected: name or symbol invalid.');
  };

  const duplicate = (): void => {
    if (!selected) return;
    const id = nextSurveyTableId('point-style-custom', styles.map((style) => style.id));
    const ok = onSurveyCommand({
      key: 'SURVEY_STYLE_TABLE',
      table: 'point',
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
    if (!selected || !draft) return;
    const ok = onSurveyCommand({
      key: 'SURVEY_STYLE_TABLE',
      table: 'point',
      op: 'update',
      styleId: selected.id,
      patch: draft,
    });
    if (ok) {
      setDraft(null);
      setMessage(null);
    } else setMessage('Apply rejected: check the name, scale, and symbol.');
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
      table: 'point',
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
      table: 'point',
      op: 'delete',
      styleId: selected.id,
      replacementId: replacement,
    });
    if (ok) {
      if (replacement && refs.catalogDefinitions > 0) onCatalogRewire('point', selected.id, replacement);
      setDraft(null);
      setReplacementId('');
      setMessage(
        replacement
          ? `Deleted; ${refs.points + refs.groups} reference(s) rewired${refs.catalogDefinitions > 0 ? ' (catalog included)' : ''}.`
          : 'Deleted.',
      );
    } else setMessage('Delete rejected.');
  };

  const set = (patch: Partial<CadPointStyle>): void =>
    setDraft((current) => ({ ...(current ?? {}), ...patch }));

  // Phase 18N — block-marker picker. markerBlockDefinitionId wins over the
  // legacy symbol when set (engine validation); clearing restores symbol
  // rendering. Seeding stays in the Block Manager (hint below).
  const blockDefinitions = useMemo(() => [...(project.blockDefinitions ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name)), [project.blockDefinitions]);
  const markerBlock = active?.markerBlockDefinitionId
    ? blockDefinitions.find((entry) => entry.id === active.markerBlockDefinitionId) ?? null
    : null;

  return (
    <ManagerShell label="Point style manager" title="Point Styles" onClose={onClose}>
      <div className="grid gap-2">
        <input
          aria-label="Filter styles"
          className={inputClass}
          placeholder="Filter styles…"
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
          <div className="grid max-h-64 content-start gap-0.5 overflow-auto" role="listbox" aria-label="Point styles">
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
              <div className="flex items-center gap-2">
                {markerBlock ? (
                  <BlockGeometryPreview definition={markerBlock} sizePx={40} label={`Marker preview of ${markerBlock.name}`} />
                ) : (
                  <PointMarkerPreview
                    shape={symbolOf(active.markerSymbolId).shape}
                    radius={symbolOf(active.markerSymbolId).radius}
                    scale={active.markerScale}
                    rotationDeg={active.rotationDeg}
                    displayMarker={active.displayMarker}
                  />
                )}
                <span className="text-[11px] text-slate-400">
                  {refs!.points + refs!.groups > 0
                    ? `Used by ${refs!.points} point(s), ${refs!.groups} group(s)${refs!.catalogDefinitions > 0 ? `, ${refs!.catalogDefinitions} catalog def(s)` : ''}`
                    : 'Unused'}
                </span>
              </div>
              <Field label="Name">
                <input
                  className={inputClass}
                  value={active.name}
                  onChange={(event) => set({ name: event.target.value })}
                />
              </Field>
              <Field label="Marker symbol">
                <select
                  className={inputClass}
                  value={active.markerSymbolId}
                  onChange={(event) => set({ markerSymbolId: event.target.value })}
                >
                  {project.styleLibrary.pointSymbols.map((symbol) => (
                    <option key={symbol.id} value={symbol.id}>{symbol.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Block marker (optional)">
                <select
                  className={inputClass}
                  aria-label="Block marker"
                  value={active.markerBlockDefinitionId ?? ''}
                  onChange={(event) => set({
                    markerBlockDefinitionId: event.target.value === '' ? undefined : event.target.value,
                  })}
                >
                  <option value="">Legacy symbol (no block)</option>
                  {blockDefinitions.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </Field>
              {active.markerBlockDefinitionId && !markerBlock ? (
                <span className="text-[11px] text-amber-200">Unknown block — pick a definition or clear to restore the symbol.</span>
              ) : null}
              {blockDefinitions.length === 0 ? (
                <span className="text-[11px] text-slate-400">No blocks yet — open the Block Manager → Survey Symbols to seed the library.</span>
              ) : null}
              <div className="grid grid-cols-2 gap-1.5">
                <Field label="Scale">
                  <input
                    className={inputClass}
                    value={active.markerScale ?? 1}
                    onChange={(event) => set({ markerScale: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Rotation (deg)">
                  <input
                    className={inputClass}
                    value={active.rotationDeg ?? 0}
                    onChange={(event) => set({ rotationDeg: Number(event.target.value) })}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={active.displayMarker}
                  onChange={(event) => set({ displayMarker: event.target.checked })}
                />
                Display marker
              </label>
              <Field label="Description">
                <input
                  className={inputClass}
                  value={active.description ?? ''}
                  onChange={(event) => set({ description: event.target.value || undefined })}
                />
              </Field>
              {guard?.blocked ? (
                <div className="grid gap-1 rounded border border-amber-700 bg-amber-950/40 p-1.5">
                  <span className="text-[11px] text-amber-200">{guard.message}</span>
                  <Field label="Replacement style">
                    <select
                      className={inputClass}
                      value={replacementId}
                      onChange={(event) => setReplacementId(event.target.value)}
                    >
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
