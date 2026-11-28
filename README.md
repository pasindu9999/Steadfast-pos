# Offline-First Apparel POS

> **Demo / assessment project.** MVP quality, demo data only, not for production use.
> © 2026 Udara Kurukulasooriya. All rights reserved (see [LICENSE](LICENSE)).

An offline-first point of sale for a boutique clothing shop. The design is described in
[ARCHITECTURE.md](ARCHITECTURE.md) and the build plan in [TASKS.md](TASKS.md).

**Current state:** the shared domain code and the API (database, demo seed, terminal enrolment,
sync push and pull, receipt lookup) are built. The terminal's local data layer is built too
(enrolment, catalogue download and search index, stock figure, saving a sale offline, PIN checks).
The till has login, scan and search, the cart, discounts and manager approval, cash and card
payment, receipts with a return QR code, keyboard shortcuts and parked sales, all working without
a network. Sales are uploaded and the catalogue refreshed in the background, retrying until the
network is back, and a status badge shows what is still waiting. The built app installs to a home
screen and opens and reloads with no network. Returns work offline too: find a
sale by receipt number, from the recent sales or from its receipt code (also for the other
terminal's sales), then refund it, with a manager PIN where needed. A manager can also void a sale
of the same day on the terminal that made it. Receipts print on 80 mm paper through the browser, with
automatic printing as a setting and reprints from Returns.

## Prerequisites

- Node.js 24
- pnpm 10.34.9 (`npm install -g pnpm@10.34.9`)
- Docker, for the local PostgreSQL database

## Local setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/pos/.env.example apps/pos/.env
docker compose up -d db
pnpm --filter api db:migrate
pnpm --filter api db:seed
pnpm dev
```

The POS runs on <http://localhost:5173> and the API on <http://localhost:3000>
(health check: <http://localhost:3000/v1/health>).

## Trying it offline

Service workers don't run on the Vite dev server, so use the built app (the API must be running, for
enrolment):

```bash
pnpm build
pnpm --filter pos preview      # http://localhost:4173
```

1. Open the app and enrol the terminal.
2. In DevTools → Application → Service workers, check that `sw.js` is **activated**. Reload once, so
   that it controls the page.
3. In DevTools → Network, choose **Offline**.
4. Reload with **Ctrl+R** (a hard reload, Ctrl+Shift+R, skips every service worker and fails).
5. Log in and sell. The badge shows the unsynced receipt.

The preview address is a different origin from the dev server, so it is enrolled separately. When a
new build is served, the till shows "Update available"; it is applied between sales.

On an iPad, add the app to the home screen first and enrol inside it.

## Demo data

| Terminal | Enrolment code (reusable, demo only) |
|---|---|
| T1 | `DEMO-S01-T1` |
| T2 | `DEMO-S01-T2` |

| Staff | Role | PIN |
|---|---|---|
| Casey Cashier | cashier | `1111` |
| Morgan Manager | manager | `9999` |

The seed only adds what is missing, so it is safe to run again. It includes a placeholder product,
SKU `MISC`, which the till uses to sell an item with an unknown barcode.

The codes are reusable only while the API runs with `DEMO_MODE=true` (set in `.env.example` and on
the demo deployment). Enrolling again moves that terminal to the new device, which carries on from
the server's receipt numbers; the old device can no longer sync. If your `apps/api/.env` predates
this setting, add `DEMO_MODE=true` to it.

To set up a terminal, open the POS, enter the API address (`http://localhost:3000` locally; other
hosts need `https`) and an enrolment code. A browser profile can be enrolled once; clear the site's
data to start again.

## Printing

Receipts print through the browser's print dialog, offline, to any printer the device knows. Press
**Print** on a receipt, or tick **Print automatically after each sale** there. Reprint from Returns
(F8): beside a recent sale, or on a looked-up sale and its returns.

In the dialog, for a thermal printer choose its 80 mm roll paper, margins **None** and scale
**100%**. Choosing **Save as PDF** gives one page, 80 mm wide.

Samples, made by the browser tests: [sale receipt](e2e/artifacts/sale-receipt.pdf) and
[return receipt](e2e/artifacts/return-receipt.pdf). The ABN on them is a placeholder.

## Till keys

| Key | Action |
|---|---|
| F2 | Cash; press again for the exact amount |
| F3 | Card |
| F4 | Cart discount |
| F8 | Returns |
| Esc | Close the open step, or clear the search |

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start the POS and API in watch mode |
| `pnpm build` | Build all workspaces |
| `pnpm lint` | ESLint and Prettier check |
| `pnpm format` | Apply Prettier formatting |
| `pnpm typecheck` | TypeScript check in all workspaces |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:int` | API integration tests (needs Docker) |
| `pnpm e2e` | Build the app and run the browser tests (no API or Docker needed); rewrites the sample PDFs |
| `pnpm --filter e2e exec playwright install chromium` | Once, before the first `pnpm e2e` |
| `pnpm --filter pos icons` | Redraw the app icons from `apps/pos/public/icon.svg` |
| `pnpm --filter api db:migrate` | Apply and create Prisma migrations |
| `pnpm --filter api db:seed` | Demo catalogue: 15 products, 120 variants, plus the misc item |
| `pnpm --filter api db:seed:large` | 4,000 variants for the performance demo |
| `pnpm --filter api db:reset` | Drop and recreate the local database (refuses non-local URLs) |

## Deployment and backups

The API runs on Render (`render.yaml`), the database on Neon and the till on Cloudflare Pages, with
a nightly encrypted backup from GitHub Actions. Steps: [docs/DEPLOY.md](docs/DEPLOY.md). Restoring:
[docs/RESTORE.md](docs/RESTORE.md).

## Layout

```
apps/pos            React + Vite terminal app
apps/api            NestJS API with Prisma
packages/core       Shared domain code, used by both apps
packages/tsconfig   Shared TypeScript configs
e2e                 Playwright tests of the built app, with a stub API
```
