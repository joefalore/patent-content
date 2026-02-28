'use client'

import { useState, useCallback } from 'react'
import { ExternalLink, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { ScoreBreakdown } from './ScoreBreakdown'
import { formatExpirationDate } from '@/lib/utils'
import type { ScoredPatent } from '@/types'

interface Props {
  patents: ScoredPatent[]
  onAction: () => void // refresh parent after approve/reject
}

interface BatchStats {
  fetched: number
  no_abstract: number
  no_diagrams: number
  google_blocked: boolean
  scored: number
  approved: number
  errors: number
}

function ScoreBadge({ score }: { score: number }) {
  const isHigh = score >= 8
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-bold ${
        isHigh
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-amber-100 text-amber-800'
      }`}
    >
      {score}/10{isHigh ? ' ✦' : ''}
    </span>
  )
}

function PatentCard({
  patent,
  selected,
  onSelect,
  onApprove,
  onReject,
  disabled,
}: {
  patent: ScoredPatent
  selected: boolean
  onSelect: (n: string) => void
  onApprove: (n: string) => void
  onReject: (n: string) => void
  disabled: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const googlePatentsUrl = `https://patents.google.com/patent/US${patent.patent_number}`

  return (
    <div
      className={`bg-white border rounded-lg p-4 transition-colors ${
        selected ? 'border-red-400 bg-red-50' : 'border-gray-200'
      }`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(patent.patent_number)}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500 shrink-0"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <ScoreBadge score={patent.score} />
                <span className="text-xs font-mono text-gray-400">US{patent.patent_number}</span>
              </div>
              <h3 className="mt-1 text-sm font-semibold text-gray-900 leading-snug">
                {patent.title}
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {patent.assignee_name ?? 'Unknown assignee'}
                {patent.cpc_section && <span className="ml-2 text-gray-400">CPC: {patent.cpc_section}</span>}
                {patent.calculated_expiration_date && (
                  <span className="ml-2 text-gray-400">
                    Expired: {formatExpirationDate(patent.calculated_expiration_date)}
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <a
                href={googlePatentsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-gray-600 transition-colors"
                title="View on Google Patents"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Plain English — the most important field */}
          {patent.plain_english && (
            <p className="mt-3 text-sm text-gray-800 bg-gray-50 border border-gray-100 rounded px-3 py-2 leading-relaxed italic">
              &ldquo;{patent.plain_english}&rdquo;
            </p>
          )}

          {/* Score breakdown */}
          <div className="mt-3">
            <ScoreBreakdown
              consumer={patent.consumer_relevance}
              relatability={patent.relatability}
              explainability={patent.explainability}
              visual={patent.visual_appeal}
            />
          </div>

          {/* Reasoning — collapsible */}
          {patent.reasoning && (
            <div className="mt-2">
              <button
                onClick={() => setExpanded((p) => !p)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Reasoning
              </button>
              {expanded && (
                <p className="mt-1 text-xs text-gray-500 leading-relaxed pl-4 border-l-2 border-gray-100">
                  {patent.reasoning}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => onApprove(patent.patent_number)}
              disabled={disabled}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Approve
            </button>
            <button
              onClick={() => onReject(patent.patent_number)}
              disabled={disabled}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-medium rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PatentReviewTab({ patents, onAction }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [runNowLoading, setRunNowLoading] = useState(false)
  const [runNowResult, setRunNowResult] = useState<BatchStats | string | null>(null)

  const highScore = patents.filter((p) => p.score >= 8)
  const reviewScore = patents.filter((p) => p.score === 7)

  const toggleSelect = useCallback((n: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(n) ? next.delete(n) : next.add(n)
      return next
    })
  }, [])

  const selectAll = () => setSelected(new Set(patents.map((p) => p.patent_number)))
  const clearAll = () => setSelected(new Set())

  async function doAction(action: 'approve' | 'reject', patentNumbers: string[]) {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/patents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, patent_numbers: patentNumbers }),
      })
      if (!res.ok) throw new Error('Action failed')
      setSelected(new Set())
      onAction()
    } catch (err) {
      alert(`Failed: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  async function runNow() {
    setRunNowLoading(true)
    setRunNowResult(null)
    try {
      const res = await fetch('/api/trigger-scorer', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setRunNowResult(data.error ?? 'Unknown error')
      } else {
        setRunNowResult(data.stats as BatchStats)
        onAction() // refresh stats
      }
    } catch {
      setRunNowResult('Failed to reach scorer')
    } finally {
      setRunNowLoading(false)
    }
  }

  if (patents.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-500 text-sm">No patents pending review.</p>
        <p className="text-gray-400 text-xs mt-1">
          Run the scorer to find high-scoring patents.
        </p>
        <button
          onClick={runNow}
          disabled={runNowLoading}
          className="mt-4 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {runNowLoading ? 'Running...' : 'Run Scorer Now'}
        </button>
        {runNowResult && (
          <RunNowResult result={runNowResult} />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {selected.size > 0 ? (
            <>
              <span className="text-sm text-gray-600">{selected.size} selected</span>
              <button
                onClick={() => doAction('approve', Array.from(selected))}
                disabled={loading}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                Approve {selected.size}
              </button>
              <button
                onClick={() => doAction('reject', Array.from(selected))}
                disabled={loading}
                className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-medium rounded hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Reject {selected.size}
              </button>
              <button onClick={clearAll} className="text-xs text-gray-400 hover:text-gray-600">
                Clear
              </button>
            </>
          ) : (
            <button onClick={selectAll} className="text-xs text-gray-400 hover:text-gray-600">
              Select all ({patents.length})
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={runNow}
            disabled={runNowLoading}
            className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {runNowLoading ? 'Running...' : 'Run Scorer Now'}
          </button>
        </div>
      </div>

      {runNowResult && <RunNowResult result={runNowResult} />}

      {/* 8+ section */}
      {highScore.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-2">
            Ready to Approve — Score 8+ ({highScore.length})
          </h2>
          <div className="space-y-3">
            {highScore.map((p) => (
              <PatentCard
                key={p.patent_number}
                patent={p}
                selected={selected.has(p.patent_number)}
                onSelect={toggleSelect}
                onApprove={(n) => doAction('approve', [n])}
                onReject={(n) => doAction('reject', [n])}
                disabled={loading}
              />
            ))}
          </div>
        </section>
      )}

      {/* 7s section */}
      {reviewScore.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2 mt-6">
            Review — Potential Gems (Score 7) ({reviewScore.length})
          </h2>
          <p className="text-xs text-gray-400 mb-3">
            These scored 7. May contain hidden gems — review before rejecting.
          </p>
          <div className="space-y-3">
            {reviewScore.map((p) => (
              <PatentCard
                key={p.patent_number}
                patent={p}
                selected={selected.has(p.patent_number)}
                onSelect={toggleSelect}
                onApprove={(n) => doAction('approve', [n])}
                onReject={(n) => doAction('reject', [n])}
                disabled={loading}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function RunNowResult({ result }: { result: BatchStats | string }) {
  if (typeof result === 'string') {
    return (
      <div className="bg-red-50 border border-red-200 rounded px-4 py-2 text-sm text-red-700">
        {result}
      </div>
    )
  }

  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded px-4 py-2 text-sm text-emerald-800">
      <span className="font-medium">Batch complete:</span>{' '}
      {result.fetched} fetched, {result.no_abstract} no abstract,{' '}
      {result.no_diagrams} no diagrams
      {result.google_blocked && ' (Google blocked — diagram checks paused)'},
      {result.scored} scored, {result.approved} approved (8+), {result.errors} errors
    </div>
  )
}
