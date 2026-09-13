/**
 * Phase 12I.2 — datum-handling radio selector (UI only, no math).
 *
 * Explicit opt-in: 'constrained' (default) requires real fixed XYZ control
 * in every connected component; 'allow-free' solves uncontrolled components
 * as free networks. Never auto-switches — the parent owns the value.
 */
import React from 'react';
import type { GnssDatumMode } from '../../engine/gnssFreeNetwork';

export interface GnssDatumHandlingSelectorProps {
  readonly value: GnssDatumMode;
  readonly onChange: (_mode: GnssDatumMode) => void;
  readonly disabled?: boolean;
}

export const GnssDatumHandlingSelector: React.FC<GnssDatumHandlingSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => (
  <fieldset disabled={disabled} className="space-y-1">
    <legend className="text-sm font-medium">Datum handling</legend>
    <label className="flex items-start gap-2 text-xs cursor-pointer">
      <input
        type="radio"
        name="gnss-datum-handling"
        value="constrained"
        checked={value === 'constrained'}
        onChange={() => onChange('constrained')}
        className="mt-0.5"
      />
      <span>
        <span className="block font-medium">Constrained components only</span>
        <span className="block text-slate-400">Require real fixed XYZ control in every connected component.</span>
      </span>
    </label>
    <label className="flex items-start gap-2 text-xs cursor-pointer">
      <input
        type="radio"
        name="gnss-datum-handling"
        value="allow-free"
        checked={value === 'allow-free'}
        onChange={() => onChange('allow-free')}
        className="mt-0.5"
      />
      <span>
        <span className="block font-medium">Allow free components</span>
        <span className="block text-slate-400">Components without real fixed XYZ control are adjusted as free networks using an inner-constrained datum.</span>
      </span>
    </label>
  </fieldset>
);
