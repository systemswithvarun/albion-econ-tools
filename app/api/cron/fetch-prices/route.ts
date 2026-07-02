import { NextResponse } from 'next/server'
import { runPriceFetch } from '@/lib/fetch-prices'

export const maxDuration = 300

// Hourly cron. Secret-gated by middleware.ts (/api/cron/*). Bypasses the manual
// cooldown (it's scheduled anyway) but runPriceFetch still stamps last_price_fetch_at.
export async function GET() {
  try {
    const result = await runPriceFetch()
    console.log(`[cron/fetch-prices] OK — ${result.items_fetched} items, volume_ok=${result.volume_ok}, ${result.elapsed_ms}ms`)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[cron/fetch-prices] ERROR', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
