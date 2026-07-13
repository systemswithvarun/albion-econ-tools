'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

/**
 * Submit button wired to the parent <form>'s pending state via useFormStatus.
 * Gives every form an explicit loading state (disabled + pending label) so the
 * operator gets immediate feedback without waiting on a full revalidation.
 */
export function SubmitButton({
  children,
  pendingText,
  className,
  variant,
}: {
  children: React.ReactNode
  pendingText: string
  className?: string
  variant?: React.ComponentProps<typeof Button>['variant']
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending} className={className}>
      {pending ? pendingText : children}
    </Button>
  )
}
