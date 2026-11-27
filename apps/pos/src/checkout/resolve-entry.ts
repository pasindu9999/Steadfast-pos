/** What Enter does in the search box (ARCH §7.2). A scanned code never comes through here. */
import type { CatalogEntry, CatalogIndex } from '../catalog/catalog-index';

export type EntryResolution =
  { type: 'add'; entry: CatalogEntry } | { type: 'not_found'; code: string } | { type: 'none' };

export function resolveEntry({
  query,
  results,
  highlighted,
  catalog,
}: {
  query: string;
  results: readonly CatalogEntry[];
  /** The result moved to with the arrow keys, if any. */
  highlighted: number | null;
  catalog: CatalogIndex;
}): EntryResolution {
  const code = query.trim();
  if (code === '') return { type: 'none' };
  const chosen = highlighted === null ? undefined : results[highlighted];
  const entry = chosen ?? catalog.lookup(code) ?? results[0];
  return entry ? { type: 'add', entry } : { type: 'not_found', code };
}
