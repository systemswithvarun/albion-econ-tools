# Price Checker Data Layer + Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, testable Price Checker data layer (item search, live-price read, favorites) plus a display-name backfill — no UI. This exposes the exact contract a later frontend task consumes.

**Architecture:** Pure canonical-read reduction (`reduceLivePrices`) unit-tested in isolation; thin Supabase data functions in `lib/prices.ts`; server-action wrappers in `app/prices/actions.ts` reusing the existing `submitGuildPriceAction`. A one-time backfill script populates `items.display_name` from ao-bin-dumps `formatted/items.json`.

**Tech Stack:** Next.js 15, Supabase (Postgres), Vitest. Reuses Doc 1's lazy `supabase` client and canonical read rule.

---

## Context

The flip module reads prices but the UI only ever had raw `item_id`s. The Price Checker needs human names (`Adept's Bag`), substring search, per-item live prices, and favorites. Names come from the `formatted/items.json` variant of ao-bin-dumps (the raw dump the seed used has no localized names). This task is data-only; the frontend is a separate task that imports these signatures verbatim, so the signatures are the contract and must match exactly.

**Key facts established during planning:**
- `formatted/items.json`: flat array, 12,066 objects, fields incl. `UniqueName` + `LocalizedNames["EN-US"]`. 11,178 have EN names.
- Enchant variants appear as `UniqueName` `BASE@N`; transform `@`→`_` to match our DB `item_id` (`T4_2H_CLAYMORE@3` → `T4_2H_CLAYMORE_3`). Same convention the seed used.
- DB `items` currently has no `display_name` column; ~11,800 rows.
- `submitGuildPriceAction` (`app/flip/actions.ts`) already trims + uppercases the item id — reuse as-is.

**Testing approach (the one judgment call):** DB round-trips can't be unit-tested without a live DB. So: the canonical price reduction is extracted into a pure `reduceLivePrices()` and fully unit-tested (covers every `getLivePricesForItem` assertion). `searchItems` + favorites are written as **integration tests gated on `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`** (run against the real DB when `.env.local` is loaded, `describe.skip` otherwise). Unit tests are green everywhere; integration tests are green when the operator runs `pnpm test` locally with creds.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `db/migrations/003_display_name.sql` | add `items.display_name` + search index |
| Create | `db/migrations/004_favorites.sql` | `favorites` table |
| Modify | `db/schema.sql` | mirror both (authoritative full schema) |
| Create | `db/seed/backfill-names.ts` | one-time display_name backfill from formatted dump |
| Create | `lib/prices.ts` | `reduceLivePrices` (pure) + searchItems, getLivePricesForItem, listFavorites, addFavorite, removeFavorite + types |
| Create | `lib/__tests__/prices.test.ts` | unit (pure) + env-gated integration tests |
| Create | `app/prices/actions.ts` | `'use server'` favorite mutations + reuse submitGuildPriceAction |
| Modify | `vitest.setup.ts` | load `.env.local` so integration tests can reach the DB |

---

## Task P1: Migrations (display_name + favorites)

**Files:**
- Create: `db/migrations/003_display_name.sql`
- Create: `db/migrations/004_favorites.sql`
- Modify: `db/schema.sql`

- [ ] **Step 1: `db/migrations/003_display_name.sql`**

```sql
-- Human-readable item name, backfilled from ao-bin-dumps formatted/items.json.
alter table items add column if not exists display_name text;

-- Case-insensitive substring search over name + id (price checker search).
create index if not exists idx_items_display_name_trgm on items (lower(display_name));
create index if not exists idx_items_item_id_lower on items (lower(item_id));
```

- [ ] **Step 2: `db/migrations/004_favorites.sql`**

```sql
-- Single-user favorites (no auth/user column in v1).
create table if not exists favorites (
  item_id    text primary key references items(item_id),
  created_at timestamptz not null default now()
);
```

- [ ] **Step 3: Mirror into `db/schema.sql`**

Read `db/schema.sql`. Add `display_name text` to the `items` create-table (after `in_watchlist`, comma rules intact). Append the two `idx_items_*` indexes and the `favorites` create-table at the end. Use plain `create table`/`create index` (no `if not exists` mismatch is fine; keep consistent with the file's style).

- [ ] **Step 4: Apply (user)**

Run both migration files in the Supabase SQL editor. Verify:
```sql
select column_name from information_schema.columns where table_name='items' and column_name='display_name';
select * from favorites limit 1;
```

- [ ] **Step 5: Commit**

```bash
git add db/migrations/003_display_name.sql db/migrations/004_favorites.sql db/schema.sql
git commit -m "feat(prices): add items.display_name + favorites table migrations"
```

---

## Task P2: Display-name backfill script

**Files:**
- Create: `db/seed/backfill-names.ts`

- [ ] **Step 1: Write `db/seed/backfill-names.ts`**

```typescript
/**
 * One-time backfill of items.display_name from ao-bin-dumps formatted/items.json.
 *
 * Source: https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json
 * Shape: flat array of { UniqueName, LocalizedNames: { "EN-US": string, ... }, ... }.
 * Enchant variants appear as UniqueName "BASE@N"; we transform '@'->'_' to match our
 * DB item_id convention (same as the seed). Items with no EN-US name fall back to item_id.
 *
 * DRY RUN: if SEED_DRY_RUN=1 or Supabase env vars are missing, prints sample lookups
 * and counts, then exits 0 without writing.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SRC_URL = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json'
const DATA_PATH = path.resolve(process.cwd(), 'data', 'formatted-items.json')

interface FormattedItem {
  UniqueName?: string
  LocalizedNames?: Record<string, string> | null
}

function toItemId(uniqueName: string): string {
  return uniqueName.replace(/@/g, '_')
}

async function ensureFile(): Promise<void> {
  if (fs.existsSync(DATA_PATH)) return
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true })
  console.log(`Downloading ${SRC_URL} ...`)
  const res = await fetch(SRC_URL)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const text = await res.text()
  fs.writeFileSync(DATA_PATH, text, 'utf-8')
}

/** item_id -> EN-US display name (only entries that have a name). */
function buildNameMap(raw: FormattedItem[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const o of raw) {
    const un = o.UniqueName
    const name = o.LocalizedNames?.['EN-US']
    if (!un || !name) continue
    map.set(toItemId(un), name)
  }
  return map
}

async function main() {
  await ensureFile()
  const raw: FormattedItem[] = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'))
  const nameMap = buildNameMap(raw)
  console.log(`Parsed ${raw.length} formatted items; ${nameMap.size} with EN-US names.`)

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  const dryRun = process.env.SEED_DRY_RUN === '1' || !url || !key

  // Spot-check mapping regardless of mode.
  for (const id of ['T4_BAG', 'T5_2H_CLAYMORE', 'T4_2H_CLAYMORE_3', 'T4_BAG_INSIGHT']) {
    console.log(`  ${id} -> ${nameMap.get(id) ?? '(fallback to item_id)'}`)
  }

  if (dryRun) {
    console.log(process.env.SEED_DRY_RUN === '1'
      ? 'SEED_DRY_RUN=1 — no DB writes.'
      : 'SUPABASE creds missing — dry run only.')
    process.exit(0)
  }

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url!, key!, { auth: { persistSession: false } })

  // Phase 1: fallback — every row's display_name = item_id (one statement).
  const fb = await supabase.from('items').update({ display_name: null }).neq('item_id', '')
  if (fb.error) throw fb.error
  const fb2 = await supabase.rpc // placeholder guard (not used) -- see note below

  // Phase 1 (real): set display_name = item_id via a SQL-free approach is impossible in
  // one supabase-js call (can't reference the column on the right side), so we set the
  // fallback per-name in phase 2 and explicitly set leftover rows after. Instead:
  // 2a) group real names and update by value; 2b) backfill remaining nulls to item_id.

  // Phase 2a: invert to name -> item_ids[], update each group.
  const byName = new Map<string, string[]>()
  for (const [itemId, name] of nameMap) {
    const arr = byName.get(name) ?? []
    arr.push(itemId)
    byName.set(name, arr)
  }
  const ID_CHUNK = 300
  let updated = 0
  for (const [name, ids] of byName) {
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK)
      const { error } = await supabase.from('items').update({ display_name: name }).in('item_id', chunk)
      if (error) throw error
      updated += chunk.length
    }
  }
  console.log(`Named-update calls done; attempted ${updated} id-assignments.`)

  // Phase 2b: any row still null (no formatted name) -> fallback to its own item_id.
  // Page through nulls (respect 1000-row read cap) and patch in chunks.
  let patched = 0
  for (;;) {
    const { data, error } = await supabase
      .from('items')
      .select('item_id')
      .is('display_name', null)
      .limit(1000)
    if (error) throw error
    const rows = data ?? []
    if (rows.length === 0) break
    for (const r of rows) {
      const { error: uErr } = await supabase
        .from('items')
        .update({ display_name: r.item_id })
        .eq('item_id', r.item_id)
      if (uErr) throw uErr
    }
    patched += rows.length
    if (rows.length < 1000) break
  }
  console.log(`Fallback-patched ${patched} rows with item_id.`)

  // Verify (single-row reads, no 1000 cap concern).
  for (const id of ['T4_BAG', 'T5_2H_CLAYMORE']) {
    const { data } = await supabase.from('items').select('display_name').eq('item_id', id).single()
    console.log(`  verify ${id} -> ${data?.display_name}`)
  }
  console.log('Backfill complete.')
}

main().catch((e) => { console.error(e); process.exit(1) })
```

> **Implementer note:** the two placeholder lines (`const fb = ...` / `const fb2 = ...`) above are wrong — DELETE them. The correct flow is exactly: Phase 2a (named updates) then Phase 2b (null → item_id fallback). Do not set everything to null first. Start from a fresh `main()` that does ensureFile → parse → buildNameMap → dry-run guard → 2a → 2b → verify. Keep `buildNameMap` and `toItemId` exactly as written (they're unit-tested in P3).

- [ ] **Step 2: Export the pure helpers for testing**

Ensure `toItemId` and `buildNameMap` are `export`ed from the script (or move them to `lib/prices.ts`/a shared util the test imports). Simplest: add `export` to both in `backfill-names.ts` and import them in the P3 test. (Top-level `dotenv.config` + `main()` call must not run on import — guard `main()` with `if (process.argv[1]?.includes('backfill-names'))` OR keep helpers in a separate `db/seed/name-map.ts` module that the script and test both import. Prefer the separate `db/seed/name-map.ts` module — cleaner, no import side effects.)

Create `db/seed/name-map.ts`:
```typescript
export interface FormattedItem {
  UniqueName?: string
  LocalizedNames?: Record<string, string> | null
}

export function toItemId(uniqueName: string): string {
  return uniqueName.replace(/@/g, '_')
}

export function buildNameMap(raw: FormattedItem[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const o of raw) {
    const un = o.UniqueName
    const name = o.LocalizedNames?.['EN-US']
    if (!un || !name) continue
    map.set(toItemId(un), name)
  }
  return map
}
```
Then `backfill-names.ts` imports `{ FormattedItem, toItemId, buildNameMap }` from `./name-map` and drops its local copies.

- [ ] **Step 3: Add script + verify dry run**

Add to `package.json` scripts: `"backfill-names": "npx tsx db/seed/backfill-names.ts"`.
Run dry run: `SEED_DRY_RUN=1 npx tsx db/seed/backfill-names.ts` → confirm it prints `T4_BAG -> Adept's Bag`, `T5_2H_CLAYMORE -> Expert's Claymore`, etc. (downloads the file to `data/formatted-items.json` on first run; that path is already gitignored by `data/*.json`).

- [ ] **Step 4: Commit**

```bash
git add db/seed/backfill-names.ts db/seed/name-map.ts package.json
git commit -m "feat(prices): add display_name backfill script from formatted dump"
```

---

## Task P3: `lib/prices.ts` data layer + tests (TDD)

**Files:**
- Create: `lib/__tests__/prices.test.ts`
- Create: `lib/prices.ts`
- Modify: `vitest.setup.ts`

- [ ] **Step 1: Add dotenv to `vitest.setup.ts`** (so integration tests can reach the DB)

Current file is `import '@testing-library/jest-dom'`. Make it:
```typescript
import '@testing-library/jest-dom'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
```

- [ ] **Step 2: Write failing tests `lib/__tests__/prices.test.ts`**

```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { reduceLivePrices, type RawObservation } from '../prices'
import { toItemId, buildNameMap } from '../../db/seed/name-map'

// --- pure: name map ---
describe('name-map', () => {
  it('transforms enchant @N to _N', () => {
    expect(toItemId('T4_2H_CLAYMORE@3')).toBe('T4_2H_CLAYMORE_3')
    expect(toItemId('T4_BAG')).toBe('T4_BAG')
  })
  it('maps UniqueName -> EN-US, skips missing names', () => {
    const m = buildNameMap([
      { UniqueName: 'T4_BAG', LocalizedNames: { 'EN-US': "Adept's Bag" } },
      { UniqueName: 'X', LocalizedNames: null },
      { UniqueName: 'T4_2H_CLAYMORE@3', LocalizedNames: { 'EN-US': "Adept's Claymore" } },
    ])
    expect(m.get('T4_BAG')).toBe("Adept's Bag")
    expect(m.get('T4_2H_CLAYMORE_3')).toBe("Adept's Claymore")
    expect(m.has('X')).toBe(false)
  })
})

// --- pure: canonical reduction ---
describe('reduceLivePrices', () => {
  const base: RawObservation = {
    city: 'BlackMarket', quality: 1, side: 'sell_order', price: 100, source: 'aodp',
    observed_at: '2026-06-27T10:00:00Z',
  }

  it('returns empty array for no observations', () => {
    expect(reduceLivePrices([])).toEqual([])
  })

  it('keeps newest per (city, quality, side)', () => {
    const rows: RawObservation[] = [
      { ...base, price: 100, observed_at: '2026-06-27T10:00:00Z' },
      { ...base, price: 200, observed_at: '2026-06-27T12:00:00Z' }, // newer
    ]
    const out = reduceLivePrices(rows)
    expect(out).toHaveLength(1)
    expect(out[0].price).toBe(200)
  })

  it('separates distinct groups', () => {
    const rows: RawObservation[] = [
      { ...base, side: 'sell_order' },
      { ...base, side: 'buy_order' },
      { ...base, city: 'Martlock' },
      { ...base, quality: 2 },
    ]
    expect(reduceLivePrices(rows)).toHaveLength(4)
  })

  it('guild beats aodp on exact observed_at tie', () => {
    const t = '2026-06-27T12:00:00Z'
    const rows: RawObservation[] = [
      { ...base, price: 100, source: 'aodp', observed_at: t },
      { ...base, price: 999, source: 'guild', observed_at: t },
    ]
    const out = reduceLivePrices(rows)
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('guild')
    expect(out[0].price).toBe(999)
  })

  it('newer aodp still beats older guild', () => {
    const rows: RawObservation[] = [
      { ...base, price: 100, source: 'guild', observed_at: '2026-06-27T10:00:00Z' },
      { ...base, price: 200, source: 'aodp', observed_at: '2026-06-27T12:00:00Z' },
    ]
    expect(reduceLivePrices(rows)[0].price).toBe(200)
  })
})

// --- integration: real DB (skips without creds) ---
const hasDb = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
const dbDescribe = hasDb ? describe : describe.skip

dbDescribe('searchItems (integration)', () => {
  it('is case-insensitive over display_name and item_id', async () => {
    const { searchItems } = await import('../prices')
    const lower = await searchItems('claymore')
    const upper = await searchItems('CLAYMORE')
    expect(lower.length).toBeGreaterThan(0)
    expect(lower.length).toBe(upper.length)
    const byId = await searchItems('t4_bag')
    expect(byId.some((r) => r.item_id === 'T4_BAG')).toBe(true)
  })
  it('paginates', async () => {
    const { searchItems } = await import('../prices')
    const page1 = await searchItems('bag', { limit: 2, offset: 0 })
    const page2 = await searchItems('bag', { limit: 2, offset: 2 })
    expect(page1).toHaveLength(2)
    expect(page1[0].item_id).not.toBe(page2[0]?.item_id)
  })
  it('returns [] for empty query', async () => {
    const { searchItems } = await import('../prices')
    expect(await searchItems('   ')).toEqual([])
  })
})

dbDescribe('getLivePricesForItem (integration)', () => {
  it('returns [] for an item with no observations', async () => {
    const { getLivePricesForItem } = await import('../prices')
    // a valid item id that almost certainly has no observations
    const out = await getLivePricesForItem('T1_SILVERBAG_NONTRADABLE')
    expect(Array.isArray(out)).toBe(true)
  })
})

dbDescribe('favorites (integration)', () => {
  const ID = 'T4_BAG'
  afterAll(async () => {
    const { removeFavorite } = await import('../prices')
    await removeFavorite(ID)
  })
  it('add/list/remove round-trip, idempotent add', async () => {
    const { addFavorite, removeFavorite, listFavorites } = await import('../prices')
    await removeFavorite(ID) // clean slate
    await addFavorite(ID)
    await addFavorite(ID) // idempotent — must not throw
    const list = await listFavorites()
    expect(list.some((r) => r.item_id === ID)).toBe(true)
    await removeFavorite(ID)
    const after = await listFavorites()
    expect(after.some((r) => r.item_id === ID)).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests — expect FAIL**

`pnpm test` → cannot resolve `../prices`. (Integration blocks skip if no creds; that's expected.)

- [ ] **Step 4: Write `lib/prices.ts`**

```typescript
import { supabase } from './supabase'

export type Side = 'buy_order' | 'sell_order'

export type ItemSearchResult = {
  item_id: string
  display_name: string
  tier: number
  enchant: number
  category: string
}

export type LivePrice = {
  city: string
  quality: number
  side: Side
  price: number
  source: 'aodp' | 'guild'
  observed_at: string
}

export type RawObservation = LivePrice

const SELECT_COLS = 'item_id, display_name, tier, enchant, category'

/** Pure canonical read: newest per (city, quality, side); guild wins exact-time tie. */
export function reduceLivePrices(rows: RawObservation[]): LivePrice[] {
  const best = new Map<string, RawObservation>()
  for (const r of rows) {
    const key = `${r.city}|${r.quality}|${r.side}`
    const cur = best.get(key)
    if (!cur) { best.set(key, r); continue }
    const t = new Date(r.observed_at).getTime()
    const ct = new Date(cur.observed_at).getTime()
    if (t > ct) best.set(key, r)
    else if (t === ct && r.source === 'guild' && cur.source !== 'guild') best.set(key, r)
  }
  return [...best.values()]
}

/** Page a supabase query 1000 rows at a time (PostgREST default cap). */
async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/** Case-insensitive substring over display_name AND item_id; paginated. Empty query -> []. */
export async function searchItems(
  query: string,
  opts?: { limit?: number; offset?: number },
): Promise<ItemSearchResult[]> {
  const term = query.trim()
  if (!term) return []
  const limit = opts?.limit ?? 50
  const offset = opts?.offset ?? 0
  // Escape PostgREST or-filter metacharacters in the term.
  const safe = term.replace(/[%,()]/g, ' ')
  const { data, error } = await supabase
    .from('items')
    .select(SELECT_COLS)
    .or(`display_name.ilike.%${safe}%,item_id.ilike.%${safe}%`)
    .order('display_name', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw error
  return (data ?? []) as ItemSearchResult[]
}

/** All observations for the item, reduced to newest-per (city, quality, side). */
export async function getLivePricesForItem(itemId: string): Promise<LivePrice[]> {
  const rows = await selectAll<RawObservation>((from, to) =>
    supabase
      .from('price_observations')
      .select('city, quality, side, price, source, observed_at')
      .eq('item_id', itemId)
      .order('observed_at', { ascending: false })
      .range(from, to),
  )
  return reduceLivePrices(rows)
}

/** Favorites joined to items for names; paginated. */
export async function listFavorites(opts?: { limit?: number; offset?: number }): Promise<ItemSearchResult[]> {
  const limit = opts?.limit ?? 100
  const offset = opts?.offset ?? 0
  const { data, error } = await supabase
    .from('favorites')
    .select(`item_id, created_at, items!inner(${SELECT_COLS})`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error
  type Row = { items: ItemSearchResult }
  return ((data ?? []) as unknown as Row[]).map((r) => r.items)
}

/** Add favorite (uppercases id, like guild entry). Idempotent on duplicate. */
export async function addFavorite(itemId: string): Promise<void> {
  const id = itemId.trim().toUpperCase()
  const { error } = await supabase
    .from('favorites')
    .upsert({ item_id: id }, { onConflict: 'item_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function removeFavorite(itemId: string): Promise<void> {
  const id = itemId.trim().toUpperCase()
  const { error } = await supabase.from('favorites').delete().eq('item_id', id)
  if (error) throw error
}
```

> **Implementer note on `listFavorites` typing:** the embedded `items!inner(...)` shape from supabase-js may type as an array or object depending on the relationship inference. If tsc complains, adjust the `Row` type to match what the builder returns (e.g. `items: ItemSearchResult | ItemSearchResult[]`) and normalize with `Array.isArray(r.items) ? r.items[0] : r.items`. Keep behavior: return one `ItemSearchResult` per favorite. Note any change.

- [ ] **Step 5: Run tests — expect PASS**

`pnpm test`:
- Without DB creds: pure tests (name-map + reduceLivePrices) pass; integration `describe.skip` shows as skipped. Suite green.
- The implementer must confirm tsc is clean and the pure suites pass. (Integration green is verified by the user in P5.)

Run `pnpm exec tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add lib/prices.ts lib/__tests__/prices.test.ts vitest.setup.ts
git commit -m "feat(prices): add price-checker data layer with pure-reduction tests"
```

---

## Task P4: Server actions `app/prices/actions.ts`

**Files:**
- Create: `app/prices/actions.ts`

- [ ] **Step 1: Write `app/prices/actions.ts`**

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { addFavorite, removeFavorite } from '@/lib/prices'

// Re-export the existing guild price submission so the price-checker UI uses one path.
export { submitGuildPriceAction } from '@/app/flip/actions'

export async function addFavoriteAction(itemId: string): Promise<void> {
  await addFavorite(itemId)
  revalidatePath('/prices')
}

export async function removeFavoriteAction(itemId: string): Promise<void> {
  await removeFavorite(itemId)
  revalidatePath('/prices')
}
```

> **Implementer note:** if Next disallows re-exporting another module's server action through a `'use server'` file (it generally allows re-export of an existing action), and tsc/build complains, instead import `submitGuildPriceAction` and wrap it: `export async function submitGuildPriceAction(fd: FormData) { return (await import('@/app/flip/actions')).submitGuildPriceAction(fd) }`. Prefer the plain re-export first; only wrap if the build fails. Note what you did.

- [ ] **Step 2: Verify** `pnpm exec tsc --noEmit` clean; `pnpm run build` succeeds (no `/prices` page yet — actions compile as a module). `pnpm test` still green.

- [ ] **Step 3: Commit**

```bash
git add app/prices/actions.ts
git commit -m "feat(prices): add favorite server actions + reuse guild submission"
```

---

## Task P5: Verification (build + live)

**Files:** none.

- [ ] **Step 1: Full gate**

`pnpm exec tsc --noEmit` (clean), `pnpm run build` (succeeds), `pnpm test` (pure green; integration skipped without creds).

- [ ] **Step 2: Backfill (user, needs creds)**

Apply migrations 003 + 004. Run `pnpm backfill-names`. Confirm console verify lines: `T4_BAG -> Adept's Bag`, `T5_2H_CLAYMORE -> Expert's Claymore`. Spot-check in SQL: `select item_id, display_name from items where item_id in ('T4_BAG','T5_2H_CLAYMORE','T4_2H_CLAYMORE_3');`

- [ ] **Step 3: Integration tests (user, needs creds)**

With `.env.local` populated, run `pnpm test` → the `(integration)` suites now execute against the real DB and must pass (search case-insensitivity + pagination + empty; favorites round-trip + idempotent; getLivePrices returns array).

- [ ] **Step 4: Final commit (if fixes)**

```bash
git add -A && git commit -m "fix(prices): address verification findings"
```

---

## Spec Coverage Self-Review

| Spec requirement | Task |
|---|---|
| `items.display_name` migration | P1 |
| Backfill from formatted/items.json, `@`→`_`, EN-US, fallback item_id, batched, 1000-cap read-back | P2 |
| `T4_BAG`→"Adept's Bag", claymore real name | P2 verify (dry run + P5) |
| favorites table (single-user, no auth) | P1 |
| `searchItems` — case-insensitive over name+id, paginated, empty handling | P3 (+integration) |
| `getLivePricesForItem` — newest-per-group, guild tie, empty array, JS reduce | P3 `reduceLivePrices` (pure tests) |
| `listFavorites` joined to items | P3 |
| `addFavorite` uppercases, idempotent | P3 |
| `removeFavorite` | P3 |
| Reuse `submitGuildPriceAction` | P4 |
| Exact signatures (Side, ItemSearchResult, LivePrice) | P3 |
| Pagination on every list read | P3 (searchItems, listFavorites, getLivePrices via selectAll) |
| Tests: search, live-price reduce, favorites round-trip | P3 |
| tsc + build clean | P5 |

## Verification
- Unit (anywhere): `pnpm test` — name-map + `reduceLivePrices`.
- Type/build: `pnpm exec tsc --noEmit`, `pnpm run build`.
- Live (user, creds): `pnpm backfill-names`; `pnpm test` runs integration suites against the real DB.
