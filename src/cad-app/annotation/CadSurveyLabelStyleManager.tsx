// Phase 18O — Survey label style managers. Bearing/distance and curve label
// tables are kept as two explicit components (clearer than one tagged table)
// and exported together for the Annotate manager tabs.

import React, { useEffect, useMemo, useState } from 'react';
import type { CadBearingLabelStyle, CadCurveLabelField, CadCurveLabelStyle, CadTextStyle } from '../../engine/cad/cadTypes';
import type {
  CadAnnotationOpResult,
  CadAnnotationUiOp,
  CadBearingLabelStylePatch,
  CadCurveLabelStylePatch,
} from './cadAnnotationUiTypes';
import { BearingLabelStylePreview, CurveLabelStylePreview } from './cadAnnotationStylePreview';
import { StyleCheckboxField, StyleNumberField, StyleOffsetField, StyleSelectField } from './cadAnnotationStyleEditor';

interface SharedProps {
  textStyles: CadTextStyle[];
  referenceCounts: Record<string, number>;
  runOp: (_op: CadAnnotationUiOp) => CadAnnotationOpResult;
  disabled?: boolean;
}

const BEARING_CONTENT = [
  { id: 'bearing', name: 'Bearing only' },
  { id: 'distance', name: 'Distance only' },
  { id: 'bearing-distance', name: 'Bearing / Distance' },
  { id: 'distance-bearing', name: 'Distance / Bearing' },
];

const BEARING_SEPARATOR = [
  { id: 'newline', name: 'New line' },
  { id: 'space', name: 'Space' },
  { id: 'slash', name: 'Slash' },
];

const CURVE_FIELDS: Array<{ id: CadCurveLabelField; label: string }> = [
  { id: 'radius', label: 'Radius' },
  { id: 'delta', label: 'Delta' },
  { id: 'length', label: 'Length' },
  { id: 'chord', label: 'Chord' },
];

export const CadBearingLabelStyleManager: React.FC<SharedProps & { styles: CadBearingLabelStyle[] }> = ({
  styles,
  textStyles,
  referenceCounts,
  runOp,
  disabled = false,
}) => {
  const definitions = useMemo(() => [...styles].sort((a, b) => a.name.localeCompare(b.name)), [styles]);
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
  const patch = (value: CadBearingLabelStylePatch): void => {
    if (selected) run({ kind: 'bearing-label-style-update', styleId: selected.id, patch: value });
  };

  return (
    <div className="cad-shell-table-wrap" data-cad-bearing-label-style-manager>
      {notice ? <div className="cad-shell-notice" role="status">{notice}</div> : null}
      <div className="cad-shell-dialog-row">
        <input
          aria-label="New bearing label style name"
          placeholder="New bearing label style name"
          value={newName}
          disabled={disabled}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button type="button" disabled={disabled || newName.trim().length === 0} onClick={() => { run({ kind: 'bearing-label-style-create', name: newName }); setNewName(''); }}>
          New
        </button>
        <button type="button" disabled={disabled || selected == null} onClick={() => selected && run({ kind: 'bearing-label-style-duplicate', styleId: selected.id })}>
          Duplicate
        </button>
      </div>
      <table className="cad-shell-table" data-cad-bearing-label-style-table>
        <thead>
          <tr><th>Preview</th><th>Name</th><th>Text style</th><th>Content</th><th>Separator</th><th>Precision</th><th>Used</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {definitions.map((style) => {
            const used = referenceCounts[style.id] ?? 0;
            return (
              <tr key={style.id} data-cad-bearing-label-style={style.id} data-selected={style.id === selectedId ? 'true' : undefined} onClick={() => setSelectedId(style.id)}>
                <td><BearingLabelStylePreview style={style} /></td>
                <td>
                  {renameId === style.id ? (
                    <input
                      aria-label={`Rename ${style.name}`}
                      value={renameValue}
                      autoFocus
                      disabled={disabled}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { run({ kind: 'bearing-label-style-rename', styleId: style.id, name: renameValue }); setRenameId(null); }
                        if (event.key === 'Escape') setRenameId(null);
                      }}
                    />
                  ) : style.name}
                </td>
                <td>{style.textStyleId}</td>
                <td>{style.content}</td>
                <td>{style.separator}</td>
                <td>{style.decimalPrecision}</td>
                <td>{used}</td>
                <td>
                  <button type="button" disabled={disabled} onClick={() => { setRenameId(style.id); setRenameValue(style.name); }}>Rename</button>
                  <button
                    type="button"
                    disabled={disabled || used > 0}
                    title={used > 0 ? `Referenced by ${used} labels — reassign first` : `Delete ${style.name}`}
                    onClick={() => run({ kind: 'bearing-label-style-delete', styleId: style.id })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {definitions.length === 0 ? <p className="cad-shell-empty">No bearing/distance label styles.</p> : null}
      {selected ? (
        <div className="cad-shell-props-group" data-cad-bearing-label-style-editor={selected.id}>
          <h4>Edit “{selected.name}”</h4>
          <StyleSelectField label="Text style" value={selected.textStyleId} options={textStyles.map((style) => ({ id: style.id, name: style.name }))} disabled={disabled} onCommit={(textStyleId) => patch({ textStyleId })} />
          <StyleSelectField label="Content" value={selected.content} options={BEARING_CONTENT} disabled={disabled} onCommit={(content) => patch({ content: content as CadBearingLabelStyle['content'] })} />
          <StyleSelectField label="Separator" value={selected.separator} options={BEARING_SEPARATOR} disabled={disabled} onCommit={(separator) => patch({ separator: separator as CadBearingLabelStyle['separator'] })} />
          <StyleNumberField label="Decimal precision" value={selected.decimalPrecision} min={0} disabled={disabled} onCommit={(decimalPrecision) => patch({ decimalPrecision: Math.round(decimalPrecision) })} />
          <StyleOffsetField label="Offset" offset={selected.offset} disabled={disabled} onCommit={(offset) => patch({ offset })} />
        </div>
      ) : null}
    </div>
  );
};

export const CadCurveLabelStyleManager: React.FC<SharedProps & { styles: CadCurveLabelStyle[] }> = ({
  styles,
  textStyles,
  referenceCounts,
  runOp,
  disabled = false,
}) => {
  const definitions = useMemo(() => [...styles].sort((a, b) => a.name.localeCompare(b.name)), [styles]);
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
  const patch = (value: CadCurveLabelStylePatch): void => {
    if (selected) run({ kind: 'curve-label-style-update', styleId: selected.id, patch: value });
  };
  const toggleField = (field: CadCurveLabelField, checked: boolean): void => {
    if (!selected) return;
    const next = checked
      ? [...selected.fields, field]
      : selected.fields.filter((entry) => entry !== field);
    patch({ fields: next });
  };

  return (
    <div className="cad-shell-table-wrap" data-cad-curve-label-style-manager>
      {notice ? <div className="cad-shell-notice" role="status">{notice}</div> : null}
      <div className="cad-shell-dialog-row">
        <input
          aria-label="New curve label style name"
          placeholder="New curve label style name"
          value={newName}
          disabled={disabled}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button type="button" disabled={disabled || newName.trim().length === 0} onClick={() => { run({ kind: 'curve-label-style-create', name: newName }); setNewName(''); }}>
          New
        </button>
        <button type="button" disabled={disabled || selected == null} onClick={() => selected && run({ kind: 'curve-label-style-duplicate', styleId: selected.id })}>
          Duplicate
        </button>
      </div>
      <table className="cad-shell-table" data-cad-curve-label-style-table>
        <thead>
          <tr><th>Preview</th><th>Name</th><th>Text style</th><th>Fields</th><th>Precision</th><th>Used</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {definitions.map((style) => {
            const used = referenceCounts[style.id] ?? 0;
            return (
              <tr key={style.id} data-cad-curve-label-style={style.id} data-selected={style.id === selectedId ? 'true' : undefined} onClick={() => setSelectedId(style.id)}>
                <td><CurveLabelStylePreview style={style} /></td>
                <td>
                  {renameId === style.id ? (
                    <input
                      aria-label={`Rename ${style.name}`}
                      value={renameValue}
                      autoFocus
                      disabled={disabled}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { run({ kind: 'curve-label-style-rename', styleId: style.id, name: renameValue }); setRenameId(null); }
                        if (event.key === 'Escape') setRenameId(null);
                      }}
                    />
                  ) : style.name}
                </td>
                <td>{style.textStyleId}</td>
                <td>{style.fields.join(', ')}</td>
                <td>{style.decimalPrecision}</td>
                <td>{used}</td>
                <td>
                  <button type="button" disabled={disabled} onClick={() => { setRenameId(style.id); setRenameValue(style.name); }}>Rename</button>
                  <button
                    type="button"
                    disabled={disabled || used > 0}
                    title={used > 0 ? `Referenced by ${used} labels — reassign first` : `Delete ${style.name}`}
                    onClick={() => run({ kind: 'curve-label-style-delete', styleId: style.id })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {definitions.length === 0 ? <p className="cad-shell-empty">No curve label styles.</p> : null}
      {selected ? (
        <div className="cad-shell-props-group" data-cad-curve-label-style-editor={selected.id}>
          <h4>Edit “{selected.name}”</h4>
          <StyleSelectField label="Text style" value={selected.textStyleId} options={textStyles.map((style) => ({ id: style.id, name: style.name }))} disabled={disabled} onCommit={(textStyleId) => patch({ textStyleId })} />
          <fieldset className="cad-shell-dialog-row" aria-label="Curve label fields">
            {CURVE_FIELDS.map((field) => (
              <StyleCheckboxField
                key={field.id}
                label={field.label}
                checked={selected.fields.includes(field.id)}
                disabled={disabled}
                onCommit={(checked) => toggleField(field.id, checked)}
              />
            ))}
          </fieldset>
          <StyleNumberField label="Decimal precision" value={selected.decimalPrecision} min={0} disabled={disabled} onCommit={(decimalPrecision) => patch({ decimalPrecision: Math.round(decimalPrecision) })} />
          <StyleOffsetField label="Offset" offset={selected.offset} disabled={disabled} onCommit={(offset) => patch({ offset })} />
        </div>
      ) : null}
    </div>
  );
};
