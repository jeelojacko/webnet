import React from 'react';
import type { CadSurfaceRow } from './cadSurfaceSnapshot';
import type { CadSurfaceComposeDiagnosticsView, CadSurfaceComposeMode } from './cadSurfaceCompose';

/**
 * Phase 18Y — exact composition result summary. The engine diagnostics (small
 * inputs, pre-commit) give every field; the worker path carries no numeric
 * diagnostics, so the post-commit row + the area identity
 * (overlap = base + overlay − result) fill the same table.
 */

export interface ComposeCommitView {
  mode: CadSurfaceComposeMode;
  firstName: string;
  secondName: string;
  firstArea: number | null;
  secondArea: number | null;
}

const area = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(3)} m²`;

const Detail: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <>
    <dt className="text-slate-400">{label}</dt>
    <dd>{value}</dd>
  </>
);

export const ComposeSummary: React.FC<{
  committed: ComposeCommitView;
  diagnostics: CadSurfaceComposeDiagnosticsView | null;
  resultRow: CadSurfaceRow | null;
}> = ({ committed, diagnostics, resultRow }) => {
  const firstLabel = committed.mode === 'paste' ? 'Target' : 'Base';
  const secondLabel = committed.mode === 'paste' ? 'Source' : 'Overlay';
  const resultArea = diagnostics?.resultArea ?? resultRow?.stats?.area ?? null;
  const vertices = diagnostics?.outputVertexCount ?? resultRow?.stats?.vertices ?? null;
  const triangles = diagnostics?.outputTriangleCount ?? resultRow?.stats?.triangles ?? null;
  const overlap =
    diagnostics?.overlapArea ??
    (committed.firstArea != null && committed.secondArea != null && resultArea != null
      ? Math.max(0, committed.firstArea + committed.secondArea - resultArea)
      : null);
  const exact = diagnostics != null || resultRow?.status === 'CURRENT';
  return (
    <dl
      className="grid grid-cols-[auto_1fr] gap-x-2 rounded border border-slate-700 p-2"
      data-cad-compose-summary={diagnostics != null ? 'exact' : 'post-commit'}
    >
      <Detail label="Result surface" value={resultRow?.name ?? 'composing…'} />
      <Detail label={`${firstLabel} “${committed.firstName}”`} value={area(diagnostics ? diagnostics.baseOnlyArea + diagnostics.overlapArea : committed.firstArea)} />
      <Detail label={`${secondLabel} “${committed.secondName}”`} value={area(diagnostics?.overlayArea ?? committed.secondArea)} />
      <Detail label="Overlap" value={area(overlap)} />
      <Detail label="Result area" value={area(resultArea)} />
      <Detail label="Vertices" value={vertices ?? '—'} />
      <Detail label="Triangles" value={triangles ?? '—'} />
      <Detail
        label="Seam length"
        value={diagnostics ? `${diagnostics.seamLength.toFixed(3)} m` : 'worker path (not measured)'}
      />
      <Detail
        label="Max mismatch"
        value={diagnostics ? `${diagnostics.maxSeamMismatch.toFixed(6)} m` : 'worker path (not measured)'}
      />
      <Detail
        label="Verdict"
        value={exact
          ? <span className="text-emerald-300">Exact</span>
          : <span className="text-amber-200">Pending</span>}
      />
    </dl>
  );
};
