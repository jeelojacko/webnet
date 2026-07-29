export const modeButtonClassName = (active: boolean) =>
  `pointer-events-auto rounded border px-2 py-1 text-[11px] ${
    active
      ? 'border-cyan-400 text-cyan-200'
      : 'border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'
  }`;

export const panelButtonClassName =
  'pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40';

export const rowButtonClassName =
  'pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200';

export const inputClassName =
  'rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400';
