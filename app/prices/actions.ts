'use server'

import { revalidatePath } from 'next/cache'
import {
  addFavorite,
  removeFavorite,
  searchItems,
  getItemPrices,
  setFavoriteSortOrder,
  reautoFavorites,
  renumberFavorites,
  type ItemSearchResult,
  type LivePrice,
} from '@/lib/prices'
import { supabase } from '@/lib/supabase'
import { getClientId } from '@/lib/client-id'

import { submitGuildPriceAction as baseSubmitGuildPriceAction } from '@/app/flip/actions'

export async function submitGuildPriceAction(formData: FormData): Promise<void> {
  return baseSubmitGuildPriceAction(formData)
}

export async function addFavoriteAction(itemId: string): Promise<void> {
  const clientId = await getClientId()
  if (!clientId) throw new Error('No client id — reload to get a session cookie')
  await addFavorite(clientId, itemId)
  revalidatePath('/prices')
}

export async function removeFavoriteAction(itemId: string): Promise<void> {
  const clientId = await getClientId()
  if (!clientId) throw new Error('No client id — reload to get a session cookie')
  await removeFavorite(clientId, itemId)
  revalidatePath('/prices')
}

/** Drag persist: pin a favorite to a position (gap-based sort_order), or unpin (null). */
export async function reorderFavoriteAction(itemId: string, sortOrder: number | null): Promise<void> {
  const clientId = await getClientId()
  if (!clientId) throw new Error('No client id — reload to get a session cookie')
  await setFavoriteSortOrder(clientId, itemId, sortOrder)
  revalidatePath('/prices')
}

/** Renumber pins to a clean step-100 sequence (gap-exhaustion escape hatch). */
export async function renumberFavoritesAction(orderedItemIds: string[]): Promise<void> {
  const clientId = await getClientId()
  if (!clientId) throw new Error('No client id — reload to get a session cookie')
  await renumberFavorites(clientId, orderedItemIds)
  revalidatePath('/prices')
}

/** Re-auto: clear every pin → list returns to family + tier order. */
export async function reautoFavoritesAction(): Promise<void> {
  const clientId = await getClientId()
  if (!clientId) throw new Error('No client id — reload to get a session cookie')
  await reautoFavorites(clientId)
  revalidatePath('/prices')
}

export async function searchItemsAction(query: string): Promise<ItemSearchResult[]> {
  return searchItems(query)
}

export async function getItemPricesAction(itemId: string): Promise<LivePrice[]> {
  return getItemPrices(itemId)
}

export interface DailyVolumeRecord {
  city: string
  avg_sold: number
  avg_price: number
}

export async function getItemDailyVolumeAction(itemId: string): Promise<DailyVolumeRecord[]> {
  const { data, error } = await supabase
    .from('daily_volume')
    .select('city, avg_sold, avg_price')
    .eq('item_id', itemId.trim().toUpperCase())
  if (error) throw error
  return (data ?? []) as DailyVolumeRecord[]
}
