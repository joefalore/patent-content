import { NextResponse } from 'next/server'
import { queryD1, queryAppD1, executeAppD1 } from '@/lib/db'

export interface ReadyItem {
  patent_number: string
  score: number
  caption_twitter: string | null
  caption_fbli: string | null
  diagram_urls: string | null
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
  posted_twitter: number
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

// GET /api/admin/published
export async function GET() {
  try {
    const [readyRows, postedRows] = await Promise.all([
      queryAppD1<{
        patent_number: string; score: number
        caption_twitter: string | null; caption_fbli: string | null
        diagram_urls: string | null; image_overlay_text: string | null
        url_slug: string; url_full: string; approved_at: string | null
      }>(`
        SELECT patent_number, score, caption_twitter, caption_fbli,
          diagram_urls, image_overlay_text, url_slug, url_full, approved_at
        FROM content_queue
        WHERE status = 'approved'
        ORDER BY approved_at DESC
        LIMIT 50
      `),

      queryAppD1<{
        id: number; patent_number: string; url_slug: string
        posted_twitter: number; posted_facebook: number; posted_linkedin: number
        posted_at: string | null; post_notes: string | null; published_at: string
      }>(`
        SELECT pc.id, pc.patent_number, pc.url_slug,
          pc.posted_twitter, pc.posted_facebook, pc.posted_linkedin,
          pc.posted_at, pc.post_notes, pc.published_at
        FROM published_content pc
        ORDER BY pc.published_at DESC
        LIMIT 100
      `),
    ])

    // Fetch patent metadata + content_queue data for posted items
    const allNumbers = [
      ...readyRows.map(r => r.patent_number),
      ...postedRows.map(r => r.patent_number),
    ]
    const uniqueNumbers = [...new Set(allNumbers)]

    if (uniqueNumbers.length === 0) {
      return NextResponse.json({ ready: [], posted: [] })
    }

    const placeholders = uniqueNumbers.map(() => '?').join(', ')

    const [patentRows, contentRows] = await Promise.all([
      queryD1<{ patent_number: string; title: string; assignee_name: string | null }>(
        `SELECT patent_number, title, assignee_name FROM patents WHERE patent_number IN (${placeholders})`,
        uniqueNumbers
      ),
      queryAppD1<{ patent_number: string; url_full: string; caption_twitter: string | null; caption_fbli: string | null }>(
        `SELECT patent_number, url_full, caption_twitter, caption_fbli FROM content_queue WHERE patent_number IN (${placeholders})`,
        uniqueNumbers
      ),
    ])

    const patentMap = new Map(patentRows.map(p => [p.patent_number, p]))
    const contentMap = new Map(contentRows.map(c => [c.patent_number, c]))

    const ready: ReadyItem[] = readyRows.map(r => ({
      ...r,
      title: patentMap.get(r.patent_number)?.title ?? '',
      assignee_name: patentMap.get(r.patent_number)?.assignee_name ?? null,
    }))

    const posted: PostedItem[] = postedRows.map(r => ({
      ...r,
      url_full: contentMap.get(r.patent_number)?.url_full ?? '',
      caption_twitter: contentMap.get(r.patent_number)?.caption_twitter ?? null,
      caption_fbli: contentMap.get(r.patent_number)?.caption_fbli ?? null,
      title: patentMap.get(r.patent_number)?.title ?? '',
      assignee_name: patentMap.get(r.patent_number)?.assignee_name ?? null,
    }))

    return NextResponse.json({ ready, posted })
  } catch (err) {
    console.error('GET /api/admin/published error:', err)
    return NextResponse.json({ error: 'Failed to fetch published items' }, { status: 500 })
  }
}

// POST /api/admin/published
export async function POST(request: Request) {
  try {
    const { patent_number } = await request.json() as { patent_number?: string }

    if (!patent_number) {
      return NextResponse.json({ error: 'patent_number required' }, { status: 400 })
    }

    const rows = await queryAppD1<{ url_slug: string; status: string }>(
      `SELECT url_slug, status FROM content_queue WHERE patent_number = ? LIMIT 1`,
      [patent_number]
    )

    if (!rows.length) {
      return NextResponse.json({ error: 'Patent not found in content queue' }, { status: 404 })
    }

    const { url_slug, status } = rows[0]

    if (status === 'published') {
      return NextResponse.json({ success: true, message: 'Already published' })
    }

    if (status !== 'approved') {
      return NextResponse.json(
        { error: `Cannot publish — content status is '${status}' (must be 'approved')` },
        { status: 409 }
      )
    }

    await executeAppD1(
      `INSERT INTO published_content (patent_number, url_slug) VALUES (?, ?)`,
      [patent_number, url_slug]
    )

    await executeAppD1(
      `UPDATE content_queue SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE patent_number = ?`,
      [patent_number]
    )

    return NextResponse.json({ success: true, patent_number })
  } catch (err) {
    console.error('POST /api/admin/published error:', err)
    return NextResponse.json({ error: 'Failed to publish patent' }, { status: 500 })
  }
}

// PATCH /api/admin/published
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
          return NextResponse.json({ error: `Field "${field}" must be 0 or 1` }, { status: 400 })
        }
        setClauses.push(`${field} = ?`)
        params.push(value)
        if (value === 1) anyPlatformBeingChecked = true
      } else if (ALLOWED_TEXT.has(field)) {
        if (typeof value !== 'string') {
          return NextResponse.json({ error: `Field "${field}" must be a string` }, { status: 400 })
        }
        setClauses.push(`${field} = ?`)
        params.push(value)
      } else {
        return NextResponse.json({ error: `Field "${field}" is not updatable` }, { status: 400 })
      }
    }

    if (anyPlatformBeingChecked) {
      setClauses.push(`posted_at = COALESCE(posted_at, CURRENT_TIMESTAMP)`)
    }

    params.push(patent_number)

    await executeAppD1(
      `UPDATE published_content SET ${setClauses.join(', ')} WHERE patent_number = ?`,
      params
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('PATCH /api/admin/published error:', err)
    return NextResponse.json({ error: 'Failed to update publishing status' }, { status: 500 })
  }
}
