import React, { useState } from 'react';
import type { ControlTokenAliasProfile } from '../../engine/fieldToFinish/catalogIo';
import { FieldLineworkControl } from '../../engine/fieldToFinish/featureMetadata';

const CANONICAL_TOKENS = [
  FieldLineworkControl.BEGIN,
  FieldLineworkControl.CONTINUE,
  FieldLineworkControl.END,
  FieldLineworkControl.CLOSE,
  FieldLineworkControl.BREAK,
];

/** Compact vendor-neutral Token→Canonical profile editor (drawing settings). */
export const TokenProfileEditor: React.FC<{
  aliases: ControlTokenAliasProfile;
  onSave: (_aliases: ControlTokenAliasProfile) => void;
}> = ({ aliases, onSave }) => {
  const [draft, setDraft] = useState<ControlTokenAliasProfile | null>(null);
  const active = draft ?? aliases;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(aliases);
  return (
    <div className="grid gap-1 text-[12px]" data-f2f-token-profile>
      <span className="font-semibold" title="Vendor-neutral control-token aliases stored on the drawing; review and generation resolve through them.">
        Control tokens (Token → Canonical)
      </span>
      <div className="grid grid-cols-[1fr_1fr] gap-x-2 gap-y-0.5 font-mono">
        {CANONICAL_TOKENS.map((canonical) => {
          const users = Object.entries(active)
            .filter(([, target]) => target.toUpperCase() === canonical)
            .map(([token]) => token);
          return (
            <label key={canonical} className="flex items-center gap-1">
              <span className="w-20 text-slate-400">{canonical}</span>
              <input
                aria-label={`${canonical} aliases`}
                className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-0.5"
                value={users.join(' ')}
                placeholder="—"
                onChange={(event) => {
                  const next: ControlTokenAliasProfile = { ...active };
                  for (const token of users) delete next[token];
                  for (const token of event.target.value.split(/\s+/).filter(Boolean)) {
                    next[token.toUpperCase()] = canonical;
                  }
                  setDraft(next);
                }}
              />
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800 disabled:opacity-40"
          disabled={!dirty}
          onClick={() => {
            if (draft) onSave(draft);
            setDraft(null);
          }}
          data-f2f-token-save
        >
          Save token profile
        </button>
        {dirty ? <span className="text-[11px] text-slate-500">Review and generation use the saved drawing profile.</span> : null}
      </div>
    </div>
  );
};
