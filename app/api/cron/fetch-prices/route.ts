import { NextResponse } from 'next/server'
import { getCurrentPrices, getHistory } from '@/lib/aodp'
import { getWatchlistItems, upsertPriceObservations, upsertDailyVolume } from '@/lib/items'

const CITIES = ['Thetford', 'FortSterling', 'Lymhurst', 'Bridgewatch', 'Martlock', 'Caerleon', 'BlackMarket']

export async function GET() {
  const started = Date.now()
  try {
    const items = await getWatchlistItems()
    if (items.length === 0) {
      return NextResponse.json({ ok: true, message: 'No watchlist items', elapsed_ms: 0 })
    }

    const itemIds = items.map((i) => i.item_id)

    // Prices: quality 1–5 for has_quality items, quality 1 only for others
    const qualityItems = items.filter((i) => i.has_quality).map((i) => i.item_id)
    const noQualityItems = items.filter((i) => !i.has_quality).map((i) => i.item_id)

    const [withQualRows, noQualRows] = await Promise.all([
      qualityItems.length > 0
        ? getCurrentPrices(qualityItems, CITIES, [1, 2, 3, 4, 5])
        : Promise.resolve([]),
      noQualityItems.length > 0
        ? getCurrentPrices(noQualityItems, CITIES, [1])
        : Promise.resolve([]),
    ])

    await upsertPriceObservations([...withQualRows, ...noQualRows])

    // Volume: one city at a time. Secondary data — must not fail the whole run.
    let volume_ok = true
    try {
      for (const city of CITIES) {
        const volumeRows = await getHistory(itemIds, city)
        await upsertDailyVolume(volumeRows)
      }
    } catch (e) {
      volume_ok = false
      console.warn('[cron/fetch-prices] volume step failed:', e instanceof Error ? e.message : JSON.stringify(e))
    }

    const elapsed_ms = Date.now() - started
    console.log(`[cron/fetch-prices] OK — ${items.length} items, volume_ok=${volume_ok}, ${elapsed_ms}ms`)
    return NextResponse.json({ ok: true, items_fetched: items.length, volume_ok, elapsed_ms })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[cron/fetch-prices] ERROR', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
