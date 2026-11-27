/** Times are stored in UTC and shown in the store's time zone. */
const LOCALE = 'en-AU';

export function formatStoreTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, timeStyle: 'short' }).format(new Date(iso));
}

export function formatStoreDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
