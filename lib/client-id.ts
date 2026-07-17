import { cookies } from 'next/headers'

// Re-exported from the Edge-safe module so server callers can keep importing it from here,
// while the middleware imports it from '@/lib/client-id-shared' (never pulling next/headers
// into the Edge bundle).
export { CLIENT_ID_COOKIE } from './client-id-shared'
import { CLIENT_ID_COOKIE } from './client-id-shared'

/**
 * Read the anonymous client id from the request cookie (server components + server
 * actions only). Returns null on the very first paint before the middleware's Set-Cookie
 * has round-tripped — callers must treat null as "unknown browser": show defaults/empty,
 * write nothing. The next request carries the cookie and reads real per-client rows.
 */
export async function getClientId(): Promise<string | null> {
  const store = await cookies()
  return store.get(CLIENT_ID_COOKIE)?.value ?? null
}
