import { NextResponse } from 'next/server'
import { queryD1 } from '@/lib/db'

export interface PipelineStats {
  total_scored: number
  total_reviewable: number   // score >= 7, not approved/rejected
  total_high_score: number   // score >= 8
  total_approved: number
  content_pending: number
  content_published: number
}

export async function GET() {
  try {
    // Run each count as a separate query — D1 handles these reliably
    const [scored, reviewable, high, approved, pending, published] = await Promise.all([
      queryD1<{ n: number }>('SELECT COUNT(*) as n FROM patent_scores WHERE score > 0'),
      queryD1<{ n: number }>('SELECT COUNT(*) as n FROM patent_scores WHERE score >= 7 AND approved_for_content = 0 AND (rejected IS NULL OR rejected = 0)'),
      queryD1<{ n: number }>('SELECT COUNT(*) as n FROM patent_scores WHERE score >= 8'),
      queryD1<{ n: number }>('SELECT COUNT(*) as n FROM patent_scores WHERE approved_for_content = 1'),
      queryD1<{ n: number }>("SELECT COUNT(*) as n FROM content_queue WHERE status = 'pending'"),
      queryD1<{ n: number }>('SELECT COUNT(*) as n FROM published_content'),
    ])

    const stats: PipelineStats = {
      total_scored: scored[0]?.n ?? 0,
      total_reviewable: reviewable[0]?.n ?? 0,
      total_high_score: high[0]?.n ?? 0,
      total_approved: approved[0]?.n ?? 0,
      content_pending: pending[0]?.n ?? 0,
      content_published: published[0]?.n ?? 0,
    }

    return NextResponse.json(stats)
  } catch (err) {
    console.error('GET /api/admin/stats error:', err)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
