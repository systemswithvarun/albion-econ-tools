'use client'

import { useMemo, useState, useTransition } from 'react'
import { Star, Check } from 'lucide-react'
import type { FlipRoute } from '@/lib/flip'
import { formatItemName } from '@/lib/display'
import { classifyAge, freshnessColor, formatAge, type Freshness } from '@/lib/freshness'
import { computeVerdict, verdictStyle, type Verdict } from '@/lib/verdict'
import { tierColor, tierBg, tierBadge, tierFromId, qualityColor, qualityLabel } from '@/lib/item-colors'
import { SHOW_MARK_TAKEN } from '@/lib/flags'
import { addFavoriteAction } from '@/app/prices/actions'

type Lens = 'verdict' | 'quadrant'

// A route enriched with the derived fields the docket renders off.
interface Row {
  route: FlipRoute
  key: string
  name: string
  ageHr: number
  fresh: Freshness
  verdict: Verdict
}

interface CityGroup {
  city: string
  rows: Row[]
}

const fmt = (n: number) => Math.round(n).toLocaleString()
const fmtSigned = (n: number) => (n >= 0 ? '+' : '') + fmt(n)

/** "FortSterling" -> "Fort Sterling"; "BlackMarket" -> "Black Market". */
function prettyCity(c: string): string {
  return c.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function routeName(r: FlipRoute): string {
  return formatItemName({ display_name: r.displayName, item_id: r.itemId, enchant: r.enchant }, r.quality)
}

export function Docket({ routes }: { routes: FlipRoute[] }) {
  const [lens, setLens] = useState<Lens>('verdict')
  const [verdictFilter, setVerdictFilter] = useState<Verdict | null>(null)
  const [showStale, setShowStale] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // Enrich every route once. netPerUnit is the decision number (cash-independent), so it
  // anchors both the row profit and the verdict — the screener stays meaningful at 0 cash.
  const allRows = useMemo<Row[]>(
    () =>
      routes.map((route, i) => {
        const ageHr = Math.max(route.buyAgeHr, route.sellAgeHr)
        return {
          route,
          key: `${route.itemId}-${route.quality}-${route.buyCity}-${route.sellCity}-${i}`,
          name: routeName(route),
          ageHr,
          fresh: classifyAge(ageHr),
          verdict: computeVerdict(route.netPerUnit, route.marginPct),
        }
      }),
    [routes],
  )

  const staleCount = useMemo(() => allRows.filter((r) => r.fresh === 'stale').length, [allRows])

  // §② Bins: stale (>3h) is collapsed by default so you can't accidentally scan it.
  // §③ Quadrant lens can further filter to one verdict.
  const visibleRows = useMemo(() => {
    let rows = showStale ? allRows : allRows.filter((r) => r.fresh !== 'stale')
    if (verdictFilter) rows = rows.filter((r) => r.verdict === verdictFilter)
    return rows
  }, [allRows, showStale, verdictFilter])

  // §①+1b: group the scan list by SOURCE CITY, cities ordered by route count — the city
  // to ride to first is the top block. Rows within a city sorted by net per unit.
  const groups = useMemo<CityGroup[]>(() => {
    const byCity = new Map<string, Row[]>()
    for (const r of visibleRows) {
      const arr = byCity.get(r.route.buyCity) ?? []
      arr.push(r)
      byCity.set(r.route.buyCity, arr)
    }
    const out: CityGroup[] = [...byCity.entries()].map(([city, rows]) => ({
      city,
      rows: rows.sort((a, b) => b.route.netPerUnit - a.route.netPerUnit),
    }))
    out.sort((a, b) => b.rows.length - a.rows.length)
    return out
  }, [visibleRows])

  const flatVisible = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const selected = useMemo(
    () => flatVisible.find((r) => r.key === selectedKey) ?? flatVisible[0] ?? null,
    [flatVisible, selectedKey],
  )

  if (routes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <p className="text-sm font-medium text-foreground">No routes match the current filters</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Build the watchlist, wait for the next price fetch, or loosen the filters.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col lg:flex-row min-h-[560px]">
      {/* ── LEFT: the scan list ─────────────────────────────────────────── */}
      <div className="lg:w-[430px] lg:flex-none flex flex-col border-b lg:border-b-0 lg:border-r border-border">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <span className="font-heading text-[13px] tracking-wider text-foreground">DOCKET</span>
          <span className="tnum text-[10.5px] text-muted-foreground">
            {flatVisible.length} routes · net ↓
          </span>
          <div className="ml-auto flex rounded-md border border-gold-dim overflow-hidden text-[10px] font-semibold">
            {(['verdict', 'quadrant'] as Lens[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => {
                  setLens(l)
                  if (l === 'verdict') setVerdictFilter(null)
                }}
                aria-pressed={lens === l}
                className={`px-2.5 py-1 uppercase tracking-wide transition-colors cursor-pointer ${
                  lens === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {lens === 'quadrant' && (
          <Quadrant rows={allRows} active={verdictFilter} onPick={setVerdictFilter} />
        )}

        <div className="flex-1 overflow-auto custom-scrollbar max-h-[520px]">
          {groups.map((g) => (
            <div key={g.city}>
              <div className="flex items-baseline gap-2.5 px-4 pt-2.5 pb-1.5 bg-panel/60 sticky top-0 z-10 backdrop-blur-sm">
                <span className="font-heading text-[11px] tracking-[0.18em] text-primary">
                  {prettyCity(g.city).toUpperCase()}
                </span>
                <span className="text-[10px] text-ink-dim">{g.rows.length} routes</span>
                <span className="flex-1 border-b border-dotted border-border" />
              </div>
              {g.rows.map((r, i) => {
                const isSel = selected?.key === r.key
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setSelectedKey(r.key)}
                    className={`w-full flex items-center gap-2.5 h-[38px] px-4 border-b border-hair text-left transition-colors cursor-pointer ${
                      isSel ? 'bg-accent ring-1 ring-inset ring-gold-dim' : 'hover:bg-panel'
                    } ${r.fresh === 'stale' ? 'opacity-55' : ''}`}
                  >
                    <span className="w-4 text-right tnum text-[10px] text-ink-dim">{i + 1}</span>
                    <span
                      className="w-2 h-2 rounded-full flex-none"
                      style={{ background: freshnessColor(r.fresh) }}
                      title={`data age ${formatAge(r.ageHr)}`}
                    />
                    <span
                      className="tnum text-[10px] font-semibold flex-none"
                      style={{ color: tierColor(tierFromId(r.route.itemId)) }}
                    >
                      {tierBadge(tierFromId(r.route.itemId), r.route.enchant)}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium text-foreground">
                      {r.name}
                    </span>
                    {lens === 'verdict' && <VerdictChip v={r.verdict} compact />}
                    <span className="tnum text-[12.5px] font-semibold flex-none" style={{ color: 'var(--gold-bright)' }}>
                      {fmtSigned(r.route.netPerUnit)}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}

          {!showStale && staleCount > 0 && (
            <button
              type="button"
              onClick={() => setShowStale(true)}
              className="w-full flex items-center gap-2 m-2 mt-2.5 px-3 py-2 rounded-md border border-dashed border-[#3a2a20] hover:bg-panel transition-colors cursor-pointer"
              style={{ width: 'calc(100% - 16px)' }}
            >
              <span className="font-heading text-[9.5px] tracking-[0.14em]" style={{ color: 'var(--stale)' }}>
                STALE · OVER 3H
              </span>
              <span className="ml-auto text-[11px] text-muted-foreground">{staleCount} hidden — show ▸</span>
            </button>
          )}
        </div>

        <div className="px-4 py-2 text-[10px] text-ink-dim bg-panel-deep border-t border-border">
          dot = data age · list holds name + net only — the detail pane carries the rest
        </div>
      </div>

      {/* ── RIGHT: the detail pane ──────────────────────────────────────── */}
      <div className="flex-1 min-w-0 bg-panel p-6">
        {selected ? <Detail row={selected} /> : <p className="text-sm text-muted-foreground">Select a route.</p>}
      </div>
    </div>
  )
}

function VerdictChip({ v, compact = false }: { v: Verdict; compact?: boolean }) {
  const s = verdictStyle(v)
  return (
    <span
      className={`flex-none text-center font-semibold tracking-[0.1em] ${compact ? 'text-[8.5px] w-[52px] py-[3px]' : 'text-[9px] w-16 py-1'}`}
      style={{ color: s.fg, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 4 }}
    >
      {v}
    </span>
  )
}

function Detail({ row }: { row: Row }) {
  const r = row.route
  const [pending, startTransition] = useTransition()
  const [watched, setWatched] = useState(false)

  const onWatch = () => {
    setWatched(true)
    startTransition(async () => {
      try {
        await addFavoriteAction(r.itemId)
      } catch {
        setWatched(false)
      }
    })
  }

  // BM demand mini-bars: a flat proxy from daily volume (the last bar is "today").
  const bars = [0.35, 0.55, 0.4, 0.72, 0.6, 1]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="tnum text-[12px] font-semibold rounded-md px-2 py-[3px]"
          style={{ color: tierColor(tierFromId(r.itemId)), background: tierBg(tierFromId(r.itemId)) }}
        >
          {tierBadge(tierFromId(r.itemId), r.enchant)}
        </span>
        <span className="text-[19px] font-semibold text-foreground">{row.name}</span>
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="w-[7px] h-[7px] rounded-full" style={{ background: qualityColor(r.quality) }} />
          {qualityLabel(r.quality)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {SHOW_MARK_TAKEN && (
            <button
              type="button"
              className="text-[11px] font-semibold text-primary border border-gold-dim rounded-md px-3 py-1.5 hover:bg-accent transition-colors cursor-pointer whitespace-nowrap"
            >
              <Check className="inline size-3 mr-1" />
              Mark taken
            </button>
          )}
          <button
            type="button"
            onClick={onWatch}
            disabled={watched || pending}
            className="text-[11px] font-semibold text-primary border border-gold-dim rounded-md px-3 py-1.5 hover:bg-accent transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <Star className={`inline size-3 mr-1 ${watched ? 'fill-current' : ''}`} />
            {watched ? 'Watching' : 'Watch'}
          </button>
        </div>
      </div>

      {/* buy → sell → net */}
      <div className="flex items-stretch border border-border rounded-lg overflow-hidden">
        <div className="flex-1 p-4 bg-card">
          <div className="font-heading text-[9.5px] tracking-[0.14em] text-ink-dim">BUY · {prettyCity(r.buyCity).toUpperCase()}</div>
          <div className="tnum text-[20px] font-semibold text-foreground mt-1">{fmt(r.buyPrice)}</div>
          <div className="text-[10.5px] text-muted-foreground mt-0.5">sell order</div>
        </div>
        <div className="flex items-center px-3.5 text-primary text-base bg-panel">→</div>
        <div className="flex-1 p-4 bg-card">
          <div className="font-heading text-[9.5px] tracking-[0.14em] text-ink-dim">SELL · {prettyCity(r.sellCity).toUpperCase()}</div>
          <div className="tnum text-[20px] font-semibold text-foreground mt-1">{fmt(r.sellPrice)}</div>
          <div className="text-[10.5px] text-muted-foreground mt-0.5">buy order · after tax</div>
        </div>
        <div className="flex items-center px-3.5 text-ink-dim text-[15px] bg-panel">=</div>
        <div className="flex-[1.1] p-4 border-l border-gold-dim" style={{ background: '#1d160a' }}>
          <div className="font-heading text-[9.5px] tracking-[0.14em] text-muted-foreground">NET PROFIT</div>
          <div className="tnum text-[22px] font-semibold mt-0.5" style={{ color: 'var(--gold-bright)' }}>
            {fmtSigned(r.netPerUnit)}
          </div>
          <div className="tnum text-[11px] text-ink-num mt-0.5">{r.marginPct.toFixed(1)}% on buy</div>
        </div>
      </div>

      <div className="flex gap-3.5 flex-wrap">
        {/* data age (§② bins) */}
        <div className="flex-1 min-w-[220px] border border-border rounded-lg p-4">
          <div className="flex justify-between items-baseline">
            <span className="font-heading text-[9.5px] tracking-[0.14em] text-ink-dim">DATA AGE</span>
            <span className="tnum text-[11px]" style={{ color: freshnessColor(row.fresh) }}>
              {formatAge(row.ageHr)}
            </span>
          </div>
          <div className="mt-2.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--hair)' }}>
            <div
              className="h-full rounded-full"
              style={{
                background: freshnessColor(row.fresh),
                width: row.fresh === 'fresh' ? '100%' : row.fresh === 'aging' ? '55%' : '18%',
              }}
            />
          </div>
          <div className="text-[10.5px] text-ink-dim mt-2">
            {row.fresh === 'fresh'
              ? 'under 1h — trust the numbers'
              : row.fresh === 'aging'
                ? '1–3h — re-scan before a big ride'
                : 'over 3h — re-check before riding'}
          </div>
        </div>

        {/* BM demand */}
        <div className="flex-1 min-w-[220px] border border-border rounded-lg p-4">
          <div className="flex justify-between items-baseline">
            <span className="font-heading text-[9.5px] tracking-[0.14em] text-ink-dim">BM DEMAND · 24H</span>
            <span className="tnum text-[11px] text-muted-foreground">{fmt(r.dailyVolume)}/day</span>
          </div>
          <div className="flex items-end gap-[3px] h-[34px] mt-2">
            {bars.map((h, i) => (
              <span
                key={i}
                className="flex-1 rounded-t-sm"
                style={{ height: `${h * 100}%`, background: i === bars.length - 1 ? 'var(--gold)' : 'var(--gold-dim)' }}
              />
            ))}
          </div>
        </div>
      </div>

      {r.bmGap && (
        <div className="tnum text-[11px] text-muted-foreground border border-border rounded-md px-3 py-2 w-fit">
          BM gap: {fmt(r.bmGap.lowestAcquisition)} → {fmt(r.bmGap.bmBuyOrder)} · floor {fmt(r.bmGap.floor)}
          {r.bmFlagged && <span className="ml-2 font-semibold" style={{ color: 'var(--gold-bright)' }}>· live window</span>}
        </div>
      )}
    </div>
  )
}

/** §③ 1j — clickable scatter used as a verdict filter. margin → x, log(net) → y. */
function Quadrant({
  rows,
  active,
  onPick,
}: {
  rows: Row[]
  active: Verdict | null
  onPick: (v: Verdict | null) => void
}) {
  const corners: { v: Verdict; label: string; cls: string }[] = [
    { v: 'THIN', label: 'BIG & THIN — TRAPS', cls: 'left-2 top-1.5 text-ink-dim' },
    { v: 'PRIME', label: 'PRIME', cls: 'right-2 top-1.5 text-primary' },
    { v: 'NOISE', label: 'NOISE — FAT %, NO SILVER', cls: 'right-2 bottom-1.5 text-ink-dim' },
    { v: 'SOLID', label: 'SOLID', cls: 'left-2 bottom-1.5 text-[#7dae6b]' },
  ]
  return (
    <div className="px-4 pt-3 pb-2 border-b border-border">
      <div className="relative h-[190px] mx-1 border-l border-b border-border">
        <div className="absolute left-1/2 top-0 bottom-0 border-l border-dashed border-hair" />
        <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-hair" />
        {corners.map((c) => (
          <button
            key={c.v}
            type="button"
            onClick={() => onPick(active === c.v ? null : c.v)}
            className={`absolute font-heading text-[8.5px] tracking-[0.1em] hover:underline cursor-pointer ${c.cls} ${active === c.v ? 'underline' : ''}`}
          >
            {c.label}
          </button>
        ))}
        {rows.map((r) => {
          const x = Math.max(2, Math.min(98, (r.route.marginPct / 50) * 100))
          const yPct = Math.max(4, Math.min(98, ((Math.log10(Math.max(1, r.route.netPerUnit)) - 3) / 2.1) * 100))
          return (
            <span
              key={r.key}
              className="absolute w-[9px] h-[9px] rounded-full -translate-x-1/2 translate-y-1/2"
              style={{
                left: `${x}%`,
                bottom: `${yPct}%`,
                background: freshnessColor(r.fresh),
                border: '1px solid var(--background)',
                opacity: active && r.verdict !== active ? 0.2 : 1,
              }}
              title={`${r.name} · ${fmtSigned(r.route.netPerUnit)} · ${r.route.marginPct.toFixed(0)}%`}
            />
          )
        })}
        <span className="absolute right-0 -bottom-4 tnum text-[9px] text-ink-dim">margin % →</span>
      </div>
      {active && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="mt-1.5 text-[10px] text-primary hover:underline cursor-pointer"
        >
          filtered to {active} — clear ✕
        </button>
      )}
    </div>
  )
}
