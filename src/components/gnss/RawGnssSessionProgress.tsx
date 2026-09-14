import React from 'react';
import { suggestReplacementPair } from './GnssRawSessionPanel.utils';
import type { SessionGraph } from '../../engine/gnssRawSessionGraph';
import type { SessionEdgeState } from '../../hooks/useGnssRawSession';

export interface RawGnssSessionProgressProps {
  readonly started: boolean;
  readonly settled: boolean;
  readonly preparing: boolean;
  readonly canProcess: boolean;
  readonly hasOccupations: boolean;
  readonly hasResult: boolean;
  readonly blockReason: string | null;
  readonly snapshot: Readonly<Record<string, SessionEdgeState>>;
  readonly failed: string[];
  readonly failedDetails: Readonly<Record<string, string>>;
  readonly graph: SessionGraph | null;
  readonly repairs: Readonly<Record<string, string>>;
  readonly replaceText: Readonly<Record<string, string>>;
  readonly replaceError: Readonly<Record<string, string | null>>;
  readonly reimportError: string | null;
  readonly runLocked: boolean;
  readonly onProcess: () => void;
  readonly onCancel: () => void;
  readonly onRestart: () => void;
  readonly onReplaceText: (_edgeId: string, _text: string) => void;
  readonly onReplaceEdge: (_edgeId: string, _fallbackText: string) => void;
  readonly onReimport: (_file: File) => void;
}

/** Phase 12J.10 — process/cancel/repair/reimport extracted, unchanged. */
export const RawGnssSessionProgress: React.FC<RawGnssSessionProgressProps> = ({
  started, settled, preparing, canProcess, hasOccupations, hasResult, blockReason,
  snapshot, failed, failedDetails, graph, repairs, replaceText, replaceError,
  reimportError, runLocked, onProcess, onCancel, onRestart,
  onReplaceText, onReplaceEdge, onReimport,
}) => (
  <>
    <div className="flex items-center gap-2">
      <button type="button" data-testid="raw-session-process" onClick={onProcess}
        disabled={!canProcess || preparing || (started && !settled)}
        className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-700 disabled:opacity-40">
        Process raw session
      </button>
      {started && !settled && (
        <button type="button" data-testid="raw-session-cancel" onClick={onCancel}
          className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-700">
          Cancel
        </button>
      )}
      {(settled || hasResult) && (
        <button type="button" data-testid="raw-session-restart" onClick={onRestart}
          className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-700">
          Start over
        </button>
      )}
    </div>
    {blockReason && hasOccupations && (
      <div data-testid="raw-session-blocker" className="text-xs text-slate-500">{blockReason}</div>
    )}
    {started && !settled && (
      <div data-testid="raw-session-progress" className="text-xs text-slate-300">
        <ul className="list-disc pl-5">
          {Object.entries(snapshot).map(([edge, state]) => (
            <li key={edge}>{edge}: {state}</li>
          ))}
        </ul>
      </div>
    )}
    {settled && failed.length > 0 && graph && (
      <div data-testid="raw-session-failed" className="text-xs text-amber-300">
        Failed edge(s): {failed.join(', ')}
        <ul className="list-disc pl-5">
          {Object.entries(failedDetails).map(([edge, why]) => {
            const cut = edge.indexOf('->');
            const suggestion = cut >= 0
              ? suggestReplacementPair(graph, {
                from: edge.slice(0, cut), to: edge.slice(cut + 2),
              })
              : null;
            const prefill = suggestion ? `${suggestion.from}->${suggestion.to}` : '';
            // Superseded edges are forgotten from the pool, so the repair
            // note lives on the replacement row ("replaces X").
            const replaces = Object.entries(repairs).find(([, v]) => v === edge)?.[0];
            return (
              <li key={edge}>{edge}: {why}
                {replaces && (
                  <span className="ml-1 text-slate-400">
                    replaces {replaces}
                  </span>
                )}
                <label className="ml-2 text-slate-300">Replace with
                  <input type="text" data-testid={`raw-session-replace-${edge}`} value={replaceText[edge] ?? prefill}
                    placeholder={prefill === '' ? 'FROM->TO' : prefill}
                    onChange={(e) => onReplaceText(edge, e.target.value)}
                    className="ml-1 bg-slate-800 border border-slate-600 px-1 py-0.5" />
                </label>
                <button type="button" data-testid={`raw-session-replace-go-${edge}`}
                  onClick={() => onReplaceEdge(edge, prefill)}
                  className="ml-1 px-1 py-0.5 border border-slate-600 rounded hover:bg-slate-700 text-slate-200">
                  Replace
                </button>
                {replaceError[edge] && <span className="ml-1 text-red-300">{replaceError[edge]}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    )}
    <div className="text-xs text-slate-300">
      <label className="block">Reimport session JSON for review (parse-only, never reprocesses)
        <input type="file" data-testid="raw-session-reimport-input" accept=".json"
          disabled={runLocked}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onReimport(f);
            e.target.value = '';
          }}
          className="mt-1 block w-full text-xs text-slate-400" />
      </label>
      {reimportError && <div data-testid="raw-session-reimport-error" className="text-xs text-red-300">{reimportError}</div>}
    </div>
  </>
);
