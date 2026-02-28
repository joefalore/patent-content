import { NextResponse } from 'next/server'
import { queryD1, executeD1 } from '@/lib/db'
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
    const patents = await queryD1<ScoredPatent>(`
      SELECT
        ps.id, ps.patent_number, ps.score,
        ps.consumer_relevance, ps.relatability, ps.explainability, ps.visual_appeal,
        ps.abstract, ps.plain_english, ps.reasoning, ps.has_diagrams,
        ps.scored_at, ps.approved_for_content, ps.approved_at, ps.rejected,
        p.title, p.assignee_name, p.cpc_section,
        p.calculated_expiration_date, p.filing_date, p.grant_date
      FROM patent_scores ps
      JOIN patents p ON p.patent_number = ps.patent_number
      WHERE ps.score >= 7
        AND ps.approved_for_content = 0
        AND (ps.rejected IS NULL OR ps.rejected = 0)
      ORDER BY ps.score DESC, ps.scored_at DESC
      LIMIT 200
    `)

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

    // Build parameterized IN clause
    const placeholders = patent_numbers.map(() => '?').join(', ')

    if (action === 'approve') {
      await executeD1(
        `UPDATE patent_scores
         SET approved_for_content = 1, approved_at = CURRENT_TIMESTAMP
         WHERE patent_number IN (${placeholders})`,
        patent_numbers
      )

      // Fire-and-forget content generation for each approved patent
      triggerGenerator(patent_numbers)
    } else {
      await executeD1(
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
