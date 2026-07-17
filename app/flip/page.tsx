import { getFlipSettings, getFlipMarkets, getRoutesForItem } from '@/lib/flip-data'
import { scanRoutes } from '@/lib/flip'
import { FiltersForm } from './_components/filters-form'
import { FlipControls } from './_components/flip-controls'
import { ManualEntryForm } from './_components/manual-entry-form'
import { Docket } from './_components/docket'
import { FlipperItemSearch } from './_components/flipper-item-search'
import { CITIES } from '@/lib/cities'
import { getClientId } from '@/lib/client-id'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function FlipPage(props: {
  searchParams: Promise<{ itemId?: string }>
}) {
  const searchParams = await props.searchParams
  const focusItemId = searchParams.itemId?.trim().toUpperCase()

  let settings
  let scan
  let loadError: string | null = null
  try {
    const clientId = await getClientId()
    settings = await getFlipSettings(clientId)
    if (focusItemId) {
      const itemRoutes = await getRoutesForItem(clientId, focusItemId)
      scan = {
        routes: itemRoutes,
        basketProfit: 0,
        basketCost: 0,
      }
    } else {
      const markets = await getFlipMarkets(settings.maxStalenessHr)
      scan = scanRoutes(markets, settings, new Date())
    }
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e)
  }

  if (loadError || !settings || !scan) {
    return (
      <main className="container mx-auto p-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">Black Market Flipper</h1>
        <p className="text-destructive text-sm">
          Could not load flip data: {loadError ?? 'unknown error'}. Confirm Supabase env vars,
          that migration 002 is applied, and that the watchlist is built.
        </p>
      </main>
    )
  }

  const routes = scan.routes

  return (
    <main className="container mx-auto p-6 max-w-7xl space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap border-b pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href="/" className="text-sm font-semibold text-muted-foreground hover:text-foreground">
              ← Dashboard
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight mt-1">Black Market Flipper</h1>
          <p className="text-muted-foreground text-sm max-w-2xl leading-relaxed">
            Black Market flipping requires no gear mastery or crafting level. It allows any player to grow their silver capital for free by exploiting price discrepancies across royal markets.
          </p>
          {!focusItemId && (
            <p className="text-xs text-muted-foreground mt-2">
              Showing <span className="tabular-nums font-semibold text-foreground">{scan.routes.length}</span> routes · basket profit{' '}
              <span className="tabular-nums font-semibold text-profit">{scan.basketProfit.toLocaleString()}</span>
              <span className="text-muted-foreground"> for </span>
              <span className="tabular-nums font-semibold text-foreground">{scan.basketCost.toLocaleString()}</span> silver
            </p>
          )}
        </div>
        <FlipControls premium={settings.premium} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-6">
          <FlipperItemSearch initialItemId={focusItemId} />
          <FiltersForm settings={settings} />
          <ManualEntryForm cities={[...CITIES]} />
        </aside>
        <div className="space-y-4 min-w-0">
          {focusItemId && (
            <div className="flex items-center justify-between gap-4 bg-primary/5 border border-primary/25 rounded-lg px-4 py-3 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-semibold text-foreground">Focused on item:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs border font-mono">{focusItemId}</code>
                {routes.length > 0 && (
                  <span className="text-muted-foreground font-medium">
                    ({routes[0].displayName || routes[0].baseName})
                  </span>
                )}
              </span>
              <Link href="/flip" className="text-xs text-primary hover:underline font-bold">
                Clear filter
              </Link>
            </div>
          )}
          <Docket routes={routes} />
        </div>
      </div>
    </main>
  )
}

