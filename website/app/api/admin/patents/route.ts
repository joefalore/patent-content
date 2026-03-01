import { NextResponse } from 'next/server'
import { queryD1, queryAppD1, executeAppD1 } from '@/lib/db'
import type { ScoredPatent } from '@/types'

// Fire content generation for each approved patent — no await (best-effort)
function triggerGenerator(patentNumbers: string[]) {
  const url = process.env.GENERATOR_WORKER_URL
  const secret = process.env.GENERATOR_WORKER_SECRET

  if (!url || url.includes('YOURSUBDOMAIN')) return

  for (const patent_number of patentNumbers) {
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-secret': secret ?? '',
      },
      body: JSON.stringify({ patent_number }),
    }).catch(err => console.error(`Generator trigger failed for ${patent_number}:`, err))
  }
}

// GET /api/admin/patents
// Returns all scored patents with score >= 7, not yet approved or rejected
export async function GET() {
  try {
    // 1. Query patent_scores from inventiongenie-db
    const scores = await queryAppD1<{
      id: number; patent_number: string; score: number
      consumer_relevance: number | null; relatability: number | null
      explainability: number | null; visual_appeal: number | null
      abstract: string | null; plain_english: string | null; reasoning: string | null
      has_diagrams: number; scored_at: string
      approved_for_content: number; approved_at: string | null; rejected: number
    }>(`
      SELECT id, patent_number, score,
        consumer_relevance, relatability, explainability, visual_appeal,
        abstract, plain_english, reasoning, has_diagrams,
        scored_at, approved_for_content, approved_at, rejected
      FROM patent_scores
      WHERE score >= 7
        AND approved_for_content = 0
        AND (rejected IS NULL OR rejected = 0)
      ORDER BY score DESC, scored_at DESC
      LIMIT 200
    `)

    if (scores.length === 0) {
      return NextResponse.json({ patents: [] })
    }

    // 2. Fetch patent metadata from patent-tracker-db
    // Batch into chunks of 99 — D1 enforces a 100 bound-parameter limit per query
    const numbers = scores.map(s => s.patent_number)
    const patentRows: Array<{
      patent_number: string; title: string; assignee_name: string | null
      cpc_section: string | null; calculated_expiration_date: string | null
      filing_date: string | null; grant_date: string | null
    }> = []
    for (let i = 0; i < numbers.length; i += 99) {
      const chunk = numbers.slice(i, i + 99)
      const placeholders = chunk.map(() => '?').join(', ')
      const rows = await queryD1<{
        patent_number: string; title: string; assignee_name: string | null
        cpc_section: string | null; calculated_expiration_date: string | null
        filing_date: string | null; grant_date: string | null
      }>(
        `SELECT patent_number, title, assignee_name, cpc_section,
                calculated_expiration_date, filing_date, grant_date
         FROM patents WHERE patent_number IN (${placeholders})`,
        chunk
      )
      patentRows.push(...rows)
    }

    const patentMap = new Map(patentRows.map(p => [p.patent_number, p]))

    // 3. Merge
    const patents: ScoredPatent[] = scores.map(s => ({
      ...s,
      title: patentMap.get(s.patent_number)?.title ?? '',
      assignee_name: patentMap.get(s.patent_number)?.assignee_name ?? null,
      cpc_section: patentMap.get(s.patent_number)?.cpc_section ?? null,
      calculated_expiration_date: patentMap.get(s.patent_number)?.calculated_expiration_date ?? null,
      filing_date: patentMap.get(s.patent_number)?.filing_date ?? null,
      grant_date: patentMap.get(s.patent_number)?.grant_date ?? null,
    }))

    return NextResponse.json({ patents })
  } catch (err) {
    console.error('GET /api/admin/patents error:', err)
    return NextResponse.json({ error: 'Failed to fetch patents' }, { status: 500 })
  }
}

// POST /api/admin/patents
// Body: { action: 'approve' | 'reject', patent_numbers: string[] }
export async function POST(request: Request) {
  try {
    const { action, patent_numbers } = await request.json() as {
      action: 'approve' | 'reject'
      patent_numbers: string[]
    }

    if (!Array.isArray(patent_numbers) || patent_numbers.length === 0) {
      return NextResponse.json({ error: 'patent_numbers array required' }, { status: 400 })
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
    }

    const placeholders = patent_numbers.map(() => '?').join(', ')

    if (action === 'approve') {
      await executeAppD1(
        `UPDATE patent_scores
         SET approved_for_content = 1, approved_at = CURRENT_TIMESTAMP
         WHERE patent_number IN (${placeholders})`,
        patent_numbers
      )
      triggerGenerator(patent_numbers)
    } else {
      await executeAppD1(
        `UPDATE patent_scores SET rejected = 1 WHERE patent_number IN (${placeholders})`,
        patent_numbers
      )
    }

    return NextResponse.json({ success: true, count: patent_numbers.length, action })
  } catch (err) {
    console.error('POST /api/admin/patents error:', err)
    return NextResponse.json({ error: 'Action failed' }, { status: 500 })
  }
}
