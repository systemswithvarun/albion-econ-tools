import { getFlipSettings, getFlipMarkets } from '@/lib/flip-data'
import { scanRoutes } from '@/lib/flip'
import { FiltersForm } from './_components/filters-form'
import { FlipControls } from './_components/flip-controls'
import { ManualEntryForm } from './_components/manual-entry-form'
import { ResultsTable } from './_components/results-table'

export const dynamic = 'force-dynamic'

const CITIES = ['Thetford', 'FortSterling', 'Lymhurst', 'Bridgewatch', 'Martlock', 'Caerleon', 'BlackMarket']

export default async function FlipPage() {
  let settings
  let scan
  let loadError: string | null = null
  try {
    settings = await getFlipSettings()
    const markets = await getFlipMarkets(settings.maxStalenessHr)
    scan = scanRoutes(markets, settings, new Date())
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e)
  }

  if (loadError || !settings || !scan) {
    return (
      <main className="container mx-auto p-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">Flip Screener</h1>
        <p className="text-destructive text-sm">
          Could not load flip data: {loadError ?? 'unknown error'}. Confirm Supabase env vars,
          that migration 002 is applied, and that the watchlist is built.
        </p>
      </main>
    )
  }

  return (
    <main className="container mx-auto p-6 max-w-7xl space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap border-b pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Flip Screener</h1>
          <p className="text-muted-foreground text-sm mt-1">
            <span className="tabular-nums text-foreground font-medium">{scan.routes.length}</span> routes · basket profit{' '}
            <span className="tabular-nums font-semibold text-profit">{scan.basketProfit.toLocaleString()}</span>
            <span className="text-muted-foreground"> for </span>
            <span className="tabular-nums text-foreground font-medium">{scan.basketCost.toLocaleString()}</span> silver
          </p>
        </div>
        <FlipControls premium={settings.premium} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-6">
          <FiltersForm settings={settings} />
          <ManualEntryForm cities={CITIES} />
        </aside>
        <ResultsTable routes={scan.routes} />
      </div>
    </main>
  )
}
