# Albion Econ Platform — Dev Log

A running record of everything built to date. Newest work at the top of each phase list. Dates are approximate to the working sessions; commit hashes are authoritative.

**Stack:** Next.js 15.5 (App Router, server components + server actions) · Supabase (Postgres) · Vitest (TDD) · shadcn/ui on Base UI (base-nova variant, *not* Radix) · Tailwind v4 (OKLCH tokens) · sonner · lucide-react.
**Domain:** Albion Online guild economy tools for the Americas-West server. Prices sourced hourly from the Albion Online Data Project (AODP) `west` API.

---

## Phase 0 — Tooling installs

- **graphifyy** (`0.8.49`) — installed via `pip install graphifyy` (note the double-y; the plain `graphify` name is an unrelated/nonexistent PyPI package and 404s). Repo: https://github.com/safishamsi/graphify. Used for the knowledge-graph pass (Phase 8).
- **impeccable** (`3.1.0`) — installed via `npx impeccable install`. Used for the UI polish pass (Phase 3).

Both were confirmed real by the user before install.

---

## Phase 1 — Doc 1 foundation (monorepo + DB + pipeline + math)

Built with subagent-driven development against a written plan (writing-plans skill).

- `afd06ef` — scaffold Next.js 15 + Vitest. Pinned Next to **15.5.x**; `create-next-app@latest` ships 16, which was rejected per spec.
- `cee6037` — Supabase client, DB schema, returnrate stub.
- `4f49881` — fees math lib + tests.
- `e02f150` — AODP client: chunked fetch + response parsers.
- `8a2bc36` — items / watchlist DB helpers.
- `159cb6f` — item seed script from `ao-bin-dumps` (~11,800 items).
- `e210ef4` — **lazy Supabase client** (Proxy wrapper so importing the module has no side effects and `next build` can collect page data without live creds) + repaired the Next-15 ESLint flat config (`FlatCompat` + `@eslint/eslintrc`; the scaffold shipped Next-16 flat-config imports incompatible with `eslint-config-next@15`).
- `8eabcd0` — hourly price-fetch cron route.
- `771941b` — shadcn/ui setup (card + badge).
- `f443655` — platform dashboard (fetch status + module links).
- `654d3b8` — craft + consumables module stubs.
- `0ad0f66` — seed hardening: continue-on-error per batch + final row count. (Prompted by a reported "seed only populated some categories" — verified to be Table Editor pagination misreading; all rows were present. Not a bug, but hardened anyway.)

**Key decisions.** Integration tests hit the real Supabase project, so they are **opt-in via `RUN_DB_TESTS=1`** (not merely "creds present") — a default `pnpm test` stays green and offline even when `.env.local` has creds but the DB isn't migrated yet.

---

## Phase 2 — Doc 2 Flip Screener (`app/flip`)

Black-Market flip screener: scan engine, filters, guild price entry, sortable results.

- `2715657` — settings filter columns + `flip_latest_prices` view (canonical latest price per item/city/quality/side: newest wins; on an exact `observed_at` tie, `guild` > `aodp`).
- `1900c06` — scan engine + tests (reproduces the spec self-check).
- `53f3389` — data layer: settings, watchlist rebuild, markets loader, guild insert.
- `77ae050` — shadcn table/input/label/select/switch.
- `4b9c0f0` — screener page, server actions, filters form, manual entry, sortable results.
- `c7ae43f` — `FlipSettings` became a type alias of `FlipFilters` (fixes `no-empty-object-type` lint on the empty interface).

Confirmed with the user that `bag_insight` and `Bag` are distinct items despite sharing the "bags" category.

---

## Phase 3 — impeccable UI polish

- `1623f0f` — a11y sortable headers, tabular numerals, pending states.
- `dd5e315` — silenced a Base UI uncontrolled-input warning (keyed the filters form to remount on settings change) + added an emerald brand theme with a `profit` semantic color and tinted neutrals (the grayscale UI read as flat).

---

## Phase 4 — Price Checker data layer (`app/prices`, no UI yet)

Exact signatures per spec: `searchItems`, `getLivePricesForItem` / `getItemPrices`, `listFavorites` / `addFavorite` / `removeFavorite`, `formatItemName`.

- `76d611e` — `items.display_name` column + `favorites` table (migrations 003, 004).
- `38d4b85` — `display_name` backfill script from a formatted dump.
- `a8eed9a` — **F8 live fixes** (user-authored, committed together): AODP spaceless-city normalization (`"Black Market"` → `"BlackMarket"`), watchlist pagination past the PostgREST 1000-row cap, `upsertDailyVolume` dedupe, resilient cron volume try/catch, guild item-id uppercasing.
- `01ea831` — price-checker data layer with pure-reduction tests (`reduceLivePrices`, `isFresh`).
- `b329df2` — gated integration tests behind `RUN_DB_TESTS=1`.
- `d03f4ea` — favorite server actions + reused guild submission path.

---

## Phase 5 — Data-layer batch C1–C6

Guard discipline throughout: *a task that writes nothing or matches nothing must fail loudly, not pass silently.*

- `cfa5478` — **C1**: centralized `CITIES` + added Brecilien.
- `c389dce` — **C2**: `formatItemName` display helper + tests.
- `e653d38` — **C3**: search-triggered live AODP fetch with 15-minute freshness cache.
- `706de8e` — **C4**: fuzzy item search via a `pg_trgm` GIN index + `search_items` RPC (substring OR trigram-similar, ranked by `similarity`, paginated).
- `1f95e1e` — **C5**: Black-Market gap flag + sort; history `avg_price`.
- `a4c9b6b` — **C6**: flip routes carry display fields + `getRoutesForItem`.
- `e7abdc0` — batch plan doc.

---

## Phase 6 — Single-source-of-truth audit (`display_name`)

Rule: `display_name` lives **only** in `items`; `item_id` is the join key everywhere else; UI renders `formatItemName`, never a raw `item_id`.

- `b307705` — audit fix: `results-table.tsx` rendered `r.baseName` instead of the formatted name → switched to `routeName(r)` / `formatItemName`.

---

## Phase 7 — Price Checker + Flipper search UI

- `84beea5` — price checker page, flipper item search, layout updates.

---

## Phase 8 — graphify knowledge graph

Ran `/graphify` over the codebase to produce a knowledge graph (graphifyy 0.8.49).

---

## Phase 9 — Manual price-fetch button

Requirement: **the button and the cron must never run divergent copies of the pull.**

- `df2ed80` — daily cron schedule fix + `maxDuration = 300` on the fetch-prices route (avoids the platform 504 on a ~100 s pull).
- `8862016` — shared `runPriceFetch()` orchestration (single source for cron + manual), server-side cooldown guard (`isWithinCooldown`, 10-min window), `POST /api/fetch-prices/manual`, and a `FetchPricesButton` in `FlipControls` with load-bearing duration text + sonner toasts. The cron route is now a thin caller of `runPriceFetch`.

---

## Phase 10 — `/flip` + `/prices` read-only diagnosis

Read-and-report only; no edits. Findings:

1. `favorites` and `settings` were **global tables with no per-user key** — every browser shared one set of favorites and one filter row. (Fixed in Phase 11.)
2. `search_items` orders by `similarity(display_name, q) desc, display_name asc` — **no tier weighting**, even though `items.tier` exists.
3. Search dropdown clipping traced to shadcn `Card` carrying `overflow-hidden rounded-xl` (`components/ui/card.tsx:15`).

---

## Phase 11 — Cookie-based per-client isolation

Fixes the Phase-10 finding #1. Commit `84b19a9` (12 files; deliberately excluded a concurrent agent's uncommitted WIP).

- **Cookie identity**: `middleware.ts` sets an httpOnly `aep_client_id` (`crypto.randomUUID()`) when absent; matcher broadened to all app routes. `lib/client-id.ts` exposes `getClientId()` reading it via `next/headers` (async in Next 15).
- **favorites**: primary key is now `(client_id, item_id)`; `addFavorite` / `removeFavorite` / `listFavorites` all take and scope by `client_id`; a null client returns `[]` and writes nothing.
- **settings**: dropped the single-row `id = 1` shape; primary key is now `client_id`, one row per client. `getFlipSettings` inserts defaults for an unknown client; `updateFlipSettings` upserts on `client_id`; a null client falls back to in-memory defaults.
- **Client components unchanged** — they still call `addFavoriteAction(itemId)` etc.; the client id is resolved server-side in the actions/pages, never threaded through the browser.
- Migration `009_client_id.sql` deletes the old null-client rows (accepted data loss).

**Deviation (flagged and accepted):** `last_price_fetch_at` could **not** be made per-client, because the price pull is shared infrastructure triggered by cron, which has no cookie / `client_id`. Moved it to a new **global** `fetch_state` table (single row, `id = 1`) so the fetch cooldown stays global while user prefs are per-client. This is the only correct split.

---

## Database migrations

| # | File | Purpose |
|---|------|---------|
| 002 | flip view + settings columns | `flip_latest_prices`, settings filter columns |
| 003 | `003_display_name` | `items.display_name` |
| 004 | `004_favorites` | favorites table |
| 005 | `005_search` | `pg_trgm` GIN + `search_items` RPC |
| 006 | `006_flip_view_display` | flip view carries display fields |
| 007 | `007_daily_volume_avg_price` | `daily_volume.avg_price` |
| 008 | `008_last_price_fetch` | last-fetch timestamp |
| 009 | `009_client_id` | per-client favorites + settings; global `fetch_state` |

`db/schema.sql` is the authoritative full schema; migrations are the incremental record.

---

## Outstanding / verification pending

These need a live DB or the deployed URL — not yet done:

- Apply migrations **005–009** in Supabase; run `pnpm backfill-names`; run one cron pass (populates Brecilien + `daily_volume.avg_price`).
- `RUN_DB_TESTS=1 pnpm test` — exercises the F8/P5 + C-batch + client-id integration tests against the migrated DB.
- **Deployed-URL acceptance** — manual button (row count before/after, no 504, `elapsed_ms` ≈ 100000, cooldown skip) and client-id isolation (two cookies → A's favorite/filter invisible to B; fresh browser → cookie set, empty favorites, default filters).

## Known debt

- `getPremiumSetting` in `lib/items.ts` is dead code still referencing `id = 1` (unused; safe to delete).
- `search_items` has no tier weighting (Phase-10 finding #2).
- Search dropdown clip: `Card` `overflow-hidden` (Phase-10 finding #3) — a concurrent agent was mid-refactor turning the dropdown into a Popover to fix this.

---

## Working conventions

- **TDD** with Vitest: pure logic extracted and unit-tested; DB integration tests env-gated behind `RUN_DB_TESTS=1`.
- **Guard discipline**: writes/matches that produce nothing must throw, not pass silently.
- **Single source of truth**: `display_name` only in `items`; render via `formatItemName`.
- **Subagent-driven** feature work against written plans.
- Multi-agent working tree: commit only your own files; leave others' uncommitted WIP untouched.
