// Phase 18O — Dimension Style manager. Live preview drives off the real
// dimension geometry resolver; delete is blocked while referenced.

import React, { useEffect, useMemo, useState } from 'react';
import type { CadDimensionStyle, CadTextStyle } from '../../engine/cad/cadTypes';
import type {
  CadAnnotationArrowDefinition,
  CadAnnotationOpResult,
  CadAnnotationUiOp,
  CadDimensionStylePatch,
} from './cadAnnotationUiTypes';
import { DimensionStylePreview } from './cadAnnotationStylePreview';
import { StyleNumberField, StyleSelectField, StyleTextField } from './cadAnnotationStyleEditor';

interface CadDimensionStyleManagerProps {
  styles: CadDimensionStyle[];
  textStyles: CadTextStyle[];
  arrowDefinitions: CadAnnotationArrowDefinition[];
  referenceCounts: Record<string, number>;
  runOp: (_op: CadAnnotationUiOp) => CadAnnotationOpResult;
  disabled?: boolean;
}

const ARROW_SIZE_MODES = [
  { id: 'model', name: 'Model' },
  { id: 'paper', name: 'Paper' },
];

export const CadDimensionStyleManager: React.FC<CadDimensionStyleManagerProps> = ({
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
  const patch = (value: CadDimensionStylePatch): void => {
    if (selected) run({ kind: 'dimension-style-update', styleId: selected.id, patch: value });
  };

  return (
    <div className="cad-shell-table-wrap" data-cad-dimension-style-manager>
      {notice ? <div className="cad-shell-notice" role="status">{notice}</div> : null}
      <div className="cad-shell-dialog-row">
        <input
          aria-label="New dimension style name"
          placeholder="New dimension style name"
          value={newName}
          disabled={disabled}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button
          type="button"
          disabled={disabled || newName.trim().length === 0}
          onClick={() => {
            run({ kind: 'dimension-style-create', name: newName });
            setNewName('');
          }}
        >
          New
        </button>
        <button
          type="button"
          disabled={disabled || selected == null}
          onClick={() => selected && run({ kind: 'dimension-style-duplicate', styleId: selected.id })}
        >
          Duplicate
        </button>
      </div>
      <table className="cad-shell-table" data-cad-dimension-style-table>
        <thead>
          <tr>
            <th>Preview</th><th>Name</th><th>Text style</th><th>Arrow</th><th>Arrow size</th>
            <th>Precision</th><th>Gap</th><th>Ext offset</th><th>Overshoot</th><th>Used</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {definitions.map((style) => {
            const used = referenceCounts[style.id] ?? 0;
            return (
              <tr
                key={style.id}
                data-cad-dimension-style={style.id}
                data-selected={style.id === selectedId ? 'true' : undefined}
                onClick={() => setSelectedId(style.id)}
              >
                <td><DimensionStylePreview style={style} /></td>
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
                          run({ kind: 'dimension-style-rename', styleId: style.id, name: renameValue });
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
                <td>{style.decimalPrecision}</td>
                <td>{style.textGap}</td>
                <td>{style.extensionOffset}</td>
                <td>{style.extensionOvershoot}</td>
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
                    title={used > 0 ? `Referenced by ${used} dimensions — reassign first` : `Delete ${style.name}`}
                    onClick={() => run({ kind: 'dimension-style-delete', styleId: style.id })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {definitions.length === 0 ? <p className="cad-shell-empty">No dimension styles in this drawing.</p> : null}
      {selected ? (
        <div className="cad-shell-props-group" data-cad-dimension-style-editor={selected.id}>
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
          <StyleSelectField
            label="Arrow size mode"
            value={selected.arrowSizeMode ?? 'model'}
            options={ARROW_SIZE_MODES}
            disabled={disabled}
            onCommit={(mode) => patch({ arrowSizeMode: mode as CadDimensionStyle['arrowSizeMode'] })}
          />
          <StyleNumberField
            label="Decimal precision"
            value={selected.decimalPrecision}
            min={0}
            disabled={disabled}
            onCommit={(decimalPrecision) => patch({ decimalPrecision: Math.round(decimalPrecision) })}
          />
          <StyleNumberField
            label="Text gap"
            value={selected.textGap}
            min={0}
            disabled={disabled}
            onCommit={(textGap) => patch({ textGap })}
          />
          <StyleNumberField
            label="Extension offset"
            value={selected.extensionOffset}
            min={0}
            disabled={disabled}
            onCommit={(extensionOffset) => patch({ extensionOffset })}
          />
          <StyleNumberField
            label="Extension overshoot"
            value={selected.extensionOvershoot}
            min={0}
            disabled={disabled}
            onCommit={(extensionOvershoot) => patch({ extensionOvershoot })}
          />
          <StyleTextField
            label="Prefix"
            value={selected.prefix ?? ''}
            disabled={disabled}
            onCommit={(prefix) => patch({ prefix })}
          />
          <StyleTextField
            label="Suffix"
            value={selected.suffix ?? ''}
            disabled={disabled}
            onCommit={(suffix) => patch({ suffix })}
          />
        </div>
      ) : null}
    </div>
  );
};
