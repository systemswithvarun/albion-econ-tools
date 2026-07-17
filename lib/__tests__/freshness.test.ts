import { describe, it, expect } from 'vitest'
import { classifyAge, formatAge, freshnessLabel } from '../freshness'

describe('classifyAge (1h / 3h bins)', () => {
  it('fresh under 1 hour', () => {
    expect(classifyAge(0)).toBe('fresh')
    expect(classifyAge(0.5)).toBe('fresh')
    expect(classifyAge(0.999)).toBe('fresh')
  })
  it('aging from 1 to 3 hours', () => {
    expect(classifyAge(1)).toBe('aging') // boundary: 1h is no longer fresh
    expect(classifyAge(2)).toBe('aging')
    expect(classifyAge(2.999)).toBe('aging')
  })
  it('stale at 3 hours and beyond', () => {
    expect(classifyAge(3)).toBe('stale') // boundary: 3h is stale
    expect(classifyAge(6)).toBe('stale')
    expect(classifyAge(100)).toBe('stale')
  })
})

describe('formatAge', () => {
  it('renders sub-hour as minutes', () => {
    expect(formatAge(0)).toBe('0m')
    expect(formatAge(0.75)).toBe('45m')
  })
  it('renders hours with zero-padded minutes', () => {
    expect(formatAge(1)).toBe('1h')
    expect(formatAge(1.5)).toBe('1h 30m')
    expect(formatAge(2 + 5 / 60)).toBe('2h 05m')
  })
})

describe('freshnessLabel', () => {
  it('names the operator thresholds, not the 15-min cache', () => {
    expect(freshnessLabel('fresh')).toMatch(/1H/)
    expect(freshnessLabel('aging')).toMatch(/1–3H/)
    expect(freshnessLabel('stale')).toMatch(/OVER 3H/)
  })
})
