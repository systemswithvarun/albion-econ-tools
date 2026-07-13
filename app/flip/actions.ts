'use server'

import { revalidatePath } from 'next/cache'
import { updateFlipSettings, addGuildPrice, rebuildWatchlist } from '@/lib/flip-data'
import { getClientId } from '@/lib/client-id'

export async function saveFiltersAction(formData: FormData): Promise<void> {
  const clientId = await getClientId()
  if (!clientId) throw new Error('No client id — reload to get a session cookie')
  const num = (k: string) => {
    const v = formData.get(k)
    return v === null || v === '' ? undefined : Number(v)
  }
  await updateFlipSettings(clientId, {
    disposableCash: num('disposableCash'),
    dailyTarget: num('dailyTarget'),
    minMarginPct: num('minMarginPct'),
    maxStalenessHr: num('maxStalenessHr'),
    minDailyVolume: num('minDailyVolume'),
  })
  revalidatePath('/flip')
}

export async function setPremiumAction(premium: boolean): Promise<void> {
  const clientId = await getClientId()
  if (!clientId) throw new Error('No client id — reload to get a session cookie')
  await updateFlipSettings(clientId, { premium })
  revalidatePath('/flip')
}

export async function rebuildWatchlistAction(): Promise<void> {
  await rebuildWatchlist()
  revalidatePath('/flip')
  revalidatePath('/')
}

export async function submitGuildPriceAction(formData: FormData): Promise<void> {
  await addGuildPrice({
    itemId: String(formData.get('itemId') ?? '').trim().toUpperCase(),
    city: String(formData.get('city') ?? '').trim(),
    quality: Number(formData.get('quality') ?? 1),
    side: formData.get('side') === 'buy_order' ? 'buy_order' : 'sell_order',
    price: Number(formData.get('price') ?? 0),
  })
  revalidatePath('/flip')
}
