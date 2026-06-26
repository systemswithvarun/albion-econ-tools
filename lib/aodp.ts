const BASE = 'https://west.albion-online-data.com'
const CHUNK_SIZE = 100  // keep URLs under ~8 KB

// --- URL builders (exported for tests) ---

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

export function buildPriceUrl(itemIds: string[], cities: string[], qualities: number[]): string {
  const ids = itemIds.join(',')
  const locs = cities.join(',')
  const quals = qualities.join(',')
  return `${BASE}/api/v2/stats/prices/${ids}.json?locations=${locs}&qualities=${quals}`
}

export function buildHistoryUrl(itemIds: string[], city: string): string {
  const ids = itemIds.join(',')
  return `${BASE}/api/v2/stats/history/${ids}.json?locations=${city}&time-scale=24`
}

// --- Response types ---

export interface AodpPriceRow {
  item_id: string
  city: string
  quality: number
  sell_price_min: number
  sell_price_min_date: string
  buy_price_max: number
  buy_price_max_date: string
}

export interface AodpHistoryRow {
  item_id: string
  location: string
  data: { item_count: number; timestamp?: string }[]
}

export interface PriceObservationInsert {
  item_id: string
  city: string
  quality: number
  side: 'buy_order' | 'sell_order'
  price: number
  source: 'aodp'
  observed_at: string
}

export interface DailyVolumeInsert {
  item_id: string
  city: string
  avg_sold: number
  fetched_at: string
}

// --- Parsers (exported for tests) ---

export function parseCurrentPrices(raw: AodpPriceRow[]): PriceObservationInsert[] {
  const rows: PriceObservationInsert[] = []
  for (const r of raw) {
    if (r.sell_price_min > 0) {
      rows.push({
        item_id: r.item_id,
        city: r.city,
        quality: r.quality,
        side: 'sell_order',
        price: r.sell_price_min,
        source: 'aodp',
        observed_at: r.sell_price_min_date,
      })
    }
    if (r.buy_price_max > 0) {
      rows.push({
        item_id: r.item_id,
        city: r.city,
        quality: r.quality,
        side: 'buy_order',
        price: r.buy_price_max,
        source: 'aodp',
        observed_at: r.buy_price_max_date,
      })
    }
  }
  return rows
}

export function parseHistory(raw: AodpHistoryRow[]): DailyVolumeInsert[] {
  const now = new Date().toISOString()
  return raw.map((r) => {
    const total = r.data.reduce((sum, d) => sum + d.item_count, 0)
    const avg = r.data.length > 0 ? Math.round(total / r.data.length) : 0
    return { item_id: r.item_id, city: r.location, avg_sold: avg, fetched_at: now }
  })
}

// --- HTTP fetchers ---

async function fetchGzip(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'Accept-Encoding': 'gzip' },
  })
  if (!res.ok) throw new Error(`AODP fetch failed: ${res.status} ${url}`)
  return res.json()
}

export async function getCurrentPrices(
  itemIds: string[],
  cities: string[],
  qualities: number[]
): Promise<PriceObservationInsert[]> {
  const chunks = chunkArray(itemIds, CHUNK_SIZE)
  const all: PriceObservationInsert[] = []
  for (const chunk of chunks) {
    const url = buildPriceUrl(chunk, cities, qualities)
    const data = (await fetchGzip(url)) as AodpPriceRow[]
    all.push(...parseCurrentPrices(data))
  }
  return all
}

export async function getHistory(
  itemIds: string[],
  city: string
): Promise<DailyVolumeInsert[]> {
  const chunks = chunkArray(itemIds, CHUNK_SIZE)
  const all: DailyVolumeInsert[] = []
  for (const chunk of chunks) {
    const url = buildHistoryUrl(chunk, city)
    const data = (await fetchGzip(url)) as AodpHistoryRow[]
    all.push(...parseHistory(data))
  }
  return all
}
