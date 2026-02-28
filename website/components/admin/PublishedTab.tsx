'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ExternalLink, Copy, Check, Download,
  Twitter, Facebook, Linkedin, ImageIcon, RefreshCw,
} from 'lucide-react'
import { Toasts } from './Toasts'
import { useToast } from '@/hooks/useToast'
import type { ToastType } from '@/hooks/useToast'
import type { ReadyItem, PostedItem } from '@/app/api/admin/published/route'

interface Props {
  onAction: () => void // refresh parent stats
}

// ─── Shared utilities ──────────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors shrink-0"
    >
      {copied
        ? <><Check className="h-3 w-3 text-emerald-500" /> Copied</>
        : <><Copy className="h-3 w-3" /> {label}</>
      }
    </button>
  )
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
      {score}/10
    </span>
  )
}

// ─── Image generation (same pattern as ContentReviewTab) ──────────────────────

function ImageGenerator({
  diagramUrls,
  overlayText,
  patentNumber,
}: {
  diagramUrls: string[]
  overlayText: string | null
  patentNumber: string
}) {
  const [selected, setSelected] = useState<string | null>(diagramUrls[0] ?? null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    return () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }
  }, [imageUrl])

  async function generate() {
    if (!selected) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diagramUrl: selected,
          overlayText: overlayText ?? 'Patent Expired',
          patent_number: patentNumber,
        }),
      })
      if (!res.ok) throw new Error(`Image generation failed (${res.status})`)
      const blob = await res.blob()
      if (imageUrl) URL.revokeObjectURL(imageUrl)
      setImageUrl(URL.createObjectURL(blob))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
      >
        <ImageIcon className="h-3 w-3" /> Social image
      </button>
    )
  }

  return (
    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Social Image</p>

      {/* Diagram thumbnails */}
      <div className="flex gap-2 flex-wrap">
        {diagramUrls.map((url, i) => (
          <button
            key={url}
            onClick={() => { setSelected(url); setImageUrl(null) }}
            className={`rounded border-2 overflow-hidden transition-all ${
              selected === url ? 'border-red-500 ring-1 ring-red-200' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Diagram ${i + 1}`} className="w-24 h-20 object-contain bg-white" loading="lazy" />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={generate}
          disabled={loading || !selected}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 text-white text-xs font-medium rounded hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
          {loading ? 'Generating...' : imageUrl ? 'Regenerate' : 'Generate'}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {imageUrl && (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Social image preview" className="w-28 border border-gray-200 rounded shadow-sm" />
          <a
            href={imageUrl}
            download={`US${patentNumber}-social.png`}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium mt-1"
          >
            <Download className="h-3 w-3" /> Download PNG
          </a>
        </div>
      )}
    </div>
  )
}

// ─── Ready to Post card ────────────────────────────────────────────────────────

function ReadyCard({
  item,
  onPublished,
  onToast,
}: {
  item: ReadyItem & { diagram_urls_parsed: string[] }
  onPublished: (patentNumber: string) => void
  onToast: (message: string, type: ToastType) => void
}) {
  const [publishing, setPublishing] = useState(false)

  async function handlePublish() {
    setPublishing(true)
    try {
      const res = await fetch('/api/admin/published', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patent_number: item.patent_number }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to publish')
      }
      onToast('Marked as published', 'success')
      onPublished(item.patent_number)
    } catch (err) {
      onToast((err as Error).message, 'error')
      setPublishing(false)
    }
  }

  const approvedDate = item.approved_at
    ? new Date(item.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <ScoreBadge score={item.score} />
            <span className="text-xs font-mono text-gray-400">US{item.patent_number}</span>
            {approvedDate && (
              <span className="text-xs text-gray-400">· Approved {approvedDate}</span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-gray-900 leading-snug">{item.title}</h3>
          {item.assignee_name && (
            <p className="text-xs text-gray-500 mt-0.5">{item.assignee_name}</p>
          )}
        </div>
      </div>

      {/* Page URL */}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Page URL</p>
        <div className="flex items-center gap-2">
          <code className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded px-2 py-1 flex-1 truncate">
            {item.url_full}
          </code>
          <CopyButton text={item.url_full} />
          <a
            href={item.url_full}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            title="Open page"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* Twitter caption */}
      {item.caption_twitter && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <Twitter className="h-3 w-3" /> Twitter
            </p>
            <CopyButton text={item.caption_twitter} />
          </div>
          <p className="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded px-3 py-2 leading-relaxed">
            {item.caption_twitter}
          </p>
          <p className="text-xs text-gray-400 text-right">{item.caption_twitter.length}/240</p>
        </div>
      )}

      {/* Facebook / LinkedIn caption */}
      {item.caption_fbli && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <Facebook className="h-3 w-3" /><Linkedin className="h-3 w-3" /> Facebook / LinkedIn
            </p>
            <CopyButton text={item.caption_fbli} />
          </div>
          <p className="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded px-3 py-2 leading-relaxed">
            {item.caption_fbli}
          </p>
        </div>
      )}

      {/* Social image generator (collapsed by default) */}
      {item.diagram_urls_parsed.length > 0 && (
        <ImageGenerator
          diagramUrls={item.diagram_urls_parsed}
          overlayText={item.image_overlay_text}
          patentNumber={item.patent_number}
        />
      )}

      {/* Publish action */}
      <div className="pt-2 border-t border-gray-100">
        <button
          onClick={handlePublish}
          disabled={publishing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {publishing ? (
            <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Publishing...</>
          ) : (
            <>Mark as Published</>
          )}
        </button>
        <p className="text-xs text-gray-400 mt-1.5">
          Creates a tracking record and moves this item to &ldquo;Posted&rdquo;.
        </p>
      </div>
    </div>
  )
}

// ─── Posted card ───────────────────────────────────────────────────────────────

function PostedCard({
  item: initialItem,
  onToast,
}: {
  item: PostedItem
  onToast: (message: string, type: ToastType) => void
}) {
  const [item, setItem] = useState(initialItem)
  const [saving, setSaving] = useState(false)
  const [notesDraft, setNotesDraft] = useState(initialItem.post_notes ?? '')
  const [editingNotes, setEditingNotes] = useState(false)
  const notesRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editingNotes) notesRef.current?.focus()
  }, [editingNotes])

  async function patch(updates: Record<string, number | string>) {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/published', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patent_number: item.patent_number, ...updates }),
      })
      if (!res.ok) throw new Error('Update failed')
    } catch (err) {
      onToast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function togglePlatform(
    field: 'posted_twitter' | 'posted_facebook' | 'posted_linkedin'
  ) {
    const newVal = item[field] === 1 ? 0 : 1
    setItem((prev) => ({ ...prev, [field]: newVal }))
    await patch({ [field]: newVal })
  }

  async function saveNotes() {
    setEditingNotes(false)
    if (notesDraft === (item.post_notes ?? '')) return
    setItem((prev) => ({ ...prev, post_notes: notesDraft }))
    await patch({ post_notes: notesDraft })
  }

  const publishedDate = new Date(item.published_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })

  const postedDate = item.posted_at
    ? new Date(item.posted_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      })
    : null

  type PlatformConfig = {
    field: 'posted_twitter' | 'posted_facebook' | 'posted_linkedin'
    label: string
    icon: React.ReactNode
  }

  const platforms: PlatformConfig[] = [
    { field: 'posted_twitter', label: 'Twitter', icon: <Twitter className="h-3.5 w-3.5" /> },
    { field: 'posted_facebook', label: 'Facebook', icon: <Facebook className="h-3.5 w-3.5" /> },
    { field: 'posted_linkedin', label: 'LinkedIn', icon: <Linkedin className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 leading-snug">{item.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
            <span className="font-mono">US{item.patent_number}</span>
            <span>·</span>
            <span>Published {publishedDate}</span>
            {postedDate && <><span>·</span><span>First posted {postedDate}</span></>}
          </div>
        </div>
        {saving && (
          <RefreshCw className="h-3.5 w-3.5 text-gray-300 animate-spin shrink-0 mt-1" />
        )}
      </div>

      {/* Page URL */}
      <div className="flex items-center gap-2">
        <a
          href={item.url_full}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:text-blue-700 truncate flex-1 transition-colors"
        >
          {item.url_full}
        </a>
        <CopyButton text={item.url_full} />
        <a
          href={item.url_full}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-gray-600 shrink-0 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Platform toggles */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Posted to</p>
        <div className="flex flex-wrap gap-2">
          {platforms.map(({ field, label, icon }) => {
            const isPosted = item[field] === 1
            return (
              <button
                key={field}
                onClick={() => togglePlatform(field)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  isPosted
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                {icon}
                {label}
                {isPosted && <Check className="h-3 w-3" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Captions (copy only — no editing in Posted view) */}
      {(item.caption_twitter || item.caption_fbli) && (
        <div className="space-y-2 pt-1 border-t border-gray-100">
          {item.caption_twitter && (
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-gray-500 flex-1 line-clamp-2">{item.caption_twitter}</p>
              <CopyButton text={item.caption_twitter} label="Twitter" />
            </div>
          )}
          {item.caption_fbli && (
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-gray-500 flex-1 line-clamp-2">{item.caption_fbli}</p>
              <CopyButton text={item.caption_fbli} label="FB/LI" />
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      <div className="space-y-1 pt-1 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Notes</p>
        {editingNotes ? (
          <textarea
            ref={notesRef}
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={saveNotes}
            onKeyDown={(e) => e.key === 'Escape' && saveNotes()}
            rows={2}
            placeholder="Add notes about this post..."
            className="w-full text-xs text-gray-700 bg-white border border-blue-300 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        ) : (
          <p
            onClick={() => setEditingNotes(true)}
            className="text-xs text-gray-500 cursor-text min-h-[24px] hover:text-gray-700 transition-colors"
          >
            {item.post_notes || <span className="italic text-gray-300">Click to add notes...</span>}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Main tab ──────────────────────────────────────────────────────────────────

export function PublishedTab({ onAction }: Props) {
  const [ready, setReady] = useState<(ReadyItem & { diagram_urls_parsed: string[] })[]>([])
  const [posted, setPosted] = useState<PostedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { toasts, addToast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/published')
      if (!res.ok) throw new Error('Failed to load published data')
      const data = await res.json() as { ready: ReadyItem[]; posted: PostedItem[] }

      // Parse diagram_urls JSON string for each ready item
      const readyParsed = (data.ready ?? []).map((item) => ({
        ...item,
        diagram_urls_parsed: (() => {
          try {
            return item.diagram_urls ? (JSON.parse(item.diagram_urls) as string[]) : []
          } catch {
            return []
          }
        })(),
      }))

      setReady(readyParsed)
      setPosted(data.posted ?? [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function handlePublished(patentNumber: string) {
    // Optimistically move item from ready to posted list
    // (actual PostedItem data will load on next refresh)
    setReady((prev) => prev.filter((i) => i.patent_number !== patentNumber))
    onAction()
    // Refresh to get the new PostedItem with full data
    setTimeout(fetchData, 500)
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-400">Loading...</div>
  }

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={fetchData} className="mt-3 text-xs text-gray-400 hover:text-gray-600">Retry</button>
      </div>
    )
  }

  if (ready.length === 0 && posted.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-500 text-sm">No published content yet.</p>
        <p className="text-gray-400 text-xs mt-1">
          Approve content in the Content Review tab to see pages here.
        </p>
      </div>
    )
  }

  return (
    <>
    <div className="space-y-10">

      {/* ── Ready to Post ──────────────────────────────────────────────── */}
      {ready.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xs font-bold tracking-widest text-emerald-700 uppercase">
                Ready to Post — {ready.length} page{ready.length !== 1 ? 's' : ''} live
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Copy the captions, post to social, then mark as Published.
              </p>
            </div>
            <button
              onClick={fetchData}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>

          <div className="space-y-4">
            {ready.map((item) => (
              <ReadyCard
                key={item.patent_number}
                item={item}
                onPublished={handlePublished}
                onToast={addToast}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Posted ─────────────────────────────────────────────────────── */}
      {posted.length > 0 && (
        <section>
          <h2 className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-4">
            Posted — {posted.length} total
          </h2>

          <div className="space-y-4">
            {posted.map((item) => (
              <PostedCard key={item.id} item={item} onToast={addToast} />
            ))}
          </div>
        </section>
      )}

    </div>
    <Toasts toasts={toasts} />
    </>
  )
}
