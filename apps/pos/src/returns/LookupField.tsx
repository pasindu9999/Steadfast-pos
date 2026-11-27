import { useRef, type FormEvent } from 'react';

import { Button } from '../ui/Button';
import { useServices } from '../ui/context';

interface LookupFieldProps {
  /** Resolves to whether a sale was found. */
  onEntry: (text: string) => Promise<boolean>;
}

/**
 * The scan box of the Returns screen: a typed receipt number, or a code from a 2D scanner or the
 * clipboard. It reads its own value, so the speed of the scanner doesn't matter.
 */
export function LookupField({ onEntry }: LookupFieldProps) {
  const { scanFocus } = useServices();
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const field = input.current;
    if (!field) return;
    const text = field.value;
    const found = await onEntry(text);
    if (found && field.value === text) field.value = '';
    // Whatever comes next replaces an entry that found nothing.
    else if (!found) field.select();
    field.focus();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex gap-2">
      <input
        ref={(element) => {
          input.current = element;
          scanFocus.set(element);
        }}
        autoFocus
        data-own-entry
        aria-label="Receipt number or receipt code"
        autoComplete="off"
        spellCheck={false}
        placeholder="Scan the receipt code, or type the receipt number"
        className="min-h-14 w-full rounded-md border-2 border-slate-700 px-4 text-xl"
      />
      <Button type="submit" variant="primary" className="min-h-14">
        Find
      </Button>
    </form>
  );
}
