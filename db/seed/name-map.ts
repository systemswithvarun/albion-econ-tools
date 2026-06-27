export interface FormattedItem {
  UniqueName?: string
  LocalizedNames?: Record<string, string> | null
}

export function toItemId(uniqueName: string): string {
  return uniqueName.replace(/@/g, '_')
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
