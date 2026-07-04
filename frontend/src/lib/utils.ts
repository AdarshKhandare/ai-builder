import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind class names with conflict resolution.
 *
 * Used by every shadcn/ui primitive (e.g. `<Button className={cn(...)} />`).
 * `clsx` handles conditional / array / object inputs; `twMerge` resolves
 * conflicting Tailwind utilities so the last one wins.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
