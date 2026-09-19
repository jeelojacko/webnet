import React from 'react';
import type { CadVolumeStyleSummary } from './cadVolumeSnapshot';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18I — volume style editor (display ONLY; never recalculates).
 * Mirrors CadSurfaceStyleEditor patterns: checkbox/colour/opacity inputs
 * dispatch VOLUME_STYLE_UPDATE through the undo path; invalid input is
 * rejected with an inline notice.
 */
export const CadVolumeStyleEditor: React.FC<{
  style: CadVolumeStyleSummary;
  runUpdate: (_patch: Record<string, boolean | string | number>) => boolean;
  notify: (_notice: string) => void;
}> = ({ style, runUpdate, notify }) => {
  const [cutColor, setCutColor] = React.useState(style.cutColor);
  const [fillColor, setFillColor] = React.useState(style.fillColor);
  const [opacity, setOpacity] = React.useState(style.opacity.toString());
  React.useEffect(() => {
    setCutColor(style.cutColor);
    setFillColor(style.fillColor);
    setOpacity(style.opacity.toString());
  }, [style]);
  const apply = (): void => {
    const value = Number(opacity);
    if (cutColor.trim() === '' || fillColor.trim() === '' || !Number.isFinite(value) || value < 0 || value > 1) {
      notify('Volume style rejected — colors non-blank, opacity a number 0–1.');
      return;
    }
    const ok = runUpdate({ cutColor: cutColor.trim(), fillColor: fillColor.trim(), opacity: value });
    notify(ok ? 'Volume style updated (display only — quantities untouched).' : 'Volume style rejected — see status/locks.');
  };
  const toggle = (patch: Record<string, boolean>, done: string): void => {
    notify(runUpdate(patch) ? done : 'Volume style rejected — see status/locks.');
  };
  return (
    <section aria-label="Volume style" className="grid gap-2 rounded border border-slate-700 p-2">
      <h3 className="text-[11px] font-semibold text-slate-200">Volume Style — {style.name}</h3>
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-[11px] text-slate-200">
          <input
            type="checkbox"
            aria-label="Show cut regions"
            checked={style.showCut}
            onChange={(event) => toggle({ showCut: event.target.checked }, 'Cut display updated.')}
          />
          Show cut
        </label>
        <label className="flex items-center gap-2 text-[11px] text-slate-200">
          <input
            type="checkbox"
            aria-label="Show fill regions"
            checked={style.showFill}
            onChange={(event) => toggle({ showFill: event.target.checked }, 'Fill display updated.')}
          />
          Show fill
        </label>
        <label className="flex items-center gap-2 text-[11px] text-slate-200">
          <input
            type="checkbox"
            aria-label="Show zero boundary"
            checked={style.showZeroBoundary}
            onChange={(event) => toggle({ showZeroBoundary: event.target.checked }, 'Zero-boundary display updated.')}
          />
          Zero boundary
        </label>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
        <Field label="Cut color">
          <input aria-label="Cut color" className={inputClass} value={cutColor} onChange={(event) => setCutColor(event.target.value)} placeholder="#d64545" />
        </Field>
        <Field label="Fill color">
          <input aria-label="Fill color" className={inputClass} value={fillColor} onChange={(event) => setFillColor(event.target.value)} placeholder="#3d7dd6" />
        </Field>
        <Field label="Opacity 0–1">
          <input aria-label="Volume opacity" className={inputClass} value={opacity} onChange={(event) => setOpacity(event.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <div>
        <button type="button" className={buttonClass} onClick={apply}>Apply volume style</button>
      </div>
    </section>
  );
};
