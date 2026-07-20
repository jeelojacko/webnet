interface AdjustedPointsTransformSelectModalProps {
  stationIds: string[];
  selectedStationIds: string[];
  onToggleStation: (_stationId: string, _checked: boolean) => void;
  onApply: () => void;
  onClose: () => void;
}

const AdjustedPointsTransformSelectModal = ({
  stationIds,
  selectedStationIds,
  onToggleStation,
  onApply,
  onClose,
}: AdjustedPointsTransformSelectModalProps) => (
  <div
    className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 px-4 py-6"
    onClick={onClose}
  >
    <div
      className="w-full max-w-md border border-slate-500 bg-slate-900 shadow-2xl"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="border-b border-slate-700 bg-slate-800 px-5 py-4">
        <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
          Transform Scope
        </div>
        <div className="mt-1 text-lg font-semibold text-white">Select Points</div>
        <div className="mt-1 text-xs text-slate-400">
          Select points to transform. Reference point is auto-included in transform scope.
        </div>
      </div>
      <div className="max-h-[50vh] space-y-2 overflow-auto px-5 py-4">
        {stationIds.length === 0 ? (
          <div className="rounded border border-slate-600 bg-slate-800/70 px-3 py-2 text-xs text-slate-300">
            No stations available. Run adjustment to populate the export set.
          </div>
        ) : (
          stationIds.map((stationId) => {
            const checked = selectedStationIds.includes(stationId);
            return (
              <label
                key={`adj-transform-select-${stationId}`}
                className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${
                  checked
                    ? 'border-cyan-500/70 bg-cyan-900/25 text-cyan-100'
                    : 'border-slate-600 bg-slate-800/60 text-slate-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onToggleStation(stationId, event.target.checked)}
                />
                <span>{stationId}</span>
              </label>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-end border-t border-slate-700 bg-slate-800 px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="border border-slate-500 bg-slate-700 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 hover:bg-slate-600"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApply}
          className="ml-2 border border-cyan-500 bg-cyan-900/40 px-4 py-2 text-xs uppercase tracking-wide text-cyan-100 hover:bg-cyan-800/60"
        >
          OK
        </button>
      </div>
    </div>
  </div>
);

export default AdjustedPointsTransformSelectModal;
