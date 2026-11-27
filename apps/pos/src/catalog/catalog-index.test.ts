import { MISC_SKU } from '@pos/core';
import { liveQuery } from 'dexie';
import { describe, expect, it, vi } from 'vitest';

import { productFixture, variantFixture } from '../test/fixtures';
import { createTestDb } from '../test/test-db';
import { buildCatalogIndex, SEARCH_LIMIT } from './catalog-index';
import { loadCatalogIndex } from './load-catalog-index';

const products = [
  productFixture({ id: 'linen', name: 'Linen Shirt' }),
  productFixture({ id: 'pant', name: 'Wide-Leg Linen Pant' }),
  productFixture({ id: 'creme', name: 'Crème Scarf', brand: null }),
  productFixture({ id: 'gone', name: 'Archived Shirt', isActive: false }),
];

const sizes = ['XS', 'S', 'M', 'L', 'XL'];

const variants = [
  // Deliberately out of size order.
  ...[3, 1, 5, 2, 4].map((sizeSort) =>
    variantFixture({
      id: `lin-${sizeSort}`,
      productId: 'linen',
      sku: `LIN-BLK-${sizes[sizeSort - 1]}`,
      barcode: `200000000000${sizeSort}`,
      size: sizes[sizeSort - 1]!,
      sizeSort,
    }),
  ),
  variantFixture({
    id: 'lin-white',
    productId: 'linen',
    sku: 'LIN-WHT-M',
    barcode: null,
    color: 'White',
  }),
  variantFixture({ id: 'pant-m', productId: 'pant', sku: 'WDL-BLK-M', barcode: '2000000000100' }),
  variantFixture({
    id: 'creme-os',
    productId: 'creme',
    sku: 'SCF-IVO-OS',
    size: 'One Size',
    sizeSort: 0,
    color: 'Ivory',
  }),
  variantFixture({ id: 'retired', productId: 'linen', sku: 'LIN-OLD-M', isActive: false }),
  variantFixture({ id: 'in-retired-product', productId: 'gone', sku: 'ARC-BLK-M' }),
  variantFixture({ id: 'orphan', productId: 'missing', sku: 'ORPHAN' }),
];

const index = buildCatalogIndex(products, variants);
const found = (query: string, limit?: number) =>
  index.search(query, limit).map((entry) => entry.variantId);

describe('CatalogIndex contents', () => {
  it('holds only sellable variants', () => {
    expect(index.size).toBe(8);
    for (const code of ['LIN-OLD-M', 'ARC-BLK-M', 'ORPHAN']) {
      expect(index.lookup(code)).toBeUndefined();
    }
    expect(found('archived')).toEqual([]);
  });

  it('describes a variant as the cart and receipt show it', () => {
    expect(index.lookup('LIN-BLK-M')).toEqual({
      variantId: 'lin-3',
      productId: 'linen',
      productName: 'Linen Shirt',
      brand: 'Harbour & Co',
      size: 'M',
      sizeSort: 3,
      color: 'Black',
      sku: 'LIN-BLK-M',
      barcode: '2000000000003',
      priceCents: 8900,
      displayName: 'Linen Shirt — Black / M',
    });
  });
});

describe('lookup', () => {
  it.each([
    ['barcode', '2000000000003'],
    ['SKU', 'LIN-BLK-M'],
    ['SKU typed in lower case', 'lin-blk-m'],
    ['code with surrounding spaces', '  2000000000003 \n'],
  ])('finds a variant by %s', (_, code) => {
    expect(index.lookup(code)?.variantId).toBe('lin-3');
  });

  it.each(['', '   ', 'LIN-BLK', '200000000000', 'nope'])('finds nothing for %j', (code) => {
    expect(index.lookup(code)).toBeUndefined();
  });

  it('prefers the barcode when it equals another variant’s SKU', () => {
    const clash = buildCatalogIndex(products, [
      variantFixture({ id: 'by-sku', productId: 'linen', sku: 'CODE-1' }),
      variantFixture({ id: 'by-barcode', productId: 'linen', sku: 'X', barcode: 'CODE-1' }),
    ]);

    expect(clash.lookup('CODE-1')?.variantId).toBe('by-barcode');
    expect(clash.lookup('code-1')?.variantId).toBe('by-barcode');
  });

  it('keeps SKUs that differ only by case apart when typed exactly', () => {
    const clash = buildCatalogIndex(products, [
      variantFixture({ id: 'upper', productId: 'linen', sku: 'AB' }),
      variantFixture({ id: 'lower', productId: 'linen', sku: 'ab', size: 'L' }),
    ]);

    expect(clash.lookup('AB')?.variantId).toBe('upper');
    expect(clash.lookup('ab')?.variantId).toBe('lower');
  });
});

describe('search', () => {
  it.each(['', '   ', '—', '%%'])('returns nothing for %j', (query) => {
    expect(found(query)).toEqual([]);
  });

  it('matches the start of any word, ignoring case', () => {
    expect(found('PAN')).toEqual(['pant-m']);
    expect(found('leg')).toEqual(['pant-m']);
  });

  it('does not match the middle of a word', () => {
    expect(found('inen')).toEqual([]);
  });

  it('needs every word to match', () => {
    expect(found('linen white')).toEqual(['lin-white']);
    expect(found('linen purple')).toEqual([]);
  });

  it('puts an exact size ahead of other prefix matches', () => {
    expect(found('linen black m')).toEqual(['lin-3', 'pant-m']);
    expect(found('shirt s')[0]).toBe('lin-2');
  });

  it('lists names that start with the query first, then colour and size order XS to XL', () => {
    expect(found('linen')).toEqual([
      'lin-1',
      'lin-2',
      'lin-3',
      'lin-4',
      'lin-5',
      'lin-white',
      'pant-m',
    ]);
  });

  it(`returns at most ${SEARCH_LIMIT} results unless told otherwise`, () => {
    expect(SEARCH_LIMIT).toBe(8);
    const many = buildCatalogIndex(
      products,
      Array.from({ length: 20 }, (_, i) =>
        variantFixture({ id: `v${i}`, productId: 'linen', sizeSort: i }),
      ),
    );

    expect(many.search('linen')).toHaveLength(8);
    expect(found('linen', 2)).toEqual(['lin-1', 'lin-2']);
    expect(found('linen', 0)).toEqual([]);
  });

  it('ignores accents in names and in the query', () => {
    expect(found('creme')).toEqual(['creme-os']);
    expect(found('CRÈME')).toEqual(['creme-os']);
  });

  it('matches brand and SKU words', () => {
    expect(found('harbour linen white')).toEqual(['lin-white']);
    expect(found('wdl-blk')).toEqual(['pant-m']);
  });
});

describe('the misc item', () => {
  const misc = variantFixture({ id: 'misc', productId: 'pm', sku: MISC_SKU, priceCents: 0 });
  const miscProduct = productFixture({ id: 'pm', name: 'Miscellaneous item' });
  const withMisc = buildCatalogIndex([...products, miscProduct], [...variants, misc]);

  it('is offered separately', () => {
    expect(withMisc.miscItem?.variantId).toBe('misc');
  });

  it('cannot be scanned, searched or counted', () => {
    expect(withMisc.lookup(MISC_SKU)).toBeUndefined();
    expect(withMisc.lookup('misc')).toBeUndefined();
    expect(withMisc.search('misc')).toEqual([]);
    expect(withMisc.size).toBe(index.size);
  });

  it('is missing when the catalogue has none, or it is retired', () => {
    expect(index.miscItem).toBeUndefined();
    const retired = buildCatalogIndex([miscProduct], [{ ...misc, isActive: false }]);
    expect(retired.miscItem).toBeUndefined();
  });
});

describe('loadCatalogIndex', () => {
  it('builds the index from the local database', async () => {
    const database = createTestDb();
    await database.products.bulkAdd(products);
    await database.variants.bulkAdd(variants);

    const loaded = await loadCatalogIndex(database);

    expect(loaded.size).toBe(8);
    expect(loaded.lookup('2000000000100')?.displayName).toBe('Wide-Leg Linen Pant — Black / M');
  });

  it('is empty before the first pull', async () => {
    expect((await loadCatalogIndex(createTestDb())).size).toBe(0);
  });

  it('rebuilds under liveQuery when the stored catalogue changes', async () => {
    const database = createTestDb();
    const sizes: number[] = [];
    const subscription = liveQuery(() => loadCatalogIndex(database)).subscribe((loaded) =>
      sizes.push(loaded.size),
    );
    await vi.waitFor(() => expect(sizes).toEqual([0]));

    await database.transaction('rw', database.products, database.variants, async () => {
      await database.products.bulkAdd(products);
      await database.variants.bulkAdd(variants);
    });

    await vi.waitFor(() => expect(sizes.at(-1)).toBe(8));
    subscription.unsubscribe();
  });
});
