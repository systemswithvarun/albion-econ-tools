import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set')
  }
  // Service-role client — server-side only, never exposed to browser
  _client = createClient(url, key, { auth: { persistSession: false } })
  return _client
}

// Lazy proxy: defers client creation (and the env-var check) until the first
// actual call. Importing this module is therefore side-effect-free, so it does
// not throw during `next build` page-data collection when env vars are absent.
// Callers keep using `supabase.from(...)` unchanged.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getClient()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
