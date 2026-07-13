import { describe, it, expect, afterAll, vi } from 'vitest'
import { reduceLivePrices, isFresh, type RawObservation } from '../prices'
import { toItemId, toBaseKey, buildNameMap } from '../../db/seed/name-map'

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

describe('toBaseKey (family sort key)', () => {
  it('strips leading tier so every tier of a family shares one key', () => {
    expect(toBaseKey('T4_2H_CLAYMORE', 0)).toBe('2H_CLAYMORE')
    expect(toBaseKey('T8_2H_CLAYMORE', 0)).toBe('2H_CLAYMORE')
    // T2 and T3 (the acceptance edge) collapse to the same family, not just T4+.
    expect(toBaseKey('T2_BAG', 0)).toBe('BAG')
    expect(toBaseKey('T3_BAG', 0)).toBe('BAG')
    expect(toBaseKey('T8_BAG', 0)).toBe('BAG')
  })
  it('strips the trailing enchant suffix so enchants join their family', () => {
    expect(toBaseKey('T4_2H_CLAYMORE_1', 1)).toBe('2H_CLAYMORE')
    expect(toBaseKey('T4_2H_CLAYMORE_3', 3)).toBe('2H_CLAYMORE')
  })
  it('keeps a name that legitimately ends in a digit (enchant 0 -> no strip)', () => {
    expect(toBaseKey('T4_ARMOR_PLATE_SET1', 0)).toBe('ARMOR_PLATE_SET1')
    // its enchant-1 variant strips only the enchant suffix, rejoining the base
    expect(toBaseKey('T4_ARMOR_PLATE_SET1_1', 1)).toBe('ARMOR_PLATE_SET1')
  })
  it('leaves non-tier ids untouched', () => {
    expect(toBaseKey('UNIQUE_HIDEOUT', 0)).toBe('UNIQUE_HIDEOUT')
  })
})

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
      { ...base, price: 200, observed_at: '2026-06-27T12:00:00Z' },
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

describe('isFresh', () => {
  const now = new Date('2026-06-27T12:00:00Z').getTime()
  it('false for null', () => expect(isFresh(null, now)).toBe(false))
  it('true within 15 min', () => expect(isFresh('2026-06-27T11:50:00Z', now)).toBe(true))
  it('false past 15 min', () => expect(isFresh('2026-06-27T11:40:00Z', now)).toBe(false))
})

// Integration tests hit the real Supabase project. They are OPT-IN via RUN_DB_TESTS=1
// (not merely "creds present"), so a default `pnpm test` stays green and offline even
// when .env.local has creds but the DB hasn't been migrated/backfilled yet.
// Run them with: RUN_DB_TESTS=1 pnpm test   (after applying migrations 003 + 004).
const runDb = process.env.RUN_DB_TESTS === '1'
const dbDescribe = runDb ? describe : describe.skip

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

  // Asserts the RENDERED order (the array the UI maps in place), not the query text.
  // family = toBaseKey(item_id, enchant), recomputed here from the returned rows.
  it('groups each family contiguously, tier-ascending within (knight)', async () => {
    const { searchItems } = await import('../prices')
    const rows = await searchItems('knight', { limit: 200 })
    expect(rows.length).toBeGreaterThan(0)

    const fam = (r: { item_id: string; enchant: number }) => toBaseKey(r.item_id, r.enchant)

    // 1. No family reappears after it ends — families are contiguous blocks.
    const seen = new Set<string>()
    let prevFam: string | null = null
    for (const r of rows) {
      const f = fam(r)
      if (f !== prevFam) {
        expect(seen.has(f)).toBe(false) // would mean the family was split and resumed
        seen.add(f)
        prevFam = f
      }
    }

    // 2. Within a family, tier never goes out of sequence (asc), enchant asc on tier ties.
    prevFam = null
    let prevTier = -Infinity
    let prevEnch = -Infinity
    for (const r of rows) {
      const f = fam(r)
      if (f !== prevFam) {
        prevFam = f
        prevTier = r.tier
        prevEnch = r.enchant
        continue
      }
      expect(r.tier).toBeGreaterThanOrEqual(prevTier)
      if (r.tier === prevTier) expect(r.enchant).toBeGreaterThanOrEqual(prevEnch)
      prevTier = r.tier
      prevEnch = r.enchant
    }
  })

  // Acceptance edge: a family spanning T2–T8 must slot the low tiers first, not just T4+.
  it('orders a T2–T8 family (bag) with low tiers first', async () => {
    const { searchItems } = await import('../prices')
    const rows = await searchItems('bag', { limit: 200 })
    const bag = rows.filter((r) => toBaseKey(r.item_id, r.enchant) === 'BAG' && r.enchant === 0)
    const tiers = bag.map((r) => r.tier)
    expect(tiers).toContain(2)
    expect(tiers).toContain(3)
    // the BAG rows appear in ascending tier order
    expect([...tiers]).toEqual([...tiers].sort((a, b) => a - b))
  })
})

dbDescribe('getLivePricesForItem (integration)', () => {
  it('returns an array for an item with no observations', async () => {
    const { getLivePricesForItem } = await import('../prices')
    const out = await getLivePricesForItem('T1_SILVERBAG_NONTRADABLE')
    expect(Array.isArray(out)).toBe(true)
  })
})

dbDescribe('getItemPrices (integration)', () => {
  it('fills a grid for a known item and caches within 15 min', async () => {
    const prices = await import('../prices')
    const id = 'T4_BAG'
    const first = await prices.getItemPrices(id)
    expect(first.length).toBeGreaterThan(0) // guard: must return a grid, not silently empty

    // Second call: newest row is now < 15 min old, so it must take the fresh DB path
    // and NOT hit AODP. Prove via the freshness branch: spy on getCurrentPrices.
    const aodp = await import('../aodp')
    const spy = vi.spyOn(aodp, 'getCurrentPrices')
    const second = await prices.getItemPrices(id)
    expect(second.length).toBeGreaterThan(0)
    expect(spy).not.toHaveBeenCalled() // no AODP request on the cached path
    spy.mockRestore()
  })
})

dbDescribe('favorites (integration)', () => {
  const ID = 'T4_BAG'
  const A = 'test-client-a'
  const B = 'test-client-b'
  afterAll(async () => {
    const { removeFavorite } = await import('../prices')
    await removeFavorite(A, ID)
    await removeFavorite(B, ID)
  })
  it('round-trip, idempotent add, and per-client isolation', async () => {
    const { addFavorite, removeFavorite, listFavorites } = await import('../prices')
    await removeFavorite(A, ID)
    await removeFavorite(B, ID)

    await addFavorite(A, ID)
    await addFavorite(A, ID) // idempotent — must not throw
    const listA = await listFavorites(A)
    expect(listA.some((r) => r.item_id === ID)).toBe(true)

    // Isolation asserted by READING B's rows, not "column exists": B never sees A's favorite.
    const listB = await listFavorites(B)
    expect(listB.some((r) => r.item_id === ID)).toBe(false)

    await removeFavorite(A, ID)
    const afterA = await listFavorites(A)
    expect(afterA.some((r) => r.item_id === ID)).toBe(false)
  })
})
