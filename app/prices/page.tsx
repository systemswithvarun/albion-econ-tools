import { listFavorites, type ItemSearchResult } from '@/lib/prices'
import { supabase } from '@/lib/supabase'
import { PriceCheckerClient } from './_components/price-checker-client'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ itemId?: string }>
}

export default async function PriceCheckerPage(props: PageProps) {
  const searchParams = await props.searchParams
  const initialItemId = searchParams.itemId?.trim().toUpperCase()

  let initialItem = null
  if (initialItemId) {
    const { data, error } = await supabase
      .from('items')
      .select('item_id, display_name, tier, enchant, category')
      .eq('item_id', initialItemId)
      .maybeSingle()

    if (!error && data) {
      initialItem = {
        item_id: data.item_id,
        display_name: data.display_name ?? data.item_id,
        tier: data.tier,
        enchant: data.enchant,
        category: data.category,
      }
    }
  }

  // Pre-load user's favorites on the server
  let initialFavorites: ItemSearchResult[] = []
  try {
    initialFavorites = await listFavorites()
  } catch (err) {
    console.error('Failed to load favorites on server:', err)
  }

  return (
    <PriceCheckerClient
      initialFavorites={initialFavorites}
      initialItem={initialItem}
    />
  )
}
