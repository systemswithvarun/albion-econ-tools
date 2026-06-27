/**
 * One-time backfill of items.display_name from ao-bin-dumps formatted/items.json.
 * Enchant variants (UniqueName "BASE@N") map to item_id "BASE_N". Items with no
 * EN-US name fall back to their item_id.
 *
 * DRY RUN: if SEED_DRY_RUN=1 or Supabase env vars are missing, prints sample
 * lookups + counts and exits 0 without writing.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { type FormattedItem, buildNameMap } from './name-map'

dotenv.config({ path: '.env.local' })

const SRC_URL = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json'
const DATA_PATH = path.resolve(process.cwd(), 'data', 'formatted-items.json')

async function ensureFile(): Promise<void> {
  if (fs.existsSync(DATA_PATH)) return
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true })
  console.log(`Downloading ${SRC_URL} ...`)
  const res = await fetch(SRC_URL)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  fs.writeFileSync(DATA_PATH, await res.text(), 'utf-8')
}

async function main() {
  await ensureFile()
  const raw: FormattedItem[] = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'))
  const nameMap = buildNameMap(raw)
  console.log(`Parsed ${raw.length} formatted items; ${nameMap.size} with EN-US names.`)

  for (const id of ['T4_BAG', 'T5_2H_CLAYMORE', 'T4_2H_CLAYMORE_3', 'T4_BAG_INSIGHT']) {
    console.log(`  ${id} -> ${nameMap.get(id) ?? '(fallback to item_id)'}`)
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (process.env.SEED_DRY_RUN === '1' || !url || !key) {
    console.log(process.env.SEED_DRY_RUN === '1' ? 'SEED_DRY_RUN=1 — no DB writes.' : 'SUPABASE creds missing — dry run only.')
    process.exit(0)
  }

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // Phase A: set real names, grouped by name (one UPDATE per name, chunked ids).
  const byName = new Map<string, string[]>()
  for (const [itemId, name] of nameMap) {
    const arr = byName.get(name) ?? []
    arr.push(itemId)
    byName.set(name, arr)
  }
  const ID_CHUNK = 300
  let assigned = 0
  let groups = 0
  for (const [name, ids] of byName) {
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK)
      const { error } = await supabase.from('items').update({ display_name: name }).in('item_id', chunk)
      if (error) throw error
      assigned += chunk.length
    }
    groups++
    if (groups % 500 === 0) console.log(`  ...${groups} name groups, ${assigned} id-assignments`)
  }
  console.log(`Phase A done: ${groups} name groups, ${assigned} id-assignments.`)

  // Phase B: any row still null (no formatted name) -> fallback to its own item_id.
  // Page through nulls 1000 at a time (PostgREST read cap), patch each.
  let patched = 0
  for (;;) {
    const { data, error } = await supabase
      .from('items')
      .select('item_id')
      .is('display_name', null)
      .limit(1000)
    if (error) throw error
    const rows = data ?? []
    if (rows.length === 0) break
    for (const r of rows) {
      const { error: uErr } = await supabase
        .from('items')
        .update({ display_name: r.item_id })
        .eq('item_id', r.item_id)
      if (uErr) throw uErr
    }
    patched += rows.length
    console.log(`  ...fallback patched ${patched}`)
    if (rows.length < 1000) break
  }
  console.log(`Phase B done: ${patched} rows fell back to item_id.`)

  for (const id of ['T4_BAG', 'T5_2H_CLAYMORE']) {
    const { data } = await supabase.from('items').select('display_name').eq('item_id', id).single()
    console.log(`  verify ${id} -> ${data?.display_name}`)
  }
  console.log('Backfill complete.')
}

main().catch((e) => { console.error(e); process.exit(1) })
