/**
 * /patent/[slug] — Public patent page
 *
 * Server Component. Renders from content_queue (status='approved' or 'published')
 * joined with patents and patent_scores.
 *
 * ISR: revalidates every hour so admin edits propagate without a full redeploy.
 * React.cache() deduplicates the D1 fetch between generateMetadata and the page.
 */

import { cache } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { queryD1, queryAppD1 } from '@/lib/db'
import { formatExpirationDate } from '@/lib/utils'

// ─── ISR ──────────────────────────────────────────────────────────────────────

export const revalidate = 3600 // 1 hour

// ─── CPC descriptions ─────────────────────────────────────────────────────────

const CPC_DESCRIPTIONS: Record<string, string> = {
  A: 'Human Necessities',
  B: 'Performing Operations & Transporting',
  C: 'Chemistry & Metallurgy',
  D: 'Textiles & Paper',
  E: 'Fixed Constructions',
  F: 'Mechanical Engineering',
  G: 'Physics',
  H: 'Electricity',
  Y: 'General Tagging',
}

// ─── Data types ───────────────────────────────────────────────────────────────

interface PatentPageData {
  // content_queue
  patent_number: string
  score: number
  diagram_urls: string[]         // parsed from JSON string
  caption_twitter: string | null
  caption_fbli: string | null
  web_summary: string | null
  web_insights: string | null
  image_overlay_text: string | null
  social_image_url: string | null
  url_slug: string
  url_full: string
  status: string
  approved_at: string | null
  // patents (read-only)
  title: string
  assignee_name: string | null
  cpc_section: string | null
  filing_date: string | null
  grant_date: string | null
  calculated_expiration_date: string | null
  pta_days: number | null
  pte_154_days: number | null
  pte_156_days: number | null
  td_exists: number | null
  mf_status: string | null
  // patent_scores
  abstract: string | null
  plain_english: string | null
}

// Raw row type — diagram_urls is still a JSON string from D1
type RawPatentPageRow = Omit<PatentPageData, 'diagram_urls'> & {
  diagram_urls: string | null
}

// ─── Data fetch (two-step: inventiongenie-db then patent-tracker-db) ──────────

// Raw row from inventiongenie-db — content_queue joined with patent_scores
type AppRow = Omit<RawPatentPageRow,
  'title' | 'assignee_name' | 'cpc_section' | 'filing_date' | 'grant_date' |
  'calculated_expiration_date' | 'pta_days' | 'pte_154_days' | 'pte_156_days' |
  'td_exists' | 'mf_status'
>

const fetchPatentPage = cache(async (slug: string): Promise<PatentPageData | null> => {
  try {
    // Step 1: content_queue + patent_scores from inventiongenie-db
    const appRows = await queryAppD1<AppRow>(
      `SELECT
        cq.patent_number, cq.score,
        cq.diagram_urls, cq.caption_twitter, cq.caption_fbli,
        cq.web_summary, cq.web_insights, cq.image_overlay_text, cq.social_image_url,
        cq.url_slug, cq.url_full, cq.status, cq.approved_at,
        ps.abstract, ps.plain_english
      FROM content_queue cq
      JOIN patent_scores ps ON ps.patent_number = cq.patent_number
      WHERE cq.url_slug = ? AND cq.status IN ('approved', 'published')
      LIMIT 1`,
      [slug]
    )

    if (!appRows.length) return null
    const appRow = appRows[0]

    // Step 2: patent metadata from patent-tracker-db
    const patentRows = await queryD1<{
      title: string; assignee_name: string | null; cpc_section: string | null
      filing_date: string | null; grant_date: string | null
      calculated_expiration_date: string | null
      pta_days: number | null; pte_154_days: number | null; pte_156_days: number | null
      td_exists: number | null; mf_status: string | null
    }>(
      `SELECT title, assignee_name, cpc_section,
        filing_date, grant_date, calculated_expiration_date,
        pta_days, pte_154_days, pte_156_days, td_exists, mf_status
      FROM patents WHERE patent_number = ?`,
      [appRow.patent_number]
    )

    if (!patentRows.length) return null
    const patentRow = patentRows[0]

    let diagram_urls: string[] = []
    try {
      diagram_urls = appRow.diagram_urls ? (JSON.parse(appRow.diagram_urls) as string[]) : []
    } catch {
      diagram_urls = []
    }

    return { ...appRow, ...patentRow, diagram_urls } as PatentPageData
  } catch (err) {
    console.error('fetchPatentPage D1 error:', err)
    return null
  }
})

// ─── SEO metadata ─────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await fetchPatentPage(slug)

  if (!data) {
    return { title: 'Patent Not Found' }
  }

  const pageTitle = `${data.title} — Expired Patent`
  // Prefer web_summary for description; fall back to plain_english; cap at 160 chars
  const description = (data.web_summary ?? data.plain_english ?? '').substring(0, 160).trimEnd()
  // For OG image: prefer stored social image, fall back to first diagram, or nothing
  const ogImageUrl = data.social_image_url ?? data.diagram_urls[0] ?? null

  return {
    title: pageTitle,
    description,
    openGraph: {
      title: pageTitle,
      description,
      type: 'article',
      url: data.url_full,
      ...(ogImageUrl
        ? { images: [{ url: ogImageUrl, alt: data.title }] }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: pageTitle,
      description,
      ...(ogImageUrl ? { images: [ogImageUrl] } : {}),
    },
    alternates: {
      canonical: data.url_full,
    },
  }
}

// ─── Page component ───────────────────────────────────────────────────────────

export default async function PatentPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const data = await fetchPatentPage(slug)

  if (!data) notFound()

  // Destructure diagrams: first is the hero, rest displayed below insights
  const [heroDiagram, ...extraDiagrams] = data.diagram_urls

  // Patent term adjustments
  const ptaDays = (data.pta_days ?? 0) > 0 ? data.pta_days! : null
  const pte154Days = (data.pte_154_days ?? 0) > 0 ? data.pte_154_days! : null
  const pte156Days = (data.pte_156_days ?? 0) > 0 ? data.pte_156_days! : null
  const hasTermInfo =
    ptaDays !== null ||
    pte154Days !== null ||
    pte156Days !== null ||
    data.td_exists === 1 ||
    data.mf_status === 'lapsed'

  const cpcDescription = data.cpc_section ? CPC_DESCRIPTIONS[data.cpc_section] : null

  // JSON-LD structured data — Article schema is well-understood by Google
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: data.title,
    description: data.web_summary ?? data.plain_english ?? '',
    ...(heroDiagram ? { image: [heroDiagram] } : {}),
    ...(data.approved_at ? { datePublished: data.approved_at } : {}),
    author: {
      '@type': 'Organization',
      name: 'InventionGenie',
      url: 'https://inventiongenie.com',
    },
    publisher: {
      '@type': 'Organization',
      name: 'InventionGenie',
      url: 'https://inventiongenie.com',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': data.url_full,
    },
  }

  // Split web_insights into paragraphs on double newline
  const insightParagraphs = data.web_insights
    ? data.web_insights.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
    : []

  return (
    <>
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="min-h-screen bg-white">

        {/* ── Brand header ───────────────────────────────────────────── */}
        <header className="sticky top-0 z-10 bg-white border-b border-gray-100">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 h-12 flex items-center gap-2">
            <Link
              href="/"
              className="text-xs font-bold tracking-widest text-red-600 uppercase hover:opacity-75 transition-opacity"
            >
              InventionGenie
            </Link>
            <span className="text-gray-300 hidden sm:inline">·</span>
            <span className="text-xs text-gray-400 hidden sm:inline">Expired Patents Explained</span>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-6 pb-20">

          {/* ── Hero diagram ────────────────────────────────────────── */}
          {heroDiagram && (
            <div className="mt-6 rounded-xl overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center"
              style={{ minHeight: '320px', maxHeight: '68vh' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroDiagram}
                alt={`Patent diagram for ${data.title}`}
                fetchPriority="high"
                loading="eager"
                className="max-w-full max-h-full object-contain p-6"
              />
            </div>
          )}

          {/* ── Patent intro ─────────────────────────────────────────── */}
          <div className="mt-8">
            {/* "Patent Expired" label + expiration date */}
            <div className="flex items-center gap-2.5 mb-3 flex-wrap">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 tracking-wide uppercase">
                Patent Expired
              </span>
              {data.calculated_expiration_date && (
                <span className="text-sm text-gray-400">
                  {formatExpirationDate(data.calculated_expiration_date)}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight">
              {data.title}
            </h1>

            {/* Quick info line */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                US{data.patent_number}
              </span>
              {data.assignee_name && (
                <span className="text-sm text-gray-500">{data.assignee_name}</span>
              )}
              {cpcDescription && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-xs text-gray-400">{cpcDescription}</span>
                </>
              )}
            </div>
          </div>

          {/* ── Two-column layout: content + sidebar ─────────────────── */}
          <div className="mt-10 lg:grid lg:grid-cols-3 lg:gap-12 lg:items-start">

            {/* Content column (2/3 width on large screens) */}
            <div className="lg:col-span-2 space-y-10">

              {/* plain_english — one-sentence hook from the scoring step */}
              {data.plain_english && (
                <blockquote className="border-l-4 border-red-200 pl-5 py-1">
                  <p className="text-base sm:text-lg text-gray-700 italic leading-relaxed">
                    &ldquo;{data.plain_english}&rdquo;
                  </p>
                </blockquote>
              )}

              {/* web_summary — 2-3 sentence plain-English summary */}
              {data.web_summary && (
                <section aria-labelledby="summary-heading">
                  <h2
                    id="summary-heading"
                    className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-3"
                  >
                    What Is This Patent?
                  </h2>
                  <p className="text-gray-800 leading-relaxed text-[15px]">
                    {data.web_summary}
                  </p>
                </section>
              )}

              {/* web_insights — 200-300 word deep-dive */}
              {insightParagraphs.length > 0 && (
                <section aria-labelledby="insights-heading">
                  <h2
                    id="insights-heading"
                    className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-3"
                  >
                    The Details
                  </h2>
                  <div className="space-y-4">
                    {insightParagraphs.map((para, i) => (
                      <p key={i} className="text-gray-700 leading-relaxed text-[15px]">
                        {para}
                      </p>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Sidebar: patent details (1/3 width on large screens, appears after content on mobile) */}
            <aside className="mt-10 lg:mt-0 lg:sticky lg:top-16">
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-5">
                <h2 className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-4">
                  Patent Details
                </h2>

                <dl className="space-y-3.5">
                  <div>
                    <dt className="text-xs text-gray-400 mb-0.5">Patent Number</dt>
                    <dd className="text-sm font-mono font-semibold text-gray-800">
                      US{data.patent_number}
                    </dd>
                  </div>

                  {data.assignee_name && (
                    <div>
                      <dt className="text-xs text-gray-400 mb-0.5">Assignee</dt>
                      <dd className="text-sm text-gray-800">{data.assignee_name}</dd>
                    </div>
                  )}

                  {data.filing_date && (
                    <div>
                      <dt className="text-xs text-gray-400 mb-0.5">Filed</dt>
                      <dd className="text-sm text-gray-800">
                        {formatExpirationDate(data.filing_date)}
                      </dd>
                    </div>
                  )}

                  {data.grant_date && (
                    <div>
                      <dt className="text-xs text-gray-400 mb-0.5">Granted</dt>
                      <dd className="text-sm text-gray-800">
                        {formatExpirationDate(data.grant_date)}
                      </dd>
                    </div>
                  )}

                  {data.calculated_expiration_date && (
                    <div>
                      <dt className="text-xs text-gray-400 mb-0.5">Expired</dt>
                      <dd className="text-sm font-semibold text-red-600">
                        {formatExpirationDate(data.calculated_expiration_date)}
                      </dd>
                    </div>
                  )}

                  {cpcDescription && (
                    <div>
                      <dt className="text-xs text-gray-400 mb-0.5">Category</dt>
                      <dd className="text-sm text-gray-800">{cpcDescription}</dd>
                    </div>
                  )}

                  {/* Term adjustments — useful for the patent attorney affiliate audience */}
                  {hasTermInfo && (
                    <div className="pt-3 mt-1 border-t border-gray-200 space-y-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                        Term History
                      </p>

                      {ptaDays !== null && (
                        <div>
                          <dt className="text-xs text-gray-400 mb-0.5">PTA Extension</dt>
                          <dd className="text-sm text-gray-800">
                            +{ptaDays.toLocaleString()} days
                          </dd>
                        </div>
                      )}

                      {pte154Days !== null && (
                        <div>
                          <dt className="text-xs text-gray-400 mb-0.5">PTE (§154)</dt>
                          <dd className="text-sm text-gray-800">
                            +{pte154Days.toLocaleString()} days
                          </dd>
                        </div>
                      )}

                      {pte156Days !== null && (
                        <div>
                          <dt className="text-xs text-gray-400 mb-0.5">PTE (§156)</dt>
                          <dd className="text-sm text-gray-800">
                            +{pte156Days.toLocaleString()} days
                          </dd>
                        </div>
                      )}

                      {data.td_exists === 1 && (
                        <div>
                          <dt className="text-xs text-gray-400 mb-0.5">Terminal Disclaimer</dt>
                          <dd className="text-sm text-gray-800">Applies</dd>
                        </div>
                      )}

                      {data.mf_status === 'lapsed' && (
                        <div>
                          <dt className="text-xs text-gray-400 mb-0.5">Maintenance Fee</dt>
                          <dd className="text-sm font-medium text-amber-700">Lapsed early</dd>
                        </div>
                      )}
                    </div>
                  )}
                </dl>

                {/* Google Patents link */}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <a
                    href={`https://patents.google.com/patent/US${data.patent_number}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    View on Google Patents →
                  </a>
                </div>
              </div>
            </aside>
          </div>

          {/* ── Additional diagrams ─────────────────────────────────── */}
          {extraDiagrams.length > 0 && (
            <section className="mt-14" aria-label="Patent diagrams">
              <h2 className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-4">
                More Diagrams
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {extraDiagrams.map((url, i) => (
                  <div
                    key={url}
                    className="rounded-xl bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center"
                    style={{ minHeight: '220px' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Patent diagram ${i + 2} for ${data.title}`}
                      loading="lazy"
                      className="max-w-full max-h-full object-contain p-4"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── PatentSunset CTA ────────────────────────────────────── */}
          <section className="mt-14" aria-label="Related tool">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-6">
              <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">
                Related Tool
              </p>
              <h3 className="text-sm font-semibold text-gray-900 leading-snug">
                Want the full expiration timeline for US{data.patent_number}?
              </h3>
              <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                PatentSunset.com tracks expiration status, term adjustments, and maintenance fee
                history for millions of US patents — all based on official USPTO records. Free to use.
              </p>
              <a
                href="https://patentsunset.com"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
              >
                Explore on PatentSunset →
              </a>
            </div>
          </section>

        </main>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <footer className="mt-20 border-t border-gray-100 bg-gray-50">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <Link
                href="/"
                className="text-xs font-bold tracking-widest text-red-600 uppercase hover:opacity-75 transition-opacity"
              >
                InventionGenie
              </Link>
              <p className="text-xs text-gray-400 text-center">
                Educational content about expired US patents.{' '}
                Information sourced from USPTO public records.
              </p>
              <a
                href="https://patentsunset.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                patentsunset.com →
              </a>
            </div>
          </div>
        </footer>

      </div>
    </>
  )
}
