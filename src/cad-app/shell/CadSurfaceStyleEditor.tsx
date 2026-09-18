import React from 'react';
import type { CadSurfaceStyleSummary } from './cadSurfaceSnapshot';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18H — CONTOURS section of the surface style editor.
 *
 * Geometry vs appearance contract (pinned by tests): interval/base edits
 * change the contour geometry revision (new derivation, NEVER a TIN
 * rebuild); appearance/label-visibility edits reuse the cached geometry
 * (same geometryRevision). Dispatches SURFACE_STYLE_UPDATE through the
 * existing undo path; invalid input is rejected with an inline notice.
 */
export const CadSurfaceStyleEditor: React.FC<{
  style: CadSurfaceStyleSummary;
  runUpdate: (_patch: Record<string, number | boolean | string | object | null>) => boolean;
  notify: (_notice: string) => void;
}> = ({ style, runUpdate, notify }) => {
  const [interval, setInterval] = React.useState(style.minorContourInterval?.toString() ?? '1');
  const [every, setEvery] = React.useState(style.majorContourEvery?.toString() ?? '5');
  const [base, setBase] = React.useState(style.contourBaseElevation?.toString() ?? '0');
  const [minorColor, setMinorColor] = React.useState(style.minorColor ?? '');
  const [majorColor, setMajorColor] = React.useState(style.majorColor ?? '');
  const [spacing, setSpacing] = React.useState(style.contourLabelSpacing?.toString() ?? '40');
  const [precision, setPrecision] = React.useState(style.contourLabelPrecision?.toString() ?? '1');
  React.useEffect(() => {
    setInterval(style.minorContourInterval?.toString() ?? '1');
    setEvery(style.majorContourEvery?.toString() ?? '5');
    setBase(style.contourBaseElevation?.toString() ?? '0');
    setMinorColor(style.minorColor ?? '');
    setMajorColor(style.majorColor ?? '');
    setSpacing(style.contourLabelSpacing?.toString() ?? '40');
    setPrecision(style.contourLabelPrecision?.toString() ?? '1');
  }, [style]);
  const num = (raw: string): number | null => {
    const value = Number(raw);
    return raw.trim() !== '' && Number.isFinite(value) ? value : null;
  };
  // Geometry-affecting: new contour derivation, never a TIN rebuild.
  const applyGeometry = (): void => {
    const minorContourInterval = num(interval);
    const majorEvery = num(every);
    const contourBaseElevation = num(base);
    if (
      minorContourInterval == null || minorContourInterval <= 0 ||
      majorEvery == null || !Number.isInteger(majorEvery) || majorEvery < 1 ||
      contourBaseElevation == null
    ) {
      notify('Contours rejected — interval > 0, major-every a positive integer, base numeric.');
      return;
    }
    const ok = runUpdate({ minorContourInterval, majorEvery: Math.trunc(majorEvery), contourBaseElevation });
    notify(ok ? 'Contour geometry updated — re-deriving (TIN untouched).' : 'Contours rejected — see status/locks.');
  };
  // Appearance-only: reuses cached contour geometry (same geometryRevision).
  const applyAppearance = (): void => {
    const ok = runUpdate({
      ...(minorColor.trim() ? { minorContour: { color: minorColor.trim() } } : { minorContour: null }),
      ...(majorColor.trim() ? { majorContour: { color: majorColor.trim() } } : { majorContour: null }),
    });
    notify(ok ? 'Contour appearance updated (geometry reused).' : 'Contours rejected — see status/locks.');
  };
  const applyLabels = (): void => {
    const contourLabelSpacing = num(spacing);
    const contourLabelPrecision = num(precision);
    if (
      contourLabelSpacing == null || contourLabelSpacing <= 0 ||
      contourLabelPrecision == null || !Number.isInteger(contourLabelPrecision) ||
      contourLabelPrecision < 0 || contourLabelPrecision > 6
    ) {
      notify('Labels rejected — spacing > 0, precision an integer 0–6.');
      return;
    }
    const ok = runUpdate({ contourLabelSpacing, contourLabelPrecision: Math.trunc(contourLabelPrecision) });
    notify(ok ? 'Contour labels updated.' : 'Labels rejected — see status/locks.');
  };
  const toggle = (patch: Record<string, boolean>, done: string): void => {
    notify(runUpdate(patch) ? done : 'Contours rejected — see status/locks.');
  };
  return (
    <section aria-label="Contours" className="grid gap-2 rounded border border-slate-700 p-2">
      <h3 className="text-[11px] font-semibold text-slate-200">Contours</h3>
      <label className="flex items-center gap-2 text-[11px] text-slate-200">
        <input
          type="checkbox"
          aria-label="Show contours"
          checked={style.showContours}
          onChange={(event) => toggle({ showContours: event.target.checked }, event.target.checked ? 'Contours on.' : 'Contours off.')}
        />
        Show contours
      </label>
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
        <Field label="Minor interval">
          <input aria-label="Minor contour interval" className={inputClass} value={interval} onChange={(event) => setInterval(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Major every N">
          <input aria-label="Major every N levels" className={inputClass} value={every} onChange={(event) => setEvery(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Base elevation">
          <input aria-label="Contour base elevation" className={inputClass} value={base} onChange={(event) => setBase(event.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <div>
        <button type="button" className={buttonClass} onClick={applyGeometry}>Apply geometry</button>
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <Field label="Minor color (blank = style)">
          <input aria-label="Minor contour color" className={inputClass} value={minorColor} onChange={(event) => setMinorColor(event.target.value)} placeholder="#38bdf8" />
        </Field>
        <Field label="Major color (blank = style)">
          <input aria-label="Major contour color" className={inputClass} value={majorColor} onChange={(event) => setMajorColor(event.target.value)} placeholder="#38bdf8" />
        </Field>
      </div>
      <div>
        <button type="button" className={buttonClass} onClick={applyAppearance}>Apply appearance</button>
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <Field label="Label spacing">
          <input aria-label="Contour label spacing" className={inputClass} value={spacing} onChange={(event) => setSpacing(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Label precision">
          <input aria-label="Contour label precision" className={inputClass} value={precision} onChange={(event) => setPrecision(event.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={applyLabels}>Apply labels</button>
        <label className="flex items-center gap-1 text-[11px] text-slate-200">
          <input
            type="checkbox"
            aria-label="Show contour labels"
            checked={style.showContourLabels}
            onChange={(event) => toggle({ showContourLabels: event.target.checked }, 'Label visibility updated.')}
          />
          Labels
        </label>
        <label className="flex items-center gap-1 text-[11px] text-slate-200">
          <input
            type="checkbox"
            aria-label="Label major contours only"
            checked={style.labelMajorOnly}
            onChange={(event) => toggle({ labelMajorOnly: event.target.checked }, 'Label filter updated.')}
          />
          Major only
        </label>
      </div>
    </section>
  );
};
