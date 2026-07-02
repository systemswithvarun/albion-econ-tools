import { describe, it, expect } from 'vitest'
import { isWithinCooldown, MANUAL_COOLDOWN_MS } from '../fetch-prices'

describe('isWithinCooldown', () => {
  const now = new Date('2026-06-27T12:00:00Z').getTime()

  it('allows when never pulled (null)', () => {
    expect(isWithinCooldown(null, now)).toBe(false)
  })

  it('blocks a pull 5 min ago (inside 10-min window)', () => {
    expect(isWithinCooldown('2026-06-27T11:55:00Z', now)).toBe(true)
  })

  it('allows a pull 11 min ago (outside window)', () => {
    expect(isWithinCooldown('2026-06-27T11:49:00Z', now)).toBe(false)
  })

  it('allows exactly at the window boundary', () => {
    const lastAt = new Date(now - MANUAL_COOLDOWN_MS).toISOString()
    expect(isWithinCooldown(lastAt, now)).toBe(false)
  })
})
