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
    expect(r!.marginPct).toBeCloseTo(20)
  })

  it('computes units, realizable, and routeDailyProfit', () => {
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
      buyQuotes: [{ city: 'Lymhurst', price: 23000, observed_at: '2026-06-27T05:00:00Z' }],
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
    expect(routes[0].netPerUnit).toBeCloseTo(5800)
  })
})

describe('scanRoutes — ranking + basket', () => {
  const lowVolHighMargin: ItemMarket = {
    itemId: 'A', baseName: 'A', quality: 1, category: 'weapons',
    buyQuotes: [{ city: 'Lymhurst', price: 10000, observed_at: fresh }],
    sellQuotes: [{ city: 'BlackMarket', price: 20000, observed_at: fresh }],
    volumeByCity: { BlackMarket: 1 },
  }
  const highVolLowMargin: ItemMarket = {
    itemId: 'B', baseName: 'B', quality: 1, category: 'weapons',
    buyQuotes: [{ city: 'Martlock', price: 10000, observed_at: fresh }],
    sellQuotes: [{ city: 'BlackMarket', price: 11500, observed_at: fresh }],
    volumeByCity: { BlackMarket: 500 },
  }

  it('ranks by routeDailyProfit, not margin (kills low-volume trap)', () => {
    const { routes } = scanRoutes([lowVolHighMargin, highVolLowMargin], baseFilters(), NOW)
    expect(routes[0].itemId).toBe('B')
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
