/** Business days are calendar days in the store's time zone, whatever the device's is. */
function storeDay(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment);
}

export function isSameStoreDay(first: Date, second: Date, timeZone: string): boolean {
  return storeDay(first, timeZone) === storeDay(second, timeZone);
}
