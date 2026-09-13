/**
 * Phase 12G — GNSS station table with FREE/FIXED-XYZ toggle.
 *
 * Full-XYZ control only: toggling sets/clears fixed + fixedX + fixedY +
 * fixedH together. Paginated, sortable, and filterable for large networks.
 */
import React, { useMemo, useState } from 'react';
import type { StationMap } from '../../types';

const PAGE_SIZE = 50;

type SortKey = 'id' | 'fixed';

interface GnssStationTableProps {
  stations: StationMap;
  onToggleFixed: (_id: string, _fixed: boolean) => void;
}

export const GnssStationTable: React.FC<GnssStationTableProps> = ({ stations, onToggleFixed }) => {
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const entries = Object.entries(stations)
      .filter(([id]) => (query === '' ? true : id.toLowerCase().includes(query)))
      .map(([id, station]) => ({
        id,
        fixed: !!station?.fixedX && !!station?.fixedY && !!station?.fixedH,
        x: station?.x ?? 0,
        y: station?.y ?? 0,
        z: station?.h ?? 0,
      }));
    entries.sort((a, b) =>
      sortKey === 'fixed'
        ? Number(b.fixed) - Number(a.fixed) || a.id.localeCompare(b.id)
        : a.id.localeCompare(b.id),
    );
    return entries;
  }, [stations, filter, sortKey]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <label className="text-xs text-slate-400" htmlFor="gnss-station-filter">
          Filter stations
        </label>
        <input
          id="gnss-station-filter"
          type="text"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setPage(0);
          }}
          placeholder="station id…"
          className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
        />
        <label className="text-xs text-slate-400" htmlFor="gnss-station-sort">
          Sort
        </label>
        <select
          id="gnss-station-sort"
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
        >
          <option value="id">Station id</option>
          <option value="fixed">Control first</option>
        </select>
        <span className="text-xs text-slate-500" aria-live="polite">
          {rows.length} station(s)
        </span>
      </div>
      <table className="w-full text-xs text-slate-200">
        <thead>
          <tr className="text-left text-slate-400 border-b border-slate-700">
            <th className="py-1 pr-2">Station</th>
            <th className="py-1 pr-2">X (m)</th>
            <th className="py-1 pr-2">Y (m)</th>
            <th className="py-1 pr-2">Z (m)</th>
            <th className="py-1 pr-2">Control</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.id} className="border-b border-slate-800">
              <td className="py-1 pr-2 font-mono">{row.id}</td>
              <td className="py-1 pr-2 font-mono">{row.x.toFixed(3)}</td>
              <td className="py-1 pr-2 font-mono">{row.y.toFixed(3)}</td>
              <td className="py-1 pr-2 font-mono">{row.z.toFixed(3)}</td>
              <td className="py-1 pr-2">
                <button
                  type="button"
                  onClick={() => onToggleFixed(row.id, !row.fixed)}
                  aria-pressed={row.fixed}
                  aria-label={`${row.id} control: ${row.fixed ? 'fixed XYZ' : 'free'}`}
                  className={`px-2 py-0.5 rounded text-xs font-medium border ${
                    row.fixed
                      ? 'bg-amber-900/60 border-amber-600 text-amber-200'
                      : 'bg-slate-800 border-slate-600 text-slate-300'
                  }`}
                >
                  {row.fixed ? 'FIXED-XYZ' : 'FREE'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pageCount > 1 && (
        <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
            className="px-2 py-0.5 border border-slate-700 rounded disabled:opacity-40"
          >
            Previous
          </button>
          <span aria-live="polite">
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
            className="px-2 py-0.5 border border-slate-700 rounded disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};
