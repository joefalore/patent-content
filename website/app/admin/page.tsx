'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { PatentReviewTab } from '@/components/admin/PatentReviewTab'
import { ContentReviewTab } from '@/components/admin/ContentReviewTab'
import { PublishedTab } from '@/components/admin/PublishedTab'
import type { ScoredPatent } from '@/types'
import type { PipelineStats } from '@/app/api/admin/stats/route'

type Tab = 'patents' | 'content' | 'published' | 'prompts'

const TABS: { id: Tab; label: string }[] = [
  { id: 'patents', label: 'Patent Review' },
  { id: 'content', label: 'Content Review' },
  { id: 'published', label: 'Published' },
  { id: 'prompts', label: 'Prompts' },
]

function StatPill({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center px-4 py-2">
      <span className={`text-xl font-bold ${accent ? 'text-red-600' : 'text-gray-900'}`}>
        {value.toLocaleString()}
      </span>
      <span className="text-xs text-gray-500 mt-0.5">{label}</span>
    </div>
  )
}

export default function AdminPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('patents')
  const [patents, setPatents] = useState<ScoredPatent[]>([])
  const [stats, setStats] = useState<PipelineStats | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [patentsRes, statsRes] = await Promise.all([
        fetch('/api/admin/patents'),
        fetch('/api/admin/stats'),
      ])

      if (patentsRes.status === 401 || statsRes.status === 401) {
        router.push('/login')
        return
      }

      const [patentsData, statsData] = await Promise.all([
        patentsRes.json(),
        statsRes.json(),
      ])

      setPatents(patentsData.patents ?? [])
      setStats(statsData)
    } catch (err) {
      console.error('Failed to load admin data:', err)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-widest text-red-600 uppercase">
              InventionGenie
            </span>
            <span className="text-gray-300">|</span>
            <span className="text-sm text-gray-500">Admin</span>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Stats strip */}
      {stats && (
        <div className="bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-center divide-x divide-gray-100 overflow-x-auto">
              <StatPill label="Scored" value={stats.total_scored} />
              <StatPill label="Score 8+" value={stats.total_high_score} />
              <StatPill label="Pending Review" value={stats.total_reviewable} accent />
              <StatPill label="Approved" value={stats.total_approved} />
              <StatPill label="Content Ready" value={stats.content_pending} />
              <StatPill label="Ready to Post" value={stats.content_approved} accent />
              <StatPill label="Published" value={stats.content_published} />
            </div>
          </div>
        </div>
      )}

      {/* Tab nav */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <nav className="flex gap-0 -mb-px">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-red-600 text-red-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {t.label}
                {t.id === 'patents' && patents.length > 0 && (
                  <span className="ml-1.5 bg-red-100 text-red-700 text-xs px-1.5 py-0.5 rounded-full">
                    {patents.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading...</div>
        ) : (
          <>
            {tab === 'patents' && (
              <PatentReviewTab patents={patents} onAction={fetchData} />
            )}

            {tab === 'content' && (
              <ContentReviewTab onAction={fetchData} />
            )}

            {tab === 'published' && (
              <PublishedTab onAction={fetchData} />
            )}

            {tab === 'prompts' && (
              <PromptsPlaceholder />
            )}
          </>
        )}
      </main>
    </div>
  )
}

function PromptsPlaceholder() {
  return (
    <div className="py-16 text-center">
      <p className="text-gray-400 text-sm font-medium">Prompts</p>
      <p className="text-gray-300 text-xs mt-1">
        Edit scoring and content generation prompts without redeploying workers.
        Coming in a later stage.
      </p>
    </div>
  )
}
