'use client'

import React, { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Star, Search, Loader2, Edit2, Check, X, TrendingUp, Info, ArrowLeft, RefreshCw, GripVertical, RotateCcw } from 'lucide-react'
import { formatItemName } from '@/lib/display'
import { CITIES, ROYAL_CITIES } from '@/lib/cities'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import {
  searchItemsAction,
  getItemPricesAction,
  getItemDailyVolumeAction,
  addFavoriteAction,
  removeFavoriteAction,
  submitGuildPriceAction,
  getWatchlistDataAction,
  reorderFavoriteAction,
  renumberFavoritesAction,
  reautoFavoritesAction,
  type DailyVolumeRecord,
} from '../actions'
import type { ItemSearchResult, FavoriteItem, LivePrice } from '@/lib/prices'
import { computeItemRoutes } from '@/lib/flip'
import { moveItem, pinPositionFor, sortFavorites } from '@/lib/favorites-order'
import { type FlipSettings } from '@/lib/flip-data'
import { classifyAge, freshnessColor, formatAge } from '@/lib/freshness'
import { tierColor, tierBadge, tierFromId, cityTag } from '@/lib/item-colors'
import { toBaseKey } from '@/db/seed/name-map'

/** "FortSterling" -> "Fort Sterling". */
function prettyCity(c: string): string {
  return c.replace(/([a-z])([A-Z])/g, '$1 $2')
}

/** Strip the tier possessive from a display name: "Adept's Bag" -> "Bag". */
function familyLabel(name: string): string {
  return name.replace(/^[^\s]+'s\s+/, '')
}

interface Family {
  key: string
  label: string
  variants: ItemSearchResult[] // one per tier (enchant 0), tier-ascending
}

/** §⑤ 1l: collapse flat search hits into base families, tier variants as a chip rail.
 *  One representative (enchant 0, else lowest enchant) per tier keeps the rail to ~5–7 chips. */
function groupIntoFamilies(results: ItemSearchResult[]): Family[] {
  const fams = new Map<string, Map<number, ItemSearchResult>>()
  const label = new Map<string, string>()
  for (const r of results) {
    const key = toBaseKey(r.item_id, r.enchant)
    if (!fams.has(key)) {
      fams.set(key, new Map())
      label.set(key, familyLabel(r.display_name))
    }
    const byTier = fams.get(key)!
    const existing = byTier.get(r.tier)
    // Prefer the base (enchant 0) as the tier's representative chip.
    if (!existing || r.enchant < existing.enchant) byTier.set(r.tier, r)
  }
  return [...fams.entries()].map(([key, byTier]) => ({
    key,
    label: label.get(key) ?? key,
    variants: [...byTier.values()].sort((a, b) => a.tier - b.tier),
  }))
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'no data'
  const diffMs = Date.now() - new Date(dateStr).getTime()
  if (diffMs < 0) return 'just now'
  const secs = Math.floor(diffMs / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const QUALITY_LABELS = [
  { value: 1, label: 'Normal' },
  { value: 2, label: 'Good' },
  { value: 3, label: 'Outstanding' },
  { value: 4, label: 'Excellent' },
  { value: 5, label: 'Masterpiece' },
]

export function PriceCheckerClient({
  initialFavorites,
  initialItem,
  initialSettings,
}: {
  initialFavorites: FavoriteItem[]
  initialItem: ItemSearchResult | null
  initialSettings: FlipSettings | null
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ItemSearchResult[]>([])
  const [favorites, setFavorites] = useState<FavoriteItem[]>(initialFavorites)
  const [selectedItem, setSelectedItem] = useState<ItemSearchResult | null>(initialItem)
  const [prices, setPrices] = useState<LivePrice[]>([])
  const [volumes, setVolumes] = useState<DailyVolumeRecord[]>([])
  const [selectedQuality, setSelectedQuality] = useState<number>(1)
  
  const [searchPending, setSearchPending] = useState(false)
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [, startTransition] = useTransition()

  // Watchlist states
  const [viewMode, setViewMode] = useState<'price' | 'flip'>('price')
  const [watchlistPrices, setWatchlistPrices] = useState<Record<string, LivePrice[]>>({})
  const [watchlistVolumes, setWatchlistVolumes] = useState<Record<string, DailyVolumeRecord[]>>({})
  const [loadingWatchlist, setLoadingWatchlist] = useState(false)

  // Drag-to-pin / re-auto state
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [orderPending, setOrderPending] = useState(false)

  // The server owns the order, so re-sync whenever a revalidate hands us a new list.
  useEffect(() => {
    setFavorites(initialFavorites)
  }, [initialFavorites])

  /** Drop: pin the dragged item at a gap-based position; leave the others as they are. */
  const handleDropOn = async (targetId: string) => {
    const sourceId = draggingId
    setDraggingId(null)
    setDragOverId(null)
    if (!sourceId || sourceId === targetId) return

    const moved = moveItem(favorites, sourceId, targetId)
    if (moved === favorites) return
    const idx = moved.findIndex((f) => f.item_id === sourceId)
    const position = pinPositionFor(moved, idx)

    // Optimistic: apply the same rule the server will, so this matches a reload.
    setFavorites(
      sortFavorites(
        moved.map((f) => (f.item_id === sourceId ? { ...f, sort_order: position ?? f.sort_order } : f)),
      ),
    )
    setOrderPending(true)
    try {
      if (position === null) {
        // Gap exhausted between two neighbouring pins — renumber the whole visible order.
        await renumberFavoritesAction(moved.map((f) => f.item_id))
      } else {
        await reorderFavoriteAction(sourceId, position)
      }
      router.refresh()
    } catch (err) {
      console.error('Failed to save watchlist order:', err)
      setFavorites(initialFavorites) // write failed — do not keep showing a fake order
    } finally {
      setOrderPending(false)
    }
  }

  /** Re-auto: clear every pin, back to family + tier order. */
  const handleResetOrder = async () => {
    setOrderPending(true)
    try {
      await reautoFavoritesAction()
      router.refresh() // server re-sorts by base_key/tier/enchant; client cannot
    } catch (err) {
      console.error('Failed to reset watchlist order:', err)
    } finally {
      setOrderPending(false)
    }
  }

  // NB: this app already uses "pin" to mean FAVORITE (the star reads "Pin Item", and the
  // panels are "Pinned Favorites" / "Pinned Watchlist"). So sort_order is deliberately
  // called a *custom order* here, never a "pin" — a favorited item is pinned whether or
  // not it has been dragged.
  const hasManualOrder = favorites.some((f) => f.sort_order !== null)

  // Track which cell is being edited
  const [editingCell, setEditingCell] = useState<{
    itemId?: string
    city: string
    side: 'buy_order' | 'sell_order'
    value: string
  } | null>(null)

  // Track which cell is submitting
  const [submittingCell, setSubmittingCell] = useState<{
    itemId?: string
    city: string
    side: 'buy_order' | 'sell_order'
  } | null>(null)

  // Debounced fuzzy search
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setSearchPending(true)
      try {
        const res = await searchItemsAction(query)
        setSearchResults(res)
      } catch (err) {
        console.error('Failed to search items:', err)
      } finally {
        setSearchPending(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [query])

  // Fetch prices and volumes when selected item changes
  const fetchItemData = async (itemId: string) => {
    setLoadingPrices(true)
    try {
      const [priceData, volData] = await Promise.all([
        getItemPricesAction(itemId),
        getItemDailyVolumeAction(itemId),
      ])
      setPrices(priceData)
      setVolumes(volData)
    } catch (err) {
      console.error('Failed to fetch item data:', err)
    } finally {
      setLoadingPrices(false)
    }
  }

  useEffect(() => {
    if (selectedItem) {
      fetchItemData(selectedItem.item_id)
      // Set URL query param without full reload
      const url = new URL(window.location.href)
      url.searchParams.set('itemId', selectedItem.item_id)
      window.history.pushState({}, '', url.toString())
    } else {
      setPrices([])
      setVolumes([])
      const url = new URL(window.location.href)
      url.searchParams.delete('itemId')
      window.history.pushState({}, '', url.toString())
    }
    setEditingCell(null)
  }, [selectedItem])

  // Fetch watchlist data
  const fetchWatchlistData = async (ids: string[]) => {
    if (ids.length === 0) {
      setWatchlistPrices({})
      setWatchlistVolumes({})
      return
    }
    setLoadingWatchlist(true)
    try {
      const data = await getWatchlistDataAction(ids)
      setWatchlistPrices(data.prices)
      setWatchlistVolumes(data.volumes)
    } catch (err) {
      console.error('Failed to fetch watchlist data:', err)
    } finally {
      setLoadingWatchlist(false)
    }
  }

  useEffect(() => {
    const ids = favorites.map((f) => f.item_id)
    fetchWatchlistData(ids)
  }, [favorites])

  // Handle Favorites toggle
  const handleToggleFavorite = async (e: React.MouseEvent, item: ItemSearchResult) => {
    e.stopPropagation()
    const isFav = favorites.some((f) => f.item_id === item.item_id)
    
    // Optimistic UI update
    if (isFav) {
      setFavorites((prev) => prev.filter((f) => f.item_id !== item.item_id))
      startTransition(async () => {
        await removeFavoriteAction(item.item_id)
      })
    } else {
      // A new favorite is auto (sort_order null), so the server slots it by family+tier.
      // Show it immediately, then refresh to pick up its real position.
      setFavorites((prev) => [{ ...item, sort_order: null }, ...prev])
      startTransition(async () => {
        await addFavoriteAction(item.item_id)
        router.refresh()
      })
    }
  }

  // Handle Guild Price inline submission
  const handleInlineSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingCell) return

    const { itemId, city, side, value } = editingCell
    const priceNum = Number(value)
    if (isNaN(priceNum) || priceNum <= 0) return
    if (!itemId) return

    setSubmittingCell({ itemId, city, side })
    try {
      const fd = new FormData()
      fd.append('itemId', itemId)
      fd.append('city', city)
      fd.append('quality', String(selectedQuality))
      fd.append('side', side)
      fd.append('price', String(priceNum))

      await submitGuildPriceAction(fd)
      
      // Re-fetch item prices if it is the focused item
      if (selectedItem && itemId === selectedItem.item_id) {
        const updatedPrices = await getItemPricesAction(selectedItem.item_id)
        setPrices(updatedPrices)
      }

      // Also refresh watchlist prices
      const ids = favorites.map((f) => f.item_id)
      if (ids.length > 0) {
        const data = await getWatchlistDataAction(ids)
        setWatchlistPrices(data.prices)
        setWatchlistVolumes(data.volumes)
      }
      
      setEditingCell(null)
    } catch (err) {
      console.error('Failed to submit price:', err)
    } finally {
      setSubmittingCell(null)
    }
  }

  const itemsList = query.trim() ? searchResults : favorites

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Sleek Top Navigation Bar */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-bold text-lg tracking-tight text-primary flex items-center gap-2">
              <TrendingUp className="size-5" />
              <span>Albion Econ</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm font-medium">
              <Link href="/" className="transition-colors hover:text-foreground text-muted-foreground">
                Dashboard
              </Link>
              <Link href="/flip" className="transition-colors hover:text-foreground text-muted-foreground">
                Market Flipping
              </Link>
              <Link href="/prices" className="transition-colors text-foreground font-semibold">
                Price Checker
              </Link>
            </nav>
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            Americas West
          </div>
        </div>
      </header>

      {/* Main Layout Container */}
      <main className="flex-1 container mx-auto px-6 py-6 grid gap-6 md:grid-cols-[340px_1fr]">
        
        {/* Left Side: Search & Favorites */}
        <div className="flex flex-col gap-4">
          <Card className="h-[calc(100vh-140px)] flex flex-col overflow-hidden">
            <CardHeader className="py-4 px-5 border-b shrink-0">
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="size-4 text-muted-foreground" />
                <span>Search Catalog</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Look up items by name or check favorites.
              </CardDescription>
              <div className="relative mt-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. Bag, Claymore..."
                  className="pl-8 text-sm"
                />
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-y-auto">
              <div className="p-3 bg-muted/40 text-[10px] uppercase font-bold tracking-wider text-muted-foreground border-b flex justify-between items-center px-4">
                <span>{query.trim() ? 'Search Results' : 'Pinned Favorites'}</span>
                {searchPending && <Loader2 className="size-3 animate-spin text-primary" />}
              </div>

              {itemsList.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground space-y-2">
                  <p className="font-medium">
                    {query.trim() ? 'No items matched your search' : 'Your personal list is empty'}
                  </p>
                  <p className="text-xs text-muted-foreground/80 max-w-[240px] mx-auto">
                    {query.trim()
                      ? 'Try double-checking the spelling or use abbreviations.'
                      : 'Search for any item and click the star to pin it here.'}
                  </p>
                </div>
              ) : query.trim() ? (
                // §⑤ 1l — tiered search: one base item per row, tiers as a chip rail.
                <div className="divide-y divide-border/60">
                  {groupIntoFamilies(searchResults).map((fam) => (
                    <div key={fam.key} className="px-4 py-2.5">
                      <div className="text-[13px] font-medium text-foreground mb-1.5 truncate">{fam.label}</div>
                      <div className="flex flex-wrap gap-1">
                        {fam.variants.map((v) => {
                          const isSel = selectedItem?.item_id === v.item_id
                          const c = tierColor(v.tier)
                          return (
                            <button
                              key={v.item_id}
                              type="button"
                              onClick={() => setSelectedItem(v)}
                              title={formatItemName({ display_name: v.display_name, item_id: v.item_id, enchant: v.enchant })}
                              className="tnum text-[11px] font-semibold rounded px-1.5 py-0.5 border transition-colors cursor-pointer"
                              style={
                                isSel
                                  ? { color: 'var(--primary-foreground)', background: c, borderColor: c }
                                  : { color: c, borderColor: 'var(--border)', background: 'transparent' }
                              }
                            >
                              T{v.tier}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                // No query → the pinned favorites, flat, as a quick nav list.
                <div className="divide-y divide-border/60">
                  {favorites.map((item) => {
                    const isFav = favorites.some((f) => f.item_id === item.item_id)
                    const isSelected = selectedItem?.item_id === item.item_id
                    return (
                      <div
                        key={item.item_id}
                        onClick={() => setSelectedItem(item)}
                        className={`group px-4 py-3 text-sm cursor-pointer flex items-center justify-between transition-all hover:bg-panel ${
                          isSelected ? 'bg-accent' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <span className="tnum text-[10px] font-semibold flex-none" style={{ color: tierColor(tierFromId(item.item_id)) }}>
                            {tierBadge(tierFromId(item.item_id), item.enchant)}
                          </span>
                          <span className="font-medium truncate text-foreground text-[13px]">
                            {formatItemName({
                              display_name: item.display_name,
                              item_id: item.item_id,
                              enchant: item.enchant,
                            })}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => handleToggleFavorite(e, item)}
                          className="opacity-70 group-hover:opacity-100 hover:text-primary focus-visible:opacity-100"
                        >
                          <Star
                            className={`size-4 transition-transform group-active:scale-90 ${
                              isFav ? 'fill-primary text-primary' : 'text-muted-foreground'
                            }`}
                          />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Price Details Grid or Watchlist Surface */}
        <div className="flex flex-col gap-4">
          {!selectedItem ? (
            /* Watchlist Surface when no item selected */
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4 flex-wrap bg-card border rounded-lg px-6 py-4 shadow-sm">
                <div>
                  <h3 className="text-lg font-bold text-foreground">Pinned Watchlist</h3>
                  <p className="text-xs text-muted-foreground">
                    Your custom set of monitored items, bypassing normal flip filters.
                  </p>
                  {favorites.length > 1 && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <GripVertical className="size-3" />
                      {hasManualOrder
                        ? 'Items you reordered come first; the rest follow family and tier.'
                        : 'Sorted by family and tier — drag an item by its handle to reorder it.'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  {/* View Toggle */}
                  <div className="flex items-center gap-1 bg-muted p-1 rounded-md border text-xs font-medium">
                    <Button
                      variant={viewMode === 'price' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('price')}
                      className={`h-7 px-3 text-xs rounded-sm ${
                        viewMode === 'price' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Price View
                    </Button>
                    <Button
                      variant={viewMode === 'flip' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('flip')}
                      className={`h-7 px-3 text-xs rounded-sm ${
                        viewMode === 'flip' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Flip View
                    </Button>
                  </div>
                  
                  {/* Order control. Always rendered once there is a list to order — it
                      previously only appeared after something was pinned, which made
                      ordering undiscoverable: the sole affordance was the drag handle,
                      and the reset was hidden exactly when you went looking for it.
                      The label reports the current ordering state. */}
                  {favorites.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleResetOrder}
                      disabled={orderPending || !hasManualOrder}
                      className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      title={
                        hasManualOrder
                          ? 'Clear the custom order and sort by family and tier'
                          : 'Already sorted by family and tier — drag an item by its handle to reorder it'
                      }
                    >
                      <RotateCcw className={`size-3.5 ${orderPending ? 'animate-spin' : ''}`} />
                      {orderPending ? 'Resetting…' : hasManualOrder ? 'Reset order' : 'Auto order'}
                    </Button>
                  )}

                  {/* Refresh Button */}
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => fetchWatchlistData(favorites.map(f => f.item_id))}
                    disabled={loadingWatchlist}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    title="Refresh prices"
                  >
                    <RefreshCw className={`size-3.5 ${loadingWatchlist ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>

              {favorites.length === 0 ? (
                <Card className="flex flex-col justify-center items-center text-center p-12 min-h-[300px] border-dashed">
                  <div className="bg-muted size-12 rounded-full flex items-center justify-center mb-4">
                    <Star className="size-6 text-muted-foreground" />
                  </div>
                  <h4 className="text-base font-bold mb-1">Your Watchlist is Empty</h4>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Search for items in the catalog on the left and click the star to pin them to this watchlist.
                  </p>
                </Card>
              ) : loadingWatchlist && Object.keys(watchlistPrices).length === 0 ? (
                <Card className="flex flex-col justify-center items-center text-center p-12 min-h-[300px]">
                  <Loader2 className="size-8 animate-spin text-primary mb-4" />
                  <h4 className="text-base font-bold mb-1">Loading Watchlist Prices</h4>
                  <p className="text-sm text-muted-foreground">
                    Retrieving cached DB observations and AODP data.
                  </p>
                </Card>
              ) : (
                <div className="space-y-4">
                  {/* Quality selector for the watchlist */}
                  <div className="border border-border/80 bg-card rounded-lg px-6 py-2.5 flex items-center justify-between gap-4 flex-wrap">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Watchlist Quality Tier
                    </span>
                    <div className="flex items-center gap-1">
                      {QUALITY_LABELS.map((q) => (
                        <Button
                          key={q.value}
                          variant={selectedQuality === q.value ? 'default' : 'ghost'}
                          size="xs"
                          onClick={() => {
                            setSelectedQuality(q.value)
                            setEditingCell(null)
                          }}
                          className={`h-7 px-3 text-xs font-medium rounded-full ${
                            selectedQuality === q.value 
                              ? 'bg-primary text-primary-foreground' 
                              : 'hover:bg-muted/70 text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {q.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* §④ 1k — The Watch: one compact row per item; the toggle swaps the
                      right side between price and flip, order and items never move. */}
                  <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-hair">
                    {favorites.map((item) => (
                      <WatchRow
                        key={item.item_id}
                        item={item}
                        mode={viewMode}
                        prices={watchlistPrices[item.item_id] ?? []}
                        volumes={watchlistVolumes[item.item_id] ?? []}
                        quality={selectedQuality}
                        premium={initialSettings?.premium ?? false}
                        dragging={draggingId === item.item_id}
                        dragOver={dragOverId === item.item_id && draggingId !== item.item_id}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', item.item_id)
                          e.dataTransfer.effectAllowed = 'move'
                          setDraggingId(item.item_id)
                        }}
                        onDragEnd={() => {
                          setDraggingId(null)
                          setDragOverId(null)
                        }}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          if (draggingId) setDragOverId(item.item_id)
                        }}
                        onDragLeave={() => setDragOverId((cur) => (cur === item.item_id ? null : cur))}
                        onDrop={(e) => {
                          e.preventDefault()
                          handleDropOn(item.item_id)
                        }}
                        onInspect={() => setSelectedItem(item)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : loadingPrices ? (
            <Card className="flex-1 flex flex-col justify-center items-center text-center p-12 min-h-[400px]">
              <Loader2 className="size-8 animate-spin text-primary mb-4" />
              <h3 className="text-base font-bold mb-1">Retrieving Live Prices</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Pinging AODP live API to gather the freshest metrics. This can take a few seconds if data is not cached.
              </p>
            </Card>
          ) : (
            <Card className="flex flex-col h-full">
              {/* Card Header details */}
              <CardHeader className="border-b py-5 px-6 flex flex-row items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedItem(null)}
                      className="p-0 h-auto hover:bg-transparent text-xs text-muted-foreground hover:text-foreground font-semibold flex items-center gap-1 mr-2"
                    >
                      <ArrowLeft className="size-3.5" />
                      <span>Back to Watchlist</span>
                    </Button>
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      {formatItemName({
                        display_name: selectedItem.display_name,
                        item_id: selectedItem.item_id,
                        enchant: selectedItem.enchant,
                      })}
                    </h2>
                    <Badge variant="outline" className="font-mono text-xs uppercase">
                      T{selectedItem.tier}
                    </Badge>
                    {selectedItem.enchant > 0 && (
                      <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-none font-semibold">
                        .{selectedItem.enchant} Enchant
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs font-mono uppercase text-muted-foreground">
                    ID: {selectedItem.item_id} · CATEGORY: {selectedItem.category}
                  </CardDescription>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => handleToggleFavorite(e, selectedItem)}
                    className="flex items-center gap-1.5 h-8 font-medium"
                  >
                    <Star
                      className={`size-3.5 ${
                        favorites.some((f) => f.item_id === selectedItem.item_id)
                          ? 'fill-yellow-500 text-yellow-500'
                          : ''
                      }`}
                    />
                    <span>
                      {favorites.some((f) => f.item_id === selectedItem.item_id) ? 'Pinned' : 'Pin Item'}
                    </span>
                  </Button>
                  <Link
                    href={`/flip?itemId=${selectedItem.item_id}`}
                    className={buttonVariants({
                      size: 'sm',
                      className: 'h-8 font-bold bg-primary text-primary-foreground hover:bg-primary/95',
                    })}
                  >
                    Plan this flip
                  </Link>
                </div>
              </CardHeader>

              {/* Quality Tabs Selector */}
              <div className="border-b bg-muted/20 px-6 py-2.5 flex items-center justify-between gap-4 flex-wrap">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Quality Tier
                </span>
                <div className="flex items-center gap-1">
                  {QUALITY_LABELS.map((q) => (
                    <Button
                      key={q.value}
                      variant={selectedQuality === q.value ? 'default' : 'ghost'}
                      size="xs"
                      onClick={() => {
                        setSelectedQuality(q.value)
                        setEditingCell(null)
                      }}
                      className={`h-7 px-3 text-xs font-medium rounded-full ${
                        selectedQuality === q.value 
                          ? 'bg-primary text-primary-foreground' 
                          : 'hover:bg-muted/70 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {q.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Grid content */}
              <CardContent className="p-0 overflow-x-auto flex-1">
                {renderPriceGrid(selectedItem.item_id, prices, volumes)}
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )

  // Price Grid Component Renderer
  function renderPriceGrid(itemId: string, itemPrices: LivePrice[], itemVolumes: DailyVolumeRecord[]) {
    const qualityPrices = itemPrices.filter((p) => p.quality === selectedQuality)

    const royalSellPrices = qualityPrices
      .filter((p) => p.side === 'sell_order' && (ROYAL_CITIES as readonly string[]).includes(p.city))
      .map((p) => p.price)
    const lowestAcquisition = royalSellPrices.length > 0 ? Math.min(...royalSellPrices) : 0

    const bmBuyPriceObs = qualityPrices.find((p) => p.city === 'BlackMarket' && p.side === 'buy_order')
    const bmBuyPrice = bmBuyPriceObs?.price ?? 0

    const bmFlagged = lowestAcquisition > 0 && bmBuyPrice >= lowestAcquisition * 1.10

    return (
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[180px] pl-6 text-xs font-bold text-muted-foreground uppercase tracking-wider">City</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Buy Price (Sell Order)</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Sell Price (Buy Order)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Render Royal Cities and Brecilien */}
          {CITIES.filter((city) => city !== 'BlackMarket').map((city) => {
            const isRoyal = (ROYAL_CITIES as readonly string[]).includes(city)
            
            // Buy Price = price players pay to buy (side = sell_order)
            const buyObs = qualityPrices.find(
              (p) => p.city === city && p.side === 'sell_order'
            )
            // Sell Price = price players get when selling (side = buy_order)
            const sellObs = qualityPrices.find(
              (p) => p.city === city && p.side === 'buy_order'
            )

            return (
              <TableRow key={city} className="hover:bg-muted/30">
                <TableCell className="font-semibold text-foreground pl-6 flex flex-col py-3">
                  <span>{city}</span>
                  <span className="text-[10px] text-muted-foreground font-normal">
                    {isRoyal ? 'Royal City' : 'Rest Hub'}
                  </span>
                </TableCell>
                
                {/* Buy Price Cell (Sell Order) */}
                <TableCell className="py-2">
                  {renderCell(itemId, city, 'sell_order', buyObs)}
                </TableCell>

                {/* Sell Price Cell (Buy Order) */}
                <TableCell className="py-2">
                  {renderCell(itemId, city, 'buy_order', sellObs)}
                </TableCell>
              </TableRow>
            )
          })}

          {/* Special Black Market Row */}
          {(() => {
            const bmVolume = itemVolumes.find((v) => v.city === 'BlackMarket')
            const bmBuyObs = qualityPrices.find(
              (p) => p.city === 'BlackMarket' && p.side === 'buy_order'
            )
            const bmSellObs = qualityPrices.find(
              (p) => p.city === 'BlackMarket' && p.side === 'sell_order'
            )

            return (
              <TableRow className="bg-primary/5 hover:bg-primary/10 border-t border-b-0">
                <TableCell className="font-bold text-foreground pl-6 py-4 flex flex-col justify-center">
                  <span className="flex items-center gap-1.5">
                    <span>Black Market</span>
                    <Badge className="bg-primary text-primary-foreground text-[9px] uppercase font-bold py-0.5 px-1.5 border-none h-4 rounded">
                      BM
                    </Badge>
                  </span>
                  <span className="text-[10px] text-muted-foreground font-normal mt-0.5">
                    Brecilien / Caerleon Hub
                  </span>
                </TableCell>
                
                <TableCell colSpan={2} className="py-3 pr-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                    {/* C5 STAT 1: Avg Sale Price */}
                    <div className="flex flex-col gap-0.5 border-l border-border/60 pl-3 first:border-0 first:pl-0">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                        Avg Sale Price (C5)
                      </span>
                      <span className="font-mono font-semibold text-sm text-foreground">
                        {bmVolume && bmVolume.avg_price > 0 ? (
                          <span>{bmVolume.avg_price.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">silver</span></span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic font-normal">no data</span>
                        )}
                      </span>
                    </div>

                    {/* C5 STAT 2: Most Recent Buy Order */}
                    <div className="flex flex-col gap-0.5 border-l border-border/60 pl-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                          Recent Buy Order
                        </span>
                        {bmBuyObs && (
                          <Badge variant="outline" className={`text-[8px] px-1 py-0 border-none font-bold ${
                            bmBuyObs.source === 'guild' 
                              ? 'bg-emerald-500/10 text-emerald-600' 
                              : 'bg-indigo-500/10 text-indigo-600'
                          }`}>
                            {bmBuyObs.source}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-mono font-bold text-sm text-foreground">
                          {bmBuyObs && bmBuyObs.price > 0 ? (
                            <span>{bmBuyObs.price.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">silver</span></span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic font-normal">no data</span>
                          )}
                        </span>
                        {bmBuyObs && (
                          <span className="text-[9px] text-muted-foreground font-mono">
                            ({formatRelativeTime(bmBuyObs.observed_at)})
                          </span>
                        )}
                      </div>
                    </div>

                    {/* C5 STAT 3: Most Recent Sell Order */}
                    <div className="flex flex-col gap-0.5 border-l border-border/60 pl-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                          Recent Sell Order
                        </span>
                        {bmSellObs && (
                          <Badge variant="outline" className={`text-[8px] px-1 py-0 border-none font-bold ${
                            bmSellObs.source === 'guild' 
                              ? 'bg-emerald-500/10 text-emerald-600' 
                              : 'bg-indigo-500/10 text-indigo-600'
                          }`}>
                            {bmSellObs.source}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-mono font-bold text-sm text-foreground">
                          {bmSellObs && bmSellObs.price > 0 ? (
                            <span>{bmSellObs.price.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">silver</span></span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic font-normal">no data</span>
                          )}
                        </span>
                        {bmSellObs && (
                          <span className="text-[9px] text-muted-foreground font-mono">
                            ({formatRelativeTime(bmSellObs.observed_at)})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Live Profit Window Alert */}
                  <div className="mt-3 flex items-center justify-between gap-4 border-t border-primary/10 pt-3 flex-wrap">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                      <Info className="size-3.5 text-muted-foreground" />
                      <span>
                        Royal Acquisition Min:{' '}
                        <strong className="text-foreground font-mono">
                          {lowestAcquisition > 0 ? lowestAcquisition.toLocaleString() : 'no data'}
                        </strong>{' '}
                        · Gap Floor (×1.10):{' '}
                        <strong className="text-foreground font-mono">
                          {lowestAcquisition > 0 ? Math.round(lowestAcquisition * 1.10).toLocaleString() : 'no data'}
                        </strong>
                      </span>
                    </div>
                    {bmFlagged ? (
                      <Badge className="bg-emerald-500 text-white font-bold animate-pulse py-1 px-3 text-[10px] border-none uppercase tracking-wider rounded-full flex items-center gap-1 shadow-sm shadow-emerald-500/15">
                        🔥 Live Profit Window
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] font-medium py-1 px-3 tracking-wide rounded-full text-muted-foreground bg-muted">
                        No profit gap
                      </Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })()}
        </TableBody>
      </Table>
    )
  }

  // Sub-renderer for price cells
  function renderCell(itemId: string, city: string, side: 'buy_order' | 'sell_order', obs: LivePrice | undefined) {
    const isEditing = editingCell?.itemId === itemId && editingCell?.city === city && editingCell?.side === side
    const isSubmitting = submittingCell?.itemId === itemId && submittingCell?.city === city && submittingCell?.side === side

    if (isEditing) {
      return (
        <form onSubmit={handleInlineSubmit} className="flex items-center gap-2 max-w-[180px]">
          <Input
            type="number"
            min={1}
            value={editingCell.value}
            onChange={(e) => setEditingCell((prev) => prev ? { ...prev, value: e.target.value } : null)}
            className="h-8 text-xs font-mono py-1 px-2 shrink"
            required
            autoFocus
            disabled={isSubmitting}
          />
          <Button
            type="submit"
            variant="default"
            size="icon-xs"
            disabled={isSubmitting}
            className="bg-emerald-600 hover:bg-emerald-700 text-white size-7"
          >
            {isSubmitting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            onClick={() => setEditingCell(null)}
            disabled={isSubmitting}
            className="size-7"
          >
            <X className="size-3.5" />
          </Button>
        </form>
      )
    }

    return (
      <div className="group/cell flex items-center justify-between gap-4 min-h-[36px]">
        {obs && obs.price > 0 ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-sm text-foreground">
                {obs.price.toLocaleString()}
              </span>
              <Badge variant="outline" className={`text-[9px] font-bold px-1.5 py-0 border-none rounded ${
                obs.source === 'guild' 
                  ? 'bg-emerald-500/10 text-emerald-600' 
                  : 'bg-indigo-500/10 text-indigo-600'
              }`}>
                {obs.source}
              </Badge>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">
              {formatRelativeTime(obs.observed_at)}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/60 italic font-medium">
            no data
          </span>
        )}

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() =>
            setEditingCell({
              itemId,
              city,
              side,
              value: obs?.price ? String(obs.price) : '',
            })
          }
          className="opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground border rounded shadow-xs ml-auto size-7 transition-opacity"
        >
          <Edit2 className="size-3" />
        </Button>
      </div>
    )
  }
}

/** §④ 1k — one compact watch row. The PRICES/FLIPS toggle swaps only the right side;
 *  the item, its tier badge, and its position never move. No live flip route ⇒ the row
 *  dims, it never disappears. */
function WatchRow({
  item,
  mode,
  prices,
  volumes,
  quality,
  premium,
  dragging,
  dragOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onInspect,
}: {
  item: FavoriteItem
  mode: 'price' | 'flip'
  prices: LivePrice[]
  volumes: DailyVolumeRecord[]
  quality: number
  premium: boolean
  dragging: boolean
  dragOver: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onInspect: () => void
}) {
  const qp = prices.filter((p) => p.quality === quality)
  const tier = tierFromId(item.item_id)
  const name = formatItemName({ display_name: item.display_name, item_id: item.item_id, enchant: item.enchant })
  const ageHrOf = (t?: string) => (t ? (Date.now() - new Date(t).getTime()) / 3_600_000 : Infinity)

  // Price mode: cheapest royal buy (sell order) + the BM buy order you sell into.
  const royalBuys = qp.filter((p) => p.side === 'sell_order' && (ROYAL_CITIES as readonly string[]).includes(p.city))
  const bestBuy = royalBuys.reduce<LivePrice | undefined>((min, p) => (!min || p.price < min.price ? p : min), undefined)
  const bmSell = qp.find((p) => p.city === 'BlackMarket' && p.side === 'buy_order')
  const priceAge = Math.min(ageHrOf(bestBuy?.observed_at), ageHrOf(bmSell?.observed_at))
  const priceFresh = classifyAge(priceAge)
  const hasPrice = Boolean(bestBuy || bmSell)

  // Flip mode: best cross-city route by net per unit.
  const volumeByCity: Record<string, number> = {}
  for (const v of volumes) volumeByCity[v.city] = v.avg_sold
  const routes = computeItemRoutes(
    {
      itemId: item.item_id,
      baseName: item.display_name ?? item.item_id,
      displayName: item.display_name,
      enchant: item.enchant,
      quality,
      category: item.category,
      buyQuotes: qp.filter((p) => p.side === 'sell_order'),
      sellQuotes: qp.filter((p) => p.side === 'buy_order'),
      volumeByCity,
    },
    { premium },
    new Date(),
  ).sort((a, b) => b.netPerUnit - a.netPerUnit)
  const best = routes[0]
  const dim = mode === 'flip' && !best
  const fmt = (n: number) => Math.round(n).toLocaleString()

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group flex items-center gap-2.5 h-11 px-3 transition-colors ${
        dragging ? 'opacity-50' : 'hover:bg-panel'
      } ${dragOver ? 'ring-1 ring-inset ring-primary' : ''} ${dim ? 'opacity-55' : ''}`}
    >
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        role="button"
        tabIndex={-1}
        aria-label={`Reorder ${name}`}
        title="Drag to move this item to a custom position"
        className="cursor-grab active:cursor-grabbing text-ink-dim opacity-0 group-hover:opacity-100 transition-opacity flex-none"
      >
        <GripVertical className="size-4" />
      </span>
      <span className="tnum text-[10px] font-semibold flex-none" style={{ color: tierColor(tier) }}>
        {tierBadge(tier, item.enchant)}
      </span>

      <button onClick={onInspect} className="flex-1 min-w-0 text-left" title="Inspect prices">
        <span className="block truncate text-[12.5px] font-medium text-foreground">{name}</span>
        {mode === 'flip' && (
          <span className="block truncate text-[10px] text-ink-dim">
            {best ? `${prettyCity(best.buyCity)} → BM` : `no live route${Number.isFinite(priceAge) ? ` · price ${formatAge(priceAge)} old` : ''}`}
          </span>
        )}
      </button>

      {item.sort_order !== null && (
        <span
          className="tnum text-[8.5px] text-ink-dim border border-border rounded px-1 py-0.5 flex-none"
          title="Custom position — Reset order returns to family + tier"
        >
          ●
        </span>
      )}

      {mode === 'price' ? (
        <>
          <span className="text-right flex-none whitespace-nowrap leading-tight">
            <span className="block tnum text-[11.5px] text-ink-num">
              {bestBuy ? `${cityTag(bestBuy.city)} ${fmt(bestBuy.price)}` : '—'}
            </span>
            <span className="block tnum text-[9.5px] text-ink-dim">
              {bmSell ? `BM ${fmt(bmSell.price)}` : 'BM —'}
            </span>
          </span>
          <span
            className="w-[5px] h-[26px] rounded-sm flex-none"
            style={{ background: hasPrice ? freshnessColor(priceFresh) : 'var(--hair)' }}
            title={hasPrice ? `data age ${formatAge(priceAge)}` : 'no data'}
          />
        </>
      ) : (
        <span className="text-right flex-none whitespace-nowrap leading-tight">
          {best ? (
            <>
              <span
                className="block tnum text-[12px] font-semibold"
                style={{ color: best.netPerUnit >= 0 ? 'var(--gold-bright)' : 'var(--stale)' }}
              >
                {best.netPerUnit >= 0 ? '+' : ''}{fmt(best.netPerUnit)}
              </span>
              <span className="block tnum text-[9.5px] text-ink-dim">{best.marginPct.toFixed(0)}%</span>
            </>
          ) : (
            <span className="tnum text-[11px]" style={{ color: 'var(--stale)' }}>stale</span>
          )}
        </span>
      )}
    </div>
  )
}
