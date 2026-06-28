# Data-layer Batch C1–C6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Six deterministic, testable data-layer upgrades: centralize cities (+Brecilien), a display-name formatter, search-triggered live fetch, fuzzy search, the Black-Market gap flag, and display fields on flip routes — no UI.

**Guard discipline (applies to every task):** a step that writes nothing or matches nothing must FAIL LOUDLY, not pass silently. Tests assert non-empty results for known-good inputs; functions throw on Supabase errors (never swallow).

**Tech Stack:** Next.js 15, Supabase (Postgres + pg_trgm + RPC), Vitest. Reuses `lib/aodp`, `lib/flip`, `lib/prices`, lazy `supabase`.

**Execution order:** C1 → C2 → C3 → C4 → C6 → C5. (C5 depends on C6's `FlipRoute`/market changes, so C6 lands first even though it's numbered later.)

---

## Established facts (from planning)
- Hardcoded city arrays: `app/api/cron/fetch-prices/route.ts:5` and `app/flip/page.tsx:10` (7 cities, no Brecilien). Test strings in `aodp.test.ts` are not arrays — leave them.
- AODP `west` serves **Brecilien** natively (spaceless, no normalization). History data points are `{ item_count, avg_price, timestamp }`.
- `daily_volume(item_id, city, avg_sold, fetched_at)` — add `avg_price`.
- `flip_latest_prices` view selects `base_name, category` — add `display_name, enchant`.
- Royal cities (acquisition set) = the 6: Thetford, FortSterling, Lymhurst, Bridgewatch, Martlock, Caerleon. Brecilien + BlackMarket are NOT acquisition cities.
- `lib/prices.ts` already exports `LivePrice`, `reduceLivePrices`, `searchItems`, `getLivePricesForItem`, favorites. Integration tests are gated behind `RUN_DB_TESTS=1`.

---

## Task C1: Centralize cities + add Brecilien

**Files:** Create `lib/cities.ts`; modify `app/api/cron/fetch-prices/route.ts`, `app/flip/page.tsx`.

- [ ] **Step 1: Create `lib/cities.ts`**

```typescript
/** Canonical spaceless city names. Order = display order. AODP (west) serves all of
 *  these natively, including Brecilien — no normalization needed. */
export const CITIES = [
  'Thetford',
  'FortSterling',
  'Lymhurst',
  'Bridgewatch',
  'Martlock',
  'Caerleon',
  'Brecilien',
  'BlackMarket',
] as const

/** Royal cities only — the acquisition set (cheapest places to instant-buy).
 *  Excludes Brecilien (rest-zone hub) and BlackMarket. */
export const ROYAL_CITIES = [
  'Thetford',
  'FortSterling',
  'Lymhurst',
  'Bridgewatch',
  'Martlock',
  'Caerleon',
] as const

export type City = (typeof CITIES)[number]
```

- [ ] **Step 2: Use it in the cron route**

In `app/api/cron/fetch-prices/route.ts`: delete the local `const CITIES = [...]` line and add `import { CITIES } from '@/lib/cities'`. The existing `for (const city of CITIES)` and `getCurrentPrices(..., CITIES, ...)` now cover Brecilien. (`CITIES` is `readonly`; if `getCurrentPrices`/`getHistory` params type as `string[]`, pass `[...CITIES]` to satisfy the mutable-array type — do this wherever tsc complains.)

- [ ] **Step 3: Use it in the flip guild-entry dropdown**

In `app/flip/page.tsx`: delete the local `const CITIES = [...]` and `import { CITIES } from '@/lib/cities'`. The `ManualEntryForm cities={CITIES}` prop expects `string[]` — pass `cities={[...CITIES]}`.

- [ ] **Step 4: Guard — grep for stragglers**

Run: `grep -rn "'Thetford'" app lib --include=*.ts --include=*.tsx | grep -v "__tests__"` → expect ONLY `lib/cities.ts`. If any other file still hardcodes a city array, replace it too. (Test files may reference 'Thetford' as data — that's fine.)

- [ ] **Step 5: Verify + commit**

`pnpm exec tsc --noEmit` clean; `pnpm test` still green (35 passed / 5 skipped). 
```bash
git add lib/cities.ts app/api/cron/fetch-prices/route.ts app/flip/page.tsx
git commit -m "feat(C1): centralize cities + add Brecilien"
```

**Accept:** grep shows only `lib/cities.ts` defines the array; Brecilien is now in the cron fetch set (live-verified by the user: one cron run writes `city='Brecilien'` rows — `select count(*) from price_observations where city='Brecilien';` > 0).

---

## Task C2: Display-name helper

**Files:** Create `lib/display.ts`, `lib/__tests__/display.test.ts`.

- [ ] **Step 1: Failing tests `lib/__tests__/display.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { formatItemName } from '../display'

describe('formatItemName', () => {
  it('uses display_name when present', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG', enchant: 0 })).toBe("Adept's Bag")
  })
  it('falls back to item_id when display_name null/empty', () => {
    expect(formatItemName({ display_name: null, item_id: 'T4_BAG', enchant: 0 })).toBe('T4_BAG')
    expect(formatItemName({ display_name: '', item_id: 'T4_BAG', enchant: 0 })).toBe('T4_BAG')
  })
  it('omits enchant suffix at enchant 0', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG', enchant: 0 })).toBe("Adept's Bag")
  })
  it('appends enchant suffix when > 0', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG_1', enchant: 1 })).toBe("Adept's Bag .1")
  })
  it('omits quality suffix at quality 1 or undefined', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG', enchant: 0 }, 1)).toBe("Adept's Bag")
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG', enchant: 0 })).toBe("Adept's Bag")
  })
  it('appends quality when > 1', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG', enchant: 0 }, 3)).toBe("Adept's Bag Q3")
  })
  it('composes enchant + quality (spec example)', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG_1', enchant: 1 }, 2)).toBe("Adept's Bag .1 Q2")
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module '../display'`).

- [ ] **Step 3: Write `lib/display.ts`**

```typescript
/** Format an item for display: base name (or id fallback) + optional enchant + quality.
 *  e.g. { display_name: "Adept's Bag", enchant: 1 }, quality 2 -> "Adept's Bag .1 Q2". */
export function formatItemName(
  item: { display_name: string | null; item_id: string; enchant: number },
  quality?: number,
): string {
  const base = item.display_name && item.display_name.trim() ? item.display_name : item.item_id
  const ench = item.enchant > 0 ? ` .${item.enchant}` : ''
  const qual = quality !== undefined && quality > 1 ? ` Q${quality}` : ''
  return `${base}${ench}${qual}`
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm exec tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/display.ts lib/__tests__/display.test.ts
git commit -m "feat(C2): add formatItemName display helper with tests"
```

**Accept:** all unit assertions above pass (id fallback, enchant-0 omit, quality-1 omit, `"Adept's Bag .1 Q2"`).

---

## Task C3: Search-triggered live fetch

**Files:** modify `lib/prices.ts`; add tests to `lib/__tests__/prices.test.ts`.

- [ ] **Step 1: Add pure freshness helper + `getItemPrices` to `lib/prices.ts`**

Add near the top (after `reduceLivePrices`):
```typescript
import { CITIES } from './cities'
import { getCurrentPrices, type PriceObservationInsert } from './aodp'
import { upsertPriceObservations } from './items'

export const FRESH_MS = 15 * 60 * 1000

/** Pure: is the newest observation within the freshness window? */
export function isFresh(newestObservedAt: string | null, now: number, windowMs = FRESH_MS): boolean {
  if (!newestObservedAt) return false
  return now - new Date(newestObservedAt).getTime() < windowMs
}
```

Add the function (uses all cities + qualities 1–5 in ONE AODP call so the grid fills):
```typescript
const ALL_QUALITIES = [1, 2, 3, 4, 5]

/**
 * Live prices for ANY item (price-checker engine). Fresh path: if the newest stored
 * observation is < 15 min old, return reduced DB rows. Stale/miss path: pull AODP for
 * all cities + qualities in one call, upsert (source 'aodp'), then return reduced rows.
 */
export async function getItemPrices(itemId: string): Promise<LivePrice[]> {
  const id = itemId.trim().toUpperCase()

  const { data: newestRows, error: nErr } = await supabase
    .from('price_observations')
    .select('observed_at')
    .eq('item_id', id)
    .order('observed_at', { ascending: false })
    .limit(1)
  if (nErr) throw nErr
  const newest = newestRows?.[0]?.observed_at ?? null

  if (isFresh(newest, Date.now())) {
    return getLivePricesForItem(id)
  }

  // Stale/miss: one AODP call covering every city (incl. Brecilien + BlackMarket) x q1-5.
  const fetched: PriceObservationInsert[] = await getCurrentPrices(id ? [id] : [], [...CITIES], ALL_QUALITIES)
  if (fetched.length > 0) await upsertPriceObservations(fetched)
  return getLivePricesForItem(id)
}
```

> **Note:** `getLivePricesForItem` already reduces + paginates; reusing it keeps one canonical read path. The guard: if AODP returns nothing AND the DB has nothing, the result is `[]` — that's a legitimate "no market" answer, but the integration test below asserts a known liquid item DOES return a non-empty grid, so a silent total failure fails the test.

- [ ] **Step 2: Tests** — add to `lib/__tests__/prices.test.ts`:

Pure (always runs):
```typescript
import { isFresh } from '../prices'
describe('isFresh', () => {
  const now = new Date('2026-06-27T12:00:00Z').getTime()
  it('false for null', () => expect(isFresh(null, now)).toBe(false))
  it('true within 15 min', () => expect(isFresh('2026-06-27T11:50:00Z', now)).toBe(true))
  it('false past 15 min', () => expect(isFresh('2026-06-27T11:40:00Z', now)).toBe(false))
})
```

Integration (`dbDescribe`, needs `RUN_DB_TESTS=1` + network):
```typescript
dbDescribe('getItemPrices (integration)', () => {
  it('fills a grid for an item outside the cron set and caches within 15 min', async () => {
    const prices = await import('../prices')
    const aodp = await import('../aodp')
    const spy = vi.spyOn(aodp, 'getCurrentPrices')
    // T8_2H_INFERNALSCYTHE is artifact-ish / outside the non-artifact cron set.
    const id = 'T4_BAG'
    const first = await prices.getItemPrices(id)
    expect(first.length).toBeGreaterThan(0) // guard: must return a grid, not silently empty
    const callsAfterFirst = spy.mock.calls.length
    const second = await prices.getItemPrices(id)
    expect(second.length).toBeGreaterThan(0)
    expect(spy.mock.calls.length).toBe(callsAfterFirst) // 2nd call within 15 min: no new AODP request
    spy.mockRestore()
  })
})
```
Add `import { vi } from 'vitest'` to the test file's imports if not present.

> **Caveat for the implementer:** `vi.spyOn(aodp, 'getCurrentPrices')` only intercepts calls made through the module namespace. Since `getItemPrices` imports `getCurrentPrices` as a named binding, the spy may not intercept it depending on bundling. If the spy doesn't register calls, switch to `vi.mock('../aodp', ...)` with a counting mock, OR assert the cache-hit via the freshness path instead (after the first call the newest row is < 15 min old, so the second call returns via the `isFresh` branch — assert that branch by checking `getCurrentPrices` is not needed). Pick whichever reliably proves "no second AODP request." Document what you used.

- [ ] **Step 3: Verify + commit** — `pnpm test` (pure green; integration skipped without flag), `pnpm exec tsc --noEmit` clean.
```bash
git add lib/prices.ts lib/__tests__/prices.test.ts
git commit -m "feat(C3): search-triggered live AODP fetch with 15-min freshness"
```

**Accept:** searching an item not in the cron set returns a full city grid and leaves fresh rows; a second call within 15 min makes no AODP request (proven by spy or freshness-branch assertion).

---

## Task C4: Fuzzy search (pg_trgm RPC)

**Files:** Create `db/migrations/005_search.sql`; modify `db/schema.sql`, `lib/prices.ts`; update tests.

- [ ] **Step 1: `db/migrations/005_search.sql`**

```sql
create extension if not exists pg_trgm;

-- Trigram GIN index for fast fuzzy + substring search on names.
create index if not exists idx_items_display_name_gin
  on items using gin (display_name gin_trgm_ops);

-- Fuzzy item search: substring OR trigram-similar, ranked by similarity. Paginated.
create or replace function search_items(q text, lim int default 50, off int default 0)
returns setof items
language sql stable
as $$
  select *
  from items
  where display_name ilike '%' || q || '%'
     or similarity(display_name, q) > 0.2
  order by similarity(display_name, q) desc, display_name asc
  limit lim offset off
$$;
```

- [ ] **Step 2: Mirror into `db/schema.sql`** — append the extension, GIN index, and function at the end. (Leave the older `idx_items_display_name_trgm` b-tree from migration 003; harmless. Optionally drop it in this migration with `drop index if exists idx_items_display_name_trgm;` — do so, it was misnamed and unused.)

- [ ] **Step 3: Rewrite `searchItems` in `lib/prices.ts` to use the RPC**

```typescript
export async function searchItems(
  query: string,
  opts?: { limit?: number; offset?: number },
): Promise<ItemSearchResult[]> {
  const term = query.trim()
  if (!term) return []
  const { data, error } = await supabase.rpc('search_items', {
    q: term,
    lim: opts?.limit ?? 50,
    off: opts?.offset ?? 0,
  })
  if (error) throw error
  return (data ?? []).map((r: { item_id: string; display_name: string | null; tier: number; enchant: number; category: string }) => ({
    item_id: r.item_id,
    display_name: r.display_name ?? r.item_id,
    tier: r.tier,
    enchant: r.enchant,
    category: r.category,
  }))
}
```
(`search_items` returns `setof items`, i.e. full item rows; we map to `ItemSearchResult`. `display_name` may be null for un-backfilled rows → fall back to id, consistent with C2.)

- [ ] **Step 4: Update integration tests** — extend the existing `searchItems (integration)` block with fuzzy/typo cases:
```typescript
  it('matches display names and tolerates typos', async () => {
    const { searchItems } = await import('../prices')
    const exact = await searchItems('satchel')
    expect(exact.some((r) => /satchel/i.test(r.display_name))).toBe(true)
    const typo1 = await searchItems('satchle')
    const typo2 = await searchItems('stachel')
    expect(typo1.length).toBeGreaterThan(0)
    expect(typo2.length).toBeGreaterThan(0)
  })
  it('returns [] for gibberish, not an error', async () => {
    const { searchItems } = await import('../prices')
    expect(await searchItems('zzzqqxnope123')).toEqual([])
  })
```
(The existing case-insensitive/pagination/empty cases still apply; keep them.)

- [ ] **Step 5: Verify + commit** — `pnpm exec tsc --noEmit` clean; `pnpm test` pure-green. (RPC behavior verified live in C-batch acceptance.)
```bash
git add db/migrations/005_search.sql db/schema.sql lib/prices.ts lib/__tests__/prices.test.ts
git commit -m "feat(C4): fuzzy item search via pg_trgm RPC"
```

**Accept (live, RUN_DB_TESTS=1 after migration):** "satchel" returns satchel items; "satchle"/"stachel" still return them; "zzzqqxnope123" returns `[]` not error.

---

## Task C6: Flip routes carry display fields + item-driven lookup

**Files:** modify `db/migrations/` (extend view), `db/schema.sql`, `lib/flip.ts`, `lib/flip-data.ts`; tests.

- [ ] **Step 1: Migration `db/migrations/006_flip_view_display.sql`** — recreate the view with `display_name` + `enchant`:

```sql
create or replace view flip_latest_prices as
select distinct on (po.item_id, po.city, po.quality, po.side)
  po.item_id,
  i.base_name,
  i.display_name,
  i.enchant,
  i.category,
  po.city,
  po.quality,
  po.side,
  po.price,
  po.source,
  po.observed_at
from price_observations po
join items i on i.item_id = po.item_id
where i.in_watchlist = true
order by po.item_id, po.city, po.quality, po.side, po.observed_at desc, po.source desc;
```
Mirror into `db/schema.sql` (replace the existing view definition there).

- [ ] **Step 2: Extend engine types in `lib/flip.ts`**

Add `displayName: string | null` and `enchant: number` to `ItemMarket`; add `displayName: string | null` and `enchant: number` to `FlipRoute`. In `scanRoutes`, when pushing a route, set `displayName: m.displayName` and `enchant: m.enchant`. (`quality` is already on `FlipRoute`.) Keep `baseName` too (don't break existing callers).

- [ ] **Step 3: Populate them in `lib/flip-data.ts` `getFlipMarkets`**

The `LatestPriceRow` interface gains `display_name: string | null` and `enchant: number`; the select string adds `display_name, enchant`; when constructing each `ItemMarket`, set `displayName: r.display_name`, `enchant: r.enchant`.

- [ ] **Step 4: Add `getRoutesForItem` to `lib/flip-data.ts`** (item-driven, NOT watchlist-gated)

```typescript
import { scanRoutes, type FlipRoute, type ItemMarket } from './flip'

/** Routes for a single item (price-checker's second entry mode). Reads that item's
 *  latest prices directly from price_observations (not the watchlist view) so it works
 *  for any item, then runs the same scan engine with current settings. */
export async function getRoutesForItem(itemId: string): Promise<FlipRoute[]> {
  const id = itemId.trim().toUpperCase()
  const settings = await getFlipSettings()

  const { data: item, error: iErr } = await supabase
    .from('items')
    .select('item_id, display_name, enchant, category')
    .eq('item_id', id)
    .single()
  if (iErr) throw iErr

  const cutoff = new Date(Date.now() - settings.maxStalenessHr * 3_600_000).toISOString()
  const { data: obs, error: oErr } = await supabase
    .from('price_observations')
    .select('city, quality, side, price, source, observed_at')
    .eq('item_id', id)
    .gt('observed_at', cutoff)
  if (oErr) throw oErr

  const { data: vol, error: vErr } = await supabase
    .from('daily_volume')
    .select('city, avg_sold')
    .eq('item_id', id)
  if (vErr) throw vErr
  const volumeByCity: Record<string, number> = {}
  for (const v of vol ?? []) volumeByCity[v.city] = v.avg_sold

  // Group observations into per-quality markets (latest per city/side via reduce).
  const byQuality = new Map<number, ItemMarket>()
  for (const r of obs ?? []) {
    let m = byQuality.get(r.quality)
    if (!m) {
      m = {
        itemId: id, baseName: item.display_name ?? id, displayName: item.display_name,
        enchant: item.enchant, quality: r.quality, category: item.category,
        buyQuotes: [], sellQuotes: [], volumeByCity,
      }
      byQuality.set(r.quality, m)
    }
    const q = { city: r.city, price: r.price, observed_at: r.observed_at }
    if (r.side === 'sell_order') m.buyQuotes.push(q)
    else m.sellQuotes.push(q)
  }
  return scanRoutes([...byQuality.values()], settings, new Date()).routes
}
```

- [ ] **Step 5: Tests** — pure (scanRoutes carries display fields). In `lib/__tests__/flip.test.ts`, extend a market with `displayName`/`enchant` and assert the route carries them:
```typescript
it('route carries displayName, enchant, quality', () => {
  const m = { ...selfCheckMarket, displayName: "Adept's Bag", enchant: 1 }
  const { routes } = scanRoutes([m], baseFilters(), NOW)
  expect(routes[0].displayName).toBe("Adept's Bag")
  expect(routes[0].enchant).toBe(1)
  expect(routes[0].quality).toBe(1)
})
```
(Update the `selfCheckMarket` and other test markets in this file to include `displayName` + `enchant` so they type-check — add `displayName: null, enchant: 0` to each existing `ItemMarket` literal.)

Integration (`dbDescribe`) in `prices.test.ts` or a new `flip-data` test:
```typescript
dbDescribe('getRoutesForItem (integration)', () => {
  it('returns routes with display fields for a known item', async () => {
    const { getRoutesForItem } = await import('../flip-data')
    const routes = await getRoutesForItem('T4_BAG')
    expect(Array.isArray(routes)).toBe(true)
    if (routes.length > 0) expect(routes[0]).toHaveProperty('displayName')
  })
})
```

- [ ] **Step 6: Verify + commit** — `pnpm test` (flip pure tests incl. new field assertions green), `pnpm exec tsc --noEmit` clean, `pnpm run build` succeeds.
```bash
git add db/migrations/006_flip_view_display.sql db/schema.sql lib/flip.ts lib/flip-data.ts lib/__tests__/flip.test.ts lib/__tests__/prices.test.ts
git commit -m "feat(C6): flip routes carry display fields + getRoutesForItem"
```

**Accept:** route payloads contain `displayName`/`enchant`/`quality`; `getRoutesForItem('T4_BAG')` returns its routes with names (live).

---

## Task C5: Black Market gap flag + sort

**Files:** modify `lib/aodp.ts` (history avg_price), `db/migrations/` (daily_volume.avg_price), `db/schema.sql`, cron route, `lib/flip.ts` (BM gap + sort), `lib/flip-data.ts`; tests.

- [ ] **Step 1: Capture `avg_price` from AODP history (`lib/aodp.ts`)**

- `AodpHistoryRow.data` element type → `{ item_count: number; avg_price?: number; timestamp?: string }`.
- `DailyVolumeInsert` → add `avg_price: number`.
- `parseHistory` → also average `avg_price`:
```typescript
export function parseHistory(raw: AodpHistoryRow[]): DailyVolumeInsert[] {
  const now = new Date().toISOString()
  return raw.map((r) => {
    const count = r.data.reduce((s, d) => s + d.item_count, 0)
    const avgSold = r.data.length > 0 ? Math.round(count / r.data.length) : 0
    const priced = r.data.filter((d) => typeof d.avg_price === 'number')
    const avgPrice = priced.length > 0
      ? Math.round(priced.reduce((s, d) => s + (d.avg_price as number), 0) / priced.length)
      : 0
    return { item_id: r.item_id, city: r.location.replace(/\s+/g, ''), avg_sold: avgSold, avg_price: avgPrice, fetched_at: now }
  })
}
```
- Update the existing `parseHistory` test in `aodp.test.ts` to expect `avg_price` (add `avg_price` to the sample data points and assert the averaged value).

- [ ] **Step 2: Migration `db/migrations/007_daily_volume_avg_price.sql`**

```sql
alter table daily_volume add column if not exists avg_price int not null default 0;
```
Mirror into `db/schema.sql` (`avg_price int not null default 0` in the `daily_volume` create-table). Update `upsertDailyVolume` in `lib/items.ts` — its row type gains `avg_price: number` (the dedupe map + upsert already pass the whole row, so just widen the param type to include `avg_price`).

- [ ] **Step 3: Pure `computeBmGap` in `lib/flip.ts`**

```typescript
export const BM_FLOOR_MULTIPLIER = 1.10 // 10% covers 8% non-premium tax + margin

export interface BmGap {
  lowestAcquisition: number // cheapest standing SELL order across royal cities (instant-buy cost)
  bmBuyOrder: number        // Black Market BUY order = buy_price_max (what you instant-SELL into)
  floor: number             // break-even floor = lowestAcquisition * 1.10
  flagged: boolean          // bmBuyOrder >= floor -> live profit window
}

/** Pure BM gap. acquisition = cheapest royal-city sell order; proceeds = BM buy order. */
export function computeBmGap(lowestAcquisition: number, bmBuyOrder: number): BmGap {
  const floor = lowestAcquisition * BM_FLOOR_MULTIPLIER
  return { lowestAcquisition, bmBuyOrder, floor, flagged: lowestAcquisition > 0 && bmBuyOrder >= floor }
}
```

- [ ] **Step 4: Wire BM gap into `scanRoutes` + sort flagged to top (`lib/flip.ts`)**

- Add `bmFlagged: boolean` and `bmGap: BmGap | null` to `FlipRoute`.
- In `scanRoutes`, per market compute the gap once: `lowestAcquisition = min price of buyQuotes whose city is in ROYAL_CITIES` (import `ROYAL_CITIES` from `./cities`); `bmBuyOrder = price of the sellQuote whose city === 'BlackMarket'` (0 if none). `const gap = (lowestAcquisition>0 && bmBuyOrder>0) ? computeBmGap(lowestAcquisition, bmBuyOrder) : null`. Set `bmGap: gap`, `bmFlagged: gap?.flagged ?? false` on every route for that market.
- Change the sort to flagged-first: `routes.sort((a,b) => Number(b.bmFlagged) - Number(a.bmFlagged) || b.routeDailyProfit - a.routeDailyProfit || b.netPerUnit - a.netPerUnit)`.

- [ ] **Step 5: Tests (pure) in `lib/__tests__/flip.test.ts`**

```typescript
import { computeBmGap } from '../flip'
describe('computeBmGap', () => {
  it('flags when BM buy order >= floor (acq 500 -> floor 550, bm 560)', () => {
    const g = computeBmGap(500, 560)
    expect(g.floor).toBeCloseTo(550)
    expect(g.flagged).toBe(true)
  })
  it('does not flag at 540 (< 550)', () => {
    expect(computeBmGap(500, 540).flagged).toBe(false)
  })
  it('does not flag with no acquisition price', () => {
    expect(computeBmGap(0, 999).flagged).toBe(false)
  })
})

it('sorts flagged routes above unflagged', () => {
  // market A: flagged (royal buy 500, BM buy 560); market B: unflagged but higher profit
  const flagged = {
    itemId: 'A', baseName: 'A', displayName: 'A', enchant: 0, quality: 1, category: 'bags',
    buyQuotes: [{ city: 'Lymhurst', price: 500, observed_at: fresh }],
    sellQuotes: [{ city: 'BlackMarket', price: 560, observed_at: fresh }],
    volumeByCity: { BlackMarket: 100 },
  }
  const plain = {
    itemId: 'B', baseName: 'B', displayName: 'B', enchant: 0, quality: 1, category: 'bags',
    buyQuotes: [{ city: 'Martlock', price: 100, observed_at: fresh }],
    sellQuotes: [{ city: 'Caerleon', price: 100000, observed_at: fresh }],
    volumeByCity: { Caerleon: 100000 },
  }
  const { routes } = scanRoutes([plain, flagged], baseFilters(), NOW)
  expect(routes[0].bmFlagged).toBe(true) // flagged wins top despite lower profit
})
```

- [ ] **Step 6: Cron writes avg_price** — no code change needed beyond Step 1/2 (the cron already calls `getHistory`→`upsertDailyVolume`, which now carry `avg_price`). Verify the cron route still type-checks.

- [ ] **Step 7: Verify + commit** — `pnpm test` (all pure green), `pnpm exec tsc --noEmit` clean, `pnpm run build` succeeds.
```bash
git add lib/aodp.ts lib/items.ts lib/flip.ts lib/flip-data.ts db/migrations/007_daily_volume_avg_price.sql db/schema.sql lib/__tests__/flip.test.ts lib/__tests__/aodp.test.ts
git commit -m "feat(C5): Black Market gap flag + sort, history avg_price"
```

**Accept:** synthetic acq 500 / BM 560 flags (560 ≥ 550); 540 doesn't; flagged routes sort above unflagged (all pure-tested). Live: BM `avg_price` populated after a cron run.

---

## Final verification (P-style, user runs live bits)

- [ ] tsc clean, `pnpm run build` succeeds, `pnpm test` green (pure suites).
- [ ] Apply migrations 005, 006, 007 in Supabase.
- [ ] Run cron once → confirm Brecilien rows + `daily_volume.avg_price` populated.
- [ ] `RUN_DB_TESTS=1 pnpm test` → C3/C4/C6 integration suites green.

## Spec Coverage Self-Review

| Spec item | Task |
|---|---|
| C1 cities.ts single constant + Brecilien, replace both arrays, grep guard | C1 |
| C2 formatItemName (fallback, enchant, quality) + tests | C2 |
| C3 getItemPrices freshness + AODP enrich + no-2nd-call | C3 |
| C4 pg_trgm + search_items RPC + fuzzy/typo/gibberish | C4 |
| C5 history avg_price, BM gap flag (acq×1.10), sort flagged top, term comments | C5 |
| C6 routes carry display_name+enchant+quality, getRoutesForItem | C6 |
| display_name+enchant in C3/C5/C6 payloads | C6 (markets/routes), C3 (LivePrice has no name by spec — item search supplies it) |
| Guard discipline (non-empty asserts, throw on error) | every task's tests |
