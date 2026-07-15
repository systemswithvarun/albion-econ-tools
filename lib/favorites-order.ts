/**
 * Pure ordering helpers for the favorites watchlist (SPEC E1, UI side).
 *
 * The server read order is: pinned rows (sort_order not null) first by sort_order asc,
 * then auto rows (null) by base_key -> tier -> enchant. These helpers mirror that rule
 * on the client so an optimistic drag shows what a reload will actually show.
 */

/** Pinned rows are spaced by this, leaving room to insert midpoints without renumbering. */
export const PIN_STEP = 100

export interface Positioned {
  item_id: string
  sort_order: number | null
}

/**
 * Server read order, client-side. Pinned first by sort_order; auto rows keep the
 * relative order the server already sorted them into (base_key/tier/enchant), which a
 * stable sort preserves. Never re-derives family order — that stays server-owned.
 */
export function sortFavorites<T extends Positioned>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const aAuto = a.sort_order == null
    const bAuto = b.sort_order == null
    if (aAuto !== bAuto) return aAuto ? 1 : -1
    if (aAuto && bAuto) return 0 // both auto → stable, keep server order
    return (a.sort_order as number) - (b.sort_order as number)
  })
}

/** Move fromId to sit where toId currently is. Returns a new array. */
export function moveItem<T extends Positioned>(list: T[], fromId: string, toId: string): T[] {
  const from = list.findIndex((f) => f.item_id === fromId)
  const to = list.findIndex((f) => f.item_id === toId)
  if (from < 0 || to < 0 || from === to) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Gap-based pin position for the row at movedIndex, from its nearest PINNED neighbours.
 * Auto rows carry no position, so they cannot bound the gap — pinned always sorts above
 * auto, which is why dropping into the auto region pins to the end of the pinned block.
 *
 * Returns null when no integer fits between the neighbours — the caller must renumber.
 */
export function pinPositionFor(next: Positioned[], movedIndex: number): number | null {
  let lo = 0
  for (let i = movedIndex - 1; i >= 0; i--) {
    const s = next[i].sort_order
    if (s != null) {
      lo = s
      break
    }
  }
  let hi: number | null = null
  for (let i = movedIndex + 1; i < next.length; i++) {
    const s = next[i].sort_order
    if (s != null) {
      hi = s
      break
    }
  }
  const upper = hi ?? lo + 2 * PIN_STEP
  const mid = Math.floor((lo + upper) / 2)
  if (mid <= lo || mid >= upper) return null // gap exhausted
  return mid
}
