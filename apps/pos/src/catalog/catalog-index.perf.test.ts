/** TASKS.md P3-3: with 4,000 variants, build under 300 ms and look up a barcode under 1 ms. */
import type { PullProduct, PullVariant } from '@pos/core';
import { describe, expect, it } from 'vitest';

import { productFixture, variantFixture } from '../test/fixtures';
import { createTestDb } from '../test/test-db';
import { buildCatalogIndex } from './catalog-index';
import { loadCatalogIndex } from './load-catalog-index';

const PRODUCTS = 200;
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const COLOURS = ['Black', 'White', 'Navy', 'Sage'];
const VARIANTS = PRODUCTS * SIZES.length * COLOURS.length;
const LOOKUPS = 20_000;

const barcode = (n: number) => `210${String(n).padStart(10, '0')}`;

function catalogue(): { products: PullProduct[]; variants: PullVariant[] } {
  const styles = ['Studio Shirt', 'Weekend Tee', 'City Dress', 'Everyday Trouser'];
  const products = Array.from({ length: PRODUCTS }, (_, p) =>
    productFixture({ id: `p${p}`, name: `${styles[p % styles.length]} ${p}` }),
  );
  const variants = products.flatMap((product, p) =>
    SIZES.flatMap((size, s) =>
      COLOURS.map((color, c) => {
        const n = p * SIZES.length * COLOURS.length + s * COLOURS.length + c;
        return variantFixture({
          id: `v${n}`,
          productId: product.id,
          sku: `G${p}-${color.slice(0, 3).toUpperCase()}-${size}`,
          barcode: barcode(n),
          size,
          sizeSort: s + 1,
          color,
        });
      }),
    ),
  );
  return { products, variants };
}

const ms = (value: number) => `${value.toFixed(4)} ms`;

describe(`CatalogIndex performance with ${VARIANTS} variants`, () => {
  const { products, variants } = catalogue();

  it('builds in under 300 ms and looks up a barcode in under 1 ms', () => {
    const buildStart = performance.now();
    const index = buildCatalogIndex(products, variants);
    const buildMs = performance.now() - buildStart;

    // Spread across the catalogue, in an order the maps can't benefit from.
    const wanted = Array.from({ length: LOOKUPS }, (_, i) => (i * 7919) % VARIANTS);
    const timings = wanted.map((n) => {
      const code = barcode(n);
      const start = performance.now();
      const entry = index.lookup(code);
      const elapsed = performance.now() - start;
      if (entry?.variantId !== `v${n}`) throw new Error(`wrong variant for ${code}`);
      return elapsed;
    });
    timings.sort((a, b) => a - b);
    const average = timings.reduce((sum, t) => sum + t, 0) / timings.length;
    const p99 = timings[Math.floor(timings.length * 0.99)]!;

    const searchStart = performance.now();
    const results = index.search('shirt black m');
    const searchMs = performance.now() - searchStart;

    console.info(
      [
        `index build (${index.size} variants): ${ms(buildMs)}`,
        `barcode lookup over ${LOOKUPS} scans: average ${ms(average)}, p99 ${ms(p99)}, ` +
          `max ${ms(timings.at(-1)!)}`,
        `name search "shirt black m" (information only): ${ms(searchMs)}`,
      ].join('\n'),
    );
    expect(index.size).toBe(4000);
    expect(results).toHaveLength(8);
    expect(buildMs).toBeLessThan(300);
    expect(average).toBeLessThan(1);
    expect(p99).toBeLessThan(1);
  });

  it('also loads from IndexedDB (timed for information only: this one is in memory)', async () => {
    const database = createTestDb();
    await database.products.bulkAdd(products);
    await database.variants.bulkAdd(variants);

    const start = performance.now();
    const index = await loadCatalogIndex(database);
    console.info(`load from fake-indexeddb and build: ${ms(performance.now() - start)}`);

    expect(index.size).toBe(VARIANTS);
  });
});
