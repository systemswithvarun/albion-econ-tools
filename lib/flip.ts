import { instantBuyCost, instantSellNet } from './fees'
import { ROYAL_CITIES } from './cities'

export interface PriceQuote {
  city: string
  price: number
  observed_at: string // ISO timestamp
}

/** One item at one quality, with the freshest quote per city on each side. */
export interface ItemMarket {
  itemId: string
  baseName: string
  displayName: string | null
  enchant: number
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
  displayName: string | null
  enchant: number
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
  bmFlagged: boolean
  bmGap: BmGap | null
}

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
    const royalBuys = m.buyQuotes.filter((q) => (ROYAL_CITIES as readonly string[]).includes(q.city))
    const lowestAcquisition = royalBuys.length > 0 ? Math.min(...royalBuys.map((q) => q.price)) : 0
    const bmSell = m.sellQuotes.find((q) => q.city === 'BlackMarket')
    const bmBuyOrder = bmSell?.price ?? 0
    const bmGap = lowestAcquisition > 0 && bmBuyOrder > 0 ? computeBmGap(lowestAcquisition, bmBuyOrder) : null
    const bmFlagged = bmGap?.flagged ?? false

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
          displayName: m.displayName,
          enchant: m.enchant,
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
          bmFlagged,
          bmGap,
        })
      }
    }
  }

  routes.sort((a, b) =>
    Number(b.bmFlagged) - Number(a.bmFlagged) ||
    b.routeDailyProfit - a.routeDailyProfit ||
    b.netPerUnit - a.netPerUnit,
  )

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
