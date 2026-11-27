/** Exponential back-off with jitter, from 1 s up to a 60 s cap (ARCH §4.7). */
export const BACKOFF_FIRST_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;

/**
 * How long to wait before retry number `attempt` (from 1): between half and all of a step that
 * doubles each time, so two terminals that lost the network together don't return together.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const step = Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** (Math.max(1, attempt) - 1));
  return Math.round(step / 2 + random() * (step / 2));
}
