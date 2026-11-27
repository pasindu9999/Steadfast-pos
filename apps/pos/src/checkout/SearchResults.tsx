import { formatAUD } from '@pos/core';

import type { CatalogEntry } from '../catalog/catalog-index';
import { optionId } from './option-id';

interface SearchResultsProps {
  id: string;
  results: readonly CatalogEntry[];
  highlighted: number | null;
  onPick: (entry: CatalogEntry) => void;
}

export function SearchResults({ id, results, highlighted, onPick }: SearchResultsProps) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Matches"
      className="divide-y divide-slate-300 rounded-md border-2 border-slate-500"
    >
      {results.map((entry, index) => (
        <li
          key={entry.variantId}
          id={optionId(index)}
          role="option"
          aria-selected={index === highlighted}
          // Keeps the focus in the search box.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(entry)}
          className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-1 aria-selected:bg-blue-800 aria-selected:text-white"
        >
          <span className="font-semibold">{entry.displayName}</span>
          <span className="text-sm">{entry.sku}</span>
          <span className="ml-auto tabular-nums">{formatAUD(entry.priceCents)}</span>
        </li>
      ))}
    </ul>
  );
}
