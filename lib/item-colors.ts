/**
 * Tier and quality colors — game-accurate, carrying item identity so v1 needs no icons
 * (design §⑥). Tier badge = "{tier}.{enchant}"; quality is a small dot.
 */

// Albion tier ramp: T2 hedge-green, T3 teal, T4 blue, T5 red, T6 orange, T7 gold, T8 near-white.
const TIER_FG: Record<number, string> = {
  2: '#7a9a6b',
  3: '#5fa0a0',
  4: '#5d87c6',
  5: '#c05a52',
  6: '#cd8438',
  7: '#d4b84a',
  8: '#d8d2c4',
}

export function tierColor(tier: number): string {
  return TIER_FG[tier] ?? '#9a8d72'
}

/** Tier from a DB item id ("T6_2H_CLAYMORE_3" -> 6). 0 if it has no T# prefix. */
export function tierFromId(itemId: string): number {
  const m = /^T(\d+)_/.exec(itemId)
  return m ? parseInt(m[1], 10) : 0
}

/** Muted, dark-tinted background behind the tier badge (derived from its hue). */
export function tierBg(tier: number): string {
  const BG: Record<number, string> = {
    2: '#1a2114',
    3: '#152220',
    4: '#141c28',
    5: '#241413',
    6: '#241a0e',
    7: '#231f0e',
    8: '#232018',
  }
  return BG[tier] ?? '#1c1710'
}

/** Badge text like "6.1" (tier.enchant); enchant 0 renders as "6.0". */
export function tierBadge(tier: number, enchant: number): string {
  return `${tier}.${enchant}`
}

// Quality 1–5: normal, good, outstanding, excellent, masterpiece.
const QUALITY_COLOR: Record<number, string> = {
  1: '#9a8d72',
  2: '#7dae6b',
  3: '#5d87c6',
  4: '#a874c0',
  5: '#d4b84a',
}

export function qualityColor(quality: number): string {
  return QUALITY_COLOR[quality] ?? '#9a8d72'
}

const QUALITY_LABEL: Record<number, string> = {
  1: 'Normal',
  2: 'Good',
  3: 'Outstanding',
  4: 'Excellent',
  5: 'Masterpiece',
}

export function qualityLabel(quality: number): string {
  return QUALITY_LABEL[quality] ?? 'Normal'
}

/** Three-letter city tag used in dense rows: Fort Sterling → FS, Black Market → BM. */
export function cityTag(city: string): string {
  const TAG: Record<string, string> = {
    Thetford: 'TH',
    FortSterling: 'FS',
    Lymhurst: 'LY',
    Bridgewatch: 'BW',
    Martlock: 'MK',
    Caerleon: 'CA',
    Brecilien: 'BR',
    BlackMarket: 'BM',
  }
  return TAG[city] ?? city.slice(0, 2).toUpperCase()
}
