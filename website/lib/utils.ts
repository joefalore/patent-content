import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Generate a deterministic URL slug from patent number and title.
 * CRITICAL: Same inputs always produce same output — slug never changes once set.
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'method', 'system', 'apparatus', 'device',
  'using', 'based', 'type', 'having', 'used', 'from', 'into', 'that',
  'this', 'its', 'via', 'per', 'new', 'one', 'two',
])

export function generateSlug(patentNumber: string, title: string): string {
  const keywords = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
    .slice(0, 5)
    .join('-')

  // Normalize patent number: strip leading zeros, lowercase
  const normalizedNumber = patentNumber.toLowerCase().replace(/^0+/, '')

  return `${normalizedNumber}-${keywords}`
}

export function generatePatentURL(slug: string): string {
  const domain = process.env.NEXT_PUBLIC_DOMAIN || 'inventiongenie.com'
  return `https://${domain}/patent/${slug}`
}

/**
 * Format an ISO date string as "Month YYYY" for display.
 * Example: "2025-03-22" -> "March 2025"
 */
export function formatExpirationDate(dateString: string | null): string {
  if (!dateString) return 'Unknown'
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
