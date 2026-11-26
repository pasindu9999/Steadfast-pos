# Offline-First Apparel POS

> **Demo / assessment project.** MVP quality, demo data only, not for production use.
> © 2026 Udara Kurukulasooriya. All rights reserved (see [LICENSE](LICENSE)).

An offline-first point of sale for a boutique clothing shop. The design is described in
[ARCHITECTURE.md](ARCHITECTURE.md) and the build plan in [TASKS.md](TASKS.md).

**Current state:** repository and tooling foundation only. No POS features are built yet.

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
pnpm dev
```

The POS runs on <http://localhost:5173> and the API on <http://localhost:3000>.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start the POS and API in watch mode |
| `pnpm build` | Build all workspaces |
| `pnpm lint` | ESLint and Prettier check |
| `pnpm format` | Apply Prettier formatting |
| `pnpm typecheck` | TypeScript check in all workspaces |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm --filter api db:migrate` | Apply and create Prisma migrations |
| `pnpm --filter api db:reset` | Drop and recreate the local database (refuses non-local URLs) |

## Layout

```
apps/pos            React + Vite terminal app
apps/api            NestJS API with Prisma
packages/core       Shared domain code, used by both apps
packages/tsconfig   Shared TypeScript configs
e2e                 End-to-end tests
```
