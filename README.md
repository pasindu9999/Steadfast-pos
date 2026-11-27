# Offline-First Apparel POS

> **Demo / assessment project.** MVP quality, demo data only, not for production use.
> © 2026 Udara Kurukulasooriya. All rights reserved (see [LICENSE](LICENSE)).

An offline-first point of sale for a boutique clothing shop. The design is described in
[ARCHITECTURE.md](ARCHITECTURE.md) and the build plan in [TASKS.md](TASKS.md).

**Current state:** the shared domain code, the database, the demo seed and terminal enrolment are
built. Sync endpoints and the terminal app are not built yet.

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

## Demo data

| Terminal | Enrolment code (reusable, demo only) |
|---|---|
| T1 | `DEMO-S01-T1` |
| T2 | `DEMO-S01-T2` |

| Staff | Role | PIN |
|---|---|---|
| Casey Cashier | cashier | `1111` |
| Morgan Manager | manager | `9999` |

The seed only adds what is missing, so it is safe to run again.

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
| `pnpm --filter api db:migrate` | Apply and create Prisma migrations |
| `pnpm --filter api db:seed` | Demo catalogue: 15 products, 120 variants |
| `pnpm --filter api db:seed:large` | 4,000 variants for the performance demo |
| `pnpm --filter api db:reset` | Drop and recreate the local database (refuses non-local URLs) |

## Layout

```
apps/pos            React + Vite terminal app
apps/api            NestJS API with Prisma
packages/core       Shared domain code, used by both apps
packages/tsconfig   Shared TypeScript configs
e2e                 End-to-end tests
```
