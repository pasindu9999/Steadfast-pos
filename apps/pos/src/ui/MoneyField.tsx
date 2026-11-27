import { useId, type ComponentProps } from 'react';

type MoneyFieldProps = Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
};

/** A dollar amount as typed. It is turned into cents by `@pos/core`, never here. */
export function MoneyField({ label, value, onChange, error, ...props }: MoneyFieldProps) {
  const errorId = useId();
  return (
    <div className="space-y-1">
      <label className="block">
        <span className="block">{label}</span>
        <input
          autoFocus
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          className="min-h-12 w-full rounded-md border-2 border-slate-500 px-3 text-xl"
          {...props}
        />
      </label>
      {error !== null && (
        <p id={errorId} role="alert" className="font-semibold text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
