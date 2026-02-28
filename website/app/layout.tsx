import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'InventionGenie — Expired Patents Explained',
    template: '%s | InventionGenie',
  },
  description:
    'Discover the most fascinating expired patents. Inventions that shaped everyday life, now free for anyone to use.',
  metadataBase: new URL('https://inventiongenie.com'),
  openGraph: {
    siteName: 'InventionGenie',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@InventionGenie',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
