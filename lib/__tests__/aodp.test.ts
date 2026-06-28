import { describe, it, expect } from 'vitest'
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
})
