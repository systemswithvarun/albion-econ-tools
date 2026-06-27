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
      <div className="rounded-md border p-8 text-center text-muted-foreground text-sm">
        No routes match the current filters. Build the watchlist, wait for a price fetch, or loosen filters.
      </div>
    )
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((c) => (
              <TableHead
                key={c.key}
                onClick={() => toggle(c.key)}
                className={`cursor-pointer select-none ${c.numeric ? 'text-right' : ''}`}
              >
                {c.label}{sortKey === c.key ? (asc ? ' ↑' : ' ↓') : ''}
              </TableHead>
            ))}
            <TableHead>Buy</TableHead>
            <TableHead>Sell</TableHead>
            <TableHead className="text-right">Age (b/s)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r, i) => (
            <TableRow key={`${r.itemId}-${r.quality}-${r.buyCity}-${r.sellCity}-${i}`} className={r.inBasket ? 'bg-primary/5' : ''}>
              <TableCell className="font-medium">
                {r.baseName}{r.quality > 1 ? ` Q${r.quality}` : ''}
                {r.inBasket && <Badge variant="secondary" className="ml-2">basket</Badge>}
              </TableCell>
              <TableCell className="text-right">{fmt(r.netPerUnit)}</TableCell>
              <TableCell className="text-right">{r.marginPct.toFixed(1)}%</TableCell>
              <TableCell className="text-right">{fmt(r.dailyVolume)}</TableCell>
              <TableCell className="text-right">{fmt(r.unitsAffordable)}</TableCell>
              <TableCell className="text-right font-semibold">{fmt(r.routeDailyProfit)}</TableCell>
              <TableCell>{r.buyCity} @ {fmt(r.buyPrice)}</TableCell>
              <TableCell>{r.sellCity} @ {fmt(r.sellPrice)}</TableCell>
              <TableCell className="text-right text-muted-foreground text-xs">
                {r.buyAgeHr.toFixed(1)}/{r.sellAgeHr.toFixed(1)}h
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
