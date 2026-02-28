/**
 * Patent Scorer Worker
 * Runs on Cloudflare Cron Trigger every 5 minutes.
 * Fetches 50 unscored expired patents, scores them with Claude Haiku,
 * saves 8+ scores to patent_scores table.
 *
 * Built in Stage 2.
 */

export interface Env {
  DB: D1Database
  R2_BUCKET: R2Bucket
  ANTHROPIC_API_KEY: string
  PATENTSVIEW_API_KEY: string
  DOMAIN: string
}

export default {
  // Cron trigger — fires every 5 minutes automatically
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScoringBatch(env))
  },

  // Manual trigger — "Run Now" button in admin calls this
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const result = await runScoringBatch(env)
    return Response.json(result)
  },
}

async function runScoringBatch(_env: Env): Promise<{ success: boolean; message: string }> {
  // Implemented in Stage 2
  return { success: true, message: 'Scorer not yet implemented — Stage 2' }
}
