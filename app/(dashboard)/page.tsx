import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'

// Rendered on demand: this page reads from Supabase at request time, so it must
// not be statically prerendered at build (no DB creds available then).
export const dynamic = 'force-dynamic'

async function getLastFetchInfo(): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('price_observations')
      .select('observed_at')
      .eq('source', 'aodp')
      .order('observed_at', { ascending: false })
      .limit(1)
      .single()
    return data?.observed_at ?? null
  } catch {
    // Supabase not configured yet / unreachable — degrade gracefully.
    return null
  }
}

async function getWatchlistCount(): Promise<number> {
  try {
    const { count } = await supabase
      .from('items')
      .select('*', { count: 'exact', head: true })
      .eq('in_watchlist', true)
    return count ?? 0
  } catch {
    return 0
  }
}

export default async function HomePage() {
  const [lastFetch, watchlistCount] = await Promise.all([
    getLastFetchInfo(),
    getWatchlistCount(),
  ])

  const modules = [
    {
      href: '/prices',
      title: 'Price Checker',
      description: 'Search any item by name and inspect live prices across all cities.',
      status: 'active' as const,
    },
    {
      href: '/flip',
      title: 'Black Market Flipper',
      description: 'Find buy-low / sell-high arbitrage opportunities between royal cities and the Black Market.',
      status: 'active' as const,
    },
    {
      href: '/craft',
      title: 'Gear Crafting',
      description: 'Calculate crafting profit with resource returns.',
      status: 'soon' as const,
    },
    {
      href: '/consumables',
      title: 'Consumables',
      description: 'Food and potion crafting margins.',
      status: 'soon' as const,
    },
  ]

  return (
    <main className="container mx-auto p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-2">Albion Econ</h1>
      <p className="text-muted-foreground mb-8">Guild economy tools — Americas West</p>

      {/* Fetch status */}
      <div className="flex gap-4 mb-8 text-sm text-muted-foreground">
        <span>
          Watchlist: <strong className="text-foreground">{watchlistCount} items</strong>
        </span>
        <span>
          Last price fetch:{' '}
          <strong className="text-foreground">
            {lastFetch ? new Date(lastFetch).toLocaleString() : 'never'}
          </strong>
        </span>
      </div>

      {/* Module cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {modules.map((m) => (
          <Link key={m.href} href={m.href} className="block">
            <Card className="h-full hover:border-primary transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between mb-1">
                  <CardTitle className="text-lg">{m.title}</CardTitle>
                  {m.status === 'soon' && (
                    <Badge variant="secondary">Soon</Badge>
                  )}
                </div>
                <CardDescription>{m.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  )
}
