import { NextResponse } from 'next/server'
import { queryD1, executeD1 } from '@/lib/db'

// ─── Types returned by this route ─────────────────────────────────────────────

export interface ReadyItem {
  patent_number: string
  score: number
  caption_twitter: string | null
  caption_fbli: string | null
  diagram_urls: string | null    // raw JSON string from D1 — client parses
  image_overlay_text: string | null
  url_slug: string
  url_full: string
  approved_at: string | null
  title: string
  assignee_name: string | null
}

export interface PostedItem {
  id: number
  patent_number: string
  url_slug: string
  url_full: string
  posted_twitter: number         // 0 | 1
  posted_facebook: number
  posted_linkedin: number
  posted_at: string | null
  post_notes: string | null
  published_at: string
  caption_twitter: string | null
  caption_fbli: string | null
  title: string
  assignee_name: string | null
}

// ─── GET /api/admin/published ─────────────────────────────────────────────────
// Returns { ready: ReadyItem[], posted: PostedItem[] }

export async function GET() {
  try {
    const [ready, posted] = await Promise.all([
      // Pages live, not yet officially "published" (no published_content record)
      queryD1<ReadyItem>(`
        SELECT
          cq.patent_number, cq.score,
          cq.caption_twitter, cq.caption_fbli,
          cq.diagram_urls, cq.image_overlay_text,
          cq.url_slug, cq.url_full, cq.approved_at,
          p.title, p.assignee_name
        FROM content_queue cq
        JOIN patents p ON p.patent_number = cq.patent_number
        WHERE cq.status = 'approved'
        ORDER BY cq.approved_at DESC
        LIMIT 50
      `),

      // Published — has a published_content record with social tracking
      queryD1<PostedItem>(`
        SELECT
          pc.id, pc.patent_number, pc.url_slug,
          pc.posted_twitter, pc.posted_facebook, pc.posted_linkedin,
          pc.posted_at, pc.post_notes, pc.published_at,
          cq.caption_twitter, cq.caption_fbli, cq.url_full,
          p.title, p.assignee_name
        FROM published_content pc
        JOIN content_queue cq ON cq.patent_number = pc.patent_number
        JOIN patents p ON p.patent_number = pc.patent_number
        ORDER BY pc.published_at DESC
        LIMIT 100
      `),
    ])

    return NextResponse.json({ ready, posted })
  } catch (err) {
    console.error('GET /api/admin/published error:', err)
    return NextResponse.json({ error: 'Failed to fetch published items' }, { status: 500 })
  }
}

// ─── POST /api/admin/published ────────────────────────────────────────────────
// Body: { patent_number: string }
// Creates a published_content record and moves content_queue to status='published'.
// Idempotent: if already published, returns success without duplicating the record.

export async function POST(request: Request) {
  try {
    const { patent_number } = await request.json() as { patent_number?: string }

    if (!patent_number) {
      return NextResponse.json({ error: 'patent_number required' }, { status: 400 })
    }

    // Fetch the url_slug from content_queue (required for published_content)
    const rows = await queryD1<{ url_slug: string; status: string }>(
      `SELECT url_slug, status FROM content_queue WHERE patent_number = ? LIMIT 1`,
      [patent_number]
    )

    if (!rows.length) {
      return NextResponse.json({ error: 'Patent not found in content queue' }, { status: 404 })
    }

    const { url_slug, status } = rows[0]

    // Idempotency: if already published, don't create a duplicate record
    if (status === 'published') {
      return NextResponse.json({ success: true, message: 'Already published' })
    }

    if (status !== 'approved') {
      return NextResponse.json(
        { error: `Cannot publish — content status is '${status}' (must be 'approved')` },
        { status: 409 }
      )
    }

    // Create published_content record (published_at is set by DEFAULT CURRENT_TIMESTAMP)
    await executeD1(
      `INSERT INTO published_content (patent_number, url_slug) VALUES (?, ?)`,
      [patent_number, url_slug]
    )

    // Move content_queue to 'published'
    await executeD1(
      `UPDATE content_queue SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE patent_number = ?`,
      [patent_number]
    )

    return NextResponse.json({ success: true, patent_number })
  } catch (err) {
    console.error('POST /api/admin/published error:', err)
    return NextResponse.json({ error: 'Failed to publish patent' }, { status: 500 })
  }
}

// ─── PATCH /api/admin/published ───────────────────────────────────────────────
// Update social posting status or notes for a published patent.
//
// Body: { patent_number, posted_twitter?, posted_facebook?, posted_linkedin?, post_notes? }
// - Platform fields: 0 | 1
// - posted_at is set via COALESCE so it records the first time any platform is marked posted

const ALLOWED_NUMERIC = new Set(['posted_twitter', 'posted_facebook', 'posted_linkedin'])
const ALLOWED_TEXT = new Set(['post_notes'])

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>
    const { patent_number, ...updates } = body

    if (!patent_number || typeof patent_number !== 'string') {
      return NextResponse.json({ error: 'patent_number required' }, { status: 400 })
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const setClauses: string[] = []
    const params: unknown[] = []
    let anyPlatformBeingChecked = false

    for (const [field, value] of Object.entries(updates)) {
      if (ALLOWED_NUMERIC.has(field)) {
        if (value !== 0 && value !== 1) {
          return NextResponse.json(
            { error: `Field "${field}" must be 0 or 1` },
            { status: 400 }
          )
        }
        setClauses.push(`${field} = ?`)
        params.push(value)
        if (value === 1) anyPlatformBeingChecked = true
      } else if (ALLOWED_TEXT.has(field)) {
        if (typeof value !== 'string') {
          return NextResponse.json(
            { error: `Field "${field}" must be a string` },
            { status: 400 }
          )
        }
        setClauses.push(`${field} = ?`)
        params.push(value)
      } else {
        return NextResponse.json(
          { error: `Field "${field}" is not updatable` },
          { status: 400 }
        )
      }
    }

    // Set posted_at on first platform check — COALESCE preserves the original date
    if (anyPlatformBeingChecked) {
      setClauses.push(`posted_at = COALESCE(posted_at, CURRENT_TIMESTAMP)`)
    }

    params.push(patent_number)

    await executeD1(
      `UPDATE published_content SET ${setClauses.join(', ')} WHERE patent_number = ?`,
      params
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('PATCH /api/admin/published error:', err)
    return NextResponse.json({ error: 'Failed to update publishing status' }, { status: 500 })
  }
}
