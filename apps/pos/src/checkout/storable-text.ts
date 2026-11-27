/** Removes NUL and half characters, which the server's database refuses. */
export function toStorableText(text: string): string {
  return text.replaceAll('\0', '').replace(/\p{Surrogate}/gu, '');
}

/** A catalogue text cut to a contract limit, never through the middle of a character. */
export function toSnapshot(text: string, maxLength: number): string {
  let snapshot = '';
  for (const character of toStorableText(text)) {
    if (snapshot.length + character.length > maxLength) break;
    snapshot += character;
  }
  return snapshot;
}
