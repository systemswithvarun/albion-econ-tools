'use client'

import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import type { FlipRoute } from '@/lib/flip'
import { formatItemName } from '@/lib/display'

type SortKey = 'default' | 'item' | 'netPerUnit' | 'marginPct' | 'dailyVolume' | 'routeDailyProfit' | 'unitsAffordable'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'item', label: 'Item' },
  { key: 'netPerUnit', label: 'Net/unit' },
  { key: 'marginPct', label: 'Margin %' },
  { key: 'dailyVolume', label: 'Daily vol' },
  { key: 'unitsAffordable', label: 'Units' },
  { key: 'routeDailyProfit', label: 'Route profit' },
]

function fmt(n: number) {
  return Math.round(n).toLocaleString()
}

/** Single rendering path for item identity: display_name (or id fallback) + enchant + quality.
 *  Never surface item_id/base_name raw — display_name lives only in items, joined into the route. */
function routeName(r: FlipRoute): string {
  return formatItemName({ display_name: r.displayName, item_id: r.itemId, enchant: r.enchant }, r.quality)
}

export function ResultsTable({ routes }: { routes: FlipRoute[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('default')
  const [asc, setAsc] = useState(false)

  const sorted = useMemo(() => {
    if (sortKey === 'default') {
      return asc ? [...routes].reverse() : routes
    }
    const copy = [...routes]
    copy.sort((a, b) => {
      const cmp = sortKey === 'item'
        ? routeName(a).localeCompare(routeName(b))
        : (a[sortKey] as number) - (b[sortKey] as number)
      return asc ? cmp : -cmp
    })
    return copy
  }, [routes, sortKey, asc])

  function toggle(k: SortKey) {
    if (k === sortKey) setAsc((v) => !v)
    else { setSortKey(k); setAsc(false) }
  }

  if (routes.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No routes match the current filters</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Build the watchlist, wait for the next price fetch, or loosen the filters.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Sort options row */}
      <div className="flex flex-wrap items-center gap-2 text-xs py-1">
        <span className="font-semibold text-muted-foreground mr-1">Sort by:</span>
        {SORT_OPTIONS.map((opt) => {
          const active = sortKey === opt.key
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => toggle(opt.key)}
              aria-pressed={active}
              className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              {opt.label}
              {active && (
                <span className="ml-1 font-mono inline-block" aria-hidden="true">
                  {asc ? '↑' : '↓'}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* List wrapper with vertical max height and scroll fallback */}
      <div className="rounded-md border bg-card max-h-[calc(100vh-280px)] overflow-auto custom-scrollbar divide-y divide-border">
        {sorted.map((r, i) => (
          <div
            key={`${r.itemId}-${r.quality}-${r.buyCity}-${r.sellCity}-${i}`}
            className={`p-4 flex flex-col gap-1.5 transition-colors ${
              r.inBasket
                ? 'bg-primary/5 hover:bg-primary/10'
                : 'hover:bg-muted/40'
            }`}
          >
            {/* Line 1: Item Name, badges, and headline number */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="font-semibold text-foreground text-sm sm:text-base leading-snug mr-1">
                  {routeName(r)}
                </span>
                {r.inBasket && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium">
                    basket
                  </Badge>
                )}
                {r.bmFlagged && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold border-none text-[10px] px-2 py-0.5 rounded-full animate-pulse whitespace-nowrap">
                    🔥 BM Flagged
                  </Badge>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm sm:text-base font-bold text-profit tabular-nums">
                  +{fmt(r.routeDailyProfit)}/day
                </div>
              </div>
            </div>

            {/* Line 2: Buy → Sell info */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-foreground">{r.buyCity}</span>
                <span>@</span>
                <span className="tabular-nums font-semibold text-foreground">{fmt(r.buyPrice)}</span>
                <span className="text-muted-foreground mx-1">→</span>
                <span className="font-medium text-foreground">{r.sellCity}</span>
                <span>@</span>
                <span className="tabular-nums font-semibold text-foreground">{fmt(r.sellPrice)}</span>
              </div>
              <div className="tabular-nums text-[10px] text-muted-foreground whitespace-nowrap">
                Age: {r.buyAgeHr.toFixed(1)}h / {r.sellAgeHr.toFixed(1)}h
              </div>
            </div>

            {/* Line 3: Gap line */}
            {r.bmGap && (
              <div className="text-[10px] text-muted-foreground font-mono leading-relaxed bg-muted/30 px-2 py-0.5 rounded border border-border/40 w-fit">
                Gap: {r.bmGap.lowestAcquisition.toLocaleString()} → {r.bmGap.bmBuyOrder.toLocaleString()} (Floor: {Math.round(r.bmGap.floor).toLocaleString()})
              </div>
            )}

            {/* Line 4: Compact metadata */}
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-muted-foreground font-medium pt-1.5 border-t border-border/30">
              <div className="flex items-center gap-1">
                <span>Net/unit:</span>
                <span className="text-profit font-bold tabular-nums">{fmt(r.netPerUnit)}</span>
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-border" aria-hidden="true" />
              <div className="flex items-center gap-1">
                <span>Margin:</span>
                <span className="text-foreground font-semibold tabular-nums">{r.marginPct.toFixed(1)}%</span>
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-border" aria-hidden="true" />
              <div className="flex items-center gap-1">
                <span>Daily Vol:</span>
                <span className="text-foreground font-semibold tabular-nums">{fmt(r.dailyVolume)}</span>
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-border" aria-hidden="true" />
              <div className="flex items-center gap-1">
                <span>Units:</span>
                <span className="text-foreground font-semibold tabular-nums">{fmt(r.unitsAffordable)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

