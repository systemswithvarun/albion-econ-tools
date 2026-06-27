'use client'

import { useState, useMemo } from 'react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { FlipRoute } from '@/lib/flip'

type SortKey = keyof Pick<
  FlipRoute,
  'baseName' | 'netPerUnit' | 'marginPct' | 'dailyVolume' | 'routeDailyProfit' | 'unitsAffordable'
>

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'baseName', label: 'Item', numeric: false },
  { key: 'netPerUnit', label: 'Net/unit', numeric: true },
  { key: 'marginPct', label: 'Margin %', numeric: true },
  { key: 'dailyVolume', label: 'Daily vol', numeric: true },
  { key: 'unitsAffordable', label: 'Units', numeric: true },
  { key: 'routeDailyProfit', label: 'Route daily profit', numeric: true },
]

function fmt(n: number) {
  return Math.round(n).toLocaleString()
}

export function ResultsTable({ routes }: { routes: FlipRoute[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('routeDailyProfit')
  const [asc, setAsc] = useState(false)

  const sorted = useMemo(() => {
    const copy = [...routes]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
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
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            {COLUMNS.map((c) => {
              const active = sortKey === c.key
              return (
                <TableHead
                  key={c.key}
                  aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
                  className={c.numeric ? 'text-right' : ''}
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className={`inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm ${
                      active ? 'text-primary' : 'text-muted-foreground'
                    } ${c.numeric ? 'flex-row-reverse' : ''}`}
                  >
                    {c.label}
                    <span aria-hidden className="w-2 text-center">{active ? (asc ? '↑' : '↓') : ''}</span>
                  </button>
                </TableHead>
              )
            })}
            <TableHead>Buy</TableHead>
            <TableHead>Sell</TableHead>
            <TableHead className="text-right">Buy/sell age</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r, i) => (
            <TableRow
              key={`${r.itemId}-${r.quality}-${r.buyCity}-${r.sellCity}-${i}`}
              className={r.inBasket ? 'bg-primary/5 hover:bg-primary/10' : undefined}
            >
              <TableCell className="font-medium">
                {r.baseName}{r.quality > 1 ? ` Q${r.quality}` : ''}
                {r.inBasket && <Badge variant="secondary" className="ml-2 align-middle">basket</Badge>}
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium text-profit">{fmt(r.netPerUnit)}</TableCell>
              <TableCell className="text-right tabular-nums">{r.marginPct.toFixed(1)}%</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.dailyVolume)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.unitsAffordable)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums text-profit">{fmt(r.routeDailyProfit)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{r.buyCity} @ <span className="tabular-nums">{fmt(r.buyPrice)}</span></TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{r.sellCity} @ <span className="tabular-nums">{fmt(r.sellPrice)}</span></TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground text-xs">
                {r.buyAgeHr.toFixed(1)}/{r.sellAgeHr.toFixed(1)}h
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
