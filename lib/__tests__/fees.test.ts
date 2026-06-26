import { describe, it, expect } from 'vitest'
import {
  taxRate,
  instantBuyCost,
  buyOrderCost,
  instantSellNet,
  sellOrderNet,
} from '../fees'

describe('fees — non-premium (8% tax)', () => {
  it('taxRate returns 0.08 when not premium', () => {
    expect(taxRate(false)).toBe(0.08)
  })

  it('instantBuyCost returns price as-is', () => {
    expect(instantBuyCost(1000)).toBe(1000)
  })

  it('buyOrderCost adds 2.5% setup fee', () => {
    expect(buyOrderCost(1000)).toBeCloseTo(1025)
  })

  it('instantSellNet deducts 8% tax', () => {
    expect(instantSellNet(1000, false)).toBeCloseTo(920)
  })

  it('sellOrderNet deducts tax + setup fee', () => {
    // 1000 * (1 - 0.08 - 0.025) = 1000 * 0.895 = 895
    expect(sellOrderNet(1000, false)).toBeCloseTo(895)
  })
})

describe('fees — premium (4% tax)', () => {
  it('taxRate returns 0.04 when premium', () => {
    expect(taxRate(true)).toBe(0.04)
  })

  it('instantSellNet deducts 4% tax', () => {
    expect(instantSellNet(1000, true)).toBeCloseTo(960)
  })

  it('sellOrderNet deducts 4% tax + setup fee', () => {
    // 1000 * (1 - 0.04 - 0.025) = 1000 * 0.935 = 935
    expect(sellOrderNet(1000, true)).toBeCloseTo(935)
  })
})
