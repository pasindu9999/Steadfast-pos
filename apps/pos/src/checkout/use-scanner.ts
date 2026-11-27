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
 * Watches the whole window, so a scan is read whatever has the focus, and its Enter never presses
 * a button. Typing that has nowhere to go is sent to the scan box.
 */
export function useScanner(onScan: (code: string) => void): void {
  const { keyTime, scanFocus, stores } = useServices();
  const buffer = useRef(EMPTY_SCAN_BUFFER);
  const scanned = useEffectEvent(onScan);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const step = pushKey(buffer.current, {
        key: event.key,
        at: keyTime(event),
        modified: event.ctrlKey || event.altKey || event.metaKey,
        repeat: event.repeat,
      });
      buffer.current = step.buffer;
      if (step.scan !== null) {
        event.preventDefault();
        event.stopPropagation();
        scanned(step.scan);
        return;
      }
      if (stores.register.getState().dialog === null && isStrayTyping(event)) scanFocus.focus();
    }
    // Capture: before any field or button sees the key.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [keyTime, scanFocus, stores]);
}
