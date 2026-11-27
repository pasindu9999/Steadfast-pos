import { MISC_SKU } from '@pos/core';
import { describe, expect, it } from 'vitest';

import { buildCatalogIndex } from '../catalog/catalog-index';
import { productFixture, variantFixture } from '../test/fixtures';
import { resolveEntry } from './resolve-entry';

const catalog = buildCatalogIndex(
  [
    productFixture({ id: 'p1', name: 'Linen Shirt' }),
    productFixture({ id: 'pm', name: 'Miscellaneous item' }),
  ],
  [
    variantFixture({ id: 'black', sku: 'LIN-BLK-M', barcode: '2000000000077', color: 'Black' }),
    variantFixture({ id: 'white', sku: 'LIN-WHT-M', color: 'White' }),
    variantFixture({ id: 'misc', productId: 'pm', sku: MISC_SKU }),
  ],
);

function resolve(query: string, highlighted: number | null = null) {
  const results = catalog.search(query);
  const outcome = resolveEntry({ query, results, highlighted, catalog });
  return outcome.type === 'add' ? outcome.entry.variantId : outcome;
}

describe('resolveEntry', () => {
  it.each(['2000000000077', 'LIN-BLK-M', 'lin-blk-m', '  LIN-BLK-M  '])(
    'adds the exact match for %j',
    (query) => {
      expect(resolve(query)).toBe('black');
    },
  );

  it('adds the first result of a name search', () => {
    expect(resolve('linen')).toBe('black');
  });

  it('adds the result the cashier moved to', () => {
    expect(resolve('linen', 1)).toBe('white');
  });

  it('prefers the highlighted result to an exact match', () => {
    // "lin-blk-m" is a SKU, but the cashier chose from the list.
    const outcome = resolveEntry({
      query: 'LIN-BLK-M',
      results: catalog.search('linen white'),
      highlighted: 0,
      catalog,
    });

    expect(outcome).toMatchObject({ type: 'add', entry: { variantId: 'white' } });
  });

  it('reports an unknown code', () => {
    expect(resolve(' 9999999999999 ')).toEqual({ type: 'not_found', code: '9999999999999' });
  });

  it.each(['', '   '])('does nothing for %j', (query) => {
    expect(resolve(query)).toEqual({ type: 'none' });
  });

  it('never finds the misc placeholder', () => {
    expect(resolve(MISC_SKU)).toEqual({ type: 'not_found', code: MISC_SKU });
  });
});
