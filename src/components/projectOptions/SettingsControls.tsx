import React from 'react';

type SettingsCardProps = {
  title: string;
  tooltip: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
};

export const SettingsCard: React.FC<SettingsCardProps> = ({
  title,
  tooltip,
  children,
  className,
  disabled = false,
}) => (
  <div
    aria-disabled={disabled}
    className={`rounded-md border p-2.5 space-y-2 ${
      disabled
        ? 'border-slate-700 bg-slate-950/45'
        : 'border-slate-600 bg-slate-900/55'
    } ${className ?? ''}`}
  >
    <div
      className={`text-[11px] uppercase tracking-wide border-b pb-1.5 ${
        disabled ? 'text-slate-500 border-slate-700' : 'text-slate-50 border-slate-600'
      }`}
      title={tooltip}
    >
      {title}
    </div>
    {children}
  </div>
);

type SettingsRowProps = {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
  className?: string;
};

export const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  tooltip,
  children,
  className,
}) => (
  <label
    className={`settings-row grid gap-1 md:grid-cols-[minmax(0,1fr)_minmax(150px,210px)] md:items-center text-[10px] uppercase tracking-wide text-slate-100 ${className ?? ''}`}
    title={tooltip}
  >
    <span>{label}</span>
    <div>{children}</div>
  </label>
);

type SettingsToggleProps = {
  checked: boolean;
  disabled?: boolean;
  title: string;
  onChange: (_checked: boolean) => void;
};

export const SettingsToggle: React.FC<SettingsToggleProps> = ({
  checked,
  disabled,
  title,
  onChange,
}) => (
  <label className="inline-flex items-center gap-2 text-xs normal-case tracking-normal text-slate-100">
    <span className="relative inline-flex h-6 w-11 items-center">
      <input
        title={title}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="absolute inset-0 rounded-full bg-slate-600 transition-colors peer-checked:bg-blue-500 peer-disabled:cursor-not-allowed peer-disabled:bg-slate-800" />
      <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5 peer-disabled:opacity-80" />
    </span>
    <span className={`${disabled ? 'text-slate-400' : 'text-slate-100'}`}>
      {checked ? 'Enabled' : 'Disabled'}
    </span>
  </label>
);
