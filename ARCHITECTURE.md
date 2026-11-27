# Offline-First POS for a Boutique Apparel Store — Architecture

> **Status:** v1.0 (MVP design) · **Author:** Udara Kurukulasooriya · **Last updated:** 2026-11
>
> This document answers Part A of the brief (§3–§10) and records the decisions the MVP in this repository is built on. Hosting prices were checked in November 2026 — re-check before production.

---

## 0. Summary for the shop owner (plain English)

- **The till works with or without Wi-Fi.** Scanning, discounts, payments, receipts and returns all happen on the tablet itself. The internet is only used to send a copy of each sale to the cloud.
- **Every sale gets its receipt number instantly**, even offline. Receipt numbers can never repeat, even if the tablet is restarted halfway through a sale.
- **When Wi-Fi comes back, everything uploads on its own**, oldest first. The badge in the corner always shows the state: *Online*, *Offline · 4 unsynced receipts*, or *Syncing…*.
- **If both counters sell the last item while offline, both sales are kept.** The customer has paid, so nothing is cancelled. The system shows stock as −1 and asks you to do a quick count, which usually uncovers a missed delivery scan or an unrecorded return.
- **Running cost is about US$8 per month** (§8). Because the shop never waits on the cloud, a cloud outage only delays the upload. It never stops sales.

---

## 1. Scope, requirements and assumptions

### 1.1 Functional (from the brief)
| # | Requirement | Where it's covered |
|---|---|---|
| F1 | Products with size/colour variants, unique SKU/barcode, price, stock | §6, §7.1 |
| F2 | Search by name or scan/type SKU to add to cart | §7.2, §9 |
| F3 | Adjust qty, % or fixed discount, tax (10% GST) | §6.4, §7.2 |
| F4 | Cash (with change) or card; printable receipt with unique ID | §7.3, §7.5 |
| F5 | Offline receipt lookup and return that restores stock and queues refund sync | §7.4 |
| F6 | 100% offline reload and sale; immediate local stock deduction; live sync badge | §4, §7 |
| F7 | Auto-push of queued sales/returns in chronological order on reconnect | §4.4 |
| F8 | Live deployment, pre-seeded demo catalogue; printing | §8, §7.5 |

### 1.2 Non-functional
- **Checkout under 10 s** for a typical 1–3 item sale, online or offline.
- **Zero lost and zero duplicated receipts** across refreshes, crashes and dropped connections.
- **US$0–25/month** for 1 store, 2 terminals and 4,000 variants.
- **Non-Windows**: runs on iPad, Android tablet, Chromebook or macOS.

### 1.3 Assumptions (stated so they can be challenged)
- Australian shop: AUD, **10% GST included in shelf prices** (configurable), **cash totals rounded to 5c**, card totals exact.
- Hardware: a USB or Bluetooth barcode scanner in keyboard (HID) mode, an 80 mm thermal printer installed as an OS printer, and a **standalone EFTPOS terminal** for cards. The POS records the card result; it does not process card data.
- About 150 sales per day, 1–3 lines each. Terminals stay inside the shop.
- Catalogue edits (back office) happen online. Selling and returns must work offline.

---

## 2. Architecture overview

**Core principle: the cloud is never on the checkout path.** Each terminal is a complete POS with its own database. The cloud is the shared record that terminals reconcile with in the background.

```
┌──────────────────────── Terminal (installable PWA, per device) ───────────────────────┐
│                                                                                        │
│  React UI ──► Checkout service ──► Dexie (IndexedDB)                                   │
│   ▲  scanner input      │           ├─ catalogue + in-memory barcode index             │
│   │                     │           ├─ sales / lines / payments / returns              │
│   │ useLiveQuery        │           ├─ stock_movements (local deltas)                  │
│   └─────────────────────┘           └─ OUTBOX (ordered, immutable events)              │
│                                            │                                           │
│  Service worker (Workbox): precached app shell → app reloads with no network           │
│  Sync worker (single per device via Web Locks) ──────────┐                             │
└──────────────────────────────────────────────────────────┼─────────────────────────────┘
                                         HTTPS  push ▲ ▼ pull
┌──────────────────────────────────────────────────────────┼─────────────────────────────┐
│  API (NestJS on Render)                                  │                             │
│   /v1/sync/push  → idempotent, per-terminal ordered event apply                        │
│   /v1/sync/pull  → catalogue / price / inventory changes since cursor                  │
│   /v1/admin/*    → catalogue management, discrepancy queue, reports                    │
│                         │                                                              │
│  PostgreSQL (Neon) ── append-only stock ledger, sync_inbox, sales, returns             │
│  Nightly pg_dump (GitHub Actions) → object storage (Cloudflare R2)                     │
└────────────────────────────────────────────────────────────────────────────────────────┘
   Static hosting for the PWA: Cloudflare Pages
```

---

## 3. Tech stack and rationale (Part A · Q1a)

### 3.1 Choices

| Layer | Choice | Why | Considered |
|---|---|---|---|
| Client app | **React + Vite + TypeScript, installable PWA** (`vite-plugin-pwa` / Workbox) | Runs on any non-Windows tablet or laptop with no app store. A static SPA can be precached completely, so it reloads offline. | Next.js (SSR adds nothing offline). React Native/Capacitor (adds packaging; only needed for native printer SDKs later). |
| Local storage | **IndexedDB via Dexie.js** | Real transactions (sale + stock + outbox written atomically), indexes for barcode and receipt lookup, versioned migrations, `liveQuery` for a reactive badge. | localStorage (synchronous, ~5 MB, no transactions). SQLite-WASM/OPFS (heavier setup, weaker Safari support; overkill at this scale). RxDB/PowerSync (good, but hides the sync design this brief is assessing). |
| Shared domain | **`packages/core` (TypeScript)**: money, tax, discount allocation, promotions, Zod event contracts | The **same pricing code** runs on the terminal (offline) and on the server (validation). One contract for both ends. | Duplicating logic in two languages. |
| API | **NestJS** (TypeScript) + Zod validation + `@nestjs/throttler` | Structured modules, guards and pipes. Same language as the client, so `core` is imported directly. | ASP.NET Core (equally suitable, but would duplicate `core`). Supabase RPC-only (see §8.4). |
| ORM | **Prisma** (plus raw SQL for the hot sync path where needed) | Typed schema, migrations, quick to work with. | Drizzle, TypeORM. |
| Cloud DB | **PostgreSQL (Neon)** | The data is relational and integrity-critical: unique constraints give deduplication, transactions give atomic event apply, and SQL gives reconciliation reports. Neon's free plan has scale-to-zero, does not pause projects, and includes branching for restore tests. | MongoDB/Firestore (weaker transactional guarantees, awkward for ledgers and reports). Supabase (pauses free projects after a week of inactivity). |
| Hosting | **Cloudflare Pages** (PWA) · **Render Starter** (API) · **Neon Free** (DB) | Cheapest always-on combination with Git-based deploys. See §8. | Fly.io, Railway, Azure Container Apps. |
| Tests | Vitest · fake-indexeddb · Testcontainers (Postgres) · Playwright | Unit tests for money, integration tests for sync against real Postgres, and end-to-end tests with the browser set to offline. | — |
| CI/CD | GitHub Actions + Pages/Render Git integration | Free, and runs the nightly backup job too. | — |

### 3.2 How the local storage layer was chosen
Criteria, in priority order:
1. **Atomic multi-record writes.** A sale touches 4–5 tables and must never be half-written.
2. **Survives reloads and restarts.**
3. **Indexed lookup** by barcode, SKU and receipt number.
4. **Capacity**: tens of MB.
5. **Works in Safari, Chrome and Firefox.**
6. **Reactive reads** for the UI.

IndexedDB meets all of these. Dexie removes its awkward API while keeping its guarantees.

### 3.3 How the cloud database was chosen
Criteria:
1. **Uniqueness constraints and transactions**, for exactly-once effects (§4.5).
2. **Atomic counters** for `on_hand = on_hand + delta`, with no lost updates when two terminals sync at the same time.
3. **Ad-hoc SQL** for owner reports and discrepancy investigation.
4. **A free or cheap managed tier** with backups we control.

PostgreSQL meets all four. Neon's scale-to-zero suits a shop that is closed 12 hours a day.

---

## 4. Offline sync engine (Part A · Q1b)

### 4.1 Event model
The terminal never sends "the new state". It sends **immutable facts**, in order:

| Event type | Emitted when | Server effect |
|---|---|---|
| `SALE_COMPLETED` | Payment confirmed | Insert sale, lines, payments; one `stock_movement(-qty)` per line |
| `SALE_VOIDED` | Same-day cancel on the same terminal | Mark voided; `stock_movement(+qty, reason='void')` |
| `RETURN_COMPLETED` | Return processed | Insert return, lines, refunds; `+qty` movement for each restocked line |

Envelope, validated by a Zod schema in `packages/core/contracts`:
```ts
{
  eventId: string,      // UUIDv7, generated on the device, never changes
  terminalId: string,
  seq: number,          // per-terminal, gap-free, strictly increasing
  type: 'SALE_COMPLETED' | 'SALE_VOIDED' | 'RETURN_COMPLETED',
  schemaVersion: 1,
  occurredAt: string,   // device clock, ISO-8601 (for reports, never for correctness)
  payload: { ... }      // full sale/return document, including price snapshots
}
```

### 4.2 Writing locally (the checkout commit)
A sale is committed in **one Dexie read-write transaction**:
1. Increment the `receiptSeq` and `outboxSeq` counters in `settings`.
2. Insert the `sale`, `saleLines` and `payments`.
3. Insert one local `stockMovement` per line (`delta = -qty`, `synced = 0`).
4. Insert the `outbox` event `{seq, eventId, type, payload, status:'pending'}`.

If the tab closes, the browser crashes or the battery dies part-way through, IndexedDB rolls the whole transaction back: no partial sale and no skipped receipt number. **Rule: no network call ever happens inside this transaction.** IndexedDB commits automatically when it is idle, so an `await fetch()` inside would break atomicity.

### 4.3 IDs and receipt numbers
- **Internal IDs**: UUIDv7. They are globally unique without coordination and sort by time, which keeps indexes efficient.
- **Human receipt number**: `{storeCode}-{terminalCode}-{seq:6}`, e.g. `S01-T2-000123`. Returns use `R-S01-T2-000017`.
- Uniqueness is structural: each terminal code is unique per store and each counter is local and monotonic. No two devices can produce the same number, even when both are offline.
- **Terminal registration** (online, one time): the owner generates an enrolment code. The device exchanges it for `{terminalId, terminalCode, deviceToken, lastAppliedSeq, receiptSeq, returnSeq}`. If a device is wiped and re-enrolled into the same terminal code, its counters **resume from the server's values**, so numbers never collide.

### 4.4 Push protocol (chronological and resumable)
`POST /v1/sync/push`, with `Authorization: Bearer <deviceToken>`
```jsonc
// request
{ "terminalId": "…", "events": [ /* up to 50, ascending seq */ ] }
// response
{
  "results": [ { "eventId": "…", "seq": 41, "status": "applied" | "duplicate" | "parked" | "rejected", "error": null } ],
  "lastAppliedSeq": 41,
  "inventory": [ { "variantId": "…", "onHand": -1 } ]   // fresh levels for the touched variants
}
```
Server algorithm, per event, **one database transaction each**:
1. `SELECT … FOR UPDATE` on the terminal row. This serialises concurrent pushes from the same device, such as a retry overlapping a slow request.
2. If `sync_inbox` already has `eventId`, return **duplicate** and apply nothing.
3. If `seq ≤ last_applied_seq` with an unknown `eventId`, return **rejected** with `SEQ_REUSED`. The device was probably reset and must re-enrol.
4. If `seq ≠ last_applied_seq + 1`, stop and return `409 {expectedSeq}`. The client resends from that point. **This is what guarantees chronological order.**
5. Validate against the Zod schema. An invalid payload is stored as **rejected** for manual repair, and `last_applied_seq` still advances so one bad event cannot block the queue.
6. Apply the effects (§4.1): `INSERT` the documents, insert `stock_movements`, `UPDATE inventory_levels SET on_hand = on_hand + delta` (atomic; no lost updates between terminals), and raise discrepancies (§5).
7. If a return references a sale the server does not have yet (sold on another terminal that is still offline), store it as **parked** and advance `seq`. It is applied automatically when that sale arrives.
8. Insert into `sync_inbox(event_id PK, …)` and set `last_applied_seq = seq`. Commit.

**Ordering across terminals** does not need coordinating. Events from different terminals touch different documents, and stock effects are additive deltas, which commute. Reports sort by `occurred_at`.

### 4.5 Zero duplicate receipts: failure analysis
At-least-once delivery combined with an idempotent receiver gives an **exactly-once effect**.

| Failure | What happens | Result |
|---|---|---|
| Browser refreshes mid-checkout | IndexedDB transaction rolls back | No sale, no receipt number used. Cashier re-tenders. |
| Refresh after commit, before sync | Event sits in the outbox (persistent) | Synced later, once |
| Connection drops **before** the server commits | Client sees an error and retries the same `eventId` | Applied once |
| Connection drops **after** the server commits, before the response | Client retries; server finds `eventId` in `sync_inbox` and returns `duplicate` | Applied once; client marks it synced |
| Two tabs open on one terminal | Web Locks (`navigator.locks.request('sync')`) allows one sync worker; the server row lock is a backstop | Applied once |
| Same receipt synced twice by a bug | `sales.id` primary key and `receipt_no` unique constraint | The database refuses the duplicate |
| Device wiped with unsynced events | **Data loss risk.** Mitigated by `storage.persist()`, installing as a PWA, an "unsynced for over 2 h" warning, and printed receipts as a paper backup | Visible to staff. Documented in §14. |

### 4.6 Pull protocol (catalogue and inventory down to terminals)
`GET /v1/sync/pull?cursor=<opaque>` returns changed `products`, `variants`, `staff` and `inventory` for the terminal's store, plus `nextCursor` and `lastAppliedSeq`.
- Every response also carries the `store` (`id`, `code`, `name`, `timezone`, `currency`, `taxRateBp`, `pricesIncludeTax`, `cashRoundingCents`), which the terminal needs to price sales and number receipts offline. Configuration changes therefore reach terminals with the next pull.
- The cursor is `(updated_at, id)` with a small overlap window. The client upserts, so receiving a row twice is harmless.
- **Local stock is a projection**: `available = serverOnHand + Σ(unsynced local deltas)`. A pull only overwrites `serverOnHand`. Local sales that have not been sent are never lost by a pull.
- In the same transaction as applying a pull, the client marks every outbox event with `seq ≤ lastAppliedSeq` as synced, along with its local movements. This closes the "server applied it but the ack was lost" gap without counting the sale twice.
- Push and pull share the same Web Lock, so they never interleave.

### 4.7 Triggers, back-off and connectivity
- **Push**: right after each commit (debounced 500 ms), on the `online` event, on `visibilitychange → visible`, and every 30 s **only while the outbox is non-empty**.
- **Pull**: at start-up, then every 5 min while the app is open.
- **Connectivity** is judged by real requests (`GET /v1/health` with a 3 s timeout), not `navigator.onLine`, which reports `true` on captive Wi-Fi.
- The health check is liveness only and never queries the database, so polling it does not keep Neon awake.
- **Back-off**: exponential with jitter, from 1 s up to a 60 s cap. The Background Sync API is not relied on because Safari and Firefox don't support it.
- **Database cost**: pushing only when there is data, and pulling every 5 min, lets Neon scale to zero between bursts and keeps usage well within the free compute allowance (§8.3).

### 4.8 Sync status badge (live, via `useLiveQuery`)
| State | Shown | Condition |
|---|---|---|
| Green | `Online · All synced` | Last request OK, outbox empty |
| Blue | `Syncing · 3` | Push in flight |
| Amber | `Offline · 4 unsynced receipts` | Health check failing, outbox non-empty |
| Red | `Needs attention` | A rejected event, oldest unsynced event over 2 h old, or storage not persisted |

The badge never blocks checkout. Tapping it opens a details sheet: last sync time, pending count, and a "Sync now" button.

---

## 5. Conflict resolution: the −1 linen shirt (Part A · Q1c)

### 5.1 Principle: stock is a ledger, not a number
`stock_movements` is the **append-only source of truth**. `inventory_levels.on_hand` is a cached sum of it. Terminals send **deltas** ("−1, sale S01-T2-000123"), never absolute values ("stock = 0"). Deltas commute, so the order in which terminals sync does not matter.

### 5.2 Walk-through
| Time | Terminal 1 (offline) | Terminal 2 (offline) | Server `on_hand` |
|---|---|---|---|
| t0 | sees 1 | sees 1 | 1 |
| t1 | sells 1 → local 0 | — | 1 |
| t2 | — | sells 1 → local 0 | 1 |
| t3 | reconnects, pushes −1 | — | **0** |
| t4 | — | reconnects, pushes −1 | **−1** → discrepancy raised |
| t5 | both pull: show −1 with a "count needed" marker | | −1 |

- **Both receipts are accepted.** A paid sale is a fact. The garment physically left the shop, which proves the system count was wrong, not the sale.
- **The database allows negative stock on purpose**: there is no `CHECK (on_hand >= 0)`.
- When an apply drives `on_hand < 0`, the server inserts a `stock_discrepancies` row (one open row per store and variant, enforced by a partial unique index) that references the triggering event.
- **Resolution workflow**: the owner's "Count needed" list → physical count → `adjustment` movement with a reason (`missed_receipt`, `unlogged_return`, `theft_or_loss`, `miscount`) → discrepancy resolved. The full audit trail stays in the ledger.
- **Why not last-write-wins?** Both terminals would report "0" and the server would store 0. That hides the error and loses the signal that something upstream (a supplier delivery or a return) was never recorded.

### 5.3 At the till
If local stock is 0 or below, the cart line shows a **non-blocking** amber chip ("System shows 0 — sale allowed"). The item is in the customer's hands, so refusing the sale would only slow the queue.

### 5.4 Other conflicts
| Conflict | Resolution |
|---|---|
| Price changed in the cloud while a terminal was offline | The sale keeps its **snapshot** price (the price the customer paid). The server flags `price_drift` for reporting and does not reject. |
| Variant archived while a terminal was offline | Soft deletes only, so the sale applies normally. |
| Return of a sale made on another terminal still offline | QR on the receipt carries the sale data (§7.4). The server **parks** the return until the sale arrives. |
| Return quantity exceeds the quantity sold (two returns at two terminals) | The server checks `Σ returned ≤ sold` under a row lock. The excess return is stored as `rejected` with `OVER_RETURN` for manager review. The money already handed back is visible in the report rather than silently dropped. |
| Totals recomputed on the server don't match the client | Accept the sale (it is a fact) and add the `total_mismatch` flag. This exposes bugs without punishing the customer. |
| Device clock wrong | Correctness depends only on `seq` and deltas. `received_at` (server time) is stored alongside `occurred_at`. Skew of more than 10 min is flagged. |

---

## 6. Apparel and POS database schema (Part A · Q2)

### 6.1 Entity overview
```
stores 1─* terminals                    products 1─* product_variants
stores 1─* staff                        categories 1─* products
stores *─* product_variants  via inventory_levels  (stock per store)
stock_movements  (ledger: store × variant × delta × reason × source)

sales 1─* sale_lines *─1 product_variants
sales 1─* payments
sales 1─* returns 1─* return_lines *─1 sale_lines
returns 1─* refunds
sync_inbox (one row per received event)      stock_discrepancies
```

### 6.2 PostgreSQL schema (reference DDL; the Prisma schema implements it)
```sql
-- Organisation -----------------------------------------------------------------
CREATE TABLE stores (
  id                  uuid PRIMARY KEY,
  code                text NOT NULL UNIQUE,                -- 'S01'
  name                text NOT NULL,
  timezone            text NOT NULL DEFAULT 'Australia/Sydney',
  currency            char(3) NOT NULL DEFAULT 'AUD',
  tax_rate_bp         int  NOT NULL DEFAULT 1000,          -- basis points: 1000 = 10.00 %
  prices_include_tax  boolean NOT NULL DEFAULT true,
  cash_rounding_cents int  NOT NULL DEFAULT 5,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE terminals (
  id                uuid PRIMARY KEY,
  store_id          uuid NOT NULL REFERENCES stores(id),
  code              text NOT NULL,                         -- 'T1'
  device_token_hash text UNIQUE,                           -- sha256 of the bearer token
  enrolment_code_hash     text UNIQUE,                     -- sha256 of the enrolment code (§11)
  enrolment_code_reusable boolean NOT NULL DEFAULT false,  -- demo terminals only
  enrolment_code_used_at  timestamptz,
  last_applied_seq  bigint NOT NULL DEFAULT 0,
  receipt_seq       bigint NOT NULL DEFAULT 0,             -- high-water marks, for re-enrolment
  return_seq        bigint NOT NULL DEFAULT 0,
  last_seen_at      timestamptz,
  is_active         boolean NOT NULL DEFAULT true,
  UNIQUE (store_id, code)
);

CREATE TABLE staff (
  id        uuid PRIMARY KEY,
  store_id  uuid NOT NULL REFERENCES stores(id),
  name      text NOT NULL,
  role      text NOT NULL CHECK (role IN ('cashier','manager','owner')),
  pin_hash  text NOT NULL,                                 -- PBKDF2; verifiable offline
  is_active boolean NOT NULL DEFAULT true
);

-- Catalogue (shared by all stores) -------------------------------------------------
CREATE TABLE categories (
  id   uuid PRIMARY KEY,
  name text NOT NULL UNIQUE                                -- Shirts, Dresses, Trousers, Accessories
);

CREATE TABLE products (                                    -- parent: "Nike Shirt", "Summer Tee"
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  brand       text,
  category_id uuid REFERENCES categories(id),
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_variants (                            -- "Summer Tee — Navy — L"
  id          uuid PRIMARY KEY,
  product_id  uuid NOT NULL REFERENCES products(id),
  sku         text NOT NULL UNIQUE,                        -- 'TEE-NV-L'
  barcode     text UNIQUE,                                 -- EAN-13 / UPC; may differ from SKU
  size        text NOT NULL,                               -- 'L', '32', 'One Size'
  size_sort   int  NOT NULL DEFAULT 0,                     -- XS<S<M<L<XL display order
  color       text NOT NULL,
  price_cents int  NOT NULL CHECK (price_cents >= 0),      -- shelf price (GST-inclusive in AU)
  cost_cents  int,
  is_active   boolean NOT NULL DEFAULT true,               -- soft delete only
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, size, color)
);
CREATE INDEX ON product_variants (product_id);
CREATE INDEX ON product_variants (updated_at, id);         -- pull cursor

-- Inventory (per store) -----------------------------------------------------------
CREATE TABLE inventory_levels (                            -- cached projection of the ledger
  store_id   uuid NOT NULL REFERENCES stores(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  on_hand    int  NOT NULL DEFAULT 0,                      -- deliberately NO check >= 0
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, variant_id)
);

CREATE TABLE stock_movements (                             -- append-only source of truth
  id          uuid PRIMARY KEY,
  store_id    uuid NOT NULL REFERENCES stores(id),
  variant_id  uuid NOT NULL REFERENCES product_variants(id),
  delta       int  NOT NULL CHECK (delta <> 0),
  reason      text NOT NULL CHECK (reason IN
               ('sale','void','return','receive','adjustment','count','transfer_in','transfer_out')),
  source_type text,                                        -- 'sale' | 'return' | 'adjustment' ...
  source_id   uuid,
  terminal_id uuid REFERENCES terminals(id),
  staff_id    uuid REFERENCES staff(id),
  note        text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON stock_movements (store_id, variant_id, occurred_at);

CREATE TABLE stock_discrepancies (
  id                   uuid PRIMARY KEY,
  store_id             uuid NOT NULL REFERENCES stores(id),
  variant_id           uuid NOT NULL REFERENCES product_variants(id),
  on_hand_at_detection int  NOT NULL,
  trigger_event_id     uuid,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  detected_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at          timestamptz,
  resolved_by          uuid REFERENCES staff(id),
  resolution_note      text
);
CREATE UNIQUE INDEX one_open_discrepancy
  ON stock_discrepancies (store_id, variant_id) WHERE status = 'open';

-- Sync ----------------------------------------------------------------------------
CREATE TABLE sync_inbox (                                  -- idempotency + audit + replay
  event_id    uuid PRIMARY KEY,
  terminal_id uuid NOT NULL REFERENCES terminals(id),
  seq         bigint NOT NULL,
  type        text NOT NULL,
  status      text NOT NULL CHECK (status IN ('applied','parked','rejected')),
  payload     jsonb NOT NULL,
  error       text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  applied_at  timestamptz,
  UNIQUE (terminal_id, seq)
);
CREATE INDEX ON sync_inbox (status) WHERE status <> 'applied';
CREATE INDEX sync_inbox_parked_sale_idx
  ON sync_inbox ((payload ->> 'originalSaleId')) WHERE status = 'parked';

-- Sales ---------------------------------------------------------------------------
CREATE TABLE sales (
  id             uuid PRIMARY KEY,                         -- UUIDv7 generated on the device
  receipt_no     text NOT NULL UNIQUE,                     -- 'S01-T2-000123'
  store_id       uuid NOT NULL REFERENCES stores(id),
  terminal_id    uuid NOT NULL REFERENCES terminals(id),
  staff_id       uuid REFERENCES staff(id),
  customer_id    uuid,                                     -- FK added with loyalty (§10.3)
  status         text NOT NULL CHECK (status IN ('completed','voided')),
  subtotal_cents int  NOT NULL,                            -- Σ qty × unit price
  discount_cents int  NOT NULL DEFAULT 0,                  -- Σ line + allocated cart discounts
  tax_cents      int  NOT NULL,                            -- GST contained / added
  rounding_cents int  NOT NULL DEFAULT 0,                  -- cash 5c rounding (±)
  total_cents    int  NOT NULL,                            -- amount charged
  cart_discount  jsonb,                                    -- {"type":"percent","value":10}
  occurred_at    timestamptz NOT NULL,                     -- device clock
  received_at    timestamptz NOT NULL DEFAULT now(),       -- server clock
  voided_at      timestamptz,
  void_reason    text,
  flags          text[] NOT NULL DEFAULT '{}'              -- 'price_drift','total_mismatch','clock_skew'
);
CREATE INDEX ON sales (store_id, occurred_at);

CREATE TABLE sale_lines (
  id                  uuid PRIMARY KEY,
  sale_id             uuid NOT NULL REFERENCES sales(id),
  line_no             int  NOT NULL,
  variant_id          uuid NOT NULL REFERENCES product_variants(id),
  sku_snapshot        text NOT NULL,
  name_snapshot       text NOT NULL,                       -- 'Linen Shirt — Black / M'
  qty                 int  NOT NULL CHECK (qty > 0),
  unit_price_cents    int  NOT NULL,                       -- price at time of sale
  line_discount_cents int  NOT NULL DEFAULT 0,             -- own + allocated cart discount
  tax_cents           int  NOT NULL,
  line_total_cents    int  NOT NULL,                       -- what the customer paid for this line
  promotion_id        uuid,                                -- FK added with promotions (§10.2)
  UNIQUE (sale_id, line_no)
);

CREATE TABLE payments (
  id             uuid PRIMARY KEY,
  sale_id        uuid NOT NULL REFERENCES sales(id),
  method         text NOT NULL CHECK (method IN ('cash','card')),
  amount_cents   int  NOT NULL,
  tendered_cents int,                                      -- cash only
  change_cents   int,                                      -- cash only
  card_reference text,                                     -- EFTPOS approval/ref; no card data stored
  card_last4     text
);

-- Returns and refunds ---------------------------------------------------------------
CREATE TABLE returns (
  id                 uuid PRIMARY KEY,
  return_no          text NOT NULL UNIQUE,                 -- 'R-S01-T2-000017'
  original_sale_id   uuid NOT NULL REFERENCES sales(id),
  store_id           uuid NOT NULL REFERENCES stores(id),  -- may differ from the sale's store later
  terminal_id        uuid NOT NULL REFERENCES terminals(id),
  staff_id           uuid REFERENCES staff(id),
  reason             text,
  refund_total_cents int  NOT NULL,                        -- Σ return_lines.refund_cents
  rounding_cents     int  NOT NULL DEFAULT 0,              -- cash 5c rounding (±) on the refund
  occurred_at        timestamptz NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON returns (original_sale_id);

CREATE TABLE return_lines (
  id           uuid PRIMARY KEY,
  return_id    uuid NOT NULL REFERENCES returns(id),
  sale_line_id uuid NOT NULL REFERENCES sale_lines(id),
  qty          int  NOT NULL CHECK (qty > 0),
  refund_cents int  NOT NULL,                              -- pro-rata of the net line price
  restock      boolean NOT NULL DEFAULT true               -- false = damaged, no stock movement
);
CREATE INDEX ON return_lines (sale_line_id);

CREATE TABLE refunds (
  id             uuid PRIMARY KEY,
  return_id      uuid NOT NULL REFERENCES returns(id),
  method         text NOT NULL CHECK (method IN ('cash','card','store_credit')),
  amount_cents   int  NOT NULL,
  card_reference text
);

-- updated_at is the pull cursor (§4.6): the database clock stamps every write -----------
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;
CREATE TRIGGER products_set_updated_at BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER product_variants_set_updated_at BEFORE INSERT OR UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER inventory_levels_set_updated_at BEFORE INSERT OR UPDATE ON inventory_levels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```
Invariant enforced in the service layer under `SELECT … FOR UPDATE` on the sale: `Σ return_lines.qty ≤ sale_lines.qty` for every sale line.

**Design notes**
- **Size and colour are explicit columns.** Apparel always has exactly these two axes, and explicit columns keep queries, indexes and the UI simple. If more axes are ever needed (fit, length), move them to `option_types`/`option_values` without changing the sales tables, because sale lines snapshot the name.
- **`store_id` is on everything store-scoped from day one**, so a second store is new data, not a new schema (§10.1).
- **Snapshots on sale lines** (SKU, name, price) keep historical receipts correct after catalogue edits.
- **Money is integer cents everywhere.** Tax rates are in basis points. There are no floats.

### 6.3 Local schema (Dexie, per terminal)
```ts
db.version(1).stores({
  settings:       'key',                    // terminalId, storeId, deviceToken, receiptSeq, returnSeq, outboxSeq, pullCursor
  products:       'id, name, updatedAt',
  variants:       'id, &sku, barcode, productId, updatedAt',
  inventory:      'variantId',              // { variantId, serverOnHand }
  staff:          'id',                     // { id, name, role, pinHash }
  sales:          'id, &receiptNo, occurredAt',
  saleLines:      'id, saleId, variantId',
  payments:       'id, saleId',
  returns:        'id, &returnNo, originalSaleId, occurredAt',
  returnLines:    'id, returnId, saleLineId',
  stockMovements: 'id, variantId, synced',  // synced: 0 | 1 (booleans are not indexable)
  outbox:         'seq, &eventId, status',  // seq assigned explicitly from settings.outboxSeq
});
```
At start-up all active variants (4,000 × ~300 B ≈ 1–2 MB) load into an in-memory `Map<barcode|sku, Variant>` and a pre-lowercased name index, so lookups never touch IndexedDB during a scan.

### 6.4 Money, tax and discount rules (implemented once, in `packages/core`)
1. Line gross = `qty × unit_price_cents`.
2. Line discounts are applied first. A cart discount (percentage or fixed) is then **allocated across lines pro-rata using the largest-remainder method**, so allocations sum exactly to the discount and a partial return refunds the correct net amount.
3. Validation: a percentage is a **whole number** 0–100. A fixed line discount applies to the whole line (not per unit) and is capped at the line gross. The cart discount applies to the total **after** line discounts, and a fixed amount is capped at it. A manager PIN is required when any line's **combined** discount (its own plus its pro-rata share of the cart discount) is strictly above a configurable threshold (default 20%) of the line gross. The comparison uses exact ratios, so cent rounding never triggers it.
4. GST, inclusive mode (AU default): `tax = round(net × rate / (10000 + rate))` per line, summed. Exclusive mode: `tax = round(net × rate / 10000)`, added to the total.
5. Cash payments round the **total** to the nearest 5c, recorded in `rounding_cents`. Card totals are exact.
6. Rounding is half-up on integer cents (halves round away from zero). Property tests assert that totals always reconcile.
7. Returns refund a share of what was paid for the line (including added tax in exclusive mode): `round(line_total × (returned_before + qty) / sold) − round(line_total × returned_before / sold)`. However a line is split across returns, the refunds sum exactly to the line total. `refund_total_cents` is the exact sum of the line refunds; a cash refund is then rounded to 5c, the difference is recorded in `returns.rounding_cents`, and the refund amount is `refund_total_cents + rounding_cents`.

---

## 7. Key flows

### 7.1 Catalogue
The back-office screens (online) create products, generate a size × colour variant matrix, set SKU, barcode, price and initial stock (posted as `receive` movements), and edit or archive. The demo is pre-seeded with about 15 products and about 120 variants. `pnpm --filter api db:seed:large` generates 4,000 variants to demonstrate search and scan performance at the required scale.

### 7.2 Checkout
1. The scan/search box has focus at all times. Scanner keystrokes arrive within about 30 ms of each other and end with Enter; an exact SKU or barcode match adds the item instantly (O(1) map lookup). Scanning the same item again increments its quantity.
2. Typed text runs a name search over the in-memory index (prefix plus token match, top 8 results, arrow keys + Enter to select).
3. The cart allows quantity changes (+/−, or typing a number), a line discount and a cart discount. Totals recalculate synchronously using `core`.

### 7.3 Payment
- **Cash**: quick-tender buttons (Exact, $20, $50, $100) and a keypad. Change due is shown in large type. Completion is disabled while tendered < total.
- **Card**: the cashier runs the EFTPOS terminal, then confirms "Approved?" and optionally enters the reference or last 4 digits. This avoids recording unpaid card sales.
- Completing payment commits the transaction (§4.2), opens the receipt, and triggers a print if auto-print is on.

### 7.4 Returns and voids (fully offline)
- **Lookup**: by receipt number, by scanning the receipt QR code, or by recent sales on this terminal.
- **Receipt QR**: encodes `{saleId, receiptNo, lines:[[variantId, qty, lineTotalCents]]}`, with the lines in `line_no` order (the first entry is line 1). This lets **any** terminal process a return offline, even when the sale was made on the other terminal and has not synced yet. The line total (not a unit price) keeps the refund exact.
- Return lines in `RETURN_COMPLETED` identify the sale line by `saleLineNo`; the server resolves it to `sale_line_id` through the unique `(sale_id, line_no)`.
- Select lines and quantities (capped at sold minus already returned, including local returns not yet synced), the reason, and restock yes/no. The refund method defaults to the original tender.
- This writes a local `+qty` movement (if restocked) and a `RETURN_COMPLETED` outbox event in one transaction, and prints a return receipt.
- **Void** applies only on the same terminal, the same day, with a manager PIN. It emits `SALE_VOIDED`. Later cancellations go through returns.

### 7.5 Receipts and printing
- A receipt view at `/receipt/:id` is rendered from local data. A print stylesheet (`@media print`, `@page { size: 80mm auto; margin: 0 }`, monospace, high contrast) targets 80 mm thermal paper.
- `window.print()` works offline through any OS-installed printer (CUPS on macOS and ChromeOS, AirPrint on iPad, the Android print service).
- Receipt contents: store details and ABN, receipt number, date and time, cashier, lines with size and colour, discounts, the "GST included" amount, payment and change, the QR code, and the returns policy.
- **Future option**: direct ESC/POS printing via WebUSB or Web Serial (Chromium only) for faster printing and cash-drawer kick.

---

## 8. Deployment and monthly cost (Part A · Q3)

### 8.1 Production topology
| Component | Service | Region | Notes |
|---|---|---|---|
| PWA (static) | Cloudflare Pages | Global CDN | Git-integrated builds from `apps/pos`. Immutable hashed assets. The service worker precaches the shell. |
| API | Render web service, **Starter** instance | Singapore | Always on (no spin-down). `prisma migrate deploy` runs on deploy. Health check at `/v1/health`. |
| Database | Neon Postgres, **Free** plan | AWS Singapore (co-located with the API) | Scale-to-zero after 5 idle minutes. 1 GB storage per project. Branching for restore drills. |
| Backups | GitHub Actions nightly `pg_dump` → gzip → age-encrypted → Cloudflare R2 | — | 30 daily plus 12 monthly copies, kept by an R2 lifecycle rule |
| Monitoring | UptimeRobot (health), Sentry (frontend and API errors) | — | Free tiers. Alert when the sync inbox holds rejected or parked events older than 24 h. |

### 8.2 Sizing
- **Catalogue**: 4,000 variants ≈ 2 MB in Postgres; first download to a terminal ≈ 1 MB gzipped.
- **Sales**: ~150 per day × ~2 KB (sale, lines, payment, movements, inbox payload) ≈ **110 MB per year**. The 1 GB free storage lasts several years, and inbox payloads older than 90 days can be pruned.
- **Bandwidth**: about 300 KB per day of sync traffic, plus the app shell (~1–2 MB) once per deploy per terminal. Negligible.

### 8.3 Monthly cost (USD)
| Line item | Recommended setup | Notes |
|---|---|---|
| Frontend hosting | **$0.00** | Cloudflare Pages free tier |
| Backend API | **$7.00** | Render Starter, always on |
| Database | **$0.00** | Neon Free: 1 GB per project, 100 CU-hours per month |
| Bandwidth | **$0.00** | Within the free allowances of all three |
| Automated daily backups | **$0.00** | GitHub Actions minutes plus R2 free tier (≪ 1 GB of dumps) |
| Monitoring and error tracking | **$0.00** | UptimeRobot and Sentry free tiers |
| Domain name | **≈ $1.00** | ≈ $12 per year, amortised |
| **Total** | **≈ US$8 per month** (roughly A$12) | |

**Neon compute check**: Neon's minimum compute is 0.25 CU. Even if the database stayed awake for 12 trading hours every day, that would be 12 h × 30 × 0.25 ≈ 90 CU-hours, still under the 100 CU-hour allowance. Event-driven pushes (§4.7) let it sleep for most of the day, so real usage is far lower. If usage ever outgrows the free plan, Neon Launch is pay-as-you-go at about $0.106 per CU-hour, which adds a few dollars a month.

### 8.4 Alternatives considered
| Option | Monthly | Trade-off |
|---|---|---|
| Demo tier: Render **Free** + Neon Free + Pages | ≈ $0–1 | Render spins down after 15 idle minutes, so the first sync after an idle period waits 30–60 s. **Acceptable because the POS is offline-first**, but not recommended for production. |
| **Supabase Pro** with sync logic as Postgres functions/Edge Functions, no Render | ≈ $25 | Managed daily backups (7 days), no pausing, built-in auth. At the very top of the budget. Supabase **Free** is ruled out: projects pause after a week of inactivity (for example a shop closed over the holidays) and it has no automatic backups. |
| Render Starter API + Render Postgres | ≈ $13+ | One vendor, but costs more than Neon Free and backups are tier-dependent. |

### 8.5 How the budget stays low without hurting reliability
1. **Offline-first moves reliability to the edge.** Each terminal can trade alone indefinitely. The cloud's availability affects how quickly reports update, not whether the shop can sell. That is why a single small instance with no redundancy is acceptable.
2. **Idempotent, resumable sync** means a server restart, deploy or database cold start is just a retry.
3. **Backups we own** (daily, encrypted, off-platform, with a **monthly restore drill into a Neon branch**) rather than paying for a premium tier to get them.
4. **No always-on database compute** thanks to scale-to-zero plus event-driven sync.
5. **Upgrade path**: Neon Launch (for point-in-time restore) and a second Render instance can be added later without changing the architecture.

### 8.6 CI/CD
- **On pull request**: install (pnpm cache) → lint → typecheck → unit tests → API integration tests (Testcontainers Postgres) → build.
- **On `main`**: all of the above, plus the Playwright offline end-to-end tests. Cloudflare Pages and Render then auto-deploy. Database migrations are forward-only and must stay compatible with the previous version.
- **API compatibility**: the sync API is versioned (`/v1`) and accepts `schemaVersion`, so terminals running an older cached PWA keep syncing after a deploy.
- **Nightly**: the backup workflow, plus a weekly check that the latest dump restores.

---

## 9. Shop-floor reality: keeping checkout under 10 seconds (Part A · Q4a)

### Decision 1: local-first, scanner-first checkout (speed)
- **No network call exists on the checkout path.** Lookups, totals, the commit and printing are all local. When the Wi-Fi drops, the cashier notices nothing except the badge turning amber. There is no "offline mode" to switch into.
- The scan field **keeps focus at all times** (it is re-focused after every action, and dialogs return focus to it). HID scanner input is detected by keystroke timing and adds the item instantly from an in-memory map. A beep and a highlight flash confirm each scan. Scanning the same item again increments its quantity.
- **Keyboard and touch shortcuts**: `F2` Cash/Exact, `F3` Card, `F4` Discount, `Esc` clear search. Large tap targets (at least 48 px). "Park sale" holds a half-built cart so the next customer can be served.
- **Typical timing**: scan 2 items (about 2 s) → Cash → $50 → Done (about 3 s) → receipt prints. About 5–6 s in total.

### Decision 2: guard rails that prevent costly mistakes
- **Cash**: completion is blocked while tendered < total. Change due is shown in very large type before the drawer opens. The 5c rounding is shown explicitly.
- **Card**: "Did the EFTPOS terminal approve?" must be confirmed. This prevents the most common queue-pressure mistake: recording a declined card as paid.
- **Manager PIN** (verified offline) for discounts over 20%, quantities over 10 on one line, voids and returns over a threshold.
- **Undo last scan**, and a clear line-item list showing size and colour, so the wrong size is caught before payment.
- The sync badge **informs but never interrupts**. No modal ever appears because of connectivity.

---

## 10. Future-proofing (Part A · Q4b)

### 10.1 Second store (shared catalogue, separate stock)
**Already supported by the schema**:
- Products and variants have no `store_id`, so the catalogue is shared.
- `inventory_levels`, `stock_movements`, `terminals`, `sales` and `returns` all carry `store_id`, so stock and sales are separate per store.

**To open store 2**:
1. Insert a `stores` row (`S02`).
2. Enrol its terminals. Receipt numbers stay globally unique (`S02-T1-…`).
3. The pull endpoint already filters inventory by the terminal's store.

**Additive changes only**:
- `store_prices(store_id, variant_id, price_cents)` for optional price overrides.
- `stock_transfers` that post `transfer_out` and `transfer_in` movements.
- A store filter on reports.
- A cross-store stock lookup ("S02 has 3 in Medium"), online only.
- Cross-store returns already work, because `returns.store_id` can differ from the original sale's store.

**Codebase**: `storeId` is already in every event, query and `core` configuration object (tax rate, rounding). No rewrite is needed.

### 10.2 BOGO and other promotions
- **New tables**: `promotions(id, type, name, buy_qty, get_qty, get_discount_bp, starts_at, ends_at, priority, stackable, is_active)`, `promotion_targets(promotion_id, product_id | variant_id | category_id)` and `promotion_stores(promotion_id, store_id)`.
- **Engine**: a **pure function** in `packages/core`: `applyPromotions(cart, activePromotions, now) → lines with discount_cents and promotion_id`. It is deterministic and unit-tested, and the terminal runs it offline.
  - BOGO = buy 1, get 1 at 100% off; "second item half price" = `get_discount_bp: 5000`.
  - The cheapest eligible item is discounted first.
- **Already in place**: `sale_lines.promotion_id` and line-level discounts. Promotions sync down like the catalogue. The server re-runs the engine only to flag mismatches, never to reprice a completed sale. Returns of promoted items refund the net line price that was actually paid, and the largest-remainder allocation keeps this exact.
- **Edge case**: promotion validity offline is judged by the device clock. Clock skew is flagged on sync (§5.4).

### 10.3 Customer loyalty
- **New tables**:
  - `customers(id, phone_e164 UNIQUE, name, email, marketing_opt_in, created_at)`
  - `loyalty_ledger(id, customer_id, delta_points, reason[earn|redeem|return_clawback|adjust], sale_id, return_id, occurred_at)`

  The balance is `Σ delta_points`. **This is the same ledger pattern as stock**, so offline reconciliation works the same way.
- **Earning offline is safe.** The `SALE_COMPLETED` payload carries `customerId` and the points earned. A returned item claws its points back.
- **Redeeming offline is risky**, because the same points could be spent at both terminals. Redemption is therefore allowed only when the terminal is online, or with a small per-terminal offline cap that is reconciled on sync.
- A customer created offline gets a client-generated UUID. The server merges duplicates by phone number.
- **Privacy**: terminals cache only the minimum (name, last 3 digits of the phone, balance snapshot). Full customer data stays in the cloud. Marketing consent is explicit, in line with the Australian Privacy Act and the Spam Act.

---

## 11. Security
- **Device enrolment** uses a one-time code generated by the owner. Each device gets a random 256-bit bearer token, stored **hashed (SHA-256)** on the server, and can be revoked per terminal. The code is also stored only as a hash, ignores case and spaces, and has a stricter rate limit. Enrolling again replaces the terminal's previous token. The **demo seed** alone marks its codes reusable (`enrolment_code_reusable`), so the published demo codes keep working.
- **Staff PINs** are stored as PBKDF2 hashes (WebCrypto), synced to terminals, and verified offline. `hashPin` and `verifyPin` live in `packages/core` (format `pbkdf2-sha256$iterations$salt$hash`, 210,000 iterations), so the server and terminals share one implementation. Roles are cashier, manager and owner. Lockout after 5 failed attempts.
- **Validation**: every sync payload is validated by a Zod schema (shared contract). Prisma uses parameterised queries. The database role used by the API has least privilege (no DDL).
- **Transport**: HTTPS only. CORS restricted to the POS origin. Helmet headers. Rate limiting through `@nestjs/throttler`.
- **No cardholder data is stored** (only the EFTPOS reference and optionally the last 4 digits), which keeps the POS out of PCI scope.
- **Secrets** live only in Render and GitHub encrypted environment variables. Dependabot plus `pnpm audit` run in CI.
- **Data on the device**: IndexedDB is not encrypted at rest. This is mitigated by the device lock screen, managed tablets, and keeping minimal personal data locally.

---

## 12. Testing strategy
| Level | Tooling | What it proves |
|---|---|---|
| Unit (`core`) | Vitest, property tests | Totals reconcile. Discount allocations sum exactly. GST inclusive and exclusive. 5c rounding. Return refund calculation. |
| Unit (POS data layer) | Vitest + fake-indexeddb | The checkout transaction is atomic. Counters are gap-free. Projected stock is correct. The outbox is ordered. |
| Integration (API) | Vitest + Testcontainers Postgres | A duplicate push applies once. A sequence gap returns 409. Concurrent terminals produce −1 and one discrepancy. A parked return is applied when its sale arrives. Over-return is rejected. |
| End-to-end | Playwright | Go offline (`context.setOffline(true)`) → reload → sell 3 → badge shows "3 unsynced" → reconnect → server has exactly 3. Two browser contexts as two terminals → −1 scenario. Offline return. Print view renders. |
| Manual | Real tablet + scanner + thermal printer | HID scan timing, print layout, PWA install, storage persistence |

---

## 13. Edge-case catalogue
| Area | Edge case | Handling |
|---|---|---|
| Storage | Browser evicts IndexedDB | `navigator.storage.persist()`, installed PWA, badge warns if not persisted |
| Storage | Device lost or wiped with unsynced data | Unsynced-age warning (over 2 h is red), printed receipts as a paper trail, re-enrolment resumes counters |
| Storage | Schema upgrade with unsynced data | Additive Dexie `version().upgrade()`. The outbox is never dropped. The server accepts older `schemaVersion`s. |
| App | Service-worker update during a sale | `registerType: 'prompt'`; update only applied between sales |
| App | Two tabs on one device | Web Locks give a single sync worker; BroadcastChannel keeps the badge in step |
| Sync | Ack lost after server commit | Duplicate detection plus `lastAppliedSeq` reconciliation on pull |
| Sync | Captive portal reports "online" | Health check with timeout determines connectivity |
| Sync | Long outage (days) | Outbox is unbounded in practice (~2 KB per sale); batches of 50 on reconnect |
| Sync | Corrupt or invalid event | Stored as `rejected` for repair, queue continues, red badge, owner alert |
| Stock | Negative stock | Allowed. Discrepancy raised. Count workflow. |
| Stock | Unknown barcode | "Misc item" (manager PIN, typed price), flagged for catalogue fix |
| Stock | Duplicate barcode across variants | Prevented by a unique constraint; the import validator reports conflicts |
| Money | Discount > subtotal, % > 100, negative | Validated in `core`; capped or rejected in the UI |
| Money | Rounding drift between client and server | Single implementation in `core`; mismatch flagged, never rejected |
| Money | Cash rounding on returns | Refund the original line net amounts. Cash refunds are rounded to 5c, and the difference is recorded. |
| Payments | Card terminal declined but cashier tapped Done | Explicit "Approved?" confirmation |
| Payments | Split tender (part cash, part card) | Schema supports multiple payments; MVP UI offers a single tender (stretch goal) |
| Returns | Sale made on the other, still-offline terminal | QR on the receipt, server-side parking |
| Returns | Over-return across terminals | Row-locked check; excess rejected for manager review |
| Returns | Damaged item | `restock = false`, so no stock movement |
| Time | Device clock wrong or timezone | Ordering by `seq`; `received_at` stored; skew flagged; store timezone used for "today" |
| Printing | Printer offline or out of paper | Receipt stays viewable and reprintable from history; a digital receipt link can be added later |
| Security | Stolen tablet | Revoke its device token. Unsynced data on it is lost, so the unsynced warning matters. |

---

## 14. Trade-offs, risks and next steps
- **A device's unsynced data lives in one place until it syncs.** This is the inherent cost of true offline use. It is mitigated by prompt sync, warnings and paper receipts. A future option is LAN peer-to-peer replication between the two terminals (for example WebRTC) so each holds the other's unsynced sales.
- **Safari/iPad** has stricter storage policies and no Background Sync. The app should be installed to the home screen and kept open during trading.
- **A single API instance and region** is acceptable because of offline-first (§8.5). Add a second instance before running many stores.
- **Hand-rolled sync** was chosen to show and control the design. For a larger product, PowerSync or ElectricSQL would be evaluated.
- **Next**:
  1. Integrated payments (for example Stripe Terminal or a local acquirer), including their offline-authorisation rules.
  2. Split tender.
  3. ESC/POS direct printing and cash drawer.
  4. Digital receipts by SMS or email (queued offline).
  5. End-of-day Z-report and cash-up.
  6. A CSV catalogue import with a barcode validator.

---

## Appendix A — API summary (`/v1`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness check, also used for connectivity |
| POST | `/terminals/enrol` | enrolment code | Returns device token, terminal code and counter high-water marks |
| POST | `/sync/push` | device token | Ordered, idempotent event ingest (§4.4) |
| GET | `/sync/pull?cursor=` | device token | Catalogue, staff and inventory deltas plus `lastAppliedSeq` (§4.6) |
| GET | `/receipts/:receiptNo` | device token | Online receipt lookup across terminals |
| CRUD | `/admin/products`, `/admin/variants` | owner session | Catalogue management, variant matrix |
| POST | `/admin/stock/adjustments` | owner session | Receive, count and adjustment movements |
| GET/PATCH | `/admin/discrepancies` | owner session | Count-needed queue and resolution |
| GET | `/admin/sync/issues` | owner session | Parked and rejected inbox events |

## Appendix B — Glossary
- **Outbox**: an ordered local queue of immutable events waiting to be sent.
- **Idempotent**: applying the same event twice has the same effect as applying it once.
- **Ledger**: append-only movements whose sum is the current quantity.
- **Parked event**: an event received before the event it depends on; applied automatically later.
