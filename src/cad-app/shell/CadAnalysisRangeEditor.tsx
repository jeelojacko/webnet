import React from 'react';
import { MAX_ANALYSIS_BANDS, DEFAULT_ANALYSIS_BAND_COUNT } from '../../engine/cad/cadAnalysisTypes';
import type { CadAnalysisMap } from '../../engine/cad/cadAnalysisTypes';
import type { CadAnalysisResult } from './cadAnalysisSnapshot';
import {
  analysisDraftLabel,
  analysisDraftMeasuredText,
  appendAnalysisRangeDraft,
  describeAnalysisRangeError,
  describeAnalysisRangeGaps,
  draftRowToBand,
  generateAnalysisRangeDraft,
  removeAnalysisRangeDraft,
  updateAnalysisRangeDraftRow,
  validateAnalysisRangeDraft,
  type AnalysisRangeDraftRow,
} from './cadAnalysisRanges';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

interface CadAnalysisRangeEditorProps {
  map: CadAnalysisMap;
  units: string;
  result: CadAnalysisResult | null;
  onApply: (_bands: ReturnType<typeof draftRowToBand>[]) => boolean;
  onNotice: (_message: string) => void;
}

/**
 * Phase 18U — dense range-editor table: Color / Lower / Upper / Label plus
 * read-only measured columns (Plan Area / %Area / 3D Area-or-Volume). Apply
 * is blocked while the draft is invalid (overlap / non-finite / lower ≥ upper
 * are rejected inline; gaps are flagged UNCLASSIFIED, never silently closed).
 * Generate Equal defaults to 5 bands and caps at MAX_ANALYSIS_BANDS.
 */
export const CadAnalysisRangeEditor: React.FC<CadAnalysisRangeEditorProps> = ({
  map,
  units,
  result,
  onApply,
  onNotice,
}) => {
  const [rows, setRows] = React.useState<AnalysisRangeDraftRow[]>([]);
  const [countDraft, setCountDraft] = React.useState(String(DEFAULT_ANALYSIS_BAND_COUNT));
  const mapIdRef = React.useRef(map.id);

  // Reset the draft when the selected map changes or its bands change
  // underneath (undo/redo, external command).
  const signature = `${map.id}:${map.bands.map((band) => `${band.id}|${band.lower}|${band.upper}`).join(',')}`;
  React.useEffect(() => {
    mapIdRef.current = map.id;
    setRows(
      [...map.bands]
        .sort((a, b) => a.lower - b.lower)
        .map((band) => {
          const measured = result?.bands.find((entry) => entry.bandId === band.id) ?? null;
          return {
            id: band.id,
            color: band.color,
            lower: String(band.lower),
            upper: String(band.upper),
            label: band.label ?? '',
            planArea: measured?.planArea ?? null,
            percent: measured?.percent ?? null,
            area3D: measured?.area3D ?? null,
            cutVolume: measured?.cutVolume ?? null,
            fillVolume: measured?.fillVolume ?? null,
            netVolume: measured?.netVolume ?? null,
          };
        }),
    );
    // Draft re-init keys off the definition signature (map + band edges), not
    // the identity of the band array/result objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const reason = validateAnalysisRangeDraft(rows);
  const gaps = describeAnalysisRangeGaps(rows);
  const equal = (): void => {
    const count = Number.parseInt(countDraft, 10);
    if (!Number.isInteger(count) || count < 1 || count > MAX_ANALYSIS_BANDS) {
      onNotice(`Band count must be 1..${MAX_ANALYSIS_BANDS}.`);
      return;
    }
    const generated = generateAnalysisRangeDraft(count, map.bands[0]?.lower ?? 0, map.bands[map.bands.length - 1]?.upper ?? 1);
    if ('error' in generated) {
      onNotice(`Generate Equal rejected: ${describeAnalysisRangeError(generated.error)}`);
      return;
    }
    setRows(generated.rows);
    onNotice(`Generated ${generated.rows.length} equal bands.`);
  };
  const apply = (): void => {
    if (reason) {
      onNotice(`Apply rejected: ${describeAnalysisRangeError(reason)}`);
      return;
    }
    const ok = onApply(rows.map(draftRowToBand));
    onNotice(ok ? 'Band ranges applied — Calculate to refresh measurements.' : 'Apply rejected.');
  };
  return (
    <div className="grid gap-1" data-cad-analysis-ranges={map.id}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-0.5 text-[11px] text-slate-300">
          <span className="text-slate-400">Band count (equal)</span>
          <input
            aria-label="Equal band count"
            className={`${inputClass} w-20`}
            value={countDraft}
            onChange={(event) => setCountDraft(event.target.value)}
          />
        </label>
        <button type="button" className={buttonClass} onClick={equal} data-cad-analysis-generate>
          Generate Equal
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={rows.length >= MAX_ANALYSIS_BANDS}
          onClick={() => setRows((current) => appendAnalysisRangeDraft(current))}
        >
          Add Band
        </button>
        <button type="button" className={buttonClass} disabled={!!reason} onClick={apply} data-cad-analysis-apply>
          Apply
        </button>
      </div>
      <table className="w-full border-collapse text-[11px]" data-cad-analysis-band-table>
        <thead>
          <tr className="text-slate-400">
            <th className="px-1 text-left">Color</th>
            <th className="px-1 text-left">Lower</th>
            <th className="px-1 text-left">Upper</th>
            <th className="px-1 text-left">Label</th>
            <th className="px-1 text-right">Plan Area</th>
            <th className="px-1 text-right">%Area</th>
            <th className="px-1 text-right">{map.source.metric === 'signed-depth' ? 'Net Volume' : '3D Area'}</th>
            <th className="px-1" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const measured = analysisDraftMeasuredText(row, map, units, result);
            return (
              <tr key={row.id} data-cad-analysis-band={row.id} title={analysisDraftLabel(row, map)}>
                <td className="px-1">
                  <input
                    aria-label={`Band ${row.id} color`}
                    type="color"
                    className="h-5 w-8 cursor-pointer rounded border border-slate-600 bg-slate-900"
                    value={row.color}
                    onChange={(event) =>
                      setRows((current) =>
                        updateAnalysisRangeDraftRow(current, row.id, { color: event.target.value }),
                      )
                    }
                  />
                </td>
                <td className="px-1">
                  <input
                    aria-label={`Band ${row.id} lower`}
                    className={inputClass}
                    value={row.lower}
                    onChange={(event) =>
                      setRows((current) =>
                        updateAnalysisRangeDraftRow(current, row.id, { lower: event.target.value }),
                      )
                    }
                  />
                </td>
                <td className="px-1">
                  <input
                    aria-label={`Band ${row.id} upper`}
                    className={inputClass}
                    value={row.upper}
                    onChange={(event) =>
                      setRows((current) =>
                        updateAnalysisRangeDraftRow(current, row.id, { upper: event.target.value }),
                      )
                    }
                  />
                </td>
                <td className="px-1">
                  <input
                    aria-label={`Band ${row.id} label`}
                    className={inputClass}
                    value={row.label}
                    placeholder={analysisDraftLabel(row, map)}
                    onChange={(event) =>
                      setRows((current) =>
                        updateAnalysisRangeDraftRow(current, row.id, { label: event.target.value }),
                      )
                    }
                  />
                </td>
                <td className="px-1 text-right text-slate-300">{measured.area}</td>
                <td className="px-1 text-right text-slate-300">
                  {row.percent == null ? '—' : `${row.percent.toFixed(1)}%`}
                </td>
                <td className="px-1 text-right text-slate-300">{measured.extra}</td>
                <td className="px-1 text-right">
                  <button
                    type="button"
                    className="rounded border border-slate-600 px-1 hover:bg-slate-800"
                    aria-label={`Delete band ${row.id}`}
                    onClick={() => setRows((current) => removeAnalysisRangeDraft(current, row.id))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {reason ? (
        <p role="status" data-cad-analysis-range-error className="text-[11px] text-amber-200">
          {describeAnalysisRangeError(reason)}
        </p>
      ) : null}
      {gaps ? (
        <p role="status" data-cad-analysis-gaps className="text-[11px] text-amber-200">
          {gaps}
        </p>
      ) : null}
      <p className="text-[11px] text-slate-500">
        {map.source.metric === 'signed-depth'
          ? 'Depth Δ = comparison − base; Δ>0 fill, Δ<0 cut. A band covering 0 is classification only ("Near Balance"), never zero earthwork.'
          : 'Plan areas are measured per band; gaps classify as UNCLASSIFIED.'}
      </p>
    </div>
  );
};
