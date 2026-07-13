import { NextRequest, NextResponse } from 'next/server'
import { CLIENT_ID_COOKIE } from '@/lib/client-id'

export function middleware(req: NextRequest) {
  // Secret-gate the cron endpoints.
  if (req.nextUrl.pathname.startsWith('/api/cron/')) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET}`
    if (auth !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Assign an anonymous per-browser client id if the browser has none yet.
  const res = NextResponse.next()
  if (!req.cookies.get(CLIENT_ID_COOKIE)?.value) {
    res.cookies.set(CLIENT_ID_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 400, // ~13 months
    })
  }
  return res
}

export const config = {
  // Run on everything except Next internals + static assets, so the cookie is set on
  // any first entry point (and the cron gate still covers /api/cron/*).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
