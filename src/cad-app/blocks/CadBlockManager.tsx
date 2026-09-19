// Phase 18N — Block Manager palette: definitions table + survey-symbol
// library view + insert panel. Table data derives from the snapshot
// project (no duplicate library truth); previews reuse BlockGeometryPreview
// (same expansion helper as the viewport overlay). Seeding happens only
// here: opening the Symbols tab runs the lazy-seed gate once per mount.

import React, { useEffect, useMemo, useState } from 'react';
import {
  SURVEY_SYMBOL_CATEGORIES,
  SURVEY_SYMBOL_SEEDS,
  isSurveySymbolSeedId,
  type SurveySymbolCategory,
} from '../../engine/cad/cadSurveySymbolLibrary';
import type { CadBlockDefinition } from '../../engine/cad/cadTypes';
import type { CadBlockSnapshot } from '../shell/cadShellTypes';
import { BlockGeometryPreview } from './cadBlockPreview';
import type { CadBlockUiOp } from './cadBlockUiCommands';

export interface CadBlockManagerActions {
  runBlockOp: (_op: CadBlockUiOp) => { applied: boolean; reason?: string };
  ensureSymbols: () => number;
  selectEntities: (_entityIds: string[]) => void;
  armInsertPick: (_definitionId: string, _scale: number, _rotationDeg: number, _repeat: boolean) => void;
  insertPickArmed: { definitionId: string } | null;
  cancelInsertPick: () => void;
}

interface CadBlockManagerProps {
  blocks: CadBlockSnapshot;
  selectedEntityIds: readonly string[];
  actions: CadBlockManagerActions;
  initialTab?: 'blocks' | 'symbols' | 'insert';
  onClose: () => void;
}

type ManagerTab = 'blocks' | 'symbols' | 'insert';

export const CadBlockManager: React.FC<CadBlockManagerProps> = ({
  blocks,
  selectedEntityIds,
  actions,
  initialTab = 'blocks',
  onClose,
}) => {
  const [tab, setTab] = useState<ManagerTab>(initialTab);
  const [notice, setNotice] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  // Lazy-seed gate: opening Symbols pulls the library in (never at new/open).
  useEffect(() => {
    if (tab !== 'symbols') return;
    const added = actions.ensureSymbols();
    if (added > 0) setNotice(`Seeded ${added} survey symbols into this drawing.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const run = (op: CadBlockUiOp): void => {
    const outcome = actions.runBlockOp(op);
    setNotice(outcome.applied ? null : (outcome.reason ?? 'Rejected.'));
  };

  const definitions = useMemo(() => [...blocks.definitions].sort((a, b) =>
    a.name.localeCompare(b.name)), [blocks.definitions]);
  const referenceCounts = blocks.referenceCounts;
  const markerUseCounts = blocks.markerUseCounts;

  return (
    <div className="cad-shell-dialog" role="dialog" aria-label="Block Manager" data-cad-block-manager>
      <div className="cad-shell-dialog-head">
        <strong>Block Manager</strong>
        <div role="tablist" aria-label="Block manager views">
          {(['blocks', 'symbols', 'insert'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={tab === entry}
              className={`cad-shell-tab${tab === entry ? ' active' : ''}`}
              onClick={() => { setTab(entry); setNotice(null); }}
            >
              {entry === 'blocks' ? `Definitions (${definitions.length})` : entry === 'symbols' ? 'Survey Symbols' : 'Insert'}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="Close Block Manager">✕</button>
      </div>
      {notice ? <div className="cad-shell-notice" role="status">{notice}</div> : null}
      {tab === 'blocks' ? (
        <BlockDefinitionsTab
          blocks={blocks}
          definitions={definitions}
          referenceCounts={referenceCounts}
          markerUseCounts={markerUseCounts}
          selectedEntityIds={selectedEntityIds}
          renameId={renameId}
          renameValue={renameValue}
          newName={newName}
          newDescription={newDescription}
          onRenameId={setRenameId}
          onRenameValue={setRenameValue}
          onNewName={setNewName}
          onNewDescription={setNewDescription}
          onRun={run}
          onSelect={actions.selectEntities}
          onInsertTab={() => setTab('insert')}
        />
      ) : null}
      {tab === 'symbols' ? <SurveySymbolsTab blocks={blocks} onRun={run} /> : null}
      {tab === 'insert' ? (
        <BlockInsertTab
          blocks={blocks}
          actions={actions}
          onRun={run}
        />
      ) : null}
    </div>
  );
};

const BlockDefinitionsTab: React.FC<{
  blocks: CadBlockSnapshot;
  definitions: CadBlockDefinition[];
  referenceCounts: Record<string, number>;
  markerUseCounts: Record<string, number>;
  selectedEntityIds: readonly string[];
  renameId: string | null;
  renameValue: string;
  newName: string;
  newDescription: string;
  onRenameId: (_id: string | null) => void;
  onRenameValue: (_value: string) => void;
  onNewName: (_value: string) => void;
  onNewDescription: (_value: string) => void;
  onRun: (_op: CadBlockUiOp) => void;
  onSelect: (_ids: string[]) => void;
  onInsertTab: () => void;
}> = (props) => {
  const { definitions = [], blocks } = props;
  return (
    <div className="cad-shell-table-wrap">
      <div className="cad-shell-dialog-row">
        <input
          aria-label="New block name"
          placeholder="Block name (from selection)"
          value={props.newName}
          onChange={(event) => props.onNewName(event.target.value)}
        />
        <input
          aria-label="New block description"
          placeholder="Description (optional)"
          value={props.newDescription}
          onChange={(event) => props.onNewDescription(event.target.value)}
        />
        <button
          type="button"
          disabled={props.selectedEntityIds.length === 0}
          title={props.selectedEntityIds.length === 0 ? 'Select linework in the viewport first' : `Create from ${props.selectedEntityIds.length} selected`}
          onClick={() => props.onRun({ kind: 'create', name: props.newName, description: props.newDescription, fromEntityIds: [...props.selectedEntityIds] })}
        >
          New from selection
        </button>
      </div>
      <table className="cad-shell-table" data-cad-block-table>
        <thead>
          <tr><th>Preview</th><th>Name</th><th>Entities</th><th>References</th><th>Point styles</th><th>Description</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {definitions.map((definition) => (
            <tr key={definition.id} data-cad-block-definition={definition.id}>
              <td><BlockGeometryPreview definition={definition} sizePx={40} /></td>
              <td>
                {props.renameId === definition.id ? (
                  <input
                    aria-label={`Rename ${definition.name}`}
                    value={props.renameValue}
                    autoFocus
                    onChange={(event) => props.onRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        props.onRun({ kind: 'rename', definitionId: definition.id, name: props.renameValue });
                        props.onRenameId(null);
                      } else if (event.key === 'Escape') props.onRenameId(null);
                    }}
                  />
                ) : (
                  <span title={isSurveySymbolSeedId(definition.id) ? 'Seeded survey symbol' : 'User block'}>{definition.name}</span>
                )}
              </td>
              <td>{definition.entities.length}</td>
              <td>{props.referenceCounts[definition.id] ?? 0}</td>
              <td>{props.markerUseCounts[definition.id] ?? 0}</td>
              <td>{definition.description ?? ''}</td>
              <td>
                <button type="button" title={`Insert ${definition.name}`} onClick={() => { props.onInsertTab(); }}>Insert</button>
                <button type="button" title={`Duplicate ${definition.name}`} onClick={() => props.onRun({ kind: 'duplicate', definitionId: definition.id })}>Duplicate</button>
                {props.renameId === definition.id ? null : (
                  <button type="button" title={`Rename ${definition.name}`} onClick={() => { props.onRenameId(definition.id); props.onRenameValue(definition.name); }}>Rename</button>
                )}
                <button
                  type="button"
                  title={`Redefine ${definition.name} from the current selection`}
                  disabled={props.selectedEntityIds.length === 0}
                  onClick={() => {
                    if (window.confirm(`Redefine “${definition.name}” from ${props.selectedEntityIds.length} selected entities? All references update.`)) {
                      props.onRun({ kind: 'redefine', definitionId: definition.id, fromEntityIds: [...props.selectedEntityIds] });
                    }
                  }}
                >
                  Redefine
                </button>
                <button
                  type="button"
                  title={`Delete ${definition.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete block “${definition.name}”?`)) {
                      props.onRun({ kind: 'delete', definitionId: definition.id });
                    }
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {definitions.length === 0 ? (
        <p className="cad-shell-empty">No blocks — select linework and use New from selection, or open Survey Symbols to seed the library.</p>
      ) : null}
      {blocks.selectedBlockReferenceIds.length > 0 ? (
        <div className="cad-shell-dialog-row">
          <button
            type="button"
            title="Explode the selected block references"
            onClick={() => {
              const count = blocks.selectedBlockReferenceIds.length;
              if (!window.confirm(`Explode ${count} reference${count === 1 ? '' : 's'} into plain entities?`)) return;
              blocks.selectedBlockReferenceIds.forEach((entityId) => props.onRun({ kind: 'explode', entityId }));
            }}
          >
            Explode selected
          </button>
        </div>
      ) : null}
      <div className="cad-shell-dialog-row cad-shell-empty">Tip: click a reference in the viewport to select it; rotation and scale edit in Properties.</div>
    </div>
  );
};

const SurveySymbolsTab: React.FC<{
  blocks: CadBlockSnapshot;
  onRun: (_op: CadBlockUiOp) => void;
}> = ({ blocks, onRun }) => {
  const [category, setCategory] = useState<'all' | SurveySymbolCategory>('all');
  const [query, setQuery] = useState('');
  const catalog = useMemo(() => new Map(SURVEY_SYMBOL_SEEDS.map((seedDef) => [seedDef.id, seedDef])), []);
  const symbols = useMemo(() => blocks.definitions
    .filter((definition) => isSurveySymbolSeedId(definition.id))
    .sort((a, b) => a.name.localeCompare(b.name)), [blocks.definitions]);
  const visible = symbols.filter((definition) => {
    const meta = catalog.get(definition.id);
    if (category !== 'all' && meta?.category !== category) return false;
    const token = query.trim().toLowerCase();
    if (token.length === 0) return true;
    const haystack = `${definition.name} ${(definition.description ?? '')} ${(meta?.tags ?? []).join(' ')}`.toLowerCase();
    return token.split(/\s+/).every((word) => haystack.includes(word));
  });
  return (
    <div className="cad-shell-table-wrap">
      <div className="cad-shell-dialog-row">
        <select aria-label="Symbol category" value={category} onChange={(event) => setCategory(event.target.value as 'all' | SurveySymbolCategory)}>
          <option value="all">All categories</option>
          {SURVEY_SYMBOL_CATEGORIES.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.label}</option>
          ))}
        </select>
        <input
          aria-label="Filter symbols"
          placeholder="Filter by name, tag, or description"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <table className="cad-shell-table" data-cad-symbol-table>
        <thead>
          <tr><th>Preview</th><th>Name</th><th>Description</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {visible.map((definition) => (
            <tr key={definition.id} data-cad-symbol={definition.id}>
              <td><BlockGeometryPreview definition={definition} sizePx={48} /></td>
              <td>{definition.name}</td>
              <td>{definition.description ?? ''}</td>
              <td>
                <button type="button" title={`Insert ${definition.name}`} onClick={() => onRun({ kind: 'insert', definitionId: definition.id, x: 0, y: 0 })}>Insert at origin</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {symbols.length === 0 ? <p className="cad-shell-empty">Seeding…</p> : null}
    </div>
  );
};

const BlockInsertTab: React.FC<{
  blocks: CadBlockSnapshot;
  actions: CadBlockManagerActions;
  onRun: (_op: CadBlockUiOp) => void;
}> = ({ blocks, actions, onRun }) => {
  const definitions = useMemo(() => [...blocks.definitions].sort((a, b) =>
    a.name.localeCompare(b.name)), [blocks.definitions]);
  const [definitionId, setDefinitionId] = useState(definitions[0]?.id ?? '');
  const [scale, setScale] = useState('1');
  const [rotation, setRotation] = useState('0');
  const [pointX, setPointX] = useState('0');
  const [pointY, setPointY] = useState('0');
  const [repeat, setRepeat] = useState(true);
  const activeId = definitions.some((entry) => entry.id === definitionId) ? definitionId : (definitions[0]?.id ?? '');
  const parsed = (): { scale: number; rotation: number; x: number; y: number } | null => {
    const values = [scale, rotation, pointX, pointY].map(Number);
    if (values.some((value) => !Number.isFinite(value))) return null;
    if ((values[0] ?? 0) <= 0) return null;
    return { scale: values[0]!, rotation: values[1]!, x: values[2]!, y: values[3]! };
  };
  const insertAt = (x: number, y: number): void => {
    const values = parsed();
    if (!values || !activeId) return;
    onRun({ kind: 'insert', definitionId: activeId, x, y, rotationDeg: values.rotation, scale: values.scale });
  };
  return (
    <div className="cad-shell-table-wrap" data-cad-block-insert>
      <div className="cad-shell-dialog-row">
        <label>Block
          <select aria-label="Insert block" value={activeId} onChange={(event) => setDefinitionId(event.target.value)}>
            {definitions.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
        </label>
        <label>Scale
          <input aria-label="Insert scale" value={scale} onChange={(event) => setScale(event.target.value)} inputMode="decimal" />
        </label>
        <label>Rotation
          <input aria-label="Insert rotation" value={rotation} onChange={(event) => setRotation(event.target.value)} inputMode="decimal" />
        </label>
        <label title="Stay armed after each pick so Esc ends the loop">
          <input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} /> Repeat
        </label>
      </div>
      <div className="cad-shell-dialog-row">
        <label>X <input aria-label="Insert X" value={pointX} onChange={(event) => setPointX(event.target.value)} inputMode="decimal" /></label>
        <label>Y <input aria-label="Insert Y" value={pointY} onChange={(event) => setPointY(event.target.value)} inputMode="decimal" /></label>
        <button
          type="button"
          title="Insert at the typed coordinates"
          disabled={parsed() == null || !activeId}
          onClick={() => {
            const values = parsed();
            if (values) insertAt(values.x, values.y);
          }}
        >
          Insert at XY
        </button>
        {actions.insertPickArmed ? (
          <button type="button" title="Stop picking (Esc)" onClick={actions.cancelInsertPick}>
            Picking… click Cancel or press Esc
          </button>
        ) : (
          <button
            type="button"
            title="Pick the insertion point in the viewport (repeat stays armed, Esc ends)"
            disabled={parsed() == null || !activeId}
            onClick={() => {
              const values = parsed();
              if (values && activeId) actions.armInsertPick(activeId, values.scale, values.rotation, repeat);
            }}
          >
            Pick point
          </button>
        )}
      </div>
      {actions.insertPickArmed ? (
        <p className="cad-shell-empty" data-cad-insert-pick-hint>
          Click empty canvas to place{repeat ? ' (repeat on — Esc ends)' : ''}. Scale {scale}, rotation {rotation}°.
        </p>
      ) : null}
      {definitions.length === 0 ? <p className="cad-shell-empty">No blocks yet — create one or seed Survey Symbols.</p> : null}
    </div>
  );
};
