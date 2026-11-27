import type { DiscountKind } from './discount-input';

const KINDS: { kind: DiscountKind; label: string }[] = [
  { kind: 'percent', label: 'Percent (%)' },
  { kind: 'fixed', label: 'Dollars ($)' },
];

export function DiscountKindPicker({
  kind,
  onChange,
}: {
  kind: DiscountKind;
  onChange: (kind: DiscountKind) => void;
}) {
  return (
    <fieldset className="flex gap-2">
      <legend className="sr-only">Kind of discount</legend>
      {KINDS.map((option) => (
        <label
          key={option.kind}
          className="flex min-h-12 flex-1 cursor-pointer items-center gap-2 rounded-md border-2 border-slate-500 px-3 font-semibold has-checked:border-blue-800 has-checked:bg-blue-100"
        >
          <input
            type="radio"
            name="discount-kind"
            checked={kind === option.kind}
            onChange={() => onChange(option.kind)}
            className="size-5"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
