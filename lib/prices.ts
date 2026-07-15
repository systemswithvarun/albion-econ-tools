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

/** A favorite row: the item's display fields plus its sort position.
 *  sort_order null = auto bucket; non-null = pinned. */
export type FavoriteItem = ItemSearchResult & { sort_order: number | null }

export type LivePrice = {
  city: string
  quality: number
  side: Side
  price: number
  source: 'aodp' | 'guild'
  observed_at: string
}

export type RawObservation = LivePrice

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

/** Fuzzy item search via pg_trgm RPC: substring OR trigram-similar, ranked. Empty query -> []. */
export async function searchItems(
  query: string,
  opts?: { limit?: number; offset?: number },
): Promise<ItemSearchResult[]> {
  const term = query.trim()
  if (!term) return []
  const { data, error } = await supabase.rpc('search_items', {
    q: term,
    lim: opts?.limit ?? 50,
    off: opts?.offset ?? 0,
  })
  if (error) throw error
  return ((data ?? []) as Array<{ item_id: string; display_name: string | null; tier: number; enchant: number; category: string }>).map((r) => ({
    item_id: r.item_id,
    display_name: r.display_name ?? r.item_id,
    tier: r.tier,
    enchant: r.enchant,
    category: r.category,
  }))
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

/**
 * Favorites for one client in sorted order (SPEC E1): pinned items (sort_order not
 * null) first by sort_order asc, then auto items by family (base_key) + tier + enchant.
 * Ordering lives in the list_favorites RPC — single source, joins items for the sort.
 * clientId null (first paint before the cookie round-trips) → empty list, no query.
 * Paginated across pages (PostgREST 1000-row cap) even though no watchlist reaches it.
 */
export async function listFavorites(
  clientId: string | null,
  opts?: { limit?: number; offset?: number },
): Promise<FavoriteItem[]> {
  if (!clientId) return []
  type Row = { item_id: string; display_name: string | null; tier: number; enchant: number; category: string; sort_order: number | null }
  const map = (rows: Row[]): FavoriteItem[] =>
    rows.map((r) => ({
      item_id: r.item_id,
      display_name: r.display_name ?? r.item_id,
      tier: r.tier,
      enchant: r.enchant,
      category: r.category,
      sort_order: r.sort_order,
    }))

  // Explicit paging requested → single RPC page.
  if (opts) {
    const { data, error } = await supabase.rpc('list_favorites', {
      cid: clientId,
      lim: opts.limit ?? 100,
      off: opts.offset ?? 0,
    })
    if (error) throw error
    return map((data ?? []) as Row[])
  }

  // Default → walk all pages so a caller that wants "the whole list" is never silently
  // truncated at the RPC's default limit.
  const PAGE = 1000
  const out: FavoriteItem[] = []
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabase.rpc('list_favorites', { cid: clientId, lim: PAGE, off })
    if (error) throw error
    const rows = (data ?? []) as Row[]
    out.push(...map(rows))
    if (rows.length < PAGE) break
  }
  return out
}

/** Drag persist (SPEC E1): pin one favorite to a manual position, or unpin it (null).
 *  Gap-based convention — pinned rows are spaced by 100; the caller writes a midpoint
 *  to slot between neighbours, and only calls renumberFavorites when a gap is exhausted.
 *  Fails loud if the item isn't one of this client's favorites (guard discipline). */
export async function setFavoriteSortOrder(
  clientId: string,
  itemId: string,
  sortOrder: number | null,
): Promise<void> {
  const id = itemId.trim().toUpperCase()
  const { data, error } = await supabase
    .from('favorites')
    .update({ sort_order: sortOrder })
    .eq('client_id', clientId)
    .eq('item_id', id)
    .select('item_id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`setFavoriteSortOrder: no favorite ${id} for this client`)
}

/** Re-auto (SPEC E1): clear every pin for the client → whole list returns to auto
 *  family + tier order. Zero rows is a legitimate empty list, not a failure. */
export async function reautoFavorites(clientId: string): Promise<void> {
  const { error } = await supabase
    .from('favorites')
    .update({ sort_order: null })
    .eq('client_id', clientId)
  if (error) throw error
}

/** Renumber pins to a clean step-100 sequence in the given order — the escape hatch
 *  for when gap-based inserts exhaust the integer space between two neighbours. Every
 *  id must be one of the client's favorites, or it fails loud. */
export async function renumberFavorites(clientId: string, orderedItemIds: string[]): Promise<void> {
  for (let i = 0; i < orderedItemIds.length; i++) {
    await setFavoriteSortOrder(clientId, orderedItemIds[i], (i + 1) * 100)
  }
}

/** Add favorite for a client (uppercases id, like guild entry). Idempotent on duplicate. */
export type DailyVolumeRecord = {
  city: string
  avg_sold: number
  avg_price: number
}

export async function addFavorite(clientId: string, itemId: string): Promise<void> {
  const id = itemId.trim().toUpperCase()
  const { error } = await supabase
    .from('favorites')
    .upsert({ client_id: clientId, item_id: id }, { onConflict: 'client_id,item_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function removeFavorite(clientId: string, itemId: string): Promise<void> {
  const id = itemId.trim().toUpperCase()
  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('client_id', clientId)
    .eq('item_id', id)
  if (error) throw error
}

/**
 * For a list of item IDs, checks freshness, fetches missing/stale prices from AODP,
 * and returns the reduced live prices for all items grouped by item_id.
 */
export async function getMultipleItemsPrices(itemIds: string[]): Promise<Record<string, LivePrice[]>> {
  if (itemIds.length === 0) return {}
  const ids = itemIds.map(id => id.trim().toUpperCase())

  // To determine freshness for each item:
  // Query the latest observed_at for each item from price_observations
  const { data: latestObs, error: lErr } = await supabase
    .from('price_observations')
    .select('item_id, observed_at')
    .in('item_id', ids)
    .order('item_id')
    .order('observed_at', { ascending: false })

  if (lErr) throw lErr

  // Group by item_id and get the newest observed_at
  const newestByItem = new Map<string, string>()
  for (const row of latestObs ?? []) {
    if (!newestByItem.has(row.item_id)) {
      newestByItem.set(row.item_id, row.observed_at)
    }
  }

  // Determine which items are stale (or have no data)
  const staleIds: string[] = []
  const now = Date.now()
  for (const id of ids) {
    const newest = newestByItem.get(id) ?? null
    if (!isFresh(newest, now)) {
      staleIds.push(id)
    }
  }

  // Fetch stale items in batch from AODP
  if (staleIds.length > 0) {
    const fetched = await getCurrentPrices(staleIds, [...CITIES], ALL_QUALITIES)
    if (fetched.length > 0) {
      await upsertPriceObservations(fetched)
    }
  }

  // Now read the live prices for all itemIds. The select carries item_id (needed to
  // group), so the row type must too — RawObservation alone doesn't have it.
  const allRows = await selectAll<RawObservation & { item_id: string }>((from, to) =>
    supabase
      .from('price_observations')
      .select('item_id, city, quality, side, price, source, observed_at')
      .in('item_id', ids)
      .order('observed_at', { ascending: false })
      .range(from, to),
  )

  // Reduce prices per item_id
  const results: Record<string, LivePrice[]> = {}
  for (const id of ids) {
    results[id] = []
  }

  // Group rows by item_id
  const rowsByItem: Record<string, RawObservation[]> = {}
  for (const r of allRows) {
    const id = r.item_id
    if (!rowsByItem[id]) rowsByItem[id] = []
    rowsByItem[id].push(r)
  }

  for (const id of ids) {
    const itemRows = rowsByItem[id] ?? []
    results[id] = reduceLivePrices(itemRows)
  }

  return results
}

/**
 * Batch query average sold and price for a list of item IDs.
 */
export async function getMultipleItemsDailyVolume(itemIds: string[]): Promise<Record<string, DailyVolumeRecord[]>> {
  if (itemIds.length === 0) return {}
  const ids = itemIds.map(id => id.trim().toUpperCase())
  const { data, error } = await supabase
    .from('daily_volume')
    .select('item_id, city, avg_sold, avg_price')
    .in('item_id', ids)
  if (error) throw error

  const results: Record<string, DailyVolumeRecord[]> = {}
  for (const id of ids) {
    results[id] = []
  }
  for (const v of data ?? []) {
    const itemId = v.item_id
    results[itemId].push({
      city: v.city,
      avg_sold: v.avg_sold,
      avg_price: v.avg_price,
    })
  }
  return results
}
