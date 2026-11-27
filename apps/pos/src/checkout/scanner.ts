/**
 * Tells a keyboard-style barcode scanner from a person (ARCH §7.2): its keys arrive a few tens of
 * milliseconds apart and end with Enter. Pure: the caller keeps the buffer.
 */

/** The longest pause inside one scan. Scanners send about every 30 ms; Bluetooth ones jitter. */
export const SCAN_MAX_GAP_MS = 50;
/** Shorter bursts are taken as typing. */
export const SCAN_MIN_LENGTH = 4;

export interface ScanBuffer {
  text: string;
  /** When the last character arrived. */
  lastAt: number;
}

export const EMPTY_SCAN_BUFFER: ScanBuffer = { text: '', lastAt: 0 };

export interface KeyPress {
  /** `KeyboardEvent.key`. */
  key: string;
  /** Milliseconds, on any steady clock. */
  at: number;
  /** Ctrl, Alt or Meta is held. */
  modified: boolean;
  /** The key is being held down. */
  repeat: boolean;
}

export interface ScanStep {
  buffer: ScanBuffer;
  /** The scanned code, when this key completed one. */
  scan: string | null;
}

/** Pressed by scanners between characters, to type capitals. */
const IGNORED_KEYS = new Set(['Shift', 'CapsLock']);

export function pushKey(buffer: ScanBuffer, { key, at, modified, repeat }: KeyPress): ScanStep {
  if (IGNORED_KEYS.has(key)) return { buffer, scan: null };
  const reset: ScanStep = { buffer: EMPTY_SCAN_BUFFER, scan: null };
  if (modified || repeat) return reset;

  const quick = at - buffer.lastAt <= SCAN_MAX_GAP_MS;
  if (key === 'Enter') {
    const complete = quick && buffer.text.length >= SCAN_MIN_LENGTH;
    return { buffer: EMPTY_SCAN_BUFFER, scan: complete ? buffer.text : null };
  }
  // Named keys such as `ArrowDown` are longer than one character.
  if (key.length !== 1) return reset;
  return { buffer: { text: quick ? buffer.text + key : key, lastAt: at }, scan: null };
}
