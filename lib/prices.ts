import { supabase } from './supabase'
import { CITIES } from './cities'
import { getCurrentPrices, type PriceObservationInsert } from './aodp'
import { upsertPriceObservations } from './items'

export type Side = 'buy_order' | 'sell_order'

export type ItemSearchResult = {
  item_id: string
  display_name: string
  tier: number
  enchant: number
  category: string
}

export type LivePrice = {
  city: string
  quality: number
  side: Side
  price: number
  source: 'aodp' | 'guild'
  observed_at: string
}

export type RawObservation = LivePrice

const SELECT_COLS = 'item_id, display_name, tier, enchant, category'

/** Pure canonical read: newest per (city, quality, side); guild wins exact-time tie. */
export function reduceLivePrices(rows: RawObservation[]): LivePrice[] {
  const best = new Map<string, RawObservation>()
  for (const r of rows) {
    const key = `${r.city}|${r.quality}|${r.side}`
    const cur = best.get(key)
    if (!cur) { best.set(key, r); continue }
    const t = new Date(r.observed_at).getTime()
    const ct = new Date(cur.observed_at).getTime()
    if (t > ct) best.set(key, r)
    else if (t === ct && r.source === 'guild' && cur.source !== 'guild') best.set(key, r)
  }
  return [...best.values()]
}

export const FRESH_MS = 15 * 60 * 1000

/** Pure: is the newest observation within the freshness window? */
export function isFresh(newestObservedAt: string | null, now: number, windowMs = FRESH_MS): boolean {
  if (!newestObservedAt) return false
  return now - new Date(newestObservedAt).getTime() < windowMs
}

const ALL_QUALITIES = [1, 2, 3, 4, 5]

/**
 * Live prices for ANY item (price-checker engine). Fresh path: if the newest stored
 * observation is < 15 min old, return reduced DB rows. Stale/miss path: pull AODP for
 * all cities + qualities in one call, upsert (source 'aodp'), then return reduced rows.
 */
export async function getItemPrices(itemId: string): Promise<LivePrice[]> {
  const id = itemId.trim().toUpperCase()

  const { data: newestRows, error: nErr } = await supabase
    .from('price_observations')
    .select('observed_at')
    .eq('item_id', id)
    .order('observed_at', { ascending: false })
    .limit(1)
  if (nErr) throw nErr
  const newest = newestRows?.[0]?.observed_at ?? null

  if (isFresh(newest, Date.now())) {
    return getLivePricesForItem(id)
  }

  const fetched: PriceObservationInsert[] = await getCurrentPrices([id], [...CITIES], ALL_QUALITIES)
  if (fetched.length > 0) await upsertPriceObservations(fetched)
  return getLivePricesForItem(id)
}

/** Page a supabase query 1000 rows at a time (PostgREST default cap). */
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

/** Case-insensitive substring over display_name AND item_id; paginated. Empty query -> []. */
export async function searchItems(
  query: string,
  opts?: { limit?: number; offset?: number },
): Promise<ItemSearchResult[]> {
  const term = query.trim()
  if (!term) return []
  const limit = opts?.limit ?? 50
  const offset = opts?.offset ?? 0
  const safe = term.replace(/[%,()]/g, ' ')
  const { data, error } = await supabase
    .from('items')
    .select(SELECT_COLS)
    .or(`display_name.ilike.%${safe}%,item_id.ilike.%${safe}%`)
    .order('display_name', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw error
  return (data ?? []) as ItemSearchResult[]
}

/** All observations for the item, reduced to newest-per (city, quality, side). */
export async function getLivePricesForItem(itemId: string): Promise<LivePrice[]> {
  const rows = await selectAll<RawObservation>((from, to) =>
    supabase
      .from('price_observations')
      .select('city, quality, side, price, source, observed_at')
      .eq('item_id', itemId)
      .order('observed_at', { ascending: false })
      .range(from, to),
  )
  return reduceLivePrices(rows)
}

/** Favorites joined to items for names; paginated. */
export async function listFavorites(opts?: { limit?: number; offset?: number }): Promise<ItemSearchResult[]> {
  const limit = opts?.limit ?? 100
  const offset = opts?.offset ?? 0
  const { data, error } = await supabase
    .from('favorites')
    .select(`item_id, created_at, items!inner(${SELECT_COLS})`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error
  type Row = { items: ItemSearchResult | ItemSearchResult[] }
  return ((data ?? []) as unknown as Row[]).map((r) => (Array.isArray(r.items) ? r.items[0] : r.items))
}

/** Add favorite (uppercases id, like guild entry). Idempotent on duplicate. */
export async function addFavorite(itemId: string): Promise<void> {
  const id = itemId.trim().toUpperCase()
  const { error } = await supabase
    .from('favorites')
    .upsert({ item_id: id }, { onConflict: 'item_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function removeFavorite(itemId: string): Promise<void> {
  const id = itemId.trim().toUpperCase()
  const { error } = await supabase.from('favorites').delete().eq('item_id', id)
  if (error) throw error
}
