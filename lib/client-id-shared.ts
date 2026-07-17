/**
 * Edge-safe constant shared by the middleware (Edge runtime) and the server-only
 * client-id helpers. Kept in its own module with NO imports so the middleware bundle
 * never pulls in `next/headers` — doing so crashes the Edge runtime
 * (MIDDLEWARE_INVOCATION_FAILED).
 */
export const CLIENT_ID_COOKIE = 'aep_client_id'
