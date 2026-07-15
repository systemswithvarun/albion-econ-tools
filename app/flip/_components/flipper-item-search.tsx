'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, Loader2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandList, CommandItem } from '@/components/ui/command'
import { searchItemsAction } from '@/app/prices/actions'
import type { ItemSearchResult } from '@/lib/prices'
import { formatItemName } from '@/lib/display'

export function FlipperItemSearch({ initialItemId }: { initialItemId?: string }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ItemSearchResult[]>([])
  const [pending, setPending] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setIsOpen(false)
      return
    }

    const timer = setTimeout(async () => {
      setPending(true)
      try {
        const res = await searchItemsAction(query)
        setResults(res)
        setIsOpen(true)
      } catch (err) {
        console.error('Failed to search items:', err)
      } finally {
        setPending(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [query])

  const handleSelectItem = (item: ItemSearchResult) => {
    setQuery('')
    setIsOpen(false)
    router.push(`/flip?itemId=${item.item_id}`)
  }

  const handleClear = () => {
    router.push('/flip')
  }

  return (
    <Card>
      <CardHeader className="py-4 px-5">
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="size-4 text-muted-foreground" />
          <span>Search Item Margin</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {initialItemId ? (
          <div className="flex items-center justify-between gap-3 bg-muted/65 border rounded-lg p-3 text-sm">
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-foreground text-xs uppercase tracking-wider text-muted-foreground">
                Active Selection
              </span>
              <span className="font-semibold text-foreground truncate mt-0.5">
                {initialItemId}
              </span>
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={handleClear}
              className="h-7 text-xs font-semibold px-2 gap-1 border-destructive text-destructive hover:bg-destructive/10"
            >
              <X className="size-3.5" />
              <span>Clear</span>
            </Button>
          </div>
        ) : (
          <div className="relative">
            <Popover open={isOpen} onOpenChange={setIsOpen} modal={false}>
              {/* Base UI uses `render` to replace the default <button> — the Radix
                  `asChild` equivalent. A button must not wrap the Input. */}
              <PopoverTrigger render={<div className="relative" />}>
                  <Input
                    value={query}
                    onChange={(e) => {
                      const val = e.target.value
                      setQuery(val)
                      if (val.trim()) {
                        setIsOpen(true)
                      } else {
                        setIsOpen(false)
                      }
                    }}
                    onFocus={() => {
                      if (query.trim()) {
                        setIsOpen(true)
                      }
                    }}
                    onClick={(e) => {
                      if (isOpen) {
                        e.stopPropagation()
                      }
                    }}
                    placeholder="e.g. Bag, Shield..."
                    className="pl-8 text-sm"
                  />
                  <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  {pending && (
                    <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-primary" />
                  )}
              </PopoverTrigger>
              <PopoverContent
                className="p-0 gap-0 w-(--anchor-width) overflow-hidden border bg-popover text-popover-foreground shadow-lg"
                align="start"
                side="bottom"
                sideOffset={4}
              >
                <Command shouldFilter={false} className="max-h-60 overflow-y-auto">
                  <CommandList className="divide-y divide-border/60">
                    {results.map((item) => (
                      <CommandItem
                        key={item.item_id}
                        value={item.item_id}
                        onSelect={() => handleSelectItem(item)}
                        className="px-3 py-2 cursor-pointer hover:bg-muted/70 flex items-center min-w-0 transition-colors"
                      >
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="font-semibold text-foreground truncate text-left">
                            {formatItemName({
                              display_name: item.display_name,
                              item_id: item.item_id,
                              enchant: item.enchant,
                            })}
                          </span>
                          <span className="text-[9px] text-muted-foreground font-mono uppercase truncate text-left">
                            {item.item_id} · T{item.tier}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                    {results.length === 0 && query.trim() !== '' && !pending && (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        No items found.
                      </div>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

