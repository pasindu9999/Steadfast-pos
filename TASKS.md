# TASKS.md — Build Plan

Phases are ordered so that **a working, deployed, offline-capable POS exists as early as possible**. Final polish comes last (Phase 9).
Each task has an ID, acceptance criteria (AC) and a rough estimate. Tick `[x]` only when the AC pass (see "Definition of done" in `CLAUDE.md`).

**Legend:** 🟥 must-have for submission · 🟨 should-have · 🟩 stretch
**Total estimate:** must-haves ≈ 26 h; everything including should-haves ≈ 33 h. If time is short, use the **Cut list** at the bottom.

**Suggested Claude Code prompt per task:**
> "Implement TASKS.md item P3-2. Read ARCHITECTURE.md §4.2 and §6.3 first. Write the tests first, then the code. Run lint/typecheck/tests and report the results. Tick the box when the AC pass."

---

## Phase 0 — Repo and tooling foundation (≈ 2 h)
- [x] **P0-1** 🟥 Scaffold the pnpm + Turborepo monorepo: `apps/pos` (Vite React TS), `apps/api` (NestJS), `packages/core`, `packages/tsconfig`, `e2e/`.
  - AC: `pnpm install && pnpm build` succeeds; `pnpm dev` starts both apps.
- [x] **P0-2** 🟥 ESLint (typescript-eslint, react-hooks), Prettier, strict tsconfig, `.editorconfig`, `.gitignore`, `.env.example` per app.
  - AC: `pnpm lint` and `pnpm typecheck` pass on the empty scaffold.
- [x] **P0-3** 🟥 Vitest set up in `core`, `pos` and `api`; `docker-compose.yml` with Postgres 17 for local dev.
  - AC: a sample test passes in each workspace; `docker compose up -d db` gives a reachable database.
- [ ] **P0-4** 🟥 GitHub Actions `ci.yml`: install (pnpm cache) → lint → typecheck → test → build.
  - AC: green run on the first push.
- [x] **P0-5** 🟥 Add a `LICENSE` (PolyForm Noncommercial 1.0.0 or "All rights reserved") and a README stub with the project name and "Demo / assessment project" notice. Make sure `ARCHITECTURE.md`, `CLAUDE.md` and `TASKS.md` are in the repo root.
  - AC: files present in the repo root.

## Phase 1 — Domain core: `packages/core` (≈ 3 h)
- [x] **P1-1** 🟥 Money utilities: integer-cents guards, `formatAUD`, half-up rounding, `roundCash5c`.
  - AC: tests cover 0, 1c, 2c, 3c, 7c and large values.
- [x] **P1-2** 🟥 Tax: GST inclusive and exclusive modes, rates in basis points (ARCH §6.4).
  - AC: $25.00 inclusive → $2.27 GST; exclusive mode gives the correct added tax; per-line tax sums to the cart tax.
- [x] **P1-3** 🟥 Discounts: line discounts (% or fixed), cart discount allocated pro-rata with the largest-remainder method, validation (0–100%, cap at subtotal, manager threshold flag).
  - AC: property test confirms allocations always sum exactly to the discount; no negative line totals.
- [x] **P1-4** 🟥 `calculateCart(lines, cartDiscount, storeConfig, tender)` → `{ lines[], subtotal, discount, tax, rounding, total }`.
  - AC: snapshot tests for 5 representative carts, including cash-rounded totals.
- [x] **P1-5** 🟥 Return refund calculation: `refundForLines(saleLines, returnQtys)` using net line prices.
  - AC: refunding all lines equals the sale total minus rounding; partial returns are exact.
- [x] **P1-6** 🟥 Receipt and return number formatters and parsers (`S01-T2-000123`, `R-S01-T2-000017`).
- [x] **P1-7** 🟥 Zod contracts: event envelope, `SALE_COMPLETED`, `SALE_VOIDED`, `RETURN_COMPLETED` payloads, push/pull request and response DTOs, error codes.
  - AC: types are exported with `z.infer`; valid and invalid fixture tests.

## Phase 2 — Cloud: database and sync API (≈ 5 h)
- [x] **P2-1** 🟥 Prisma schema implementing ARCH §6.2: all tables, unique and partial indexes; `on_hand` with no `>= 0` check. Use a raw SQL migration for the partial unique index.
  - AC: `db:migrate` succeeds on a clean database; the schema matches the DDL.
- [x] **P2-2** 🟥 Seed script: 1 store (S01), 2 terminals (T1, T2) with enrolment codes, staff (cashier PIN 1111, manager PIN 9999), 4 categories, about 15 products and 120 variants (sizes XS–XL, 3–4 colours), stock via `receive` movements. Include **"Linen Shirt — Black / M" with qty 1** for the conflict demo. Add `db:seed:large` for 4,000 variants.
  - AC: the seed is idempotent; the large seed completes in under 30 s.
- [x] **P2-3** 🟥 `GET /v1/health`, config via a Zod-validated env, Helmet, CORS allow-list, throttler, Pino logging, standard error shape.
- [x] **P2-4** 🟥 `POST /v1/terminals/enrol` (enrolment code → device token, stored hashed) and a device-token auth guard.
  - AC: an invalid or revoked token returns 401; re-enrolling returns the counter high-water marks.
- [x] **P2-5** 🟥 `POST /v1/sync/push` implementing ARCH §4.4 steps 1–8 (row lock, duplicate, `SEQ_REUSED`, gap → 409, validate, apply, inbox, advance seq), with one transaction per event. Response includes the fresh inventory for touched variants.
- [x] **P2-6** 🟥 Event appliers: `SALE_COMPLETED` (sale, lines, payments, movements, atomic `on_hand += delta`, discrepancy on < 0, server recompute → `total_mismatch` flag), `SALE_VOIDED`, `RETURN_COMPLETED` (over-return check under lock; parking when the sale is missing; re-apply parked events after a sale is inserted).
- [x] **P2-7** 🟥 `GET /v1/sync/pull?cursor=`: products, variants, staff, inventory for the terminal's store, `nextCursor` and `lastAppliedSeq`.
- [ ] **P2-8** 🟥 Integration tests (Testcontainers):
  - duplicate push applies once
  - gap returns 409 with `expectedSeq`
  - seq reuse is rejected
  - **concurrent T1 + T2 sales of the last Linen Shirt → on_hand −1, one open discrepancy, both sales stored**
  - a parked return is applied after its sale arrives
  - over-return is rejected
  - an invalid payload is rejected and the queue advances
  - AC: all green in CI.
- [x] **P2-9** 🟨 `GET /v1/receipts/:receiptNo` (online cross-terminal lookup).

## Phase 3 — Terminal: local data layer (≈ 4 h)
- [x] **P3-1** 🟥 Dexie schema per ARCH §6.3, typed tables, `navigator.storage.persist()` request at start-up.
- [x] **P3-2** 🟥 Enrolment screen (one-time, online): enter the API URL and enrolment code, then store the settings and counters.
- [x] **P3-3** 🟥 Initial pull and catalogue bootstrap into Dexie; in-memory `CatalogIndex` (barcode/SKU `Map` plus name token index) built at start-up.
  - AC: with 4,000 variants, index build takes under 300 ms and a scan lookup under 1 ms (measured in a test).
- [x] **P3-4** 🟥 Stock projection: `available = serverOnHand + Σ unsynced local deltas`; a hook `useAvailable(variantId)`.
- [x] **P3-5** 🟥 `commitSale(cart, tender)`: a single Dexie transaction per ARCH §4.2 (counters, sale, lines, payments, movements, outbox event).
  - AC (fake-indexeddb): a forced throw mid-transaction leaves zero rows and an unchanged counter; 100 sequential sales give seq 1..100 with no gaps.
- [x] **P3-6** 🟥 Offline staff PIN verification (PBKDF2 via WebCrypto) for login and manager overrides.

## Phase 4 — Terminal: checkout UI (≈ 4 h)
- [x] **P4-1** 🟥 App shell and layout: scan/search bar (always focused), cart panel, totals panel, sync badge slot, cashier login.
- [x] **P4-2** 🟥 Scanner and search input: HID timing detection plus Enter → exact match add; text → top-8 name results with keyboard navigation; same scan increments quantity; beep and flash feedback; "not found" toast with a misc-item option (manager PIN).
- [x] **P4-3** 🟥 Cart: quantity +/−/edit, remove, undo last scan, line discount, cart discount (% or $), manager PIN above the threshold, amber "system shows 0" chip.
- [x] **P4-4** 🟥 Payment: Cash (quick tender buttons, keypad, change in large type, block when tendered < total, 5c rounding shown) and Card ("Approved?" confirmation plus optional reference/last 4).
- [x] **P4-5** 🟥 Receipt view (`/receipt/:id`) from local data, with the QR code (ARCH §7.4 payload).
- [x] **P4-6** 🟨 Keyboard shortcuts (F2 Cash, F3 Card, F4 Discount, Esc), "park sale".

## Phase 5 — Terminal: sync engine and status badge (≈ 3 h)
- [x] **P5-1** 🟥 Sync worker inside `navigator.locks.request('sync')`: push pending outbox events in `seq` batches of 50; handle `applied`/`duplicate`/`parked` (mark synced) and `rejected` (mark failed, red badge); handle 409 by resending from `expectedSeq`.
  - AC: the network call happens outside Dexie transactions; acks are applied in a new transaction.
- [x] **P5-2** 🟥 Triggers and connectivity: after-commit (500 ms debounce), `online`, `visibilitychange`, a 30 s timer only while pending, pull every 5 min; health check with a 3 s timeout; exponential backoff with jitter (1 s → 60 s).
- [ ] **P5-3** 🟥 Pull apply: upsert the catalogue, set `serverOnHand`, mark outbox events with `seq ≤ lastAppliedSeq` and their movements as synced, all in **one transaction**; rebuild the index if the catalogue changed.
- [ ] **P5-4** 🟥 Sync status badge with `useLiveQuery` (green, blue, amber, red states per ARCH §4.8), a details sheet with last sync time, pending count and a "Sync now" button. BroadcastChannel keeps the badge in step across tabs.

## Phase 6 — Returns and voids (≈ 2.5 h)
- [ ] **P6-1** 🟥 Receipt lookup offline: by receipt number, recent sales list, and QR scan or paste (decode the QR payload for sales from the other terminal).
- [ ] **P6-2** 🟥 Return flow: select lines and quantities (capped at sold minus returned, including unsynced local returns), reason, restock toggle, refund method defaults to the original tender; `commitReturn` in one transaction (+movements, outbox `RETURN_COMPLETED`); return receipt.
- [ ] **P6-3** 🟨 Void: same terminal, same business day, manager PIN → `SALE_VOIDED`.

## Phase 7 — PWA offline shell and printing (≈ 2 h)
- [ ] **P7-1** 🟥 `vite-plugin-pwa`: precache the app shell, `navigateFallback` to `index.html`, `registerType: 'prompt'`, an update toast that only applies between sales; web manifest and icons (installable).
  - AC: DevTools → Offline → hard reload → the app loads and can make a sale.
- [ ] **P7-2** 🟥 Print stylesheet for 80 mm thermal paper (`@page { size: 80mm auto; margin: 0 }`), a Print button, an auto-print-after-sale setting, and reprint from history.
  - AC: print preview fits 80 mm with no clipping and the QR code is legible.

## Phase 8 — Deployment, back office and end-to-end tests (≈ 4 h)
- [ ] **P8-1** 🟥 Neon project (Singapore), Render web service (Singapore, Starter or Free for the demo) with `prisma migrate deploy`, Cloudflare Pages for `apps/pos` with `VITE_API_URL`; production seed run.
  - AC: the public URLs work, and a demo terminal can be enrolled using codes listed in the README.
- [ ] **P8-2** 🟥 Minimal back office (online): product list, create a product plus the size × colour variant matrix, edit price/SKU/barcode, receive stock (movement), archive.
  - AC: a new product appears on the terminal after the next pull.
- [ ] **P8-3** 🟨 Owner screens: discrepancy "count needed" list with an adjustment and reason; sync issues (parked and rejected); today's sales.
- [ ] **P8-4** 🟥 `backup.yml`: nightly `pg_dump` → gzip → encrypt → upload to R2 (or a private artifact as a fallback), plus documented restore steps.
- [ ] **P8-5** 🟥 Playwright end-to-end tests:
  - (a) offline reload + 3 sales → badge "3 unsynced" → online → server has exactly 3
  - (b) two contexts as T1/T2, both offline, both sell the Linen Shirt M/Black → reconnect → both receipts on the server, on_hand −1, discrepancy present
  - (c) offline return restores local stock and syncs
  - (d) receipt print view renders
  - AC: green locally and in CI on `main`.
- [ ] **P8-6** 🟨 Uptime monitor on `/v1/health`; Sentry DSNs set via env (optional).

## Phase 9 — Final polish and submission (≈ 3–4 h, last)
- [ ] **P9-1** 🟨 UI polish: consistent spacing and typography, empty and loading states, toasts, size ordering XS→XL, colour swatches, tablet layout check (iPad and Android sizes).
- [ ] **P9-2** 🟨 Accessibility pass: keyboard-only checkout, focus outlines, aria-live for scan feedback and badge changes, contrast check.
- [ ] **P9-3** 🟨 Performance check with `db:seed:large`: time a scan to the cart updating, cold start offline. Record the numbers in the README.
- [ ] **P9-4** 🟥 README.md: overview, live URLs, demo enrolment codes and PINs, a 2-minute "how to test offline" script (DevTools → Offline steps, two-tab conflict demo), local setup, scripts, architecture link, known limitations.
- [ ] **P9-5** 🟥 Final review of `ARCHITECTURE.md`: matches what was built; mark anything designed but not built as "Designed, not built in MVP".
- [ ] **P9-6** 🟥 Demo watermark: footer and receipt header "Demo — © Udara Kurukulasooriya"; demo data only.
- [ ] **P9-7** 🟨 Screen recording (2–3 min): offline sale → badge → reconnect sync → −1 conflict → offline return → print. Link it in the README.
- [ ] **P9-8** 🟥 Submission: repo link, live URL, short email/WhatsApp summary highlighting the sync guarantees and the cost (≈ US$8/month).

---

## Suggested 5-day schedule
| Day | Focus | Tasks |
|---|---|---|
| 1 | Foundation and domain | P0-*, P1-*, start P2-1/P2-2 |
| 2 | Cloud sync | P2-3 → P2-8 (integration tests green) |
| 3 | Terminal data and checkout | P3-*, P4-1 → P4-5 |
| 4 | Sync, returns, offline, print, deploy | P5-*, P6-1/P6-2, P7-*, P8-1, P8-2 |
| 5 | Tests and polish | P8-4, P8-5, Phase 9 |

**Checkpoint rule:** by the end of Day 4 there must be a deployed URL where an offline sale syncs. If not, cut stretch items and finish the core path first.

## Cut list (drop in this order if behind)
1. P9-1 / P9-2 depth (keep it basic but tidy)
2. P8-6 monitoring, P9-7 video (describe them in the README instead)
3. P4-6 shortcuts and park sale
4. P6-3 void (document it as designed)
5. P8-3 owner screens (show the discrepancy via an API response or a SQL query in the README)
6. P2-9 online receipt lookup

**Never cut:** P3-5 atomic commit, P2-5/P2-6 idempotent ordered sync, P2-8 / P8-5(a,b) tests, P7-1 offline reload, P9-4 README, P9-5 ARCHITECTURE review.

---

## Follow-ups (log items found during work; don't fix silently)
- **Handoff, Phase 4 built (P4-1 to P4-6):** login, scan and search, cart, discounts and approval (`staff/`, `checkout/`), cash and card, receipt with QR (`print/`), F2–F4 and Esc, parked sales.
- **Handoff, for sync (P5):** `ui/SyncBadgeSlot` is empty; every sale is saved by `completeSale`, so trigger the after-commit push there; nothing on the till calls the API.
- **Handoff, for returns and print (P6, P7):** `receiptQrSchema` in core reads the QR; `loadReceipt` and `/receipt/:id` can serve history and reprint.
- **Handoff, decisions made:** manager PIN rules, 50 ms scanner gap, `MISC` placeholder, change capped at $1,000, parked sales kept in `settings` (ARCH §6.3, §7.2–§7.4, §9).
- **Handoff, working here:** screen tests start with `// @vitest-environment jsdom` and use `test/render.tsx` and `test/key-clock.ts`; rules live in plain modules beside the components.
- **P5 / P8-3:** a misc item is sold on the `MISC` variant (price 0, no stock), so the server will flag `price_drift` and open a stock discrepancy for it. The server should exempt it.
- **No task yet:** a sale does not record which manager approved a discount, quantity or misc item.
- **P6-1:** a sale of more than about 45 lines has no QR code (ARCH §7.4).
- **P7-1:** the sale on the till and the cashier login are in memory, so a reload or app update loses them (parked sales survive).
- **P7-2:** the receipt has no print button, print styles, ABN, returns policy or SKUs, and can be reopened only by its address until history exists.
- **P9-1:** the cash dialog needs scrolling on screens under about 820 px high.
- **P9-1:** on a tablet, the always-focused scan box may keep opening the on-screen keyboard.
- **No task yet:** while a dialog is open a scan cannot confirm it, but its characters still land in the focused field.
- **No task yet:** any cashier can resume or discard any parked sale, approvals included, and parked sales never expire.
- **P9-3:** the till has been run in headless desktop Chrome, not on a tablet or with a real scanner (including PIN hashing speed). The POS bundle is over 500 kB (about 170 kB gzipped).
- **Handoff, Phase 3 built (P3-1 to P3-6):** `apps/pos` has the Dexie database (`db/`), enrolment, API client and pull (`sync/`), catalogue index and `useAvailable` (`catalog/`), `commitSale` (`checkout/`) and PIN checks (`staff/`).
- **Handoff, for the UI (P4):** call `commitSale(cart, tender)` with price, SKU and name snapshots from the `CatalogIndex` entry; word each `CheckoutError` code for the cashier; log in with `listLoginStaff` then `verifyStaffPin` (`minRole: 'manager'` for approvals).
- **Handoff, for sync (P5):** send outbox rows without `status`; apply acks and the push response's `inventory` in one new transaction; `pullOnce` is ready to be scheduled under the Web Lock.
- **Handoff, decisions made:** re-enrolling is refused; `https` API only (`http` on localhost); pull already marks events up to `lastAppliedSeq` synced; 5 wrong PINs lock one person for 5 minutes (ARCH §6.3, §11).
- **Handoff, working here:** POS tests run on `fake-indexeddb` with no DOM (`src/test/` has the fixtures); ESLint allows `fetch` only in `sync/api-client.ts`; rebuild `@pos/core` after changing it.
- **No task yet:** synced stock movements and sent outbox events are never pruned, so each variant's movement history grows.
- **No task yet:** the PIN lock follows the device clock, nobody can unlock it early, and clearing site data removes it.
- **Handoff, Phase 2 built (P2-1 to P2-9):** schema, demo seed, enrolment and device auth, ordered idempotent push with the three appliers, snapshot pull and receipt lookup, all covered by Testcontainers tests. The API the terminal needs for Phases 3–6 is complete; admin endpoints are Phase 8.
- **Handoff, client rules for push:** mark `applied`, `duplicate` and `parked` as synced and show `rejected` as needing attention; on `409` resend from `expectedSeq`; `SEQ_REUSED` means enrol again; a batch is at most 50 events in ascending `seq` (ARCH §4.4).
- **Handoff, client rules for pull:** send back `nextCursor`, upsert (rows repeat for 60 s), treat `isActive: false` as retired, and mark events up to `lastAppliedSeq` synced in the same transaction as the new stock levels (ARCH §4.6).
- **Handoff, decisions made:** stored UUIDs are lower-cased by the contracts; a paid sale is only flagged; the rejection codes are in ARCH §4.4; locks go terminal row, sale id, sale row, then stock in order, and a deadlocked event is retried three times.
- **Handoff, working here:** start Docker before `pnpm test:int` (about 3 minutes); rebuild `@pos/core` after changing it; new API modules go in `app.module.ts`; `apps/api/test/helpers` builds shops, events and pushes.
- **Handoff, Phase 1 built:** `@pos/core` has money, GST, discounts, `calculateCart`, refunds, receipt/return numbers and Zod event/push/pull contracts, all imported from the package root.
- **Handoff, pricing decisions:** whole-percent discounts; manager PIN when one line's combined discount is above 20%; only cash rounds to 5c; refunds are exact shares of the line total, with cash rounding kept in `roundingCents` (ARCH §6.4).
- **Handoff, contract decisions:** return lines use `saleLineNo` (the QR carries line totals, ARCH §7.4); pull includes `store` (§4.6); schemas check shape and limits, never arithmetic.
- **P0-4:** `ci.yml` passes when its steps run locally (Windows). Its new `test:int` step has not run in CI. Tick this after a push shows a green run.
- **P5-1 / P6-2:** a terminal is not told when a return it saw as `parked` is later rejected (for example `OVER_RETURN`). It shows only in `sync_inbox`.
- **No task yet:** `ShortcutsAndParking.test.tsx` ("ignores them on an empty cart") failed once in a full run and passed on every rerun; it may fire the key before the listener is attached.
- **P8-3:** nothing lists or replays rejected events, or parked returns whose sale never arrives or was rejected.
- **No task yet:** the server does not recompute refund amounts, return totals or refund rounding, and `returns` has no flags column. It does not enforce the same-day void rule either.
- **No task yet:** contracts allow any int4 quantity. An absurd one is accepted and flagged `total_mismatch`; only one that overflows a stock column is rejected. Consider a cap in `core`.
- **P2-8:** all scenarios pass locally and the `test:int` CI step is added. Tick it after CI shows a green run.
- **P8-2 / P9-1:** pull sends `categoryId` but no category names, so the terminal can't show or filter by category.
- **No task yet (needed with P5):** a device that is already enrolled can't enrol again (revoked token, `SEQ_REUSED`). It must keep unsynced events and set each counter to the higher of local and server.
- **P5-3:** `applyPull` already does all of ARCH §4.6 and the app rebuilds the index through `liveQuery`; the lock and triggers are in place. Rows repeated by the 60 s overlap still rebuild the index (about 30 ms for 4,000 variants).
- **P5-3 / P6-2:** once a pull acknowledges a `parked` return, its restock leaves the local figure until the server has the sale and applies it.
- **P8-2:** a catalogue write transaction must finish within 60 s, or the pull cursor can miss its rows. Back-office writes must also go through the database, whose trigger stamps `updated_at`.
- **P8-5:** add the `e2e` script, and a Playwright CI job on `main` (ARCH §8.6).
- **No task yet:** `pnpm audit` in CI and Dependabot (ARCH §11).
- **No task yet:** `stores` has no column for the ABN printed on receipts (ARCH §7.5) or for the manager discount threshold (`core` defaults it to 20%).
- **P6-2 / P8-2:** `commitSale` keeps sales within the contract limits. Returns must still keep `reason` to 500 characters, and the back office should limit SKUs to 64 and names so that `Name — Colour / Size` fits 200.
- **P4-2:** a "misc item" has no variant, but `sale_lines.variant_id` and the `SALE_COMPLETED` contract require one.
- **P6-2:** two terminals that each partially return the same line without knowing of the other can differ from the line total by 1c.
