'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  CheckCircle, XCircle, RefreshCw, Copy, Check,
  Download, ImageIcon, Pencil, ExternalLink,
} from 'lucide-react'
import { Toasts } from './Toasts'
import { useToast } from '@/hooks/useToast'
import type { ToastType } from '@/hooks/useToast'
import type { ContentQueueItemWithPatent } from '@/types'
import { formatExpirationDate } from '@/lib/utils'

// Diagram URLs come from D1 as a JSON string — parse before use
type ContentItem = Omit<ContentQueueItemWithPatent, 'diagram_urls'> & {
  diagram_urls: string[]
}

interface Props {
  onAction: () => void // refresh parent stats
}

// ─── Utility sub-components ────────────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for HTTP environments
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors ${className ?? ''}`}
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function ScrapeBadge({ status, attempts }: { status: string; attempts: number }) {
  if (status === 'scraped') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-emerald-50 text-emerald-700">
        Scraped
      </span>
    )
  }
  if (status === 'failed' || status === 'blocked') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-red-50 text-red-600">
        {status === 'blocked' ? 'Blocked' : 'Scrape failed'} (attempt {attempts})
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-50 text-amber-700">
      Pending scrape
    </span>
  )
}

// ─── Editable field ────────────────────────────────────────────────────────────

function EditableField({
  label,
  value,
  field,
  patentNumber,
  multiline,
  maxChars,
  onSaved,
}: {
  label: string
  value: string | null
  field: string
  patentNumber: string
  multiline?: boolean
  maxChars?: number
  onSaved: (field: string, value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function handleSave() {
    const trimmed = draft.trim()
    if (trimmed === (value ?? '').trim()) {
      setEditing(false)
      return
    }
    setSaveState('saving')
    try {
      const res = await fetch('/api/admin/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patent_number: patentNumber, field, value: trimmed }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaveState('saved')
      onSaved(field, trimmed)
      setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 3000)
    }
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setDraft(value ?? '')
      setEditing(false)
    }
    if (!multiline && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }

  const displayValue = value || ''
  const charCount = displayValue.length

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <div className="flex items-center gap-2">
          {maxChars && !editing && (
            <span className={`text-xs ${charCount > maxChars * 0.9 ? 'text-amber-600' : 'text-gray-400'}`}>
              {charCount}/{maxChars}
            </span>
          )}
          {saveState === 'saving' && <span className="text-xs text-gray-400">Saving...</span>}
          {saveState === 'saved' && <span className="text-xs text-emerald-600">Saved</span>}
          {saveState === 'error' && <span className="text-xs text-red-600">Save failed</span>}
          {!editing && displayValue && <CopyButton text={displayValue} />}
          <button
            onClick={() => setEditing(true)}
            className="text-gray-300 hover:text-gray-500 transition-colors"
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-1">
          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              rows={multiline ? (field === 'web_insights' ? 8 : 4) : 2}
              className="w-full text-sm text-gray-800 bg-white border border-blue-300 rounded px-3 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="w-full text-sm text-gray-800 bg-white border border-blue-300 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          )}
          {maxChars && (
            <span className={`text-xs ${draft.length > maxChars ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
              {draft.length}/{maxChars}
            </span>
          )}
        </div>
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="text-sm text-gray-800 bg-gray-50 border border-gray-100 rounded px-3 py-2 leading-relaxed cursor-text hover:border-gray-200 transition-colors min-h-[36px] whitespace-pre-wrap"
        >
          {displayValue || <span className="text-gray-400 italic">Empty — click to add</span>}
        </div>
      )}
    </div>
  )
}

// ─── Diagram picker ────────────────────────────────────────────────────────────

function DiagramPicker({
  diagrams,
  selected,
  onSelect,
}: {
  diagrams: string[]
  selected: string | null
  onSelect: (url: string) => void
}) {
  if (diagrams.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        No diagrams scraped — content can still be approved without a social image.
      </p>
    )
  }

  return (
    <div className="flex gap-3 flex-wrap">
      {diagrams.map((url, i) => (
        <button
          key={url}
          onClick={() => onSelect(url)}
          className={`relative rounded-lg overflow-hidden border-2 transition-all ${
            selected === url
              ? 'border-red-500 shadow-md ring-2 ring-red-200'
              : 'border-gray-200 hover:border-gray-300'
          }`}
          title={`Diagram ${i + 1}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Diagram ${i + 1}`}
            className="w-36 h-28 object-contain bg-white"
            loading="lazy"
          />
          {selected === url && (
            <div className="absolute inset-0 flex items-start justify-end p-1">
              <span className="bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs">
                ✓
              </span>
            </div>
          )}
        </button>
      ))}
    </div>
  )
}

// ─── Content card ──────────────────────────────────────────────────────────────

function ContentCard({
  item: initialItem,
  onApproved,
  onRejected,
  onToast,
}: {
  item: ContentItem
  onApproved: (patentNumber: string) => void
  onRejected: (patentNumber: string) => void
  onToast: (message: string, type: ToastType) => void
}) {
  const [item, setItem] = useState(initialItem)
  const [selectedDiagram, setSelectedDiagram] = useState<string | null>(
    initialItem.diagram_urls[0] ?? null
  )
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [generatingImage, setGeneratingImage] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl])

  function handleFieldSaved(field: string, value: string) {
    setItem((prev) => ({ ...prev, [field]: value }))
  }

  async function handleGenerateImage() {
    if (!selectedDiagram) return
    setGeneratingImage(true)
    setImageError(null)

    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diagramUrl: selectedDiagram,
          overlayText: item.image_overlay_text ?? 'Patent Expired',
        }),
      })

      if (!res.ok) {
        throw new Error(`Image generation failed (${res.status})`)
      }

      const blob = await res.blob()
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
      setImagePreviewUrl(URL.createObjectURL(blob))
    } catch (err) {
      setImageError((err as Error).message)
    } finally {
      setGeneratingImage(false)
    }
  }

  async function handleAction(action: 'approve' | 'reject') {
    setActionLoading(true)
    try {
      const res = await fetch('/api/admin/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, patent_number: item.patent_number }),
      })
      if (!res.ok) throw new Error('Action failed')

      if (action === 'approve') {
        onToast('Content approved — page is now live', 'success')
        onApproved(item.patent_number)
      } else {
        onToast('Content rejected', 'success')
        onRejected(item.patent_number)
      }
    } catch (err) {
      onToast(`Failed: ${(err as Error).message}`, 'error')
      setActionLoading(false)
    }
  }

  async function handleRegenerate() {
    setShowRegenerateConfirm(false)
    setRegenerating(true)
    try {
      const res = await fetch('/api/trigger-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patent_number: item.patent_number }),
      })
      const data = await res.json() as { success?: boolean; error?: string; message?: string }
      if (!res.ok || !data.success) {
        onToast(data.error ?? data.message ?? 'Regeneration failed', 'error')
      } else {
        onToast('Regeneration queued — refresh in ~30s to see updated content', 'success')
      }
    } catch {
      onToast('Failed to reach generator worker', 'error')
    } finally {
      setRegenerating(false)
    }
  }

  const googlePatentsUrl = `https://patents.google.com/patent/US${item.patent_number}`

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-sm font-bold bg-emerald-100 text-emerald-800">
              {item.score}/10
            </span>
            <span className="text-xs font-mono text-gray-400">US{item.patent_number}</span>
            <ScrapeBadge status={item.scrape_status} attempts={item.scrape_attempts} />
          </div>
          <h3 className="mt-1 text-sm font-semibold text-gray-900 leading-snug">{item.title}</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {item.assignee_name ?? 'Unknown assignee'}
            {item.calculated_expiration_date && (
              <span className="ml-2 text-gray-400">
                Expired: {formatExpirationDate(item.calculated_expiration_date)}
              </span>
            )}
          </p>
        </div>
        <a
          href={googlePatentsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-gray-300 hover:text-gray-500 transition-colors"
          title="View on Google Patents"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <div className="px-5 py-4 space-y-6">
        {/* ── Diagram picker ──────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Select Diagram for Social Image
          </p>
          <DiagramPicker
            diagrams={item.diagram_urls}
            selected={selectedDiagram}
            onSelect={(url) => {
              setSelectedDiagram(url)
              setImagePreviewUrl(null) // reset preview when changing selection
              setImageError(null)
            }}
          />
        </div>

        {/* ── Social image generation ─────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Social Image (4:5)
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={handleGenerateImage}
              disabled={generatingImage || !selectedDiagram}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 text-white text-xs font-medium rounded hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {generatingImage ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5" />
              )}
              {generatingImage ? 'Generating...' : imagePreviewUrl ? 'Re-generate Image' : 'Generate Image'}
            </button>

            {!selectedDiagram && (
              <span className="text-xs text-amber-600">Select a diagram first</span>
            )}
          </div>

          {imageError && (
            <p className="text-xs text-red-600">{imageError}</p>
          )}

          {imagePreviewUrl && (
            <div className="flex items-start gap-4">
              {/* Preview at reduced size */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt="Generated social image preview"
                className="w-40 border border-gray-200 rounded shadow-sm"
              />
              <div className="flex flex-col gap-2 pt-1">
                <p className="text-xs text-gray-500">1080 × 1350 (4:5)</p>
                <a
                  href={imagePreviewUrl}
                  download={`US${item.patent_number}-social.png`}
                  className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  <Download className="h-3 w-3" />
                  Download PNG
                </a>
              </div>
            </div>
          )}
        </div>

        {/* ── Editable content fields ─────────────────────────────────── */}
        <div className="space-y-5">
          <EditableField
            label="Twitter Caption"
            value={item.caption_twitter}
            field="caption_twitter"
            patentNumber={item.patent_number}
            maxChars={240}
            onSaved={handleFieldSaved}
          />

          <EditableField
            label="Facebook / LinkedIn Caption"
            value={item.caption_fbli}
            field="caption_fbli"
            patentNumber={item.patent_number}
            multiline
            onSaved={handleFieldSaved}
          />

          <EditableField
            label="Image Overlay Text"
            value={item.image_overlay_text}
            field="image_overlay_text"
            patentNumber={item.patent_number}
            onSaved={handleFieldSaved}
          />

          <EditableField
            label="Website Summary"
            value={item.web_summary}
            field="web_summary"
            patentNumber={item.patent_number}
            multiline
            onSaved={handleFieldSaved}
          />

          <EditableField
            label="Website Insights"
            value={item.web_insights}
            field="web_insights"
            patentNumber={item.patent_number}
            multiline
            onSaved={handleFieldSaved}
          />
        </div>

        {/* ── Page URL ────────────────────────────────────────────────── */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Page URL</span>
            <CopyButton text={item.url_full} />
          </div>
          <p className="text-xs font-mono text-gray-600 bg-gray-50 border border-gray-100 rounded px-3 py-2 break-all">
            {item.url_full}
          </p>
        </div>
      </div>

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAction('approve')}
            disabled={actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Approve
          </button>
          <button
            onClick={() => handleAction('reject')}
            disabled={actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-medium rounded hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </button>
        </div>

        {/* Regenerate — with confirm step */}
        <div className="flex items-center gap-2">
          {showRegenerateConfirm ? (
            <>
              <span className="text-xs text-amber-700 font-medium">Overwrites all edits. Confirm?</span>
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="text-xs text-red-600 font-medium hover:text-red-700 disabled:opacity-50"
              >
                {regenerating ? 'Regenerating...' : 'Yes, regenerate'}
              </button>
              <button
                onClick={() => setShowRegenerateConfirm(false)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowRegenerateConfirm(true)}
              disabled={actionLoading || regenerating}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Regenerate content
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main tab ──────────────────────────────────────────────────────────────────

export function ContentReviewTab({ onAction }: Props) {
  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { toasts, addToast } = useToast()

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/content')
      if (!res.ok) throw new Error('Failed to load content items')
      const data = await res.json() as { items: ContentQueueItemWithPatent[] }

      // Parse diagram_urls JSON string → string[] for each item
      const parsed: ContentItem[] = (data.items ?? []).map((item) => ({
        ...item,
        diagram_urls: (() => {
          try {
            return item.diagram_urls ? JSON.parse(item.diagram_urls as unknown as string) : []
          } catch {
            return []
          }
        })(),
      }))

      setItems(parsed)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  function handleApproved(patentNumber: string) {
    setItems((prev) => prev.filter((i) => i.patent_number !== patentNumber))
    onAction()
  }

  function handleRejected(patentNumber: string) {
    setItems((prev) => prev.filter((i) => i.patent_number !== patentNumber))
    onAction()
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-400">Loading content queue...</div>
  }

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={fetchItems} className="mt-3 text-xs text-gray-400 hover:text-gray-600">
          Retry
        </button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-500 text-sm">No content pending review.</p>
        <p className="text-gray-400 text-xs mt-1">
          Approve patents in the Patent Review tab to queue content generation.
        </p>
        <button
          onClick={fetchItems}
          className="mt-4 flex items-center gap-1.5 mx-auto text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>
    )
  }

  return (
    <>
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {items.length} item{items.length !== 1 ? 's' : ''} pending review
        </p>
        <button
          onClick={fetchItems}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* Cards */}
      <div className="space-y-6">
        {items.map((item) => (
          <ContentCard
            key={item.patent_number}
            item={item}
            onApproved={handleApproved}
            onRejected={handleRejected}
            onToast={addToast}
          />
        ))}
      </div>
    </div>
    <Toasts toasts={toasts} />
    </>
  )
}
