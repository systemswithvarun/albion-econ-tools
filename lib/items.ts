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

/** All items in watchlist — used by cron to know what to fetch.
 *  Paginates past PostgREST's 1000-row cap. */
export async function getWatchlistItems(): Promise<Item[]> {
  const pageSize = 1000
  let from = 0
  const all: Item[] = []
  for (;;) {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('in_watchlist', true)
      .range(from, from + pageSize - 1)
    if (error) throw error
    const batch = (data ?? []) as Item[]
    all.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return all
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
  rows: { item_id: string; city: string; avg_sold: number; avg_price: number; fetched_at: string }[]
): Promise<void> {
  if (rows.length === 0) return
  // Dedupe by (item_id, city) — a batch can't touch the same ON CONFLICT row twice
  const byKey = new Map<string, typeof rows[number]>()
  for (const r of rows) byKey.set(`${r.item_id}|${r.city}`, r)
  const deduped = [...byKey.values()]
  const { error } = await supabase
    .from('daily_volume')
    .upsert(deduped, { onConflict: 'item_id,city' })
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
