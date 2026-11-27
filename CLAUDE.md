# CLAUDE.md — Offline-First Apparel POS

Guidance for Claude Code working in this repository. Read this file fully at the start of every session.

## What this project is
An offline-first Point of Sale for a boutique clothing shop, built as a time-boxed take-home assignment (MVP quality, demo data only).
- `ARCHITECTURE.md` is the **source of truth for design decisions**. Read the relevant section before implementing a feature, and cite it in commit messages (e.g. `feat(sync): idempotent push (ARCH §4.4)`).
- `TASKS.md` is the **build plan**. Work on one task ID at a time, in order, unless told otherwise. Tick the checkbox when the task's acceptance criteria pass.

## Non-negotiable rules (do not violate without asking)
1. **The network is never on the checkout path.** Sales, returns, voids, totals, lookups and printing work entirely from local data. No `fetch` in any UI or checkout code path; only the sync worker talks to the API.
2. **Money is integer cents** (`number`, safe-integer checked). Never floats for money. Tax rates are in basis points. All pricing, tax, discount, rounding and promotion logic lives in `packages/core` and is imported by both the POS app and the API. Never re-implement it.
3. **One Dexie transaction per business action.** A sale commits its sale, lines, payments, stock movements, counter increments and outbox event atomically (ARCH §4.2).
4. **Never `await` anything except Dexie inside a Dexie transaction.** No `fetch`, `setTimeout` or non-Dexie promises; IndexedDB commits automatically when idle. Do network work outside, then open a new transaction.
5. **Events are immutable facts.** IDs are client-generated UUIDv7. `seq` is per-terminal, gap-free and assigned from `settings.outboxSeq` inside the commit transaction. Never mutate a sent event payload.
6. **Stock is a ledger of deltas.** Terminals send deltas, never absolute quantities. Negative stock is allowed (no `CHECK >= 0`). Never implement last-write-wins on quantities (ARCH §5).
7. **The server is idempotent and ordered.** Every push is safe to retry. Apply each event in its own DB transaction with the terminal row locked. Duplicates change nothing and return `duplicate`, or `rejected` again if the event was rejected (ARCH §4.4).
8. **A paid sale is never rejected for business reasons** (stock, price drift, total mismatch). Accept it and add a flag. Only schema-invalid payloads become `rejected`, and the queue still advances.
9. **Validate at boundaries with Zod** schemas from `packages/core/src/contracts`. API request bodies, sync events and env vars are all parsed, never trusted.
10. **No secrets in the repo.** Use `.env` (git-ignored) plus `.env.example`. Never commit tokens, connection strings or real customer data.

## Repository layout
```
apps/
  pos/            React + Vite + TS PWA (terminal UI, Dexie, sync worker)
    src/
      db/         Dexie schema, migrations, repositories
      checkout/   cart state, commit transaction, receipt numbers
      sync/       outbox push, pull, web-lock, backoff, status store
      returns/    lookup, QR decode, return commit
      staff/      offline PIN checks (login, manager approval)
      catalog/    in-memory barcode/name index
      print/      receipt view + print CSS
      admin/      back-office screens (online only)
      ui/         shared components
  api/            NestJS + Prisma (sync, terminals, admin, reports)
    prisma/       schema.prisma, migrations, seed.ts
    src/modules/  sync/, terminals/, catalog/, inventory/, admin/, health/
packages/
  core/           pure TS: money, tax, discounts, promotions, receipt-no format, Zod contracts
  tsconfig/       shared tsconfig bases
e2e/              Playwright tests (offline scenarios, two-terminal conflict)
.github/workflows ci.yml, backup.yml
```
Dependency direction: `apps/* → packages/core`. `packages/core` imports nothing from the apps, and has no DOM or Node-only APIs and no I/O.

## Stack (pin exact versions in package.json at scaffold time)
- Node 24 LTS, pnpm 10 workspaces, Turborepo, TypeScript `strict: true`, ESM.
- POS: React 19, Vite, `vite-plugin-pwa` (Workbox, `registerType: 'prompt'`), Dexie 4 + `dexie-react-hooks`, Zustand (cart/UI state only), Tailwind CSS, `uuid` (v7), `qrcode`, plus `@zxing/browser` or `barcode-detector` for camera QR scanning (optional).
- API: NestJS, Prisma + PostgreSQL, Zod, `@nestjs/throttler`, Helmet, Pino logger.
- Tests: Vitest (+ `fake-indexeddb`), Testcontainers (Postgres) for API integration, Playwright for e2e.
- Hosting: Cloudflare Pages (POS), Render (API), Neon (Postgres).

## Commands (create these in phase 0 and keep them working)
```bash
pnpm install
pnpm dev                 # turbo: pos (vite) + api (nest --watch)
pnpm build
pnpm lint                # eslint + prettier check
pnpm typecheck
pnpm test                # vitest across workspaces (unit)
pnpm test:int            # API integration tests (needs Docker for Testcontainers)
pnpm e2e                 # playwright (builds + previews POS, starts API)
pnpm --filter api db:migrate     # prisma migrate dev
pnpm --filter api db:seed        # demo catalogue (~15 products / ~120 variants)
pnpm --filter api db:seed:large  # 4,000 variants for performance demo
pnpm --filter api db:reset
```
Local Postgres comes from `docker compose up -d db` (see `docker-compose.yml`).

## Coding conventions
- **TypeScript**: no `any` (use `unknown` and narrow). Exhaustive `switch` over event types with a `never` check. Prefer pure functions; side effects live at the edges (db/, sync/, controllers).
- **Naming**: DB columns `snake_case` (Prisma `@map`), TS `camelCase`. Money fields end in `Cents`, rates in `Bp`.
- **Files**: one React component per file. Feature folders, not type folders. Keep components small and push logic into hooks and services.
- **Errors**: API returns `{ error: { code, message } }` with stable `code`s (e.g. `SEQ_GAP`, `SEQ_REUSED`, `OVER_RETURN`). The POS never shows raw errors to cashiers.
- **Time**: store ISO-8601 UTC. Use the store timezone only for display and "today" boundaries.
- **UI**: the checkout must be usable keyboard-only, with tap targets of at least 48 px and WCAG AA contrast. The scan input must regain focus after every action.
- **Logging**: no PII in logs. Log `eventId`, `terminalId` and `seq` for every sync decision.

## Testing expectations
- Every function in `packages/core` has unit tests, including edge cases (0, max, rounding boundaries). Use property tests for allocation and totals.
- Every sync rule in ARCH §4.4/§4.5 has an integration test: duplicate, seq gap → 409, seq reuse, concurrent terminals → −1 + one discrepancy, parked return applied later, over-return.
- Bug fixes start with a failing test.
- Before saying a task is done, run `pnpm lint && pnpm typecheck && pnpm test` (and `pnpm test:int` / `pnpm e2e` when touched) and report the results honestly. Don't claim a pass you didn't run.

## How to work in this repo (Claude Code)
- **Plan first** for any task touching more than 2 files: outline the files and approach, then implement.
- Keep changes scoped to the current `TASKS.md` item. Note unrelated issues under "Follow-ups" in `TASKS.md` instead of fixing them silently.
- If a requirement is ambiguous or conflicts with `ARCHITECTURE.md`, **stop and ask**. If a design decision changes, update `ARCHITECTURE.md` in the same change.
- **Never run `git commit`, `git push` or any other command that creates commits or rewrites history unless I explicitly ask in that message. Leave changes uncommitted for me to review.** When a task is done, suggest a Conventional Commit message (`feat:`, `fix:`, `test:`, `chore:`, `docs:`) instead.
- Don't add dependencies without saying why. Prefer the stack listed above.
- Don't modify generated files (Prisma client, `dist/`, the service-worker build output).

## Things not to do
- No Next.js/SSR, no localStorage/sessionStorage for business data, no float money.
- No relying on the Background Sync API or `navigator.onLine` alone. Connectivity = a successful `/v1/health` call.
- No blocking modals caused by connectivity. The sync badge informs; it never interrupts.
- No real payment-gateway integration, no storing card data, no real customer or business data in seeds.
- No `prisma migrate reset` or destructive DB commands against anything except the local Docker DB.

## Definition of done (per task)
- [ ] Acceptance criteria in `TASKS.md` met
- [ ] Lint, typecheck and tests green (results stated)
- [ ] Works offline where relevant (verified in DevTools → Network → Offline, or by a Playwright test)
- [ ] `ARCHITECTURE.md` / `README.md` updated if behaviour or setup changed
- [ ] Checkbox ticked in `TASKS.md`
