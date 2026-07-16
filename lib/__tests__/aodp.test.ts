import { describe, it, expect } from 'vitest'
import {
  chunkArray, buildPriceUrl, buildHistoryUrl, parseCurrentPrices, parseHistory,
  toAodpId, fromAodpId,
} from '../aodp'

// The DB stores enchant as `_N` (seed convention); AODP addresses it as `@N`. Everything
// below pins that translation — asking AODP for `T4_BAG_1` returns HTTP 200 with all-zero
// prices, so a wrong id looks exactly like "no orders" and fails silently.
describe('toAodpId (DB _N -> AODP @N)', () => {
  it('converts an enchanted id', () => {
    expect(toAodpId('T4_BAG_1', 1)).toBe('T4_BAG@1')
    expect(toAodpId('T8_2H_CLAYMORE_3', 3)).toBe('T8_2H_CLAYMORE@3')
  })
  it('leaves a base id untouched', () => {
    expect(toAodpId('T4_BAG', 0)).toBe('T4_BAG')
  })
  it('does NOT corrupt a base id that legitimately ends in a digit', () => {
    // enchant 0 — the trailing 1 is part of the name, not an enchant level.
    expect(toAodpId('T4_ARMOR_PLATE_SET1', 0)).toBe('T4_ARMOR_PLATE_SET1')
    // its enchant-1 variant converts only the real suffix
    expect(toAodpId('T4_ARMOR_PLATE_SET1_1', 1)).toBe('T4_ARMOR_PLATE_SET1@1')
  })
})

describe('fromAodpId (AODP @N -> DB _N)', () => {
  it('maps the enchant suffix back so it matches items.item_id', () => {
    expect(fromAodpId('T4_BAG@1')).toBe('T4_BAG_1')
    expect(fromAodpId('T4_ARMOR_PLATE_SET1@1')).toBe('T4_ARMOR_PLATE_SET1_1')
  })
  it('leaves a base id untouched', () => {
    expect(fromAodpId('T4_BAG')).toBe('T4_BAG')
  })
  it('round-trips with toAodpId', () => {
    for (const [id, e] of [['T4_BAG_1', 1], ['T4_ARMOR_PLATE_SET1', 0], ['T4_BAG', 0]] as [string, number][]) {
      expect(fromAodpId(toAodpId(id, e))).toBe(id)
    }
  })
})

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
    const url = buildPriceUrl([{ item_id: 'T4_SWORD', enchant: 0 }], ['Thetford'], [1])
    expect(url).toBe(
      'https://west.albion-online-data.com/api/v2/stats/prices/T4_SWORD.json?locations=Thetford&qualities=1'
    )
  })

  it('joins multiple items with comma', () => {
    const url = buildPriceUrl(
      [{ item_id: 'T4_SWORD', enchant: 0 }, { item_id: 'T5_SWORD', enchant: 0 }],
      ['Thetford'], [1],
    )
    expect(url).toContain('T4_SWORD,T5_SWORD')
  })

  it('asks for enchanted items with @, not the DB _ form', () => {
    const url = buildPriceUrl([{ item_id: 'T4_BAG_1', enchant: 1 }], ['Martlock'], [1])
    expect(url).toContain('T4_BAG@1.json')
    expect(url).not.toContain('T4_BAG_1.json')
  })
})

describe('buildHistoryUrl', () => {
  it('builds correct URL', () => {
    const url = buildHistoryUrl([{ item_id: 'T4_SWORD', enchant: 0 }], 'Thetford')
    expect(url).toBe(
      'https://west.albion-online-data.com/api/v2/stats/history/T4_SWORD.json?locations=Thetford&time-scale=24'
    )
  })

  it('asks for enchanted items with @ too (daily_volume had zero enchanted rows)', () => {
    const url = buildHistoryUrl([{ item_id: 'T4_BAG_1', enchant: 1 }], 'Martlock')
    expect(url).toContain('T4_BAG@1.json')
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

  it('maps the @ id back to the DB _ form so the FK to items holds', () => {
    // price_observations.item_id references items(item_id), and items stores T4_BAG_1.
    // Writing AODP's 'T4_BAG@1' verbatim would violate that FK.
    const raw = [
      {
        item_id: 'T4_BAG@1',
        city: 'Martlock',
        quality: 1,
        sell_price_min: 13595,
        sell_price_min_date: '2026-07-15T12:15:00',
        buy_price_max: 948,
        buy_price_max_date: '2026-07-16T00:50:00',
      },
    ]
    const rows = parseCurrentPrices(raw)
    expect(rows.map((r) => r.item_id)).toEqual(['T4_BAG_1', 'T4_BAG_1'])
  })
})

describe('parseHistory', () => {
  it('averages item_count across days for a city', () => {
    const raw = [
      {
        item_id: 'T4_SWORD',
        location: 'Thetford',
        data: [{ item_count: 10, avg_price: 100 }, { item_count: 20, avg_price: 200 }],
      },
    ]
    const rows = parseHistory(raw)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ item_id: 'T4_SWORD', city: 'Thetford', avg_sold: 15, avg_price: 150 })
  })

  it('yields avg_price 0 when data points lack avg_price', () => {
    const raw = [
      {
        item_id: 'T4_SWORD',
        location: 'Thetford',
        data: [{ item_count: 10 }, { item_count: 20 }],
      },
    ]
    const rows = parseHistory(raw)
    expect(rows[0]).toMatchObject({ avg_sold: 15, avg_price: 0 })
  })

  it('maps the @ id back to the DB _ form (daily_volume also FKs to items)', () => {
    const raw = [
      { item_id: 'T4_BAG@1', location: 'Martlock', data: [{ item_count: 10, avg_price: 100 }] },
    ]
    expect(parseHistory(raw)[0].item_id).toBe('T4_BAG_1')
  })
})
