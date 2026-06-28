import { describe, it, expect } from 'vitest'
import { formatItemName } from '../display'

describe('formatItemName', () => {
  it('uses display_name when present', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG', enchant: 0 })).toBe("Adept's Bag")
  })
  it('falls back to item_id when display_name null/empty', () => {
    expect(formatItemName({ display_name: null, item_id: 'T4_BAG', enchant: 0 })).toBe('T4_BAG')
    expect(formatItemName({ display_name: '', item_id: 'T4_BAG', enchant: 0 })).toBe('T4_BAG')
  })
  it('omits enchant suffix at enchant 0', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG', enchant: 0 })).toBe("Adept's Bag")
  })
  it('appends enchant suffix when > 0', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG_1', enchant: 1 })).toBe("Adept's Bag .1")
  })
  it('omits quality suffix at quality 1 or undefined', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG', enchant: 0 }, 1)).toBe("Adept's Bag")
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG', enchant: 0 })).toBe("Adept's Bag")
  })
  it('appends quality when > 1', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG', enchant: 0 }, 3)).toBe("Adept's Bag Q3")
  })
  it('composes enchant + quality (spec example)', () => {
    expect(formatItemName({ display_name: "Adept's Bag", item_id: 'T4_BAG_1', enchant: 1 }, 2)).toBe("Adept's Bag .1 Q2")
  })
})
