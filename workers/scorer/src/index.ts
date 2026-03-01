/**
 * Patent Scorer Worker — InventionGenie
 *
 * Runs on Cloudflare Cron Trigger every 5 minutes.
 * Each run processes BATCH_SIZE unscored expired utility patents:
 *   1. Fetch abstracts from PatentsView (parallel batches, 45 req/min limit)
 *   2. Check Google Patents for diagrams (sequential, 1-3s random delay, circuit breaker)
 *   3. Score with Claude Haiku (structured JSON with plain-English translation)
 *   4. Save ALL processed patents to patent_scores — even rejections (score=0)
 *      so they are excluded from future batches and never re-processed
 *
 * The fetch handler accepts POST from the admin "Run Now" button.
 */

export interface Env {
  PATENTS_DB: D1Database  // patent-tracker-db — patents table (read-only)
  APP_DB: D1Database      // inventiongenie-db — patent_scores, prompts (read/write)
  R2_BUCKET: R2Bucket
  ANTHROPIC_API_KEY: string
  PATENTSVIEW_API_KEY: string
  WORKER_AUTH_SECRET: string
  DOMAIN: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const BATCH_SIZE = 20
const PATENTSVIEW_RATE_LIMIT = 45 // max requests per 60-second window
const CPC_DESCRIPTIONS: Record<string, string> = {
  A: 'Human Necessities (food, clothing, personal care, health, amusement)',
  B: 'Performing Operations, Transporting (separating, mixing, shaping, printing, vehicles)',
  C: 'Chemistry, Metallurgy (materials, compounds, processes)',
  D: 'Textiles, Paper (fiber treatment, weaving, apparel)',
  E: 'Fixed Constructions (buildings, civil engineering, sanitary)',
  F: 'Mechanical Engineering, Lighting, Heating (engines, weapons, pumps)',
  G: 'Physics (instruments, nuclear, computing, optics)',
  H: 'Electricity, Electronics (circuits, communications, semiconductors)',
  Y: 'Emerging Cross-Sector Technologies',
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PatentRow {
  patent_number: string
  title: string
  assignee_name: string | null
  cpc_section: string | null
  calculated_expiration_date: string | null
  filing_date: string | null
  grant_date: string | null
}

interface ScoringResult {
  plain_english: string
  consumer_relevance: number
  relatability: number
  explainability: number
  visual_appeal: number
  score: number
  reasoning: string
}

interface BatchStats {
  fetched: number
  no_abstract: number
  no_diagrams: number
  scored: number
  approved: number // score >= 8
  errors: number
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}


/**
 * Fill {{placeholder}} template variables.
 * Used to inject patent data into the scoring prompt stored in D1.
 */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

// ─── PatentsView Rate Limiter ─────────────────────────────────────────────────
//
// Tracks timestamps of recent API calls within a 60-second sliding window.
// Blocks when the window is full and waits until space opens up.
// This instance is per-Worker-invocation (no cross-invocation shared state).

const patentsViewLimiter = {
  queue: [] as number[],

  async throttle(): Promise<void> {
    const now = Date.now()
    // Drop timestamps older than 60 seconds
    this.queue = this.queue.filter((t) => now - t < 60_000)

    if (this.queue.length >= PATENTSVIEW_RATE_LIMIT) {
      // Wait until the oldest call falls out of the window
      const wait = 60_000 - (now - this.queue[0]) + 100
      await sleep(wait)
      return this.throttle()
    }

    this.queue.push(Date.now())
  },
}

// ─── PatentsView — Abstract + Diagram Fetching ───────────────────────────────
//
// Fetches abstract AND diagram count in a single PatentsView call.
// `figures` is a NESTED ENTITY in PatentsView API v1 — use dot notation in the
// fields array (e.g. "figures.num_figures"), NOT a top-level field name.
// The response returns a `figures` array within each patent object.

interface PatentViewData {
  abstract: string | null
  hasDiagrams: boolean
}

async function fetchPatentViewData(patentNumber: string, apiKey: string): Promise<PatentViewData> {
  await patentsViewLimiter.throttle()

  const q = encodeURIComponent(JSON.stringify({ patent_id: patentNumber }))
  const f = encodeURIComponent(JSON.stringify(['patent_abstract', 'patent_id', 'figures.num_figures']))
  const url = `https://search.patentsview.org/api/v1/patent/?q=${q}&f=${f}`

  try {
    const response = await fetch(url, { headers: { 'X-Api-Key': apiKey } })
    if (!response.ok) {
      await response.body?.cancel()
      return { abstract: null, hasDiagrams: false }
    }

    const data = (await response.json()) as {
      patents?: Array<{
        patent_abstract?: string | null
        figures?: Array<{ num_figures?: number | null }>
      }>
      error?: boolean
    }

    if (data.error || !data.patents?.length) return { abstract: null, hasDiagrams: false }

    const patent = data.patents[0]
    const abstract = patent.patent_abstract ?? null
    const numFigures = patent.figures?.[0]?.num_figures
    // If field is missing/null (shouldn't happen, but be safe), default true:
    // better to score a diagram-less patent than to wrongly reject one that has diagrams
    const hasDiagrams = numFigures == null ? true : numFigures > 0

    return { abstract, hasDiagrams }
  } catch {
    return { abstract: null, hasDiagrams: false }
  }
}

/**
 * Fetch abstract + diagram flag for an entire batch in parallel chunks of 10.
 * 700ms pause between chunks to stay within PatentsView rate limit.
 */
async function fetchAllPatentViewData(
  patents: PatentRow[],
  apiKey: string
): Promise<Map<string, PatentViewData>> {
  const results = new Map<string, PatentViewData>()
  const CHUNK = 10

  for (let i = 0; i < patents.length; i += CHUNK) {
    const chunk = patents.slice(i, i + CHUNK)

    const chunkResults = await Promise.all(
      chunk.map((p) =>
        fetchPatentViewData(p.patent_number, apiKey).then((data) => ({
          number: p.patent_number,
          data,
        }))
      )
    )

    chunkResults.forEach((r) => results.set(r.number, r.data))

    if (i + CHUNK < patents.length) {
      await sleep(700)
    }
  }

  return results
}


// ─── Claude Haiku — Scoring ───────────────────────────────────────────────────

async function scoreWithHaiku(
  patent: PatentRow,
  abstract: string,
  hasDiagrams: boolean,
  promptTemplate: string,
  apiKey: string
): Promise<ScoringResult | null> {
  const cpcDesc =
    patent.cpc_section ? (CPC_DESCRIPTIONS[patent.cpc_section] ?? patent.cpc_section) : 'Unknown'

  const prompt = fillTemplate(promptTemplate, {
    patent_number: patent.patent_number,
    title: patent.title,
    assignee_name: patent.assignee_name ?? 'Unknown',
    abstract,
    cpc_section: patent.cpc_section ?? 'Unknown',
    cpc_description: cpcDesc,
    has_diagrams: hasDiagrams ? 'Yes' : 'No',
  })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error(`Haiku API error ${response.status} for patent ${patent.patent_number}: ${errBody}`)
      return null
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>
    }

    const rawText = data.content[0]?.text ?? ''

    // Strip markdown code fences if Haiku wrapped the JSON despite instructions
    const jsonText = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

    const result = JSON.parse(jsonText) as ScoringResult

    // Validate required fields are present and numeric
    // Validate required numeric fields
    const r = result as unknown as Record<string, unknown>
    const required = ['consumer_relevance', 'relatability', 'explainability', 'visual_appeal', 'score']
    for (const field of required) {
      if (typeof r[field] !== 'number') {
        console.error(`Haiku response missing field "${field}" for ${patent.patent_number}`)
        return null
      }
    }

    return result
  } catch (err) {
    console.error(`Failed to score patent ${patent.patent_number}:`, err)
    return null
  }
}

// ─── D1 Writes ────────────────────────────────────────────────────────────────

async function fetchScoringPrompt(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT prompt_text FROM prompts WHERE prompt_type = 'scoring' AND is_active = 1 ORDER BY version DESC LIMIT 1"
    )
    .first<{ prompt_text: string }>()
  return row?.prompt_text ?? null
}

async function saveScore(
  db: D1Database,
  patentNumber: string,
  score: number,
  abstract: string | null,
  hasDiagrams: boolean,
  result: ScoringResult | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO patent_scores
        (patent_number, score, consumer_relevance, relatability,
         explainability, visual_appeal, abstract, plain_english,
         has_diagrams, reasoning)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(patent_number) DO NOTHING`
    )
    .bind(
      patentNumber,
      score,
      result?.consumer_relevance ?? null,
      result?.relatability ?? null,
      result?.explainability ?? null,
      result?.visual_appeal ?? null,
      abstract,
      result?.plain_english ?? null,
      hasDiagrams ? 1 : 0,
      result?.reasoning ?? null
    )
    .run()
}

// ─── Main Scoring Orchestrator ────────────────────────────────────────────────

async function runScoringBatch(env: Env): Promise<BatchStats> {
  const stats: BatchStats = {
    fetched: 0,
    no_abstract: 0,
    no_diagrams: 0,
    scored: 0,
    approved: 0,
    errors: 0,
  }

  // 1. Load active scoring prompt from inventiongenie-db (APP_DB)
  const promptTemplate = await fetchScoringPrompt(env.APP_DB)
  if (!promptTemplate) {
    console.error('No active scoring prompt in prompts table — aborting batch')
    return stats
  }

  // 2. Fetch unscored expired utility patents
  //    - Oversample from PATENTS_DB (3x batch size) to account for already-scored overlap
  //    - D1 binding hard limit: 100 SQL variables per query — oversample must stay under that
  //    - Can't use a cross-DB subquery, so filter in code after checking APP_DB
  const OVERSAMPLE = BATCH_SIZE * 3  // 20 * 3 = 60 — safely under D1's 100-variable limit
  const { results: candidates } = await env.PATENTS_DB.prepare(
    `SELECT patent_number, title, assignee_name, cpc_section,
            calculated_expiration_date, filing_date, grant_date
     FROM patents
     WHERE status = 'Expired'
       AND enriched = 1
       AND title IS NOT NULL
       AND patent_number NOT LIKE 'D%'
     ORDER BY RANDOM()
     LIMIT ?`
  )
    .bind(OVERSAMPLE)
    .all<PatentRow>()

  // Filter out already-scored patents by querying APP_DB with the candidate numbers
  let patents: PatentRow[] = candidates
  if (candidates.length > 0) {
    const candidateNumbers = candidates.map(c => c.patent_number)
    const placeholders = candidateNumbers.map(() => '?').join(', ')
    const { results: scoredRows } = await env.APP_DB.prepare(
      `SELECT patent_number FROM patent_scores WHERE patent_number IN (${placeholders})`
    ).bind(...candidateNumbers).all<{ patent_number: string }>()
    const scoredSet = new Set(scoredRows.map(r => r.patent_number))
    patents = candidates.filter(c => !scoredSet.has(c.patent_number)).slice(0, BATCH_SIZE)
  }

  stats.fetched = patents.length

  if (patents.length === 0) {
    console.log('No unscored patents remaining in pool')
    return stats
  }

  // 3. Fetch abstracts + diagram flags from PatentsView in parallel chunks
  const patentViewData = await fetchAllPatentViewData(patents, env.PATENTSVIEW_API_KEY)

  // 4. Process each patent
  for (const patent of patents) {
    try {
      const pvData = patentViewData.get(patent.patent_number) ?? { abstract: null, hasDiagrams: false }
      const { abstract, hasDiagrams } = pvData

      // No abstract — save as score=0 to prevent future re-processing
      if (!abstract) {
        stats.no_abstract++
        await saveScore(env.APP_DB, patent.patent_number, 0, null, false, null)
        continue
      }

      // No diagrams per PatentsView figures.num_figures — auto-reject and save to prevent re-processing
      if (!hasDiagrams) {
        stats.no_diagrams++
        await saveScore(env.APP_DB, patent.patent_number, 0, abstract, false, null)
        continue
      }

      // Score with Claude Haiku
      const result = await scoreWithHaiku(
        patent,
        abstract,
        hasDiagrams,
        promptTemplate,
        env.ANTHROPIC_API_KEY
      )

      if (!result) {
        // Haiku call failed or returned invalid JSON — save score=0 to avoid retry loop
        stats.errors++
        await saveScore(env.APP_DB, patent.patent_number, 0, abstract, hasDiagrams, null)
        continue
      }

      await saveScore(env.APP_DB, patent.patent_number, result.score, abstract, hasDiagrams, result)
      stats.scored++
      if (result.score >= 8) stats.approved++

      console.log(
        `[${result.score}/10] ${patent.patent_number} — ${patent.title.slice(0, 60)}`
      )
    } catch (err) {
      console.error(`Unhandled error on patent ${patent.patent_number}:`, err)
      stats.errors++
    }
  }

  console.log('Batch complete:', JSON.stringify(stats))
  return stats
}

// ─── Worker Export ────────────────────────────────────────────────────────────

export default {
  // Cron trigger — fires every 5 minutes, no human action needed
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScoringBatch(env))
  },

  // Fetch handler — "Run Now" button in admin POSTs here
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    // Verify request comes from our admin (shared secret)
    const authHeader = request.headers.get('x-worker-secret')
    if (!authHeader || authHeader !== env.WORKER_AUTH_SECRET) {
      return new Response('Unauthorized', { status: 401 })
    }

    try {
      const stats = await runScoringBatch(env)
      return Response.json({ success: true, stats })
    } catch (err) {
      console.error('Scoring batch failed:', err)
      return Response.json({ success: false, error: (err as Error).message }, { status: 500 })
    }
  },
}
