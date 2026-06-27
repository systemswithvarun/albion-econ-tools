import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/cron/')) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET}`
    if (auth !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/cron/:path*'],
}
