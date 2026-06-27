'use client'

import { useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { submitGuildPriceAction } from '../actions'
import { SubmitButton } from './submit-button'

export function ManualEntryForm({ cities }: { cities: string[] }) {
  const formRef = useRef<HTMLFormElement>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Guild price entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={async (fd) => {
            await submitGuildPriceAction(fd)
            formRef.current?.reset()
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="itemId">Item ID</Label>
            <Input id="itemId" name="itemId" placeholder="T4_BAG" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="city">City</Label>
            <Select name="city" defaultValue={cities[0]}>
              <SelectTrigger id="city"><SelectValue /></SelectTrigger>
              <SelectContent>
                {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="quality">Quality</Label>
              <Input id="quality" name="quality" type="number" min={1} max={5} defaultValue={1} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="side">Side</Label>
              <Select name="side" defaultValue="sell_order">
                <SelectTrigger id="side"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sell_order">Sell order (buy from)</SelectItem>
                  <SelectItem value="buy_order">Buy order (sell into)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="price">Price</Label>
            <Input id="price" name="price" type="number" min={1} required />
          </div>
          <SubmitButton className="w-full" pendingText="Submitting…">Submit price</SubmitButton>
        </form>
      </CardContent>
    </Card>
  )
}
