// Phase 18O — Text Style manager (Toolspace Settings + Annotate ribbon).
// Table + inline editors; every mutation goes through one AnnotationOp so
// the workspace owns undo/history. Delete is blocked while referenced.

import React, { useEffect, useMemo, useState } from 'react';
import type { CadTextStyle } from '../../engine/cad/cadTypes';
import type { CadAnnotationOpResult, CadAnnotationUiOp, CadTextStylePatch } from './cadAnnotationUiTypes';
import { TextStylePreview } from './cadAnnotationStylePreview';
import { StyleNumberField, StyleSelectField, StyleTextField } from './cadAnnotationStyleEditor';

interface CadTextStyleManagerProps {
  styles: CadTextStyle[];
  referenceCounts: Record<string, number>;
  runOp: (_op: CadAnnotationUiOp) => CadAnnotationOpResult;
  disabled?: boolean;
}

const HEIGHT_MODES = [
  { id: 'legacy-screen', name: 'Legacy screen (px)' },
  { id: 'model', name: 'Model height' },
  { id: 'paper', name: 'Paper height (mm)' },
];

const FONT_WEIGHTS = [
  { id: 'normal', name: 'Normal' },
  { id: 'bold', name: 'Bold' },
];

const FONT_STYLES = [
  { id: 'normal', name: 'Normal' },
  { id: 'italic', name: 'Italic' },
];

/** Legacy styles have no heightMode; treat absent as legacy screen. */
const textStyleHeightMode = (style: CadTextStyle): 'legacy-screen' | 'model' | 'paper' =>
  style.heightMode ?? 'legacy-screen';

export const CadTextStyleManager: React.FC<CadTextStyleManagerProps> = ({
  styles,
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
  const patch = (value: CadTextStylePatch): void => {
    if (selected) run({ kind: 'text-style-update', styleId: selected.id, patch: value });
  };

  return (
    <div className="cad-shell-table-wrap" data-cad-text-style-manager>
      {notice ? <div className="cad-shell-notice" role="status">{notice}</div> : null}
      <div className="cad-shell-dialog-row">
        <input
          aria-label="New text style name"
          placeholder="New text style name"
          value={newName}
          disabled={disabled}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button
          type="button"
          disabled={disabled || newName.trim().length === 0}
          onClick={() => {
            run({ kind: 'text-style-create', name: newName });
            setNewName('');
          }}
        >
          New
        </button>
        <button
          type="button"
          disabled={disabled || selected == null}
          onClick={() => selected && run({ kind: 'text-style-duplicate', styleId: selected.id })}
        >
          Duplicate
        </button>
      </div>
      <table className="cad-shell-table" data-cad-text-style-table>
        <thead>
          <tr>
            <th>Preview</th><th>Name</th><th>Font</th><th>Mode</th><th>Height</th>
            <th>Width</th><th>Spacing</th><th>Weight</th><th>Style</th><th>Used</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {definitions.map((style) => {
            const mode = textStyleHeightMode(style);
            const used = referenceCounts[style.id] ?? 0;
            return (
              <tr
                key={style.id}
                data-cad-text-style={style.id}
                data-selected={style.id === selectedId ? 'true' : undefined}
                onClick={() => setSelectedId(style.id)}
              >
                <td><TextStylePreview style={style} /></td>
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
                          run({ kind: 'text-style-rename', styleId: style.id, name: renameValue });
                          setRenameId(null);
                        }
                        if (event.key === 'Escape') setRenameId(null);
                      }}
                    />
                  ) : style.name}
                </td>
                <td>{style.fontFamily}</td>
                <td>{mode}</td>
                <td>{mode === 'paper' ? `${style.paperHeightMm ?? '—'} mm` : (style.modelHeight ?? style.fontSize)}</td>
                <td>{style.widthFactor ?? 1}</td>
                <td>{style.lineSpacingFactor ?? 1}</td>
                <td>{style.fontWeight ?? 'normal'}</td>
                <td>{style.fontStyle ?? 'normal'}</td>
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
                    title={used > 0 ? `Referenced by ${used} entity/style — reassign first` : `Delete ${style.name}`}
                    onClick={() => run({ kind: 'text-style-delete', styleId: style.id })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {definitions.length === 0 ? <p className="cad-shell-empty">No text styles in this drawing.</p> : null}
      {selected ? (
        <div className="cad-shell-props-group" data-cad-text-style-editor={selected.id}>
          <h4>Edit “{selected.name}”</h4>
          <StyleTextField
            label="Font"
            value={selected.fontFamily}
            disabled={disabled}
            onCommit={(fontFamily) => patch({ fontFamily })}
          />
          <StyleSelectField
            label="Sizing mode"
            value={textStyleHeightMode(selected)}
            options={HEIGHT_MODES}
            disabled={disabled}
            onCommit={(mode) => patch({ heightMode: mode as CadTextStyle['heightMode'] })}
          />
          <StyleNumberField
            label="Model height"
            value={selected.modelHeight ?? selected.fontSize}
            min={0.0001}
            disabled={disabled}
            onCommit={(modelHeight) => patch({ modelHeight })}
          />
          <StyleNumberField
            label="Paper height mm"
            value={selected.paperHeightMm ?? 2.5}
            min={0.0001}
            disabled={disabled}
            onCommit={(paperHeightMm) => patch({ paperHeightMm })}
          />
          <StyleNumberField
            label="Width factor"
            value={selected.widthFactor ?? 1}
            min={0.0001}
            disabled={disabled}
            onCommit={(widthFactor) => patch({ widthFactor })}
          />
          <StyleNumberField
            label="Line spacing factor"
            value={selected.lineSpacingFactor ?? 1}
            min={0.0001}
            disabled={disabled}
            onCommit={(lineSpacingFactor) => patch({ lineSpacingFactor })}
          />
          <StyleSelectField
            label="Weight"
            value={selected.fontWeight ?? 'normal'}
            options={FONT_WEIGHTS}
            disabled={disabled}
            onCommit={(weight) => patch({ fontWeight: weight as CadTextStyle['fontWeight'] })}
          />
          <StyleSelectField
            label="Style"
            value={selected.fontStyle ?? 'normal'}
            options={FONT_STYLES}
            disabled={disabled}
            onCommit={(fontStyle) => patch({ fontStyle: fontStyle as CadTextStyle['fontStyle'] })}
          />
        </div>
      ) : null}
    </div>
  );
};
