'use server'

import { revalidatePath } from 'next/cache'
import { addFavorite, removeFavorite } from '@/lib/prices'

// Reuse the existing guild price submission so the price-checker UI uses one path.
export { submitGuildPriceAction } from '@/app/flip/actions'

export async function addFavoriteAction(itemId: string): Promise<void> {
  await addFavorite(itemId)
  revalidatePath('/prices')
}

export async function removeFavoriteAction(itemId: string): Promise<void> {
  await removeFavorite(itemId)
  revalidatePath('/prices')
}
