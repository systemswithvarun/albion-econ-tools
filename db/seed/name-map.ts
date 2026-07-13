export interface FormattedItem {
  UniqueName?: string
  LocalizedNames?: Record<string, string> | null
}

export function toItemId(uniqueName: string): string {
  return uniqueName.replace(/@/g, '_')
}

/**
 * Family sort key: item_id stripped of its leading tier (`T#_`) and, for enchanted
 * rows, its trailing enchant suffix (`_<enchant>`). All tiers + enchants of one
 * family collapse to the same key so search results can group by family.
 *
 * MUST stay byte-identical to the SQL backfill in migrations/010_base_key.sql:
 *   strip ^T\d+_ , then (enchant>0) strip _<enchant>$ .
 *
 * Examples: (T4_2H_CLAYMORE,0)->2H_CLAYMORE  (T4_2H_CLAYMORE_3,3)->2H_CLAYMORE
 *           (T4_ARMOR_PLATE_SET1,0)->ARMOR_PLATE_SET1  (UNIQUE_HIDEOUT,0)->UNIQUE_HIDEOUT
 */
export function toBaseKey(itemId: string, enchant: number): string {
  let k = itemId.replace(/^T\d+_/, '')
  if (enchant > 0) k = k.replace(new RegExp(`_${enchant}$`), '')
  return k
}

export function buildNameMap(raw: FormattedItem[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const o of raw) {
    const un = o.UniqueName
    const name = o.LocalizedNames?.['EN-US']
    if (!un || !name) continue
    map.set(toItemId(un), name)
  }
  return map
}
