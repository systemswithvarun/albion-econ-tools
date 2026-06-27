import { describe, it, expect, afterAll } from 'vitest'
import { reduceLivePrices, type RawObservation } from '../prices'
import { toItemId, buildNameMap } from '../../db/seed/name-map'

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
  it('returns an array for an item with no observations', async () => {
    const { getLivePricesForItem } = await import('../prices')
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
    await removeFavorite(ID)
    await addFavorite(ID)
    await addFavorite(ID)
    const list = await listFavorites()
    expect(list.some((r) => r.item_id === ID)).toBe(true)
    await removeFavorite(ID)
    const after = await listFavorites()
    expect(after.some((r) => r.item_id === ID)).toBe(false)
  })
})
