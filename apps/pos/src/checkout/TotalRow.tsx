interface TotalRowProps {
  label: string;
  value: string;
  /** Marks the amount for tests. */
  id: string;
  large?: boolean;
}

export function TotalRow({ label, value, id, large = false }: TotalRowProps) {
  return (
    <p
      data-large={large || undefined}
      className={`flex justify-between gap-4 ${large ? 'text-3xl font-bold' : 'text-lg'}`}
    >
      <span>{label}</span>
      <span data-testid={id} className="tabular-nums">
        {value}
      </span>
    </p>
  );
}
