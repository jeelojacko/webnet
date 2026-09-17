import { buildPointLabelContent } from '../../engine/cad/cadPointLabelStyles';

/**
 * Phase 18D survey-manager non-component shared bits (kept separate so the
 * .tsx companion only exports components for react-refresh).
 */

export const inputClass =
  'rounded border border-slate-600 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-100';

export const buttonClass =
  'rounded border border-slate-600 px-2 py-1 text-[11px] hover:bg-slate-800 disabled:opacity-40';

/** "Copy of X", "Copy of X (2)", ... against taken names (case-insensitive). */
export const nextCopyName = (base: string, taken: readonly string[]): string => {
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  const root = `Copy of ${base}`;
  if (!lower.has(root.toLowerCase())) return root;
  let index = 2;
  while (lower.has(`${root} (${index})`.toLowerCase())) index += 1;
  return `${root} (${index})`;
};

/** Fixed example point for label previews (never a real entity). */
export const LABEL_PREVIEW_EXAMPLE = {
  stationId: '1001',
  x: 0,
  y: 0,
  z: 123.456,
  description: 'IP',
  featureCode: 'CTRL',
};

export const previewLabelText = (style: Parameters<typeof buildPointLabelContent>[1]): string =>
  buildPointLabelContent(LABEL_PREVIEW_EXAMPLE, style);
