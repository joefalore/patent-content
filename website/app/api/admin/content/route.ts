import { NextResponse } from 'next/server'
import { queryD1, queryAppD1, executeAppD1 } from '@/lib/db'
import type { ContentQueueItemWithPatent } from '@/types'

// Fields the admin is allowed to edit inline — whitelist prevents SQL injection
const EDITABLE_FIELDS = new Set([
  'caption_twitter',
  'caption_fbli',
  'web_summary',
  'web_insights',
  'image_overlay_text',
])

// GET /api/admin/content
export async function GET() {
  try {
    // 1. Query content_queue from inventiongenie-db
    const items = await queryAppD1<{
      id: number; patent_number: string; score: number
      diagram_urls: string | null; caption_twitter: string | null; caption_fbli: string | null
      web_summary: string | null; web_insights: string | null
      image_overlay_text: string | null; social_image_url: string | null
      url_slug: string; url_full: string
      scrape_status: string; scrape_attempts: number; scrape_error: string | null
      status: string; created_at: string
    }>(`
      SELECT id, patent_number, score,
        diagram_urls, caption_twitter, caption_fbli,
        web_summary, web_insights, image_overlay_text, social_image_url,
        url_slug, url_full,
        scrape_status, scrape_attempts, scrape_error,
        status, created_at
      FROM content_queue
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 50
    `)

    if (items.length === 0) return NextResponse.json({ items: [] })

    // 2. Fetch patent metadata from patent-tracker-db
    const numbers = items.map(i => i.patent_number)
    const placeholders = numbers.map(() => '?').join(', ')
    const patentRows = await queryD1<{
      patent_number: string; title: string; assignee_name: string | null
      calculated_expiration_date: string | null; filing_date: string | null; grant_date: string | null
    }>(
      `SELECT patent_number, title, assignee_name, calculated_expiration_date, filing_date, grant_date
       FROM patents WHERE patent_number IN (${placeholders})`,
      numbers
    )

    const patentMap = new Map(patentRows.map(p => [p.patent_number, p]))

    // 3. Merge — cast scrape_status/status to narrow union types (D1 returns string)
    const merged: ContentQueueItemWithPatent[] = items.map(i => ({
      ...i,
      scrape_status: i.scrape_status as ContentQueueItemWithPatent['scrape_status'],
      status: i.status as ContentQueueItemWithPatent['status'],
      approved_at: null,
      published_at: null,
      research_summary: null,
      research_insights: null,
      title: patentMap.get(i.patent_number)?.title ?? '',
      assignee_name: patentMap.get(i.patent_number)?.assignee_name ?? null,
      calculated_expiration_date: patentMap.get(i.patent_number)?.calculated_expiration_date ?? null,
      filing_date: patentMap.get(i.patent_number)?.filing_date ?? null,
      grant_date: patentMap.get(i.patent_number)?.grant_date ?? null,
    }))

    return NextResponse.json({ items: merged })
  } catch (err) {
    console.error('GET /api/admin/content error:', err)
    return NextResponse.json({ error: 'Failed to fetch content items' }, { status: 500 })
  }
}

// PATCH /api/admin/content
export async function PATCH(request: Request) {
  try {
    const { patent_number, field, value } = await request.json() as {
      patent_number: string; field: string; value: string
    }

    if (!patent_number || !field) {
      return NextResponse.json({ error: 'patent_number and field required' }, { status: 400 })
    }

    if (!EDITABLE_FIELDS.has(field)) {
      return NextResponse.json({ error: `Field "${field}" is not editable` }, { status: 400 })
    }

    if (field === 'caption_twitter' && typeof value === 'string' && value.length > 240) {
      return NextResponse.json({ error: 'Twitter caption must be 240 characters or less' }, { status: 400 })
    }

    await executeAppD1(
      `UPDATE content_queue SET ${field} = ? WHERE patent_number = ? AND status = 'pending'`,
      [value, patent_number]
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('PATCH /api/admin/content error:', err)
    return NextResponse.json({ error: 'Failed to save field' }, { status: 500 })
  }
}

// POST /api/admin/content
export async function POST(request: Request) {
  try {
    const { action, patent_number } = await request.json() as {
      action: 'approve' | 'reject'; patent_number: string
    }

    if (!patent_number) {
      return NextResponse.json({ error: 'patent_number required' }, { status: 400 })
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
    }

    if (action === 'approve') {
      await executeAppD1(
        `UPDATE content_queue SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE patent_number = ?`,
        [patent_number]
      )
    } else {
      await executeAppD1(
        `UPDATE content_queue SET status = 'rejected' WHERE patent_number = ?`,
        [patent_number]
      )
    }

    return NextResponse.json({ success: true, action, patent_number })
  } catch (err) {
    console.error('POST /api/admin/content error:', err)
    return NextResponse.json({ error: 'Action failed' }, { status: 500 })
  }
}
