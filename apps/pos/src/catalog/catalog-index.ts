/**
 * The in-memory catalogue (ARCH §6.3): a scan or a search never touches IndexedDB.
 * It holds only what can be sold: active variants of active products.
 */
import { MISC_SKU } from '@pos/core';

import type { ProductRow, VariantRow } from '../db/types';
import { variantDisplayName } from './display-name';

export const SEARCH_LIMIT = 8;

export interface CatalogEntry {
  variantId: string;
  productId: string;
  productName: string;
  brand: string | null;
  size: string;
  sizeSort: number;
  color: string;
  sku: string;
  barcode: string | null;
  priceCents: number;
  displayName: string;
}

export interface CatalogIndex {
  readonly size: number;
  /** The placeholder for unknown items. It is never scanned or searched. */
  readonly miscItem: CatalogEntry | undefined;
  /** An exact barcode or SKU match, trying the exact case first. */
  lookup(code: string): CatalogEntry | undefined;
  /** Entries in which every word of the query starts a word, best matches first. */
  search(query: string, limit?: number): CatalogEntry[];
}

interface Searchable {
  entry: CatalogEntry;
  /** The folded product name, words joined by single spaces. */
  name: string;
  /** Every folded word, each with a space before and after. */
  words: string;
}

/** Ranks a name that starts with the query above any number of exact words. */
const NAME_PREFIX_SCORE = 1000;

const collator = new Intl.Collator('en');

/** Lower-case words without accents: `Crème Wide-Leg` → `creme`, `wide`, `leg`. */
function tokenise(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
}

function sellableEntries(
  products: readonly ProductRow[],
  variants: readonly VariantRow[],
): CatalogEntry[] {
  const activeProducts = new Map(
    products.filter((product) => product.isActive).map((product) => [product.id, product]),
  );
  return variants.flatMap((variant) => {
    const product = activeProducts.get(variant.productId);
    if (!variant.isActive || !product) return [];
    return [
      {
        variantId: variant.id,
        productId: product.id,
        productName: product.name,
        brand: product.brand,
        size: variant.size,
        sizeSort: variant.sizeSort,
        color: variant.color,
        sku: variant.sku,
        barcode: variant.barcode,
        priceCents: variant.priceCents,
        displayName: variantDisplayName(product.name, variant.color, variant.size),
      },
    ];
  });
}

/** Name, then colour, then size from XS to XL. */
function byDisplayOrder(a: CatalogEntry, b: CatalogEntry): number {
  return (
    collator.compare(a.productName, b.productName) ||
    collator.compare(a.color, b.color) ||
    a.sizeSort - b.sizeSort ||
    collator.compare(a.sku, b.sku)
  );
}

export function buildCatalogIndex(
  products: readonly ProductRow[],
  variants: readonly VariantRow[],
): CatalogIndex {
  const sellable = sellableEntries(products, variants);
  const miscItem = sellable.find((entry) => entry.sku === MISC_SKU);
  const entries = sellable.filter((entry) => entry !== miscItem).sort(byDisplayOrder);

  const exact = new Map<string, CatalogEntry>();
  const folded = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    exact.set(entry.sku, entry);
    const key = entry.sku.toUpperCase();
    if (!folded.has(key)) folded.set(key, entry);
  }
  // Barcodes go in second, so a scan wins over another variant's SKU.
  for (const entry of entries) {
    if (entry.barcode === null) continue;
    exact.set(entry.barcode, entry);
    folded.set(entry.barcode.toUpperCase(), entry);
  }

  const searchable: Searchable[] = entries.map((entry) => {
    const name = tokenise(entry.productName);
    const rest = tokenise(`${entry.brand ?? ''} ${entry.color} ${entry.size} ${entry.sku}`);
    return { entry, name: name.join(' '), words: ` ${[...name, ...rest].join(' ')} ` };
  });

  return {
    size: entries.length,
    miscItem,
    lookup(code) {
      const key = code.trim();
      if (key === '') return undefined;
      return exact.get(key) ?? folded.get(key.toUpperCase());
    },
    search(query, limit = SEARCH_LIMIT) {
      const wanted = tokenise(query);
      if (wanted.length === 0) return [];
      const phrase = wanted.join(' ');

      const matches: { entry: CatalogEntry; score: number }[] = [];
      for (const { entry, name, words } of searchable) {
        if (!wanted.every((word) => words.includes(` ${word}`))) continue;
        const exactWords = wanted.filter((word) => words.includes(` ${word} `)).length;
        const score = (name.startsWith(phrase) ? NAME_PREFIX_SCORE : 0) + exactWords;
        matches.push({ entry, score });
      }
      // The sort is stable, so equal scores stay in display order.
      matches.sort((a, b) => b.score - a.score);
      return matches.slice(0, limit).map((match) => match.entry);
    },
  };
}
