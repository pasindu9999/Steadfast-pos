import { describe, expect, it } from 'vitest';

import { EMPTY_SCAN_BUFFER, pushKey, SCAN_MAX_GAP_MS, SCAN_MIN_LENGTH } from './scanner';

interface Press {
  key: string;
  /** Milliseconds since the previous key. */
  gap?: number;
  modified?: boolean;
  repeat?: boolean;
}

/** The codes found while typing the keys. */
function scansOf(presses: Press[]): string[] {
  let buffer = EMPTY_SCAN_BUFFER;
  let at = 1000;
  const found: string[] = [];
  for (const { key, gap = 10, modified = false, repeat = false } of presses) {
    at += gap;
    const result = pushKey(buffer, { key, at, modified, repeat });
    buffer = result.buffer;
    if (result.scan !== null) found.push(result.scan);
  }
  return found;
}

const typed = (text: string, gap?: number): Press[] => [...text].map((key) => ({ key, gap }));
const enter = (gap?: number): Press => ({ key: 'Enter', gap });

describe('pushKey', () => {
  it('uses the limits of ARCH §7.2', () => {
    expect(SCAN_MAX_GAP_MS).toBe(50);
    expect(SCAN_MIN_LENGTH).toBe(4);
  });

  it.each(['2000000000077', 'LIN-BLK-M', 'TEE-NVY-L'])(
    'finds a fast %s ending in Enter',
    (code) => {
      expect(scansOf([...typed(code), enter()])).toEqual([code]);
    },
  );

  it('ignores typing at a human pace', () => {
    expect(scansOf([...typed('linen', 150), enter(150)])).toEqual([]);
  });

  it('allows a gap of exactly the limit', () => {
    expect(scansOf([...typed('12345', 50), enter(50)])).toEqual(['12345']);
  });

  it('refuses a gap one millisecond over the limit', () => {
    expect(scansOf([...typed('12345', 51), enter()])).toEqual([]);
  });

  it('needs at least four characters', () => {
    expect(scansOf([...typed('123'), enter()])).toEqual([]);
    expect(scansOf([...typed('1234'), enter()])).toEqual(['1234']);
  });

  it('keeps only the burst after slow typing', () => {
    const presses = [...typed('lin', 150), { key: '9', gap: 150 }, ...typed('312'), enter()];

    expect(scansOf(presses)).toEqual(['9312']);
  });

  it('starts again after a pause in the middle', () => {
    expect(scansOf([...typed('9312'), { key: '3', gap: 200 }, ...typed('45'), enter()])).toEqual(
      [],
    );
  });

  it('ignores Shift and Caps Lock, which scanners send for capitals', () => {
    const presses = [
      { key: 'Shift' },
      { key: 'L' },
      { key: 'Shift' },
      { key: 'I' },
      { key: 'CapsLock' },
      { key: 'N' },
      { key: '1' },
      enter(),
    ];

    expect(scansOf(presses)).toEqual(['LIN1']);
  });

  it.each(['ArrowDown', 'Backspace', 'Tab', 'Escape', 'Unidentified'])(
    'starts again on %s',
    (key) => {
      expect(scansOf([...typed('9312'), { key }, ...typed('45'), enter()])).toEqual([]);
    },
  );

  it('starts again on a shortcut with Ctrl, Alt or Meta', () => {
    const presses = [...typed('9312'), { key: 'v', modified: true }, ...typed('45'), enter()];

    expect(scansOf(presses)).toEqual([]);
  });

  it('is not fooled by a held-down key', () => {
    const held: Press[] = Array.from({ length: 8 }, () => ({ key: '0', gap: 33, repeat: true }));

    expect(scansOf([{ key: '0', gap: 500 }, ...held, enter()])).toEqual([]);
  });

  it('refuses an Enter that comes late', () => {
    expect(scansOf([...typed('9312345'), enter(300)])).toEqual([]);
  });

  it('finds nothing in a lone Enter, or a second one', () => {
    expect(scansOf([enter()])).toEqual([]);
    expect(scansOf([...typed('9312'), enter(), enter()])).toEqual(['9312']);
  });

  it('reads scans one after another', () => {
    const presses = [...typed('1111'), enter(), ...typed('2222'), enter()];

    expect(scansOf(presses)).toEqual(['1111', '2222']);
  });
});
