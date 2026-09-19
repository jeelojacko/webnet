// Phase 18O — shared inline editors for the annotation style managers.
// One commit-on-Enter/blur contract for every text/number/select field so
// the managers stay declarative and the tests share stable aria labels.

import React, { useEffect, useState } from 'react';

interface BaseFieldProps {
  label: string;
  disabled?: boolean;
}

export const StyleTextField: React.FC<BaseFieldProps & {
  value: string;
  onCommit: (_value: string) => void;
  placeholder?: string;
}> = ({ label, value, onCommit, disabled, placeholder }) => (
  <label className="cad-shell-check-row">
    {label}
    <CommitInput
      ariaLabel={label}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onCommit={onCommit}
    />
  </label>
);

export const StyleNumberField: React.FC<BaseFieldProps & {
  value: number;
  onCommit: (_value: number) => void;
  step?: number;
  min?: number;
}> = ({ label, value, onCommit, disabled, step, min }) => (
  <label className="cad-shell-check-row">
    {label}
    <CommitInput
      ariaLabel={label}
      value={String(value)}
      disabled={disabled}
      inputMode="decimal"
      onCommit={(draft) => {
        const parsed = Number(draft);
        if (!Number.isFinite(parsed)) return;
        if (min != null && parsed < min) return;
        onCommit(parsed);
      }}
      step={step}
    />
  </label>
);

export const StyleSelectField: React.FC<BaseFieldProps & {
  value: string;
  options: Array<{ id: string; name: string }>;
  onCommit: (_value: string) => void;
  allowEmpty?: string;
}> = ({ label, value, options, onCommit, disabled, allowEmpty }) => (
  <label className="cad-shell-check-row">
    {label}
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onCommit(event.target.value)}
    >
      {allowEmpty != null ? <option value="">{allowEmpty}</option> : null}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  </label>
);

export const StyleCheckboxField: React.FC<BaseFieldProps & {
  checked: boolean;
  onCommit: (_checked: boolean) => void;
}> = ({ label, checked, onCommit, disabled }) => (
  <label className="cad-shell-check-row">
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCommit(event.target.checked)}
    />
    {label}
  </label>
);

export const StyleOffsetField: React.FC<BaseFieldProps & {
  offset: { x: number; y: number };
  onCommit: (_offset: { x: number; y: number }) => void;
}> = ({ label, offset, onCommit, disabled }) => (
  <div className="cad-shell-dialog-row" role="group" aria-label={label}>
    <StyleNumberField
      label={`${label} E`}
      value={offset.x}
      disabled={disabled}
      onCommit={(x) => onCommit({ x, y: offset.y })}
    />
    <StyleNumberField
      label={`${label} N`}
      value={offset.y}
      disabled={disabled}
      onCommit={(y) => onCommit({ x: offset.x, y })}
    />
  </div>
);

/**
 * Uncontrolled-while-typing input: local draft syncs from `value` when the
 * field is not focused, commits on Enter/blur, reverts on Escape. Never
 * fights a parent re-render mid-edit.
 */
const CommitInput: React.FC<{
  ariaLabel: string;
  value: string;
  onCommit: (_value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputMode?: 'numeric' | 'decimal' | 'text';
  step?: number;
}> = ({ ariaLabel, value, onCommit, disabled, placeholder, inputMode, step }) => {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  const commit = (): void => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      aria-label={ariaLabel}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      inputMode={inputMode}
      step={step}
      onFocus={() => setEditing(true)}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      onBlur={commit}
    />
  );
};
