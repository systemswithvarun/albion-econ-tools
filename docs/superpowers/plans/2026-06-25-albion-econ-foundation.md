# Albion Econ Platform — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the monorepo root, shared DB schema, price-fetch pipeline, and core math libs for a Next.js 15 / Supabase guild economy platform — no feature (flip/craft) logic yet.

**Architecture:** Single Next.js 15 App Router project. Platform-level concerns (schema, price fetching, math libs) live in `db/` and `lib/`. Feature modules (`flip/`, `craft/`, `consumables/`) are sibling routes sharing those libs. Hourly Vercel Cron pulls AODP prices for all watchlisted items and upserts `price_observations`.

**Tech Stack:** Next.js 15 (App Router), Supabase (Postgres + JS client), Tailwind CSS, shadcn/ui, pnpm, Vitest, Vercel Cron.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `package.json` | pnpm workspace, scripts |
| Create | `next.config.ts` | Next.js 15 config |
| Create | `vitest.config.ts` | Vitest + Next.js compat |
| Create | `.env.local.example` | env template |
| Create | `db/schema.sql` | all DDL: items, price_observations, daily_volume, settings, recipes |
| Create | `db/seed/seed-items.ts` | ao-bin-dumps import script |
| Create | `lib/supabase.ts` | Supabase client (server + browser) |
| Create | `lib/aodp.ts` | AODP HTTP client, chunked fetching, gzip |
| Create | `lib/fees.ts` | tax + setup-fee math (pure functions) |
| Create | `lib/returnrate.ts` | typed stubs only — P2 fills math |
| Create | `lib/items.ts` | item/watchlist DB helpers |
| Create | `app/layout.tsx` | root layout, Tailwind |
| Create | `app/(dashboard)/page.tsx` | landing: module links + fetch status |
| Create | `app/api/cron/fetch-prices/route.ts` | hourly cron handler |
| Create | `app/craft/page.tsx` | "coming soon" stub |
| Create | `app/consumables/page.tsx` | "coming soon" stub |
| Create | `vercel.json` | cron schedule + env |
| Create | `middleware.ts` | CRON_SECRET bearer check for cron route |
| Create | `lib/__tests__/fees.test.ts` | fees math unit tests |
| Create | `lib/__tests__/aodp.test.ts` | AODP client unit tests (mocked fetch) |

---

## Task 1: Scaffold Next.js 15 project

**Files:**
- Create: `package.json`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.local.example`
- Create: `.gitignore`

- [ ] **Step 1: Create project root**

```bash
cd C:\Users\mansi\Documents
mkdir albion-econ-platform
cd albion-econ-platform
```

- [ ] **Step 2: Init Next.js 15 with pnpm**

```bash
pnpm create next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --use-pnpm
```

When prompted: accept all defaults. This gives you the App Router layout.

- [ ] **Step 3: Install additional deps**

```bash
pnpm add @supabase/supabase-js
pnpm add -D vitest @vitejs/plugin-react vite-tsconfig-paths @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 4: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
})
```

- [ ] **Step 5: Write `vitest.setup.ts`**

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 6: Add test script to `package.json`**

Open `package.json` and add inside `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 7: Write `.env.local.example`**

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
CRON_SECRET=a-long-random-secret
```

Copy to `.env.local` and fill real values. `.env.local` is gitignored by default.

- [ ] **Step 8: Write `next.config.ts`**

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // needed for server actions if used later
  },
}

export default nextConfig
```

- [ ] **Step 9: Verify dev server starts**

```bash
pnpm dev
```

Expected: `ready - started server on 0.0.0.0:3000`. Hit Ctrl+C.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 + Vitest"
```

---

## Task 2: Supabase client

**Files:**
- Create: `lib/supabase.ts`

- [ ] **Step 1: Write `lib/supabase.ts`**

```typescript
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_KEY!

if (!url || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set')
}

// Service-role client — server-side only, never exposed to browser
export const supabase = createClient(url, key, {
  auth: { persistSession: false },
})
```

- [ ] **Step 2: Commit**

```bash
git add lib/supabase.ts
git commit -m "feat: add Supabase service client"
```

---

## Task 3: Database schema

**Files:**
- Create: `db/schema.sql`

- [ ] **Step 1: Write `db/schema.sql`**

```sql
-- items: master item catalog, populated by seed script
create table if not exists items (
  item_id      text primary key,           -- e.g. "T4_ARMOR_PLATE_SET1"
  base_name    text not null,
  tier         int not null,
  enchant      int not null default 0,     -- 0–4
  category     text not null,             -- weapon|armor|offhand|head|shoes|bag|satchel|resource|...
  is_artifact  bool not null default false,
  has_quality  bool not null default true,
  in_watchlist bool not null default false
);

-- price_observations: one row per observed price tick
create table if not exists price_observations (
  id          bigserial primary key,
  item_id     text not null references items(item_id),
  city        text not null,              -- Thetford|FortSterling|Lymhurst|Bridgewatch|Martlock|Caerleon|BlackMarket
  quality     int not null default 1,    -- 1–5
  side        text not null,             -- 'buy_order' | 'sell_order'
  price       int not null,
  source      text not null default 'aodp', -- 'aodp' | 'guild'
  observed_at timestamptz not null default now(),
  constraint side_check check (side in ('buy_order', 'sell_order')),
  constraint source_check check (source in ('aodp', 'guild'))
);

create index if not exists idx_price_obs_lookup
  on price_observations (item_id, city, quality, side, observed_at desc);

-- daily_volume: latest daily avg sold per item+city
create table if not exists daily_volume (
  item_id    text not null references items(item_id),
  city       text not null,
  avg_sold   int not null,
  fetched_at timestamptz not null default now(),
  primary key (item_id, city)
);

-- settings: single row, global toggle
create table if not exists settings (
  id      int primary key default 1,
  premium bool not null default false,
  region  text not null default 'west',
  constraint single_row check (id = 1)
);

insert into settings (id) values (1) on conflict do nothing;

-- recipes: empty in P1, populated P2
create table if not exists recipes (
  item_id       text not null references items(item_id),
  resource_id   text not null,
  quantity      int not null,
  is_returnable bool not null default true,  -- false for artifact resources
  primary key (item_id, resource_id)
);
```

- [ ] **Step 2: Apply schema to Supabase**

In Supabase dashboard → SQL Editor, paste and run `db/schema.sql`.

Or via CLI if you have it:
```bash
supabase db push --db-url "postgres://postgres:<password>@<host>:5432/postgres"
```

- [ ] **Step 3: Verify tables exist**

In Supabase dashboard → Table Editor, confirm: `items`, `price_observations`, `daily_volume`, `settings`, `recipes` all visible.

- [ ] **Step 4: Commit**

```bash
git add db/schema.sql
git commit -m "feat: add platform DB schema"
```

---

## Task 4: `lib/fees.ts` — shared math (with tests first)

**Files:**
- Create: `lib/__tests__/fees.test.ts`
- Create: `lib/fees.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/__tests__/fees.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  taxRate,
  instantBuyCost,
  buyOrderCost,
  instantSellNet,
  sellOrderNet,
} from '../fees'

describe('fees — non-premium (8% tax)', () => {
  it('taxRate returns 0.08 when not premium', () => {
    expect(taxRate(false)).toBe(0.08)
  })

  it('instantBuyCost returns price as-is', () => {
    expect(instantBuyCost(1000)).toBe(1000)
  })

  it('buyOrderCost adds 2.5% setup fee', () => {
    expect(buyOrderCost(1000)).toBeCloseTo(1025)
  })

  it('instantSellNet deducts 8% tax', () => {
    expect(instantSellNet(1000, false)).toBeCloseTo(920)
  })

  it('sellOrderNet deducts tax + setup fee', () => {
    // 1000 * (1 - 0.08 - 0.025) = 1000 * 0.895 = 895
    expect(sellOrderNet(1000, false)).toBeCloseTo(895)
  })
})

describe('fees — premium (4% tax)', () => {
  it('taxRate returns 0.04 when premium', () => {
    expect(taxRate(true)).toBe(0.04)
  })

  it('instantSellNet deducts 4% tax', () => {
    expect(instantSellNet(1000, true)).toBeCloseTo(960)
  })

  it('sellOrderNet deducts 4% tax + setup fee', () => {
    // 1000 * (1 - 0.04 - 0.025) = 1000 * 0.935 = 935
    expect(sellOrderNet(1000, true)).toBeCloseTo(935)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm test
```

Expected: `Cannot find module '../fees'`

- [ ] **Step 3: Write `lib/fees.ts`**

```typescript
export const SETUP_FEE = 0.025

export function taxRate(premium: boolean): number {
  return premium ? 0.04 : 0.08
}

/** Take a sell_order (instant buy): pay listed price, no extra fee */
export function instantBuyCost(price: number): number {
  return price
}

/** Place a buy_order: price + 2.5% setup fee locked upfront */
export function buyOrderCost(price: number): number {
  return price * (1 + SETUP_FEE)
}

/** Hit a buy_order (instant sell): receive price minus tax */
export function instantSellNet(price: number, premium: boolean): number {
  return price * (1 - taxRate(premium))
}

/** Place a sell_order: receive price minus tax minus setup fee */
export function sellOrderNet(price: number, premium: boolean): number {
  return price * (1 - taxRate(premium) - SETUP_FEE)
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm test
```

Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add lib/fees.ts lib/__tests__/fees.test.ts
git commit -m "feat: add fees math lib with tests"
```

---

## Task 5: `lib/returnrate.ts` — typed stubs

**Files:**
- Create: `lib/returnrate.ts`

No tests for stubs — they throw, which is the correct P1 behavior.

- [ ] **Step 1: Write `lib/returnrate.ts`**

```typescript
/** Return rate math — implemented in P2. Stubs here ensure callers can import and type-check. */

export interface ReturnRateInput {
  itemId: string
  city: string
  premium: boolean
}

export interface ReturnRateResult {
  /** Fraction of resources returned (0–1) */
  returnRate: number
  /** Expected resource cost after returns */
  effectiveCost: number
}

/**
 * Calculate resource return rate and effective craft cost.
 * STUB — throws in P1. P2 fills in real math without changing this signature.
 */
export function calcReturnRate(_input: ReturnRateInput): ReturnRateResult {
  throw new Error('calcReturnRate not implemented until P2')
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/returnrate.ts
git commit -m "feat: add returnrate stub for P2"
```

---

## Task 6: `lib/aodp.ts` — AODP HTTP client (with tests)

**Files:**
- Create: `lib/__tests__/aodp.test.ts`
- Create: `lib/aodp.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/__tests__/aodp.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chunkArray, buildPriceUrl, buildHistoryUrl, parseCurrentPrices, parseHistory } from '../aodp'

describe('chunkArray', () => {
  it('splits array into chunks of given size', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns single chunk when array smaller than size', () => {
    expect(chunkArray(['a', 'b'], 10)).toEqual([['a', 'b']])
  })
})

describe('buildPriceUrl', () => {
  it('builds correct URL for single item and city', () => {
    const url = buildPriceUrl(['T4_SWORD'], ['Thetford'], [1])
    expect(url).toBe(
      'https://west.albion-online-data.com/api/v2/stats/prices/T4_SWORD.json?locations=Thetford&qualities=1'
    )
  })

  it('joins multiple items with comma', () => {
    const url = buildPriceUrl(['T4_SWORD', 'T5_SWORD'], ['Thetford'], [1])
    expect(url).toContain('T4_SWORD,T5_SWORD')
  })
})

describe('buildHistoryUrl', () => {
  it('builds correct URL', () => {
    const url = buildHistoryUrl(['T4_SWORD'], 'Thetford')
    expect(url).toBe(
      'https://west.albion-online-data.com/api/v2/stats/history/T4_SWORD.json?locations=Thetford&time-scale=24'
    )
  })
})

describe('parseCurrentPrices', () => {
  it('extracts buy and sell observation rows from AODP response', () => {
    const raw = [
      {
        item_id: 'T4_SWORD',
        city: 'Thetford',
        quality: 1,
        sell_price_min: 5000,
        sell_price_min_date: '2026-06-25T12:00:00',
        buy_price_max: 4000,
        buy_price_max_date: '2026-06-25T11:00:00',
      },
    ]
    const rows = parseCurrentPrices(raw)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ item_id: 'T4_SWORD', city: 'Thetford', quality: 1, side: 'sell_order', price: 5000, source: 'aodp' })
    expect(rows[1]).toMatchObject({ item_id: 'T4_SWORD', city: 'Thetford', quality: 1, side: 'buy_order', price: 4000, source: 'aodp' })
  })

  it('skips rows where both prices are 0', () => {
    const raw = [
      {
        item_id: 'T4_SWORD',
        city: 'Thetford',
        quality: 1,
        sell_price_min: 0,
        sell_price_min_date: '2026-06-25T12:00:00',
        buy_price_max: 0,
        buy_price_max_date: '2026-06-25T11:00:00',
      },
    ]
    const rows = parseCurrentPrices(raw)
    expect(rows).toHaveLength(0)
  })
})

describe('parseHistory', () => {
  it('averages item_count across days for a city', () => {
    const raw = [
      {
        item_id: 'T4_SWORD',
        location: 'Thetford',
        data: [{ item_count: 10 }, { item_count: 20 }],
      },
    ]
    const rows = parseHistory(raw)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ item_id: 'T4_SWORD', city: 'Thetford', avg_sold: 15 })
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm test
```

Expected: `Cannot find module '../aodp'`

- [ ] **Step 3: Write `lib/aodp.ts`**

```typescript
const BASE = 'https://west.albion-online-data.com'
const CHUNK_SIZE = 100  // keep URLs under ~8 KB

// --- URL builders (exported for tests) ---

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

export function buildPriceUrl(itemIds: string[], cities: string[], qualities: number[]): string {
  const ids = itemIds.join(',')
  const locs = cities.join(',')
  const quals = qualities.join(',')
  return `${BASE}/api/v2/stats/prices/${ids}.json?locations=${locs}&qualities=${quals}`
}

export function buildHistoryUrl(itemIds: string[], city: string): string {
  const ids = itemIds.join(',')
  return `${BASE}/api/v2/stats/history/${ids}.json?locations=${city}&time-scale=24`
}

// --- Response types ---

export interface AodpPriceRow {
  item_id: string
  city: string
  quality: number
  sell_price_min: number
  sell_price_min_date: string
  buy_price_max: number
  buy_price_max_date: string
}

export interface AodpHistoryRow {
  item_id: string
  location: string
  data: { item_count: number; timestamp: string }[]
}

export interface PriceObservationInsert {
  item_id: string
  city: string
  quality: number
  side: 'buy_order' | 'sell_order'
  price: number
  source: 'aodp'
  observed_at: string
}

export interface DailyVolumeInsert {
  item_id: string
  city: string
  avg_sold: number
  fetched_at: string
}

// --- Parsers (exported for tests) ---

export function parseCurrentPrices(raw: AodpPriceRow[]): PriceObservationInsert[] {
  const rows: PriceObservationInsert[] = []
  for (const r of raw) {
    if (r.sell_price_min > 0) {
      rows.push({
        item_id: r.item_id,
        city: r.city,
        quality: r.quality,
        side: 'sell_order',
        price: r.sell_price_min,
        source: 'aodp',
        observed_at: r.sell_price_min_date,
      })
    }
    if (r.buy_price_max > 0) {
      rows.push({
        item_id: r.item_id,
        city: r.city,
        quality: r.quality,
        side: 'buy_order',
        price: r.buy_price_max,
        source: 'aodp',
        observed_at: r.buy_price_max_date,
      })
    }
  }
  return rows
}

export function parseHistory(raw: AodpHistoryRow[]): DailyVolumeInsert[] {
  const now = new Date().toISOString()
  return raw.map((r) => {
    const total = r.data.reduce((sum, d) => sum + d.item_count, 0)
    const avg = r.data.length > 0 ? Math.round(total / r.data.length) : 0
    return { item_id: r.item_id, city: r.location, avg_sold: avg, fetched_at: now }
  })
}

// --- HTTP fetchers ---

async function fetchGzip(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'Accept-Encoding': 'gzip' },
  })
  if (!res.ok) throw new Error(`AODP fetch failed: ${res.status} ${url}`)
  return res.json()
}

export async function getCurrentPrices(
  itemIds: string[],
  cities: string[],
  qualities: number[]
): Promise<PriceObservationInsert[]> {
  const chunks = chunkArray(itemIds, CHUNK_SIZE)
  const all: PriceObservationInsert[] = []
  for (const chunk of chunks) {
    const url = buildPriceUrl(chunk, cities, qualities)
    const data = (await fetchGzip(url)) as AodpPriceRow[]
    all.push(...parseCurrentPrices(data))
  }
  return all
}

export async function getHistory(
  itemIds: string[],
  city: string
): Promise<DailyVolumeInsert[]> {
  const chunks = chunkArray(itemIds, CHUNK_SIZE)
  const all: DailyVolumeInsert[] = []
  for (const chunk of chunks) {
    const url = buildHistoryUrl(chunk, city)
    const data = (await fetchGzip(url)) as AodpHistoryRow[]
    all.push(...parseHistory(data))
  }
  return all
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm test
```

Expected: all tests pass (fees + aodp suite).

- [ ] **Step 5: Commit**

```bash
git add lib/aodp.ts lib/__tests__/aodp.test.ts
git commit -m "feat: add AODP client with chunked fetch and parsers"
```

---

## Task 7: `lib/items.ts` — item/watchlist DB helpers

**Files:**
- Create: `lib/items.ts`

- [ ] **Step 1: Write `lib/items.ts`**

```typescript
import { supabase } from './supabase'

export interface Item {
  item_id: string
  base_name: string
  tier: number
  enchant: number
  category: string
  is_artifact: boolean
  has_quality: boolean
  in_watchlist: boolean
}

/** All items in watchlist — used by cron to know what to fetch */
export async function getWatchlistItems(): Promise<Item[]> {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('in_watchlist', true)
  if (error) throw error
  return data as Item[]
}

/** Live price for (item_id, city, quality, side).
 *  Canonical read rule: newest observed_at, guild wins on tie.
 */
export async function getLivePrice(
  itemId: string,
  city: string,
  quality: number,
  side: 'buy_order' | 'sell_order'
): Promise<{ price: number; observed_at: string; source: string } | null> {
  const { data, error } = await supabase
    .from('price_observations')
    .select('price, observed_at, source')
    .eq('item_id', itemId)
    .eq('city', city)
    .eq('quality', quality)
    .eq('side', side)
    .order('observed_at', { ascending: false })
    .order('source', { ascending: false }) // 'guild' > 'aodp' lexicographically — guild wins ties
    .limit(1)
    .single()
  if (error && error.code === 'PGRST116') return null  // no rows
  if (error) throw error
  return data as { price: number; observed_at: string; source: string }
}

/** Upsert price observations (bulk) */
export async function upsertPriceObservations(
  rows: {
    item_id: string
    city: string
    quality: number
    side: string
    price: number
    source: string
    observed_at: string
  }[]
): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase.from('price_observations').insert(rows)
  if (error) throw error
}

/** Upsert daily volume (overwrites per item+city) */
export async function upsertDailyVolume(
  rows: { item_id: string; city: string; avg_sold: number; fetched_at: string }[]
): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase
    .from('daily_volume')
    .upsert(rows, { onConflict: 'item_id,city' })
  if (error) throw error
}

export async function getPremiumSetting(): Promise<boolean> {
  const { data, error } = await supabase
    .from('settings')
    .select('premium')
    .eq('id', 1)
    .single()
  if (error) throw error
  return (data as { premium: boolean }).premium
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/items.ts
git commit -m "feat: add items/watchlist DB helpers"
```

---

## Task 8: Seeding script (`db/seed/seed-items.ts`)

**Files:**
- Create: `db/seed/seed-items.ts`
- Create: `data/.gitkeep`

- [ ] **Step 1: Download ao-bin-dumps**

```bash
# In project root — downloads ~10 MB JSON
curl -L https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.json -o data/items.json
```

If `curl` unavailable on Windows:
```powershell
Invoke-WebRequest https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.json -OutFile data\items.json
```

- [ ] **Step 2: Inspect `data/items.json` structure**

```bash
node -e "const d=require('./data/items.json'); console.log(JSON.stringify(d.slice?.(0,2) ?? Object.keys(d).slice(0,2), null, 2))"
```

The top-level is either an array of item objects or an object keyed by item ID. Note the shape — the seed script below handles the array form. Adjust if different.

- [ ] **Step 3: Write `db/seed/seed-items.ts`**

```typescript
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

interface RawItem {
  UniqueName: string        // e.g. "T4_ARMOR_PLATE_SET1@2"
  LocalizedNames?: { 'EN-US'?: string }
  Tier?: number
  EnchantmentLevel?: number
  ShopCategory?: string
  CraftingRequirements?: {
    CraftResource?: { UniqueName: string }[] | { UniqueName: string }
  }
}

function parseItemId(uniqueName: string): { item_id: string; tier: number; enchant: number } {
  // UniqueName format: "T4_ARMOR_PLATE_SET1@2" where @2 = enchant 2
  const [base, enchantStr] = uniqueName.split('@')
  const enchant = enchantStr ? parseInt(enchantStr, 10) : 0
  const tierMatch = base.match(/^T(\d)_/)
  const tier = tierMatch ? parseInt(tierMatch[1], 10) : 0
  return { item_id: uniqueName.replace('@', '_'), tier, enchant }
}

function isArtifact(item: RawItem): boolean {
  const reqs = item.CraftingRequirements
  if (!reqs) return false
  const resources = Array.isArray(reqs.CraftResource)
    ? reqs.CraftResource
    : reqs.CraftResource
    ? [reqs.CraftResource]
    : []
  return resources.some((r) => r.UniqueName.includes('ARTEFACT'))
}

function hasQuality(item: RawItem): boolean {
  const cat = (item.ShopCategory ?? '').toLowerCase()
  // Resources and consumables typically have no quality; gear does
  return !['resource', 'consumable', 'farmable'].includes(cat)
}

async function seed() {
  const raw: RawItem[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/items.json'), 'utf-8')
  )

  const rows = raw.map((item) => {
    const { item_id, tier, enchant } = parseItemId(item.UniqueName)
    return {
      item_id,
      base_name: item.LocalizedNames?.['EN-US'] ?? item.UniqueName,
      tier,
      enchant,
      category: (item.ShopCategory ?? 'unknown').toLowerCase(),
      is_artifact: isArtifact(item),
      has_quality: hasQuality(item),
      in_watchlist: false,
    }
  })

  const BATCH = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await supabase
      .from('items')
      .upsert(batch, { onConflict: 'item_id' })
    if (error) {
      console.error('Seed error at batch', i, error)
      process.exit(1)
    }
    inserted += batch.length
    console.log(`Seeded ${inserted}/${rows.length}`)
  }
  console.log('Seed complete.')
}

seed()
```

- [ ] **Step 4: Add seed script to `package.json`**

In `"scripts"` add:
```json
"seed": "npx tsx db/seed/seed-items.ts"
```

Install `tsx` if not already present:
```bash
pnpm add -D tsx dotenv
```

- [ ] **Step 5: Run seed**

```bash
pnpm seed
```

Expected output: lines like `Seeded 500/18432`, ending with `Seed complete.`

- [ ] **Step 6: Add `data/` to `.gitignore`**

Append to `.gitignore`:
```
data/*.json
```

- [ ] **Step 7: Commit**

```bash
git add db/seed/seed-items.ts package.json .gitignore data/.gitkeep
git commit -m "feat: add item seed script from ao-bin-dumps"
```

---

## Task 9: Hourly cron route (`app/api/cron/fetch-prices/route.ts`)

**Files:**
- Create: `middleware.ts`
- Create: `app/api/cron/fetch-prices/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Write `middleware.ts`** (protects cron route with bearer token)

```typescript
import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/cron/')) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET}`
    if (auth !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/cron/:path*'],
}
```

- [ ] **Step 2: Write `app/api/cron/fetch-prices/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getCurrentPrices, getHistory } from '@/lib/aodp'
import { getWatchlistItems, upsertPriceObservations, upsertDailyVolume } from '@/lib/items'

const CITIES = ['Thetford', 'FortSterling', 'Lymhurst', 'Bridgewatch', 'Martlock', 'Caerleon', 'BlackMarket']

export async function GET() {
  const started = Date.now()
  try {
    const items = await getWatchlistItems()
    if (items.length === 0) {
      return NextResponse.json({ ok: true, message: 'No watchlist items', elapsed_ms: 0 })
    }

    const itemIds = items.map((i) => i.item_id)

    // Prices: quality 1–5 for has_quality items, quality 1 only for others
    const qualityItems = items.filter((i) => i.has_quality).map((i) => i.item_id)
    const noQualityItems = items.filter((i) => !i.has_quality).map((i) => i.item_id)

    const [withQualRows, noQualRows] = await Promise.all([
      qualityItems.length > 0
        ? getCurrentPrices(qualityItems, CITIES, [1, 2, 3, 4, 5])
        : Promise.resolve([]),
      noQualityItems.length > 0
        ? getCurrentPrices(noQualityItems, CITIES, [1])
        : Promise.resolve([]),
    ])

    await upsertPriceObservations([...withQualRows, ...noQualRows])

    // Volume: one city at a time (AODP history endpoint takes one city)
    for (const city of CITIES) {
      const volumeRows = await getHistory(itemIds, city)
      await upsertDailyVolume(volumeRows)
    }

    const elapsed_ms = Date.now() - started
    console.log(`[cron/fetch-prices] OK — ${items.length} items, ${elapsed_ms}ms`)
    return NextResponse.json({ ok: true, items_fetched: items.length, elapsed_ms })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/fetch-prices] ERROR', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
```

- [ ] **Step 3: Write `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/cron/fetch-prices",
      "schedule": "0 * * * *"
    }
  ]
}
```

Vercel automatically sends `Authorization: Bearer $CRON_SECRET` for crons defined here. Set `CRON_SECRET` in Vercel's env vars dashboard.

- [ ] **Step 4: Commit**

```bash
git add middleware.ts app/api/cron/fetch-prices/route.ts vercel.json
git commit -m "feat: add hourly price fetch cron route"
```

---

## Task 10: Tailwind + shadcn/ui setup

**Files:**
- Modify: `app/layout.tsx`
- Create: `app/globals.css`

- [ ] **Step 1: Init shadcn/ui**

```bash
pnpm dlx shadcn@latest init
```

Prompts:
- Style: **Default**
- Base color: **Slate**
- CSS variables: **Yes**

This writes `components.json`, updates `tailwind.config.ts`, and creates `app/globals.css`.

- [ ] **Step 2: Add a card component (used by dashboard)**

```bash
pnpm dlx shadcn@latest add card badge
```

- [ ] **Step 3: Verify `app/layout.tsx` imports globals.css**

It should already after `shadcn init`. Confirm:
```tsx
import './globals.css'
```

If missing, add it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: configure shadcn/ui with Slate theme"
```

---

## Task 11: Dashboard page

**Files:**
- Create: `app/(dashboard)/page.tsx`

- [ ] **Step 1: Write `app/(dashboard)/page.tsx`**

```tsx
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'

async function getLastFetchInfo() {
  const { data } = await supabase
    .from('price_observations')
    .select('observed_at')
    .eq('source', 'aodp')
    .order('observed_at', { ascending: false })
    .limit(1)
    .single()
  return data?.observed_at ?? null
}

async function getWatchlistCount() {
  const { count } = await supabase
    .from('items')
    .select('*', { count: 'exact', head: true })
    .eq('in_watchlist', true)
  return count ?? 0
}

export default async function HomePage() {
  const [lastFetch, watchlistCount] = await Promise.all([
    getLastFetchInfo(),
    getWatchlistCount(),
  ])

  const modules = [
    {
      href: '/flip',
      title: 'Market Flipping',
      description: 'Find buy-low / sell-high opportunities across cities.',
      status: 'active' as const,
    },
    {
      href: '/craft',
      title: 'Gear Crafting',
      description: 'Calculate crafting profit with resource returns.',
      status: 'soon' as const,
    },
    {
      href: '/consumables',
      title: 'Consumables',
      description: 'Food and potion crafting margins.',
      status: 'soon' as const,
    },
  ]

  return (
    <main className="container mx-auto p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-2">Albion Econ</h1>
      <p className="text-muted-foreground mb-8">Guild economy tools — Americas West</p>

      {/* Fetch status */}
      <div className="flex gap-4 mb-8 text-sm text-muted-foreground">
        <span>
          Watchlist: <strong className="text-foreground">{watchlistCount} items</strong>
        </span>
        <span>
          Last price fetch:{' '}
          <strong className="text-foreground">
            {lastFetch ? new Date(lastFetch).toLocaleString() : 'never'}
          </strong>
        </span>
      </div>

      {/* Module cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {modules.map((m) => (
          <Link key={m.href} href={m.href} className="block">
            <Card className="h-full hover:border-primary transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between mb-1">
                  <CardTitle className="text-lg">{m.title}</CardTitle>
                  {m.status === 'soon' && (
                    <Badge variant="secondary">Soon</Badge>
                  )}
                </div>
                <CardDescription>{m.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Start dev server and verify**

```bash
pnpm dev
```

Open `http://localhost:3000`. Expect: heading "Albion Econ", three module cards, fetch status line. If Supabase env not set, expect an error thrown from `supabase.ts` — that's correct behavior, not a bug.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/page.tsx
git commit -m "feat: add platform dashboard with fetch status and module links"
```

---

## Task 12: Module stubs

**Files:**
- Create: `app/craft/page.tsx`
- Create: `app/consumables/page.tsx`

- [ ] **Step 1: Write `app/craft/page.tsx`**

```tsx
export default function CraftPage() {
  return (
    <main className="container mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">Gear Crafting</h1>
      <p className="text-muted-foreground">Coming soon — P2.</p>
    </main>
  )
}
```

- [ ] **Step 2: Write `app/consumables/page.tsx`**

```tsx
export default function ConsumablesPage() {
  return (
    <main className="container mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">Consumables</h1>
      <p className="text-muted-foreground">Coming soon — P3.</p>
    </main>
  )
}
```

- [ ] **Step 3: Verify routes load**

With dev server running, open `/craft` and `/consumables`. Both should render their "coming soon" message.

- [ ] **Step 4: Run full test suite one final time**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/craft/page.tsx app/consumables/page.tsx
git commit -m "feat: add craft and consumables module stubs"
```

---

## Spec Coverage Self-Review

| Requirement | Task |
|---|---|
| Next.js 15 App Router + pnpm | Task 1 |
| Supabase client (service role) | Task 2 |
| `items` table | Task 3 |
| `price_observations` table + index | Task 3 |
| `daily_volume` table | Task 3 |
| `settings` table (single row, premium toggle) | Task 3 |
| `recipes` table (empty, created) | Task 3 |
| `lib/fees.ts` — all 5 functions with correct math | Task 4 |
| `lib/returnrate.ts` — typed stubs, throws in P1 | Task 5 |
| `lib/aodp.ts` — getCurrentPrices + getHistory, gzip, chunked | Task 6 |
| `lib/items.ts` — watchlist, livePrice, upserts, settings | Task 7 |
| Seed from ao-bin-dumps (tier, enchant, category, is_artifact, has_quality, recipes) | Task 8 |
| Canonical read rule (newest observed_at, guild wins tie) | Task 7 `getLivePrice` |
| Hourly cron, all 7 cities, quality logic | Task 9 |
| CRON_SECRET auth | Task 9 `middleware.ts` |
| Vercel Cron `0 * * * *` | Task 9 `vercel.json` |
| Dashboard: module links + fetch status | Task 11 |
| craft + consumables stubs | Task 12 |
| Tailwind + shadcn/ui | Task 10 |
