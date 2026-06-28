/** Canonical spaceless city names. Order = display order. AODP (west) serves all of
 *  these natively, including Brecilien — no normalization needed. */
export const CITIES = [
  'Thetford',
  'FortSterling',
  'Lymhurst',
  'Bridgewatch',
  'Martlock',
  'Caerleon',
  'Brecilien',
  'BlackMarket',
] as const

/** Royal cities only — the acquisition set (cheapest places to instant-buy).
 *  Excludes Brecilien (rest-zone hub) and BlackMarket. */
export const ROYAL_CITIES = [
  'Thetford',
  'FortSterling',
  'Lymhurst',
  'Bridgewatch',
  'Martlock',
  'Caerleon',
] as const

export type City = (typeof CITIES)[number]
