import { describe, it, expect } from 'vitest'
import { computeVerdict } from '../verdict'

describe('computeVerdict', () => {
  it('NOISE when profit is below 8k, regardless of margin', () => {
    expect(computeVerdict(5_000, 80)).toBe('NOISE')
    expect(computeVerdict(7_999, 25)).toBe('NOISE')
  })
  it('THIN when margin is under 12% but silver is real', () => {
    expect(computeVerdict(50_000, 11.9)).toBe('THIN') // the big-profit trap
    expect(computeVerdict(8_000, 5)).toBe('THIN')
  })
  it('PRIME only when both profit ≥ 30k and margin ≥ 25%', () => {
    expect(computeVerdict(30_000, 25)).toBe('PRIME')
    expect(computeVerdict(120_000, 40)).toBe('PRIME')
  })
  it('SOLID for the middle: enough silver, healthy margin, not prime', () => {
    expect(computeVerdict(15_000, 20)).toBe('SOLID')
    expect(computeVerdict(29_999, 25)).toBe('SOLID') // just below prime profit
    expect(computeVerdict(50_000, 24)).toBe('SOLID') // just below prime margin
    expect(computeVerdict(10_000, 12)).toBe('SOLID') // margin exactly at THIN boundary
  })
  it('bins tile with no gaps across the boundaries', () => {
    // margin exactly 12 is NOT thin; profit exactly 8k is NOT noise
    expect(computeVerdict(8_000, 12)).toBe('SOLID')
  })
})
