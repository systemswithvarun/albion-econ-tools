import { cookies } from 'next/headers'

/** Cookie name the middleware sets for anonymous per-browser identity. */
export const CLIENT_ID_COOKIE = 'aep_client_id'

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
