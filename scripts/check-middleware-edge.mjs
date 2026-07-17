#!/usr/bin/env node
/**
 * Guards the Edge middleware against server-only imports — at the SOURCE level.
 *
 * middleware.ts runs on Vercel's Edge runtime. If anything in its import graph pulls in a
 * server-only module (most importantly `next/headers`, also the `server-only` marker or
 * `node:fs`), the Edge runtime can throw MIDDLEWARE_INVOCATION_FAILED — a 500 on every
 * route. `next build` does not catch this (it tree-shakes locally and only fails at Edge
 * runtime), and grepping the BUILT bundle is useless: webpack rewrites import specifiers
 * to numeric ids, so the string `next/headers` never appears.
 *
 * So we walk the actual source import graph from middleware.ts and fail if it can reach a
 * forbidden module. Deterministic, independent of bundling.
 *
 *   node scripts/check-middleware-edge.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'

const ROOT = process.cwd()
const ENTRIES = ['middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js']

// Bare specifiers that must never be reachable from the Edge middleware.
const FORBIDDEN = ['next/headers', 'server-only', 'node:fs', 'node:fs/promises']

const entry = ENTRIES.find((e) => existsSync(join(ROOT, e)))
if (!entry) {
  console.log('[edge-check] no middleware file found — nothing to check.')
  process.exit(0)
}

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

/** Resolve an import specifier to a source file path, or null if external/unresolvable. */
function resolveSpec(spec, fromFile) {
  let base
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null // bare external specifier — handled by the FORBIDDEN check, not walked
  if (existsSync(base) && !existsSync(base + '/')) return base
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext
  for (const ext of EXTS) if (existsSync(join(base, 'index' + ext))) return join(base, 'index' + ext)
  return null
}

const IMPORT_RE = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

const visited = new Set()

/** DFS the import graph; return the path chain to a forbidden module, or null. */
function walk(file, chain) {
  if (visited.has(file)) return null
  visited.add(file)
  const src = readFileSync(file, 'utf8')
  const specs = []
  for (const m of src.matchAll(IMPORT_RE)) specs.push(m[1] || m[2] || m[3])
  for (const spec of specs) {
    if (FORBIDDEN.includes(spec)) return [...chain, `${rel(file)} → ${spec}`]
    const next = resolveSpec(spec, file)
    if (next) {
      const found = walk(next, [...chain, rel(file)])
      if (found) return found
    }
  }
  return null
}

const rel = (p) => p.replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/')

const chain = walk(join(ROOT, entry), [])
if (chain) {
  console.error('[edge-check] FAIL — the Edge middleware can reach a server-only module:')
  console.error('  ' + chain.join('\n    → '))
  console.error(
    '\nMove the shared value into a pure, import-free module (see lib/client-id-shared.ts)\n' +
      'and import that from the middleware. Left as-is this risks a 500 on every route\n' +
      '(MIDDLEWARE_INVOCATION_FAILED) on the Edge runtime.',
  )
  process.exit(1)
}

console.log(`[edge-check] OK — ${entry} import graph is Edge-safe (no server-only modules).`)
