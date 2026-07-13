/**
 * Task 8 — Seed the `items` table from the Albion `ao-bin-dumps` items.json.
 *
 * Source file: data/items.json (downloaded from
 *   https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.json)
 *
 * NOTE on the real data shape (verified against the live file, not assumed):
 *   The file is an XML-to-JSON conversion. Top level is { "?xml": {...}, "items": {...} }.
 *   `items` holds metadata keys ("@xmlns...", "shopcategories") plus one key per item
 *   category, each an ARRAY (or, for a couple categories, a single object) of definitions:
 *     weapon, equipmentitem, simpleitem, consumableitem, mount, furnitureitem,
 *     farmableitem, journalitem, hideoutitem, ... etc.
 *   Each definition uses leading-`@` field names: @uniquename, @tier, @shopcategory,
 *   @shopsubcategory1, etc. Enchanted variants are NOT separate top-level items; they
 *   live nested under  enchantments.enchantment[] , each with @enchantmentlevel (1-4)
 *   and its own craftingrequirements. There is no embedded localized name — only
 *   @namelocatag (a localization tag), so base_name falls back to the uniquename.
 *
 * The `items` table stores one row PER enchant level, so we expand each base item into
 * its base (enchant 0) row plus one row per nested enchantment level.
 *
 * Columns (db/schema.sql): item_id (PK), base_name, tier, enchant, category,
 *   is_artifact, has_quality, in_watchlist (always false here — watchlist is curated later).
 *
 * DRY-RUN MODE (deliberate addition, not in the original plan):
 *   We have no Supabase credentials in this environment, so to validate the PARSING we
 *   support a dry run. If SEED_DRY_RUN === '1' OR the Supabase env vars are missing, the
 *   script parses the file, prints summary stats + sample rows, and exits 0 WITHOUT ever
 *   constructing the Supabase client or inserting. The Supabase upsert path is otherwise
 *   unchanged (batches of 500, onConflict: 'item_id').
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { toBaseKey } from './name-map'

dotenv.config({ path: '.env.local' })

// ---------------------------------------------------------------------------
// Types describing the (loosely-typed) ao-bin-dumps JSON shape we care about.
// ---------------------------------------------------------------------------
interface CraftResource {
  '@uniquename'?: string
  '@count'?: string
  [k: string]: unknown
}
interface CraftingRequirement {
  craftresource?: CraftResource | CraftResource[]
  [k: string]: unknown
}
interface Enchantment {
  '@enchantmentlevel'?: string
  craftingrequirements?: CraftingRequirement | CraftingRequirement[]
  [k: string]: unknown
}
interface RawItem {
  '@uniquename'?: string
  '@tier'?: string
  '@shopcategory'?: string
  '@namelocatag'?: string
  craftingrequirements?: CraftingRequirement | CraftingRequirement[]
  enchantments?: { enchantment?: Enchantment | Enchantment[] }
  [k: string]: unknown
}

interface ItemRow {
  item_id: string
  base_name: string
  base_key: string
  tier: number
  enchant: number
  category: string
  is_artifact: boolean
  has_quality: boolean
  in_watchlist: boolean
}

// Categories whose items never carry a quality level (resources, consumables,
// farmables, journals, mounts, furniture, tokens, etc.). Anything not in this set
// (weapons, armors, head, shoes, bags, capes, offhands, artefacts, ...) has quality.
const NO_QUALITY_CATEGORIES = new Set([
  'resources',
  'consumables',
  'farming',
  'gathering',
  'crafting',
  'other',
  'mounts',
  'furniture',
  'vanity',
  'unknown',
])

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

/** Collect every craftresource uniquename for a given crafting-requirements blob. */
function craftResourceNames(cr: CraftingRequirement | CraftingRequirement[] | undefined): string[] {
  const names: string[] = []
  for (const req of asArray(cr)) {
    for (const res of asArray(req.craftresource)) {
      if (res['@uniquename']) names.push(res['@uniquename'])
    }
  }
  return names
}

/** Tier: prefer the explicit @tier field; fall back to leading T<n>_ in the name. */
function parseTier(item: RawItem): number {
  const t = item['@tier']
  if (t != null && t !== '') {
    const n = parseInt(t, 10)
    if (Number.isFinite(n)) return n
  }
  const m = /^T(\d+)_/.exec(item['@uniquename'] ?? '')
  return m ? parseInt(m[1], 10) : 0
}

/** Lowercased @shopcategory, or 'unknown'. */
function parseCategory(item: RawItem): string {
  const c = item['@shopcategory']
  return c && c.trim() ? c.toLowerCase() : 'unknown'
}

function hasQuality(category: string): boolean {
  return !NO_QUALITY_CATEGORIES.has(category)
}

/** DB-safe item_id from a uniquename + enchant level. Plan convention: replace '@' with '_'. */
function makeItemId(uniquename: string, enchant: number): string {
  const withEnch = enchant > 0 ? `${uniquename}@${enchant}` : uniquename
  return withEnch.replace(/@/g, '_')
}

// ---------------------------------------------------------------------------
// Parsing: flatten every category into ItemRows, expanding enchant variants.
// ---------------------------------------------------------------------------
function parseItems(json: any): ItemRow[] {
  const itemsObj = json?.items ?? json
  if (!itemsObj || typeof itemsObj !== 'object') {
    throw new Error('Unexpected items.json shape: no top-level `items` object found.')
  }

  const rows: ItemRow[] = []
  const seen = new Set<string>()

  for (const key of Object.keys(itemsObj)) {
    // Skip XML metadata / non-item-collection keys.
    if (key.startsWith('@') || key === 'shopcategories') continue

    const collection = asArray<RawItem>(itemsObj[key] as RawItem | RawItem[])
    for (const item of collection) {
      const uniquename = item['@uniquename']
      if (!uniquename) continue // not a real item definition

      const tier = parseTier(item)
      const category = parseCategory(item)
      const quality = hasQuality(category)
      // base_name: no localized EN name exists in this dump, so fall back to uniquename.
      const baseName = uniquename

      // Artifact check at base level: any craft resource referencing an ARTEFACT.
      const baseArtifact = craftResourceNames(item.craftingrequirements).some((n) =>
        n.includes('ARTEFACT')
      )

      // --- enchant 0 (base) row ---
      const baseId = makeItemId(uniquename, 0)
      pushRow(rows, seen, {
        item_id: baseId,
        base_name: baseName,
        base_key: toBaseKey(baseId, 0),
        tier,
        enchant: 0,
        category,
        is_artifact: baseArtifact,
        has_quality: quality,
        in_watchlist: false,
      })

      // --- nested enchant variants ---
      for (const ench of asArray(item.enchantments?.enchantment)) {
        const lvl = parseInt(ench['@enchantmentlevel'] ?? '', 10)
        if (!Number.isFinite(lvl) || lvl <= 0) continue
        // Each enchant level may reference an artifact resource of its own.
        const enchArtifact =
          baseArtifact ||
          craftResourceNames(ench.craftingrequirements).some((n) => n.includes('ARTEFACT'))

        const enchId = makeItemId(uniquename, lvl)
        pushRow(rows, seen, {
          item_id: enchId,
          base_name: baseName,
          base_key: toBaseKey(enchId, lvl),
          tier,
          enchant: lvl,
          category,
          is_artifact: enchArtifact,
          has_quality: quality,
          in_watchlist: false,
        })
      }
    }
  }

  return rows
}

function pushRow(rows: ItemRow[], seen: Set<string>, row: ItemRow): void {
  if (seen.has(row.item_id)) return // de-dupe on PK
  seen.add(row.item_id)
  rows.push(row)
}

// ---------------------------------------------------------------------------
// Dry-run summary
// ---------------------------------------------------------------------------
function printDryRunSummary(rows: ItemRow[]): void {
  const artifacts = rows.filter((r) => r.is_artifact).length
  const noQuality = rows.filter((r) => !r.has_quality).length
  const enchanted = rows.filter((r) => r.enchant > 0).length
  const categories = new Set(rows.map((r) => r.category))

  console.log('--- DRY RUN (no DB writes) ---')
  console.log(`Total rows:                 ${rows.length}`)
  console.log(`  with is_artifact=true:    ${artifacts}`)
  console.log(`  with has_quality=false:   ${noQuality}`)
  console.log(`  enchanted (enchant > 0):  ${enchanted}`)
  console.log(`  distinct categories:      ${[...categories].sort().join(', ')}`)
  console.log('')
  console.log('Sample rows:')
  const samples = [
    rows.find((r) => r.enchant === 0 && r.category === 'weapons'),
    rows.find((r) => r.enchant === 3 && r.category === 'weapons'),
    rows.find((r) => r.is_artifact),
    rows.find((r) => !r.has_quality),
    rows.find((r) => r.category === 'armors' && r.enchant === 0),
  ].filter(Boolean) as ItemRow[]
  for (const s of samples) console.log('  ' + JSON.stringify(s))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function seed(): Promise<void> {
  const dataPath = path.resolve(process.cwd(), 'data', 'items.json')
  if (!fs.existsSync(dataPath)) {
    console.error(`items.json not found at ${dataPath}. Download it first (see file header).`)
    process.exit(1)
  }

  console.log(`Reading ${dataPath} ...`)
  const json = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))

  // PARSE FIRST — independent of any DB access, so the dry run can validate it.
  const rows = parseItems(json)
  console.log(`Parsed ${rows.length} item rows.`)

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  const dryRun = process.env.SEED_DRY_RUN === '1' || !url || !key

  if (dryRun) {
    if (process.env.SEED_DRY_RUN === '1') {
      console.log('SEED_DRY_RUN=1 set — skipping DB upsert.')
    } else {
      console.log('SUPABASE_URL / SUPABASE_SERVICE_KEY not set — running parse-only dry run.')
    }
    printDryRunSummary(rows)
    process.exit(0)
  }

  // --- Real upsert path (requires creds; never reached in dry run) ---
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url!, key!, { auth: { persistSession: false } })

  const BATCH = 500
  let ok = 0
  const failures: { at: number; message: string; sampleIds: string[] }[] = []

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await supabase.from('items').upsert(batch, { onConflict: 'item_id' })
    if (error) {
      // Do NOT abort the whole seed on one bad batch — record it and keep going,
      // so a single failing chunk can't leave the table mostly empty.
      failures.push({ at: i, message: error.message, sampleIds: batch.slice(0, 3).map((r) => r.item_id) })
      console.error(`Batch @${i} FAILED: ${error.message} (e.g. ${batch.slice(0, 3).map((r) => r.item_id).join(', ')})`)
    } else {
      ok += batch.length
    }
    console.log(`Progress ${Math.min(i + BATCH, rows.length)} / ${rows.length} (ok=${ok}, failed batches=${failures.length})`)
  }

  // Verify what actually landed.
  const { count, error: countErr } = await supabase
    .from('items')
    .select('*', { count: 'exact', head: true })

  console.log('')
  console.log('--- SEED SUMMARY ---')
  console.log(`Rows attempted:        ${rows.length}`)
  console.log(`Rows in failed batches:${rows.length - ok}`)
  console.log(`Failed batches:        ${failures.length}`)
  console.log(`Row count in table:    ${countErr ? `(count failed: ${countErr.message})` : count}`)
  if (failures.length > 0) {
    console.log('First failure detail:', JSON.stringify(failures[0], null, 2))
    process.exit(1)
  }
  console.log('Done.')
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
