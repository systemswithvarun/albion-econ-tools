/** Format an item for display: base name (or id fallback) + optional enchant + quality.
 *  e.g. { display_name: "Adept's Bag", enchant: 1 }, quality 2 -> "Adept's Bag .1 Q2". */
export function formatItemName(
  item: { display_name: string | null; item_id: string; enchant: number },
  quality?: number,
): string {
  const base = item.display_name && item.display_name.trim() ? item.display_name : item.item_id
  const ench = item.enchant > 0 ? ` .${item.enchant}` : ''
  const qual = quality !== undefined && quality > 1 ? ` Q${quality}` : ''
  return `${base}${ench}${qual}`
}
