'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Manual "Fetch live prices" trigger. POSTs the manual route (same runPriceFetch as
 *  cron), then refreshes the page so flipper rows visibly update. The long duration text
 *  is load-bearing: a silent ~100s spinner reads as hung. */
export function FetchPricesButton() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function onClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/fetch-prices/manual', { method: 'POST' })
      const data = await res.json()

      if (data?.skipped) {
        const mins = data.last_at
          ? Math.max(0, Math.round((Date.now() - new Date(data.last_at).getTime()) / 60000))
          : 0
        toast.info(`Last pull ${mins}m ago — prices are still fresh.`)
      } else if (data?.ok) {
        const secs = Math.round((data.elapsed_ms ?? 0) / 1000)
        toast.success(`${(data.items_fetched ?? 0).toLocaleString()} items priced in ${secs}s`)
        router.refresh() // re-query flipper rows so the page visibly updates
      } else {
        toast.error(data?.error ?? 'Fetch failed')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button onClick={onClick} disabled={loading} variant="outline">
      {loading ? (
        <>
          <Loader2 className="animate-spin" />
          Pulling all cities + BM + Brecilien — ~90–120s, keep this tab open
        </>
      ) : (
        'Fetch live prices'
      )}
    </Button>
  )
}
