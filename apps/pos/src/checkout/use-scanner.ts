import { useEffect, useEffectEvent, useRef } from 'react';

import { useServices } from '../ui/context';
import { EMPTY_SCAN_BUFFER, pushKey } from './scanner';

const TEXT_ENTRY = 'input, textarea, select, [contenteditable="true"]';

/** A character typed while a button or nothing has the focus. Space still presses buttons. */
function isStrayTyping({ key, ctrlKey, altKey, metaKey, target }: KeyboardEvent): boolean {
  if (key.length !== 1 || key === ' ' || ctrlKey || altKey || metaKey) return false;
  return !(target instanceof Element && target.matches(TEXT_ENTRY));
}

/**
 * A receipt code is hundreds of characters, and one pause in it would leave only its end. The field
 * it was typed into still has all of it.
 */
function wholeScan(target: EventTarget | null, burst: string): string {
  if (!(target instanceof HTMLInputElement)) return burst;
  const start = target.value.indexOf('{');
  return start >= 0 && target.value.endsWith(burst) ? target.value.slice(start) : burst;
}

/**
 * Watches the whole window, so a scan is read whatever has the focus, and its Enter never presses
 * a button. Typing that has nowhere to go is sent to the scan box. A field marked `data-own-entry`
 * reads its own value on Enter, however fast or slowly it was filled.
 */
export function useScanner(onScan: (code: string) => void): void {
  const { keyTime, scanFocus, stores } = useServices();
  const buffer = useRef(EMPTY_SCAN_BUFFER);
  const scanned = useEffectEvent(onScan);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A held Enter must not press the next button too, such as one on the receipt.
      if (event.key === 'Enter' && event.repeat) event.preventDefault();
      const step = pushKey(buffer.current, {
        key: event.key,
        at: keyTime(event),
        modified: event.ctrlKey || event.altKey || event.metaKey,
        repeat: event.repeat,
      });
      buffer.current = step.buffer;
      const { target } = event;
      const ownEntry = target instanceof Element && target.matches('[data-own-entry]');
      if (event.key === 'Enter' && ownEntry) return;
      if (step.scan !== null) {
        event.preventDefault();
        event.stopPropagation();
        scanned(wholeScan(target, step.scan));
        return;
      }
      if (stores.register.getState().dialog === null && isStrayTyping(event)) scanFocus.focus();
    }
    // Capture: before any field or button sees the key.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [keyTime, scanFocus, stores]);
}
