import type { TenderMethod } from '@pos/core';

const METHODS: { value: TenderMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
];

interface RefundMethodPickerProps {
  value: TenderMethod | null;
  /** How the sale was paid, if this terminal knows. */
  tender: TenderMethod | null;
  onChange: (method: TenderMethod) => void;
}

export function RefundMethodPicker({ value, tender, onChange }: RefundMethodPickerProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold">Refund by</legend>
      <p>
        {tender === null
          ? 'Check the paper receipt for how it was paid.'
          : `The sale was paid by ${tender}.`}
      </p>
      <div className="flex gap-4">
        {METHODS.map((method) => (
          <label
            key={method.value}
            className="flex min-h-12 min-w-28 items-center gap-2 rounded-md border-2 border-slate-500 px-4 text-xl"
          >
            <input
              type="radio"
              name="refund-method"
              value={method.value}
              checked={value === method.value}
              onChange={() => onChange(method.value)}
              className="size-6"
            />
            {method.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
