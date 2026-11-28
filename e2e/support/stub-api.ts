/**
 * Just enough of the API to set up a terminal: health, enrolment and one catalogue. Every answer is
 * parsed with the shared contracts, so the stub cannot drift from them. The real server is tested by
 * `pnpm test:int`.
 */
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  apiErrorSchema,
  enrolResponseSchema,
  hashPin,
  healthResponseSchema,
  pullResponseSchema,
} from '@pos/core';

export const ENROLMENT_CODE = 'E2E-DEMO-T1';
export const CASHIER = { name: 'Casey Cashier', pin: '1111' };

const UPDATED_AT = '2026-11-01T00:00:00.000Z';
const id = (kind: number, n: number) =>
  `${String(kind).repeat(8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Item {
  name: string;
  size: string;
  color: string;
  priceCents: number;
  barcode: string;
}

export const ITEMS = {
  linen: {
    name: 'Linen Shirt',
    size: 'M',
    color: 'Black',
    priceCents: 8900,
    barcode: '2000000000015',
  },
  tee: {
    name: 'Summer Tee',
    size: 'L',
    color: 'Navy',
    priceCents: 3500,
    barcode: '2000000000022',
  },
  // A name long enough to need wrapping on 72 mm paper.
  coat: {
    name: 'Extra-Long Weatherproof Merino Wool Overcoat With Detachable Hood',
    size: 'XL',
    color: 'Heathered Charcoal',
    priceCents: 4999,
    barcode: '2000000000039',
  },
} satisfies Record<string, Item>;

/** Enough different items for a receipt whose code is as dense as codes get. */
export const BULK_ITEMS: Item[] = Array.from({ length: 42 }, (_, index) => ({
  name: `Sock ${index + 1}`,
  size: 'One Size',
  color: 'White',
  priceCents: 500,
  barcode: `20000001${String(index).padStart(5, '0')}`,
}));

async function catalogue() {
  const items = [...Object.values(ITEMS), ...BULK_ITEMS];
  return pullResponseSchema.parse({
    store: {
      id: id(1, 1),
      code: 'S01',
      name: 'Demo Boutique',
      timezone: 'Australia/Sydney',
      currency: 'AUD',
      taxRateBp: 1000,
      pricesIncludeTax: true,
      cashRoundingCents: 5,
    },
    products: items.map((item, index) => ({
      id: id(2, index),
      name: item.name,
      brand: 'Harbour & Co',
      categoryId: null,
      description: null,
      isActive: true,
      updatedAt: UPDATED_AT,
    })),
    variants: items.map((item, index) => ({
      id: id(3, index),
      productId: id(2, index),
      sku: `E2E-${index}`,
      barcode: item.barcode,
      size: item.size,
      sizeSort: index,
      color: item.color,
      priceCents: item.priceCents,
      isActive: true,
      updatedAt: UPDATED_AT,
    })),
    staff: [
      {
        id: id(4, 1),
        name: CASHIER.name,
        role: 'cashier',
        pinHash: await hashPin(CASHIER.pin),
        isActive: true,
      },
    ],
    inventory: items.map((_, index) => ({ variantId: id(3, index), onHand: 100 })),
    nextCursor: 'e2e-cursor',
    lastAppliedSeq: 0,
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export interface StubApi {
  url: string;
  close: () => Promise<void>;
}

export async function startStubApi(): Promise<StubApi> {
  const pull = await catalogue();
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'authorization, content-type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    const route = `${request.method} ${new URL(request.url ?? '/', 'http://stub').pathname}`;
    // The body is not needed: any code enrols the one terminal.
    request.resume();
    if (route === 'GET /v1/health') {
      send(response, 200, healthResponseSchema.parse({ status: 'ok' }));
    } else if (route === 'POST /v1/terminals/enrol') {
      send(
        response,
        200,
        enrolResponseSchema.parse({
          terminalId: id(5, 1),
          terminalCode: 'T1',
          deviceToken: 'e2e-device-token-0123456789abcdef0123',
          lastAppliedSeq: 0,
          receiptSeq: 0,
          returnSeq: 0,
        }),
      );
    } else if (route === 'GET /v1/sync/pull') {
      send(response, 200, pull);
    } else {
      // No push: these tests keep their sales unsynced.
      send(
        response,
        503,
        apiErrorSchema.parse({ error: { code: 'INTERNAL_ERROR', message: 'not in the stub' } }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
