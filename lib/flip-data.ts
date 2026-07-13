import { supabase } from './supabase'
import { scanRoutes, type FlipRoute, type ItemMarket, type FlipFilters, type PriceQuote } from './flip'

export type FlipSettings = FlipFilters

const SETTINGS_COLS = 'premium, disposable_cash, daily_target, min_margin_pct, max_staleness_hr, min_daily_volume'

const DEFAULT_FLIP_SETTINGS: FlipSettings = {
  premium: false,
  disposableCash: 0,
  dailyTarget: 0,
  minMarginPct: 5,
  maxStalenessHr: 6,
  minDailyVolume: 0,
}

function mapSettingsRow(d: {
  premium: boolean
  disposable_cash: number | string
  daily_target: number | string
  min_margin_pct: number | string
  max_staleness_hr: number
  min_daily_volume: number
}): FlipSettings {
  return {
    premium: d.premium,
    disposableCash: Number(d.disposable_cash),
    dailyTarget: Number(d.daily_target),
    minMarginPct: Number(d.min_margin_pct),
    maxStalenessHr: d.max_staleness_hr,
    minDailyVolume: d.min_daily_volume,
  }
}

/**
 * Read one client's settings row. clientId null (first paint) → in-memory defaults, no
 * write. First read for a known-but-unseen client inserts a defaults row, then returns it.
 */
export async function getFlipSettings(clientId: string | null): Promise<FlipSettings> {
  if (!clientId) return { ...DEFAULT_FLIP_SETTINGS }
  const { data, error } = await supabase
    .from('settings')
    .select(SETTINGS_COLS)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    const { data: inserted, error: iErr } = await supabase
      .from('settings')
      .insert({ client_id: clientId })
      .select(SETTINGS_COLS)
      .single()
    if (iErr) throw iErr
    return mapSettingsRow(inserted)
  }
  return mapSettingsRow(data)
}

export interface FlipSettingsUpdate {
  premium?: boolean
  disposableCash?: number
  dailyTarget?: number
  minMarginPct?: number
  maxStalenessHr?: number
  minDailyVolume?: number
}

/** Update (or first-time create) one client's settings row. */
export async function updateFlipSettings(clientId: string, patch: FlipSettingsUpdate): Promise<void> {
  const row: Record<string, unknown> = { client_id: clientId }
  if (patch.premium !== undefined) row.premium = patch.premium
  if (patch.disposableCash !== undefined) row.disposable_cash = patch.disposableCash
  if (patch.dailyTarget !== undefined) row.daily_target = patch.dailyTarget
  if (patch.minMarginPct !== undefined) row.min_margin_pct = patch.minMarginPct
  if (patch.maxStalenessHr !== undefined) row.max_staleness_hr = patch.maxStalenessHr
  if (patch.minDailyVolume !== undefined) row.min_daily_volume = patch.minDailyVolume
  // upsert so an unknown client's first write also creates the row.
  const { error } = await supabase.from('settings').upsert(row, { onConflict: 'client_id' })
  if (error) throw error
}

/**
 * Set items.in_watchlist per the Module 1 rule:
 *   equipment (weapons/armors/offhands/head/shoes) with is_artifact=false,
 *   plus all bags (which includes the T4-8_BAG_INSIGHT satchels).
 * Idempotent: recomputes the whole column.
 */
export async function rebuildWatchlist(): Promise<number> {
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
  display_name: string | null
  enchant: number
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
      .select('item_id, base_name, display_name, enchant, category, city, quality, side, price, observed_at')
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

  const markets = new Map<string, ItemMarket>()
  for (const r of priceRows) {
    const key = `${r.item_id}::${r.quality}`
    let m = markets.get(key)
    if (!m) {
      m = {
        itemId: r.item_id,
        baseName: r.base_name,
        displayName: r.display_name,
        enchant: r.enchant,
        quality: r.quality,
        category: r.category,
        buyQuotes: [],
        sellQuotes: [],
        volumeByCity: volByItemCity.get(r.item_id) ?? {},
      }
      markets.set(key, m)
    }
    const quote: PriceQuote = { city: r.city, price: r.price, observed_at: r.observed_at }
    if (r.side === 'sell_order') m.buyQuotes.push(quote)
    else m.sellQuotes.push(quote)
  }

  return [...markets.values()]
}

/** Routes for a single item (price-checker's second entry mode). Reads that item's
 *  latest prices directly from price_observations (not the watchlist view) so it works
 *  for any item, then runs the same scan engine with current settings. */
export async function getRoutesForItem(clientId: string | null, itemId: string): Promise<FlipRoute[]> {
  const id = itemId.trim().toUpperCase()
  const settings = await getFlipSettings(clientId)

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

  const byQuality = new Map<number, ItemMarket>()
  for (const r of obs ?? []) {
    let m = byQuality.get(r.quality)
    if (!m) {
      m = {
        itemId: id,
        baseName: item.display_name ?? id,
        displayName: item.display_name,
        enchant: item.enchant,
        quality: r.quality,
        category: item.category,
        buyQuotes: [],
        sellQuotes: [],
        volumeByCity,
      }
      byQuality.set(r.quality, m)
    }
    const q = { city: r.city, price: r.price, observed_at: r.observed_at }
    if (r.side === 'sell_order') m.buyQuotes.push(q)
    else m.sellQuotes.push(q)
  }
  return scanRoutes([...byQuality.values()], settings, new Date()).routes
}
