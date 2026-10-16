# Developing Halden v2

v2 lives next to v1 on the `v2` branch until phase 2 reaches parity (see [DESIGN.md](DESIGN.md)). The v1 shop
in `api/`, `lib/` and `public/` keeps working (`npm run v1:dev`) and is removed at the switch.

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API: `src/core` (config, db, errors, sessions, clock, rate limits, outbox, migrations), `src/modules/*` (routes, services, repositories), `test/` |
| `apps/web` | Next.js storefront and account pages, `e2e/` Playwright tests |
| `packages/contracts` | Zod schemas and error codes shared by API and web |
| `packages/money` | cents arithmetic, rounding, allocation |
| `db/migrations` | forward-only SQL migrations |
| `qa/` | Propmaster rules, recipes and scenarios (rewritten per phase for the v2 schema) |

## First run

Needs Node 22.12+ (24 recommended) and PostgreSQL 13+. The Propmaster repo's Docker Postgres (port 5433) works.

```sh
npm install
cp apps/api/.env.example apps/api/.env     # fill in the two SEED_*_PASSWORD values
# create the databases once, e.g. on the Propmaster container:
docker exec propmaster-postgres-1 psql -U propmaster -c "CREATE DATABASE halden_v2" -c "CREATE DATABASE halden_test"
npm run db:reset                            # drop, migrate, seed (local databases only)
npm run dev                                 # API on http://127.0.0.1:4000, shop on http://localhost:3001
```

Port 3001, not 3000, because the local EverShop test target already uses 3000.

Demo accounts (passwords from `apps/api/.env`): `admin@halden.test`, `support@halden.test`,
`warehouse@halden.test` (staff password), `maya@`, `jonas@`, `ari@halden.test` (shopper password).
Their emails never show in the public fake inbox; new accounts' emails do, at `/qa/inbox`.

## Everyday commands

| Command | Does |
|---|---|
| `npm run dev` | API and web with reload |
| `npm test` | money unit tests and API integration tests (real Postgres at `TEST_DATABASE_URL`, rebuilt each run) |
| `npm run test:e2e` | Playwright against running servers (start the API with `RATE_LIMITS=false` for e2e runs) |
| `npm run lint`, `npm run format:check`, `npm run typecheck` | the quality gate CI runs |
| `npm run db:migrate` | apply new migrations to `DATABASE_URL` |
| `npm run db:seed` | put the demo data back (schema stays) |
| `npm run build` | API bundle (`apps/api/dist`) and Next production build |

API reference (OpenAPI 3.1, try requests in the browser): http://127.0.0.1:4000/api/v1/docs, or `/api/v1/docs`
through the web app.

## Conventions

- **Business rules live in services**, never in routes or the web app. Each service file starts with the rules it
  enforces, in plain words. Repositories hold the SQL; bind parameters only.
- **Every error** is `application/problem+json` with a `code` from `packages/contracts/src/errors.ts`.
- **Business time** comes from the shop clock (`req.now`), never `new Date()` directly, so the QA lab can move it.
- **Schema changes** are a new file in `db/migrations`. Never edit one that has run: the runner refuses.
- **Money** is integer cents in code and `numeric(10,2)` in the database; never floats.
- **Frontend motion** is browser-native only (DESIGN.md 5.4 and 5.5): transform and opacity, reduced motion
  respected, no animation library. CI fails a push that breaks the performance budgets.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and `v2`:

1. lint, format check, typecheck
2. unit and API integration tests on Postgres 17
3. production build, Playwright (desktop and mobile), first-load JS budget, Lighthouse CI (mobile, median of 3)

Reports (Playwright HTML, Lighthouse JSON/HTML) are uploaded as the `reports` artifact.
