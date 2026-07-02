import { NextResponse } from 'next/server'
import { runPriceFetch, getLastPriceFetchAt, isWithinCooldown } from '@/lib/fetch-prices'

export const maxDuration = 300

/**
 * Manual price-fetch trigger for the flipper button. Runs the SAME runPriceFetch as the
 * cron (no divergent copy). The CRON_SECRET is never needed here — this endpoint does the
 * pull server-side with the service client; abuse is bounded by the 10-min cooldown.
 */
export async function POST() {
  try {
    const lastAt = await getLastPriceFetchAt()
    if (isWithinCooldown(lastAt, Date.now())) {
      return NextResponse.json({ skipped: true, last_at: lastAt })
    }
    const result = await runPriceFetch()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[fetch-prices/manual] ERROR', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
