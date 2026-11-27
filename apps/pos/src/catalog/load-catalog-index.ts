import type { PosDatabase } from '../db/database';
import { buildCatalogIndex, type CatalogIndex } from './catalog-index';

export async function loadCatalogIndex(database: PosDatabase): Promise<CatalogIndex> {
  // One transaction, so a pull can't change the catalogue between the two reads.
  const [products, variants] = await database.transaction(
    'r',
    database.products,
    database.variants,
    () => Promise.all([database.products.toArray(), database.variants.toArray()]),
  );
  return buildCatalogIndex(products, variants);
}
