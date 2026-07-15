'use client'

import React, { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { Star, Search, Loader2, ArrowLeftRight, Edit2, Check, X, TrendingUp, Info, ArrowLeft, RefreshCw } from 'lucide-react'
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
  type DailyVolumeRecord,
} from '../actions'
import type { ItemSearchResult, LivePrice } from '@/lib/prices'
import { computeItemRoutes } from '@/lib/flip'
import { type FlipSettings } from '@/lib/flip-data'

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
  initialFavorites: ItemSearchResult[]
  initialItem: ItemSearchResult | null
  initialSettings: FlipSettings | null
}) {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ItemSearchResult[]>([])
  const [favorites, setFavorites] = useState<ItemSearchResult[]>(initialFavorites)
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
      setFavorites((prev) => [item, ...prev])
      startTransition(async () => {
        await addFavoriteAction(item.item_id)
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
              ) : (
                <div className="divide-y divide-border/60">
                  {itemsList.map((item) => {
                    const isFav = favorites.some((f) => f.item_id === item.item_id)
                    const isSelected = selectedItem?.item_id === item.item_id
                    return (
                      <div
                        key={item.item_id}
                        onClick={() => setSelectedItem(item)}
                        className={`group px-4 py-3 text-sm cursor-pointer flex items-center justify-between transition-all hover:bg-muted/70 ${
                          isSelected ? 'bg-primary/5 border-l-2 border-primary' : ''
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="font-semibold truncate text-foreground text-sm">
                            {formatItemName({
                              display_name: item.display_name,
                              item_id: item.item_id,
                              enchant: item.enchant,
                            })}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground truncate uppercase">
                            {item.item_id} · T{item.tier}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => handleToggleFavorite(e, item)}
                          className="opacity-70 group-hover:opacity-100 hover:text-yellow-500 focus-visible:opacity-100"
                        >
                          <Star
                            className={`size-4 transition-transform group-active:scale-90 ${
                              isFav ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground'
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

                  {favorites.map((item) => {
                    const itemPrices = watchlistPrices[item.item_id] ?? []
                    const itemVolumes = watchlistVolumes[item.item_id] ?? []

                    return (
                      <Card key={item.item_id} className="overflow-hidden border shadow-sm">
                        <CardHeader className="py-3.5 px-6 bg-muted/20 border-b flex flex-row items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => setSelectedItem(item)}
                              className="font-bold text-foreground text-sm sm:text-base hover:text-primary transition-colors text-left"
                            >
                              {formatItemName({
                                display_name: item.display_name,
                                item_id: item.item_id,
                                enchant: item.enchant,
                              })}
                            </button>
                            <Badge variant="outline" className="font-mono text-[10px] uppercase py-0 px-1.5 h-5">
                              T{item.tier}
                            </Badge>
                            {item.enchant > 0 && (
                              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-none font-semibold text-[10px] py-0 px-1.5 h-5">
                                .{item.enchant}
                              </Badge>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => setSelectedItem(item)}
                              className="text-xs h-7 px-2 font-medium"
                            >
                              Inspect details
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={(e) => handleToggleFavorite(e, item)}
                              className="text-yellow-500 hover:bg-yellow-500/10"
                            >
                              <Star className="size-4 fill-yellow-500 text-yellow-500" />
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="p-0">
                          {viewMode === 'price' ? (
                            <div className="overflow-x-auto">
                              {renderPriceGrid(item.item_id, itemPrices, itemVolumes)}
                            </div>
                          ) : (
                            renderFlipEconomics(item, itemPrices, itemVolumes)
                          )}
                        </CardContent>
                      </Card>
                    )
                  })}
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

  // Flip Economics Renderer
  function renderFlipEconomics(item: ItemSearchResult, itemPrices: LivePrice[], itemVolumes: DailyVolumeRecord[]) {
    // Build ItemMarket
    const buyQuotes = itemPrices.filter((p) => p.quality === selectedQuality && p.side === 'sell_order')
    const sellQuotes = itemPrices.filter((p) => p.quality === selectedQuality && p.side === 'buy_order')
    const volumeByCity: Record<string, number> = {}
    itemVolumes.forEach((v) => { volumeByCity[v.city] = v.avg_sold })

    const itemMarket = {
      itemId: item.item_id,
      baseName: item.display_name ?? item.item_id,
      displayName: item.display_name,
      enchant: item.enchant,
      quality: selectedQuality,
      category: item.category,
      buyQuotes,
      sellQuotes,
      volumeByCity,
    }

    const premium = initialSettings?.premium ?? false
    // Use computeItemRoutes to calculate flip economics (pure logic from lib/flip.ts)
    const routes = computeItemRoutes(itemMarket, { premium }, new Date())

    // If there are no valid routes, show message
    if (routes.length === 0) {
      return (
        <div className="p-6 text-center text-sm text-muted-foreground border-t border-dashed bg-muted/10 rounded-b-lg">
          No cross-city flip routes available (requires quotes in at least two different cities).
        </div>
      )
    }

    // Sort routes by net profit desc
    routes.sort((a, b) => b.netPerUnit - a.netPerUnit)

    return (
      <div className="divide-y divide-border border-t max-h-[400px] overflow-y-auto custom-scrollbar font-sans">
        {routes.map((r, i) => (
          <div
            key={`${r.buyCity}-${r.sellCity}-${i}`}
            className="p-4 flex flex-col gap-1.5 hover:bg-muted/30 transition-colors"
          >
            {/* Line 1: Route header and BM flagged badge */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-semibold text-foreground">{r.buyCity}</span>
                <span className="text-muted-foreground text-xs">→</span>
                <span className="font-semibold text-foreground">{r.sellCity}</span>
                {r.bmFlagged && r.sellCity === 'BlackMarket' && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold border-none text-[9px] px-1.5 py-0.5 rounded-full animate-pulse whitespace-nowrap">
                    🔥 BM Flagged
                  </Badge>
                )}
              </div>
              <div className="text-right shrink-0">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                  r.netPerUnit > 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'
                }`}>
                  {r.netPerUnit > 0 ? '+' : ''}{Math.round(r.netPerUnit).toLocaleString()} silver / unit
                </span>
              </div>
            </div>

            {/* Line 2: Prices and Age */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div>
                Buy @ <span className="font-semibold text-foreground font-mono">{Math.round(r.buyPrice).toLocaleString()}</span>
                <span className="mx-2">|</span>
                Sell @ <span className="font-semibold text-foreground font-mono">{Math.round(r.sellPrice).toLocaleString()}</span>
              </div>
              <div className="text-[10px] font-mono whitespace-nowrap">
                Age: {r.buyAgeHr.toFixed(1)}h / {r.sellAgeHr.toFixed(1)}h
              </div>
            </div>

            {/* Line 3: Gap line if Black Market */}
            {r.bmGap && r.sellCity === 'BlackMarket' && (
              <div className="text-[10px] text-muted-foreground font-mono leading-relaxed bg-muted/40 px-2 py-0.5 rounded border border-border/40 w-fit">
                BM Gap: {r.bmGap.lowestAcquisition.toLocaleString()} → {r.bmGap.bmBuyOrder.toLocaleString()} (Floor: {Math.round(r.bmGap.floor).toLocaleString()})
              </div>
            )}

            {/* Line 4: Margin % and Daily Volume */}
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-muted-foreground font-medium pt-1.5 border-t border-border/30">
              <div className="flex items-center gap-1">
                <span>Margin:</span>
                <span className={`font-semibold tabular-nums ${r.marginPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                  {r.marginPct.toFixed(1)}%
                </span>
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-border" aria-hidden="true" />
              <div className="flex items-center gap-1">
                <span>Daily Vol:</span>
                <span className="text-foreground font-semibold tabular-nums">
                  {Math.round(r.dailyVolume).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
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
