/** Stand-ins for `window` and `document`, one set per "tab". */
import type { BrowserTargets } from '../sync/triggers';

export function browserTargets(): BrowserTargets {
  const page: { visibilityState: DocumentVisibilityState } = { visibilityState: 'visible' };
  return { window: new EventTarget(), document: Object.assign(new EventTarget(), page) };
}
