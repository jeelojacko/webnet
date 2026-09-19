// Phase 18O — Leader Style manager (text style / arrowhead / size / landing / gap).

import React, { useEffect, useMemo, useState } from 'react';
import type { CadLeaderStyle, CadTextStyle } from '../../engine/cad/cadTypes';
import type {
  CadAnnotationArrowDefinition,
  CadAnnotationOpResult,
  CadAnnotationUiOp,
  CadLeaderStylePatch,
} from './cadAnnotationUiTypes';
import { LeaderStylePreview } from './cadAnnotationStylePreview';
import { StyleNumberField, StyleSelectField } from './cadAnnotationStyleEditor';

interface CadLeaderStyleManagerProps {
  styles: CadLeaderStyle[];
  textStyles: CadTextStyle[];
  arrowDefinitions: CadAnnotationArrowDefinition[];
  referenceCounts: Record<string, number>;
  runOp: (_op: CadAnnotationUiOp) => CadAnnotationOpResult;
  disabled?: boolean;
}

export const CadLeaderStyleManager: React.FC<CadLeaderStyleManagerProps> = ({
  styles,
  textStyles,
  arrowDefinitions,
  referenceCounts,
  runOp,
  disabled = false,
}) => {
  const definitions = useMemo(
    () => [...styles].sort((a, b) => a.name.localeCompare(b.name)),
    [styles],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newName, setNewName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId != null && definitions.some((style) => style.id === selectedId)) return;
    setSelectedId(definitions[0]?.id ?? null);
  }, [definitions, selectedId]);

  const selected = definitions.find((style) => style.id === selectedId) ?? null;
  const run = (op: CadAnnotationUiOp): void => {
    const outcome = runOp(op);
    setNotice(outcome.applied ? null : (outcome.reason ?? 'Rejected.'));
  };
  const patch = (value: CadLeaderStylePatch): void => {
    if (selected) run({ kind: 'leader-style-update', styleId: selected.id, patch: value });
  };

  return (
    <div className="cad-shell-table-wrap" data-cad-leader-style-manager>
      {notice ? <div className="cad-shell-notice" role="status">{notice}</div> : null}
      <div className="cad-shell-dialog-row">
        <input
          aria-label="New leader style name"
          placeholder="New leader style name"
          value={newName}
          disabled={disabled}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button
          type="button"
          disabled={disabled || newName.trim().length === 0}
          onClick={() => {
            run({ kind: 'leader-style-create', name: newName });
            setNewName('');
          }}
        >
          New
        </button>
        <button
          type="button"
          disabled={disabled || selected == null}
          onClick={() => selected && run({ kind: 'leader-style-duplicate', styleId: selected.id })}
        >
          Duplicate
        </button>
      </div>
      <table className="cad-shell-table" data-cad-leader-style-table>
        <thead>
          <tr>
            <th>Preview</th><th>Name</th><th>Text style</th><th>Arrow</th>
            <th>Arrow size</th><th>Landing</th><th>Gap</th><th>Used</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {definitions.map((style) => {
            const used = referenceCounts[style.id] ?? 0;
            return (
              <tr
                key={style.id}
                data-cad-leader-style={style.id}
                data-selected={style.id === selectedId ? 'true' : undefined}
                onClick={() => setSelectedId(style.id)}
              >
                <td><LeaderStylePreview style={style} /></td>
                <td>
                  {renameId === style.id ? (
                    <input
                      aria-label={`Rename ${style.name}`}
                      value={renameValue}
                      autoFocus
                      disabled={disabled}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          run({ kind: 'leader-style-rename', styleId: style.id, name: renameValue });
                          setRenameId(null);
                        }
                        if (event.key === 'Escape') setRenameId(null);
                      }}
                    />
                  ) : style.name}
                </td>
                <td>{style.textStyleId}</td>
                <td>{arrowDefinitions.find((entry) => entry.id === style.arrowBlockDefinitionId)?.name ?? '—'}</td>
                <td>{style.arrowSize}</td>
                <td>{style.landingLength}</td>
                <td>{style.textGap}</td>
                <td>{used}</td>
                <td>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => { setRenameId(style.id); setRenameValue(style.name); }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={disabled || used > 0}
                    title={used > 0 ? `Referenced by ${used} leaders — reassign first` : `Delete ${style.name}`}
                    onClick={() => run({ kind: 'leader-style-delete', styleId: style.id })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {definitions.length === 0 ? <p className="cad-shell-empty">No leader styles in this drawing.</p> : null}
      {selected ? (
        <div className="cad-shell-props-group" data-cad-leader-style-editor={selected.id}>
          <h4>Edit “{selected.name}”</h4>
          <StyleSelectField
            label="Text style"
            value={selected.textStyleId}
            options={textStyles.map((style) => ({ id: style.id, name: style.name }))}
            disabled={disabled}
            onCommit={(textStyleId) => patch({ textStyleId })}
          />
          <StyleSelectField
            label="Arrowhead"
            value={selected.arrowBlockDefinitionId}
            options={arrowDefinitions}
            disabled={disabled}
            onCommit={(arrowBlockDefinitionId) => patch({ arrowBlockDefinitionId })}
          />
          <StyleNumberField
            label="Arrow size"
            value={selected.arrowSize}
            min={0.0001}
            disabled={disabled}
            onCommit={(arrowSize) => patch({ arrowSize })}
          />
          <StyleNumberField
            label="Landing length"
            value={selected.landingLength}
            min={0}
            disabled={disabled}
            onCommit={(landingLength) => patch({ landingLength })}
          />
          <StyleNumberField
            label="Text gap"
            value={selected.textGap}
            min={0}
            disabled={disabled}
            onCommit={(textGap) => patch({ textGap })}
          />
        </div>
      ) : null}
    </div>
  );
};
