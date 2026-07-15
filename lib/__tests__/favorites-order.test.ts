import { describe, it, expect } from 'vitest'
import { sortFavorites, moveItem, pinPositionFor, PIN_STEP } from '../favorites-order'

const row = (item_id: string, sort_order: number | null = null) => ({ item_id, sort_order })

describe('sortFavorites', () => {
  it('puts pinned rows first by sort_order, auto rows after', () => {
    const out = sortFavorites([row('A'), row('B', 200), row('C'), row('D', 100)])
    expect(out.map((r) => r.item_id)).toEqual(['D', 'B', 'A', 'C'])
  })
  it('keeps auto rows in the order the server gave them (stable)', () => {
    const out = sortFavorites([row('BAG_T4'), row('BAG_T8'), row('CAPE_T4')])
    expect(out.map((r) => r.item_id)).toEqual(['BAG_T4', 'BAG_T8', 'CAPE_T4'])
  })
  it('does not mutate the input', () => {
    const input = [row('A'), row('B', 100)]
    sortFavorites(input)
    expect(input.map((r) => r.item_id)).toEqual(['A', 'B'])
  })
})

describe('moveItem', () => {
  it('moves a row to the target index', () => {
    const out = moveItem([row('A'), row('B'), row('C')], 'C', 'A')
    expect(out.map((r) => r.item_id)).toEqual(['C', 'A', 'B'])
  })
  it('returns the list unchanged for a no-op or unknown id', () => {
    const list = [row('A'), row('B')]
    expect(moveItem(list, 'A', 'A')).toBe(list)
    expect(moveItem(list, 'Z', 'A')).toBe(list)
  })
})

describe('pinPositionFor', () => {
  it('pins to PIN_STEP when nothing else is pinned (rest stays auto below)', () => {
    // The E1 acceptance: drag one item to top of an all-auto list.
    const next = [row('CAPE'), row('BAG_T4'), row('BAG_T8')]
    expect(pinPositionFor(next, 0)).toBe(PIN_STEP)
  })
  it('halves the gap above the first pin when dropped at top', () => {
    const next = [row('X'), row('P', 100)]
    expect(pinPositionFor(next, 0)).toBe(50)
  })
  it('takes the midpoint between two pins', () => {
    const next = [row('P1', 100), row('X'), row('P2', 200)]
    expect(pinPositionFor(next, 1)).toBe(150)
  })
  it('steps past the last pin when dropped into the auto region', () => {
    const next = [row('P1', 100), row('X'), row('AUTO')]
    expect(pinPositionFor(next, 1)).toBe(200)
  })
  it('ignores auto rows as gap bounds', () => {
    // AUTO between the pins must not affect the midpoint.
    const next = [row('P1', 100), row('AUTO'), row('X'), row('P2', 200)]
    expect(pinPositionFor(next, 2)).toBe(150)
  })
  it('returns null when no integer fits — caller must renumber', () => {
    expect(pinPositionFor([row('P1', 100), row('X'), row('P2', 101)], 1)).toBeNull()
    expect(pinPositionFor([row('P1', 100), row('X'), row('P2', 100)], 1)).toBeNull()
  })
})
