# Flip Screener (Module 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `app/flip` — a market-flipping screener that reads `price_observations`, computes margin across city pairs via `lib/fees`, and returns a ranked, filterable "go buy these" basket.

**Architecture:** Pure scan engine (`lib/flip.ts`, fully unit-tested against Doc 2's self-check) fed by a thin DB data layer (`lib/flip-data.ts`). Next 15 App Router: `/flip` is a server component that loads settings + markets, runs the scan, and hands a `ScanResult` to client components (sortable table, filter form, manual-entry form, premium toggle). Mutations go through server actions that update `settings` / insert `price_observations` and `revalidatePath('/flip')`. No new fetch pipeline — reuses Doc 1's cron + tables.

**Tech Stack:** Next.js 15, Supabase (Postgres view + service client), Tailwind + shadcn/ui, Vitest.

---

## Context

Doc 1 built the foundation (tables, `lib/fees`, `lib/aodp`, hourly cron, dashboard). The cron only fetches `in_watchlist` items, and the watchlist is currently empty — this module is what populates it and consumes the price data. This plan adds the flip feature only; it touches `settings` and `items.in_watchlist` but adds no new pipeline.

**Decisions made beyond the raw Doc 2 spec (the "make it better" latitude):**
- **Headline net = instant/instant** (matches the self-check exactly). The engine is structured so sell-order / buy-order variants can be added later without changing callers; v1 ranks/displays the instant/instant route to stay verifiable.
- **Liquidity cap uses the sell city's `avg_sold`** (`daily_volume`) — selling is the binding constraint when offloading.
- **A Postgres view (`flip_latest_prices`)** does the canonical "latest per (item,city,quality,side), guild wins tie" reduction server-side (`distinct on`), so the data layer stays simple and correct.
- **Category names are plural** in our DB (`weapons/armors/offhands/head/shoes/bags`); the watchlist SQL uses the real strings.
- **Basket caps each item once at its `avg_sold`** (no double-allocating the same item across two routes).

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `db/migrations/002_flip.sql` | ALTER `settings` (+5 cols), create `flip_latest_prices` view |
| Create | `lib/flip.ts` | Pure scan engine: `scanRoutes`, basket allocation, types |
| Create | `lib/__tests__/flip.test.ts` | Engine tests incl. Doc 2 self-check (4,600/unit) |
| Create | `lib/flip-data.ts` | DB layer: settings get/update, markets loader, guild insert, watchlist rebuild |
| Create | `app/flip/page.tsx` | Server component: load + scan + render |
| Create | `app/flip/actions.ts` | Server actions: filters, premium, guild price, rebuild watchlist |
| Create | `app/flip/_components/filters-form.tsx` | Client: filter inputs |
| Create | `app/flip/_components/results-table.tsx` | Client: sortable results + basket highlight |
| Create | `app/flip/_components/manual-entry-form.tsx` | Client: guild price entry |
| Create | `app/flip/_components/flip-controls.tsx` | Client: premium toggle + rebuild-watchlist button |
| Modify | `components/ui/*` | Add shadcn: table, input, label, select, switch |
| Modify | `db/schema.sql` | Append the same ALTER + view (keep schema.sql authoritative) |

---

## Task F1: Schema migration (settings columns + latest-price view)

**Files:**
- Create: `db/migrations/002_flip.sql`
- Modify: `db/schema.sql` (append the new columns to the `settings` block + the view)

- [ ] **Step 1: Write `db/migrations/002_flip.sql`**

```sql
-- Module 1 (Flip) schema additions. Idempotent where practical.

-- Extend settings with flip filters (single-row settings table from Doc 1).
alter table settings add column if not exists disposable_cash bigint   not null default 0;
alter table settings add column if not exists daily_target    bigint   not null default 0;
alter table settings add column if not exists min_margin_pct  numeric  not null default 5;
alter table settings add column if not exists max_staleness_hr int     not null default 6;
alter table settings add column if not exists min_daily_volume int     not null default 0;

-- Canonical latest price per (item, city, quality, side) for watchlist items.
-- distinct on + order by observed_at desc, source desc encodes the Doc 1 rule:
-- newest wins; on an exact observed_at tie, 'guild' > 'aodp' lexicographically.
create or replace view flip_latest_prices as
select distinct on (po.item_id, po.city, po.quality, po.side)
  po.item_id,
  i.base_name,
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

- [ ] **Step 2: Mirror into `db/schema.sql`**

In `db/schema.sql`, add the five columns to the `settings` `create table` (so a fresh DB matches), and append the `flip_latest_prices` view definition at the end. Use the same column names/types/defaults as above (write them inline in the create table, not as ALTERs).

- [ ] **Step 3: Apply to Supabase**

User action: run `db/migrations/002_flip.sql` in the Supabase SQL editor. Verify:
```sql
select disposable_cash, daily_target, min_margin_pct, max_staleness_hr, min_daily_volume from settings;
select * from flip_latest_prices limit 1;
```
Expected: settings row returns defaults; view query succeeds (may be 0 rows until watchlist is set + cron runs).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/002_flip.sql db/schema.sql
git commit -m "feat(flip): add settings filter columns + flip_latest_prices view"
```

---

## Task F2: Scan engine `lib/flip.ts` (TDD)

**Files:**
- Create: `lib/__tests__/flip.test.ts`
- Create: `lib/flip.ts`

- [ ] **Step 1: Write failing tests `lib/__tests__/flip.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { scanRoutes, type ItemMarket, type FlipFilters } from '../flip'

const NOW = new Date('2026-06-27T12:00:00Z')
const fresh = '2026-06-27T11:30:00Z' // 0.5h old

function baseFilters(over: Partial<FlipFilters> = {}): FlipFilters {
  return {
    disposableCash: 1_000_000,
    dailyTarget: 0,
    minMarginPct: 0,
    maxStalenessHr: 6,
    minDailyVolume: 0,
    premium: false,
    ...over,
  }
}

// Doc 2 self-check: Lymhurst buy 23k -> BlackMarket sell 30k, instant/instant,
// non-premium => 30000*0.92 - 23000 = 4600/unit.
const selfCheckMarket: ItemMarket = {
  itemId: 'T4_BAG',
  baseName: 'T4_BAG',
  quality: 1,
  category: 'bags',
  buyQuotes: [{ city: 'Lymhurst', price: 23000, observed_at: fresh }],
  sellQuotes: [{ city: 'BlackMarket', price: 30000, observed_at: fresh }],
  volumeByCity: { BlackMarket: 100 },
}

describe('scanRoutes — self-check', () => {
  it('reproduces 4,600 net/unit for the documented route', () => {
    const { routes } = scanRoutes([selfCheckMarket], baseFilters(), NOW)
    const r = routes.find((x) => x.buyCity === 'Lymhurst' && x.sellCity === 'BlackMarket')
    expect(r).toBeDefined()
    expect(r!.netPerUnit).toBeCloseTo(4600)
    expect(r!.marginPct).toBeCloseTo(20) // 4600/23000*100
  })

  it('computes units, realizable, and routeDailyProfit', () => {
    // cash 1,000,000 / 23,000 = 43 units; capped by avg_sold 100 -> 43
    const { routes } = scanRoutes([selfCheckMarket], baseFilters(), NOW)
    const r = routes[0]
    expect(r.unitsAffordable).toBe(43)
    expect(r.realizable).toBe(43)
    expect(r.routeDailyProfit).toBeCloseTo(4600 * 43)
  })
})

describe('scanRoutes — filters', () => {
  it('drops routes below min_margin_pct', () => {
    const { routes } = scanRoutes([selfCheckMarket], baseFilters({ minMarginPct: 25 }), NOW)
    expect(routes).toHaveLength(0)
  })

  it('drops routes below min_daily_volume', () => {
    const { routes } = scanRoutes([selfCheckMarket], baseFilters({ minDailyVolume: 200 }), NOW)
    expect(routes).toHaveLength(0)
  })

  it('drops stale quotes (older than max_staleness_hr)', () => {
    const stale: ItemMarket = {
      ...selfCheckMarket,
      buyQuotes: [{ city: 'Lymhurst', price: 23000, observed_at: '2026-06-27T05:00:00Z' }], // 7h old
    }
    const { routes } = scanRoutes([stale], baseFilters({ maxStalenessHr: 6 }), NOW)
    expect(routes).toHaveLength(0)
  })

  it('does not create same-city routes', () => {
    const sameCity: ItemMarket = {
      ...selfCheckMarket,
      buyQuotes: [{ city: 'Lymhurst', price: 23000, observed_at: fresh }],
      sellQuotes: [{ city: 'Lymhurst', price: 30000, observed_at: fresh }],
      volumeByCity: { Lymhurst: 100 },
    }
    const { routes } = scanRoutes([sameCity], baseFilters(), NOW)
    expect(routes).toHaveLength(0)
  })

  it('premium reduces tax (4%) and raises net', () => {
    const { routes } = scanRoutes([selfCheckMarket], baseFilters({ premium: true }), NOW)
    // 30000*0.96 - 23000 = 5800
    expect(routes[0].netPerUnit).toBeCloseTo(5800)
  })
})

describe('scanRoutes — ranking + basket', () => {
  const lowVolHighMargin: ItemMarket = {
    itemId: 'A', baseName: 'A', quality: 1, category: 'weapons',
    buyQuotes: [{ city: 'Lymhurst', price: 10000, observed_at: fresh }],
    sellQuotes: [{ city: 'BlackMarket', price: 20000, observed_at: fresh }],
    volumeByCity: { BlackMarket: 1 }, // huge margin, ~no volume
  }
  const highVolLowMargin: ItemMarket = {
    itemId: 'B', baseName: 'B', quality: 1, category: 'weapons',
    buyQuotes: [{ city: 'Martlock', price: 10000, observed_at: fresh }],
    sellQuotes: [{ city: 'BlackMarket', price: 11500, observed_at: fresh }],
    volumeByCity: { BlackMarket: 500 },
  }

  it('ranks by routeDailyProfit, not margin (kills low-volume trap)', () => {
    const { routes } = scanRoutes([lowVolHighMargin, highVolLowMargin], baseFilters(), NOW)
    expect(routes[0].itemId).toBe('B') // higher daily profit despite lower margin
  })

  it('greedily fills basket toward daily_target and flags members', () => {
    const { routes, basketProfit } = scanRoutes(
      [lowVolHighMargin, highVolLowMargin],
      baseFilters({ dailyTarget: 1000, disposableCash: 1_000_000 }),
      NOW,
    )
    expect(routes.some((r) => r.inBasket)).toBe(true)
    expect(basketProfit).toBeGreaterThanOrEqual(1000)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm test` → `Cannot find module '../flip'`.

- [ ] **Step 3: Write `lib/flip.ts`**

```typescript
import { instantBuyCost, instantSellNet } from './fees'

export interface PriceQuote {
  city: string
  price: number
  observed_at: string // ISO timestamp
}

/** One item at one quality, with the freshest quote per city on each side. */
export interface ItemMarket {
  itemId: string
  baseName: string
  quality: number
  category: string
  /** side = 'sell_order' rows — the price you PAY to instant-buy. */
  buyQuotes: PriceQuote[]
  /** side = 'buy_order' rows — the price you RECEIVE to instant-sell. */
  sellQuotes: PriceQuote[]
  /** avg_sold (daily_volume) per city. */
  volumeByCity: Record<string, number>
}

export interface FlipFilters {
  disposableCash: number
  dailyTarget: number
  minMarginPct: number
  maxStalenessHr: number
  minDailyVolume: number
  premium: boolean
}

export interface FlipRoute {
  itemId: string
  baseName: string
  quality: number
  buyCity: string
  buyPrice: number
  sellCity: string
  sellPrice: number
  netPerUnit: number
  marginPct: number
  dailyVolume: number
  buyAgeHr: number
  sellAgeHr: number
  unitsAffordable: number
  realizable: number
  routeDailyProfit: number
  inBasket: boolean
}

export interface ScanResult {
  routes: FlipRoute[]
  basketProfit: number
  basketCost: number
}

function ageHr(observed_at: string, now: Date): number {
  return (now.getTime() - new Date(observed_at).getTime()) / 3_600_000
}

export function scanRoutes(markets: ItemMarket[], filters: FlipFilters, now: Date): ScanResult {
  const { disposableCash, minMarginPct, maxStalenessHr, minDailyVolume, premium, dailyTarget } = filters
  const routes: FlipRoute[] = []

  for (const m of markets) {
    const freshBuys = m.buyQuotes.filter((q) => ageHr(q.observed_at, now) <= maxStalenessHr)
    const freshSells = m.sellQuotes.filter((q) => ageHr(q.observed_at, now) <= maxStalenessHr)

    for (const buy of freshBuys) {
      for (const sell of freshSells) {
        if (buy.city === sell.city) continue // a flip moves goods between markets

        const buyCost = instantBuyCost(buy.price)
        const netPerUnit = instantSellNet(sell.price, premium) - buyCost
        if (buyCost <= 0) continue
        const marginPct = (netPerUnit / buyCost) * 100
        const dailyVolume = m.volumeByCity[sell.city] ?? 0

        if (marginPct < minMarginPct) continue
        if (dailyVolume < minDailyVolume) continue

        const unitsAffordable = Math.floor(disposableCash / buyCost)
        const realizable = Math.min(unitsAffordable, dailyVolume)
        const routeDailyProfit = netPerUnit * realizable

        routes.push({
          itemId: m.itemId,
          baseName: m.baseName,
          quality: m.quality,
          buyCity: buy.city,
          buyPrice: buy.price,
          sellCity: sell.city,
          sellPrice: sell.price,
          netPerUnit,
          marginPct,
          dailyVolume,
          buyAgeHr: ageHr(buy.observed_at, now),
          sellAgeHr: ageHr(sell.observed_at, now),
          unitsAffordable,
          realizable,
          routeDailyProfit,
          inBasket: false,
        })
      }
    }
  }

  // Rank by daily profit (tiebreak: net per unit). This auto-defuses the
  // high-margin / low-volume trap.
  routes.sort((a, b) => b.routeDailyProfit - a.routeDailyProfit || b.netPerUnit - a.netPerUnit)

  // Greedy basket: walk ranked routes, allocate cash, cap each ITEM once at its
  // sell-city avg_sold, stop when daily_target reached or cash exhausted.
  let remaining = disposableCash
  let basketProfit = 0
  let basketCost = 0
  const usedItems = new Set<string>()

  for (const r of routes) {
    if (dailyTarget > 0 && basketProfit >= dailyTarget) break
    if (remaining <= 0) break
    if (usedItems.has(r.itemId)) continue

    const buyCost = instantBuyCost(r.buyPrice)
    const affordable = Math.floor(remaining / buyCost)
    const units = Math.min(affordable, r.dailyVolume)
    if (units <= 0) continue

    r.inBasket = true
    usedItems.add(r.itemId)
    const cost = units * buyCost
    remaining -= cost
    basketCost += cost
    basketProfit += r.netPerUnit * units
  }

  return { routes, basketProfit, basketCost }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm test` → all flip tests pass (plus existing 16). Confirm the self-check `4600` assertion passes.

- [ ] **Step 5: Commit**

```bash
git add lib/flip.ts lib/__tests__/flip.test.ts
git commit -m "feat(flip): add scan engine with tests (reproduces self-check)"
```

---

## Task F3: Data layer `lib/flip-data.ts`

**Files:**
- Create: `lib/flip-data.ts`

- [ ] **Step 1: Write `lib/flip-data.ts`**

```typescript
import { supabase } from './supabase'
import type { ItemMarket, FlipFilters, PriceQuote } from './flip'

export interface FlipSettings extends FlipFilters {}

/** Read the single settings row, mapping DB columns to FlipFilters. */
export async function getFlipSettings(): Promise<FlipSettings> {
  const { data, error } = await supabase
    .from('settings')
    .select('premium, disposable_cash, daily_target, min_margin_pct, max_staleness_hr, min_daily_volume')
    .eq('id', 1)
    .single()
  if (error) throw error
  return {
    premium: data.premium,
    disposableCash: Number(data.disposable_cash),
    dailyTarget: Number(data.daily_target),
    minMarginPct: Number(data.min_margin_pct),
    maxStalenessHr: data.max_staleness_hr,
    minDailyVolume: data.min_daily_volume,
  }
}

export interface FlipSettingsUpdate {
  premium?: boolean
  disposableCash?: number
  dailyTarget?: number
  minMarginPct?: number
  maxStalenessHr?: number
  minDailyVolume?: number
}

export async function updateFlipSettings(patch: FlipSettingsUpdate): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.premium !== undefined) row.premium = patch.premium
  if (patch.disposableCash !== undefined) row.disposable_cash = patch.disposableCash
  if (patch.dailyTarget !== undefined) row.daily_target = patch.dailyTarget
  if (patch.minMarginPct !== undefined) row.min_margin_pct = patch.minMarginPct
  if (patch.maxStalenessHr !== undefined) row.max_staleness_hr = patch.maxStalenessHr
  if (patch.minDailyVolume !== undefined) row.min_daily_volume = patch.minDailyVolume
  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('settings').update(row).eq('id', 1)
  if (error) throw error
}

/**
 * Set items.in_watchlist per the Module 1 rule:
 *   equipment (weapons/armors/offhands/head/shoes) with is_artifact=false,
 *   plus all bags (which includes the T4-8_BAG_INSIGHT satchels).
 * Idempotent: recomputes the whole column.
 */
export async function rebuildWatchlist(): Promise<number> {
  // Clear, then set, so de-listed items get reset too.
  const clear = await supabase.from('items').update({ in_watchlist: false }).neq('item_id', '')
  if (clear.error) throw clear.error

  const equip = await supabase
    .from('items')
    .update({ in_watchlist: true })
    .in('category', ['weapons', 'armors', 'offhands', 'head', 'shoes'])
    .eq('is_artifact', false)
    .select('item_id')
  if (equip.error) throw equip.error

  const bags = await supabase
    .from('items')
    .update({ in_watchlist: true })
    .eq('category', 'bags')
    .select('item_id')
  if (bags.error) throw bags.error

  return (equip.data?.length ?? 0) + (bags.data?.length ?? 0)
}

/** Insert a manual/guild price observation. Live in the next scan via freshness. */
export async function addGuildPrice(input: {
  itemId: string
  city: string
  quality: number
  side: 'buy_order' | 'sell_order'
  price: number
}): Promise<void> {
  const { error } = await supabase.from('price_observations').insert({
    item_id: input.itemId,
    city: input.city,
    quality: input.quality,
    side: input.side,
    price: input.price,
    source: 'guild',
    observed_at: new Date().toISOString(),
  })
  if (error) throw error
}

interface LatestPriceRow {
  item_id: string
  base_name: string
  category: string
  city: string
  quality: number
  side: 'buy_order' | 'sell_order'
  price: number
  observed_at: string
}

/** Page through a supabase query 1000 rows at a time (PostgREST default cap). */
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

/**
 * Build ItemMarket[] for the scan: latest fresh price per (item,city,quality,side)
 * from the flip_latest_prices view, joined with daily_volume.
 */
export async function getFlipMarkets(maxStalenessHr: number): Promise<ItemMarket[]> {
  const cutoff = new Date(Date.now() - maxStalenessHr * 3_600_000).toISOString()

  const priceRows = await selectAll<LatestPriceRow>((from, to) =>
    supabase
      .from('flip_latest_prices')
      .select('item_id, base_name, category, city, quality, side, price, observed_at')
      .gt('observed_at', cutoff)
      .range(from, to),
  )

  const volRows = await selectAll<{ item_id: string; city: string; avg_sold: number }>((from, to) =>
    supabase.from('daily_volume').select('item_id, city, avg_sold').range(from, to),
  )

  const volByItemCity = new Map<string, Record<string, number>>()
  for (const v of volRows) {
    const rec = volByItemCity.get(v.item_id) ?? {}
    rec[v.city] = v.avg_sold
    volByItemCity.set(v.item_id, rec)
  }

  // Group price rows into ItemMarket keyed by item_id + quality.
  const markets = new Map<string, ItemMarket>()
  for (const r of priceRows) {
    const key = `${r.item_id}::${r.quality}`
    let m = markets.get(key)
    if (!m) {
      m = {
        itemId: r.item_id,
        baseName: r.base_name,
        quality: r.quality,
        category: r.category,
        buyQuotes: [],
        sellQuotes: [],
        volumeByCity: volByItemCity.get(r.item_id) ?? {},
      }
      markets.set(key, m)
    }
    const quote: PriceQuote = { city: r.city, price: r.price, observed_at: r.observed_at }
    if (r.side === 'sell_order') m.buyQuotes.push(quote) // you buy from sell orders
    else m.sellQuotes.push(quote) // you sell into buy orders
  }

  return [...markets.values()]
}
```

- [ ] **Step 2: Verify types**

Run: `pnpm exec tsc --noEmit` → clean. (No unit tests here — DB-bound; exercised live in Task F8.)

- [ ] **Step 3: Commit**

```bash
git add lib/flip-data.ts
git commit -m "feat(flip): add data layer (settings, watchlist rebuild, markets loader, guild insert)"
```

---

## Task F4: Add shadcn components

**Files:** adds `components/ui/{table,input,label,select,switch}.tsx`

- [ ] **Step 1: Add components**

Run (use `npx`, not `pnpm dlx` — the dlx path has a zod-resolution bug in this env):
```bash
npx --yes shadcn@latest add table input label select switch --yes
```

- [ ] **Step 2: Verify**

Confirm `components/ui/table.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `switch.tsx` exist. Run `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add components/ui package.json pnpm-lock.yaml
git commit -m "chore(flip): add shadcn table/input/label/select/switch"
```

---

## Task F5: Server actions `app/flip/actions.ts`

**Files:**
- Create: `app/flip/actions.ts`

- [ ] **Step 1: Write `app/flip/actions.ts`**

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { updateFlipSettings, addGuildPrice, rebuildWatchlist } from '@/lib/flip-data'

export async function saveFiltersAction(formData: FormData): Promise<void> {
  const num = (k: string) => {
    const v = formData.get(k)
    return v === null || v === '' ? undefined : Number(v)
  }
  await updateFlipSettings({
    disposableCash: num('disposableCash'),
    dailyTarget: num('dailyTarget'),
    minMarginPct: num('minMarginPct'),
    maxStalenessHr: num('maxStalenessHr'),
    minDailyVolume: num('minDailyVolume'),
  })
  revalidatePath('/flip')
}

export async function setPremiumAction(premium: boolean): Promise<void> {
  await updateFlipSettings({ premium })
  revalidatePath('/flip')
}

export async function rebuildWatchlistAction(): Promise<void> {
  await rebuildWatchlist()
  revalidatePath('/flip')
  revalidatePath('/')
}

export async function submitGuildPriceAction(formData: FormData): Promise<void> {
  await addGuildPrice({
    itemId: String(formData.get('itemId') ?? '').trim(),
    city: String(formData.get('city') ?? '').trim(),
    quality: Number(formData.get('quality') ?? 1),
    side: formData.get('side') === 'buy_order' ? 'buy_order' : 'sell_order',
    price: Number(formData.get('price') ?? 0),
  })
  revalidatePath('/flip')
}
```

- [ ] **Step 2: Verify** `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add app/flip/actions.ts
git commit -m "feat(flip): add server actions for filters, premium, watchlist, guild entry"
```

---

## Task F6: Flip page + client components

**Files:**
- Create: `app/flip/page.tsx`
- Create: `app/flip/_components/filters-form.tsx`
- Create: `app/flip/_components/flip-controls.tsx`
- Create: `app/flip/_components/manual-entry-form.tsx`
- Create: `app/flip/_components/results-table.tsx`

- [ ] **Step 1: `app/flip/page.tsx` (server component)**

```tsx
import { getFlipSettings, getFlipMarkets } from '@/lib/flip-data'
import { scanRoutes } from '@/lib/flip'
import { FiltersForm } from './_components/filters-form'
import { FlipControls } from './_components/flip-controls'
import { ManualEntryForm } from './_components/manual-entry-form'
import { ResultsTable } from './_components/results-table'

export const dynamic = 'force-dynamic'

const CITIES = ['Thetford', 'FortSterling', 'Lymhurst', 'Bridgewatch', 'Martlock', 'Caerleon', 'BlackMarket']

export default async function FlipPage() {
  let settings
  let scan
  let loadError: string | null = null
  try {
    settings = await getFlipSettings()
    const markets = await getFlipMarkets(settings.maxStalenessHr)
    scan = scanRoutes(markets, settings, new Date())
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e)
  }

  if (loadError || !settings || !scan) {
    return (
      <main className="container mx-auto p-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">Flip Screener</h1>
        <p className="text-destructive text-sm">
          Could not load flip data: {loadError ?? 'unknown error'}. Confirm Supabase env vars,
          that migration 002 is applied, and that the watchlist is built.
        </p>
      </main>
    )
  }

  return (
    <main className="container mx-auto p-6 max-w-7xl space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Flip Screener</h1>
          <p className="text-muted-foreground text-sm">
            {scan.routes.length} routes · basket profit{' '}
            <span className="text-foreground font-medium">{scan.basketProfit.toLocaleString()}</span> for{' '}
            {scan.basketCost.toLocaleString()} silver
          </p>
        </div>
        <FlipControls premium={settings.premium} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-6">
          <FiltersForm settings={settings} />
          <ManualEntryForm cities={CITIES} />
        </aside>
        <ResultsTable routes={scan.routes} />
      </div>
    </main>
  )
}
```

- [ ] **Step 2: `app/flip/_components/filters-form.tsx` (client)**

```tsx
'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { saveFiltersAction } from '../actions'
import type { FlipSettings } from '@/lib/flip-data'

export function FiltersForm({ settings }: { settings: FlipSettings }) {
  const fields: { name: string; label: string; value: number; step?: string }[] = [
    { name: 'disposableCash', label: 'Disposable cash', value: settings.disposableCash },
    { name: 'dailyTarget', label: 'Daily profit target', value: settings.dailyTarget },
    { name: 'minMarginPct', label: 'Min margin %', value: settings.minMarginPct, step: '0.1' },
    { name: 'maxStalenessHr', label: 'Max staleness (hr)', value: settings.maxStalenessHr },
    { name: 'minDailyVolume', label: 'Min daily volume', value: settings.minDailyVolume },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Filters</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={saveFiltersAction} className="space-y-3">
          {fields.map((f) => (
            <div key={f.name} className="space-y-1">
              <Label htmlFor={f.name}>{f.label}</Label>
              <Input id={f.name} name={f.name} type="number" step={f.step ?? '1'} defaultValue={f.value} />
            </div>
          ))}
          <Button type="submit" className="w-full">Apply filters</Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: `app/flip/_components/flip-controls.tsx` (client)**

```tsx
'use client'

import { useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { setPremiumAction, rebuildWatchlistAction } from '../actions'

export function FlipControls({ premium }: { premium: boolean }) {
  const [pending, start] = useTransition()
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <Switch
          id="premium"
          checked={premium}
          onCheckedChange={(v) => start(() => setPremiumAction(v))}
          disabled={pending}
        />
        <Label htmlFor="premium">Premium</Label>
      </div>
      <Button variant="outline" disabled={pending} onClick={() => start(() => rebuildWatchlistAction())}>
        Rebuild watchlist
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: `app/flip/_components/manual-entry-form.tsx` (client)**

```tsx
'use client'

import { useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { submitGuildPriceAction } from '../actions'

export function ManualEntryForm({ cities }: { cities: string[] }) {
  const formRef = useRef<HTMLFormElement>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Guild price entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={async (fd) => {
            await submitGuildPriceAction(fd)
            formRef.current?.reset()
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="itemId">Item ID</Label>
            <Input id="itemId" name="itemId" placeholder="T4_BAG" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="city">City</Label>
            <Select name="city" defaultValue={cities[0]}>
              <SelectTrigger id="city"><SelectValue /></SelectTrigger>
              <SelectContent>
                {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="quality">Quality</Label>
              <Input id="quality" name="quality" type="number" min={1} max={5} defaultValue={1} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="side">Side</Label>
              <Select name="side" defaultValue="sell_order">
                <SelectTrigger id="side"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sell_order">Sell order (buy from)</SelectItem>
                  <SelectItem value="buy_order">Buy order (sell into)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="price">Price</Label>
            <Input id="price" name="price" type="number" min={1} required />
          </div>
          <Button type="submit" className="w-full">Submit price</Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: `app/flip/_components/results-table.tsx` (client, sortable)**

```tsx
'use client'

import { useState, useMemo } from 'react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { FlipRoute } from '@/lib/flip'

type SortKey = keyof Pick<
  FlipRoute,
  'baseName' | 'netPerUnit' | 'marginPct' | 'dailyVolume' | 'routeDailyProfit' | 'unitsAffordable'
>

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'baseName', label: 'Item', numeric: false },
  { key: 'netPerUnit', label: 'Net/unit', numeric: true },
  { key: 'marginPct', label: 'Margin %', numeric: true },
  { key: 'dailyVolume', label: 'Daily vol', numeric: true },
  { key: 'unitsAffordable', label: 'Units', numeric: true },
  { key: 'routeDailyProfit', label: 'Route daily profit', numeric: true },
]

function fmt(n: number) {
  return Math.round(n).toLocaleString()
}

export function ResultsTable({ routes }: { routes: FlipRoute[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('routeDailyProfit')
  const [asc, setAsc] = useState(false)

  const sorted = useMemo(() => {
    const copy = [...routes]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
      return asc ? cmp : -cmp
    })
    return copy
  }, [routes, sortKey, asc])

  function toggle(k: SortKey) {
    if (k === sortKey) setAsc((v) => !v)
    else { setSortKey(k); setAsc(false) }
  }

  if (routes.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-muted-foreground text-sm">
        No routes match the current filters. Build the watchlist, wait for a price fetch, or loosen filters.
      </div>
    )
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((c) => (
              <TableHead
                key={c.key}
                onClick={() => toggle(c.key)}
                className={`cursor-pointer select-none ${c.numeric ? 'text-right' : ''}`}
              >
                {c.label}{sortKey === c.key ? (asc ? ' ↑' : ' ↓') : ''}
              </TableHead>
            ))}
            <TableHead>Buy</TableHead>
            <TableHead>Sell</TableHead>
            <TableHead className="text-right">Age (b/s)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r, i) => (
            <TableRow key={`${r.itemId}-${r.quality}-${r.buyCity}-${r.sellCity}-${i}`} className={r.inBasket ? 'bg-primary/5' : ''}>
              <TableCell className="font-medium">
                {r.baseName}{r.quality > 1 ? ` Q${r.quality}` : ''}
                {r.inBasket && <Badge variant="secondary" className="ml-2">basket</Badge>}
              </TableCell>
              <TableCell className="text-right">{fmt(r.netPerUnit)}</TableCell>
              <TableCell className="text-right">{r.marginPct.toFixed(1)}%</TableCell>
              <TableCell className="text-right">{fmt(r.dailyVolume)}</TableCell>
              <TableCell className="text-right">{fmt(r.unitsAffordable)}</TableCell>
              <TableCell className="text-right font-semibold">{fmt(r.routeDailyProfit)}</TableCell>
              <TableCell>{r.buyCity} @ {fmt(r.buyPrice)}</TableCell>
              <TableCell>{r.sellCity} @ {fmt(r.sellPrice)}</TableCell>
              <TableCell className="text-right text-muted-foreground text-xs">
                {r.buyAgeHr.toFixed(1)}/{r.sellAgeHr.toFixed(1)}h
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

- [ ] **Step 6: Verify build**

Run: `pnpm exec tsc --noEmit` (clean) and `pnpm run build` (succeeds; `/flip` listed as ƒ Dynamic). Run `pnpm test` (engine + existing tests green).

- [ ] **Step 7: Commit**

```bash
git add app/flip
git commit -m "feat(flip): add screener page, filters, manual entry, sortable results table"
```

---

## Task F7: Impeccable UI polish

**Files:** refines `app/flip/**` styling only (no logic changes).

- [ ] **Step 1: Run the impeccable skill on the flip UI**

Invoke the `impeccable` skill (e.g. `/impeccable polish app/flip`) targeting the flip page + components. Focus: visual hierarchy of the results table (make `routeDailyProfit` the clear primary), basket highlighting, filter sidebar density, empty/error states, number formatting, responsive behavior at narrow widths.

- [ ] **Step 2: Re-verify after polish**

Run `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm run build` — all green. Do not let polish change the engine math or action contracts.

- [ ] **Step 3: Commit**

```bash
git add app/flip components
git commit -m "style(flip): impeccable UI polish pass"
```

---

## Task F8: End-to-end verification (live)

**Files:** none (verification only).

- [ ] **Step 1: Apply migration + build watchlist**

User: apply `db/migrations/002_flip.sql`. Then in the running app, open `/flip`, click **Rebuild watchlist**. Verify `select count(*) from items where in_watchlist;` is in the thousands (equipment non-artifact + bags).

- [ ] **Step 2: Trigger a price fetch**

Manually hit the cron with the secret:
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/fetch-prices
```
Expect `{ ok: true, items_fetched: <n> }`. Confirm `select count(*) from price_observations;` grew.

- [ ] **Step 3: Self-check the math live**

Add two guild prices via the form to reproduce the doc example: `T4_BAG` Lymhurst quality 1 `sell_order` 23000, and `T4_BAG` BlackMarket quality 1 `buy_order` 30000. With non-premium, the route should show **net/unit ≈ 4,600** and margin ≈ 20%.

- [ ] **Step 4: Exercise filters + sorting + basket**

Set disposable cash + daily target, apply, confirm rows filter and the basket highlights toward the target. Toggle premium and confirm nets rise. Sort columns.

- [ ] **Step 5: Final commit (if any verification fixes)**

```bash
git add -A && git commit -m "fix(flip): address end-to-end verification findings"
```

---

## Spec Coverage Self-Review

| Doc 2 requirement | Task |
|---|---|
| `settings` +5 filter columns | F1 |
| Watchlist rule (equipment non-artifact + bags + insight satchels) | F2 `rebuildWatchlist` (+F8 apply) |
| Manual/guild entry → `price_observations` (source='guild', now()) | F2 `addGuildPrice`, F5 action, F6 form |
| Route building per item×quality, city pairs, fresh both sides | F2 engine |
| Buy uses sell_order price; sell uses buy_order price | F2 `ItemMarket` mapping + engine |
| Net via lib/fees (instant/instant) + self-check 4,600 | F2 test |
| Filters: min_margin_pct, min_daily_volume, max_staleness_hr | F2 engine + F6 form |
| Capital allocation: units, realizable=min(units,avg_sold), routeDailyProfit | F2 engine |
| Rank by routeDailyProfit | F2 engine |
| Greedy basket toward daily_target within cash, cap per item at avg_sold | F2 engine |
| Results table with all columns, sortable, premium toggle | F6 |
| Use impeccable for UI | F7 |

## Verification
- Unit: `pnpm test` (flip engine incl. self-check + existing 16).
- Type/build: `pnpm exec tsc --noEmit`, `pnpm run build`.
- Live: Task F8 (watchlist rebuild → cron fetch → self-check route → filters/basket).
