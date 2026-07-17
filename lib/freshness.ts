/**
 * Data-freshness bins — the green→amber→rust ramp, reserved exclusively for price age.
 *
 * Thresholds (operator's call, not AODP's 15-min cache):
 *   fresh  = under 1 hour
 *   aging  = 1 to 3 hours
 *   stale  = over 3 hours
 */
export type Freshness = 'fresh' | 'aging' | 'stale'

export const FRESH_MAX_HR = 1
export const AGING_MAX_HR = 3

/** Bin an age in hours. A route's age is the older of its two quote ages. */
export function classifyAge(ageHr: number): Freshness {
  if (ageHr < FRESH_MAX_HR) return 'fresh'
  if (ageHr < AGING_MAX_HR) return 'aging'
  return 'stale'
}

const COLOR: Record<Freshness, string> = {
  fresh: 'var(--fresh)',
  aging: 'var(--aging)',
  stale: 'var(--stale)',
}

/** CSS color for a bin — token, so it tracks the theme. */
export function freshnessColor(f: Freshness): string {
  return COLOR[f]
}

const LABEL: Record<Freshness, string> = {
  fresh: 'FRESH · UNDER 1H',
  aging: 'AGING · 1–3H',
  stale: 'STALE · OVER 3H',
}

export function freshnessLabel(f: Freshness): string {
  return LABEL[f]
}

/** Compact age string: "42m", "2h 05m", "1h". */
export function formatAge(ageHr: number): string {
  const totalMin = Math.max(0, Math.round(ageHr * 60))
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`
}
