/** Return rate math — implemented in P2. Stubs here ensure callers can import and type-check. */

export interface ReturnRateInput {
  itemId: string
  city: string
  premium: boolean
}

export interface ReturnRateResult {
  /** Fraction of resources returned (0–1) */
  returnRate: number
  /** Expected resource cost after returns */
  effectiveCost: number
}

/**
 * Calculate resource return rate and effective craft cost.
 * STUB — throws in P1. P2 fills in real math without changing this signature.
 */
export function calcReturnRate(_input: ReturnRateInput): ReturnRateResult {
  throw new Error('calcReturnRate not implemented until P2')
}
