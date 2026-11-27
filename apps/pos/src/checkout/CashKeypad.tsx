import { Button } from '../ui/Button';
import type { KeypadKey } from './tender';

const KEYS: { key: KeypadKey; face: string; name?: string }[] = [
  { key: '7', face: '7' },
  { key: '8', face: '8' },
  { key: '9', face: '9' },
  { key: '4', face: '4' },
  { key: '5', face: '5' },
  { key: '6', face: '6' },
  { key: '1', face: '1' },
  { key: '2', face: '2' },
  { key: '3', face: '3' },
  { key: '.', face: '.', name: 'Decimal point' },
  { key: '0', face: '0' },
  { key: 'backspace', face: '⌫', name: 'Delete last digit' },
];

export function CashKeypad({ onKey }: { onKey: (key: KeypadKey) => void }) {
  return (
    <div role="group" aria-label="Keypad" className="grid grid-cols-3 gap-2">
      {KEYS.map(({ key, face, name }) => (
        <Button key={key} aria-label={name} className="text-xl" onClick={() => onKey(key)}>
          {face}
        </Button>
      ))}
      <Button aria-label="Clear amount" className="col-span-3" onClick={() => onKey('clear')}>
        Clear
      </Button>
    </div>
  );
}
