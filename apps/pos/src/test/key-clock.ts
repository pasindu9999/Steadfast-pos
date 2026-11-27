/**
 * Key times for screen tests. `userEvent` types instantly, which would look like a scanner, so
 * keys are spaced like a person's unless a scan is being simulated.
 */
const TYPING_GAP_MS = 200;
const SCAN_GAP_MS = 5;

export function createKeyClock() {
  let now = 0;
  let gap = TYPING_GAP_MS;
  return {
    read: () => (now += gap),
    async scanning(type: () => Promise<void>): Promise<void> {
      // A pause first, so the burst does not join what was typed before it.
      now += 1000;
      gap = SCAN_GAP_MS;
      try {
        await type();
      } finally {
        gap = TYPING_GAP_MS;
      }
    },
  };
}
