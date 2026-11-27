import { createAppUpdater } from './app-updater';

/** The one updater: `main.tsx` starts it and the till shows what it finds. */
export const appUpdates = createAppUpdater();
