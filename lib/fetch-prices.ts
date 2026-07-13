import { getCurrentPrices, getHistory } from './aodp'
import { getWatchlistItems, upsertPriceObservations, upsertDailyVolume } from './items'
import { CITIES } from './cities'
import { supabase } from './supabase'

/** Manual-fetch cooldown: the manual route refuses to re-pull within this window. */
export const MANUAL_COOLDOWN_MS = 10 * 60 * 1000

export interface FetchResult {
  items_fetched: number
  volume_ok: boolean
  elapsed_ms: number
}

/**
 * Single source of truth for the price pull. Called by BOTH the hourly cron and the
 * manual button so the two trigger paths can never run divergent copies. Pulls current
 * prices for all watchlist items across every city (royals + Brecilien + Black Market)
 * x qualities, upserts observations, refreshes daily volume (best-effort), and stamps
 * settings.last_price_fetch_at so the cooldown guard can see it.
 */
export async function runPriceFetch(): Promise<FetchResult> {
  const started = Date.now()
  const items = await getWatchlistItems()
  if (items.length === 0) {
    return { items_fetched: 0, volume_ok: true, elapsed_ms: Date.now() - started }
  }

  const itemIds = items.map((i) => i.item_id)
  const qualityItems = items.filter((i) => i.has_quality).map((i) => i.item_id)
  const noQualityItems = items.filter((i) => !i.has_quality).map((i) => i.item_id)

  const [withQualRows, noQualRows] = await Promise.all([
    qualityItems.length > 0
      ? getCurrentPrices(qualityItems, [...CITIES], [1, 2, 3, 4, 5])
      : Promise.resolve([]),
    noQualityItems.length > 0
      ? getCurrentPrices(noQualityItems, [...CITIES], [1])
      : Promise.resolve([]),
  ])

  await upsertPriceObservations([...withQualRows, ...noQualRows])

  // Volume is secondary data — a failure here must not fail the whole pull.
  let volume_ok = true
  try {
    for (const city of CITIES) {
      const volumeRows = await getHistory(itemIds, city)
      await upsertDailyVolume(volumeRows)
    }
  } catch (e) {
    volume_ok = false
    console.warn('[runPriceFetch] volume step failed:', e instanceof Error ? e.message : JSON.stringify(e))
  }

  // Stamp the GLOBAL cooldown timestamp on every successful pull (both cron and manual).
  // Lives in fetch_state (single row) — the price DB is shared, so the cooldown is global,
  // not per-client. Cron has no client_id, so this must not depend on one.
  const { error: tsErr } = await supabase
    .from('fetch_state')
    .update({ last_price_fetch_at: new Date().toISOString() })
    .eq('id', 1)
  if (tsErr) throw tsErr

  return { items_fetched: items.length, volume_ok, elapsed_ms: Date.now() - started }
}

/** Read the last successful pull timestamp (ISO) for the cooldown guard. */
export async function getLastPriceFetchAt(): Promise<string | null> {
  const { data, error } = await supabase
    .from('fetch_state')
    .select('last_price_fetch_at')
    .eq('id', 1)
    .single()
  if (error) throw error
  return data?.last_price_fetch_at ?? null
}

/** Pure: is a pull too recent to run again? (null = never pulled → allowed). */
export function isWithinCooldown(lastAt: string | null, now: number, windowMs = MANUAL_COOLDOWN_MS): boolean {
  if (!lastAt) return false
  return now - new Date(lastAt).getTime() < windowMs
}
