/**
 * Profit × margin, collapsed into one judgment the tool stamps (design §③, 1h).
 *
 * The pair "big profit / thin margin" is a trap and "fat margin / no silver" is noise;
 * a rule names which. Bands (from the design doc), evaluated in precedence order so the
 * four tile cleanly with no gaps:
 *
 *   NOISE  profit < 8k                     — not enough silver to bother, whatever the %
 *   THIN   margin < 12%   (profit ≥ 8k)    — the trap: real silver, margin too thin
 *   PRIME  profit ≥ 30k AND margin ≥ 25%   — put silver here
 *   SOLID  everything else                 — profit ≥ 8k, margin ≥ 12%, not prime
 */
export type Verdict = 'PRIME' | 'SOLID' | 'THIN' | 'NOISE'

export const NOISE_MAX_PROFIT = 8_000
export const THIN_MAX_MARGIN = 12
export const PRIME_MIN_PROFIT = 30_000
export const PRIME_MIN_MARGIN = 25

export function computeVerdict(profit: number, marginPct: number): Verdict {
  if (profit < NOISE_MAX_PROFIT) return 'NOISE'
  if (marginPct < THIN_MAX_MARGIN) return 'THIN'
  if (profit >= PRIME_MIN_PROFIT && marginPct >= PRIME_MIN_MARGIN) return 'PRIME'
  return 'SOLID'
}

export interface VerdictStyle {
  fg: string
  bg: string
  border: string
}

const STYLE: Record<Verdict, VerdictStyle> = {
  PRIME: { fg: '#e8c06a', bg: '#1d160a', border: '#4a3d20' },
  SOLID: { fg: '#7dae6b', bg: '#17200f', border: '#2c3a22' },
  THIN: { fg: '#d69a3f', bg: '#241a0c', border: '#4a3416' },
  NOISE: { fg: '#6b6250', bg: '#17140e', border: '#2e2718' },
}

export function verdictStyle(v: Verdict): VerdictStyle {
  return STYLE[v]
}
