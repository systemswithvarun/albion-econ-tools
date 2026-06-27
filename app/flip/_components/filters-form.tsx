'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { saveFiltersAction } from '../actions'
import { SubmitButton } from './submit-button'
import type { FlipSettings } from '@/lib/flip-data'

export function FiltersForm({ settings }: { settings: FlipSettings }) {
  const fields: { name: string; label: string; value: number; step?: string }[] = [
    { name: 'disposableCash', label: 'Disposable cash', value: settings.disposableCash },
    { name: 'dailyTarget', label: 'Daily profit target', value: settings.dailyTarget },
    { name: 'minMarginPct', label: 'Min margin %', value: settings.minMarginPct, step: '0.1' },
    { name: 'maxStalenessHr', label: 'Max staleness (hr)', value: settings.maxStalenessHr },
    { name: 'minDailyVolume', label: 'Min daily volume', value: settings.minDailyVolume },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Filters</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          key={`${settings.disposableCash}-${settings.dailyTarget}-${settings.minMarginPct}-${settings.maxStalenessHr}-${settings.minDailyVolume}`}
          action={saveFiltersAction}
          className="space-y-3"
        >
          {fields.map((f) => (
            <div key={f.name} className="space-y-1">
              <Label htmlFor={f.name}>{f.label}</Label>
              <Input id={f.name} name={f.name} type="number" step={f.step ?? '1'} defaultValue={f.value} />
            </div>
          ))}
          <SubmitButton className="w-full" pendingText="Applying…">Apply filters</SubmitButton>
        </form>
      </CardContent>
    </Card>
  )
}
