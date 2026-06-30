'use server'

import { revalidatePath } from 'next/cache'
import { addFavorite, removeFavorite, searchItems, getItemPrices, type ItemSearchResult, type LivePrice } from '@/lib/prices'
import { supabase } from '@/lib/supabase'

import { submitGuildPriceAction as baseSubmitGuildPriceAction } from '@/app/flip/actions'

export async function submitGuildPriceAction(formData: FormData): Promise<void> {
  return baseSubmitGuildPriceAction(formData)
}

export async function addFavoriteAction(itemId: string): Promise<void> {
  await addFavorite(itemId)
  revalidatePath('/prices')
}

export async function removeFavoriteAction(itemId: string): Promise<void> {
  await removeFavorite(itemId)
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
