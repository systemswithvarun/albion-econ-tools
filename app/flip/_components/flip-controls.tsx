'use client'

import { useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { setPremiumAction, rebuildWatchlistAction } from '../actions'

export function FlipControls({ premium }: { premium: boolean }) {
  const [pending, start] = useTransition()
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <Switch
          id="premium"
          checked={premium}
          onCheckedChange={(v) => start(() => setPremiumAction(v))}
          disabled={pending}
        />
        <Label htmlFor="premium">Premium</Label>
      </div>
      <Button variant="outline" disabled={pending} onClick={() => start(() => rebuildWatchlistAction())}>
        Rebuild watchlist
      </Button>
    </div>
  )
}
