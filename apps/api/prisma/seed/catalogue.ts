/** Fictional demo catalogue (ARCH §7.1). */
export const CATEGORIES = ['Shirts', 'Dresses', 'Trousers', 'Accessories'] as const;
type Category = (typeof CATEGORIES)[number];

const COLOUR_CODES = {
  Assorted: 'AST',
  Black: 'BLK',
  Camel: 'CAM',
  Champagne: 'CHP',
  Charcoal: 'CHA',
  Coral: 'COR',
  Emerald: 'EMR',
  Ivory: 'IVO',
  Natural: 'NAT',
  Navy: 'NVY',
  Olive: 'OLV',
  Rust: 'RST',
  Sage: 'SAG',
  Sand: 'SND',
  Sky: 'SKY',
  Stone: 'STN',
  Tan: 'TAN',
  Terracotta: 'TER',
  White: 'WHT',
} as const;
type Colour = keyof typeof COLOUR_CODES;

const GARMENT_SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
const ONE_SIZE = 'One Size';

export interface SeedProduct {
  code: string;
  name: string;
  category: Category;
  priceCents: number;
  sizes: readonly string[];
  colours: readonly Colour[];
}

export interface SeedVariant {
  sku: string;
  barcode: string;
  size: string;
  sizeSort: number;
  color: string;
  priceCents: number;
  openingStock: number;
}

function garment(
  code: string,
  name: string,
  category: Category,
  priceCents: number,
  colours: Colour[],
): SeedProduct {
  return { code, name, category, priceCents, colours, sizes: GARMENT_SIZES };
}

function accessory(code: string, name: string, priceCents: number, colours: Colour[]): SeedProduct {
  return { code, name, category: 'Accessories', priceCents, colours, sizes: [ONE_SIZE] };
}

export const DEMO_PRODUCTS: readonly SeedProduct[] = [
  garment('LIN', 'Linen Shirt', 'Shirts', 8900, ['Black', 'White', 'Sage']),
  garment('OXF', 'Oxford Shirt', 'Shirts', 7900, ['White', 'Sky', 'Navy']),
  garment('TEE', 'Summer Tee', 'Shirts', 3500, ['Navy', 'White', 'Coral']),
  garment('WRP', 'Wrap Dress', 'Dresses', 12900, ['Black', 'Terracotta', 'Olive']),
  garment('SLP', 'Slip Dress', 'Dresses', 11900, ['Champagne', 'Black', 'Emerald']),
  garment('TLR', 'Tailored Trouser', 'Trousers', 10900, ['Charcoal', 'Navy', 'Stone']),
  garment('WDL', 'Wide-Leg Linen Pant', 'Trousers', 9900, ['Sand', 'Black', 'White']),
  accessory('BLT', 'Leather Belt', 4500, ['Black', 'Tan']),
  accessory('TOT', 'Canvas Tote', 2900, ['Natural', 'Black']),
  accessory('SCF', 'Silk Scarf', 3900, ['Ivory', 'Rust', 'Navy']),
  accessory('BNE', 'Wool Beanie', 2500, ['Charcoal', 'Camel']),
  accessory('HAT', 'Straw Hat', 4900, ['Natural']),
  accessory('CRD', 'Leather Card Holder', 3500, ['Black', 'Tan']),
  accessory('SOK', 'Cotton Socks', 1500, ['White', 'Black']),
  accessory('SCR', 'Scrunchie Set', 1200, ['Assorted']),
];

/** Filler for the performance demo: with the 120 demo variants this makes 4,000. */
export function largeCatalogueProducts(): SeedProduct[] {
  const styles = [
    ['Studio Shirt', 'Shirts', 6900],
    ['Weekend Tee', 'Shirts', 2900],
    ['City Dress', 'Dresses', 9900],
    ['Everyday Trouser', 'Trousers', 8500],
  ] as const;
  return Array.from({ length: 194 }, (_, index) => {
    const [style, category, priceCents] = styles[index % styles.length]!;
    const number = String(index + 1).padStart(3, '0');
    const colours: Colour[] = ['Black', 'White', 'Navy', 'Sage'];
    return garment(`G${number}`, `${style} ${number}`, category, priceCents, colours);
  });
}

function ean13(first12: string): string {
  const sum = [...first12].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0);
  return `${first12}${(10 - (sum % 10)) % 10}`;
}

/**
 * Expands products into variants. Barcodes use the in-store range starting with 2; each
 * catalogue gets its own `barcodePrefix` so their numbers never collide.
 */
export function buildCatalogue(products: readonly SeedProduct[], barcodePrefix: string) {
  let count = 0;
  return products.map((product) => ({
    product,
    variants: product.sizes.flatMap((size, sizeIndex) =>
      product.colours.map((color): SeedVariant => {
        count += 1;
        const sizeCode = size === ONE_SIZE ? 'OS' : size;
        const sku = `${product.code}-${COLOUR_CODES[color]}-${sizeCode}`;
        return {
          sku,
          barcode: ean13(`${barcodePrefix}${String(count).padStart(9, '0')}`),
          size,
          sizeSort: size === ONE_SIZE ? 0 : sizeIndex + 1,
          color,
          priceCents: product.priceCents,
          // One Linen Shirt in Black / M, so both terminals can sell the last one (ARCH §5.2).
          openingStock: sku === 'LIN-BLK-M' ? 1 : 3 + (count % 10),
        };
      }),
    ),
  }));
}
