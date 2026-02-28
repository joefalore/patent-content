import { NextResponse } from 'next/server'
import { queryD1, executeD1 } from '@/lib/db'
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
// Returns all content_queue items with status='pending', joined with patents
export async function GET() {
  try {
    const items = await queryD1<ContentQueueItemWithPatent>(`
      SELECT
        cq.id, cq.patent_number, cq.score,
        cq.diagram_urls, cq.caption_twitter, cq.caption_fbli,
        cq.web_summary, cq.web_insights, cq.image_overlay_text, cq.social_image_url,
        cq.url_slug, cq.url_full,
        cq.scrape_status, cq.scrape_attempts, cq.scrape_error,
        cq.status, cq.created_at,
        p.title, p.assignee_name, p.calculated_expiration_date
      FROM content_queue cq
      JOIN patents p ON p.patent_number = cq.patent_number
      WHERE cq.status = 'pending'
      ORDER BY cq.created_at DESC
      LIMIT 50
    `)

    return NextResponse.json({ items })
  } catch (err) {
    console.error('GET /api/admin/content error:', err)
    return NextResponse.json({ error: 'Failed to fetch content items' }, { status: 500 })
  }
}

// PATCH /api/admin/content
// Inline field edit. Body: { patent_number, field, value }
export async function PATCH(request: Request) {
  try {
    const { patent_number, field, value } = await request.json() as {
      patent_number: string
      field: string
      value: string
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

    // field is safe — validated against whitelist above
    await executeD1(
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
// Body: { action: 'approve' | 'reject', patent_number: string }
export async function POST(request: Request) {
  try {
    const { action, patent_number } = await request.json() as {
      action: 'approve' | 'reject'
      patent_number: string
    }

    if (!patent_number) {
      return NextResponse.json({ error: 'patent_number required' }, { status: 400 })
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
    }

    if (action === 'approve') {
      await executeD1(
        `UPDATE content_queue SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE patent_number = ?`,
        [patent_number]
      )
    } else {
      await executeD1(
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
