import React from 'react';
import type { CadProfileStyleSummary } from './cadProfileSnapshot';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18J — profile style editor (display ONLY; never rebuilds profiles).
 * Bounded color/lineweight/opacity/showVertices edits dispatch
 * PROFILE_STYLE_UPDATE through the undo path; invalid input is rejected
 * with an inline notice.
 */
export const CadProfileStyleEditor: React.FC<{
  style: CadProfileStyleSummary;
  runUpdate: (_patch: Record<string, boolean | string | number>) => boolean;
  notify: (_notice: string) => void;
}> = ({ style, runUpdate, notify }) => {
  const [color, setColor] = React.useState(style.color);
  const [lineweight, setLineweight] = React.useState(style.lineweight.toString());
  const [opacity, setOpacity] = React.useState(style.opacity.toString());
  React.useEffect(() => {
    setColor(style.color);
    setLineweight(style.lineweight.toString());
    setOpacity(style.opacity.toString());
  }, [style]);
  const apply = (): void => {
    const weight = Number(lineweight);
    const alpha = Number(opacity);
    if (
      color.trim() === '' ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      !Number.isFinite(alpha) ||
      alpha < 0 ||
      alpha > 1
    ) {
      notify('Profile style rejected — color non-blank, lineweight ≥ 0, opacity 0–1.');
      return;
    }
    const ok = runUpdate({ color: color.trim(), lineweight: weight, opacity: alpha });
    notify(ok ? 'Profile style updated (display only — profiles untouched).' : 'Profile style rejected — see status/locks.');
  };
  const toggle = (patch: Record<string, boolean>, done: string): void => {
    notify(runUpdate(patch) ? done : 'Profile style rejected — see status/locks.');
  };
  return (
    <section aria-label="Profile style" className="grid gap-2 rounded border border-slate-700 p-2">
      <h3 className="text-[11px] font-semibold text-slate-200">Profile Style — {style.name}</h3>
      <label className="flex items-center gap-2 text-[11px] text-slate-200">
        <input
          type="checkbox"
          aria-label="Show profile vertices"
          checked={style.showVertices}
          onChange={(event) => toggle({ showVertices: event.target.checked }, 'Vertex display updated.')}
        />
        Show vertices
      </label>
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
        <Field label="Color">
          <input aria-label="Profile color" className={inputClass} value={color} onChange={(event) => setColor(event.target.value)} placeholder="#1f6feb" />
        </Field>
        <Field label="Lineweight mm">
          <input aria-label="Profile lineweight" className={inputClass} value={lineweight} onChange={(event) => setLineweight(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Opacity 0–1">
          <input aria-label="Profile opacity" className={inputClass} value={opacity} onChange={(event) => setOpacity(event.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <div>
        <button type="button" className={buttonClass} onClick={apply}>Apply profile style</button>
      </div>
    </section>
  );
};
